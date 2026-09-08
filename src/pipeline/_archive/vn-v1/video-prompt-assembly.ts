/**
 * video-prompt-assembly.ts (Stage C - D 工作单)
 * ─────────────────────────────────────────────────────────────────
 * 把 cinematic_storyboard.shots[] 拼装成可直接送给图像/视频生成模型的 prompt。
 *
 * 输出双语并列：
 *   - keyframes[].prompt_zh / prompt_en  → 接 Hunyuan / 中文 SD（zh），SD/Flux/Imagen（en）
 *   - video_segments[].prompt_zh / prompt_en → 接 Veo / Sora / Kling（中英都吃）
 *
 * 设计原则：
 *   - 纯函数，无 LLM 调用，瞬时完成（在 cinematic_storyboard 后置一步）
 *   - 不同模型偏好的 prompt 模板可在此扩展
 *   - 字段缺失时降级，不抛错
 */

interface ShotInput {
  shot_id?: string;
  framing?: string;
  angle?: string;
  movement?: string;
  lighting?: string;
  actor_action?: string;
  vfx?: string;
  duration_sec?: number;
  qte?: { trigger?: string; window_ms?: number; fail_penalty?: string };
}

interface StoryboardEntryInput {
  node_id?: string;
  shots?: ShotInput[];
  transition_in?: string;
  transition_out?: string;
  pacing?: string;
}

export interface KeyframePrompt {
  shot_id: string;
  node_id: string;
  prompt_zh: string;
  prompt_en: string;
}

export interface VideoSegmentPrompt {
  shot_id: string;
  node_id: string;
  duration_sec: number;
  prompt_zh: string;
  prompt_en: string;
}

export interface VideoPromptsBundle {
  keyframes: KeyframePrompt[];
  video_segments: VideoSegmentPrompt[];
}

/* ───────────── 中英映射表 ───────────── */

const FRAMING_EN: Record<string, string> = {
  extreme_wide: "extreme wide shot",
  wide: "wide shot",
  medium: "medium shot",
  close: "close-up",
  extreme_close: "extreme close-up",
  over_shoulder: "over-the-shoulder shot",
};

const FRAMING_ZH: Record<string, string> = {
  extreme_wide: "大全景",
  wide: "全景",
  medium: "中景",
  close: "特写",
  extreme_close: "大特写",
  over_shoulder: "过肩镜头",
};

const ANGLE_EN: Record<string, string> = {
  eye_level: "eye-level angle",
  low: "low-angle shot",
  high: "high-angle shot",
  dutch: "Dutch angle",
  aerial: "aerial view",
  pov: "POV shot",
};

const ANGLE_ZH: Record<string, string> = {
  eye_level: "平视",
  low: "仰拍",
  high: "俯拍",
  dutch: "斜角",
  aerial: "鸟瞰",
  pov: "主观视角",
};

const MOVEMENT_EN: Record<string, string> = {
  static: "static camera",
  pan: "panning shot",
  tilt: "tilt shot",
  tracking: "tracking shot",
  dolly: "dolly movement",
  crane: "crane shot",
  handheld: "handheld camera",
};

const MOVEMENT_ZH: Record<string, string> = {
  static: "固定机位",
  pan: "横摇",
  tilt: "纵摇",
  tracking: "跟拍",
  dolly: "推拉",
  crane: "升降",
  handheld: "手持",
};

const PACING_EN: Record<string, string> = {
  tense: "tense pacing",
  relaxed: "relaxed pacing",
  climactic: "climactic pacing",
  reflective: "reflective pacing",
};

/* ───────────── 单 shot 拼装器 ───────────── */

function assembleKeyframePromptZh(shot: ShotInput): string {
  const parts: string[] = [];
  if (shot.framing) parts.push(FRAMING_ZH[shot.framing] ?? shot.framing);
  if (shot.angle) parts.push(ANGLE_ZH[shot.angle] ?? shot.angle);
  if (shot.actor_action) parts.push(shot.actor_action);
  if (shot.lighting) parts.push(shot.lighting);
  if (shot.vfx) parts.push(shot.vfx);
  parts.push("电影质感", "8K 高清");
  return parts.filter(Boolean).join("，");
}

function assembleKeyframePromptEn(shot: ShotInput): string {
  const parts: string[] = [];
  if (shot.framing) parts.push(FRAMING_EN[shot.framing] ?? shot.framing);
  if (shot.angle) parts.push(ANGLE_EN[shot.angle] ?? shot.angle);
  if (shot.actor_action) parts.push(`of ${shot.actor_action}`);
  if (shot.lighting) parts.push(shot.lighting);
  if (shot.vfx) parts.push(shot.vfx);
  parts.push("cinematic", "8k", "high detail");
  return parts.filter(Boolean).join(", ");
}

function assembleVideoPromptZh(shot: ShotInput, pacing: string | undefined): string {
  const parts: string[] = [];
  if (shot.actor_action) parts.push(shot.actor_action);
  if (shot.movement) parts.push(MOVEMENT_ZH[shot.movement] ?? shot.movement);
  if (shot.framing) parts.push(FRAMING_ZH[shot.framing] ?? shot.framing);
  if (shot.duration_sec) parts.push(`时长 ${shot.duration_sec} 秒`);
  if (shot.lighting) parts.push(shot.lighting);
  if (pacing) parts.push(`节奏：${pacing}`);
  if (shot.qte?.trigger) parts.push(`QTE 节奏点：${shot.qte.trigger}`);
  return parts.filter(Boolean).join("，");
}

function assembleVideoPromptEn(shot: ShotInput, pacing: string | undefined): string {
  const parts: string[] = [];
  if (shot.actor_action) parts.push(shot.actor_action);
  if (shot.movement) parts.push(MOVEMENT_EN[shot.movement] ?? shot.movement);
  if (shot.framing) parts.push(FRAMING_EN[shot.framing] ?? shot.framing);
  if (shot.duration_sec) parts.push(`${shot.duration_sec}s duration`);
  if (shot.lighting) parts.push(shot.lighting);
  if (pacing) parts.push(PACING_EN[pacing] ?? pacing);
  if (shot.qte?.trigger) parts.push(`QTE beat: ${shot.qte.trigger}`);
  return parts.filter(Boolean).join(", ");
}

/* ───────────── 主入口 ───────────── */

/** 把整个 cinematic_storyboard 拍平成 keyframe / video segment prompt bundle。 */
export function assembleVideoPrompts(
  storyboard: { storyboards?: StoryboardEntryInput[] } | undefined | null,
): VideoPromptsBundle {
  const keyframes: KeyframePrompt[] = [];
  const video_segments: VideoSegmentPrompt[] = [];

  if (!storyboard?.storyboards) {
    return { keyframes, video_segments };
  }

  for (const entry of storyboard.storyboards) {
    const nodeId = entry.node_id ?? "unknown";
    if (!entry.shots) continue;
    for (const shot of entry.shots) {
      const shotId = shot.shot_id ?? `${nodeId}_S${keyframes.length + 1}`;
      keyframes.push({
        shot_id: shotId,
        node_id: nodeId,
        prompt_zh: assembleKeyframePromptZh(shot),
        prompt_en: assembleKeyframePromptEn(shot),
      });
      video_segments.push({
        shot_id: shotId,
        node_id: nodeId,
        duration_sec: shot.duration_sec ?? 4,
        prompt_zh: assembleVideoPromptZh(shot, entry.pacing),
        prompt_en: assembleVideoPromptEn(shot, entry.pacing),
      });
    }
  }

  return { keyframes, video_segments };
}
