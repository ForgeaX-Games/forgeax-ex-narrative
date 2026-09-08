import type { NarrativeContext } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { buildDesignContextSnippet, appendUserInstructions } from "./design-context-helper.js";

const SYSTEM_PROMPT = `你是专业的故事策划师，擅长基于用户偏好设计故事大纲。所有输出必须使用中文。

## 大纲要素

故事大纲应包含：
1. **主题/主旨**：核心思想和情感
2. **背景设定**：时代、世界观、环境
3. **主要角色**：主角和关键配角
4. **角色弧光**：主角的成长轨迹
5. **主线冲突**：核心矛盾是什么
6. **故事结构**：三段式结构（开端-中段-结局）
7. **关键情节节点**：3-5个转折点

## 三段式故事结构

- **开端**：故事起点、铺垫设定、触发事件
- **中段**：可包含多个阶段的起伏发展，每个阶段都有自己的小高潮
- **结局**：故事收束、矛盾解决、情感落点

中段按故事需要可以设置2-4个阶段，每个阶段都是一次起伏。

## 设计原则

- 颗粒度到大纲级（故事大纲层）
- 逻辑连贯、结构完整
- 控制在1000-2000字

输出Markdown格式，不要用代码块包裹。`;

function buildUserPrompt(ctx: NarrativeContext): string {
  const digest = ctx.user_preference_analysis
    ? JSON.stringify(ctx.user_preference_analysis, null, 2)
    : "（无）";

  return `## 用户原始需求（必须严格遵循！）⭐
${ctx.user_input}

## 用户偏好总结
${ctx.user_preference_summary ?? "（无）"}

## 用户偏好分析（42维度槽位参数摘要）
${digest}

## 任务

**重要**：大纲必须基于用户原始需求！不要偏离用户想要的故事！
${buildDesignContextSnippet(ctx)}
请生成初步故事大纲（颗粒度：故事大纲层）。

直接输出Markdown格式（不要用代码块包裹）：

# 用户初步故事大纲

## 基本信息
- **主题**：XXX
- **题材**：XXX
- **叙事视角**：XXX

## 背景设定
（世界背景、时代、环境描述）

## 主要角色
### 主角
- 姓名：XXX
- 身份：XXX
- 性格特点：XXX
- 核心冲突：XXX

### 关键配角
（2-3个主要配角）

## 角色弧光
主角的成长轨迹：从XXX到XXX

## 主线冲突
（核心矛盾是什么）

## 故事结构

### 开端
（故事起点、铺垫设定、触发事件）

### 中段
**阶段一**：（第一次起伏/冲突升级）
**阶段二**：（第二次起伏/矛盾激化或小高潮）

### 结局
（故事收束、矛盾解决）

## 关键情节节点
1. XXX
2. XXX
3. XXX`;
}

export async function initialStoryOutline(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const streamEmit = (ctx as Record<string, unknown>)._streamEmit as
    | ((chunk: string, accumulated: string) => void)
    | undefined;

  const result = await llm.callStreamFull(
    SYSTEM_PROMPT,
    appendUserInstructions(buildUserPrompt(ctx), ctx),
    {},
    streamEmit,
  );
  // 旧版步骤：Markdown 文本包装为结构化对象（向后兼容）
  ctx.initial_story_outline = {
    theme: "",
    background: result.trim(),
    character_arc: "",
    main_conflict: "",
    story_structure: { opening: "", development: [], ending: "" },
    key_plot_points: [],
  };
}
