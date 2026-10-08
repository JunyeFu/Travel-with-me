// server/index.js
// 极简 BFF：托管前端静态文件 + 代理高德 Web 服务接口
//
// 它只做两件事：
//   1) 托管 index.html，以及由 2D 入口清单批准的 CSS / JS
//   2) /_AMapService/* → https://restapi.amap.com/* 透明转发，
//      并在转发时注入服务端持有的 jscode（安全密钥）
//
// 设计要点：
//   - 浏览器永远看不到 jscode：前端只发请求到同源 /_AMapService
//   - jscode 只来自环境变量，不进 git，不进打包产物
//   - 上游响应原样回放，仅去掉 content-encoding/length（fetch 已自动解压）

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { basicAuth } from 'hono/basic-auth';
import { secureHeaders } from 'hono/secure-headers';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import {
  assertExplicit2DRuntimeManifest,
  build2DRuntimeManifest,
  projectPathFromRequestURL
} from '../scripts/active-2d-runtime.mjs';
import { initDB } from './rag/db.js';
import { saveGuide, listGuides, softDeleteGuide, getActiveGuideCount } from './rag/store.js';
import { BM25Index } from './rag/bm25.js';
import { retrieveGuides, formatRetrievedContext } from './rag/retrieve.js';
import { tokenize } from './rag/tokenizer.js';

// 本地加载 .env：Zeabur 等部署环境本身就会注入 process.env，找不到 .env 时静默跳过。
loadDotenv();

const JSCODE = process.env.AMAP_JSCODE;
const AMAP_JS_KEY = process.env.AMAP_JS_KEY;
const AMAP_WEB_SERVICE_KEY = process.env.AMAP_WEB_SERVICE_KEY;
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const PORT = Number(process.env.PORT) || 8080;
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_2D_MANIFEST = await build2DRuntimeManifest(PROJECT_ROOT);
assertExplicit2DRuntimeManifest(RUNTIME_2D_MANIFEST);
const ACTIVE_2D_JAVASCRIPT_PATHS = RUNTIME_2D_MANIFEST.activeJavaScriptPaths;
const ACTIVE_2D_STYLESHEET_PATHS = new Set(RUNTIME_2D_MANIFEST.htmlStylesheets);
const UPSTREAM = 'https://restapi.amap.com';
const PROXY_PREFIX = '/_AMapService';
const AMAP_ALLOWED_PATHS = new Set([
  '/v3/place/text',
  '/v3/place/around',
  '/v3/geocode/geo',
  '/v3/geocode/regeo',
  '/v3/direction/driving',
  '/v3/direction/walking',
  '/v3/direction/transit/integrated',
  '/v4/direction/bicycling'
]);
const TILE_PREFIX = '/_AMapTile';
const AI_PREFIX = '/_ai';
const RAG_PREFIX = '/_rag';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DEEPSEEK_JSON_ATTEMPTS = 2;
const DEEPSEEK_TIMEOUT_MS = readPositiveInt(process.env.DEEPSEEK_TIMEOUT_MS, 90000);
const GUIDE_PROMPT_TEMPLATE = loadGuidePromptTemplate();
const ALLOWED_ORIGINS = parseOriginList(process.env.ALLOWED_ORIGINS);
const MAX_AI_BODY_BYTES = readPositiveInt(process.env.MAX_AI_BODY_BYTES, 24000);
const AI_RATE_LIMIT = readPositiveInt(process.env.AI_RATE_LIMIT, 10);
const AI_RATE_WINDOW_MS = readPositiveInt(process.env.AI_RATE_WINDOW_MS, 60 * 60 * 1000);
const AMAP_RATE_LIMIT = readPositiveInt(process.env.AMAP_RATE_LIMIT, 600);
const AMAP_RATE_WINDOW_MS = readPositiveInt(process.env.AMAP_RATE_WINDOW_MS, 60 * 1000);
const TILE_RATE_LIMIT = readPositiveInt(process.env.TILE_RATE_LIMIT, 1200);
const TILE_RATE_WINDOW_MS = readPositiveInt(process.env.TILE_RATE_WINDOW_MS, 60 * 1000);
const RAG_ENABLED = process.env.RAG_ENABLED !== 'false';
const RAG_SAVE_IMPORTED_GUIDES = process.env.RAG_SAVE_IMPORTED_GUIDES !== 'false';
const DEMO_MODE = process.env.DEMO_MODE === 'true';
const DEMO_USERNAME = process.env.DEMO_USERNAME;
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;
if (DEMO_MODE && (!DEMO_USERNAME || !DEMO_PASSWORD)) {
  throw new Error('DEMO_MODE requires DEMO_USERNAME and DEMO_PASSWORD.');
}
if (DEMO_MODE && RAG_ENABLED) {
  throw new Error('Public demo requires RAG_ENABLED=false (visitor guides must not be stored).');
}
const RAG_DB_PATH = process.env.RAG_DB_PATH || resolve(PROJECT_ROOT, 'data', 'rag.db');
const RAG_TOP_K = readPositiveInt(process.env.RAG_TOP_K, 3);
const RAG_MAX_CONTEXT_CHARS = readPositiveInt(process.env.RAG_MAX_CONTEXT_CHARS, 1500);
const RAG_MIN_DOCS = readPositiveInt(process.env.RAG_MIN_DOCS, 3);
const RAG_SEARCH_RATE_LIMIT = readPositiveInt(process.env.RAG_SEARCH_RATE_LIMIT, 20);
const RAG_SEARCH_RATE_WINDOW_MS = 60 * 60 * 1000;
const rateBuckets = new Map();

