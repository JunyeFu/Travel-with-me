import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { build2DRuntimeManifest } from '../../scripts/active-2d-runtime.mjs';
import { buildReviewHtml, RELEASE_LAYER_IDS } from '../../scripts/release-evidence.mjs';

const SEEDED_WORKSPACE = {
  trips: [
    {
      id: 'trip-s1-desktop',
      title: 'S1 桌面验收行程',
      subtitle: '桌面端核心路径回归',
      city: '北京',
      locations: {
        loc_hotel: {
          name: '老城酒店',
          query: '老城酒店',
          addr: '北京市东城区旅居路 1 号',
          lnglat: [116.397, 39.908],
          resolved: true,
          photo: '',
          type: '住宿服务'
        },
        loc_cafe: {
          name: '胡同咖啡',
          query: '胡同咖啡',
          addr: '北京市东城区胡同 12 号',
          lnglat: [116.405, 39.912],
          resolved: true,
          photo: '',
          type: '餐饮服务;咖啡厅'
        },
        loc_unscheduled: {
          name: '备选书店',
          query: '备选书店',
          addr: '北京市东城区备选路 8 号',
          lnglat: [116.409, 39.91],
          resolved: true,
          photo: '',
          type: '购物服务;书店'
        }
      },
      days: [
        {
          id: 'day_1',
          title: '抵达与散步',
          events: [
            {
              id: 'event_hotel',
              title: '住进老城酒店',
              icon: 'hotel',
              note: '确认前台寄存行李',
              locationId: 'loc_hotel',
              routeToNext: { mode: 'driving' }
            },
            {
              id: 'event_cafe',
              title: '胡同咖啡休息',
              icon: 'coffee',
              timeSlot: 'evening',
              note: '靠窗位置适合整理照片',
              locationId: 'loc_cafe'
            }
          ]
        }
      ],
      unscheduled: [
        {
          id: 'event_unscheduled',
          title: '备选书店',
          icon: 'bookstore',
          note: '只在空闲时考虑',
          locationId: 'loc_unscheduled'
        }
      ],
      annotations: [
        {
          id: 'ann_view_cafe',
          type: 'viewpoint',
          lnglat: [116.405, 39.912],
          elevation: 42,
          title: '胡同视角',
          note: '适合作为 3D 标记回归点',
          createdAt: '2026-06-19T00:00:00.000Z'
        }
      ]
    }
  ],
  activeTripId: 'trip-s1-desktop'
};

const IMPORT_WORKSPACE = {
  trips: [
    {
      id: 'trip-s1-imported',
      title: 'S1 导入路线',
      subtitle: '导入导出回归',
      city: '北京',
      locations: {
        loc_imported: {
          name: '导入地点',
          query: '导入地点',
          addr: '北京市东城区导入路 9 号',
          lnglat: [116.411, 39.916],
          resolved: true,
          photo: '',
          type: '风景名胜'
        }
      },
      days: [
        {
          id: 'day_imported',
          title: '导入日程',
          events: [
            {
              id: 'event_imported',
              title: '导入事件',
              icon: 'place',
              note: '来自 JSON 导入',
              locationId: 'loc_imported'
            }
          ]
        }
      ],
      unscheduled: []
    }
  ],
  activeTripId: 'trip-s1-imported'
};

function createGeoAssetWorkspace() {
  const workspace = JSON.parse(JSON.stringify(SEEDED_WORKSPACE));
  workspace.trips[0].geoAssets = {
    buildings: [],
    landcover: [],
    landmarks: [],
    waterways: [
      {
        id: 'test-canal',
        centerline: [
          [116.397, 39.908],
          [116.405, 39.912]
        ],
        widthMeters: 14,
        provenance: {
          source: 'test-open-data',
          licence: 'ODbL',
          attribution: 'Test open data',
          updatedAt: '2026-06-21T00:00:00.000Z'
        }
      }
    ],
    roads: [
      {
        id: 'test-road',
        kind: 'local',
        centerline: [
          [116.397, 39.908],
          [116.405, 39.912]
        ],
        widthMeters: 6,
        provenance: {
          source: 'test-open-data',
          licence: 'ODbL',
          attribution: 'Test open data',
          updatedAt: '2026-06-21T00:00:00.000Z'
        }
      }
    ],
    bridges: [
      {
        id: 'test-bridge',
        centerline: [
          [116.4005, 39.909],
          [116.4015, 39.911]
        ],
        widthMeters: 8,
        deckHeightMeters: 5,
        provenance: {
          source: 'test-open-data',
          licence: 'ODbL',
          attribution: 'Test open data',
          updatedAt: '2026-06-21T00:00:00.000Z'
        }
      }
    ]
  };
  return workspace;
}

