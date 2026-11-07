import dns from 'node:dns';
import net from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici';

/** Plages refusées par défaut : tout ce qui n'est pas « unicast » public. */
export function isPublicIp(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return false;
  let addr = ipaddr.parse(ip);
  if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
    addr = (addr as ipaddr.IPv6).toIPv4Address();
  }
  // ipaddr.js classe 100.64.0.0/10 (CGNAT, donc Tailscale) en « carrierGradeNat »,
  // 169.254/16 en « linkLocal », fc00::/7 en « uniqueLocal », etc.
  return addr.range() === 'unicast';
}

export class FetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

export interface SafeFetchOptions {
  allowPrivate?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: string;
  maxRedirects?: number;
  userAgent?: string;
}

export interface SafeResponse {
  status: number;
  url: string;
  headers: Headers;
  body: Buffer;
  text(): string;
  json<T = unknown>(): T;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

function guardedLookup(allowPrivate: boolean) {
  return (hostname: string, options: dns.LookupOptions, cb: LookupCb) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return cb(err, '');
      const list = addresses as dns.LookupAddress[];
      const bad = list.find((a) => !allowPrivate && !isPublicIp(a.address));
      if (bad) {
        const e = new Error(`Adresse non publique refusée (${hostname} → ${bad.address})`) as NodeJS.ErrnoException;
        e.code = 'ESSRF';
        return cb(e, '');
      }
      if (options.all) return cb(null, list);
      const first = list[0];
      if (!first) return cb(new Error(`DNS vide pour ${hostname}`), '');
      cb(null, first.address, first.family);
    });
  };
}

const agents = new Map<boolean, Dispatcher>();
function agentFor(allowPrivate: boolean): Dispatcher {
  let a = agents.get(allowPrivate);
  if (!a) {
    a = new Agent({ connect: { lookup: guardedLookup(allowPrivate) as never }, connections: 16 });
    agents.set(allowPrivate, a);
  }
  return a;
}

export function assertUrlAllowed(raw: string, allowPrivate = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchError(`URL invalide : ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchError(`Protocole refusé : ${url.protocol}`);
  if (url.username || url.password) throw new FetchError('Identifiants dans l’URL refusés');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate) {
    if (net.isIP(host) && !isPublicIp(host)) throw new FetchError(`Adresse non publique refusée : ${host}`);
    if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.ts\.net)$/i.test(host)) {
      throw new FetchError(`Hôte local refusé : ${host}`);
    }
  }
  return url;
}

async function readLimited(res: Response, maxBytes: number): Promise<Buffer> {
  const len = Number(res.headers.get('content-length') ?? '0');
  if (len > maxBytes) throw new FetchError(`Réponse trop volumineuse (${len} octets)`);
  if (!res.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new FetchError(`Réponse trop volumineuse (> ${maxBytes} octets)`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function decode(body: Buffer, contentType: string | null): string {
  const m = /charset=["']?([\w-]+)/i.exec(contentType ?? '');
  let charset = m?.[1]?.toLowerCase();
  if (!charset) {
    const head = body.subarray(0, 512).toString('latin1');
    charset = /encoding=["']([\w-]+)["']/i.exec(head)?.[1]?.toLowerCase() ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase();
  }
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

/**
 * fetch protégé contre le SSRF : schéma http(s) uniquement, IP privées refusées à la résolution DNS
 * (y compris après chaque redirection, suivie manuellement), timeout global et taille maximale.
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const allowPrivate = opts.allowPrivate ?? false;
  const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
  let current = assertUrlAllowed(rawUrl, allowPrivate);
  const maxRedirects = opts.maxRedirects ?? 5;

  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      res = (await undiciFetch(current, {
        method: opts.method ?? 'GET',
        body: opts.body,
        redirect: 'manual',
        signal,
        dispatcher: agentFor(allowPrivate),
        headers: {
          'user-agent': opts.userAgent ?? 'Radar/0.1',
          accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/html;q=0.8, */*;q=0.5',
          ...opts.headers,
        },
      })) as unknown as Response;
    } catch (err) {
      const e = err as Error & { cause?: Error & { code?: string } };
      if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new FetchError('Délai dépassé');
      throw new FetchError(e.cause?.message ?? e.message);
    }

    if (res.status >= 300 && res.status < 400 && res.status !== 304) {
      const loc = res.headers.get('location');
      await res.body?.cancel().catch(() => {});
      if (!loc) throw new FetchError(`Redirection ${res.status} sans Location`, res.status);
      if (hop >= maxRedirects) throw new FetchError('Trop de redirections');
      current = assertUrlAllowed(new URL(loc, current).toString(), allowPrivate);
      continue;
    }

    const body = res.status === 304 ? Buffer.alloc(0) : await readLimited(res, maxBytes);
    const finalUrl = current.toString();
    return {
      status: res.status,
      url: finalUrl,
      headers: res.headers,
      body,
      text: () => decode(body, res.headers.get('content-type')),
      json: <T>() => JSON.parse(decode(body, res.headers.get('content-type'))) as T,
    };
  }
}
