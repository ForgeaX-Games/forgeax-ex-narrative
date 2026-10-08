import { describe, it, expect, vi } from "vitest";
import { executableStepFn, executableStepIds } from "../core/pipeline.js";
import { STEP_REGISTRY } from "../core/step-registry.js";
import { executeAgent } from "../core/agent-exec.js";
import { getAgentDef } from "../blueprint/agent-def-registry.js";
import type { NarrativeContext } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import "../core/step-registrations.js";
import "../blueprint/agent-def-registrations.js";

/**
 * 执行内核并轨的护栏。
 *
 * run() / rerunFromStep() / runWithBlueprint() / 单 agent HTTP 入口现在都经
 * executeAgent 派发，它按 AgentDef 决定走 runner 还是 step 函数。这带来两条
 * 必须守住的不变量，否则并轨会静默改变产出：
 *
 *   1. run() 能跑的每个 step 都在 STEP_REGISTRY 登记——不登记就派发不了；
 *   2. 两处登记的是同一个函数——否则「换派发口径」等于「换实现」。
 */
describe("执行内核并轨", () => {
  it("可执行的 step 都在 StepDescriptor 注册表里", () => {
    const unregistered = executableStepIds().filter((id) => !STEP_REGISTRY.has(id));
    expect(unregistered, "以下 step 有 fn 但没登记，executeAgent 派发不了").toEqual([]);
  });

  it("run() 用的 fn 与注册表登记的 fn 是同一个函数", () => {
    const mismatched = executableStepIds().filter(
      (id) => executableStepFn(id) !== STEP_REGISTRY.get(id)?.fn,
    );
    expect(mismatched, "两处指向了不同实现").toEqual([]);
  });

  it("派发落到 legacy step 函数，且产出写回 ctx", async () => {
    // 取一个尚未迁移到 runner 的多阶段步：story_framework 已切 runner（M3），不能再用它验证 legacy 分支。
    const desc = STEP_REGISTRY.get("outline_batch")!;
    const original = desc.fn;
    const spy = vi.fn(async (ctx: NarrativeContext) => {
      (ctx as Record<string, unknown>)[desc.outputFields[0]!] = { ok: true };
    });
    // 直接改注册表里的 fn：这正是并轨后 executeAgent 取实现的地方，
    // 能被拦到就说明派发真的经过了注册表而不是绕开它。
    (desc as { fn: unknown }).fn = spy;
    try {
      const ctx = {} as NarrativeContext;
      const outcome = await executeAgent("outline_batch", ctx, {} as LLMClient);
      expect(spy).toHaveBeenCalledOnce();
      expect(outcome.via).toBe("legacy");
      expect(outcome.output).toEqual({ ok: true });
    } finally {
      (desc as { fn: unknown }).fn = original;
    }
  });

  /**
   * 已迁移到 runner 的席位白名单。
   *
   * 加进来的前提是该 step 的落地逻辑（分批、派生字段、修复）已经不在函数体里，
   * 且提示词 system/user 两段都由 PromptComposer 提供——否则切过去会静默丢产出。
   */
  /**
   * 注意：encyclopedia_retrieval 虽已在 M2 迁移（RUNNER_MIGRATIONS 有登记、
   * useNewRunner=true），但它不在 STEP_FNS（pipeline.ts）里——它是按需单独跑的
   * 检索席，不进 run() 的默认步序，只能经单 agent HTTP 入口（executeAgent 直调）
   * 触达。executableStepIds() 只枚举 run() 能跑的 step，故它不出现在这份白名单。
   */
  /**
   * playability_adapt 现在**在**这份白名单里。它曾不在，原因是玩法适配席标 planned、
   * 实现挂在 alsoOwns 上解析不到 AgentDef，只能退回 legacy 路径；随 v4 §2.5.20 转
   * active 后实现进了 bindings，RUNNER_MIGRATIONS 里那条等接回的登记随即生效。
   */
  const ON_RUNNER = [
    "narrative_card", "character_enrichment", "item_database", "quest_generation",
    // M2 原子迁移（12 席，encyclopedia_retrieval / playability_adapt 见上方说明）
    "preference_summary", "preference_analysis", "initial_plan", "worldview",
    "lore_generation", "content_check",
    "deai_polish", "plot_refine", "playability_adapt",
    "structure_check",
    // M3 结构表达：story_framework 内部环拆成 SequenceStage（见下方 SEQUENCE_ON_RUNNER）
    "story_framework",
    // M4 波次原语落地：plot_generation / script_generation 切 wave（见下方 WAVE_ON_RUNNER）
    "plot_generation", "script_generation",
  ];

  /**
   * 分片席位：user 段铺的是**单片**材料，故解析时（`_chunk` 尚不存在）本就没有
   * 完整 user prompt，逐片装配由 ChunkedRunner 负责。它们的 user 段由
   * runner-migration.test.ts 用真实分片数据对照 legacy 逐字校验。
   */
  const CHUNKED_ON_RUNNER = [
    "quest_generation", "deai_polish", "plot_refine", "playability_adapt",
  ];

  /**
   * 波次席位：与分片席位同一处境——user 段铺的是**单元**材料，解析时 `_chunk`
   * 尚不存在，逐单元装配由 WaveRunner 负责。与 CHUNKED_ON_RUNNER 合并处理
   * （下面"提示词不为空"测试只核 system 段）。
   */
  const WAVE_ON_RUNNER = ["plot_generation", "script_generation"];

  /** 确定性席位：无 LLM 调用，天然没有 PromptComposer，不受"提示词不能空"这条守卫约束。 */
  const DETERMINISTIC_ON_RUNNER = ["structure_check"];

  /**
   * 多阶段席位：提示词按阶段查 stage-composer-registry（composerId），
   * 不落在 StepDescriptor.composer 这个单槽位上——与 MULTI_PHASE_STEPS
   * （下方 PromptComposer 登记面）同一惯例，"不登记单一 composer"本身就是正确状态。
   */
  const SEQUENCE_ON_RUNNER = ["story_framework"];

  it("只有白名单里的席位走新 runner", () => {
    const onRunner = executableStepIds()
      .filter((id) => getAgentDef(id)?.useNewRunner === true)
      .sort();
    expect(onRunner, "有 step 被切到新 runner，请确认其后处理已迁移").toEqual(
      [...ON_RUNNER].sort(),
    );
  });

  it("story_framework 的两个阶段 composer 提示词不为空", async () => {
    const { composeSystemPrompt } = await import("../runtime/prompt-composer.js");
    const { getStageComposer } = await import("../blueprint/stage-composer-registry.js");
    const ctx = { user_input: "一个消除游戏" } as NarrativeContext;
    for (const name of ["story_framework_plan", "story_framework_fill"]) {
      const composer = getStageComposer(name);
      expect(composeSystemPrompt(composer, ctx).length, `${name} system prompt 为空`)
        .toBeGreaterThan(100);
    }
  });

  it("切到 runner 的席位提示词不为空（不能靠空提示词跑）", async () => {
    const { PromptResolver } = await import("../blueprint/prompt-resolver.js");
    const { composeSystemPrompt } = await import("../runtime/prompt-composer.js");
    const ctx = { user_input: "一个消除游戏" } as NarrativeContext;
    for (const id of ON_RUNNER) {
      if (DETERMINISTIC_ON_RUNNER.includes(id)) continue; // 无 LLM 调用，无提示词可核。
      if (SEQUENCE_ON_RUNNER.includes(id)) continue; // 提示词按阶段查表，见上一条测试单独核实。

      const composer = STEP_REGISTRY.get(id)?.composer;
      expect(composer, `${id} 没有 PromptComposer，切 runner 会发空提示词`).toBeTruthy();

      if (CHUNKED_ON_RUNNER.includes(id) || WAVE_ON_RUNNER.includes(id)) {
        // 分片/波次席只核 system 段：user 段缺片/缺单元时**应当抛错**
        // （分片器/分层器没给数据是编程错误），在这里喂假片只会得到一份为测试而生的提示词。
        expect(composeSystemPrompt(composer!, ctx).length, `${id} system prompt 为空`)
          .toBeGreaterThan(100);
        continue;
      }

      const prompts = PromptResolver.resolveFromComposer(composer!, ctx);
      expect(prompts.systemPrompt.length, `${id} system prompt 为空`).toBeGreaterThan(100);
      expect(prompts.userPromptTemplate.length, `${id} user prompt 为空`).toBeGreaterThan(50);
    }
  });

  /**
   * 不依赖白名单的通用版：**任何**走 runner 的 step 都必须登记 composer——
   * 但确定性席位（无 LLM 调用）天然没有，sequence 席位的提示词按阶段查
   * stage-composer-registry（不落在 StepDescriptor.composer 这个单槽位），
   * 按 structure.type 排除而非硬编码名单，这样以后再迁一个同类席位不用回来改这条测试。
   * 有人切了新席位又忘了同步白名单时，由这条兜住。
   */
  it("凡走 runner 的 step 必已登记 composer", () => {
    const missing = executableStepIds()
      .filter((id) => getAgentDef(id)?.useNewRunner === true)
      .filter((id) => {
        const type = getAgentDef(id)?.structure.type;
        return type !== "deterministic" && type !== "sequence";
      })
      .filter((id) => !STEP_REGISTRY.get(id)?.composer);
    expect(missing, "这些 step 切了 runner 但没登记 composer，会发空提示词").toEqual([]);
  });

  /**
   * M5 加闸：不只是"声明 useNewRunner=true"这个静态标记核对，还要黑盒证实
   * `executeAgent` 真的走不到老 `step.fn`——把 STEP_REGISTRY 里的 fn 换成一枚
   * 踩雷桩（一调用就抛错），对每个白名单席位真正跑一遍 executeAgent，只要
   * 雷没响就说明该实现的老函数体已彻底不可达，不是只改了个标记位。
   *
   * 用空 ctx + 哑 LLM 允许 runner 本身因缺输入而失败——这里不核"跑得通"，
   * 只核"没有落到 legacy fn"，故吞掉 runner 自身抛出的错误。
   */
  it("白名单席位的老 step.fn 已不可达（黑盒验证，非只查标记位）", async () => {
    const dummyLlm = {
      supportsWebSearch: false,
      async call(): Promise<string> {
        return "{}";
      },
      async callWithRetry(): Promise<string> {
        return "{}";
      },
      async callStreamFull(): Promise<string> {
        return "{}";
      },
      async callWithWebSearch(): Promise<{ text: string; citations: never[] }> {
        return { text: "{}", citations: [] };
      },
    } as unknown as LLMClient;

    const triggered: string[] = [];
    for (const id of ON_RUNNER) {
      const desc = STEP_REGISTRY.get(id);
      if (!desc?.fn) continue; // 无老实现可踩（如纯新建席位），跳过。
      const original = desc.fn;
      (desc as { fn: unknown }).fn = async () => {
        triggered.push(id);
        throw new Error(`踩雷：${id} 的老 step.fn 被调用了`);
      };
      try {
        await executeAgent(id, {} as NarrativeContext, dummyLlm).catch(() => {
          // runner 路径因空 ctx 抛错是预期内的，这里只关心雷有没有响。
        });
      } finally {
        (desc as { fn: unknown }).fn = original;
      }
    }
    expect(triggered, "以下白名单席位的调用仍落到了老 step.fn").toEqual([]);
  });
});

