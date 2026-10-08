// js/render/map.js
// 地图渲染：管 marker、polyline、视野缩放、infoWindow
//
// 这个模块是"地图的视图层"——只负责把 trip 数据投影到地图上
// 不负责"何时切换日期"那种业务逻辑（那是 main.js / sidebar.js 的事）

import { createLogger } from '../logger.js';
import { AppConfig } from '../config.js';
import { getAppState, getTrip, getLocation, getMarker, setMap, setInfoWindow } from '../state.js';
import { ROUTE_GUIDANCE } from '../route-guidance.js';
import { escapeHTML, unique } from '../utils.js';

const log = createLogger('map');
let markerSelectHandler = null;
const arrowShaderContexts = new WeakSet();

export function setMarkerSelectHandler(handler) {
  markerSelectHandler = handler;
}

// ─── 初始化 ─────────────────────────────────────────────

export function initMap(AMap) {
  const mapElement = document.getElementById('map');
  if (mapElement) {
    mapElement.dataset.mapProvider = AMap?.__fallback ? 'local-fallback' : 'amap';
  }

  const map = new AMap.Map('map', {
    zoom: AppConfig.defaultZoom,
    center: AppConfig.defaultCenter,
    resizeEnable: true,
    viewMode: '2D'
  });
  map.addControl(new AMap.ToolBar({ position: 'RT' }));

  // autoMove: false 禁掉 AMap 的"自动把 InfoWindow 拉进可视区"。
  // 否则 focusLocation 先 setZoomAndCenter 把 marker 居中，
  // 280ms 后 openInfoWindow 又触发一次自动平移，导致 marker 视觉上偏离中心；
  // 严重时表现为"第一次点击好像没反应，得点两次"。
  const infoWindow = new AMap.InfoWindow({ offset: new AMap.Pixel(0, -22), autoMove: false });

  setMap(map);
  setInfoWindow(infoWindow);

  return { map, infoWindow };
}

function fixAMapArrowShader(map) {
  // 高德 2.0 原生箭头 GLSL 的 clamp 参数颠倒，在 SwiftShader 上采样为空。
  // 只修正此地图 WebGL 上下文的已知错误表达式，不改 SDK 文件或其他着色器。
  const gl = map.getContext().gl;
  if (arrowShaderContexts.has(gl)) return;
  const shaderSource = gl.shaderSource;
  gl.shaderSource = function (shader, source) {
    return shaderSource.call(
      this,
      shader,
      source.replaceAll(
        'clamp(0.0,1.0,text_offset_x/icon_size.x)',
        'clamp(text_offset_x/icon_size.x,0.0,1.0)'
      )
    );
  };
  arrowShaderContexts.add(gl);
}

// ─── Marker ────────────────────────────────────────────

export function createAllMarkers() {
  const trip = getTrip();
  Object.keys(trip.locations).forEach(locationId => {
    const loc = getLocation(locationId);
    // 没有 lnglat 时跳过——首次启动 demo trip 不带内置坐标，
    // 等 resolveAllLocations 异步从高德拿到坐标后再创建 marker。
    if (!Array.isArray(loc.lnglat) || loc.lnglat.length < 2) return;
    createOrUpdateMarker(locationId, loc.lnglat);
  });
}

export function createOrUpdateMarker(locationId, lnglat) {
  // 防御：lnglat 缺失时不创建 marker，避免给 AMap 喂 undefined
  if (!Array.isArray(lnglat) || lnglat.length < 2) return null;
  const state = getAppState();
  if (!state.AMap || !state.map) return null;

  const existing = state.markers.get(locationId);
  if (existing) {
    existing.setPosition(lnglat);
    return existing;
  }

  const content = document.createElement('div');
  content.className = 'custom-marker';
  content.dataset.locationId = locationId;
  content.dataset.lng = String(Number(lnglat[0]));
  content.dataset.lat = String(Number(lnglat[1]));
  content.innerHTML = '<span></span>';

  const marker = new state.AMap.Marker({
    position: lnglat,
    content,
    offset: new state.AMap.Pixel(-14, -14)
  });
  // 缓存 content 元素，方便后续给 marker 加 CSS 动画 class（脉冲效果）
  marker._contentEl = content;
  marker.on('click', () => {
    openInfoWindow(locationId);
    markerSelectHandler?.(locationId);
  });

  state.markers.set(locationId, marker);
  state.markerList.push(marker);
  state.map.add(marker);
  return marker;
}

export function removeMarker(locationId) {
  const state = getAppState();
  const marker = state.markers.get(locationId);
  if (!marker) return;

  // 清理可能正在运行的 pulse 定时器
  if (marker._pulseTimerId) {
    clearTimeout(marker._pulseTimerId);
    marker._pulseTimerId = null;
  }

  try {
    state.map.remove(marker);
  } catch (err) {
    log.warn('移除 Marker 失败：', err);
  }
  state.markers.delete(locationId);
  state.markerList = state.markerList.filter(item => item !== marker);
}

