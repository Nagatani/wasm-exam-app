# wasm-exam-app

ブラウザ完結型のプログラミング演習・オンライン採点システム（学内LMS）。

学生がMonacoエディタで書いたコードを、**問題ごとに指定された言語**でコンパイル・実行し、テストケースと突き合わせて自動採点します。個人情報（学籍番号・氏名・成績）を外部SaaSに預けない方針のため、認証とデータベースは自前のExpress + PostgreSQLサーバーで運用します。

## 対応言語

| 言語 | 実行場所 | ランタイム | 備考 |
|---|---|---|---|
| **C** | ブラウザ | WASI / `@wasmer/sdk`（clang） | 初回のみ ~106MBのツールチェインを取得（ブラウザキャッシュされます） |
| **JavaScript** | ブラウザ | Web Worker | `readline()` / `print()` などの入出力ヘルパーを注入 |
| **TypeScript** | ブラウザ | Web Worker（`sucrase` で型除去） | 型エラーは採点に影響せず、構文エラーのみコンパイルエラー扱い |
| **Python** | ブラウザ | Pyodide（CPython → WASM、Web Worker） | 初回のみ ~10MBをCDNから取得 |
| **Java** | サーバー | サンドボックスDockerコンテナ（`judge` サービス、JDK 24 + `--enable-preview`） | ブラウザで実行できないため唯一サーバーにソースを送ります。詳細は [`docs/operations.md`](./docs/operations.md) |

言語ごとの入出力の作法・制限は **[`docs/languages.md`](./docs/languages.md)** にまとめています（問題作成時・受験時とも必読）。

## 実装状況

- フェーズ1〜5（認証・講師用試験管理・実行サンドボックス・受験フロー・成績ダッシュボード / CSV出力）完了
- 多言語対応（1問1言語・生徒に言語選択なし / Javaサーバーサイドjudge / JS・TS・Pythonクライアントサイド）完了
- 提出モデルの刷新（2026-09-10）完了 — 設問ごとは「下書き保存」、試験全体で1回「最終提出」して採点。受験可能回数を講師が設定（既定1回 / 無制限可）、成績は最後に提出した回。時間切れは自動提出
- フェーズ6の一部完了 — Cの10秒実行時間制限、`TLE`/`MLE` の独立判定、解答例でテストケースを検証、サンプルの差分表示、コンパイルエラーのエディタ表示、成績画面から提出コード閲覧、問題ごとの出力比較モード（完全一致 / 行末空白無視 / 空行無視 / 数値許容誤差 / **大文字小文字無視**）、非公開テストのWA時に答えを漏らさない範囲のヒント表示、試験の公開開始・受付終了日時、問題の複製・**試験そのものの複製**・テストケース一括追加（貼り付け・ファイル読み込み）、**試験横断の問題バンク**（タグ・公開/非公開検索・JSONエクスポート/インポート）、クラス（受講者名簿）管理と試験のクラス紐付け、生徒アカウントの一括作成（初期パスワード発行・印刷）、**最初のアカウントの自動教員昇格**、**試験の既定解答言語**、実行環境の準備状況カード、公開前チェック、サービス状態表示・教員昇格フォーム（現在は☰→管理者メニュー）、個別の時間延長（配慮対応）、judge への C 実行経路の追加と Java/C の既存提出の再採点（生徒の通常の受験フローに変更なし）、**judge のネットワーク遮断**（`server` をコンテナ化して `judge` と同じ内部ネットワークに置く運用構成 `docker-compose.prod.yml` を追加。詳細は [`docs/operations.md`](./docs/operations.md)・[`docs/roadmap.md`](./docs/roadmap.md) §3）、**DBバックアップ・リストアスクリプト**
- UI改善（2026-09-11〜12）完了 — 問題編集画面の保存ボタン統一（セクションごとのラベル・未保存インジケータ・横断バナー）、ネットワーク／実行環境未取得時の分かりやすいエラーメッセージ、テストケースごとの時間・メモリ制限入力欄（Java・C再採点のみ）、問題一覧・テストケース一覧のドラッグ＆ドロップ並び替え、**問題ごとの部分点設定**（`Task.allowPartialCredit`、通過テスト数比例で採点）、**問題文への画像アップロード**（`POST /api/uploads`、PNG/JPEG/GIF/WebP・5MB上限、`/uploads/*` で公開配信）、**ハンバーガーメニュー（ドロワー）**（右上の☰から開閉。ページ移動〈ダッシュボード・クラス管理・管理者メニュー〉、設定〈テーマ・AI機能・パスワード変更〉、ログアウトを集約。2026-09-26 に管理者メニュー〈サービス状態・パスワード再発行・教員昇格〉と設定を独立した画面に整理）
- **AI作問サポート（2026-09-16）完了** — 教師専用・ブラウザ内蔵LLM（`@mlc-ai/web-llm`、モデルダウンロードはブラウザごとにオプトイン）による問題文・初期テンプレート・テストケース・解答例の下書き生成。期待される出力はLLMに書かせず、生成された解答例コードを実際に実行して求めます。詳細は [`docs/teacher-guide.md`](./docs/teacher-guide.md)。
- **演習モード + AIヒント（2026-09-18〜19）完了** — 試験（時間制限あり）とは別に、時間制限なし・何度でも実行/提出できる学習支援用の「演習」モードを追加（既存の問題作成UIをそのまま使えます）。演習モードの問題では、教師が許可すれば生徒はAIによる**段階的ヒント**（着眼点→疑わしい箇所→修正方針、生徒のブラウザでのオプトインが別途必要）を利用できます。**ヒント3は簡単な問題では答えに近い内容になることがあると実機検証済み**のため、教師は問題ごとにヒントを何段階まで公開するか制限できます。詳細は [`docs/teacher-guide.md`](./docs/teacher-guide.md)。
- **ログイン・アカウント保護と品質基盤（2026-09-25）完了** — ログインのレート制限、自己サインアップを閉じる設定（`ALLOW_SIGNUP=false`）、講師によるパスワード再発行（[`docs/operations.md`](./docs/operations.md)「ログイン・アカウントの保護」）。自動テスト（サーバー単体・DB結合・judge経由・フロントエンド単体）と GitHub Actions による CI
- **残タスク・要対応事項**（JS/TS/Pythonの再採点、ブラウザE2Eテストほか）は [`docs/roadmap.md`](./docs/roadmap.md) の9節に一覧化（優先度「中」以上は 9-0 に要約）
- **既存環境を更新したとき**は、未適用のマイグレーションを `npm --prefix server run prisma:deploy`（開発環境では `prisma:migrate`）で適用してください。適用状況は `server/` 内で `npx prisma migrate status` で確認できます

