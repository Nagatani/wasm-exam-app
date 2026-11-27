# 依存パッケージ削減の検討一覧

リポジトリ全体（フロントエンド・バックエンド・ジャッジ）の依存パッケージを棚卸しし、リファクタリングによって削除・置換できる候補と、現状維持すべきパッケージを整理した一覧です。

**このドキュメントは判断材料の整理のみを目的としており、現時点でコードや `package.json` の変更は行っていません。**

## 使い方

1. まず「判断用サマリー一覧表」で全体像と推奨度を確認する。
2. 気になる項目の詳細セクションを読み、メリットとデメリット・制約を踏まえて **採用 / 見送り / 保留** を判断する。
3. サマリー表の「判断」欄、または各詳細セクション末尾の「判断メモ」欄に結果を記入する。

推奨度の目安 — **高**：削減効果が大きく実装・検証リスクが低い／**中**：効果はあるが設計判断や広めの検証が必要／**低**：移行コストやリスクに対して効果が小さい（または前提条件あり）。

### 現在の依存規模

| 対象 | 管理ファイル | 本番依存（直接 / 推移含む） | 開発依存（直接） | 総到達パッケージ数（lockfile） |
|---|---|---|---|---|
| `frontend` | `package.json` | 8 件 | 11 件 | 224 パッケージ |
| `server` | `server/package.json` | 8 件 / 84 パッケージ | 10 件 | 225 パッケージ |
| `judge` | `judge/runner/package.json`・`judge/Dockerfile` | 2 件 / 19 パッケージ + 外部 JAR 1 件 | 0 件 | 19 パッケージ + JAR 1 件 |

---

## 判断用サマリー一覧表

推奨度順（高 → 中 → 低）に並べています。「判断」欄には `採用` / `見送り` / `保留` などを記入してください。

| 判断 | ID | 対象 | パッケージ | 削減規模（直接 / 推移・バンドル等） | 推奨度 | 概要 |
|---|---|---|---|---|---|---|
| `採用` | F1 | `frontend` | `react-markdown` | 本番 直接 1・推移 **80** パッケージ（全体の約 35%）、バンドル約 113KB（非圧縮）縮小 | **高** | プラグイン・生 HTML 未使用の素の呼び出し 4 箇所のみ。軽量 React コンポーネント自作で大幅削減 |
| `採用` | S1 | `server` | `dotenv` | 本番 直接 1 パッケージ | **高** | `server/src/index.ts` L1 のみ。Node 22.12+ 標準の `process.loadEnvFile()` 等で置換 |
| `採用` | S2 | `server` | `cookie-parser` + `@types/cookie-parser` | 本番 推移 3 + 開発 1 パッケージ | **高** | 署名なしセッション Cookie 1 種の読み取りのみ。約 15 行のヘルパーで置換 |
| `採用` | S3 | `server` | `cors` + `@types/cors` | 本番 推移 3 + 開発 3 パッケージ | **高** | 単一固定オリジン + `credentials: true` のみ（主に開発用）。約 20 行のミドルウェアで置換 |
| `採用` | S4 | `server` | `multer` + `@types/multer` | 本番 推移 **16** + 開発 12 パッケージ | **中** | 画像アップロード 1 ルートのみ。`express.raw`（推奨）または Web Fetch `formData()` で置換 |
| `採用` | F2 | `frontend` | `@monaco-editor/react` | 本番 直接 1・推移 3 パッケージ、`CodeEditor` チャンク（約 17KB）軽量化 | **中** | CDN 動的ロードの薄いラッパー。AMD loader + `monaco.editor.create()` 直接制御へ置換 |
| `採用` | F3 | `frontend` | `react-router-dom` | 案 B: 本番 直接 1・推移 4 パッケージ、エントリーチャンク（249KB）軽量化（案 A: 直接 1 減） | **中** | フラットな 18 ルートのみ。案 A（`react-router` 直接利用）または案 B（History API 自作） |
| `採用` | F4 | `frontend` | `vitest` | 開発 直接 1・推移 17 パッケージ | **中** | DOM・モック未使用の純粋関数テスト 10 ファイルのみ。Node 標準 `node:test` に移行（※リポジトリ横断の補足あり） |
| `採用` | S5 | `server` | `bcryptjs` + `@types/bcryptjs` | 本番 1 + 開発 1 パッケージ | **低**（※新規のみなら中） | Node 標準 `node:crypto` の `scrypt` で置換可能だが、既存 DB の bcrypt ハッシュ移行が障壁 |
| `保留` | S6 | `server` | `tsx` | 開発 推移 29 パッケージ | **低** | Node `--experimental-strip-types` 置換は CJS + 拡張子省略相対 import の全面修正が必要 |
| `保留` | S7 | `server` | `vitest` | 開発 推移 25 パッケージ | **低** | 3 プロジェクト構成・`globalSetup`・直列実行・TS 拡張子問題があり費用対効果が低い |
| `採用` | J1 | `judge` | `Gson`（外部 JAR） | 外部 JAR 1 件（約 280KB、推移 0） | **低** | `Judge.java` の JSON 処理。任意入力のエスケープ・Unicode バグのリスクに見合わない |
| `保留` | F5 | `frontend` | `tailwindcss` | `package.json` 1 行のみ（lockfile 上の実削減 0） | **低** | `@tailwindcss/vite` の依存に含まれるため直接記載を消せるが、公式手順・IDE 補完面で維持推奨 |
| `保留` | F6 | `frontend` | `@types/node` | 開発 推移 2 パッケージ | **低** | `playwright.config.ts` と `e2e/*.spec.ts` で実使用しているため維持推奨 |

