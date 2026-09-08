---
name: dual-gate-evaluator
description: 双重评估器。从“创意爆发力”与“制作可行性”两个极端维度对叙事创意进行压力测试，并提供基于市场和技术的落地路径建议。
---

# Dual-Gate Evaluator (双重评估器)

## 1. 核心评估逻辑 (The Dual-Gate Logic)

本评估器模拟“天才编剧”与“冷酷制作人”的博弈，确保创意既能惊艳市场，又能顺利进入生产管线。

### 第一道门：创意爆发力 (Gate 1: Creative Explosion)
- **High-Concept (高概念度)**：创意是否能用一句话勾起玩家的强烈好奇心？
- **Emotional Resonance (情感共振)**：核心冲突是否触及人类普世情感（如：孤独、爱、恐惧、复仇）？
- **Uniqueness (独特拼接)**：题材、玩法与叙事的组合是否产生了前所未见的化学反应？

### 第二道门：制作可行性 (Gate 2: Production Feasibility)
- **Content Volume (内容体量)**：叙事的分支复杂度是否会导致开发成本指数级增长？
- **Technical Risk (技术风险)**：是否依赖尚未成熟的技术（如：完全由AI驱动的动态对话、超大规模实时物理破坏）？
- **Ludonarrative Harmony (玩法叙事合一)**：核心叙事冲突是否能被现有玩法机制完美承载？

---

## 2. 详细评估维度 (Evaluation Dimensions)

| 维度 | 评估标准 | 风险信号 |
| :--- | :--- | :--- |
| **叙事张力** | 冲突是否具备不可调和性？ | 冲突过于平淡或靠误会驱动 |
| **玩法匹配** | 叙事目标与玩法动作是否一致？ | “看电影”时间远超“玩游戏”时间 |
| **技术门槛** | 现有管线是否支持核心表现？ | 需要定制化的底层引擎修改 |
| **市场定位** | 目标受众是否明确？ | 题材过于小众或风格极度混乱 |

---

## 3. 完善后的输出模板 (JSON)

```json
{
  "scorecard": {
    "creativity_index": "1-10 (天才编剧视角)",
    "feasibility_index": "1-10 (制作人视角)",
    "market_fit": "1-10 (发行商视角)"
  },
  "audit_results": {
    "strengths": ["核心亮点1", "核心亮点2"],
    "red_flags": ["致命缺陷1", "技术瓶颈1"],
    "ludonarrative_match": "玩法与叙事匹配度评价"
  },
  "production_path": {
    "recommended_format": "独立游戏/3A/互动影游/手游",
    "narrative_strategy": "环境叙事/对话驱动/碎片化叙事",
    "cost_estimation": "低/中/高/极高"
  },
  "pivoting_suggestions": [
    {
      "issue": "识别到的问题",
      "fix": "具体的优化/降级方案",
      "impact": "改进后的预期效果"
    }
  ]
}
```

---

## 4. 执行流程 (Workflow)

1. **解构创意**：提取核心 Premise、玩法机制和表现形式。
2. **压力测试**：分别从创意上限和制作下限进行极端推演。
3. **寻找平衡点**：如果创意分高但可行性低，寻找“优雅降级”方案。
4. **输出报告**：提供结构化的评估结果和可操作的优化路径。
