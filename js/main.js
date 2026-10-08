// js/main.js
// 应用入口 + 业务编排
//
// 这个文件负责"做什么时候做什么"的业务流程，自己几乎不写渲染或 API 细节
// 主要做三件事：
//   1) boot：加载 SDK → 初始化地图 → 渲染界面 → 解析地点
//   2) selectDay：切换日期时，更新 UI + marker 显示 + 启动路线规划
//   3) planRoutes：编排"规划路线 → 画线 → 更新卡片"

import './error-boundary.js';
import { loadAMap } from './api/amap-loader.js?v=20260622-map-base-v2';
import { createFallbackAMap } from './api/fallback-amap.js?v=20260622-map-base-v2';
import {
  createGeocodeServices,
  resolveLocation,
  searchPlaces,
  searchNearBy,
  reverseGeocode,
  buildDisplayAddress
} from './api/geocode.js';
import { normalizeLngLat } from './api/amap-web-service.js';
import { extractGuideText, getGuideImportStatus } from './api/guide-import.js';
import {
  getAppState,
  getTrip,
  getDay,
  getLocation,
  setActiveDayId,
  getRememberedDayId,
  setSelectedTarget,
  clearSelectedTarget,
  setAMap,
  updateLocation,
  updateLocationForTrip,
  removeLocation,
  updateTripMeta,
  initWorkspace,
  getWorkspace,
  hasActiveTrip,
  createTrip,
  switchTrip,
  renameTrip,
  deleteTrip,
  addDay,
  updateDay,
  removeDay,
  addLocation,
  addEventToDay,
  updateEventInDay,
  removeEventFromDay,
  addUnscheduledEvent,
  updateUnscheduledEvent,
  removeUnscheduledEvent,
  moveEventInDay,
  reorderEventInDay,
  moveEventBetweenContainers,
  batchTripChanges,
  updateRouteToNext,
  on
} from './state.js';
import {
  initMap,
  createAllMarkers,
  createOrUpdateMarker,
  removeMarker,
  clearAllMarkers,
  pruneMarkersToLocationIds,
  showEmptyMapView,
  showMarkersForDay,
  fitMarkers,
  fitSegment,
  focusLocation,
  showCandidatePreview,
  clearCandidatePreview,
  clearRouteOverlays,
  highlightSegment,
  clearSegmentHighlight,
  setMarkerSelectHandler
} from './render/map.js?v=20260623-gate50-marker-select';
import {
  renderHeader,
  renderTabs,
  renderItinerary,
  updateActiveTab,
  updateVisibleDayGroups,
  resetRouteCards,
  setStatus,
  updateSelectedTargetUI
} from './render/sidebar.js?v=20260901-s5b';
import { openSearchModal } from './render/search-modal.js?v=20260509-v5';
import { openEventEditorModal } from './render/event-editor-modal.js?v=20260509-v6';
import { openGuideImportModal } from './render/guide-import-modal.js';
import { openGuidePreviewModal } from './render/guide-preview-modal.js';
import { openDayEditorModal } from './render/day-editor-modal.js';
import { openRouteEditorModal } from './render/route-editor-modal.js';
import { openTripModal } from './render/trip-modal.js';
import { openWorkspaceImportModal } from './render/workspace-import-modal.js';
import { bindShareButton } from './render/share-flow.js?v=20260901-s4b';
import { renderWorkspaceTabs, closeWorkspaceMenu } from './render/workspace-tabs.js';
import { scheduleRoutePlanning, clearAllRoutes } from './route-planner.js?v=20260622-map-base-v2';
import { readSharedTripFromURL } from './share.js';
import {
  getLastWorkspaceLoadInfo,
  importWorkspace,
  loadWorkspace,
  parseWorkspaceImport,
  saveWorkspace,
  stringifyWorkspaceExport
} from './storage.js?v=20260901-s4';
import { sleep } from './utils.js';
import { inferIconId } from './render/icons.js';
import { createLogger } from './logger.js';
import { buildGuideDraft, searchGuidePlaces } from './guide-import-flow.js';
import { MAX_GUIDE_DAYS } from './guide-import-cleanup.js';

const log = createLogger('main');

// ─── boot ──────────────────────────────────────────────

// 启动 banner——刷新后 console 第一行能确认你拿到的是 v8c 代码（不是缓存）
log.info('main.js v8h · provider fallback + runtime map config');

let mobileViewSwitchBound = false;
let lastMapError = null;
let persistenceUnavailable = false;
let protectedWorkspaceNotice = '';
let persistenceSuspended = false;
const locationResolutionRuns = new Map();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
bindMobileViewSwitch();

