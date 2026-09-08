/**
 * 自定义专属创作团队契约测试。
 *
 * 守的是四件"错了不报错"的事：
 *   1. 落盘状态机不会停在 distilling（停了用户只能看着转圈）；
 *   2. 蒸馏产物的 stageSkills 键必须是真席位 id（不是就注入不到任何地方）；
 *   3. 注入按席位取段，且不覆盖 IP DNA 算子段（两者是并列增强，不是二选一）；
 *   4. 没蒸馏出某席位技能时不注入（宁缺勿滥）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  createTeam,
  loadTeam,
  listTeams,
  listReadyTeams,
  deleteTeam,
  markReady,
  isSafeTeamId,
} from "../store.js";
import { bookUidFor, teamDisplayName, type DistilledProfile, type TeamRecord } from "../types.js";
import { distillTeam, normalizeProfile, validateProfile } from "../distill.js";
import { SKILL_TARGET_SEATS, type BookEvidence, type DistillEvidence } from "../distill-prompts.js";
import { DISTILL_SEATS, distillSeatForKind } from "../distill-seats.js";
import { buildCustomTeamFragment, setCustomTeamProfile } from "../injection.js";
import { templateDigest, operatorDigest } from "../ip-dna-bridge.js";
import { getSeat, getSeatForAgent } from "../../pipeline/routing/assistant-seats.js";
import { composeSystemPrompt } from "../../pipeline/runtime/prompt-composer.js";
import { PLOT_GENERATION_COMPOSER } from "../../pipeline/steps/plot-generation.js";
import { CHARACTER_ENRICHMENT_COMPOSER } from "../../pipeline/steps/character-enrichment.js";
import { prepareInjection } from "../../ip-dna/injection/operator-injection.js";
import type { NarrativeContext } from "../../types/index.js";
import type { LLMClient } from "../../pipeline/runtime/llm-client.js";

let cwd: string;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "team-store-"));
});
afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

/** 一份最小可用 profile：只给情节席技能，用来验证"按席位取段"。 */
function sampleProfile(over: Partial<DistilledProfile> = {}): DistilledProfile {
  return {
    displayName: "《雾港》模板创作助手",
    summary: "擅长以物证推进悬疑",
    signatureTraits: ["转折靠物证而非顿悟"],
    taboos: ["不写内心独白式解谜"],
    structureTemplate: "三段各以一次误判收束",
    stageSkills: { plot: "每个节点落一件可被观众复核的物证" },
    operatorUids: ["OP::1"],
    ...over,
  };
}

describe("团队落盘（store）", () => {
  it("建团队默认 draft，作者顾问默认开百科娘检索", () => {
    const book = createTeam({ kind: "book_template", source: "雾港", books: [{ title: "雾港" }] }, cwd);
    expect(book.status).toBe("draft");
    // 单本蒸馏的材料全在用户上传里，不需要检索。
    expect(book.useEncyclopedia).toBe(false);
    expect(book.books[0]!.bookUid).toBe(bookUidFor("雾港"));

    const author = createTeam({ kind: "author_advisor", source: "余华" }, cwd);
    // 作者本人的资料不在上传里，只能检索——所以这一类默认开。
    expect(author.useEncyclopedia).toBe(true);
  });

  it("列表按新建在前，ready 过滤只放有 profile 的", () => {
    const a = createTeam({ kind: "book_template", source: "A", books: [{ title: "A" }] }, cwd);
    const b = createTeam({ kind: "book_template", source: "B", books: [{ title: "B" }] }, cwd);
    expect(listTeams(cwd).map((t) => t.id)).toContain(a.id);
    expect(listReadyTeams(cwd)).toEqual([]);

    markReady(b.id, sampleProfile(), cwd);
    expect(listReadyTeams(cwd).map((t) => t.id)).toEqual([b.id]);

    expect(deleteTeam(b.id, cwd)).toBe(true);
    expect(loadTeam(b.id, cwd)).toBeUndefined();
  });

  it("id 直接进文件名，路径穿越必须被挡住", () => {
    expect(isSafeTeamId("team_abc-1")).toBe(true);
    expect(isSafeTeamId("../etc/passwd")).toBe(false);
    expect(() => loadTeam("../x", cwd)).toThrow(/非法团队 id/);
  });

  it("展示名在没蒸馏时也可读（列表要显示的就是它）", () => {
    const draft = createTeam({ kind: "author_advisor", source: "余华" }, cwd);
    expect(teamDisplayName(draft)).toContain("余华");
    const ready = markReady(draft.id, sampleProfile({ displayName: "余华创作顾问" }), cwd)!;
    expect(teamDisplayName(ready)).toBe("余华创作顾问");
  });
});

