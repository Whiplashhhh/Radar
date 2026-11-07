import { CheckCircle2, MoreVertical, PlusSquare, Share } from 'lucide-react';
import { isIOS, isStandalone } from '../lib/platform';
import { PageHeader } from '../components/ui';

/** Explique l'installation sur l'écran d'accueil (obligatoire pour le push sur iOS). */
export function InstallPage() {
  const ios = isIOS();
  return (
    <>
      <PageHeader title="Installer Radar" back />
      <main className="px-safe pb-tabbar mx-auto max-w-xl pt-6">
        {isStandalone() ? (
          <p className="flex items-center gap-2 rounded-2xl border border-ok/40 bg-surface p-4 text-ok"><CheckCircle2 /> Radar est déjà installé : vous pouvez activer les notifications dans Réglages.</p>
        ) : (
          <>
            <p className="text-[1.05rem] leading-relaxed text-muted">
              {ios
                ? 'Sur iPhone et iPad, les notifications push ne fonctionnent que si Radar est ajouté à l’écran d’accueil (iOS 16.4 ou plus récent). Ça prend 10 secondes :'
                : 'Installez Radar comme une application pour un accès rapide et les notifications :'}
            </p>
            <ol className="mt-6 space-y-4">
              {(ios
                ? [
                    { icon: <Share size={22} />, title: 'Touchez « Partager »', text: 'L’icône carrée avec une flèche, en bas de Safari (ou en haut sur iPad).' },
                    { icon: <PlusSquare size={22} />, title: '« Sur l’écran d’accueil »', text: 'Faites défiler la feuille de partage si besoin, puis « Ajouter ».' },
                    { icon: <CheckCircle2 size={22} />, title: 'Ouvrez Radar depuis l’icône', text: 'Puis Réglages → Notifications → « Activer les notifications ».' },
                  ]
                : [
                    { icon: <MoreVertical size={22} />, title: 'Ouvrez le menu du navigateur', text: 'Les trois points en haut à droite de Chrome.' },
                    { icon: <PlusSquare size={22} />, title: '« Installer l’application »', text: 'ou « Ajouter à l’écran d’accueil ».' },
                    { icon: <CheckCircle2 size={22} />, title: 'Activez les notifications', text: 'Réglages → Notifications → « Activer les notifications ».' },
                  ]
              ).map((s, i) => (
                <li key={i} className="flex gap-4 rounded-2xl border border-border bg-surface p-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-bg text-accent">{s.icon}</span>
                  <span>
                    <span className="block font-semibold">{i + 1}. {s.title}</span>
                    <span className="block text-muted">{s.text}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-6 text-sm text-faint">Radar doit être ouvert en HTTPS (via <code className="font-mono">tailscale serve</code>) pour que l’installation et le push fonctionnent.</p>
          </>
        )}
      </main>
    </>
  );
}
