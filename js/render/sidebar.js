// js/render/sidebar.js
// 侧边栏渲染：tabs + 行程卡 + 路线卡
//
// 这个模块只做"把数据画出来"和"暴露交互回调"两件事：
//   - 渲染：从 state 读 trip 数据，输出 DOM
//   - 回调：用户点了 tab / event / route，会调 main.js 传进来的 handler
// 这样 sidebar 不直接依赖 main.js，main.js 决定点击后做什么

import { getTrip, getLocation, getAppState, getRouteCard, hasActiveTrip } from '../state.js';
import { escapeHTML, formatDistance, formatDuration, getTransportLabel } from '../utils.js';
import { getIconIdForEvent, renderIconSVG } from './icons.js';
import { getTimeSlotLabel, getTimeSlotHour, normalizeTimeSlot } from '../time-slots.js';
import { getRouteDaylightColor } from '../route-guidance.js';
import { getRouteDisplayLabel, normalizeRouteToNext } from '../route-config.js';

// ─── 静态部分（标题副标题） ─────────────────────────────

export function renderHeader() {
  const trip = getTrip();
  const titleEl = document.getElementById('trip-title-text');
  const subtitleEl = document.getElementById('trip-subtitle');
  if (!hasActiveTrip()) {
    if (titleEl) titleEl.textContent = '还没有行程';
    if (subtitleEl) subtitleEl.textContent = '点击添加第一个行程';
    return;
  }
  if (titleEl) titleEl.textContent = cleanHeaderText(trip.title);
  if (subtitleEl) subtitleEl.textContent = cleanHeaderText(trip.subtitle);
}

function cleanHeaderText(value) {
  return String(value || '')
    .replace(/^(\u{1F392}|\u9983\u5E13)\s*/u, '')
    .replace(/\s*(\u{1F4CD}|\u9983\u6437)\s*$/u, '');
}

// ─── Tabs ─────────────────────────────────────────────

// handlers: { onSelectDay: (dayId) => void }
export function renderTabs(handlers) {
  const tabs = document.getElementById('tabs-container');
  const trip = getTrip();
  tabs.innerHTML = '';
  if (!hasActiveTrip()) return;

  tabs.appendChild(createTabButton('all', '全部日期', handlers));
  // V5：tab 按钮显示 "Day 1" / "Day 2" 而不是日期
  trip.days.forEach((day, dayIndex) => {
    tabs.appendChild(createTabButton(day.id, `Day ${dayIndex + 1}`, handlers));
  });

  const addDayBtn = document.createElement('button');
  addDayBtn.type = 'button';
  addDayBtn.className = 'tab-btn tab-add-day-btn';
  addDayBtn.textContent = '+';
  addDayBtn.title = '新建一天';
  addDayBtn.setAttribute('aria-label', '新建一天');
  addDayBtn.addEventListener('click', () => handlers.onAddDay?.());
  tabs.appendChild(addDayBtn);
}

function createTabButton(dayId, label, handlers) {
  const btn = document.createElement('button');
  btn.className = 'tab-btn';
  btn.dataset.dayId = dayId;
  btn.textContent = label;
  btn.addEventListener('click', () => handlers.onSelectDay?.(dayId));
  return btn;
}

export function updateActiveTab(dayId) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.dayId === dayId);
  });
}

export function updateVisibleDayGroups(dayId) {
  const container = document.getElementById('itinerary-container');
  if (container) container.scrollTop = 0;

  document.querySelectorAll('.day-group').forEach(group => {
    const isUnscheduled = group.dataset.dayId === 'unscheduled';
    group.style.display = (
      isUnscheduled ? dayId === 'all' : dayId === 'all' || group.dataset.dayId === dayId
    )
      ? 'block'
      : 'none';
  });
  document.querySelectorAll('.route-card').forEach(card => {
    card.hidden = dayId === 'all';
  });
  document.querySelectorAll('.day-add-btn').forEach(btn => {
    btn.hidden = btn.classList.contains('unscheduled-add-btn') ? dayId !== 'all' : dayId === 'all';
  });
  // 空天提示在所有视图下都展示——只要这一天没有地点，就提示用户去添加。
  document.querySelectorAll('.empty-day-state').forEach(state => {
    state.hidden = false;
  });
}

