import { TIME_SLOT_OPTIONS, normalizeTimeSlot } from '../time-slots.js';
import { escapeHTML } from '../utils.js';
import { modalSingleton } from './modal-base.js';
import { MAX_GUIDE_DAYS } from '../guide-import-cleanup.js';

let draft = null;
let openActionEventId = null;
let selectedRepairEventId = null;
let previewHandlers = null;

export const openGuidePreviewModal = modalSingleton(({ draft: inputDraft, handlers }) => {
  draft = structuredClone(inputDraft);
  openActionEventId = null;
  draft.events.forEach(event => {
    if (!event.matched && typeof event.keepUnmatched !== 'boolean') event.keepUnmatched = false;
  });
  selectedRepairEventId = draft.events.find(event => !event.matched && !event.deleted)?.id || null;
  previewHandlers = handlers;
  const root = createModal();
  document.body.appendChild(root);
  requestAnimationFrame(() => root.querySelector('.guide-preview-title')?.focus());
});

function createModal() {
  const root = document.createElement('div');
  root.className = 'modal-overlay';
  root.innerHTML = `
    <div class="modal guide-preview-modal" role="dialog" aria-modal="true" aria-label="导入预览">
      <div class="modal-header">
        <h2>导入预览</h2>
        <button type="button" class="modal-close" aria-label="关闭">×</button>
      </div>
      <div class="modal-body guide-preview-body"></div>
    </div>
  `;
  renderBody(root.querySelector('.guide-preview-body'));
  bindShellEvents(root);
  return root;
}

function renderBody(body) {
  const activeEvents = draft.events.filter(event => !event.deleted);
  const unresolvedEvents = activeEvents.filter(event => !event.matched && !event.keepUnmatched);
  body.innerHTML = `
    ${renderProgressRail()}
    <div class="guide-preview-summary ${draft.guideType}">
      <div class="guide-preview-type">${escapeHTML(getGuideTypeText(draft.guideType))}</div>
      ${draft.warnings.length ? `<div class="guide-preview-warnings">${draft.warnings.map(escapeHTML).join(' / ')}</div>` : ''}
      <div class="guide-preview-source">原文摘要：${escapeHTML(String(draft.sourceText || '').slice(0, 120) || '未保留原文')}</div>
    </div>
    <div class="guide-preview-title-row">
      <label>行程标题</label>
      <input type="text" class="guide-preview-title" value="${escapeHTML(draft.title || '')}" placeholder="给新行程起个名字" />
    </div>
    <div class="guide-preview-meta">
      <span>${escapeHTML(draft.city || '未识别城市')}</span>
      <span>${activeEvents.length} 个地点</span>
      <span>${activeEvents.filter(event => event.matched).length} 个已匹配</span>
    </div>
    <div class="guide-preview-compare">
      <div class="guide-preview-groups">
        ${renderDayGroups(activeEvents)}
        ${renderUnscheduledGroup(activeEvents)}
      </div>
      ${renderRepairPanel(activeEvents)}
    </div>
    ${unresolvedEvents.length ? `<p class="guide-preview-decision-hint">还有 ${unresolvedEvents.length} 个未匹配地点，请绑定候选或明确保留未匹配。</p>` : ''}
    <div class="modal-actions guide-preview-actions">
      <button type="button" class="modal-cancel guide-preview-back">返回输入</button>
      <button type="button" class="modal-submit guide-preview-confirm" ${activeEvents.length && !unresolvedEvents.length ? '' : 'disabled'}>导入为新行程</button>
    </div>
  `;
  bindBodyEvents(body);
}

function renderDayGroups(events) {
  const maxDay = getMaxDay();
  let html = '';
  for (let day = 1; day <= maxDay; day += 1) {
    const dayEvents = events.filter(event => event.day === day);
    html += `
      <section class="guide-preview-group">
        <h3>Day ${day}</h3>
        ${dayEvents.length ? dayEvents.map(renderEventCard).join('') : '<p class="guide-preview-empty">这一天还没有地点</p>'}
      </section>
    `;
  }
  return html;
}