---

## 詳細：フロントエンド（ルート `package.json`）

### F1. `react-markdown`（`dependencies` / `^10.1.0`）— 推奨度: 高

- **現在の使用箇所**:
  - `src/pages/StudentTaskPage.tsx`（L436）、`src/pages/PracticeTaskPage.tsx`（L355）、`src/pages/TaskEditorPage.tsx`（L799, L812）の 3 ファイル計 4 箇所のみ。
  - すべて `<ReactMarkdown>{task.statementMarkdown}</ReactMarkdown>` の素の呼び出しで、remark/rehype プラグイン・カスタム `components`・生 HTML（`rehype-raw`）は一切未使用。
  - `src/index.css` の `.markdown-body` が対象とする要素は `h1`–`h4`, `p`, `ul`/`ol`/`li`, `a`, `strong`, `em`, `hr`, `blockquote`, `code`, `pre`, `table`/`th`/`td`（現状 `remark-gfm` 未導入のためテーブルは未レンダリング）＋画像挿入（`![alt](/uploads/...)`）。
- **リファクタリング案**:
  - 実使用サブセット（見出し・段落・強調・インラインコード・フェンスドコードブロック・リスト・引用・水平線・リンク・画像、必要なら GFM テーブル）を直接 `ReactNode` ツリーに変換する軽量コンポーネント（`src/components/MarkdownBody.tsx`、目安 150〜250 行）とユニットテストを自作する。
  - `dangerouslySetInnerHTML` は使わず React 要素として生成し、リンクおよび画像 URL はスキーム検証（`http:` / `https:` / `/` 相対パスのみ許可）を行う。
- **メリット**:
  - 単独で **80 パッケージ**（`unified` / `remark-*` / `micromark*` / `mdast-*` / `hast-*` 等、フロントエンド全到達依存 224 件の **約 35%**）を削除でき、削減効果が最大。
  - バンドルサイズを大幅削減（`dist/assets/lib-*.js` 約 113KB 非圧縮 → 数 KB 程度）。
  - サプライチェーン攻撃面および依存脆弱性対応のコストを大幅に減らせる。
- **デメリット・リスク・制約**:
  - `CLAUDE.md` の制約（生 HTML 無効・XSS 防止）を自前実装で確実に守る必要がある（特に `javascript:` 等の危険な URL スキーム遮断をテストで担保すること）。
  - ネストリスト・バックスラッシュエスケープ・参照リンクなど CommonMark のエッジケースで、既存問題文の表示に微差が出る可能性がある。
- **判断メモ**:
  - 判断: `（採用 / 見送り / 保留）`
  - メモ:

---

### F2. `@monaco-editor/react`（`dependencies` / `^4.7.0`）— 推奨度: 中

- **現在の使用箇所**:
  - `src/components/CodeEditor.tsx`: `<Editor>`（`height`, `language`, `theme`, `beforeMount`, `onMount`, `value`, `onChange`, `options`）と型 `Monaco`, `OnMount`, `OnChange`。`onMount` 内で `onKeyDown` / `onDidPaste` / `addAction` / `setModelMarkers` を利用。
  - `src/runner/monacoThemes.ts`: `import type { Monaco }` のみ（`defineTheme` 用）。
  - Monaco 本体は npm 依存に含まれず、`@monaco-editor/loader` が `https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs` から AMD `loader.js` を動的ロードしている（`server/src/lib/csp.ts` で `cdn.jsdelivr.net` を許可済み）。