// ─── 行程主体 ────────────────────────────────────────────

// handlers: { onEventClick, onRouteClick }
export function renderItinerary(handlers) {
  const container = document.getElementById('itinerary-container');
  const state = getAppState();
  const trip = getTrip();
  container.innerHTML = '';
  state.routeCards.clear();

  if (!hasActiveTrip()) {
    container.innerHTML = `
      <div class="workspace-empty-state">
        <div class="workspace-empty-actions">
          <button type="button" class="workspace-empty-create" aria-label="新建空白行程">
            <span class="workspace-empty-create-mark">+</span>
            <span>新建空白行程</span>
          </button>
          <button type="button" class="workspace-empty-import" aria-label="AI 导入攻略">
            <span class="workspace-empty-import-mark">AI</span>
            <span>AI 导入攻略</span>
          </button>
        </div>
      </div>
    `;
    container.querySelector('.workspace-empty-create')?.addEventListener('click', () => {
      handlers.onCreateTrip?.();
    });
    container.querySelector('.workspace-empty-import')?.addEventListener('click', () => {
      handlers.onImportGuide?.();
    });
    return;
  }

  if (!trip.days.length) {
    container.innerHTML = `
      <div class="trip-empty-days-state">
        <button type="button" class="empty-day-create-btn" aria-label="新建一天">+</button>
        <p>还没有日期，点击上方 + 新建一天</p>
      </div>
    `;
    container.querySelector('.empty-day-create-btn')?.addEventListener('click', () => {
      handlers.onAddDay?.();
    });
    return;
  }

  trip.days.forEach((day, dayIndex) => {
    // V5：标签变成 "Day N · 标题"，title 留空时显示"新的一天"
    const dayLabel = day.title?.trim() || '新的一天';
    const dayGroup = document.createElement('section');
    dayGroup.className = 'day-group';
    dayGroup.dataset.dayId = day.id;
    dayGroup.innerHTML = `
      <div class="day-title">
        <div class="day-title-main">
          <span class="day-title-label">Day ${dayIndex + 1} · ${escapeHTML(dayLabel)}</span>
          <button type="button" class="day-edit-btn" title="编辑这一天">···</button>
        </div>
        <button type="button" class="day-add-btn">+ 添加地点</button>
      </div>
      <div class="event-container"></div>
    `;

    dayGroup.querySelector('.day-edit-btn').addEventListener('click', () => {
      handlers.onEditDay?.(day.id);
    });

    dayGroup.querySelector('.day-add-btn').addEventListener('click', () => {
      handlers.onAddLocation?.(day.id);
    });

    const eventsContainer = dayGroup.querySelector('.event-container');
    bindContainerDropEvents(eventsContainer, day, handlers);

    if (!day.events.length) {
      eventsContainer.classList.add('event-container-empty');
      eventsContainer.innerHTML = `
        <div class="empty-day-state">
          <button type="button" class="empty-day-create-btn" aria-label="添加第一个地点">+</button>
          <p>这一天还没有地点，点击添加第一个地点</p>
        </div>
      `;
      eventsContainer.querySelector('.empty-day-create-btn').addEventListener('click', () => {
        handlers.onAddLocation?.(day.id);
      });
      container.appendChild(dayGroup);
      return;
    }

    day.events.forEach((event, eventIndex) => {
      eventsContainer.appendChild(createEventCard(day, event, eventIndex, handlers));

      const nextEvent = day.events[eventIndex + 1];
      if (shouldCreateRouteCard(event, nextEvent)) {
        const segment = buildRouteSegment(day, event, nextEvent, eventIndex);
        eventsContainer.appendChild(createRouteCard(segment, handlers));
      }
    });

    container.appendChild(dayGroup);
  });

  // V5 新增：未排期 section（与 day-group 并列，始终展示在末尾）
  // - 数据来自 trip.unscheduled，只有"全部日期"页展示
  // - 不画 routeToNext route-card（unscheduled events 之间没有路线）
  const unscheduled = trip.unscheduled || [];
  const unsGroup = document.createElement('section');
  unsGroup.className = 'day-group day-group-unscheduled';
  unsGroup.dataset.dayId = 'unscheduled';
  unsGroup.innerHTML = `
    <div class="day-title">
      <div class="day-title-main">
        <span class="day-title-label">未排期</span>
      </div>
      <button type="button" class="day-add-btn unscheduled-add-btn">+ 添加地点</button>
    </div>
    <div class="event-container"></div>
  `;

  unsGroup.querySelector('.unscheduled-add-btn').addEventListener('click', () => {
    handlers.onAddUnscheduledLocation?.();
  });

  const evContainer = unsGroup.querySelector('.event-container');
  const mockDay = { id: 'unscheduled', events: unscheduled };
  bindContainerDropEvents(evContainer, mockDay, handlers);

  if (!unscheduled.length) {
    evContainer.classList.add('event-container-empty', 'event-container-unscheduled-empty');
    evContainer.innerHTML = `
      <div class="empty-day-state unscheduled-empty-state">
        <p>可以把暂不确定日期的地点放在这里</p>
      </div>
    `;
  } else {
    unscheduled.forEach((event, idx) => {
      evContainer.appendChild(createEventCard(mockDay, event, idx, handlers));
    });
  }

  container.appendChild(unsGroup);
}

