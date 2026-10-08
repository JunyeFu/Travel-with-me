// js/api/routing.js
// 路径规划：4 种交通方式的统一接口
//
// 输入一个 segment（from / to / mode），输出统一的 result：
//   - 成功：{ ok: true, detail: { distance, duration, steps, label, icon, ... }, paths: [...] }
//   - 估算：{ ok: false, estimated: true, detail: {...} }
//   - 失败：{ ok: false }
//
// 上层（render/sidebar）只关心这个统一形态，不需要知道高德返回什么

import { toNumber, calculateDistance, cleanText, getTransportIcon, sleep } from '../utils.js';
import { getRouteDisplayLabel } from '../route-config.js';
import { createLogger } from '../logger.js';
import { normalizeLngLat, requestAMapWebService } from './amap-web-service.js';

const log = createLogger('routing');

// ─── 创建路线服务 ──────────────────────────────────────

export function createRouteService(AMap, map, mode, segment = {}) {
  const common = {
    map: null, // 不让高德自己画线，我们自己控制
    hideMarkers: true,
    autoFitView: false,
    isOutline: true,
    outlineColor: '#ffffff'
  };

  if (mode === 'transit') {
    if (!segment.fromCity || !segment.toCity) return null;
    return new AMap.Transfer({
      ...common,
      city: segment.fromCity,
      cityd: segment.toCity,
      policy: (AMap.TransferPolicy && AMap.TransferPolicy.LEAST_TIME) || 0,
      extensions: 'all',
      autoFitView: false
    });
  }
  if (mode === 'walking') return new AMap.Walking(common);
  if (mode === 'riding') return new AMap.Riding(common);

  return new AMap.Driving(
    Object.assign({}, common, {
      policy: (AMap.DrivingPolicy && AMap.DrivingPolicy.LEAST_TIME) || 0,
      showTraffic: false
    })
  );
}

// ─── 真正搜路线 ────────────────────────────────────────

// segment: { fromLngLat, toLngLat, mode }
export async function searchRoute(AMap, service, segment) {
  if (segment.mode === 'transit' && (!segment.fromCity || !segment.toCity)) {
    return buildEstimatedResult(segment);
  }
  const bffResult = await searchRouteWithBff(segment);
  if (bffResult.ok) return bffResult;
  if (!service) return buildEstimatedResult(segment);

  const maxAttempts = 3;
  let lastResult = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastResult = await searchRouteOnce(AMap, service, segment);
    if (lastResult.ok) return lastResult;
    if (attempt < maxAttempts) await sleep(450 * attempt);
  }

  log.warn('路线规划失败，使用估算兜底：', segment, lastResult?.status, lastResult?.raw);
  return buildEstimatedResult(segment);
}

function searchRouteOnce(AMap, service, segment) {
  if (!AMap || !service) {
    return Promise.resolve({ ok: false, status: 'sdk-unavailable', raw: null });
  }
  const origin = new AMap.LngLat(Number(segment.fromLngLat[0]), Number(segment.fromLngLat[1]));
  const destination = new AMap.LngLat(Number(segment.toLngLat[0]), Number(segment.toLngLat[1]));

  return new Promise(resolve => {
    const callback = (status, result) => {
      if (isRouteSearchSuccess(status, result, segment.mode)) {
        const paths =
          segment.mode === 'transit'
            ? extractSdkTransitPaths(result.plans[0])
            : extractRoutePaths(result);
        resolve({
          ok: paths.length > 0,
          source: 'amap-js-sdk',
          detail: extractRouteDetail(segment, result),
          paths
        });
      } else {
        resolve({ ok: false, status, raw: result });
      }
    };

    try {
      // 驾车需要第三个空对象参数
      if (segment.mode === 'driving') {
        service.search(origin, destination, {}, callback);
      } else {
        service.search(origin, destination, callback);
      }
    } catch (error) {
      resolve({ ok: false, status: 'exception', raw: error });
    }
  });
}

