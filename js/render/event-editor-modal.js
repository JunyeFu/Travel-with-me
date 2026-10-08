// js/render/event-editor-modal.js
// 编辑行程事件：标题 + 手动校准地点，或通过 POI 搜索替换为新地点
//
// 这个模块只负责 UI 和表单收集，不直接读写 state。

import { createLogger } from '../logger.js';
import { escapeHTML } from '../utils.js';
import {
  bindIconPicker,
  getIconIdForEvent,
  inferIconId,
  renderIconPickerHTML,
  renderIconSVG
} from './icons.js';
import { TIME_SLOT_OPTIONS, normalizeTimeSlot } from '../time-slots.js';
import { modalSingleton } from './modal-base.js';

const log = createLogger('event-editor');

export const openEventEditorModal = modalSingleton(({ event, location, handlers }) => {
  const root = createModal(event, location, handlers);
  document.body.appendChild(root);
  requestAnimationFrame(() => root.querySelector('.editor-title-input')?.focus());
});

function createModal(event, location, handlers) {
  const anchorName = handlers?.nearbyAnchor?.name || '';
  const radiusKm = Math.round(Number(handlers?.nearbyAnchor?.radius || 5000) / 1000);
  const maxResults = Number(handlers?.nearbyAnchor?.maxResults || 4);
  const nearbyHintHTML = anchorName
    ? `以「<span class="search-nearby-anchor"></span>」为中心搜索 ${radiusKm}km 内附近最多 ${maxResults} 个地点`
    : '当前地点还没有坐标，将基于关键词全城搜索';
  const root = document.createElement('div');
  root.className = 'modal-overlay';
  root.innerHTML = `
    <div class="modal editor-modal" role="dialog" aria-modal="true" aria-label="编辑日程">
      <div class="modal-header">
        <h2>编辑日程</h2>
        <button type="button" class="modal-close" aria-label="关闭">×</button>
      </div>
      <form class="modal-body editor-form">
        <div class="modal-form-row">
          <label>标题</label>
          <input type="text" class="editor-title-input" placeholder="在这里做什么" required value="${escapeHTML(event.title || '')}" />
        </div>
        <div class="modal-form-row icon-form-row">
          <label>图标</label>
          ${renderIconPickerHTML(getIconIdForEvent(event, location))}
        </div>
        <div class="modal-form-row date-form-row">
          <label>日期</label>
          ${renderContainerPickerHTML(handlers?.containerOptions || [], handlers?.currentContainerId || '')}
        </div>
        <div class="modal-form-row time-form-row">
          <label>时间</label>
          ${renderTimeSlotPickerHTML(event.timeSlot)}
        </div>

        <div class="editor-section-title">更新地点信息</div>
        <div class="editor-location-card">
          ${renderLocationCardHTML(location, '当前地点', 'static', getIconIdForEvent(event, location))}
        </div>

        <div class="editor-search-panel" hidden>
          <div class="editor-search-tabs" role="tablist" aria-label="搜索方式">
            <button type="button" class="editor-search-tab active" data-search-mode="keyword" role="tab" aria-selected="true">关键词搜索</button>
            <button type="button" class="editor-search-tab" data-search-mode="nearby" role="tab" aria-selected="false">搜附近</button>
          </div>
          <div class="editor-search-copy" data-mode-text="keyword">请输入新的地点</div>
          <div class="editor-search-copy search-nearby-hint" data-mode-text="nearby" hidden>${nearbyHintHTML}</div>
          <div class="editor-search-box">
            <svg class="editor-search-icon" width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"></path>
            </svg>
            <input type="text" class="editor-search-input" placeholder="搜索新地点" />
            <button type="button" class="editor-search-btn">搜索</button>
          </div>
        </div>
        <div class="modal-results editor-results" data-state="idle"></div>

        <div class="modal-form-row note-form-row">
          <label>备注</label>
          <textarea class="editor-note-input" placeholder="请输入备注信息，例如预约时间、注意事项、同行人安排">${escapeHTML(event.note || '')}</textarea>
        </div>

        <div class="modal-actions">
          <button type="button" class="modal-cancel">取消</button>
          <button type="submit" class="modal-submit">保存</button>
        </div>
      </form>
    </div>
  `;

  if (anchorName) {
    const anchorEl = root.querySelector('.search-nearby-anchor');
    if (anchorEl) anchorEl.textContent = anchorName;
  }

  bindEvents(root, location, handlers);
  return root;
}

