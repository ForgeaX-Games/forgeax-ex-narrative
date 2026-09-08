/**
 * blueprint/stage-composer-registry.ts
 *
 * SequenceStage.composerId 的查找表。多阶段 step（story_framework 的 plan/fill）
 * 迁移前本就各阶段各有一份内联 PromptComposer——这张表只是把它们从"该 step 文件
 * 私有的模块级常量"升格为"runner 可按名查到"，composer 本体不用改写。
 */
import type { PromptComposer } from "../runtime/prompt-composer.js";

const stageComposers = new Map<string, PromptComposer>();

export function registerStageComposer(name: string, composer: PromptComposer): void {
  stageComposers.set(name, composer);
}

export function getStageComposer(name: string): PromptComposer {
  const composer = stageComposers.get(name);
  if (!composer) throw new Error(`Stage composer not registered: ${name}`);
  return composer;
}

export function hasStageComposer(name: string): boolean {
  return stageComposers.has(name);
}