if (!JSCODE) {
  console.warn(
    '[trip-app] AMAP_JSCODE 未设置：高德 Web 服务请求会被拒绝。请检查 .env 或部署环境变量。'
  );
}
if (!AMAP_JS_KEY) {
  console.warn('[trip-app] AMAP_JS_KEY 未设置：高德 JS SDK 将不可用，前端会启用本地 2D 兜底。');
}
if (!AMAP_WEB_SERVICE_KEY) {
  console.warn('[trip-app] AMAP_WEB_SERVICE_KEY 未设置：地点搜索、地理编码和路线规划将不可用。');
}
if (!DEEPSEEK_KEY) {
  console.warn('[trip-app] DEEPSEEK_API_KEY 未设置：AI 攻略导入功能将不可用。');
}

let bm25Index = null;
if (RAG_ENABLED) {
  initDB(RAG_DB_PATH);
  bm25Index = new BM25Index();
  bm25Index.rebuildFromDB();
}

function isRagReady() {
  return bm25Index !== null && bm25Index.docCount >= RAG_MIN_DOCS;
}

export function rebuildRagIndex() {
  bm25Index?.rebuildFromDB();
}

const app = new Hono();

app.get('/healthz', c =>
  c.json({
    status: 'ok',
    service: 'travel-with-me',
    timestamp: new Date().toISOString()
  })
);

app.get('/readyz', c => {
  const aiReady = Boolean(DEEPSEEK_KEY && GUIDE_PROMPT_TEMPLATE);
  const ready = Boolean(AMAP_JS_KEY && AMAP_WEB_SERVICE_KEY && JSCODE && (!DEMO_MODE || aiReady));
  return c.json(
    {
      status: ready ? 'ready' : 'degraded',
      dependencies: {
        amapJsSecurity: Boolean(JSCODE),
        amapJsKey: Boolean(AMAP_JS_KEY),
        amapWebService: Boolean(AMAP_WEB_SERVICE_KEY),
        aiGuideImport: aiReady,
        rag: Boolean(bm25Index)
      }
    },
    ready ? 200 : 503
  );
});

if (DEMO_MODE) {
  // Health endpoints above are deliberately public. Everything registered below is protected.
  app.use('*', basicAuth({ username: DEMO_USERNAME, password: DEMO_PASSWORD }));
}

app.get('/_config', c =>
  c.json({
    amapJsKey: AMAP_JS_KEY || ''
  })
);

