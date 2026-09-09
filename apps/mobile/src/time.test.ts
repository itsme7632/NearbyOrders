import { describe, expect, it } from 'vitest';
import {
  addDays,
  compactDateLabel,
  dayNameShort,
  dayOfWeek,
  daysBetween,
  formatSlotTime,
  isPastDate,
  longDateLabel,
  minutesOfDay,
  pktDateOf,
  todayPkt,
} from './time.js';

describe('PKT date helpers', () => {
  it('converts UTC instants to the Pakistan-local calendar date', () => {
    // 2026-09-10T19:30:00Z is 2026-09-11 00:30 PKT (UTC+05:00).
    expect(pktDateOf(new Date('2026-09-10T19:30:00Z'))).toBe('2026-09-11');
    // 2026-09-10T18:59:00Z is still 2026-09-10 in PKT.
    expect(pktDateOf(new Date('2026-09-10T18:59:00Z'))).toBe('2026-09-10');
  });

  it('todayPkt is a valid YYYY-MM-DD string', () => {
    expect(todayPkt()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('adds days across month boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-09-09', -9)).toBe('2026-08-31');
  });

  it('computes day of week and day names from the date string', () => {
    // 2026-09-09 is a Wednesday.
    expect(dayOfWeek('2026-09-09')).toBe(3);
    expect(dayNameShort('2026-09-09')).toBe('Wed');
  });

  it('counts whole days between dates', () => {
    expect(daysBetween('2026-09-09', '2026-09-10')).toBe(1);
    expect(daysBetween('2026-09-10', '2026-09-09')).toBe(-1);
    expect(daysBetween('2026-09-09', '2026-09-09')).toBe(0);
  });

  it('labels dates for chips and summaries', () => {
    expect(compactDateLabel('2026-09-09')).toEqual({ day: 'Wed', month: 'Sep', num: '9' });
    expect(longDateLabel('2026-09-09')).toBe('Wednesday, September 9');
  });

  it('classifies past dates only strictly before today', () => {
    const today = todayPkt();
    expect(isPastDate(today)).toBe(false);
    expect(isPastDate(addDays(today, -1))).toBe(true);
    expect(isPastDate(addDays(today, 1))).toBe(false);
  });
});

describe('slot time formatting', () => {
  it('parses HH:MM into minutes', () => {
    expect(minutesOfDay('09:30')).toBe(570);
    expect(minutesOfDay('00:00')).toBe(0);
    expect(minutesOfDay('23:59')).toBe(1439);
  });

  it('formats business-local times as a friendly 12-hour clock', () => {
    expect(formatSlotTime('09:00')).toBe('9:00 AM');
    expect(formatSlotTime('09:30')).toBe('9:30 AM');
    expect(formatSlotTime('12:00')).toBe('12:00 PM');
    expect(formatSlotTime('00:15')).toBe('12:15 AM');
    expect(formatSlotTime('22:05')).toBe('10:05 PM');
  });
});
