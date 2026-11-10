// Apply the viewer's saved theme before first paint (per-viewer preference only)
try {
  var t = JSON.parse(localStorage.getItem('skynet_theme') || 'null');
  if (t) { document.documentElement.dataset.theme = t.theme || 'navy'; document.documentElement.dataset.mode = t.mode || 'dark'; }
} catch (e) { /* storage unavailable */ }
