// js/storage.js
// 持久化封装：localStorage 优先，失败时降级到内存
//
// workspace 结构：
//   { version: 5, savedAt, workspace: { trips: [...], activeTripId } }
//
// V5 schema 升级：version 2 -> 3
//   - days[].date 字段删除
//   - 顶层 trip 新增 unscheduled[]
//   - 旧版本（v < 3）数据加载时直接丢弃，触发首次启动用 initialTrip
// V6 schema 升级：version 3 -> 4
//   - 行程 icon id 规范化为 canonical id（pin/train/shop 等旧 id 不再写入新数据）
//   - 旧版本直接丢弃，避免 localStorage 里继续保留冗余 icon id
// V7 schema 升级：version 4 -> 5
//   - 不再静默丢弃旧 schema；加载旧版本时先保存 recovery snapshot，再交给 state 层规范化
//   - 增加 workspace JSON 导出/导入封装
//
// 单 trip 接口（saveTrip/loadTrip）保留，方便以后做"草稿快照"或迁出 BFF；
// 当前主存储是 saveWorkspace/loadWorkspace。

const STORAGE_PREFIX = 'trip-app:';
const memoryFallback = new Map();

function safeGet(key) {
  if (memoryFallback.has(key)) return memoryFallback.get(key);
  try {
    return localStorage.getItem(STORAGE_PREFIX + key);
  } catch {
    return memoryFallback.get(key) ?? null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, value);
    memoryFallback.delete(key);
    return true;
  } catch {
    memoryFallback.set(key, value);
    return false;
  }
}

function safeRemove(key) {
  try {
    localStorage.removeItem(STORAGE_PREFIX + key);
    memoryFallback.delete(key);
    return true;
  } catch {
    memoryFallback.set(key, null);
    return false;
  }
}

// ─── workspace 接口（多 trip 容器） ────────────────────

const WORKSPACE_KEY = 'workspace';
const RECOVERY_PREFIX = 'workspace-recovery:';

export const SCHEMA_VERSION = 5;
export const EXPORT_FORMAT = 'travel-with-me.workspace';
export const EXPORT_FORMAT_VERSION = 1;

let lastWorkspaceLoadInfo = { status: 'empty' };

export async function saveWorkspace(workspace) {
  const json = JSON.stringify({
    version: SCHEMA_VERSION,
    savedAt: Date.now(),
    workspace
  });
  const durable = safeSet(WORKSPACE_KEY, json);
  return durable
    ? { ok: true }
    : {
        ok: false,
        error: 'PERSISTENCE_UNAVAILABLE',
        message: '浏览器本地存储不可用；本次修改仅在当前页面有效。',
        fallback: 'memory'
      };
}

// 返回 workspace 对象；从未保存过返回 null（让调用方走"首次启动"分支）。
// 旧版本 schema 不再直接丢弃：先保存 recovery snapshot，再把 workspace 交给 state 层规范化。
export async function loadWorkspace() {
  const raw = safeGet(WORKSPACE_KEY);
  if (!raw) {
    lastWorkspaceLoadInfo = { status: 'empty' };
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    const version = Number(parsed.version || 0);
    if (version > SCHEMA_VERSION) {
      lastWorkspaceLoadInfo = {
        status: 'future-version',
        shouldPersist: false,
        message: '工作区版本较新，请使用对应版本打开。'
      };
      return null;
    }
    const loadedWorkspace = parsed.workspace ?? null;
    const validation = validateWorkspaceShape(loadedWorkspace);
    if (!validation.ok) {
      const recoveryKey = createRecoverySnapshot(raw, 'invalid-workspace-shape');
      lastWorkspaceLoadInfo = recoveryKey
        ? {
            status: 'invalid',
            error: validation.error,
            message: validation.message,
            recoveryKey,
            shouldPersist: false
          }
        : {
            status: 'recovery-failed',
            error: 'RECOVERY_SNAPSHOT_FAILED',
            sourceError: validation.error,
            recoveryKey: '',
            shouldPersist: false
          };
      return null;
    }
    if (version < SCHEMA_VERSION) {
      const recoveryKey = createRecoverySnapshot(
        raw,
        `schema-v${version || 'unknown'}-to-v${SCHEMA_VERSION}`
      );
      if (!recoveryKey) {
        lastWorkspaceLoadInfo = {
          status: 'recovery-failed',
          error: 'RECOVERY_SNAPSHOT_FAILED',
          sourceStatus: 'migration',
          fromVersion: version || null,
          toVersion: SCHEMA_VERSION,
          recoveryKey: '',
          shouldPersist: false
        };
        return null;
      }
      console.warn(
        `[storage] 检测到旧 schema (v${version || '?'})，已保存恢复快照并交给状态层迁移。`
      );
      lastWorkspaceLoadInfo = {
        status: 'migrated',
        fromVersion: version || null,
        toVersion: SCHEMA_VERSION,
        recoveryKey
      };
      return loadedWorkspace;
    }
    lastWorkspaceLoadInfo = { status: 'ok', version };
    return loadedWorkspace;
  } catch {
    const recoveryKey = createRecoverySnapshot(raw, 'parse-error');
    lastWorkspaceLoadInfo = recoveryKey
      ? { status: 'parse-error', recoveryKey, shouldPersist: false }
      : {
          status: 'recovery-failed',
          error: 'RECOVERY_SNAPSHOT_FAILED',
          sourceStatus: 'parse-error',
          recoveryKey: '',
          shouldPersist: false
        };
    console.warn('storage: workspace JSON 解析失败');
    return null;
  }
}