// ─── Event 卡 ──────────────────────────────────────────

function createEventCard(day, event, eventIndex, handlers) {
  const isUnscheduled = day.id === 'unscheduled';
  const loc = getLocation(event.locationId);
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.locationId = event.locationId;
  card.dataset.eventId = event.id;
  card.dataset.dayId = day.id;
  card.dataset.timeSlot = normalizeTimeSlot(event.timeSlot);
  card.tabIndex = 0;
  card.setAttribute('aria-label', `在地图上查看${event.title || loc.name}`);
  const selected = getAppState().selectedTarget;
  if (selected?.kind === 'place' && selected.dayId === day.id && selected.eventId === event.id) {
    card.classList.add('active');
    card.setAttribute('aria-current', 'true');
  }
  const iconHTML = renderIconSVG(getIconIdForEvent(event, loc));
  const timeSlot = normalizeTimeSlot(event.timeSlot);
  const timeBadgeHTML = timeSlot
    ? `<span class="event-time-badge">${escapeHTML(getTimeSlotLabel(timeSlot))}</span>`
    : '';
  const addTimeHTML = timeSlot
    ? ''
    : '<button type="button" class="event-add-time-btn">+ 添加时间</button>';
  const noteHTML = event.note ? `<div class="event-note">${escapeHTML(event.note)}</div>` : '';
  const actionHTML = isUnscheduled
    ? `
        <button type="button" class="event-action-btn" data-action="edit" title="编辑">···</button>
        <button type="button" class="event-action-btn danger" data-action="delete" title="删除">−</button>
      `
    : `
        <button type="button" class="event-action-btn" data-action="edit" title="编辑">···</button>
        <button type="button" class="event-action-btn" data-action="add-after" title="后面添加">+</button>
        <button type="button" class="event-action-btn danger" data-action="delete" title="删除">−</button>
        <button type="button" class="event-action-btn" data-action="move-up" title="上移" ${canMoveWithinTimeSlot(day, eventIndex, 'up') ? '' : 'disabled'}>↑</button>
        <button type="button" class="event-action-btn" data-action="move-down" title="下移" ${canMoveWithinTimeSlot(day, eventIndex, 'down') ? '' : 'disabled'}>↓</button>
      `;
  card.innerHTML = `
    <button type="button" class="drag-handle" draggable="true" aria-label="拖动排序" title="拖动排序">⋮⋮</button>
    <div class="card-icon" aria-hidden="true">${iconHTML}</div>
    <div class="card-content">
      <div class="card-header">
        ${timeBadgeHTML}
        <span class="event-desc">${escapeHTML(event.title || '')}</span>
        ${addTimeHTML}
      </div>
      <div class="location-info">
        <svg class="location-icon" width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
        </svg>
        <span>${escapeHTML(loc.name)}</span>
      </div>
      ${noteHTML}
      <div class="card-actions">
        ${actionHTML}
      </div>
    </div>
  `;

  const activateCard = () => {
    document.querySelectorAll('.card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    handlers.onEventClick?.(day.id, event);
  };
  card.addEventListener('click', activateCard);
  card.addEventListener('keydown', event => {
    if (event.target !== card || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    activateCard();
  });

  bindDragEvents(card, day, event, handlers);

  card.querySelector('.event-add-time-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    handlers.onEditEvent?.(day.id, event);
  });

  card.querySelector('.card-actions').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || btn.disabled) return;
    e.stopPropagation();

    const action = btn.dataset.action;
    if (action === 'edit') handlers.onEditEvent?.(day.id, event);
    if (action === 'add-after') handlers.onAddAfterEvent?.(day.id, event.id);
    if (action === 'move-up') handlers.onMoveEvent?.(day.id, event.id, 'up');
    if (action === 'move-down') handlers.onMoveEvent?.(day.id, event.id, 'down');
    if (action === 'delete') handlers.onDeleteEvent?.(day.id, event);
  });

  return card;
}

