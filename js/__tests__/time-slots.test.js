// js/__tests__/time-slots.test.js

import { describe, it, expect } from 'vitest';
import {
  normalizeTimeSlot,
  getTimeSlotLabel,
  getTimeSlotRank,
  getTimeSlotHour
} from '../time-slots.js';
import { getRouteDaylightColor, ROUTE_GUIDANCE } from '../route-guidance.js';

describe('normalizeTimeSlot', () => {
  it('returns valid time slots as-is', () => {
    expect(normalizeTimeSlot('morning')).toBe('morning');
    expect(normalizeTimeSlot('evening')).toBe('evening');
  });

  it('returns empty string for invalid values', () => {
    expect(normalizeTimeSlot('breakfast')).toBe('');
    expect(normalizeTimeSlot('')).toBe('');
    expect(normalizeTimeSlot(null)).toBe('');
  });
});

describe('getTimeSlotLabel', () => {
  it('returns Chinese label for known slots', () => {
    expect(getTimeSlotLabel('morning')).toBe('上午');
    expect(getTimeSlotLabel('evening')).toBe('晚上');
  });

  it('returns "未定" for empty/unknown', () => {
    expect(getTimeSlotLabel('')).toBe('未定');
    expect(getTimeSlotLabel('unknown')).toBe('未定');
  });
});

describe('getTimeSlotRank', () => {
  it('morning < noon < afternoon < evening < empty', () => {
    expect(getTimeSlotRank('morning')).toBeLessThan(getTimeSlotRank('noon'));
    expect(getTimeSlotRank('noon')).toBeLessThan(getTimeSlotRank('afternoon'));
    expect(getTimeSlotRank('afternoon')).toBeLessThan(getTimeSlotRank('evening'));
    expect(getTimeSlotRank('evening')).toBeLessThan(getTimeSlotRank(''));
  });
});

describe('route daylight mapping', () => {
  it('uses representative hours for the existing time slots without assigning an unknown time', () => {
    expect(['morning', 'noon', 'afternoon', 'evening', ''].map(getTimeSlotHour)).toEqual([
      9,
      12,
      15,
      20,
      null
    ]);
    expect(getRouteDaylightColor(null)).toBe('#6E6A63');
  });

  it('keeps pre-sunrise mornings and post-sunset hours blue, with neutral yellow at noon', () => {
    for (const hour of [0, 4, 5, 6, 18, 20, 23, 24]) {
      expect(getRouteDaylightColor(hour)).toBe('#86B8DB');
    }
    expect(getRouteDaylightColor(12)).toBe('#DDD394');
    expect(getRouteDaylightColor(9)).toBe('#C7CCA6');
    expect(getRouteDaylightColor(15)).toBe(getRouteDaylightColor(9));
  });

  it('maps all 24 hours to exactly five fixed daylight colors', () => {
    const palette = ['#86B8DB', '#9CBDC9', '#B2C6B8', '#C7CCA6', '#DDD394'];
    const levels = [0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 4, 4, 4, 3, 3, 2, 1, 0, 0, 0, 0, 0, 0];
    const colors = Array.from({ length: 24 }, (_, hour) => getRouteDaylightColor(hour));
    expect(colors).toEqual(levels.map(level => palette[level]));
    expect(new Set(colors).size).toBe(5);
  });

  it('preserves the original default, selected and dimmed rendering parameters', () => {
    expect(ROUTE_GUIDANCE.default).toEqual({ strokeWeight: 7, strokeOpacity: 0.96, zIndex: 200 });
    expect(ROUTE_GUIDANCE.active).toEqual({ strokeWeight: 9, strokeOpacity: 1, zIndex: 220 });
    expect(ROUTE_GUIDANCE.dim).toEqual({ strokeWeight: 5, strokeOpacity: 0.32, zIndex: 100 });
  });
});