- **リファクタリング案**:
  - AMD `loader.js` を読み込むヘルパー（約 40 行、CDN バージョンを明示固定）と、`CodeEditor.tsx` 内で `monaco.editor.create()` / `setValue` / `setModelLanguage` / `setTheme` / `updateOptions` / `dispose` を直接制御する薄い React ラッパー（約 100〜130 行）、および使用 API のみの最小型定義（約 50 行）に置換する。
- **メリット**:
  - 直接依存 1・推移依存 **3 パッケージ**（`@monaco-editor/react`, `@monaco-editor/loader`, `state-local`）を削除できる。
  - `dist/assets/CodeEditor-*.js`（約 17KB）をさらに軽量化できる。
  - CDN から読み込む `monaco-editor` のバージョンをプロジェクト側で明示的に固定管理できる。
- **デメリット・リスク・制約**:
  - controlled `value` 同期（カーソル位置保持・無限更新ループ防止）や React `StrictMode` の二重マウント/破棄時の `dispose` 制御を自前で正しく書く必要がある。
  - `CLAUDE.md` に記載された E2E 仕様（`window.monaco.editor.getModels()[0].setValue(code)` が `onChange` に流れること）を壊さないよう、Playwright E2E 全件での検証が必須。
  - 将来 Monaco API を追加利用する際、自前型定義への追記が必要になる。
- **判断メモ**:
  - 判断: `（採用 / 見送り / 保留）`
  - メモ:

---

### F3. `react-router-dom`（`dependencies` / `^7.18.1`）— 推奨度: 中

- **現在の使用箇所**:
  - `src/App.tsx`, `ProtectedRoute.tsx`, `UserDrawer.tsx`, `BackHeader.tsx`, `RoleHome.tsx` および各 Page の計 21 ファイル。
  - 機能範囲はフラットな 18 ルート定義のみ（ネスト `<Outlet>`・Data Router・loader/action・`useSearchParams` 等はすべて未使用）。
  - 使用 API は `BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`（`UserDrawer.tsx` のみ、`end` 指定あり）, `Navigate`（2 ファイル）, `useLocation`（`ProtectedRoute.tsx` のみ）, `useNavigate`（13 ファイル、`replace: true` と `navigate(-1)` を使用）, `useParams`（7 ファイル、`:examId` / `:taskId` のみ）。
- **リファクタリング案**:
  - **案 A（最小変更）**: React Router v7 では `react-router-dom` は `react-router` の薄い再エクスポートラッパーのため、直接 `react-router` に差し替えて `react-router-dom` を削除する（1 パッケージ減のみ）。
  - **案 B（完全脱依存）**: History API（`pushState` / `replaceState` / `popstate`）+ React Context + 軽量パスマッチャ（`:param` 抽出）で、上記使用 API と互換の軽量ルーターを自作する（目安 120〜180 行）。
- **メリット**:
  - 案 B を採れば直接依存 1・推移依存 **4 パッケージ**（`react-router-dom`, `react-router`, `cookie`, `set-cookie-parser`）を削除でき、エントリーチャンク `dist/assets/index-*.js`（現在 249KB）を軽量化できる（試験開始時のログイン集中による初回転送量削減に効く）。
- **デメリット・リスク・制約**:
  - 21 ファイルの import パス変更が発生する（案 B で互換 API 名を保てば呼び出し側コードの修正は最小で済む）。
  - 案 B では `Link` の修飾キー（Cmd/Ctrl クリック等）による新規タブ遷移、`popstate`、`navigate(-1)`、遷移時のスクロール位置リセット、および `ProtectedRoute` のリダイレクト挙動を自前で正しく実装し、E2E で網羅検証する必要がある。
- **判断メモ**:
  - 判断: `（採用・案A / 採用・案B / 見送り / 保留）`
  - メモ:

---

### F4. `vitest`（`devDependencies` / `^5.0.1`）— 推奨度: 中

- **現在の使用箇所**:
  - `vitest.config.ts` および `src/**/*.test.ts` の 10 ファイル。
  - すべて `environment: 'node'`（DOM 不使用・Vite プラグイン不使用）で、`describe` / `it` / `expect` のみ使用（`vi.*` モック・タイマー・スナップショット等は一切未使用）。
