# 機能改善・設計見直し 作業予定リスト

`wasm-exam-app` を **① アクセシビリティ改善**、**② 同時 100 人規模の採点処理設計**、**③ テスト作問作業のサポート**、**④ ブラウザ内 LLM（WebLLM）の活用拡大** の 4 観点から監査し、優先度付きの作業予定リストとして整理したドキュメントです。

**このドキュメントは改善計画と作業バックログの整理のみを目的としており、現時点でソースコードや既存ドキュメントの変更は行っていません。** 着手前に各フェーズ・項目の採否を判断してください。

---

## 概要と前提制約

### 対象領域と件数サマリー

| 領域 | ID 体系 | 合計件数 | 優先度：高 | 優先度：中 | 優先度：低 |
|---|---|---:|---:|---:|---:|
| 1. アクセシビリティ改善（WCAG 2.1 / 2.2 AA） | `A1`〜`A12` | 12 件 | 5 件 | 5 件 | 2 件 |
| 2. 同時 100 人規模の採点処理設計 | `P1`〜`P10` | 10 件 | 5 件 | 4 件 | 1 件 |
| 3. テスト作問作業のサポート | `T1`〜`T12` | 12 件 | 5 件 | 5 件 | 2 件 |
| 4. ブラウザ内 LLM（WebLLM）の活用拡大 | `L1`〜`L10` | 10 件 | 7 件 | 3 件 | 0 件 |
| **合計** | — | **44 件** | **22 件** | **17 件** | **5 件** |

### 遵守すべき前提制約（`CLAUDE.md` / `docs/roadmap.md`）

本計画の全項目は、以下のプロジェクト制約を前提としています。

1. **学内セルフホスト維持（個人情報保護）**: 学生の個人情報・提出コードは学内管理インフラ（Express + PostgreSQL）に留め、外部 BaaS や外部 LLM API への送信は行わない。
2. **judge の常駐 isolate 使い回し不採用**: セキュリティ分離（生徒コードが他生徒の採点に影響しないこと）を優先し、提出・リクエストごとの新規プロセス実行を維持する。スケールはコンテナ水平増設とキュー最適化で実現する。
3. **ブラウザ内 Java 実行は対象外**: Java 25 / JEP 512 対応の制約により、Java は引き続きサーバー側 `judge` で実行する。
4. **`@mlc-ai/web-llm` の `React.lazy` 分離厳守**: 数 MB のバンドルが通常ページの初期読み込みを汚染しないよう、WebLLM 依存コードは既存の `React.lazy` 境界内に閉じ込める。
5. **非公開テスト期待値の秘匿**: 生徒向け API・AI ヒントコンテキストには非公開テストケースの `expectedOutput` および `Solution` を一切渡さない（ユニットテストで継続保証する）。
6. **`EXAM` モードでの AI ヒント完全無効**: 生徒向け AI 機能（ヒント・エラー解説・AC 後レビュー等）はすべて演習モード（`PRACTICE`）限定とし、試験モード（`EXAM`）には一切導入しない。
7. **小型モデル（3B / 7B）のヒント限界は実機検証必須**: 3B モデルでのヒント答え漏れはプロンプト調整のみでは解決しなかった既知の限界であり、7B モデル等での改善を主張する場合は必ず実機モデルで同一バグに対する検証を行う。

---

## 推奨実施フェーズ（全体ロードマップ）

4 領域の項目を「本番事故防止・基盤整備 → 体験と生産性の大幅向上 → 発展・運用深化」の 3 フェーズに配置しています。

### Phase 1：本番事故防止 ＆ 基盤整備（計 15 件）

100 人同時試験で即座に障害へ直結するボトルネック、キーボード操作不能・WCAG AA 違反の致命的欠陥、作問時の保存漏れ・公開事故防止、WebLLM 拡張の土台となるエンジン分離・CSP 実機検証を最優先で実施します。

| 領域 | 対象 ID | 主な内容 |
|---|---|---|
| 採点スケール（5 件） | `P1`, `P2`, `P3`, `P4`, `P5` | TLE ポイズンピル解消、締切 N+1 解消、教室 NAT ロックアウト対策、マルチ `judge` プール、Prisma プール／インデックス／セッションキャッシュ |
| アクセシビリティ（3 件） | `A1`, `A2`, `A3` | `UserDrawer`/`ConfirmDialog` フォーカストラップ＆`inert`、`<input type="file">` キーボード操作化、ダーク／ライト両テーマの WCAG AA コントラスト修正 |
| 作問サポート（4 件） | `T1`, `T2`, `T3`, `T5` | 「すべて保存」＆ `Cmd/Ctrl+S`、期待値一括上書き＆`SampleDiff`/実行時間表示、全問題一括検証＆`publish-check` 強化、Markdown 画像ペースト／ドロップ |
| WebLLM（3 件） | `L1`, `L2`, `L9` | 共有エンジンマネージャ分離・ストリーミング・中断・アイドル解放、1.5B/3B/7B プリセット＆WebGPU/キャッシュ診断、CSP `enforce` 実機検証＆学内ミラー対応 |

### Phase 2：体験と生産性の大幅向上（計 20 件）

試験中の体感を改善するポーリング最適化・SSE 化、スクリーンリーダー対応のライブリージョン・ルーター遷移・フォーム／テーブル意味論、下書きプレビューや問題バンク強化、低リスク・高教育効果の WebLLM 活用拡大を進めます。

| 領域 | 対象 ID | 主な内容 |
|---|---|---|
| 採点スケール（4 件） | `P6`, `P7`, `P8`, `P9` | 採点結果ポーリング最適化／待ち順表示／SSE 化、`scrypt`・`UV_THREADPOOL_SIZE` 最適化、Java プレビュー保護＆`regrade` 非同期化、静的アセットキャッシュ／圧縮＆Pyodide 配信 |
| アクセシビリティ（7 件） | `A4`, `A5`, `A6`, `A7`, `A8`, `A9`, `A10` | ライブリージョン（実行結果・タイマー警告・採点完了）、ルーターフォーカス・タイトル・ランドマーク・見出し階層、フォームラベル紐付け、Monaco Tab 脱出案内、テーブル意味論、フォーカスリング＆`prefers-reduced-motion`、`HelpPopover`＆24×24px ターゲット |
| 作問サポート（6 件） | `T4`, `T6`, `T7`, `T8`, `T9`, `T10` | DRAFT 生徒画面プレビュー、試験単位 JSON エクスポート／インポート、`TaskBankPicker` 強化、テストケース CSV/TSV/JSON インポート＆プレビュー、`ExamDetailPage` 情報充実、`TestCaseRow` 複製・折りたたみ・`ConfirmDialog` 統一 |
| WebLLM（3 件） | `L3`, `L6`, `L7` | 既存問題強化（エッジケース生成・曖昧さチェック・スターター生成）、エラーメッセージかみ砕き解説（CE/RE）、AC 後コードレビュー |

### Phase 3：発展・運用深化・細部の磨き込み（計 9 件）

本番運用をさらに安定・高度化する可視化・負荷テスト強化、作問アクセラレータ、授業振り返り向け AI 分析、UI の細部統一を行います。

| 領域 | 対象 ID | 主な内容 |
|---|---|---|
| 採点スケール（1 件） | `P10` | `service-health` メトリクス拡張 ＆ `loadtest-grading.ts` の現実シナリオ化 |
| アクセシビリティ（2 件） | `A11`, `A12` | トグルボタン `aria-pressed`/`role="group"`・装飾記号 `aria-hidden`、残存 `window.confirm` の `ConfirmDialog` 化 |
| 作問サポート（2 件） | `T11`, `T12` | 初学者向け定型問題テンプレート（非 AI）、初期テンプレート⇔解答例コピー＆境界値チェックリスト |
| WebLLM（4 件） | `L4`, `L5`, `L8`, `L10` | 匿名化つまずき傾向サマリー、類題・バリエーション生成、ヒントへの 1 問 1 答フォローアップ＆5 言語 `looksLikeCode` 強化、構造化出力リトライ＆コンパイル失敗時自動リカバリ |

### 領域横断のシナジー・推奨着手順序

- **`ConfirmDialog` 統一（`A1` → `T10`・`A12`）**: 先に `A1` で `ConfirmDialog` にフォーカストラップ・フォーカス復帰・`aria-describedby`・初期フォーカス改善を入れた上で、`T10`（作問画面の `window.confirm` 2 箇所）と `A12`（生徒画面の `window.confirm` 3 箇所）を置換すると手戻りがありません。
- **`TaskEditorPage` UX × WebLLM 既存問題強化（`T1`・`T2` × `L3`）**: 同じ `TaskEditorPage.tsx` / `SolutionCheckPanel` / `AiAssistPanel.tsx` を対象とするため、一括保存・期待値反映の導線と AI 生成プレビューの選択反映 UI を統一設計すると保守性が高まります。
- **`AdminPage` 運用機能集約（`P3` × `P10`）**: `P3` の IP ロック解除 UI と `P10` の採点キュー・複数 judge 状態メトリクスを同じ `server/src/routes/admin.ts` / `src/pages/AdminPage.tsx` に整理できます。
- **学内ミラー・配信基盤（`P9` × `L9`）**: `P9` の静的アセット圧縮・Pyodide 自前配信と `L9` の WebLLM 学内モデルミラー（CORS + `Cross-Origin-Resource-Policy: cross-origin`）は、同じリバースプロキシ設定および `docs/operations.md` 更新でまとめて整備できます。
- **採点完了通知のリアルタイム化 × SR 対応（`P6` × `A4`）**: `P6` で `StudentExamFinishedPage` に待ち順表示・SSE を導入する際、`A4` の常設 `role="status" aria-live="polite"` を同時に組み込むことで、画面閲覧者とスクリーンリーダー利用者の双方に確実な完了通知が届きます。

---

## 1. アクセシビリティ改善（`A1`〜`A12`）

WCAG 2.1 / 2.2 AA 準拠を基準としたフロントエンド監査結果に基づく作業リストです。

### 優先度：高

