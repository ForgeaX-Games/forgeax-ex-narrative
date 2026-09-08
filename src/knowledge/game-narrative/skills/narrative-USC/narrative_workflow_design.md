# USC 游戏叙事设计工作流架构 (Draft)

基于 Tracy Fullerton 的 Playcentric Approach，我们将叙事设计拆解为以下核心 Skill 模块，并构建线性与循环并行的工作流。

## 1. 核心模块 (Skill Modules)

### A. 戏剧性元素 (Dramatic Elements)
- **Skill 1: Premise (前提/设定)** - 确立故事的核心冲突和背景。
- **Skill 2: Character (角色)** - 定义角色的动机、需求、冲突和成长曲线。
- **Skill 3: Story (故事/剧情)** - 构建情节结构（如三幕式）和叙事节奏。
- **Skill 4: World Building (世界观)** - 设定物理规则、社会结构、历史背景。

### B. 玩家体验 (Player Experience)
- **Skill 5: Dramatic Arc (戏剧弧线)** - 映射玩家的情感波动与剧情高潮。
- **Skill 6: Narrative Mechanics (叙事机制)** - 故事如何通过玩法（对话系统、物品描述、环境叙事）传达。

## 2. 工作流 (Workflow)

1.  **Step 1: Concept Foundation (概念基石)**
    - 调用 `Premise Skill` 生成核心创意。
    - 调用 `World Building Skill` 填充背景。
2.  **Step 2: Character-Driven Plot (角色驱动剧情)**
    - 调用 `Character Skill` 创建主要角色。
    - 根据角色动机，调用 `Story Skill` 生成剧情大纲。
3.  **Step 3: Integration (整合与反馈)**
    - 调用 `Narrative Mechanics Skill` 将剧情转化为游戏元素。
    - 调用 `Dramatic Arc Skill` 进行一致性检查和情感对齐。

## 3. 技术实现思路
- 每个 Skill 作为一个独立的 Prompt 模板或 Agent。
- 使用 JSON Schema 规范输入输出，确保 Skill 之间的数据流转（如 Character 的输出作为 Story 的输入）。