export function showCandidatePreview(place, anchorLocation = null) {
  clearCandidatePreview();
  const state = getAppState();
  if (!Array.isArray(place?.lnglat) || !state.AMap || !state.map) return;
  const content = document.createElement('div');
  content.className = 'custom-marker candidate-preview-marker';
  content.innerHTML = '<span></span>';
  const marker = new state.AMap.Marker({
    position: place.lnglat,
    content,
    offset: new state.AMap.Pixel(-14, -14)
  });
  const overlays = [marker];
  const anchor = anchorLocation?.lnglat;
  if (Array.isArray(anchor)) {
    overlays.push(
      new state.AMap.Polyline({
        path: [anchor, place.lnglat],
        strokeColor: ROUTE_GUIDANCE.line,
        strokeOpacity: 0.72,
        strokeWeight: 3,
        strokeStyle: 'dashed'
      })
    );
  }
  state.candidatePreview = overlays;
  state.map.add(overlays);
  fitMarkers([marker]);
}

export function clearCandidatePreview() {
  const state = getAppState();
  if (!state.candidatePreview?.length) return;
  state.map?.remove(state.candidatePreview);
  state.candidatePreview = null;
}

export function clearAllMarkers() {
  const state = getAppState();
  state.markerList.forEach(marker => {
    try {
      state.map.remove(marker);
    } catch (err) {
      log.warn('移除 Marker 失败：', err);
    }
  });
  state.markers.clear();
  state.markerList = [];
}

export function pruneMarkersToLocationIds(locationIds) {
  const keep = new Set(locationIds);
  Array.from(getAppState().markers.keys()).forEach(locationId => {
    if (!keep.has(locationId)) removeMarker(locationId);
  });
}

export function showEmptyMapView() {
  const state = getAppState();
  clearRouteOverlays();
  clearAllMarkers();
  try {
    state.infoWindow?.close?.();
  } catch {
    // AMap may throw while tearing down an InfoWindow; the empty-map view can continue safely.
  }
  if (state.map) {
    state.map.setZoomAndCenter(AppConfig.emptyMapZoom, AppConfig.emptyMapCenter, true);
  }
}

// ─── 显示哪些 marker（按当前选中的日期） ──────────────────

export function showMarkersForDay(dayId) {
  const state = getAppState();
  state.markerList.forEach(m => m.hide());

  const visible = getVisibleMarkers(dayId);
  visible.forEach(m => m.show());
  return visible;
}

function getVisibleMarkers(dayId) {
  const state = getAppState();
  if (dayId === 'all') return state.markerList;

  const trip = getTrip();
  const day = trip.days.find(d => d.id === dayId);
  if (!day) return [];

  const ids = unique(day.events.map(e => e.locationId));
  return ids.map(id => state.markers.get(id)).filter(Boolean);
}

// ─── 视野 ──────────────────────────────────────────────
// 自接管缓动：AMap 内置过渡曲线偏中性，达不到"先快后慢"的高级感。
// 这里用 RAF 逐帧插值 center / zoom，曲线选 ease-out-cubic，
// 每帧调 setZoomAndCenter(..., true) 让 AMap 立刻渲染当前帧。
//
// 视觉时长 + 曲线在这两个常量里调，动画感觉不对就改这两个值：
const PAN_DURATION = 900;
const EASE = t => 1 - Math.pow(1 - t, 3); // ease-out-cubic
const FIT_PADDING = [60, 60, 60, 60];

let activeAnimId = 0;
let infoWindowTimer = null;

function asLngLat(value) {
  if (!value) return [0, 0];
  if (Array.isArray(value)) return [Number(value[0]), Number(value[1])];
  if (typeof value.getLng === 'function') return [Number(value.getLng()), Number(value.getLat())];
  return [Number(value.lng ?? value.Lng ?? 0), Number(value.lat ?? value.Lat ?? 0)];
}

function animateMapTo(targetLngLat, targetZoom, duration = PAN_DURATION) {
  const state = getAppState();
  if (!state.map) return;

  if (activeAnimId) cancelAnimationFrame(activeAnimId);

  const startCenter = asLngLat(state.map.getCenter());
  const startZoom = state.map.getZoom();
  const [endLng, endLat] = asLngLat(targetLngLat);
  const endZoom = Number(targetZoom ?? startZoom);

  const startTime = performance.now();

  const frame = now => {
    const t = Math.min((now - startTime) / duration, 1);
    const k = EASE(t);
    const lng = startCenter[0] + (endLng - startCenter[0]) * k;
    const lat = startCenter[1] + (endLat - startCenter[1]) * k;
    const zoom = startZoom + (endZoom - startZoom) * k;
    state.map.setZoomAndCenter(zoom, [lng, lat], true); // immediately=true，本帧立刻渲染
    if (t < 1) {
      activeAnimId = requestAnimationFrame(frame);
    } else {
      activeAnimId = 0;
    }
  };
  activeAnimId = requestAnimationFrame(frame);
}