describe("蒸馏两席（2.4.1 / 2.4.2）", () => {
  it("两席各产出一种团队成员，作者顾问声明依赖百科娘", () => {
    expect(DISTILL_SEATS.map((s) => s.featureId)).toEqual(["2.4.1", "2.4.2"]);
    expect(distillSeatForKind("book_template").id).toBe("book_template_distill");
    // 这条依赖就是方案里"百科娘要排在 2.4.2 之前"的落点，写死在表里防回退。
    expect(distillSeatForKind("author_advisor").dependsOnSeats).toContain("encyclopedia");
    expect(getSeat("encyclopedia")?.status).toBe("active");
  });

  it("可注入席位全部是真席位 id", () => {
    for (const target of SKILL_TARGET_SEATS) {
      expect(getSeat(target.seatId), target.seatId).toBeDefined();
    }
  });
});

describe("蒸馏产物校验与归一", () => {
  const record = {
    id: "t1",
    kind: "book_template",
    source: "雾港",
    books: [],
    authorMaterials: [],
    useEncyclopedia: false,
    status: "distilling",
    createdAt: "",
    updatedAt: "",
  } as TeamRecord;

  const evidence: DistillEvidence = {
    books: [
      {
        title: "雾港",
        bookUid: bookUidFor("雾港"),
        templateDigest: "- 主题：赎罪",
        operatorDigest: "- [OP::1] 物证转折：靠可复核的物件推进",
        operatorUids: ["OP::1"],
      },
    ],
  };

  it("缺 displayName / 空签名 / 空技能都要抛（触发重试）", () => {
    expect(() => validateProfile(JSON.stringify({ signatureTraits: ["a"], stageSkills: { plot: "x" } })))
      .toThrow(/displayName/);
    expect(() => validateProfile(JSON.stringify({ displayName: "x", signatureTraits: [], stageSkills: { plot: "y" } })))
      .toThrow(/signatureTraits/);
    // 一个技能都注入不了的 profile 等于没蒸馏出东西，必须重试而不是落盘。
    expect(() => validateProfile(JSON.stringify({ displayName: "x", signatureTraits: ["a"], stageSkills: {} })))
      .toThrow(/stageSkills/);
  });

  it("归一化丢掉假席位键与编造的算子 uid", () => {
    const profile = normalizeProfile(
      {
        displayName: "《雾港》模板创作助手",
        signatureTraits: ["物证转折"],
        taboos: [],
        structureTemplate: "三段",
        methodology: "不该留下的方法论",
        stageSkills: {
          plot: "落物证",
          // step id 而非席位 id：注入按席位取段，留着它永远命中不了。
          plot_generation: "会被丢掉",
          all: "会被丢掉",
        },
        operatorUids: ["OP::1", "OP::编造的"],
      },
      record,
      evidence,
    );

    expect(Object.keys(profile.stageSkills)).toEqual(["plot"]);
    expect(profile.operatorUids).toEqual(["OP::1"]);
    // 单本蒸馏留骨架、丢方法论：两个都留会让顾问带上某一本书的骨架。
    expect(profile.structureTemplate).toBe("三段");
    expect(profile.methodology).toBeUndefined();
  });

  it("跨作品蒸馏反过来：留方法论、丢骨架", () => {
    const profile = normalizeProfile(
      {
        signatureTraits: ["反复失败后的一次让步"],
        structureTemplate: "不该留下的骨架",
        methodology: "以失败推进弧光",
        stageSkills: { character: "配欲望与缺口" },
      },
      { ...record, kind: "author_advisor", source: "余华" },
      evidence,
    );
    expect(profile.methodology).toBe("以失败推进弧光");
    expect(profile.structureTemplate).toBeUndefined();
    // 展示名缺省要能兜出来，否则列表出现无名条目。
    expect(profile.displayName).toBe("余华创作顾问");
  });
});