- [x] **A1. `UserDrawer` 閉鎖時の `ThemeToggle` フォーカス漏れ修正 ＆ モーダル／ドロワーのフォーカストラップ・復帰実装**
  - **優先度**: 高 ／ **推奨フェーズ**: Phase 1 ／ **工数目安**: 中
  - **対象ファイル**: `src/components/UserDrawer.tsx`（L64-78, L147, L202）、`src/components/ThemeToggle.tsx`（L7）、`src/components/ConfirmDialog.tsx`（L33-46, L52, L59-67）、`src/components/TaskBankPicker.tsx`（L70-82, L134）、新規 `src/hooks/useDialogFocus.ts`
  - **現状の課題・根拠**:
    - `UserDrawer` は常時マウントで `aria-hidden={!open}` を付与しているが、`ThemeToggle` に `tabIndex={tab}` が渡っておらずドロワー閉鎖中も Tab でフォーカスが当たる（`aria-hidden="true"` 内のフォーカス可能要素は WCAG 4.1.2 違反）。
    - `UserDrawer` / `ConfirmDialog` / `TaskBankPicker` のすべてでフォーカストラップが無く Tab が背面ページへ抜ける。背景の `<button>`（`ConfirmDialog.tsx:52`, `TaskBankPicker.tsx:134`）も Tab 順に入る。閉鎖時のトリガー要素へのフォーカス復帰も無い。
    - `ConfirmDialog` の `role="alertdialog"` に `aria-describedby` が無く本文 `<p>` が読み上げられない場合がある。また開いた直後に破壊的操作ボタン（`confirmButtonRef`）へフォーカスしており誤確定リスクが高い。
  - **具体的な作業内容**:
    1. 共通フック `useDialogFocus(open, dialogRef, onClose)` を作成し、Tab/Shift+Tab のループ（フォーカストラップ）、開く前の `document.activeElement` へのフォーカス復帰、背景ボタンへの `tabIndex={-1}` を全モーダル／ドロワーに適用する。
    2. `UserDrawer` の閉鎖時ラッパーに HTML 標準の `inert={!open}` を適用し、`tabIndex={tab}` の手動管理を廃止して `ThemeToggle` 等の漏れを根絶する。
    3. `ConfirmDialog` に `aria-describedby="confirm-dialog-message"` を付与し、初期フォーカスを「キャンセル」ボタンへ変更する。
  - **完了条件**: 閉じた `UserDrawer` 内要素に Tab が当たらないこと、全モーダル／ドロワーで Tab が内部循環し閉鎖時に元のトリガーへフォーカスが戻ること、`ConfirmDialog` の初期フォーカスがキャンセルボタンにあることをキーボード操作および E2E で確認できる。

- [x] **A2. `display: none` の `<input type="file">` 解消によるキーボードファイル選択対応**
  - **優先度**: 高 ／ **推奨フェーズ**: Phase 1 ／ **工数目安**: 小
  - **対象ファイル**: `src/components/FileLoadButton.tsx`（L49）、`src/components/TaskBankPicker.tsx`（L281）、`src/pages/TaskEditorPage.tsx`（L763）
  - **現状の課題・根拠**: `<label>` 内の `<input type="file" className="hidden">` が `display: none` のため Tab フォーカスが一切当たらず、キーボード／スクリーンリーダーユーザーが「画像を挿入」「JSON インポート」「ファイルから読み込む」を実行できない（WCAG 2.1.1 違反）。
  - **具体的な作業内容**: `className="hidden"` を `className="sr-only"` に変更し、親 `<label>` に `focus-within:outline-2 focus-within:outline-mp-cyan focus-within:outline-offset-2` を付与する（または `<button>` + `inputRef.current?.click()` 方式に統一する）。
  - **完了条件**: 上記 3 箇所すべてで Tab キー移動後に Enter / Space でファイル選択ダイアログを開け、フォーカスリングが視認できること。

- [x] **A3. Monokai Pro ダーク／ライト両テーマの文字・境界コントラスト改善（WCAG 1.4.3 / 1.4.11）**
  - **優先度**: 高 ／ **推奨フェーズ**: Phase 1 ／ **工数目安**: 小〜中
  - **対象ファイル**: `src/index.css`（L10-49）、関連するティントバッジ／バナー（`RestoreBackupBanner.tsx:29`, `UserDrawer.tsx:101`, `StudentTaskPage.tsx:360,398`, `StudentDashboard.tsx:218`, `SampleDiff.tsx:19`, `ChangePasswordPage.tsx:47`, `ExamResultsPage.tsx:673`, `TaskBankPicker.tsx:246`）
  - **現状の課題・根拠**（実測コントラスト比：通常文字基準 4.5:1、非テキスト境界基準 3.0:1）:
    - **ダーク**（`--mp-surface: #403e41` / `--mp-surface-hover: #524f53`）: `--mp-muted (#939293)` on `surface` = **3.42:1**、on `surface-hover` = **2.60:1**。`--mp-red (#ff6188)` on `surface` = **3.69:1**。ティントバッジ on `surface`：`orange` on `orange/20` = **3.50:1**、`cyan` on `cyan/20` = **4.29:1**、`green` on `green/20` = **4.26:1**。
    - **ライト**（`--mp-surface: #ede7e5`）: `--mp-muted (#706b6e)` = **4.27:1**、`--mp-red (#cc2154)` = **4.39:1**、`--mp-orange (#c0471c)` = **4.13:1**、`--mp-yellow (#a36208)` = **3.98:1**、`--mp-green (#1e7e54)` = **4.12:1**。ティントバナー／バッジ：`RestoreBackupBanner`（`orange` on `orange/10`+bg = **4.24:1**）、`UserDrawer`（`cyan` on `cyan/15`+surface = **3.81:1**）、`StudentTaskPage`（`green` on `green/20`+surface = **3.22:1**）、`SampleDiff`（`yellow` on `yellow/30`+bg = **3.14:1**）、`ChangePasswordPage`（`yellow` on `yellow/20`+surface = **3.12:1**）。
    - **境界線（1.4.11）**: `--mp-border` がダーク `#5b595c` on `#2d2a2e` = **2.04:1**、ライト `#d3cdcc` on `#fefaf9` = **1.51:1**（3.0:1 未満）。
    - ※ソリッドボタン（`--mp-btn-fg` on 各アクセント色）はダーク・ライトとも全色 4.87:1〜12.86:1 で適合済み。
  - **具体的な作業内容**:
    1. ダークテーマの `--mp-muted` を `#aba9ab` 程度（on `#403e41` で ≥ 4.6:1）、`--mp-red` テキスト用途を `#ff7a9b` 等に調整する。
    2. ライトテーマの `--mp-muted` を `#5c575a`、`--mp-surface` を `#f4f0ee` へ微調整するか各アクセント色を 5〜10% 深め、`surface` 上でも全色 ≥ 4.5:1 を確保する。
    3. ティントバッジは背景透明度を下げる（`/10`）か文字色を `--mp-fg` に変更する。フォーム入力欄枠線用に 3.0:1 以上を満たす `--mp-border-strong` を導入する。
  - **完了条件**: ダーク・ライト両テーマで通常テキストおよびティントバッジが ≥ 4.5:1、フォーム入力枠線が ≥ 3.0:1 を満たすことをコントラスト計算ツールで確認し、既存ソリッドボタンの適合（≥ 4.5:1）を維持していること。

- [x] **A4. 実行結果・エラー・タイマー警告・採点完了のライブリージョン（`aria-live` / `role="alert"`）整備**
  - **優先度**: 高 ／ **推奨フェーズ**: Phase 2 ／ **工数目安**: 中
  - **対象ファイル**: `src/pages/StudentTaskPage.tsx`（L355-365, L425-429, L509-517, L529-571）、`src/pages/PracticeTaskPage.tsx`（L456-498）、`src/pages/StudentExamFinishedPage.tsx`（L319）、`src/pages/LoginPage.tsx`（L75）、`src/pages/SignupPage.tsx`（L98）、`src/pages/ChangePasswordPage.tsx`（L80）、`src/pages/TeacherDashboard.tsx`（L84, L343）、`src/pages/ExamDetailPage.tsx`（L393, L514）、`src/pages/TaskEditorPage.tsx`（L530, L796, L838, L843-847, L917-919）、`src/pages/ExamResultsPage.tsx`（L251, L506, L702）、`src/components/TaskBankPicker.tsx`（L228-229, L293-294）
  - **現状の課題・根拠**:
    - `StudentTaskPage` / `PracticeTaskPage` のプログレスバー（`role="progressbar"`・`aria-valuenow`/`aria-valuemax` も欠如）、判定結果（`verdict`）、コンパイルエラー、実行エラーに `aria-live` / `role="status"` / `role="alert"` が無く、`Ctrl+Enter` 実行後に SR へ結果が通知されない。
    - カウントダウンの残り 5 分・残り 1 分・時間切れ切替時に SR 通知が無い。
    - `StudentExamFinishedPage` は「採点中です…」に `role="status"` があるが、完了時に要素ごとアンマウントされるため完了結果が読み上げられない。
    - 認証・管理・編集系フォームのエラーおよび保存フィードバックに `role="alert"` / `role="status"` が無い。
  - **具体的な作業内容**:
    1. 全エラー表示に `role="alert"`、保存完了／状態変化（`RuntimeReadinessCard`, `draftSavedFlash`, `savedFlash`, `regradeMsg`, 採点完了サマリ）に常設の `role="status" aria-live="polite"` コンテナを設ける（`P6` と連携）。
    2. 実行進捗バーに `role="progressbar"` + `aria-label` + `aria-valuenow`/`aria-valuemax`（不定時は属性省略）を付与する。
    3. `StudentTaskPage` に 5 分前・1 分前・時間切れの閾値到達時のみ文言を更新する `sr-only` の `role="alert"` 要素を追加する。
  - **完了条件**: 実行結果・エラー・保存完了・タイマー閾値・採点完了の各イベントで、DOM 上のライブリージョンが正しく更新され、過剰な毎秒読み上げが発生しないこと。

- [x] **A5. カスタムルーターのページ遷移時フォーカス管理・タイトル更新・ランドマーク・見出し階層整備**
  - **優先度**: 高 ／ **推奨フェーズ**: Phase 2 ／ **工数目安**: 中
  - **対象ファイル**: `src/lib/router.tsx`（L45-68）、`src/App.tsx`、`index.html`（L7）、`src/components/BackHeader.tsx`（L20）、`src/components/MarkdownBody.tsx`（L71）、`src/pages/ExamDetailPage.tsx`、`src/pages/TaskEditorPage.tsx`、その他全 Page コンポーネント（15 ページ）
  - **現状の課題・根拠**:
    - `src/lib/router.tsx` は `pathname` 変更時に `window.scrollTo(0, 0)` のみ行い、フォーカス移動・遷移アナウンスを行わない。
    - `index.html` の `<title>プログラミング演習システム</title>` 固定で、全ルートで `document.title` が更新されない（WCAG 2.4.2 違反）。
    - `<main>` ランドマークは `StudentTaskPage.tsx:431` と `PracticeTaskPage.tsx:351` のみで他 15 ページは `<div>`、`BackHeader.tsx:20` も `<header>` ではなく `<div>`。スキップリンクも全ページ未設置。
    - `ExamDetailPage` / `TaskEditorPage` に `<h1>` が無く `<h2>` から開始している。`MarkdownBody.tsx:71` が問題文中の `#` を `<h1>` として描画するため、`StudentTaskPage` の `<h2>問題文</h2>` 配下に `<h1>` が出現する。
  - **具体的な作業内容**:
    1. `router.tsx`（または `App.tsx`）に、ルート遷移時に `<main id="main-content" tabIndex={-1}>`（または `<h1>`）へフォーカスを移し `aria-live="polite"` でページタイトルを読み上げる仕組みと `usePageTitle(title)` フックを追加する。
    2. 全ページを `<main id="main-content" tabIndex={-1}>` で囲み、`App.tsx` 先頭に `sr-only focus:not-sr-only` な「本文へスキップ」リンクを配置する。`BackHeader` を `<header>` に変更する。
    3. `ExamDetailPage` / `TaskEditorPage` に適切な `<h1>` を追加し、`MarkdownBody` に `headingOffset`（例：`h1`→`h3` へシフト）を導入する。
  - **完了条件**: 全ルートで固有の `document.title` が設定され、スキップリンク・`<header>`・`<main>`・単一 `<h1>` からの見出し階層が崩れていないこと。

