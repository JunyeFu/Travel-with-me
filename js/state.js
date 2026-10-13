// js/state.js
// 应用状态的"唯一真源"
//
// 设计原则：
//   - workspace 是最多 3 条 trip 的容器（可序列化，可保存）
//   - trip 是当前 active trip（可序列化，可保存）
//   - appState 是运行时状态（地图实例、Marker 集合、订阅 token 等，不可序列化）
//   - 模块外不直接 import 这两个对象，统一通过本文件暴露的 getter / mutator 访问
//   - mutator 在改完 trip 之后会触发 emit('change')，将来 UI 编辑功能可订阅
//
// 这样后面要加"撤销/重做"或"自动保存"，只要在 mutator 里加一行就行

import { initialTrip } from './data/trip.js';
import { AppConfig } from './config.js';
// V5：date 字段已删除，addDaysISO/isISODate/todayISO 全部不再使用
import { getTimeSlotRank, normalizeTimeSlot } from './time-slots.js';
import { normalizeRouteToNext } from './route-config.js';
import { reconcilePlan } from './day-plan.js';

// ─── 内部状态（不直接导出） ─────────────────────────────

export const MAX_TRIPS = 3;

let workspace = createDefaultWorkspace();
let trip = getActiveTripFromWorkspace();

const appState = {
  AMap: null,
  map: null,
  infoWindow: null,
  activeDayId: 'all',
  activeDayByTripId: new Map(),
  selectedTarget: null,
  routePlanningSerial: 0,
  routePlanningTimer: null,
  markers: new Map(),
  markerList: [],
  candidatePreview: null,
  routeServices: [],
  // routeOverlays: 按 segmentId 索引，每段可能由多条 Polyline 拼成 + 1 条高亮时叠加的发光环。
  // { polylines: Polyline[], halo: Polyline[], color: string }
  routeOverlays: new Map(),
  activeRouteSegmentId: null,
  routeCards: new Map()
};

// ─── 订阅机制（极简版） ────────────────────────────────

const listeners = new Map(); // event -> Set<fn>
let tripChangeBatchDepth = 0;
let tripChangePending = false;

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}

function emit(event, payload) {
  if (event === 'trip:changed' && tripChangeBatchDepth > 0) {
    tripChangePending = true;
    return;
  }
  listeners.get(event)?.forEach(fn => {
    try {
      fn(payload);
    } catch (err) {
      console.warn('listener error:', err);
    }
  });
}

export function batchTripChanges(fn) {
  tripChangeBatchDepth += 1;
  try {
    return fn();
  } finally {
    tripChangeBatchDepth -= 1;
    if (tripChangeBatchDepth === 0 && tripChangePending) {
      tripChangePending = false;
      emit('trip:changed', { kind: 'batch:changed' });
    }
  }
}

// ─── workspace 读 / 写 ────────────────────────────────

export function getWorkspace() {
  return workspace;
}

export function hasActiveTrip() {
  return Boolean(trip);
}

export function initWorkspace(savedWorkspace, sharedTrip = null) {
  let result = { ok: true, sharedTrip: false };
  if (sharedTrip) {
    const normalizedShared = normalizeTrip(sharedTrip, '分享行程');
    const hasSavedWorkspace = Array.isArray(savedWorkspace?.trips);
    workspace = normalizeWorkspace(savedWorkspace, hasSavedWorkspace ? null : normalizedShared);
    const existingIndex = workspace.trips.findIndex(item => item.id === normalizedShared.id);
    if (!hasSavedWorkspace) {
      workspace.activeTripId = normalizedShared.id;
      result = { ok: true, sharedTrip: true, tripId: normalizedShared.id };
    } else if (existingIndex >= 0) {
      workspace.activeTripId = workspace.trips[existingIndex].id;
      result = { ok: false, error: 'SHARED_TRIP_EXISTS', tripId: normalizedShared.id };
    } else if (workspace.trips.length < MAX_TRIPS) {
      workspace.trips.push(normalizedShared);
      workspace.activeTripId = normalizedShared.id;
      result = { ok: true, sharedTrip: true, tripId: normalizedShared.id };
    } else {
      result = { ok: false, error: 'WORKSPACE_FULL', tripId: normalizedShared.id };
    }
  } else {
    workspace = normalizeWorkspace(savedWorkspace);
  }
  trip = getActiveTripFromWorkspace();
  emit('workspace:replaced', { workspace });
  emit('trip:replaced', { trip });
  return result;
}

