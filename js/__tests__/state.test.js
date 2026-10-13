// js/__tests__/state.test.js

import { describe, it, expect, beforeEach } from 'vitest';

// state.js mutates module-level variables; import once per describe to start fresh
// Each test block re-imports the module via dynamic import

/** @type {typeof import('../state.js')} */
let state;

beforeEach(async () => {
  // Dynamic import gives a fresh module instance each test (Vitest isolates modules per test file)
  state = await import('../state.js');
  // Initialize with null workspace to get default demo trip
  state.initWorkspace(null, null);
});

describe('createTrip', () => {
  it('creates a new trip with title and one default day', () => {
    state.initWorkspace({ trips: [], activeTripId: null });
    const id = state.createTrip('我的旅行');
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
    expect(id.startsWith('trip-')).toBe(true);

    const trip = state.getTrip();
    expect(trip.title).toBe('我的旅行');
    expect(trip.days.length).toBe(1);
  });

  it('rejects when max trips reached', () => {
    state.initWorkspace({ trips: [], activeTripId: null });
    state.createTrip('Trip 1');
    state.createTrip('Trip 2');
    state.createTrip('Trip 3');
    expect(state.createTrip('Trip 4')).toBeNull();
  });
});

describe('workspace data integrity', () => {
  it('keeps adopted order, date and repeated-place legs through normalization', () => {
    state.initWorkspace({
      activeTripId: 't',
      trips: [
        {
          id: 't',
          locations: { x: { name: '同一地点', lnglat: [120, 30] } },
          days: [
            {
              id: 'd',
              events: [
                { id: 'late', locationId: 'x', timeSlot: 'evening', visit: { min: 20, max: 30 } },
                { id: 'early', locationId: 'x', timeSlot: 'morning' }
              ],
              plan: {
                travelDate: '2026-10-08',
                start: { locationId: 'x', minute: 540 },
                end: { locationId: 'x', minute: 720 },
                legs: []
              }
            }
          ]
        }
      ]
    });
    state.updateEventInDay('d', 'late', { timeSlot: 'afternoon' });
    const saved = structuredClone(state.getWorkspace());
    state.initWorkspace(saved);
    const day = state.getTrip().days[0];
    expect(day.events.map(e => e.id)).toEqual(['late', 'early']);
    expect(day.plan.travelDate).toBe('2026-10-08');
    expect(day.plan.legs).toHaveLength(3);
    expect(day.plan.legs.every(l => l.mode === null)).toBe(true);
    state.cachePlanRoute('d', 'start', 'late', { status: 'real', seconds: 60, paths: [] });
    state.updateLocation('x', { name: '改名，不改变地点' });
    expect(day.plan.legs[0].estimate?.seconds).toBe(60);
    state.updateLocation('x', { lnglat: [121, 31] });
    expect(day.plan.legs[0].estimate).toBeNull();
    expect(day.plan.legs[0].previousEstimate.seconds).toBe(60);
    state.cachePlanRoute('d', 'start', 'late', null, 'failed');
    expect(day.plan.legs[0].queryState).toBe('failed');
    expect(day.plan.legs[0].previousEstimate.seconds).toBe(60);
  });
  it('never deletes persisted demo-trip edits during normalization', () => {
    state.initWorkspace({
      trips: [
        {
          id: 'demo-trip-bj-may',
          title: '我的北京行程',
          locations: {
            custom: {
              name: '咖啡馆',
              lnglat: [120, 30],
              resolved: true
            }
          },
          days: [
            {
              id: 'day-1',
              title: '接站与安顿',
              events: [{ id: 'custom-event', title: '和男朋友喝咖啡', locationId: 'custom' }]
            }
          ]
        }
      ],
      activeTripId: 'demo-trip-bj-may'
    });

    expect(state.getLocation('custom')).toMatchObject({ lnglat: [120, 30], resolved: true });
    expect(state.getTrip().days[0].events).toEqual([
      expect.objectContaining({ id: 'custom-event', title: '和男朋友喝咖啡' })
    ]);
  });

  it('refuses a shared trip when all local slots are occupied', () => {
    const saved = {
      trips: ['a', 'b', 'c'].map(id => ({ id, title: id, locations: {}, days: [] })),
      activeTripId: 'b'
    };

    const result = state.initWorkspace(saved, {
      id: 'shared',
      title: '分享行程',
      locations: {},
      days: []
    });

    expect(result).toMatchObject({ ok: false, error: 'WORKSPACE_FULL' });
    expect(state.getWorkspace().trips.map(item => item.id)).toEqual(['a', 'b', 'c']);
    expect(state.getWorkspace().activeTripId).toBe('b');
  });

  it('preserves local edits when a shared trip has an existing id', () => {
    const result = state.initWorkspace(
      {
        trips: [{ id: 'same', title: '本地编辑', locations: {}, days: [] }],
        activeTripId: 'same'
      },
      { id: 'same', title: '链接原文', locations: {}, days: [] }
    );

    expect(result).toMatchObject({ ok: false, error: 'SHARED_TRIP_EXISTS' });
    expect(state.getTrip().title).toBe('本地编辑');
  });

  it('repairs duplicate trip ids so every saved trip remains reachable', () => {
    state.initWorkspace({
      trips: [
        { id: 'same', title: 'A', locations: {}, days: [] },
        { id: 'same', title: 'B', locations: {}, days: [] }
      ],
      activeTripId: 'same'
    });

    const trips = state.getWorkspace().trips;
    expect(new Set(trips.map(item => item.id)).size).toBe(2);
    expect(state.switchTrip(trips[1].id)).toBe(true);
    expect(state.getTrip().title).toBe('B');
  });

  it('repairs duplicate day and event ids in saved trip data', () => {
    state.initWorkspace({
      trips: [
        {
          id: 'trip',
          title: '历史行程',
          locations: {},
          days: [
            { id: 'same-day', title: 'A', events: [{ id: 'same-event', title: 'A1' }] },
            { id: 'same-day', title: 'B', events: [{ id: 'same-event', title: 'B1' }] }
          ],
          unscheduled: [{ id: 'same-event', title: 'U1' }]
        }
      ],
      activeTripId: 'trip'
    });

    const normalized = state.getTrip();
    const eventIds = [
      ...normalized.days.flatMap(day => day.events.map(event => event.id)),
      ...normalized.unscheduled.map(event => event.id)
    ];
    expect(new Set(normalized.days.map(day => day.id)).size).toBe(2);
    expect(new Set(eventIds).size).toBe(3);
    expect(state.getDay(normalized.days[1].id).title).toBe('B');
  });

  it('returns a historically resolved location with invalid coordinates to pending resolution', () => {
    state.initWorkspace({
      trips: [
        {
          id: 'trip',
          title: '历史行程',
          locations: {
            broken: { name: '坏坐标', lnglat: [999, 39.9], resolved: true }
          },
          days: []
        }
      ],
      activeTripId: 'trip'
    });

    expect(state.getLocation('broken')).toMatchObject({ name: '坏坐标', resolved: false });
    expect(state.getLocation('broken').lnglat).toBeUndefined();
  });

  it('applies an async location result to the trip that started the request', () => {
    state.initWorkspace({
      trips: [
        { id: 'a', title: 'A', locations: { place: { name: 'A 地点' } }, days: [] },
        { id: 'b', title: 'B', locations: { place: { name: 'B 地点' } }, days: [] }
      ],
      activeTripId: 'a'
    });
    state.switchTrip('b');

    expect(state.updateLocationForTrip('a', 'place', { lnglat: [121, 31] })).toBe(true);
    expect(state.getTrip().locations.place.lnglat).toBeUndefined();
    expect(state.getWorkspace().trips[0].locations.place.lnglat).toEqual([121, 31]);
  });
});

