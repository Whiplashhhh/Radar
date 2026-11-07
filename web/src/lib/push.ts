import { api } from '../api';
import { pushSupported } from './platform';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/**
 * Active le push sur cet appareil. DOIT être appelé depuis un geste utilisateur (clic) :
 * iOS refuse la demande de permission sinon.
 */
export async function enablePush(): Promise<PushSubscription> {
  if (!pushSupported()) throw new Error('Notifications push non supportées par ce navigateur.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Permission refusée. Réactivez-la dans les réglages du système.' : 'Permission non accordée.');
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api.pushKey();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  await api.subscribe(sub.toJSON());
  return sub;
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.unsubscribe(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}

/** Badging API : nombre d'items prioritaires non lus sur l'icône de l'app. */
export function setBadge(n: number): void {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (n > 0) void nav.setAppBadge?.(n).catch(() => {});
    else void nav.clearAppBadge?.().catch(() => {});
  } catch {
    /* non supporté */
  }
}
