import { expect, test } from '@playwright/test';

test.describe('@live-provider live provider smoke', () => {
  test.skip(process.env.LIVE_PROVIDER !== '1', 'Live provider smoke is explicit opt-in only.');

  test('BFF readiness and AMap geocode proxy are healthy', async ({ request }) => {
    const ready = await request.get('/readyz');
    expect(ready.status()).toBe(200);
    const readyBody = await ready.json();
    expect(readyBody.status).toBe('ready');
    expect(readyBody.dependencies.amapWebService).toBe(true);
    expect(readyBody.dependencies.amapJsSecurity).toBe(true);

    const geocode = await request.get('/_AMapService/v3/geocode/geo', {
      params: {
        address: '北京市东城区',
        city: '北京'
      }
    });
    expect(geocode.status()).toBe(200);
    const geocodeBody = await geocode.json();
    expect(String(geocodeBody.status)).toBe('1');
  });

  test('Hangzhou driving and transit have real geometry through the application parser', async ({
    page
  }) => {
    test.setTimeout(60_000);
    await page.goto('/');
    const results = await page.evaluate(async () => {
      const { searchRoute } = await import('/js/api/routing.js');
      const segment = {
        fromLngLat: [120.212, 30.29],
        toLngLat: [120.164, 30.251],
        fromCity: '杭州',
        toCity: '杭州'
      };
      const results = [];
      for (const mode of ['driving', 'transit']) {
        const result = await searchRoute(null, null, { ...segment, mode });
        results.push({
          mode,
          ok: result.ok,
          source: result.source,
          points: result.paths.flat().length,
          distance: result.detail.distance,
          duration: result.detail.duration
        });
      }
      return results;
    });
    for (const result of results) {
      expect(result.ok, result.mode).toBe(true);
      expect(result.source).toBe('amap-web-service');
      expect(result.points).toBeGreaterThan(2);
      expect(result.distance).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThan(0);
    }
  });

  test('multiple cities and cross-city transit preserve road truth', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.goto('/');
    const results = await page.evaluate(async () => {
      const { searchRoute } = await import('/js/api/routing.js');
      const segments = [
        {
          name: 'Suzhou-driving',
          fromLngLat: [120.619, 31.299],
          toLngLat: [120.63, 31.324],
          fromCity: '苏州',
          toCity: '苏州',
          mode: 'driving'
        },
        {
          name: 'Chengdu-driving',
          fromLngLat: [104.067, 30.657],
          toLngLat: [104.059, 30.668],
          fromCity: '成都',
          toCity: '成都',
          mode: 'driving'
        },
        {
          name: 'Hangzhou-Suzhou-transit',
          fromLngLat: [120.164, 30.251],
          toLngLat: [120.619, 31.299],
          fromCity: '杭州',
          toCity: '苏州',
          mode: 'transit'
        }
      ];
      const output = [];
      for (const segment of segments) {
        const result = await searchRoute(null, null, segment);
        output.push({
          name: segment.name,
          ok: result.ok,
          source: result.source,
          estimated: result.estimated === true,
          points: result.paths?.flat().length || 0,
          distance: result.detail?.distance,
          duration: result.detail?.duration
        });
      }
      return output;
    });
    await testInfo.attach('multi-city-road-truth', {
      body: JSON.stringify(results, null, 2),
      contentType: 'application/json'
    });
    console.log(JSON.stringify(results));
    for (const result of results) {
      if (result.name.endsWith('driving') || result.ok) {
        expect(result.ok, result.name).toBe(true);
        expect(result.source).toBe('amap-web-service');
        expect(result.points).toBeGreaterThan(2);
      } else {
        expect(result.estimated).toBe(true);
        expect(result.points).toBe(0);
      }
    }
  });
});
