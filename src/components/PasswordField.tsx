import { useState } from 'react';

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  minLength?: number;
  required?: boolean;
}

/**
 * Password input with a show/hide toggle. Shared by the login and signup
 * forms so the toggle behaves identically in both (and the signup form gets
 * it on both the password and confirm fields without duplicating markup).
 */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  minLength,
  required,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="mb-4">
      <label className="mb-1 block text-sm text-mp-muted" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          className="w-full rounded border border-mp-border bg-mp-bg px-3 py-2 pr-14 text-mp-fg"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          minLength={minLength}
          required={required}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? 'パスワードを隠す' : 'パスワードを表示'}
          className="absolute inset-y-0 right-0 px-3 text-xs font-bold text-mp-cyan hover:underline"
        >
          {visible ? '隠す' : '表示'}
        </button>
      </div>
    </div>
  );
}
