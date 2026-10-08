// js/__tests__/routing.test.js

import { afterEach, describe, it, expect, vi } from 'vitest';
import { buildEstimatedResult, searchRoute, createRouteService } from '../api/routing.js';
import { normalizeRouteGeometry } from '../route-config.js';

afterEach(() => vi.unstubAllGlobals());

describe('route truth contract', () => {
  const segment = {
    fromLngLat: [120.1, 30.2],
    toLngLat: [120.3, 30.4],
    fromCity: '杭州',
    toCity: '杭州',
    mode: 'driving'
  };
  const respond = payload =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => payload }))
    );
  const line = '120.1,30.2;120.2,30.3';

  it('uses endpoint cities for BFF and SDK without attaching a second renderer', async () => {
    respond({
      status: '1',
      route: { transits: [{ segments: [{ bus: { buslines: [{ name: 'A', polyline: line }] } }] }] }
    });
    const crossCity = { ...segment, mode: 'transit', toCity: '绍兴' };
    await searchRoute(null, null, crossCity);
    const url = new URL(fetch.mock.calls[0][0], 'http://localhost');
    expect(url.searchParams.get('city')).toBe('杭州');
    expect(url.searchParams.get('cityd')).toBe('绍兴');
    class Transfer {
      constructor(options) {
        this.options = options;
      }
    }
    const service = createRouteService({ Transfer }, {}, 'transit', crossCity);
    expect(service.options).toMatchObject({ city: '杭州', cityd: '绍兴', map: null });
    expect(createRouteService({ Transfer }, {}, 'transit')).toBeNull();
  });

  it('does not invent a city for transit', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    const result = await searchRoute(null, null, { ...segment, mode: 'transit', fromCity: '' });
    expect(result).toMatchObject({ ok: false, estimated: true });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([[[]], [[{ polyline: line }, {}]]])(
    'does not call missing or partial geometry real: %j',
    async steps => {
      respond({ status: '1', route: { paths: [{ distance: 1200, duration: 200, steps }] } });
      expect(await searchRoute(null, null, segment)).toMatchObject({ ok: false, estimated: true });
    }
  );

  it('selects one bus candidate consistently and does not join gaps', async () => {
    respond({
      status: '1',
      route: {
        transits: [
          {
            segments: [
              {
                bus: {
                  buslines: [
                    { name: 'A', polyline: line },
                    { name: 'B', polyline: '121,31;122,32' }
                  ]
                }
              },
              { walking: { steps: [{ polyline: '120.25,30.35;120.3,30.4' }] } }
            ]
          }
        ]
      }
    });
    const result = await searchRoute(null, null, { ...segment, mode: 'transit' });
    expect(result).toMatchObject({
      ok: true,
      source: 'amap-web-service',
      detail: { transitBoardings: 1, transitTransfers: 0, steps: ['乘坐 A'] }
    });
    expect(result.paths).toEqual([
      [
        [120.1, 30.2],
        [120.2, 30.3]
      ],
      [
        [120.25, 30.35],
        [120.3, 30.4]
      ]
    ]);
  });

  it('ignores the empty railway placeholder returned by the real BFF', async () => {
    respond({
      status: '1',
      route: {
        transits: [
          {
            segments: [
              {
                railway: { via_stops: [], alters: [], spaces: [] },
                bus: { buslines: [{ name: 'A', polyline: line }] }
              }
            ]
          }
        ]
      }
    });
    const result = await searchRoute(null, null, { ...segment, mode: 'transit' });
    expect(result).toMatchObject({
      ok: true,
      detail: { transitBoardings: 1, transitTransfers: 0 }
    });
  });

  it('does not label missing railway geometry as real', async () => {
    respond({
      status: '1',
      route: {
        transits: [
          { segments: [{ bus: { buslines: [{ polyline: line }] } }, { railway: { name: '高铁' } }] }
        ]
      }
    });
    expect(await searchRoute(null, null, { ...segment, mode: 'transit' })).toMatchObject({
      ok: false,
      estimated: true
    });
  });

  it('uses SDK full geometry once, or preserves all ordered steps with SDK provenance', async () => {
    respond({ status: '0' });
    class LngLat {
      constructor(lng, lat) {
        this.lng = lng;
        this.lat = lat;
      }
    }
    const steps = [
      {
        path: [
          [120.1, 30.2],
          [120.2, 30.3]
        ]
      },
      {
        path: [
          [120.2, 30.3],
          [120.3, 30.4]
        ]
      }
    ];
    const service = route => ({
      search: (_a, _b, _options, cb) => cb('complete', { routes: [route] })
    });
    const result = await searchRoute({ LngLat }, service({ steps }), segment);
    expect(result.source).toBe('amap-js-sdk');
    expect(result.paths).toEqual([
      [
        [120.1, 30.2],
        [120.2, 30.3],
        [120.3, 30.4]
      ]
    ]);
    const full = [
      [120.1, 30.2],
      [120.3, 30.4]
    ];
    expect((await searchRoute({ LngLat }, service({ path: full, steps }), segment)).paths).toEqual([
      full
    ]);
  });

  it('extracts native SDK transit.path without counting candidate lines as transfers', async () => {
    respond({ status: '0' });
    class LngLat {}
    const service = {
      search: (_a, _b, cb) =>
        cb('complete', {
          plans: [
            {
              segments: [
                {
                  transit_mode: 'BUS',
                  transit: {
                    path: [
                      [120.1, 30.2],
                      [120.3, 30.4]
                    ],
                    lines: [{ name: 'A' }, { name: 'B' }]
                  }
                }
              ]
            }
          ]
        })
    };
    const result = await searchRoute({ LngLat }, service, { ...segment, mode: 'transit' });
    expect(result).toMatchObject({
      ok: true,
      source: 'amap-js-sdk',
      detail: { transitBoardings: 1 }
    });
    expect(result.paths).toHaveLength(1);
    expect(result.detail.steps).toEqual(['乘坐 A']);
  });

  it('preserves more than eight separate paths in persisted geometry', () => {
    const paths = Array.from({ length: 10 }, (_, i) => [
      [120 + i / 100, 30],
      [120 + i / 100, 30.01]
    ]);
    expect(normalizeRouteGeometry({ source: 'amap-js-sdk', mode: 'walking', paths }).paths).toEqual(
      paths
    );
  });
});

