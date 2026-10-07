import { useState } from 'react';
import { EyeIcon, EyeOffIcon } from './icons.js';

/**
 * Password field with a visibility toggle. Shared by the sign-in/register
 * form, change-password, and the reset new-password screen — one
 * implementation, no duplication.
 */
export function PasswordInput(props: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  invalid?: boolean;
  placeholder: string;
  label: string;
  name?: string;
  enterKeyHint?: 'next' | 'done' | 'send' | 'go';
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-slot">
      <input
        type={visible ? 'text' : 'password'}
        name={props.name}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        aria-label={props.label}
        aria-invalid={props.invalid || undefined}
        placeholder={props.placeholder}
        enterKeyHint={props.enterKeyHint ?? 'done'}
        disabled={props.disabled}
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? `Hide ${props.label.toLowerCase()}` : `Show ${props.label.toLowerCase()}`}
        aria-pressed={visible}
        disabled={props.disabled}
      >
        {visible ? <EyeOffIcon size={19} /> : <EyeIcon size={19} />}
      </button>
    </div>
  );
}
