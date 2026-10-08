# Product and Architecture Blueprint

> 当前产品基线：2026-10-02，2D-only。入口见 [README](../../README.md)，实现边界见 [ARCHITECTURE](../../ARCHITECTURE.md)。

## 产品定义与主流程

Travel With Me 是桌面优先的旅行规划工作台：将中文攻略或手动选择的地点组织为可编辑的多天行程，在真实 2D 地图上查看地点和道路连接，并保存、导出或分享。它不是实时导航，也不是 3D 城市查看器。

文字输入 → AI 提取与地点匹配 → 可编辑预览 → 确认创建行程 → 选择 Day 查看路线 → 本地保存 / JSON 备份 / PNG 分享。

- AI 入口是输入弹窗，提取后才进入预览；目前不直接上传图片、不提供 OCR。
- workspace 最多三条 trip。schema v5 使用 Day 顺序和标题，不包含日历日期；未排期事件保留在 `unscheduled[]`。
- 2D 地图是地理事实的展示层，持久化模型是业务事实源。估算直线不得冒充真实道路。
- 移动 Web 提供行程 / 地图切换和核心操作兼容；Kotlin 原生迁移是独立计划，M0 样本完成，M1–M4 未启动。

## 数据与凭证边界

遵循 [2D 数据契约](../architecture/2d-data-foundation.md)。POI、地理编码、道路规划优先经 BFF；地图由 AMap JS API 2.0 渲染。Web JS Key 用于浏览器地图；Web Service Key、DeepSeek Key 保留在服务端环境变量。`.env` 不进入仓库或导出文件。

路线保留原生描边、透明度、方向箭头和选择反馈，只按时段替换五档蓝黄离散色号。日照色是时间示意，不宣称真实日出日落或天气计算。

## 当前交付边界

- 当前维护：2D 编辑、地图双向选择、文字导入、数据恢复、分享和桌面 / 移动核心闭环。
- 3D 代码与文档仅作封存参考，不接回入口、默认测试、依赖或 BFF；恢复须另行决策，见 [封存规则](../../archive/3d/README.md)。历史 D1 / Gate 50 不再是活动任务。
- 账号、云同步、收费、OCR 与 Kotlin 后续阶段不属于已交付能力。
- 发布按 [发布合同](../operations/release-playbook.md) 绑定准确候选提交；本地通过不代表 CI、容器、人工授权或正式发布已完成。

## 验证与文档归属

默认执行格式、lint、2D 隔离、单元测试、mock 浏览器回归与离线攻略样本评测。真实 AMap / DeepSeek 验证单独记录，不把 mock 或固定 AI 输出当作 LIVE 效果。

| 文档                                           | 用途                   |
| ---------------------------------------------- | ---------------------- |
| `docs/README.md`                               | 活动文档与历史资料索引 |
| `ARCHITECTURE.md`                              | 实现模块边界           |
| `docs/engineering/api.md`                      | 服务端接口与环境变量   |
| `docs/design/ui-visual-style-guide.md`         | 当前 2D 视觉与交互规范 |
| `docs/operations/release-playbook.md`          | 同候选发布证据合同     |
| `TODO.md`                                      | 当前工作队列           |
| `docs/product/kotlin-native-migration-plan.md` | 独立原生迁移计划       |

本轮对照、缺陷表和验收见 [2026-10-02 审查](../engineering/2d-conformance-review-2026-10-02.md)。
