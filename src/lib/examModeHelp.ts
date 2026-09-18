// Shared caution copy for the exam "モード" setting (EXAM vs PRACTICE) — used
// by both TeacherDashboard.tsx's create form and ExamDetailPage.tsx's edit
// form, kept in one place so the two don't drift apart.
export const EXAM_MODE_HELP_TEXT =
  '演習モードは、テストではなく学習支援のためのモードです。制限時間・受験可能回数・公開スケジュールは使われず、公開すると対象の生徒はいつでも何度でも実行・提出できます。時間や回数で成績を管理したい試験には使わないでください。' +
  '\n\n演習モードには「成績を見る」ダッシュボードがありません（無制限に提出できるため、試験のような1回の点数という概念がないためです）。提出履歴は生徒自身の画面にのみ表示されます。' +
  '\n\nAIヒント機能（問題ごとに設定）も演習モードの問題でのみ有効になります。';