async function boot() {
  const savedWorkspace = await loadWorkspace();
  const workspaceLoadInfo = getLastWorkspaceLoadInfo();
  const sharedTrip = readSharedTripFromURL();
  const sharedTripResult = initWorkspace(savedWorkspace, sharedTrip);
  const preserveInvalidSource = workspaceLoadInfo.shouldPersist === false;
  const initialSaveResult = preserveInvalidSource
    ? {
        ok: false,
        protectedSource: true,
        message: '本地数据异常，已在当前页面安全打开；原始数据未被覆盖，请先导出工作区。'
      }
    : await saveWorkspace(getWorkspace());
  persistenceUnavailable = !initialSaveResult.ok;
  protectedWorkspaceNotice = initialSaveResult.protectedSource ? initialSaveResult.message : '';

  renderWorkspace();
  renderHeader();
  setStatus('正在加载高德地图 JS API 2.0...');
  if (sharedTripResult.error === 'WORKSPACE_FULL') {
    setStatus('分享行程未导入：本地已保存 3 条路线，请先导出或删除一条后再打开链接。');
  } else if (sharedTripResult.error === 'SHARED_TRIP_EXISTS') {
    setStatus('已保留这条行程的本地编辑；分享链接没有覆盖本地内容。');
  } else if (initialSaveResult.protectedSource) {
    setStatus(initialSaveResult.message);
  } else if (!initialSaveResult.ok) {
    setStatus(initialSaveResult.message);
  } else if (workspaceLoadInfo.status === 'migrated') {
    setStatus('已兼容旧版本地数据，并保存恢复快照。正在加载地图...');
  } else if (workspaceLoadInfo.status === 'parse-error' || workspaceLoadInfo.status === 'invalid') {
    setStatus('本地数据异常，已保存恢复快照并启动默认行程。');
  }
  bindShareButton();

  // 订阅 trip 变更：编辑模式下任何 mutator 都会触发，UI 自动重渲
  on('trip:changed', handleTripChanged);
  on('trip:replaced', handleTripReplaced);
  on('workspace:changed', handleWorkspaceChanged);
  on('workspace:replaced', handleWorkspaceChanged);

  renderAll();
  setMarkerSelectHandler(handleMarkerSelected);

  try {
    const AMap = await loadAMap();
    lastMapError = null;
    setAMap(AMap);

    initMap(AMap);
    createAllMarkers();
    selectDay('all', { fitView: true, planRoutes: false });
    syncEmptyWorkspaceUI();

    // 后台异步校准坐标，完成后重新设置当前选中的日期
    await resolveAllLocations();
    if (hasActiveTrip() && !getAppState().selectedTarget) {
      selectDay(getAppState().activeDayId, { fitView: false, planRoutes: true });
    }
  } catch (error) {
    log.error('高德地图加载失败', error);
    lastMapError = error?.message || 'AMAP_LOAD_FAILED';
    await bootFallbackMap();
    setStatus('高德底图暂不可用，已启用本地 2D 路线视图。');
  }
}

async function bootFallbackMap() {
  const AMap = createFallbackAMap();
  setAMap(AMap);
  initMap(AMap);
  createAllMarkers();
  selectDay('all', { fitView: true, planRoutes: false });
  syncEmptyWorkspaceUI();
  await resolveAllLocations();
  if (hasActiveTrip() && !getAppState().selectedTarget) {
    selectDay(getAppState().activeDayId, { fitView: true, planRoutes: true });
  }
}

function bindMobileViewSwitch() {
  if (mobileViewSwitchBound) return;
  mobileViewSwitchBound = true;
  document.body.dataset.mobileView ||= 'list';
  document.querySelectorAll('button[data-mobile-view]').forEach(button => {
    button.addEventListener('click', () => setMobileView(button.dataset.mobileView));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const nextView = ['ArrowRight', 'End'].includes(event.key) ? 'map' : 'list';
      setMobileView(nextView);
      document.querySelector(`button[data-mobile-view="${nextView}"]`)?.focus();
    });
  });
  syncMobileViewButtons();
}

function setMobileView(view) {
  const nextView = view === 'map' ? 'map' : 'list';
  document.body.dataset.mobileView = nextView;
  syncMobileViewButtons();
  if (nextView === 'map' && getAppState().map) {
    setTimeout(() => {
      const state = getAppState();
      state.map?.resize?.();
      const visibleMarkers = showMarkersForDay(state.activeDayId);
      if (state.selectedTarget?.kind === 'place') focusLocation(state.selectedTarget.locationId);
      else if (visibleMarkers.length) fitMarkers(visibleMarkers);
    }, 50);
  }
}