export function createTrip(title) {
  if (workspace.trips.length >= MAX_TRIPS) return null;
  const nextTrip = createBlankTrip(title);
  workspace.trips.push(nextTrip);
  workspace.activeTripId = nextTrip.id;
  trip = nextTrip;
  emit('workspace:changed', { kind: 'trip:created', tripId: nextTrip.id });
  emit('trip:replaced', { trip });
  return nextTrip.id;
}

export function switchTrip(tripId) {
  if (workspace.activeTripId === tripId) return true;
  const nextTrip = workspace.trips.find(item => item.id === tripId);
  if (!nextTrip) return false;
  workspace.activeTripId = tripId;
  trip = nextTrip;
  emit('workspace:changed', { kind: 'trip:switched', tripId });
  emit('trip:replaced', { trip });
  return true;
}

export function renameTrip(tripId, title) {
  const target = workspace.trips.find(item => item.id === tripId);
  if (!target || !String(title || '').trim()) return false;
  target.title = String(title).trim();
  if (target.id === workspace.activeTripId) trip = target;
  emit('workspace:changed', { kind: 'trip:renamed', tripId });
  emit('trip:changed', { kind: 'trip:updated' });
  return true;
}

export function deleteTrip(tripId) {
  const index = workspace.trips.findIndex(item => item.id === tripId);
  if (index < 0) return false;

  workspace.trips.splice(index, 1);
  if (workspace.activeTripId === tripId) {
    const nextIndex = Math.max(0, index - 1);
    workspace.activeTripId = workspace.trips[nextIndex]?.id || null;
    trip = getActiveTripFromWorkspace();
    emit('workspace:changed', { kind: 'trip:deleted', tripId });
    emit('trip:replaced', { trip });
  } else {
    trip = getActiveTripFromWorkspace();
    emit('workspace:changed', { kind: 'trip:deleted', tripId });
  }
  return true;
}

// ─── trip 读 ──────────────────────────────────────────

export function getTrip() {
  return trip || createEmptyReadTrip();
}

export function getDay(dayId) {
  return getTrip().days.find(day => day.id === dayId);
}

export function getLocation(locationId) {
  return (
    getTrip().locations[locationId] || {
      name: '未知地点',
      addr: '',
      lnglat: AppConfig.defaultCenter
    }
  );
}

export function getAllLocationIds() {
  return Object.keys(getTrip().locations);
}

// ─── trip 写（mutator） ────────────────────────────────
// 编辑型 mutator 都 emit 'trip:changed'，载荷里带 kind 让订阅方按需精细更新
// 'location:updated' 是底层坐标校准，比 trip:changed 粒度更细，保留独立事件

export function addLocation(loc) {
  if (!trip) return null;
  const id = loc.id || generateLocationId();
  trip.locations[id] = {
    name: loc.name,
    query: loc.query || loc.name,
    addr: loc.addr || loc.name,
    lnglat: loc.lnglat,
    resolved: isValidLngLat(loc.lnglat),
    // photo / type 来自高德 extensions=all，持久化给"已有地点"编辑卡的右侧图位用
    photo: loc.photo || '',
    type: loc.type || '',
    province: loc.province || '',
    city: loc.city || '',
    district: loc.district || '',
    tag: loc.tag || '',
    source: loc.source || (loc.lnglat ? 'user' : ''),
    ...(loc.keepUnmatched ? { keepUnmatched: true } : {})
  };
  emit('trip:changed', { kind: 'location:added', locationId: id });
  return id;
}

export function updateLocation(locationId, patch) {
  if (!trip) return false;
  const loc = trip.locations[locationId];
  if (!loc) return false;
  const previousCoords = loc.lnglat,
    previousCity = loc.city;
  applyLocationPatch(loc, patch);
  if (
    previousCoords?.[0] !== loc.lnglat?.[0] ||
    previousCoords?.[1] !== loc.lnglat?.[1] ||
    previousCity !== loc.city
  ) {
    for (const day of trip.days)
      for (const leg of day.plan?.legs || [])
        if (leg.fromLocationId === locationId || leg.toLocationId === locationId) {
          leg.previousEstimate =
            leg.estimate?.status === 'real' ? leg.estimate : leg.previousEstimate;
          leg.estimate = null;
          leg.queryState = 'changed';
        }
  }
  emit('location:updated', { locationId });
  emit('trip:changed', { kind: 'location:updated', locationId });
  return true;
}