### 優先度：中

- [x] **A6. フォームのラベル未紐付け・`aria-describedby` / `aria-invalid` 整備**
  - **優先度**: 中 ／ **推奨フェーズ**: Phase 2 ／ **工数目安**: 小
  - **対象ファイル**: `src/components/TestCaseRow.tsx`（L91, L100, L112, L131）、`src/pages/ExamResultsPage.tsx`（L300, L492）、`src/components/AiAssistPanel.tsx`（L186）、`src/pages/TaskEditorPage.tsx`（L826, L1048）、`src/pages/LoginPage.tsx`、`src/pages/SignupPage.tsx`、`src/pages/ChangePasswordPage.tsx`
  - **現状の課題・根拠**:
    - `TestCaseRow` の 4 つの `<label>` に `htmlFor` が無く、対応する `<textarea>`/`<input>` にも `id` が無いため SR で無名入力欄になる。
    - `ExamResultsPage` の検索欄・`NumberSettingCell`（延長時間・追加受験）、`AiAssistPanel`、`BulkTestCasePanel` の入力欄が `<label>` 未紐付け／`aria-label` 欠如（`title` や `placeholder` のみ）。
    - 認証フォームでエラーメッセージや補足説明が `aria-describedby` / `aria-invalid` で入力欄に紐づいていない。
  - **具体的な作業内容**:
    1. `useId()` で `TestCaseRow` の各入力欄に一意な `id` / `htmlFor` を付与する。
    2. 検索欄（`aria-label="学籍番号・氏名で検索"`）、`NumberSettingCell`（`aria-label={`${student.displayName}の${label}`}`）、`AiAssistPanel` / `BulkTestCasePanel` の `<textarea>` に適切な `aria-label` を付与する。
    3. 認証フォームのエラー表示に `id` を振り、入力欄へ `aria-invalid={Boolean(error)}` と `aria-describedby` を設定する。
  - **完了条件**: 対象画面の全フォームコントロールがアクセシブルネームを持ち、エラー時に `aria-invalid` と `aria-describedby` で説明が関連付けられること。

- [x] **A7. Monaco エディタ（`CodeEditor.tsx`）の Tab キートラップ案内と `ariaLabel` 設定**
  - **優先度**: 中 ／ **推奨フェーズ**: Phase 2 ／ **工数目安**: 小
  - **対象ファイル**: `src/components/CodeEditor.tsx`（L139-148, L265）、`src/pages/TaskEditorPage.tsx`（L830, L1224）、`src/pages/StudentTaskPage.tsx`（L465）、`src/pages/PracticeTaskPage.tsx`（L406）
  - **現状の課題・根拠**:
    - Monaco 既定では `Tab` がインデント挿入に奪われるため、フォーカス脱出方法（`Ctrl+M` / macOS は `Ctrl+Shift+M`）の案内が無い（WCAG 2.1.2 配慮不足）。
    - `monaco.editor.create` に `ariaLabel` が無く、`TaskEditorPage` の複数エディタ（「初期テンプレートコード」「解答例コード」）を SR で区別できない。`loadError`（L265）に `role="alert"` が無い。
  - **具体的な作業内容**: `CodeEditorProps` に `ariaLabel?: string` を追加して `monaco.editor.create(..., { ariaLabel, accessibilitySupport: 'auto' })` を設定し、エディタヘッダまたは `sr-only` に Tab 脱出ショートカット案内を追加、`loadError` に `role="alert"` を付与する。
  - **完了条件**: 各エディタが固有の `ariaLabel` を持ち、Tab 脱出案内が表示／読み上げ可能で、ロードエラーに `role="alert"` が付いていること。

- [x] **A8. 結果テーブルのセマンティクス整備（`scope` / `<caption>` / `aria-sort` / 空 `<th>`）**
  - **優先度**: 中 ／ **推奨フェーズ**: Phase 2 ／ **工数目安**: 小
  - **対象ファイル**: `src/pages/ExamResultsPage.tsx`（L339, L342, L436-447, L566, L644）、`src/pages/PracticeStatsPage.tsx`（L262）、`src/pages/StudentExamFinishedPage.tsx`（L205, L328）
  - **現状の課題・根拠**: 全テーブルで `scope="col"` と `<caption>`（または `aria-label`）が未設定。`ExamResultsPage` は展開ボタン列の `<th>` が空、`SortHeader` の `<th>` に `aria-sort` が無く、行展開ボタンが全員同じ `aria-label="設問別の詳細を開く"` で対象者が判別しづらい。
  - **具体的な作業内容**: 全テーブルヘッダに `scope="col"`、各テーブルに `<caption className="sr-only">...</caption>`、空 `<th>` に `<span className="sr-only">詳細</span>`、`SortHeader` の `<th>` に `aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}`、展開ボタンに `${student.displayName}の設問別の詳細を${expanded ? '閉じる' : '開く'}` を設定する。
  - **完了条件**: 全結果テーブルで `scope="col"`・`<caption>`・`aria-sort`・対象者名入り展開ラベルが正しく出力されること。

- [x] **A9. フォーカスリングの視認性確保（`focus:outline-none` 撤廃）と `prefers-reduced-motion` 対応**
  - **優先度**: 中 ／ **推奨フェーズ**: Phase 2 ／ **工数目安**: 小
  - **対象ファイル**: `src/index.css`（L241-244）、`src/pages/LoginPage.tsx`（L59）、`src/pages/SignupPage.tsx`（L71）、`src/components/PasswordField.tsx`（L38）、`src/components/Skeleton.tsx`（L8）、`src/components/UserDrawer.tsx`（L163）
  - **現状の課題・根拠**:
    - 認証フォームが `focus:outline-none` でブラウザ標準リングを消し 1px 枠線色変化のみで表現（WCAG 2.4.7 / ハイコントラストモードでフォーカス消失）。
    - `src/index.css` にグローバル `:focus-visible` と `prefers-reduced-motion` 定義が無く、`.mp-progress-indeterminate`・`Skeleton`（`animate-pulse`）・`UserDrawer`（`transition-transform`）がモーション軽減設定を無視する。
  - **具体的な作業内容**: `src/index.css` に `:focus-visible { outline: 2px solid var(--mp-cyan); outline-offset: 2px; }` と `@media (prefers-reduced-motion: reduce)` を定義し、認証フォームの `focus:outline-none` を撤廃、`UserDrawer` / `Skeleton` に `motion-reduce:transition-none` / `motion-reduce:animate-none` を付与する。
  - **完了条件**: 全インタラクティブ要素で `:focus-visible` が視認でき、OS のモーション軽減設定有効時にスライド・点滅・不定プログレスのアニメーションが停止／簡略化されること。

- [x] **A10. `HelpPopover` の ARIA 構造改善とタップターゲットサイズ確保（WCAG 2.5.8）**
  - **優先度**: 中 ／ **推奨フェーズ**: Phase 2 ／ **工数目安**: 小
  - **対象ファイル**: `src/components/HelpPopover.tsx`（L40-56）、`src/pages/ExamDetailPage.tsx`（L539-556）、`src/pages/TaskEditorPage.tsx`（L954-971）
  - **現状の課題・根拠**:
    - `HelpPopover` がクリック開閉型に `role="tooltip"` を使用し `aria-controls` 紐付けも無く、Tab で外に出ても閉じない。ボタンも `h-4 w-4`（16×16px）で WCAG 2.2 AA 最小ターゲット 24×24px 未満。
    - `ExamDetailPage` / `TaskEditorPage` の並び替え `▲`/`▼` ボタンも約 12×12px と極小で、`aria-label` に対象名が含まれない。
  - **具体的な作業内容**: `HelpPopover` に `useId()` で `aria-controls` を紐付け、ポップオーバーを `role="region"`（または `aria-describedby` 補足）に変更、`onBlur`（コンテナ外移動）で閉じ Escape 時にトリガーへフォーカス復帰、ボタンサイズを `h-6 w-6`（24×24px）以上へ拡大。並び替え `▲`/`▼` ボタンも `min-h-6 min-w-6` に拡大し `aria-label={`テストケース ${i + 1} を上に移動`}` 等へ具体化する。
  - **完了条件**: 対象ボタンがすべて 24×24px 以上であり、`HelpPopover` がフォーカス離脱・Escape で適切に閉じること。

### 優先度：低

- [ ] **A11. トグルボタン群の `aria-pressed` / `role="group"` 統一と装飾記号の `aria-hidden`**
  - **優先度**: 低 ／ **推奨フェーズ**: Phase 3 ／ **工数目安**: 小
  - **対象ファイル**: `src/pages/ExamResultsPage.tsx`（L247, L307-327, L675）、`src/pages/TaskEditorPage.tsx`（L772-793, L952）、`src/components/ThemeToggle.tsx`（L13）、`src/pages/ExamDetailPage.tsx`（L536）、`src/pages/StudentTaskPage.tsx`（L402）、`src/components/HintPanel.tsx`（L83）
  - **現状の課題・根拠**: `ExamResultsPage`（絞り込み）と `TaskEditorPage`（編集／分割／プレビュー）に `role="group"`・`aria-pressed` が無い。`☀️`/`🌙`・`⠿`・`✎`・`📄`/`📋`・`🤖` 等の装飾記号に `aria-hidden="true"` が無く不要な読み上げが起き、`ThemeToggle` に `aria-label` が無い。
  - **具体的な作業内容**: トグルボタン群に `role="group" aria-label="..."` と `aria-pressed` を付与し、装飾記号を `<span aria-hidden="true">` で囲み、`ThemeToggle` に `aria-label={theme === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}` を追加する。
  - **完了条件**: 全トグルボタン群で押下状態が `aria-pressed` で伝わり、装飾記号が SR 読み上げ対象から除外されていること。