function syncMobileViewButtons() {
  const activeView = document.body.dataset.mobileView || 'list';
  document.querySelectorAll('button[data-mobile-view]').forEach(button => {
    const active = button.dataset.mobileView === activeView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
}

function renderAll() {
  renderWorkspace();
  renderTabs({
    onSelectDay: dayId => selectDay(dayId, { fitView: true, planRoutes: true }),
    onAddDay: openCreateDayFlow
  });
  renderItinerary(getItineraryHandlers());
  syncEmptyWorkspaceUI();
}

function getItineraryHandlers() {
  return {
    onEventClick: (dayId, event) => {
      selectPlaceTarget(dayId, event, false);
      clearSegmentHighlight();
      focusLocation(event.locationId);
    },
    onRouteClick: segment => {
      setSelectedTarget({ kind: 'route', dayId: segment.dayId, segmentId: segment.id });
      updateSelectedTargetUI(getAppState().selectedTarget);
      fitSegment(segment);
      highlightSegment(segment.id);
    },
    onEditRoute: openRouteEditorFlow,
    onEditDay: openEditDayFlow,
    onEditEvent: openEditEventFlow,
    onAddLocation: dayId => openAddLocationFlow({ dayId }),
    onAddUnscheduledLocation: () => openAddLocationFlow({ dayId: 'unscheduled' }),
    onAddAfterEvent: (dayId, eventId) => openAddLocationFlow({ dayId, afterEventId: eventId }),
    onMoveEvent: moveEventInDay,
    onReorderEvent: reorderEventInDay,
    onDropEvent: handleEventDrop,
    onDeleteEvent: deleteEventFlow,
    onAddDay: openCreateDayFlow,
    onCreateTrip: openCreateTripFlow,
    onImportGuide: openGuideImportFlow
  };
}

function selectPlaceTarget(dayId, event, reveal) {
  setSelectedTarget({
    kind: 'place',
    dayId,
    eventId: event.id,
    locationId: event.locationId
  });
  updateSelectedTargetUI(getAppState().selectedTarget, { reveal });
}

function handleMarkerSelected(locationId) {
  const activeDayId = getAppState().activeDayId;
  const containers = [
    ...getTrip().days.map(day => ({ dayId: day.id, events: day.events })),
    { dayId: 'unscheduled', events: getTrip().unscheduled || [] }
  ];
  const match = containers.find(
    item =>
      (activeDayId === 'all' || item.dayId === activeDayId) &&
      item.events.some(event => event.locationId === locationId)
  );
  const event = match?.events.find(item => item.locationId === locationId);
  if (match && event) {
    clearSegmentHighlight();
    selectPlaceTarget(match.dayId, event, true);
  }
}

function renderWorkspace() {
  renderWorkspaceTabs({
    onSelectTrip: tripId => {
      if (switchTrip(tripId)) {
        clearSegmentHighlight();
        setStatus('已切换行程。');
      }
    },
    onCreateTrip: openCreateTripFlow,
    onImportGuide: openGuideImportFlow,
    onRenameTrip: openRenameTripFlow,
    onDeleteTrip: deleteTripFlow,
    onExportWorkspace: exportWorkspaceFlow,
    onImportWorkspace: importWorkspaceFlow
  });
}

function openCreateTripFlow() {
  if (getWorkspace().trips.length >= 3) {
    setStatus('最多只能同时保存 3 个行程。请先删除一个旧行程。');
    return;
  }
  openTripModal({
    mode: 'create',
    handlers: {
      onCreate: title => {
        createTrip(title);
        setStatus('已新建旅行路线。Day 1 已创建，可以开始添加地点。');
      }
    }
  });
}

function openRenameTripFlow(tripId) {
  const target = getWorkspace().trips.find(item => item.id === tripId);
  if (!target) return;
  openTripModal({
    mode: 'edit',
    title: target.title,
    handlers: {
      onSave: title => {
        renameTrip(tripId, title);
        setStatus('旅行标题已更新。');
      }
    }
  });
}

function deleteTripFlow(tripId) {
  const target = getWorkspace().trips.find(item => item.id === tripId);
  if (!target) return;
  const ok = window.confirm(
    `删除“${target.title || '这个行程'}”？这个行程里的日期和地点都会一起删除。`
  );
  if (!ok) return;
  deleteTrip(tripId);
  setStatus(hasActiveTrip() ? '行程已删除。' : '还没有行程。点击添加第一个行程。');
}

function importGuideDraft(draft) {
  const activeEvents = draft.events.filter(event => !event.deleted);
  if (!activeEvents.length) {
    setStatus('没有可导入的地点。');
    return;
  }
  if (getWorkspace().trips.length >= 3) {
    setStatus('最多保存 3 个行程，请先删除一个旧行程。');
    return;
  }

  const title = String(draft.title || '').trim() || 'AI 导入行程';
  const tripId = createTrip(title);
  if (!tripId) {
    setStatus('创建新行程失败，请重试。');
    return;
  }
  batchTripChanges(() => {
    if (draft.city) updateTripMeta({ city: draft.city });

    const maxDay = Math.min(
      MAX_GUIDE_DAYS,
      Math.max(1, ...activeEvents.map(event => Number(event.day) || 0))
    );
    while (getTrip().days.length < maxDay) addDay({ title: '' });

    const dayIds = getTrip().days.map(day => day.id);
    activeEvents.forEach(event => {
      const poi = event.poi;
      const name = poi?.name || event.placeName;
      const addr = buildDisplayAddress(poi || {}) || poi?.addr || '';
      const eventTitle = String(event.title || event.placeName || '').trim() || event.placeName;
      const locationId = addLocation({
        name,
        query: event.placeName,
        addr,
        lnglat: poi?.lnglat || null,
        photo: poi?.photo || '',
        type: poi?.type || '',
        province: poi?.province || '',
        city: poi?.city || '',
        district: poi?.district || '',
        tag: poi?.tag || ''
      });
      const payload = {
        title: eventTitle,
        icon: inferIconId({
          title: eventTitle,
          name,
          addr,
          type: poi?.type,
          tag: poi?.tag
        }),
        timeSlot: event.timeSlot,
        note: event.note || '',
        locationId
      };

      if (event.day == null) {
        addUnscheduledEvent(payload);
      } else {
        const dayId = dayIds[event.day - 1] || dayIds[0];
        addEventToDay(dayId, payload, { preserveOrder: true });
      }
    });
  });

  setStatus(`已从攻略导入 ${activeEvents.length} 个地点。`);
}

function openCreateDayFlow() {
  openDayEditorModal({
    mode: 'create',
    day: { title: '' }, // V5：title 默认空，提交后 sidebar 显示"新的一天"
    handlers: {
      onCreate: patch => {
        const dayId = addDay(patch);
        return !!dayId;
      }
    }
  });
}

function openEditDayFlow(dayId) {
  const day = getDay(dayId);
  if (!day) return;

  openDayEditorModal({
    mode: 'edit',
    day,
    canDelete: getTrip().days.length > 1,
    handlers: {
      onSave: (_day, patch) => updateDay(dayId, patch),
      onDelete: () => deleteDayFlow(dayId)
    }
  });
}

function deleteDayFlow(dayId) {
  const day = getDay(dayId);
  if (!day) return;
  if (getTrip().days.length <= 1) {
    setStatus('每个旅行路线至少需要保留 1 天。');
    return;
  }

  // V5：用 Day N 替代日期文案
  const dayIndex = getTrip().days.findIndex(d => d.id === dayId);
  const dayLabel = dayIndex >= 0 ? `Day ${dayIndex + 1}` : '这一天';
  const titleSuffix = day.title?.trim() ? ` · ${day.title}` : '';
  const ok = window.confirm(`删除"${dayLabel}${titleSuffix}"？这一天里的日程也会一起删除。`);
  if (!ok) return;

  removeDay(dayId);
}

// ─── 添加地点流程 ───────────────────────────────────────

// "搜附近"流水线（不再调 LLM）：直接用用户原话当 keyword，在锚点附近搜
// 默认半径 5km；最多返回 4 个 POI（按高德返回顺序，离锚点近优先）
const NEARBY_DEFAULT_RADIUS = 5000;
const NEARBY_MAX_RESULTS = 4;
async function runNearbySearch({ userInput, anchorLocation, AMap }) {
  if (!userInput) return [];
  const center =
    Array.isArray(anchorLocation?.lnglat) && anchorLocation.lnglat.length >= 2
      ? anchorLocation.lnglat
      : null;

  let candidates;
  if (center) {
    candidates = await searchNearBy(AMap, {
      keyword: userInput,
      center,
      radius: NEARBY_DEFAULT_RADIUS
    });
  } else {
    // 没锚点（当天为空）：退化为全城关键词搜索
    candidates = await searchPlaces(AMap, userInput, { city: getTrip().city || false });
  }
  return candidates.slice(0, NEARBY_MAX_RESULTS);
}

// 解析"添加地点"流程的搜附近锚点：
// 1) 卡片内 +：使用 afterEventId 对应的地点
// 2) 日期栏 +：优先使用同一天当前高亮地点
// 3) 无高亮：回退到当天最后一个地点
function resolveAddLocationAnchor(dayId, afterEventId) {
  const isUnscheduled = dayId === 'unscheduled';
  const day = isUnscheduled
    ? { id: 'unscheduled', events: getTrip().unscheduled || [] }
    : getDay(dayId);
  if (!day) return null;
  const events = day.events || [];
  if (!events.length) return null;

  let anchorEvent;
  if (afterEventId) {
    anchorEvent = events.find(e => e.id === afterEventId);
  }
  if (!anchorEvent) {
    const selected = getAppState().selectedTarget;
    if (selected?.kind === 'place' && selected.dayId === dayId) {
      anchorEvent = events.find(e => e.id === selected.eventId);
    }
  }
  if (!anchorEvent) anchorEvent = events[events.length - 1];
  if (!anchorEvent?.locationId) return null;
  return getLocation(anchorEvent.locationId) || null;
}

function openAddLocationFlow(options = {}) {
  if (!hasActiveTrip()) return;
  const state = getAppState();
  if (!state.AMap) {
    setStatus('地图还在加载，请稍后再添加地点。');
    return;
  }
  const targetDayId = options.dayId || state.activeDayId;
  if (targetDayId === 'all') return; // 普通添加必须落到具体 day；未排期入口会显式传 unscheduled

  const anchorLocation = resolveAddLocationAnchor(targetDayId, options.afterEventId);
  const dayIndex = getTrip().days.findIndex(day => day.id === targetDayId);
  const insertionLabel =
    targetDayId === 'unscheduled'
      ? '加入未排期'
      : `加入 Day ${dayIndex + 1}${anchorLocation ? ` · ${anchorLocation.name}之后` : ''}`;

  openSearchModal({
    insertionLabel,
    nearbyAnchor: anchorLocation
      ? { name: anchorLocation.name, radius: NEARBY_DEFAULT_RADIUS, maxResults: NEARBY_MAX_RESULTS }
      : null,
    onSearch: keyword => searchPlaces(state.AMap, keyword, { city: getTrip().city || false }),
    onNearbySearch: userInput =>
      runNearbySearch({
        userInput,
        anchorLocation,
        AMap: state.AMap
      }),
    onPreview: place => {
      if (place) showCandidatePreview(place, anchorLocation);
      else clearCandidatePreview();
    },
    onDismiss: clearCandidatePreview,
    onConfirm: ({ place, event }) => {
      clearCandidatePreview();
      const locationId = addLocation({
        name: place.name,
        query: place.name,
        addr: place.addr || place.name,
        lnglat: place.lnglat,
        photo: place.photo || '',
        type: place.type || '',
        province: place.province || '',
        city: place.city || '',
        district: place.district || '',
        tag: place.tag || ''
      });
      const eventPayload = {
        title: event.title,
        icon: event.icon,
        timeSlot: event.timeSlot,
        note: event.note,
        locationId
      };
      if (targetDayId === 'unscheduled') {
        addUnscheduledEvent(eventPayload);
      } else {
        addEventToDay(targetDayId, eventPayload, { afterEventId: options.afterEventId });
      }
    }
  });
}

async function openGuideImportFlow(initial = {}) {
  if (getWorkspace().trips.length >= 3) {
    setStatus('最多保存 3 个行程，请先删除一个旧行程。');
    return;
  }
  let status;
  try {
    status = await getGuideImportStatus();
  } catch {
    setStatus('AI 攻略导入暂不可用，请稍后重试。');
    return;
  }
  if (!status.available) {
    setStatus('AI 攻略导入暂不可用，请检查 DEEPSEEK_API_KEY。');
    return;
  }

  openGuideImportModal({
    initialText: initial.text || '',
    initialCity: initial.cityHint || '',
    handlers: {
      onSubmit: async ({ text, cityHint, onProgress, signal }) => {
        onProgress?.('extracting', '正在解析攻略文字...');
        setStatus('正在解析攻略...');
        const extracted = await extractGuideText({ text, cityHint, signal });
        signal?.throwIfAborted?.();
        if (extracted.guide_type === 'non_travel') {
          throw new Error('未识别到旅行内容，请检查粘贴文本。');
        }
        if (!extracted.events?.length) {
          throw new Error('没有识别到可导入的地点，请换一段攻略试试。');
        }
        const draft = await buildGuideDraft(extracted, { text, cityHint }, onProgress, signal);
        signal?.throwIfAborted?.();
        onProgress?.('done', '解析完成，正在打开预览...');
        openGuidePreviewModal({
          draft,
          handlers: {
            onBack: currentDraft =>
              openGuideImportFlow({
                text: currentDraft.sourceText,
                cityHint: currentDraft.cityHint
              }),
            onSearchPlace: (keyword, city) => searchGuidePlaces(keyword, city || false, 8),
            onConfirm: importGuideDraft
          }
        });
        setStatus('攻略解析完成，请确认导入预览。');
        return true;
      }
    }
  });
}

// ─── 编辑 / 删除 / 移动流程 ─────────────────────────────

function openEditEventFlow(dayId, event) {
  if (!hasActiveTrip()) return;
  const state = getAppState();
  if (!state.AMap) {
    setStatus('地图还在加载，请稍后再编辑日程。');
    return;
  }

  const loc = getLocation(event.locationId);
  openEventEditorModal({
    event,
    location: loc,
    handlers: {
      currentContainerId: dayId,
      containerOptions: getEventContainerOptions(),
      onSearch: keyword => searchPlaces(state.AMap, keyword, { city: getTrip().city || false }),
      nearbyAnchor: loc?.lnglat
        ? { name: loc.name, radius: NEARBY_DEFAULT_RADIUS, maxResults: NEARBY_MAX_RESULTS }
        : null,
      onNearbySearch: userInput =>
        runNearbySearch({
          userInput,
          anchorLocation: loc,
          AMap: state.AMap
        }),
      onResolveAddress: lnglat => reverseGeocode(state.AMap, lnglat),
      onConfirm: ({ event: eventPatch, location, selectedPlace }) => {
        const targetDayId = eventPatch.targetDayId || dayId;
        delete eventPatch.targetDayId;
        let locationId = event.locationId;

        if (selectedPlace && countLocationReferences(event.locationId) > 1) {
          locationId = addLocation(location);
        } else {
          updateLocation(event.locationId, location);
        }

        const patch = {
          ...eventPatch,
          locationId
        };

        if (dayId === 'unscheduled') {
          updateUnscheduledEvent(event.id, patch);
        } else {
          updateEventInDay(dayId, event.id, patch);
        }

        if (targetDayId !== dayId) {
          moveEventBetweenContainers(event.id, {
            dayId: targetDayId,
            timeSlot: patch.timeSlot
          });
        }
      }
    }
  });
}

function deleteEventFlow(dayId, event) {
  const ok = window.confirm(`删除“${event.title || '这个日程'}”？`);
  if (!ok) return;

  const locationId = event.locationId;
  const removed =
    dayId === 'unscheduled'
      ? removeUnscheduledEvent(event.id)
      : removeEventFromDay(dayId, event.id);
  if (!removed) return;
  const state = getAppState();
  if (
    state.selectedTarget?.kind === 'place' &&
    state.selectedTarget.dayId === dayId &&
    state.selectedTarget.eventId === event.id
  ) {
    clearSelectedTarget();
  }
  if (countLocationReferences(locationId) === 0) removeLocation(locationId);
}

function handleEventDrop(payload, target) {
  if (!payload?.eventId || !target?.dayId) return;
  if (payload.dayId === target.dayId && payload.eventId === target.afterEventId) return;
  const moved = moveEventBetweenContainers(payload.eventId, {
    dayId: target.dayId,
    timeSlot: target.timeSlot,
    afterEventId: target.afterEventId,
    index: target.index
  });
  if (!moved) setStatus('移动日程失败，请重试。');
}

function getEventContainerOptions() {
  const trip = getTrip();
  return [
    { id: 'unscheduled', label: '未排期' },
    ...trip.days.map((day, index) => ({
      id: day.id,
      label: `Day ${index + 1}${day.title?.trim() ? ` · ${day.title.trim()}` : ''}`
    }))
  ];
}

function openRouteEditorFlow(segment) {
  openRouteEditorModal({
    segment,
    handlers: {
      onConfirm: routeToNext => {
        if (!updateRouteToNext(segment.dayId, segment.eventId, routeToNext)) {
          setStatus('路线设置更新失败，请重试。');
        }
      }
    }
  });
}

function countLocationReferences(locationId) {
  const trip = getTrip();
  const dayCount = trip.days.reduce((count, day) => {
    return count + day.events.filter(event => event.locationId === locationId).length;
  }, 0);
  const unscheduledCount = (trip.unscheduled || []).filter(
    event => event.locationId === locationId
  ).length;
  return dayCount + unscheduledCount;
}

function exportWorkspaceFlow() {
  const content = stringifyWorkspaceExport(getWorkspace());
  const date = new Date().toISOString().slice(0, 10);
  downloadTextFile(`travel-with-me-workspace-${date}.json`, content, 'application/json');
  setStatus('工作区 JSON 已导出。');
}

async function importWorkspaceFlow() {
  const file = await pickJSONFile();
  if (!file) return;

  let text;
  try {
    text = await readFileAsText(file);
  } catch {
    setStatus('读取导入文件失败。');
    return;
  }

  const parsed = parseWorkspaceImport(text);
  openWorkspaceImportModal({
    file,
    parsed,
    handlers: {
      onReselect: importWorkspaceFlow,
      onConfirm: replaceWorkspaceFromImport
    }
  });
  setStatus(parsed.ok ? '工作区 JSON 校验通过，请确认替换。' : parsed.message);
}

async function replaceWorkspaceFromImport(workspace) {
  const result = await importWorkspace(workspace);
  if (!result.ok) {
    setStatus(result.message || '导入失败，请检查文件格式。');
    return result;
  }

  protectedWorkspaceNotice = '';
  persistenceUnavailable = false;
  persistenceSuspended = true;
  try {
    initWorkspace(workspace);
  } finally {
    persistenceSuspended = false;
  }
  clearAllMarkers();
  clearRouteOverlays();
  resetRouteCards();
  renderHeader();
  renderAll();
  if (getAppState().map) {
    createAllMarkers();
    selectDay('all', { fitView: true, planRoutes: false });
  }
  setStatus(result.recoveryKey ? '工作区已导入，原数据已保存恢复快照。' : '工作区已导入。');
  return { ok: true };
}

function downloadTextFile(filename, content, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function pickJSONFile() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.hidden = true;
    input.className = 'workspace-import-file-input';
    document.body.appendChild(input);
    input.addEventListener(
      'change',
      () => {
        resolve(input.files?.[0] || null);
        input.remove();
      },
      { once: true }
    );
    input.addEventListener(
      'cancel',
      () => {
        resolve(null);
        input.remove();
      },
      { once: true }
    );
    input.click();
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result || '')));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsText(file, 'utf-8');
  });
}