export function updateLocationForTrip(tripId, locationId, patch) {
  if (trip?.id === tripId) return updateLocation(locationId, patch);
  const targetTrip = workspace.trips.find(item => item.id === tripId);
  const loc = targetTrip?.locations?.[locationId];
  if (!loc) return false;
  applyLocationPatch(loc, patch);
  emit('workspace:changed', { kind: 'location:updated-in-background', tripId, locationId });
  return true;
}

function applyLocationPatch(loc, patch) {
  if (patch.name != null) loc.name = patch.name;
  if (patch.query != null) loc.query = patch.query;
  if (patch.addr != null) loc.addr = patch.addr;
  if (patch.lnglat) {
    loc.lnglat = patch.lnglat;
    loc.resolved = true;
    delete loc.keepUnmatched;
  }
  if (patch.photo != null) loc.photo = patch.photo;
  if (patch.type != null) loc.type = patch.type;
  if (patch.province != null) loc.province = patch.province;
  if (patch.city != null) loc.city = patch.city;
  if (patch.district != null) loc.district = patch.district;
  if (patch.tag != null) loc.tag = patch.tag;
  if (patch.source != null) loc.source = patch.source;
}

export function removeLocation(locationId) {
  if (!trip) return false;
  if (!trip.locations[locationId]) return false;
  delete trip.locations[locationId];
  emit('trip:changed', { kind: 'location:removed', locationId });
  return true;
}

export function updateTripMeta(patch) {
  if (!trip) return false;
  if (patch.title != null) trip.title = patch.title;
  if (patch.subtitle != null) trip.subtitle = patch.subtitle;
  if (patch.city != null) trip.city = patch.city;
  if (patch.guideSource != null) trip.guideSource = structuredClone(patch.guideSource);
  emit('trip:changed', { kind: 'trip:updated' });
  return true;
}

export function createEmptyTrip(title) {
  return createTrip(title);
}

// V5：addDay 简化——不再校验日期、不再 sort by date
// day 顺序由用户决定（数组索引就是 Day N），title 留空时显示"新的一天"
export function addDay(day = {}) {
  if (!trip) return null;
  const id = day.id || generateDayId();

  trip.days.push({
    id,
    title: String(day.title || '').trim(),
    events: Array.isArray(day.events) ? structuredClone(day.events).map(normalizeEvent) : []
  });
  sortDayEventsByTimeSlot(trip.days[trip.days.length - 1]);

  emit('trip:changed', { kind: 'day:added', dayId: id });
  return id;
}

// V5：updateDay 只支持 title patch
export function updateDay(dayId, patch) {
  if (!trip) return false;
  const day = trip.days.find(item => item.id === dayId);
  if (!day) return false;

  if (patch.title != null) day.title = String(patch.title).trim();

  emit('trip:changed', { kind: 'day:updated', dayId });
  return true;
}

export function updateDayPlan(dayId, plan, eventPatches = []) {
  const day = trip?.days.find(item => item.id === dayId);
  if (!day) return false;
  for (const patch of eventPatches) {
    const event = day.events.find(item => item.id === patch.id);
    if (event) Object.assign(event, patch);
  }
  day.plan = reconcilePlan(day, structuredClone(plan), trip.locations, trip.city);
  day.events.forEach(event => {
    delete event.routeToNext;
  });
  emit('trip:changed', { kind: 'day:plan-updated', dayId });
  return true;
}

export function cachePlanRoute(dayId, from, to, estimate, queryState = 'success') {
  const day = trip?.days.find(item => item.id === dayId);
  const leg = day?.plan?.legs.find(item => item.from === from && item.to === to);
  if (!leg) return false;
  if (leg.estimate?.status === 'real') leg.previousEstimate = structuredClone(leg.estimate);
  leg.estimate = structuredClone(estimate);
  leg.queryState = queryState;
  emit('trip:changed', { kind: 'day:plan-calculated', dayId, phase: queryState });
  return true;
}

export function removeDay(dayId) {
  if (!trip) return null;
  if (trip.days.length <= 1) return null;

  const index = trip.days.findIndex(day => day.id === dayId);
  if (index < 0) return null;

  const [removedDay] = trip.days.splice(index, 1);
  const removedLocationIds = [];
  uniqueLocationIds(removedDay.events).forEach(locationId => {
    if (!isLocationReferenced(locationId)) {
      delete trip.locations[locationId];
      removedLocationIds.push(locationId);
    }
  });

  emit('trip:changed', {
    kind: 'day:removed',
    dayId,
    removedLocationIds
  });
  return removedDay;
}