function bindEvents(root, initialLocation, handlers) {
  const form = root.querySelector('.editor-form');
  const searchInput = root.querySelector('.editor-search-input');
  const searchBtn = root.querySelector('.editor-search-btn');
  const resultsEl = root.querySelector('.editor-results');
  const locationCard = root.querySelector('.editor-location-card');
  const iconPicker = bindIconPicker(
    root,
    root.querySelector('.icon-picker-btn.active')?.dataset.iconId || 'place'
  );
  const containerPicker = bindContainerPicker(root);
  const timeSlotPicker = bindTimeSlotPicker(root);
  let selectedPlace = null;
  let searchMode = 'keyword';
  let selectedLocation = {
    name: initialLocation.name || '',
    query: initialLocation.query || initialLocation.name || '',
    addr: initialLocation.addr || '',
    lnglat: initialLocation.lnglat || [],
    photo: initialLocation.photo || '',
    type: initialLocation.type || '',
    province: initialLocation.province || '',
    city: initialLocation.city || '',
    district: initialLocation.district || '',
    tag: initialLocation.tag || ''
  };
  let cardLabel = '当前地点';

  const renderCard = (status = 'static') => {
    // 用当前 iconPicker 的值兜底图标——用户切了图标后占位 SVG 也要跟着变
    locationCard.innerHTML = renderLocationCardHTML(
      selectedLocation,
      cardLabel,
      status,
      iconPicker.getValue()
    );
  };

  // 已有地点常常只存了名称（addr === name），这里按需异步逆地理回填详细地址。
  // 注意 modal 关闭后 resultsEl 已不在 DOM 树里，所有异步回调要先确认 modal 还活着。
  let addressRequestId = 0;
  let searchRequestId = 0;

  const ensureAddressForCurrent = async () => {
    if (!hasPoorAddress(selectedLocation) || !handlers?.onResolveAddress) return;
    if (!Array.isArray(selectedLocation.lnglat) || selectedLocation.lnglat.length < 2) return;

    const requestId = ++addressRequestId;
    const targetLocation = selectedLocation;
    renderCard('loading');
    let info;
    try {
      info = await handlers.onResolveAddress(selectedLocation.lnglat);
    } catch (err) {
      log.warn('逆地理编码失败：', err);
    }
    if (!root?.isConnected || requestId !== addressRequestId || selectedLocation !== targetLocation)
      return;

    const composed = composeAddress(info, selectedLocation.name);
    if (composed) selectedLocation.addr = composed;
    renderCard('static');
  };

  const doSearch = async () => {
    const keyword = searchInput.value.trim();
    if (!keyword) return;
    const isNearby = searchMode === 'nearby';
    const runner = isNearby ? handlers?.onNearbySearch : handlers?.onSearch;
    if (!runner) return;
    const requestId = ++searchRequestId;

    selectedPlace = null;
    setResultsState(resultsEl, 'loading', '<div class="modal-hint">搜索中...</div>');

    try {
      const places = await runner(keyword);
      if (!root.isConnected || requestId !== searchRequestId) return;
      if (!places || !places.length) {
        const emptyHTML = isNearby
          ? '<div class="modal-hint">附近没找到相关地点，换个关键词试试</div>'
          : '<div class="modal-hint">未找到相关地点</div>';
        setResultsState(resultsEl, 'empty', emptyHTML);
        return;
      }
      renderResults(resultsEl, places, place => {
        selectedPlace = place;
        addressRequestId += 1;
        const fallbackAddr = composeAddress(
          {
            formatted: place.addr,
            province: place.province,
            city: place.city,
            district: place.district
          },
          place.name
        );
        selectedLocation = {
          name: place.name || '',
          query: place.name || '',
          addr: fallbackAddr,
          lnglat: place.lnglat || [],
          photo: place.photo || '',
          type: place.type || '',
          province: place.province || '',
          city: place.city || '',
          district: place.district || '',
          tag: place.tag || ''
        };
        iconPicker.setValue(
          inferIconId({
            name: place.name,
            addr: fallbackAddr,
            type: place.type,
            tag: place.tag
          })
        );
        cardLabel = '已选择地点';
        renderCard('static');
        // 选完后收起结果，避免遮挡备注栏
        setResultsState(resultsEl, 'idle', '');
      });
    } catch (err) {
      if (!root.isConnected || requestId !== searchRequestId) return;
      log.error('搜索地点失败：', err);
      setResultsState(resultsEl, 'error', '<div class="modal-hint">搜索失败，请重试</div>');
    }
  };

  const tabs = root.querySelectorAll('.editor-search-tab');
  const switchMode = mode => {
    if (searchMode === mode) return;
    searchRequestId += 1;
    searchMode = mode;
    tabs.forEach(tab => {
      const active = tab.dataset.searchMode === mode;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    root.querySelectorAll('[data-mode-text]').forEach(el => {
      el.hidden = el.dataset.modeText !== mode;
    });
    searchInput.placeholder = mode === 'nearby' ? '例如：川菜、咖啡馆、便利店' : '搜索新地点';
    searchInput.value = '';
    selectedPlace = null;
    setResultsState(resultsEl, 'idle', '');
    searchInput.focus();
  };

  tabs.forEach(tab => {
    tab.addEventListener('click', () => switchMode(tab.dataset.searchMode));
  });

  ensureAddressForCurrent();

  root.addEventListener('click', e => {
    if (!e.target.closest('.editor-location-change-btn')) return;
    const panel = root.querySelector('.editor-search-panel');
    panel.hidden = false;
    searchInput.focus();
  });

  searchBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doSearch();
    }
  });

  root.querySelector('.modal-close').addEventListener('click', openEventEditorModal.close);
  root.querySelector('.modal-cancel').addEventListener('click', openEventEditorModal.close);

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!handlers?.onConfirm) return;

    const lng = Number(selectedLocation.lnglat?.[0]);
    const lat = Number(selectedLocation.lnglat?.[1]);
    const lnglat = Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;

    handlers.onConfirm({
      event: {
        title: root.querySelector('.editor-title-input').value.trim(),
        icon: iconPicker.getValue(),
        targetDayId: containerPicker.getValue(),
        timeSlot: timeSlotPicker.getValue(),
        note: root.querySelector('.editor-note-input').value.trim()
      },
      location: {
        name: selectedLocation.name,
        query: selectedLocation.query || selectedLocation.name,
        addr: selectedLocation.addr,
        lnglat,
        photo: selectedLocation.photo || '',
        type: selectedLocation.type || ''
      },
      selectedPlace
    });
    openEventEditorModal.close();
  });
}

