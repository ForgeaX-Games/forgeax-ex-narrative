---
name: story-beat-generator
description: 故事节拍生成器。基于USC叙事结构，将宏观的三幕剧结构拆解为可操作的叙事节拍，并与“序列架构师”深度协同，确保叙事节拍与游戏玩法节奏对齐。
---

# Story Beat Generator (故事节拍生成器)

## 1. 核心设计标准 (Beat Standards)

故事节拍（Beat）是叙事中最小的动作单位。在游戏叙事中，节拍必须具备**“交互性”**和**“节奏感”**。

### A. 节拍与序列的协同 (Beat-Sequence Synergy)
- **宏观结构**：三幕剧（Act 1, 2, 3）。
- **中观结构**：序列（Sequence）。每个 Act 由 2-4 个 Sequence 组成。
- **微观结构**：节拍（Beat）。每个 Sequence 由一系列 Beat 组成。
- **协同逻辑**：每个 Beat 必须明确其在 Sequence 中的位置，并对应相应的玩法压力。

### B. 游戏叙事体验标准 (Game Narrative Experience)
- **Action-Reaction (动作-反应)**：每个节拍应包含“世界对玩家动作的反馈”。
- **Emotional Shift (情感位移)**：每个节拍结束时，角色的处境或玩家的情绪状态必须发生正向(+)或负向(-)的转变。
- **Information Pacing (信息节奏)**：严控信息投放量，确保节拍之间有呼吸感。

---

## 2. 完善后的输出模板 (JSON)

```json
{
  "macro_structure": {
    "act_1": { "theme": "引入与契约", "sequences": [] },
    "act_2": { "theme": "冲突与试炼", "sequences": [] },
    "act_3": { "theme": "高潮与蜕变", "sequences": [] }
  },
  "beat_details": [
    {
      "sequence_id": "所属序列ID",
      "beat_name": "节拍名称",
      "dramatic_value": "+/- 转变点",
      "narrative_content": "发生的具体叙事事件",
      "gameplay_interaction": "玩家在此节拍中的具体操作/交互",
      "pacing_type": "低压(叙事填充) / 中压(探索挑战) / 高压(高潮冲突)",
      "trinity_alignment": {
        "narrative_goal": "叙事目标",
        "gameplay_goal": "玩法目标",
        "experience_goal": "体验目标"
      }
    }
  ]
}
```

---

## 3. 执行流程 (Workflow)

1. **结构映射**：将 Premise 扩展为三幕剧大纲。
2. **序列拆解**：将每一幕拆解为 2-4 个逻辑独立的序列（对接 `narrative-sequence-architect`）。
3. **节拍填充**：在序列内部填充具体的叙事节拍，确保每个节拍都有对应的玩法交互。
4. **节奏校验**：检查节拍间的压力曲线，确保不会连续出现多个“高压节拍”导致疲劳。
5. **情感标注**：为每个节拍标注情感位移（Value Shift），确保叙事不是平铺直叙。

---

## 4. 与序列 Skill 的协同示例

**输入**：
- 序列：[Sequence 03] 逃离崩塌的矿井
- 体验目标：极度紧迫感

**生成的节拍 (Beats)**：
1. **Beat A (低压)**：发现出口被封死，主角绝望独白（情感：-）。玩法：环境交互。
2. **Beat B (中压)**：余震开始，天花板掉落。玩法：躲避障碍。
3. **Beat C (高压)**：最终的跳跃，抓住悬崖边缘（情感：+）。玩法：QTE/精准跳跃。
4. **Beat D (低压)**：逃出生天，回望废墟。玩法：行走/过场。