export function addEventToDay(dayId, event, options = {}) {
  if (!trip) return null;
  const day = trip.days.find(d => d.id === dayId);
  if (!day) return null;

  const id = event.id || generateEventId(dayId);
  const timeSlot = normalizeTimeSlot(event.timeSlot);
  const note = event.note ? String(event.note).trim() : '';
  const newEvent = {
    id,
    title: String(event.title || trip.locations[event.locationId]?.name || '').trim(),
    ...(event.icon ? { icon: event.icon } : {}),
    ...(timeSlot ? { timeSlot } : {}),
    ...(note ? { note } : {}),
    locationId: event.locationId,
    ...(event.sourceFacts ? { sourceFacts: structuredClone(event.sourceFacts) } : {}),
    ...(event.visit ? { visit: structuredClone(event.visit) } : {}),
    ...(event.routeToNext ? { routeToNext: normalizeRouteToNext(event.routeToNext) } : {})
  };

  const insertIndex =
    options.preserveOrder || day.plan
      ? getPreserveOrderInsertIndex(day, options)
      : getTimeSlotAppendIndex(day, timeSlot, options);
  day.events.splice(insertIndex, 0, newEvent);
  normalizeDayRoutes(day);

  emit('trip:changed', { kind: 'event:added', dayId, eventId: id });
  return id;
}

export function updateEventInDay(dayId, eventId, patch) {
  if (!trip) return false;
  const day = trip.days.find(d => d.id === dayId);
  if (!day) return false;
  const event = day.events.find(item => item.id === eventId);
  if (!event) return false;
  const previousSlot = normalizeTimeSlot(event.timeSlot);

  if (patch.title != null) event.title = patch.title;
  if (patch.icon != null) event.icon = patch.icon;
  if (patch.timeSlot != null) {
    const nextSlot = normalizeTimeSlot(patch.timeSlot);
    if (nextSlot) event.timeSlot = nextSlot;
    else delete event.timeSlot;
  }
  if (patch.note != null) {
    const note = String(patch.note).trim();
    if (note) event.note = note;
    else delete event.note;
  }
  if (patch.locationId != null) event.locationId = patch.locationId;
  if ('visit' in patch) event.visit = structuredClone(patch.visit);
  if ('fixedStart' in patch) event.fixedStart = patch.fixedStart;
  if (patch.routeToNext) event.routeToNext = normalizeRouteToNext(patch.routeToNext);
  if (!day.plan && patch.timeSlot != null && normalizeTimeSlot(event.timeSlot) !== previousSlot) {
    moveEventToTimeSlotEnd(day, eventId);
  }
  normalizeDayRoutes(day);

  emit('trip:changed', { kind: 'event:updated', dayId, eventId });
  return true;
}

export function updateRouteToNext(dayId, eventId, routePatch) {
  if (!trip) return false;
  const day = trip.days.find(d => d.id === dayId);
  if (!day) return false;
  const index = day.events.findIndex(item => item.id === eventId);
  if (index < 0 || index >= day.events.length - 1) return false;

  day.events[index].routeToNext = normalizeRouteToNext(routePatch);
  normalizeDayRoutes(day);
  emit('trip:changed', { kind: 'route:updated', dayId, eventId });
  return true;
}

export function cacheRouteGeometry(dayId, eventId, geometry) {
  if (!trip) return false;
  const day = trip.days.find(item => item.id === dayId);
  const event = day?.events.find(item => item.id === eventId);
  if (!event?.routeToNext) return false;

  const route = normalizeRouteToNext({
    ...event.routeToNext,
    mode: geometry?.mode || event.routeToNext.mode,
    geometry
  });
  if (!route.geometry) return false;
  event.routeToNext = route;
  emit('trip:changed', { kind: 'route:geometry-cached', dayId, eventId });
  return true;
}

export function removeEventFromDay(dayId, eventId) {
  if (!trip) return false;
  const day = trip.days.find(d => d.id === dayId);
  if (!day) return false;
  const index = day.events.findIndex(item => item.id === eventId);
  if (index < 0) return false;

  day.events.splice(index, 1);
  normalizeDayRoutes(day);
  emit('trip:changed', { kind: 'event:removed', dayId, eventId });
  return true;
}

