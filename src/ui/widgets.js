/* The small windows that hang off the drawings - the picked window's or
   device's, the selected storey's, the site boundary's - and the one rule
   they all keep, the rule the views' own bars keep: on the screen while any
   of their view is, under its bar, and gone with it once it is scrolled past.

   One opens beside what it belongs to and follows it as the drawing moves -
   unless it is one that stays put once opened, so that the same button can be
   pressed again and again. Moved by its title, it keeps its place against its
   view; closed, it forgets that place, and opens beside its thing again. */

const ALL = [];
const clampN = (x, a, b) => Math.min(b, Math.max(a, x));

/** a small window: { el, at, st: 'open' | 'min' | 'closed', off, anchor, stay } */
export function makeWidget(cls, hooks = {}) {
  const el = document.createElement('div');
  el.className = 'devpop' + (cls ? ' ' + cls : ''); el.hidden = true;
  document.body.appendChild(el);
  const w = { el, at: null, st: 'closed', off: null, anchor: null, stay: !!hooks.stay, html: '', hooks };
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const act = e.target.closest('[data-popact]');
    if (act) {
      e.preventDefault();
      if (act.dataset.popact === 'close') closeWidget(w);
      else if (act.dataset.popact === 'more') { w.more = !w.more; w.el.style.width = ''; }
      else {
        w.st = w.st === 'min' ? 'open' : 'min';
        // folded, it keeps its width, so its buttons stay under the pointer
        el.style.width = w.st === 'min' ? el.offsetWidth + 'px' : '';
      }
      if (hooks.change) hooks.change(w);
      return;
    }
    if (!e.target.closest('.dvhd') || e.target.closest('input, select, button')) return;
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY, l0 = el.offsetLeft, t0 = el.offsetTop;
    const move = ev => {
      const x = clampN(l0 + ev.clientX - x0, 4, innerWidth - el.offsetWidth - 4), y = clampN(t0 + ev.clientY - y0, 4, innerHeight - el.offsetHeight - 4);
      el.style.left = x + 'px'; el.style.top = y + 'px';
      const vr = w.at && w.at.el.getBoundingClientRect();
      if (vr) w.off = [x - vr.left, y - vr.top];
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
  ALL.push(w);
  return w;
}
/** opened afresh beside what it belongs to */
export function openWidget(w, inst) { w.at = inst || w.at; w.st = 'open'; w.off = null; w.el.style.width = ''; }
/** closed: it forgets where it was moved to */
export function closeWidget(w) { w.st = 'closed'; w.off = null; w.el.hidden = true; w.el.style.width = ''; }
export function hideWidget(w) { w.el.hidden = true; }

/** drawn: its content, and where it hangs - anchor { x, y } in its view's drawing, and the side it opens to */
export function showWidget(w, html, anchor) {
  if (w.st === 'closed' || !w.at) { w.el.hidden = true; return; }
  if (w.html !== html) { w.el.innerHTML = html; w.html = html; }
  w.el.classList.toggle('min', w.st === 'min');
  w.anchor = anchor || w.anchor;
  w.el.hidden = false;
  placeWidget(w);
}

/** the anchor on the screen */
function anchorAt(w) {
  const a = w.anchor, svgEl = a && w.at.host.querySelector('svg'), ctm = svgEl && svgEl.getScreenCTM && svgEl.getScreenCTM();
  if (!ctm) return null;
  const pt = svgEl.createSVGPoint(); pt.x = a.x; pt.y = a.y;
  return pt.matrixTransform(ctm);
}
/** where it stands: beside its anchor or where it was moved to - then kept on the screen while its view is */
export function placeWidget(w) {
  if (w.el.hidden || !w.at || !w.at.el.isConnected) return;
  const el = w.el, vr = w.at.el.getBoundingClientRect(), wd = el.offsetWidth, h = el.offsetHeight;
  let x, y;
  if (w.off) { x = vr.left + w.off[0]; y = vr.top + w.off[1]; }
  else {
    const c = anchorAt(w);
    if (!c) return;
    const left = w.anchor.side === 'left';
    x = left ? c.x - 18 - wd : c.x + 18; y = w.anchor.mid ? c.y - h / 2 : c.y + 18;
    // turned to the other side where it would leave its view, then held inside it where it fits
    const L = Math.max(4, vr.left + 4), R = Math.min(innerWidth - 4, vr.right - 4);
    if (!left && x + wd > R) x = c.x - 18 - wd;
    if (left && x < L) x = c.x + 18;
    if (R - L >= wd) x = clampN(x, L, R - wd);
    // clear of the other small windows open beside it: to their side, or under or over them
    const others = (w.hooks.avoid ? w.hooks.avoid() : []).filter(o => o && o !== w && !o.el.hidden).map(o => o.el.getBoundingClientRect());
    const hit = (cx, cy) => others.some(r => cx < r.right + 4 && cx + wd > r.left - 4 && cy < r.bottom + 4 && cy + h > r.top - 4);
    if (hit(x, y)) {
      const tries = [];
      for (const r of others) tries.push([r.right + 8, y], [r.left - 8 - wd, y], [x, r.bottom + 8], [x, r.top - 8 - h]);
      const ok = tries.find(([cx, cy]) => cx >= 4 && cx + wd <= innerWidth - 4 && cy >= vr.top && cy + h <= vr.bottom && !hit(cx, cy));
      if (ok) [x, y] = ok;
    }
    // one that stays put keeps the place it opened in, against its view
    if (w.stay) w.off = [x - vr.left, y - vr.top];
  }
  // under the view's bar and over the dock, while the view is on the screen; past it, it goes with the view
  const bar = w.at.el.querySelector('.v3dbar'), dock = document.getElementById('dock');
  const T = (bar ? bar.getBoundingClientRect().bottom : vr.top) + 4;
  const B = Math.min(innerHeight, dock && dock.offsetHeight ? dock.getBoundingClientRect().top : innerHeight) - 4;
  const lo = Math.min(T, vr.bottom - h), hi = Math.max(B - h, vr.top);
  y = Math.max(lo, Math.min(hi, y));
  x = clampN(x, 4, innerWidth - wd - 4);
  el.style.left = Math.round(x) + 'px'; el.style.top = Math.round(y) + 'px';
}
const placeAll = () => { for (const w of ALL) placeWidget(w); };
if (typeof addEventListener === 'function') {
  addEventListener('scroll', placeAll, { passive: true, capture: true });
  addEventListener('resize', placeAll);
}
