# Tier 1 管线配置

> 叙事驱动型游戏（70-95%）完整管线配置参考。

---

## 管线执行策略：Full Pipeline

```
Phase 1 → Phase 2 → Phase 4 → Phase 5
 创意策划    完整大纲    内容生成    打磨优化
```

所有阶段全量执行，无跳过。

---

## Phase 1：创意策划案

**目标**：确定核心创意、情感目标、品类定位

**输出步骤**：
- `core_concept`：High Concept + 核心体验目标
- `system_architecture`：品类 + 题材 + 参考作品
- `value_framework`：叙事支柱（3个关键词）
- `design_doc`：规模预估（章节数/角色数/结局数）

**Tier 1 特殊要求**：
- High Concept 必须体现叙事核心卖点
- 规模预估必须区分最小/推荐/完整体量
- 体量合理性校验：视觉小说推荐 10-40 分钟，JRPG 推荐 20-60 小时

---

## Phase 2：完整大纲与策划

**目标**：完成完整叙事结构设计

**输出步骤**：
- `worldview_generation`：世界圣经（核心设定、势力、规则、历史）
- `character_generation`：角色档案（主角弧光、NPC、关系图）
- `story_framework`：叙事结构（三幕/英雄之旅/网状等）
- `outline_batch`：章节大纲（每章节概述、关键节拍）
- `detailed_outline`：详细大纲（分支点、Agency 选择点、收敛点）

**Tier 1 特殊要求**：
- `story_framework` 必须包含 Agency 规划（Expressive / Branching 区分）
- `detailed_outline` 必须规划收敛点（Convergence Points）
- `worldview_generation` 必须输出数据卫生规则

---

## Phase 4：内容生成

**目标**：生成完整叙事内容资产

**渐进式层级执行**：

| Layer | 步骤 | 内容 |
|-------|------|------|
| Layer 1 | `scene_plan Phase 1` | 所有章节场景骨架、分支点、情感曲线 |
| Layer 2 | `scene_plan Phase 2` | 主线对话、分支对话、事件内容 |
| Layer 3 | `quest_generation` | 支线任务、角色个人线、碎片叙事 |

**Tier 1 特殊要求**：
- Layer 2 对话必须区分主线/分支/Expressive 选择
- `quest_generation` 必须包含角色个人线（角色驱动型游戏）
- 物品叙事（I）和环境叙事（E）同步生成

---

## Phase 5：打磨优化

**目标**：质量审计与问题修复

**审计维度**（Tier 1 全量执行）：

| 审计类型 | 检查内容 |
|---------|---------|
| 一致性审计 | 世界观/角色/时间线/称呼前后一致 |
| 质量审计 | 对话自然度/情感传达/信息密度/节奏感 |
| 结构审计 | 分支逻辑/结局触发/内容可达性/死胡同检测 |
| Agency 审计 | Expressive/Branching 是否混淆？收敛点是否有效？ |
| 品类审计 | 使用对应品类的审计清单 |

---

## 节点级重跑配置

修改单个节点时，影响面评估优先级：

```
修改 worldview → 影响：character, story_framework, outline_batch, detailed_outline, 所有 Phase 4
修改 character → 影响：story_framework（部分）, outline_batch, detailed_outline, scene_plan
修改 story_framework → 影响：outline_batch, detailed_outline, scene_plan
修改 outline_batch → 影响：详细大纲, scene_plan（对应章节）
修改单个场景节点 → 影响：同场景后续节点, quest_generation（相关任务）
```

---

## 体量 × 管线深度参考

| 目标体量 | 推荐配置 |
|---------|---------|
| 概念验证（<30分钟） | Phase 1 + Phase 2 |
| 短篇演示（30-60分钟） | Phase 1 + Phase 2 + Phase 4 Layer 1 |
| 完整 Demo（1-3小时） | Phase 1 → 2 → 4 (Layer 1-2) |
| 完整游戏（10小时+） | Phase 1 → 2 → 4 (全量) → Phase 5 |
