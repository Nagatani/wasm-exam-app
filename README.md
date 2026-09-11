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
- フェーズ6の一部完了 — Cの10秒実行時間制限、`TLE`/`MLE` の独立判定、解答例でテストケースを検証、サンプルの差分表示、コンパイルエラーのエディタ表示、成績画面から提出コード閲覧、問題ごとの出力比較モード（完全一致 / 行末空白無視 / 空行無視 / 数値許容誤差）、試験の公開開始・受付終了日時、問題の複製・テストケース一括追加、クラス（受講者名簿）管理と試験のクラス紐付け、生徒アカウントの一括作成（初期パスワード発行・印刷）、実行環境の準備状況カード、公開前チェック、サービス状態表示・教員昇格フォーム、個別の時間延長（配慮対応）、judge への C 実行経路の追加と Java/C の既存提出の再採点（生徒の通常の受験フローに変更なし）、**judge のネットワーク遮断**（`server` をコンテナ化して `judge` と同じ内部ネットワークに置く運用構成 `docker-compose.prod.yml` を追加。詳細は [`docs/operations.md`](./docs/operations.md)・[`docs/roadmap.md`](./docs/roadmap.md) §3）
- 残り（分かりやすいエラーフィードバック、judgeのJS/TS/Python対応、問題バンクほか）は [`docs/roadmap.md`](./docs/roadmap.md)
- **マイグレーションの適用が必要**: `20260910120000_add_attempt_lifecycle` / `20260910130000_comparison_mode_and_schedule` / `20260911090000_courses_enrollments` / `20260911100000_student_provisioning` / `20260911110000_exam_time_extension`（`npm --prefix server run prisma:migrate`）。**今回の judge C対応にスキーマ変更はありません**が、`judge/Dockerfile` を変更したので `docker compose build judge` の再ビルドが必要です

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

サインアップ画面から作成したアカウントは常に `role: STUDENT` です。最初の講師アカウントだけDBに直接SQLを実行して昇格させます（以降はアプリ内の講師昇格APIで対応可能）。

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
| `npm run preview` | 本番ビルドをローカルでプレビュー |

### バックエンド（`server/`）

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー起動（`tsx watch`） |
| `npm run build` / `npm run start` | ビルド / ビルド済みコード実行 |
| `npm run prisma:migrate` | スキーマ変更後のマイグレーション作成・適用 |
| `npm run prisma:deploy` | 本番環境等でのマイグレーション適用（ドリフト確認なし） |
| `npm run prisma:generate` | Prisma Clientの再生成 |

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
| [`docs/roadmap.md`](./docs/roadmap.md) | フェーズ6以降のバックログ、教師・生徒双方の体験改善の展望と優先度 |
| [`CLAUDE.md`](./CLAUDE.md) | アーキテクチャと設計判断の背景（開発者向け） |