app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-eval'", // 高德 JS SDK 内部使用动态函数构造，缺失时地图插件无法初始化。
        "'unsafe-inline'", // 高德 JS SDK 内部会触发 javascript: URL/内联回调；缺失时部分浏览器白屏。
        'https://cdn.jsdelivr.net',
        'https://webapi.amap.com',
        'https://mapplugin.amap.com',
        'https://jsapi.amap.com'
      ],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      connectSrc: [
        "'self'",
        'https://webapi.amap.com',
        'https://restapi.amap.com',
        'https://jsapi.amap.com',
        'https://jsapi-data1.amap.com',
        'https://jsapi-data2.amap.com',
        'https://jsapi-data3.amap.com',
        'https://jsapi-data4.amap.com',
        'https://jsapi-data5.amap.com',
        'https://o4.amap.com',
        'https://vdata.amap.com',
        'https://wprd0.is.autonavi.com',
        'https://wprd01.is.autonavi.com',
        'https://wprd02.is.autonavi.com',
        'https://wprd03.is.autonavi.com',
        'https://wprd04.is.autonavi.com',
        'https://api.deepseek.com'
      ],
      workerSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    },
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    referrerPolicy: 'strict-origin-when-cross-origin',
    strictTransportSecurity: false,
    permissionsPolicy: {
      geolocation: ['self'],
      camera: [],
      microphone: [],
      payment: []
    }
  })
);

// ─── AI 攻略导入 ────────────────────────────────────────

app.get(`${AI_PREFIX}/status`, c => {
  return c.json({
    available: Boolean(DEEPSEEK_KEY && GUIDE_PROMPT_TEMPLATE),
    reason: !DEEPSEEK_KEY
      ? 'DEEPSEEK_API_KEY_MISSING'
      : !GUIDE_PROMPT_TEMPLATE
        ? 'GUIDE_PROMPT_MISSING'
        : ''
  });
});

app.use(
  `${AI_PREFIX}/extract-guide`,
  bodyLimit({
    maxSize: MAX_AI_BODY_BYTES,
    onError: c =>
      c.json({ error: 'REQUEST_TOO_LARGE', message: '请求体过大，请缩短攻略文本后重试。' }, 413)
  })
);

