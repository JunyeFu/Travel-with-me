# Trip App

## Current product boundary

The active product is 2D-only. The former 3D implementation is frozen reference material and is
not loaded, served, tested, or depended on by the default product runtime. The authoritative
boundary is documented in [archive/3d/README.md](archive/3d/README.md) and enforced by
`npm run check:architecture`.

Current work is limited to the 2D itinerary, map, search, routing, AI import, persistence, and share
image flows. Historical 3D roadmaps and QA documents do not authorize reconnecting 3D code.

Trip App 是一个中文旅行路线规划 Web App，用来创建多条旅行路线、管理多日行程、搜索地点、规划交通方式，并生成旅行手账风格的分享长图。

当前项目是 **Node/Hono BFF + 原生 ES Modules 前端**，不是 React/Vue/Vite 项目，也不是纯静态站。

## 项目阶段

当前项目处于 **2D 稳定性与数据完整性收敛** 阶段。桌面端核心规划闭环已经成立，但还不建议直接商业化上线：云端同步、账号体系、配额、监控和真实用户反馈仍需补齐。

当前开发主线为 **2D Web 产品**：宽屏路线规划、地图联动、AI 导入和分享图；移动 Web 保留基础可访问和回归守门。

当前主文档：

- [文档索引](docs/README.md)：当前文档职责和封存资料入口。
- [产品与架构总纲](docs/product/architecture-blueprint.md)：产品定位、2D 数据事实层、双 Key 边界和交付门禁。
- [2D 数据事实层](docs/architecture/2d-data-foundation.md)：地点、路线、地理事实、BFF 和持久化边界。
- [3D 封存边界](archive/3d/README.md)：历史 3D 实现的隔离规则和恢复前置条件。
- [UI 视觉风格守则](docs/design/ui-visual-style-guide.md)：锁定当前颜色、图标、布局、圆角、阴影和后续新增 UI 的审查清单。
- [AI 导入评测](docs/product/guide-import-evaluation.md)：攻略导入召回率、误提取率、day 准确率和 note 覆盖率的离线评测。
- [架构文档](ARCHITECTURE.md)：当前 2D 系统架构、ADR 和模块边界。
- [商业化策略](docs/product/commercialization.md)：商业化缺口、方案取舍、阶段路线和暂不做清单。
- [Roadmap](TODO.md)：当前可执行 backlog。
- [BFF API 文档](docs/engineering/api.md)：服务端代理和接口契约。
- [工程工作流底座](docs/engineering/development-workflow.md)：软件安装、账号密钥、环境准备和日常开发流程。
- [发布运行手册](docs/operations/release-playbook.md)：健康检查、灰度、回滚与上线门禁。

## 当前能力

- **多路线工作区**：顶部活页本标签切换，最多本地保存 3 条旅行路线。
- **本地自动保存与恢复**：workspace 保存到 localStorage，刷新后恢复当前路线和编辑内容；旧 schema 加载前会保存恢复快照。
- **JSON 导出/导入**：行程菜单支持导出当前 workspace，也支持从 JSON 导入并在替换前保存恢复快照。
- **默认演示行程**：首次打开会加载“五一北京行程”；默认地点不再写死坐标，启动后通过高德解析。
- **AI 攻略导入**：顶部提供独立 `AI 导入` 入口；可粘贴中文攻略文本，由 DeepSeek 提取行程结构，再用高德匹配 POI，预览确认后创建新路线。
- **攻略检索增强**：已导入攻略可进入本地 SQLite/BM25 索引，为后续攻略提取提供相似文本上下文。
- **日期管理**：新建一天、编辑日期/标题、删除日期；日期不可重复，并按时间排序。
- **地点管理**：搜索添加地点、替换已有地点、删除地点、同一天内拖拽排序。
- **智能一些的添加体验**：新增地点时标题自动使用地点名；可按关键词搜索，也可基于当天已有地点“搜附近”。
- **地点信息增强**：高德 POI 结果会尽量展示图片、评分、人均、标签；地点详情卡也会保留图片/type 信息。
- **时间块与备注**：地点支持未定、上午、中午、下午、晚上；支持备注。
- **简约 icon 体系**：内置 Lucide 风格 SVG 图标，按 POI type、地点名和标题加权匹配，避免地址误判。
- **地图联动**：点击地点卡片聚焦地图；没有地点时清空 marker/路线并展示中国视图。
- **路线规划**：支持打车/驾车、步行、公共交通、骑行；自动路线会先试算步行，远距离再比较公共交通和打车，公交换乘多或明显更慢时自动改用打车/驾车。
- **自定义路线展示**：每段路线可设置展示名称和组合步骤，地图仍绑定一个高德基础 mode 规划。
- **分享长图**：Canvas 生成 PNG，可选择是否包含交通方式；地图背景走真实高德瓦片。
- **旧链接兼容**：仍支持读取旧版 `#trip=` 链接并导入当前 workspace。