- **リファクタリング案**:
  - `engines.node >= 22.12`（CI も Node 22）を活かし、Node 標準の `node:test` + `node:assert/strict` に移行して `node --experimental-strip-types --test` で実行する。`vitest.config.ts` も削除できる。
- **メリット**:
  - 直接依存 1・推移依存 **17 パッケージ**（`vitest`, `@vitest/*`, `tinypool`, `chai` 等）を削除でき、`npm ci` とテスト起動が高速化する。
- **デメリット・リスク・制約**:
  - 現在の `src/**/*.test.ts` はすべて拡張子なしの相対 import（例: `from './bulkTestCases'`）を使っているため、Node 標準の型ストリッピングで直接実行するには相対 import に `.ts` 拡張子を付与する必要がある（`tsconfig.app.json` はすでに `allowImportingTsExtensions: true` のため型チェック自体は整合する）。
  - `server/` 側は引き続き `vitest`（`unit` / `integration` / `judge` の 3 プロジェクト）を使うため、フロントエンドのみ移行するとリポジトリ内でテスト記述スタイル（`expect` vs `assert`）が分断される（後述「リポジトリ横断の補足」を参照）。
- **判断メモ**:
  - 判断: `（採用 / 見送り / 保留）`
  - メモ:

---

### F5. `tailwindcss`（`devDependencies` / `^4.3.2`）— 推奨度: 低

- **現在の使用箇所**:
  - `src/index.css`（`@import "tailwindcss";`, `@theme inline`）。ビルドは `@tailwindcss/vite` 経由。
- **リファクタリング案**:
  - `@tailwindcss/vite@4.3.2` の `dependencies` に `tailwindcss@4.3.2` が直接含まれているため（`exclusive = 0`）、`package.json` の直接記載のみ削除する。
- **メリット**:
  - `package.json` が 1 行減るのみ（lockfile の総パッケージ数は変化しない）。
- **デメリット・リスク・制約**:
  - Tailwind CSS v4 の公式手順では `@tailwindcss/vite` と `tailwindcss` の両方を明示する構成が推奨されており、将来 `peerDependencies` 化された場合や IDE 補完プラグインの挙動リスクを考えると維持する方が安全。
- **判断メモ**:
  - 判断: `（採用 / 見送り / 保留）`
  - メモ:

---

### F6. `@types/node`（`devDependencies` / `^24.13.2`）— 推奨度: 低

- **現在の使用箇所**:
  - `tsconfig.node.json`（`"types": ["node"]` だが、対象の `vite.config.ts` / `vitest.config.ts` 自体は Node API 未使用）。
  - 一方で `playwright.config.ts`（`node:os`, `node:path`, `process.env`）および `e2e/*.spec.ts`（`process.env`）で実際に利用している。
- **リファクタリング案**:
  - `tsconfig.node.json` の `"types": ["node"]` の整理は可能だが、E2E 設定・テストの型補完のためにパッケージ自体は維持するのが自然。
- **メリット**:
  - 削除しても開発依存 2 パッケージのみと効果が小さい。
- **デメリット・リスク・制約**:
  - 削除すると `playwright.config.ts` や `e2e/*.spec.ts` の Node 型補完・型チェックが欠落する。
- **判断メモ**:
  - 判断: `（採用 / 見送り / 保留）`
  - メモ:

---

## 詳細：バックエンド（`server/package.json`）

### S1. `dotenv`（`dependencies` / `^16.4.7`）— 推奨度: 高

- **現在の使用箇所**:
  - `server/src/index.ts` L1 の `import 'dotenv/config'` のみ。
- **リファクタリング案**:
  - Node 22.12+ 標準の `process.loadEnvFile()` を `server/src/index.ts` 先頭で呼び出す（約 5 行）。または `start` / `dev` スクリプトに `--env-file-if-exists=.env`（Node 22.9+）を付与する。
- **メリット**:
  - 本番依存を 1 件削減できる。
  - `process.loadEnvFile()` も既存環境変数を上書きしないため `dotenv/config` と同等の挙動を保てる。
- **デメリット・リスク・制約**:
  - `process.loadEnvFile()` は `.env` が存在しない場合に `ENOENT` を投げる。`server/Dockerfile`（`docker-compose.prod.yml` の `env_file` 経由）や `playwright.config.ts` では `.env` 不在で起動するため、`ENOENT` のみ無視する `try/catch`（または `--env-file-if-exists` の利用）が必須。
