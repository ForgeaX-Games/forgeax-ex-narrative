/**
 * vn-v2-e2.ts — tpl-vn-v2 E2（上传剧本）步序旁路
 *
 * 封存（C1，2026-08）：不再被任何活跃代码 import。业务功能（上传剧本时把它当
 * 权威来源、不许另编故事）已通用化进 `preference_summary` 席的 composer
 * （见 `steps/user-preference-summary.ts` 的 `uploadedScriptContext`），对所有
 * 品类生效，不再需要按 step id 做运行时改图。仅保留代码供查证运行方式的历史差异。
 *
 * 运行时（pipeline.ts）与 /plan 预览（run-manifest-builder.ts）曾共用同一实现：
 * 二期 M9 要求前端不再镜像任何步序规则，预览与真跑必须逐字同源。
 */
import { STEP_IDS as S } from "../../routing/modes.js";

/**
 * tpl-vn-v2 E2 旁路：用户上传剧本时，**替换**（不是叠加）E1 中下层步骤。
 *
 * 与 MyFile/提示词/影游叙事生成提示词/00_README.md §四 调用顺序对齐：
 *   入口一（用户输入）：vn_logline → vn_outline_acts → vn_beats → G-01...（场号由 G-01 末尾导出）
 *   入口二（上传剧本）：vn_logline → vn_script_normalize → vn_segment_confirm → G-01...
 *
 * 也就是 E2 路径下 vn_outline_acts / vn_beats 步被 vn_script_normalize + vn_segment_confirm
 * 替代——后者产出 vn_outline_acts / vn_beats / vn_character_bios，让 G-01~G-03 无差别消费；
 * vn_scenes 已降级为 G-01 拓扑定稿后的派生数据（§4.6c）。
 *
 * 共享同一 mode（vn_full / design_vn_full），路由由「是否有上传剧本」决定。
 */
export function injectVnV2E2Steps(
  stepGroups: Array<string | string[]>,
  hasUploadedScript: boolean,
): Array<string | string[]> {
  if (!hasUploadedScript) return stepGroups;

  const isFlatBeat = (entry: string | string[], target: string): boolean =>
    Array.isArray(entry) ? entry.includes(target) : entry === target;

  // 防御：避免重复处理（rerun 场景）
  const alreadyInjected = stepGroups.some(
    (e) => isFlatBeat(e, S.VN_SCRIPT_NORMALIZE) || isFlatBeat(e, S.VN_SEGMENT_CONFIRM),
  );
  if (alreadyInjected) return stepGroups;

  // 要被替换的 E1 中下层 step（不再保留）
  const REPLACED: ReadonlySet<string> = new Set([
    S.VN_OUTLINE_ACTS,
    S.VN_SCENES,
    S.VN_BEATS,
  ]);

  const containsAnyReplaced = stepGroups.some((e) =>
    Array.isArray(e) ? e.some((s) => REPLACED.has(s)) : REPLACED.has(e),
  );
  if (!containsAnyReplaced) return stepGroups;

  // 替换策略：
  //   - 单个 step 命中 REPLACED → 移除该 entry
  //   - 数组 step 部分命中 REPLACED → 过滤掉命中的元素，保留其他
  //   - 第一次遇到 REPLACED 时插入 [VN_SCRIPT_NORMALIZE, VN_SEGMENT_CONFIRM] 替代
  const out: Array<string | string[]> = [];
  let injected = false;
  for (const entry of stepGroups) {
    if (Array.isArray(entry)) {
      const remaining = entry.filter((s) => !REPLACED.has(s));
      const hadReplaced = remaining.length !== entry.length;
      if (remaining.length > 0) out.push(remaining);
      if (hadReplaced && !injected) {
        out.push(S.VN_SCRIPT_NORMALIZE);
        out.push(S.VN_SEGMENT_CONFIRM);
        injected = true;
      }
    } else {
      if (REPLACED.has(entry)) {
        if (!injected) {
          out.push(S.VN_SCRIPT_NORMALIZE);
          out.push(S.VN_SEGMENT_CONFIRM);
          injected = true;
        }
        // 命中则跳过（被 normalize+confirm 取代）
        continue;
      }
      out.push(entry);
    }
  }
  return out;
}
