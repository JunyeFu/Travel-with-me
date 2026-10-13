import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  unlinkSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function budgetDeepSeekFetch(caseId, arm) {
  const ledgerPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../work/release/ai-budget.json'
  );
  mkdirSync(dirname(ledgerPath), { recursive: true });
  // One paid test process at a time: otherwise a smoke run can overwrite another run's count.
  const lockPath = ledgerPath + '.lock';
  let owner;
  try {
    owner = openSync(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error('Another LIVE AI test owns the budget. Run paid tests sequentially.');
    throw error;
  }
  process.once('exit', () => {
    closeSync(owner);
    unlinkSync(lockPath);
  });
  const ledger = existsSync(ledgerPath)
    ? JSON.parse(readFileSync(ledgerPath, 'utf8'))
    : { limit: 60, calls: [] };
  if (ledger.limit !== 60) throw new Error('Budget ledger must retain the agreed 60-call ceiling');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (new URL(String(input)).hostname !== 'api.deepseek.com') return originalFetch(input, init);
    if (ledger.calls.length >= 60) throw new Error('LIVE_AI_BUDGET_EXHAUSTED');
    const call = {
      number: ledger.calls.length + 1,
      arm,
      caseId: caseId(),
      startedAt: new Date().toISOString(),
      status: 'started'
    };
    ledger.calls.push(call);
    writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
    const started = performance.now();
    try {
      const res = await originalFetch(input, init);
      const body = await res.clone().json();
      call.httpStatus = res.status;
      call.model = body.model || '';
      call.usage = body.usage || null;
      call.status = res.ok ? 'completed' : 'failed';
      return res;
    } catch (error) {
      call.status = 'failed';
      call.error = error.name;
      throw error;
    } finally {
      call.elapsedMs = Math.round(performance.now() - started);
      writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
    }
  };
  return ledger;
}
