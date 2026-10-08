# AI Guide Import Evaluation

## 受控种子实时对照（2026-10-08）

`npm run test:guide-import:live` 串行运行现有 12 份种子输入的无检索/有检索两组，复用评分器。参考语料在 `tests/fixtures/guide-import-evaluation/rag-reference.json`，与评测输入分离；内存攻略库、`RAG_SAVE_IMPORTED_GUIDES=false`，不把测试输入自动入库。

实际输出、耗时、模型与 [DeepSeek usage](https://api-docs.deepseek.com/api/create-chat-completion/)保留在 `work/release/ai-evaluation/`。`work/release/ai-budget.json` 在上游发送前计数，上限 60，所有付费测试必须串行；独占锁阻止并行覆盖。失败、JSON 重试和 smoke 计入同一预算，不自动重置或追加额度。单组 `--arm=off/on` 仅用于明确的受控复测。

这是实际 BFF/供应商请求与受控种子样本，不是用户研究或完整浏览器 LIVE_E2E。阈值未通过、不减少错误或产生退化时不宣称 RAG 质量收益；公网仍关闭。原始报告保留生成时间、Git 修订与脏状态，冻结前结果不能替代同候选发布证据。无账单只记录用量，不宣称实付费用。

> 离线样本评测说明 | 当前产品边界见 [产品总纲](architecture-blueprint.md)。

本文档定义 S2 阶段的 AI 攻略导入评测方法。目标是让 prompt、清洗规则、POI 匹配策略的调整都有可复现数字，而不是只靠人工主观判断。

## 当前状态

已建立离线评测框架：

- 评测样例：`tests/fixtures/guide-import-evaluation/cases.json`
- 评测脚本：`scripts/evaluate-guide-import.mjs`
- 运行命令：`npm.cmd run test:guide-import`

当前样例覆盖 6 类真实风险：

| 类型             | 关注点                                     |
| ---------------- | ------------------------------------------ |
| 按日 citywalk    | 地点召回、顺序和 day 归属                  |
| 混合攻略         | 固定日程 + 未排期推荐的分流                |
| 推荐合集         | 不强行编造日期                             |
| 带广告噪声的攻略 | 不把相机、口红、优惠码等非地点内容导入     |
| 跨城路线         | 保留路线城市结构，不把无关购物清单混进行程 |
| 模型坏输出       | 评估本地清洗能否过滤模型误抽取的非地点项   |

2026-06-19 更新：默认评测集已扩展到 12 个 case、64 个标注地点，新增亲子周末、历史路线、园林慢游、夜景美食、海岸线和湖山路线等场景。真实用户攻略仍需继续采集到 20-30 篇；当前新增样例属于产品侧种子回归集。

从 S2-2 起，离线评测会先对固定 `modelOutput.events` 快照执行与前端一致的清洗逻辑，再计算召回、误提取和禁用项命中。它衡量固定样本的后处理回归，不调用实时模型或真实 POI 匹配，不能据此声称端到端导入质量。

## 样例格式

每个 case 包含：

- `sourceText`：原始中文攻略文本。
- `expected`：人工标注答案。
- `modelOutput`：某次模型输出快照，结构对齐 `/_ai/extract-guide`。

最小结构：

```json
{
  "id": "beijing-daily-citywalk",
  "cityHint": "北京",
  "sourceText": "上午先从鼓楼出发...",
  "expected": {
    "guideType": "daily_itinerary",
    "events": [
      {
        "placeName": "鼓楼",
        "day": 1,
        "noteKeywords": ["上午", "出发"]
      }
    ],
    "forbiddenPlaceNames": ["优惠码"]
  },
  "modelOutput": {
    "guide_type": "daily_itinerary",
    "city": "北京",
    "events": [
      {
        "day": 1,
        "place_name": "鼓楼",
        "note": "上午从鼓楼出发"
      }
    ]
  }
}
```

## 指标

| 指标                  | 含义                                     | 默认阈值 |
| --------------------- | ---------------------------------------- | -------- |
| `recall`              | 人工标注地点被模型召回的比例             | `>= 85%` |
| `falsePositiveRate`   | 模型多提取地点占模型输出地点的比例       | `<= 15%` |
| `dayAccuracy`         | 已召回地点的 day 归属准确率              | `>= 85%` |
| `noteKeywordCoverage` | 已标注 note 关键词在模型 note 中的覆盖率 | `>= 65%` |
| `guideTypeAccuracy`   | 攻略类型识别准确率                       | `>= 80%` |
| `forbiddenHits`       | 被明确禁止导入的噪声项命中次数           | `= 0`    |

## 使用方式

运行默认评测：

```powershell
npm.cmd run test:guide-import
```

输出 JSON：

```powershell
node scripts/evaluate-guide-import.mjs --json
```

使用其他样例文件：

```powershell
node scripts/evaluate-guide-import.mjs --input tests/fixtures/guide-import-evaluation/cases.json
```

临时调整阈值：

```powershell
node scripts/evaluate-guide-import.mjs --threshold recall=0.9 --threshold falsePositiveRate=0.1
```

## 后续扩展

S2 继续补齐：

- 扩展到 20-30 篇真实中文攻略。
- 增加 bad case：商单软文、徒步路线、景区内路线、跨城市长线。
- 保存真实 DeepSeek 输出快照，不覆盖人工标注答案。
- 每次 prompt 或清洗规则调整后记录评测结果。
- 将 `npm.cmd run test:guide-import` 接入 CI，作为 AI 导入质量门禁。
