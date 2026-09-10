# 運用・デプロイガイド

常用環境（講義で使う本番）を構築・運用するための手順です。開発時の起動は [README](../README.md#起動方法)を参照。

## 構成の考え方

運用モードでは **フロントエンドの本番ビルドを `server/` 自身が配信**します（consolidated serving）。APIとフロントを1プロセス・1ポートで扱えるので、リバースプロキシの後ろに `server` を1つ置くだけで済みます。Java実行だけは別に `judge` コンテナが必要です。

```
[ブラウザ] ──► [リバースプロキシ (TLS)] ──► [server (Node, :4000)]
                                              ├─ 静的配信: フロント本番ビルド (dist/)
                                              ├─ API: /api/*
                                              └─ ──► [PostgreSQL]
                                                 ──► [judge コンテナ (127.0.0.1:4001)]  ※Javaのみ
```

## 必要なもの

- Node.js **22.12以降**（22.11以下は `npm install` がネイティブ依存を一部スキップし、`build` が失敗することがあります）
- PostgreSQL（本番は管理されたPostgreSQLを推奨。`docker-compose.yml` の `db` は開発用）
- Docker（`judge` コンテナ用。Java問題を使わないなら不要）

## デプロイ手順

```bash
# 1. 取得・依存インストール
git pull
npm ci
npm --prefix server ci

# 2. フロントエンドを同一オリジン配信向けにビルド
cp .env.production.example .env.production      # 初回のみ（VITE_API_BASE_URL は空のまま）
npm run build:full                              # dist/ を生成し server/ もビルド

# 3. サーバーの環境変数（server/.env）
#    DATABASE_URL=postgresql://USER:PASS@HOST:5432/DBNAME
#    PORT=4000
#    CORS_ORIGIN=https://exam.example.ac.jp      # フロントを配信するオリジン
#    NODE_ENV=production
#    JUDGE_URL=http://localhost:4001             # Java を使わないなら空
#    JUDGE_CONCURRENCY=3
#    JUDGE_REQUEST_TIMEOUT_MS=60000

# 4. DB マイグレーションを適用（スキーマ変更なしの適用のみ）
npm --prefix server run prisma:deploy

# 5. judge コンテナを起動（Java を使う場合）
docker compose up -d judge

# 6. サーバー起動（pm2 / systemd などで常駐させる）
npm start
```

`.env.production` の `VITE_API_BASE_URL` を**空**にするのが要点です。空だとフロントのAPI呼び出しが同一オリジンの相対パス（`/api/...`）になり、どのホスト名で配信しても同じビルドがそのまま動きます。

## 必須HTTPヘッダー（重要）

フロントのHTMLを配信する層は、次の2つのレスポンスヘッダーを**必ず**返す必要があります。

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

これがないと **C（`@wasmer/sdk` が `SharedArrayBuffer` を使用）** と **Python（PyodideのCDN読み込み）** が動きません。ブラウザはcross-origin isolationされたページでしか必要な機能を露出しないためです。JS/TS/Javaには不要ですが、常に付けて問題ありません。

- `npm start` 運用なら `server/src/index.ts` がグローバルミドルウェアで両ヘッダーを設定済みなので、**追加設定は不要**です。
- リバースプロキシがこれらのヘッダーを**削除・上書きしない**ように注意してください（`proxy_hide_header` や `more_clear_headers` の設定に注意）。
- フロントをCDNや別の静的ホストから配信する構成にする場合は、その配信層で両ヘッダーを設定してください。
- 動作確認: ブラウザのDevToolsコンソールで `self.crossOriginIsolated` が `true` であること。

## judgeサービス（Java実行）

- `docker compose up -d judge` で起動。ホストの **`127.0.0.1:4001`** にのみpublishされ、外部には公開されません。`server` は `JUDGE_URL` で到達します。
- `JUDGE_URL` を空にするとJava実行は無効になり、生徒側でJavaの問題は「準備中」表示になります（他言語は影響なし）。
- **サンドボックスはコンテナ自体**です。`docker-compose.yml` で `cap_drop: ALL` / `read_only` / tmpfs作業領域 / `pids_limit` / `mem_limit` / `cpus` / `no-new-privileges` / 非rootユーザーを設定しています。学生コードのコンパイル・実行はこのコンテナ内でのみ行われ、ホストでは一切実行されません。macOSでもLinuxでもDocker上で同一に動きます。
- 負荷制御:
  - `JUDGE_CONCURRENCY`（`server` 側、既定3）… サーバーが同時にjudgeへ投げる最大数
  - ユーザーあたり同時1ジョブ（超過リクエストは即429）
  - `JUDGE_MAX_CONCURRENT`（`judge` コンテナ側、`docker-compose.yml` の環境変数、既定2）… コンテナ内の同時コンパイル・実行数の上限
  - `JUDGE_REQUEST_TIMEOUT_MS`（`server` → judgeの1リクエスト全体のタイムアウト）
- `judge/` のコード（`Judge.java` / `Dockerfile`）を変更したら `docker compose build judge` で再ビルドしてから `up -d`。
- ログ: `docker compose logs -f judge`
- ヘルスチェック: `curl http://localhost:4001/health` → `{"ok":true}`
- スケール注意: `server` 側の同時実行制御は**単一プロセス前提の簡易セマフォ**です。`server` を複数インスタンスで動かす場合、全体の同時実行は「インスタンス数 × `JUDGE_CONCURRENCY`」になります。judge側の `JUDGE_MAX_CONCURRENT` とコンテナのリソース上限で頭打ちにしてください。

## クライアントランタイムの配信・キャッシュ（一斉受験対策）

C（clang ツールチェイン、初回 ~106MB）と Python（Pyodide、初回 ~10MB）はブラウザが初回に取得します。1クラスが一斉に取りに行くと学内回線を圧迫し、最初のコンパイルが数分かかることがあります。以下で緩和します。

- **生徒ダッシュボードの「実行環境の準備状況」**：ページを開くと自動で両ランタイムの取得を開始し、`C` / `Python` の状態（未取得 / 準備中 / 準備完了 / 取得失敗）を表示します。「今すぐ準備する」で手動再開も可能。受験前にこれを「準備完了」にしておくよう生徒に案内してください。取得済みの状態はそのブラウザセッション中は保持されます（`getRuntimeReadiness()` / `prewarmAllClientRunners()` in `src/runner/clientRunner.ts`）。
- **演習室 PC の事前ウォーム**：授業前に各 PC で生徒ダッシュボードを一度開いておく（または上記ボタンを押す）とブラウザキャッシュに載り、本番の一斉アクセスを避けられます。
- **Pyodide の配信元**：`src/runner/py.worker.ts` の `PYODIDE_BASE_URL`（既定 jsDelivr CDN、v0.28.0）。学内から jsDelivr に到達できない／CDN 依存を避けたい場合は、Pyodide の配布物を自ホストして同定数をそのパスに差し替え、`npm run build:full` し直してください。自ホスト配信層も上記 COOP/COEP と両立する CORP/CORS ヘッダーが必要です（同一オリジンに置くのが最も簡単）。
- **clang の配信元**：`src/runner/cRunner.ts` が Wasmer レジストリ（`Wasmer.fromRegistry('clang/clang')`）から取得します。Pyodide のような単純な URL 差し替えはできません。学内で clang を使う場合は、上記の「演習室 PC の事前ウォーム」で各ブラウザにキャッシュさせておく運用を推奨します。

## 生徒アカウントの一括作成と初期パスワード

講師は「クラス管理」から `学籍番号,氏名` の名簿で生徒アカウントを一括作成できます（`POST /api/students/bulk`）。

- 各アカウントにランダムな約12文字の**初期パスワード**が発行され、`users.initialPassword` に**平文で保存**されます。講師はクラスの受講者一覧と「初期パスワード一覧を印刷」で配布用スリップを（紛失時も）再印刷できます。
- 生徒が初回ログインで `/change-password` からパスワードを変更すると、`initialPassword` は `NULL` になり以後表示されません（`mustChangePassword` も解除）。
- **平文保存はユーザー承認済みの割り切り**（2026-09-11）です。自ホスト＝institution 管理下の DB で、プロビジョニングから初回変更までの短い期間だけ存在し、講師専用ルートからしか返しません。許容できない場合は `POST /bulk` のレスポンスでのみ初期パスワードを返す方式（列を持たない）＋「パスワードリセット」操作に切り替えてください。
- 配布スリップは印刷後に適切に管理・破棄してください。

## データベース

- バックアップは通常のPostgreSQL運用（`pg_dump` / スナップショット等）。個人情報（学籍番号・氏名・成績・初期パスワード）が入るため、institutionの要件に従って保護してください。
- `docker-compose.yml` の `db` はnamed volume（`pgdata`）に保存する開発用です。本番はmanaged PostgreSQLを推奨。
- ポート注意: 開発機では `docker-compose.yml` がホスト **5433** にマップしています（5432で稼働する別のPostgreSQLとの衝突回避）。本番の `DATABASE_URL` は実際の接続先に合わせてください。

## アップグレード

```bash
git pull
npm ci && npm --prefix server ci
npm --prefix server run prisma:deploy
npm run build:full
# server を再起動（pm2 restart / systemctl restart ...）
docker compose build judge && docker compose up -d judge   # judge/ に変更があったとき
```

`prisma:deploy` は未適用のマイグレーションを順に流すだけで、スキーマドリフトのプロンプトは出ません。適用状況は `npm --prefix server run prisma:migrate -- status`（または `npx prisma migrate status`）で確認できます。

## トラブルシューティング

| 症状 | 原因 / 対処 |
|---|---|
| CやPythonの「実行」が無反応・エラー | COOP/COEPヘッダー未設定。DevToolsコンソールに `SharedArrayBuffer` / cross-origin isolation関連のエラーが出ていないか、`self.crossOriginIsolated` が `true` かを確認。リバースプロキシがヘッダーを消していないか確認 |
| Javaの問題が生徒側で「準備中」のまま | `server/.env` の `JUDGE_URL` が空、またはjudgeコンテナ未起動。`curl $JUDGE_URL/health` で確認 |
| Javaの実行が502になる | judge側のエラー。`docker compose logs judge` を確認。コンテナの `mem_limit` / `pids_limit` に達していないか |
| 429（前の実行がまだ処理中） が頻発 | 同時受験者数に対して `JUDGE_CONCURRENCY` が小さい。値を上げる。judgeコンテナのリソースも合わせて増やす |
| DBに繋がらない / `P1010` | 接続先ポート違い（開発機は5433）。native PostgreSQLとの衝突。`DATABASE_URL` を確認 |
| `npm install` 後に `build` / `lint` が失敗 | Nodeが22.11以下。22.12+ にアップグレード |
| マイグレーションのドリフト警告 | `npx prisma migrate status`（`server/` 内）で状態確認 → `prisma:deploy` |
| Pythonの初回ロードが極端に遅い / 失敗 | `PYODIDE_BASE_URL`（jsDelivr）への到達性。学内制限があれば自ホストへ切り替え |
| 提出したのに成績に出ない | その試験が「公開中」か。成績は最新提出のみ表示。生徒が別アカウントで受けていないか |
