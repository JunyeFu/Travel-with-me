# API Reference

> 当前 2D 接口参考 | 实现边界见 [ARCHITECTURE.md](../../ARCHITECTURE.md)。

Travel With Me 的 BFF 层提供以下端点：

公网演示设置 `DEMO_MODE=true` 后，除 `/healthz`、`/readyz` 外全部页面和接口需要 Basic Auth；必须设置 `DEMO_USERNAME`、`DEMO_PASSWORD` 并关闭 RAG。演示 `/readyz` 同时要求地图、AI 和口令完整。`/_ai/extract-guide` 额外限制全局每进程每小时 12 次，与客户端 IP 无关。部署环境与数据边界见 [公网演示](../operations/public-demo.md)。

> 2026-08-12：3D 已封存，`/_elevation` 与 `/_geo-assets` 已从活动服务移除并返回 404。下方同名章节只保留历史契约，不能作为当前 API 使用。

## 基础信息

| 项           | 值                                               |
| ------------ | ------------------------------------------------ |
| Base URL     | `http://localhost:8080` (本地) / 部署域名 (生产) |
| 协议         | HTTP/1.1                                         |
| Content-Type | `application/json`                               |

AI 导入、地图服务代理和瓦片代理会检查显式 `Origin` / `Referer`。默认允许同源请求；如需允许其他正式域名，使用 `ALLOWED_ORIGINS` 配置，多个域名用逗号或空格分隔。

BFF 会返回基础安全响应头，包括 `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy` 和最小权限策略。外部地图与字体仍按当前前端白名单/浏览器策略加载。

---

## `GET /healthz`

服务存活检查。

**成功响应 (200)**

```json
{
  "status": "ok",
  "service": "travel-with-me",
  "timestamp": "2026-06-21T00:00:00.000Z"
}
```

---

## `GET /readyz`

依赖就绪检查。缺少高德密钥时返回 `503` 和 `degraded`。

**响应**

```json
{
  "status": "ready",
  "dependencies": {
    "amapJsSecurity": true,
    "amapWebService": true,
    "aiGuideImport": true
  }
}
```

---

## `GET /_ai/status`

检查 AI 攻略导入功能是否可用。

**响应**

```json
{
  "available": true,
  "reason": ""
}
```

`reason` 可能值：

- `""` — 可用
- `"DEEPSEEK_API_KEY_MISSING"` — 未配置 API Key
- `"GUIDE_PROMPT_MISSING"` — Prompt 文件缺失

---

## `POST /_ai/extract-guide`

从中文攻略文本中提取结构化行程。

**请求**

```json
{
  "text": "北京3日深度游攻略...",
  "cityHint": "北京"
}
```

| 字段     | 类型   | 必填 | 约束                        |
| -------- | ------ | ---- | --------------------------- |
| text     | string | 是   | 50–5000 字符，需含中文      |
| cityHint | string | 否   | 辅助城市名，AI 亦可自动识别 |

**成功响应 (200)**

```json
{
  "guide_type": "daily_itinerary",
  "city": "北京",
  "title_suggestion": "北京3日深度游",
  "events": [
    {
      "place_name": "故宫",
      "day": 1,
      "time_slot": "morning",
      "note": "提前7天官网预约",
      "source_quote": "Day1必去故宫"
    }
  ],
  "warnings": []
}
```

**错误响应**

| HTTP | error                | 说明                           |
| ---- | -------------------- | ------------------------------ |
| 400  | `BAD_REQUEST`        | 请求 JSON 格式错误             |
| 400  | `TEXT_TOO_SHORT`     | 文本 < 50 字                   |
| 400  | `TEXT_TOO_LONG`      | 文本 > 5000 字                 |
| 403  | `FORBIDDEN_SOURCE`   | Origin / Referer 不在允许范围  |
| 413  | `REQUEST_TOO_LARGE`  | 请求体超过大小限制             |
| 429  | `RATE_LIMITED`       | 请求过于频繁                   |
| 502  | `AI_UPSTREAM_FAILED` | DeepSeek 返回错误              |
| 502  | `AI_PARSE_FAILED`    | JSON 解析失败（含 debug 信息） |
| 502  | `AI_FAILED`          | 其他未知错误                   |
| 503  | `AI_UNAVAILABLE`     | 未配置 DEEPSEEK_API_KEY        |
| 504  | `AI_TIMEOUT`         | 超时（默认 90s）               |