export function moveEventInDay(dayId, eventId, direction) {
  if (!trip) return false;
  const day = trip.days.find(d => d.id === dayId);
  if (!day) return false;

  const from = day.events.findIndex(item => item.id === eventId);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= day.events.length) return false;
  if (
    !day.plan &&
    normalizeTimeSlot(day.events[from].timeSlot) !== normalizeTimeSlot(day.events[to].timeSlot)
  ) {
    return false;
  }

  const [event] = day.events.splice(from, 1);
  day.events.splice(to, 0, event);
  normalizeDayRoutes(day);
  emit('trip:changed', { kind: 'event:moved', dayId, eventId });
  return true;
}

export function reorderEventInDay(dayId, eventId, targetEventId) {
  if (!trip) return false;
  if (eventId === targetEventId) return false;

  const day = trip.days.find(d => d.id === dayId);
  if (!day) return false;

  const from = day.events.findIndex(item => item.id === eventId);
  const target = day.events.findIndex(item => item.id === targetEventId);
  if (from < 0 || target < 0) return false;
  if (
    !day.plan &&
    normalizeTimeSlot(day.events[from].timeSlot) !== normalizeTimeSlot(day.events[target].timeSlot)
  ) {
    return false;
  }

  const [event] = day.events.splice(from, 1);
  day.events.splice(target, 0, event);
  normalizeDayRoutes(day);
  emit('trip:changed', { kind: 'event:reordered', dayId, eventId });
  return true;
}

// ─── 未排期事件容器（V5 新增） ─────────────────────────
//
// 形态与 days[].events 一致，但**没有 routeToNext**——未排期之间不画路线。
// 主要承接 AI 攻略导入识别出的"无日期归属"地点（推荐合集类）。
// 用户可通过 day/timeSlot 下拉把它们移到具体 day（V6 实现）。

export function getUnscheduled() {
  return trip?.unscheduled || [];
}

export function addUnscheduledEvent(event = {}) {
  if (!trip) return null;
  if (!Array.isArray(trip.unscheduled)) trip.unscheduled = [];
  const id = event.id || generateEventId('uns');
  const newEvent = normalizeUnscheduledEvent({ ...event, id });
  trip.unscheduled.push(newEvent);
  emit('trip:changed', { kind: 'unscheduled:added', eventId: id });
  return id;
}

export function updateUnscheduledEvent(eventId, patch) {
  if (!trip) return false;
  const list = trip.unscheduled || [];
  const ev = list.find(item => item.id === eventId);
  if (!ev) return false;

  if (patch.title != null) ev.title = String(patch.title).trim();
  if (patch.icon != null) ev.icon = patch.icon;
  if (patch.timeSlot != null) {
    const nextSlot = normalizeTimeSlot(patch.timeSlot);
    if (nextSlot) ev.timeSlot = nextSlot;
    else delete ev.timeSlot;
  }
  if (patch.note != null) {
    const note = String(patch.note).trim();
    if (note) ev.note = note;
    else delete ev.note;
  }
  if (patch.locationId != null) ev.locationId = patch.locationId;
  if ('visit' in patch) ev.visit = structuredClone(patch.visit);
  if ('fixedStart' in patch) ev.fixedStart = patch.fixedStart;
  // 不处理 routeToNext——未排期 events 没有这个字段

  emit('trip:changed', { kind: 'unscheduled:updated', eventId });
  return true;
}

export function removeUnscheduledEvent(eventId) {
  if (!trip?.unscheduled) return false;
  const idx = trip.unscheduled.findIndex(e => e.id === eventId);
  if (idx < 0) return false;
  const [removed] = trip.unscheduled.splice(idx, 1);
  // 清理无引用的 location（同 removeEventFromDay 的 cleanup 逻辑由调用方在 main.js 决定）
  emit('trip:changed', {
    kind: 'unscheduled:removed',
    eventId,
    removedLocationId: removed?.locationId
  });
  return true;
}