async function installMockAMap(page, unresolvedLocations = false) {
  await page.route('**/_AMapService/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: '0', info: 'E2E_USE_SDK_FIXTURE' })
    })
  );
  await page.route('**/_config', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ amapJsKey: 'e2e-test-key' })
    })
  );
  await page.addInitScript(unresolvedLocations => {
    const toPair = value => {
      if (Array.isArray(value)) return [Number(value[0]), Number(value[1])];
      if (value && typeof value.getLng === 'function') return [value.getLng(), value.getLat()];
      return [Number(value?.lng ?? 116.397), Number(value?.lat ?? 39.908)];
    };

    class MockLngLat {
      constructor(lng, lat) {
        this.lng = Number(lng);
        this.lat = Number(lat);
      }
      getLng() {
        return this.lng;
      }
      getLat() {
        return this.lat;
      }
    }

    class MockMap {
      constructor(id, options = {}) {
        this.id = id;
        this.zoom = 16;
        this.center = options.center || [116.397, 39.908];
        this.handlers = new Map();
        window.__mockMap = this;
        this.context = { gl: { shaderSource() {} } };
      }
      getContext() {
        return this.context;
      }
      addControl() {}
      add() {}
      remove() {}
      resize() {}
      on(event, handler) {
        const handlers = this.handlers.get(event) || [];
        handlers.push(handler);
        this.handlers.set(event, handlers);
      }
      emit(event) {
        (this.handlers.get(event) || []).forEach(handler => handler());
      }
      getZoom() {
        return this.zoom;
      }
      getCenter() {
        return new MockLngLat(this.center[0], this.center[1]);
      }
      setZoomAndCenter(zoom, center) {
        this.zoom = Number(zoom);
        this.center = toPair(center);
        this.emit('zoomchange');
        this.emit('zoomend');
      }
      setFitView(markers, immediately, padding, maxZoom) {
        const positions = (markers || [])
          .map(marker => marker?.getPosition?.())
          .filter(Boolean)
          .map(toPair);
        if (positions.length) {
          this.center = positions
            .reduce((sum, position) => [sum[0] + position[0], sum[1] + position[1]], [0, 0])
            .map(value => Number((value / positions.length).toFixed(6)));
        }
        this.zoom = Math.min(maxZoom || 17, 17);
        this.emit('zoomchange');
        this.emit('zoomend');
      }
    }

    class MockMarker {
      constructor(options = {}) {
        this.position = options.position || [116.397, 39.908];
        this.handlers = new Map();
      }
      setPosition(position) {
        this.position = position;
      }
      getPosition() {
        const [lng, lat] = toPair(this.position);
        return new MockLngLat(lng, lat);
      }
      on(event, handler) {
        this.handlers.set(event, handler);
      }
      show() {}
      hide() {}
    }

    class MockPolyline {
      constructor(options = {}) {
        this.options = options;
      }
      getPath() {
        return this.options.path;
      }
      setOptions(options = {}) {
        this.options = { ...this.options, ...options };
      }
      show() {}
      hide() {}
    }

    class MockInfoWindow {
      setContent() {}
      open() {}
      close() {}
    }

    const buildPoi = (keyword, index = 0) => ({
      id: `mock-poi-${index}`,
      name: index === 0 ? `S1 测试${keyword}` : `备选${keyword}`,
      address: index === 0 ? '北京市东城区 S1 测试路 8 号' : '北京市东城区备选路 2 号',
      pname: '北京市',
      cityname: '北京市',
      adname: '东城区',
      type: '餐饮服务;咖啡厅',
      location: { lng: 116.409 + index * 0.001, lat: 39.914 + index * 0.001 },
      rating: '4.8',
      biz_ext: { cost: '42' },
      photos: []
    });

    class MockPlaceSearch {
      search(keyword, callback) {
        if (unresolvedLocations) {
          callback('no_data', {});
          return;
        }
        callback('complete', { info: 'OK', poiList: { pois: [buildPoi(keyword, 0)] } });
      }
      searchNearBy(keyword, center, radius, callback) {
        callback('complete', { info: 'OK', poiList: { pois: [buildPoi(keyword, 0)] } });
      }
    }

    class MockGeocoder {
      getLocation(keyword, callback) {
        if (unresolvedLocations) {
          callback('no_data', {});
          return;
        }
        callback('complete', {
          info: 'OK',
          geocodes: [
            {
              location: new MockLngLat(116.407, 39.913),
              formattedAddress: `北京市东城区${keyword}`,
              addressComponent: {
                province: '北京市',
                city: '北京市',
                district: '东城区'
              }
            }
          ]
        });
      }
      getAddress(lnglat, callback) {
        callback('complete', {
          info: 'OK',
          regeocode: {
            formattedAddress: '北京市东城区测试地址',
            addressComponent: {
              province: '北京市',
              city: '北京市',
              district: '东城区'
            }
          }
        });
      }
    }

    class MockRouteService {
      search(origin, destination, optionsOrCallback, maybeCallback) {
        const callback =
          typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
        const [fromLng, fromLat] = toPair(origin);
        const [toLng, toLat] = toPair(destination);
        callback('complete', {
          info: 'OK',
          routes: [
            {
              distance: 1200,
              time: 900,
              path: [
                [fromLng, fromLat],
                [toLng, toLat]
              ],
              steps: []
            }
          ]
        });
      }
      clear() {}
    }

    const AMap = {
      Map: MockMap,
      ToolBar: class {},
      InfoWindow: MockInfoWindow,
      Pixel: class {
        constructor(x, y) {
          this.x = x;
          this.y = y;
        }
      },
      Marker: MockMarker,
      Polyline: MockPolyline,
      LngLat: MockLngLat,
      PlaceSearch: MockPlaceSearch,
      Geocoder: MockGeocoder,
      Driving: MockRouteService,
      Walking: MockRouteService,
      Riding: MockRouteService,
      Transfer: MockRouteService,
      DrivingPolicy: { LEAST_TIME: 0 },
      TransferPolicy: { LEAST_TIME: 0 }
    };

    window.AMapLoader = {
      load: () => Promise.resolve(AMap)
    };
  }, unresolvedLocations);
}

async function installMockAmapPlaceText(page) {
  await page.route('**/_AMapService/v3/place/text**', async route => {
    const url = new URL(route.request().url());
    const keyword = url.searchParams.get('keywords') || '';
    const poi = buildMockBffPoi(keyword);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: '1',
        info: 'OK',
        count: '1',
        pois: [poi]
      })
    });
  });
}

function buildMockBffPoi(keyword) {
  if (keyword.includes('书店')) {
    return {
      id: 'mock-bff-bookstore',
      name: 'S1 测试书店',
      address: '北京市东城区 S1 测试路 8 号',
      pname: '北京市',
      cityname: '北京市',
      adname: '东城区',
      type: '购物服务;书店',
      location: '116.409,39.914',
      biz_ext: { rating: '4.8', cost: '42' },
      photos: []
    };
  }
  if (keyword.includes('鼓楼')) {
    return {
      id: 'mock-bff-gulou',
      name: '鼓楼',
      address: '北京市东城区钟鼓楼广场',
      pname: '北京市',
      cityname: '北京市',
      adname: '东城区',
      type: '风景名胜',
      location: '116.397,39.940',
      biz_ext: { rating: '4.7' },
      photos: []
    };
  }
  return {
    id: 'mock-bff-summer-palace',
    name: keyword || '颐和园',
    address: '北京市海淀区新建宫门路 19 号',
    pname: '北京市',
    cityname: '北京市',
    adname: '海淀区',
    type: '风景名胜',
    location: '116.275,39.999',
    biz_ext: { rating: '4.9' },
    photos: []
  };
}

async function seedWorkspace(page, workspace = SEEDED_WORKSPACE) {
  await page.addInitScript(seed => {
    window.localStorage.setItem(
      'trip-app:workspace',
      JSON.stringify({
        version: 5,
        savedAt: Date.now(),
        workspace: seed
      })
    );
  }, workspace);
}

async function openSeededDesktop(page, isMobile, options = {}) {
  test.skip(isMobile, 'desktop S1 path');
  if (options.mockAMap !== false) await installMockAMap(page);
  if (options.forceAmapFailure) {
    await page.addInitScript(() => {
      window.AMapLoader = {
        load: () => Promise.reject(new Error('AMAP_E2E_FORCED_FAILURE'))
      };
    });
  }
  if (options.blockAmapLoader) {
    await page.route('https://webapi.amap.com/loader.js', async route => route.abort('failed'));
  }
  await seedWorkspace(page, options.workspace || SEEDED_WORKSPACE);
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await expect(page.locator('#trip-title-text')).toHaveText(
    options.workspace?.trips?.[0]?.title || 'S1 桌面验收行程',
    { timeout: 15_000 }
  );
  if (options.mockAMap !== false && !options.forceAmapFailure) {
    await expect.poll(() => page.evaluate(() => Boolean(window.__mockMap))).toBe(true);
  }
}

