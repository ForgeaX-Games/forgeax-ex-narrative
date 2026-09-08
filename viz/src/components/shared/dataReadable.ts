// 与 GenericObjectView 共享的纯函数 / 标签字典。
// 单独成文件是为了避免 React Fast Refresh 警告：
// "Could not Fast Refresh — only works when a file only exports components."
// 一旦 .tsx 同时导出 React 组件 + 普通函数，HMR 会强制 invalidate 整个模块，
// 导致 React 组件树状态错位 → CanvasErrorBoundary 抓到 "节点渲染异常"。

import { getLocale } from "../../i18n";

const LABEL_REMAP_ZH: Record<string, string> = {
  name: "名称", description: "描述", type: "类型", category: "类别",
  rarity: "稀有度", effect: "效果", source: "来源", location: "位置",
  trigger: "触发", condition: "条件", reward: "奖励", cost: "费用",
  level: "等级", hp: "生命值", attack: "攻击", defense: "防御",
  quest_id: "任务ID", story_node_id: "关联节点", objectives: "目标",
  prerequisites: "前置条件", completion_conditions: "完成条件",
  branch_at: "分叉点", branches: "分支", merge_at: "合并点",
  node_id: "节点", content: "内容", summary: "摘要",
  main_content: "主要内容", narrative_function: "叙事功能",
  narrative_stage: "叙事阶段", stage_type: "阶段类型",
  story_elements: "故事元素", boundary_constraints: "边界约束",
  jrpg_elements: "JRPG元素", character_arcs: "角色弧光",
  prev_node: "前置节点", next_node: "后续节点", is_branch: "分支节点",
  tension_level: "张力等级", conflict_type: "冲突类型", stakes: "赌注",
  atmosphere: "氛围", dialogue_hint: "对话提示", turning_point: "转折点",
  plot: "情节", cause: "起因", process: "经过", result: "结果",
  // 互动影游 / cinematic_storyboard 字段
  qte: "🎯 QTE 互动",
  shape: "形状", appear_ms: "出现时刻 (ms)", target_ms: "目标时刻 (ms)",
  duration_ms: "总时长 (ms)", window_ms: "判定窗口 (ms)",
  fail_penalty: "失败惩罚", success_reward: "成功奖励",
  // 角色档案字段
  archetype_analysis: "原型分析", core_archetype: "核心原型", surface_archetype: "表面原型",
  psychological_drivers: "心理驱动", core_motivation: "核心动机", core_fear: "核心恐惧",
  decisive_past_event: "决定性过去", character_arc_spectrum: "角色弧光",
  background_information: "背景信息", role_in_story: "故事定位",
  relationships: "人物关系", family_relationships: "家庭关系", social_relationships: "社会关系",
  appearance_description: "外貌描述", location_description: "出没地点",
  location_name: "地点名称", position_description: "位置描述",
  occupation: "职业", race: "种族", gender: "性别", age: "年龄",
  label: "角色类型", game_mechanics: "游戏属性", base_stats: "基础属性",
  // 角色血肉（personal_life）
  personal_life: "角色血肉", likes: "喜好", dislikes: "厌恶",
  habits: "习惯", speech_pattern: "说话方式", personal_item: "私人物件",
  private_wish: "内心期待", vulnerability: "矛盾面",
  independent_bonds: "私人牵绊", relationship: "关系", detail: "细节",
  // 其他
  visual_prompt: "视觉提示词", scene_prompt: "场景提示词",
  ui_style_prompt: "UI 风格提示词",
  shots: "镜头序列", scene: "场景", lines: "台词",
  speaker: "角色", text: "台词内容", role: "出演角色",
  scene_role: "剧情角色", node_kind: "节点类型",
  framing: "构图", angle: "视角", movement: "运镜",
  lighting: "光影", actor_action: "演员动作", sfx: "音效",
};