// 跨容器移动：unscheduled ↔ days[N]，days[A] ↔ days[B]
// target: { dayId: 'unscheduled' | <day-id>, timeSlot?, afterEventId? }
// 实现思路：从源容器 splice 出 event，patch timeSlot，push 到目标容器。
// V6 攻略导入"加入行程"按钮会用到这个；V5 先建好接口，UI 调用方留给 V6。
export function moveEventBetweenContainers(eventId, target = {}) {
  if (!trip) return false;
  const targetDayId = target.dayId;
  if (!targetDayId) return false;

  // 1) 在所有容器里找到 event
  let sourceArr = null;
  let sourceIdx = -1;
  let sourceDayId = null;

  // 先查 unscheduled
  if (Array.isArray(trip.unscheduled)) {
    const idx = trip.unscheduled.findIndex(e => e.id === eventId);
    if (idx >= 0) {
      sourceArr = trip.unscheduled;
      sourceIdx = idx;
      sourceDayId = 'unscheduled';
    }
  }
  // 再查 days
  if (sourceIdx < 0) {
    for (const day of trip.days || []) {
      const idx = day.events.findIndex(e => e.id === eventId);
      if (idx >= 0) {
        sourceArr = day.events;
        sourceIdx = idx;
        sourceDayId = day.id;
        break;
      }
    }
  }
  if (sourceIdx < 0) return false;

  // 2) splice 出来 + patch timeSlot
  const [event] = sourceArr.splice(sourceIdx, 1);
  if (target.timeSlot !== undefined) {
    const nextSlot = normalizeTimeSlot(target.timeSlot);
    if (nextSlot) event.timeSlot = nextSlot;
    else delete event.timeSlot;
  }

  // 3) 插入目标容器
  if (targetDayId === 'unscheduled') {
    if (!Array.isArray(trip.unscheduled)) trip.unscheduled = [];
    delete event.routeToNext; // 跨进 unscheduled 必须剥掉路线
    trip.unscheduled.splice(getListInsertIndex(trip.unscheduled, target), 0, event);
  } else {
    const targetDay = trip.days.find(d => d.id === targetDayId);
    if (!targetDay) {
      // 找不到目标 day，回滚到源容器
      sourceArr.splice(sourceIdx, 0, event);
      return false;
    }
    const insertionOptions = { afterEventId: target.afterEventId, index: target.index };
    const insertIndex = targetDay.plan
      ? getPreserveOrderInsertIndex(targetDay, insertionOptions)
      : getTimeSlotAppendIndex(targetDay, normalizeTimeSlot(event.timeSlot), {
          afterEventId: target.afterEventId,
          index: target.index
        });
    targetDay.events.splice(insertIndex, 0, event);
    normalizeDayRoutes(targetDay);
  }

  // 4) 如果源是某个 day，重排路线
  if (sourceDayId !== 'unscheduled') {
    const sourceDay = trip.days.find(d => d.id === sourceDayId);
    if (sourceDay) normalizeDayRoutes(sourceDay);
  }

  emit('trip:changed', {
    kind: 'event:moved-between',
    eventId,
    fromDayId: sourceDayId,
    toDayId: targetDayId
  });
  return true;
}

export function replaceTrip(newTrip) {
  const normalized = normalizeTrip(newTrip);
  if (!workspace.trips.length) {
    workspace.trips.push(normalized);
    workspace.activeTripId = normalized.id;
  } else {
    const activeIndex = workspace.trips.findIndex(item => item.id === workspace.activeTripId);
    const replaceIndex = activeIndex >= 0 ? activeIndex : 0;
    workspace.trips[replaceIndex] = normalized;
    workspace.activeTripId = normalized.id;
  }
  trip = normalized;
  // V5：不再 sortDaysByDate
  emit('workspace:changed', { kind: 'trip:replaced', tripId: normalized.id });
  emit('trip:replaced', { trip });
}

function getTimeSlotAppendIndex(day, timeSlot, options = {}) {
  if (Number.isInteger(options.index)) {
    return Math.max(0, Math.min(day.events.length, options.index));
  }
  if (options.afterEventId) {
    const index = day.events.findIndex(item => item.id === options.afterEventId);
    if (index >= 0) return index + 1;
  }

  const rank = getTimeSlotRank(timeSlot);
  for (let index = 0; index < day.events.length; index += 1) {
    if (getTimeSlotRank(day.events[index].timeSlot) > rank) return index;
  }
  return day.events.length;
}

function getPreserveOrderInsertIndex(day, options = {}) {
  if (options.afterEventId) {
    const index = day.events.findIndex(event => event.id === options.afterEventId);
    if (index >= 0) return index + 1;
  }
  if (Number.isInteger(options.index)) {
    return Math.max(0, Math.min(day.events.length, options.index));
  }
  return day.events.length;
}

