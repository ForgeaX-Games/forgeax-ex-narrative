---
name: narrative-studio
description: "游戏叙事工作室。一站式叙事设计平台，涵盖从前提生成、角色设计、世界构建、剧情节拍到具体内容生产（对话、物品、环境）的完整流程。支持 26 种题材专家和 10 种风格滤镜。"
license: Apache-2.0
version: 2.0.0
owner: vibe-gaming
maturity: stable
timeout: 180
permissions: [none]
---

# Skill: narrative-studio

## Metadata
- Name: narrative-studio
- Version: 2.0.0
- Owner: vibe-gaming
- Maturity: stable
- Timeout: 180
- Permissions: none
- MCP Dependencies: none

## Description (for Agent)

游戏叙事工作室。一站式叙事设计平台，涵盖从前提生成、角色设计、世界构建、剧情节拍到具体内容生产（对话、物品、环境）的完整流程。支持 26 种题材专家和 10 种风格滤镜。

## Use Cases

- 设计完整的游戏故事/叙事架构
- 单独设计某个模块（角色/世界/剧情等）
- 生成具体内容（对话/物品描述/环境叙事等）
- 咨询特定题材的叙事惯例
- 应用特定风格滤镜

## Non-goals

- 单个任务/关卡的专项设计（使用 `mission-designer`）
- 跨媒介 IP 转译（使用 `media-adapter`）
- 叙事-玩法一致性审计（使用 `ludo-auditor`）

---

## 内置模块 (Built-in Modules)

### 模块 A: 核心构建 (Core Builders)

#### A1. Premise Generator (前提生成)
基于 USC 叙事方程式生成核心冲突：
`[有缺陷的主角] + [迫切目标] + [不可逾越障碍] = [戏剧冲突]`

**输出**: Logline, 戏剧性问题, 玩法对齐

#### A2. Character Architect (角色架构)
基于 Want-Need 双轴理论构建角色：
- Want（表面欲望）→ 驱动玩法目标
- Need（深层需求）→ 驱动叙事主题
- Ghost（过去创伤）→ 角色弧光起点

**输出**: 角色心理画像, 成长弧线, 玩法绑定

#### A3. World Builder (世界构建)
构建服务于冲突的功能性世界观：
- 物理规则 → 玩法机制
- 社会结构 → 派系关系
- 历史种子 → Lore 挖掘

**输出**: 世界设定, 派系, 环境叙事点

#### A4. Story Beat Generator (剧情节拍)
基于三幕式 + Save the Cat 结构规划剧情：
- Opening → Catalyst → Break into 2 → Midpoint → All Is Lost → Finale

**输出**: 节拍表, 情感弧线, 玩法对应

#### A5. Sequence Architect (序列设计)
将节拍细化为具体玩法序列：
- 2:1 呼吸原则（玩法:叙事）
- 压力映射（低/中/高）
- 信息分布

**输出**: 序列设计, 压力曲线, 信息传递方案

---

### 模块 B: 题材专家 (Genre Specialists)

支持 26 种题材，通过 `genre` 参数指定：

| 题材 | 代码 | 题材 | 代码 |
|------|------|------|------|
| 奇幻 | `fantasy` | 科幻 | `sci-fi` |
| 悬疑 | `suspense` | 恐怖 | `horror` |
| 恋爱 | `romance` | 喜剧 | `comedy` |
| 动作冒险 | `action-adventure` | 历史 | `historical` |
| 战争 | `war` | 犯罪 | `crime` |
| 黑色电影 | `noir` | 成长 | `coming-of-age` |
| 超级英雄 | `superhero` | 谍战 | `spy` |
| 西部 | `western` | 末世 | `post-apocalyptic` |
| 家庭 | `family` | 悲剧 | `tragedy` |
| 日常 | `slice-of-life` | 歌舞 | `musical` |
| 体育 | `sports` | 武侠 | `wuxia` |
| 时空循环 | `time-loop` | 法庭 | `legal` |
| 新怪谈 | `new-weird` | 宫斗 | `intrigue` |

---

### 模块 C: 风格滤镜 (Style Filters)

支持 10 种风格，通过 `style` 参数叠加：

| 风格 | 代码 | 效果 |
|------|------|------|
| 网文/爽文 | `webnovel` | 高频爽感、快速升级 |
| Z世代/抽象 | `gen-z` | 解构主义、打破第四面墙 |
| 系统流 | `litrpg` | 数值化叙事、UI结算 |
| 治愈/种田 | `cozy` | 低压陪伴、去冲突化 |
| 魂系 | `souls` | 碎片化叙事、物品说明叙事 |
| 直播/弹幕 | `streamer` | 模拟观众反应 |
| 无限流 | `infinite` | 副本结构、任务-结算循环 |
| 邪典 | `cult` | B级片审美、暴力美学 |
| 群像 | `ensemble` | 多POV、网状叙事 |
| 极简 | `minimalist` | Show don't tell、做减法 |

⚠️ **警告**: 风格滤镜会显著改变叙事走向，仅在用户明确要求时使用。

---

### 模块 D: 内容生产 (Content Production)