- [ ] **A12. 残存しているネイティブ `window.confirm` の `ConfirmDialog` 化**（関連：`A1`, `T10`）
  - **優先度**: 低 ／ **推奨フェーズ**: Phase 3 ／ **工数目安**: 小〜中
  - **対象ファイル**: `src/pages/StudentTaskPage.tsx`（L270）、`src/pages/PracticeTaskPage.tsx`（L250, L258）（※作問側の `src/components/TestCaseRow.tsx:82`・`src/pages/TaskEditorPage.tsx:324` は `T10` で対応）
  - **現状の課題・根拠**: 生徒画面のコードリセット等でネイティブ `window.confirm` が残存しており、他画面の `ConfirmDialog` と操作感・フォーカス挙動が不統一。
  - **具体的な作業内容**: `A1` でフォーカストラップ・フォーカス復帰・`aria-describedby` 対応を完了した `ConfirmDialog` へ順次置換する。
  - **完了条件**: アプリ全体（`T10` 含む）でネイティブ `window.confirm` が残存せず、すべての確認ダイアログが統一された `ConfirmDialog` で動作すること。

---

## 2. 同時 100 人規模の採点処理設計（`P1`〜`P10`）

学内セルフホストおよび judge のリクエスト単位プロセス分離を維持しつつ、100 人同時ログイン・同時提出・締切一斉確定に耐えるための作業リストです。

### 優先度：高

- [x] **P1. TLE 混入時の judge 60 秒タイムアウトによるリトライ嵐（ポイズンピル問題）解消**
  - **優先度**: 高 ／ **推奨フェーズ**: Phase 1 ／ **工数目安**: 小〜中
  - **対象ファイル**: `server/src/lib/judgeClient.ts`、`server/src/lib/grading.ts`、`judge/Judge.java`（整合確認）
  - **現状の課題・根拠**:
    - `judgeClient.ts` の `JUDGE_REQUEST_TIMEOUT_MS=60000` に対し、Python は 15 秒/件（C/JS/TS は 10 秒/件）、`Judge.java` の `runNodeRunner` 全体上限は `95000 + (perTest+2000)*tests.size()`。
    - **100 人試算**: Python 5 テストケースで無限ループを提出した生徒が 1 人でもいると `15s×5 = 75s > 60s` で `JudgeError(Timeout)` になり、`grading.ts`（`RETRY_DELAY_MS=15000`）が 15 秒ごとに無限リトライする。一方 `Judge.java` は HTTP 切断後も子プロセスを止めず 75 秒以上スロットを占有するため、数人の TLE 提出だけで `JUDGE_MAX_CONCURRENT=2` の全スロットが恒久的に詰まる。
  - **具体的な作業内容**:
    1. `judgeClient.ts` のリクエストタイムアウトを「テストケース数 × 言語別上限 + コンパイル猶予」から動的算出（または上限引き上げ）し、正常な TLE 完了まで HTTP を切断しない。
    2. `grading.ts` のリトライを指数バックオフ＋ジッター（例：5s → 10s → 20s → 60s 上限）＋最大リトライ回数上限へ変更する。
    3. `gradeAttempt` で完了済みタスクの判定結果を保持し、5 問目失敗時に 1〜4 問目を再実行しないようにする。
  - **完了条件**: 5 テストケースすべて TLE となる Python 提出が 1 回で正常に `TLE` 確定してリトライ嵐を起こさないこと、およびリトライ上限・バックオフがユニット／judge テストで検証されていること。

- [x] **P2. 締切一斉時の `maybeSettleAttempt` N+1 重クエリ嵐の解消**
  - **優先度**: 高 ／ **推奨フェーズ**: Phase 1 ／ **工数目安**: 小
  - **対象ファイル**: `server/src/lib/attempts.ts`、`server/src/lib/examResults.ts`
  - **現状の課題・根拠**:
    - `maybeSettleAttempt()` が期限判定や `isServerGraded()` 分岐の**前**に `exam` + 全 `tasks` + 全 `testCases` + 全 `drafts`（コード全文）を Eager JOIN し、さらに `extraMinutesFor()` を発行している（サーバー採点時はこれらを一切使わない）。
    - `getExamResults()` が `IN_PROGRESS` の全受験に対して `for (const a of expired) await maybeSettleAttempt(a.id)` を直列実行している。
    - **100 人試算**: 締切直後に教員が成績画面を開くだけで 100 回の 4 テーブル JOIN ＋ 100 回の `extraMinutesFor`（200 クエリ超）が直列発生し、さらに締切時刻に 100 人のブラウザが `/attempt` と `/result` を叩いて 300 回超の重 JOIN が同時殺到する。
  - **具体的な作業内容**:
    1. `maybeSettleAttempt()` を 2 段階化し、まず `ExamAttempt` 最小カラム＋`exam(timeLimitMinutes, closesAt)`＋`extraMinutes` のみ取得して期限判定。`isServerGraded()` なら即 `beginGrading()` し、レガシー経路時のみ `tasks/testCases/drafts` を取得する。
    2. `examResults.ts` に一括判定関数を導入し、`exam` と `ExamTimeExtension` を 1 回だけ取得して期限超過分のみ並列制限付きで `beginGrading()` する。
  - **完了条件**: 100 人一斉締切時の `getExamResults()` クエリ数が定数＋期限超過分の軽量更新のみに収まり、既存の統合テスト・judge テストが全件パスすること。

- [x] **P3. 教室 NAT 環境でのログイン制限（`LOGIN_MAX_FAILURES_PER_IP=100`）による全員ロックアウト対策**（関連：`P10`）
  - **優先度**: 高 ／ **推奨フェーズ**: Phase 1 ／ **工数目安**: 小
  - **対象ファイル**: `server/src/lib/loginRateLimit.ts`、`server/src/routes/admin.ts`、`src/pages/AdminPage.tsx`、`docs/operations.md`
  - **現状の課題・根拠**:
    - 既定値 `LOGIN_MAX_FAILURES_PER_IP=100` / 15 分では、100 人が同じ教室 NAT IP から 12 文字ランダム初期パスワードで初回ログインすると 1 人平均 1 回の打ち間違いで教室全員が 15 分間 429 ロックアウトされる。
    - `clearLoginFailuresFor()` は `acct:` キーのみ削除し `ip:` キーを解除しないため、サーバー再起動なしに教員が解除する手段が無い。
  - **具体的な作業内容**:
    1. `LOGIN_MAX_FAILURES_PER_IP` の既定値を引き上げ（例：300〜500）、`docs/operations.md` に「教室人数 × 5」の目安を明記する。
    2. `loginRateLimit.ts` に `clearIpRateLimit(ip?)` を追加し、`routes/admin.ts` と `AdminPage.tsx` に IP ロック解除エンドポイント／ボタンを追加する。
  - **完了条件**: 教員が `AdminPage` から IP ロックを即時解除でき、統合テストで解除後に再ログイン可能であることを確認できる。

- [x] **P4. 単一 `judge` コンテナのスループット限界解消とマルチ `judge` プール対応**
  - **優先度**: 高 ／ **推奨フェーズ**: Phase 1 ／ **工数目安**: 中
  - **対象ファイル**: `server/src/lib/judgeClient.ts`、`server/src/lib/executionQueue.ts`、`docker-compose.prod.yml`、`docs/operations.md`
  - **現状の課題・根拠**:
    - `docker-compose.prod.yml` は `judge` 1 台（`JUDGE_CPUS=2.0`, `JUDGE_MEM_LIMIT=1g`, `JUDGE_MAX_CONCURRENT=2`, `pids_limit=512`）、`judgeClient.ts` も単一 `JUDGE_URL` のみ対応。
    - **100 人試算**: 100 人 × 5 問＝500 ジョブ。全員 AC でも 2 コア約 57 秒（4 コア 35 秒）、TLE／重いテストが 1 割混ざると容易に 2〜3 分超え。`1g` メモリは `Judge.java`（`-Xmx256m`）＋Python 2 並列（各 ~300MB）で上限ギリギリで、並列増で OOM-kill や `pids_limit: 512` 超過の危険がある。
  - **具体的な作業内容**:
    1. `judgeClient.ts` でカンマ区切り `JUDGE_URLS`（`JUDGE_URL` 後方互換）に対応し、in-flight 数最小（least-busy）＋ヘルスチェック連動フェイルオーバーで振り分ける（各コンテナ内のリクエスト単位プロセス分離は維持）。
    2. `docker-compose.prod.yml` と `docs/operations.md` に複数 `judge` 構成例およびサイジング目安（`mem_limit = 0.4g * concurrency + 0.5g`、`pids_limit = 256 * concurrency`）を追加する。
  - **完了条件**: 複数 `JUDGE_URLS` 指定時にジョブが分散され、1 台停止時も残りの judge へフェイルオーバーして採点が継続することをテストで確認できる。

- [x] **P5. Prisma コネクションプール既定値不足対策・欠落インデックス追加・セッション短期キャッシュ**
  - **優先度**: 高 ／ **推奨フェーズ**: Phase 1 ／ **工数目安**: 小
  - **対象ファイル**: `server/prisma/schema.prisma`（＋マイグレーション）、`server/src/lib/session.ts`、`server/src/routes/students.ts`、`server/.env.prod.docker.example`、`docs/operations.md`
  - **現状の課題・根拠**:
    - `new PrismaClient()` 既定の `connection_limit = num_cpus * 2 + 1`（2〜4 vCPU で 5〜9 接続）に対し、全認証 API が毎回 `session.findUnique` を発行。100 人ポーリング（50 req/s × 5〜6 クエリ＝250〜300 queries/s）＋採点トランザクション＋締切処理が重なるとプール枯渇（`P2024`）の恐れがある。
    - `ExamAttempt(examId, status)` と `Submission(taskId)`（`regrade` の `where: { taskId }` が全件スキャン）にインデックスが無い。
  - **具体的な作業内容**:
    1. `server/.env.prod.docker.example` と `docs/operations.md` に `DATABASE_URL` の `?connection_limit=25&pool_timeout=20` を明記する。
    2. `schema.prisma` に `ExamAttempt` の `@@index([examId, status])`、`Submission` の `@@index([taskId])` を追加しマイグレーションを作成する。
    3. 単一インスタンス前提を活かし、`session.ts` に極短 TTL（例：5 秒）のインメモリキャッシュを追加し、`revokeSessionByToken` / `force-logout` / `reset-password` 時に即時パージする（認証 DB クエリを約 80% 削減しつつ即時失効を維持）。
  - **完了条件**: マイグレーション適用後にインデックスが存在し、`force-logout` / `reset-password` 時にキャッシュが即時無効化されることを統合テストで確認できる。