function getListInsertIndex(list, options = {}) {
  if (Number.isInteger(options.index)) {
    return Math.max(0, Math.min(list.length, options.index));
  }
  if (options.afterEventId) {
    const index = list.findIndex(item => item.id === options.afterEventId);
    if (index >= 0) return index + 1;
  }
  return list.length;
}

function moveEventToTimeSlotEnd(day, eventId) {
  const index = day.events.findIndex(item => item.id === eventId);
  if (index < 0) return;
  const [event] = day.events.splice(index, 1);
  day.events.splice(getTimeSlotAppendIndex(day, event.timeSlot), 0, event);
}

function normalizeEvent(event = {}) {
  const normalized = { ...event };
  const timeSlot = normalizeTimeSlot(normalized.timeSlot);
  if (timeSlot) normalized.timeSlot = timeSlot;
  else delete normalized.timeSlot;

  if (normalized.note != null) {
    const note = String(normalized.note).trim();
    if (note) normalized.note = note;
    else delete normalized.note;
  }
  return normalized;
}

function sortDayEventsByTimeSlot(day) {
  day.events = day.events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const rankDiff = getTimeSlotRank(a.event.timeSlot) - getTimeSlotRank(b.event.timeSlot);
      return rankDiff || a.index - b.index;
    })
    .map(item => item.event);
}

function normalizeDayRoutes(day, locations = trip?.locations, city = trip?.city) {
  if (day.plan) {
    day.plan = reconcilePlan(day, day.plan, locations, city);
    day.events.forEach(event => {
      delete event.routeToNext;
    });
    return;
  }
  day.events.forEach((event, index) => {
    if (index === day.events.length - 1) {
      delete event.routeToNext;
      return;
    }
    const current = normalizeRouteToNext(event.routeToNext || {});
    if (current.manual) {
      event.routeToNext = current;
      return;
    }
    event.routeToNext = normalizeRouteToNext({
      ...current,
      mode: current.mode || 'walking'
    });
  });
}

function generateLocationId() {
  return `loc-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}

function generateEventId(dayId) {
  return `${dayId}-e-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}