設計判断の背景は [`CLAUDE.md`](./CLAUDE.md)を参照してください。

## 構成

```
.
├── src/                       # フロントエンド (React + Vite + TypeScript + Tailwind CSS v4)
│   └── runner/                # 各言語のクライアントサイド実行ランナー
├── server/                    # バックエンド (Express + TypeScript + Prisma + PostgreSQL)
│   ├── Dockerfile             # server をコンテナ化する場合のビルド定義（運用時・コンテナ構成用）
│   └── .env.prod.docker.example  # ↑ 用の環境変数サンプル
├── judge/                     # Java・C 用サンドボックス実行サービス (Docker, 単一ファイルの Judge.java)
├── docker-compose.yml         # 開発用：ローカル PostgreSQL + judge サービス
├── docker-compose.prod.yml    # 運用時・コンテナ構成用：judge（内部ネットワークのみ）+ server
├── docs/                      # 利用ドキュメント
└── legacy/                    # 初期モックプロトタイプ（参考用、未使用）
```

## 必要環境

- Node.js **22.12+** 推奨（22.11以下だと `npm install` 時にネイティブバイナリの依存が一部スキップされ、`build` / `lint` が失敗することがあります）
- Docker（ローカルPostgreSQLとJava judgeの起動用）
- npm

## セットアップ

```bash
# 1. 依存関係インストール
npm install
npm --prefix server install

# 2. 環境変数ファイルを用意
cp .env.example .env
cp server/.env.example server/.env

# 3. ローカル PostgreSQL と Java judge を起動
docker compose up -d db judge

# 4. DB マイグレーションを適用
npm --prefix server run prisma:migrate
```

> **ポート注意**: `docker-compose.yml` はホスト側 **5433番** をPostgreSQLコンテナに、**127.0.0.1:4001** をjudgeコンテナにマッピングしています（本機で稼働中のHomebrew版PostgreSQLが5432番を使うため）。`server/.env` の `DATABASE_URL` は5433、`JUDGE_URL` は4001を指すようになっています。
>
> Java問題を使わない場合は `judge` の起動は不要で、`server/.env` の `JUDGE_URL` を空にしておけばJavaは「準備中」表示になります。

## 起動方法

### 開発時（コードを編集しながら動かす）

ターミナルを2つ開きます（フロントエンドはHMRが効きます）。

```bash
# ターミナル1: バックエンド (http://localhost:4000)
npm --prefix server run dev

# ターミナル2: フロントエンド (http://localhost:5173)
npm run dev
```

ブラウザで `http://localhost:5173` を開き、学籍番号とパスワードで新規登録／ログインします。

### 運用時（1コマンド・1プロセス）

コードを編集しない通常運用（講義中など）では、サーバー1つでフロントエンド配信もAPIも両方まかなえます。`judge` コンテナは別途起動しておきます。

```bash
cp .env.production.example .env.production   # 初回のみ
npm run build:full                            # フロントエンド本番ビルド + サーバービルド
docker compose up -d db judge
npm start                                     # http://localhost:4000 で配信 + API
```

### 運用時（コンテナでまとめて実行・judgeのネットワーク遮断つき）