### 優先度：中

- [x] **P6. `StudentExamFinishedPage` の 2 秒ポーリング集中緩和・待ち順可視化・SSE 化**（関連：`A4`）
  - **優先度**: 中 ／ **推奨フェーズ**: Phase 2 ／ **工数目安**: 小（短期）／ 中（SSE）
  - **対象ファイル**: `src/pages/StudentExamFinishedPage.tsx`、`server/src/routes/student.ts`、`server/src/lib/grading.ts`
  - **現状の課題・根拠**:
    - `GRADING_POLL_MS = 2000` 固定で 100 クライアント＝50 req/s。`/result` は採点中でも毎回 5 クエリ（session, exam+tasks, inProgress, all attempts, extraAttempts）を発行し 250 queries/s。締切自動遷移で 100 台のタイマーが同期し波状攻撃になり、待ち順が見えないため F5 連打も誘発する。
  - **具体的な作業内容**:
    1. **短期**: `/result` で `inProgress` と `all` の重複クエリを 1 本化し、`grading` 中は `extraAttemptsFor` を省略。`grading.ts` から `queuePosition` / `queueTotal` を返して画面に待ち順を表示。フロントにジッター（±20%）＋バックオフ（2s→3s→5s）＋`document.hidden` 時の一時停止を導入する。
    2. **中期**: `GET /api/student/exams/:examId/result/stream`（SSE）を追加し、`gradeAttempt` 完了イベントで即時プッシュする（定常ポーリング 50 req/s → 0 req/s）。
  - **完了条件**: 採点待ち画面に待ち順が表示され、ポーリング負荷が削減されること（SSE 導入時は完了通知が即時反映され、切断時はポーリングへフォールバックすること）。

- [x] **P7. ログイン・初回パスワード変更ラッシュ時の `scrypt` 最適化と `UV_THREADPOOL_SIZE` 引き上げ**
  - **優先度**: 中 ／ **推奨フェーズ**: Phase 2 ／ **工数目安**: 小
  - **対象ファイル**: `server/Dockerfile`、`docker-compose.prod.yml`、`server/src/routes/auth.ts`（L161-170）、`server/src/routes/students.ts`
  - **現状の課題・根拠**:
    - `scrypt(N=16384, r=8, p=1)` は 1 回 30〜60ms・16MB。`UV_THREADPOOL_SIZE` 未指定（既定 4 スレッド）のため、100 人一斉初回パスワード変更（`verifyPassword` 2 回＋`hashPassword` 1 回＝計 300 回の `scrypt`）で 4〜6 秒以上キューが詰まり、同じ libuv スレッドプールを使う `express.static` や DNS 解決まで遅延する。
  - **具体的な作業内容**:
    1. `server/Dockerfile` / `docker-compose.prod.yml` に `UV_THREADPOOL_SIZE=16`（ホスト CPU 数に応じ 8〜16）を設定する。
    2. `auth.ts` の `/change-password` で `currentPassword === newPassword` を文字列比較で先に弾き、2 回目の `verifyPassword` を削減する（CPU 消費 33% 減）。
    3. `students.ts` の `/bulk` の直列 `for` ループ内 `hashPassword` を並列制限付き（concurrency 4〜8）に改善する。
  - **完了条件**: `/change-password` の既存挙動を維持したまま `scrypt` 呼び出しが 2 回に減り、`/bulk` の 100 人一括登録が並列化されていること。

- [x] **P8. Java プレビュー突発負荷の保護と `regrade` の非同期バックグラウンド化**
  - **優先度**: 中 ／ **推奨フェーズ**: Phase 2 ／ **工数目安**: 中
  - **対象ファイル**: `server/src/lib/executionQueue.ts`、`server/src/routes/tasks.ts`、`server/src/routes/student.ts`、`server/src/routes/practice.ts`
  - **現状の課題・根拠**:
    - `executionQueue.ts` の `interactiveWaiters` は無制限キューかつタイムアウト無し。Java 試験で 30 人同時実行＋数人 TLE で後続が 60 秒超待たされ、ブラウザ切断後もゴーストジョブが実行される。
    - `POST /api/tasks/:taskId/regrade` が 100 件の提出を同期 HTTP レスポンス内で `withJudgeSlot`（interactive 優先）直列実行しており、リバプロ 60 秒タイムアウトの危険＋生徒の Java「実行」をブロックする。
  - **具体的な作業内容**:
    1. `executionQueue.ts` にインタラクティブ待ち上限・待ちタイムアウト（例：20〜30 秒で 429/503 返却）と、クライアント切断時（`req.on('close')` / `AbortSignal`）のキュー離脱を追加する。
    2. `regrade` を `withJudgeCapacity`（background 優先）＋非同期ジョブ化し、進捗／完了をステータス API で確認できるようにする。
  - **完了条件**: クライアント切断時に待機中ジョブがキューから離脱すること、`regrade` 実行中も生徒の Java プレビューが優先実行され HTTP タイムアウトしないこと。

- [x] **P9. 静的アセット配信のキャッシュ・圧縮設定と Pyodide 自前配信オプション整備**（関連：`L9`）
  - **優先度**: 中 ／ **推奨フェーズ**: Phase 2 ／ **工数目安**: 小
  - **対象ファイル**: `server/src/app.ts`、`docs/operations.md`、`docker-compose.prod.yml`（任意オプション）
  - **現状の課題・根拠**:
    - `express.static(CLIENT_DIST_PATH)` が既定オプション（`maxAge: 0`）かつ圧縮無しで、Vite のハッシュ付き `/assets/*` まで毎回 304 再検証が発生する。
    - **100 人試算**: 初回 JS バンドルに加え、C（clang ~106MB×100＝10.6GB）・Python（Pyodide ~10MB×100＝1GB）の外部取得が教室回線を圧迫する。
  - **具体的な作業内容**:
    1. `app.ts` で `/assets` に `maxAge: '1y', immutable: true`、`index.html` に `no-cache` を設定する。
    2. リバースプロキシでの gzip/brotli 有効化、Pyodide の同一オリジン自前配信（`VITE_PYODIDE_BASE_URL`）の Docker 組み込みオプション、および clang 事前キャッシュ運用手順を `docs/operations.md` に整備する。
  - **完了条件**: `/assets/*` に長期 immutable キャッシュヘッダ、`index.html` に `no-cache` が付与されることをテストまたは curl で確認でき、運用手順がドキュメント化されていること。

### 優先度：低

- [ ] **P10. 運用メトリクス可視化（`service-health` 拡張）と負荷テストの現実化**（関連：`P3`）
  - **優先度**: 低 ／ **推奨フェーズ**: Phase 3 ／ **工数目安**: 小〜中
  - **対象ファイル**: `server/src/lib/executionQueue.ts`、`server/src/lib/grading.ts`、`server/src/lib/judgeClient.ts`、`server/src/routes/admin.ts`、`src/pages/AdminPage.tsx`、`server/scripts/loadtest-grading.ts`
  - **現状の課題・根拠**:
    - `GET /api/admin/service-health` は `{ db, judge }` の死活のみで、試験中の採点キュー長・実行中件数・リトライ中件数が見えない。
    - `loadtest-grading.ts` はログイン直列・提出 100% 正常 AC のみで、ログインラッシュ・TLE 混入・教員 `getExamResults()` 並行閲覧・p95/p99 レイテンシを検証できていない。
  - **具体的な作業内容**:
    1. `executionQueue` / `grading` / `judgeClient` からライブ統計（`active`, `interactiveWaiting`, `backgroundWaiting`, `gradingRunning`, `gradingQueued`, `gradingRetrying`, 各 judge URL 状態）を返し、`AdminPage` に表示する。
    2. `loadtest-grading.ts` に「100 人同時ログイン」「TLE/CE/WA 10% 混入」「Java プレビュー 10 並列」「教員 `GET /results` 並行アクセス」シナリオと p50/p95/p99/エラー率レポートを追加する。
  - **完了条件**: `AdminPage` で採点キュー・judge プール状態をリアルタイム確認でき、拡張済み負荷テストで 100 人シナリオの p95/p99 を定量計測できること。

---

## 3. テスト作問作業のサポート（`T1`〜`T12`）

講師の日常作問スピード向上と出題ミス（保存漏れ・期待値誤り・リンク切れ等）の防止に向けた作業リストです。

### 優先度：高

- [x] **T1. `TaskEditorPage` の「すべて保存」ワンクリック化 ＆ `Cmd/Ctrl+S` ショートカット**
  - **優先度**: 高 ／ **推奨フェーズ**: Phase 1 ／ **工数目安**: 中
  - **対象ファイル**: `src/pages/TaskEditorPage.tsx`（L416, L526-533）、`src/components/TestCaseRow.tsx`、`SolutionEditor`
  - **現状の課題・根拠**: 基本情報・テストケース（行ごと）・解答例コードの 3 セクションが独立保存で、sticky バナーは未保存箇所を一覧表示するのみ。各行までスクロールして個別保存する必要があり保存漏れ・手戻りが起きやすい。また `TestCaseRow` が未保存のまま「解答例でテストケースを検証」を押すと DB 保存済みの古いテストケースで検証されてしまう（L416）。
  - **具体的な作業内容**:
    1. sticky 未保存バナー内に **「すべて保存」ボタン** を追加し、`Cmd/Ctrl+S`（Monaco 外／内双方）でも発火させる。
    2. `TestCaseRow` / `SolutionEditor` から `useImperativeHandle` で `save()` を公開する（または未保存ドラフトを親へ集約）し、`Promise.allSettled` で並列保存＋部分失敗も明示する。
    3. 「解答例でテストケースを検証」実行時に未保存テストケースがある場合は注意表示または自動保存オプションを提示する。
  - **完了条件**: 複数セクションを同時編集後に 1 クリックまたは `Cmd/Ctrl+S` で全保存でき、部分失敗時に失敗箇所のみ未保存状態で残ること。

