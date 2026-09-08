/**
 * expert-agents.ts —— 品类专家 = 席位管线的编排（无硬编码步序）
 *
 * 产品侧的说法是「专家组是预制工作流」，而工作流的内容由
 * narrative-pipelines.ts 的四条席位管线定义。所以专家这一层**不该有自己的步序**：
 * 它只是「品类 → 四条之一」的映射加一个 composite 外壳。
 *
 * ─────────────────────────────────────────────────────────────────
 * 这里替掉了什么
 * ─────────────────────────────────────────────────────────────────
 * 原先 tpl-jrpg / expert.jrpg 两个 composite 的 children 直接摊平
 * templates.ts 的 JRPG_PIPELINE_STEPS。那是一份独立的步序事实源，与
 * resolveSeatStepGroups 各说各话——专家节点连出来的还是老步序，正是
 * 「管线已经换了、专家却没换」的根源。现在两者同源。
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么 117 个品类各注册一个 def，而不是只注册四条管线
 * ─────────────────────────────────────────────────────────────────
 * 画布上的专家节点 catalogId 是 `expert.genre.<code>`（见前端 genreExpertItem），
 * 单 agent 入口按这个 id 查 AgentDef 来 announce 子步。只注册四条管线的话，
 * 拖一个品类专家进画布就查不到定义。注册动作本身是数据映射，不是代码——
 * 加品类只需改 GENRE_TAXONOMY。
 */
import {
  GENRE_TAXONOMY,
  findGenreByCode,
  getGenreDisplayName,
  type ContentLocale,
} from "../../knowledge/genre-taxonomy.js";
import { registerAgentDef } from "../blueprint/agent-def-registry.js";
import { makeCompositeAgentDef } from "../blueprint/runners/composite-runner.js";
import type { AgentDef } from "../blueprint/types.js";
import {
  NARRATIVE_PIPELINES,
  expandPipelineSteps,
  resolveNarrativePipeline,
  type NarrativePipeline,
} from "./narrative-pipelines.js";
import type { TierId } from "../../types/index.js";

/**
 * 专家的对外显示名。
 *
 * 单一出处很重要：AgentDef 的 name、/genres 的 expert_name、画布上专家容器的标题
 * 必须是同一个字符串。上一版三处各自拼名字，画布顶上于是写着管线内部名
 * 「叙事管线（分镜）」，用户拖进来的却是「互动叙事专家」，看着像跑错了东西。
 *
 * 构词与顶栏调色板的 `nav.suffix.expert` 一致（`{品类}专家`）：用户点的是「互动叙事专家」，
 * 画布上就该还是这四个字。品类查不到时退回「其他品类叙事专家」——那正是无品类专家项的名字，
 * 后端识别出品类后会按品类重新路由，届时这个名字也随之变准。
 */
export function expertDisplayName(
  genreCode: string | null | undefined,
  _tier?: TierId,
  locale: ContentLocale = "zh",
): string {
  const entry = genreCode ? findGenreByCode(genreCode) : undefined;
  if (!entry) return locale === "en" ? "General Narrative Expert" : "其他品类叙事专家";
  const name = getGenreDisplayName(entry, locale);
  return locale === "en" ? `${name} expert` : `${name}专家`;
}

/**
 * 席位管线 → composite 的 children/edges。
 *
 * 边是纯串行链：CSV 的环节一环接一环，并行发生在单个 agent 内部
 * （角色/道具的分批、场景树的同层并发），不在管线层展开。所以这里不给
 * parallelGroups——给了等于宣称管线层有并行，与 resolveSeatStepGroups 不符。
 */
function compositeConfigFor(pipeline: NarrativePipeline): {
  children: string[];
  edges: Array<{ source: string; target: string }>;
} {
  const children = expandPipelineSteps(pipeline);
  const edges = children.slice(0, -1).map((source, i) => ({
    source,
    target: children[i + 1]!,
  }));
  return { children, edges };
}

function expertDef(id: string, name: string, pipeline: NarrativePipeline): AgentDef {
  return makeCompositeAgentDef(id, name, compositeConfigFor(pipeline), {
    prompts: { templateId: pipeline.id, skillSlots: ["style_guide"] },
    io: {
      requiredInputs: ["user_input"],
      outputField: pipeline.id.replace(/-/g, "_"),
    },
  });
}

/**
 * 画布静态目录里的四个专家项（见前端 composerCatalog 的 expert.* 条目）。
 * 它们是常用品类的快捷入口，与 expert.genre.<code> 指向同一条管线。
 */
const STATIC_EXPERT_ALIASES: ReadonlyArray<{
  id: string;
  name: string;
  genreCode: string | null;
  tier: TierId;
}> = [
  { id: "expert.jrpg", name: "JRPG 品类叙事专家", genreCode: "rpg-jrpg", tier: "tier1" },
  { id: "expert.orpg", name: "ORPG 品类叙事专家", genreCode: "rpg-open-world", tier: "tier1" },
  { id: "expert.film_game", name: "影游品类叙事专家", genreCode: "adv-interactive", tier: "tier1" },
  // 无品类：交给层级默认，后端识别出品类后仍会按品类重新路由。
  { id: "expert.other", name: "其他品类叙事专家", genreCode: null, tier: "tier1" },
];

/**
 * 注册全部专家 composite。返回注册的 id。
 *
 * 覆盖三类 id：
 *   pl-*                四条管线本体（可直接被调用/预览）
 *   expert.genre.<code> 117 个品类专家（画布动态目录）
 *   expert.<alias>      画布静态目录的四个快捷项
 * 另加 tpl-jrpg 一个历史别名，供旧画布与旧 checkpoint 仍能解析。
 */
export function registerExpertAgentDefs(): string[] {
  const ids: string[] = [];
  const add = (def: AgentDef): void => {
    registerAgentDef(def);
    ids.push(def.id);
  };

  for (const pipeline of Object.values(NARRATIVE_PIPELINES)) {
    add(expertDef(pipeline.id, pipeline.name, pipeline));
  }

  for (const genre of GENRE_TAXONOMY) {
    const pipeline = resolveNarrativePipeline(genre.code, genre.tier);
    add(expertDef(`expert.genre.${genre.code}`, expertDisplayName(genre.code), pipeline));
  }

  for (const alias of STATIC_EXPERT_ALIASES) {
    const tier = alias.genreCode
      ? findGenreByCode(alias.genreCode)?.tier ?? alias.tier
      : alias.tier;
    add(expertDef(alias.id, alias.name, resolveNarrativePipeline(alias.genreCode ?? "", tier)));
  }

  // 历史别名：旧画布节点与旧 checkpoint 里存的是 tpl-jrpg。
  // 指向同一条管线，不再指向 templates.ts 的 JRPG_PIPELINE_STEPS。
  add(expertDef("tpl-jrpg", "JRPG 品类叙事专家", NARRATIVE_PIPELINES["pl-narrative"]));

  return ids;
}