// ─── trip 变更订阅 ──────────────────────────────────────

async function persistWorkspace() {
  if (persistenceSuspended) return { ok: true, skipped: true };
  if (protectedWorkspaceNotice) {
    return {
      ok: false,
      protectedSource: true,
      message: protectedWorkspaceNotice
    };
  }
  const result = await saveWorkspace(getWorkspace());
  if (!result.ok && !persistenceUnavailable) {
    persistenceUnavailable = true;
    log.warn('工作区无法持久化', result.error);
    setStatus(result.message || '浏览器本地存储不可用，本次修改仅在当前页面有效。');
  } else if (result.ok) {
    persistenceUnavailable = false;
  }
  return result;
}

function handleWorkspaceChanged() {
  renderWorkspace();
  persistWorkspace();
}

function handleTripChanged(payload) {
  if (!payload) return;
  const preservedScrollTop =
    payload.kind === 'location:updated'
      ? document.getElementById('itinerary-container')?.scrollTop
      : null;
  persistWorkspace();
  if (payload.kind === 'route:geometry-cached') return;
  renderWorkspace();

  if (payload.kind === 'trip:updated') {
    renderHeader();
  }

  if (payload.kind === 'location:added' || payload.kind === 'location:updated') {
    const loc = getLocation(payload.locationId);
    createOrUpdateMarker(payload.locationId, loc.lnglat);
  }

  if (payload.kind === 'location:removed') {
    removeMarker(payload.locationId);
  }

  if (payload.kind === 'day:removed') {
    payload.removedLocationIds?.forEach(removeMarker);
  }

  pruneMapMarkersToTripEvents();
  // prune 之后兜底重建：处理 'location:added' → prune 把刚加的 marker 删掉的时序问题。
  // 等紧随其后的 'event:added' 触发本函数时，这里会重新创建丢失的 marker。
  ensureMarkersForReferencedLocations();

  // 编辑型变更统一重新渲染行程，再按当前视图刷新 marker 和路线。
  renderTabs({
    onSelectDay: dayId => selectDay(dayId, { fitView: true, planRoutes: true }),
    onAddDay: openCreateDayFlow
  });
  renderItinerary(getItineraryHandlers());
  const activeId = getNextActiveDayId(payload);
  const preserveSelection =
    payload.kind === 'location:updated' && getAppState().selectedTarget?.kind === 'place';
  selectDay(activeId, {
    fitView: true,
    planRoutes: activeId !== 'all',
    preserveSelection
  });
  syncEmptyWorkspaceUI();
  if (preservedScrollTop != null) {
    document.getElementById('itinerary-container').scrollTop = preservedScrollTop;
  }
}