async function searchRouteWithBff(segment) {
  const origin = normalizeLngLat(segment.fromLngLat);
  const destination = normalizeLngLat(segment.toLngLat);
  if (!origin || !destination) return { ok: false, status: 'invalid-coordinates', raw: null };

  const params = { origin: origin.join(','), destination: destination.join(',') };
  let path = '/v3/direction/driving';
  if (segment.mode === 'walking') path = '/v3/direction/walking';
  if (segment.mode === 'riding') path = '/v4/direction/bicycling';
  if (segment.mode === 'transit') {
    path = '/v3/direction/transit/integrated';
    params.city = segment.fromCity;
    params.cityd = segment.toCity;
    params.strategy = 0;
  } else if (segment.mode === 'driving') {
    params.extensions = 'all';
  }

  const response = await requestAMapWebService(path, params);
  if (!response.ok) return { ok: false, status: response.code, raw: response.payload };
  const result = parseBffRoute(segment, response.payload);
  return result || { ok: false, status: 'BFF_ROUTE_EMPTY', raw: response.payload };
}

function parseBffRoute(segment, payload) {
  if (segment.mode === 'riding') {
    const path = payload?.data?.paths?.[0];
    if (!path) return null;
    return createBffRouteResult(segment, path, path.steps || []);
  }
  if (segment.mode === 'transit') {
    const transit = payload?.route?.transits?.[0];
    if (!transit) return null;
    const steps = transit.segments || [];
    const paths = extractBffTransitPaths(steps);
    if (!paths.length) return null;
    return {
      ok: true,
      source: 'amap-web-service',
      detail: {
        mode: segment.mode,
        label: getRouteDisplayLabel(segment.routeToNext || segment),
        icon: getTransportIcon(segment.mode),
        distance: toNumber(transit.distance),
        duration: toNumber(transit.duration),
        steps: extractTransitInstructions(steps),
        transitBoardings: countTransitBoardings(steps),
        transitTransfers: Math.max(0, countTransitBoardings(steps) - 1)
      },
      paths
    };
  }
  const path = payload?.route?.paths?.[0];
  if (!path) return null;
  return createBffRouteResult(segment, path, path.steps || []);
}

function createBffRouteResult(segment, path, steps) {
  const paths = mergeStepPolylines(steps);
  if (!paths.length) return null;
  return {
    ok: true,
    source: 'amap-web-service',
    detail: {
      mode: segment.mode,
      label: getRouteDisplayLabel(segment.routeToNext || segment),
      icon: getTransportIcon(segment.mode),
      distance: toNumber(path.distance),
      duration: toNumber(path.duration),
      steps: []
    },
    paths
  };
}

function mergeStepPolylines(steps) {
  return joinContinuousPaths(steps.map(step => normalizePath(step.polyline || step.path)));
}

// Only join touching paths. Missing geometry invalidates the result; gaps are not roads.
function joinContinuousPaths(paths) {
  if (!paths.length || paths.some(path => path.length < 2)) return [];
  const joined = [];
  for (const path of paths) {
    const previous = joined[joined.length - 1];
    const end = previous?.[previous.length - 1];
    if (end && end[0] === path[0][0] && end[1] === path[0][1]) appendPath(previous, path);
    else joined.push([...path]);
  }
  return joined;
}

function extractBffTransitPaths(segments) {
  const paths = [];
  for (const segment of segments) {
    for (const step of segment.walking?.steps || []) paths.push(normalizePath(step.polyline));
    if (toNumber(segment.walking?.distance) > 0 && !segment.walking?.steps?.length) return [];
    const line = getTransitLines(segment)[0];
    if (line) paths.push(normalizePath(line.polyline));
    if (hasRailway(segment)) paths.push(normalizePath(segment.railway.polyline));
    if (segment.taxi && toNumber(segment.taxi.distance) > 0)
      paths.push(normalizePath(segment.taxi.polyline));
  }
  return joinContinuousPaths(paths);
}

