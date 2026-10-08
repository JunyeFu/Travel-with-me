// 行程导引的跨渲染器视觉契约。
// AMap Polyline 与 Three.js 网格的底层能力不同，但必须表达同一条路线与状态。

export const ROUTE_GUIDANCE = Object.freeze({
  outline: '#FFFFFF',
  roadBed: '#F8F4EA',
  edge: '#3E3B34',
  line: '#E6AD00',
  activeLine: '#F2B705',
  default: Object.freeze({ strokeWeight: 7, strokeOpacity: 0.96, zIndex: 200 }),
  dim: Object.freeze({ strokeWeight: 5, strokeOpacity: 0.32, zIndex: 100 }),
  active: Object.freeze({ strokeWeight: 9, strokeOpacity: 1, zIndex: 220 }),
  halo: Object.freeze({ strokeWeight: 18, strokeOpacity: 0.22 })
});

export function getRouteGuidanceColor({ active = false } = {}) {
  return active ? ROUTE_GUIDANCE.activeLine : ROUTE_GUIDANCE.line;
}

// 五档固定色号，按示意日照强度分档：夜间浅蓝 → 正午中性黄。
const DAYLIGHT_COLORS = ['#86B8DB', '#9CBDC9', '#B2C6B8', '#C7CCA6', '#DDD394'];
// 00–06 / 18–23 为夜间；07–12 逐档增强，13–17 逐档回落。
const HOUR_COLOR_INDEX = [0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 4, 4, 4, 3, 3, 2, 1, 0, 0, 0, 0, 0, 0];

export function getRouteDaylightColor(hour) {
  if (hour === null) return '#6E6A63';
  return DAYLIGHT_COLORS[HOUR_COLOR_INDEX[Math.floor(hour) % 24]];
}