function handleTripReplaced() {
  closeWorkspaceMenu();
  clearSelectedTarget();
  persistWorkspace();
  renderWorkspace();
  renderHeader();
  renderTabs({
    onSelectDay: dayId => selectDay(dayId, { fitView: true, planRoutes: true }),
    onAddDay: openCreateDayFlow
  });
  renderItinerary(getItineraryHandlers());
  clearAllRoutes();
  clearAllMarkers();
  createAllMarkers();
  const rememberedDayId = getRememberedDayId();
  const restoredDayId =
    rememberedDayId === 'all' || getDay(rememberedDayId) ? rememberedDayId : 'all';
  selectDay(restoredDayId, { fitView: true, planRoutes: restoredDayId !== 'all' });
  syncEmptyWorkspaceUI();
  if (getAppState().AMap && hasActiveTrip()) void resolveAllLocations();
}

function getNextActiveDayId(payload) {
  if (payload.kind === 'day:added') return payload.dayId;

  const activeId = getAppState().activeDayId;
  if (activeId === 'all') return 'all';
  if (getDay(activeId)) return activeId;

  return getTrip().days[0]?.id || 'all';
}

// ─── selectDay：切换日期 ────────────────────────────────

function selectDay(dayId, { fitView = false, planRoutes = false, preserveSelection = false } = {}) {
  if (!preserveSelection) {
    clearSelectedTarget();
    updateSelectedTargetUI(null);
  }
  setActiveDayId(dayId);
  updateActiveTab(dayId);
  updateVisibleDayGroups(dayId);
  clearAllRoutes();
  clearSegmentHighlight();

  if (!hasActiveTrip()) {
    resetRouteCards();
    showEmptyMapView();
    setStatus('还没有行程。点击添加第一个行程。');
    syncEmptyWorkspaceUI();
    return;
  }

  const visibleMarkers = showMarkersForDay(dayId);
  if (!hasTripEventLocations()) {
    resetRouteCards();
    showEmptyMapView();
    setStatus('还没有地点。添加地点后，地图会自动定位到行程范围。');
    return;
  }

  if (dayId === 'all') {
    resetRouteCards();
    setStatus(protectedWorkspaceNotice || '全部地点已显示。选择某一天后，会展示当天路线。');
  } else if (planRoutes) {
    const day = getDay(dayId);
    if (day) scheduleRoutePlanning(day);
  }

  if (fitView && visibleMarkers.length) fitMarkers(visibleMarkers);
  updateMapDebug();
}