describe('batched trip changes', () => {
  it('emits one render-driving change for a bulk import', () => {
    const changes = [];
    const unsubscribe = state.on('trip:changed', payload => changes.push(payload));

    state.batchTripChanges(() => {
      state.updateTripMeta({ city: '上海市' });
      state.addDay({ title: '第二天' });
      state.addDay({ title: '第三天' });
    });
    unsubscribe();

    expect(changes).toEqual([{ kind: 'batch:changed' }]);
  });
});

describe('addDay', () => {
  it('adds a day to the active trip', () => {
    const dayId = state.addDay({ title: '新的一天' });
    expect(dayId).toBeTruthy();
    expect(state.getTrip().days.length).toBeGreaterThan(1);
  });
});

describe('addEventToDay', () => {
  it('persists a resolved location source for the 2D map data contract', () => {
    const locationId = state.addLocation({
      name: 'Provider place',
      addr: 'Provider address',
      lnglat: [116.4, 39.9],
      source: 'amap-web-service'
    });

    expect(state.getLocation(locationId)).toMatchObject({
      lnglat: [116.4, 39.9],
      source: 'amap-web-service'
    });
  });

  it('does not mark a location without coordinates as resolved', () => {
    const locationId = state.addLocation({ name: '待解析地点' });
    expect(state.getLocation(locationId)).toMatchObject({ resolved: false });
  });

  it('adds an event to a specific day', () => {
    const trip = state.getTrip();
    const day = trip.days[0];
    const locId = state.addLocation({ name: '测试地点', addr: '测试地址', lnglat: [116.4, 39.9] });
    const eventId = state.addEventToDay(day.id, {
      title: '参观测试',
      locationId: locId,
      timeSlot: 'morning'
    });
    expect(eventId).toBeTruthy();
    const updatedDay = state.getDay(day.id);
    expect(updatedDay.events.length).toBeGreaterThan(0);
    expect(updatedDay.events.find(e => e.id === eventId)?.title).toBe('参观测试');
  });

  it('adds event without timeSlot', () => {
    const trip = state.getTrip();
    const day = trip.days[0];
    const locId = state.addLocation({ name: '无时间地点', addr: '某处', lnglat: [116.4, 39.9] });
    const eventId = state.addEventToDay(day.id, { title: '自由活动', locationId: locId });
    expect(eventId).toBeTruthy();
  });
});

