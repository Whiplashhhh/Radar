import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, getThemePref } from './lib/theme';
import './index.css';

applyTheme(getThemePref());
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (getThemePref() === 'system') applyTheme('system');
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true, networkMode: 'offlineFirst' },
    mutations: { networkMode: 'offlineFirst' },
  },
});

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const update = registerSW({
      immediate: true,
      onNeedRefresh() {
        // Nouvelle version : on l'active au prochain passage en arrière-plan pour ne pas couper la lecture.
        document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void update(true), { once: true });
      },
    });
  });
  // Le SW demande de rafraîchir les données (clic sur une notification, nouvel abonnement…)
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent<{ type?: string }>) => {
    if (e.data?.type === 'radar:refresh') void queryClient.invalidateQueries();
  });
}