function updateMapDebug() {
  if (typeof window === 'undefined') return;
  const state = getAppState();
  const providerKind = state.AMap?.__fallback ? 'fallback' : state.AMap ? 'amap' : 'none';
  window.__mapDebug__ = {
    providerKind,
    amapReady: providerKind === 'amap',
    fallbackReady: providerKind === 'fallback',
    routeOverlayCount: state.routeOverlays?.size || 0,
    routeSource: 'amap-webservice-bff',
    lastMapError
  };
}

// ─── 后台批量解析地点坐标 ───────────────────────────────

async function resolveAllLocations() {
  if (!hasActiveTrip()) {
    setStatus('还没有行程。点击添加第一个行程。');
    return;
  }
  const state = getAppState();
  const trip = getTrip();
  const tripId = trip.id;
  const runToken = Symbol(tripId);
  locationResolutionRuns.set(tripId, runToken);
  setStatus('正在通过高德解析地点坐标...');

  const services = createGeocodeServices(state.AMap, trip.city || undefined);
  const entries = Object.entries(trip.locations);
  let success = 0;
  let skipped = 0;

  let completedByOwner = false;
  try {
    for (const [locationId, loc] of entries) {
      if (locationResolutionRuns.get(tripId) !== runToken) return;
      if (loc?.resolved === true || hasValidLngLat(loc?.lnglat)) {
        skipped += 1;
        continue;
      }
      const locationVersion = getLocationResolutionVersion(loc);
      const result = await resolveLocation(services, loc);
      if (locationResolutionRuns.get(tripId) !== runToken) return;

      const currentTrip = getWorkspace().trips.find(item => item.id === tripId);
      const currentLocation = currentTrip?.locations?.[locationId];
      if (!currentLocation || getLocationResolutionVersion(currentLocation) !== locationVersion) {
        continue;
      }

      const resolvedLngLat = normalizeLngLat(result?.lnglat);
      if (resolvedLngLat) {
        const updated = updateLocationForTrip(tripId, locationId, {
          lnglat: resolvedLngLat,
          addr: buildDisplayAddress(result) || currentLocation.addr || currentLocation.name,
          photo: result.photo || currentLocation.photo || '',
          type: result.type || currentLocation.type || '',
          province: result.province || currentLocation.province || '',
          city: result.city || currentLocation.city || '',
          district: result.district || currentLocation.district || '',
          tag: result.tag || currentLocation.tag || '',
          source: result.source || currentLocation.source || 'amap-web-service'
        });
        if (updated && getTrip().id === tripId) {
          createOrUpdateMarker(locationId, resolvedLngLat);
          success += 1;
        }
      }
      await sleep(160); // 节流，避免对服务端施压
    }
    completedByOwner = locationResolutionRuns.get(tripId) === runToken;
  } finally {
    // 旧 run 收尾时不能删掉同一行程后来启动的新 run token。
    if (locationResolutionRuns.get(tripId) === runToken) {
      locationResolutionRuns.delete(tripId);
    }
  }

  if (completedByOwner && getTrip().id === tripId) {
    setStatus(`地点加载完成：${skipped} 个已保留，${success} 个由高德校准。选择某一天可查看路线。`);
  }
}

