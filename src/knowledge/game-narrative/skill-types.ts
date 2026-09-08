/**
 * skill-types.ts (C2)
 * ─────────────────────────────────────────────────────────────────
 * Skill 系统的核心接口定义。
 *
 * 混合存储策略：
 *  - md 文件（作者维护）：长正文、风格指南、few-shot 示例
 *  - ts 文件（自动编译）：类型安全的索引 + 内联 md 内容
 *
 * 一个 NarrativeSkill 描述某个 game genre 在所有可注入 step 处的内容补丁。
 * Skill 内容通过 PromptComposer 的命名 skillSlots 进入 system prompt。
 */
import type { TierId } from "../../types/index.js";

/**
 * 单个 step 上的 skill 内容片段。
 * 同一品类的同一 step 可同时填充 multiple slots（如 style/examples/constraints）。
 */
export interface StepSkillBlock {
  /** 整段内容（方案 A：直接拼到 system prompt 末尾） */
  systemPromptAddition?: string;

  /**
   * 命名槽位内容（方案 E：填到 PromptComposer 的 skillSlots）
   * 当 step 已重构为 PromptComposer 时优先生效；否则 fallback 用 systemPromptAddition。
   */
  slots?: {
    /** 品类风格指南：语气、节奏、文化母题 */
    style_guide?: string;
    /** 少量 few-shot 示例（输入→输出风味） */
    examples?: string;
    /** 硬约束（必须做到/绝不做的事） */
    constraints?: string;
    /** 角色塑造守则（仅 character_enrichment 类） */
    character_archetype?: string;
    /** 世界观结构守则（仅 worldview 类） */
    worldview_archetype?: string;
    /** 任意自定义槽位 */
    [extraSlot: string]: string | undefined;
  };
}

/**
 * 一个 game genre 的完整 skill 定义。
 */
export interface NarrativeSkill {
  /** 品类代码（与 GENRE_TAXONOMY.code 对应） */
  genreCode: string;
  /** 品类所属 tier */
  tier: TierId;
  /** 关键词用于关键词级匹配（与 GENRE_TAXONOMY.keywords 互补） */
  matchKeywords?: string[];

  /**
   * 可选启用的扩展 step（必须是当前 pipelineTemplate 的 optionalSteps 子集）。
   * 例：adv-interactive 在 tpl-vn 模板下可声明 enableSteps: ["cinematic_storyboard"]
   */
  enableSteps?: string[];

  /**
   * Stage C：长剧分幕模式默认幕数。
   *
   * 解释：
   *   - undefined 或 <= 1：短剧模式，branch_tree / dialogue_script / cinematic_storyboard
   *     走单次 LLM（典型 2-3 分钟成片）。
   *   - >= 2：长剧模式，相关 capability 走 chunked execute（macro→micro→check）。
   *     典型值：4-6（4-6 小时互动影游剧本，每幕 1 小时左右）。
   *
   * 触发优先级（hybrid 模式）：
   *   user_input 关键词 ('5 幕长剧' / '短剧 2-3 分钟' 等) > skill.defaultActs > 1
   */
  defaultActs?: number;

  /**
   * 各 step 的 skill 内容映射。Key = step ID（与 STEP_IDS 对应）。
   * 缺省的 step 不注入任何内容（用 baseline prompt）。
   */
  stepSkills: Record<string, StepSkillBlock>;

  /**
   * Phase 2：品类专属叙事段声明（"品类叙事包"核心）。
   *
   * 声明该品类在「通用前驱」（偏好总结 → 偏好分析 → 初步方案）之后的
   * 专属叙事 agent 序列。Planner 第一步即可拼出完整管线：
   *
   *   完整管线 = 通用前驱(PREFERENCE_TRIO) + narrativeSteps
   *   （design_* 模式再在最前拼接 D0-D4 策划链）
   *
   * 元素：
   *   - string         → 单个 step（串行）
   *   - string[]       → 并行组（同组步骤并发执行）
   *
   * 示例（RPG 七单品，世界观/角色/道具/L0-L5/场景都在此声明）：
   *   ["worldview", "character_enrichment", "item_database",
   *    "story_framework", "outline_batch", "detailed_outline",
   *    "plot_generation", "script_generation",
   *    ["quest_generation", "scene_plan"]]
   *
   * 未声明（undefined）时：Planner 回退到 pipelineTemplate 预置方案 / needs 规则。
   */
  narrativeSteps?: Array<string | string[]>;
}

/**
 * 策划步骤 (D0-D4) 也接受 skill 注入。
 * 接口形状与 NarrativeSkill 完全一致，仅语义上区分；运行时复用同一份数据结构。
 */
export type DesignSkill = NarrativeSkill;

/**
 * Skill loader 的查询结果。
 * 当某个 (genreCode, stepId) 组合无 skill 时返回 null，调用方走 baseline prompt。
 */
export type SkillLookupResult = StepSkillBlock | null;