describe("蒸馏执行链状态机", () => {
  function stubLlm(reply: string | (() => Promise<string>)): LLMClient {
    return {
      callWithRetry: async (
        _s: string,
        _u: string,
        _o: unknown,
        parse?: (raw: string) => unknown,
      ) => {
        const raw = typeof reply === "string" ? reply : await reply();
        parse?.(raw);
        return raw;
      },
    } as unknown as LLMClient;
  }

  const okReply = JSON.stringify({
    displayName: "《雾港》模板创作助手",
    summary: "以物证推进",
    signatureTraits: ["物证转折"],
    taboos: ["不写独白解谜"],
    structureTemplate: "三段",
    stageSkills: { plot: "落物证" },
    operatorUids: ["OP::1"],
  });

  const bookEvidence: BookEvidence = {
    title: "雾港",
    bookUid: bookUidFor("雾港"),
    templateDigest: "- 主题：赎罪",
    operatorDigest: "- [OP::1] 物证转折",
    operatorUids: ["OP::1"],
    ipDnaRunId: "20260101_雾港",
  };

  it("跑通后落 ready，并把提炼 run 键回填进书籍分组", async () => {
    const team = createTeam({ kind: "book_template", source: "雾港", books: [{ title: "雾港" }] }, cwd);
    const done = await distillTeam(team, {
      llm: stubLlm(okReply),
      extractBook: async () => bookEvidence,
      cwd,
    });

    expect(done.status).toBe("ready");
    expect(done.profile?.stageSkills.plot).toBe("落物证");
    // 回填 run 键是"日后能回到提炼产物"的唯一线索，丢了就只能重跑一遍。
    expect(loadTeam(team.id, cwd)!.books[0]!.ipDnaRunId).toBe("20260101_雾港");
  });

  it("提炼全挂时落 failed 且带原因，不会停在 distilling", async () => {
    const team = createTeam({ kind: "book_template", source: "雾港", books: [{ title: "雾港" }] }, cwd);
    const done = await distillTeam(team, {
      llm: stubLlm(okReply),
      extractBook: async () => {
        throw new Error("文件编码坏了");
      },
      cwd,
    });

    expect(done.status).toBe("failed");
    expect(done.errorMessage).toMatch(/没有产出可用证据/);
    expect(loadTeam(team.id, cwd)!.status).toBe("failed");
  });

  it("三本里挂一本仍按两本蒸馏（不因一本坏放弃全部）", async () => {
    const team = createTeam(
      { kind: "author_advisor", source: "余华", books: [{ title: "A" }, { title: "B" }, { title: "坏" }] },
      cwd,
    );
    let seen = 0;
    const done = await distillTeam(team, {
      llm: stubLlm(
        JSON.stringify({
          displayName: "余华创作顾问",
          signatureTraits: ["以失败推进"],
          methodology: "反复失败后的让步",
          stageSkills: { character: "配欲望与缺口" },
        }),
      ),
      extractBook: async (book) => {
        seen += 1;
        if (book.title === "坏") throw new Error("挂了");
        return { ...bookEvidence, title: book.title, bookUid: book.bookUid };
      },
      cwd,
    });

    expect(seen).toBe(3);
    expect(done.status).toBe("ready");
  });

  it("百科娘检索失败不阻断蒸馏（退化为没有外部资料）", async () => {
    const team = createTeam(
      { kind: "author_advisor", source: "余华", books: [{ title: "A" }], useEncyclopedia: true },
      cwd,
    );
    let userPrompt = "";
    const llm = {
      callWithRetry: async (_s: string, u: string) => {
        userPrompt = u;
        return JSON.stringify({
          displayName: "余华创作顾问",
          signatureTraits: ["以失败推进"],
          stageSkills: { character: "配欲望与缺口" },
        });
      },
    } as unknown as LLMClient;

    const done = await distillTeam(team, {
      llm,
      extractBook: async (book) => ({ ...bookEvidence, title: book.title, bookUid: book.bookUid }),
      retrieveAuthorInfo: async () => {
        throw new Error("没有联网通道");
      },
      cwd,
    });

    expect(done.status).toBe("ready");
    // 检索没结果时必须明写"不得以记忆补充"，否则模型会拿印象当事实。
    expect(userPrompt).toContain("不得以记忆补充");
  });

  it("完全没有材料时直接 failed，不白跑一次 LLM", async () => {
    const team = createTeam({ kind: "author_advisor", source: "余华" }, cwd);
    let called = false;
    const done = await distillTeam(team, {
      llm: stubLlm(async () => {
        called = true;
        return okReply;
      }),
      extractBook: async () => bookEvidence,
      cwd,
    });
    expect(called).toBe(false);
    expect(done.status).toBe("failed");
    expect(done.errorMessage).toMatch(/没有任何材料/);
  });
});

