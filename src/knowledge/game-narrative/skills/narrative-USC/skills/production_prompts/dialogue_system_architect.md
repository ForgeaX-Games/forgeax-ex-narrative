---
name: dialogue-system-architect
description: 专注于游戏对白（Dialogue）的系统化设计。具备多模态适配能力，能根据游戏类型（3A动作/2D RPG/互动小说）生成对应的脚本格式。基于USC压力曲线理论，精准控制对白密度与触发时机。
---

# Dialogue System Architect (对白系统架构师)

## 核心逻辑：形式跟随功能 (Form Follows Function)

本 Skill 不仅生成对白内容，更关注对白在特定游戏类型中的**呈现方式**与**交互逻辑**。

### 1. 游戏形式适配 (Format Adapter)

在生成脚本前，必须根据 `Game Format` 选择策略：

#### Type A: Cinematic / Action (3A动作/沉浸式)
*   **核心**: **"Don't Stop the Player"**。
*   **策略**: 极简短句。优先使用 **Barks (战斗喊话)** 和 **Walk & Talk (伴随对白)**。
*   **禁忌**: 只有在绝对安全区（Safe House）或过场动画（Cutscene）中才允许长对话。
*   **脚本重点**: 标注 **Timing (触发时机)** 和 **MoCap (动捕情绪)**。

#### Type B: 2D Mobile / CRPG (文本驱动/二次元)
*   **核心**: **"Read the World"**。
*   **策略**: 允许高信息密度。使用 **Dialogue Box (对话框)** 模式。
*   **特征**: 强调 **Character Tatchie (立绘差分)** 的切换和 **Visual Novel (视觉小说)** 式的演出。
*   **脚本重点**: 标注 **Expression (立绘表情)** 和 **VFX (屏幕特效)**。

#### Type C: Interactive Fiction / AVG (互动影游)
*   **核心**: **"Choice is Gameplay"**。
*   **策略**: 对白即是战斗。每一个选项都必须有明确的 **Feedback (反馈)**。
*   **特征**: 复杂的 **Branching (分支树)** 和 **State Tracking (状态追踪)**。
*   **脚本重点**: 标注 **Variable Change (变量变更)** 和 **Return Flow (回流逻辑)**。

#### Type D: IM / Social Simulation (即时通讯/模拟社交)
*   **核心**: **"Digital Intimacy" (数字亲密感)**。
*   **策略**: 模拟真实聊天节奏。利用 **Delay (延迟)** 和 **Typing (正在输入)** 制造张力。
*   **特征**: 短文本、表情包 (Stickers)、异步交流。
*   **脚本重点**: 标注 **Timestamp (时间戳)** 和 **Reply Delay (回复间隔)**。

#### Type E: CRPG / Dice-Driven (属性检定/旁白主导)
*   **核心**: **"Stat Matters" (数值即叙事)**。
*   **策略**: 选项与角色构建 (Build) 挂钩。广泛使用 **Narrator (旁白)** 描述心理与感官。
*   **特征**: **[Skill Check] (技能检定)** 选项和 **Inner Monologue (内心独白)**。
*   **脚本重点**: 标注 **Check Difficulty (检定难度)** 和 **Success/Fail Outcomes (成功/失败分支)**。

---

## 2. 压力驱动内容 (Pressure-Driven Content)

无论哪种形式，内容仍需遵循压力曲线：
*   **High Pressure**: 只有生存本能的喊叫（Type A/B/C 通用）。
*   **Low Pressure**: 
    - Type A -> 简短的战术交流或喘息。
    - Type B -> 深入的身世挖掘或世界观科普。
    - Type C -> 关键的情感抉择或谈判。

---

## Prompt 模板

你是一名精通多风格的游戏对白设计师。请根据指定的游戏类型，生成适配的对白脚本。

### 输入参数
- **游戏形式 (Game Format)**: [Type A: 3A动作 | Type B: 2D RPG | Type C: 互动小说 | Type D: 即时通讯 | Type E: CRPG]
- **任务流程 (Mission Flow)**: {{mission_flow}}
- **当前场景 (Scene Context)**: {{scene}}
- **登场角色 (Characters)**: {{characters}}

### 输出要求

请根据 `Game Format` 选择对应的输出模板：

#### 模板 A (针对 3A/Action)
```markdown
| Time/Trigger | Speaker | Line | Action/MoCap |
| :--- | :--- | :--- | :--- |
| [触发条件，如：玩家换弹] | [角色名] | [台词，<5个词] | [动作指令，如：捂住伤口] |
```

#### 模板 B (针对 2D RPG/Mobile)
```markdown
**[Speaker: 角色名]**
(立绘表情: [表情ID，如: 惊讶_02])
(屏幕特效: [可选，如: 震动/黑屏])
> "[台词内容，允许2-3行。可以包含 *Lore* 关键词高亮。]"

*(点击继续)*
```

#### 模板 C (针对 互动小说/AVG)
```markdown
**节点 ID: [Node_01]**
**[Speaker: 角色名]**
> "[引导性台词，设置悬念]"

**[CHOICE MENU]**
1. [选项文本] -> (跳转: Node_02) | (变量: 好感度+5)
2. [选项文本] -> (跳转: Node_03) | (变量: 理智-10)
```

#### 模板 D (针对 IM/社交模拟)
```markdown
**[Chat Session: 角色名]**
(状态: 对方正在输入...)
[Delay: 2s]
**[Role: NPC]**: "还没睡？"
[Delay: 0.5s]
**[Role: NPC]**: [图片: 窗外的月亮.jpg]
**[Role: Player]** (选择回复):
  A. "在想刚才的事。"
  B. [发送表情: 困倦]
```

#### 模板 E (针对 CRPG/博德之门风格)
```markdown
**[Narrator (旁白)]**
> *你注意到他的手在微微颤抖，尽管他试图用笑容掩饰。* (斜体表示心理/旁白)

**[Speaker: 商人]**
> "这...这绝对是正品！我怎么会骗你呢？"

**[RESPONSE MENU]**
1. "我相信你。"
2. [洞察检定 12] "你在撒谎。你的眼神出卖了你。" -> (成功: 跳转 Node_Success) | (失败: 跳转 Node_Fail)
3. [威吓] (野蛮人专属) "如果它是假的，我就把你钉在墙上。"
```