export function getLastWorkspaceLoadInfo() {
  return { ...lastWorkspaceLoadInfo };
}

export async function clearWorkspace() {
  const durable = safeRemove(WORKSPACE_KEY);
  return durable ? { ok: true } : { ok: false, error: 'PERSISTENCE_UNAVAILABLE' };
}

export function buildWorkspaceExport(workspace) {
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    workspace
  };
}

export function stringifyWorkspaceExport(workspace) {
  return `${JSON.stringify(buildWorkspaceExport(workspace), null, 2)}\n`;
}

export function parseWorkspaceImport(input) {
  let parsed;
  try {
    parsed = typeof input === 'string' ? JSON.parse(input) : input;
  } catch {
    return { ok: false, error: 'INVALID_JSON', message: '导入文件不是合法 JSON。' };
  }

  if (Number(parsed?.schemaVersion || parsed?.version || 0) > SCHEMA_VERSION) {
    return {
      ok: false,
      error: 'FUTURE_SCHEMA',
      message: '该文件来自较新的版本，不能覆盖当前工作区。'
    };
  }
  const workspace = extractImportedWorkspace(parsed);
  if (!workspace) {
    return {
      ok: false,
      error: 'INVALID_WORKSPACE',
      message: '没有找到可导入的 workspace 数据。'
    };
  }

  const validation = validateWorkspaceShape(workspace);
  if (!validation.ok) return validation;

  return {
    ok: true,
    workspace,
    summary: summarizeWorkspace(workspace),
    meta: {
      format: parsed?.format || '',
      schemaVersion: parsed?.schemaVersion || parsed?.version || null,
      exportedAt: parsed?.exportedAt || ''
    }
  };
}

function summarizeWorkspace(workspace) {
  const trips = workspace.trips.map(trip => {
    const days = trip.days || [];
    const scheduledEvents = days.flatMap(day => day.events || []);
    const unscheduledEvents = trip.unscheduled || [];
    const previewPlaces = [...scheduledEvents, ...unscheduledEvents]
      .map(event => event.title || trip.locations?.[event.locationId]?.name || '')
      .filter(Boolean)
      .slice(0, 5);
    return {
      id: String(trip.id || ''),
      title: String(trip.title || '未命名行程'),
      dayCount: days.length,
      scheduledCount: scheduledEvents.length,
      unscheduledCount: unscheduledEvents.length,
      locationCount: Object.keys(trip.locations || {}).length,
      previewPlaces
    };
  });
  return {
    tripCount: trips.length,
    dayCount: trips.reduce((total, trip) => total + trip.dayCount, 0),
    scheduledCount: trips.reduce((total, trip) => total + trip.scheduledCount, 0),
    unscheduledCount: trips.reduce((total, trip) => total + trip.unscheduledCount, 0),
    locationCount: trips.reduce((total, trip) => total + trip.locationCount, 0),
    trips
  };
}

export async function importWorkspace(workspace) {
  const validation = validateWorkspaceShape(workspace);
  if (!validation.ok) return validation;

  const currentRaw = safeGet(WORKSPACE_KEY);
  const recoveryKey = currentRaw ? createRecoverySnapshot(currentRaw, 'before-import') : '';
  if (currentRaw && !recoveryKey) {
    return {
      ok: false,
      error: 'RECOVERY_SNAPSHOT_FAILED',
      message: '无法创建恢复快照，导入已取消；原工作区未被覆盖。',
      recoveryKey: ''
    };
  }
  const saved = await saveWorkspace(workspace);
  return saved.ok ? { ok: true, recoveryKey } : { ...saved, recoveryKey };
}

// ─── 单 trip 接口（保留，未在主流程使用） ──────────────

