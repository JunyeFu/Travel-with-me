import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, posix, resolve } from 'node:path';

export const RELEASE_STATUSES = Object.freeze(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN']);
export const RELEASE_LAYER_IDS = Object.freeze([
  'local',
  'ci-node-22',
  'amap-live',
  'deepseek-live',
  'container',
  'human-review',
  'release-authorization'
]);

const LAYER_LABELS = Object.freeze({
  local: '本地自动化',
  'ci-node-22': 'Node 22.22.1 CI',
  'amap-live': 'AMap LIVE',
  'deepseek-live': 'DeepSeek LIVE',
  container: '容器健康与就绪',
  'human-review': '四视口人工审查',
  'release-authorization': '发布授权'
});
const SECRET_FIELD = /(api.?key|secret|token|password|credential|authorization)/i;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export function validateReleaseManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') return ['manifest must be an object'];
  if (manifest.schemaVersion !== '2d-release-evidence/v1') {
    errors.push('schemaVersion must be 2d-release-evidence/v1');
  }
  if (!isTimestamp(manifest.generatedAt)) errors.push('generatedAt must be an ISO timestamp');

  const candidate = manifest.candidate || {};
  if (!COMMIT_PATTERN.test(candidate.commit || '')) errors.push('candidate commit must be 40 hex');
  if (!candidate.branch) errors.push('candidate branch is required');
  if (typeof candidate.clean !== 'boolean') errors.push('candidate clean must be boolean');
  if (typeof candidate.frozen !== 'boolean') errors.push('candidate frozen must be boolean');
  if (!Array.isArray(candidate.dirtyScope)) errors.push('candidate dirtyScope must be an array');
  if (!COMMIT_PATTERN.test(candidate.rollback?.revision || '')) {
    errors.push('rollback revision must be 40 hex');
  }
  if (typeof candidate.rollback?.verified !== 'boolean') {
    errors.push('rollback verified must be boolean');
  }

  const layers = Array.isArray(manifest.layers) ? manifest.layers : [];
  const ids = layers.map(layer => layer?.id);
  for (const requiredId of RELEASE_LAYER_IDS) {
    if (ids.filter(id => id === requiredId).length !== 1) {
      errors.push(`layer ${requiredId} must appear exactly once`);
    }
  }
  for (const layer of layers) validateLayer(layer, candidate.commit, errors);
  findSecretFields(manifest, '', errors);
  return [...new Set(errors)];
}

export function deriveReleaseDecision(manifest) {
  const validationErrors = validateReleaseManifest(manifest);
  const blockers = [];
  const candidate = manifest?.candidate || {};

  if (validationErrors.length) {
    blockers.push(
      ...validationErrors.map(reason => ({
        id: 'manifest',
        label: '证据清单合同',
        status: 'FAIL',
        reason,
        owner: 'release engineer',
        requiredAction: '修复清单并重新校验',
        rollbackPoint: candidate.rollback?.revision || '未记录',
        closureCondition: '清单校验无错误'
      }))
    );
  }
  const candidateReasons = [];
  if (!candidate.clean) candidateReasons.push('候选仍有脏变更');
  if (!candidate.frozen) candidateReasons.push('候选尚未冻结');
  if (!candidate.rollback?.verified) candidateReasons.push('回滚修订尚未验证可恢复');
  if (candidateReasons.length)
    blockers.push(candidateBlocker(candidateReasons.join('；'), candidate));

  for (const layer of Array.isArray(manifest?.layers) ? manifest.layers : []) {
    if (layer.status === 'PASS') continue;
    blockers.push({
      id: layer.id,
      label: LAYER_LABELS[layer.id] || layer.id,
      status: RELEASE_STATUSES.includes(layer.status) ? layer.status : 'FAIL',
      reason: layer.reason || '证据未通过',
      owner: layer.owner || '未分配',
      requiredAction: layer.requiredAction || '补齐候选绑定证据',
      rollbackPoint: layer.rollbackPoint || candidate.rollback?.revision || '未记录',
      closureCondition: layer.closureCondition || '该层状态为 PASS'
    });
  }

  return { decision: blockers.length ? 'HOLD' : 'RELEASE', blockers };
}

