/**
 * scene-numbering.ts — 确定性场号派生。
 *
 * C1（VN v2 吸收）：归档的 `exportScenesAndRenumber`（`_archive/vn-v2/vn-branched-beats.ts`）
 * 曾用一套"三维 staging（location_name / time_of_day / indoor_outdoor）+ 拓扑定稿后
 * 派生场号"的机制，但那实现绑死在 `VnBranchedBeat` 这个 VN 专属图结构上。业务功能——
 * "场景需要空间站位信息，且场号编排必须可复现"——与品类无关，这里把算法泛化成对
 * 任意"按叙事顺序排好的三维状态序列"生效的纯函数，不搬老的导出函数、不依赖任何
 * VN 类型，供分镜席（`script_generation`）的 `ScriptChapter[]` 复用。
 *
 * 规则（与归档版本语义一致）：
 * - 相邻场景的三维状态（location + time_of_day + indoor_outdoor）全同 ⟹ 同场号；
 * - 任一维变化 ⟹ 场号 = 当前最大场号 + 1；
 * - 不复用铁律：即便剧情"回到"三维状态与早先某场全同的地点，只要中间出现过别的
 *   状态，仍取新场号——场号只表示"叙事推进到第几场"，不是"地点身份"，地点复用
 *   由 location 字段本身承担，不靠复用场号表达。
 */

export interface StagedScene {
  location: string;
  time_of_day?: string;
  indoor_outdoor?: string;
}

function threeDimKey(s: StagedScene): string {
  return `${s.location}|${s.time_of_day ?? ""}|${s.indoor_outdoor ?? ""}`;
}

/**
 * 按入参顺序（调用方必须已按叙事/拓扑顺序排好）逐一分配全局场号，从 "1" 起、
 * 严格递增、绝不复用。纯函数：不修改入参，返回与入参等长、一一对应的场号数组。
 */
export function deriveDeterministicSceneNumbers(scenes: readonly StagedScene[]): string[] {
  const numbers: string[] = [];
  let current = 0;
  let prevKey: string | undefined;
  for (const s of scenes) {
    const key = threeDimKey(s);
    if (key !== prevKey) {
      current += 1;
      prevKey = key;
    }
    numbers.push(String(current));
  }
  return numbers;
}
