/**
 * seat-attribution.ts —— 把一串 step id 归到席位（编号 2.3.x）。
 *
 * 为什么需要这一层：席位与 step 不是一对一。需求清单席在通用作用域下由
 * `preference_summary + preference_analysis` 两步实现，画布上于是并排出现两张
 * 写着「偏好总结」「偏好分析」的卡——看起来像上一版的老步骤，实际是这一席的实现。
 * 把归属随 announce 一起下发，画布才能在卡上标出「这一步属于哪一席」，
 * 而不需要用户去背 step id 与席位的对应关系。
 *
 * 归属真值是 assistant-seats.ts 的绑定表，这里只做投影，不另立一份映射。
 */
import { getSeatForAgent } from "./assistant-seats.js";
import type { AnnounceSeatGroup } from "../../types/index.js";

/**
 * 按给定顺序把 step 聚成席位段。
 *
 * 同一席的 step 在管线里本就相邻（席内顺序即实现链顺序），所以顺序聚合即可；
 * 万一不相邻，同一席会出现两段——那说明管线定义把一席拆开了，
 * 分成两段展示恰好是实情，不该悄悄合并掩盖。
 *
 * 查不到席位的 step（pipeline_config / tier_router 这类元节点）不进任何段。
 */
export function seatGroupsForSteps(stepIds: readonly string[]): AnnounceSeatGroup[] {
  const groups: AnnounceSeatGroup[] = [];
  for (const stepId of stepIds) {
    const seat = getSeatForAgent(stepId);
    if (!seat) continue;
    const last = groups[groups.length - 1];
    if (last && last.id === seat.id) {
      last.steps.push(stepId);
      continue;
    }
    groups.push({ id: seat.id, name: seat.name, steps: [stepId] });
  }
  return groups;
}
