/* SVG as strings: the drawing primitives every view is built from.
   Colours are CSS custom properties, so the sheet's palette lives in one place. */

import { fmt } from '../util.js';

/* every drawing's frame: 470 x 500 on the page; a view opened full screen is
   drawn on a sheet as wide as the screen allows, at the same height, so text
   and lines keep their size and only the drawing gains room */
export let W = 470, H = 500;
export const SHEET0 = [470, 500];
export function setSheet(w, h) { W = Math.round(w); H = Math.round(h); }

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
export function El(tag, a, inner) {
  let s = '<' + tag;
  for (const k in a) if (a[k] !== undefined && a[k] !== null) s += ' ' + k + '="' + a[k] + '"';
  return inner === undefined ? s + '/>' : s + '>' + inner + '</' + tag + '>';
}
export const T = (x, y, txt, o = {}) => El('text', {
  x: fmt(x, 2), y: fmt(y, 2), fill: o.fill || 'var(--ink2)',
  'font-size': o.size || 9.5, 'font-family': o.mono === false ? 'var(--sans)' : 'var(--mono)',
  'text-anchor': o.anchor || 'start', transform: o.rot, opacity: o.op,
  // a figure that can be typed over: clicked, the page opens a box on it
  'data-edit': o.edit, class: o.edit ? 'editable' : undefined
}, esc(txt));
export const L = (x1, y1, x2, y2, o = {}) => El('line', {
  x1: fmt(x1, 2), y1: fmt(y1, 2), x2: fmt(x2, 2), y2: fmt(y2, 2),
  stroke: o.stroke || 'var(--ink)', 'stroke-width': o.w || 1,
  'stroke-dasharray': o.dash, 'stroke-linecap': o.cap, opacity: o.op, 'marker-end': o.marker
});
export const POLY = (pts, o = {}) => El('polygon', {
  points: pts.map(p => fmt(p[0], 2) + ',' + fmt(p[1], 2)).join(' '),
  fill: o.fill || 'none', stroke: o.stroke || 'none', 'stroke-width': o.w || 1,
  opacity: o.op, 'stroke-dasharray': o.dash
});
export const PATH = (d, o = {}) => El('path', {
  d, fill: o.fill || 'none', stroke: o.stroke || 'var(--ink)', 'stroke-width': o.w || 1,
  'stroke-dasharray': o.dash, opacity: o.op, 'stroke-linejoin': 'round'
});
export const RECT = (x, y, w, h, o = {}) => El('rect', Object.assign(
  { x: fmt(x, 2), y: fmt(y, 2), width: fmt(w, 2), height: fmt(h, 2) }, o));
export const CIRCLE = (x, y, r, o = {}) => El('circle', Object.assign({ cx: fmt(x, 2), cy: fmt(y, 2), r }, o));
/** a polyline through screen points as path data */
export const pathD = pts => pts.map((p, i) => (i ? 'L' : 'M') + fmt(p[0], 2) + ',' + fmt(p[1], 2)).join(' ');

export const defsCommon = `<defs>
 <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
   <path d="M0,1 L9,5 L0,9 z" fill="var(--sun)"/></marker>
 <marker id="ad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
   <path d="M0,2 L9,5 L0,8 z" fill="var(--ink3)"/></marker>
 <pattern id="poche" width="5" height="5" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
   <line x1="0" y1="0" x2="0" y2="5" stroke="var(--ink3)" stroke-width="1"/></pattern>
 <pattern id="shp" width="4" height="4" patternTransform="rotate(-45)" patternUnits="userSpaceOnUse">
   <rect width="4" height="4" fill="var(--shadefill)"/>
   <line x1="0" y1="0" x2="0" y2="4" stroke="var(--shade)" stroke-width="1"/></pattern>
</defs>`;

/** text on a small opaque backing, so it survives a busy drawing */
export function TB(x, y, txt, o = {}) {
  const w = String(txt).length * (o.size || 9.5) * 0.58 + 6, h = (o.size || 9.5) + 4;
  const ax = o.anchor === 'middle' ? x - w / 2 : o.anchor === 'end' ? x - w : x - 3;
  return RECT(ax, y - h + 3.5, w, h, { fill: 'var(--panel)', opacity: o.bg === undefined ? .92 : o.bg, 'data-edit': o.edit, class: o.edit ? 'editable' : undefined,
    stroke: o.edit ? o.fill : undefined, 'stroke-width': o.edit ? .6 : undefined, 'stroke-dasharray': o.edit ? '1.5 1.5' : undefined }) + T(x, y, txt, o);
}