app.post(`${AI_PREFIX}/extract-guide`, async c => {
  const sourceRejected = rejectUntrustedSource(c);
  if (sourceRejected) return sourceRejected;
  if (DEMO_MODE) {
    const globalLimited = enforceRateLimit(c, 'ai-demo-global', 12, 60 * 60 * 1000, true, 'global');
    if (globalLimited) return globalLimited;
  }
  const limited = enforceRateLimit(c, 'ai', AI_RATE_LIMIT, AI_RATE_WINDOW_MS);
  if (limited) return limited;
  const tooLargeByHeader = rejectLargeBodyByHeader(c, MAX_AI_BODY_BYTES);
  if (tooLargeByHeader) return tooLargeByHeader;

  if (!DEEPSEEK_KEY) {
    return c.json(
      { error: 'AI_UNAVAILABLE', message: 'AI 攻略导入功能暂不可用：缺少 DEEPSEEK_API_KEY。' },
      503
    );
  }
  if (!GUIDE_PROMPT_TEMPLATE) {
    return c.json(
      { error: 'AI_PROMPT_MISSING', message: '攻略解析 Prompt 未找到，请检查服务端 Prompt 文件。' },
      500
    );
  }

  let payload;
  let rawBody;
  try {
    rawBody = await c.req.text();
  } catch {
    return c.json({ error: 'BAD_REQUEST', message: '请求体读取失败。' }, 400);
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_AI_BODY_BYTES) {
    return c.json(
      { error: 'REQUEST_TOO_LARGE', message: '请求体过大，请缩短攻略文本后重试。' },
      413
    );
  }
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'BAD_REQUEST', message: '请求格式错误。' }, 400);
  }

  const text = String(payload?.text || '').trim();
  const cityHint = String(payload?.cityHint || '').trim();
  if (text.length < 50)
    return c.json({ error: 'TEXT_TOO_SHORT', message: '文字太短，请粘贴完整攻略段落。' }, 400);
  if (text.length > 5000)
    return c.json({ error: 'TEXT_TOO_LONG', message: '文字过长，请分段处理。' }, 400);

  try {
    const retrievedContextSection = isRagReady()
      ? formatRetrievedContext(
          retrieveGuides(bm25Index, text, {
            topK: RAG_TOP_K,
            maxSnippetLength: Math.floor(RAG_MAX_CONTEXT_CHARS / RAG_TOP_K)
          })
        )
      : '';
    let lastDebug = null;
    for (let attempt = 1; attempt <= DEEPSEEK_JSON_ATTEMPTS; attempt += 1) {
      const upstreamResp = await fetchDeepSeekWithTimeout({
        text,
        cityHint,
        signalTimeoutMs: DEEPSEEK_TIMEOUT_MS,
        retrievedContextSection
      });

      const data = await upstreamResp.json().catch(() => null);
      if (!upstreamResp.ok) {
        console.error('[trip-app] DeepSeek 请求失败：', data || upstreamResp.statusText);
        return c.json({ error: 'AI_UPSTREAM_FAILED', message: 'AI 暂时不可用，请稍后重试。' }, 502);
      }

      const choice = data?.choices?.[0];
      const content = choice?.message?.content || '';
      const parsed = parseGuideJSON(content);
      if (parsed) {
        const normalized = normalizeExtractedGuide(parsed);
        if (bm25Index && RAG_SAVE_IMPORTED_GUIDES) {
          const tokens = tokenize(text);
          const guideId = saveGuide({
            city: normalized.city || cityHint || null,
            guide_type: normalized.guide_type || null,
            source_text: text,
            extracted: JSON.stringify(normalized),
            token_count: tokens.length
          });
          bm25Index.addDocument(guideId, tokens);
        }
        return c.json(normalized);
      }

      const debug = {
        attempt,
        model: data?.model || DEEPSEEK_MODEL,
        finishReason: choice?.finish_reason || '',
        contentLength: String(content || '').length,
        preview: previewText(content)
      };
      lastDebug = debug;
      console.warn('[trip-app] AI 输出 JSON 解析失败：', debug);
      if (attempt < DEEPSEEK_JSON_ATTEMPTS) {
        await sleep(500);
        continue;
      }
    }

    return c.json(
      {
        error: 'AI_PARSE_FAILED',
        message: buildParseFailMessage(lastDebug || {}),
        debug: lastDebug
      },
      502
    );
  } catch (err) {
    if (err?.name === 'AbortError') {
      console.warn('[trip-app] DeepSeek 请求超时：', {
        model: DEEPSEEK_MODEL,
        timeoutMs: DEEPSEEK_TIMEOUT_MS,
        textLength: text.length
      });
      return c.json(
        {
          error: 'AI_TIMEOUT',
          message: `AI 处理超过 ${Math.round(DEEPSEEK_TIMEOUT_MS / 1000)} 秒，请稍后重试或缩短攻略文本。`
        },
        504
      );
    }
    console.error('[trip-app] AI 攻略导入失败：', err);
    return c.json({ error: 'AI_FAILED', message: 'AI 暂时不可用，请稍后重试。' }, 502);
  }
});

app.get(`${RAG_PREFIX}/status`, c => {
  if (!bm25Index) {
    return c.json({ available: false, reason: 'rag_disabled', documentCount: 0 });
  }
  return c.json({
    available: true,
    ready: isRagReady(),
    documentCount: bm25Index.stats.docCount,
    avgDocLength: bm25Index.stats.avgDocLength,
    indexBuiltAt: bm25Index.stats.indexBuiltAt,
    minDocs: RAG_MIN_DOCS
  });
});