- [x] **T2. 解答例からの期待値一括生成・一括上書き ＆ `SampleDiff` 差分・実行時間（`timeMs`）表示**
  - **優先度**: 高 ／ **推奨フェーズ**: Phase 1 ／ **工数目安**: 小〜中
  - **対象ファイル**: `src/pages/TaskEditorPage.tsx`（`SolutionCheckPanel` L1067-1152、`BulkTestCasePanel`）、`src/components/SampleDiff.tsx`、`src/lib/bulkTestCases.ts`、`server/src/routes/tasks.ts`（L235 参照）
  - **現状の課題・根拠**:
    - `SolutionCheckPanel` の「実際の出力を期待値にする」が行ごとの個別クリックのみで、入力一括追加後や出力形式変更時に件数分クリックが必要。
    - 不一致表示が素の `<pre>` 並列のみで既存の `SampleDiff`（行ハイライト・末尾空白の `·` 可視化・行数差表示）が未活用。
    - `runClientSide` および `POST /api/tasks/:taskId/check-solution` が返す `timeMs` を UI に表示していない。
  - **具体的な作業内容**:
    1. `SolutionCheckPanel` に **「不一致の期待値をすべて上書き（N 件）」** および **「期待値が空のケースのみ反映」** ボタンを追加する。
    2. `BulkTestCasePanel` に「入力のみ一括追加 → 解答例で期待値を自動生成」導線を追加する（`bulkTestCases.ts` は `---` なしを `expectedOutput: ''` として既に受理可能）。
    3. 不一致詳細に `SampleDiff` を再利用し、各行に実行時間（`timeMs`）を表示する（Java の `timeLimitMs` 調整にも活用）。
  - **完了条件**: 入力のみ一括登録した複数テストケースの期待値を解答例実行から一括反映でき、不一致箇所が `SampleDiff` と `timeMs` 付きで表示されること。

- [x] **T3. 試験全体の「全問題の解答例を一括検証」＆ `publish-check` 強化**
  - **優先度**: 高 ／ **推奨フェーズ**: Phase 1 ／ **工数目安**: 中
  - **対象ファイル**: `server/src/routes/exams.ts`（L236-316）、`src/pages/ExamDetailPage.tsx`、`src/api/exams.ts`
  - **現状の課題・根拠**:
    - `ExamDetailPage` から全問題の解答例が通るか一括確認する手段が無く、1 問ずつ開いて検証する必要がある。
    - `GET /api/exams/:examId/publish-check` は `solutions` を取得しておらず、解答例未登録・問題文空欄・重複入力テストケース・問題文内 `/uploads/...` の画像リンク切れ（他サーバーからの JSON インポート時等）を検知できない。返却に `taskId` が無く指摘箇所から直接飛べない。
  - **具体的な作業内容**:
    1. `publish-check` を拡張：① `solutions` を `include` し `task.language` の解答例未登録を `warn`、② `statementMarkdown.trim() === ''` を `warn`、③ 同一タスク内の重複 `input` を `warn`、④ `/uploads/<file>` の `UPLOADS_DIR` 実在チェック（不在時は `error` または `warn`）、⑤ 各 issue に `taskId?: string` を付与し `ExamDetailPage` から該当問題編集画面へ直接リンクする。
    2. 新規 `GET /api/exams/:examId/verification-bundle` で全問題の `testCases`＋該当言語の `solution` を一括取得し、`ExamDetailPage` に **「全問題の解答例を一括検証」** ボタンを追加（C/JS/TS/Python はブラウザ `runClientSide`、Java は `check-solution` で順次検証し問題ごとの AC/WA/CE/未登録・最大実行時間を一覧表示）。
  - **完了条件**: 拡張した `publish-check` の全検査項目が統合テストで検証され、`ExamDetailPage` から全問題の解答例検証結果と問題編集リンクを確認できること。

- [x] **T4. 下書き（DRAFT）状態のまま使える「生徒画面プレビュー」導線**
  - **優先度**: 高 ／ **推奨フェーズ**: Phase 2 ／ **工数目安**: 中
  - **対象ファイル**: `src/pages/TaskEditorPage.tsx`、`src/pages/ExamDetailPage.tsx`、`src/App.tsx`、新規プレビュー用モーダルまたは `src/pages/TeacherTaskPreviewPage.tsx`、`docs/teacher-guide.md`（L282 更新）
  - **現状の課題・根拠**: 現状は講師が手動で `/student/...` を開く必要があり、`student.ts` / `practice.ts` が `status: 'PUBLISHED'` でフィルタしているため **DRAFT 状態の試験は生徒画面でプレビューできない**。また試験モードで誤って最終提出すると講師自身の受験記録が残る。
  - **具体的な作業内容**: `TaskEditorPage` / `ExamDetailPage` に **「生徒画面プレビュー」** ボタンを追加し、既存の `TaskDetail` をそのまま渡す読み取り専用モーダル（または `/teacher/exams/:examId/tasks/:taskId/preview` ルート）で、`StudentTaskPage` 相当のレイアウト（問題文 Markdown＋サンプル一覧＋初期テンプレート入り Monaco＋お試し実行）を DB への受験記録を一切作らずに確認可能にする。
  - **完了条件**: DRAFT 状態の試験・問題で生徒画面相当のレイアウトとコードお試し実行が動作し、`ExamAttempt` / `Submission` レコードが一切作成されないこと。

- [x] **T5. Markdown エディタでのクリップボード画像貼り付け（`onPaste`）・ドラッグ＆ドロップ対応・サンプル挿入**
  - **優先度**: 高 ／ **推奨フェーズ**: Phase 1 ／ **工数目安**: 小
  - **対象ファイル**: `src/pages/TaskEditorPage.tsx`（L758-824）
  - **現状の課題・根拠**: スクリーンショットや図をコピーして問題文 `<textarea>` に直接ペースト・ドロップできず、毎回ファイル保存→「画像を挿入」が必要。
  - **具体的な作業内容**: `statementMarkdown` の `<textarea>` に `onPaste`（`clipboardData.items` から `image/*` 抽出）と `onDrop` を追加し、既存の `handleInsertImage(file)`（`POST /api/uploads`）を呼び出す。併せて「サンプルテストケースを Markdown の入出力例として挿入」ボタンを配置する。
  - **完了条件**: クリップボードからの画像貼り付けおよびドラッグ＆ドロップで `/uploads/...` へアップロードされてカーソル位置へ Markdown 画像構文が挿入され、サンプル挿入ボタンでサンプル入出力が整形挿入されること。

### 優先度：中

- [x] **T6. 試験単位のポータブル JSON エクスポート／インポート**
  - **優先度**: 中 ／ **推奨フェーズ**: Phase 2 ／ **工数目安**: 中
  - **対象ファイル**: `server/src/lib/taskPortable.ts`（L7-9 参照）、`server/src/routes/exams.ts`、`src/pages/ExamDetailPage.tsx`、`src/pages/TeacherDashboard.tsx`
  - **現状の課題・根拠**: `wasm-exam-task/v1` は単一問題単位のみで、別サーバー・別年度環境へ試験一式を移行するには 1 問ずつエクスポート→インポートする必要がある。
  - **具体的な作業内容**: `GET /api/exams/:examId/export`（試験メタデータ＋全問題配列、`wasm-exam/v1` 形式）と `POST /api/exams/import`（常に `DRAFT`・スケジュール未設定で新規試験作成、`isPublic: false`）を追加。`ExamDetailPage` に「試験をエクスポート」、`TeacherDashboard` に「JSON から試験をインポート」を配置し、`/uploads/` 画像参照がある場合は注意メッセージを表示する。
  - **完了条件**: 試験のエクスポート→別試験としてのインポートで全問題・テストケース・解答例が復元され、常に `DRAFT` で作成されることを統合テストで確認できる。

- [x] **T7. `TaskBankPicker` の強化（問題文プレビュー・複数選択一括追加・検索／タグ補完／ソート改善）**
  - **優先度**: 中 ／ **推奨フェーズ**: Phase 2 ／ **工数目安**: 中
  - **対象ファイル**: `src/components/TaskBankPicker.tsx`、`server/src/routes/taskBank.ts`（L43）、`src/api/taskBank.ts`
  - **現状の課題・根拠**: 一覧から問題文・コードを確認せずに追加するしかなく、追加も 1 問ずつ。検索 `q` が `title` のみで `statementMarkdown` を対象外としており、既存の `GET /api/task-bank/tags` も未接続、ソート不可。
  - **具体的な作業内容**:
    1. 各行に「プレビュー」トグルを追加し、展開時に `GET /api/tasks/:taskId` で問題文 Markdown・サンプル・初期テンプレートを表示する。
    2. チェックボックス複数選択＋「選択した N 件をまとめて追加」ボタンを追加する（`reloadTasksQuietly()` 維持）。
    3. `taskBank.ts` の `q` 検索に `statementMarkdown` を含め、タグ入力に `GET /api/task-bank/tags` 連動の `<datalist>` 補完とソート（新着順／タイトル順／配点順）を追加する。
  - **完了条件**: モーダルを閉じずにプレビュー確認・複数件一括追加・本文キーワード検索・タグ補完・並び替えが動作すること。

- [x] **T8. テストケース一括インポートの拡充（CSV/TSV/JSON 対応・追加前プレビュー）＆ エクスポート**
  - **優先度**: 中 ／ **推奨フェーズ**: Phase 2 ／ **工数目安**: 小〜中
  - **対象ファイル**: `src/pages/TaskEditorPage.tsx`（`BulkTestCasePanel` L1026-1065）、`src/lib/bulkTestCases.ts`、`src/lib/bulkTestCases.test.ts`
  - **現状の課題・根拠**: 独自書式（`===` / `---` / `@sample`）のみで追加前パースプレビューが無く、テストケース単体のエクスポートも無い。
  - **具体的な作業内容**: 入力欄下にリアルタイムのパース結果プレビュー（`N 件を認識（うちサンプル M 件）`＋先頭数件の表表示）を追加。CSV / TSV（スプレッドシート貼り付け：`input,expectedOutput,isSample`）および JSON 形式のタブ／自動判定と、既存テストケースの同形式エクスポートボタンを追加する。
  - **完了条件**: 独自書式・CSV/TSV・JSON のパーサおよびエクスポートがユニットテストでカバーされ、UI 上で登録前に認識件数と内容を確認できること。

- [x] **T9. `ExamDetailPage` 問題一覧の情報充実 ＆ 合計配点表示**
  - **優先度**: 中 ／ **推奨フェーズ**: Phase 2 ／ **工数目安**: 小
  - **対象ファイル**: `server/src/routes/exams.ts`（L324）、`src/pages/ExamDetailPage.tsx`、`src/types/exam.ts`
  - **現状の課題・根拠**: `GET /api/exams/:examId` が `{ id, order, title, points }` のみ返却しており、問題一覧で言語・テストケース数・解答例有無・試験全体の合計配点が分からない。
  - **具体的な作業内容**: `GET /api/exams/:examId` の select に `language` と `_count: { select: { testCases: true, solutions: true } }` を追加し、`ExamDetailPage` に合計配点（例：`合計 100 点`）および各問題行に言語バッジ・テスト件数・解答例登録済みバッジを表示する。
  - **完了条件**: `ExamDetailPage` 上で試験合計配点と各問題の言語・テスト件数・解答例有無が一覧確認できること。

