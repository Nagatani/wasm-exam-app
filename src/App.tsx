import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
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

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<PageSkeleton />}>
          <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route
            path="/change-password"
            element={
              <ProtectedRoute allowPasswordChangePending>
                <ChangePasswordPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <SettingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <RoleHome />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student"
            element={
              <ProtectedRoute role="STUDENT">
                <StudentDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/exams/:examId/tasks/:taskId"
            element={
              <ProtectedRoute role="STUDENT">
                <StudentTaskPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/exams/:examId/finished"
            element={
              <ProtectedRoute role="STUDENT">
                <StudentExamFinishedPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/practice/exams/:examId"
            element={
              <ProtectedRoute role="STUDENT">
                <PracticeSetPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/practice/exams/:examId/tasks/:taskId"
            element={
              <ProtectedRoute role="STUDENT">
                <PracticeTaskPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher"
            element={
              <ProtectedRoute role="TEACHER">
                <TeacherDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/exams/:examId"
            element={
              <ProtectedRoute role="TEACHER">
                <ExamDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/exams/:examId/tasks/:taskId"
            element={
              <ProtectedRoute role="TEACHER">
                <TaskEditorPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/exams/:examId/results"
            element={
              <ProtectedRoute role="TEACHER">
                <ExamResultsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/exams/:examId/practice-stats"
            element={
              <ProtectedRoute role="TEACHER">
                <PracticeStatsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/courses"
            element={
              <ProtectedRoute role="TEACHER">
                <CoursesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/admin"
            element={
              <ProtectedRoute role="TEACHER">
                <AdminPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/teacher/sandbox"
            element={
              <ProtectedRoute role="TEACHER">
                <SandboxPage />
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