## 技术栈

```text
Node.js + Hono
  ├─ 静态文件托管
  ├─ 高德 Web 服务代理：/_AMapService/*
  ├─ 高德瓦片代理：/_AMapTile
  ├─ AI 攻略解析：/_ai/extract-guide
  └─ 本地攻略检索：/_rag/*

Browser
  ├─ 原生 ES Modules
  ├─ 原生 DOM 渲染
  ├─ 高德地图 JS API 2.0
  ├─ localStorage workspace
  └─ Canvas 分享长图
```

项目没有前端构建流程。浏览器直接加载 `index.html`、`css/`、`js/` 下的文件。

## 本地运行

需要 Node.js 22.22.1+。

```bash
npm install
npm start
```

访问：

```text
http://localhost:8080
```

开发模式：

```bash
npm run dev
```

代码检查：

```bash
npm run check       # 格式、Lint、2D 架构边界与可见文本编码检查
npm test            # 运行单元测试
npm run test:guide-import # 运行 AI 攻略导入离线评测
npm run test:e2e    # 运行 Playwright 桌面主线 smoke + 移动端基础回归
npm run test:watch  # 测试持续监听模式
```

如果 8080 端口被占用，Windows PowerShell 可先找到并结束占用进程：

```powershell
Get-NetTCPConnection -LocalPort 8080 | Select-Object -ExpandProperty OwningProcess
Stop-Process -Id <PID> -Force
```

不要直接双击 `index.html`，也不建议用 `python -m http.server`。当前高德服务代理、瓦片代理和安全密钥注入都依赖 `server/index.js`。

## 环境变量

高德 Key 和 DeepSeek API Key 都只能放在环境变量里，不能写入源码仓库。`AMAP_JS_KEY`
会在浏览器运行时可见，这是 JS SDK 的限制；但它也必须通过服务端 `/_config` 注入，不能硬编码进
`js/config.js`。

```text
AMAP_JS_KEY=<your-amap-js-api-key>
AMAP_JSCODE=<your-amap-jscode>
AMAP_WEB_SERVICE_KEY=<your-amap-web-service-key>
DEEPSEEK_API_KEY=<your-deepseek-api-key>
DEEPSEEK_TIMEOUT_MS=90000
RAG_ENABLED=true
RAG_DB_PATH=data/rag.db
PORT=8080
```

本地可参考 `.env.example`。生产环境需要在部署平台配置 `AMAP_JS_KEY`、`AMAP_JSCODE`、
`AMAP_WEB_SERVICE_KEY` 和 `DEEPSEEK_API_KEY`。如果不配置 `DEEPSEEK_API_KEY`，AI 导入入口会不可用，但普通行程规划不受影响。

`DEEPSEEK_TIMEOUT_MS` 可选，默认 90000。Zeabur 等部署环境到 DeepSeek 的链路可能比本地慢，如果 AI 导入频繁超时，可在部署平台显式配置为 `90000` 或更高。

## 部署

当前部署依赖 Node/Hono。部署目录必须是包含 `package.json`、`server/`、`index.html` 的项目根目录。

Zeabur 或类似平台需要：

- 使用 Node 22.22.1+。
- 安装依赖后运行 `node server/index.js`。
- 配置环境变量 `AMAP_JS_KEY`、`AMAP_JSCODE`、`AMAP_WEB_SERVICE_KEY`。
- 如需 AI 导入，配置环境变量 `DEEPSEEK_API_KEY`。
- 在高德控制台把生产域名加入 Web JS API Key 的域名白名单。

上线后建议检查：

- 地图能加载。
- POI 搜索能返回结果。
- 搜附近可用。
- 路线规划能返回真实路线或估算路线。
- 分享长图能显示地图瓦片。
- AI 导入能打开、解析、进入预览；未匹配地点可手动搜索绑定。
- 仓库源码里搜不到真实 `AMAP_JS_KEY`、`AMAP_JSCODE`、`AMAP_WEB_SERVICE_KEY`。
- 浏览器源码里搜不到 `AMAP_JSCODE`。
- 浏览器源码里搜不到 `DEEPSEEK_API_KEY`。

## 目录结构

