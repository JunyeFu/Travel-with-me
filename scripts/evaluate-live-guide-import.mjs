import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { budgetDeepSeekFetch } from './live-ai-budget.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'work/release/ai-evaluation');
const ledgerPath = resolve(root, 'work/release/ai-budget.json');
const arm = process.argv.find(arg => arg.startsWith('--arm='))?.split('=')[1];
const limit = 60;
mkdirSync(output, { recursive: true });
const cases = JSON.parse(
  readFileSync(resolve(root, 'tests/fixtures/guide-import-evaluation/cases.json'), 'utf8')
);
const reference = JSON.parse(
  readFileSync(resolve(root, 'tests/fixtures/guide-import-evaluation/rag-reference.json'), 'utf8')
);

if (!arm) {
  const startedAt = Date.now();
  const completed = [];
  for (const group of ['off', 'on']) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--arm=${group}`], {
      cwd: root,
      env: process.env,
      stdio: 'inherit'
    });
    if (child.status !== 0) {
      process.exitCode = 1;
      break;
    }
    completed.push(group);
  }
  if (
    completed.length === 2 &&
    existsSync(resolve(output, 'off-report.json')) &&
    existsSync(resolve(output, 'on-report.json'))
  ) {
    const off = JSON.parse(readFileSync(resolve(output, 'off-report.json'), 'utf8'));
    const on = JSON.parse(readFileSync(resolve(output, 'on-report.json'), 'utf8'));
    if ([off, on].some(report => Date.parse(report.generatedAt) < startedAt))
      throw new Error('Evaluation reports must come from this invocation');
    const errors = report => ({
      missed: report.score.cases.reduce((n, c) => n + c.missed.length, 0),
      extra: report.score.summary.falsePositiveCount,
      forbidden: report.score.summary.forbiddenHits,
      wrongDay: report.score.cases.reduce(
        (n, c) => n + Math.round(c.matchedCount * (1 - c.dayAccuracy)),
        0
      ),
      failed: report.results.filter(c => !c.ok).length
    });
    const a = errors(off),
      b = errors(on);
    const benefit =
      off.thresholdPass &&
      on.thresholdPass &&
      Object.keys(a).every(k => b[k] <= a[k]) &&
      Object.keys(a).some(k => b[k] < a[k]);
    const comparison = {
      scope:
        'Real BFF/DeepSeek requests on controlled seed inputs; NOT user research or browser LIVE_E2E.',
      generatedAt: new Date().toISOString(),
      off: a,
      on: b,
      benefitObserved: benefit,
      publicRagEnabled: false,
      calls: JSON.parse(readFileSync(ledgerPath, 'utf8')).calls.length,
      cost: 'usage recorded; no actual bill or monetary cost asserted'
    };
    writeFileSync(resolve(output, 'comparison.json'), JSON.stringify(comparison, null, 2));
    console.log(JSON.stringify(comparison, null, 2));
  }
} else {
  if (!['off', 'on'].includes(arm)) throw new Error('Unknown evaluation arm');
  process.env.DEMO_MODE = 'false';
  process.env.RAG_ENABLED = String(arm === 'on');
  process.env.RAG_DB_PATH = ':memory:';
  process.env.RAG_SAVE_IMPORTED_GUIDES = 'false';
  process.env.AI_RATE_LIMIT = '1000';
  let currentCase = '';
  const ledger = budgetDeepSeekFetch(() => currentCase, arm);
  const { app } = await import('../server/index.js');
  const status = await (await app.request('/_ai/status')).json();
  if (!status.available) throw new Error(`DeepSeek unavailable: ${status.reason}`);
  if (arm === 'on') {
    const { saveGuide } = await import('../server/rag/store.js');
    const { tokenize } = await import('../server/rag/tokenizer.js');
    for (const doc of reference)
      saveGuide({
        city: doc.city,
        guide_type: 'recommendation',
        source_text: doc.text,
        extracted: '{}',
        token_count: tokenize(doc.text).length
      });
    const { rebuildRagIndex } = await import('../server/index.js');
    rebuildRagIndex();
    if (!(await (await app.request('/_rag/status')).json()).ready)
      throw new Error('Reference corpus not ready');
  }
  const results = [],
    scored = [];
  for (const sample of cases) {
    if (ledger.calls.length >= limit) {
      process.exitCode = 1;
      break;
    }
    currentCase = sample.id;
    const firstCall = ledger.calls.length;
    const started = performance.now();
    const res = await app.request('/_ai/extract-guide', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: sample.sourceText, cityHint: sample.cityHint })
    });
    const actual = await res.json();
    const result = {
      id: sample.id,
      ok: res.ok,
      httpStatus: res.status,
      elapsedMs: Math.round(performance.now() - started),
      calls: ledger.calls.slice(firstCall),
      output: res.ok ? actual : { error: actual.error, message: actual.message }
    };
    results.push(result);
    scored.push({ ...sample, modelOutput: res.ok ? actual : { events: [] } });
    writeFileSync(resolve(output, `${arm}-cases.json`), JSON.stringify(scored, null, 2));
    writeFileSync(resolve(output, `${arm}-results.json`), JSON.stringify(results, null, 2));
    console.log(
      `${arm} ${sample.id}: HTTP ${res.status}; ${result.elapsedMs}ms; calls=${ledger.calls.length}/${limit}`
    );
    if (result.calls.some(call => [401, 402, 403].includes(call.httpStatus)))
      throw new Error('Supplier credential or balance rejected; further calls stopped');
  }
  if (results.length !== cases.length) throw new Error('Incomplete evaluation: budget exhausted');
  const scoring = spawnSync(
    process.execPath,
    [
      'scripts/evaluate-guide-import.mjs',
      '--input',
      resolve(output, `${arm}-cases.json`),
      '--json'
    ],
    { cwd: root, encoding: 'utf8' }
  );
  if (!scoring.stdout.trim()) throw new Error('Scoring failed');
  const report = {
    arm,
    generatedAt: new Date().toISOString(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: Boolean(
      execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
    ),
    controlledSeeds: true,
    configuredModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    promptFile: 'server/prompts/guide-extract.md',
    promptText: readFileSync(resolve(root, 'server/prompts/guide-extract.md'), 'utf8'),
    retrievalCorpusSize: arm === 'on' ? reference.length : 0,
    score: JSON.parse(scoring.stdout),
    thresholdPass: scoring.status === 0,
    results
  };
  writeFileSync(resolve(output, `${arm}-report.json`), JSON.stringify(report, null, 2));
  if (results.some(item => !item.ok)) process.exitCode = 1;
}
