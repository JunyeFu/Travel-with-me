// js/__tests__/storage.test.js

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PREFIX = 'trip-app:';

let store;
let storage;

beforeEach(async () => {
  store = new Map();
  globalThis.localStorage = {
    getItem: vi.fn(key => store.get(key) ?? null),
    setItem: vi.fn((key, value) => store.set(key, String(value))),
    removeItem: vi.fn(key => store.delete(key))
  };
  vi.resetModules();
  storage = await import('../storage.js');
});

afterEach(() => {
  delete globalThis.window;
});

describe('workspace storage reliability', () => {
  it('round trips incomplete visits and failed refresh history but omits pending queries', async () => {
    const workspace = {
      activeTripId: 't',
      trips: [
        {
          id: 't',
          locations: {},
          days: [
            {
              id: 'd',
              events: [{ id: 'a', visit: { min: 30, max: null } }],
              plan: {
                start: { locationId: null, minute: null },
                end: { locationId: null, minute: null },
                legs: [
                  {
                    from: 'start',
                    to: 'a',
                    mode: 'walking',
                    estimate: null,
                    queryState: 'failed',
                    previousEstimate: { status: 'real', seconds: 60, paths: [], fetchedAt: 100 }
                  }
                ]
              }
            }
          ]
        }
      ]
    };
    const restored = storage.parseWorkspaceImport(storage.stringifyWorkspaceExport(workspace));
    expect(restored.ok).toBe(true);
    expect(restored.workspace).toEqual(workspace);
    workspace.trips[0].days[0].plan.legs[0].queryState = 'pending';
    await storage.saveWorkspace(workspace);
    expect(
      JSON.parse(store.get('trip-app:workspace')).workspace.trips[0].days[0].plan.legs[0].queryState
    ).toBeNull();
    expect(storage.stringifyWorkspaceExport(workspace)).not.toContain('pending');
  });
  it('backs up schema 5 and refuses future versions without replacing source', async () => {
    const workspace = { trips: [{ id: 't', days: [], locations: {} }], activeTripId: 't' };
    store.set(`${PREFIX}workspace`, JSON.stringify({ version: 5, workspace }));
    expect(await storage.loadWorkspace()).toEqual(workspace);
    expect(storage.getLastWorkspaceLoadInfo()).toMatchObject({
      status: 'migrated',
      fromVersion: 5
    });
    const future = JSON.stringify({ version: 7, workspace });
    store.set(`${PREFIX}workspace`, future);
    expect(await storage.loadWorkspace()).toBeNull();
    expect(storage.getLastWorkspaceLoadInfo().shouldPersist).toBe(false);
    expect(store.get(`${PREFIX}workspace`)).toBe(future);
    expect(storage.parseWorkspaceImport({ schemaVersion: 7, workspace }).error).toBe(
      'FUTURE_SCHEMA'
    );
  });
  it('round trips plan date and source facts and rejects malformed plans', () => {
    const workspace = {
      trips: [
        {
          id: 't',
          days: [
            {
              id: 'd',
              events: [],
              plan: {
                travelDate: '2026-10-08',
                start: { locationId: null, minute: null },
                end: { locationId: null, minute: null },
                legs: []
              }
            }
          ],
          locations: {}
        }
      ],
      activeTripId: 't'
    };
    expect(
      storage.parseWorkspaceImport(storage.stringifyWorkspaceExport(workspace)).workspace
    ).toEqual(workspace);
    workspace.trips[0].days[0].plan.legs = {};
    expect(storage.parseWorkspaceImport(storage.stringifyWorkspaceExport(workspace)).ok).toBe(
      false
    );
  });
  it('loads old schema workspace and creates recovery snapshot', async () => {
    const workspace = {
      trips: [{ id: 'trip-old', title: '旧行程', days: [], locations: {} }],
      activeTripId: 'trip-old'
    };
    store.set(
      `${PREFIX}workspace`,
      JSON.stringify({
        version: 3,
        savedAt: 1,
        workspace
      })
    );

    const loaded = await storage.loadWorkspace();
    const info = storage.getLastWorkspaceLoadInfo();

    expect(loaded).toEqual(workspace);
    expect(info.status).toBe('migrated');
    expect(info.fromVersion).toBe(3);
    expect(info.recoveryKey).toMatch(/^workspace-recovery:/);
    expect(store.has(`${PREFIX}${info.recoveryKey}`)).toBe(true);
    expect(store.has(`${PREFIX}workspace`)).toBe(true);
  });

  it('does not migrate an old schema when its recovery snapshot cannot be persisted', async () => {
    const raw = JSON.stringify({
      version: 3,
      workspace: {
        trips: [{ id: 'legacy', title: '旧行程', days: [], locations: {} }],
        activeTripId: 'legacy'
      }
    });
    store.set(`${PREFIX}workspace`, raw);
    localStorage.setItem.mockImplementation((key, value) => {
      if (key.startsWith(`${PREFIX}workspace-recovery:`)) {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      }
      store.set(key, String(value));
    });

    expect(await storage.loadWorkspace()).toBeNull();
    expect(storage.getLastWorkspaceLoadInfo()).toMatchObject({
      status: 'recovery-failed',
      error: 'RECOVERY_SNAPSHOT_FAILED',
      sourceStatus: 'migration',
      shouldPersist: false
    });
    expect(store.get(`${PREFIX}workspace`)).toBe(raw);
  });

  it('keeps a recovery snapshot when workspace JSON is broken', async () => {
    const raw = '{not-json';
    store.set(`${PREFIX}workspace`, raw);

    const loaded = await storage.loadWorkspace();
    const info = storage.getLastWorkspaceLoadInfo();

    expect(loaded).toBeNull();
    expect(info.status).toBe('parse-error');
    expect(info.shouldPersist).toBe(false);
    expect(store.has(`${PREFIX}${info.recoveryKey}`)).toBe(true);
    expect(store.get(`${PREFIX}workspace`)).toBe(raw);
  });

  it('blocks startup persistence when the current schema has an invalid workspace shape', async () => {
    const raw = JSON.stringify({
      version: storage.SCHEMA_VERSION,
      workspace: {
        trips: [{ id: 'broken', days: {}, locations: {} }],
        activeTripId: 'broken'
      }
    });
    store.set(`${PREFIX}workspace`, raw);

    const loaded = await storage.loadWorkspace();
    const info = storage.getLastWorkspaceLoadInfo();

    expect(loaded).toBeNull();
    expect(info).toMatchObject({
      status: 'invalid',
      error: 'INVALID_DAYS',
      shouldPersist: false
    });
    expect(info.recoveryKey).toMatch(/^workspace-recovery:/);
    expect(store.get(`${PREFIX}workspace`)).toBe(raw);
  });

  it('reports a blocking load error when broken data cannot be snapshotted', async () => {
    const raw = '{still-not-json';
    store.set(`${PREFIX}workspace`, raw);
    localStorage.setItem.mockImplementation((key, value) => {
      if (key.startsWith(`${PREFIX}workspace-recovery:`)) {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      }
      store.set(key, String(value));
    });

    expect(await storage.loadWorkspace()).toBeNull();
    expect(storage.getLastWorkspaceLoadInfo()).toMatchObject({
      status: 'recovery-failed',
      error: 'RECOVERY_SNAPSHOT_FAILED',
      sourceStatus: 'parse-error',
      shouldPersist: false
    });
    expect(store.get(`${PREFIX}workspace`)).toBe(raw);
  });

  it('exports and parses workspace JSON', () => {
    const workspace = {
      trips: [{ id: 'trip-1', title: '测试行程', days: [], locations: {} }],
      activeTripId: 'trip-1'
    };

    const json = storage.stringifyWorkspaceExport(workspace);
    const parsed = storage.parseWorkspaceImport(json);

    expect(parsed.ok).toBe(true);
    expect(parsed.workspace).toEqual(workspace);
    expect(parsed.meta.format).toBe(storage.EXPORT_FORMAT);
    expect(parsed.meta.schemaVersion).toBe(storage.SCHEMA_VERSION);
  });

  it('summarizes a validated import before replacement', () => {
    const parsed = storage.parseWorkspaceImport({
      format: storage.EXPORT_FORMAT,
      schemaVersion: storage.SCHEMA_VERSION,
      exportedAt: '2026-09-01T02:28:00.000Z',
      workspace: {
        activeTripId: 'trip-1',
        trips: [
          {
            id: 'trip-1',
            title: '北京奇遇',
            days: [
              {
                id: 'day-1',
                title: '古城漫游',
                events: [
                  { id: 'event-1', title: '故宫', locationId: 'loc-1' },
                  { id: 'event-2', title: '景山', locationId: 'loc-2' }
                ]
              }
            ],
            unscheduled: [{ id: 'event-3', title: '鼓楼', locationId: 'loc-3' }],
            locations: {
              'loc-1': { id: 'loc-1', name: '故宫' },
              'loc-2': { id: 'loc-2', name: '景山' },
              'loc-3': { id: 'loc-3', name: '鼓楼' }
            }
          }
        ]
      }
    });

    expect(parsed.ok).toBe(true);
    expect(parsed.summary).toEqual({
      tripCount: 1,
      dayCount: 1,
      scheduledCount: 2,
      unscheduledCount: 1,
      locationCount: 3,
      trips: [
        {
          id: 'trip-1',
          title: '北京奇遇',
          dayCount: 1,
          scheduledCount: 2,
          unscheduledCount: 1,
          locationCount: 3,
          previewPlaces: ['故宫', '景山', '鼓楼']
        }
      ]
    });
  });

  it('rejects invalid import payload', () => {
    expect(storage.parseWorkspaceImport('{bad').error).toBe('INVALID_JSON');
    expect(storage.parseWorkspaceImport({ trips: 'nope' }).error).toBe('INVALID_TRIPS');
    expect(
      storage.parseWorkspaceImport({
        trips: [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }]
      }).error
    ).toBe('TOO_MANY_TRIPS');
    expect(storage.parseWorkspaceImport({ trips: [null] }).error).toBe('INVALID_TRIP');
    expect(storage.parseWorkspaceImport({ trips: [{ days: {} }] }).error).toBe('INVALID_DAYS');
    expect(storage.parseWorkspaceImport({ trips: [{ days: [{ events: 'bad' }] }] }).error).toBe(
      'INVALID_DAY'
    );
    expect(
      storage.parseWorkspaceImport({ trips: [{ days: [], unscheduled: {}, locations: {} }] }).error
    ).toBe('INVALID_UNSCHEDULED');
  });

  it('rejects imported trips with duplicate ids', () => {
    const parsed = storage.parseWorkspaceImport({
      trips: [
        { id: 'same', title: 'A', days: [], locations: {} },
        { id: 'same', title: 'B', days: [], locations: {} }
      ],
      activeTripId: 'same'
    });

    expect(parsed).toMatchObject({ ok: false, error: 'DUPLICATE_TRIP_ID' });
  });

  it('rejects an imported trip with duplicate day ids', () => {
    const parsed = storage.parseWorkspaceImport({
      trips: [
        {
          id: 'trip',
          days: [
            { id: 'same-day', events: [] },
            { id: 'same-day', events: [] }
          ],
          locations: {}
        }
      ],
      activeTripId: 'trip'
    });

    expect(parsed).toMatchObject({ ok: false, error: 'DUPLICATE_DAY_ID' });
  });

  it('rejects duplicate event ids across an imported trip', () => {
    const parsed = storage.parseWorkspaceImport({
      trips: [
        {
          id: 'trip',
          days: [
            { id: 'day-a', events: [{ id: 'same-event', title: 'A' }] },
            { id: 'day-b', events: [{ id: 'same-event', title: 'B' }] }
          ],
          locations: {}
        }
      ],
      activeTripId: 'trip'
    });

    expect(parsed).toMatchObject({ ok: false, error: 'DUPLICATE_EVENT_ID' });
  });

  it('rejects an event id duplicated between a day and the unscheduled list', () => {
    const parsed = storage.parseWorkspaceImport({
      trips: [
        {
          id: 'trip',
          days: [{ id: 'day-a', events: [{ id: 'same-event', title: 'A' }] }],
          unscheduled: [{ id: 'same-event', title: 'B' }],
          locations: {}
        }
      ],
      activeTripId: 'trip'
    });

    expect(parsed).toMatchObject({ ok: false, error: 'DUPLICATE_EVENT_ID' });
  });

  it('imports workspace and snapshots previous local data', async () => {
    await storage.saveWorkspace({
      trips: [{ id: 'old', title: '旧', days: [], locations: {} }],
      activeTripId: 'old'
    });

    const nextWorkspace = {
      trips: [{ id: 'new', title: '新', days: [], locations: {} }],
      activeTripId: 'new'
    };
    const result = await storage.importWorkspace(nextWorkspace);
    const loaded = await storage.loadWorkspace();

    expect(result.ok).toBe(true);
    expect(result.recoveryKey).toMatch(/^workspace-recovery:/);
    expect(store.has(`${PREFIX}${result.recoveryKey}`)).toBe(true);
    expect(loaded).toEqual(nextWorkspace);
  });

  it('keeps the current workspace when its recovery snapshot cannot be persisted', async () => {
    const currentWorkspace = {
      trips: [{ id: 'current', title: '当前行程', days: [], locations: {} }],
      activeTripId: 'current'
    };
    await storage.saveWorkspace(currentWorkspace);
    localStorage.setItem.mockImplementation((key, value) => {
      if (key.startsWith(`${PREFIX}workspace-recovery:`)) {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      }
      store.set(key, String(value));
    });

    const result = await storage.importWorkspace({
      trips: [{ id: 'replacement', title: '替换行程', days: [], locations: {} }],
      activeTripId: 'replacement'
    });

    expect(result).toMatchObject({ ok: false, error: 'RECOVERY_SNAPSHOT_FAILED' });
    expect(await storage.loadWorkspace()).toEqual(currentWorkspace);
  });

  it('reports a durable-write failure and reads the newer memory fallback', async () => {
    store.set(
      `${PREFIX}workspace`,
      JSON.stringify({
        version: storage.SCHEMA_VERSION,
        workspace: { trips: [{ id: 'old' }], activeTripId: 'old' }
      })
    );
    localStorage.setItem.mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });

    const nextWorkspace = { trips: [{ id: 'new' }], activeTripId: 'new' };
    const saved = await storage.saveWorkspace(nextWorkspace);
    const loaded = await storage.loadWorkspace();

    expect(saved).toMatchObject({ ok: false, error: 'PERSISTENCE_UNAVAILABLE' });
    expect(loaded).toEqual(nextWorkspace);
  });

  it('does not resurrect a durable workspace after removal fails', async () => {
    const workspace = {
      trips: [{ id: 'old', title: '旧行程', days: [], locations: {} }],
      activeTripId: 'old'
    };
    await storage.saveWorkspace(workspace);
    localStorage.removeItem.mockImplementation(() => {
      throw new DOMException('access denied', 'SecurityError');
    });

    expect(await storage.clearWorkspace()).toMatchObject({
      ok: false,
      error: 'PERSISTENCE_UNAVAILABLE'
    });
    expect(await storage.loadWorkspace()).toBeNull();
  });
});

describe('shared trip input boundary', () => {
  it('accepts only object-shaped trips from the URL hash', async () => {
    const { readSharedTripFromURL } = await import('../share.js');
    const encode = value => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

    globalThis.window = { location: { hash: `#trip=${encode({ id: 'shared', title: '分享' })}` } };
    expect(readSharedTripFromURL()).toEqual({ id: 'shared', title: '分享' });

    window.location.hash = `#trip=${encode('not-a-trip')}`;
    expect(readSharedTripFromURL()).toBeNull();

    window.location.hash = `#trip=${encode([{ id: 'array-trip' }])}`;
    expect(readSharedTripFromURL()).toBeNull();
  });
});