/** a handle that moves the sun: the sun itself, so it is not taken for a cut tab */
export const sunKnob = (x, y) => CIRCLE(x, y, 11, { fill: 'var(--sun)', opacity: .2 }) + CIRCLE(x, y, 6.5, { fill: 'var(--sun)', stroke: 'var(--panel)', 'stroke-width': 1.4 });
/** a line closed at each end by a 45-degree tick, as a length is dimensioned
 *  on a drawing - arrowheads are kept for rays and directions */
export function tickLine(x1, y1, x2, y2, o = {}) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
  const tx = (ux - uy) * 3.2, ty = (ux + uy) * 3.2, col = o.stroke || 'var(--ink3)';
  return L(x1, y1, x2, y2, o) + L(x1 - tx, y1 - ty, x1 + tx, y1 + ty, { stroke: col, w: (o.w || 1) * 1.4 })
    + L(x2 - tx, y2 - ty, x2 + tx, y2 + ty, { stroke: col, w: (o.w || 1) * 1.4 });
}
/** a dimension line closed by ticks, with extension lines and a centred figure */
export function dim(x1, y1, x2, y2, label, off = 0, side = 1) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len * off * side, ny = dx / len * off * side;
  const a = [x1 + nx, y1 + ny], b = [x2 + nx, y2 + ny];
  let s = tickLine(a[0], a[1], b[0], b[1], { stroke: 'var(--ink3)', w: .7 });
  s += L(x1, y1, a[0], a[1], { stroke: 'var(--ink3)', w: .5, dash: '2 2' });
  s += L(x2, y2, b[0], b[1], { stroke: 'var(--ink3)', w: .5, dash: '2 2' });
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, vertical = Math.abs(dx) < Math.abs(dy);
  s += RECT(mx - (vertical ? 16 : label.length * 2.6 + 3), my - 6, vertical ? 32 : label.length * 5.2 + 6, 11, { fill: 'var(--panel)' });
  s += T(mx, my + 3, label, { anchor: 'middle', size: 9, fill: 'var(--ink2)' });
  return s;
}

/** an angle arc, screen angles measured anticlockwise from +x */
export function arc(cx, cy, r, a0, a1, col) {
  const p0 = [cx + r * Math.cos(a0), cy - r * Math.sin(a0)], p1 = [cx + r * Math.cos(a1), cy - r * Math.sin(a1)];
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0, sweep = a1 > a0 ? 0 : 1;
  return PATH(`M${fmt(p0[0], 2)},${fmt(p0[1], 2)} A${fmt(r, 2)},${fmt(r, 2)} 0 ${large} ${sweep} ${fmt(p1[0], 2)},${fmt(p1[1], 2)}`, { stroke: col, w: 1 });
}

export const svg = (inner, label) => El('svg', {
  viewBox: `0 0 ${W} ${H}`, xmlns: 'http://www.w3.org/2000/svg', role: 'img', 'aria-label': label }, inner);

/** the strip of figures under a drawing */
export const titleBlock = (name, pairs) => '<div class="tblock"><h3>' + name + '</h3>'
  + pairs.map(p => '<span class="m"><b>' + p[0] + '</b> ' + p[1] + '</span>').join('') + '</div>';

/** paint a list of faces already in back-to-front order. `style(face)` gives
 *  { fills: [[colour, opacity], ...], stroke, w }; only the edges a face really
 *  has are stroked, never the cuts the hidden-surface tree made in it. */
export function paintFaces(order, project, eye, style) {
  let g = '';
  for (const q of order) {
    if (q.n[0] * eye[0] + q.n[1] * eye[1] + q.n[2] * eye[2] <= 0.002) continue;   // turned away
    const st = style(q);
    if (!st) continue;
    const pts = q.pts.map(project);
    // a face wholly off the sheet is not drawn at all
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    if (x1 < -20 || x0 > W + 20 || y1 < -20 || y0 > H + 20) continue;
    for (const [fill, op] of st.fills) g += POLY(pts, { fill, op: op < 1 ? fmt(op, 3) : undefined });
    if (!st.stroke) continue;
    let d = '', open = false;
    for (let i = 0; i < q.edge.length; i++) {
      if (!q.edge[i]) { open = false; continue; }
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (!open) { d += 'M' + fmt(a[0], 2) + ',' + fmt(a[1], 2); open = true; }
      d += 'L' + fmt(b[0], 2) + ',' + fmt(b[1], 2);
    }
    if (d) g += PATH(d, { stroke: st.stroke, w: st.w });
  }
  return g;
}