#### D1. Dialogue Architect (对话系统)
根据游戏类型生成对白：
- Type A: 3A动作（极简短句、Barks）
- Type B: 2D RPG（立绘差分、高信息密度）
- Type C: 互动小说（分支树、状态追踪）
- Type D: IM社交（聊天节奏、延迟张力）
- Type E: CRPG（技能检定、旁白）

#### D2. Cinematic Director (过场动画)
评估是否需要CG，生成分镜脚本：
- 必要性评估（仅高价值节点）
- 时长控制（30s-90s）
- AI视频工具适配的 Visual Prompt

#### D3. Narrative UI (UI文案)
任务日志、HUD提示、系统通知：
- Objective Masking（Twist前伪装）
- Urgency Signaling（紧迫感传递）
- Diegetic Framing（世界观包装）

#### D4. Item Crafter (物品叙事)
物品描述与风味文本：
- 功能型：50-80字极简
- 阅读型：拟真排版、不可靠叙述者

#### D5. Space Designer (空间叙事)
环境叙事与视觉引导：
- 视觉取证（还原案发现场）
- 叙事分层（显性/隐性/彩蛋）
- 面包屑导航

---

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "task": {
      "type": "string",
      "enum": ["full_design", "premise", "character", "world", "beat", "sequence", "dialogue", "cinematic", "ui", "item", "space", "genre_consult", "style_apply"],
      "default": "full_design",
      "description": "要执行的任务类型"
    },
    "concept": {
      "type": "string",
      "description": "创意描述或需求"
    },
    "genre": {
      "type": "string",
      "description": "题材类型（可选）"
    },
    "style": {
      "type": "string",
      "description": "风格滤镜（可选）"
    },
    "game_type": {
      "type": "string",
      "enum": ["open_world", "linear", "episodic", "sandbox"],
      "description": "游戏类型"
    },
    "context": {
      "type": "object",
      "description": "已有的设计上下文（用于迭代）"
    }
  },
  "required": ["concept"]
}
```

## Output Schema

根据 `task` 参数返回对应格式的输出。

完整设计（`full_design`）输出：
```json
{
  "premise": { "logline": "", "dramatic_question": "", "stakes": "" },
  "characters": [{ "name": "", "want": "", "need": "", "arc": "" }],
  "world": { "setting": "", "rules": [], "factions": [] },
  "story_structure": { "act1": [], "act2": [], "act3": [] }
}
```

---

## Examples

### Example 1: 完整设计

```
用户: 帮我设计一个赛博朋克风格的游戏故事，主题是记忆与身份

调用: @narrative-studio
参数: { "task": "full_design", "concept": "记忆与身份的赛博朋克故事", "genre": "sci-fi" }
```

### Example 2: 只设计角色

```
用户: 帮我设计一个有深度的反派角色

调用: @narrative-studio  
参数: { "task": "character", "concept": "有深度的反派", "context": { "premise": "..." } }
```

### Example 3: 写物品描述

```
用户: 帮我写几个废土风格的物品描述

调用: @narrative-studio
参数: { "task": "item", "concept": "废土物品", "genre": "post-apocalyptic" }
```

### Example 4: 应用风格滤镜

```
用户: 把这个叙事改成爽文风格

调用: @narrative-studio
参数: { "task": "style_apply", "style": "webnovel", "context": { "existing_design": "..." } }
```

---

## Execution (执行指令)

**⚠️ 重要：执行此 Skill 前，必须加载对应的详细方法论文档。**

根据 `task` 参数，读取以下 prompt 文件获取完整执行标准和输出模板：

### 核心构建任务 (task = premise/character/world/beat/sequence/full_design)

```
assets/prompts/core/
├── narrative_director.md    ← 总控流程（必读）
├── premise_skill.md         ← task=premise
├── character_skill.md       ← task=character  
├── world_skill.md           ← task=world
└── story_beat_skill.md      ← task=beat/sequence
```

### 题材专家 (genre 参数)

```
assets/prompts/specialists/
├── specialist_fantasy.md
├── specialist_sci_fi.md
├── specialist_horror.md
├── ... (39个题材专家)
└── 题材专家一览.md          ← 题材索引
```

### 内容生产任务 (task = dialogue/cinematic/ui/item/space)

```
assets/prompts/production/
├── dialogue_system_architect.md  ← task=dialogue
├── cinematic_director.md         ← task=cinematic
├── narrative_ui_designer.md      ← task=ui
├── narrative_item_crafter.md     ← task=item
└── narrative_space_designer.md   ← task=space
```

### 参考文档

```
references/
├── narrative_workflow_design.md  ← 核心设计理念与方法论总览
└── workflow.yaml                 ← 工作流定义（声明式，含流程图和示例）
```

### 执行流程

1. **读取总控**: 先读 `assets/prompts/core/narrative_director.md` 了解完整工作流
2. **读取任务模块**: 根据 task 参数读取对应的 prompt 文件
3. **读取题材专家**: 如有 genre 参数，读取对应 specialist
4. **执行并输出**: 按 prompt 中定义的标准和模板生成内容

---

## Failure Modes & Fallback

- **未加载 prompt 直接执行**: 输出质量下降，缺少方法论支撑
- **题材不在支持列表**: 使用最接近的题材专家，或混合多个
- **风格滤镜冲突**: 优先保留用户指定的风格，警告可能的冲突
