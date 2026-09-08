/**
 * templates.ts — 封存快照（D1，2026-08）
 *
 * 原 `pipeline/templates.ts` 里 `tpl-vn-v2` 的模板定义。业务功能已由 C1 吸收进
 * 通用席位（详见 [`./README.md`](./README.md) 吸收台账），本文件只保留定义
 * 本体的原貌以便复核，不是又一处独立的吸收记录。
 *
 * 本文件不再被任何活跃代码 import。`PipelineTemplateId` 类型本身仍保留在
 * 活跃的 `../../templates.ts` 里（历史 checkpoint 读取键），`"tpl-vn-v2"` 字面量
 * 继续可用。
 */
import { STEP_IDS as S } from "../../routing/modes.js";
import type { PipelineTemplateId } from "../../routing/templates.js";

interface ArchivedPipelineTemplate {
  id: PipelineTemplateId;
  label: string;
  description: string;
  steps: Array<string | string[]>;
  optionalSteps?: string[];
  tiers: Array<"tier1" | "tier2" | "tier3" | "tier4">;
}

export const VN_V2_TEMPLATE: ArchivedPipelineTemplate = {
  id: "tpl-vn-v2",
  // 展示层去 v2 后缀（命名统一，§Phase5）；底层 id 保持 tpl-vn-v2 以兼容历史 checkpoint/模板注册。
  label: "互动影游（专属管线）",
  description:
    "影游叙事专属管线：E1（Logline → 三幕 → 情节点黄金线）→ G（剧情树改造〔含场号导出〕 → 剧本创作 → 分镜设计）。" +
    "上传剧本时自动切换到 E2 入口（剧本预处理 → 文本段确认 → 跳过 E1 中下层），E1 与 E2 互斥。" +
    "借用 世界观 一步（已注入 vn-v2 上下文），不再包含 RPG 范式的偏好分析（vn 用 logline+三幕直接驱动）。",
  tiers: ["tier1", "tier2"],
  steps: [
    // E1：故事结构
    S.VN_LOGLINE,            // E1-01
    S.VN_OUTLINE_ACTS,       // E1-02（三幕 + 人物小传，单步双输出）
    // 借用：世界观（影游写实风格 skill 注入；context_inputs 已读取 vn_logline / vn_outline_acts / vn_character_bios）
    S.WORLDVIEW,
    S.VN_SCENES,             // E1-03
    S.VN_BEATS,              // E1-04
    // G：剧情树 + 状态账本 + 剧本 + 分镜
    S.VN_BRANCHED_BEATS,     // G-01
    S.VN_STATE_LEDGER,       // G-01.5
    S.VN_SCREENPLAY,         // G-02
    S.VN_STORYBOARD,         // G-03
  ],
  // E2 路径动态接管：has_uploaded_script=true 时 pipeline.ts 把 E1 中下层
  // (VN_OUTLINE_ACTS / VN_SCENES / VN_BEATS) 替换为 (VN_SCRIPT_NORMALIZE / VN_SEGMENT_CONFIRM)
  optionalSteps: [S.VN_SCRIPT_NORMALIZE, S.VN_SEGMENT_CONFIRM],
};
