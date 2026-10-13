import { describe, expect, it } from 'vitest';
import {
  evaluateDayPlan,
  reconcilePlan,
  shortenVisits,
  formatPlanTime,
  describeGuideTime
} from '../day-plan.js';
import { normalizeGuideTimeFacts } from '../../server/guide-time.js';

const day = () => ({
  id: 'd',
  events: [
    { id: 'a', locationId: 'museum', visit: { min: 60, max: 90 } },
    { id: 'b', locationId: 'street', visit: { min: 30, max: 45 } }
  ],
  plan: {
    start: { locationId: 'hotel', minute: 540 },
    end: { locationId: 'station', minute: 720 },
    legs: [
      ['start', 'a', 1200],
      ['a', 'b', 1800],
      ['b', 'end', 1500]
    ].map(([from, to, seconds]) => ({
      from,
      to,
      mode: 'walking',
      estimate: { status: 'real', seconds }
    }))
  }
});

describe('daily time assessment', () => {
  it('keeps gate-side activity duration, exact target margins and inclusive totals without double counting', () => {
    expect(
      normalizeGuideTimeFacts(
        { activity_type: '馆门口拍照', duration_min: 20, duration_max: 20 },
        0
      )
    ).toMatchObject({ activity: '馆门口拍照', duration: { min: 20, max: 20 } });
    const input = day();
    input.plan.end.minute = 690;
    expect(evaluateDayPlan(input)).toMatchObject({ status: 'overrun', slack: [-3600, -900] });
    input.plan.end.minute = 780;
    expect(evaluateDayPlan(input).slack).toEqual([1800, 4500]);
    input.plan.start.minute = 1320;
    input.plan.end.minute = 1500;
    expect(evaluateDayPlan(input)).toMatchObject({
      status: 'possible-overrun',
      slack: [-1800, 900]
    });
    input.plan.legs.forEach((leg, i) => {
      leg.estimate.seconds = i === 0 ? 2400 : 0;
    });
    input.events[0].visit = { min: 120, max: 120 };
    input.events[1].visit = { min: 0, max: 0 };
    expect(evaluateDayPlan(input)).toMatchObject({ travelSeconds: 2400, activity: [7200, 7200] });
  });
  it('keeps an already-missed appointment after adopting a shorter visit', () => {
    const input = day();
    input.events[0].fixedStart = 550;
    input.plan.end.minute = 780;
    expect(evaluateDayPlan(shortenVisits(input, 'a'))).toMatchObject({
      status: 'within-window',
      conflicts: [{ eventId: 'a', late: [600, 600] }]
    });
  });
  it('keeps known arrivals when only the second visit is missing', () => {
    const input = day();
    input.events[1].visit = null;
    expect(evaluateDayPlan(input)).toMatchObject({
      status: 'incomplete',
      completion: null,
      stops: [
        { arrival: [33600, 33600], departure: [37200, 39000] },
        { arrival: [39000, 40800], departure: [null, null] }
      ]
    });
    expect(describeGuideTime(evaluateDayPlan(input).stops[0], 540)).toContain('晚20分钟（仅对照）');
    expect(describeGuideTime({ arrival: [null, null] }, 540)).toContain('原文 09:00（仅对照）');
    expect(describeGuideTime({ arrival: [540 * 60, 540 * 60] }, 540)).toContain('一致（仅对照）');
  });
  it('only truncates after a missing middle leg, and keeps a known late appointment', () => {
    const input = day();
    input.events[0].fixedStart = 550;
    input.plan.legs[1].estimate = null;
    expect(evaluateDayPlan(input)).toMatchObject({
      status: 'incomplete',
      stops: [
        { arrival: [33600, 33600], departure: [37200, 39000] },
        { arrival: [null, null], departure: [null, null] }
      ],
      conflicts: [{ eventId: 'a', late: [600, 600] }]
    });
  });
  it('missing end settings do not erase earlier stops or anchor unknown arrivals at an appointment', () => {
    const input = day();
    input.plan.end.locationId = null;
    input.plan.end.minute = null;
    expect(evaluateDayPlan(input).stops[1].departure).toEqual([40800, 43500]);
    input.plan.legs[1].estimate = null;
    input.events[1].fixedStart = 700;
    expect(evaluateDayPlan(input).stops[1].start).toEqual([null, null]);
  });
  it('does not turn a partial duration into zero or a single-valued adopted visit', () => {
    const input = day();
    input.events[1].visit = { min: 30, max: null };
    expect(evaluateDayPlan(input).status).toBe('incomplete');
    expect(evaluateDayPlan(input).stops[1].arrival).toEqual([39000, 40800]);
  });
  it('reconciliation keeps history and invalidates changed coordinates or transit preference', () => {
    const locations = { hotel: { lnglat: [1, 2] }, museum: { lnglat: [3, 4] } };
    const input = day(),
      plan = reconcilePlan(input, input.plan);
    plan.legs[0].estimate = {
      status: 'real',
      seconds: 1200,
      query: { from: [1, 2], to: [3, 4], mode: 'walking' },
      fetchedAt: 10
    };
    expect(reconcilePlan(input, plan, locations).legs[0].estimate.seconds).toBe(1200);
    locations.museum.lnglat = [5, 6];
    const changed = reconcilePlan(input, plan, locations).legs[0];
    expect(changed.estimate).toBeNull();
    expect(changed.previousEstimate.fetchedAt).toBe(10);
    locations.museum.lnglat = [3, 4];
    plan.legs[0].transitPreference = 'subway';
    expect(reconcilePlan(input, plan, locations).legs[0].estimate).toBeNull();
  });
  it('rejects inverted visits, negative route duration and a missing leg', () => {
    for (const mutate of [
      d => (d.events[0].visit = { min: 90, max: 60 }),
      d => (d.plan.legs[0].estimate.seconds = -1),
      d => d.plan.legs.pop()
    ]) {
      const input = day();
      mutate(input);
      expect(evaluateDayPlan(input).status).toBe('incomplete');
    }
  });
  it('distinguishes no plan, explicit midnight and unconditional overrun', () => {
    expect(evaluateDayPlan({ events: [] })).toBeNull();
    const input = day();
    input.plan.start.minute = 1410;
    input.plan.end.minute = 1500;
    expect(evaluateDayPlan(input).status).toBe('overrun');
    input.plan.end.minute = 60;
    expect(evaluateDayPlan(input).status).toBe('incomplete');
  });
  it('keeps accepted transit preference and invalidates changed endpoint estimates', () => {
    const input = {
      events: [
        {
          id: 'a',
          locationId: 'x',
          sourceFacts: { transport: { mode: 'transit', preference: 'subway' } }
        }
      ]
    };
    const plan = reconcilePlan(input, { start: { locationId: 's' }, end: { locationId: 'e' } });
    plan.legs[1].transitPreference = null;
    plan.legs[1].estimate = { status: 'real', seconds: 5 };
    expect(reconcilePlan(input, plan).legs[1].transitPreference).toBeNull();
    input.events[0].locationId = 'y';
    expect(reconcilePlan(input, plan).legs[1].estimate).toBeNull();
  });
  it('does not turn vague time or missing transport into precise facts', () => {
    expect(
      normalizeGuideTimeFacts(
        { time_text: '下午随后', arrival_time: '下午', duration_min: 60, duration_max: 90 },
        2
      )
    ).toMatchObject({ order: 2, arrival: null, duration: { min: 60, max: 90 }, transport: null });
    expect(normalizeGuideTimeFacts({ arrival_time: '25:10' }, 0).arrival).toBeNull();
  });
  it('includes both terminal legs and reports the independently worked interval', () => {
    expect(evaluateDayPlan(day())).toMatchObject({
      status: 'possible-overrun',
      completion: [42300, 45000],
      travelSeconds: 4500
    });
  });
  it('applies shorter visits without mutating the original and has zero high-case slack', () => {
    const original = day();
    const changed = shortenVisits(original, 'a');
    expect(evaluateDayPlan(changed)).toMatchObject({
      status: 'within-window',
      completion: [42300, 43200],
      slack: [0, 900]
    });
    expect(original.events[0].visit.max).toBe(90);
  });
  it('counts appointment wait, and reports late appointments even if the day fits', () => {
    const input = day();
    input.events[0].fixedStart = 600;
    expect(evaluateDayPlan(input).completion).toEqual([44700, 47400]);
    input.events[0].fixedStart = 550;
    input.plan.end.minute = 900;
    expect(evaluateDayPlan(input)).toMatchObject({
      status: 'within-window',
      conflicts: [expect.objectContaining({ eventId: 'a' })]
    });
  });
  it('does not treat missing duration or a rough route as zero', () => {
    const input = day();
    input.events[0].visit = null;
    expect(evaluateDayPlan(input).status).toBe('incomplete');
    input.events[0].visit = { min: 60, max: 90 };
    input.plan.legs[0].estimate.status = 'rough';
    expect(evaluateDayPlan(input).status).toBe('incomplete');
  });
  it('supports explicit next-day end, second precision, and a missing window', () => {
    expect(formatPlanTime(90000)).toBe('次日 01:00');
    const input = day();
    input.plan.legs[0].estimate.seconds = 1201;
    expect(evaluateDayPlan(input).completion[0]).toBe(42301);
    input.plan.end.minute = null;
    expect(evaluateDayPlan(input).status).toBe('incomplete');
  });
  it('preserves valid neighboring legs, removes obsolete legs, and never selects an automatic legacy mode', () => {
    const input = {
      events: [
        { id: 'a', locationId: 'x', routeToNext: { mode: 'driving' } },
        { id: 'b', locationId: 'x' }
      ]
    };
    const plan = reconcilePlan(input, {
      start: { locationId: 'x' },
      end: { locationId: 'x' },
      legs: []
    });
    expect(plan.legs).toHaveLength(3);
    expect(plan.legs[1].mode).toBeNull();
    expect(plan.legs[1].legacyMode).toBe('driving');
  });
});