const LABEL_REMAP_EN: Record<string, string> = {
  name: "Name", description: "Description", type: "Type", category: "Category",
  rarity: "Rarity", effect: "Effect", source: "Source", location: "Location",
  trigger: "Trigger", condition: "Condition", reward: "Reward", cost: "Cost",
  level: "Level", hp: "HP", attack: "Attack", defense: "Defense",
  quest_id: "Quest ID", story_node_id: "Linked node", objectives: "Objectives",
  prerequisites: "Prerequisites", completion_conditions: "Completion conditions",
  branch_at: "Branch at", branches: "Branches", merge_at: "Merge at",
  node_id: "Node", content: "Content", summary: "Summary",
  main_content: "Main content", narrative_function: "Narrative function",
  narrative_stage: "Narrative stage", stage_type: "Stage type",
  story_elements: "Story elements", boundary_constraints: "Boundary constraints",
  jrpg_elements: "JRPG elements", character_arcs: "Character arcs",
  prev_node: "Previous node", next_node: "Next node", is_branch: "Branch node",
  tension_level: "Tension level", conflict_type: "Conflict type", stakes: "Stakes",
  atmosphere: "Atmosphere", dialogue_hint: "Dialogue hint", turning_point: "Turning point",
  plot: "Plot", cause: "Cause", process: "Process", result: "Result",
  qte: "🎯 QTE",
  shape: "Shape", appear_ms: "Appear (ms)", target_ms: "Target (ms)",
  duration_ms: "Duration (ms)", window_ms: "Judge window (ms)",
  fail_penalty: "Fail penalty", success_reward: "Success reward",
  archetype_analysis: "Archetype analysis", core_archetype: "Core archetype", surface_archetype: "Surface archetype",
  psychological_drivers: "Psychological drivers", core_motivation: "Core motivation", core_fear: "Core fear",
  decisive_past_event: "Decisive past event", character_arc_spectrum: "Character arc",
  background_information: "Background", role_in_story: "Role in story",
  relationships: "Relationships", family_relationships: "Family relationships", social_relationships: "Social relationships",
  appearance_description: "Appearance", location_description: "Whereabouts",
  location_name: "Location name", position_description: "Position",
  occupation: "Occupation", race: "Race", gender: "Gender", age: "Age",
  label: "Character type", game_mechanics: "Game stats", base_stats: "Base stats",
  personal_life: "Persona details", likes: "Likes", dislikes: "Dislikes",
  habits: "Habits", speech_pattern: "Speech pattern", personal_item: "Personal item",
  private_wish: "Inner wish", vulnerability: "Vulnerability",
  independent_bonds: "Personal bonds", relationship: "Relationship", detail: "Detail",
  visual_prompt: "Visual prompt", scene_prompt: "Scene prompt",
  ui_style_prompt: "UI style prompt",
  shots: "Shot sequence", scene: "Scene", lines: "Lines",
  speaker: "Speaker", text: "Line text", role: "Cast role",
  scene_role: "Story role", node_kind: "Node kind",
  framing: "Framing", angle: "Angle", movement: "Camera movement",
  lighting: "Lighting", actor_action: "Actor action", sfx: "SFX",
};

export function humanKey(key: string): string {
  const remap = getLocale() === "zh" ? LABEL_REMAP_ZH : LABEL_REMAP_EN;
  return remap[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function dataToReadableText(data: unknown, depth = 0): string {
  const indent = "  ".repeat(depth);
  if (data === null || data === undefined) return "";
  if (typeof data === "string") return data;
  if (typeof data === "number" || typeof data === "boolean") return String(data);

  if (Array.isArray(data)) {
    if (data.length === 0) return "(empty)";
    if (data.every((v) => typeof v === "string" || typeof v === "number")) {
      return data.join("、");
    }
    return data.map((item, i) => {
      const prefix = `${indent}${i + 1}. `;
      if (typeof item === "object" && item !== null) {
        return prefix + dataToReadableText(item, depth + 1).trimStart();
      }
      return prefix + String(item);
    }).join("\n");
  }

  if (typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>).filter(
      ([, v]) => v !== null && v !== undefined && v !== "",
    );
    return entries.map(([k, v]) => {
      const label = humanKey(k);
      const isSimple = typeof v === "string" || typeof v === "number" || typeof v === "boolean";
      const isSimpleArr = Array.isArray(v) && v.every((x) => typeof x === "string" || typeof x === "number");
      if (isSimple) return `${indent}**${label}**: ${v}`;
      if (isSimpleArr) return `${indent}**${label}**: ${(v as (string | number)[]).join("、")}`;
      return `${indent}### ${label}\n${dataToReadableText(v, depth + 1)}`;
    }).join("\n");
  }

  return String(data);
}
