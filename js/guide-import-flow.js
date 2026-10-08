// js/guide-import-flow.js
// AI 攻略导入：纯函数层。从 main.js 提取。零循环依赖。
// 编排器 importGuideDraft/openGuideImportFlow 仍留在 main.js。

import { searchPlaces, searchNearBy } from './api/geocode.js';
import { loadAMap } from './api/amap-loader.js';
import { getAppState, setAMap } from './state.js';
import { setStatus } from './render/sidebar.js';
import { cleanGuideExtractedEvents } from './guide-import-cleanup.js';
import { createLogger } from './logger.js';

const GUIDE_MATCH_LIMIT = 40;
const GUIDE_MATCH_TIMEOUT_MS = 8000;
const log = createLogger('guide-import');

export async function buildGuideDraft(extracted, source, onProgress, signal) {
  signal?.throwIfAborted?.();
  const city = source.cityHint || extracted.city || '';
  const events = [];
  let matched = 0;
  const warnings = [...(extracted.warnings || [])];
  const normalizedEvents = cleanGuideExtractedEvents(
    normalizeGuideEventsFromSource(extracted.events || [], source.text || '', warnings),
    { warnings }
  );
  const validEvents = normalizedEvents.filter(item => item?.place_name);
  const eventsToMatch = validEvents.slice(0, GUIDE_MATCH_LIMIT);
  if (validEvents.length > GUIDE_MATCH_LIMIT) {
    warnings.push(
      `已保留前 ${GUIDE_MATCH_LIMIT} 个主路线地点，其余地点已忽略，可在导入后手动补充。`
    );
  }
  const total = eventsToMatch.length;
  onProgress?.('matching', total ? `准备匹配 ${total} 个地点...` : '正在整理...');
  signal?.throwIfAborted?.();

  for (let index = 0; index < total; index += 1) {
    signal?.throwIfAborted?.();
    const item = eventsToMatch[index];
    onProgress?.('matching', `正在匹配 ${item.place_name || '地点'} (${index + 1}/${total})`);
    setStatus(`正在匹配高德地点：${index + 1}/${total}（${item.place_name || ''}）`);

    const poi = await withTimeout(
      matchGuidePlace({
        placeName: item.place_name,
        city,
        note: item.note,
        sourceQuote: item.source_quote,
        signal
      }),
      GUIDE_MATCH_TIMEOUT_MS,
      null,
      `匹配 ${item.place_name}`
    );
    signal?.throwIfAborted?.();
    if (poi) matched += 1;
    events.push({
      id: `guide-${Date.now().toString(36)}-${index}`,
      placeName: item.place_name,
      day: Number.isInteger(item.day) && item.day > 0 ? item.day : null,
      timeSlot: item.time_slot || '',
      note: item.note || '',
      sourceQuote: item.source_quote || '',
      poi,
      matched: Boolean(poi),
      deleted: false
    });
  }

  onProgress?.('previewing', '正在整理导入预览...');
  signal?.throwIfAborted?.();
  return {
    title: extracted.title_suggestion || `${city || 'AI'}旅行路线`,
    city,
    cityHint: source.cityHint || '',
    sourceText: source.text || '',
    guideType: extracted.guide_type,
    warnings,
    events,
    matched
  };
}

export function withTimeout(promise, ms, fallback, label = '异步任务') {
  let settled = false;
  let timerId;
  return new Promise(resolve => {
    timerId = window.setTimeout(() => {
      settled = true;
      log.warn(`guide import ${label} 超时`);
      resolve(fallback);
    }, ms);

    Promise.resolve(promise)
      .then(value => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timerId);
        resolve(value);
      })
      .catch(error => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timerId);
        log.warn(`guide import ${label} 失败`, error);
        resolve(fallback);
      });
  });
}

