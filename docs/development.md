# 開発ガイド

開発環境の作り方は [README の「初回セットアップ」](../README.md#1-初回セットアップ開発環境) を参照してください。ここではディレクトリ構成・コマンド・自動テストをまとめます。設計判断の背景は [`CLAUDE.md`](../CLAUDE.md) にあります。

## ディレクトリ構成

```
.
├── src/                    # フロントエンド（React + Vite + TypeScript + Tailwind CSS v4）
│   ├── runner/             # ブラウザ内の言語別ランナー（C / JS / TS / Python）
│   └── ai/                 # ブラウザ内LLM（AI作問サポート・AIヒント）
├── server/                 # バックエンド（Express + TypeScript + Prisma + PostgreSQL）
│   ├── prisma/             # スキーマとマイグレーション
│   ├── scripts/            # バックアップ・リストア、負荷試験、E2E 用DB準備
│   ├── test/               # 単体・結合・judge 経由のテスト
│   └── Dockerfile          # 運用構成B（コンテナ実行）用のイメージ
├── judge/                  # 採点・Java 実行用サンドボックス（Docker）
│   └── runner/shared/      # ブラウザと judge が共有する実行コード
├── e2e/                    # Playwright によるブラウザ E2E テスト
├── docker-compose.yml      # 開発・運用構成A：PostgreSQL + judge
├── docker-compose.prod.yml # 運用構成B：server + judge（judge は内部ネットワークのみ）
├── docs/                   # ドキュメント
└── legacy/                 # 初期のモックプロトタイプ（参考用・未使用）
```

フロントエンド（リポジトリ直下）と `server/` は別々の npm プロジェクトで、`node_modules` も別です。

## コマンド

### フロントエンド（リポジトリ直下）

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー（http://localhost:5173、HMR あり） |
| `npm run build` | 型チェック + 本番ビルド |
| `npm run build:full` | フロントエンドとサーバーの両方をビルド |
| `npm start` | ビルド済みサーバーを起動（画面と API を1プロセスで配信） |
| `npm run docker:prod` | 運用構成B（`docker-compose.prod.yml`）をビルドして起動 |
| `npm run lint` | oxlint による静的解析 |
| `npm run preview` | 本番ビルドのプレビュー |

### バックエンド（`server/`）

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー（http://localhost:4000、`tsx watch`） |
| `npm run build` / `npm run start` | ビルド / ビルド済みコードの実行 |
| `npm run prisma:migrate` | スキーマ変更後のマイグレーション作成・適用（開発用） |
| `npm run prisma:deploy` | 未適用のマイグレーションを適用（本番・更新時） |
| `npm run prisma:generate` | Prisma Client の再生成 |
| `npm run backup` / `npm run restore` | DB のバックアップ / リストア（[operations.md](./operations.md#バックアップリストア)） |

### Docker

| コマンド | 内容 |
|---|---|
| `docker compose up -d db judge` | PostgreSQL と judge を起動 |
| `docker compose up -d --build judge` | `judge/` を変更したときの再ビルド |
| `docker compose ps` / `docker compose logs -f judge` | 稼働状況 / judge のログ |

- `judge/runner/shared/` はブラウザ側のランナーも読み込む共有コードです。挙動を変えるときはここを変更し（片側だけに複製しない）、judge イメージを再ビルドしてください。
- `docker-compose.yml` と `docker-compose.prod.yml` を同じディレクトリで同時に起動しないでください（同じプロジェクト名になり、judge が上書きされます）。
- リポジトリを更新してマイグレーションが増えたときは `npm --prefix server run prisma:migrate` を実行してください。

## 自動テスト

| コマンド | 内容 | 必要なもの |
|---|---|---|
| `npm test` | 単体テスト（フロントエンドの補助関数 + サーバーの採点ロジックなど） | なし |
| `npm run test:frontend` | フロントエンドの単体テストのみ | なし |
| `npm run test:integration` | 結合テスト（API を実際の DB に対して実行） | `db` コンテナ |
| `npm run test:judge` | judge 経由のテスト（全言語の本採点・再採点、Java の実行など） | `db` と `judge` コンテナ |
| `npm run test:e2e` | ブラウザ E2E テスト（Playwright + Chromium） | `db` コンテナ（初回は `npx playwright install chromium`） |
| `npm --prefix server run test:all` | サーバーの単体・結合・judge 経由をすべて | `db` と `judge` コンテナ |
| `npm --prefix server run typecheck:test` | テストコードの型チェック | なし |

- テストはそれぞれ専用の DB（`wasm_exam_test` / `wasm_exam_judge_test` / `wasm_exam_e2e_test`）を自動作成して使います。名前が `_test` で終わらない DB には接続しないため、開発用 DB が消えることはありません。
- E2E テストは本番と同じ構成（本番ビルドを `server` が配信）でポート 4173 に起動し、CSP を適用した状態で実行します。環境変数で範囲を広げられます。
  - `E2E_WITH_C=1` … C の実行も確認（clang 約106MB を取得）
  - `E2E_JUDGE_URL=http://localhost:4001` … judge による本採点と、ブラウザの「実行」との判定一致も確認
- `server/scripts/loadtest-grading.ts` は、多数の生徒の同時最終提出を再現して採点完了までの時間を測る負荷試験です（使い方はファイル冒頭）。

## CI

`.github/workflows/ci.yml` が、プルリクエストと `main` への push ごとに次のジョブを実行します（Node 22）。

| ジョブ | 内容 |
|---|---|
| `frontend` | lint、フロントエンド単体テスト、ビルド |
| `server` | ビルド、テストの型チェック、単体テスト、結合テスト（PostgreSQL 16） |
| `judge` | `docker-compose.yml` の judge をビルド・起動し、judge 経由のテスト |
| `e2e` | judge を起動し、`E2E_WITH_C=1` と `E2E_JUDGE_URL` 付きで E2E テスト（失敗時はレポートを保存） |
