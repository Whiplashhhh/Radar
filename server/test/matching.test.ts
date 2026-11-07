import { describe, expect, it } from 'vitest';
import { bestLevel, keywordRegex, matchAll, matchWatch, type WatchRule } from '../src/core/matching';
import { SEED_WATCHLIST } from '../src/seed/watchlist';

const rules: WatchRule[] = SEED_WATCHLIST.map((w, i) => ({ id: i + 1, name: w.name, aliases: w.aliases, cpes: w.cpes ?? [], packages: w.packages ?? [], exclude: w.exclude ?? [] }));
const rule = (name: string) => rules.find((r) => r.name === name) as WatchRule;
const kw = (name: string, text: string) => matchWatch(rule(name), { text })?.level ?? null;

describe('keywordRegex', () => {
  it('respecte les frontières de mot', () => {
    expect(keywordRegex('Chrome').test('Google Chrome 130')).toBe(true);
    expect(keywordRegex('Chrome').test('Chromecast firmware')).toBe(false);
    expect(keywordRegex('Node.js').test('Node.js 22.11 release')).toBe(true);
    expect(keywordRegex('Node.js').test('in node-fetch')).toBe(false);
  });
  it('gère les alias sensibles à la casse', () => {
    expect(keywordRegex('=React').test('React 19 fixes')).toBe(true);
    expect(keywordRegex('=React').test('how users react to it')).toBe(false);
  });
  it('accepte les espaces variables dans les alias multi-mots', () => {
    expect(keywordRegex('Spring Boot').test('Spring  Boot 3.4')).toBe(true);
  });
});

describe('matching par mots-clés (cas pièges)', () => {
  it('« React » ne matche pas n’importe quel texte contenant « react »', () => {
    expect(kw('React', 'A reactive streams library')).toBeNull();
    expect(kw('React', 'Chemical reaction in the lab')).toBeNull();
    expect(kw('React', 'Companies must react to the new rule')).toBeNull();
    expect(kw('React', 'preact-render-to-string XSS')).toBeNull();
    expect(kw('React', 'XSS in React Server Components')).toBe('probable');
    expect(kw('React', 'A flaw in ReactJS apps')).toBe('probable');
  });
  it('Vue : pas de faux positif sur le mot français « vue »', () => {
    expect(kw('Vue.js', 'Une vue d’ensemble des menaces')).toBeNull();
    expect(kw('Vue.js', 'Vue.js 3.5 est disponible')).toBe('probable');
  });
  it('Python : un package « python-requests » n’est pas Python', () => {
    expect(kw('Python', 'python-requests leaks credentials')).toBeNull();
    expect(kw('Python', 'CPython 3.13 tarfile flaw')).toBe('probable');
    expect(kw('Python', 'Monty Python and Python fans')).toBeNull();
  });
  it('Java : JavaScript n’est pas Java', () => {
    expect(kw('Java / OpenJDK', 'JavaScript engine bug')).toBeNull();
    expect(kw('Java / OpenJDK', 'Oracle Java SE critical patch')).toBe('probable');
  });
  it('Chrome vs Chromecast et extensions', () => {
    expect(kw('Chrome', 'Chromecast with Google TV')).toBeNull();
    expect(kw('Chrome', 'Malicious Chrome extensions steal cookies')).toBeNull();
    expect(kw('Chrome', 'Google Chrome zero-day exploited')).toBe('probable');
  });
  it('WordPress : les plugins sont exclus', () => {
    expect(kw('WordPress', 'The Foo plugin for WordPress is vulnerable to SQLi')).toBeNull();
    expect(kw('WordPress', 'WordPress 6.7.1 security release')).toBe('probable');
  });
  it('Docker : Docker Desktop exclu, runc compte', () => {
    expect(kw('Docker', 'Docker Desktop for Windows privilege escalation')).toBeNull();
    expect(kw('Docker', 'runc container escape')).toBe('probable');
  });
  it('Dart sensible à la casse', () => {
    expect(kw('Flutter / Dart', 'a poisoned dart attack')).toBeNull();
    expect(kw('Flutter / Dart', 'Dart SDK 3.6')).toBe('probable');
  });
  it('n8n et Pi-hole', () => {
    expect(kw('n8n', 'n8n workflow RCE')).toBe('probable');
    expect(kw('Pi-hole', 'Pi-hole v6 web interface XSS')).toBe('probable');
  });
});

describe('matching structuré', () => {
  it('package avec glob → certain', () => {
    const r = matchWatch(rule('Spring'), { text: 'nothing', packages: [{ ecosystem: 'maven', package: 'org.springframework.boot:spring-boot-actuator' }] });
    expect(r?.level).toBe('certain');
    expect(r?.reason).toContain('org.springframework.boot');
  });
  it('package npm exact : « vue » mais pas « vue-i18n »', () => {
    expect(matchWatch(rule('Vue.js'), { text: '', packages: [{ ecosystem: 'npm', package: 'vue' }] })?.level).toBe('certain');
    expect(matchWatch(rule('Vue.js'), { text: '', packages: [{ ecosystem: 'npm', package: 'vue-i18n' }] })).toBeNull();
    expect(matchWatch(rule('Vue.js'), { text: '', packages: [{ ecosystem: 'npm', package: '@vue/compiler-sfc' }] })?.level).toBe('certain');
  });
  it('écosystème normalisé (PyPI → pip)', () => {
    const r: WatchRule = { id: 99, name: 'Django', aliases: [], cpes: [], packages: ['pip:django'], exclude: [] };
    expect(matchWatch(r, { text: '', packages: [{ ecosystem: 'PyPI', package: 'Django' }] })?.level).toBe('certain');
  });
  it('CPE vendor:product → certain, même si un mot d’exclusion est présent', () => {
    const r = matchWatch(rule('Docker'), { text: 'Docker Desktop', cpes: ['cpe:2.3:a:docker:docker:*:*:*:*:*:*:*:*'] });
    expect(r?.level).toBe('certain');
  });
  it('CPE d’un autre produit du même vendor → pas de match', () => {
    expect(matchWatch(rule('Chrome'), { text: '', cpes: ['cpe:2.3:a:google:android:*:*:*:*:*:*:*:*'] })).toBeNull();
  });
  it('certain l’emporte sur probable', () => {
    const res = matchAll(rules, { text: 'React and Node.js', packages: [{ ecosystem: 'npm', package: 'react-dom' }] });
    expect(res.find((r) => r.name === 'React')?.level).toBe('certain');
    expect(res.find((r) => r.name === 'Node.js')?.level).toBe('probable');
    expect(bestLevel(res)).toBe('certain');
  });
  it('les entrées désactivées sont ignorées', () => {
    expect(matchAll([{ ...rule('n8n'), enabled: false }], { text: 'n8n' })).toEqual([]);
  });
});