function renderLocationCardHTML(location, label, status = 'static', iconId = 'pin') {
  const photoHTML = renderEditorLocationPhoto(location, iconId);
  return `
    <div class="editor-location-text">
      <div class="editor-location-label">${escapeHTML(label)}</div>
      <div class="editor-location-name">${escapeHTML(location.name || '')}</div>
      <div class="editor-location-addr">${escapeHTML(getLocationAddressText(location, status))}</div>
      <button type="button" class="editor-location-change-btn">更换地点</button>
    </div>
    ${photoHTML}
  `;
}

// 当前/已选择地点卡的右侧图位：
// - 有真图：渲染为圆角矩形，加载失败兜底为 SVG 占位
// - 无图：SVG 占位（用 event.icon 决定，比 POI type 信号更强）
function renderEditorLocationPhoto(location, iconId) {
  const url = String(location.photo || '').trim();
  const iconHTML = renderIconSVG(iconId, 'placeholder-icon-svg');
  if (url) {
    const httpsUrl = url.replace(/^http:\/\//i, 'https://');
    // onerror 时把 img 替换成 SVG 占位（高德 photo 偶发 404）
    return `
      <figure class="editor-location-photo">
        <img src="${escapeHTML(httpsUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer"
             onerror="this.parentElement.classList.add('is-placeholder');">
        <span class="placeholder-icon-holder">${iconHTML}</span>
      </figure>
    `;
  }
  return `<figure class="editor-location-photo is-placeholder"><span class="placeholder-icon-holder">${iconHTML}</span></figure>`;
}

function getLocationAddressText(location, status) {
  if (status === 'loading') return '正在获取详细地址...';
  const addr = String(location.addr || '').trim();
  const name = String(location.name || '').trim();
  if (addr && addr !== name) return addr;
  return '暂无详细地址';
}

function hasPoorAddress(location) {
  const addr = String(location.addr || '').trim();
  const name = String(location.name || '').trim();
  return !addr || addr === name;
}

// 把 POI 或逆地理结果合成一个用于显示的"详细地址"。
// 若 formatted 已包含 name（例如"北京市丰台区北京南站(公交站)"），保留 formatted；
// 否则用 省+市+区 兜底。和 name 完全相等的情况会被 getLocationAddressText 兜成"暂无"。
function composeAddress(info, name) {
  if (!info) return '';
  const formatted = String(info.formatted || '').trim();
  if (formatted) return formatted;
  const composed = [info.province, info.city, info.district]
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .join('');
  if (composed && composed !== String(name || '').trim()) return composed;
  return '';
}

function renderTimeSlotPickerHTML(value) {
  const selected = normalizeTimeSlot(value);
  return `
    <div class="time-slot-picker" role="radiogroup" aria-label="选择时间">
      ${TIME_SLOT_OPTIONS.map(
        option => `
        <button type="button" class="time-slot-btn ${option.id === selected ? 'active' : ''}" data-time-slot="${option.id}" role="radio" aria-checked="${option.id === selected}">
          ${escapeHTML(option.label)}
        </button>
      `
      ).join('')}
    </div>
  `;
}

function renderContainerPickerHTML(options, currentValue) {
  const normalized = options.length
    ? options
    : [{ id: currentValue || 'unscheduled', label: '未排期' }];
  const selected = currentValue || normalized[0]?.id || 'unscheduled';
  const selectedOption = normalized.find(option => option.id === selected) || normalized[0];
  return `
    <div class="editor-container-picker" data-value="${escapeHTML(selectedOption?.id || '')}">
      <button type="button" class="editor-container-trigger" aria-haspopup="listbox" aria-expanded="false">
        <span class="editor-container-label">${escapeHTML(selectedOption?.label || '未排期')}</span>
        <span class="editor-container-arrow" aria-hidden="true">⌄</span>
      </button>
      <div class="editor-container-menu" role="listbox" hidden>
      ${normalized
        .map(
          option => `
        <button type="button" class="editor-container-option ${option.id === selected ? 'active' : ''}" data-container-id="${escapeHTML(option.id)}" role="option" aria-selected="${option.id === selected}">
          ${escapeHTML(option.label)}
        </button>
      `
        )
        .join('')}
      </div>
    </div>
  `;
}

function bindContainerPicker(root) {
  const picker = root.querySelector('.editor-container-picker');
  const trigger = root.querySelector('.editor-container-trigger');
  const label = root.querySelector('.editor-container-label');
  const menu = root.querySelector('.editor-container-menu');
  if (!picker || !trigger || !label || !menu) return { getValue: () => '' };

  const close = () => {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  };
  const open = () => {
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
  };
  const toggle = () => {
    if (menu.hidden) open();
    else close();
  };

  trigger.addEventListener('click', e => {
    e.stopPropagation();
    toggle();
  });

  menu.querySelectorAll('.editor-container-option').forEach(option => {
    option.addEventListener('click', e => {
      e.stopPropagation();
      picker.dataset.value = option.dataset.containerId || '';
      label.textContent = option.textContent.trim();
      menu.querySelectorAll('.editor-container-option').forEach(item => {
        const active = item === option;
        item.classList.toggle('active', active);
        item.setAttribute('aria-selected', String(active));
      });
      close();
    });
  });

  root.addEventListener('click', e => {
    if (!picker.contains(e.target)) close();
  });
  root.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
  });

  return { getValue: () => picker.dataset.value || '' };
}

