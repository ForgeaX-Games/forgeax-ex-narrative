/**
 * custom-team/injection.ts — 把蒸馏出的助手/顾问注入各席位
 *
 * 原话：「这些助手和顾问在生成的各个环节能够结合游戏品类需求调用叙事管线，
 * 并在相应环节注入符合这些助手和顾问的特点技能」。所以注入有两条硬要求：
 *
 *   1. **按环节**：每席只拿写给它的那一段（stageSkills 按席位建键），
 *      不是把整份 profile 铺给所有 step；
 *   2. **不排挤品类技能**：profile 是"这位作者怎么写"，品类技能是"这类游戏要什么"，
 *      两者并列。所以注入的是追加段，不覆盖任何既有段。
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么挂在算子注入这一层
 * ─────────────────────────────────────────────────────────────────
 * 提示词有两条并行的装配路径：声明了 `{{slot:operators}}` 的走 provider 精确填槽，
 * 没声明的走"末尾 append"。两条路都从 `ctx._operator_injection*` 取内容，
 * 所以在那里落一份，两条路自动都覆盖到——在别处各写一遍必然漏掉一条。
 */
import { getSeatForAgent } from "../pipeline/routing/assistant-seats.js";
import type { DistilledProfile } from "./types.js";

/** profile 挂在 ctx 上的键（运行开始时由 server 水合）。 */
export const CUSTOM_TEAM_CTX_KEY = "_custom_team_profile";

/** 吃"结构骨架 / 方法论"这一整段的席位：只有决定宏观形态的两席用得上。 */
const SHAPING_SEATS = new Set(["outline", "structure"]);

interface ProfileHost {
  [CUSTOM_TEAM_CTX_KEY]?: DistilledProfile;
}

export function getCustomTeamProfile(ctx: unknown): DistilledProfile | undefined {
  return (ctx as ProfileHost | undefined)?.[CUSTOM_TEAM_CTX_KEY];
}

export function setCustomTeamProfile(ctx: unknown, profile: DistilledProfile): void {
  (ctx as Record<string, unknown>)[CUSTOM_TEAM_CTX_KEY] = profile;
}

/**
 * 某个 step 该拿到的专属团队片段。
 *
 * 席位维度解析：step → 席位 → stageSkills[席位]。因此一份 profile 自动覆盖该席位在
 * 所有品类/模板下的实现变体（故事情节席在影游下是 vn_screenplay；写这段话时卡牌下
 * 还有 event_pool，已随 C3 封存进 `_archive/specialized/`），不需要逐变体登记。
 *
 * 没有为该席位蒸馏出技能就返回空串 —— 宁缺勿滥：把风格签名硬塞给一个没有依据的环节，
 * 只会让那一环的输出偏离品类要求，而且不报错。
 */
export function buildCustomTeamFragment(ctx: unknown, stepId: string): string {
  const profile = getCustomTeamProfile(ctx);
  if (!profile) return "";
  const seat = getSeatForAgent(stepId);
  if (!seat) return "";
  const skill = profile.stageSkills[seat.id];
  if (!skill || !skill.trim()) return "";

  const parts = [`## 专属创作团队 · ${profile.displayName}`];
  if (profile.summary) parts.push(profile.summary);
  if (profile.signatureTraits.length > 0) {
    parts.push(`### 风格签名（须体现）\n${profile.signatureTraits.map((t) => `- ${t}`).join("\n")}`);
  }
  // 骨架与方法论只发给管宏观形态的两席。它们篇幅长，发给分镜、道具这类局部席位
  // 只会挤占材料预算——那些席位需要的是写给自己的那一段，不是整本书的架构。
  if (SHAPING_SEATS.has(seat.id)) {
    const shaping = profile.structureTemplate ?? profile.methodology;
    if (shaping?.trim()) {
      const label = profile.structureTemplate ? "结构骨架" : "创作方法论";
      parts.push(`### ${label}\n${shaping.trim()}`);
    }
  }
  parts.push(`### 本环节的做法\n${skill.trim()}`);
  if (profile.taboos.length > 0) {
    // 禁区放在最后一段：它是最容易被前面的正向要求盖过去的部分，压轴能提高遵守率。
    parts.push(`### 禁区（不要做）\n${profile.taboos.map((t) => `- ${t}`).join("\n")}`);
  }
  return parts.join("\n\n");
}
