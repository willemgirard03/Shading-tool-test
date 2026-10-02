/* The drawings' layout: views in rows, rearranged, resized, added and taken away.

   Between the views of a row, and at each end of it, is a margin; between the
   rows, and above and below them all, another. Every margin shows a + at its
   middle when the pointer is over it: it adds a view there, of any kind, from
   a list - a column in the row, or a row of its own. The margins between two
   views, and between two rows, can also be dragged: sideways to share a row's
   width differently, up and down to make a row taller or shorter.

   Each view's bar carries a grip. Dragged, the view can be dropped near the
   top or bottom edge of a row (a row of its own, the full width), near the left
   or right edge of a view (a column beside it), or over the middle of another
   view (the two change places). Its bar's - takes it off the page; the others
   in its row close up. A row left empty goes.

   The arrangement - which views, in which rows, at what widths and heights - is
   kept in this browser. It is how the page is looked at, not design.

   Every view is drawn on a sheet the shape of the space it has.            */

import { SHEET0 } from '../draw/svg.js';
import { VIEW_TYPES } from './views.js';

const KEY = 'solar-shading-layout-v7c';
const $ = id => document.getElementById(id);
export const LAYOUT0 = [{ views: [{ type: 'axon' }, { type: 'sun' }] }, { views: [{ type: 'section' }, { type: 'plan' }] }, { views: [{ type: 'detail' }] },
  { views: [{ type: 'gday' }, { type: 'gyear' }] }];

/** the sheet a view is drawn on: its width over the height it may use */
export function sheetFor(el) {
  if (!el || !el.isConnected) return SHEET0;
  const host = el.querySelector('.vhost');
  if (el.classList.contains('full')) {
    const r = el.getBoundingClientRect(), bar = el.querySelector('.v3dbar').getBoundingClientRect();
    const aw = Math.max(200, r.width - 16), ah = Math.max(200, r.bottom - bar.bottom - 12);
    return [Math.max(300, 500 * aw / ah), 500];
  }
  const w = host.clientWidth || el.clientWidth;
  if (!w) return SHEET0;
  const row = el.parentElement, rh = row && row.dataset.h ? +row.dataset.h : 0;
  if (rh) {
    // a row given a height: the drawing takes what its bar and figures leave
    const bar = el.querySelector('.v3dbar').offsetHeight, ttl = el.querySelector('.vtitle').offsetHeight;
    const h = Math.max(160, rh - bar - ttl);
    return [Math.max(200, SHEET0[1] * w / h), SHEET0[1]];
  }
  // tall enough to read, never taller than most of the screen
  const h = Math.min(w * SHEET0[1] / SHEET0[0], Math.max(420, window.innerHeight * 0.78));
  return [Math.max(SHEET0[0], SHEET0[1] * w / h), SHEET0[1]];
}

/** a view joining a row takes the row's average share of its width - a row
 *  whose widths have been dragged holds shares in pixels, and a newcomer at
 *  the default share of 1 would all but vanish */
function fitIn(el, row) {
  const others = viewsOf(row).filter(v => v !== el);
  if (!others.length) { el.style.flexGrow = ''; return; }
  const g = others.reduce((a, v) => a + (+v.style.flexGrow || 1), 0) / others.length;
  el.style.flexGrow = g;
}
const rowsOf = () => [...$('views').querySelectorAll(':scope > .vrow')];
const viewsOf = row => [...row.querySelectorAll(':scope > .view')];

/** the arrangement, for keeping */
function snapshot() {
  return rowsOf().map(r => ({ h: r.dataset.h ? +r.dataset.h : null,
    views: viewsOf(r).map(v => ({ type: v.dataset.type, pin: v.dataset.pin || null, grow: +(v.style.flexGrow || 1) })) }));
}
export function saveLayout() { try { localStorage.setItem(KEY, JSON.stringify(snapshot())); } catch (_) { } }

