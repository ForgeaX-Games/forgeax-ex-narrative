import { getLocale } from "./index";
import { UI_CATALOGS } from "./ui";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

// Reverse map of tag dimension labels / option values (in any locale) → i18n key,
// so a frozen record summary like "Story theme：复仇；Story genre：奇幻" can be
// re-localized for display without touching the backend generation input.
const TAG_TEXT_TO_KEY: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const loc of ["en", "zh"] as const) {
    for (const [k, v] of Object.entries(UI_CATALOGS[loc])) {
      if (k.startsWith("tagDim.") || k.startsWith("tagOpt.")) m.set(v, k);
    }
  }
  return m;
})();

function splitKv(part: string): { label: string; val: string } | null {
  const idx = part.search(/[:：]/);
  if (idx < 0) return null;
  return { label: part.slice(0, idx).trim(), val: part.slice(idx + 1).trim() };
}

/** Display-only: re-localize tag dimension labels and option values in a summary string. */
export function localizeTagSummary(text: string, t: TFn): string {
  if (!text || !/[:：;；]/.test(text)) return text;
  const pairSep = getLocale() === "en" ? "; " : "；";
  const kvSep = getLocale() === "en" ? ": " : "：";
  let changed = false;
  const out = text.split(/[;；]/).map((part) => {
    const trimmed = part.trim();
    if (!trimmed) return part;
    const kv = splitKv(trimmed);
    if (!kv) {
      const k = TAG_TEXT_TO_KEY.get(trimmed);
      if (k) { changed = true; return t(k); }
      return part;
    }
    const lk = TAG_TEXT_TO_KEY.get(kv.label);
    const vk = TAG_TEXT_TO_KEY.get(kv.val);
    if (!lk && !vk) return part;
    changed = true;
    return `${lk ? t(lk) : kv.label}${kvSep}${vk ? t(vk) : kv.val}`;
  }).join(pairSep);
  return changed ? out : text;
}
