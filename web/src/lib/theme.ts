export type ThemePref = 'dark' | 'light' | 'system';
const KEY = 'radar.theme';

export function getThemePref(): ThemePref {
  try {
    return (localStorage.getItem(KEY) as ThemePref | null) ?? 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(pref: ThemePref): void {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0d12' : '#f6f7f9');
}

export function setThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* stockage indisponible */
  }
  applyTheme(pref);
}