function bindDragEvents(card, day, event, handlers) {
  const handle = card.querySelector('.drag-handle');

  handle.addEventListener('click', e => e.stopPropagation());
  handle.addEventListener('dragstart', e => {
    e.stopPropagation();
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(
      'text/plain',
      JSON.stringify({
        dayId: day.id,
        eventId: event.id,
        timeSlot: normalizeTimeSlot(event.timeSlot)
      })
    );
  });

  handle.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    clearDragInsertState();
  });

  card.addEventListener('dragover', e => {
    e.preventDefault();
    e.stopPropagation();
    clearDragInsertState(card);
    card.classList.toggle('drag-insert-before', getInsertPosition(e, card) === 'before');
    card.classList.toggle('drag-insert-after', getInsertPosition(e, card) === 'after');
    e.dataTransfer.dropEffect = 'move';
  });

  card.addEventListener('dragleave', () => {
    card.classList.remove('drag-insert-before', 'drag-insert-after');
  });

  card.addEventListener('drop', e => {
    const payload = readDragPayload(e);
    if (!payload || payload.eventId === event.id) return;
    e.preventDefault();
    e.stopPropagation();
    const position = getInsertPosition(e, card);
    const targetIndex = (day.events || []).findIndex(item => item.id === event.id);
    const afterEventId =
      position === 'after' ? event.id : getPreviousEventId(day.events || [], targetIndex);
    const explicitIndex = position === 'before' && targetIndex === 0 ? 0 : undefined;
    clearDragInsertState();
    handlers.onDropEvent?.(payload, {
      dayId: day.id,
      timeSlot: normalizeTimeSlot(event.timeSlot),
      afterEventId,
      index: explicitIndex
    });
  });
}

function bindContainerDropEvents(container, day, handlers) {
  container.addEventListener('dragover', e => {
    if (e.target.closest('.card')) return;
    e.preventDefault();
    container.classList.add('drag-container-over');
    e.dataTransfer.dropEffect = 'move';
  });

  container.addEventListener('dragleave', e => {
    if (container.contains(e.relatedTarget)) return;
    container.classList.remove('drag-container-over');
  });

  container.addEventListener('drop', e => {
    if (e.target.closest('.card')) return;
    const payload = readDragPayload(e);
    if (!payload) return;
    e.preventDefault();
    container.classList.remove('drag-container-over');
    const events = day.events || [];
    handlers.onDropEvent?.(payload, {
      dayId: day.id,
      timeSlot: normalizeTimeSlot(payload.timeSlot),
      afterEventId: events.length ? events[events.length - 1].id : null,
      index: events.length
    });
  });
}

