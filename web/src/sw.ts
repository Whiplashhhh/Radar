/// <reference lib="webworker" />
import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// SPA : toutes les navigations servent index.html (hors API).
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/health/] }));

// API en lecture : réseau d'abord, cache en secours (mode hors-ligne : derniers items, favoris, fiches).
registerRoute(
  ({ url, request }) => request.method === 'GET' && url.origin === self.location.origin && /^\/api\/(items|vulns|briefings|stats|watchlist|feeds|settings)/.test(url.pathname),
  new NetworkFirst({
    cacheName: 'radar-api',
    networkTimeoutSeconds: 5,
    plugins: [new ExpirationPlugin({ maxEntries: 400, maxAgeSeconds: 14 * 24 * 3600 })],
  }),
);

// Images des articles (tiers) : cache opportuniste.
registerRoute(
  ({ request, url }) => request.destination === 'image' && url.origin !== self.location.origin,
  new StaleWhileRevalidate({ cacheName: 'radar-img', plugins: [new ExpirationPlugin({ maxEntries: 150, maxAgeSeconds: 7 * 24 * 3600 })] }),
);

self.addEventListener('message', (e) => {
  if ((e.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting();
});

interface Payload {
  title: string;
  body: string;
  url: string;
  tag?: string;
  severity?: string | null;
  techs?: string[];
  badge?: number;
  critical?: boolean;
}

/** Le payload se suffit à lui-même : aucune requête réseau (le téléphone peut être hors du tailnet). */
self.addEventListener('push', (event) => {
  let p: Payload;
  try {
    p = event.data?.json() as Payload;
  } catch {
    p = { title: 'Radar', body: event.data?.text() ?? '', url: '/priority' };
  }
  const nav = self.navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  const badge = typeof p.badge === 'number' ? (p.badge > 0 ? nav.setAppBadge?.(p.badge) : nav.clearAppBadge?.()) : undefined;
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(p.title, {
        body: p.body,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        tag: p.tag,
        data: { url: p.url },
        requireInteraction: !!p.critical,
        lang: 'fr',
      } as NotificationOptions),
      badge?.catch(() => {}),
      self.clients.matchAll({ type: 'window' }).then((cs) => cs.forEach((c) => c.postMessage({ type: 'radar:refresh' }))),
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data as { url?: string } | null)?.url ?? '/priority', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clients) {
        if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
          await c.focus();
          await (c as WindowClient).navigate(target).catch(() => c.postMessage({ type: 'radar:navigate', url: target }));
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

// Renouvellement d'abonnement (clés tournées par le navigateur)
self.addEventListener('pushsubscriptionchange', (event) => {
  const e = event as Event & { oldSubscription?: PushSubscription; waitUntil(p: Promise<unknown>): void };
  e.waitUntil(
    (async () => {
      const res = await fetch('/api/push/key');
      const { publicKey } = (await res.json()) as { publicKey: string };
      const raw = atob((publicKey + '='.repeat((4 - (publicKey.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
      const key = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await fetch('/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
    })(),
  );
});