async function enter3DFrom2DSelection(page, lnglat = getSeededRouteCenter()) {
  await page.locator('#map-3d-toggle').click();
  await expect(page.locator('.map-3d-selection-pin')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#map-3d-toggle')).toHaveAttribute('data-state', 'selecting-3d-center');
  if (lnglat) {
    await page.evaluate(center => {
      const toLngLat = () => ({
        lng: center[0],
        lat: center[1],
        getLng: () => center[0],
        getLat: () => center[1]
      });
      const patchMap = map => {
        if (!map) return;
        map.setCenter?.(center);
        map.containerToLngLat = toLngLat;
        map.unproject = () => center;
      };
      const map = document.querySelector('#map')?.__mapInstance;
      patchMap(map);
      patchMap(window.__mockAMapLastMap);
      (window.__mockAMapMaps || []).forEach(patchMap);
    }, lnglat);
  }
  const map = page.locator('#map');
  const box = await map.boundingBox();
  const x = Math.round((box?.x || 0) + (box?.width || 800) / 2);
  const y = Math.round((box?.y || 0) + (box?.height || 600) / 2);
  await page.mouse.click(x, y);
}

function getSeededRouteCenter(workspace = SEEDED_WORKSPACE) {
  const trip =
    workspace.trips?.find(item => item.id === workspace.activeTripId) || workspace.trips?.[0];
  const firstDay = trip?.days?.[0];
  const events = firstDay?.events || [];
  for (let index = 0; index < events.length - 1; index += 1) {
    const from = trip.locations?.[events[index].locationId]?.lnglat;
    const to = trip.locations?.[events[index + 1].locationId]?.lnglat;
    if (isLngLat(from) && isLngLat(to)) {
      return [(Number(from[0]) + Number(to[0])) / 2, (Number(from[1]) + Number(to[1])) / 2];
    }
  }
  return null;
}

function isLngLat(value) {
  return (
    Array.isArray(value) && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))
  );
}

async function openTripMenu(page) {
  await page.getByRole('button', { name: '行程菜单' }).click();
}

test('responsive workbenches contain cards and preserve the shared rail', async ({
  page,
  isMobile
}) => {
  test.skip(isMobile, 'explicit four-viewport matrix');
  test.setTimeout(90_000);
  const sample = JSON.parse(
    await readFile(
      new URL('../../work/user-simulation/routes.workspace.json', import.meta.url),
      'utf8'
    )
  );
  await installMockAMap(page, true);
  await seedWorkspace(page, sample.workspace);
  await page.route('**/_AMapService/**', route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ status: '1', pois: [], geocodes: [] })
    })
  );
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.locator('.card').first()).toBeVisible();
    const sidebar = await page.locator('.sidebar').boundingBox();
    await page.locator('#share-trip-btn').click();
    await expect(page.locator('.share-image-preview img')).toBeVisible();
    if (width >= 768) {
      const rail = await page.locator('.workbench-rail').boundingBox();
      expect(Math.abs(rail.width - sidebar.width)).toBeLessThan(1);
    }
    await page.getByRole('button', { name: '返回行程', exact: true }).click();
    await page.locator('.workspace-tab-wrap.active .workspace-tab-menu-btn').click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '导入工作区 JSON', exact: true }).click();
    await (
      await chooser
    ).setFiles({
      name: 'responsive-workspace.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(sample))
    });
    await expect(page.locator('.import-trip-card')).toHaveCount(3);
    const geometry = await page.locator('.workbench-stage').evaluate(stage => {
      const bounds = stage.getBoundingClientRect();
      const style = window.getComputedStyle(stage);
      const cards = [...stage.querySelectorAll('.import-trip-card')].map(card => {
        const rect = card.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      });
      return {
        left: bounds.left + parseFloat(style.paddingLeft),
        right: bounds.right - parseFloat(style.paddingRight),
        clientWidth: stage.clientWidth,
        scrollWidth: stage.scrollWidth,
        background: style.backgroundColor,
        cards
      };
    });
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
    expect(geometry.background).toBe('rgb(246, 242, 235)');
    for (const card of geometry.cards) {
      expect(Math.abs(card.left - geometry.left)).toBeLessThan(1);
      expect(Math.abs(card.right - geometry.right)).toBeLessThan(1);
      expect(Math.abs(card.width - geometry.cards[0].width)).toBeLessThan(1);
    }
    await page.locator('.workspace-workbench').evaluate(el => (el.scrollTop = el.scrollHeight));
    await page.getByRole('button', { name: '取消导入', exact: true }).click();
    await expect(page.locator('.import-workbench')).toHaveCount(0);
    await expect(page.locator('#trip-title-text')).toHaveText(sample.workspace.trips[0].title);
    if (width < 768) {
      await page.evaluate(async () => {
        const { openGuidePreviewModal } = await import('/js/render/guide-preview-modal.js');
        openGuidePreviewModal({
          draft: {
            title: '视觉回归样本',
            city: '杭州',
            guideType: 'daily_itinerary',
            sourceText: '第一天沿西湖散步。',
            warnings: [],
            events: [
              {
                id: 'visual-event',
                day: 1,
                placeName: '断桥残雪',
                note: '预留休息时间。',
                matched: false,
                searchResults: []
              }
            ]
          },
          handlers: {}
        });
      });
      const card = page.locator('.guide-preview-event');
      await expect(card).toBeVisible();
      const bodyWidth = await page.locator('.guide-preview-body').evaluate(body => ({
        content: body.scrollWidth,
        available: body.clientWidth
      }));
      expect(bodyWidth.content).toBeLessThanOrEqual(bodyWidth.available);
      const main = await card.locator('.guide-preview-event-main').boundingBox();
      const controls = await card.locator('.guide-preview-event-controls').boundingBox();
      const input = card.locator('.guide-preview-event-note-input');
      const inputBounds = await input.boundingBox();
      expect(controls.y + controls.height).toBeLessThanOrEqual(main.y);
      expect(Math.abs(inputBounds.width - main.width)).toBeLessThan(1);
      await input.fill('手机全宽备注编辑验证');
      await card.getByRole('button', { name: '更多操作', exact: true }).click();
      await expect(card.locator('.guide-preview-action-menu')).toBeVisible();
      await card.locator('.guide-preview-day-select').selectOption('2');
      await expect(page.locator('.guide-preview-event-note-input')).toHaveValue(
        '手机全宽备注编辑验证'
      );
      await page.getByRole('button', { name: '关闭', exact: true }).click();
    }
  }
});

test('release closure fits a 320px viewport with long revision identifiers', async ({
  page,
  isMobile
}) => {
  test.skip(isMobile, 'explicit 320px viewport');
  await page.setViewportSize({ width: 320, height: 844 });
  const commit = 'a'.repeat(40);
  const html = buildReviewHtml({
    schemaVersion: '2d-release-evidence/v1',
    generatedAt: '2026-09-28T00:00:00.000Z',
    candidate: {
      commit,
      branch: 'feature/visual-regression-fixes',
      clean: true,
      frozen: true,
      dirtyScope: [],
      rollback: { revision: 'b'.repeat(40), verified: true }
    },
    layers: RELEASE_LAYER_IDS.map(id => ({
      id,
      status: 'PASS',
      command: `verify ${id}`,
      startedAt: '2026-09-28T00:00:00.000Z',
      finishedAt: '2026-09-28T00:01:00.000Z',
      candidateCommit: commit,
      artifact: { path: `evidence/${id}.json`, sha256: 'c'.repeat(64) },
      actor: ['human-review', 'release-authorization'].includes(id) ? 'visual-test-fixture' : ''
    }))
  });
  await page.setContent(html);
  await page.getByRole('link', { name: '发布收口', exact: true }).click();
  await expect(page.locator('#closure')).toBeInViewport();
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    content: document.documentElement.scrollWidth
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport);
  const closure = await page.locator('#closure aside').evaluate(aside => {
    const bounds = aside.getBoundingClientRect();
    const style = window.getComputedStyle(aside);
    return {
      right: bounds.right - parseFloat(style.paddingRight),
      children: [...aside.children].map(child => child.getBoundingClientRect().right)
    };
  });
  for (const right of closure.children) expect(right).toBeLessThanOrEqual(closure.right);
});

