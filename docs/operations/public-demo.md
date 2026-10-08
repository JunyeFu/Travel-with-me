# 公网口令演示部署

本轮目标为受邀面试演示，不是商业化服务。按 [Zeabur Dockerfile 文档](https://zeabur.com/docs/en-US/deploy/methods/dockerfile)使用项目根目录 Dockerfile，单实例 HTTPS；先完成现有七层发布门禁，再开放域名。不上传 .env，不复用历史 manifest 放行。认证复用 [Hono Basic Auth](https://hono.dev/docs/middleware/builtin/basic-auth)，不是账号系统。

## 平台环境变量（这里只列名称，不列值）

- DEMO_MODE=true
- DEMO_USERNAME、DEMO_PASSWORD：平台填写演示用户名/口令，不进仓库或面试材料。
- RAG_ENABLED=false、RAG_SAVE_IMPORTED_GUIDES=false：不初始化攻略库、不保存访客原文。
- AMAP_JS_KEY、AMAP_JSCODE、AMAP_WEB_SERVICE_KEY、DEEPSEEK_API_KEY：配置已确认轮换的有效凭证；高德生产域名白名单要包含实际 HTTPS 域名。
- ALLOWED_ORIGINS：实际 HTTPS origin；不是访问身份验证。
- PORT：由平台注入；沿用 Node/Hono 启动和现有 Dockerfile。

缺少演示口令或仍启用 RAG 时，进程拒绝启动。默认本地 DEMO_MODE 不启用，接口与存储行为保持原样。

## 验证

GET /healthz、/readyz 免口令；其余全部路径需要 Basic Auth，包括静态页面、配置、地图代理、瓦片与 AI。演示模式 readyz 同时需要地图和 AI 配置。

AI 全局每进程每小时最多接收 12 次解析请求，计数不依赖 X-Forwarded-For；每次解析最多两次上游请求。沿用原每 IP 限流。此限流不是持久化日额度，进程重启会重置；不部署多实例。没有新增账号、配额平台或日志服务。

现场顺序：未认证页面/代理应 401 → 认证后地图与 AI 可用 → 文本导入/POI 修正/Day 道路/保存分享 → 确认 RAG 不可用 → 健康 200 → 回滚到已验证修订后再冒烟。

发布合同与精确候选绑定以 release-playbook.md 为准。人工签字与针对候选的授权不能由自动化替代。Basic Auth 必须在 HTTPS 下使用，口令不可写入 URL、截图、JSON 或视频。
