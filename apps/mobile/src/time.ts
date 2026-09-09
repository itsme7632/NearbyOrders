/**
 * Business-local (Asia/Karachi, PKT) date/time helpers.
 *
 * Pakistan has no DST, so local wall-clock time is a fixed UTC+05:00 offset —
 * the same invariant the API relies on (see docs/bookings.md). All helpers do
 * pure UTC arithmetic and never depend on the device timezone, so a slot shown
 * as 10:00 AM is 10:00 PKT on every phone.
 */

/** Offset of business-local time from UTC, in minutes. */
export const PKT_OFFSET_MINUTES = 300;

/** Date portion (YYYY-MM-DD) of a UTC instant, in business-local time. */
export const pktDateOf = (instant: Date): string =>
  new Date(instant.getTime() + PKT_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);

/** Today's date (YYYY-MM-DD) in business-local time. */
export const todayPkt = (): string => pktDateOf(new Date());

/** Parses YYYY-MM-DD without timezone surprises; invalid strings yield NaN. */
const parseDateOnly = (date: string): number => Date.parse(`${date}T00:00:00Z`);

/** Adds n days to a YYYY-MM-DD date string. */
export const addDays = (date: string, n: number): string =>
  new Date(parseDateOnly(date) + n * 86_400_000).toISOString().slice(0, 10);

/** 0–6 (0 = Sunday) for a YYYY-MM-DD date string. */
export const dayOfWeek = (date: string): number => new Date(parseDateOnly(date)).getUTCDay();

/** Whole days between two YYYY-MM-DD dates (b - a). */
export const daysBetween = (a: string, b: string): number =>
  Math.round((parseDateOnly(b) - parseDateOnly(a)) / 86_400_000);

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** `MON` for a YYYY-MM-DD date string. */
export const dayNameShort = (date: string): string => DAY_SHORT[dayOfWeek(date)] ?? '';

/** `Wednesday, September 11` style label for summaries and confirmations. */
export const longDateLabel = (date: string): string => {
  const d = new Date(parseDateOnly(date));
  return `${DAY_LONG[d.getUTCDay()]}, ${MONTH_LONG[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

/** `9 SEP` style compact label for date chips (no leading zero). */
export const compactDateLabel = (date: string): { day: string; month: string; num: string } => {
  const d = new Date(parseDateOnly(date));
  return { day: DAY_SHORT[d.getUTCDay()] ?? '', month: MONTH_SHORT[d.getUTCMonth()] ?? '', num: String(d.getUTCDate()) };
};

/** Converts "HH:MM" (business-local) into minutes since midnight. */
export const minutesOfDay = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Formats minutes-since-midnight as a friendly 12-hour clock label
 * ("9:00 AM", "12:30 PM", "10:05 PM").
 */
export const formatSlotTime = (hhmm: string): string => {
  const total = minutesOfDay(hhmm);
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
};

/** True when `date` (business-local) is strictly before today (PKT). */
export const isPastDate = (date: string): boolean => daysBetween(todayPkt(), date) < 0;