- **判断メモ**:
  - 判断: `（採用 / 見送り / 保留）`
  - メモ:

---

### S2. `cookie-parser` + `@types/cookie-parser`（`dependencies` `^1.4.7` / `devDependencies` `^1.4.8`）— 推奨度: 高

- **現在の使用箇所**:
  - `server/src/app.ts` L50（`app.use(cookieParser())`、署名付き Cookie は未使用）。
  - `server/src/middleware/auth.ts` L15（`req.cookies?.[SESSION_COOKIE_NAME]`）。
  - `server/src/routes/auth.ts` L134（`req.cookies?.[SESSION_COOKIE_NAME]`）。
  - ※ `res.cookie` / `res.clearCookie` は Express 標準機能であり、`cookie-parser` は不要。
- **リファクタリング案**:
  - `req.headers.cookie` から指定名の値を取り出す約 15 行のヘルパー（例: `getCookie(req, SESSION_COOKIE_NAME)`）を `server/src/lib/session.ts` 等に追加し、`req.cookies` 参照の 2 箇所を置換する。
  - `session_token` は 64 文字 hex 固定のため、`decodeURIComponent`（不正文字列時はフォールバック）程度で十分。
- **メリット**:
  - 本番推移依存 **3 パッケージ**（`cookie-parser`, `cookie`, `cookie-signature`）＋ 開発依存 1 件を削減できる。
  - Express の型拡張も不要になりコードが簡潔になる。
- **デメリット・リスク・制約**:
  - ほぼなし。単体テストを数件追加し、既存の統合テスト・E2E で認証フローを確認すれば安全に移行できる。
- **判断メモ**:
  - 判断: `（採用 / 見送り / 保留）`
  - メモ:

---

### S3. `cors` + `@types/cors`（`dependencies` `^2.8.5` / `devDependencies` `^2.8.17`）— 推奨度: 高

- **現在の使用箇所**:
  - `server/src/app.ts` L41（`app.use(cors({ origin: CORS_ORIGIN, credentials: true }))`）のみ。
  - 単一の固定オリジン文字列 + `credentials: true` の単純構成（本番の統合配信では同一オリジンで動作するため、実質的には開発時の 2 ターミナル構成用）。
- **リファクタリング案**:
  - `server/src/app.ts`（または `server/src/lib/cors.ts`）に約 20 行のミドルウェアを自作する（`Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials: true`, `Vary: Origin` を付与し、`OPTIONS` プリフライト時に `Access-Control-Allow-Methods` / `Access-Control-Allow-Headers` を返して `204` で終了）。
- **メリット**:
  - 本番推移依存 **3 パッケージ**（`cors`, `object-assign`, `vary`）＋ 開発依存 **3 パッケージ** を削減できる。
- **デメリット・リスク・制約**:
  - プリフライト（`OPTIONS` + `Access-Control-Request-Headers`）の扱いを漏らすと開発環境（Vite `:5173` → API `:4000`）で `Content-Type: application/json` 等のリクエストが失敗する。単体テストと既存統合テストでの確認が必要。
- **判断メモ**:
  - 判断: `（採用 / 見送り / 保留）`
  - メモ:

---

### S4. `multer` + `@types/multer`（`dependencies` `^2.5.0` / `devDependencies` `^2.2.0`）— 推奨度: 中

- **現在の使用箇所**:
  - `server/src/routes/uploads.ts` のみ（`multer.memoryStorage()`, `fileSize: 5MB`, `files: 1`, `ALLOWED_IMAGE_TYPES` 4 種の MIME フィルタ, `upload.single('file')`）。
  - クライアント側の呼び出しは `src/api/uploads.ts` のみ。
- **リファクタリング案**:
  - **案 A（推奨・最小実装）**: Express 標準同梱の `express.raw({ type: Object.keys(ALLOWED_IMAGE_TYPES), limit: MAX_UPLOAD_BYTES })` に切り替え、約 25 行で処理する。フロントエンド `src/api/uploads.ts` も `FormData` をやめて `body: file` + `Content-Type: file.type` に変更する（約 5 行変更）。
  - **案 B（ワイヤ互換維持）**: Node 22 標準の Web Fetch `new Request(..., { body: Readable.toWeb(req), duplex: 'half' }).formData()` で `multipart/form-data` をそのままパースする（5MB 上限をストリーム途中で遮断するバイトカウンタ付き、約 40 行）。
