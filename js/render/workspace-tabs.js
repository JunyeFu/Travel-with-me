// js/render/workspace-tabs.js
// 顶部活页本行程标签：只负责渲染 workspace 切换 UI 和收集交互。

import { getWorkspace, MAX_TRIPS } from '../state.js';
import { escapeHTML } from '../utils.js';

let menuEl = null;
let menuDocListener = null; // 外部 close 时清理

export function renderWorkspaceTabs(handlers = {}) {
  const root = document.getElementById('workspace-tabs');
  if (!root) return;
  const focusedTripId = root.contains(document.activeElement)
    ? document.activeElement.dataset.tripId
    : null;

  const workspace = getWorkspace();
  root.innerHTML = `
    <div class="workspace-tabs-track" role="tablist" aria-label="旅行路线">
      ${workspace.trips.map((trip, index) => renderTripTab(trip, index, trip.id === workspace.activeTripId)).join('')}
      ${workspace.trips.length < MAX_TRIPS ? renderCreateTab(workspace.trips.length) : ''}
      ${renderImportTab(workspace.trips.length)}
    </div>
  `;

  root.querySelectorAll('[data-trip-id]').forEach(button => {
    button.addEventListener('click', () => handlers.onSelectTrip?.(button.dataset.tripId));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...root.querySelectorAll('[data-trip-id]')];
      const index = tabs.indexOf(button);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      const tripId = tabs[next].dataset.tripId;
      handlers.onSelectTrip?.(tripId);
      [...root.querySelectorAll('[data-trip-id]')]
        .find(tab => tab.dataset.tripId === tripId)
        ?.focus();
    });
  });
  if (focusedTripId) {
    [...root.querySelectorAll('[data-trip-id]')]
      .find(tab => tab.dataset.tripId === focusedTripId)
      ?.focus();
  }

  root.querySelector('[data-create-trip]')?.addEventListener('click', () => {
    handlers.onCreateTrip?.();
  });

  root.querySelector('[data-import-guide]')?.addEventListener('click', () => {
    handlers.onImportGuide?.();
  });

  requestAnimationFrame(() => {
    root.querySelector('[role="tab"][aria-selected="true"]')?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest'
    });
  });

  root.querySelector('[data-trip-menu]')?.addEventListener('click', e => {
    e.stopPropagation();
    const button = e.currentTarget;
    const tripId = button.dataset.tripMenu;
    menuEl?.remove();
    menuEl = createMenu(button, tripId, handlers);
    document.body.appendChild(menuEl);
  });
}

export function closeWorkspaceMenu() {
  menuEl?.remove();
  menuEl = null;
  if (menuDocListener) {
    document.removeEventListener('click', menuDocListener);
    menuDocListener = null;
  }
}

function renderTripTab(trip, index, active) {
  const slot = index + 1;
  return `
    <div class="workspace-tab-wrap ${active ? 'active' : ''}" style="--slot: ${slot};">
      <div class="workspace-tab ${active ? 'active' : ''}" title="${escapeHTML(trip.title)}">
        <button type="button" class="workspace-tab-title-btn" data-trip-id="${escapeHTML(trip.id)}" role="tab" aria-selected="${active}" tabindex="${active ? '0' : '-1'}">
          <span class="workspace-tab-title">${escapeHTML(trip.title || '未命名行程')}</span>
        </button>
        ${
          active
            ? `
        <button type="button" class="workspace-tab-menu-btn" data-trip-menu="${escapeHTML(trip.id)}" aria-label="行程菜单" title="行程菜单">⋯</button>
        `
            : ''
        }
      </div>
    </div>
  `;
}

function renderCreateTab(index) {
  return `
    <div class="workspace-tab-wrap workspace-tab-create-wrap" style="--slot: ${index + 1};">
      <div class="workspace-tab workspace-tab-add" aria-label="新建行程">
        <button type="button" class="workspace-tab-create-btn" data-create-trip aria-label="新建行程" title="新建行程">+</button>
      </div>
    </div>
  `;
}

function renderImportTab(index) {
  return `
    <div class="workspace-tab-wrap workspace-tab-ai-wrap" style="--slot: ${index + 2};">
      <button type="button" class="workspace-tab workspace-tab-ai-import" data-import-guide aria-label="从攻略导入" title="从攻略导入">AI 导入</button>
    </div>
  `;
}

function createMenu(anchor, tripId, handlers) {
  const rect = anchor.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'workspace-tab-menu';
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.left = `${Math.max(8, rect.right - 150)}px`;
  menu.innerHTML = `
    <button type="button" data-action="rename">修改名称</button>
    <button type="button" data-action="export">导出工作区 JSON</button>
    <button type="button" data-action="import">导入工作区 JSON</button>
    <button type="button" class="danger" data-action="delete">删除行程</button>
  `;

  menu.addEventListener('click', e => {
    const action = e.target.closest('button')?.dataset.action;
    if (!action) return;
    closeWorkspaceMenu();
    if (action === 'rename') handlers.onRenameTrip?.(tripId);
    if (action === 'export') handlers.onExportWorkspace?.();
    if (action === 'import') handlers.onImportWorkspace?.();
    if (action === 'delete') handlers.onDeleteTrip?.(tripId);
  });

  setTimeout(() => {
    const close = e => {
      if (!menu.contains(e.target) && e.target !== anchor) {
        closeWorkspaceMenu();
        document.removeEventListener('click', close);
      }
    };
    menuDocListener = close;
    document.addEventListener('click', close);
  }, 0);

  return menu;
}