describe('removeEventFromDay', () => {
  it('removes an existing event', () => {
    const trip = state.getTrip();
    const day = trip.days[0];
    const eventsBefore = day.events.length;
    if (eventsBefore === 0) return; // skip if demo trip has no events
    const eventId = day.events[0].id;
    const removed = state.removeEventFromDay(day.id, eventId);
    expect(removed).toBe(true);
    expect(state.getDay(day.id).events.length).toBe(eventsBefore - 1);
  });
});

describe('moveEventBetweenContainers', () => {
  it('moves event between unscheduled and a day', () => {
    const trip = state.getTrip();
    const day = trip.days[0];
    const locId = state.addLocation({ name: '未排期地点', addr: '测试', lnglat: [116.4, 39.9] });
    const eventId = state.addUnscheduledEvent({ title: '候补', locationId: locId });
    expect(eventId).toBeTruthy();

    const moved = state.moveEventBetweenContainers(eventId, { dayId: day.id });
    expect(moved).toBe(true);
    expect(state.getDay(day.id).events.find(e => e.id === eventId)).toBeTruthy();
  });
});

describe('getAppState', () => {
  it('returns runtime state object', () => {
    const appState = state.getAppState();
    expect(appState).toBeDefined();
    expect(appState.activeDayId).toBe('all');
  });

  it('remembers the active day independently for each trip during the session', () => {
    state.initWorkspace({
      trips: [
        { id: 'a', title: 'A', locations: {}, days: [{ id: 'a-day', events: [] }] },
        { id: 'b', title: 'B', locations: {}, days: [{ id: 'b-day', events: [] }] }
      ],
      activeTripId: 'a'
    });

    state.setActiveDayId('a-day');
    state.switchTrip('b');
    state.setActiveDayId('b-day');

    expect(state.getRememberedDayId('a')).toBe('a-day');
    expect(state.getRememberedDayId('b')).toBe('b-day');
  });

  it('keeps one exclusive runtime selection and clears it explicitly', () => {
    state.setSelectedTarget({ kind: 'place', dayId: 'day-1', eventId: 'event-1' });
    expect(state.getAppState().selectedTarget).toEqual({
      kind: 'place',
      dayId: 'day-1',
      eventId: 'event-1'
    });

    state.setSelectedTarget({ kind: 'route', dayId: 'day-1', segmentId: 'segment-1' });
    expect(state.getAppState().selectedTarget).toEqual({
      kind: 'route',
      dayId: 'day-1',
      segmentId: 'segment-1'
    });

    state.clearSelectedTarget();
    expect(state.getAppState().selectedTarget).toBeNull();
  });
});