function getInsertPosition(e, card) {
  const rect = card.getBoundingClientRect();
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

function getPreviousEventId(events, index) {
  if (index <= 0) return null;
  return events[index - 1]?.id || null;
}

function clearDragInsertState(except = null) {
  document.querySelectorAll('.card.drag-insert-before, .card.drag-insert-after').forEach(el => {
    if (el === except) return;
    el.classList.remove('drag-insert-before', 'drag-insert-after');
  });
  document.querySelectorAll('.event-container.drag-container-over').forEach(el => {
    el.classList.remove('drag-container-over');
  });
}

function canMoveWithinTimeSlot(day, eventIndex, direction) {
  const targetIndex = direction === 'up' ? eventIndex - 1 : eventIndex + 1;
  if (targetIndex < 0 || targetIndex >= day.events.length) return false;
  return (
    normalizeTimeSlot(day.events[eventIndex]?.timeSlot) ===
    normalizeTimeSlot(day.events[targetIndex]?.timeSlot)
  );
}

function readDragPayload(e) {
  try {
    const raw = e.dataTransfer.getData('text/plain');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ─── Route 卡 ──────────────────────────────────────────

function createRouteCard(segment, handlers) {
  const state = getAppState();
  const card = document.createElement('article');
  card.className = 'route-card idle';
  card.dataset.routeId = segment.id;
  card.tabIndex = 0;
  card.setAttribute('aria-label', `在地图上查看${getRouteDisplayLabel(segment.routeToNext)}路线`);
  const selected = state.selectedTarget;
  if (selected?.kind === 'route' && selected.segmentId === segment.id) {
    card.classList.add('selected');
    card.setAttribute('aria-current', 'true');
  }
  card.style.setProperty('--route-color', segment.color);
  card.innerHTML = renderRouteIdleHTML(segment);
  card.addEventListener('click', e => {
    const btn = e.target.closest('.route-edit-btn');
    if (btn) {
      e.stopPropagation();
      handlers.onEditRoute?.(segment);
      return;
    }
    handlers.onRouteClick?.(segment);
  });
  card.addEventListener('keydown', event => {
    if (event.target !== card || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    handlers.onRouteClick?.(segment);
  });
  state.routeCards.set(segment.id, card);
  return card;
}

export function updateSelectedTargetUI(target, { reveal = false } = {}) {
  document.querySelectorAll('.card.active, .route-card.selected').forEach(element => {
    element.classList.remove('active', 'selected');
    element.removeAttribute('aria-current');
  });
  if (!target) return;
  const selector =
    target.kind === 'place'
      ? `.card[data-day-id="${CSS.escape(target.dayId)}"][data-event-id="${CSS.escape(target.eventId)}"]`
      : `.route-card[data-route-id="${CSS.escape(target.segmentId)}"]`;
  const element = document.querySelector(selector);
  if (!element) return;
  element.classList.add(target.kind === 'place' ? 'active' : 'selected');
  element.setAttribute('aria-current', 'true');
  if (reveal) element.scrollIntoView({ block: 'nearest' });
}

function renderRouteIdleHTML(segment) {
  const label = getRouteDisplayLabel(segment.routeToNext);
  return `
    <div class="route-card-main">
      <div class="route-body">
        <div class="route-title">
          <span class="route-mode">${escapeHTML(label)}</span>
        </div>
        <div class="route-placeholder">选择当天后加载距离、用时和路线。</div>
        <button type="button" class="route-edit-btn" title="编辑路线">编辑</button>
      </div>
    </div>
  `;
}

// ─── Route 卡的状态切换 ─────────────────────────────────

export function setRouteCardLoading(segment) {
  const card = getRouteCard(segment.id);
  if (!card) return;
  card.className = 'route-card loading';
  card.style.setProperty('--route-color', segment.color);
  card.innerHTML = `
    <div class="route-card-main">
      <div class="route-body">
        <div class="route-title">
          <span class="route-mode">${escapeHTML(getRouteDisplayLabel(segment.routeToNext))}</span>
        </div>
        <div class="route-placeholder">正在规划路线...</div>
        <button type="button" class="route-edit-btn" title="编辑路线">编辑</button>
      </div>
    </div>
  `;
}

export function updateRouteCardOk(segment, detail) {
  renderRouteCardResult(segment, detail, 'ok');
}

export function updateRouteCardEstimated(segment, detail) {
  renderRouteCardResult(segment, detail, 'estimated');
}

export function updateRouteCardError(segment, message) {
  const card = getRouteCard(segment.id);
  if (!card) return;
  card.className = 'route-card error';
  card.style.setProperty('--route-color', segment.color);
  card.innerHTML = `
    <div class="route-card-main">
      <div class="route-body">
        <div class="route-title">
          <span class="route-mode">${escapeHTML(getRouteDisplayLabel(segment.routeToNext))}</span>
        </div>
        <div class="route-placeholder">${escapeHTML(message)}</div>
        <button type="button" class="route-edit-btn" title="编辑路线">编辑</button>
      </div>
    </div>
  `;
}

function renderRouteCardResult(segment, detail, statusClass) {
  const card = getRouteCard(segment.id);
  if (!card) return;
  card.className = `route-card ${statusClass}`;
  card.style.setProperty('--route-color', segment.color);

  const meta = `约 ${formatDistance(detail.distance)} · 预计 ${formatDuration(detail.duration)}`;
  const route = normalizeRouteToNext(segment.routeToNext);
  const customSteps = route.legs?.map(leg => `${getTransportLabel(leg.mode)}：${leg.label}`) || [];
  const steps = customSteps.length ? customSteps : detail.mode === 'transit' ? detail.steps : [];

  card.innerHTML = `
    <div class="route-card-main">
      <div class="route-body">
        <div class="route-title">
          <span class="route-mode">${escapeHTML(detail.label)}</span>
        </div>
        <div class="route-meta">${meta}</div>
        <button type="button" class="route-edit-btn" title="编辑路线">编辑</button>
        ${
          steps.length
            ? `<ol class="route-steps">${steps
                .map(
                  (step, i) => `
          <li class="route-step"><span class="route-step-index">${i + 1}</span><span>${escapeHTML(step)}</span></li>
        `
                )
                .join('')}</ol>`
            : ''
        }
      </div>
    </div>
  `;
}

export function resetRouteCards() {
  const trip = getTrip();
  trip.days.forEach(day => {
    buildRouteSegments(day).forEach(segment => {
      const card = getRouteCard(segment.id);
      if (!card) return;
      card.className = 'route-card idle';
      card.style.setProperty('--route-color', segment.color);
      card.innerHTML = renderRouteIdleHTML(segment);
    });
  });
}

// ─── Status panel ──────────────────────────────────────

let statusRevision = 0;

export function setStatus(text) {
  const el = document.getElementById('status-panel');
  if (!el) return;
  const nextText = String(text || '');
  const revision = ++statusRevision;
  if (el.textContent === nextText) {
    el.textContent = '';
    Promise.resolve().then(() => {
      if (el.isConnected && revision === statusRevision) el.textContent = nextText;
    });
  } else {
    el.textContent = nextText;
  }
  el.setAttribute('aria-busy', String(/正在|加载中|搜索中|匹配中/.test(nextText)));
}

// ─── Segment 构造（被 sidebar 和 main 都用到） ────────────

export function shouldCreateRouteCard(event, nextEvent) {
  return Boolean(
    event &&
    nextEvent &&
    event.routeToNext &&
    event.locationId &&
    nextEvent.locationId &&
    event.locationId !== nextEvent.locationId
  );
}

export function buildRouteSegments(day) {
  const segments = [];
  day.events.forEach((event, eventIndex) => {
    const next = day.events[eventIndex + 1];
    if (!shouldCreateRouteCard(event, next)) return;
    segments.push(buildRouteSegment(day, event, next, eventIndex));
  });
  return segments;
}

function buildRouteSegment(day, event, nextEvent, eventIndex) {
  const fromLoc = getLocation(event.locationId);
  const toLoc = getLocation(nextEvent.locationId);
  const routeToNext = normalizeRouteToNext(event.routeToNext);
  const mode = routeToNext.mode;
  return {
    id: `${day.id}-route-${eventIndex}`,
    dayId: day.id,
    eventId: event.id,
    fromId: event.locationId,
    toId: nextEvent.locationId,
    fromName: fromLoc.name,
    toName: toLoc.name,
    fromLngLat: fromLoc.lnglat,
    toLngLat: toLoc.lnglat,
    fromCity: fromLoc.city || getTrip().city || '',
    toCity: toLoc.city || getTrip().city || '',
    mode,
    routeToNext,
    color: getRouteDaylightColor(getTimeSlotHour(event.timeSlot))
  };
}
