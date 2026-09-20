import { minutesOfDay } from '../time.js';
import type { Availability } from '../api.js';

/** One server-returned availability slot; times are business-local "HH:mm". */
export type Slot = Availability['slots'][number];

export type Daypart = 'Morning' | 'Afternoon' | 'Evening';

export interface SlotDaypartGroup {
  daypart: Daypart;
  slots: Slot[];
}

/**
 * Daypart boundaries in minutes since midnight. Slots arrive from the server
 * as business-local times, so these boundaries apply to the raw "HH:mm"
 * values directly — no timezone shifting is done (or needed) here.
 *
 *  - Morning:   before 12:00
 *  - Afternoon: 12:00 – 16:59
 *  - Evening:   17:00 and later
 */
export const DAYPART_START_MINUTES: Record<Daypart, number> = {
  Morning: 0,
  Afternoon: 12 * 60,
  Evening: 17 * 60,
};

const DAYPART_ORDER: readonly Daypart[] = ['Morning', 'Afternoon', 'Evening'];

const daypartOf = (start: string): Daypart => {
  const minutes = minutesOfDay(start);
  if (minutes >= DAYPART_START_MINUTES.Evening) return 'Evening';
  if (minutes >= DAYPART_START_MINUTES.Afternoon) return 'Afternoon';
  return 'Morning';
};

/**
 * Groups server-returned slot times into Morning / Afternoon / Evening.
 *
 * Pure function: never shifts, invents, or drops a slot. Slots keep their
 * original order inside each group; groups come out in daypart order and
 * empty groups are omitted.
 */
export function groupSlotsByDaypart(slots: readonly Slot[]): SlotDaypartGroup[] {
  const buckets: Record<Daypart, Slot[]> = { Morning: [], Afternoon: [], Evening: [] };
  for (const slot of slots) buckets[daypartOf(slot.start)].push(slot);
  return DAYPART_ORDER.filter((daypart) => buckets[daypart].length > 0).map((daypart) => ({
    daypart,
    slots: buckets[daypart],
  }));
}
