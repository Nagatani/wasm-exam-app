# 運用ガイド

講義で使う本番環境の構築・設定・運用の手順です。開発環境は [README の「初回セットアップ」](../README.md#1-初回セットアップ開発環境) を参照してください。

## 構成

本番では**フロントエンドの本番ビルドを `server` が配信**します。画面と API が1プロセス・1ポートになるので、リバースプロキシ（TLS 終端）の後ろに `server` を1つ置くだけで済みます。構成は2通りで、違いは「`server` をホストで動かすか、コンテナで動かすか」です。

### 構成A：ホストで `npm start`

```
[ブラウザ] ──► [リバースプロキシ (TLS)] ──► [server (Node, :4000, ホストプロセス)]
                                              ├─ 静的配信: フロントエンドの本番ビルド (dist/)
                                              ├─ API: /api/*
                                              ├─► [PostgreSQL]
                                              └─► [judge コンテナ (127.0.0.1:4001)]
```

手順が少なく済みます。ただし `server` がホストの公開ポート経由で judge に到達するため、**judge の外向き通信は遮断できません**（後述「judge のネットワーク遮断」）。

### 構成B：Docker Compose でまとめて実行

```
[ブラウザ] ──► [リバースプロキシ (TLS)] ──► [server コンテナ (:4000)] ──► [外部の PostgreSQL]
                                                    │
                                                    └─ Docker の内部ネットワークのみ ──► [judge コンテナ]（外向き通信不可・ポート非公開）
```

`server` もコンテナ化し、judge と同じ Docker 内部ネットワーク（`internal: true`）に置いて `http://judge:8080` で到達させます。judge はホストにポートを公開しないので、外向き通信を遮断できます。

**選び方**：生徒のコードを実行する judge をネットワークから切り離したいなら構成B、手順の少なさを優先するなら構成A。後から切り替えても構いません。

## 必要なもの

- Node.js **22.12 以降**（構成B はビルドがコンテナ内で行われるため、ホストではマイグレーション実行用にのみ使います）
- PostgreSQL（本番は管理された PostgreSQL を推奨。`docker-compose.yml` の `db` は開発用）
- Docker（judge 用。構成B では `server` もコンテナで動かします）

## デプロイ手順（構成A）

```bash
# 1. 取得・依存インストール
git pull
npm ci
npm --prefix server ci

# 2. フロントエンドを同一オリジン配信向けにビルド
cp .env.production.example .env.production      # 初回のみ（VITE_API_BASE_URL は空のまま）
npm run build:full                              # dist/ を生成し server/ もビルド

# 3. サーバーの環境変数（server/.env、server/.env.example をもとに作成）
#    DATABASE_URL=postgresql://USER:PASS@HOST:5432/DBNAME
#    PORT=4000
#    CORS_ORIGIN=https://exam.example.ac.jp      # 画面を配信するオリジン
#    NODE_ENV=production
#    JUDGE_URL=http://localhost:4001             # 本採点・Java 実行用
#    JUDGE_CONCURRENCY=2                         # judge の JUDGE_MAX_CONCURRENT と同じ値に
#    ALLOW_SIGNUP=false                          # 名簿から一括作成で運用する場合
#    TRUST_PROXY=1                               # リバースプロキシ経由の場合

# 4. DB マイグレーションを適用
npm --prefix server run prisma:deploy

# 5. judge を起動（CPU を増やす場合は「採点の処理能力」を参照）
docker compose up -d --build judge

# 6. サーバーを起動（pm2 / systemd などで常駐させる）
npm start
```

`.env.production` の `VITE_API_BASE_URL` は**空**にします。空だと API 呼び出しが同一オリジンの相対パス（`/api/...`）になり、どのホスト名で配信しても同じビルドが動きます。

## デプロイ手順（構成B）

`docker-compose.prod.yml` が judge と `server`（フロントエンド同梱、イメージは `server/Dockerfile`）をまとめて起動します。本番は管理された PostgreSQL を前提としているため、このファイルに `db` サービスはありません。

```bash
# 1. 取得
git pull

# 2. サーバーの環境変数（server/.env ではなく server/.env.prod.docker）
cp server/.env.prod.docker.example server/.env.prod.docker
#   DATABASE_URL=postgresql://USER:PASS@到達できるホスト:5432/DBNAME
#   CORS_ORIGIN=https://exam.example.ac.jp
#   ALLOW_SIGNUP=false / TRUST_PROXY=1 は既定で設定済み
#   JUDGE_URL は compose 側が http://judge:8080 に設定するので不要

# 3. DB マイグレーションを適用（ホストから。初回は npm --prefix server ci が必要）
DATABASE_URL=... npm --prefix server run prisma:deploy

# 4. ビルドして起動
npm run docker:prod
# 同義: docker compose -f docker-compose.prod.yml up -d --build

# 5. 確認
curl http://127.0.0.1:4000/health   # {"ok":true}
docker compose -f docker-compose.prod.yml logs -f server
```

- リバースプロキシは `127.0.0.1:4000` に向けます。
- `docker-compose.yml` と `docker-compose.prod.yml` は**併用しない**でください。同じディレクトリでは同じプロジェクト名になり、judge がどちらかの定義で上書きされます。切り替えるときは先に `down` してください。

## アップグレード

**構成A**

```bash
git pull
npm ci && npm --prefix server ci
npm --prefix server run prisma:deploy
npm run build:full
# server を再起動（pm2 restart / systemctl restart など）
docker compose up -d --build judge      # judge/ に変更があったとき
```

**構成B**

```bash
git pull
DATABASE_URL=... npm --prefix server run prisma:deploy
npm run docker:prod                     # judge・server を再ビルドして再起動
```

マイグレーションの適用状況は `server/` で `npx prisma migrate status` で確認できます。

## HTTP ヘッダー

### 必須：COOP / COEP

画面（HTML）を配信する層は、次の2つを**必ず**返す必要があります。

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

これがないと **C**（`SharedArrayBuffer` を使用）と **Python**（Pyodide）がブラウザで動きません。

- `server` が全レスポンスに付けているので、`server` から配信するなら追加設定は不要です。
- リバースプロキシがこれらを**削除・上書きしない**よう注意してください（`proxy_hide_header` や `more_clear_headers` など）。
- 確認方法：ブラウザの DevTools コンソールで `self.crossOriginIsolated` が `true` であること。

あわせて `X-Content-Type-Options: nosniff` と `Referrer-Policy: strict-origin-when-cross-origin` も付けています（アップロード画像の誤解釈防止と、試験 ID を含む URL の外部送信防止）。これらもプロキシで消さないでください。

### Content-Security-Policy（CSP）

外部から読み込んでよい取得先を許可リストで限定します。許可しているのは jsDelivr（Monaco エディタ・Pyodide）、Wasmer レジストリ（C の clang）、Hugging Face / GitHub raw（AI 機能のモデル）です。環境変数 `CSP_MODE` で動作を選びます。

| `CSP_MODE` | 動作 |
|---|---|
| `report`（既定） | `Content-Security-Policy-Report-Only` を送る。**何もブロックしない**。違反はブラウザが `/api/csp-report` に報告し、サーバーログに `CSP violation: ...` と出る（1分あたり最大30行） |
| `enforce` | 適用する（許可リスト外の読み込みをブロック） |
| `off` | 送らない |

- まず `report` のまま授業で一通り使い（C・Python・AI 機能を使うならそれも）、ログに `CSP violation` が出ないことを確認してから `enforce` にしてください。
- Monaco・JS/TS・Python・C は `enforce` で動作することを自動テストで確認しています。AI 機能（WebLLM）は `enforce` での動作を確認していないため、AI 機能を使う場合は `report` のままにしておくのが安全です。
- Pyodide を別ホストに置いた場合は、`CSP_EXTRA_SOURCES` にその origin を空白区切りで追加してください（同一オリジンなら不要）。

## judge（採点・Java 実行）

judge は生徒のコードをコンパイル・実行するサンドボックスのコンテナです。

- **本採点はすべて judge で行います**。試験の最終提出・時間切れの自動提出・再採点では、全言語（C / Java / JS / TS / Python）の下書きを judge が実行して採点します。生徒の「実行」（お試し）は Java 以外はブラウザ内です。
- **judge はブラウザと同じ実行環境で採点**するので、「実行」と本採点で結果がずれません。C は clang 16 で WebAssembly（wasm32-wasi）にして Node の WASI で実行、Python はブラウザと同じ版の Pyodide、JS/TS はブラウザと共通の入出力コード（`judge/runner/shared/`）を使います。時間制限もブラウザと同じ（C/JS/TS 10秒・Python 15秒。テストケースごとの設定は Java のみ有効）。
- 最終提出は押した時点で確定し（提出時刻もその時点）、採点は裏で行います（生徒の画面は「採点中」→数秒で結果）。**judge が止まっていても提出は失われません**。「採点中」のまま `GRADING_RETRY_MS`（既定15秒）ごとに再試行し、judge が戻れば自動で採点されます。サーバーを再起動しても、採点中の受験は起動時に再開されます。
- `JUDGE_URL` を空にすると judge を使わない構成になります。Java の問題は「準備中」表示になり、C / JS / TS / Python は生徒のブラウザで実行した結果をもとに採点します（時間切れの自動提出では、これらの言語の下書きは再実行できず0点）。**確認テストでは judge を使う構成を推奨します。**
- **サンドボックスはコンテナ自体**です。`cap_drop: ALL`・`read_only`・tmpfs の作業領域（`noexec`）・`pids_limit`・`mem_limit`・`cpus`・`no-new-privileges`・非 root ユーザーで動かし、生徒のコードはホストでは一切実行しません。
- **イメージの中身**：JDK 24（Java、`--enable-preview`）、clang 16 + wasi-libc（C）、Node 22 + `judge/runner/`（JS/TS/Python。Pyodide と sucrase はブラウザと同じ版に固定）。Python はビルド時に作る Pyodide のメモリスナップショットから提出ごとに新しいインタープリタを復元します（生徒のコードを動かす前の状態なので、提出どうしが影響し合うことはありません）。
- `judge/`（`judge/runner/shared/` を含む）を変更したら、judge イメージの再ビルドが必要です。

### 接続・確認

| | 構成A（`docker-compose.yml`） | 構成B（`docker-compose.prod.yml`） |
|---|---|---|
| 到達方法 | ホストの `127.0.0.1:4001`（外部には非公開）。`JUDGE_URL=http://localhost:4001` | 内部ネットワークの `http://judge:8080`（`JUDGE_URL` は compose が設定） |
| ログ | `docker compose logs -f judge` | `docker compose -f docker-compose.prod.yml logs -f judge` |
| ヘルスチェック | `curl http://localhost:4001/health` | `docker compose -f docker-compose.prod.yml exec server node -e "fetch('http://judge:8080/health').then(r=>r.text()).then(console.log)"` |

講師画面の ☰ →「管理者メニュー」の「サービス状態」でも DB と judge の状態を確認できます。

### 負荷制御の設定

| 変数 | 設定する側 | 既定 | 内容 |
|---|---|---|---|
| `JUDGE_CONCURRENCY` | server | 2 | server が同時に judge へ送る最大数。**judge の `JUDGE_MAX_CONCURRENT` と同じ値に**（構成B は compose が揃えます） |
| `GRADING_CONCURRENCY` | server | `JUDGE_CONCURRENCY` の2倍 | 同時に採点処理を進める受験の数 |
| `JUDGE_REQUEST_TIMEOUT_MS` | server | 60000 | judge への1リクエストのタイムアウト |
| `JUDGE_MAX_CONCURRENT` | judge（compose） | 2 | コンテナ内の同時コンパイル・実行数 |
| `JUDGE_CPUS` | judge（compose） | 2.0 | judge に割り当てる CPU |
| `JUDGE_MEM_LIMIT` | judge（compose） | 1g | judge のメモリ上限 |

- 生徒の「実行」（Java）と講師の検証・再採点は、裏の採点より**優先して**処理されます（最終提出が殺到しても「実行」が採点待ちの後ろに並びません）。
- 「実行」はユーザーあたり同時1件までです（超過は即 429）。裏の採点は順番待ちになるだけです。
- `server` は**単一インスタンスで運用してください**。同時実行の制御・ログイン試行の記録はプロセスのメモリ上にあるため、複数インスタンスにすると制限が正しく効きません。

### 採点の処理能力（一斉提出への備え）

最終提出は押した時点で確定するため、同時に何人提出しても提出そのものは遅れません（100人同時でも応答は最大約0.2秒）。「採点中」から結果が出るまでの時間は、judge に割り当てた **CPU 数にほぼ比例して短くなります**。

実測値（8コアの開発機。生徒100人が 5問〈C・JS・TS・Python・Java 各1問、テストケース各5件〉の試験を同時に最終提出）：

| judge の設定 | 全員の採点完了 | 半数の採点完了 |
|---|---|---|
| 2コア・同時2（既定） | 約57秒 | 約33秒 |
| 4コア・同時4 | 約35秒 | 約21秒 |
| 6コア・同時6 | 約27秒 | 約17秒 |

- 問題1問（テストケース5件）あたりの judge の CPU 消費の目安：C 約0.1秒、JS/TS 約0.12秒、Java 約0.2秒、Python 約0.45秒。
- **数十人〜100人規模なら既定（2コア）でも1分前後で全員の採点が終わります**。早く結果を返したい場合は、サーバーのコア数に余裕があれば judge に多く割り当ててください（例：8コアのサーバーなら4〜6コア）。
- 変更方法（構成A）：`JUDGE_CPUS=4 JUDGE_MAX_CONCURRENT=4 JUDGE_MEM_LIMIT=2g docker compose up -d judge` とし、`server/.env` の `JUDGE_CONCURRENCY=4` に揃えてサーバーを再起動。構成B：同じ変数を `docker compose -f docker-compose.prod.yml` の実行時（シェルまたは `.env`）に指定すれば、server 側も自動で揃います。
- メモリの目安は同時実行1つあたり最大 300MB 程度（Python）。`JUDGE_MEM_LIMIT` は「同時実行数 × 0.4GB」程度にしてください。
- 採点が混んでいる間も、Java の「実行」は優先処理されて約0.5秒で返ります。
- 自分の環境で測る場合は `server/scripts/loadtest-grading.ts`（使い方はファイル冒頭）を使ってください。

### judge のネットワーク遮断

`cap_drop` などはホストへの影響を制限しますが、**外向きのネットワーク通信は止めません**。judge は DB に触れず個人情報も持たないため漏洩の実害は小さいものの、クラウドのメタデータエンドポイント（`169.254.169.254` など）へのアクセスなど、踏み台にされるリスクは残ります。

**構成B ではこれを遮断しています**。judge は `internal: true` のネットワーク（judge と server だけが所属）にのみ接続し、ホストに公開ポートを持ちません。judge からは DNS 解決も IP 直接の接続もできず、server からは `http://judge:8080` で到達できます。server 自身は別の通常ネットワークにも所属しているので、外部の PostgreSQL などには普通に接続できます。

構成A のまま judge だけを `internal: true` にすることはできません（ホストで動く server から到達するために公開ポートが必要で、Docker Desktop では `internal: true` と公開ポートが両立しないため）。構成A で遮断したい場合は、ホストのファイアウォールで judge のブリッジネットワークからの外向き通信を落とす方法があります（Linux の例：`iptables -I DOCKER-USER -s <judge のサブネット> ! -d <server/db> -j DROP`）。

## ブラウザ側の実行環境の配信（一斉受験への備え）

C（clang ツールチェイン、初回 約106MB）と Python（Pyodide、初回 約10MB）はブラウザが初回に取得します。1クラスが一斉に取得すると学内回線を圧迫し、最初のコンパイルに数分かかることがあります。

- **生徒ダッシュボードの「実行環境の準備状況」**：開くと自動で取得を始め、C / Python の状態（未取得 / 準備中 / 準備完了 / 取得失敗）を表示します。その試験で使う言語の準備ができるまで「受験する」は押せません（受験中の回の再開は妨げません）。受験前に「準備完了」にしておくよう生徒に案内してください。
- **演習室 PC の事前準備**：授業前に各 PC で生徒ダッシュボードを一度開いておくとブラウザにキャッシュされ、本番の一斉取得を避けられます。
- **Pyodide の配信元**：既定は jsDelivr CDN（v0.28.0）。学内から到達できない場合や CDN に依存したくない場合は、Pyodide v0.28.0 の配布物（`full/` 一式）を自前で配信し、ビルド時に `VITE_PYODIDE_BASE_URL`（例：`/pyodide/v0.28.0/full/`、`.env.production` に記入）を指定して `npm run build:full` し直してください。別オリジンに置く場合は COOP/COEP と両立する CORP/CORS ヘッダーも必要です（同一オリジンに置くのが簡単です）。
- **clang の配信元**：Wasmer レジストリから取得し、URL の差し替えはできません。上記の事前準備でキャッシュさせる運用を推奨します。

### AI 機能のモデル

AI作問サポート（講師）と AIヒント（生徒・演習モードのみ）は、同じブラウザ内 LLM（`Qwen2.5-Coder-3B-Instruct`、**約2.5GB**）をダウンロードします。

- **オプトイン式なので、既定では誰もダウンロードしません**。☰ →「設定（AI機能など）」で有効にした人のブラウザにだけ入ります。使う予定がなければ有効化しないよう案内してください。
- 配信元（`@mlc-ai/web-llm` が参照する Hugging Face 等）はアプリ側で変更できません。学内から到達できない環境では使えません。
- クラス全体で AIヒントを使う授業では、事前に各ブラウザでダウンロードを済ませておくことを推奨します。
- オプトインを切ってもモデルは残ります。削除するには「設定（AI機能など）」の「ダウンロード済みモデルを削除してオフにする」を使います（講師・生徒の両機能で同じキャッシュを共有しているため、どちらから削除しても両方に効きます）。

## アカウント

### 生徒アカウントの一括作成と初期パスワード

講師は ☰ →「クラス管理」から、`学籍番号,氏名` の名簿で生徒アカウントを一括作成できます。

- 各アカウントにランダムな約12文字の**初期パスワード**が発行されます。講師が配布用の用紙を（紛失時も）再印刷できるよう、初期パスワードは `users.initialPassword` に**平文で保存**されます。生徒が初回ログインでパスワードを変更すると消去され、以後は表示されません。講師用の画面・API からしか返しません。
- この平文保存が許容できない場合は、一括作成時の応答でのみ初期パスワードを返し、列を持たない方式に変更してください。
- 配布用の用紙は印刷後に適切に管理・破棄してください。
- **パスワードを忘れた生徒**は、講師が受講者一覧の「パスワード再発行」、または ☰ →「管理者メニュー」の「パスワードの再発行」（学籍番号指定。クラス未所属の生徒にも使える）で復旧できます。新しい初期パスワードが発行され、その生徒のログインはすべて失効し、ログイン制限も解除されます。
- **ログアウトだけさせたい**とき（共用 PC でのログアウト忘れなど）は、受講者一覧の「ログアウトさせる」または ☰ →「管理者メニュー」の「強制ログアウト」を使います。パスワードは変わりません。
- どちらも教員アカウントは対象外です。

### ログイン・アカウントの保護

- **ログイン試行回数の制限**：同じ学籍番号・同じ IP から**10回**失敗すると、その組み合わせは**15分間** `429` になります（正しいパスワードでも不可）。1つの IP から全アカウント合計で**100回**失敗した場合もその IP を15分止めます（教室が1つの NAT アドレスを共有していても、普通の打ち間違いでは届かない値です）。ログインに成功するとその学籍番号の失敗回数はリセットされます。値は `LOGIN_MAX_FAILURES` / `LOGIN_MAX_FAILURES_PER_IP` / `LOGIN_LOCKOUT_MINUTES` で変更できます。
  - 記録はサーバーのメモリ上にあり、再起動で消えます。
  - ロックされた生徒は、15分待つか、講師が「パスワード再発行」をすればすぐ解除されます。
  - **リバースプロキシの後ろでは `TRUST_PROXY=1`**（プロキシの段数）を設定してください。未設定だと全員がプロキシの IP に見え、IP 単位の上限が全員共通になります。プロキシを通さず直接公開している場合は設定しないでください（`X-Forwarded-For` を偽装できてしまいます）。
- **自己サインアップを閉じる**：`ALLOW_SIGNUP=false` にすると新規登録を受け付けません（ログイン画面の「新規登録」リンクも消えます）。名簿から一括作成する運用では推奨します（開いていると名簿外の人もアカウントを作れ、クラス未指定の試験が見えてしまいます）。ユーザーが1人もいない間だけは、最初の1人（自動で講師になる管理者）を登録できます。既定は `true` で、`server/.env.prod.docker.example` では `false` です。
- **期限切れ・失効したセッションの削除**：起動時と `SESSION_CLEANUP_INTERVAL_HOURS`（既定6）時間ごとに、期限切れ（ログインから12時間）または失効（ログアウト・強制ログアウト・パスワード再発行）したセッションを削除します（`0` で無効）。

## データベース

- `docker-compose.yml` の `db` は開発用です（named volume `pgdata` に保存、ホストの 5433 番に公開）。本番は管理された PostgreSQL を推奨します。

### バックアップ・リストア

学籍番号・氏名・成績・初期パスワードを保存しているため、定期的なバックアップを推奨します。**管理された PostgreSQL を使う場合は、まずそのサービスのバックアップ機能を使ってください**。以下のスクリプトは自前で PostgreSQL を動かす場合向けです。

- **`backup-db.sh` / `restore-db.sh`**：`DATABASE_URL` で到達できる PostgreSQL に対して、ホストの `pg_dump` / `pg_restore` を使います。クライアントのメジャーバージョンは DB サーバーと同じかそれ以上にしてください（古いと `server version mismatch` などで失敗します）。
  ```bash
  npm --prefix server run backup                        # 既定の保存先: server/backups/
  BACKUP_RETENTION_DAYS=14 server/scripts/backup-db.sh /path/to/backup/dir
  server/scripts/restore-db.sh server/backups/wasm-exam-20260914-120000.dump
  ```
- **`backup-db-docker.sh` / `restore-db-docker.sh`**：`docker-compose.yml` の `db` コンテナ内の `pg_dump` / `pg_restore` を使うので、バージョンの不一致が起きません。**リポジトリのルートで実行してください**（別のディレクトリからだと `service "db" is not running` になります。その場合は `COMPOSE_PROJECT_NAME` を指定）。
  ```bash
  server/scripts/backup-db-docker.sh
  server/scripts/restore-db-docker.sh server/backups/wasm-exam-20260914-120000.dump
  ```
- バックアップは `wasm-exam-<日時>.dump`（pg_dump のカスタム形式）として `server/backups/`（Git 管理外）に保存し、`BACKUP_RETENTION_DAYS`（既定30、`0` で無効）より古いものを自動で削除します。失敗したときに空のファイルは残りません。
- リストアは対象 DB の中身をすべて置き換える**破壊的な操作**なので、確認が出ます。復元後は `npm --prefix server run prisma:deploy` でマイグレーションの状態を確認してください。
- 定期実行の例（毎日3時、Linux の cron）：
  ```
  0 3 * * * cd /path/to/wasm-exam-app && server/scripts/backup-db-docker.sh >> /var/log/wasm-exam-backup.log 2>&1
  ```

## アップロードされた画像

講師が問題文に挿入した画像はファイルとして保存され、`/uploads/*` で**認証なしで**配信されます（個人情報ではなく問題文の図版のため）。PNG / JPEG / GIF / WebP、1ファイル5MBまで、講師のみアップロードできます。

- **構成A**：`server/uploads/`（`UPLOADS_DIR` で変更可）に保存されます。
- **構成B**：名前付きボリューム `uploads` に保存されます。`docker compose -f docker-compose.prod.yml down -v` はボリュームごと削除するので、画像を残すなら `-v` を付けないでください。

## トラブルシューティング

| 症状 | 原因 / 対処 |
|---|---|
| C や Python の「実行」が動かない | COOP/COEP ヘッダーがない。DevTools で `self.crossOriginIsolated` が `true` か、リバースプロキシがヘッダーを消していないか確認 |
| Java の問題が「準備中」のまま | `JUDGE_URL` が空、または judge が停止。「管理者メニュー」の「サービス状態」か judge のヘルスチェックで確認 |
| 提出が「採点中」のまま進まない | judge が停止している。復旧すれば自動で採点される（提出は失われない）。server のログに `grading attempt ... failed` が出ていないか確認 |
| Java の実行が 502 になる | judge 側のエラー。judge のログを確認。`mem_limit` / `pids_limit` に達していないか |
| 429（前の実行がまだ処理中）が頻発する | 同じ生徒が連続で「実行」している。受験者数に対して足りない場合は `JUDGE_CONCURRENCY` と judge の CPU・同時実行数を増やす |
| DB に繋がらない / `P1010` | 接続先のポート違い（開発環境は 5433）。`DATABASE_URL` を確認 |
| `npm install` 後に `build` / `lint` が失敗する | Node が 22.11 以下。22.12 以降に上げる |
| マイグレーションのずれの警告 | `server/` で `npx prisma migrate status` → `prisma:deploy` |
| Python の初回読み込みが極端に遅い・失敗する | jsDelivr に到達できるか確認。学内で制限されていれば `VITE_PYODIDE_BASE_URL` で自前配信に切り替える |
| 提出したのに成績に出ない | 試験が「公開中」か。成績は最後に提出した回のみ。採点中なら数秒待つ。生徒が別アカウントで受けていないか |
| 構成B で server が judge に繋がらない | `docker-compose.prod.yml` を `docker-compose.yml` と混ぜずに起動したか。`docker compose -f docker-compose.prod.yml ps` で両方 `Up` か確認 |
| 構成B の `docker build` が `has no exported member` 系のエラーで失敗する | `server/Dockerfile` で `prisma generate` を `tsc` より前に実行する必要がある。Dockerfile を編集した場合はこの順序を守る |
