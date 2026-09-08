/**
 * 策划层全部接口定义。
 * 涵盖 D0-D4 各步输出 + 三大循环 + 叙事需求接口。
 */

import type { NarrativeType } from "../knowledge/genre-narrative-type.js";

// ─── 基础类型 ───

export interface NameDesc {
  name: string;
  description: string;
}

export interface SystemRef {
  id: string;
  name: string;
  priority: "required" | "recommended" | "optional";
  brief?: string;
}

export interface CurrencyDef {
  id: string;
  name: string;
  type: "premium" | "soft" | "energy" | "token" | "score";
  cap?: number;
  description: string;
}

// ─── 三大循环 ───

export interface GameplayStage {
  name: string;
  player_action: string;
  systems_involved: string[];
  emotion: string;
}

export interface ResourceNode {
  name: string;
  type: "source" | "sink" | "transform";
  description: string;
}

export interface ThreeLoops {
  system_loop: {
    description: string;
    core_systems: string[];
    gameplay_systems: string[];
    support_systems: string[];
    flow: string;
  };

  gameplay_loop: {
    description: string;
    stages: GameplayStage[];
    session_length: string;
    meta_loop?: string;
  };

  resource_loop: {
    description: string;
    currencies: string[];
    sources: NameDesc[];
    sinks: NameDesc[];
    transformations?: { input: string; output: string; via: string }[];
    growth_driver: string;
  };
}

// ─── D0: 核心概念 ───

export interface CoreConcept {
  game_name: string;
  one_liner: string;
  core_experience: { emotion: string; gameplay: string; narrative: string };
  narrative_pillars: string[];
  scale_estimate: {
    play_hours: number;
    chapters: number;
    characters: number;
    endings: number;
  };
  reference_games: string[];
  three_loops: ThreeLoops;
}

// ─── D1: 系统架构 ───

export interface SystemArchitecture {
  categories: {
    core: SystemRef[];
    gameplay: SystemRef[];
    progression: SystemRef[];
    social: SystemRef[];
    presentation: SystemRef[];
  };
  dependency_graph: { from: string; to: string; reason: string }[];
  generation_order: string[];
}

// ─── D2: 玩法设计 ───

export interface SystemDesignEntry {
  id: string;
  name: string;
  loop_role: string;
  design_brief: string;
  key_features: string[];
  data_structures?: Record<string, string>;
  interactions: { system_id: string; interaction: string }[];
  implementation_notes: string;
}

export interface SystemDetails {
  systems: SystemDesignEntry[];
}

// ─── D3: 数值框架 ───

export interface ValueFramework {
  resource_detail: {
    currencies: CurrencyDef[];
    acquisition_channels: { name: string; rate: string; systems: string[] }[];
    consumption_channels: { name: string; cost: string; systems: string[] }[];
    balance_notes: string[];
  };
  growth: {
    curve_type: string;
    milestones: { level: string; unlock: string }[];
  };
  combat_values?: {
    base_stats: string;
    damage_formula: string;
    scaling_note: string;
  };
  difficulty: {
    curve_type: string;
    stages: NameDesc[];
  };
}

// ─── D4: 完整策划案 + 叙事需求接口 ───

export interface GameDesignContext {
  core_concept: CoreConcept;
  system_architecture: SystemArchitecture;
  system_details: SystemDetails;
  value_framework: ValueFramework;

  completeness: {
    missing: string[];
    warnings: string[];
    coverage: number;
  };

  narrative_requirements: NarrativeRequirements;
}

export type NarrativeDepth = "full" | "standard" | "basic" | "minimal";

export interface NarrativeRequirements {
  needs: Record<string, number>;
  narrative_type: NarrativeType;
  depth: NarrativeDepth;
  available_modes: string[];
  recommended_mode: string;
  priority_content: string[];
  constraints: string[];
  system_context: { id: string; name: string; brief: string }[];
  loops_summary: {
    gameplay_loop: string;
    resource_loop: string;
  };
}

// ─── DemandAnalysis (tier_router 输出) ───

export interface DemandAnalysis {
  genre_code: string;
  genre_name: string;
  tier: import("./index.js").TierId;

  theme: {
    code: string;
    name: string;
  };

  volume: {
    duration_minutes: number;
    feasibility: "ok" | "risky" | "mismatch";
    suggestion?: string;
  };

  demand_type:
    | "concept_doc"
    | "full_design_doc"
    | "script_dialogue"
    | "full_assets"
    | "single_module";

  narrative_needs: Record<string, number>;
  narrative_type: NarrativeType;
  required_systems: string[];
  recommended_systems: string[];

  loop_templates: {
    system_loop: string[];
    gameplay_loop: GameplayStage[];
    resource_loop: ResourceNode[];
  };

  narrative_routing: {
    available_modes: string[];
    recommended_mode: string;
  };

  reasoning: string;
}