export function fitMarkers(markers) {
  const state = getAppState();
  if (!markers.length) return;
  if (markers.length === 1) {
    animateMapTo(markers[0].getPosition(), 14);
    return;
  }
  // 多点适配：先让 AMap 算出"刚好包住所有 marker"的 zoom/center，
  // 然后用我们的 RAF 缓动平滑过渡过去（绕开 AMap 自己那段不够"丝滑"的过渡）。
  if (activeAnimId) cancelAnimationFrame(activeAnimId);
  const target = computeFitView(state.map, markers, FIT_PADDING, 17);
  if (!target) {
    state.map.setFitView(markers, false, FIT_PADDING, 17);
    return;
  }
  animateMapTo(target.center, target.zoom);
}

function computeFitView(map, markers, padding, maxZoom) {
  // AMap 没有公开"只算不画"的方法。这里调一次 setFitView(immediately=true) 把 map 跳到目标，
  // 立刻读 center/zoom，再恢复原状（视觉上等于没动）。这样我们就拿到了目标值，
  // 后面用 RAF 自己缓动过去。
  try {
    const beforeCenter = asLngLat(map.getCenter());
    const beforeZoom = map.getZoom();
    map.setFitView(markers, true, padding, maxZoom);
    const center = asLngLat(map.getCenter());
    const zoom = map.getZoom();
    map.setZoomAndCenter(beforeZoom, beforeCenter, true); // 还原
    return { center, zoom };
  } catch {
    return null;
  }
}

export function fitSegment(segment) {
  const markers = [getMarker(segment.fromId), getMarker(segment.toId)].filter(Boolean);
  fitMarkers(markers);
}

export function focusLocation(locationId) {
  const state = getAppState();
  const marker = state.markers.get(locationId);
  if (!marker) return;
  marker.show();
  animateMapTo(marker.getPosition(), 15);

  // 同步刷新 InfoWindow 的开窗时机：等到 RAF 动画结束再弹
  if (infoWindowTimer) clearTimeout(infoWindowTimer);
  infoWindowTimer = setTimeout(() => openInfoWindow(locationId), PAN_DURATION + 60);
}

// ─── InfoWindow ────────────────────────────────────────

export function openInfoWindow(locationId) {
  const state = getAppState();
  const loc = getLocation(locationId);
  const marker = state.markers.get(locationId);
  if (!loc || !marker) return;

  state.infoWindow.setContent(`
    <div class="info-window-content">
      <h3 class="info-window-title">${escapeHTML(loc.name)}</h3>
      <p class="info-window-addr">${escapeHTML(loc.addr || loc.query || loc.name)}</p>
    </div>
  `);
  state.infoWindow.open(state.map, marker.getPosition());
}

// ─── Polyline（画路线） ─────────────────────────────────
// 每段路线按 segmentId 存进 state.routeOverlays（Map），方便点击某段时高亮"它"
// 而不是其他段。

const ROUTE_DEFAULT = ROUTE_GUIDANCE.default;
const ROUTE_DIM = ROUTE_GUIDANCE.dim;
const ROUTE_ACTIVE = ROUTE_GUIDANCE.active;
const PULSE_DURATION_MS = 1400;

export function drawRoutePaths(segment, paths, dashed = false) {
  const state = getAppState();
  if (!state.AMap.__fallback) fixAMapArrowShader(state.map);
  const polylines = [];
  paths.forEach(path => {
    if (path.length < 2) return;
    polylines.push(addPolyline(path, dashed, segment.color));
  });
  state.routeOverlays.set(segment.id, {
    polylines,
    halo: [],
    color: segment.color,
    dashed
  });
  if (polylines.length) document.getElementById('route-daylight-legend').hidden = false;
}

function addPolyline(path, dashed, color) {
  const state = getAppState();
  const polyline = new state.AMap.Polyline({
    path,
    isOutline: true,
    outlineColor: ROUTE_GUIDANCE.outline,
    borderWeight: 2,
    strokeColor: color,
    strokeOpacity: ROUTE_DEFAULT.strokeOpacity,
    strokeWeight: ROUTE_DEFAULT.strokeWeight,
    strokeStyle: dashed ? 'dashed' : 'solid',
    lineJoin: 'round',
    lineCap: 'round',
    zIndex: ROUTE_DEFAULT.zIndex,
    showDir: !dashed
  });
  state.map.add(polyline);
  return polyline;
}