export function normalizeGuideEventsFromSource(events, sourceText, warnings) {
  const routePlan = extractMainRoutePlan(sourceText);
  if (!routePlan.length) return events;

  const extractedByName = new Map();
  for (const item of events || []) {
    const key = normalizeGuidePlaceName(item?.place_name || '');
    if (key && !extractedByName.has(key)) extractedByName.set(key, item);
  }

  const normalized = routePlan.map(routeItem => {
    const key = normalizeGuidePlaceName(routeItem.name);
    const existing = extractedByName.get(key);
    const note = compactGuideNote([routeItem.note, existing?.note].filter(Boolean).join('；'));
    return {
      ...existing,
      place_name: routeItem.name,
      day: routeItem.day,
      time_slot: existing?.time_slot ?? null,
      note,
      source_quote: existing?.source_quote || routeItem.sourceQuote || routeItem.name
    };
  });

  if (normalized.length && normalized.length < (events || []).length) {
    warnings.push('已按主路线提取地点，沿途小店和机位已合并进备注。');
  }
  return normalized.length ? normalized : events;
}

function extractMainRoutePlan(sourceText) {
  const text = String(sourceText || '');
  const lines = text
    .split(/\r?\n/g)
    .map(line => line.trim())
    .filter(Boolean);
  const routeItems = [];
  const noteByPlace = new Map();
  let currentDay = null;
  let routeLineCount = 0;

  for (const line of lines) {
    const dayFromHeader = parseRouteDay(line);
    if (dayFromHeader) currentDay = dayFromHeader;

    const routeText = extractRouteLineText(line);
    if (routeText) {
      routeLineCount += 1;
      const day = currentDay || routeLineCount;
      const points = routeText
        .split(/[→>＞]+/g)
        .map(cleanRoutePlaceName)
        .filter(Boolean);

      for (const point of points) {
        routeItems.push({
          name: point,
          day,
          note: '',
          sourceQuote: line.slice(0, 80)
        });
      }
      continue;
    }

    const note = parseRoutePointNote(line);
    if (note) {
      noteByPlace.set(normalizeGuidePlaceName(note.name), note.text);
    }
  }

  const seen = new Set();
  const result = [];
  for (const item of routeItems) {
    const key = `${item.day}:${normalizeGuidePlaceName(item.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const note = findRouteNoteForPlace(item.name, noteByPlace);
    result.push({
      ...item,
      note: note ? compactGuideNote(note) : ''
    });
  }

  return result.length >= 3 ? result : [];
}

function parseRouteDay(line) {
  const alpha = line.match(/(?:^|[\s【[])([ABC])\s*线/i);
  if (alpha) return alpha[1].toUpperCase().charCodeAt(0) - 64;
  const zhMap = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  const route = line.match(/路线\s*([一二三四五六1-6])/);
  if (route) return zhMap[route[1]] || Number(route[1]) || null;
  const day = line.match(/(?:Day|DAY|D)\s*([1-9])/);
  if (day) return Number(day[1]);
  return null;
}

function extractRouteLineText(line) {
  if (!/[→>＞]/.test(line)) return '';
  const match = line.match(/(?:^|[▶▷—\s-])(?:路线|行程|线路)\s*[：:]\s*(.+)$/u);
  if (!match) return '';
  return match[1]
    .replace(/[，,。；;].*$/, '')
    .replace(/全程.*$/, '')
    .trim();
}

function cleanRoutePlaceName(value) {
  return String(value || '')
    .replace(/^[\s✔✓✅📍🔥⭐▶▷—、-]+/u, '')
    .replace(/\s*(?:路线|行程|线路)\s*$/, '')
    .replace(/[（(].*?[）)]/g, '')
    .replace(/[，,。；;：:].*$/, '')
    .trim();
}

function parseRoutePointNote(line) {
  const match = line.match(/^[\s✔✓✅📍🔥⭐—、-]*([^：:]{2,24})[：:]\s*(.+)$/u);
  if (!match) return null;
  const name = cleanRoutePlaceName(match[1]);
  const text = compactGuideNote(match[2]);
  if (!name || !text) return null;
  return { name, text };
}

function findRouteNoteForPlace(placeName, noteByPlace) {
  const placeKey = normalizeGuidePlaceName(placeName);
  if (noteByPlace.has(placeKey)) return noteByPlace.get(placeKey);
  for (const [key, note] of noteByPlace.entries()) {
    if (key.startsWith(placeKey) || placeKey.startsWith(key)) return note;
  }
  return '';
}

function compactGuideNote(value) {
  const parts = String(value || '')
    .replace(/[✅✔✓📍🔥⭐]/gu, '')
    .split(/[，,、；;]+/g)
    .map(item => item.trim())
    .filter(Boolean);
  const compact = Array.from(new Set(parts)).slice(0, 6).join('、');
  return compact.length > 70 ? `${compact.slice(0, 70)}...` : compact;
}

function normalizeGuidePlaceName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[·•_—,，.。:：;；()（）【\]《》"'“”‘’-]/g, '');
}

// 攻略地点匹配：按 PRD §4.4 的降级链做 (Layer 3 source_quote 提名词已删，V1 只剩 2 层 + 兜底)
//
//   Layer 1: place_name + city → top1 相似度 ≥ 0.7 → 直接返回
//   Layer 2: place_name + note 关键词扩展 → 任意候选相似度 ≥ 0.5 → 返回最高相似度的
//   兜底:    都没命中 → 返回 null（预览页标灰，用户手动搜）
//
// 之前 Codex 只实现了 Layer 1 + 拿 places[0] 不做 similarity check——所以 LLM 提取的
// "便宜坊" 撞不上高德的 "便宜坊烤鸭(xx店)"，看似 fail；预览页手动搜能命中是因为用户能挑。
export async function matchGuidePlace({ placeName, city, note, sourceQuote, signal }) {
  const state = getAppState();
  if (!state.AMap || !placeName) return null;

  // Layer 1: place_name + city
  const placesL1 = await searchGuidePlaces(placeName, city, 10, signal);
  const bestL1 = pickBestMatch(placesL1, placeName, 0.7);
  // 日志默认开，方便用户/开发自助 debug；上线前可统一关
  log.debug(`L1 "${placeName}"`, {
    city,
    count: placesL1.length,
    candidates: placesL1.slice(0, 5).map(p => ({
      name: p.name,
      score: similarityScore(p.name, placeName).toFixed(2)
    })),
    picked: bestL1?.name || null
  });
  if (bestL1) return bestL1;

  // Layer 2: place_name + note 关键词扩展
  const keywords = extractNounKeywords(note, sourceQuote, placeName);
  for (const kw of keywords) {
    const expandedKeyword = `${placeName} ${kw}`.trim();
    signal?.throwIfAborted?.();
    const placesL2 = await searchGuidePlaces(expandedKeyword, city, 8, signal);
    const bestL2 = pickBestMatch(placesL2, placeName, 0.7);
    log.debug(`L2 "${expandedKeyword}"`, {
      count: placesL2.length,
      candidates: placesL2.slice(0, 3).map(p => ({
        name: p.name,
        score: similarityScore(p.name, placeName).toFixed(2)
      })),
      picked: bestL2?.name || null
    });
    if (bestL2) return bestL2;
  }

  // Layer 3 (兜底): Geocoder 地址解析——专门救 PlaceSearch 吞掉的知名地标
  const geocoded = await geocodeAsPOI(placeName, city);
  if (geocoded) {
    // L3 拿到 lnglat 后，反向再做一次 searchNearBy 补全 rating/cost/photo 等 rich metadata
    const enriched = await enrichGeocodedPOI(geocoded, placeName);
    if (enriched) {
      log.debug(`L3+enrich "${placeName}"`, {
        addr: enriched.addr,
        rating: enriched.rating ?? null,
        cost: enriched.cost ?? null,
        hasPhoto: Boolean(enriched.photo)
      });
      return enriched;
    }
    // enrich 失败也没关系，用纯 Geocoder 结果（无 photo/rating，但有坐标）
    log.debug(`L3 Geocoder "${placeName}" (无 enrich)`, {
      addr: geocoded.addr
    });
    return geocoded;
  }

  log.warn(`"${placeName}" 全部层级失败 → 标灰`);
  return null;
}

// 从一堆候选 POI 里挑出与 placeName 最相似的（相似度 ≥ threshold 才算命中）
// PRD §4.4.2 阈值定义：≥ 70% 高置信度自动绑；< 70% 标灰
function pickBestMatch(places, placeName, threshold) {
  if (!places?.length) return null;
  let best = null;
  let bestScore = 0;
  for (const place of places) {
    const score = similarityScore(place.name, placeName);
    if (score > bestScore) {
      best = place;
      bestScore = score;
    }
  }
  return bestScore >= threshold ? best : null;
}

// 简易字符相似度：综合"包含关系"和"字符交集占比"
// 例：("便宜坊烤鸭(王府井店)", "便宜坊") → 包含 → min/max = 3/11 ≈ 0.27 — 但我们更看重 LLM
//     名是否被高德名包含。所以包含关系给一个保底加分。
function similarityScore(amapName, llmName) {
  const fullName = String(amapName || '')
    .toLowerCase()
    .replace(/\s+/g, '');
  const b = String(llmName || '')
    .toLowerCase()
    .replace(/\s+/g, '');
  if (!fullName || !b) return 0;
  if (fullName === b) return 1;
  // A landmark in a hotel's branch/address qualifier does not identify the hotel as that landmark.
  const a = fullName.replace(/\([^)]*\)|（[^）]*）/g, '');
  if (!a) return 0;
  // 包含关系：LLM 名是高德名的子串（如 "便宜坊" ⊂ "便宜坊烤鸭"）→ 高置信
  if (a.includes(b) || b.includes(a)) {
    const minLen = Math.min(a.length, b.length);
    const maxLen = Math.max(a.length, b.length);
    // 子串占比 + 0.4 加权（鼓励完整包含的匹配）
    return Math.min(1, minLen / maxLen + 0.4);
  }
  // 不包含：用字符交集
  const setB = new Set(b);
  let common = 0;
  for (const ch of a) if (setB.has(ch)) common++;
  return common / Math.max(a.length, b.length);
}

// Layer 3 兜底拿到 lnglat 后，用 PlaceSearch.searchNearBy 反向回填 rich metadata。
// 思路：Geocoder 已经精确定位到地点 → 用这个 lnglat 做圆心 + placeName 做关键词搜
// 800m 内的 POI → 命中带 rating/cost/photo/tag 的"同一地点"PlaceSearch 条目。
//
// 为什么这次能拿到 PlaceSearch 之前拿不到的：
//   - 之前 PlaceSearch 用 city 名做 scope，被 AMap 内部 quirk 吞掉
//   - 现在用 lnglat 做精确空间约束，搜索效率高很多
//   - 例：「颐和园」之前 city='北京' 三层 0 结果 → Geocoder 解出 lnglat → searchNearBy
//          以那个 lnglat 为圆心搜「颐和园」→ 命中带 rating 4.6、photo 的颐和园 POI
//
// 失败时返回 null，调用方继续用 Geocoder 的简化 POI。
async function enrichGeocodedPOI(geocoded, placeName) {
  if (!geocoded?.lnglat || !placeName) return null;
  const state = getAppState();
  if (!state.AMap) return null;

  const places = await searchNearBy(state.AMap, {
    keyword: placeName,
    center: geocoded.lnglat,
    radius: 800
  });
  if (!places.length) return null;

  // 用 similarity 筛掉"附近的不同店铺"——确保命中是同一个地点
  // Nearby enrichment must obey the same identity threshold as direct search.
  const best = pickBestMatch(places, placeName, 0.7);
  if (!best) return null;

  // 优先用 PlaceSearch 的完整数据（含 rating/cost/photo）
  // lnglat 用 PlaceSearch 给的（POI 入口位置，比 Geocoder 的"地理中心"更适合 marker）
  return best;
}

// Layer 3 兜底：用 AMap.Geocoder（地址解析）拿坐标
// PlaceSearch 三层全 0 时的最后救命——例如"鼓楼""颐和园"这种知名地标
// AMap 的 PlaceSearch 偶尔会吞它们，但 Geocoder 几乎总能解出。
// 返回的 POI 形态简化：只有 name/addr/lnglat，没有 rating/cost/photo——
// 但用户能在地图上看到 marker，预览页也显示 ✓ 已匹配。
async function geocodeAsPOI(placeName, city) {
  const state = getAppState();
  if (!state.AMap || !placeName) return null;
  const AMap = state.AMap;
  return new Promise(resolve => {
    const geocoder = new AMap.Geocoder({
      city: city || ''
    });
    geocoder.getLocation(placeName, (status, result) => {
      if (status !== 'complete' || (result?.info || '').toUpperCase() !== 'OK') {
        resolve(null);
        return;
      }
      const geo = result.geocodes?.[0];
      if (!geo?.location) {
        resolve(null);
        return;
      }
      const lng = Number(geo.location.lng);
      const lat = Number(geo.location.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        resolve(null);
        return;
      }
      resolve({
        id: `geo-${geo.adcode || Date.now().toString(36)}`,
        name: placeName, // Geocoder 没返回 name，用用户输入兜底
        addr: String(geo.formattedAddress || '').trim(),
        province: String(geo.addressComponent?.province || '').trim(),
        city: String(
          geo.addressComponent?.city || geo.addressComponent?.province || city || ''
        ).trim(),
        district: String(geo.addressComponent?.district || '').trim(),
        type: '',
        lnglat: [lng, lat]
      });
    });
  });
}

// 从 note / source_quote 抽中文名词关键词，给 Layer 2 做扩展搜索用
// 简单粗暴：按标点切分 → 取长度 ≥ 2 的中文片段 → 去重 → 取最长的 2 个
// （不调 LLM，纯规则；够 Layer 2 用）
function extractNounKeywords(note, sourceQuote, excludeKeyword = '') {
  const text = `${note || ''} ${sourceQuote || ''}`;
  if (!text.trim()) return [];
  const fragments = text
    .split(/[，。、；,.\s\d:：()（）"'""''!！?？—~～·/-]+/g)
    .map(s => s.trim())
    .filter(s => s.length >= 2 && s.length <= 8 && /^[一-鿿]+$/.test(s))
    .filter(s => !excludeKeyword.includes(s) && !s.includes(excludeKeyword));
  // 去重并按长度倒序，取前 2 个
  const dedup = Array.from(new Set(fragments));
  dedup.sort((a, b) => b.length - a.length);
  return dedup.slice(0, 2);
}

// 攻略地点搜索的降级：
//   Layer A: city 名（AI/用户给的城市）
//   Layer B: 全国搜（city: false）
//
// 不回退 AppConfig.cityCode（默认北京）。否则上海攻略在 city 搜索失败后，会被北京候选污染。
export async function searchGuidePlaces(keyword, city, pageSize = 8, signal) {
  const state = getAppState();
  if (!keyword) return [];
  const AMap = state.AMap || (await loadAMap());
  if (!state.AMap) setAMap(AMap);

  const cityCandidates = [];
  if (city) cityCandidates.push(city); // A: AI/用户城市名
  cityCandidates.push(false); // B: 全国兜底。不要回退默认北京，避免跨城市攻略误匹配。

  for (const cityArg of cityCandidates) {
    signal?.throwIfAborted?.();
    const places = await searchPlaces(AMap, keyword, { city: cityArg, pageSize, signal });
    log.debug(
      `[guide-search] "${keyword}" tried city=${JSON.stringify(cityArg)} → count=${places.length}`,
      places.length ? `first="${places[0]?.name}"` : ''
    );
    if (places.length) return places;
  }
  log.warn(`"${keyword}" 搜索 0 结果`, { tried: cityCandidates });
  return [];
}
