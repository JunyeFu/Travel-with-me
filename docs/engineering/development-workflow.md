# Development Workflow Foundation

> 工程工作流参考 | 当前产品与启动方式以 [README](../../README.md) 为准。

本文档定义 Travel With Me 按高效率、可持续、可商业化工程方式继续推进时，需要准备的软件、账号、环境变量和工作流。目标是让项目从“本地能跑”变成“多人/AI 协作也能稳定迭代”。

## 1. 历史本机环境快照（不代表当前安装状态）

已确认：

| 项目        | 当前状态           | 说明                                                  |
| ----------- | ------------------ | ----------------------------------------------------- |
| Node        | `v24.15.0`         | 可用；官方当前 LTS 已到 Node 24 系列                  |
| npm         | `11.12.1`          | 需用 `npm.cmd`，直接运行 `npm` 被 PowerShell 策略拦截 |
| Git         | `2.54.0.windows.1` | 可用                                                  |
| Docker      | 已安装             | `docker.exe` 在 PATH 中                               |
| VS Code CLI | 未找到 `code`      | 需要安装 VS Code 或把 `code` 加入 PATH                |
| GitHub CLI  | 未找到 `gh`        | 建议安装，用于登录、PR、CI、Issue 管理                |

当前项目仍保持原技术形态：Node/Hono BFF + 原生 ES Modules 前端，不做 React/Vue/Vite 重写。

## 2. 工作流原则

### 2.1 保持轻量，不盲目重构框架

当前项目的高效路径不是换框架，而是补齐工程底座：

- 依赖锁定。
- 质量门禁自动化。
- 浏览器级回归测试。
- 可恢复数据。
- API/环境变量/部署文档同步。
- 分支、PR、CI、发布节奏稳定。

### 2.2 本地、CI、生产三套环境一致

本地做的每件事都应能在 CI 中复现：

```text
npm.cmd ci
npm.cmd run check
npm.cmd test
npm.cmd run test:e2e
```

当前还没有 `test:e2e`，应在后续引入 Playwright 后补齐。

### 2.3 AI 协作必须受质量门禁约束

AI/Codex 可以加速探索、重构、测试和文档，但每轮都必须落到：

- 文件变更可审查。
- 测试可运行。
- 文档同步。
- 不回滚用户已有改动。
- 不把聊天里的方案当成事实，必须写入项目文档。

## 3. 必装软件

### 3.1 Node.js LTS

用途：运行 Hono BFF、npm scripts、Vitest、Playwright。

建议：

- 使用官方 Node.js LTS。
- 本机已有 `v24.15.0`，可继续使用。
- 如果要标准化团队环境，建议安装 Node 版本管理器，并在项目中增加 `.nvmrc` 或 `.node-version`。

Windows 安装：

```powershell
winget install OpenJS.NodeJS.LTS
```

准备项：

- 继续使用 `npm.cmd`，避免 PowerShell 执行策略拦截 `npm.ps1`。
- 或由用户自行决定是否调整 PowerShell 执行策略。

### 3.2 Git for Windows

用途：版本控制、分支、PR、CI 触发。

本机已安装，可用。

建议配置：

```powershell
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"
git config --global init.defaultBranch main
git config --global pull.rebase false
```

### 3.3 VS Code

用途：日常编辑、调试、Git diff、扩展生态、AI 协作。

当前 `code` 命令未找到，建议安装或把 VS Code bin 加入 PATH。

Windows 安装：

```powershell
winget install Microsoft.VisualStudioCode
```

推荐扩展：

```text
dbaeumer.vscode-eslint
esbenp.prettier-vscode
ms-playwright.playwright
GitHub.vscode-github-actions
GitHub.copilot
GitHub.copilot-chat
ms-azuretools.vscode-docker
EditorConfig.EditorConfig
```

### 3.4 GitHub CLI

用途：登录 GitHub、创建 PR、查看 CI、管理 issue/release。

当前未安装，建议安装：

```powershell
winget install GitHub.cli
gh auth login
```

### 3.5 Docker Desktop + WSL 2

用途：未来本地跑 Postgres、Redis、Sentry/监控模拟、生产镜像验证。

