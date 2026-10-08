// js/route-planner.js
// 路线规划编排：scheduleRoutePlanning → clearAllRoutes
// 从 main.js 提取。零循环依赖。

import {
  createRouteService,
  searchRoute,
  buildEstimatedResult,
  safeClearService
} from './api/routing.js?v=20260621-p0-v1';
import { cacheRouteGeometry, getAppState, getTrip, hasActiveTrip } from './state.js';
import {
  buildRouteSegments,
  resetRouteCards,
  setRouteCardLoading,
  updateRouteCardOk,
  updateRouteCardEstimated,
  updateRouteCardError,
  setStatus
} from './render/sidebar.js';
import { drawRoutePaths, clearRouteOverlays } from './render/map.js';

const AUTO_ROUTE_MAX_TRANSIT_BOARDINGS = 3;
const AUTO_ROUTE_DRIVING_TIME_ADVANTAGE_SECONDS = 15 * 60;
const AUTO_ROUTE_TRANSIT_SLOW_RATIO = 1.6;

export function scheduleRoutePlanning(day) {
  if (!hasActiveTrip()) return;
  const state = getAppState();
  if (state.routePlanningTimer) clearTimeout(state.routePlanningTimer);

  const serial = ++state.routePlanningSerial;
  const segments = buildRouteSegments(day);
  if (!segments.length) {
    resetRouteCards();
    setStatus(`${dayDisplayLabel(day)} 还没有路线。添加至少两个地点后会自动规划路线。`);
    return;
  }

  segments.forEach(setRouteCardLoading);
  setStatus(`${dayDisplayLabel(day)}：正在规划 ${segments.length} 段路线...`);

  state.routePlanningTimer = setTimeout(() => {
    planRoutesForDay(day, segments, serial);
  }, 240);
}

async function planRoutesForDay(day, segments, serial) {
  const state = getAppState();
  let success = 0,
    estimated = 0,
    failed = 0;

  for (const segment of segments) {
    if (serial !== state.routePlanningSerial) return;
    const result = await searchSegment(segment, serial);
    if (serial !== state.routePlanningSerial) return;

    if (result.ok) {
      success += 1;
      drawRoutePaths(segment, result.paths, false);
      cacheRouteGeometry(segment.dayId, segment.eventId, {
        source: result.source,
        mode: segment.mode,
        paths: result.paths,
        fetchedAt: Date.now()
      });
      updateRouteCardOk(segment, result.detail);
    } else if (result.estimated) {
      estimated += 1;
      drawRoutePaths(segment, result.paths, true);
      updateRouteCardEstimated(segment, result.detail);
    } else {
      failed += 1;
      updateRouteCardError(segment, '高德暂未返回该段路线，请在地图 App 中再次确认。');
    }
  }

  if (serial !== state.routePlanningSerial) return;
  setStatus(
    `${dayDisplayLabel(day)} 已完成：${success} 段真实路线，${estimated} 段估算路线，${failed} 段失败。`
  );
}

export function dayDisplayLabel(day) {
  if (!day) return '';
  const idx = getTrip().days.findIndex(d => d.id === day.id);
  const dayN = idx >= 0 ? `Day ${idx + 1}` : '某天';
  const titleSuffix = day.title?.trim() ? ` · ${day.title}` : '';
  return `${dayN}${titleSuffix}`;
}

async function searchSegment(segment, serial) {
  if (!hasValidSegmentCoords(segment)) {
    return { ok: false, status: 'missing-coordinates', segmentId: segment.id };
  }
  if (!segment.routeToNext?.manual) {
    return searchAutoSegment(segment, serial);
  }
  return searchModeSegment(segment, segment.mode, serial);
}

async function searchAutoSegment(segment, serial) {
  const walking = await searchModeSegment(segment, 'walking', serial);
  if (isStaleRouteResult(walking)) return walking;
  if (walking.ok && Number(walking.detail?.duration || 0) <= 30 * 60) {
    applySegmentMode(segment, 'walking');
    return walking;
  }

  const transit = await searchModeSegment(segment, 'transit', serial);
  if (isStaleRouteResult(transit)) return transit;

  const driving = await searchModeSegment(segment, 'driving', serial);
  if (isStaleRouteResult(driving)) return driving;

  if (shouldUseTransitOverDriving(transit, driving)) {
    applySegmentMode(segment, 'transit');
    return transit;
  }

  applySegmentMode(segment, 'driving');
  return driving.ok || driving.estimated
    ? driving
    : buildEstimatedResult(asRouteModeSegment(segment, 'driving'));
}

function shouldUseTransitOverDriving(transit, driving) {
  if (!transit?.ok) return false;
  const boardings = Number(transit.detail?.transitBoardings || 0);
  if (boardings >= AUTO_ROUTE_MAX_TRANSIT_BOARDINGS) return false;
  if (!driving?.ok && !driving?.estimated) return true;
  const transitDuration = Number(transit.detail?.duration || 0);
  const drivingDuration = Number(driving.detail?.duration || 0);
  if (transitDuration > 0 && drivingDuration > 0) {
    if (transitDuration - drivingDuration >= AUTO_ROUTE_DRIVING_TIME_ADVANTAGE_SECONDS)
      return false;
    if (transitDuration >= drivingDuration * AUTO_ROUTE_TRANSIT_SLOW_RATIO) return false;
  }
  return true;
}

async function searchModeSegment(segment, mode, serial) {
  const state = getAppState();
  const targetSegment = asRouteModeSegment(segment, mode);
  const service = hasSdkRouteService(state.AMap, mode)
    ? createRouteService(state.AMap, state.map, mode, targetSegment)
    : null;

  if (service) state.routeServices.push(service);
  const result = await searchRoute(state.AMap, service, targetSegment);

  if (serial !== state.routePlanningSerial) {
    safeClearService(service);
    return { ok: false, stale: true };
  }
  return result;
}

function hasSdkRouteService(AMap, mode) {
  if (!AMap || AMap.__fallback) return false;
  if (mode === 'transit') return typeof AMap.Transfer === 'function';
  if (mode === 'walking') return typeof AMap.Walking === 'function';
  if (mode === 'riding') return typeof AMap.Riding === 'function';
  return typeof AMap.Driving === 'function';
}

function asRouteModeSegment(segment, mode) {
  return { ...segment, mode, routeToNext: { ...(segment.routeToNext || {}), mode } };
}

function applySegmentMode(segment, mode) {
  segment.mode = mode;
  segment.routeToNext = { ...(segment.routeToNext || {}), mode };
}

function isStaleRouteResult(result) {
  return result?.stale === true;
}

function hasValidSegmentCoords(segment) {
  return isValidLngLat(segment.fromLngLat) && isValidLngLat(segment.toLngLat);
}

function isValidLngLat(value) {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(Number(value[0])) &&
    Number.isFinite(Number(value[1]))
  );
}

export function clearAllRoutes() {
  const state = getAppState();
  state.routePlanningSerial += 1;
  if (state.routePlanningTimer) {
    clearTimeout(state.routePlanningTimer);
    state.routePlanningTimer = null;
  }
  state.routeServices.forEach(safeClearService);
  state.routeServices = [];
  clearRouteOverlays();
}