```text
trip-app/
├── Dockerfile
├── package.json
├── package-lock.json
├── .editorconfig
├── .prettierrc
├── eslint.config.js
├── vitest.config.js
├── playwright.config.js
├── .github/workflows/ci.yml
├── server/
│   ├── index.js              # Hono BFF：静态托管、高德/AI 代理、瓦片代理
│   ├── rag/                  # SQLite/BM25 攻略检索
│   └── prompts/
│       └── guide-extract.md  # AI 攻略解析 Prompt
├── index.html
├── css/
│   ├── tokens.css            # 设计令牌
│   ├── layout.css            # 布局骨架
│   └── components.css        # UI 组件
└── js/
    ├── main.js               # 启动流程和业务编排
    ├── state.js              # workspace/trip 唯一状态源
    ├── storage.js            # localStorage workspace 存储
    ├── config.js             # 高德 key、地图默认配置
    ├── logger.js             # 日志框架（按模块开关）
    ├── route-config.js       # 路线配置与组合交通方式规范化
    ├── time-slots.js         # 时间块定义和排序
    ├── share.js              # 旧 #trip= 链接兼容
    ├── share-image.js        # Canvas 分享长图生成
    ├── data/
    │   └── trip.js           # 五一北京演示数据 + JSDoc typedef
    ├── api/
    │   ├── amap-loader.js    # 高德 SDK 加载
    │   ├── geocode.js        # POI 搜索、搜附近、地址解析
    │   ├── guide-import.js   # AI 攻略导入请求封装
    │   └── routing.js        # 路线规划与估算
    ├── render/
    │   ├── modal-base.js     # Modal 基础设施
    │   ├── shared-widgets.js # 共享 UI 组件
    │   ├── icons.js          # 图标体系
    │   ├── workspace-tabs.js
    │   ├── sidebar.js
    │   ├── map.js            # 2D 地图渲染
    │   ├── search-modal.js
    │   ├── event-editor-modal.js
    │   ├── day-editor-modal.js
    │   ├── route-editor-modal.js
    │   ├── share-modal.js
    │   ├── guide-import-modal.js
    │   ├── guide-preview-modal.js
    │   └── trip-modal.js
    ├── __tests__/
    │   ├── utils.test.js
    │   ├── time-slots.test.js
    │   ├── route-config.test.js
    │   ├── icons.test.js
    │   └── state.test.js
    └── tests/
        └── e2e/
            └── smoke.spec.js
```

## 架构约定

依赖方向保持单向：

```text
server/index.js
      ↑
Browser ES Modules
      ↑
main.js
  ↓     ↓      ↓
state   api    render
  ↓     ↓      ↓
utils + config
```

- `state.js` 是唯一状态源，所有 workspace/trip 修改都通过 mutator。
- `main.js` 负责业务编排：启动、切换路线/日期、规划路线、打开弹窗、生成分享图。
- `api/` 只封装高德能力，不读 DOM，不改 state。
- `render/` 只负责 UI 渲染和收集交互，通过 handlers 回到 `main.js`。
- `share-image.js` 只输入 trip、输出 PNG，不依赖页面 DOM 结构。

## 数据模型摘要

```js
workspace = {
  trips: Trip[],
  activeTripId
}

trip = {
  id,
  title,
  subtitle,
  city,
  locations: {
    [id]: {
      name,
      query,
      addr,
      lnglat,
      photo,
      type,
      searchTerms,
      includeKeywords,
      resolveBy,
      resolved
    }
  },
  days: [
    {
      id,
      title,
      events: [
        {
          id,
          title,
          icon,
          timeSlot,
          note,
          locationId,
          routeToNext
        }
      ]
    }
  ],
  unscheduled: [],
  annotations: [] // 只作为封存兼容数据保留，不参与 2D 运行时
}
```

路线配置兼容旧结构：

```js
routeToNext = {
  mode: 'driving' | 'walking' | 'transit' | 'riding',
  label?: string,
  legs?: Array<{ mode, label }>,
  manual?: boolean
}
```

`mode` 是高德实际规划模式；`label` 和 `legs` 用于路线卡和分享图展示。`manual: true` 表示用户明确编辑过该段路线，后续自动排序/新增地点不会覆盖该段路线设置。当前不会按 `legs` 拆成多段地图路线。

## 高德代理说明

源码不写任何真实高德 Key。浏览器运行时通过 `/_config` 获取 Web JS API Key；安全密钥
`AMAP_JSCODE` 和 Web Service Key 只在服务端使用：