本机已有 Docker 命令，但仍需确认 Docker Desktop 正常启动，WSL 2 后端可用。

检查：

```powershell
docker version
docker compose version
wsl.exe -l -v
```

准备项：

- Docker Desktop 使用 WSL 2 backend。
- Windows 需启用虚拟化。
- 后续 S3 做云端同步时，用 Docker Compose 启动本地 Postgres/Redis。

## 4. 建议安装软件

### 4.1 GitHub Desktop

适合可视化看 diff、处理简单提交。不是必需，但对多人协作和非命令行操作友好。

```powershell
winget install GitHub.GitHubDesktop
```

### 4.2 pnpm

当前项目已有 `package-lock.json`，短期继续 npm，避免无意义迁移。

如果后续进入 monorepo 或依赖规模变大，可评估 pnpm。pnpm 官方支持通过 Corepack 启用并 pin 项目版本：

```powershell
corepack enable pnpm
corepack use pnpm@latest-11
```

暂时不建议现在切换，除非决定统一迁移 lockfile。

### 4.3 Playwright Browsers

后续引入 E2E 后安装：

```powershell
npm.cmd i -D @playwright/test
npx.cmd playwright install
```

用途：

- 桌面核心路径 smoke test。
- 375px 小屏基础回归，只用于防止既有兼容能力倒退。
- 分享长图和 3D canvas 非空检查。
- CI 失败截图和 trace。

### 4.4 数据库客户端

进入 S3 云端同步前再安装：

- TablePlus / DBeaver / pgAdmin，三选一即可。
- 本地 Postgres 推荐先用 Docker Compose，不直接装系统服务。

### 4.5 API 调试工具

推荐任选一个：

- Bruno：请求集合可进 Git，轻量。
- Postman：生态完整，但项目文件管理较重。
- VS Code REST Client：足够轻。

当前 BFF API 较少，优先 Bruno 或 VS Code REST Client。

## 5. 暂不安装或暂不引入

这些工具当前看起来高级，但会增加项目复杂度：

| 工具/方向             | 暂缓原因                                                      |
| --------------------- | ------------------------------------------------------------- |
| React/Vue/Vite 重写   | 当前核心风险是数据、安全、桌面端 Web 私测闭环、测试，不是框架 |
| Kubernetes            | 单体 BFF 阶段太重                                             |
| Terraform             | 还未进入多环境云基础设施                                      |
| 微服务拆分            | 当前模块边界还应先在单体内稳定                                |
| Cesium/Mapbox 全量 3D | 会把旅行规划产品带成重地图平台                                |
| Redis 分布式限流      | S1 私测用内存限流够，S3 再引入                                |
| CRDT 实时协作         | 先完成单人云同步和版本恢复                                    |

## 6. 账号与密钥准备

### 6.1 高德开放平台

需要：

- Web JS API Key。
- Web 服务安全密钥 `AMAP_JSCODE`。
- 本地域名和生产域名白名单。

本地 `.env`：

```text
AMAP_JSCODE=...
```

注意：`AMAP_JSCODE` 只能在服务端环境变量中，不能写入前端。

### 6.2 DeepSeek

需要：

```text
DEEPSEEK_API_KEY=...
DEEPSEEK_TIMEOUT_MS=90000
```

AI 导入前必须准备：

- 预算上限。
- 失败重试策略。
- 真实攻略评测集。

### 6.3 GitHub

需要：

- GitHub 账号。
- 仓库。
- GitHub Actions。
- 分支保护。
- PR Review 规则。

后续建议：

- `main` 分支禁止直接 push。
- 所有变更走 PR。
- PR 必跑 `check`、`test`、E2E。

### 6.4 部署平台

短期可继续 Zeabur 或同类 Node 部署平台。

生产环境变量至少：

```text
PORT=8080
AMAP_JSCODE=...
DEEPSEEK_API_KEY=...
DEEPSEEK_TIMEOUT_MS=90000
ALLOWED_ORIGINS=https://你的生产域名
```

## 7. 项目内准备工作

### 7.1 固定 Node 版本

建议新增：

```text
.nvmrc
.node-version
```

