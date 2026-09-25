import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BackHeader } from '../components/BackHeader';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { getServiceHealth, promoteToTeacher, type ServiceHealth } from '../api/admin';
import { resetStudentPassword } from '../api/students';
import { ApiError } from '../api/client';

type Message = { ok: boolean; text: string } | null;

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-4 rounded-lg border border-mp-border bg-mp-surface p-4">
      <h2 className="text-sm font-bold">{title}</h2>
      {description && <p className="mt-1 text-xs text-mp-muted">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function MessageLine({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p className={`mt-2 text-sm ${message.ok ? 'text-mp-green' : 'text-mp-red'}`}>{message.text}</p>
  );
}

function ServiceStatus() {
  const [health, setHealth] = useState<ServiceHealth | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const tick = () =>
      getServiceHealth()
        .then((h) => {
          setHealth(h);
          setFailed(false);
        })
        .catch(() => setFailed(true));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  const dot = (state: string) =>
    state === 'ok' ? 'text-mp-green' : state === 'disabled' ? 'text-mp-muted' : 'text-mp-red';
  const word: Record<string, string> = { ok: '正常', error: '接続不可', disabled: '無効' };

  if (failed) return <p className="text-sm text-mp-red">● サーバーに接続できません</p>;
  if (!health) return <p className="text-sm text-mp-muted">確認中...</p>;
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      <span className={dot(health.db)}>● DB: {word[health.db] ?? health.db}</span>
      <span className={dot(health.judge)}>
        ● Java judge: {word[health.judge] ?? health.judge}
      </span>
    </div>
  );
}

function StudentNumberForm({
  id,
  submitLabel,
  submitting,
  onSubmit,
}: {
  id: string;
  submitLabel: string;
  submitting: boolean;
  onSubmit: (studentNumber: string) => void;
}) {
  const [studentNumber, setStudentNumber] = useState('');
  const trimmed = studentNumber.trim();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (trimmed) onSubmit(trimmed);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
      <div>
        <label className="mb-1 block text-xs text-mp-muted" htmlFor={id}>
          学籍番号
        </label>
        <input
          id={id}
          className="rounded border border-mp-border bg-mp-bg px-3 py-1.5 text-sm text-mp-fg"
          value={studentNumber}
          onChange={(e) => setStudentNumber(e.target.value)}
          required
        />
      </div>
      <button
        type="submit"
        disabled={submitting || trimmed === ''}
        className="rounded bg-mp-cyan px-3 py-1.5 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? '処理中...' : submitLabel}
      </button>
    </form>
  );
}

function PromoteTeacher() {
  const [pending, setPending] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  async function confirm() {
    if (!pending) return;
    const studentNumber = pending;
    setPending(null);
    setSubmitting(true);
    setMessage(null);
    try {
      const { user } = await promoteToTeacher(studentNumber);
      setMessage({ ok: true, text: `${user.displayName}（${user.studentNumber}）を教員にしました。` });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : '昇格に失敗しました。' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <StudentNumberForm
        id="promote-sn"
        submitLabel="教員に昇格"
        submitting={submitting}
        onSubmit={setPending}
      />
      <MessageLine message={message} />
      <ConfirmDialog
        open={pending !== null}
        title="教員に昇格"
        message={`${pending ?? ''} を教員にします。教員はすべての試験の編集・成績の閲覧ができるようになります。よろしいですか？`}
        confirmLabel="昇格する"
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

function ResetPassword() {
  const [pending, setPending] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [issued, setIssued] = useState<{
    studentNumber: string;
    displayName: string;
    initialPassword: string;
  } | null>(null);

  async function confirm() {
    if (!pending) return;
    const studentNumber = pending;
    setPending(null);
    setSubmitting(true);
    setMessage(null);
    setIssued(null);
    try {
      setIssued(await resetStudentPassword(studentNumber));
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof ApiError ? err.message : 'パスワードの再発行に失敗しました。',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <StudentNumberForm
        id="reset-sn"
        submitLabel="パスワードを再発行"
        submitting={submitting}
        onSubmit={setPending}
      />
      <MessageLine message={message} />
      {issued && (
        <div className="mt-3 rounded border border-mp-green/50 bg-mp-green/10 p-3 text-sm">
          <p>
            {issued.studentNumber} {issued.displayName} の新しい初期パスワード:
          </p>
          <p className="my-1 font-mono text-lg font-bold tracking-wider">{issued.initialPassword}</p>
          <p className="text-xs text-mp-muted">
            本人に伝えてください。生徒は次回ログイン時にパスワードの変更を求められます。クラスに所属している生徒なら、クラス管理の受講者一覧からも確認・印刷できます。
          </p>
        </div>
      )}
      <ConfirmDialog
        open={pending !== null}
        title="パスワードを再発行"
        message={`${pending ?? ''} のパスワードを再発行します。今のパスワードは使えなくなり、ログイン中の端末もすべてログアウトされます（受験中の場合は再ログインが必要です）。よろしいですか？`}
        confirmLabel="再発行する"
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

/**
 * Teacher-only admin tools, reached from the hamburger drawer (UserDrawer).
 * Previously a collapsed "▶ 管理者メニュー" block at the bottom of
 * TeacherDashboard.
 */
export function AdminPage() {
  return (
    <div className="min-h-screen bg-mp-bg p-6 text-mp-fg">
      <div className="mx-auto max-w-3xl">
        <BackHeader to="/teacher" label="教師ダッシュボードに戻る" />
        <h1 className="mb-4 text-xl font-bold text-mp-cyan">管理者メニュー</h1>

        <Section title="サービス状態" description="30秒ごとに自動更新します。">
          <ServiceStatus />
        </Section>

        <Section
          title="パスワードの再発行"
          description="クラスに所属していない生徒も含め、学籍番号を指定して初期パスワードを再発行します（教員アカウントは対象外）。ログイン失敗によるロックも解除されます。"
        >
          <ResetPassword />
        </Section>

        <Section
          title="教員への昇格"
          description="既存のアカウントを学籍番号で指定して教員にします。"
        >
          <PromoteTeacher />
        </Section>

        <Section
          title="開発・動作確認"
          description="C コンパイラ等の動作を単体で確認するための開発用ツールです。"
        >
          <Link to="/teacher/sandbox" className="text-sm text-mp-cyan underline hover:opacity-80">
            サンドボックス動作確認を開く
          </Link>
        </Section>
      </div>
    </div>
  );
}