- **メリット**:
  - `express` に次ぐ第 2 位の本番依存ツリー（**16 パッケージ**）＋ 開発依存 **12 パッケージ** を一気に削減できる。
  - `multer` / `busboy` 系の CVE 対応負荷や Docker コンテナイメージサイズの軽減にも効く。
- **デメリット・リスク・制約**:
  - `CLAUDE.md` の制約（不正な MIME タイプはディスクに書く前に拒否、5MB 上限、PNG/JPEG/GIF/WebP 許可リスト、`crypto.randomUUID()` ファイル名）を維持する必要がある。
  - 案 A は `POST /api/uploads` のワイヤ形式が変わるため、`src/api/uploads.ts` と `server/test/integration/authoring.test.ts`（2 テスト）の同時修正が必要（教員専用の内部 API のため外部互換性リスクは低い）。
  - 案 B はフロント無変更だが、不正 multipart ボディのエラーハンドリングと 5MB 超過時の早期打ち切りを自前で丁寧に実装する必要がある。
- **判断メモ**:
  - 判断: `（採用・案A / 採用・案B / 見送り / 保留）`
  - メモ:

---

### S5. `bcryptjs` + `@types/bcryptjs`（`dependencies` `^2.4.3` / `devDependencies` `^2.4.6`）— 推奨度: 低（既存本番 DB なし／新規導入のみなら 中）

- **現在の使用箇所**:
  - `server/src/routes/auth.ts`（signup / login / change-password の `hash(..., 12)`・`compare`）。
  - `server/src/routes/students.ts`（bulk / reset-password の `hash(..., 12)`）。
- **リファクタリング案**:
  - Node 標準 `node:crypto` の `scrypt` + `randomBytes(16)` + `timingSafeEqual` で約 30 行の `server/src/lib/password.ts` を自作する（保存形式例: `$scrypt$N$r$p$<salt>$<hash>`）。
  - `CLAUDE.md` の「ネイティブ npm アドオン回避（pure-JS 方針）」にも合致し、OpenSSL 実装のため pure-JS の `bcryptjs` より高速かつ libuv スレッドプール上で動作するためイベントループを塞がない。
- **メリット**:
  - 本番 1 件 + 開発 1 件を削減できる。
  - メモリハードな KDF への移行による耐性向上と、一括アカウント発行（`/api/students/bulk`）や試験開始時のログイン集中によるイベントループ詰まりの解消。
- **デメリット・リスク・制約**:
  - **既存 DB の `users.passwordHash` に保存された bcrypt ハッシュ（`$2a$12$...`）は `scrypt` で検証できない。**
  - 既存運用 DB を維持する場合、ログイン成功時に順次 `scrypt` へ再ハッシュするデュアル運用期間が必要になり、その間は `bcryptjs` を削除できない（全ユーザーの強制パスワードリセットを行わない限り即削除不可）。
- **判断メモ**:
  - 判断: `（採用 / 見送り / 保留）`
  - メモ:

---

### S6. `tsx`（`devDependencies` / `^4.19.2`）— 推奨度: 低

- **現在の使用箇所**:
  - `server/package.json`（`"dev": "tsx watch src/index.ts"`）。
  - `playwright.config.ts` L37（`npx tsx scripts/e2e-prepare-db.ts`）。
  - `server/scripts/loadtest-grading.ts`（手動実行）。
- **リファクタリング案**:
  - Node 22.12+ の `--experimental-strip-types`（+ `--watch`）で代替する。
- **メリット**:
  - 開発依存 **29 パッケージ**（`esbuild` 含む）を削減でき、`npm ci` が高速化する（本番 Docker イメージは `npm ci --omit=dev` のためコンテナサイズへの影響はなし）。
- **デメリット・リスク・制約**:
  - **移行コストが大きい。** `server/package.json` は `"type": "commonjs"` で、`server/src/` と `server/scripts/e2e-prepare-db.ts` 全体が拡張子省略の相対 import（`from './app'` 等）を使用している。
  - Node の `--experimental-strip-types` は拡張子省略の `.ts` 解決を行わないため、全ファイルの相対 import に `.ts` を付与し、`tsconfig.json` の `rewriteRelativeImportExtensions` 等を調整する必要がある。
  - Node 22.12〜22.17 では実行時に `ExperimentalWarning` が出る。（※ 相対 import を持たない `loadtest-grading.ts` 単体なら即置換可能）。
