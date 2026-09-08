import { useEffect, useMemo, useState } from "react";
import { findCatalogItem, isEntryNode } from "../composer/composerCatalog";
import { useT } from "../i18n";
import { axisOptionLabel, loadNarrativeAxes } from "../lib/axesCache";
import { useNarrativeStore } from "../store/narrativeStore";
import type { NarrativeAxesCatalog } from "./useNarrativeStream";

/** 进度画布上那枚入口卡：标题 + 一组可读字段（字段名已本地化，值取本次运行的真值）。 */
export interface EntryCard {
  id: string;
  label: string;
  fields: Record<string, string>;
  /**
   * 这枚入口锚的产物地址前两元：条目键与泳道。
   *
   * 入口是这张图的锚点（后端拿它的 id 当 startNodeId），所以"这一屏的东西存在哪"
   * 这个问题的答案只能由它给。缺了它，多泳道条目里的入口卡看不出自己属于哪条泳道——
   * 而三条泳道的入口卡长得一模一样。
   */
  anchor: { entryKey: string | null; pipelineId: string | null };
}

/**
 * 入口节点在进度画布上的投影。
 *
 * 为什么要单独一个 hook：入口在编排态是可编辑节点（ComposerFlowNode 读 store），
 * 在生成态该是只读的一张卡——两态共用一个组件会让人在跑的时候还能改配置，
 * 改了又不影响这一轮，比看不见更糟。
 *
 * 真值优先级：本次运行的上下文 > 编排态配置。运行一旦开始，ctx 里的
 * user_input / narrative_axes / tier_detection 才是"实际按什么跑的"；
 * 还没有 ctx 时（刚点开始）退回入口节点自己的 config，卡上不留空白。
 */
export function useEntryCard(): EntryCard | null {
  const t = useT();
  const composerNodes = useNarrativeStore((s) => s.composerNodes);
  const result = useNarrativeStore((s) => s.activeResult);
  const entryKey = useNarrativeStore((s) => s.activeEntryKey);
  const entryPipelines = useNarrativeStore((s) => s.entryPipelines);
  const activePipelineId = useNarrativeStore((s) => s.activePipelineId);
  const [axes, setAxes] = useState<NarrativeAxesCatalog>({ types: [], themes: [], structures: [] });

  /**
   * 取当前聚焦泳道的那枚入口，而不是画布上的第一枚。
   *
   * manifest 的 `compositionGraph.startNodeId` 就是这条泳道的锚点 id（后端按它切分子图）。
   * 一律取第一枚会让多泳道条目在切换泳道后仍显示第一条的需求与三轴——图换了、
   * 入口卡没换，而且两者看不出不一致。
   */
  const entryNode = useMemo(() => {
    const entries = composerNodes.filter((n) => isEntryNode(n));
    if (entries.length === 0) return null;
    const startNodeId = entryPipelines.find((p) => p.pipelineId === activePipelineId)
      ?.compositionGraph?.startNodeId;
    return entries.find((n) => n.id === startNodeId) ?? entries[0]!;
  }, [composerNodes, entryPipelines, activePipelineId]);

  useEffect(() => {
    if (!entryNode) return;
    let alive = true;
    void loadNarrativeAxes().then((a) => { if (alive) setAxes(a); });
    return () => { alive = false; };
  }, [entryNode]);

  return useMemo(() => {
    if (!entryNode) return null;
    const ctx = (result ?? {}) as Record<string, unknown>;
    const cfg = entryNode.config as Record<string, unknown>;
    const runAxes = (ctx.narrative_axes ?? {}) as Record<string, unknown>;
    const tierDetection = (ctx.tier_detection ?? {}) as Record<string, unknown>;
    const auto = t("composer.cfg.tierAuto");

    /** 轴编码 → 显示名；词表还没到（或是长尾码）就报编码本身，不报空。 */
    const axisName = (list: NarrativeAxesCatalog["types"], code: unknown): string | null => {
      if (typeof code !== "string" || !code) return null;
      const hit = list.find((o) => o.code === code);
      return hit ? axisOptionLabel(hit) : code;
    };

    // 文件上传那一路：需求就是"投了哪些文件"。少了这一项，文件链条目的入口卡
    // 会报「没有输入」——明明投了三份稿子，卡上说什么都没有。
    const uploadedNames = (cfg.uploadedFileNames as string[] | undefined) ?? [];

    const requirement =
      (typeof ctx.user_input === "string" && ctx.user_input.trim())
      || (typeof cfg.userInput === "string" && cfg.userInput.trim())
      || Object.values((cfg.tagSelections ?? {}) as Record<string, string>).filter(Boolean).join("；")
      || (uploadedNames.length > 0 ? uploadedNames.join("、") : "")
      || t("composer.node.noInput");

    const complexity = (ctx.complexity ?? cfg.complexity) as number | undefined;
    const scaleLabel = complexity ? t(`complexity.${complexity}.label`) : null;

    const fields: Record<string, string> = {
      [t("composer.cfg.input")]: requirement,
      [t("composer.cfg.storyType")]:
        axisName(axes.types, runAxes.storyType ?? cfg.storyType) ?? auto,
      [t("composer.cfg.storyTheme")]:
        axisName(axes.themes, runAxes.storyTheme ?? cfg.storyTheme) ?? auto,
      [t("composer.cfg.scale")]:
        scaleLabel && scaleLabel !== `complexity.${complexity}.label`
          ? scaleLabel
          : (complexity ? String(complexity) : auto),
    };

    // 品类由后端识别后才定（前端只在入口显式指定时才有），有名字才报。
    const genreName = tierDetection.genre_name;
    if (typeof genreName === "string" && genreName) fields[t("composer.cfg.genre")] = genreName;

    // 产物锚点：条目键 + 泳道。多泳道条目里三张入口卡本来长得一样，报出锚点才分得清
    // 眼前这张图的产物落在哪；单泳道时只报条目键，不拿一串 pipe- 哈希占位。
    if (entryKey) {
      const lanes = entryPipelines.length;
      fields[t("composer.cfg.anchor")] =
        lanes > 1 && activePipelineId ? `${entryKey} · ${activePipelineId}` : entryKey;
    }

    // 标题走 catalog 的 i18n 键；node.label 是入库时的中文快照，英文界面下会露出来。
    const labelKey = findCatalogItem(entryNode.catalogId)?.labelKey;
    const localized = labelKey ? t(labelKey) : null;
    const label = localized && localized !== labelKey ? localized : entryNode.label;

    return {
      id: entryNode.id,
      label,
      fields,
      anchor: { entryKey: entryKey ?? null, pipelineId: activePipelineId ?? null },
    };
  }, [entryNode, result, axes, t, entryKey, activePipelineId, entryPipelines]);
}