function bindTimeSlotPicker(root) {
  let value = normalizeTimeSlot(
    root.querySelector('.time-slot-btn.active')?.dataset.timeSlot || ''
  );
  root.querySelectorAll('.time-slot-btn').forEach(button => {
    button.addEventListener('click', () => {
      value = normalizeTimeSlot(button.dataset.timeSlot || '');
      root.querySelectorAll('.time-slot-btn').forEach(item => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-checked', String(active));
      });
    });
  });
  return { getValue: () => value };
}

// 推荐结果卡的图位：
// - 有真图：圆角矩形展示，加载失败兜底为 SVG 占位（不留空白，体感一致）
// - 无图：SVG 占位（基于 POI type 推断），不让"半数有图半数空"显得不协调
// 高德 photo URL 默认 http，HTTPS 生产站会被 mixed content 拦截 → 改写成 https
function renderPhotoBanner(place) {
  const url = String(place.photo || '').trim();
  const iconHTML = renderIconSVG(
    inferIconId({
      name: place.name,
      addr: place.addr,
      type: place.type,
      tag: place.tag
    }),
    'placeholder-icon-svg'
  );
  if (url) {
    const httpsUrl = url.replace(/^http:\/\//i, 'https://');
    return `
      <figure class="modal-result-photo">
        <img src="${escapeHTML(httpsUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer"
             onerror="this.parentElement.classList.add('is-placeholder');">
        <span class="placeholder-icon-holder">${iconHTML}</span>
      </figure>
    `;
  }
  return `<figure class="modal-result-photo is-placeholder"><span class="placeholder-icon-holder">${iconHTML}</span></figure>`;
}

// 把高德返回的真实数据（评分/人均/标签）渲染成 chip
// 三项全空时返回空串，整行不出现，保持卡片紧凑
function renderMetaChips(place) {
  const chips = [];
  if (place.rating != null && Number(place.rating) > 0) {
    chips.push(`<span class="meta-chip meta-rating">⭐ ${escapeHTML(String(place.rating))}</span>`);
  }
  if (place.cost != null && Number(place.cost) > 0) {
    chips.push(`<span class="meta-chip meta-cost">¥${escapeHTML(String(place.cost))}/人</span>`);
  }
  const firstTag = String(place.tag || '')
    .split(/[;\s]+/)
    .filter(Boolean)[0];
  if (firstTag) {
    chips.push(`<span class="meta-chip meta-tag">${escapeHTML(firstTag)}</span>`);
  }
  return chips.length ? `<div class="modal-result-meta">${chips.join('')}</div>` : '';
}

function setResultsState(resultsEl, state, html) {
  resultsEl.dataset.state = state;
  resultsEl.innerHTML = html;
}

function renderResults(resultsEl, places, onPick) {
  resultsEl.dataset.state = 'ready';
  resultsEl.innerHTML = '';
  places.forEach(place => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'modal-result-item';
    const addrText =
      composeAddress(
        {
          formatted: place.addr,
          province: place.province,
          city: place.city,
          district: place.district
        },
        place.name
      ) || '地址未提供';
    const metaHTML = renderMetaChips(place);
    const photoHTML = renderPhotoBanner(place);
    item.innerHTML = `
      ${photoHTML}
      <div class="modal-result-name">${escapeHTML(place.name)}</div>
      <div class="modal-result-addr">${escapeHTML(addrText)}</div>
      ${metaHTML}
    `;
    item.addEventListener('click', () => {
      resultsEl
        .querySelectorAll('.modal-result-item')
        .forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      onPick(place);
    });
    resultsEl.appendChild(item);
  });
}
