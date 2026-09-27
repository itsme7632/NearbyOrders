import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { CloseIcon } from './icons.js';
import { useOverlayBackHandler } from '../androidBack.js';

/* ==================================================================
   Warm Proximity core primitives (Phase 1).
   Reusable, accessible building blocks for sheets, segmented switches
   and transient feedback. Screens compose these instead of inventing
   their own overlays.
   ================================================================== */

/* ------------------------------ Sheet ------------------------------ */

/**
 * Mobile-first bottom sheet dialog.
 *
 * - role="dialog" + aria-modal with labelled title
 * - Focus moves to the close action on open and returns on close
 * - Escape and backdrop tap dismiss (unless `persistent`)
 * - Android system back dismisses too (unless `persistent`), via the
 *   central back handler — sheets never navigate away underneath
 * - Body scroll is locked while open; safe-area inset is padded
 * - Content scrolls inside `.sheet-body`
 */
export function Sheet(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Optional supporting line under the title (meta, subtitle). */
  subtitle?: ReactNode;
  /** When true, Escape/backdrop don't dismiss — the sheet owns the flow. */
  persistent?: boolean;
  closeLabel?: string;
}) {
  const { open, onClose, persistent } = props;
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // System back dismisses an open non-persistent sheet before navigating.
  // Persistent sheets own their flow (same as Escape/backdrop): they do not
  // register, so back navigates history as usual.
  useOverlayBackHandler(open && !persistent, onClose);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    // Keyboard users land on the way out first.
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !persistent) onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = prevOverflow;
      restoreRef.current?.focus();
    };
  }, [open, onClose, persistent]);

  if (!open) return null;

  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        if (!persistent && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-header">
          <h2 className="sheet-title" id={titleId}>
            {props.title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="sheet-close"
            onClick={onClose}
            aria-label={props.closeLabel ?? `Close ${props.title}`}
          >
            <CloseIcon size={18} />
          </button>
        </div>
        {props.subtitle ? <div className="sheet-sub">{props.subtitle}</div> : null}
        <div className="sheet-body">{props.children}</div>
      </div>
    </div>
  );
}

/* ------------------------- SegmentedControl ------------------------ */

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
};

/**
 * Compact single-select switch (radiogroup semantics).
 *
 * Roving tabindex: the selected option is tabbable, arrow keys move and
 * select. Compact mobile presentation; use for 2–4 mutually exclusive
 * view/mode choices (e.g. Explore List/Map).
 */
export function SegmentedControl<T extends string>(props: {
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Stretch to the full container width. */
  full?: boolean;
}) {
  const focusOption = (container: HTMLElement | null, index: number) => {
    const el = container?.children[index] as HTMLElement | undefined;
    el?.focus();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = props.options.length - 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next !== null) {
      e.preventDefault();
      props.onChange(props.options[next].value);
      focusOption(e.currentTarget.parentElement, next);
    }
  };

  return (
    <div className={`segmented${props.full ? ' segmented-full' : ''}`} role="radiogroup" aria-label={props.label}>
      {props.options.map((opt, i) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={props.value === opt.value}
          tabIndex={props.value === opt.value ? 0 : -1}
          className="segmented-option"
          onClick={() => props.onChange(opt.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Accessible on/off toggle (Phase 3D). A native-feeling switch built on a
 * <button role="switch">: full keyboard support, a 48px touch target, and
 * an honest on/off label for screen readers. Disabled while a save is in
 * flight so a tap can never queue conflicting states.
 */
export function Toggle(props: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      className={`toggle${props.checked ? ' toggle-on' : ''}`}
      onClick={() => props.onChange(!props.checked)}
    >
      <span className="toggle-knob" aria-hidden />
    </button>
  );
}

/* ------------------------------ Toast ------------------------------ */

export type ToastKind = 'success' | 'error' | 'info';

type ToastItem = { id: number; kind: ToastKind; message: string };

type ToastContextValue = {
  /** Show a transient message; auto-dismisses, also manually dismissible. */
  notify: (kind: ToastKind, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

let toastSeq = 1;
const AUTO_DISMISS_MS = 4500;
const MAX_VISIBLE = 3;

/**
 * Provides `useToast()` to the tree and renders the toast region.
 * Mount once near the app root. Toasts announce via role="status"
 * (role="alert" for errors) and dismiss automatically or via the
 * dismiss button. Positioned above the floating bottom nav.
 */
export function ToastProvider(props: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (kind: ToastKind, message: string) => {
      const id = toastSeq++;
      setToasts((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const value: ToastContextValue = {
    notify,
    success: (message: string) => notify('success', message),
    error: (message: string) => notify('error', message),
    info: (message: string) => notify('info', message),
  };

  return (
    <ToastContext.Provider value={value}>
      {props.children}
      <div className="toast-region">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span className="toast-message">{t.message}</span>
            <button type="button" className="toast-dismiss" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
              <CloseIcon size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
