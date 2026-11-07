import { describe, expect, it } from 'vitest';
import { canonicalUrl, titleKey } from '../src/core/dedup';
import { canonicalId, extractCves, extractGhsas, extractVulnIds } from '../src/core/ids';

describe('extraction d’identifiants', () => {
  it('extrait et normalise les CVE', () => {
    expect(extractCves('Patch CVE-2024-3094 et cve-2021-44228, encore CVE-2024-3094')).toEqual(['CVE-2024-3094', 'CVE-2021-44228']);
    expect(extractCves('CVE‑2024‑12345 (tirets insécables)')).toEqual(['CVE-2024-12345']);
    expect(extractCves('CVE-24-1 invalide, XCVE-2024-1234 invalide')).toEqual([]);
  });
  it('extrait les GHSA', () => {
    expect(extractGhsas('voir GHSA-m5ph-mmg5-6w5h et ghsa-92R3-p8c2-3fpx')).toEqual(['GHSA-m5ph-mmg5-6w5h', 'GHSA-92r3-p8c2-3fpx']);
    expect(extractGhsas('GHSA-aaaa-bbbb-cccc')).toEqual([]); // alphabet GHSA restreint
  });
  it('combine', () => {
    expect(extractVulnIds('CVE-2025-0001 / GHSA-m5ph-mmg5-6w5h')).toEqual(['CVE-2025-0001', 'GHSA-m5ph-mmg5-6w5h']);
  });
  it('identifiant canonique : CVE le plus ancien, sinon GHSA', () => {
    expect(canonicalId(['GHSA-m5ph-mmg5-6w5h', 'CVE-2025-9', 'CVE-2024-1000'])).toBe('CVE-2024-1000');
    expect(canonicalId(['GHSA-m5ph-mmg5-6w5h'])).toBe('GHSA-m5ph-mmg5-6w5h');
  });
});

describe('dédup', () => {
  it('URL canonique', () => {
    expect(canonicalUrl('http://www.Example.com/a/b/?utm_source=x&id=2&fbclid=1#top')).toBe('https://example.com/a/b?id=2');
    expect(canonicalUrl('https://example.com/')).toBe('https://example.com/');
    expect(canonicalUrl('https://example.com/x?b=2&a=1')).toBe('https://example.com/x?a=1&b=2');
    expect(canonicalUrl('javascript:alert(1)')).toBeNull();
    expect(canonicalUrl(null)).toBeNull();
  });
  it('clé de titre robuste aux accents et à la ponctuation', () => {
    expect(titleKey('Faille critique dans OpenSSH : mettez à jour !')).toBe(titleKey('faille critique dans openssh — mettez a jour'));
    expect(titleKey('Court')).toBeNull();
  });
});
