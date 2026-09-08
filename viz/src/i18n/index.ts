import { useSyncExternalStore } from 'react';
import { UI_CATALOGS, type Locale } from './ui';

export type { Locale };

let current: Locale = 'en';

export function getLocale(): Locale {
  return current;
}

export function setLocale(next: Locale): void {
  if (next !== 'en' && next !== 'zh') return;
  if (next === current) return;
  current = next;
  try { document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en'; } catch { /* */ }
  emit();
}

const listeners = new Set<() => void>();
function emit(): void { for (const fn of listeners) fn(); }

export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const LOCALE_KEY = 'forgeax.locale';
const LOCALE_MSG = 'forgeax:locale-changed';

export function readHostLocale(): Locale {
  try {
    const url = new URLSearchParams(location.search).get('locale');
    if (url === 'en' || url === 'zh') return url;
  } catch { /* */ }
  try {
    const raw = localStorage.getItem(LOCALE_KEY);
    if (raw === 'zh' || raw === 'en') return raw;
  } catch { /* */ }
  return 'en';
}

function wireHostLocaleSync(apply: (l: Locale) => void): void {
  apply(readHostLocale());
  if (typeof window === 'undefined') return;
  window.addEventListener('storage', (e) => {
    if (e.key === LOCALE_KEY && (e.newValue === 'en' || e.newValue === 'zh')) {
      apply(e.newValue);
    }
  });
  window.addEventListener('message', (e) => {
    const d = e.data as { type?: string; locale?: string } | null;
    if (!d || d.type !== LOCALE_MSG) return;
    if (d.locale === 'en' || d.locale === 'zh') apply(d.locale);
  });
}

export function initLocaleSync(): void {
  wireHostLocaleSync(setLocale);
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let s = UI_CATALOGS[current][key] ?? UI_CATALOGS.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return s;
}

export function tf(key: string, vars: Record<string, string | number>): string {
  return t(key, vars);
}

/** Re-render when host locale changes (React components). */
export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  useSyncExternalStore(onLocaleChange, getLocale, getLocale);
  return t;
}

export function tStepLabel(stepId: string, fallback?: string): string {
  const key = `step.${stepId}.label`;
  const hit = t(key);
  return hit === key ? (fallback ?? stepId) : hit;
}

export function tStepTags(stepId: string): string[] {
  const tags: string[] = [];
  for (let i = 0; ; i++) {
    const key = `step.${stepId}.tag.${i}`;
    const hit = t(key);
    if (hit === key) break;
    tags.push(hit);
  }
  return tags;
}

export function tDisplayState(state: string): string {
  const key = `display.${state}`;
  const hit = t(key);
  return hit === key ? state : hit;
}
