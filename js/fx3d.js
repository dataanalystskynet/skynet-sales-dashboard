// =====================================================================
// SKYNET EXPRESS – fx3d.js : dashboard-wide 3D motion
//  * 3D reveal: KPI cards / panels rise and un-tilt into place, staggered,
//    as they enter the viewport (works for every page, also after re-render)
//  * pointer tilt: KPI cards (strong) and chart panels (subtle) lean towards
//    the cursor, then settle back
// Pure presentation – no data, no storage. Disabled for reduced motion.
// =====================================================================
const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const SEL = '.kpi, .panel, .summary-strip, .stat-tile';
const seen = new WeakSet();

const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  // stagger the elements that become visible together
  const vis = entries.filter((e) => e.isIntersecting).map((e) => e.target)
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left);
  vis.forEach((el, i) => {
    io.unobserve(el);
    el.style.setProperty('--fx-delay', Math.min(i * 70, 700) + 'ms');
    requestAnimationFrame(() => el.classList.add('fx-in'));
    const done = () => { el.classList.add('fx-done'); el.removeEventListener('transitionend', done); };
    el.addEventListener('transitionend', done);
    setTimeout(done, 1600 + i * 70);
  });
}, { threshold: 0.08, rootMargin: '0px 0px -4% 0px' }) : null;

function tilt(el, max) {
  let raf = 0;
  el.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { el.style.setProperty('--ry', (px * max).toFixed(2) + 'deg'); el.style.setProperty('--rx', (-py * max).toFixed(2) + 'deg'); });
  });
  el.addEventListener('pointerleave', () => { cancelAnimationFrame(raf); el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); });
}

function enhance(root) {
  if (reduce()) return;
  root.querySelectorAll(SEL).forEach((el) => {
    if (seen.has(el)) return; seen.add(el);
    if (io && !el.closest('.modal, .drawer')) { el.classList.add('fx-reveal'); io.observe(el); }
    if (el.classList.contains('kpi')) tilt(el, 14);
    else if (el.classList.contains('panel') && el.querySelector('.chart-box')) tilt(el, 3);
  });
}

export function startFx3d() {
  const view = document.getElementById('view'); if (!view) return;
  enhance(view);
  new MutationObserver(() => enhance(view)).observe(view, { childList: true, subtree: true });
}
