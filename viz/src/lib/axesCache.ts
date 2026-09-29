import { fetchNarrativeAxes, type NarrativeAxesCatalog, type AxisOption } from "../hooks/useNarrativeStream";
import { getLocale } from "../i18n";

/**
 * 三轴词表的进程内缓存，与 genreCache 同构（缓存 Promise 而非结果，并发调用共享一次请求）。
 *
 * 词表不随 locale 变——后端一次给全，中英名都在同一条记录里（name / nameEn），
 * 所以这里不按 locale 分键，只在取显示名时按当前 locale 挑字段。
 */
const EMPTY: NarrativeAxesCatalog = { types: [], themes: [], structures: [] };

let cache: Promise<NarrativeAxesCatalog> | null = null;

export function loadNarrativeAxes(): Promise<NarrativeAxesCatalog> {
  if (!cache) cache = fetchNarrativeAxes().catch(() => EMPTY);
  return cache;
}

/** 按当前 locale 取轴选项的显示名；英文缺失时退回中文名，中文永不缺。 */
export function axisOptionLabel(opt: AxisOption): string {
  return getLocale() === "en" ? (opt.nameEn?.trim() || opt.name) : opt.name;
}

/**
 * 按存盘时的名字反查显示名。
 *
 * 落盘的 `storyType` / `storyTheme` 存的是词表里的中文 `name`（后端按它索引），
 * 所以历史列表直接把它贴到标签上，英文界面就会冒出「记忆与身份」。反查一次，
 * 落盘的值不动，只有显示跟着语言走。三轴没加载好或查不到就照原样显示——
 * 用户自定义的轴值本来就只有他自己写的那一个名字。
 */
export function axisLabelByName(axes: NarrativeAxesCatalog | null, name: string): string {
  if (!axes) return name;
  for (const axis of [axes.types, axes.themes, axes.structures]) {
    const hit = axis.find((o) => o.name === name);
    if (hit) return axisOptionLabel(hit);
  }
  return name;
}
