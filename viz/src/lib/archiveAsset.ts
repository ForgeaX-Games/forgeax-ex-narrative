/**
 * 归档：把任务库里的一份产物收进项目库，并同时把它记为定稿。
 *
 * ## 为什么是一个动作而不是两个
 *
 * 用户心里只有一件事——「我认这一份，收起来」。系统这边它落成两张正交的表
 * （见 `assetConfirm.ts` 头部）：确认表在产物旁边、下游跑生成时读它；项目库在另一侧、
 * 跨任务收集。表正交不代表动作要拆成两下：拆开之后只会稳定地产出两种半成品——
 * 收进了项目但没确认（下游照样读不到它），或确认了却没收（项目库里翻不着）。
 *
 * ## 蕴含是单向的
 *
 * 归档蕴含确认，确认不蕴含归档。反向不成立是因为「先认下这一版，还没想好归哪个项目」
 * 是真实的用法，而且一份产物可以归进多个项目——那时确认只该有一次。
 * 所以取消归档也不撤确认：撤了会把另一个项目里的那一份连坐。
 */
import { collectAsset, type AssetRef } from "./projectVault";
import { confirmAsset, type ConfirmedAsset } from "./assetConfirm";

/** 返回该条泳道确认后的清单，供调用方就地刷新勾选态；确认那一半失败时返回 null。 */
export async function archiveAsset(
  projectId: string,
  ref: AssetRef,
  categoryId: string | null = null,
): Promise<ConfirmedAsset[] | null> {
  await collectAsset(projectId, ref, categoryId);
  /**
   * 确认那一半失败不回滚已收进去的资产：收进项目是用户看得见的结果，
   * 撤掉它去追求两张表齐步，代价是用户眼前的东西凭空消失。确认可以事后补——
   * 任务侧的确认开关一直在，而「收进去了又没了」没有补救动作。
   */
  return confirmAsset(ref.taskKey, ref.path).catch(() => null);
}