for (const slug of ['hangzhou', 'chengdu', 'suzhou']) {
  test(`synthetic user route ${slug}: import, edit, persist and share`, async ({
    page
  }, testInfo) => {
    test.setTimeout(60_000);
    const errors = [];
    const mapTileRequests = [];
    page.on('request', request => {
      if (request.url().includes('/_AMapTile')) mapTileRequests.push(request.url());
    });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const fixture = new URL('../../work/user-simulation/routes.workspace.json', import.meta.url);
    const sample = JSON.parse(await readFile(fixture, 'utf8'));
    const trip = sample.workspace.trips.find(item => item.id === `sample-${slug}`);
    await installMockAMap(page, true);
    // Keep synthetic locations unresolved; do not spend live API calls or assign mock Beijing POIs.
    await page.route('**/_AMapService/**', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: '1', info: 'OK', pois: [], geocodes: [] })
      })
    );
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/Trip App|Travel With Me/i);
    await openTripMenu(page);
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '导入工作区 JSON' }).click();
    await (
      await chooserPromise
    ).setFiles({
      name: 'synthetic-routes.workspace.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(sample))
    });
    await expect(page.locator('.validation-step.passed')).toHaveCount(3);
    await expect(page.locator('.import-trip-card')).toHaveCount(3);
    await page.getByRole('button', { name: '保存恢复点并替换' }).click();
    await page.getByRole('tab', { name: trip.title, exact: true }).click();
    await expect(page.locator('#trip-title-text')).toHaveText(trip.title);
    await page.getByRole('button', { name: 'Day 1', exact: true }).click();
    await expect(page.locator('.day-group:visible')).toHaveCount(1);
    const event = trip.days[0].events[0];
    const card = page.locator(`.card[data-event-id="${event.id}"]`);
    await card.hover();
    await card.locator('[data-action="edit"]').click();
    const updatedNote = `${event.note} 模拟用户修改：下午留出休息时间。`;
    await page.locator('.editor-note-input').fill(updatedNote);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.locator('.event-note').first()).toHaveText(updatedNote);
    await expect
      .poll(async () =>
        page.evaluate(
          ({ tripId, eventId }) => {
            const saved = JSON.parse(localStorage.getItem('trip-app:workspace'));
            return saved.workspace.trips
              .find(item => item.id === tripId)
              .days[0].events.find(item => item.id === eventId).note;
          },
          { tripId: trip.id, eventId: event.id }
        )
      )
      .toBe(updatedNote);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#trip-title-text')).toHaveText(trip.title);
    await expect(page.getByText(updatedNote, { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        ({ tripId, locationId }) => {
          const saved = JSON.parse(localStorage.getItem('trip-app:workspace'));
          const location = saved.workspace.trips.find(item => item.id === tripId).locations[
            locationId
          ];
          return {
            resolved: location.resolved,
            hasCoordinates: Array.isArray(location.lnglat) && location.lnglat.length === 2
          };
        },
        { tripId: trip.id, locationId: event.locationId }
      )
    ).toEqual({ resolved: false, hasCoordinates: false });
    const screenshot = testInfo.outputPath(`${slug}-itinerary.png`);
    await page.screenshot({ path: screenshot });
    await testInfo.attach(`${slug}-itinerary`, { path: screenshot, contentType: 'image/png' });
    await page.getByRole('button', { name: '分享长图', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '分享长图' })).toBeVisible();
    await expect(page.locator('.share-image-preview img')).toHaveAttribute(
      'src',
      /^data:image\/png/
    );
    const shareScreenshot = testInfo.outputPath(`${slug}-share-workbench.png`);
    await page.screenshot({ path: shareScreenshot });
    await testInfo.attach(`${slug}-share-workbench`, {
      path: shareScreenshot,
      contentType: 'image/png'
    });
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载长图', exact: true }).click();
    const download = await downloadPromise;
    const sharePath = testInfo.outputPath(`${slug}-app-share.png`);
    await download.saveAs(sharePath);
    await testInfo.attach(`${slug}-app-share`, { path: sharePath, contentType: 'image/png' });
    expect(mapTileRequests).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('loads the trip planner shell', async ({ page, isMobile }) => {
  await installMockAMap(page);
  await page.goto('/', { waitUntil: 'commit' });

  await expect(page).toHaveTitle(/Trip App|Travel With Me/i);
  if (isMobile) await expect(page.getByRole('tab', { name: '地图' })).toBeVisible();
  else await expect(page.locator('#status-panel')).toBeVisible();
  await expect(page.locator('body')).toContainText(/行程|旅行|地点/);
});

test('startup preserves invalid local workspace source instead of overwriting it', async ({
  page,
  isMobile
}) => {
  test.skip(isMobile, 'single startup persistence assertion');
  await installMockAMap(page);
  const raw = '{invalid-workspace-json';
  await page.addInitScript(value => {
    localStorage.setItem('trip-app:workspace', value);
  }, raw);
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  expect(await page.evaluate(() => localStorage.getItem('trip-app:workspace'))).toBe(raw);
  await page.getByRole('button', { name: '新建行程' }).click();
  await page.locator('.trip-title-input').fill('仅内存行程');
  await page.getByRole('button', { name: '确定' }).click();
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => localStorage.getItem('trip-app:workspace'))).toBe(raw);

  page.on('dialog', dialog => dialog.accept());
  await openTripMenu(page);
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入工作区 JSON' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: 'recover-workspace.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(IMPORT_WORKSPACE))
  });
  await page.getByRole('button', { name: '保存恢复点并替换' }).click();
  await expect(page.locator('#trip-title-text')).toHaveText('S1 导入路线');

  await openTripMenu(page);
  await page.getByRole('button', { name: '修改名称' }).click();
  await page.locator('.trip-title-input').fill('保护解除后可保存');
  await page.getByRole('button', { name: '保存' }).click();
  await expect
    .poll(async () => {
      const saved = await page.evaluate(() => localStorage.getItem('trip-app:workspace'));
      return JSON.parse(saved).workspace.trips[0].title;
    })
    .toBe('保护解除后可保存');
});

test('2D runtime does not load or expose archived 3D surfaces', async ({ page, isMobile }) => {
  const forbiddenRequests = [];
  page.on('request', request => {
    if (/\/three\/|\/_elevation|\/_geo-assets/.test(request.url())) {
      forbiddenRequests.push(request.url());
    }
  });
  await installMockAMap(page);
  await page.goto('/', { waitUntil: 'networkidle' });

  if (isMobile) await page.getByRole('tab', { name: '地图' }).click();
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('#map-3d')).toHaveCount(0);
  await expect(page.locator('#map-3d-toggle')).toHaveCount(0);
  expect(forbiddenRequests).toEqual([]);

  expect((await page.request.get('/_elevation?latitude=39&longitude=116')).status()).toBe(404);
  expect((await page.request.get('/_geo-assets?points=116,39')).status()).toBe(404);
  expect((await page.request.get('/three/build/three.module.js')).status()).toBe(404);

  const runtimeManifest = await build2DRuntimeManifest(process.cwd());
  for (const projectPath of runtimeManifest.activeJavaScriptPaths) {
    const response = await page.request.get(`/${projectPath}`);
    expect(response.status(), `active 2D module must be served: ${projectPath}`).toBe(200);
  }
  for (const projectPath of runtimeManifest.inactiveJavaScriptPaths) {
    const response = await page.request.get(`/${projectPath}`);
    expect(response.status(), `inactive JavaScript must stay sealed: ${projectPath}`).toBe(404);
  }
});

