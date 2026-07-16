# wasm-exam-app

ブラウザ完結型のC/Javaプログラミング演習・オンライン採点システム（学内LMS）。
学生が書いたコードはすべてブラウザ内（C: WASI/Wasmer、Java: CheerpJ）でコンパイル・実行され、サーバーには送信されません。
個人情報（学籍番号・成績等）を外部SaaSに預けない方針のため、認証・データベースは自前のExpress + PostgreSQLサーバーで運用します。

現在の実装状況: **フェーズ1（認証・ロール管理）まで完了**。試験・問題登録、コード実行ジャッジ、採点ダッシュボード等は未実装です。

## 構成

```
.
├── src/            # フロントエンド (React + Vite + TypeScript + Tailwind CSS v4)
├── server/         # バックエンド (Express + TypeScript + Prisma + PostgreSQL)
├── docker-compose.yml   # ローカル用PostgreSQL
└── legacy/         # 初期モックプロトタイプ（参考用、未使用）
```

## 必要環境

- Node.js **22.12+** 推奨（22.11以下だと `npm install` 時にネイティブバイナリの依存が一部スキップされ、`build`/`lint` が失敗することがあります）
- Docker（ローカルPostgreSQL起動用）
- npm

## セットアップ

```bash
# 1. 依存関係インストール（フロントエンド）
npm install

# 2. 依存関係インストール（サーバー）
cd server && npm install && cd ..

# 3. 環境変数ファイルを用意
cp .env.example .env
cp server/.env.example server/.env

# 4. ローカルPostgreSQLを起動
docker compose up -d db

# 5. DBマイグレーションを適用
cd server && npm run prisma:migrate && cd ..
```

> **ポート注意**: `docker-compose.yml` はホスト側 **5433番ポート** をPostgreSQLコンテナにマッピングしています（本機で稼働中のHomebrew版PostgreSQLが5432番を使用しているため）。`server/.env` の `DATABASE_URL` も5433番を指すようになっています。

## 起動方法

ターミナルを2つ開いて、それぞれで起動します。

```bash
# ターミナル1: バックエンド (http://localhost:4000)
cd server && npm run dev

# ターミナル2: フロントエンド (http://localhost:5173)
npm run dev
```

ブラウザで `http://localhost:5173` を開き、学籍番号とパスワードで新規登録／ログインできます。

## 最初の講師アカウントの作成

サインアップ画面から作成したアカウントは常に `role: STUDENT` になります。最初の講師アカウントは、DBに直接SQLを実行して昇格させてください（以降はアプリ内の講師昇格APIで対応可能）。

```bash
docker exec <postgresコンテナ名> psql -U wasm_exam -d wasm_exam \
  -c "update users set role='TEACHER' where \"studentNumber\"='<学籍番号>';"
```

コンテナ名は `docker ps` で確認できます（例: `wasm-exam-app-db-1`）。

## よく使うコマンド

### フロントエンド（リポジトリルート）

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー起動 |
| `npm run build` | 型チェック + 本番ビルド |
| `npm run lint` | oxlintによる静的解析 |
| `npm run preview` | 本番ビルドをローカルでプレビュー |

### バックエンド（`server/`）

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー起動（`tsx watch`） |
| `npm run build` / `npm run start` | ビルド / ビルド済みコード実行 |
| `npm run prisma:migrate` | スキーマ変更後のマイグレーション作成・適用 |
| `npm run prisma:deploy` | 本番環境等でのマイグレーション適用 |
| `npm run prisma:generate` | Prisma Clientの再生成 |

## 詳細ドキュメント

アーキテクチャや設計判断の背景（なぜ自前サーバーなのか、セッション管理の方式など）は [`CLAUDE.md`](./CLAUDE.md) を参照してください。