function generateDayId() {
  return `day-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}

function uniqueLocationIds(events) {
  return Array.from(new Set(events.map(event => event.locationId).filter(Boolean)));
}

function isLocationReferenced(locationId) {
  if (!trip) return false;
  return (
    trip.days.some(
      day =>
        day.events.some(event => event.locationId === locationId) ||
        day.plan?.start?.locationId === locationId ||
        day.plan?.end?.locationId === locationId
    ) || (trip.unscheduled || []).some(event => event.locationId === locationId)
  );
}

// V5：dateExists / sortDaysByDate 已删除——day 顺序由数组索引决定

function createDefaultWorkspace() {
  const demoTrip = normalizeTrip(initialTrip);
  return {
    trips: [demoTrip],
    activeTripId: demoTrip.id
  };
}

function normalizeWorkspace(input, fallbackTrip = null) {
  const sourceTrips = Array.isArray(input?.trips) ? input.trips : [fallbackTrip || initialTrip];
  const trips = sourceTrips
    .filter(Boolean)
    .slice(0, MAX_TRIPS)
    .map((item, index) => normalizeTrip(item, `旅行路线 ${index + 1}`));
  const tripIds = new Set();
  trips.forEach(item => {
    item.id = claimUniqueId(item.id, tripIds, generateTripId);
  });

  const activeTripId = trips.some(item => item.id === input?.activeTripId)
    ? input.activeTripId
    : trips[0]?.id || null;

  return { trips, activeTripId };
}

function normalizeTrip(input, fallbackTitle = '旅行路线') {
  const cloned = structuredClone(input || {});
  cloned.id = cloned.id || generateTripId();
  cloned.title = String(cloned.title || fallbackTitle).trim() || fallbackTitle;
  cloned.subtitle = cloned.subtitle || '点击下方行程卡片，右侧地图将自动飞跃至对应地点';
  cloned.city = cloned.city || AppConfig.cityName;
  cloned.locations =
    cloned.locations && typeof cloned.locations === 'object' ? cloned.locations : {};
  Object.values(cloned.locations).forEach(location => normalizeStoredLocation(location));
  cloned.days = Array.isArray(cloned.days) ? cloned.days : [];
  const dayIds = new Set();
  const eventIds = new Set();
  // V5：不再 normalize day.date（字段已删除），不再 sortDaysByDate
  cloned.days.forEach(day => {
    day.id = claimUniqueId(day.id, dayIds, generateDayId);
    day.title = String(day.title || '').trim();
    delete day.date; // 防御性清理：万一旧数据混进来，确保新 schema 干净
    day.events = Array.isArray(day.events)
      ? day.events.map(event => {
          const normalized = normalizeEvent(event);
          normalized.id = claimUniqueId(normalized.id, eventIds, () => generateEventId(day.id));
          return normalized;
        })
      : [];
    if (!day.plan) sortDayEventsByTimeSlot(day);
    normalizeDayRoutes(day, cloned.locations, cloned.city);
  });
  if (!cloned.days.length) {
    cloned.days.push(createBlankDay());
  }
  // V5 新增：unscheduled 数组——AI 攻略导入识别出的"无日期归属" events 落点
  cloned.unscheduled = Array.isArray(cloned.unscheduled)
    ? cloned.unscheduled.map(event => {
        const normalized = normalizeUnscheduledEvent(event);
        normalized.id = claimUniqueId(normalized.id, eventIds, () => generateEventId('uns'));
        return normalized;
      })
    : [];
  // Archived 3D fields are intentionally preserved as opaque data so 2D saves never destroy them.
  cloned.annotations = Array.isArray(cloned.annotations) ? cloned.annotations : [];
  return cloned;
}

// 未排期 event 的字段处理：复用 normalizeEvent 的字段处理逻辑，但**剥掉 routeToNext**
// 因为未排期之间没有"下一站"概念，不画路线
function normalizeUnscheduledEvent(event = {}) {
  const normalized = normalizeEvent(event);
  delete normalized.routeToNext;
  return normalized;
}

function createBlankTrip(title) {
  return normalizeTrip(
    {
      title,
      subtitle: '点击下方行程卡片，右侧地图将自动飞跃至对应地点',
      city: AppConfig.cityName,
      locations: {},
      days: [createBlankDay()],
      annotations: []
    },
    '新的旅行路线'
  );
}

function createBlankDay() {
  return {
    id: generateDayId(),
    title: '',
    events: []
  };
}

function createEmptyReadTrip() {
  return {
    id: '',
    title: '',
    subtitle: '点击添加第一个行程',
    city: AppConfig.cityName,
    locations: {},
    days: [],
    unscheduled: [],
    annotations: []
  };
}

function getActiveTripFromWorkspace() {
  return workspace.trips.find(item => item.id === workspace.activeTripId) || null;
}

function generateTripId() {
  return `trip-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}

function claimUniqueId(candidate, usedIds, generateId) {
  const baseId = String(candidate || generateId());
  let id = baseId;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

function normalizeStoredLocation(location) {
  if (!location || typeof location !== 'object') return;
  if (!isValidLngLat(location.lnglat)) {
    delete location.lnglat;
    location.resolved = false;
    return;
  }
  location.lnglat = [Number(location.lnglat[0]), Number(location.lnglat[1])];
  location.resolved = true;
}

function isValidLngLat(value) {
  if (!Array.isArray(value) || value.length < 2) return false;
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

// ─── appState 读 ─────────────────────────────────────

export function getAppState() {
  return appState;
}

export function getActiveDayId() {
  return appState.activeDayId;
}

export function getMarker(locationId) {
  return appState.markers.get(locationId);
}

export function getRouteCard(routeId) {
  return appState.routeCards.get(routeId);
}

// ─── appState 写 ─────────────────────────────────────

export function setActiveDayId(dayId) {
  appState.activeDayId = dayId;
  if (workspace.activeTripId) appState.activeDayByTripId.set(workspace.activeTripId, dayId);
}

export function getRememberedDayId(tripId = workspace.activeTripId) {
  return appState.activeDayByTripId.get(tripId) || 'all';
}

export function setSelectedTarget(target) {
  appState.selectedTarget = target ? { ...target } : null;
}

export function clearSelectedTarget() {
  appState.selectedTarget = null;
}

export function setAMap(AMap) {
  appState.AMap = AMap;
}

export function setMap(map) {
  appState.map = map;
}

export function setInfoWindow(infoWindow) {
  appState.infoWindow = infoWindow;
}
