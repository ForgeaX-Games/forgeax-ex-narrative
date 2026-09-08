# USC 游戏叙事设计 Skill 工作流

本项目基于南加州大学 (USC) Tracy Fullerton 的 **Playcentric Approach** 方法论，构建了一套可自动化的游戏叙事生成工作流。

## 1. 核心理念：戏剧性元素 (Dramatic Elements)
我们通过将叙事拆解为相互关联的“戏剧性元素”，确保生成的每一部分内容都服务于核心冲突和玩家体验。

- **Premise (前提)**: 确定“谁在追求什么，遇到了什么阻碍”。
- **Character (角色)**: 聚焦于“需求 (Need)”与“欲望 (Want)”的冲突。
- **World (世界)**: 为冲突提供物理和社会支撑。
- **Story (故事)**: 按照戏剧弧线 (Dramatic Arc) 组织节拍。

## 2. 目录结构
- `skills/prompts/`: 存放各环节的 AI Prompt 模板。
  - `premise_skill.md`: 前提生成。
  - `character_skill.md`: 角色架构。
  - `world_skill.md`: 世界观构建。
  - `story_beat_skill.md`: 剧情节拍生成。
- `narrative_pipeline.py`: 模拟 Skill 之间数据流转的 Python 脚本。
- `narrative_workflow_design.md`: 详细的方法论架构说明。

## 3. 如何使用
1. **定义 Premise**: 使用 `premise_skill.md` 确定故事基调。
2. **派生 Character**: 将 Premise 的输出填入 `character_skill.md`。
3. **构建 World**: 根据 Premise 中的冲突设定世界规则。
4. **生成 Story**: 整合角色和世界信息，生成三幕式剧情。

## 4. 工作流优势
- **一致性**: 通过 JSON Schema 传递上下文，确保角色动机与世界观、剧情高度统一。
- **模块化**: 每个 Skill 可以独立迭代或替换（例如更换不同的叙事结构模板）。
- **情感驱动**: 严格遵循 USC 的情感目标导向设计。
