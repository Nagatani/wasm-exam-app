import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route } from './lib/router';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { RoleHome } from './pages/RoleHome';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { PageSkeleton } from './components/Skeleton';

// Route-level code splitting: only the login/signup/password pages and the
// role dispatcher ship in the entry chunk; every other page (and what it
// pulls in — Markdown rendering, the runners, the teacher editors) is fetched
// when first visited. Keeps the first load light for a whole class logging in
// at once, and keeps teacher-only code out of students' downloads.
const StudentDashboard = lazy(() => import('./pages/StudentDashboard').then((m) => ({ default: m.StudentDashboard })));
const TeacherDashboard = lazy(() => import('./pages/TeacherDashboard').then((m) => ({ default: m.TeacherDashboard })));
const ExamDetailPage = lazy(() => import('./pages/ExamDetailPage').then((m) => ({ default: m.ExamDetailPage })));
const TaskEditorPage = lazy(() => import('./pages/TaskEditorPage').then((m) => ({ default: m.TaskEditorPage })));
const TaskPreviewPage = lazy(() => import('./pages/TaskPreviewPage').then((m) => ({ default: m.TaskPreviewPage })));
const SandboxPage = lazy(() => import('./pages/SandboxPage').then((m) => ({ default: m.SandboxPage })));
const StudentTaskPage = lazy(() => import('./pages/StudentTaskPage').then((m) => ({ default: m.StudentTaskPage })));
const StudentExamFinishedPage = lazy(() => import('./pages/StudentExamFinishedPage').then((m) => ({ default: m.StudentExamFinishedPage })));
const PracticeSetPage = lazy(() => import('./pages/PracticeSetPage').then((m) => ({ default: m.PracticeSetPage })));
const PracticeTaskPage = lazy(() => import('./pages/PracticeTaskPage').then((m) => ({ default: m.PracticeTaskPage })));
const ExamResultsPage = lazy(() => import('./pages/ExamResultsPage').then((m) => ({ default: m.ExamResultsPage })));
const CoursesPage = lazy(() => import('./pages/CoursesPage').then((m) => ({ default: m.CoursesPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const PracticeStatsPage = lazy(() => import('./pages/PracticeStatsPage').then((m) => ({ default: m.PracticeStatsPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));

function MainLandmark({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" tabIndex={-1} className="outline-none">
      {children}
    </main>
  );
}

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<PageSkeleton />}>
          <Routes>
          <Route
            path="/login"
            title="ログイン"
            element={
              <MainLandmark>
                <LoginPage />
              </MainLandmark>
            }
          />
          <Route
            path="/signup"
            title="新規登録"
            element={
              <MainLandmark>
                <SignupPage />
              </MainLandmark>
            }
          />
          <Route
            path="/change-password"
            title="パスワードの変更"
            element={
              <ProtectedRoute allowPasswordChangePending>
                <MainLandmark>
                  <ChangePasswordPage />
                </MainLandmark>
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            title="設定"
            element={
              <ProtectedRoute>
                <MainLandmark>
                  <SettingsPage />
                </MainLandmark>
              </ProtectedRoute>
            }
          />
          <Route
            path="/"
            title="ホーム"
            element={
              <ProtectedRoute>
                <MainLandmark>
                  <RoleHome />
                </MainLandmark>
              </ProtectedRoute>
            }
          />
          <Route
            path="/student"
            title="生徒ダッシュボード"
            element={
              <ProtectedRoute role="STUDENT">
                <MainLandmark>
                  <StudentDashboard />
                </MainLandmark>
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/exams/:examId/tasks/:taskId"
            title="試験問題"
            element={
              <ProtectedRoute role="STUDENT">
                <StudentTaskPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/exams/:examId/finished"
            title="試験結果・提出確認"
            element={
              <ProtectedRoute role="STUDENT">
                <MainLandmark>
                  <StudentExamFinishedPage />
                </MainLandmark>
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/practice/exams/:examId"
            title="演習セット"
            element={
              <ProtectedRoute role="STUDENT">
                <MainLandmark>
                  <PracticeSetPage />
                </MainLandmark>
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/practice/exams/:examId/tasks/:taskId"
            title="演習問題"
            element={
              <ProtectedRoute role="STUDENT">
                <PracticeTaskPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher"
            title="教師ダッシュボード"
            element={
              <ProtectedRoute role="TEACHER">
                <MainLandmark>
                  <TeacherDashboard />
                </MainLandmark>
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/exams/:examId"
            title="試験詳細"
            element={
              <ProtectedRoute role="TEACHER">
                <MainLandmark>
                  <ExamDetailPage />
                </MainLandmark>
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/exams/:examId/tasks/:taskId"
            title="問題編集"
            element={
              <ProtectedRoute role="TEACHER">
                <MainLandmark>
                  <TaskEditorPage />
                </MainLandmark>
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/tasks/:taskId/preview"
            title="生徒画面プレビュー"
            element={
              <ProtectedRoute role="TEACHER">
                <TaskPreviewPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/exams/:examId/results"
            title="成績一覧"
            element={
              <ProtectedRoute role="TEACHER">
                <MainLandmark>
                  <ExamResultsPage />
                </MainLandmark>
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/exams/:examId/practice-stats"
            title="演習の状況"
            element={
              <ProtectedRoute role="TEACHER">
                <MainLandmark>
                  <PracticeStatsPage />
                </MainLandmark>
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/courses"
            title="クラス管理"
            element={
              <ProtectedRoute role="TEACHER">
                <MainLandmark>
                  <CoursesPage />
                </MainLandmark>
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/admin"
            title="管理者メニュー"
            element={
              <ProtectedRoute role="TEACHER">
                <MainLandmark>
                  <AdminPage />
                </MainLandmark>
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/sandbox"
            title="サンドボックス"
            element={
              <ProtectedRoute role="TEACHER">
                <MainLandmark>
                  <SandboxPage />
                </MainLandmark>
              </ProtectedRoute>
            }
          />
          </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
