import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { TabBar } from './components/TabBar';
import { ToastProvider } from './components/ui';
import { BriefingPage } from './pages/BriefingPage';
import { FeedPage } from './pages/FeedPage';
import { FeedsPage } from './pages/FeedsPage';
import { InstallPage } from './pages/InstallPage';
import { ItemPage } from './pages/ItemPage';
import { SettingsPage } from './pages/SettingsPage';
import { VulnPage } from './pages/VulnPage';
import { WatchEditPage, WatchlistPage } from './pages/WatchlistPage';

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <a href="#contenu" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:p-3">
          Aller au contenu
        </a>
        <div id="contenu" className="min-h-dvh min-[900px]:pl-60">
          <Routes>
            <Route path="/" element={<Navigate to="/priority" replace />} />
            <Route path="/priority" element={<FeedPage key="priority" view="priority" />} />
            <Route path="/security" element={<FeedPage key="security" view="security" />} />
            <Route path="/tech" element={<FeedPage key="tech" view="tech" />} />
            <Route path="/all" element={<FeedPage key="all" view="all" />} />
            <Route path="/item/:id" element={<ItemPage />} />
            <Route path="/vuln/:id" element={<VulnPage />} />
            <Route path="/briefing" element={<BriefingPage />} />
            <Route path="/briefing/:id" element={<BriefingPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/watchlist" element={<WatchlistPage />} />
            <Route path="/settings/watchlist/:id" element={<WatchEditPage />} />
            <Route path="/settings/feeds" element={<FeedsPage />} />
            <Route path="/install" element={<InstallPage />} />
            <Route path="*" element={<Navigate to="/priority" replace />} />
          </Routes>
        </div>
        <TabBar />
      </ToastProvider>
    </BrowserRouter>
  );
}
