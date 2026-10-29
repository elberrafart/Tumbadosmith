import { es } from './es';
import { en } from './en';

export type Lang = 'es' | 'en';
export type MessageKey = keyof typeof es;

const DICTS: Record<Lang, Record<MessageKey, string>> = { es, en };
let lang: Lang = 'es';

export function detectLang(): Lang {
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const p of prefs) {
    const code = p?.slice(0, 2).toLowerCase();
    if (code === 'es') return 'es';
    if (code === 'en') return 'en';
  }
  return 'es';
}

export function setLang(l: Lang): void {
  lang = l;
  document.documentElement.lang = l;
}

export function getLang(): Lang {
  return lang;
}

/** Translate, replacing {name} placeholders. */
export function t(key: MessageKey, vars: Record<string, string | number> = {}): string {
  const s = DICTS[lang][key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