- [x] **T10. テストケース行の操作性向上（複製・折りたたみ・バッジ・`ConfirmDialog` 統一・誤記修正）**（関連：`A1`, `A12`）
  - **優先度**: 中 ／ **推奨フェーズ**: Phase 2 ／ **工数目安**: 小
  - **対象ファイル**: `src/components/TestCaseRow.tsx`（L82, L152）、`src/pages/TaskEditorPage.tsx`（L324）
  - **現状の課題・根拠**: テストケースの複製ボタン・折りたたみが無く件数増加で縦長になる。削除確認（`TestCaseRow.tsx:82`）と再採点確認（`TaskEditorPage.tsx:324`）が `window.confirm` のまま。また `TestCaseRow.tsx:152` の説明文が「Java・C（再採点）にのみ適用されます」と実態（Java のみ）とズレている。
  - **具体的な作業内容**: 各 `TestCaseRow` ヘッダに「サンプル／非公開」バッジ・折りたたみトグル・「このケースを複製」ボタンを追加し、2 箇所の `window.confirm` を `ConfirmDialog` に統一、L152 の文言を「Java にのみ適用されます」へ修正する。
  - **完了条件**: テストケースの複製・折りたたみ・バッジ表示が動作し、作問画面に `window.confirm` が残らず、説明文の誤記が修正されていること。

### 優先度：低

- [ ] **T11. 初学者向けプログラミング問題の定型テンプレート（非 AI・即時利用）**
  - **優先度**: 低 ／ **推奨フェーズ**: Phase 3 ／ **工数目安**: 小
  - **対象ファイル**: `src/pages/TaskEditorPage.tsx`、新規 `src/lib/taskTemplates.ts`
  - **現状の課題・根拠**: 新規問題作成時は空の問題文＋最小スケルトンのみ。AI 作問サポートは WebGPU＋約 2.5GB モデルのオプトインが必要で、誰でも即座には使えない。
  - **具体的な作業内容**: 問題文が空のとき（または「テンプレートから作成」メニュー）に、初学者向け定番パターン（単一入力と計算／N 個の整数配列／条件分岐／文字列処理／浮動小数点計算）の定型セット（Markdown 骨子【問題】【入力形式】【出力形式】【制約】＋言語別入力読み取り済み `starterCode`＋境界値テスト入力ひな形）を即時挿入できるようにする。
  - **完了条件**: 5 言語それぞれで定型テンプレートを 1 クリック挿入でき、AI 未有効環境でも即座に作問を開始できること。

- [ ] **T12. 初期テンプレート ⇔ 解答例コードのクイックコピー ＆ 境界値チェックリスト**
  - **優先度**: 低 ／ **推奨フェーズ**: Phase 3 ／ **工数目安**: 小
  - **対象ファイル**: `src/pages/TaskEditorPage.tsx`（`SolutionEditor`、テストケース追加エリア）
  - **現状の課題・根拠**: `SolutionEditor` が初期状態で空のため毎回 `starterCode` を手動コピペする必要がある。境界値テストの抜け漏れ防止ガイドも無い。
  - **具体的な作業内容**: `SolutionEditor` に「初期テンプレートをコピー」ボタン（既存コードがある場合は確認付き）を追加し、テストケース追加エリアに「境界値チェックリスト / ひな形挿入」（0・負数・最小/最大値・単一要素等）を軽量なポップオーバーで提供する。
  - **完了条件**: 1 クリックで `starterCode` を解答例へコピーでき、境界値チェックリストから代表的な境界入力を確認・挿入できること。

---

## 4. ブラウザ内 LLM（WebLLM）の活用拡大（`L1`〜`L10`）

全項目で `React.lazy` 分離・非公開テスト期待値の秘匿・`EXAM` モードでの AI 完全無効・個人情報の学内/ローカル完結・3B/7B モデル限界の実機検証ルールを遵守します。

### 4-1. 基盤・UX（モデル選択・ランタイム管理・対話体験）

- [x] **L1. 共有エンジンマネージャへの分離とアイドル解放・ストリーミング・中断対応**
  - **優先度**: 高 ／ **推奨フェーズ**: Phase 1 ／ **工数目安**: 中
  - **対象ファイル**: 新規 `src/ai/webllmEngine.ts`、新規 `src/ai/aiRuntimeSettings.ts`、`src/ai/aiAssist.ts`（L63, L167）、`src/ai/aiHint.ts`（L2, L98）、`src/components/AiAssistSettings.tsx`、`src/components/AiHintSettings.tsx`、`src/components/HintPanel.tsx`、`src/components/AiAssistPanel.tsx`
  - **現状の課題・根拠**:
    - `aiHint.ts` が講師向け `aiAssist.ts` の `loadAiAssistModel` を直接 import しておりエンジン管理と作問ロジックが密結合。
    - 非ストリーミングかつ `engine.interruptGenerate()` 未対応で生成中の数十秒間中断不可。
    - 一度ロードしたエンジン（~2.5GB VRAM）を自動解放する仕組みが無く、タブを閉じるまで GPU メモリを占有し続ける。
  - **具体的な作業内容**:
    1. `src/ai/webllmEngine.ts`（モデルロード・キャッシュ操作・進捗購読・アイドルタイムアウトでの自動 `engine.unload()`・`visibilitychange`/`pagehide` 解放）と依存ゼロの `src/ai/aiRuntimeSettings.ts` に分離する。`AiAssistSettings` / `AiHintSettings` の重複（各 ~140 行）を共通コンポーネント化する（ロール別オプトインキーは現行どおり分離維持）。
    2. テキスト出力系（ヒント・解説・レビュー・分析）を `stream: true` で逐次描画し、「中断」ボタンから `engine.interruptGenerate()` を呼ぶ。
    3. `webllmEngine.ts` は既存の `React.lazy` 境界からのみ import し、メインバンドル汚染ゼロを維持する。
  - **完了条件**: ビルド出力のメインチャンクに `@mlc-ai/web-llm` が含まれないこと、生成のストリーミング表示・途中中断・アイドル自動アンロードが動作すること。

- [x] **L2. 段階的モデルプリセット選択（1.5B / 3B / 7B）＋ WebGPU・空き容量・キャッシュ診断**
  - **優先度**: 高 ／ **推奨フェーズ**: Phase 1 ／ **工数目安**: 中
  - **対象ファイル**: `src/ai/webllmEngine.ts`、`src/ai/aiRuntimeSettings.ts`、`src/ai/aiAssist.ts`（L17, L19-21）、`src/components/AiAssistSettings.tsx`（L112-115）、`src/components/AiHintSettings.tsx`（L112-115）
  - **現状の課題・根拠**:
    - `Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC`（~2.5GB）に固定だが、`@mlc-ai/web-llm@0.2.85` の `prebuiltAppConfig` には `1.5B`（~1.6GB）/ `3B`（~2.5GB）/ `7B`（~5.1GB）および `shader-f16` 非対応 GPU 向け `q4f32_1` が同梱されている。
    - `isWebGpuSupported()` が `'gpu' in navigator` のみ確認しており、実アダプタ有無・`shader-f16`・`maxStorageBufferBindingSize`・空き容量（`quota - usage`）を事前診断できない。`hasModelInCache(modelId)` 未使用でモデル取得済み判定も不正確。
  - **具体的な作業内容**:
    1. `SettingsPage` に 3 段階プリセットを追加（軽量：`1.5B` 生徒ノート PC 向け／標準：`3B` 既定／高精度：`7B` 講師 PC 向け）。`adapter.features.has('shader-f16')` が偽の場合は自動で `q4f32_1` バリアントへフォールバックする。
    2. 事前診断パネルで WebGPU アダプタ・`shader-f16`・`navigator.storage.estimate()` の空き容量・`hasModelInCache()` によるモデル別キャッシュ状況を表示し、モデル切替時に旧キャッシュ削除を選択可能にする。
    3. **実機検証タスク**: 7B モデルでヒント 3 の答え漏れ（`docs/roadmap.md` 記載の 3B 限界）が改善するかは、実機モデルで同一バグを検証するまで「改善済み」と断定しない。
  - **完了条件**: 3 プリセットの選択・`shader-f16` 自動フォールバック・空き容量／モデル別キャッシュ有無表示が `SettingsPage` で正しく動作すること。

### 4-2. 講師向け活用（作問・品質向上・授業振り返り支援）

- [x] **L3. 既存問題の強化モード（エッジケース入力追加・問題文の曖昧さチェック・スターターコード生成）＆ プレビュー改善**
  - **優先度**: 高 ／ **推奨フェーズ**: Phase 2 ／ **工数目安**: 中
  - **対象ファイル**: `src/components/AiAssistPanel.tsx`（L224-233）、`src/pages/TaskEditorPage.tsx`（L738-745）、`src/ai/aiAssist.ts`
  - **現状の課題・根拠**: 現状は「白紙からの一括下書き生成」のみで既存の問題文・テストケース・解答例を受け取れない。またプレビューが問題文とテスト件数のみで、コードや各テスト入出力を確認せず即 `bulkCreateTestCases` 永続化されてしまう。
  - **具体的な作業内容**:
    1. `AiAssistPanel` をタブ／モード切替式に拡張し、現在の `statementMarkdown` / `testCases` / `solutionCode` を渡せるようにする：
       - **エッジケース入力の追加生成**: 未カバーの境界値入力のみ生成 → 既存解答例を `runClientSide` / `check-solution` で実実行して期待値を自動確定（**LLM に期待値を書かせない原則厳守**）→ チェックボックスで選んだケースのみ追加。
       - **問題文の曖昧さ・仕様漏れチェック**: 問題文・テストケース・`comparisonMode` を突合し、入力範囲未記載・出力形式の曖昧さ・仕様矛盾を箇条書き指摘（自動上書きはしない）。
       - **解答例からスターターコード生成**: 登録済み `solutionCode` から解答本体を抜いた `starterCode` 骨組みを生成。
    2. プレビュー画面でテストケース一覧（入力＋検証済み期待出力）とコードを確認・個別選択してから反映できるようにする。
  - **完了条件**: 既存問題に対して 3 モードが動作し、エッジケースの期待値が必ず実実行から生成され、選択したケースのみ反映されること。