- **判断メモ**:
  - 判断: `（採用 / 見送り / 保留）`
  - メモ:

---

### S7. `vitest`（`devDependencies` / `^5.0.1`）— 推奨度: 低

- **現在の使用箇所**:
  - `server/vitest.config.mts`（`unit` / `integration` / `judge` の 3 プロジェクト、`globalSetup`、`fileParallelism: false`、project 別 `env`、`testTimeout`）。
  - テスト 12 ファイル（`vi.fn()` は `csp.test.ts` の 1 箇所のみ）。
- **リファクタリング案**:
  - Node 22 標準の `node:test` + `node:assert/strict` に移行し、テストを `tsc` ビルド後に実行するか型ストリッピング経由で実行する。`globalSetup` はラッパースクリプト化する（`--test-global-setup` は Node 22.15+ のため `engines: >=22.12` では使用不可）。
- **メリット**:
  - 開発依存 **25 パッケージ** を削減できる。
- **デメリット・リスク・制約**:
  - 12 ファイルすべてのアサーション書き換えに加え、`globalSetup`・project 別 `env`・直列実行の自前管理が必要になる。
  - `tsx` と同様に TS 実行時の拡張子解決問題も絡む。
  - CI の `server` / `judge` ジョブ構成にも影響し、費用対効果が低い。
- **判断メモ**:
  - 判断: `（採用 / 見送り / 保留）`
  - メモ:

---

## 詳細：ジャッジ（`judge/Dockerfile`）

### J1. `Gson` 2.11.0（`judge/Dockerfile` 外部 JAR）— 推奨度: 低

- **現在の使用箇所**:
  - `judge/Judge.java`（`/run` のリクエスト・レスポンス、`SharedLimits`、`NodeRunRequest` の JSON シリアライズ／デシリアライズ、エラー文字列エスケープ）。
- **リファクタリング案**:
  - `Judge.java` 内に最小限の再帰下降 JSON パーサと文字列エスケープ付きシリアライザを自前実装する（目安 180〜250 行）。
- **メリット**:
  - `judge/Dockerfile` から Maven Central への外部ダウンロード（`ADD https://repo1.maven.org/...`）を除去でき、Docker ビルド時の外部依存を 1 つ減らせる。
- **デメリット・リスク・制約**:
  - 生徒の `code` / `stdin` / `stdout` / `stderr` には任意の制御文字・Unicode・サロゲートペア・エスケープ文字が含まれるため、自前 JSON パーサ／シリアライザのバグ混入リスクがある。
  - Gson は SHA-256 チェックサム固定・推移依存ゼロの単一軽量 JAR（約 280KB）であり、置換による恩恵が小さい。
- **判断メモ**:
  - 判断: `（採用 / 見送り / 保留）`
  - メモ:

---

## リポジトリ横断の補足

- **`vitest` はルート（F4）と `server/`（S7）の両方で利用中**:
  - ルート（フロントエンド）側は純粋関数テストのみで移行が比較的容易（推奨度: 中）だが、`server/` 側は 3 プロジェクト構成や `globalSetup` 等の都合で移行コストが高い（推奨度: 低）。
  - フロントエンドだけ `node:test` に移行すると、リポジトリ内でテスト記法（`assert` と `expect`）とランナーが分断される。「フロントエンドの開発依存 17 パッケージ削減」と「リポジトリ全体のテスト規約統一」のどちらを優先するかでセット判断するのがよい。
- **`sucrase` はルートと `judge/runner/` でバージョン完全一致が必須**:
  - ブラウザの JS/TS プレビューと judge のサーバー側採点で型ストリッピング・構文エラー位置 `(line:col)` 抽出を一致させるため、`package.json`（`^3.35.1`）と `judge/runner/package.json`（`3.35.1`）のバージョン固定が `server/test/runtimeParity.test.ts` で強制されている。片側だけの削除・置換はできない。
- **`engines.node >= 22.12` と Node 標準機能の制約**:
  - `dotenv` 代替（`process.loadEnvFile()` / `--env-file-if-exists`）は Node 22.12 でそのまま使える。
  - 一方、`tsx`（S6）や `vitest`（F4 / S7）の代替に `--experimental-strip-types` を使う場合、拡張子省略の相対 import を解決できない制約や、Node 22.12〜22.17 の `ExperimentalWarning`、`--test-global-setup` が Node 22.15+ 限定である点が共通の障壁になる。
