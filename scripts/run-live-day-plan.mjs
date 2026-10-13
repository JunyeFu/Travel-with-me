import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { budgetDeepSeekFetch } from './live-ai-budget.mjs';
import { evaluateDayPlan, reconcilePlan } from '../js/day-plan.js';

process.env.RAG_ENABLED = 'false';
process.env.RAG_SAVE_IMPORTED_GUIDES = 'false';
process.env.DEMO_MODE = 'false';
const ledger = budgetDeepSeekFetch(() => 'day-plan-time-facts', 'time-assessment');
const before = ledger.calls.length;
const { app } = await import('../server/index.js');
const report = {
  startedAt: new Date().toISOString(),
  status: 'running',
  aiCallsBefore: before,
  mapQueries: []
};
try {
  const response = await app.request('/_ai/extract-guide', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      cityHint: '杭州',
      text: '杭州一天慢旅行：从住宿地坐地铁到清河坊步行街，09:00到达，游玩60到90分钟，看店铺和街景。随后步行到胡庆余堂(总店)，10:50预约开始参观，停留30到45分钟。结束后步行返回清河坊步行街，途中留出休息时间。住宿地名称和希望结束的时间由用户补充。'
    })
  });
  report.aiHTTP = response.status;
  const guide = await response.json();
  assert.equal(response.status, 200);
  report.events = guide.events.map(e => ({ name: e.place_name, facts: e.time_facts }));
  const street = guide.events.find(e => e.place_name.includes('河坊'));
  const museum = guide.events.find(e => e.place_name.includes('胡庆余堂'));
  assert.equal(street?.time_facts?.arrival, 540);
  assert.deepEqual(street?.time_facts?.duration, { min: 60, max: 90 });
  assert.equal(street?.time_facts?.transport?.mode, 'walking');
  assert.deepEqual(street?.time_facts?.startTransport, {
    mode: 'transit',
    preference: 'subway'
  });
  assert.deepEqual(museum?.time_facts?.duration, { min: 30, max: 45 });
  assert.equal(museum?.time_facts?.fixedCandidate, 650);
  const coordinates = ['120.168923,30.240073', '120.168961,30.239832'];
  for (const [from, to] of [
    [0, 1],
    [1, 0]
  ]) {
    const started = performance.now();
    const response = await app.request(
      `/_AMapService/v3/direction/walking?origin=${coordinates[from]}&destination=${coordinates[to]}`
    );
    const result = await response.json(),
      path = result.route?.paths?.[0];
    assert.equal(response.status, 200);
    assert.equal(result.status, '1');
    assert.ok(Number.isFinite(Number(path?.duration)));
    report.mapQueries.push({
      from: coordinates[from],
      to: coordinates[to],
      seconds: Number(path.duration),
      meters: Number(path.distance),
      elapsedMs: Math.round(performance.now() - started),
      fetchedAt: Date.now(),
      steps: path.steps
    });
  }
  const day = {
    events: [
      {
        id: 'street',
        locationId: 'street',
        sourceFacts: street.time_facts,
        visit: { ...street.time_facts.duration, source: 'guide' }
      },
      {
        id: 'museum',
        locationId: 'museum',
        sourceFacts: museum.time_facts,
        fixedStart: museum.time_facts.fixedCandidate,
        visit: { ...museum.time_facts.duration, source: 'guide' }
      }
    ]
  };
  day.plan = reconcilePlan(day, {
    start: { locationId: 'museum', minute: 540 },
    end: { locationId: 'street', minute: 720 }
  });
  assert.equal(day.plan.legs[0].transitPreference, 'subway');
  assert.equal(evaluateDayPlan(day).status, 'incomplete');
  // User-confirmed walking replaces the unsupported pure-subway preference for this short fixture.
  day.plan.legs.forEach((leg, i) => {
    leg.mode = 'walking';
    leg.modeSource = 'user';
    leg.transitPreference = null;
    leg.estimate = { status: 'real', seconds: report.mapQueries[i === 1 ? 0 : 1].seconds };
  });
  report.assessment = evaluateDayPlan(day);
  assert.equal(report.assessment.status, 'within-window');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  throw error;
} finally {
  report.aiCallsAfter = ledger.calls.length;
  report.finishedAt = new Date().toISOString();
  await mkdir('work/time-assessment', { recursive: true });
  await writeFile('work/time-assessment/live-result.json', JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      status: report.status,
      aiCalls: ledger.calls.length - before,
      totalBudget: `${ledger.calls.length}/60`,
      mapQueries: report.mapQueries.length
    })
  );
}