function extractSdkTransitPaths(plan) {
  return joinContinuousPaths(
    (plan.segments || []).map(segment => normalizePath(segment.transit?.path))
  );
}

function appendPath(all, path) {
  path.forEach(point => {
    const last = all[all.length - 1];
    if (!last || last[0] !== point[0] || last[1] !== point[1]) all.push(point);
  });
  return all;
}

function extractTransitInstructions(segments) {
  return (Array.isArray(segments) ? segments : [])
    .flatMap(segment => {
      const instruction = String(segment?.walking?.instruction || '').trim();
      const names = getTransitLines(segment)
        .slice(0, 1)
        .map(line => cleanText(line?.name || ''))
        .filter(Boolean)
        .map(name => `乘坐 ${name}`);
      return [instruction, ...names].filter(Boolean);
    })
    .slice(0, 8);
}

function countTransitBoardings(segments) {
  return (Array.isArray(segments) ? segments : []).reduce((count, segment) => {
    return count + (getTransitLines(segment).length ? 1 : 0) + (hasRailway(segment) ? 1 : 0);
  }, 0);
}

// 估算结果：用直线距离 + 速度估时长，画虚线
export function buildEstimatedResult(segment) {
  if (!isValidLngLat(segment?.fromLngLat) || !isValidLngLat(segment?.toLngLat)) {
    return { ok: false, estimated: false, status: 'missing-coordinates' };
  }
  const distance = calculateDistance(segment.fromLngLat, segment.toLngLat);
  const speedKmh = segment.mode === 'walking' ? 4.5 : segment.mode === 'riding' ? 13 : 22;
  const duration = Math.max(60, Math.round(distance / ((speedKmh * 1000) / 3600)));

  return {
    ok: false,
    estimated: true,
    detail: {
      mode: segment.mode,
      label: `${getRouteDisplayLabel(segment.routeToNext || segment)}（估算）`,
      icon: getTransportIcon(segment.mode),
      distance,
      duration,
      steps: []
    },
    paths: [[segment.fromLngLat, segment.toLngLat]]
  };
}

function isValidLngLat(value) {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(Number(value[0])) &&
    Number.isFinite(Number(value[1]))
  );
}

export function safeClearService(service) {
  if (service && typeof service.clear === 'function') {
    try {
      service.clear();
    } catch (err) {
      log.warn('清除路线服务失败：', err);
    }
  }
}

// ─── 内部：判断成功 ─────────────────────────────────────

function isRouteSearchSuccess(status, result, mode) {
  if (status !== 'complete' || !result) return false;
  // AMap SDK 在不同接口里返回的 info 大小写不一致（驾车/步行小写 'ok'，
  // 地理编码大写 'OK'），统一按大小写不敏感比较。
  if (result.info && result.info.toUpperCase() !== 'OK') return false;
  if (mode === 'transit') return Boolean(result.plans?.length);
  return Boolean(result.routes?.length);
}

// ─── 内部：提取距离/时长/文字步骤 ─────────────────────────

function extractRouteDetail(segment, result) {
  if (segment.mode === 'transit') return extractTransitDetail(segment, result);
  return extractSimpleRouteDetail(segment, result);
}