function hasValidLngLat(lnglat) {
  return Boolean(normalizeLngLat(lnglat));
}

function getLocationResolutionVersion(location) {
  return JSON.stringify({
    name: location?.name || '',
    query: location?.query || '',
    addr: location?.addr || '',
    searchTerms: location?.searchTerms || [],
    includeKeywords: location?.includeKeywords || [],
    resolveBy: location?.resolveBy || '',
    lnglat: location?.lnglat || null,
    resolved: location?.resolved === true
  });
}

function syncEmptyWorkspaceUI() {
  const empty = !hasActiveTrip();
  document.body.classList.toggle('workspace-empty', empty);
  const shareBtn = document.getElementById('share-trip-btn');
  if (shareBtn) {
    shareBtn.disabled = empty;
    shareBtn.hidden = empty;
  }
  if (empty) showEmptyMapView();
}

function getReferencedLocationIds() {
  const trip = getTrip();
  const ids = new Set();
  trip.days.forEach(day => {
    day.events.forEach(event => {
      if (event.locationId && trip.locations[event.locationId]) ids.add(event.locationId);
    });
  });
  (trip.unscheduled || []).forEach(event => {
    if (event.locationId && trip.locations[event.locationId]) ids.add(event.locationId);
  });
  return Array.from(ids);
}

function hasTripEventLocations() {
  return getReferencedLocationIds().length > 0;
}

function pruneMapMarkersToTripEvents() {
  pruneMarkersToLocationIds(getReferencedLocationIds());
}

// 同步：保证所有被 event 引用且有 lnglat 的 location 都有 marker。
// 解决 'location:added' 后立即 prune 的时序问题——刚加的 location 还没被 event 引用，
// marker 会被误删；后续 'event:added' 触发时这里把丢失的 marker 重建回来。
function ensureMarkersForReferencedLocations() {
  const trip = getTrip();
  for (const id of getReferencedLocationIds()) {
    const loc = trip.locations[id];
    if (loc?.lnglat) createOrUpdateMarker(id, loc.lnglat);
  }
}
