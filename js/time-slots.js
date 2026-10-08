export const TIME_SLOT_OPTIONS = [
  { id: '', label: '未定' },
  { id: 'morning', label: '上午' },
  { id: 'noon', label: '中午' },
  { id: 'afternoon', label: '下午' },
  { id: 'evening', label: '晚上' }
];

export const TIME_SLOT_ORDER = ['morning', 'noon', 'afternoon', 'evening', ''];

export function normalizeTimeSlot(value) {
  return TIME_SLOT_ORDER.includes(value) ? value : '';
}

export function getTimeSlotLabel(value) {
  const normalized = normalizeTimeSlot(value);
  return TIME_SLOT_OPTIONS.find(option => option.id === normalized)?.label || '未定';
}

export function getTimeSlotRank(value) {
  const rank = TIME_SLOT_ORDER.indexOf(normalizeTimeSlot(value));
  return rank >= 0 ? rank : TIME_SLOT_ORDER.length - 1;
}

export function getTimeSlotHour(value) {
  return { morning: 9, noon: 12, afternoon: 15, evening: 20 }[normalizeTimeSlot(value)] ?? null;
}