test('mobile can switch between itinerary and map views', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile-only layout behavior');
  await installMockAMap(page);

  await page.goto('/', { waitUntil: 'commit' });

  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.map-container')).toBeHidden();
  await expect(page.locator('#status-panel')).toBeVisible();
  await expect(page.locator('#status-panel')).toHaveAttribute('aria-live', 'polite');

  await page.getByRole('button', { name: 'Day 2' }).click();
  const selectedCard = page.getByRole('article', { name: '在地图上查看人大通州校区转转' });
  await selectedCard.click();
  const listScrollTop = await page
    .locator('.itinerary-list')
    .evaluate(element => element.scrollTop);
  await expect(selectedCard).toHaveAttribute('aria-current', 'true');

  await page.getByRole('tab', { name: '地图' }).click();
  await expect(page.locator('.map-container')).toBeVisible();
  await expect(page.locator('.sidebar')).toBeHidden();

  await page.getByRole('tab', { name: '行程', exact: true }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Day 2' })).toHaveClass(/active/);
  await expect(selectedCard).toHaveAttribute('aria-current', 'true');
  await expect
    .poll(() => page.locator('.itinerary-list').evaluate(element => element.scrollTop))
    .toBe(listScrollTop);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
    )
    .toBe(0);
});

test('desktop can create and rename a trip', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop S1 path');
  await installMockAMap(page);

  await page.goto('/', { waitUntil: 'commit' });

  await page.getByRole('button', { name: '新建行程' }).click();
  await expect(page.getByRole('dialog', { name: '新建旅行路线' })).toBeVisible();
  await page.locator('.trip-title-input').fill('S1 新建桌面路线');
  await page.getByRole('button', { name: '确定' }).click();

  await expect(page.locator('#trip-title-text')).toHaveText('S1 新建桌面路线');

  await openTripMenu(page);
  await page.getByRole('button', { name: '修改名称' }).click();
  await expect(page.getByRole('dialog', { name: '修改旅行标题' })).toBeVisible();
  await page.locator('.trip-title-input').fill('S1 已重命名路线');
  await page.getByRole('button', { name: '保存' }).click();

  await expect(page.locator('#trip-title-text')).toHaveText('S1 已重命名路线');
  await expect(page.locator('#status-panel')).toContainText('旅行标题已更新');
});

test('workspace tabs support arrow wrap and Home End with retained focus', async ({ page }) => {
  await installMockAMap(page);
  await page.goto('/', { waitUntil: 'commit' });
  await page.getByRole('button', { name: '新建行程' }).click();
  await page.locator('.trip-title-input').fill('键盘行程');
  await page.getByRole('button', { name: '确定' }).click();
  const tabs = page.locator('[data-trip-id]');
  await expect(tabs).toHaveCount(2);
  await tabs.nth(1).focus();
  for (const [key, index] of [
    ['ArrowRight', 0],
    ['ArrowLeft', 1],
    ['Home', 0],
    ['End', 1]
  ]) {
    await page.keyboard.press(key);
    await expect(tabs.nth(index)).toBeFocused();
    await expect(tabs.nth(index)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#trip-title-text')).toHaveText(await tabs.nth(index).innerText());
    await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'list');
    await expect(page.locator('body')).not.toHaveAttribute('tabindex');
  }
});

test('desktop modal traps focus, isolates the background, and restores its trigger', async ({
  page,
  isMobile
}) => {
  test.skip(isMobile, 'desktop keyboard modal behavior');
  await installMockAMap(page);
  await page.goto('/', { waitUntil: 'commit' });

  const trigger = page.getByRole('button', { name: '新建行程' });
  await trigger.focus();
  await trigger.press('Enter');
  const dialog = page.getByRole('dialog', { name: '新建旅行路线' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('.workspace-shell')).toHaveAttribute('inert', '');
  await expect(page.locator('.trip-title-input')).toBeFocused();

  await page.locator('.modal-submit').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('.modal-close')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('.modal-submit')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator('body > :not(.modal-overlay)[inert]')).toHaveCount(0);
});

test('desktop can edit day, event, and route settings', async ({ page, isMobile }) => {
  await openSeededDesktop(page, isMobile);

  const dayGroup = page.locator('.day-group', { hasText: 'Day 1 · 抵达与散步' }).first();
  await dayGroup.locator('.day-title-main .day-edit-btn').click();
  await expect(page.getByRole('dialog', { name: '编辑这一天' })).toBeVisible();
  await page.locator('.day-title-input').fill('S1 桌面编辑日');
  await page.locator('.day-editor-modal .modal-submit').click();
  await expect(page.getByText('Day 1 · S1 桌面编辑日')).toBeVisible();

  const eventCard = page.locator('.card', { hasText: '住进老城酒店' }).first();
  await eventCard.locator('.event-add-time-btn').click();
  await expect(page.getByRole('dialog', { name: '编辑日程' })).toBeVisible();
  await page.locator('.editor-title-input').fill('S1 桌面编辑事件');
  await page.locator('.editor-note-input').fill('S1 桌面备注已保存');
  await page.getByRole('button', { name: '保存' }).click();

  await expect(page.getByText('S1 桌面编辑事件')).toBeVisible();
  await expect(page.getByText('S1 桌面备注已保存')).toBeVisible();

  await page.getByRole('button', { name: 'Day 1' }).click();
  await page.locator('.route-card').first().locator('.route-edit-btn').click({ force: true });
  await expect(page.getByRole('dialog', { name: '编辑路线' })).toBeVisible();
  await page.getByRole('radio', { name: '步行' }).click();
  await page.getByRole('button', { name: '保存' }).click();

  await expect(page.locator('.route-card').first()).toContainText('步行');
});

test('desktop keyboard activates itinerary and route map links', async ({ page, isMobile }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await openSeededDesktop(page, isMobile);
  await page.getByRole('button', { name: 'Day 1' }).click();
  const routeOptions = () =>
    page.evaluate(async () => {
      const { getAppState } = await import('/js/state.js');
      return [...getAppState().routeOverlays.values()].flatMap(entry =>
        entry.polylines.map(line => line.options)
      );
    });
  await expect.poll(async () => (await routeOptions()).length).toBe(1);
  expect((await routeOptions())[0]).toMatchObject({ showDir: true, strokeWeight: 7 });

  const eventCard = page.locator('.card', { hasText: '住进老城酒店' }).first();
  await eventCard.focus();
  await page.keyboard.press('Enter');
  await expect(eventCard).toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => window.__mockMap?.center)).toEqual([116.397, 39.908]);

  const routeCard = page.locator('.route-card').first();
  await routeCard.focus();
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.__mockMap?.center)).toEqual([116.401, 39.91]);
  expect((await routeOptions())[0]).toMatchObject({ showDir: true, strokeWeight: 9 });
  await page.getByRole('button', { name: '全部日期' }).click();
  await expect.poll(async () => (await routeOptions()).length).toBe(0);
  expect(errors).toEqual([]);
});