function renderUnscheduledGroup(events) {
  const unscheduled = events.filter(event => event.day == null);
  return `
    <section class="guide-preview-group guide-preview-unscheduled">
      <h3>未排期</h3>
      ${unscheduled.length ? unscheduled.map(renderEventCard).join('') : '<p class="guide-preview-empty">没有未排期地点</p>'}
    </section>
  `;
}

function renderEventCard(event) {
  const status = event.matched ? '✓ 已匹配' : '× 未匹配';
  const menuOpen = openActionEventId === event.id;
  const addr = event.matched
    ? event.poi?.addr || event.poi?.district || '已选择地图地点'
    : '未匹配到地图地点，导入后可手动搜索绑定';
  return `
    <article class="guide-preview-event ${event.matched ? '' : 'unmatched'} ${selectedRepairEventId === event.id ? 'selected' : ''}" data-event-id="${escapeHTML(event.id)}">
      <div class="guide-preview-event-main">
        <label class="guide-preview-edit-field">
          <span>标题</span>
          <input type="text" class="guide-preview-event-title-input" value="${escapeHTML(getEventTitle(event))}" aria-label="编辑日程标题" />
        </label>
        <div class="guide-preview-event-addr">${escapeHTML(addr)}</div>
        <label class="guide-preview-edit-field guide-preview-note-field">
          <span>备注</span>
          <textarea class="guide-preview-event-note-input" aria-label="编辑日程备注" rows="2">${escapeHTML(event.note || '')}</textarea>
        </label>
      </div>
      <div class="guide-preview-event-controls">
        <span class="guide-preview-match ${event.matched ? 'ok' : 'fail'}">${event.keepUnmatched ? '✓ 保留未匹配' : status}</span>
        <button type="button" class="guide-preview-action-toggle ${menuOpen ? 'active' : ''}" aria-label="更多操作" title="更多操作">···</button>
        ${menuOpen ? renderActionMenu(event) : ''}
      </div>
    </article>
  `;
}

function renderProgressRail() {
  return `<div class="guide-import-progress guide-preview-progress" data-step="previewing">
    <div class="guide-import-progress-track">
      ${['AI 解析', '匹配地点', '确认预览', '完成']
        .map(
          (label, index) =>
            `<div class="guide-import-step ${index < 2 ? 'done' : index === 2 ? 'active' : ''}"><span class="guide-import-step-dot"></span><span class="guide-import-step-label">${label}</span></div>`
        )
        .join('')}
    </div>
  </div>`;
}

function renderRepairPanel(events) {
  const unmatched = events.filter(event => !event.matched);
  const event = events.find(item => item.id === selectedRepairEventId) || unmatched[0];
  if (!event) {
    return '<aside class="guide-repair-panel complete"><strong>地点匹配已完成</strong><p>可以检查标题和备注后导入。</p></aside>';
  }
  selectedRepairEventId = event.id;
  const results = Array.isArray(event.searchResults) ? event.searchResults : [];
  return `
    <aside class="guide-repair-panel" data-event-id="${escapeHTML(event.id)}">
      <div class="guide-repair-heading"><span>候选对比</span><strong>${escapeHTML(event.placeName)}</strong></div>
      <div class="guide-preview-search-row">
        <input type="text" class="guide-preview-search-input" value="${escapeHTML(event.searchKeyword || event.placeName || '')}" placeholder="搜索高德地点" />
        <button type="button" class="guide-preview-search-btn" ${event.searching ? 'disabled' : ''}>${event.searching ? '搜索中' : '搜索'}</button>
      </div>
      <div class="guide-preview-search-results" data-state="${event.searching ? 'loading' : results.length ? 'ready' : event.searchError ? 'error' : 'idle'}">
        ${renderFallbackSearchResults(event, results)}
      </div>
      ${event.matched ? '' : `<button type="button" class="guide-keep-unmatched ${event.keepUnmatched ? 'active' : ''}">${event.keepUnmatched ? '已决定保留未匹配' : '保留未匹配并继续'}</button>`}
    </aside>
  `;
}

