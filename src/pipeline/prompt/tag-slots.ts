/**
 * pipeline/prompt/tag-slots.ts —— 标签选择进提示词第⑦段（上下文输入）的 provider。
 *
 * 六个标签维的去向分两路，这里负责第二路：
 *   1. 世界观底色 / 母题里能换算成轴 code 的词 → 叙事类型 / 叙事题材两轴
 *      （tag-axis-mapping.ts），参与结构投票与策略卡装配；
 *   2. 剩下的母题 / 核心冲突 / 风格基调 / 世界观类型 → **本文件**，
 *      作为结构化创作约束进上下文输入段。
 *
 * 为什么第二路必须有自己的通道：这四维在 19 个题材 code 与 14 个类型 code 里
 * 都没有对应项，硬往轴上凑只会造出假映射。但它们是用户显式表达的创作意图，
 * 不该只作为一句 `母题：救赎；核心冲突：人vs命运` 混在需求原文里 ——
 * 混在原文里时模型无从判断这是"用户点名要的"还是"顺口提了一句"。
 */
import type { NarrativeContext, NarrativeTags } from "../../types/index.js";
import type { FragmentProvider } from "./providers.js";

/**
 * 标签维 → 提示词里的中文标目。
 *
 * 与 viz 的 TAG_DIMENSIONS.nameKey 是两份东西：那边是 i18n 键（界面按用户语言显示），
 * 这边是**写进提示词的**标目，固定中文 —— 生成内容的语言由 content_locale 控制，
 * 但给模型看的约束标目保持稳定，免得换个界面语言就换一套 prompt 措辞。
 */
const TAG_DIMENSION_LABELS: Readonly<Record<string, string>> = {
  theme: "母题",
  genre: "世界观底色",
  tone: "风格基调",
  conflict: "核心冲突",
  worldtype: "世界观类型",
  custom: "作者补充",
};

/** 标目顺序 = 写进提示词的顺序，从"故事讲什么"到"长什么样"。 */
const TAG_DIMENSION_ORDER = ["theme", "conflict", "tone", "genre", "worldtype", "custom"] as const;

interface TagLine {
  dimension: string;
  label: string;
  value: string;
}

export function collectTagLines(tags: NarrativeTags | null | undefined): TagLine[] {
  if (!tags) return [];
  const lines: TagLine[] = [];
  for (const dim of TAG_DIMENSION_ORDER) {
    const picked = tags.selections?.[dim]?.trim();
    const custom = tags.customTexts?.[dim]?.trim();
    const value = [picked, custom].filter(Boolean).join(" / ");
    if (!value) continue;
    lines.push({ dimension: dim, label: TAG_DIMENSION_LABELS[dim] ?? dim, value });
  }
  return lines;
}

/**
 * 渲染成约束块。空标签 → 空串 → 整段塌缩（骨架的既有行为）。
 */
export function buildNarrativeTagsBlock(ctx: NarrativeContext): string {
  const lines = collectTagLines(ctx.narrative_tags);
  if (lines.length === 0) return "";

  const body = lines.map((l) => `- ${l.label}：${l.value}`).join("\n");
  return `### 作者指定的创作坐标（逐条落实，不得漏项）

${body}

这几条是作者在标签里显式勾选的，不是可有可无的氛围描述：
母题与核心冲突要在情节的因果链上真实成立（不能只在台词里被提到），
风格基调与世界观要贯穿到场景、用词和人物言行。`;
}

export const narrativeTagsProvider: FragmentProvider = {
  slot: "material",
  name: "narrative-tags",
  provide({ ctx }) {
    return buildNarrativeTagsBlock(ctx);
  },
};
