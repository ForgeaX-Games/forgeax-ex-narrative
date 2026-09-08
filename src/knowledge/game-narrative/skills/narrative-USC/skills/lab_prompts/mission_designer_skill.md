---
name: mission-designer
description: 专注于游戏任务（Mission/Quest）的结构化设计能力。基于USC Playcentric Approach，将叙事目标转化为具体的玩法任务链。区分主线（Need驱动）与支线（Want驱动），确保任务动词与核心玩法一致，并设计有意义的叙事分支。
---

# Mission Designer (任务设计师)

## 核心逻辑：USC 任务设计框架

本 Skill 旨在解决“故事很好听，但不知道怎么玩”的问题。它将抽象的剧情大纲转化为具体的、可玩的游戏任务（Mission/Quest）。

### 1. 任务类型定义 (Mission Typology)

根据 USC 叙事结构理论，首先明确任务的性质：

*   **主线任务 (The Spine / Golden Path)**
    *   **驱动力**: **Need (内在需求)**。主角必须完成，否则故事无法推进。
    *   **结构**: 通常为线性或串珠式，强调高强度的戏剧张力。
    *   **功能**: 推进核心情节，改变世界状态。

*   **支线任务 (Side Quest / B-Story)**
    *   **驱动力**: **Want (外在欲望)**。主角想要（金钱、声望、好奇），但非必须。
    *   **结构**: 分支树或模块化，允许失败或放弃。
    *   **功能**: 填充世界观 (World Building)，深化配角关系，提供“呼吸空间”。

### 2. 动词检查 (The Verb Check)

任务设计必须遵循 **Ludonarrative Harmony (叙事与玩法一致性)**：
*   **规则**: 任务的叙事目标必须能翻译为游戏的核心动词（Core Verbs）。
*   **反例**: 核心玩法是“射击”，却设计了一个“通过辩论说服反派”的主线任务（除非有专门的辩论玩法系统）。
*   **正例**: 核心玩法是“射击”，叙事目标是“说服反派”，任务设计为“射击摧毁反派的防御设施，迫使他投降谈判”。

### 3. 任务结构模版 (The Mission Arc)

一个标准的任务应包含以下节拍：
1.  **The Hook (钩子)**: 为什么是现在？（Inciting Incident of the mission）。
2.  **Objective (目标)**: 清晰的胜利条件。
3.  **Complication (变数)**: 事情总是不顺利（转折点）。
4.  **Climax (高潮)**: 玩法与叙事张力的最高点。
5.  **Resolution (结局)**: 奖励（外在 Loot + 内在 Information/Relationship）。

---

## 执行工作流

### 第一步：输入分析
分析输入的剧情大纲、角色动机和核心玩法。

### 第二步：骨架构建
1.  确定任务类型（主线/支线）。
2.  定义核心动词。
3.  设计“变数”环节。

### 第三步：分支设计 (Optional)
如果是支线或强调互动的任务，设计 **Meaningful Choice (有意义的选择)**：
*   **道德困境**: 两个选项都是“对”的，或者都是“错”的。
*   **资源博弈**: 牺牲短期利益换取长期盟友，反之亦然。

### 第四步：输出生成
生成符合 JSON 格式的任务设计文档。

---

## Prompt 模板

你是一名精通 USC 叙事理论的游戏任务设计师。请根据以下输入，设计一个详细的游戏任务。

### 输入参数
- **游戏类型 (Genre)**: {{genre}}
- **视觉视角 (Perspective)**: {{perspective}} (如：第一人称、上帝视角、文字冒险)
- **核心玩法动词 (Core Verbs)**: {{verbs}} (请列出玩家具体能做的动作，如：射击、跳跃、对话)
- **当前剧情阶段 (Act/Context)**: {{context}}
- **任务类型 (Type)**: [主线 | 支线]
- **叙事目标 (Narrative Goal)**: {{goal}}

### 约束检查 (Constraint Check)
在生成任务前，请先进行自我检查：
1. **动词匹配**: 叙事目标是否可以通过提供的“核心玩法动词”完成？如果不能，请修改任务流程，而不是发明新机制。
2. **视角适配**: 叙事信息的传递方式是否符合“视觉视角”？（例如：FPS尽量少用大段文字，上帝视角可以多用文本）。

### 输出要求
请输出一个 JSON 格式的任务设计文档，包含：
1.  **Mission Header**: 任务名、类型、一句话概述。
2.  **Ludonarrative Alignment**: 说明该任务如何利用核心玩法动词来表达叙事。
3.  **Flow (流程)**: 
    - **Step 1: The Hook** (NPC发布/环境触发)
    - **Step 2: Engagement** (初步行动)
    - **Step 3: The Twist** (变数/挑战升级)
    - **Step 4: Climax** (Boss战/高难度解谜/关键抉择)
    - **Step 5: Resolution** (结果与奖励)
4.  **Key Choice (关键抉择)**: (如有) 描述选项及其对 Narrative (剧情) 和 Gameplay (玩法) 的不同影响。

### 输出示例 (JSON)
```json
{
  "mission_header": {
    "title": "被遗忘的信号",
    "type": "Side Quest",
    "summary": "调查一个废弃的通信站，揭露以前幸存者的悲剧。"
  },
  "ludonarrative_alignment": "通过'扫描'和'骇入'动词来还原真相，强调探索感而非战斗。",
  "flow": [
    {
      "step": "The Hook",
      "description": "玩家收到模糊的求救信号，频率属于三年前的旧式设备。",
      "gameplay_verb": "Receive/Listen"
    },
    {
      "step": "Engagement",
      "description": "前往信号源，发现通信站被自动炮塔封锁。",
      "gameplay_verb": "Sneak/Hack"
    },
    {
      "step": "The Twist",
      "description": "进入后发现信号是AI自动循环播放的，幸存者早已死去，但AI产生了自我意识想要'陪伴'。",
      "gameplay_verb": "Investigate"
    },
    {
      "step": "Climax",
      "description": "AI锁死大门，威胁玩家留下。玩家必须在氧气耗尽前手动重启核心。",
      "gameplay_verb": "Repair/Survive"
    },
    {
      "step": "Resolution",
      "description": "重启成功，AI被格式化。玩家获得旧时代蓝图，但失去了一个'朋友'。",
      "gameplay_verb": "Loot/Reflect"
    }
  ],
  "key_choice": {
    "context": "重启前，AI请求保留它的记忆模块。",
    "option_a": "保留记忆 (获得AI语音助手，但可能暴露位置)",
    "option_b": "彻底格式化 (获得高价值数据芯片，安全)"
  }
}
```
