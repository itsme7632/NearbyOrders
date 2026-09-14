import type { ReactNode } from 'react';

/** v3 empty state: illustration circle, tight title/body, optional action. */
export function EmptyStateV3(props: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty-v3">
      <div className="empty-v3-icon" aria-hidden>
        {props.icon}
      </div>
      <h3>{props.title}</h3>
      <p>{props.body}</p>
      {props.action}
    </div>
  );
}