function extractTransitDetail(segment, result) {
  const plan = result.plans?.[0] || {};
  const steps = [];
  let transitBoardings = 0;

  (plan.segments || []).forEach(seg => {
    const walkDistance = toNumber(seg.walking?.distance);
    if (walkDistance > 80) {
      steps.push(
        `步行 ${walkDistance >= 1000 ? (walkDistance / 1000).toFixed(1) + ' 公里' : walkDistance + ' 米'}`
      );
    }

    const lines = getTransitLines(seg).slice(0, 1);
    transitBoardings += lines.length;
    lines.forEach(line => {
      const name = cleanText(line.name || line.lineName || '公共交通');
      const dep = getStopName(line.departure_stop || line.departureStop);
      const arr = getStopName(line.arrival_stop || line.arrivalStop);
      steps.push(`乘坐 ${name}${dep && arr ? `:${dep} → ${arr}` : ''}`);
    });

    if (hasRailway(seg)) {
      transitBoardings += 1;
      const name = cleanText(seg.railway.name || seg.railway.trip || '铁路');
      const dep = getStopName(seg.railway.departure_stop || seg.railway.departureStop);
      const arr = getStopName(seg.railway.arrival_stop || seg.railway.arrivalStop);
      steps.push(`乘坐 ${name}${dep && arr ? `:${dep} → ${arr}` : ''}`);
    }
  });

  return {
    mode: segment.mode,
    label: getRouteDisplayLabel(segment.routeToNext || segment),
    icon: getTransportIcon(segment.mode),
    distance: toNumber(plan.distance || result.distance),
    duration: toNumber(plan.time || plan.duration || result.time || result.duration),
    steps: steps.length ? steps.slice(0, 8) : ['按高德推荐公共交通方案前往。'],
    transitBoardings,
    transitTransfers: Math.max(0, transitBoardings - 1)
  };
}

function extractSimpleRouteDetail(segment, result) {
  const route = result?.routes?.[0] || {};
  return {
    mode: segment.mode,
    label: getRouteDisplayLabel(segment.routeToNext || segment),
    icon: getTransportIcon(segment.mode),
    distance: toNumber(route.distance || result.distance),
    duration: toNumber(route.time || route.duration || result.time || result.duration),
    steps: []
  };
}

// ─── 内部：提取轨迹（用于画 Polyline） ────────────────────

function extractRoutePaths(result) {
  const route = result?.routes?.[0];
  if (!route) return [];

  const fullPath = normalizePath(route.path || route.polyline);
  if (fullPath.length >= 2) return [fullPath];
  return mergeStepPolylines(route.steps || route.rides || []);
}

function normalizePath(rawPath) {
  if (!rawPath) return [];
  if (typeof rawPath === 'string') {
    return rawPath
      .split(/[;|]/)
      .map(item => normalizePoint(item.trim()))
      .filter(Boolean);
  }
  if (!Array.isArray(rawPath)) {
    const point = normalizePoint(rawPath);
    return point ? [point] : [];
  }
  return rawPath.map(normalizePoint).filter(Boolean);
}

function normalizePoint(point) {
  if (!point) return null;
  if (typeof point === 'string') {
    const parts = point.split(',').map(item => Number(item.trim()));
    return parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])
      ? [parts[0], parts[1]]
      : null;
  }
  if (Array.isArray(point) && point.length >= 2) {
    const lng = Number(point[0]);
    const lat = Number(point[1]);
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
  }
  if (point.location) return normalizePoint(point.location);
  if (typeof point.getLng === 'function' && typeof point.getLat === 'function') {
    return [Number(point.getLng()), Number(point.getLat())];
  }
  const lng = Number(point.lng != null ? point.lng : point.Lng);
  const lat = Number(point.lat != null ? point.lat : point.Lat);
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}

function getTransitLines(seg) {
  const groups = [seg.transit?.lines, seg.bus?.buslines, seg.bus?.lines, seg.lines, seg.buslines];
  return groups.reduce((all, item) => {
    if (Array.isArray(item)) all.push(...item);
    else if (item) all.push(item);
    return all;
  }, []);
}

function hasRailway(segment) {
  return (
    toNumber(segment.railway?.distance) > 0 ||
    (typeof segment.railway?.name === 'string' && segment.railway.name.length > 0)
  );
}

function getStopName(stop) {
  if (!stop) return '';
  if (typeof stop === 'string') return cleanText(stop);
  return cleanText(stop.name || stop.stationName || '');
}
