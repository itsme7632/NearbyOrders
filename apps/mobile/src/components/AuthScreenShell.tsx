import type { ReactNode } from 'react';
import { NearbyOrdersMark } from './icons.js';

/**
 * Shared chrome for the pre-auth screens (verify-email, forgot-password,
 * reset-code, new-password): real N+O brand mark, back link, and the
 * screen-head (kicker / h1 / lede) pattern used across the app.
 */
export function AuthScreenShell(props: {
  onBack: () => void;
  backLabel?: string;
  kicker?: string;
  title: string;
  lede?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="screen auth-screen">
      <button type="button" className="back-link" onClick={props.onBack}>
        ‹ {props.backLabel ?? 'Back'}
      </button>
      <header className="auth-brand">
        <span className="auth-brand-mark auth-brand-mark-real" aria-hidden>
          <NearbyOrdersMark size={30} tone="light" />
        </span>
        <span className="auth-brand-lockup">
          <span className="auth-brand-name">
            Nearby<b>Orders</b>
          </span>
          <span className="auth-brand-tag">Find nearby. Book or order.</span>
        </span>
      </header>
      <div className="screen-head">
        {props.kicker ? <p className="auth-kicker">{props.kicker}</p> : null}
        <h1>{props.title}</h1>
        {props.lede ? <p className="muted">{props.lede}</p> : null}
      </div>
      <div className="card">{props.children}</div>
    </div>
  );
}
