/**
 * prompt-composer.ts —— ✅ 当前**唯一生产提示词引擎**（P1.2/P1.3 真值订正）。
 * ─────────────────────────────────────────────────────────────────
 * 把"过程性 step + 硬编码 prompt"重构为"声明式 PromptComposer + 薄 Executor"。
 * run() 与 runWithBlueprint 的 legacy 回退均通过本文件的 composeSystemPrompt 生成提示词。
 *
 * ⚠️ 历史修订：早期注释曾标 @deprecated 并建议"改用 blueprint/prompt-resolver.ts +
 *    prompts/agents/*.md"——此为**名实不符**：PromptResolver 是 useNewRunner 实验引擎，
 *    生产从不执行（见其文件头 + pipeline.ts:1179）。那批 md 已于四期吸收并归档到
 *    src/prompts/_archive/（见该目录 README）。
 *
 *    **提示词只有这一个落点**：新增或修改 step 提示词，改对应 step 文件里的
 *    PromptComposer.blocks（含逻辑的块用 (ctx)=>string 函数；静态文案直接写字符串）。
 *    IP DNA 段统一用 IP_DNA_SLOT_BLOCK、叙事策略段统一用 STRATEGY_SLOT_BLOCK，
 *    两者的段序都派生自 skeleton.PROMPT_SLOT_ORDER，不要在 step 里手写。
 *
 * 设计要点：
 *   1. 每个 step 用一份纯数据 PromptComposer 描述 prompt 结构
 *   2. blocks 是命名字符串块，按顺序拼接成最终 prompt
 *   3. 部分 block 内含 {{SKILL.<slot_name>}} 占位符，运行时被 skill.slots 填充
 *   4. skillSlots 显式声明哪些 slot 接受注入（白名单）
 *   5. 特异化 step 通过 skillSlots: [] 显式拒绝 skill 注入
 *
 * Skill 注入解析顺序：
 *   1. 优先用 skill.stepSkills[stepId].slots[<slotName>] 替换 {{SKILL.<slotName>}}
 *   2. 若 skill 仅提供 systemPromptAddition（旧形态），append 到 system prompt 末尾
 *   3. 未填充的 {{SKILL.*}} 占位符替换为空串（不留痕迹）
 */
import type { NarrativeContext } from "../../types/index.js";
import { getStepSkill } from "../../knowledge/game-narrative/skill-loader.js";
import type { StepSkillBlock } from "../../knowledge/game-narrative/skill-types.js";
import { getInjectedFragment } from "../../ip-dna/injection/operator-injection.js";
import { hasIpDnaPlaceholders, hasStrategyPlaceholders, renderPlaceholders } from "../prompt/syntax.js";
import { buildSlotMap, buildDataHelpers } from "../prompt/providers.js";
import { PROMPT_SLOT_ORDER, type PromptSlot } from "../prompt/skeleton.js";

/**
 * §7.2b 统一提示词骨架的 IP DNA 一等插槽块（客观真相→三视角算子→关系→账本，段序固定）。
 *
 * 用法：消费算子的 step 把本块加入 PromptComposer.blocks 并在 systemBlockOrder 中
 * 置于「身份」之后、「品类风格/约束」之前，即可让 IP DNA 注入从"末尾 append"
 * 升级为骨架内结构化插槽（位置正确、与 step 角色设定融合）。
 *
 * 非 IP DNA 驱动的常规生成：各插槽 provider 返空 → 占位渲染为空 → 整块塌缩消失，
 * 行为与未声明本块时完全一致（零副作用）。
 *
 * 段序唯一事实源：直接从 skeleton.ts 的 PROMPT_SLOT_ORDER 派生（过滤出 IP DNA 四段），
 * 各 step 不再各自决定 IP DNA 段内顺序——改骨架即改全局，杜绝漂移。
 */
const IP_DNA_SLOTS: readonly PromptSlot[] = ["objective_truth", "operators", "relations", "ledger"];

export const IP_DNA_SLOT_BLOCK = PROMPT_SLOT_ORDER.filter((slot) =>
  IP_DNA_SLOTS.includes(slot),
)
  .map((slot) => `{{slot:${slot}}}`)
  .join("\n\n");

/**
 * 骨架第 ③ 段「叙事策略」的四子槽块（品类→类型→题材→结构，段序固定）。
 *
 * 用法与 IP_DNA_SLOT_BLOCK 对称：吃策略卡的 step 把本块加进 blocks，并在
 * systemBlockOrder 中置于「身份/任务」之后、「IP DNA」之前。
 *
 * 只有 STEP_TO_STRATEGY_STAGE 里登记的四个环节会拿到内容（需求清单 / 策划文档 /
 * 故事大纲 / 故事结构）；其余 step 即便声明也全部渲染为空、整块塌缩，行为与未声明一致。
 * 四轴中任一轴缺策略卡同样只是该子槽为空，不影响其余三轴。
 */
const STRATEGY_SLOTS: readonly PromptSlot[] = [
  "strategy_genre",
  "strategy_type",
  "strategy_theme",
  "strategy_structure",
];

export const STRATEGY_SLOT_BLOCK = PROMPT_SLOT_ORDER.filter((slot) =>
  STRATEGY_SLOTS.includes(slot),
)
  .map((slot) => `{{slot:${slot}}}`)
  .join("\n\n");

/**
 * 一个 step 的 prompt 蓝图。
 */