---

## `ALL /_AMapService/*`

高德 Web 服务透明代理。前端设置 `_AMapSecurityConfig.serviceHost` 后，所有高德 SDK 发起的 Web 服务请求都会通过此代理。

- **上游**: `https://restapi.amap.com`
- **注入**: 服务端自动附加 `key=$AMAP_WEB_SERVICE_KEY`，并移除浏览器传入的 `key` 与 `jscode`
- **透传**: Referer / Origin / User-Agent 头
- **重试**: 最多 2 次
- **防护**: 显式非允许来源返回 `403`，超出限流返回 `429`

---

## `GET /_AMapTile`

高德地图瓦片代理。解决 Canvas 跨域污染问题（供分享长图使用）。

**参数**

| 参数 | 类型   | 必填 | 说明                |
| ---- | ------ | ---- | ------------------- |
| x    | number | 是   | 瓦片 X 坐标         |
| y    | number | 是   | 瓦片 Y 坐标         |
| z    | number | 是   | 缩放级别，范围 3–18 |

**响应**

- Content-Type: `image/*`
- Cache-Control: `public, max-age=86400`
- 参数越界返回 `400`；显式非允许来源返回 `403`；超出限流返回 `429`。

---

## `GET /_elevation`（已移除，仅历史记录）

高程代理。当前用于 3D terrain fallback / sampling，不作为商业级 DEM tile 管线。单次最多 100 个坐标点。

**参数**

| 参数      | 类型   | 必填 | 说明                                 |
| --------- | ------ | ---- | ------------------------------------ |
| latitude  | string | 是   | 逗号分隔纬度列表                     |
| longitude | string | 是   | 逗号分隔经度列表，数量必须与纬度一致 |

**成功响应**

透传上游 Open-Meteo Elevation API JSON。缓存头为 `public, max-age=86400`。

**错误响应**

| HTTP | error                           | 说明                           |
| ---- | ------------------------------- | ------------------------------ |
| 400  | `INVALID_ELEVATION_COORDINATES` | 坐标为空、数量不匹配或超过 100 |
| 403  | `FORBIDDEN_SOURCE`              | Origin / Referer 不在允许范围  |
| 429  | `RATE_LIMITED`                  | 请求过于频繁                   |
| 502  | `ELEVATION_UPSTREAM_FAILED`     | 高程上游不可用                 |

---

## `GET /_geo-assets`（已移除，仅历史记录）

获取行程附近的小范围地理上下文资产。当前实现是 bounded Overpass/OSM prototype context layer，用于建筑、道路、水域、桥梁和植被上下文验证；它不是长期商业生产依赖。

**参数**

| 参数   | 类型   | 必填 | 说明                                                      |
| ------ | ------ | ---- | --------------------------------------------------------- |
| points | string | 是   | 分号分隔的 `lng,lat` 坐标列表，必须包含 1 至 8 个有效地点 |

**成功响应**

```json
{
  "geoAssets": {
    "buildings": [],
    "roads": [],
    "waterways": [],
    "bridges": [],
    "landcover": [],
    "landmarks": []
  },
  "attribution": "© OpenStreetMap contributors",
  "licence": "ODbL 1.0"
}
```

**错误响应**

| HTTP | error                        | 说明                             |
| ---- | ---------------------------- | -------------------------------- |
| 400  | `INVALID_GEO_ASSET_POINTS`   | 坐标为空、无效或超过 8 个 anchor |
| 403  | `FORBIDDEN_SOURCE`           | Origin / Referer 不在允许范围    |
| 429  | `RATE_LIMITED`               | 请求过于频繁或上游限流           |
| 502  | `GEO_ASSETS_UPSTREAM_FAILED` | 上游地理要素服务不可用           |

---

## `GET /_rag/status`

检查 RAG 检索功能是否可用。

**响应**

```json
{
  "available": true,
  "ready": false,
  "documentCount": 2,
  "avgDocLength": 45,
  "indexBuiltAt": "2026-07-16T09:00:00.000Z",
  "minDocs": 3
}
```

`ready` 为 `false` 表示文档数不足 `minDocs`，检索尚未启用（冷启动保护）。

---

## `POST /_rag/search`

BM25 稀疏检索相似攻略。Origin / Referer 检查 + 限流（默认 20 次/小时）。