test('desktop can add a searched place to the itinerary', async ({ page, isMobile }) => {
  await openSeededDesktop(page, isMobile);
  await installMockAmapPlaceText(page);

  await page.getByRole('button', { name: 'Day 1' }).click();
  const dayGroup = page.locator('.day-group', { hasText: 'Day 1 · 抵达与散步' }).first();
  await dayGroup.locator('.day-add-btn').click();
  await expect(page.getByRole('dialog', { name: '搜索并添加地点' })).toBeVisible();

  await page.locator('.modal-search-input').fill('书店');
  await page.locator('.modal-search-btn').click();
  await expect(page.locator('.modal-result-item').first()).toContainText('S1 测试书店');
  await page.locator('.modal-result-item').first().click();

  await page.locator('.modal-event-title').fill('S1 新增搜索地点');
  await page.locator('.modal-event-form .modal-submit').click();

  await expect(page.getByText('S1 新增搜索地点')).toBeVisible();
});

test('desktop keeps a user-selected place when background geocoding returns late', async ({
  page,
  isMobile
}) => {
  test.skip(isMobile, 'desktop async ownership path');
  await installMockAMap(page);
  const workspace = JSON.parse(JSON.stringify(SEEDED_WORKSPACE));
  workspace.trips[0].locations.loc_hotel = {
    name: '旧坐标地点',
    query: '旧坐标地点',
    addr: '待解析地址',
    resolved: false
  };

  let releaseOldRequest;
  let markOldRequestStarted;
  const oldRequestStarted = new Promise(resolve => {
    markOldRequestStarted = resolve;
  });
  await page.route('**/_AMapService/v3/place/text**', async route => {
    const keyword = new URL(route.request().url()).searchParams.get('keywords') || '';
    if (keyword === '旧坐标地点') {
      markOldRequestStarted();
      await new Promise(resolve => {
        releaseOldRequest = resolve;
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: '1',
          info: 'OK',
          pois: [
            {
              id: 'stale-geocode',
              name: '旧坐标地点',
              address: '不应覆盖用户选择的旧返回地址',
              location: '116.2,39.8'
            }
          ]
        })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: '1', info: 'OK', pois: [buildMockBffPoi(keyword)] })
    });
  });

  await seedWorkspace(page, workspace);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await oldRequestStarted;

  const eventCard = page.locator('.card', { hasText: '住进老城酒店' }).first();
  await eventCard.locator('.event-add-time-btn').click();
  await page.locator('.editor-location-change-btn').click();
  await page.locator('.editor-search-input').fill('书店');
  await page.locator('.editor-search-btn').click();
  await page.locator('.modal-result-item').first().click();
  await page.getByRole('button', { name: '保存' }).click();

  releaseOldRequest();
  await page.waitForTimeout(500);
  await eventCard.locator('.event-add-time-btn').click();
  await expect(page.locator('.editor-location-addr')).toHaveText('北京市东城区 S1 测试路 8 号');
});

test('desktop can export and import workspace JSON', async ({ page, isMobile }) => {
  await openSeededDesktop(page, isMobile);

  await openTripMenu(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出工作区 JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^travel-with-me-workspace-\d{4}-\d{2}-\d{2}\.json$/
  );

  await openTripMenu(page);
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入工作区 JSON' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: 's1-import-workspace.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        format: 'travel-with-me.workspace',
        formatVersion: 1,
        schemaVersion: 5,
        exportedAt: new Date().toISOString(),
        workspace: IMPORT_WORKSPACE
      })
    )
  });

  await expect(page.getByRole('dialog', { name: '导入工作区 JSON' })).toBeVisible();
  await expect(page.locator('.validation-step.passed')).toHaveCount(3);
  await expect(page.locator('.import-trip-card')).toHaveCount(1);
  await expect(page.locator('#trip-title-text')).not.toHaveText('S1 导入路线');
  await page.getByRole('button', { name: '保存恢复点并替换' }).click();

  await expect(page.locator('#trip-title-text')).toHaveText('S1 导入路线');
  await expect(page.getByText('导入事件')).toBeVisible();
});

test('desktop can import an AI guide through the preview flow', async ({ page, isMobile }) => {
  await openSeededDesktop(page, isMobile);
  await installMockAmapPlaceText(page);
  await page.route('**/_ai/status', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ available: true })
    });
  });
  await page.route('**/_ai/extract-guide', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        guide_type: 'daily_itinerary',
        city: '北京',
        title_suggestion: 'S1 AI 导入路线',
        warnings: [],
        events: [
          {
            day: 1,
            place_name: '颐和园',
            note: '上午游览昆明湖和长廊',
            source_quote: '上午去颐和园'
          },
          {
            day: 1,
            place_name: '鼓楼',
            note: '傍晚看老城街区',
            source_quote: '傍晚去鼓楼'
          }
        ]
      })
    });
  });

  await page.getByRole('button', { name: '从攻略导入' }).click();
  await expect(page.getByRole('dialog', { name: '从攻略导入' })).toBeVisible();
  await expect(page.locator('.guide-import-city')).toBeFocused();
  await page.locator('.guide-import-city').fill('北京');
  await page.locator('.guide-import-textarea').fill('旅行'.repeat(2501));
  await expect(page.locator('.guide-import-error')).toBeVisible();
  await page
    .locator('.guide-import-textarea')
    .fill(
      '第一天上午去颐和园，从东宫门进入，沿着昆明湖和长廊慢慢逛。下午可以回到老城休息，傍晚去鼓楼附近看看街区和小店，晚上找一家附近餐厅吃饭。'
    );
  await expect(page.locator('.guide-import-error')).toBeHidden();
  await expect(page.getByLabel('攻略文字', { exact: true })).toBeVisible();
  await expect(page.getByText(/暂不支持直接上传图片/)).toBeVisible();
  await page.locator('.guide-import-submit').click();

  await expect(page.getByRole('dialog', { name: '导入预览' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.guide-preview-title')).toBeFocused();
  await expect(page.locator('.workspace-shell')).toHaveAttribute('inert', '');
  await expect(page.locator('.modal-overlay')).toHaveCount(1);
  await expect(page.locator('.guide-preview-event')).toHaveCount(2);

  const previewEvents = page.locator('.guide-preview-event');
  await previewEvents.nth(0).locator('.guide-preview-event-title-input').fill('S2 改名颐和园');
  await previewEvents.nth(0).locator('.guide-preview-event-note-input').fill('S2 预览备注已修正');
  await previewEvents.nth(1).locator('.guide-preview-action-toggle').click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '导入预览' })).toBeVisible();
  await previewEvents.nth(1).locator('.guide-preview-action-toggle').click();
  await expect(previewEvents.nth(1).locator('.guide-preview-action-menu')).toBeVisible();
  await previewEvents.nth(1).locator('.guide-preview-day-select').selectOption('2');
  await page.locator('.guide-preview-event').nth(1).locator('.guide-preview-action-toggle').click();
  await page
    .locator('.guide-preview-event')
    .nth(1)
    .locator('.guide-preview-time-slot-select')
    .selectOption('evening');

  await page.locator('.guide-preview-confirm').click();

  await expect(page.locator('#trip-title-text')).toHaveText('S1 AI 导入路线');
  await expect(page.getByText('S2 改名颐和园')).toBeVisible();
  await expect(page.getByText('S2 预览备注已修正')).toBeVisible();
  await expect(page.locator('.card', { hasText: '鼓楼' })).toBeVisible();
  await page.getByRole('button', { name: 'Day 2' }).click();
  await expect(page.getByText('晚上')).toBeVisible();
});