内容使用当前 LTS 主版本，例如：

```text
24
```

### 7.2 修复 PowerShell npm 体验

当前直接运行 `npm` 会被执行策略拦截。项目内命令统一写成：

```powershell
npm.cmd install
npm.cmd run check
npm.cmd test
```

不要在文档里只写 Windows PowerShell 下不可用的 `npm`，除非同时说明可用 `npm.cmd`。

### 7.3 增加 EditorConfig

如果项目没有 `.editorconfig`，应补齐：

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
```

### 7.4 增加 Playwright

下一步建议新增：

```json
{
  "scripts": {
    "test:e2e": "playwright test"
  }
}
```

第一批测试只覆盖核心 smoke：

1. 打开首页。
2. 创建/切换行程。
3. 添加地点。
4. 切换 day。
5. 打开分享图。
6. 375px 小屏基础布局不出现致命遮挡。

### 7.5 增加 Dev Container

适合后续多人协作，保证环境一致。

建议文件：

```text
.devcontainer/devcontainer.json
Dockerfile
docker-compose.yml
```

S1 可以暂缓；S3 云端同步需要 Postgres 后再做更划算。

## 8. 推荐日常工作流

### 8.1 每次开发前

```powershell
git status --short
npm.cmd ci
npm.cmd run check
npm.cmd test
```

确认工作区是否有用户未提交改动，不随便回滚。

### 8.2 开发中

```powershell
npm.cmd run dev
npm.cmd run test:watch
```

编辑规则：

- 小步提交。
- 每次只解决一个阶段目标。
- 代码、测试、文档一起更新。
- 新 API 必须同步 `docs/engineering/api.md`。
- 新架构决策必须同步 `ARCHITECTURE.md`。
- 新产品/技术方向必须同步 `docs/product/architecture-blueprint.md`；3D 技术取舍必须同步 `docs/architecture/3d/deep-research-integration.md` 和 `docs/architecture/3d/top-down-execution-roadmap.md`。

### 8.3 提交前

```powershell
npm.cmd run check
npm.cmd test
```

引入 Playwright 后再加：

```powershell
npm.cmd run test:e2e
```

### 8.4 PR 流程

推荐：

1. 新建分支：`codex/s1-data-reliability`
2. 完成小范围修改。
3. 本地跑质量门禁。
4. 创建 PR。
5. CI 通过。
6. Review。
7. Squash merge。

PR 描述模板：

```text
## What

## Why

## Verification
- npm.cmd run check
- npm.cmd test
- npm.cmd run test:e2e

## Risks

## Docs
```

## 9. 推荐安装顺序

按当前机器状态，建议顺序如下：

1. 安装 VS Code，并确认 `code .` 可用。
2. 安装 GitHub CLI，并执行 `gh auth login`。
3. 确认 Docker Desktop 可启动，`docker version` 正常。
4. 准备高德和 DeepSeek 环境变量。
5. 继续使用 `npm.cmd`，暂不切 pnpm。
6. 下一轮项目改造安装 Playwright。
7. S3 前安装数据库客户端，并用 Docker Compose 跑 Postgres。

## 10. 官方参考

Current status override:

- Playwright is already part of the project toolchain.
- The next development preparation task is not installing Playwright; it is building the deterministic ROI visual baseline harness documented in `docs/engineering/qa/visual-baseline.md`.
- Live-provider checks remain explicit opt-in and must not be part of default visual QA.

- Node.js downloads: https://nodejs.org/en/download
- npm install docs: https://docs.npmjs.com/cli/v11/commands/npm-install/
- VS Code Windows setup: https://code.visualstudio.com/docs/setup/windows
- VS Code CLI docs: https://code.visualstudio.com/docs/configure/command-line
- GitHub CLI quickstart: https://docs.github.com/en/github-cli/github-cli/quickstart
- Docker Desktop WSL 2 backend: https://docs.docker.com/desktop/features/wsl/
- Playwright installation: https://playwright.dev/docs/intro
- Playwright browsers: https://playwright.dev/docs/browsers
- Vitest guide: https://vitest.dev/guide/
- pnpm installation: https://pnpm.io/installation