function renderActionMenu(event) {
  return `
    <div class="guide-preview-action-menu">
      <label class="guide-preview-action-field">
        <span>日期</span>
        ${renderDaySelect(event)}
      </label>
      <label class="guide-preview-action-field">
        <span>时间</span>
        ${renderTimeSlotSelect(event)}
      </label>
      <button type="button" class="guide-preview-search-toggle">${event.matched ? '更换地点' : '搜索地点'}</button>
      <button type="button" class="guide-preview-delete" title="删除">删除</button>
    </div>
  `;
}

function renderFallbackSearchResults(event, results) {
  if (event.searching) return '<div class="guide-preview-search-hint">正在搜索...</div>';
  if (event.searchError)
    return `<div class="guide-preview-search-hint">${escapeHTML(event.searchError)}</div>`;
  if (!results.length)
    return '<div class="guide-preview-search-hint">搜索后从结果中选择一个地点</div>';
  return results
    .map(
      (place, index) => `
    <button type="button" class="guide-preview-place-result" data-result-index="${index}">
      ${renderPlacePhoto(place)}
      <span class="guide-preview-place-name">${escapeHTML(place.name || '未命名地点')}</span>
      <span class="guide-preview-place-addr">${escapeHTML(place.addr || place.district || place.city || '地址未提供')}</span>
    </button>
  `
    )
    .join('');
}

function renderPlacePhoto(place) {
  const url = String(place.photo || '').trim();
  if (!url) return '<span class="guide-preview-place-photo is-empty"></span>';
  return `
    <span class="guide-preview-place-photo">
      <img src="${escapeHTML(url.replace(/^http:\/\//i, 'https://'))}" alt="" loading="lazy" referrerpolicy="no-referrer" />
    </span>
  `;
}

function renderDaySelect(event) {
  const maxDay = getMaxDay();
  const options = ['<option value="">未排期</option>'];
  for (let day = 1; day <= Math.min(MAX_GUIDE_DAYS, maxDay + 1); day += 1) {
    options.push(
      `<option value="${day}" ${event.day === day ? 'selected' : ''}>Day ${day}</option>`
    );
  }
  return `<select class="guide-preview-day-select" aria-label="选择日期">${options.join('')}</select>`;
}

function renderTimeSlotSelect(event) {
  const value = normalizeTimeSlot(event.timeSlot || '');
  const options = TIME_SLOT_OPTIONS.map(
    option =>
      `<option value="${escapeHTML(option.id)}" ${option.id === value ? 'selected' : ''}>${escapeHTML(option.label)}</option>`
  );
  return `<select class="guide-preview-time-slot-select" aria-label="选择时间">${options.join('')}</select>`;
}

function bindShellEvents(root) {
  root.querySelector('.modal-close').addEventListener('click', openGuidePreviewModal.close);

  root.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (openActionEventId) {
      e.preventDefault();
      e.stopImmediatePropagation();
      openActionEventId = null;
      renderBody(root.querySelector('.guide-preview-body'));
      return;
    }
    openGuidePreviewModal.close();
  });
}