app.post(`${RAG_PREFIX}/search`, async c => {
  const sourceRejected = rejectUntrustedSource(c);
  if (sourceRejected) return sourceRejected;
  const limited = enforceRateLimit(
    c,
    'rag-search',
    RAG_SEARCH_RATE_LIMIT,
    RAG_SEARCH_RATE_WINDOW_MS
  );
  if (limited) return limited;
  if (!bm25Index) {
    return c.json({ error: 'RAG_UNAVAILABLE', message: 'RAG 检索功能未启用。' }, 503);
  }

  let payload;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: 'BAD_REQUEST', message: '请求格式错误。' }, 400);
  }
  const query = String(payload?.query || '').trim();
  const topK = Math.min(Math.max(Number(payload?.top_k) || RAG_TOP_K, 1), 20);
  if (query.length < 2) {
    return c.json({ error: 'QUERY_TOO_SHORT', message: '查询文本过短。' }, 400);
  }
  const results = retrieveGuides(bm25Index, query, {
    topK,
    maxSnippetLength: Math.floor(RAG_MAX_CONTEXT_CHARS / topK)
  });
  return c.json({ results, count: results.length });
});

app.get(`${RAG_PREFIX}/guides`, c => {
  if (!bm25Index) return c.json({ guides: [], total: 0 });
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 50, 1), 200);
  const offset = Math.max(Number(c.req.query('offset')) || 0, 0);
  return c.json({ guides: listGuides({ limit, offset }), total: getActiveGuideCount() });
});

app.delete(`${RAG_PREFIX}/guides/:id`, c => {
  const sourceRejected = rejectUntrustedSource(c);
  if (sourceRejected) return sourceRejected;
  if (!bm25Index) return c.json({ error: 'RAG_UNAVAILABLE', message: 'RAG 检索功能未启用。' }, 503);
  const id = c.req.param('id');
  if (!softDeleteGuide(id)) {
    return c.json({ error: 'NOT_FOUND', message: '文档不存在。' }, 404);
  }
  bm25Index?.rebuildFromDB();
  return c.json({ deleted: id });
});

// ─── 高德 Web 服务代理 ────────────────────────────────────
// 高德 JS SDK 在前端设置 _AMapSecurityConfig.serviceHost 后，
// 所有 Web 服务请求都会以 ${serviceHost}/v3/... 形式打到这里。
// AMap SDK also emits a JSONP telemetry request through serviceHost during startup.
// Consume it locally so telemetry cannot bypass the BFF boundary or create an unhandled SDK rejection.
app.get(`${PROXY_PREFIX}/v3/log/init`, c => {
  const callback = String(c.req.query('callback') || '');
  const validCallback = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(callback);
  const payload = JSON.stringify({ status: '1' });
  return new Response(validCallback ? `${callback}(${payload});` : payload, {
    headers: {
      'cache-control': 'no-store',
      'content-type': validCallback ? 'application/javascript; charset=utf-8' : 'application/json'
    }
  });
});

