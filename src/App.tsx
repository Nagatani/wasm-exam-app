import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { RoleHome } from './pages/RoleHome';
import { StudentDashboard } from './pages/StudentDashboard';
import { TeacherDashboard } from './pages/TeacherDashboard';
import { ExamDetailPage } from './pages/ExamDetailPage';
import { TaskEditorPage } from './pages/TaskEditorPage';
import { SandboxPage } from './pages/SandboxPage';
import { StudentTaskPage } from './pages/StudentTaskPage';
import { StudentExamFinishedPage } from './pages/StudentExamFinishedPage';
import { ExamResultsPage } from './pages/ExamResultsPage';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
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
            path="/teacher/sandbox"
            element={
              <ProtectedRoute role="TEACHER">
                <SandboxPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