/**
 * PromptComposer 登记面（4.4）。
 *
 * 登记 composer 与切 runner 是两件事，前者是后者的前置：`agent-exec.resolvePrompts`
 * 从 `StepDescriptor.composer` 兜底取提示词，没登记就发空提示词 —— 不报错，只让模型
 * 胡说，是最难发现的一类故障。所以先把 composer 全挂上，再逐席切换。
 */
describe("PromptComposer 登记面", () => {
  /**
   * 多阶段步：各有 2–3 个分阶段 composer（plan/fill/gap 或 skeleton/expand），
   * 而描述符只能放一个，所以**故意**留空。
   *
   * 随便挑一个登记比留空更坏：留空切 runner 会发空提示词（上面那条守卫能拦），
   * 挑一个则会拿规划阶段的提示词跑填充阶段，看起来一切正常。正确出路是把分阶段
   * 上移成 SequenceStage / ChunkedConfig（见 seat-spec.ts 的 SHAPE_DIVERGENCES）。
   */
  /**
   * `scene_plan` 曾在这张名单里（旧 `scene_generation` 是骨架+展开+聚合三阶段）。
   * 2026-08 场景席按方向拆分后它变成**单轮**：一次 LLM 出树，随后交确定性聚合器，
   * 因此登记单个 composer 就是它的全部提示词，不再有"挑一个阶段"的风险。
   * 后向那半迁去 `scene_evidence`，那一步是分层批处理，故不登记 composer。
   */
  const MULTI_PHASE_STEPS = [
    "story_framework",
    "outline_batch",
    "detailed_outline",
  ];

  /**
   * 守的是「静默发空提示词」这一种故障，不是「提示词内容对不对」。
   *
   * 只断言 **system** 段：它是角色/任务/约束那套骨架，不依赖上游数据，所以在空 ctx 下
   * 也必须成型。user 段恰恰相反 —— 它铺的就是上游产物，空 ctx 下本就该是空的，
   * 拿它当断言只会逼出一份为测试而捏、与生产脱节的假 ctx。
   *
   * 另有几个 composer 在上游缺失时抛错（如 vn_outline_acts 要求 ctx.vn_logline）。
   * 抛错是**好**结果：说明 composer 真跑了并校验了输入，故跳过而非计为失败。
   */
  it("登记了 composer 的 step 不会静默给出空 system 提示词", async () => {
    const { PromptResolver } = await import("../blueprint/prompt-resolver.js");
    const ctx = { user_input: "一个消除游戏" } as NarrativeContext;
    const silentlyEmpty: string[] = [];
    for (const [id, desc] of STEP_REGISTRY) {
      if (!desc.composer) continue;
      let prompts;
      try {
        prompts = PromptResolver.resolveFromComposer(desc.composer, ctx);
      } catch {
        continue; // 缺上游而抛错 —— composer 已接通，正是我们要的。
      }
      if (!prompts.systemPrompt.trim()) silentlyEmpty.push(id);
    }
    expect(silentlyEmpty, "这些 step 登记了 composer 却给出空 system 提示词").toEqual([]);
  });

  it("多阶段步保持不登记（挑一个阶段登记比留空更坏）", () => {
    const wronglyRegistered = MULTI_PHASE_STEPS.filter(
      (id) => STEP_REGISTRY.get(id)?.composer,
    );
    expect(
      wronglyRegistered,
      "多阶段步登记了单个 composer：请改为上移 SequenceStage/ChunkedConfig",
    ).toEqual([]);
  });

  it("除多阶段步外，有 composer 的核心席位都已登记", () => {
    // 这批 step 的提示词事实源是内联 composer，逐一登记后 runner 迁移才是安全动作。
    const shouldHaveComposer = [
      "preference_summary", "initial_plan", "worldview", "character_enrichment",
      "item_database", "plot_generation", "script_generation", "quest_generation",
      "script_scene_generation", "narrative_card", "lore_generation",
    ];
    const missing = shouldHaveComposer.filter((id) => !STEP_REGISTRY.get(id)?.composer);
    expect(missing, "这些 step 有内联 composer 但没登记到描述符").toEqual([]);
  });
});
