# 归档：其余模板定义本体（D1，2026-08）

## 本目录内容

`templates.ts`——原 `pipeline/templates.ts` 的 `PIPELINE_TEMPLATES` 里不属于
三条精心设计过的老管线（jrpg / vn-v2 / vn-v1）、也不属于四个品类特化模板
（specialized）的"其余"两条：

| 模板 id | 用途 |
| --- | --- |
| `tpl-narrative-card` | Tier4 极简：`narrative_card` 一步生成 |
| `tpl-light` | Tier3 大部分品类：偏好 → 初步方案 → 世界观 → 角色 |

同时承载原 `PIPELINE_TEMPLATES` 的公共外壳说明：`PipelineTemplate` 接口形状，
以及 `getPipelineTemplate` / `resolveTemplateSteps` 两个查表函数**为什么没有
被保留为可运行代码**（见 `templates.ts` 文件末尾的说明与摘录）。

## 为什么这两个 id 单独归在这里

它们既不是"精心设计过、需要独立目录承载差异对照"的老管线（那是 `jrpg/` 与
`vn-v2/` 的标准），也不是需要按品类特化维度归档的能力（`specialized/`）。
`tpl-narrative-card` 对应的 `narrative_card` 是唯一手写并跑在 `SingleTurnRunner`
上的 AgentDef，本轮不动它（详见方案定案第 4 条），模板定义本身只是历史步序
记录；`tpl-light` 是"没有特化内容"的兜底轻量管线，两者都没有独立的吸收去处，
故合并存档。

## 吸收去处

**无。** 两个模板定义都只是步序记录，没有领域知识、校验规则或形态差异需要
吸收进新架构——`narrative_card` 步本身已是活跃代码（未受影响），`tpl-light`
的步序（偏好三件套 + 世界观 + 角色）全部是通用步骤，新架构下由四条席位管线
（`pl-codex` / `pl-narrative` 的对应层级）直接覆盖，没有专属提示词或校验规则
需要单独搬运。

## 待二层校对项

无。

参见总台账：[`../README.md`](../README.md)。
