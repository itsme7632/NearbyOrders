import { useState } from 'react';
import { getOwnerHours, putHours, type BusinessHour, type HourInput } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, ErrorState, Loading, Toggle } from '../components/ui.js';
import { AlertIcon } from '../components/icons.js';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const isValidTime = (t: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

/**
 * Client-side mirror of the server's opening-hours validation so obvious
 * mistakes never reach the API. Returns per-day messages keyed by dayOfWeek.
 * The backend stays authoritative — this only improves the UX.
 */
export function validateHours(days: HourInput[]): Record<number, string> {
  const errors: Record<number, string> = {};
  for (const d of days) {
    if (d.isClosed) continue;
    if (!d.opensAt || !d.closesAt || !isValidTime(d.opensAt) || !isValidTime(d.closesAt)) {
      errors[d.dayOfWeek] = 'Set an opening and closing time for open days.';
    } else if (d.opensAt >= d.closesAt) {
      errors[d.dayOfWeek] = 'Closing time must be after opening time.';
    }
  }
  return errors;
}

export function OwnerHours(props: { businessId: string }) {
  const hours = useAsyncData<BusinessHour[]>(() => getOwnerHours(props.businessId), [props.businessId]);
  const [days, setDays] = useState<HourInput[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (hours.loading && !days) return <Loading />;
  if (hours.error && !days) return <ErrorState message={hours.error} onRetry={hours.reload} />;

  const model: HourInput[] =
    days ??
    (hours.data?.length
      ? hours.data.map((h) => ({
          dayOfWeek: h.dayOfWeek,
          isClosed: h.isClosed,
          opensAt: h.opensAt ?? undefined,
          closesAt: h.closesAt ?? undefined,
        }))
      : Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isClosed: false, opensAt: '09:00', closesAt: '18:00' })));

  const fieldErrors = validateHours(model);
  const hasErrors = Object.keys(fieldErrors).length > 0;

  const update = (day: number, patch: Partial<HourInput>) => {
    setSaved(false);
    setDays(model.map((d) => (d.dayOfWeek === day ? { ...d, ...patch } : d)));
  };

  const save = async () => {
    if (busy || hasErrors) return;
    setBusy(true);
    setError(null);
    try {
      await putHours(
        props.businessId,
        model.map((d) => (d.isClosed ? { dayOfWeek: d.dayOfWeek, isClosed: true } : d)),
      );
      setSaved(true);
      setDays(null);
      hours.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-label="Opening hours">
      <div className="section-head">
        <h2>Opening hours</h2>
      </div>
      <p className="ov-section-sub">
        Customers see your business as open only during these hours. Set each day you trade, or switch a day off.
      </p>
      {error ? <ErrorState message={error} /> : null}
      {saved ? <p className="save-ok">Saved ✓</p> : null}
      <ul className="hours-editor">
        {[1, 2, 3, 4, 5, 6, 0].map((day) => {
          const d = model.find((x) => x.dayOfWeek === day)!;
          const dayError = fieldErrors[day];
          return (
            <li key={day} className={`hours-row${dayError ? ' hours-row-invalid' : ''}`}>
              <span className="hours-day">{DAY_LABELS[day]}</span>
              <Toggle checked={!d.isClosed} onChange={(v) => update(day, { isClosed: !v, opensAt: v ? d.opensAt ?? '09:00' : undefined, closesAt: v ? d.closesAt ?? '18:00' : undefined })} label={`${DAY_LABELS[day]} open`} />
              {d.isClosed ? (
                <span className="hours-closed">Closed</span>
              ) : (
                <span className="hours-times">
                  <input type="time" value={d.opensAt ?? ''} onChange={(e) => update(day, { opensAt: e.target.value })} aria-label={`${DAY_LABELS[day]} opens`} />
                  <input type="time" value={d.closesAt ?? ''} onChange={(e) => update(day, { closesAt: e.target.value })} aria-label={`${DAY_LABELS[day]} closes`} />
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {hasErrors ? (
        <div className="hours-error-summary" role="alert">
          <AlertIcon size={14} /> Fix the highlighted days before saving.
        </div>
      ) : null}
      <Button full onClick={save} disabled={busy || hasErrors}>
        {busy ? 'Saving…' : 'Save hours'}
      </Button>
    </section>
  );
}

/* ------------------------------ Reviews ------------------------------ */

/** Customer reviews for one of the owner's businesses (read-only). */