describe("注入（按席位取段，不排挤算子）", () => {
  it("只给蒸馏出技能的那一席，其余席位一字不注入", () => {
    const ctx = {} as NarrativeContext;
    setCustomTeamProfile(ctx, sampleProfile());

    // plot 席的通用实现是 plot_generation：注入按席位解析，所以变体自动覆盖。
    expect(getSeatForAgent("plot_generation")?.id).toBe("plot");
    const plotFragment = buildCustomTeamFragment(ctx, "plot_generation");
    expect(plotFragment).toContain("专属创作团队");
    expect(plotFragment).toContain("落一件可被观众复核的物证");
    expect(plotFragment).toContain("禁区");

    // 没为角色席蒸馏出技能 → 宁缺勿滥，一个字都不给。
    expect(buildCustomTeamFragment(ctx, "character_enrichment")).toBe("");
  });

  it("骨架只发给管宏观形态的两席", () => {
    const ctx = {} as NarrativeContext;
    setCustomTeamProfile(ctx, sampleProfile({
      stageSkills: { outline: "按单元切", plot: "落物证" },
    }));
    expect(buildCustomTeamFragment(ctx, "story_framework")).toContain("结构骨架");
    // 分镜、道具这类局部席位不该被整本书的架构挤占材料预算。
    expect(buildCustomTeamFragment(ctx, "plot_generation")).not.toContain("结构骨架");
  });

  it("没选团队时零影响", () => {
    expect(buildCustomTeamFragment({} as NarrativeContext, "plot_generation")).toBe("");
  });

  it("prepareInjection 把片段落到两条装配路径上，且与算子段并存", async () => {
    const ctx = {} as NarrativeContext;
    setCustomTeamProfile(ctx, sampleProfile());
    const raw = ctx as unknown as Record<string, unknown>;
    // 先放一段既有算子内容，验证专属团队是追加而不是覆盖。
    raw._operator_injection = { plot_generation: "## IP DNA 算子注入\n既有算子段" };
    raw._operator_injection_sections = { plot_generation: { operators: "## IP DNA 算子注入\n既有算子段" } };

    await prepareInjection(ctx, "plot_generation", {} as unknown as LLMClient);

    const append = (raw._operator_injection as Record<string, string>).plot_generation;
    const sections = (raw._operator_injection_sections as Record<string, { operators?: string }>).plot_generation;
    for (const text of [append, sections.operators!]) {
      expect(text).toContain("既有算子段");
      expect(text).toContain("专属创作团队");
    }
  });

  it("真实提示词装配路径能拿到它（两条路各验一次）", async () => {
    // 情节席（有 {{slot:operators}} 的结构化装配）与角色席（末尾 append）各走一条路，
    // 两条都从同一份 ctx._operator_injection* 取内容——所以两条都必须命中。
    const ctx = {} as NarrativeContext;
    setCustomTeamProfile(ctx, sampleProfile({
      stageSkills: { plot: "落一件可被观众复核的物证", character: "配欲望与缺口" },
    }));
    await prepareInjection(ctx, "plot_generation", {} as unknown as LLMClient);
    await prepareInjection(ctx, "character_enrichment", {} as unknown as LLMClient);

    const plotPrompt = composeSystemPrompt(PLOT_GENERATION_COMPOSER, ctx);
    expect(plotPrompt).toContain("专属创作团队");
    expect(plotPrompt).toContain("可被观众复核的物证");

    const charPrompt = composeSystemPrompt(CHARACTER_ENRICHMENT_COMPOSER, ctx);
    expect(charPrompt).toContain("专属创作团队");
    expect(charPrompt).toContain("配欲望与缺口");
  });

  it("重复 prepareInjection 不会把同一段注入两遍", async () => {
    const ctx = {} as NarrativeContext;
    setCustomTeamProfile(ctx, sampleProfile());
    await prepareInjection(ctx, "plot_generation", {} as unknown as LLMClient);
    await prepareInjection(ctx, "plot_generation", {} as unknown as LLMClient);

    const append = (ctx as unknown as Record<string, unknown>)._operator_injection as Record<string, string>;
    const occurrences = append.plot_generation.split("专属创作团队").length - 1;
    expect(occurrences).toBe(1);
  });
});

describe("IP 提炼摘要", () => {
  it("模板缺失与空字段都给出可读的占位，不静默产出空证据", () => {
    expect(templateDigest(undefined)).toContain("提炼未产出模板");
    expect(templateDigest({ core_elements: {} } as never)).toContain("模板字段为空");
  });

  it("算子摘要带 uid 且截到 40 条（噪声过多会让归纳更泛）", () => {
    const ops = Array.from({ length: 50 }, (_, i) => ({
      uid: `OP::${i}`,
      name: `算子${i}`,
      definition: "定义",
    }));
    const digest = operatorDigest(ops as never);
    expect(digest.uids).toHaveLength(40);
    expect(digest.text).toContain("[OP::0]");
    expect(digest.text).not.toContain("[OP::45]");
  });
});
