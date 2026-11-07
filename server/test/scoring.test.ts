import { describe, expect, it } from 'vitest';
import { epssPoints, normalizeSeverity, PRIORITY_THRESHOLD, scoreItem, scoreVuln, severityFromCvss } from '../src/core/scoring';

describe('scoring', () => {
  it('sévérité depuis CVSS', () => {
    expect(severityFromCvss(9.8)).toBe('critical');
    expect(severityFromCvss(9.0)).toBe('critical');
    expect(severityFromCvss(7.0)).toBe('high');
    expect(severityFromCvss(6.9)).toBe('medium');
    expect(severityFromCvss(4)).toBe('medium');
    expect(severityFromCvss(0.1)).toBe('low');
    expect(severityFromCvss(null)).toBe('unknown');
  });
  it('normalise les libellés', () => {
    expect(normalizeSeverity('MODERATE')).toBe('medium');
    expect(normalizeSeverity('Important')).toBe('high');
    expect(normalizeSeverity('???')).toBe('unknown');
  });
  it('paliers EPSS', () => {
    expect(epssPoints(0.97)).toBe(20);
    expect(epssPoints(0.2)).toBe(12);
    expect(epssPoints(0.02)).toBe(5);
    expect(epssPoints(0.001)).toBe(0);
    expect(epssPoints(null)).toBe(0);
  });
  it('exemples de la SPEC', () => {
    expect(scoreVuln({ severity: 'critical', kev: true, epss: 0.9, matchLevel: 'certain' })).toBe(100);
    expect(scoreVuln({ severity: 'high', kev: false, epss: null, matchLevel: 'certain' })).toBe(60);
    expect(scoreVuln({ severity: 'medium', kev: false, epss: null, matchLevel: 'probable' })).toBe(30);
    expect(scoreVuln({ severity: 'critical', kev: false, epss: null, matchLevel: null })).toBe(40);
  });
  it('une CVE haute matchée est prioritaire, une critique non matchée sans KEV ne l’est pas', () => {
    expect(scoreVuln({ severity: 'high', kev: false, epss: null, matchLevel: 'certain' })).toBeGreaterThanOrEqual(PRIORITY_THRESHOLD);
    expect(scoreVuln({ severity: 'critical', kev: false, epss: 0.005, matchLevel: null })).toBeLessThan(PRIORITY_THRESHOLD);
  });
  it('KEV critique hors watchlist reste prioritaire (grosse actu sécu)', () => {
    expect(scoreVuln({ severity: 'critical', kev: true, epss: null, matchLevel: null })).toBeGreaterThanOrEqual(PRIORITY_THRESHOLD);
  });
  it('score d’article', () => {
    expect(scoreItem({ category: 'news', matchLevel: null })).toBe(5);
    expect(scoreItem({ category: 'security', boost: 50, matchLevel: null })).toBe(70);
    expect(scoreItem({ category: 'tech', matchLevel: 'certain' })).toBe(35);
    expect(scoreItem({ category: 'news', matchLevel: null, bestVulnScore: 90 })).toBe(80);
    expect(scoreItem({ category: 'security', boost: 80, matchLevel: 'certain' })).toBe(100);
  });
});
