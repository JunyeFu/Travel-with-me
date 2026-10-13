import assert from 'node:assert/strict';
import { budgetDeepSeekFetch } from './live-ai-budget.mjs';

process.env.RAG_ENABLED = 'false';
process.env.DEMO_MODE = 'false';
budgetDeepSeekFetch(() => 'hangzhou-semantic-smoke', 'smoke');

const { app } = await import('../server/index.js');
const statusResponse = await app.request('/_ai/status');
const status = await statusResponse.json();
if (!status.available) throw new Error(`DeepSeek live smoke unavailable: ${status.reason}`);

const response = await app.request('/_ai/extract-guide', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    cityHint: '杭州',
    text: '杭州两日游攻略：第一天上午游览西湖断桥和白堤，中午在湖滨用餐，下午前往灵隐寺，晚上逛河坊街。第二天上午参观中国茶叶博物馆，下午到西溪湿地散步。'
  })
});
const result = await response.json();
if (!response.ok || !result.city || !Array.isArray(result.events) || !result.events.length) {
  throw new Error(
    `DeepSeek live smoke failed: HTTP ${response.status} ${result.error || ''}`.trim()
  );
}
assert.match(result.city, /杭州/);
for (const [name, day] of [
  ['断桥', 1],
  ['白堤', 1],
  ['灵隐寺', 1],
  ['河坊街', 1],
  ['茶叶博物馆', 2],
  ['西溪', 2]
]) {
  assert.ok(
    result.events.some(event => event.place_name.includes(name) && event.day === day),
    `Missing or misplaced itinerary stop: ${name}, Day ${day}`
  );
}
assert.ok(
  result.events.every(event => [1, 2].includes(event.day)),
  'Unexpected itinerary day'
);
assert.ok(
  result.events.every(event => !/北京|上海|故宫|天安门/.test(event.place_name)),
  'Unrelated destination introduced'
);
console.log(
  'DeepSeek semantic fixture passed: six required stops, day assignment and unrelated-place checks.'
);
console.log(`DeepSeek live smoke passed: city=${result.city}; events=${result.events.length}.`);
