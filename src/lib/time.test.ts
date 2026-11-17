import { describe, expect, it } from 'vitest';
import { formatClockTime, startOfToday } from './time';

describe('startOfToday', () => {
  it('returns local midnight for the instant it is given', () => {
    const instant = new Date(2026, 0, 15, 13, 45, 30, 250).getTime();
    const midnight = new Date(startOfToday(instant));
    expect(midnight.getHours()).toBe(0);
    expect(midnight.getMinutes()).toBe(0);
    expect(midnight.getSeconds()).toBe(0);
    expect(midnight.getDate()).toBe(15);
  });

  it('is the same value anywhere inside one day', () => {
    const first = new Date(2026, 0, 15, 0, 0, 0, 0).getTime();
    const last = new Date(2026, 0, 15, 23, 59, 59, 999).getTime();
    expect(startOfToday(first)).toBe(startOfToday(last));
  });

  it('separates two consecutive days', () => {
    const day = new Date(2026, 0, 15, 12, 0, 0, 0).getTime();
    const next = new Date(2026, 0, 16, 12, 0, 0, 0).getTime();
    expect(startOfToday(next)).toBeGreaterThan(startOfToday(day));
  });
});

describe('formatClockTime', () => {
  it('renders the hour and the minute', () => {
    const text = formatClockTime(new Date(2026, 0, 15, 10, 45).getTime());
    expect(text).toContain('10');
    expect(text).toContain('45');
  });
});