- [ ] **L4. 試験・演習のつまずき傾向サマリー（100% ブラウザ内・個人情報保護）**
  - **優先度**: 高 ／ **推奨フェーズ**: Phase 3 ／ **工数目安**: 中
  - **対象ファイル**: `server/src/routes/exams.ts`（または新規ルート）、`src/pages/ExamResultsPage.tsx`、`src/pages/PracticeStatsPage.tsx`、新規 `src/ai/aiErrorSummary.ts`、新規 lazy パネル `src/components/ErrorSummaryPanel.tsx`
  - **現状の課題・根拠**: 成績／演習状況画面では正答率バーと個別提出閲覧のみで、クラス全体の誤答・コンパイルエラー傾向を把握するには 1 人ずつ展開が必要。外部 LLM API 送信は学内インフラ制約に反する。
  - **具体的な作業内容**:
    1. 講師専用（`requireRole('TEACHER')`）の匿名化取得エンドポイント `GET /api/exams/:examId/tasks/:taskId/error-samples` を追加（`studentId`/`studentNumber`/`displayName` を一切含めず、非 AC 提出から最大 15〜20 件の `{ status, code, failingTestHints }` のみ返却）。
    2. `ExamResultsPage` / `PracticeStatsPage` の問題別行に `isAiAssistEnabled()` 時のみ「つまずき傾向を分析」ボタンを配置（`React.lazy`）。クライアント側でコード切り詰め＋正規化ハッシュによる重複クラスタリング後に WebLLM へ渡し、「よくある誤答パターン上位 3〜5 件」「次回講義の補足ポイント」を要約する。
  - **完了条件**: API レスポンスに個人識別情報が一切含まれないことを統合テストで保証し、ブラウザ内完結で要約が出力されること。

- [ ] **L5. 類題・バリエーション生成（再試験・別クラス向け）**
  - **優先度**: 中 ／ **推奨フェーズ**: Phase 3 ／ **工数目安**: 小〜中
  - **対象ファイル**: `src/components/AiAssistPanel.tsx`、`src/ai/aiAssist.ts`
  - **現状の課題・根拠**: 再試験や別クラス出題では複製後に手作業で題材・条件・数値を書き換えている。
  - **具体的な作業内容**: `AiAssistPanel` に「この問題から類題を作成」モードを追加。現在の問題文・解答例・言語をもとに、アルゴリズム・難易度を保ったまま題材・条件・入出力形式を変えた新下書き＋テスト入力を生成し、生成解答例の実実行で期待値を検証する。既存問題の上書き事故を防ぐため、複製後の新規問題編集画面での利用を推奨導線にする。
  - **完了条件**: 既存問題から類題ドラフトと実実行検証済みテストケースを生成・プレビュー確認後に反映できること。

### 4-3. 生徒向け活用（演習モード `PRACTICE` 限定）

- [x] **L6. エラーメッセージのかみ砕き解説（CE / RE 翻訳）**
  - **優先度**: 高 ／ **推奨フェーズ**: Phase 2 ／ **工数目安**: 小
  - **対象ファイル**: `src/pages/PracticeTaskPage.tsx`、`src/ai/aiHintContext.ts`、`src/ai/aiHintContext.test.ts`、`src/ai/aiHint.ts`、`src/components/HintPanel.tsx`
  - **現状の課題・根拠**: `aiHintContext.ts`（L41-47）では `CE` 時の `compileStderr` がステージ 2 まで隠されており、clang / javac / Python traceback の英語エラーの意味が分からない初学者でもいきなり「疑わしい箇所（ヒント 2）」を開かざるを得ない。一方、エラー文自体の日本語解説は 3B モデルの答え漏れリスクが構造的に極めて低い。
  - **具体的な作業内容**:
    1. `PracticeTaskPage` の `verdict?.overallStatus === 'CE'`（およびサンプルの `RE`）表示直下に、`task.aiHintEnabled && aiHintOptedIn` 時のみ「エラーの意味を解説」ボタンを配置（`HintPanel` と同じ `React.lazy` チャンク内）。
    2. 純粋関数 `buildErrorExplainContext` を `aiHintContext.ts` に追加し、**問題文・非公開テストは一切渡さず** `language`・`compileStderr`（またはサンプル RE 情報）・該当行周辺コード（前後数行）のみを渡す。`NO_CODE_RULE` + `looksLikeCode` を適用する。
    3. `StudentTaskPage.tsx`（`EXAM` モード）には一切追加しない。
  - **完了条件**: `aiHintContext.test.ts` で問題文・非公開テストが含まれないことを検証し、`PRACTICE` モードのみでストリーミング解説が動作すること。

- [x] **L7. AC 後のコードレビュー（ネタバレリスク 0 の学習支援）**
  - **優先度**: 高 ／ **推奨フェーズ**: Phase 2 ／ **工数目安**: 小
  - **対象ファイル**: `src/pages/PracticeTaskPage.tsx`、`src/components/HintPanel.tsx`（L46, L84）、`src/ai/aiHintContext.ts`、`src/ai/aiHintContext.test.ts`、`src/ai/aiHint.ts`
  - **現状の課題・根拠**: `HintPanel` は `verdict.overallStatus !== 'AC'` のときしか機能せず、AC を取った瞬間に役割を終える。AC 後なら答え漏れリスクがゼロであり、3B モデルでも安全かつ教育効果が高い（可読性・変数名・冗長な分岐・計算量・境界条件の気づき）。
  - **具体的な作業内容**:
    1. `PracticeTaskPage` で `verdict?.overallStatus === 'AC'` かつ `task.aiHintEnabled && aiHintOptedIn` のときに「コードを振り返る（AC 後レビュー）」ボタンを表示する（同 lazy チャンク内）。
    2. 純粋関数 `buildPostAcReviewContext` に `language`・`statementMarkdown`・生徒の AC コードのみを渡し（非公開テスト入出力は一切渡さないことを `aiHintContext.test.ts` で保証）、「良い点 1 つ」「改善のヒント 1〜2 点」をストリーミング出力する。
  - **完了条件**: 非公開テスト秘匿テストがパスし、`PRACTICE` モードの AC 後にのみコードレビューが実行できること。

- [ ] **L8. 解放済みヒントに対する 1 問 1 答フォローアップ質問 ＋ 5 言語対応 `looksLikeCode` 強化**
  - **優先度**: 中 ／ **推奨フェーズ**: Phase 3 ／ **工数目安**: 小〜中
  - **対象ファイル**: `src/components/HintPanel.tsx`、`src/ai/aiHintContext.ts`（L79-80）、`src/ai/aiHintContext.test.ts`、`src/ai/aiHint.ts`
  - **現状の課題・根拠**:
    - `HintPanel` は一方通行の 3 段階表示のみで、ヒント文中の専門用語（「オフバイワン」「整数除算」等）を聞き返せない。
    - `looksLikeCode` の正規表現が C 言語寄り（`for(`, `scanf`, `printf`, `{};` 等）で、Python（`def `, `range(`, `print(`, `elif`, `input(`）・JS/TS（`const `, `let `, `console.log`, `=>`）・Java（`System.out`, `Scanner`）のコード漏れをすり抜ける恐れがある。
  - **具体的な作業内容**:
    1. 解放済みヒントカード下に「このヒントについて質問する（最大 2 往復・100 文字以内）」入力欄を設け、直近解放済みステージと同じ `buildStageContext(stage, ctx)` の制約下で回答生成する。
    2. `looksLikeCode(text, language?)` を 5 言語（C / Java / JS / TS / Python）対応へ拡張し、`aiHintContext.test.ts` に全言語テストを追加する。
  - **完了条件**: 5 言語すべてのコード片が `looksLikeCode` で検知されるユニットテストが通り、フォローアップ質問が解放済みステージのコンテキスト制約と最大 2 往復制限を守ること。

### 4-4. 運用・配信（CSP・学内ミラー・構造化出力の信頼性）

- [x] **L9. CSP `enforce` 実機検証と学内モデルミラー設定（`VITE_WEBLLM_MODEL_BASE_URL`）**（関連：`P9`）
  - **優先度**: 高 ／ **推奨フェーズ**: Phase 1 ／ **工数目安**: 小〜中
  - **対象ファイル**: `src/ai/webllmEngine.ts`、`server/src/lib/csp.ts`（L21-23）、`docs/operations.md`（L156）、`docs/roadmap.md`（L12）
  - **現状の課題・根拠**:
    - `CSP_MODE=enforce` 下での WebLLM 実機動作（Hugging Face リダイレクト先・XetHub/LFS ドメイン・WebGPU wasm ロード等）および AI 作問の Java → judge `check-solution` 経路が実機未確認。
    - 授業で 40 人が同時に 2.5GB モデルを Hugging Face から取得すると学内回線に ~100GB の負荷がかかる。Pyodide には `VITE_PYODIDE_BASE_URL` の学内ミラー仕組みがあるが WebLLM は未対応。
  - **具体的な作業内容**:
    1. `webllmEngine.ts` でビルド時環境変数 `VITE_WEBLLM_MODEL_BASE_URL` / `VITE_WEBLLM_WASM_BASE_URL` をサポートし、設定時は `prebuiltAppConfig.model_list` の URL を学内ミラーへ書き換えたカスタム `AppConfig` を渡す。
    2. `docs/operations.md` に学内ミラー用 Nginx の CORS + `Cross-Origin-Resource-Policy: cross-origin`（COEP `require-corp` 対応）設定例を追記する。
    3. `CSP_MODE=enforce` 下で Chrome / Edge 実機検証を行い、不足オリジンがあれば `server/src/lib/csp.ts` を更新（あわせて Java `check-solution` 経路も実機確認し `docs/roadmap.md` の該当項目をクローズ）。
  - **完了条件**: `CSP_MODE=enforce` 環境で CSP 違反ゼロのまま WebLLM モデル取得・推論および AI 作問の Java 期待値検証が動作し、学内ミラー設定手順が整備されていること。

- [ ] **L10. 構造化出力の信頼性向上と解答例コンパイル失敗時の自動リカバリ**
  - **優先度**: 中 ／ **推奨フェーズ**: Phase 3 ／ **工数目安**: 小
  - **対象ファイル**: `src/ai/aiAssist.ts`（L167-186）、`src/components/AiAssistPanel.tsx`（L115-119）、新規 `src/ai/structuredJson.ts`
  - **現状の課題・根拠**: `generateTaskDraft` は `max_tokens` 未設定で長文暴走リスクがあり、JSON パース失敗や解答例コンパイル失敗時に即エラー終了してユーザーに最初からやり直させている。
  - **具体的な作業内容**: 共通の構造化出力ヘルパー `requestStructuredJson<T>` を用意し、用途別の `max_tokens` 上限・コードフェンス除去フォールバック・スキーマ検証失敗時の 1 回自動リトライを実装する。また作問生成で解答例が `compileFailed` になった場合、最大 1 回だけ `compileStderr` をモデルへ返して解答例のみ自動修正させる。
  - **完了条件**: コードフェンス混入 JSON や一時的な構文エラーに対して 1 回自動リカバリが働き、再失敗時は従来どおり明確なエラーが表示されること。
