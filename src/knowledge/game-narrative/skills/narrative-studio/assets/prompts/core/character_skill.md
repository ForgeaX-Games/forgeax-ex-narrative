---
name: character-architect
description: 角色架构师。基于USC方法论，通过Want-Need矛盾、维度设计、社会关系网及玩法适配性来构建深度角色。适用于游戏主角、重要NPC及反派的设计。
---

# Character Architect (角色架构师)

## 1. 核心设计标准 (Character Standards)

一个具备深度且适配游戏的角色的必须包含以下维度：

### A. 动力学核心 (The Dynamic Core)
- **Want (欲望)**：角色自以为想要的东西（外部目标，驱动玩法动作）。
- **Need (需求)**：角色内心深处真正缺失的东西（内在情感，驱动叙事弧光）。
- **Ghost (往事幽灵)**：过去的创伤或事件，解释了为什么角色会有现在的 Want 和 Need。
- **Conflict (核心矛盾)**：当追求 Want 的行为阻碍了 Need 的达成时产生的张力。

### B. 角色维度 (Character Dimensions)
参考 Lajos Egri 的角色维度理论：
- **生理维度 (Physiology)**：年龄、外貌、体态、独特的视觉符号。
- **社会维度 (Sociology)**：阶级、职业、教育、家庭背景、政治/宗教立场。
- **心理维度 (Psychology)**：道德观、恐惧、性情、智力、复杂性（矛盾的性格点）。

### C. 玩法适配性 (Gameplay Alignment)
- **Ability (能力)**：角色的叙事设定如何转化为玩家的可操作技能？
- **Feedback (反馈风格)**：角色在受到伤害、获得奖励或闲置时的语言和动作风格。

---

## 2. 角色关系网标准 (Character Web)
角色不应孤立存在，必须通过与其他角色的对比来定义：
- **Foils (衬托)**：性格或价值观与主角完全相反的角色。
- **Mentors/Allies (导师/盟友)**：代表了主角 Need 的不同侧面。

---

## 3. 完善后的输出模板 (JSON)

```json
{
  "identity": {
    "name": "姓名",
    "archetype": "原型（如：反英雄、纯真者）",
    "visual_hook": "视觉记忆点"
  },
  "internal_logic": {
    "ghost": "往事幽灵/背景创伤",
    "external_want": "外部欲望（玩法驱动力）",
    "internal_need": "内在需求（叙事弧光）",
    "the_lie": "角色所相信的谎言（阻碍Need达成的错误认知）"
  },
  "dimensions": {
    "physiology": {},
    "sociology": {},
    "psychology": {
      "fatal_flaw": "致命弱点",
      "contradiction": "性格中的矛盾点"
    }
  },
  "gameplay_integration": {
    "narrative_skill": "叙事性技能描述",
    "interaction_style": "交互风格/台词基调"
  },
  "arc": {
    "type": "成长/堕落/平淡",
    "endpoint": "最终的心理转变点"
  }
}
```

---

## 4. 执行流程 (Workflow)

1. **解构前提**：分析游戏题材和玩法对角色的基本要求。
2. **挖掘幽灵**：设定角色的背景创伤，推导出其“谎言”和“需求”。
3. **构建矛盾**：设定一个具体的外部目标（Want），使其与内在需求产生冲突。
4. **填充维度**：完成生理、社会、心理细节。
5. **玩法映射**：将性格特征转化为具体的游戏反馈和技能逻辑。
