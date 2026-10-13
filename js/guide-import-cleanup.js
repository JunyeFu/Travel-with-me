import { normalizeTimeSlot } from './time-slots.js';

export const MAX_GUIDE_DAYS = 30;

const NOISE_EXACT_NAMES = new Set([
  '相机',
  '镜头',
  '口红',
  '口红色号',
  '色号',
  '优惠码',
  '酒店优惠码',
  '购物清单',
  '大阪购物清单',
  '行李清单',
  '穿搭',
  '拍照姿势',
  '防晒',
  '雨伞',
  '身份证',
  '充电宝',
  '机票',
  '车票',
  '预算',
  '天气'
]);

const VAGUE_EXACT_NAMES = new Set([
  '家',
  '公司',
  '酒店',
  '民宿',
  '附近',
  '楼下',
  '楼下便利店',
  '一家小店',
  '那家店',
  '随便逛逛',
  '打车',
  '地铁',
  '步行'
]);

const NOISE_PATTERNS = [
  /优惠(?:码|券)$/u,
  /(?:购物|采购|行李|装备|必带|避雷)清单$/u,
  /(?:相机|镜头|口红|色号|穿搭|姿势|滤镜|修图|机位参数)$/u,
  /^(?:从)?(?:家|酒店|民宿|公司)(?:出发|回去|附近)?$/u,
  /^(?:打车|地铁|公交|步行|骑车|开车|走路).{0,8}$/u
];

export function cleanGuideExtractedEvents(events, options = {}) {
  const warnings = options.warnings;
  const normalized = [];
  const seen = new Set();
  let filteredCount = 0;
  let outOfRangeDayCount = 0;

  for (const event of events || []) {
    const rawDay = Number(event?.day);
    if (Number.isInteger(rawDay) && rawDay > MAX_GUIDE_DAYS) outOfRangeDayCount += 1;
    const item = normalizeGuideEvent(event);
    if (!item) {
      filteredCount += 1;
      continue;
    }

    const key = `${item.day || ''}:${item.time_slot || ''}:${normalizeGuideCleanupText(
      item.place_name
    )}:${item.source_sequence ?? item.time_facts?.arrival ?? item.source_quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(item);
  }

  if (filteredCount && Array.isArray(warnings)) {
    warnings.push(`已过滤 ${filteredCount} 个非地点或噪声项。`);
  }
  if (outOfRangeDayCount && Array.isArray(warnings)) {
    warnings.push(`超出 ${MAX_GUIDE_DAYS} 天的地点已移入未排期。`);
  }

  return normalized;
}

export function normalizeGuideEvent(event) {
  const placeName = String(event?.place_name || event?.placeName || '').trim();
  if (!placeName || isGuideNoisePlaceName(placeName)) return null;

  const day = normalizeGuideDay(event?.day);
  const timeSlot = normalizeTimeSlot(event?.time_slot || event?.timeSlot || '');
  return {
    ...event,
    place_name: placeName,
    day,
    time_slot: timeSlot || null,
    note: String(event?.note || '').trim(),
    source_quote: String(event?.source_quote || event?.sourceQuote || '').trim()
  };
}

export function isGuideNoisePlaceName(placeName) {
  const normalized = normalizeGuideCleanupText(placeName);
  if (!normalized) return true;
  if (NOISE_EXACT_NAMES.has(normalized) || VAGUE_EXACT_NAMES.has(normalized)) return true;
  return NOISE_PATTERNS.some(pattern => pattern.test(normalized));
}

export function normalizeGuideCleanupText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/gu, '')
    .replace(/[，。！？、；;:()[\]{}"'“”‘’<>《》【】\-_/\\|]/gu, '');
}

function normalizeGuideDay(value) {
  if (value === null || value === undefined || value === '') return null;
  const day = Number(value);
  return Number.isInteger(day) && day > 0 && day <= MAX_GUIDE_DAYS ? day : null;
}
