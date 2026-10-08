/**
 * 品类 skill 的注入点必须挂在真实存在的 step 上。
 *
 * 被守的失效方式是**静默的**：`getStepSkill` 按 step id 精确查表，键对不上就返回空，
 * 没有报错、没有日志。互动影游的三段风格文本因此在生产路径上一处也注入不到 —— C1
 * 统一管线时 `vn_branched_beats` / `vn_screenplay` / `vn_storyboard` 随 tpl-vn-v2 封存，
 * 而 skill 那边的键没人改。那个品类恰好是 IP 改编的缺省品类，所以失配的是缺省路径。
 *
 * 这条检查存在的理由就是它机械：步序还会再改，而"改完记得去对一遍各品类 skill 的键"
 * 是记不住的。
 */
import { describe, it, expect } from "vitest";
// 两处注册都靠 import 副作用。不引，两张表都是空的：下面第一条会假绿，第二、三条会红
// —— 后两条正是为此存在的。
import "../../../pipeline/core/step-registrations.js";
import "../skill-bootstrap.js";
import { STEP_REGISTRY } from "../../../pipeline/core/step-registry.js";
import { listRegisteredSkills } from "../skill-loader.js";

/**
 * 活跃 = 这个 step 有注册过的实现。
 *
 * 前两个判据都试过，都不对：
 *
 * - `STEP_IDS` 是 id 常量表，里头还留着十个 `vn_*` —— C1 封存了它们的实现，键没删。
 *   拿它当判据，这条检查抓不到任何东西（实测：把键改回 `vn_branched_beats` 仍然绿）。
 *   同一个陷阱之前在 `ModeId` 与 `MODE_CONFIGS` 上出过一次。
 * - `MODE_CONFIGS` 的静态步序又太窄：`lore_generation` 不在任何 mode 里（modes.ts 的注释
 *   就这么写着），却由 `narrative-steps-defaults` 按 needs 动态编排出来，七个品类正经在
 *   用。按它判会把七处正常注入误报成失配。
 *
 * `STEP_REGISTRY` 同时躲开两边：它是"这个 step 跑不跑得起来"的真值，与步序由哪条路
 * 决定无关。
 */
const LIVE_STEP_IDS = new Set<string>(STEP_REGISTRY.keys());
const ALL_SKILLS = listRegisteredSkills();

describe("skill 的 stepSkills 键", () => {
  it("每个键都是活跃的 step id", () => {
    const orphans: string[] = [];
    for (const skill of ALL_SKILLS) {
      for (const stepId of Object.keys(skill.stepSkills ?? {})) {
        if (!LIVE_STEP_IDS.has(stepId)) orphans.push(`${skill.genreCode} → ${stepId}`);
      }
    }
    // 报全部而不是第一个：一次步序调整往往同时弃用好几个 step。
    expect(orphans).toEqual([]);
  });

  it("至少有一个品类真的注入了内容", () => {
    // 上一条在"所有 skill 都没有 stepSkills"时也会绿。少了这条，把 stepSkills 整体
    // 删空就是"通过"。
    const withSteps = ALL_SKILLS.filter((s) => Object.keys(s.stepSkills ?? {}).length > 0);
    expect(withSteps.length).toBeGreaterThan(0);
  });

  it("step 注册表真的装上了", () => {
    // 同理：空注册表会让第一条无条件绿（没有键能不在空集合里……反了，是每个键都不在，
    // 于是全部误报）。这条钉住的是另一头：注册表空时第一条会红成一片，而红的原因
    // 不是失配。写明它，下次看到满屏失配的人先来看这里。
    expect(LIVE_STEP_IDS.size).toBeGreaterThan(10);
  });
});