export async function saveTrip(trip, slot = 'draft') {
  const json = JSON.stringify({
    version: 1,
    savedAt: Date.now(),
    trip
  });
  const durable = safeSet(slot, json);
  return durable ? { ok: true } : { ok: false, error: 'PERSISTENCE_UNAVAILABLE' };
}

export async function loadTrip(slot = 'draft') {
  const raw = safeGet(slot);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed.trip ?? null;
  } catch {
    console.warn('storage: trip JSON 解析失败');
    return null;
  }
}

export async function clearTrip(slot = 'draft') {
  const durable = safeRemove(slot);
  return durable ? { ok: true } : { ok: false, error: 'PERSISTENCE_UNAVAILABLE' };
}

function createRecoverySnapshot(raw, reason) {
  const key = `${RECOVERY_PREFIX}${Date.now()}`;
  const snapshot = JSON.stringify({
    version: 1,
    createdAt: new Date().toISOString(),
    reason,
    raw
  });
  return safeSet(key, snapshot) ? key : '';
}

function extractImportedWorkspace(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.format === EXPORT_FORMAT) return parsed.workspace;
  if (parsed.workspace && typeof parsed.workspace === 'object') return parsed.workspace;
  if ('trips' in parsed) return parsed;
  return null;
}

function validateWorkspaceShape(workspace) {
  if (!workspace || typeof workspace !== 'object') {
    return { ok: false, error: 'INVALID_WORKSPACE', message: 'workspace 必须是对象。' };
  }
  if (!Array.isArray(workspace.trips)) {
    return { ok: false, error: 'INVALID_TRIPS', message: 'workspace.trips 必须是数组。' };
  }
  if (workspace.trips.length > 3) {
    return { ok: false, error: 'TOO_MANY_TRIPS', message: '最多只能导入 3 条旅行路线。' };
  }
  const tripIds = new Set();
  for (const trip of workspace.trips) {
    if (!trip || typeof trip !== 'object' || Array.isArray(trip)) {
      return { ok: false, error: 'INVALID_TRIP', message: '每条旅行路线必须是对象。' };
    }
    const tripId = String(trip.id || '');
    if (tripId && tripIds.has(tripId)) {
      return {
        ok: false,
        error: 'DUPLICATE_TRIP_ID',
        message: '导入数据包含重复的行程 ID。'
      };
    }
    if (tripId) tripIds.add(tripId);
    if (trip.days != null && !Array.isArray(trip.days)) {
      return { ok: false, error: 'INVALID_DAYS', message: '旅行路线的 days 必须是数组。' };
    }
    if (
      trip.locations != null &&
      (typeof trip.locations !== 'object' || Array.isArray(trip.locations))
    ) {
      return {
        ok: false,
        error: 'INVALID_LOCATIONS',
        message: '旅行路线的 locations 必须是对象。'
      };
    }
    const dayIds = new Set();
    const eventIds = new Set();
    for (const day of trip.days || []) {
      if (!day || typeof day !== 'object' || !Array.isArray(day.events || [])) {
        return { ok: false, error: 'INVALID_DAY', message: '每个 day 必须包含 events 数组。' };
      }
      const dayId = String(day.id || '');
      if (dayId && dayIds.has(dayId)) {
        return {
          ok: false,
          error: 'DUPLICATE_DAY_ID',
          message: '导入数据包含重复的日程 ID。'
        };
      }
      if (dayId) dayIds.add(dayId);
      if ((day.events || []).some(event => !event || typeof event !== 'object')) {
        return { ok: false, error: 'INVALID_EVENT', message: '每个日程必须是对象。' };
      }
      for (const event of day.events || []) {
        const eventId = String(event.id || '');
        if (eventId && eventIds.has(eventId)) {
          return {
            ok: false,
            error: 'DUPLICATE_EVENT_ID',
            message: '导入数据包含重复的日程事件 ID。'
          };
        }
        if (eventId) eventIds.add(eventId);
      }
    }
    if (trip.unscheduled != null && !Array.isArray(trip.unscheduled)) {
      return {
        ok: false,
        error: 'INVALID_UNSCHEDULED',
        message: '旅行路线的 unscheduled 必须是数组。'
      };
    }
    for (const event of trip.unscheduled || []) {
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        return { ok: false, error: 'INVALID_EVENT', message: '每个日程必须是对象。' };
      }
      const eventId = String(event.id || '');
      if (eventId && eventIds.has(eventId)) {
        return {
          ok: false,
          error: 'DUPLICATE_EVENT_ID',
          message: '导入数据包含重复的日程事件 ID。'
        };
      }
      if (eventId) eventIds.add(eventId);
    }
  }
  return { ok: true };
}
