// Appliqué avant le premier rendu pour éviter un flash de thème (script externe : compatible CSP).
(function () {
  try {
    var pref = localStorage.getItem('radar.theme') || 'dark';
    var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch {
    document.documentElement.dataset.theme = 'dark';
  }
})();