export function clearRouteOverlays() {
  document.getElementById('route-daylight-legend').hidden = true;
  const state = getAppState();
  state.routeOverlays.forEach(entry => {
    entry.polylines.forEach(p => safeRemoveOverlay(state.map, p));
    entry.halo.forEach(p => safeRemoveOverlay(state.map, p));
  });
  state.routeOverlays.clear();
  state.activeRouteSegmentId = null;
}

function safeRemoveOverlay(map, overlay) {
  try {
    map.remove(overlay);
  } catch (err) {
    log.warn('清除自绘路线失败：', err);
  }
}

// ─── 路线高亮 ─────────────────────────────────────────
// 视觉策略：选中的 polyline 加粗 + 提亮 + 下方叠一层"发光环"；
// 其它 polyline 半透明降权重；起终点 marker 短暂脉冲。

export function highlightSegment(segmentId) {
  const state = getAppState();
  if (!state.map || !state.routeOverlays.has(segmentId)) return;

  state.activeRouteSegmentId = segmentId;

  state.routeOverlays.forEach((entry, id) => {
    const isActive = id === segmentId;
    // 先清掉这段之前的发光环（来自上一次高亮，可能没及时清）
    entry.halo.forEach(p => safeRemoveOverlay(state.map, p));
    entry.halo = [];

    const target = isActive ? ROUTE_ACTIVE : ROUTE_DIM;
    entry.polylines.forEach(line => {
      try {
        line.setOptions({
          strokeWeight: target.strokeWeight,
          strokeOpacity: target.strokeOpacity,
          zIndex: target.zIndex
        });
      } catch {
        // Ignore stale AMap polyline instances during route highlight refresh.
      }
    });

    if (isActive) {
      // 在每条 polyline 下方再叠一层同 path 的 halo（更粗、半透明、无 outline）
      entry.polylines.forEach(line => {
        try {
          const path = line.getPath?.();
          if (!path || path.length < 2) return;
          const halo = new state.AMap.Polyline({
            path,
            isOutline: false,
            strokeColor: entry.color || ROUTE_GUIDANCE.line,
            strokeOpacity: ROUTE_GUIDANCE.halo.strokeOpacity,
            strokeWeight: ROUTE_GUIDANCE.halo.strokeWeight,
            strokeStyle: 'solid',
            lineJoin: 'round',
            lineCap: 'round',
            zIndex: ROUTE_ACTIVE.zIndex - 10
          });
          state.map.add(halo);
          entry.halo.push(halo);
        } catch {
          // Ignore stale AMap polyline instances during route highlight refresh.
        }
      });
    }
  });

  // 起终点 marker 脉冲
  pulseMarkerByLocationId(getSegmentEndpointIds(segmentId).from);
  pulseMarkerByLocationId(getSegmentEndpointIds(segmentId).to);
}

export function clearSegmentHighlight() {
  const state = getAppState();
  state.routeOverlays.forEach(entry => {
    entry.polylines.forEach(line => {
      try {
        line.setOptions({
          strokeWeight: ROUTE_DEFAULT.strokeWeight,
          strokeOpacity: ROUTE_DEFAULT.strokeOpacity,
          zIndex: ROUTE_DEFAULT.zIndex
        });
      } catch {
        // Ignore stale AMap polyline instances during route highlight cleanup.
      }
    });
    entry.halo.forEach(p => safeRemoveOverlay(state.map, p));
    entry.halo = [];
  });
  state.activeRouteSegmentId = null;
}

// 根据 segmentId 推回起终点 locationId。segment.id 形如 "${dayId}-route-${eventIndex}"，
// 配合当前 trip 数据可以反查到 events[i] 和 events[i+1] 的 locationId。
function getSegmentEndpointIds(segmentId) {
  const trip = getTrip();
  for (const day of trip?.days || []) {
    for (let i = 0; i < (day.events?.length || 0) - 1; i += 1) {
      if (`${day.id}-route-${i}` === segmentId) {
        return {
          from: day.events[i].locationId,
          to: day.events[i + 1].locationId
        };
      }
    }
  }
  return { from: null, to: null };
}

function pulseMarkerByLocationId(locationId) {
  if (!locationId) return;
  const marker = getAppState().markers.get(locationId);
  const el = marker?._contentEl;
  if (!el) return;
  el.classList.remove('pulse');
  void el.offsetWidth;
  el.classList.add('pulse');
  const pid = setTimeout(() => el.classList.remove('pulse'), PULSE_DURATION_MS);
  marker._pulseTimerId = pid; // 供 removeMarker 清理
}