/** the rows built afresh from a kept arrangement, or the first one; make(type) returns a new view */
export function buildLayout(make, fresh = false) {
  let rows = null;
  if (!fresh) try { rows = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { rows = null; }
  if (fresh) try { localStorage.removeItem(KEY); } catch (_) { }
  const ok = Array.isArray(rows) && rows.every(r => r && Array.isArray(r.views) && r.views.every(v => v && VIEW_TYPES[v.type]));
  if (!ok) rows = LAYOUT0;
  const host = $('views');
  host.innerHTML = '';
  for (const r of rows) {
    const row = document.createElement('div'); row.className = 'vrow';
    if (r.h) row.dataset.h = r.h;
    for (const v of r.views) { const inst = make(v.type, v.pin); if (v.grow) inst.el.style.flexGrow = v.grow; row.appendChild(inst.el); }
    host.appendChild(row);
  }
  margins();
}

/* ---------- the margins: a + on each, and the ones between can be dragged ---------- */
function margin(kind, end) {
  const d = document.createElement('div');
  d.className = (kind === 'col' ? 'vdiv' : 'hdiv') + (end ? ' end' : '');
  d.innerHTML = '<button type="button" class="vplus" title="Add a view here">+</button>';
  return d;
}
/** every margin taken out and put back where the rows and views now stand */
export function margins() {
  const host = $('views');
  host.querySelectorAll('.vdiv, .hdiv').forEach(d => d.remove());
  for (const r of rowsOf()) if (!r.querySelector('.view')) r.remove();
  const rows = rowsOf();
  rows.forEach((row, i) => {
    host.insertBefore(margin('row', i === 0), row);
    const vs = viewsOf(row);
    vs.forEach((v, j) => row.insertBefore(margin('col', j === 0), v));
    row.appendChild(margin('col', true));
  });
  host.appendChild(margin('row', true));
  host.classList.toggle('empty', !rows.length);
}

/** where a view taken off the page, or dragged, leaves the rest */
export function removeView(el) { el.remove(); margins(); saveLayout(); }

/* ---------- the list a + opens ---------- */
let menu = null;
function closeMenu() { if (menu) { menu.remove(); menu = null; } }
function openMenu(btn, onPick) {
  closeMenu();
  const r = btn.getBoundingClientRect();
  menu = document.createElement('div');
  menu.className = 'vmenu';
  menu.innerHTML = '<p>Add a view</p>' + Object.entries(VIEW_TYPES).map(([k, l]) => `<button type="button" data-add="${k}">${l}</button>`).join('');
  Object.assign(menu.style, { left: Math.round(r.left + r.width / 2 + window.scrollX) + 'px', top: Math.round(r.bottom + 4 + window.scrollY) + 'px' });
  document.body.appendChild(menu);
  menu.addEventListener('click', e => { const b = e.target.closest('[data-add]'); if (b) { closeMenu(); onPick(b.dataset.add); } });
}

/* ---------- moving a view by its grip ---------- */
function dropAt(x, y, dragged) {
  for (const row of rowsOf()) {
    const rr = row.getBoundingClientRect();
    if (y < rr.top - 8 || y > rr.bottom + 8) continue;
    const edge = Math.min(46, rr.height * 0.18);
    if (y < rr.top + edge) return { kind: 'row', row, side: 'before', rect: [rr.left, rr.top - 4, rr.width, 8] };
    if (y > rr.bottom - edge) return { kind: 'row', row, side: 'after', rect: [rr.left, rr.bottom - 4, rr.width, 8] };
    for (const v of viewsOf(row)) {
      const vr = v.getBoundingClientRect();
      if (x < vr.left - 6 || x > vr.right + 6) continue;
      const m = Math.min(90, vr.width * 0.25);
      if (x < vr.left + m) return { kind: 'col', view: v, side: 'before', rect: [vr.left - 4, vr.top, 8, vr.height] };
      if (x > vr.right - m) return { kind: 'col', view: v, side: 'after', rect: [vr.right - 4, vr.top, 8, vr.height] };
      if (v === dragged) return null;
      return { kind: 'swap', view: v, rect: [vr.left, vr.top, vr.width, vr.height] };
    }
  }
  return null;
}
function drop(t, v) {
  if (!t) return false;
  if (t.kind === 'row') {
    const row = document.createElement('div'); row.className = 'vrow';
    t.row.parentElement.insertBefore(row, t.side === 'before' ? t.row : t.row.nextSibling);
    v.style.flexGrow = ''; row.appendChild(v);
  } else if (t.kind === 'col') {
    if (t.view === v) return false;
    t.view.parentElement.insertBefore(v, t.side === 'before' ? t.view : t.view.nextSibling);
    fitIn(v, v.parentElement);
  } else {
    const mark = document.createElement('span');
    v.parentElement.insertBefore(mark, v);
    t.view.parentElement.insertBefore(v, t.view);
    mark.parentElement.insertBefore(t.view, mark);
    mark.remove();
  }
  margins();
  return true;
}

/** make(type) returns a new view; onChange redraws after any change; onResize while a margin is dragged */
export function wireLayout(make, onChange, onResize) {
  const tgt = $('dropTarget'), host = $('views');
  let drag = null, size = null;
  // a + on a margin: a view of the kind picked, where the margin is
  host.addEventListener('click', e => {
    const b = e.target.closest('.vplus');
    if (!b) return;
    e.stopPropagation();
    const d = b.parentElement;
    openMenu(b, type => {
      const inst = make(type);
      if (d.classList.contains('vdiv')) { d.parentElement.insertBefore(inst.el, d); fitIn(inst.el, inst.el.parentElement); }
      else { const row = document.createElement('div'); row.className = 'vrow'; row.appendChild(inst.el); host.insertBefore(row, d); }
      margins(); saveLayout(); onChange();
    });
  });
  document.addEventListener('pointerdown', e => { if (menu && !menu.contains(e.target) && !e.target.closest('.vplus')) closeMenu(); });

  document.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !e.target.closest) return;
    // a margin between two views or two rows: resized by dragging
    const m = e.target.closest('.vdiv:not(.end), .hdiv:not(.end)');
    if (m && !e.target.closest('.vplus') && host.contains(m)) {
      if (m.classList.contains('vdiv')) {
        const row = m.parentElement, vs = viewsOf(row);
        vs.forEach(v => { v.style.flexGrow = Math.max(1, v.getBoundingClientRect().width); });
        const L = m.previousElementSibling, R = m.nextElementSibling;
        size = { kind: 'col', L, R, x: e.clientX, l: +L.style.flexGrow, r: +R.style.flexGrow };
      } else {
        const row = m.previousElementSibling;
        size = { kind: 'row', row, y: e.clientY, h: row.getBoundingClientRect().height };
      }
      document.body.classList.add(size.kind === 'col' ? 'sizingc' : 'sizingr');
      e.preventDefault();
      return;
    }
    const g = e.target.closest('.grip');
    if (!g) return;
    const v = g.closest('.view');
    if (!v || v.classList.contains('full')) return;
    drag = { v, x: e.clientX, y: e.clientY, on: false };
    e.preventDefault();
  });
  window.addEventListener('pointermove', e => {
    if (size) {
      if (size.kind === 'col') {
        const dx = e.clientX - size.x, min = 180;
        const l = Math.max(min, size.l + dx), r = Math.max(min, size.r - (l - size.l));
        size.L.style.flexGrow = l; size.R.style.flexGrow = r;
      } else size.row.dataset.h = Math.round(Math.max(260, size.h + e.clientY - size.y));
      onResize();
      return;
    }
    if (!drag) return;
    if (!drag.on && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    drag.on = true;
    drag.v.classList.add('dragging'); document.body.classList.add('moving');
    const t = dropAt(e.clientX, e.clientY, drag.v);
    drag.t = t;
    if (!t) { tgt.hidden = true; return; }
    const [l, tp, w, h] = t.rect;
    Object.assign(tgt.style, { left: l + window.scrollX + 'px', top: tp + window.scrollY + 'px', width: w + 'px', height: h + 'px' });
    tgt.className = 'droptarget ' + t.kind;
    tgt.hidden = false;
  });
  const end = () => {
    if (size) { size = null; document.body.classList.remove('sizingc', 'sizingr'); saveLayout(); onChange(); return; }
    if (!drag) return;
    const d = drag; drag = null;
    tgt.hidden = true; document.body.classList.remove('moving');
    d.v.classList.remove('dragging');
    if (d.on && drop(d.t, d.v)) { saveLayout(); onChange(); }
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  // a double click on a row's margin gives the row back its own height
  host.addEventListener('dblclick', e => {
    const m = e.target.closest('.hdiv:not(.end)');
    if (m && m.previousElementSibling) { delete m.previousElementSibling.dataset.h; saveLayout(); onChange(); }
  });
}