export async function verifyReleaseArtifacts(manifest, projectRoot) {
  const errors = validateReleaseManifest(manifest);
  if (errors.length) return errors;
  const artifactErrors = [];
  for (const layer of manifest.layers) {
    if (!layer.artifact) continue;
    const artifactPath = resolve(projectRoot, layer.artifact.path);
    let content;
    try {
      content = await readFile(artifactPath);
    } catch {
      artifactErrors.push(`layer ${layer.id} artifact is missing: ${layer.artifact.path}`);
      continue;
    }
    const actual = createHash('sha256').update(content).digest('hex');
    if (actual !== layer.artifact.sha256.toLowerCase()) {
      artifactErrors.push(`layer ${layer.id} artifact SHA-256 mismatch: ${layer.artifact.path}`);
    }
  }
  return artifactErrors;
}

export function buildReviewHtml(manifest) {
  const errors = validateReleaseManifest(manifest);
  if (errors.length) throw new Error(`Invalid release manifest:\n${errors.join('\n')}`);
  const result = deriveReleaseDecision(manifest);
  const tabs = manifest.layers
    .map(layer => `<a href="#${escapeHtml(layer.id)}">${escapeHtml(LAYER_LABELS[layer.id])}</a>`)
    .join('');
  const layers = manifest.layers.map(layer => renderLayer(layer)).join('');
  const blockerRows = result.blockers.length
    ? result.blockers.map((blocker, index) => renderBlocker(blocker, index === 0)).join('')
    : '<p class="empty">所有必需层级已闭合。</p>';
  const counts = Object.fromEntries(RELEASE_STATUSES.map(status => [status, 0]));
  for (const layer of manifest.layers) counts[layer.status] += 1;

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>2D 发布审查册</title><style>${REVIEW_CSS}</style></head>
<body><main class="shell">
  <header><div><p class="eyebrow">TRAVEL WITH ME · 2D ONLY</p><h1>候选发布审查</h1></div><span class="decision ${result.decision.toLowerCase()}">${result.decision}</span></header>
  <section class="candidate"><div><span>候选提交</span><strong>${escapeHtml(manifest.candidate.commit)}</strong></div><div><span>分支</span><strong>${escapeHtml(manifest.candidate.branch)}</strong></div><div><span>生成时间</span><strong>${escapeHtml(manifest.generatedAt)}</strong></div><div><span>工作树</span><strong>${manifest.candidate.clean ? 'CLEAN' : `DIRTY · ${manifest.candidate.dirtyScope.length} 项`}</strong></div></section>
  <nav><a href="#overview">总览</a>${tabs}<a href="#closure">发布收口</a></nav>
  <section id="overview" class="panel"><p class="kicker">七层证据总览</p><h2>分层活页审查册</h2><div class="summary">${RELEASE_STATUSES.map(status => `<div><b>${counts[status]}</b><span>${status}</span></div>`).join('')}</div><p>审查包只读取机器清单；缺失、错配、旧候选、fixture、mock 或跳过证据均不能转为通过。</p></section>
  ${layers}
  <section id="closure" class="panel"><p class="kicker">异常优先</p><h2>阻断项收口台</h2><div class="closure-grid"><div class="blockers">${blockerRows}</div><aside><span>状态汇总</span><strong>${result.blockers.length} 个未闭合项</strong><span>回滚修订</span><code>${escapeHtml(manifest.candidate.rollback.revision)}</code><span>已验证</span><strong>${manifest.candidate.rollback.verified ? '是' : '否'}</strong><button disabled>${result.decision === 'RELEASE' ? '已满足放行条件' : '发布保持禁用'}</button></aside></div></section>
</main></body></html>`;
}

function validateLayer(layer, candidateCommit, errors) {
  if (!layer || typeof layer !== 'object') {
    errors.push('layer must be an object');
    return;
  }
  if (!RELEASE_LAYER_IDS.includes(layer.id))
    errors.push(`unknown layer ${layer.id || '(missing)'}`);
  if (!RELEASE_STATUSES.includes(layer.status)) errors.push(`layer ${layer.id} has invalid status`);
  if (layer.candidateCommit !== candidateCommit)
    errors.push(`layer ${layer.id} candidate commit mismatch`);
  if (layer.fixture === true || layer.mock === true)
    errors.push(`layer ${layer.id} cannot use fixture or mock evidence`);

  if (layer.status === 'PASS') {
    if (!layer.command) errors.push(`layer ${layer.id} command is required for PASS`);
    if (!isTimestamp(layer.startedAt) || !isTimestamp(layer.finishedAt)) {
      errors.push(`layer ${layer.id} timestamps are required for PASS`);
    }
    const artifactPath = layer.artifact?.path || '';
    if (!isSafeRelativePath(artifactPath))
      errors.push(`layer ${layer.id} needs a safe relative artifact path`);
    if (!SHA256_PATTERN.test(layer.artifact?.sha256 || '')) {
      errors.push(`layer ${layer.id} artifact SHA-256 is required for PASS`);
    }
    if (['human-review', 'release-authorization'].includes(layer.id) && !layer.actor) {
      errors.push(`layer ${layer.id} requires a named actor for PASS`);
    }
  } else if (RELEASE_STATUSES.includes(layer.status)) {
    for (const field of [
      'reason',
      'owner',
      'requiredAction',
      'rollbackPoint',
      'closureCondition'
    ]) {
      if (!layer[field]) errors.push(`layer ${layer.id} ${field} is required when unresolved`);
    }
  }
}

function candidateBlocker(reason, candidate) {
  return {
    id: 'candidate',
    label: '候选冻结',
    status: 'BLOCKED',
    reason,
    owner: 'release engineer',
    requiredAction: '形成已审查、干净且冻结的 2D 候选提交',
    rollbackPoint: candidate.rollback?.revision || '未记录',
    closureCondition: '候选 clean=true、frozen=true 且回滚修订已验证'
  };
}

function renderLayer(layer) {
  return `<section id="${escapeHtml(layer.id)}" class="panel layer"><div class="panel-head"><div><p class="kicker">${escapeHtml(layer.id)}</p><h2>${escapeHtml(LAYER_LABELS[layer.id])}</h2></div><span class="status ${layer.status.toLowerCase()}">${layer.status}</span></div><dl><dt>绑定提交</dt><dd><code>${escapeHtml(layer.candidateCommit)}</code></dd><dt>命令</dt><dd>${escapeHtml(layer.command || '未运行')}</dd><dt>制品</dt><dd>${escapeHtml(layer.artifact?.path || '未生成')}</dd><dt>SHA-256</dt><dd><code>${escapeHtml(layer.artifact?.sha256 || '未生成')}</code></dd><dt>说明</dt><dd>${escapeHtml(layer.reason || '证据已通过合同校验')}</dd></dl></section>`;
}

function renderBlocker(blocker, open) {
  return `<details${open ? ' open' : ''}><summary><span>${escapeHtml(blocker.label)}</span><b>${escapeHtml(blocker.status)}</b></summary><dl><dt>原因</dt><dd>${escapeHtml(blocker.reason)}</dd><dt>责任角色</dt><dd>${escapeHtml(blocker.owner)}</dd><dt>所需证据 / 动作</dt><dd>${escapeHtml(blocker.requiredAction)}</dd><dt>回退点</dt><dd><code>${escapeHtml(blocker.rollbackPoint)}</code></dd><dt>关闭条件</dt><dd>${escapeHtml(blocker.closureCondition)}</dd></dl></details>`;
}

function isSafeRelativePath(value) {
  if (!value || isAbsolute(value) || /^[a-z]:/i.test(value)) return false;
  const normalized = posix.normalize(value.replaceAll('\\', '/'));
  return normalized !== '..' && !normalized.startsWith('../') && !normalized.startsWith('/');
}

function isTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function findSecretFields(value, path, errors) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (SECRET_FIELD.test(key)) errors.push(`secret field is forbidden: ${childPath}`);
    findSecretFields(child, childPath, errors);
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

const REVIEW_CSS = `
.closure-grid > * { min-width: 0; }
#closure code { overflow-wrap: anywhere; }
:root{color:#342d29;background:#efe7da;font-family:Inter,"Noto Sans SC",system-ui,sans-serif}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:linear-gradient(120deg,#efe7da,#f8f2e8)}.shell{width:min(1180px,calc(100% - 32px));margin:24px auto 80px}header{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #4a413a;padding:20px 4px}.eyebrow,.kicker{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#84766d;margin:0 0 8px}h1,h2{font-family:Georgia,"Noto Serif SC",serif;margin:0}h1{font-size:38px}.decision,.status{display:inline-flex;padding:8px 14px;border-radius:99px;font:700 13px/1 monospace;border:1px solid currentColor}.hold,.fail,.blocked{color:#a44937;background:#f8e0d8}.release,.pass{color:#356c57;background:#dcecdf}.not_run{color:#7c6f64;background:#ece5db}.candidate{display:grid;grid-template-columns:2fr 1.4fr 1.4fr .8fr;gap:12px;margin:18px 0}.candidate div,.panel{background:#fffaf1;border:1px solid #d4c6b7;box-shadow:0 10px 24px #7b604318}.candidate div{padding:16px}.candidate span,.candidate strong{display:block}.candidate span{font-size:12px;color:#8a7a6c;margin-bottom:7px}.candidate strong{font-size:13px;overflow-wrap:anywhere}nav{position:sticky;top:0;z-index:2;display:flex;gap:6px;overflow:auto;padding:10px;background:#efe7daee;border-block:1px solid #d5c5b4}nav a{white-space:nowrap;color:#584b43;text-decoration:none;padding:9px 12px;border-radius:6px}nav a:hover{background:#dfe8dd;color:#315c4d}.panel{margin:18px 0;padding:28px;border-radius:8px;scroll-margin-top:70px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0}.summary div{padding:18px;background:#f2ebdf;border-left:4px solid #a95a46}.summary b,.summary span{display:block}.summary b{font:700 30px Georgia}.summary span{font-size:12px;color:#776b62}.panel-head{display:flex;justify-content:space-between;align-items:start}.layer dl,details dl,#closure aside{display:grid;grid-template-columns:150px 1fr;gap:10px 18px;margin:24px 0 0;padding-top:18px;border-top:1px solid #ded2c5}dt{color:#85776d;font-size:13px}dd{margin:0;overflow-wrap:anywhere}code{font-family:"SFMono-Regular",Consolas,monospace;font-size:12px}.closure-grid{display:grid;grid-template-columns:minmax(0,2.3fr) minmax(250px,1fr);gap:16px;align-items:start}.blockers{display:grid;gap:10px;margin-top:22px}details{border:1px solid #d5c5b4;background:#f8f1e6;padding:14px}summary{cursor:pointer;display:flex;justify-content:space-between;font-weight:700}summary b{color:#a44937;font-size:12px}#closure aside{background:#f2ebdf;padding:18px;border:1px solid #d5c5b4;grid-template-columns:1fr;margin-top:22px}button{width:100%;padding:14px;border:0;border-radius:6px;background:#c9bfb3;color:#766c65;font-weight:700}@media(max-width:760px){.candidate{grid-template-columns:1fr 1fr}.summary{grid-template-columns:1fr 1fr}.closure-grid{grid-template-columns:1fr}.layer dl,details dl,#closure aside{grid-template-columns:1fr}.shell{width:min(100% - 18px,1180px)}h1{font-size:30px}.panel{padding:20px}}
`;