function bindBodyEvents(body) {
  body.addEventListener('click', e => {
    if (
      openActionEventId &&
      !e.target.closest('.guide-preview-action-menu') &&
      !e.target.closest('.guide-preview-action-toggle')
    ) {
      openActionEventId = null;
      renderBody(body);
    }
  });
  body.querySelector('.guide-preview-title').addEventListener('input', e => {
    draft.title = e.target.value;
  });
  body.querySelector('.guide-preview-back').addEventListener('click', () => {
    previewHandlers?.onBack?.(draft);
    openGuidePreviewModal.close();
  });
  body.querySelector('.guide-preview-confirm').addEventListener('click', () => {
    previewHandlers?.onConfirm?.(structuredClone(draft));
    openGuidePreviewModal.close();
  });
  body.querySelectorAll('.guide-preview-event').forEach(card => {
    const event = draft.events.find(item => item.id === card.dataset.eventId);
    if (!event) return;
    card.addEventListener('click', e => {
      if (event.matched || e.target.closest('input, textarea, select, button')) return;
      selectedRepairEventId = event.id;
      renderBody(body);
    });
    card.querySelector('.guide-preview-event-title-input')?.addEventListener('input', e => {
      event.title = e.target.value;
    });
    card.querySelector('.guide-preview-event-note-input')?.addEventListener('input', e => {
      event.note = e.target.value;
    });
    card.querySelector('.guide-preview-action-toggle')?.addEventListener('click', e => {
      e.stopImmediatePropagation();
      openActionEventId = openActionEventId === event.id ? null : event.id;
      renderBody(body);
      body
        .querySelector(
          `.guide-preview-event[data-event-id="${CSS.escape(event.id)}"] .guide-preview-action-toggle`
        )
        ?.focus();
    });
    card.querySelector('.guide-preview-day-select')?.addEventListener('change', e => {
      event.day = e.target.value ? Number(e.target.value) : null;
      openActionEventId = null;
      renderBody(body);
    });
    card.querySelector('.guide-preview-time-slot-select')?.addEventListener('change', e => {
      event.timeSlot = normalizeTimeSlot(e.target.value || '');
      renderBody(body);
    });
    card.querySelector('.guide-preview-delete')?.addEventListener('click', () => {
      event.deleted = true;
      openActionEventId = null;
      renderBody(body);
    });
    card.querySelector('.guide-preview-search-toggle')?.addEventListener('click', () => {
      selectedRepairEventId = event.id;
      event.searchKeyword ||= event.placeName;
      openActionEventId = null;
      renderBody(body);
    });
  });
  bindRepairPanel(body);
}

function bindRepairPanel(body) {
  const panel = body.querySelector('.guide-repair-panel[data-event-id]');
  if (!panel) return;
  const event = draft.events.find(item => item.id === panel.dataset.eventId);
  if (!event) return;
  const search = async () => {
    const keyword = panel.querySelector('.guide-preview-search-input')?.value.trim();
    if (!keyword || !previewHandlers?.onSearchPlace) return;
    event.searchKeyword = keyword;
    event.searching = true;
    event.searchError = '';
    event.searchResults = [];
    renderBody(body);
    try {
      const places = await previewHandlers.onSearchPlace(keyword, draft.city);
      event.searchResults = Array.isArray(places) ? places : [];
      event.searchError = event.searchResults.length ? '' : '没有找到结果，换个关键词试试';
    } catch {
      event.searchResults = [];
      event.searchError = '搜索失败，请重试';
    } finally {
      event.searching = false;
      renderBody(body);
    }
  };
  panel.querySelector('.guide-preview-search-btn')?.addEventListener('click', search);
  panel.querySelector('.guide-preview-search-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      search();
    }
  });
  panel.querySelectorAll('.guide-preview-place-result').forEach(button => {
    button.addEventListener('click', () => {
      const place = event.searchResults?.[Number(button.dataset.resultIndex)];
      if (!place) return;
      event.poi = place;
      event.matched = true;
      event.keepUnmatched = false;
      event.searchResults = [];
      event.searchError = '';
      selectedRepairEventId = null;
      renderBody(body);
    });
  });
  panel.querySelector('.guide-keep-unmatched')?.addEventListener('click', () => {
    event.keepUnmatched = true;
    selectedRepairEventId = draft.events.find(
      item => !item.deleted && !item.matched && !item.keepUnmatched
    )?.id;
    renderBody(body);
  });
}

function getMaxDay() {
  return Math.min(
    MAX_GUIDE_DAYS,
    Math.max(1, ...draft.events.map(event => Number(event.day) || 0))
  );
}

function getEventTitle(event) {
  return String(event.title || event.placeName || '').trim();
}

function getGuideTypeText(type) {
  if (type === 'recommendation_list') return '已识别为推荐合集，地点已放入未排期';
  if (type === 'mixed') return '已识别为按日攻略 + 推荐合集';
  if (type === 'daily_itinerary') return '已识别为按日攻略';
  return '识别结果';
}
