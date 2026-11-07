import { describe, expect, it } from 'vitest';
import { assertUrlAllowed, isPublicIp, safeFetch } from '../src/lib/safe-fetch';
import { deferForQuiet, inRange, isQuiet, nextLocalTime, zonedParts, zonedToUtc } from '../src/lib/time';
import { nextFetchDelay } from '../src/services/poller';

describe('anti-SSRF', () => {
  it('classe les IP', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.10', '172.16.0.1', '169.254.169.254', '100.101.102.103', '0.0.0.0', '::1', 'fd7a:115c:a1e0::1', 'fe80::1', '::ffff:127.0.0.1', '224.0.0.1']) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
    for (const ip of ['1.1.1.1', '140.82.112.3', '2606:4700:4700::1111']) expect(isPublicIp(ip), ip).toBe(true);
  });
  it('refuse les URL dangereuses', () => {
    expect(() => assertUrlAllowed('file:///etc/passwd')).toThrow(/Protocole/);
    expect(() => assertUrlAllowed('http://127.0.0.1:8787/api')).toThrow(/non publique/);
    expect(() => assertUrlAllowed('http://[::1]/')).toThrow(/non publique/);
    expect(() => assertUrlAllowed('http://localhost/')).toThrow(/local/);
    expect(() => assertUrlAllowed('http://nas.tail1234.ts.net/')).toThrow(/local/);
    expect(() => assertUrlAllowed('https://user:pw@example.com/')).toThrow(/Identifiants/);
    expect(assertUrlAllowed('http://127.0.0.1/', true).hostname).toBe('127.0.0.1');
    expect(assertUrlAllowed('https://example.com/feed').hostname).toBe('example.com');
  });
  it('safeFetch refuse une IP privée avant toute connexion', async () => {
    await expect(safeFetch('http://192.168.1.1/')).rejects.toThrow(/non publique/);
  });
});

describe('backoff', () => {
  it('exponentiel et plafonné', () => {
    expect(nextFetchDelay(30, 0)).toBe(30 * 60_000);
    expect(nextFetchDelay(30, 1)).toBe(60 * 60_000);
    expect(nextFetchDelay(30, 3)).toBe(240 * 60_000);
    expect(nextFetchDelay(30, 20)).toBe(24 * 60 * 60_000);
  });
});

describe('fuseau Europe/Paris', () => {
  const tz = 'Europe/Paris';
  it('zonedParts été / hiver', () => {
    expect(zonedParts(Date.parse('2026-07-01T20:30:00Z'), tz)).toMatchObject({ hour: 22, minute: 30, date: '2026-07-01' });
    expect(zonedParts(Date.parse('2026-01-01T23:30:00Z'), tz)).toMatchObject({ hour: 0, minute: 30, date: '2026-01-02' });
  });
  it('zonedToUtc', () => {
    expect(zonedToUtc(2026, 7, 1, 8, 0, tz)).toBe(Date.parse('2026-07-01T06:00:00Z'));
    expect(zonedToUtc(2026, 12, 1, 8, 0, tz)).toBe(Date.parse('2026-12-01T07:00:00Z'));
    // jour du passage à l'heure d'hiver (25 octobre 2026)
    expect(zonedToUtc(2026, 10, 25, 7, 0, tz)).toBe(Date.parse('2026-10-25T06:00:00Z'));
  });
  it('plages horaires passant minuit', () => {
    expect(inRange(23 * 60, 22 * 60, 7 * 60)).toBe(true);
    expect(inRange(6 * 60 + 59, 22 * 60, 7 * 60)).toBe(true);
    expect(inRange(7 * 60, 22 * 60, 7 * 60)).toBe(false);
    expect(inRange(12 * 60, 9 * 60, 17 * 60)).toBe(true);
    expect(inRange(12 * 60, 9 * 60, 9 * 60)).toBe(false);
  });
  it('heures calmes : décalage à la fin de plage', () => {
    const q = { enabled: true, start: '22:00', end: '07:00' };
    const night = Date.parse('2026-03-10T22:30:00Z'); // 23:30 à Paris
    expect(isQuiet(night, tz, q.start, q.end)).toBe(true);
    expect(deferForQuiet(night, tz, q)).toBe(Date.parse('2026-03-11T06:00:00Z'));
    const noon = Date.parse('2026-03-10T11:00:00Z');
    expect(deferForQuiet(noon, tz, q)).toBe(noon);
    expect(deferForQuiet(night, tz, { ...q, enabled: false })).toBe(night);
  });
  it('nextLocalTime', () => {
    const ts = Date.parse('2026-03-10T05:00:00Z'); // 06:00 Paris
    expect(nextLocalTime(ts, tz, '07:00')).toBe(Date.parse('2026-03-10T06:00:00Z'));
    expect(nextLocalTime(ts, tz, '05:00')).toBe(Date.parse('2026-03-11T04:00:00Z'));
  });
});
