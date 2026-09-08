import { describe, it, expect } from "vitest";
import { composeSystemPrompt, type PromptComposer } from "../runtime/prompt-composer.js";
import type { NarrativeContext } from "../../types/index.js";
import { buildIpSourceReference } from "../steps/design-context-helper.js";
import { PREFERENCE_SUMMARY_COMPOSER } from "../steps/user-preference-summary.js";
import { INITIAL_PLAN_COMPOSER } from "../steps/initial-plan.js";
import { WORLDVIEW_COMPOSER } from "../steps/worldview-construction.js";
import { CHARACTER_ENRICHMENT_COMPOSER } from "../steps/character-enrichment.js";
import { ITEM_DATABASE_COMPOSER } from "../steps/item-database.js";
import { SCENE_PLAN_COMPOSER } from "../steps/scene-plan.js";
import { SCRIPT_SCENE_EXPAND_COMPOSER } from "../steps/script-scene-generation.js";
import { LORE_GENERATION_COMPOSER } from "../steps/lore-generation.js";
import { NARRATIVE_CARD_COMPOSER } from "../steps/narrative-card.js";

/**
 * 上传原作时各席的处置口径（席位表 2.3.1-2.3.13 的「如果上传的是文件」分支）。
 *
 * 设定层各席的原文写的是「直接提炼文件里的内容即可」——职责是抽取归档；
 * 结构层各席才是改编重组。两者用错口径的后果相反：给世界观席下"重组"指令会让它
 * 改写原作设定，给大纲席下"不得改写"会让它不敢做游戏化重构。这里把两种口径
 * 各钉一颗钉子，避免以后新增席位随手抄错那一个。
 */

/** 设定层：提炼口径。 */
const EXTRACT_SEATS: Array<[string, PromptComposer]> = [
  ["需求清单", PREFERENCE_SUMMARY_COMPOSER],
  ["策划文档", INITIAL_PLAN_COMPOSER],
  ["世界观", WORLDVIEW_COMPOSER],
  ["角色档案", CHARACTER_ENRICHMENT_COMPOSER],
  ["道具清单", ITEM_DATABASE_COMPOSER],
  ["场景列表", SCENE_PLAN_COMPOSER],
  ["剧本场景耦合:展开", SCRIPT_SCENE_EXPAND_COMPOSER],
  ["设定集", LORE_GENERATION_COMPOSER],
  ["叙事卡", NARRATIVE_CARD_COMPOSER],
];

function ctxWithUpload(overrides: Partial<NarrativeContext> = {}): NarrativeContext {
  return {
    user_input: "把这本小说改成 JRPG",
    uploaded_script: {
      content: "第一章　临安城的雨下了三天。沈砚之提着灯，踏进了藏书阁。",
      format: "prose",
      char_count: 28,
    },
    ...overrides,
  } as unknown as NarrativeContext;
}

describe("上传原作时的处置口径分层", () => {
  it("无上传原文时整块塌缩，纯生成行为不变", () => {
    const bare = { user_input: "写个故事" } as unknown as NarrativeContext;
    expect(buildIpSourceReference(bare, "extract")).toBe("");
    expect(buildIpSourceReference(bare, "adapt")).toBe("");
    for (const [name, composer] of EXTRACT_SEATS) {
      const sp = composeSystemPrompt(composer, bare);
      expect(sp, name).not.toContain("IP 原文参考");
      expect(sp, name).not.toContain("{{slot:");
    }
  });

  it("提炼口径要求沿用原名、只在原作未涉及处补写", () => {
    const text = buildIpSourceReference(ctxWithUpload(), "extract");
    expect(text).toContain("提炼基准");
    expect(text).toContain("直接沿用其名称与原义");
    expect(text).toContain("原作未涉及");
    // 提炼口径不得出现结构层那句"做必要重组"，否则等于放行改写设定
    expect(text).not.toContain("必要重组");
  });

  it("改编口径保留情节重组授权，且为默认值", () => {
    const ctx = ctxWithUpload();
    const text = buildIpSourceReference(ctx, "adapt");
    expect(text).toContain("忠实改编基准");
    expect(text).toContain("仅在游戏化结构（节点/分支/单元）层面做必要重组");
    expect(buildIpSourceReference(ctx)).toBe(text);
  });

  for (const [name, composer] of EXTRACT_SEATS) {
    it(`[${name}] 有上传原作时拿到的是提炼口径，不是改编口径`, () => {
      const sp = composeSystemPrompt(composer, ctxWithUpload());
      expect(sp).toContain("提炼基准");
      expect(sp).not.toContain("忠实改编基准");
      expect(sp).not.toContain("{{slot:");
    });
  }

  it("英文语种下不串中文块", () => {
    const en = ctxWithUpload({ content_locale: "en" } as Partial<NarrativeContext>);
    const text = buildIpSourceReference(en, "extract");
    expect(text).toContain("extraction baseline");
    expect(text).not.toMatch(/[\u4e00-\u9fff]/);
    expect(buildIpSourceReference(en, "adapt")).toContain("faithful-adaptation baseline");
  });
});
