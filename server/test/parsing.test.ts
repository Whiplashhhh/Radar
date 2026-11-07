import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseKev } from '../src/adapters/cisa-kev';
import { parseEpss } from '../src/adapters/epss';
import { parseGhsa } from '../src/adapters/github-advisories';
import { parseNvd, RateLimiter } from '../src/adapters/nvd';
import { looksLikeFeed, parseDate, parseFeed } from '../src/adapters/rss';
import { discoverFeeds } from '../src/core/discovery';
import { buildOpml, parseOpml } from '../src/core/opml';
import { htmlToText, sanitize } from '../src/lib/html';

const fx = (f: string) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>CERT-FR</title><link>https://www.cert.ssi.gouv.fr/</link>
<item><title>Vulnérabilité dans OpenSSH (CVE-2024-6387)</title><link>https://www.cert.ssi.gouv.fr/alerte/CERTFR-2024-ALE-009/</link>
<guid isPermaLink="false">CERTFR-2024-ALE-009</guid><pubDate>Mon, 01 Jul 2024 14:30:00 +0200</pubDate>
<description><![CDATA[<p>Une vulnérabilité &eacute; <script>alert(1)</script><img src="/x.png" onerror="evil()"></p>]]></description>
<dc:creator>CERT-FR</dc:creator></item>
<item><title>Sans lien</title><guid>https://example.org/p/2</guid><pubDate>Tue, 02 Jul 2024 08:00:00 CEST</pubDate></item>
</channel></rss>`;

const RDF = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel rdf:about="https://lwn.net"><title>LWN.net</title><link>https://lwn.net</link></channel>
<item rdf:about="https://lwn.net/Articles/1/"><title>Kernel 6.12</title><link>https://lwn.net/Articles/1/</link><dc:date>2024-11-18T10:00:00+00:00</dc:date></item>
</rdf:RDF>`;