**请求**

```json
{
  "query": "北京故宫三日游",
  "top_k": 3
}
```

**成功响应 (200)**

```json
{
  "results": [
    {
      "id": "guide-xxx",
      "score": 5.21,
      "city": "北京",
      "guideType": "daily_itinerary",
      "snippet": "北京三日游攻略，第一天故宫..."
    }
  ],
  "count": 1
}
```

---

## `GET /_rag/guides`

列出已存储的攻略文档。

**查询参数**

| 参数   | 类型   | 默认 | 说明     |
| ------ | ------ | ---- | -------- |
| limit  | number | 50   | 最多 200 |
| offset | number | 0    | -        |

**响应**

```json
{
  "guides": [
    {
      "id": "guide-xxx",
      "city": "北京",
      "guide_type": "daily_itinerary",
      "token_count": 30,
      "created_at": 1721100000000,
      "deleted": 0
    }
  ],
  "total": 1
}
```

---

## `DELETE /_rag/guides/:id`

软删除指定攻略文档（`deleted` 标记为 1，不从 BM25 索引物理移除，但检索结果会过滤）。

**响应**: `{ "deleted": "guide-xxx" }` 或 `404`

---

## 环境变量

| 变量                        | 必填 | 默认值        | 说明                                   |
| --------------------------- | ---- | ------------- | -------------------------------------- |
| `AMAP_JSCODE`               | 是   | —             | 高德 JS API 安全密钥，仅服务端使用     |
| `AMAP_WEB_SERVICE_KEY`      | 是   | —             | 高德 Web Service Key，BFF 注入         |
| `DEEPSEEK_API_KEY`          | 否   | —             | DeepSeek API Key，留空则 AI 导入不可用 |
| `DEEPSEEK_TIMEOUT_MS`       | 否   | `90000`       | AI 请求超时（毫秒）                    |
| `ALLOWED_ORIGINS`           | 否   | 空            | 额外允许来源，默认只允许同源显式来源   |
| `MAX_AI_BODY_BYTES`         | 否   | `24000`       | AI 导入请求体最大字节数                |
| `AI_RATE_LIMIT`             | 否   | `10`          | 单 IP 每个 AI 窗口最大请求数           |
| `AI_RATE_WINDOW_MS`         | 否   | `3600000`     | AI 限流窗口（毫秒）                    |
| `AMAP_RATE_LIMIT`           | 否   | `600`         | 单 IP 每个高德代理窗口最大请求数       |
| `AMAP_RATE_WINDOW_MS`       | 否   | `60000`       | 高德代理限流窗口（毫秒）               |
| `TILE_RATE_LIMIT`           | 否   | `1200`        | 单 IP 每个瓦片窗口最大请求数           |
| `TILE_RATE_WINDOW_MS`       | 否   | `60000`       | 瓦片限流窗口（毫秒）                   |
| `ELEVATION_RATE_LIMIT`      | 否   | `120`         | 单 IP 每个高程窗口最大请求数           |
| `ELEVATION_RATE_WINDOW_MS`  | 否   | `60000`       | 高程限流窗口（毫秒）                   |
| `GEO_ASSETS_RATE_LIMIT`     | 否   | `24`          | 单 IP 每个 geoAssets 窗口最大请求数    |
| `GEO_ASSETS_RATE_WINDOW_MS` | 否   | `3600000`     | geoAssets 限流窗口（毫秒）             |
| `GEO_ASSETS_CACHE_TTL_MS`   | 否   | `86400000`    | geoAssets 内存缓存时间（毫秒）         |
| `PORT`                      | 否   | `8080`        | 服务监听端口                           |
| `RAG_ENABLED`               | 否   | `true`        | 设为 false 完全关闭 RAG 检索           |
| `RAG_DB_PATH`               | 否   | `data/rag.db` | SQLite 数据库文件路径                  |
| `RAG_TOP_K`                 | 否   | `3`           | 检索返回的相似攻略数量                 |
| `RAG_MAX_CONTEXT_CHARS`     | 否   | `1500`        | 注入 prompt 的检索上下文最大字符数     |
| `RAG_MIN_DOCS`              | 否   | `3`           | 启用检索的最低文档数（冷启动保护）     |
| `RAG_SEARCH_RATE_LIMIT`     | 否   | `20`          | /\_rag/search 每小时限流次数           |