1. `api/amap-loader.js` 先请求 `/_config` 获取 `AMAP_JS_KEY`。
2. `api/amap-loader.js` 设置 `window._AMapSecurityConfig.serviceHost = location.origin + '/_AMapService'`。
3. 高德 SDK Web 服务请求打到同源 `/_AMapService/...`。
4. `server/index.js` 转发到 `https://restapi.amap.com`，并注入 `key=$AMAP_WEB_SERVICE_KEY` 和 `jscode=$AMAP_JSCODE`。
5. 分享长图地图瓦片走 `/_AMapTile`，避免跨域图片污染 canvas。

## AI 攻略导入

AI 导入入口在顶部行程标签栏中与新建 `+` 并列显示；空工作区中央也提供 `AI 导入攻略` 入口。导入流程：

1. 用户粘贴中文攻略文本，可选填写城市。
2. 前端调用 `/_ai/extract-guide`，由服务端读取 `server/prompts/guide-extract.md` 并调用 DeepSeek。
3. 前端会先做一层确定性清洗：如果原文存在 `路线：A→B→C` 这类主路线结构，只把主路线点作为行程地点，并把沿途小店/机位/玩法说明合并进备注。
4. 前端按清洗后的 AI 结果做高德 POI 匹配，单个地点匹配有超时保护，避免某个 POI 卡住整个导入。
5. 用户可在预览页调整 day、删除事件、为未匹配地点手动搜索绑定。
6. 确认后创建一条新 trip；有 day 的事件进入具体日期，无 day 的事件进入 `unscheduled[]`。

导入预览里默认不写入时间块，保持攻略原文顺序，避免因为“上午/下午/未定”分组排序破坏路线顺序。运行时最多匹配 40 个地点；超过时会保留前 40 个主路线地点，并提示导入后手动补充。

当前模型使用 `deepseek-v4-flash`。曾测试 `deepseek-v4-pro` 的 JSON Output，但出现空 content，因此暂时回到 flash。后续模型切换需要用真实攻略评测集验证稳定性。

## Icon 体系

地点 icon 使用内置 SVG path，不依赖 npm 包或构建流程。视觉来源统一参考 Lucide 线性图标风格。

- 当前分类：地点、交通、酒店、餐饮、咖啡甜品、购物、市集、校园、公园户外、景点、展馆、娱乐游玩、酒吧。
- 旧 id 会兜底兼容，例如 `pin -> place`、`train -> transport`、`shop/book -> shopping`、`school -> campus`、`photo -> attraction`。
- 自动匹配按 `POI type > 事件标题/地点名 > 地址` 加权判断；地址不会触发交通，避免餐饮店因地址含“站”误判为交通。
- localStorage schema 当前为 v5；旧 schema 会先保存恢复快照，再由状态层规范化。

## 已知限制

- localStorage 只适合本机草稿；已支持本地 JSON 导出/导入，但不支持跨设备自动同步。
- 分享长图是当前主分享方式；旧 `#trip=` 长链接只做兼容。
- AI 导入已有 12 个种子评测 case 和离线质量门禁；仍需继续采集真实用户攻略与 bad case。
- 组合交通方式目前主要用于展示说明，地图仍按一个高德基础 mode 规划。
- 默认示例不再内置坐标，首次解析依赖高德 POI/Geocoder 返回结果。
- 跨天/未排期拖拽已支持桌面端基础交互；移动端触控拖拽不再作为当前开发主线。
- 小屏已有列表/地图切换的基础回归守门，但移动 Web 深度适配暂停，后续优先考虑 Kotlin 原生 Android。

## 后续 TODO

1. 真实用户评测：补充真实攻略和分享图反馈。
2. 分享传播：只读短链接、复制到我的行程、撤销分享和打开统计。
3. 交通方式模型升级：支持中转点/途经点，让组合交通能映射到真实分段路线。
4. 数据同步：在 localStorage 基础上增加可选云端保存。

## 本地目录约定

- `D:\Agent\travel-with-me` 是本项目唯一工作入口（原名 `travel_with_me`，2026-09-19 改名）；并行任务 worktree 统一放在 `_worktrees/`（当前含 codex-separate-3d 工作线），合并后即删；历史备份归档 `_archive/`。两者经 `.git/info/exclude` 本地排除，不入库。
- 2026-09-17 清理：移除工作区迁移遗留的 141 个孤儿 worktree（旧 Desktop 路径）与一次性 `ai/t_*` 分支；原 `travel_with_me-2d` 检出迁入 `_worktrees/codex-separate-3d`，25 个提交与未提交改动原样保留。
