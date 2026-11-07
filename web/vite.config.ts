import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: __dirname,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      registerType: 'prompt',
      manifest: {
        name: 'Radar — veille sécu & tech',
        short_name: 'Radar',
        description: 'Lecteur RSS auto-hébergé de veille sécurité et tech',
        lang: 'fr',
        dir: 'ltr',
        start_url: '/priority',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b0d12',
        theme_color: '#0b0d12',
        categories: ['news', 'productivity', 'security'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Prioritaire', url: '/priority' },
          { name: 'Briefing du matin', url: '/briefing' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8787', '/health': 'http://127.0.0.1:8787' },
  },
});
