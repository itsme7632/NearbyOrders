import { useRef } from 'react';

export const CODE_LENGTH = 6;

/**
 * Single 6-digit numeric code input (NOT segmented boxes).
 *
 * One field is deliberate: `autoComplete="one-time-code"` gives Android SMS
 * autofill, and a single field supports paste — both break with segmented
 * inputs. Digits are styled large with letter-spacing for the premium
 * verification feel.
 */
export function CodeInput(props: {
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  label: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);

  const handleChange = (raw: string) => {
    // Digits only, max 6 — strip anything else (handles paste).
    const digits = raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
    props.onChange(digits);
  };

  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      className={`code-input${props.invalid ? ' input-invalid' : ''}`}
      value={props.value}
      onChange={(e) => handleChange(e.target.value)}
      aria-label={props.label}
      aria-invalid={props.invalid || undefined}
      placeholder="······"
      maxLength={CODE_LENGTH}
      enterKeyHint="done"
      disabled={props.disabled}
      // Autofocus opens the numeric keyboard immediately on mount.
      // React 19 supports the autofocus attribute via autoFocus prop.
      autoFocus={props.autoFocus}
    />
  );
}