describe('buildEstimatedResult', () => {
  const baseSegment = mode => ({
    fromLngLat: [116.4, 39.9],
    toLngLat: [116.5, 40.0],
    mode,
    routeToNext: { mode }
  });

  it('produces estimated result with distance and duration', () => {
    const result = buildEstimatedResult(baseSegment('driving'));
    expect(result.ok).toBe(false);
    expect(result.estimated).toBe(true);
    expect(result.detail.distance).toBeGreaterThan(0);
    expect(result.detail.duration).toBeGreaterThan(0);
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]).toHaveLength(2);
  });

  it('walking duration > driving duration for same distance', () => {
    const driving = buildEstimatedResult(baseSegment('driving'));
    const walking = buildEstimatedResult(baseSegment('walking'));
    expect(driving.detail.distance).toBe(walking.detail.distance);
    expect(walking.detail.duration).toBeGreaterThan(driving.detail.duration);
  });

  it('riding speed is between walking and driving', () => {
    const w = buildEstimatedResult(baseSegment('walking'));
    const r = buildEstimatedResult(baseSegment('riding'));
    const d = buildEstimatedResult(baseSegment('driving'));
    expect(r.detail.duration).toBeGreaterThan(d.detail.duration);
    expect(r.detail.duration).toBeLessThan(w.detail.duration);
  });

  it('distance is symmetric', () => {
    const a = buildEstimatedResult({
      fromLngLat: [116.4, 39.9],
      toLngLat: [116.5, 40.0],
      mode: 'driving',
      routeToNext: { mode: 'driving' }
    });
    const b = buildEstimatedResult({
      fromLngLat: [116.5, 40.0],
      toLngLat: [116.4, 39.9],
      mode: 'driving',
      routeToNext: { mode: 'driving' }
    });
    expect(a.detail.distance).toBe(b.detail.distance);
  });

  it('same point returns distance 0', () => {
    const result = buildEstimatedResult({
      fromLngLat: [116.4, 39.9],
      toLngLat: [116.4, 39.9],
      mode: 'driving',
      routeToNext: { mode: 'driving' }
    });
    expect(result.detail.distance).toBe(0);
  });

  it('does not estimate a route when coordinates are missing', () => {
    const result = buildEstimatedResult({
      fromLngLat: undefined,
      toLngLat: [116.01, 39.01],
      mode: 'driving'
    });

    expect(result).toEqual({ ok: false, estimated: false, status: 'missing-coordinates' });
  });
});
