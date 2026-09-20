import { describe, expect, it } from 'vitest';
import { groupSlotsByDaypart, type Slot } from './bookingSlots.js';

const slot = (start: string, end: string, available = true): Slot => ({ start, end, available });

describe('groupSlotsByDaypart', () => {
  it('returns no groups for an empty input', () => {
    expect(groupSlotsByDaypart([])).toEqual([]);
  });

  it('puts 00:00–11:59 in Morning', () => {
    const groups = groupSlotsByDaypart([slot('00:00', '00:30'), slot('09:00', '09:30'), slot('11:59', '12:29')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.daypart).toBe('Morning');
    expect(groups[0]!.slots.map((s) => s.start)).toEqual(['00:00', '09:00', '11:59']);
  });

  it('puts 12:00 exactly in Afternoon, not Morning', () => {
    const groups = groupSlotsByDaypart([slot('12:00', '12:30')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.daypart).toBe('Afternoon');
  });

  it('puts 12:00–16:59 in Afternoon', () => {
    const groups = groupSlotsByDaypart([slot('12:00', '12:30'), slot('14:45', '15:15'), slot('16:59', '17:29')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.daypart).toBe('Afternoon');
  });

  it('puts 17:00 exactly in Evening, not Afternoon', () => {
    const groups = groupSlotsByDaypart([slot('17:00', '17:30')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.daypart).toBe('Evening');
  });

  it('puts 17:00–23:59 in Evening', () => {
    const groups = groupSlotsByDaypart([slot('17:00', '17:30'), slot('20:15', '20:45'), slot('23:59', '00:29')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.daypart).toBe('Evening');
  });

  it('emits groups in Morning → Afternoon → Evening order regardless of input order', () => {
    const groups = groupSlotsByDaypart([
      slot('19:00', '19:30'),
      slot('10:00', '10:30'),
      slot('13:00', '13:30'),
    ]);
    expect(groups.map((g) => g.daypart)).toEqual(['Morning', 'Afternoon', 'Evening']);
  });

  it('omits empty dayparts', () => {
    const groups = groupSlotsByDaypart([slot('08:00', '08:30'), slot('21:00', '21:30')]);
    expect(groups.map((g) => g.daypart)).toEqual(['Morning', 'Evening']);
  });

  it('preserves the original slot order within each daypart for unsorted input', () => {
    const groups = groupSlotsByDaypart([
      slot('10:30', '11:00'),
      slot('09:00', '09:30'),
      slot('10:00', '10:30'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.slots.map((s) => s.start)).toEqual(['10:30', '09:00', '10:00']);
  });

  it('never drops, shifts, or invents slots', () => {
    const input = [slot('08:00', '08:30'), slot('12:30', '13:00'), slot('18:00', '18:30'), slot('09:15', '09:45')];
    const groups = groupSlotsByDaypart(input);
    const flattened = groups.flatMap((g) => g.slots);
    expect(flattened).toHaveLength(input.length);
    expect(flattened).toEqual(expect.arrayContaining(input));
    // End times pass through untouched.
    expect(flattened.find((s) => s.start === '08:00')!.end).toBe('08:30');
  });

  it('keeps taken (unavailable) slots in their daypart group', () => {
    const groups = groupSlotsByDaypart([slot('09:30', '10:00', false)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.slots[0]!.available).toBe(false);
  });

  it('does not mutate the input array', () => {
    const input = [slot('18:00', '18:30'), slot('09:00', '09:30')];
    groupSlotsByDaypart(input);
    expect(input.map((s) => s.start)).toEqual(['18:00', '09:00']);
  });
});
