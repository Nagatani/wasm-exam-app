import { useAuth } from '../contexts/AuthContext';
import { logOut } from '../api/auth';

export function TeacherDashboard() {
  const { profile, refresh } = useAuth();

  return (
    <div className="min-h-screen bg-gray-900 p-6 text-white">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-teal-400">講師管理画面</h1>
        <button
          onClick={() => logOut().then(refresh)}
          className="rounded bg-gray-700 px-3 py-1.5 text-sm hover:bg-gray-600"
        >
          ログアウト
        </button>
      </header>
      <p className="text-gray-400">
        ようこそ、{profile?.studentNumber} さん。試験・問題の登録画面はフェーズ2で実装予定です。
      </p>
    </div>
  );
}