test('AI preview fallback search stays scoped to the draft city', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop AI preview search path');
  await installMockAMap(page);
  await page.addInitScript(() => {
    const originalLoad = window.AMapLoader.load;
    window.AMapLoader.load = async () => {
      const AMap = await originalLoad();
      AMap.PlaceSearch = class {
        search(_keyword, callback) {
          callback('no_data', { info: 'NO_DATA', poiList: { pois: [] } });
        }
        searchNearBy(_keyword, _center, _radius, callback) {
          callback('no_data', { info: 'NO_DATA', poiList: { pois: [] } });
        }
      };
      AMap.Geocoder = class {
        getLocation(_keyword, callback) {
          callback('no_data', { info: 'NO_DATA', geocodes: [] });
        }
      };
      return AMap;
    };
  });
  await seedWorkspace(page, SEEDED_WORKSPACE);
  let fallbackSearchCity = null;
  await page.route('**/_AMapService/**', async route => {
    const url = new URL(route.request().url());
    const keyword = url.searchParams.get('keywords') || '';
    if (url.pathname.endsWith('/v3/place/text') && keyword === '人工选择') {
      fallbackSearchCity = url.searchParams.get('city');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: '1',
          info: 'OK',
          pois: [
            {
              id: 'manual-shanghai',
              name: '人工选择地点',
              address: '上海市黄浦区测试路 1 号',
              cityname: '上海市',
              location: '121.49,31.23'
            }
          ]
        })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: '0', info: 'NO_DATA', pois: [], geocodes: [] })
    });
  });
  await page.route('**/_ai/status', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"available":true}' })
  );
  await page.route('**/_ai/extract-guide', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        guide_type: 'daily_itinerary',
        city: '上海',
        title_suggestion: '上海手动匹配',
        warnings: [],
        events: [{ day: 1, place_name: '待匹配地点', note: '', source_quote: '' }]
      })
    })
  );
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: '从攻略导入' }).click();
  await page.locator('.guide-import-city').fill('上海');
  await page
    .locator('.guide-import-textarea')
    .fill(
      '这是一段用于验证上海行程地点匹配范围的中文旅行攻略文字，包含足够长度的信息以进入预览流程，并允许用户手动修正未匹配地点。'
    );
  await page.locator('.guide-import-submit').click();
  await expect(page.getByRole('dialog', { name: '导入预览' })).toBeVisible();
  await expect(page.locator('.guide-preview-event')).toHaveClass(/unmatched/);
  await page.locator('.guide-preview-action-toggle').click();
  await page.locator('.guide-preview-search-toggle').click();
  await page.locator('.guide-preview-search-input').fill('人工选择');
  await page.locator('.guide-preview-search-btn').click();
  await expect(page.locator('.guide-preview-place-result')).toContainText('人工选择地点');
  expect(fallbackSearchCity).toBe('上海');
});

test('desktop can enter and exit nonblank 3D map view @archived-3d', async ({ page, isMobile }) => {
  test.setTimeout(60_000);
  await openSeededDesktop(page, isMobile);

  await page.route('**/_elevation**', async route => {
    const url = new URL(route.request().url());
    const count =
      (url.searchParams.get('latitude') || '').split(',').filter(Boolean).length || 1600;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ elevation: Array.from({ length: count }, (_, i) => 40 + (i % 8)) })
    });
  });

  await expect(page.locator('#map-3d-toggle')).toBeVisible();
  await enter3DFrom2DSelection(page);

  await expect(page.locator('#map-3d canvas')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#map-3d-toggle')).toContainText('2D');
  await expect(page.locator('#map-3d')).toHaveAttribute(
    'data-work-area-source',
    'selected-2d-point'
  );
  await expect(page.locator('#map-3d')).toHaveAttribute('data-work-area-span-meters', /^\d+$/);
  await expect(page.locator('#map-3d')).toHaveAttribute(
    'data-terrain-mode',
    /citywalk|micro-street/
  );
  await expect(page.locator('#map-3d')).toHaveAttribute(
    'data-terrain-confidence',
    /sampled|low-relief|flat-fallback/
  );
  await expect(page.locator('#map-3d')).toHaveAttribute('data-elevation-range', /^\d+$/);
  await expect(page.locator('.terrain-insight-panel')).toBeVisible();
  await expect(page.locator('#map-3d')).toHaveAttribute('data-annotation-count', '1');
  await page.locator('#map-3d canvas').click({ position: { x: 360, y: 260 } });
  await expect(page.getByRole('dialog', { name: '添加 3D 标记' })).toBeVisible({
    timeout: 10_000
  });
  await page.locator('.annotation-type-input').selectOption('risk');
  await page.locator('.annotation-title-input').fill('坡道路口');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.locator('#map-3d')).toHaveAttribute('data-annotation-count', '2');
  await expect
    .poll(async () =>
      page.locator('#map-3d canvas').evaluate(canvas => {
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (!gl) return 0;
        let drawnSamples = 0;
        const pixel = new Uint8Array(4);
        const samples = [
          [0.5, 0.5],
          [0.34, 0.44],
          [0.66, 0.44],
          [0.42, 0.62],
          [0.58, 0.62]
        ];
        for (const [xRatio, yRatio] of samples) {
          gl.readPixels(
            Math.floor(canvas.width * xRatio),
            Math.floor(canvas.height * yRatio),
            1,
            1,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixel
          );
          if (pixel[3] > 0) drawnSamples += 1;
        }
        return drawnSamples;
      })
    )
    .toBeGreaterThan(3);

  await page.locator('#map-3d-toggle').click();
  await expect(page.locator('#map-3d')).toBeHidden({ timeout: 15_000 });
});

test('desktop 3D anchors empty off-route selections to location context @archived-3d', async ({
  page,
  isMobile
}) => {
  test.setTimeout(60_000);
  await openSeededDesktop(page, isMobile);

  await enter3DFrom2DSelection(page, [116.6, 39.9]);

  await expect(page.locator('#map-3d canvas')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#map-3d')).toHaveAttribute(
    'data-work-area-source',
    'selected-2d-point'
  );
  await expect(page.locator('#map-3d')).toHaveAttribute('data-work-area-anchor-adjusted', 'true');
  await expect(page.locator('#map-3d')).toHaveAttribute('data-work-area-anchor-type', 'location');
  await expect(page.locator('#map-3d')).toHaveAttribute(
    'data-work-area-anchor-distance-meters',
    /^[1-9]\d*$/
  );
  await expect
    .poll(
      async () =>
        page.evaluate(() => ({
          phase: window.__threeDebug__?.phase,
          passed: window.__threeDebug__?.quality?.passed,
          anchorAdjusted: window.__threeDebug__?.workArea?.anchorAdjusted,
          anchorType: window.__threeDebug__?.workArea?.anchorType,
          routeSegments: window.__threeDebug__?.counts?.routeSegments || 0,
          buildingMassings: window.__threeDebug__?.counts?.buildingMassings || 0
        })),
      { timeout: 15_000 }
    )
    .toMatchObject({
      phase: 'steady',
      passed: true,
      anchorAdjusted: true,
      anchorType: 'location'
    });

  const debug = await page.evaluate(() => window.__threeDebug__ || {});
  expect(debug.counts?.buildingMassings || 0).toBeGreaterThan(0);
});