app.all(`${PROXY_PREFIX}/*`, async c => {
  const sourceRejected = rejectUntrustedSource(c);
  if (sourceRejected) return sourceRejected;
  const limited = enforceRateLimit(c, 'amap', AMAP_RATE_LIMIT, AMAP_RATE_WINDOW_MS);
  if (limited) return limited;

  const incoming = new URL(c.req.url);
  const upstreamPath = incoming.pathname.slice(PROXY_PREFIX.length);
  if (!AMAP_ALLOWED_PATHS.has(upstreamPath)) {
    return c.json(
      {
        status: '0',
        info: 'BFF_PATH_NOT_ALLOWED',
        infocode: '40003',
        message: '该高德服务端点未被当前应用授权。'
      },
      400
    );
  }
  const upstream = new URL(UPSTREAM + upstreamPath);
  upstream.search = incoming.search;
  if (!AMAP_WEB_SERVICE_KEY) {
    return c.json(
      {
        status: '0',
        info: 'BFF_KEY_MISSING',
        infocode: '50002',
        message: '高德 Web 服务 Key 未配置。'
      },
      503
    );
  }
  // Browser JS keys never cross the server boundary. Web-service APIs use their own key type.
  upstream.searchParams.set('key', AMAP_WEB_SERVICE_KEY);
  upstream.searchParams.delete('jscode');

  const init = {
    method: c.req.method,
    headers: {
      'user-agent': c.req.header('user-agent') || 'trip-app-bff',
      accept: c.req.header('accept') || '*/*'
    }
  };
  // 高德通过 Referer 头校验域名白名单（appname 参数不算数）。
  // 不透传 Referer 时所有 Web 服务请求会被 AMap 拒绝（INVALID_USER_DOMAIN / 10006）。
  const referer = c.req.header('referer');
  if (referer) init.headers['referer'] = referer;
  const origin = c.req.header('origin');
  if (origin) init.headers['origin'] = origin;

  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    init.body = await c.req.arrayBuffer();
    const ct = c.req.header('content-type');
    if (ct) init.headers['content-type'] = ct;
  }

  let upstreamResp;
  try {
    upstreamResp = await fetchWithRetry(upstream, init, {
      attempts: 2,
      label: '高德 Web 服务'
    });
  } catch (err) {
    console.error('[trip-app] 上游请求失败：', err);
    return c.json(
      {
        status: '0',
        info: 'BFF_UPSTREAM_FAILED',
        infocode: '50001',
        message: '高德服务连接超时或网络不可用，请稍后重试。'
      },
      502
    );
  }

  const body = await upstreamResp.arrayBuffer();
  const headers = new Headers();
  upstreamResp.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === 'content-encoding' || k === 'content-length' || k === 'transfer-encoding') return;
    headers.set(key, value);
  });
  return new Response(body, { status: upstreamResp.status, headers });
});

// ─── 高德底图瓦片代理 ────────────────────────────────────
// 分享长图需要把地图瓦片画进 canvas；浏览器直接加载跨域瓦片会污染 canvas。
app.get(TILE_PREFIX, async c => {
  const sourceRejected = rejectUntrustedSource(c, false);
  if (sourceRejected) return sourceRejected;
  const limited = enforceRateLimit(c, 'tile', TILE_RATE_LIMIT, TILE_RATE_WINDOW_MS, false);
  if (limited) return limited;

  const x = Number(c.req.query('x'));
  const y = Number(c.req.query('y'));
  const z = Number(c.req.query('z'));
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) {
    return c.text('Bad tile params', 400);
  }
  if (!isValidTileCoord(x, y, z)) {
    return c.text('Tile params out of range', 400);
  }

  const host = `https://webrd0${(Math.abs(x + y) % 4) + 1}.is.autonavi.com`;
  const upstream = new URL('/appmaptile', host);
  upstream.searchParams.set('lang', 'zh_cn');
  upstream.searchParams.set('size', '1');
  upstream.searchParams.set('scale', '1');
  upstream.searchParams.set('style', '8');
  upstream.searchParams.set('x', String(x));
  upstream.searchParams.set('y', String(y));
  upstream.searchParams.set('z', String(z));

  let upstreamResp;
  try {
    upstreamResp = await fetch(upstream, {
      headers: {
        'user-agent': c.req.header('user-agent') || 'trip-app-bff',
        accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });
  } catch (err) {
    console.error('[trip-app] 瓦片请求失败：', err);
    return c.text('Tile upstream failed', 502);
  }

  const body = await upstreamResp.arrayBuffer();
  const headers = new Headers();
  upstreamResp.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === 'content-encoding' || k === 'content-length' || k === 'transfer-encoding') return;
    headers.set(key, value);
  });
  headers.set('cache-control', 'public, max-age=86400');
  return new Response(body, { status: upstreamResp.status, headers });
});

