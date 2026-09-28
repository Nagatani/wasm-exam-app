# wasm-exam-app

プログラミング演習講義のための、ブラウザで受験・採点するオンライン試験／演習システムです。

- 問題ごとに講師が解答言語（C / Java / JavaScript / TypeScript / Python）を1つ決め、生徒は Monaco エディタで解答します。
- 「実行」（お試し）は Java 以外は生徒のブラウザ内で動き、本採点（最終提出・時間切れ自動提出・再採点）はサンドボックス化した `judge` コンテナがブラウザと同じ実行環境で行います。
- 学籍番号・氏名・成績を外部サービスに預けないよう、認証とデータは自前の Express + PostgreSQL サーバーに置きます。

## 1. 初回セットアップ（開発環境）

### 必要なもの

- Node.js **22.12 以降**
- Docker（PostgreSQL と judge を動かします）

### 手順

```bash
# 依存関係のインストール
npm install
npm --prefix server install

# 環境変数ファイルの用意（開発用の既定値のままで動きます）
cp .env.example .env
cp server/.env.example server/.env

# PostgreSQL と judge を起動
docker compose up -d db judge

# DB マイグレーションを適用
npm --prefix server run prisma:migrate
```

> PostgreSQL はホストの **5433番**、judge は **127.0.0.1:4001** に公開されます（`server/.env` の既定値もこれに合わせてあります）。

### 起動

ターミナルを2つ使います。

```bash
npm --prefix server run dev   # バックエンド  http://localhost:4000
npm run dev                   # フロントエンド http://localhost:5173
```

`http://localhost:5173` を開いて使います。

### 最初の講師アカウントの作成

**最初にサインアップしたアカウントが自動で講師になります**（2人目以降は生徒）。以降の講師は、画面右上の ☰ →「管理者メニュー」→「教員への昇格」で追加します。

最初のアカウントを取り違えた場合などは、DB を直接更新して昇格できます（コンテナ名は `docker compose ps` で確認）。

```bash
docker exec wasm-exam-app-db-1 psql -U wasm_exam -d wasm_exam \
  -c "update users set role='TEACHER' where \"studentNumber\"='<学籍番号>';"
```

テスト・ビルドなど開発用のコマンドは [`docs/development.md`](./docs/development.md) にまとめています。

## 2. 運用セットアップ（本番）

本番ではフロントエンドの本番ビルドを `server` が配信し、API と画面を1つのポート（4000番）で提供します。その前に TLS を終端するリバースプロキシを置いてください。構成は2通りです。

| 構成 | 概要 | 向いている場合 |
|---|---|---|
| **A. ホストで実行** | `server` をホストの Node で動かし、judge だけコンテナで動かす | 手順を少なくしたい |
| **B. コンテナで実行** | `server` と judge をまとめてコンテナで動かし、judge の外向き通信を遮断する | 生徒のコードを実行する judge をネットワークから切り離したい |

**A. ホストで実行**

```bash
cp .env.production.example .env.production   # VITE_API_BASE_URL は空のまま
# server/.env に本番の DATABASE_URL・CORS_ORIGIN などを設定
npm ci && npm --prefix server ci
npm run build:full
npm --prefix server run prisma:deploy
docker compose up -d --build judge
npm start                                     # pm2 / systemd などで常駐させる
```

**B. コンテナで実行**（DB は外部の PostgreSQL を使います）

```bash
cp server/.env.prod.docker.example server/.env.prod.docker   # DATABASE_URL などを編集
DATABASE_URL=... npm --prefix server run prisma:deploy
npm run docker:prod
```

環境変数、必須の HTTP ヘッダー、judge の処理能力、バックアップ、アップグレードなどの詳細は [`docs/operations.md`](./docs/operations.md) を参照してください。

## 3. ドキュメント

| ドキュメント | 内容 |
|---|---|
| [`docs/teacher-guide.md`](./docs/teacher-guide.md) | 講師向け：クラス・試験・問題・テストケースの作成、成績の確認、演習モード、AI機能 |
| [`docs/languages.md`](./docs/languages.md) | 言語ごとの実行環境・入出力の書き方・制限、採点のルール |
| [`docs/operations.md`](./docs/operations.md) | 本番の構築・設定・運用（judge、セキュリティ、アカウント保護、バックアップ、トラブル対応） |
| [`docs/development.md`](./docs/development.md) | 開発者向け：ディレクトリ構成、コマンド、自動テスト、CI |
| [`docs/roadmap.md`](./docs/roadmap.md) | 未対応の課題と、意図的に対象外としたもの |
| [`CLAUDE.md`](./CLAUDE.md) | アーキテクチャと設計判断（開発者・AIエージェント向け、英語） |