describe('parseFeed', () => {
  it('RSS 2.0 : champs, assainissement différé, auteur, date', () => {
    const f = parseFeed(RSS, 'https://www.cert.ssi.gouv.fr/alerte/feed/');
    expect(f.format).toBe('rss');
    expect(f.title).toBe('CERT-FR');
    expect(f.items).toHaveLength(2);
    const [a, b] = f.items;
    expect(a?.guid).toBe('CERTFR-2024-ALE-009');
    expect(a?.url).toBe('https://www.cert.ssi.gouv.fr/alerte/CERTFR-2024-ALE-009/');
    expect(a?.author).toBe('CERT-FR');
    expect(a?.publishedAt).toBe(Date.parse('2024-07-01T12:30:00Z'));
    expect(b?.url).toBe('https://example.org/p/2');
    expect(b?.publishedAt).not.toBeNull();
  });
  it('RSS 1.0 (RDF)', () => {
    const f = parseFeed(RDF, 'https://lwn.net/headlines/rss');
    expect(f.format).toBe('rdf');
    expect(f.items[0]?.title).toBe('Kernel 6.12');
    expect(f.items[0]?.publishedAt).toBe(Date.parse('2024-11-18T10:00:00Z'));
  });
  it('Atom (releases GitHub réelles)', () => {
    const f = parseFeed(fx('vue-releases.atom'), 'https://github.com/vuejs/core/releases.atom');
    expect(f.format).toBe('atom');
    expect(f.items.length).toBeGreaterThan(0);
    const it0 = f.items[0];
    expect(it0?.kind).toBe('release');
    expect(it0?.url).toMatch(/^https:\/\/github\.com\/vuejs\/core\/releases\/tag\//);
    expect(it0?.publishedAt).toBeGreaterThan(Date.parse('2020-01-01'));
  });
  it('refuse ce qui n’est pas un flux', () => {
    expect(() => parseFeed('<html><body>hi</body></html>')).toThrow(/Ni RSS ni Atom/);
    expect(() => parseFeed('pas du xml <<<')).toThrow();
  });
  it('détecte un flux', () => {
    expect(looksLikeFeed('﻿<?xml version="1.0"?>\n<rss version="2.0">', 'text/xml')).toBe(true);
    expect(looksLikeFeed('<!doctype html><html>', 'text/html')).toBe(false);
    expect(looksLikeFeed('', 'application/atom+xml')).toBe(true);
  });
  it('dates exotiques', () => {
    expect(parseDate('Tue, 02 Jul 2024 08:00:00 GMT')).toBe(Date.parse('2024-07-02T08:00:00Z'));
    expect(parseDate('n’importe quoi')).toBeNull();
  });
});

describe('sanitize', () => {
  it('retire scripts, handlers et résout les URL', () => {
    const out = sanitize('<p onclick="x()">Salut <script>alert(1)</script><a href="/p">lien</a><img src="/i.png" onerror="e()"><iframe src="https://evil"></iframe></p>', 'https://site.fr/a/');
    expect(out).not.toMatch(/script|onclick|onerror|iframe/);
    expect(out).toContain('href="https://site.fr/p"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('src="https://site.fr/i.png"');
  });
  it('bloque javascript: et data: hors images', () => {
    expect(sanitize('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript');
    expect(sanitize('<a href="data:text/html,x">x</a>')).not.toContain('data:');
  });
  it('supprime les pixels de tracking', () => {
    expect(sanitize('<img src="https://t.co/p.gif" width="1" height="1">')).toBe('');
  });
  it('htmlToText', () => {
    expect(htmlToText('<p>Bonjour&nbsp;<b>le</b></p><p>monde &amp; co</p>')).toBe('Bonjour le monde & co');
  });
});

describe('CISA KEV', () => {
  it('parse le catalogue réel et ne fait surfacer que les entrées récentes', () => {
    const cat = JSON.parse(fx('kev.json'));
    const now = Date.parse(`${cat.vulnerabilities[0].dateAdded}T12:00:00Z`);
    const vulns = parseKev(cat, now);
    expect(vulns.length).toBe(cat.vulnerabilities.length);
    const v = vulns[0]!;
    expect(v.id).toMatch(/^CVE-\d{4}-\d+$/);
    expect(v.kev).toBe(true);
    expect(v.surface).toBe(true);
    expect(v.description).toContain(cat.vulnerabilities[0].product);
    expect(parseKev(cat, now + 365 * 86_400_000)[0]?.surface).toBe(false);
  });
});

describe('GitHub Advisories', () => {
  it('parse les advisories réels (npm)', () => {
    const list = JSON.parse(fx('ghsa-npm.json'));
    const vulns = parseGhsa(list, Date.parse(list[0].published_at));
    expect(vulns.length).toBe(list.length);
    const v = vulns[0]!;
    expect(v.aliases).toContain(list[0].ghsa_id);
    expect(v.affected?.[0]?.ecosystem).toBe('npm');
    expect(v.sourceUrl).toMatch(/^https:\/\/github\.com\/advisories\/GHSA-/);
    expect(['critical', 'high', 'medium', 'low', 'unknown']).toContain(v.severity);
    expect(v.surface).toBe('relevant');
  });
  it('préfère le CVE comme id, gère first_patched_version objet', () => {
    const [v] = parseGhsa(
      [{ ghsa_id: 'GHSA-m5ph-mmg5-6w5h', cve_id: 'CVE-2026-1', html_url: 'https://github.com/advisories/GHSA-m5ph-mmg5-6w5h', summary: 's', description: null, severity: 'moderate', published_at: '2026-01-01T00:00:00Z', vulnerabilities: [{ package: { ecosystem: 'npm', name: 'x' }, vulnerable_version_range: '< 2', first_patched_version: { identifier: '2.0.0' } }], cvss: { vector_string: 'CVSS:3.1/AV:N', score: 5.3 } }],
      Date.parse('2026-01-02'),
    );
    expect(v?.id).toBe('CVE-2026-1');
    expect(v?.severity).toBe('medium');
    expect(v?.affected?.[0]?.patched).toBe('2.0.0');
    expect(v?.cvssVersion).toBe('3.1');
  });
  it('ignore les advisories retirées', () => {
    expect(parseGhsa([{ ghsa_id: 'GHSA-m5ph-mmg5-6w5h', cve_id: null, html_url: 'u', summary: 's', description: null, severity: 'high', published_at: '2026-01-01T00:00:00Z', withdrawn_at: '2026-01-02T00:00:00Z' }], 0)).toEqual([]);
  });
});

describe('NVD et EPSS', () => {
  const nvd = {
    vulnerabilities: [
      {
        cve: {
          id: 'CVE-2024-6387',
          published: '2024-07-01T13:15:00.000',
          descriptions: [{ lang: 'en', value: 'A signal handler race condition was found in OpenSSH server (sshd)' }],
          metrics: {
            cvssMetricV31: [
              { type: 'Secondary', cvssData: { baseScore: 8.1, baseSeverity: 'HIGH', vectorString: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H', version: '3.1' } },
            ],
          },
          configurations: [{ nodes: [{ cpeMatch: [{ vulnerable: true, criteria: 'cpe:2.3:a:openbsd:openssh:*:*:*:*:*:*:*:*', versionStartIncluding: '8.5', versionEndExcluding: '9.8' }] }] }],
          references: [{ url: 'https://www.openssh.com/txt/release-9.8', tags: ['Release Notes'] }],
        },
      },
    ],
  };
  it('parse CVSS, CPE et plages', () => {
    const d = parseNvd(nvd)!;
    expect(d.cvssScore).toBe(8.1);
    expect(d.severity).toBe('high');
    expect(d.cpes).toEqual(['cpe:2.3:a:openbsd:openssh:*:*:*:*:*:*:*:*']);
    expect(d.ranges[0]?.range).toBe('≥ 8.5, < 9.8');
    expect(d.publishedAt).toBe(Date.parse('2024-07-01T13:15:00Z'));
  });
  it('réponse vide → null', () => {
    expect(parseNvd({ vulnerabilities: [] })).toBeNull();
  });
  it('EPSS', () => {
    expect(parseEpss({ data: [{ cve: 'CVE-2021-44228', epss: '0.94358', percentile: '0.99' }] })).toEqual([{ cve: 'CVE-2021-44228', epss: 0.94358, percentile: 0.99 }]);
  });
  it('rate limiter à fenêtre glissante', () => {
    let t = 0;
    const rl = new RateLimiter(2, 30_000, () => t);
    expect(rl.take()).toBe(true);
    expect(rl.take()).toBe(true);
    expect(rl.take()).toBe(false);
    expect(rl.delay()).toBeGreaterThan(29_000);
    t = 30_001;
    expect(rl.take()).toBe(true);
  });
});

describe('découverte et OPML', () => {
  it('trouve les liens alternate', () => {
    const html = `<html><head><link rel="alternate" type="application/rss+xml" title="Flux" href="/feed/">
      <link rel="alternate" type="application/rss+xml" href="/comments/feed/"><link rel="stylesheet" href="/s.css"></head></html>`;
    expect(discoverFeeds(html, 'https://korben.info/x')).toEqual([{ url: 'https://korben.info/feed/', title: 'Flux', type: 'rss' }]);
  });
  it('aller-retour OPML', () => {
    const xml = buildOpml([
      { url: 'https://a.fr/feed', title: 'A & B', category: 'security', siteUrl: 'https://a.fr' },
      { url: 'https://b.fr/rss', title: 'B', category: 'tech' },
    ]);
    const back = parseOpml(xml);
    expect(back).toHaveLength(2);
    expect(back[0]).toMatchObject({ url: 'https://a.fr/feed', title: 'A & B', category: 'security', siteUrl: 'https://a.fr' });
    expect(back[1]?.category).toBe('tech');
  });
  it('OPML tiers imbriqué', () => {
    const xml = `<opml version="1.0"><body><outline text="Security"><outline text="Krebs" xmlUrl="https://krebsonsecurity.com/feed/"/></outline><outline text="X" xmlUrl="https://x.org/rss"/></body></opml>`;
    expect(parseOpml(xml)).toEqual([
      { url: 'https://krebsonsecurity.com/feed/', title: 'Krebs', siteUrl: null, category: 'security' },
      { url: 'https://x.org/rss', title: 'X', siteUrl: null, category: null },
    ]);
  });
});