test('desktop 3D renders attributable water, roads, and deck-first bridges @archived-3d', async ({
  page,
  isMobile
}) => {
  test.setTimeout(75_000);
  await openSeededDesktop(page, isMobile, { workspace: createGeoAssetWorkspace() });

  await page.getByRole('button', { name: 'Day 1' }).click();
  await enter3DFrom2DSelection(page);

  await expect(page.locator('#map-3d canvas')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#map-3d')).toHaveAttribute('data-water-carve-count', '1');
  await expect(page.locator('#map-3d')).toHaveAttribute('data-waterway-count', '1');
  await expect(page.locator('#map-3d')).toHaveAttribute('data-road-count', '1');
  await expect(page.locator('#map-3d')).toHaveAttribute('data-bridge-count', '1');

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const debug = window.__threeDebug__ || {};
        return {
          waterwayCount: debug.geoAssetCounts?.waterways || 0,
          roadCount: debug.geoAssetCounts?.roads || 0,
          bridgeCount: debug.geoAssetCounts?.bridges || 0,
          waterMeshes: debug.counts?.waterMeshes || 0,
          roadMeshes: debug.counts?.roadMeshes || 0,
          bridgeDecks: debug.counts?.bridgeDecks || 0,
          bridgePiers: debug.counts?.bridgePiers || 0,
          providers: debug.provenance?.providers || []
        };
      })
    )
    .toMatchObject({
      waterwayCount: 1,
      roadCount: 1,
      bridgeCount: 1,
      waterMeshes: 1,
      roadMeshes: 1,
      bridgeDecks: 1,
      bridgePiers: 0
    });
  const geoDebug = await page.evaluate(() => window.__threeDebug__ || {});
  expect(geoDebug.provenance?.providers || []).toContain('test-open-data');
});

test('desktop 3D camera supports unlocked WASD translation with terrain y clamp @archived-3d', async ({
  page,
  isMobile
}) => {
  test.setTimeout(75_000);
  await openSeededDesktop(page, isMobile);

  await page.getByRole('button', { name: 'Day 1' }).click();
  await enter3DFrom2DSelection(page);

  await expect(page.locator('#map-3d canvas')).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => page.evaluate(() => window.__threeDebug__?.phase), { timeout: 15_000 })
    .toBe('steady');

  const before = await page.evaluate(() => window.__threeDebug__?.camera);
  const metrics = await page.evaluate(() => window.__threeDebug__?.geometryMetrics || {});
  expect(metrics.routeClearanceP95Meters).toBeGreaterThan(0);
  expect(metrics.routeClearanceP95Meters).toBeLessThanOrEqual(0.3);
  expect(metrics.buildingBaseTerrainErrorP95Meters).toBeLessThanOrEqual(0.25);

  await page.keyboard.down('KeyW');
  await page.waitForTimeout(350);
  await page.keyboard.up('KeyW');
  const afterForward = await page.evaluate(() => window.__threeDebug__?.camera);

  expect(afterForward.position.x).not.toBe(before.position.x);
  expect(afterForward.position.z).not.toBe(before.position.z);
  expect(afterForward.clearance).toBeGreaterThanOrEqual(afterForward.minClearance);
  expect(afterForward.clearance).toBeLessThanOrEqual(afterForward.maxClearance);

  await page.keyboard.down('KeyD');
  await page.waitForTimeout(350);
  await page.keyboard.up('KeyD');
  const afterRight = await page.evaluate(() => window.__threeDebug__?.camera);

  expect(afterRight.position.x).not.toBe(afterForward.position.x);
  expect(afterRight.position.z).not.toBe(afterForward.position.z);
  expect(afterRight.clearance).toBeGreaterThanOrEqual(afterRight.minClearance);
  expect(afterRight.clearance).toBeLessThanOrEqual(afterRight.maxClearance);
});

test('desktop falls back to local 2D map when AMap JS SDK fails', async ({ page, isMobile }) => {
  test.setTimeout(60_000);
  await openSeededDesktop(page, isMobile, {
    mockAMap: false,
    forceAmapFailure: true,
    blockAmapLoader: true
  });

  await expect(page.locator('#map')).toHaveAttribute('data-map-provider', 'local-fallback', {
    timeout: 20_000
  });
  await expect(page.locator('#status-panel')).toContainText(/本地 2D|已完成|路线/);
  await expect(page.locator('.fallback-map')).toBeVisible();
});

test('desktop 3D stays open after 60 seconds idle @archived-3d', async ({ page, isMobile }) => {
  test.setTimeout(110_000);
  await openSeededDesktop(page, isMobile);

  await page.getByRole('button', { name: 'Day 1' }).click();
  await enter3DFrom2DSelection(page);

  await expect(page.locator('#map-3d canvas')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#map-3d-toggle')).toContainText('2D');
  await expect
    .poll(async () => page.evaluate(() => window.__threeDebug__?.phase), { timeout: 15_000 })
    .toBe('steady');

  await page.waitForTimeout(61_000);

  await expect(page.locator('#map-3d')).toBeVisible();
  await expect(page.locator('#map-3d-toggle')).toContainText('2D');
  await expect
    .poll(async () => page.evaluate(() => window.__threeDebug__?.phase), { timeout: 15_000 })
    .toBe('steady');
});

test('desktop can open share image preview from seeded trip', async ({ page, isMobile }) => {
  await openSeededDesktop(page, isMobile);

  await page.getByRole('button', { name: '分享长图' }).click();
  await expect(page.getByRole('dialog', { name: '分享长图' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.share-modal .modal-close')).toBeFocused();
  await expect(page.locator('.share-image-preview img')).toHaveAttribute('src', /^data:image\/png/);
  await expect(page.locator('.share-include-notes')).toBeChecked();
  await expect(page.locator('.share-include-routes')).not.toBeChecked();
  await expect(page.locator('.share-include-unscheduled')).not.toBeChecked();
  await expect(page.locator('.share-include-annotations')).toHaveCount(0);

  const firstSrc = await page.locator('.share-image-preview img').getAttribute('src');
  await page.locator('.share-include-notes').uncheck();
  await expect(page.locator('.share-image-loading')).toBeHidden({ timeout: 15_000 });
  await expect(page.locator('.share-image-preview img')).not.toHaveAttribute('src', firstSrc || '');

  const secondSrc = await page.locator('.share-image-preview img').getAttribute('src');
  await page.locator('.share-include-unscheduled').check();
  await expect(page.locator('.share-image-loading')).toBeHidden({ timeout: 15_000 });
  await expect(page.locator('.share-image-preview img')).not.toHaveAttribute(
    'src',
    secondSrc || ''
  );
  await expect(page.getByRole('button', { name: '下载长图' })).toBeVisible();
  await page.locator('.share-modal .modal-close').click();
  await expect(page.getByRole('button', { name: '分享长图' })).toBeFocused();
});
