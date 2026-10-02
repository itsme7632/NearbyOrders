import { useCallback, useEffect, useRef, useState } from 'react';
import type { ForegroundPush } from '../push.js';
import { BellIcon, CloseIcon } from './icons.js';

export type QueuedPush = ForegroundPush & { id: number };

const AUTO_DISMISS_MS = 8000;

let pushSeq = 1;

/**
 * In-app banner for notifications that arrive while the app is open (the OS
 * shows nothing in that case). One banner at a time; extras queue. Tapping
 * opens the deep link; the close button dismisses. Auto-dismisses after a
 * few seconds so it never blocks the workflow.
 */
export function ForegroundPushBanner(props: { onOpen: (deepLink: string) => void }) {
  const [queue, setQueue] = useState<QueuedPush[]>([]);
  const onOpenRef = useRef(props.onOpen);
  onOpenRef.current = props.onOpen;

  const dismiss = useCallback((id: number) => {
    setQueue((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const current = queue[0] ?? null;

  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(() => dismiss(current.id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [current, dismiss]);

  const open = useCallback(
    (p: QueuedPush) => {
      dismiss(p.id);
      if (p.deepLink) onOpenRef.current(p.deepLink);
    },
    [dismiss],
  );

  return (
    <>
      {/* Headless queue API: the hook pushes here, the banner renders. */}
      <PushQueueSink
        onPush={(p) =>
          setQueue((prev) => {
            // De-dupe rapid repeats of the same alert.
            if (prev.some((q) => q.title === p.title && q.body === p.body)) return prev;
            return [...prev.slice(-2), p];
          })
        }
      />
      {current ? (
        <div className="push-banner" role="status" aria-live="polite">
          <button
            type="button"
            className="push-banner-body"
            onClick={() => open(current)}
            aria-label={current.deepLink ? `Open: ${current.title}` : current.title}
          >
            <span className="push-banner-icon" aria-hidden>
              <BellIcon size={20} />
            </span>
            <span className="push-banner-text">
              <strong>{current.title}</strong>
              {current.body ? <span>{current.body}</span> : null}
            </span>
            {current.deepLink ? <span className="push-banner-cta">View</span> : null}
          </button>
          <button
            type="button"
            className="push-banner-dismiss"
            onClick={() => dismiss(current.id)}
            aria-label="Dismiss notification"
          >
            <CloseIcon size={14} />
          </button>
        </div>
      ) : null}
    </>
  );
}

/**
 * Renders nothing; exists so any component can enqueue a foreground push
 * without prop-drilling. The banner above subscribes via a module-level bus.
 */
type SinkProps = { onPush: (p: QueuedPush) => void };

const subscribers = new Set<(p: QueuedPush) => void>();

/** Enqueue a foreground push from anywhere (the push hook calls this). */
export const enqueueForegroundPush = (push: ForegroundPush): void => {
  const queued = { ...push, id: pushSeq++ };
  subscribers.forEach((fn) => fn(queued));
};

function PushQueueSink(props: SinkProps) {
  useEffect(() => {
    subscribers.add(props.onPush);
    return () => {
      subscribers.delete(props.onPush);
    };
  }, [props.onPush]);
  return null;
}