// ─── 静态文件托管 ─────────────────────────────────────────
// 只暴露 2D HTML 入口解析得到、且显式清单批准的运行时文件。
app.get('/', serveStatic({ path: './index.html' }));
app.get('/index.html', serveStatic({ path: './index.html' }));
const serveActive2DStylesheet = serveStatic({ root: './' });
app.use('/css/*', (c, next) => {
  const projectPath = projectPathFromRequestURL(c.req.url, 'css');
  if (!ACTIVE_2D_STYLESHEET_PATHS.has(projectPath)) return c.notFound();
  return serveActive2DStylesheet(c, next);
});
const serveActive2DJavaScript = serveStatic({ root: './' });
app.use('/js/*', (c, next) => {
  const projectPath = projectPathFromRequestURL(c.req.url);
  if (!ACTIVE_2D_JAVASCRIPT_PATHS.has(projectPath)) return c.notFound();
  return serveActive2DJavaScript(c, next);
});
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMainModule) {
  serve({ fetch: app.fetch, port: PORT }, info => {
    console.log(`[trip-app] 已启动：http://localhost:${info.port}`);
  });
}

export { app };

function loadDotenv() {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(here, '..', '.env');
  let content;
  try {
    content = readFileSync(envPath, 'utf8');
  } catch {
    return; // 没有 .env，按部署环境的 process.env 走
  }
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function loadGuidePromptTemplate() {
  const here = dirname(fileURLToPath(import.meta.url));
  const promptPath = resolve(here, 'prompts', 'guide-extract.md');
  try {
    return readFileSync(promptPath, 'utf8').trim();
  } catch {
    console.warn('[trip-app] 未找到 AI 攻略导入 Prompt，无法加载攻略解析功能。');
    return '';
  }
}

function renderGuidePrompt(template, text, cityHint, retrievedContextSection = '') {
  const city = cityHint || '由你识别';
  return template
    .replace('{retrieved_context_section}', retrievedContextSection)
    .replace('{user_specified_city 或 "由你识别"}', city)
    .replace('{user_text}', text);
}

async function fetchDeepSeekWithTimeout({
  text,
  cityHint,
  signalTimeoutMs,
  retrievedContextSection = ''
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), signalTimeoutMs);
  try {
    return await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${DEEPSEEK_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        temperature: 0.2,
        max_tokens: 4096,
        messages: [
          {
            role: 'system',
            content:
              '你必须只输出一个可被 JSON.parse 解析的 json object，不要输出 markdown、代码块、解释文字或前后缀。'
          },
          {
            role: 'user',
            content: renderGuidePrompt(
              GUIDE_PROMPT_TEMPLATE,
              text,
              cityHint,
              retrievedContextSection
            )
          }
        ]
      })
    });
  } finally {
    clearTimeout(timer);
  }
}

function readPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function parseOriginList(value = '') {
  return new Set(
    String(value)
      .split(/[,\s]+/)
      .map(item => item.trim())
      .filter(Boolean)
      .map(item => {
        try {
          return new URL(item).origin;
        } catch {
          return '';
        }
      })
      .filter(Boolean)
  );
}

function rejectUntrustedSource(c, asJson = true) {
  const requestOrigin = new URL(c.req.url).origin;
  const origins = getExplicitRequestOrigins(c);
  if (!origins.length) return null;

  const allowed = origins.every(origin => origin === requestOrigin || ALLOWED_ORIGINS.has(origin));
  if (allowed) return null;

  console.warn('[trip-app] 拒绝非允许来源请求：', {
    path: new URL(c.req.url).pathname,
    client: getClientIP(c),
    origins
  });
  return asJson
    ? c.json({ error: 'FORBIDDEN_SOURCE', message: '请求来源不被允许。' }, 403)
    : c.text('Forbidden source', 403);
}

function getExplicitRequestOrigins(c) {
  const origins = [];
  const origin = normalizeOrigin(c.req.header('origin'));
  if (origin) origins.push(origin);
  const referer = normalizeOrigin(c.req.header('referer'));
  if (referer && referer !== origin) origins.push(referer);
  return origins;
}