- **独立した 3 つの `package.json`**:
  - ルート・`server/`・`judge/runner/` は `node_modules` を共有しない独立プロジェクトのため、同一パッケージでもそれぞれ個別に lockfile とインストール時間に影響する。

---

## 現状維持を推奨する依存パッケージ一覧

上記候補以外のすべての依存パッケージ（全 3 つの `package.json` で宣言されている残り全 22 パッケージ）です。置換コスト・リスク・アーキテクチャ制約の観点から現状維持を推奨します。

| 対象 | 種別 | パッケージ | バージョン | 維持する理由 |
|---|---|---|---|---|
| `frontend` | `dependencies` | `react` | `^19.2.7` | UI フレームワーク本体（全コンポーネント・Hooks・`React.lazy` の基盤） |
| `frontend` | `dependencies` | `react-dom` | `^19.2.7` | React のブラウザ DOM レンダラ（`createRoot`） |
| `frontend` | `dependencies` | `@wasmer/sdk` | `^0.10.0` | C 言語のブラウザ内コンパイル（`clang/clang`）および WASI 実行に不可欠 |
| `frontend` | `dependencies` | `@mlc-ai/web-llm` | `^0.2.85` | ブラウザ内 WebGPU LLM（AI 作問サポート・AI ヒント）の中核。`React.lazy` で動的分離済み |
| `frontend` | `dependencies` | `sucrase` | `^3.35.1` | ブラウザ側 TS 型ストリップ・JS 構文エラー位置特定。`runtimeParity.test.ts` で judge 側とバージョン一致を強制 |
| `frontend` | `devDependencies` | `vite` | `^8.3.3` | 開発サーバー（HMR・COOP/COEP ヘッダ）および本番バンドラ |
| `frontend` | `devDependencies` | `@vitejs/plugin-react` | `^6.0.3` | Vite での React JSX 変換・Fast Refresh に必須 |
| `frontend` | `devDependencies` | `typescript` | `~6.0.2` | `tsc -b` による型チェック（`npm run build` / CI） |
| `frontend` | `devDependencies` | `@types/react` | `^19.2.17` | React の TypeScript 型定義 |
| `frontend` | `devDependencies` | `@types/react-dom` | `^19.2.3` | `react-dom/client` の TypeScript 型定義 |
| `frontend` | `devDependencies` | `@tailwindcss/vite` | `^4.3.2` | Tailwind CSS v4 の Vite 統合（全 UI スタイリング基盤） |
| `frontend` | `devDependencies` | `oxlint` | `^1.71.0` | 高速リンター（CI 組み込み済み。ESLint 比で軽量） |
| `frontend` | `devDependencies` | `@playwright/test` | `^1.63.0` | 実ブラウザ E2E テスト（CSP `enforce` 検証・ブラウザ↔judge パリティ検証）の実行基盤 |
| `server` | `dependencies` | `express` | `^4.21.2` | ルーティング・静的配信・`trust proxy`・ボディパーサ・Cookie 設定の中核 |
| `server` | `dependencies` | `@prisma/client` | `^6.2.1` | PostgreSQL スキーマ・21 本のマイグレーション・型安全クエリ・トランザクションの基盤 |
| `server` | `dependencies` | `zod` | `^4.6.6` | 12 ファイル・123 箇所でリクエスト検証に使用。推移依存ゼロで保守性メリットが大きい |
| `server` | `devDependencies` | `@types/express` | `^4.17.21` | `express` の TypeScript 型定義 |
| `server` | `devDependencies` | `prisma` | `^6.2.1` | マイグレーション実行・クライアント生成（`prisma generate`）に必須 |
| `server` | `devDependencies` | `typescript` | `^5.7.2` | 本番ビルド（`tsc`）および `typeParity.test.ts` を含む型チェック（`typecheck:test`）に必須 |
| `server` | `devDependencies` | `@types/node` | `^22.10.5` | `node:crypto`・`node:fs`・`node:path` 等の Node 標準 API の型定義に必須 |
| `judge` | `dependencies` | `pyodide` | `0.28.0` | ブラウザ（CDN v0.28.0）とのランタイム同一性（`runtimeParity.test.ts` で強制）およびスナップショット高速起動に不可欠 |
| `judge` | `dependencies` | `sucrase` | `3.35.1` | ブラウザ JS/TS ランナーとの TS 型ストリップ・構文エラー位置抽出の同一性（`runtimeParity.test.ts` で強制）に不可欠 |