`server` 自体もコンテナ化し、`judge` と同じ Docker 内部ネットワークに閉じ込める構成です。上の「1コマンド・1プロセス」と違い、`judge` コンテナに外向き通信をさせない構成にできます（ホスト公開ポートを持たないため）。DBは本番同様、外部の PostgreSQL を使います。

```bash
cp server/.env.prod.docker.example server/.env.prod.docker   # 初回のみ、DATABASE_URL等を編集
npm run docker:prod                                            # judge・server をビルドして起動
```

どちらを使うかを含む詳細（本番でのリバースプロキシ設定・必須HTTPヘッダー・judgeの運用）は **[`docs/operations.md`](./docs/operations.md)** を参照してください。

## 最初の講師アカウントの作成

新規デプロイ後、**最初にサインアップしたアカウントは自動的に `role: TEACHER` になります**（2人目以降は通常どおり `role: STUDENT`）。管理者がまず自分のアカウントを作る想定です。以降の教員追加は、画面右上の☰メニュー →「管理者メニュー」の「教員への昇格」で行えます。

最初のアカウントを取り違えた・削除してしまった等でこの自動昇格を逃した場合は、DBに直接SQLを実行して昇格させてください。

```bash
docker exec wasm-exam-app-db-1 psql -U wasm_exam -d wasm_exam \
  -c "update users set role='TEACHER' where \"studentNumber\"='<学籍番号>';"
```

コンテナ名は `docker compose ps` で確認できます。講師の操作手順は **[`docs/teacher-guide.md`](./docs/teacher-guide.md)** にあります。

## よく使うコマンド

### フロントエンド（リポジトリルート）

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー起動 |
| `npm run build` | 型チェック + 本番ビルド |
| `npm run build:full` | フロントエンド本番ビルド + サーバービルド |
| `npm start` | ビルド済みサーバーを起動（フロントエンド配信 + APIを1プロセスで） |
| `npm run docker:prod` | `judge`・`server` をコンテナでビルド・起動（`docker-compose.prod.yml`、judgeのネットワーク遮断つき） |
| `npm run lint` | oxlintによる静的解析 |
| `npm test` | 単体テスト（フロントエンドの補助関数＋サーバーの採点ロジック。DB不要） |
| `npm run test:frontend` | フロントエンドの単体テストのみ |
| `npm run test:integration` | 結合テスト（APIを実際のDBに対して実行。開発用 `db` コンテナが必要。専用の `wasm_exam_test` DBを自動作成し、開発用DBには触れません） |
| `npm run test:judge` | judge 経由の結合テスト（Java・Cを実際にコンパイル・実行。`db` と `judge` コンテナが必要。専用の `wasm_exam_judge_test` DBを使用） |
| `npm run preview` | 本番ビルドをローカルでプレビュー |

### バックエンド（`server/`）

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー起動（`tsx watch`） |
| `npm run build` / `npm run start` | ビルド / ビルド済みコード実行 |
| `npm run prisma:migrate` | スキーマ変更後のマイグレーション作成・適用 |
| `npm run prisma:deploy` | 本番環境等でのマイグレーション適用（ドリフト確認なし） |
| `npm run prisma:generate` | Prisma Clientの再生成 |
| `npm test` / `npm run test:integration` / `npm run test:judge` / `npm run test:all` | 単体 / 結合 / judge 経由の結合 / すべて |
| `npm run typecheck:test` | テストコードの型チェック |

### Docker

| コマンド | 内容 |
|---|---|
| `docker compose up -d db judge` | 開発用：PostgreSQLとjudgeを起動 |
| `docker compose ps` | コンテナの稼働状況 |
| `docker compose logs -f judge` | judgeのログ |
| `docker compose build judge` | `judge/` を変更したときの再ビルド |
| `docker compose -f docker-compose.prod.yml up -d --build`（= `npm run docker:prod`） | 運用時・コンテナ構成：judge・server をビルドして起動 |
| `docker compose -f docker-compose.prod.yml ps` / `logs -f server` | ↑ の稼働状況・ログ |

`docker-compose.yml`（開発用）と `docker-compose.prod.yml`（運用時・コンテナ構成）は同時に使わないでください。詳細は [`docs/operations.md`](./docs/operations.md)。

## ドキュメント一覧

| ファイル | 内容 |
|---|---|
| [`docs/languages.md`](./docs/languages.md) | 対応言語ごとの実行モデル・標準入出力の作法・制限・注意点 |
| [`docs/teacher-guide.md`](./docs/teacher-guide.md) | 講師向け：試験・問題・テストケース・解答例の作成、成績確認、CSV出力 |
| [`docs/operations.md`](./docs/operations.md) | 本番デプロイ、必須HTTPヘッダー、judgeサービスの運用、トラブルシューティング |
| [`docs/roadmap.md`](./docs/roadmap.md) | フェーズ6以降のバックログと経緯。**残タスク一覧は9節** |
| [`CLAUDE.md`](./CLAUDE.md) | アーキテクチャと設計判断の背景（開発者向け） |