function normalizeOrigin(value) {
  if (!value) return '';
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function rejectLargeBodyByHeader(c, maxBytes) {
  const rawLength = c.req.header('content-length');
  if (!rawLength) return null;
  const byteLength = Number(rawLength);
  if (!Number.isFinite(byteLength) || byteLength <= maxBytes) return null;
  return c.json({ error: 'REQUEST_TOO_LARGE', message: '请求体过大，请缩短攻略文本后重试。' }, 413);
}

function enforceRateLimit(c, name, limit, windowMs, asJson = true, client = getClientIP(c)) {
  const now = Date.now();
  if (rateBuckets.size > 10000) pruneRateBuckets(now);

  const key = `${name}:${client}`;
  const existing = rateBuckets.get(key);
  const bucket =
    existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  rateBuckets.set(key, bucket);

  if (bucket.count <= limit) return null;

  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  const response = asJson
    ? c.json({ error: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试。' }, 429)
    : c.text('Too many requests', 429);
  response.headers.set('retry-after', String(retryAfter));
  return response;
}

function pruneRateBuckets(now = Date.now()) {
  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) rateBuckets.delete(key);
  }
}

function getClientIP(c) {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || 'local';
}

function isValidTileCoord(x, y, z) {
  if (z < 3 || z > 18) return false;
  const max = 2 ** z;
  return x >= 0 && y >= 0 && x < max && y < max;
}

function parseGuideJSON(content) {
  const normalized = stripMarkdownFence(String(content || '').trim());
  try {
    return JSON.parse(normalized);
  } catch {
    // Continue with tolerant extraction and repair below.
  }

  const jsonLike = extractBalancedJSONObject(normalized);
  if (!jsonLike) return null;
  try {
    return JSON.parse(jsonLike);
  } catch {
    const repaired = repairCommonJSONIssues(jsonLike);
    try {
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
}

function stripMarkdownFence(text) {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function extractBalancedJSONObject(text) {
  const start = text.indexOf('{');
  if (start < 0) return '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return '';
}

function repairCommonJSONIssues(text) {
  return text.replace(/,\s*([}\]])/g, '$1').replace(/:\s*undefined\b/g, ': null');
}

function previewText(content) {
  return String(content || '')
    .replace(/\s+/g, ' ')
    .slice(0, 500);
}

function buildParseFailMessage(debug) {
  if (!debug.contentLength) return 'AI 没有返回内容，请稍后重试。';
  if (debug.finishReason && debug.finishReason !== 'stop') {
    return `AI 输出未完成（${debug.finishReason}），请缩短攻略后重试。`;
  }
  return `AI 输出不是合法 JSON。返回片段：${debug.preview || '无内容'}`;
}

function normalizeExtractedGuide(input = {}) {
  const guideTypes = new Set(['daily_itinerary', 'recommendation_list', 'mixed', 'non_travel']);
  const timeSlots = new Set(['morning', 'noon', 'afternoon', 'evening']);
  const guideType = guideTypes.has(input.guide_type) ? input.guide_type : 'non_travel';
  return {
    guide_type: guideType,
    city: input.city ? String(input.city).trim() : null,
    title_suggestion: String(input.title_suggestion || '').trim(),
    events: Array.isArray(input.events)
      ? input.events
          .map(event => ({
            place_name: String(event?.place_name || '').trim(),
            day: Number.isInteger(event?.day) && event.day > 0 ? event.day : null,
            time_slot: timeSlots.has(event?.time_slot) ? event.time_slot : null,
            note: String(event?.note || '')
              .trim()
              .slice(0, 120),
            source_quote: String(event?.source_quote || '')
              .trim()
              .slice(0, 80)
          }))
          .filter(event => event.place_name)
      : [],
    warnings: Array.isArray(input.warnings)
      ? input.warnings.map(item => String(item || '').trim()).filter(Boolean)
      : []
  };
}

async function fetchWithRetry(url, init = {}, options = {}) {
  const attempts = Math.max(1, Number(options.attempts) || 1);
  const label = options.label || '上游服务';
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastError = err;
      if (attempt >= attempts) break;
      console.warn(
        `[trip-app] ${label}请求失败，准备重试 ${attempt}/${attempts - 1}：`,
        summarizeFetchError(err)
      );
      await sleep(500 * attempt);
    }
  }
  throw lastError;
}

function summarizeFetchError(err) {
  return {
    name: err?.name || '',
    message: err?.message || '',
    code: err?.cause?.code || err?.code || ''
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