export interface PromptComposer {
  /** Step ID（与 STEP_IDS 对应），用于查找对应的 skill block */
  stepId: string;

  /**
   * 命名字符串块，按 systemBlockOrder/userBlockOrder 拼接。
   * 块内可使用 {{SKILL.<slotName>}} 占位符引用 skill slot 内容。
   */
  blocks: Record<string, string | ((ctx: NarrativeContext) => string)>;

  /**
   * System prompt 中包含的 block 顺序。未列出的 block 不会进入 system prompt。
   */
  systemBlockOrder: string[];

  /**
   * User prompt 中包含的 block 顺序。未列出的 block 不会进入 user prompt。
   */
  userBlockOrder: string[];

  /**
   * 显式开放给 skill 注入的 slot 名称集合（白名单）。
   * 空数组 = 显式拒绝所有 skill 注入（特异化 step）。
   * 非空数组 = 仅这些 slot 的内容会被注入到对应 block。
   */
  skillSlots: string[];
}

const SKILL_PLACEHOLDER = /\{\{SKILL\.([\w_]+)\}\}/g;

function resolveBlock(
  block: string | ((ctx: NarrativeContext) => string),
  ctx: NarrativeContext,
): string {
  return typeof block === "function" ? block(ctx) : block;
}

function fillSkillPlaceholders(
  text: string,
  skillBlock: StepSkillBlock | null,
  allowedSlots: string[],
): string {
  return text.replace(SKILL_PLACEHOLDER, (_, slotName: string) => {
    if (!skillBlock?.slots) return "";
    if (!allowedSlots.includes(slotName)) return "";
    return skillBlock.slots[slotName] ?? "";
  });
}

function joinNonEmpty(parts: string[]): string {
  return parts.filter((p) => p && p.trim().length > 0).join("\n\n");
}

/**
 * 拼装 system prompt：按 systemBlockOrder 串联 blocks，并填充 skill slot。
 * 若 skill 仅有 systemPromptAddition（无 slots），则附加到末尾（向后兼容方案 A）。
 */
export function composeSystemPrompt(
  composer: PromptComposer,
  ctx: NarrativeContext,
): string {
  const genreCode =
    ctx.demand_analysis?.genre_code ??
    ctx.tier_detection?.genre_code ??
    null;
  const skillBlock = genreCode ? getStepSkill(genreCode, composer.stepId) : null;
  const allowed = composer.skillSlots;

  const sysParts: string[] = [];
  for (const name of composer.systemBlockOrder) {
    const raw = composer.blocks[name];
    if (raw === undefined) continue;
    const resolved = resolveBlock(raw, ctx);
    sysParts.push(fillSkillPlaceholders(resolved, skillBlock, allowed));
  }
  let sp = joinNonEmpty(sysParts);

  if (skillBlock?.systemPromptAddition && allowed.length > 0) {
    sp += `\n\n## 🎭 品类专属指引（${genreCode}）\n${skillBlock.systemPromptAddition}`;
  }

  // IP DNA 注入双轨（与 PromptResolver.renderSystemPrompt 一致）：
  //   - 模板声明了结构化插槽（{{slot:operators}} 等）→ provider 按骨架插槽精确填充
  //     （§7.2b：客观真相→三视角算子→关系→账本，位置与 step 角色融合）；
  //   - 未声明 → 退回"末尾 append"兼容旧行为。
  // 只声明策略段的 step 也要走渲染，否则 {{slot:strategy_*}} 会原样留在提示词里；
  // 但"末尾 append"的判定仍只看 IP DNA，避免这类 step 的 IP DNA 行为被顺带改掉。
  const hadIpDnaSlots = hasIpDnaPlaceholders(sp);
  if (hadIpDnaSlots || hasStrategyPlaceholders(sp)) {
    const slots = buildSlotMap(ctx, composer.stepId);
    sp = renderPlaceholders(sp, { ctx, slots, data: buildDataHelpers(ctx) })
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  if (!hadIpDnaSlots) {
    const injected = getInjectedFragment(ctx, composer.stepId);
    if (injected) sp += `\n\n${injected}`;
  }

  return sp;
}

/**
 * 拼装 user prompt：按 userBlockOrder 串联 blocks，同样支持 skill slot 注入。
 */
export function composeUserPrompt(
  composer: PromptComposer,
  ctx: NarrativeContext,
): string {
  const genreCode =
    ctx.demand_analysis?.genre_code ??
    ctx.tier_detection?.genre_code ??
    null;
  const skillBlock = genreCode ? getStepSkill(genreCode, composer.stepId) : null;
  const allowed = composer.skillSlots;

  const userParts: string[] = [];
  for (const name of composer.userBlockOrder) {
    const raw = composer.blocks[name];
    if (raw === undefined) continue;
    const resolved = resolveBlock(raw, ctx);
    userParts.push(fillSkillPlaceholders(resolved, skillBlock, allowed));
  }
  return joinNonEmpty(userParts);
}

/**
 * 调试辅助：序列化 composer 用于日志/单元测试。
 */
export function describeComposer(composer: PromptComposer): {
  stepId: string;
  systemBlocks: string[];
  userBlocks: string[];
  skillSlots: string[];
} {
  return {
    stepId: composer.stepId,
    systemBlocks: composer.systemBlockOrder,
    userBlocks: composer.userBlockOrder,
    skillSlots: composer.skillSlots,
  };
}
