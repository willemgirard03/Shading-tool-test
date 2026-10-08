/* The figures round the drawings, in two parts.

   Design recommendations are for the selected window's side and storey, at
   the instant set: the sun's angles to that facade, the ideal shading that
   would shade that window at this instant - drawn by the hand method at the
   window's own size - and what the by-law allows a device there to project,
   read against one of those ideal solutions. They are ideals, not the design:
   nothing as built is shown there. An ideal can be made a shading system
   type and put on the window; the drawings and the results then test it.

   Results are for what Calculation settings names: the solar heat entering,
   in a row under the settings, and the code checks under the drawings.

   Every figure is a bubble, and each bubble's worked calculation opens from
   its ƒ, with the live numbers put in.

   Conventions:
     solar azimuth      the sun's horizontal direction from due south, east -
     surface azimuth    the facade normal's direction from due south, east -
     gamma              surface solar azimuth = surface azimuth - solar azimuth
     theta              profile angle = atan(tan beta / cos gamma)
     Ph = h / tan theta   the projection that shades a window of height h
     Pd = w / tan |gamma| the fin depth that shades a width w               */

import { D2R, R2D, fmt, hhmm, wrap180, MONTHS, clamp } from '../util.js';
import { CLOCK_NAME } from '../solar.js';
import { boxSpan } from '../geometry/boxes.js';
import { deviceLabel } from '../geometry/device.js';
import { systemPitch } from '../geometry/analysis.js';
import { SURFACE_NAMES } from '../geometry/room.js';
import { SKIES } from '../energy.js';
import { El, T, L, PATH, RECT } from '../draw/svg.js';
import { projectionAt, siteFrame, insideBy, isStreet, SITE_KINDS } from '../geometry/site.js';
export { projectionAt };

const deg = x => fmt(x, 1) + '°';
const eq = s => `<div class="eqline">${s}</div>`;
const mm = x => fmt(x * 1000, 0) + ' mm';
// every length in millimetres, as the drawings give them
const m2 = x => fmt(x * 1000, 0) + ' mm';

/* ---------- the bubbles and their calculations ----------
   A bubble's calculation stays open across redraws: which one is open is kept
   here, by key, and the page toggles it. */
export const fxUI = { open: null };
export function fig(key, label, value, sub, calc, cls = '') {
  const open = fxUI.open === key;
  return `<div class="fig ${cls}">${calc ? `<button type="button" class="fx" data-fx="${key}" aria-expanded="${open}" title="How this is worked out">ƒ</button>` : ''}
    <span>${label}</span><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}
    ${calc ? `<div class="fxpop"${open ? '' : ' hidden'}>${calc}</div>` : ''}</div>`;
}
const figs = (...xs) => `<div class="figs">${xs.join('')}</div>`;
const svgOf = (w, h, g, label) => El('svg', { viewBox: `0 0 ${w} ${h}`, xmlns: 'http://www.w3.org/2000/svg', class: 'recsvg', role: 'img', 'aria-label': label }, g);

/** the instant, written out */
export const whenOf = F => MONTHS[F.date.m - 1] + ' ' + F.date.d + ', ' + hhmm(F.S.hour) + ' ' + CLOCK_NAME[F.S.timeMode];
/** what the recommendations are for: the selected window, its face, its storey */
export const recFor = F => {
  const { sel } = F, s = sel.f + ' side · storey ' + (sel.st + 1) + (sel.unit !== null ? ' · window ' + (sel.unit + 1) : '');
  return s + ' · ' + whenOf(F);
};

/* ---------- sun angles, to the selected face ---------- */
export function recSun(F) {
  const { cur } = F;
  const solAz = wrap180(cur.az - 180), surfAz = wrap180(cur.gf - 180), gam = wrap180(cur.gf - cur.az);
  const side = a => Math.abs(a) < 0.05 ? 'due south' : fmt(Math.abs(a), 1) + '° ' + (a < 0 ? 'E' : 'W') + ' of S';
  const facade = fig('surf', 'Facade faces', side(surfAz), fmt(cur.gf, 0) + '° from north',
    eq('surface azimuth = the facade normal, from due south (east −) = ' + fmt(surfAz, 1) + '°') + eq('it follows from the building’s north offset and the floor’s rotation'));
  if (!cur.up) return figs(facade, fig('alt', 'Sun', 'below the horizon', whenOf(F), ''));
  const behind = Math.abs(gam) >= 90;
  return figs(
    fig('alt', 'Solar altitude β', deg(cur.alt), 'the sun’s height above the horizon', eq('β from the solar position at ' + whenOf(F))),
    fig('az', 'Solar azimuth', side(solAz), fmt(cur.az, 0) + '° from north', eq('the sun’s direction from due south, east negative = ' + fmt(solAz, 1) + '°')),
    facade,
    fig('gam', 'Surface solar azimuth γ', deg(gam), behind ? 'the sun is behind this facade' : 'the sun, round from the facade normal',
      eq('γ = surface azimuth − solar azimuth = ' + fmt(surfAz, 1) + ' − (' + fmt(solAz, 1) + ') = ' + deg(gam)) + (behind ? eq('|γ| ≥ 90°: no beam reaches this facade at all') : ''), behind ? 'dim' : 'key'),
    behind ? '' : fig('theta', 'Profile angle θ', deg(cur.vsa), 'in the plane square to the facade',
      eq('θ = tan⁻¹(tan β / cos γ) = tan⁻¹(' + fmt(Math.tan(cur.alt * D2R), 3) + ' / ' + fmt(Math.cos(gam * D2R), 3) + ') = ' + deg(cur.vsa)), 'key'),
    behind ? '' : fig('inc', 'Angle of incidence i', deg(cur.inc), 'between the beam and the glass’s normal',
      eq('cos i = cos β · cos γ = ' + fmt(Math.cos(cur.alt * D2R), 3) + ' × ' + fmt(Math.cos(gam * D2R), 3) + ' = ' + fmt(cur.cosInc, 3)) + eq('i = ' + deg(cur.inc))));
}

/* ---------- the shading that would shade this window, at this instant ----------
   One member as deep as the window needs, or the same cut-off from n members,
   each 1/n as deep at 1/n the spacing: the cut-off is set by depth over
   spacing, so n shallower members do what one deep one does. How many is the
   reader's to try, here, and is not part of the design. */
export const recUI = { nh: 1, nv: 1 };
export const MEMBERS_MAX = 12;
const members = (key, n, tip) => `<label class="recn" title="${tip}"><span>Members</span><input type="range" min="1" max="${MEMBERS_MAX}" step="1" value="${n}" data-recn="${key}" aria-label="Number of members"><output data-recout="${key}">${n}</output></label>`;
/** n horizontal members over a window: the top one at the head, each shading the gap below it; heights from the storey's floor */
export function hSolution(m, th, n) {
  const h = m.winH, pitch = h / n, tT = Math.tan(th * D2R);
  return { n, pitch, d: pitch / tT, Ph: h / tT, zs: Array.from({ length: n }, (_, k) => m.head - k * pitch) };
}
/** a section through the window: the members at the head and down it, each just shading the gap below it */
function sectionDiagram(h, sill, sol, th) {
  const W = 260, H = 190, x0 = 70, yF = 168, d = sol.d;
  const k = Math.min(120 / Math.max(h + sill, 0.5), 150 / Math.max(Math.min(d, 4 * h), 0.3));
  const y = v => yF - v * k, cut = d > 4 * h, P = cut ? 4 * h : d, tT = Math.tan(th * D2R);
  let g = RECT(x0 - 16, y(sill + h + 0.35), 16, (sill + h + 0.35) * k, { fill: 'url(#recpoche)', stroke: 'var(--ink)', 'stroke-width': .8 });
  g += RECT(x0 - 16, y(sill + h), 16, h * k, { fill: 'var(--panel)', stroke: 'none' }) + L(x0 - 6, y(sill), x0 - 6, y(sill + h), { stroke: 'var(--glass)', w: 2 });
  g += L(0, yF, W, yF, { stroke: 'var(--ink3)', w: .7 }) + T(4, yF + 12, 'floor', { size: 8, fill: 'var(--ink3)' }) + T(W - 4, yF + 12, 'outside →', { size: 8, anchor: 'end', fill: 'var(--ink3)' });
  for (const z of sol.zs) {
    g += RECT(x0, y(z) - 3, P * k, 3, { fill: 'var(--sun)' });
    if (cut) g += T(x0 + P * k + 4, y(z) + 3, '…', { size: 10, fill: 'var(--sun)' });
    // the ray at θ from the foot of the gap below, past the member's tip
    const ox = x0 - 6, oy = y(z - sol.pitch), run = P * k + 6 + 50;
    g += L(ox, oy, ox + run, oy - run * tT, { stroke: 'var(--sun)', w: 1, dash: '4 3' });
  }
  g += T(x0 - 22, (y(sill) + y(sill + h)) / 2, 'h ' + m2(h), { size: 8.5, anchor: 'end', fill: 'var(--ink2)' });
  g += T(x0 + P * k / 2, y(sill + h) - 7, (sol.n === 1 ? 'Ph ' : 'd ') + (cut ? '≥ ' : '') + m2(d), { size: 8.5, anchor: 'middle', fill: 'var(--sun)' });
  if (sol.n > 1) g += T(x0 - 22, y(sill + h) + 3, 's ' + m2(sol.pitch), { size: 8.5, anchor: 'end', fill: 'var(--ink2)' });
  g += T(x0 + 18, y(sill) - 3, 'θ ' + deg(th), { size: 8.5, fill: 'var(--sun)' });
  const defs = '<defs><pattern id="recpoche" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="var(--panel)"/><line x1="0" y1="0" x2="0" y2="5" stroke="var(--ink3)" stroke-width=".6"/></pattern></defs>';
  return svgOf(W, H, defs + g, 'Section: ' + (sol.n === 1 ? 'an overhang at the head' : sol.n + ' louvres') + ' deep enough to shade the whole window at this instant');
}
/** a plan of the window: n fins from the jamb the sun comes from, each just shading the gap beside it */
function planDiagram(w, Pd, gam, n) {
  const W = 260, H = 190, yW = 40, d = Pd / n, k = Math.min(150 / Math.max(w, 0.5), 120 / Math.max(Math.min(d, 4 * w), 0.3));
  const cx = W / 2, x0 = cx - w * k / 2, x1 = cx + w * k / 2, cut = d > 4 * w, P = cut ? 4 * w : d;
  // the fins stand from the jamb the sun comes from - the right, seen from outside, when γ > 0; from above, outside is down
  const right = gam > 0, dir = right ? -1 : 1, fin0 = right ? x1 : x0, step = w * k / n, tg = Math.tan(Math.abs(gam) * D2R);
  let g = RECT(10, yW - 14, x0 - 10, 14, { fill: 'var(--ink3)', opacity: .25 }) + RECT(x1, yW - 14, W - 10 - x1, 14, { fill: 'var(--ink3)', opacity: .25 });
  g += L(x0, yW - 6, x1, yW - 6, { stroke: 'var(--glass)', w: 2.2 });
  g += T(cx, yW - 24, 'w ' + m2(w), { size: 8.5, anchor: 'middle', fill: 'var(--ink2)' }) + T(W - 6, H - 6, 'outside ↓', { size: 8, anchor: 'end', fill: 'var(--ink3)' });
  for (let j = 0; j < n; j++) {
    const fx = fin0 + dir * j * step;
    g += RECT(fx - 1.5, yW, 3, P * k, { fill: 'var(--sun)' });
    if (cut) g += T(fx, yW + P * k + 12, '…', { size: 10, anchor: 'middle', fill: 'var(--sun)' });
    // the ray at γ from the far side of the gap, past the fin's tip
    const ox = fx + dir * step, run = P * k + 46;
    g += L(ox, yW - 6, ox - dir * run * tg, yW - 6 + run, { stroke: 'var(--sun)', w: 1, dash: '4 3' });
  }
  g += T(fin0 + (right ? 6 : -6), yW + P * k / 2, (n === 1 ? 'Pd ' : 'd ') + (cut ? '≥ ' : '') + m2(d), { size: 8.5, anchor: right ? 'start' : 'end', fill: 'var(--sun)' });
  if (n > 1) g += T(fin0 + dir * step / 2, yW - 9, 's ' + m2(w / n), { size: 8, anchor: 'middle', fill: 'var(--ink2)' });
  g += T(cx, yW + P * k + 24, 'γ ' + deg(Math.abs(gam)), { size: 8.5, anchor: 'middle', fill: 'var(--sun)' });
  return svgOf(W, H, g, 'Plan: ' + (n === 1 ? 'a fin at the jamb' : n + ' fins') + ' deep enough to shade the whole window width at this instant');
}
/** the ideal on one axis, as a shading system would be made from it: { dir, n, d, pitch, ext, side, name } */
export function idealSpec(F, dir) {
  const { m, cur } = F;
  if (!m.opening || !cur.onFacade) return null;
  const gam = wrap180(cur.gf - cur.az), tg = Math.tan(Math.abs(gam) * D2R), tT = Math.tan(cur.vsa * D2R);
  const when = MONTHS[F.date.m - 1] + ' ' + F.date.d + ' ' + hhmm(F.S.hour);
  if (dir === 'h') {
    const s = hSolution(m, cur.vsa, recUI.nh);
    // the sun slips along a blade by d tan |γ| across its depth: the blade runs that far past each jamb
    return { dir, n: s.n, d: s.d, pitch: s.pitch, ext: Math.min(12, 2 * s.d * tg), name: (s.n === 1 ? 'Ideal overhang' : 'Ideal ' + s.n + ' louvres') + ', ' + when };
  }
  if (tg <= 1e-3) return null;
  const n = recUI.nv, pitch = m.winW / n, d = pitch / tg;
  // and up a fin by d tan θ: the fin runs that far above the head
  return { dir, n, d, pitch, ext: Math.min(12, d * tT), side: gam > 0 ? 'end' : 'start', name: (n === 1 ? 'Ideal fin' : 'Ideal ' + n + ' fins') + ', ' + when };
}
const useBtn = dir => `<button type="button" class="minibtn idealuse" data-ideal="${dir}" title="Make these ideal members a shading system type of their own: name it, and it goes on the selected window. It shades the whole glass at this instant only.">Use on this window</button>`;
const MEMBERS_TIP = 'One member as deep as the window needs, or the same cut-off from n members, each 1/n as deep at 1/n the spacing. Try different numbers here: it does not change the design.';
export function recGeometry(F) {
  const { m, cur } = F;
  if (!m.opening) return '<p class="calcnote">The selected storey has no glazing on this side.</p>';
  if (!cur.onFacade) return '<p class="calcnote">The sun is ' + (cur.up ? 'behind this facade' : 'down') + ' at ' + whenOf(F) + ': nothing is needed to shade this window now.</p>';
  const h = m.winH, w = m.winW, th = cur.vsa, tT = Math.tan(th * D2R), gam = wrap180(cur.gf - cur.az), tg = Math.tan(Math.abs(gam) * D2R);
  const hs = hSolution(m, th, recUI.nh), nv = recUI.nv, Pd = tg > 1e-3 ? w / tg : Infinity, sv = w / nv, dv = Pd / nv;
  const head = '<p class="recnote" data-part="note"><b>Ideal solutions</b>, not the shading as built: the hand method’s simplest devices - flush, long and thin - that would shade the whole of this window at ' + whenOf(F) + '. There are many other ways. Use one on the window to test it in the drawings and the results.</p>';
  const hFig = hs.n === 1
    ? fig('Ph', 'Overhang at the head', m2(hs.d), 'shades the whole ' + m2(h) + ' height now', eq('Ph = h / tan θ = ' + fmt(h, 2) + ' / ' + fmt(tT, 3) + ' = ' + m2(hs.d)))
    : fig('Ph', hs.n + ' louvres at ' + mm(hs.pitch), 'depth ' + mm(hs.d), 'each shades the gap below it, the top one at the head',
      eq('spacing s = h / n = ' + fmt(h, 2) + ' / ' + hs.n + ' = ' + mm(hs.pitch)) + eq('depth = s / tan θ = ' + fmt(hs.pitch * 1000, 0) + ' / ' + fmt(tT, 3) + ' = ' + mm(hs.d))
        + eq('one overhang would be Ph = h / tan θ = ' + m2(hs.Ph) + ': each of the ' + hs.n + ' is 1/' + hs.n + ' of it'));
  const vFig = !isFinite(Pd) ? '' : nv === 1
    ? fig('Pd', 'Fin at the ' + (gam > 0 ? 'right' : 'left') + ' jamb', m2(Pd), 'shades the whole ' + m2(w) + ' width now', eq('Pd = w / tan |γ| = ' + fmt(w, 2) + ' / ' + fmt(tg, 3) + ' = ' + m2(Pd)))
    : fig('Pd', nv + ' fins at ' + mm(sv), 'depth ' + mm(dv), 'each shades the gap beside it, the first at the ' + (gam > 0 ? 'right' : 'left') + ' jamb',
      eq('spacing s = w / n = ' + fmt(w, 2) + ' / ' + nv + ' = ' + mm(sv)) + eq('depth = s / tan |γ| = ' + fmt(sv * 1000, 0) + ' / ' + fmt(tg, 3) + ' = ' + mm(dv))
        + eq('one fin would be Pd = w / tan |γ| = ' + m2(Pd) + ': each of the ' + nv + ' is 1/' + nv + ' of it'));
  const sec = `<div class="reccard ideal"><div class="rechd"><h4 data-part="hh"><span class="idealtag">Ideal</span> Horizontal: against the profile angle θ ${deg(th)}</h4>${members('nh', hs.n, MEMBERS_TIP)}${useBtn('h')}</div>
    <div data-part="hb">${sectionDiagram(h, m.sill, hs, th)}${figs(hFig)}</div></div>`;
  const pln = `<div class="reccard ideal"><div class="rechd"><h4 data-part="vh"><span class="idealtag">Ideal</span> Vertical: against γ ${deg(Math.abs(gam))}</h4>${members('nv', nv, MEMBERS_TIP)}${isFinite(Pd) ? useBtn('v') : ''}</div>
    <div data-part="vb">${isFinite(Pd) ? planDiagram(w, Pd, gam, nv) + figs(vFig) : '<p class="calcnote">The sun is square to the facade: a fin cannot shade it now - horizontal elements can.</p>'}</div></div>`;
  return head + `<div class="recgrid">${sec}${pln}</div>`;
}

/* ---------- what the by-law allows a device here to project ---------- */
/** the selected window's devices as the by-law reads them: furthest reach off the wall face, lowest point above the street */
export function deviceReach(F) {
  const { m, sel } = F;
  if (!m.own || !m.own.length) return null;
  let reach = 0, low = Infinity;
  for (const b of m.own) { reach = Math.max(reach, b.c[2] + boxSpan(b, 2) - m.reveal); low = Math.min(low, b.c[1] - boxSpan(b, 1)); }
  return { reach: Math.max(0, reach), low: sel.row.zb + low };
}
/** how far off this wall face a device may reach, at a height above the street */
function allowAt(sg, dist, z) {
  if (isStreet(sg)) return dist + Math.min(projectionAt(z, sg.width).mm, Math.max(0, sg.curb - 0.6) * 1000) / 1000;
  return sg.kind === 'property' ? dist : Infinity;
}
/* A section at the boundary, at one scale both ways so the profile angle is
   drawn true: the selected storey and a little round it, the wall face, the
   property line, what may project past it band by band, the curb, and the
   horizontal members recommended above, each with its ray at θ. */
function bylawDiagram(F, sol, dist, sg, th) {
  const { sel, m } = F, H = 236, x0 = 52, yG = 212, street = isStreet(sg), zb = sel.row.zb;
  const zLo = Math.max(0, zb - 0.6), zHi = zb + sel.row.h + 0.6;
  const bands = !street ? [] : sg.width < 10 ? [[0, 7.62, 0], [7.62, 1e3, 0.915]] : [[0, 2.75, 0], [2.75, 5.2, 0.5], [5.2, 7.62, 0.915], [7.62, 1e3, 1.37]];
  const seen = bands.filter(([a, b]) => b > zLo && a < zHi), reachMax = Math.max(0, ...seen.map(b => b[2]));
  // wide enough for the allowance, the members and, when it is near, the curb
  let span = Math.max(dist + reachMax + 0.4, sol ? Math.min(sol.d, dist + 4) + 0.3 : 0, dist + 0.8, 1.2);
  const curbIn = street && sg.curb <= reachMax + 1.2;
  if (curbIn) span = Math.max(span, dist + sg.curb + 0.25);
  const s = Math.min((yG - 22) / (zHi - zLo), 240 / span), W = Math.max(210, Math.round(x0 + span * s + 44));
  const y = z => yG - (z - zLo) * s, x = d => x0 + d * s, xR = x(span);
  let g = '';
  if (zLo === 0) g += L(6, yG, xR + 4, yG, { stroke: 'var(--ink3)', w: .8 }) + T(4, yG + 13, (street ? sg.kind : 'grade') + ' level', { size: 8, fill: 'var(--ink3)' });
  else g += T(4, yG + 13, '↓ street ' + m2(zLo) + ' below', { size: 8, fill: 'var(--ink3)' });
  if (street) {
    // the allowance, band by band, from the property line out, in the heights drawn; the band's heights on the right
    for (const [a0, b0, d] of seen) {
      const a = Math.max(a0, zLo), b = Math.min(b0, zHi);
      if (d > 0) g += RECT(x(dist), y(b), d * s, (b - a) * s, { fill: 'var(--glass)', opacity: .12, stroke: 'var(--glass)', 'stroke-width': .6 });
      g += T(x(dist + d) + 3, y((a + b) / 2) + 3, d > 0 ? fmt(d * 1000, 0) : 'none', { size: 8, fill: 'var(--glass)' });
    }
    [2.75, 5.2, 7.62].forEach(v => { if (v > zLo && v < zHi) g += L(x(dist), y(v), xR, y(v), { stroke: 'var(--glass)', w: .5, dash: '2 2' }) + T(xR + 3, y(v) + 3, fmt(v, 2) + ' m', { size: 7.5, fill: 'var(--ink3)' }); });
    if (curbIn) {
      const cx = x(dist + sg.curb);
      g += L(cx, y(zHi) + 6, cx, yG, { stroke: 'var(--ink2)', w: .8, dash: '3 3' }) + T(cx, y(zHi) + 2, 'curb', { size: 8, anchor: 'middle', fill: 'var(--ink2)' });
      if (sg.curb > 0.6) g += RECT(x(dist + sg.curb - 0.6), y(zHi) + 6, 0.6 * s, yG - y(zHi) - 6, { fill: 'var(--ink3)', opacity: .1 });
    } else g += T(W - 4, yG + 13, 'curb ' + m2(sg.curb) + ' out →', { size: 8, anchor: 'end', fill: 'var(--ink2)' });
  } else if (sg.kind === 'property') g += T(x(dist) + 4, y(zHi) + 20, 'neighbour', { size: 8, fill: '#A23A16' });
  // the wall face, the storey and its floor, the window, the property line
  g += L(x0, y(zHi), x0, yG, { stroke: 'var(--ink)', w: 2 }) + T(x0 - 4, y(zHi) + 9, 'face', { size: 8, anchor: 'end', fill: 'var(--ink3)' });
  g += RECT(x0 - 4, y(zb + sel.row.h), 4, sel.row.h * s, { fill: 'var(--sun)', opacity: .35 });
  g += L(x0 - 10, y(zb), x0, y(zb), { stroke: 'var(--ink)', w: 1 }) + T(x0 - 12, y(zb) + 3, m2(zb), { size: 7.5, anchor: 'end', fill: 'var(--ink3)' });
  g += L(x(dist), y(zHi), x(dist), yG, { stroke: sg.kind === 'property' ? '#A23A16' : 'var(--ink2)', w: 1, dash: '8 3 2 3' })
    + T(x(dist) + 4, y(zHi) + 9, 'property line', { size: 8, fill: 'var(--ink2)' });
  if (m.opening) g += L(x0 - 2, y(zb + m.sill), x0 - 2, y(zb + m.head), { stroke: 'var(--glass)', w: 3 });
  if (sol) {
    const tT = Math.tan(th * D2R), dd = Math.min(sol.d, span);
    sol.zs.forEach((z, j) => {
      const Z = zb + z, over = sol.d > allowAt(sg, dist, Z) + 1e-6;
      g += RECT(x0, y(Z) - 2, dd * s, 2.6, { fill: over ? '#C0442B' : 'var(--sun)' });
      // the ray at θ, from the foot of the gap below the member, past its tip
      const ox = x0, oy = y(Z - sol.pitch), run = Math.min(dd * s + 22, (oy - y(zHi)) / Math.max(tT, 1e-3));
      g += L(ox, oy, ox + run, oy - run * tT, { stroke: 'var(--sun)', w: .9, dash: '4 3' });
      if (j === sol.zs.length - 1) {
        // the profile angle at the sill, off the horizontal
        const r = 22, a = th * D2R;
        g += L(ox, oy, ox + r + 8, oy, { stroke: 'var(--sun)', w: .7 });
        g += PATH(`M${fmt(ox + r, 2)},${fmt(oy, 2)} A${r},${r} 0 0 0 ${fmt(ox + r * Math.cos(a), 2)},${fmt(oy - r * Math.sin(a), 2)}`, { stroke: 'var(--sun)', w: 1 });
        g += T(ox + r + 4, oy - r * Math.sin(a / 2) + 3, 'θ ' + deg(th), { size: 8.5, fill: 'var(--sun)' });
      }
    });
    g += T(x0 + dd * s + 4, y(zb + sol.zs[0]) + 10, 'ideal ' + (sol.n === 1 ? 'Ph ' : sol.n + ' × ') + m2(sol.d), { size: 8, fill: 'var(--sun)' });
  }
  return El('svg', { viewBox: `0 0 ${W} ${H}`, xmlns: 'http://www.w3.org/2000/svg', class: 'recsvg bylaw', role: 'img',
    'aria-label': 'Section at the boundary, true to scale: the property line, what the by-law allows a device to project past it at each height, the curb, and the ideal horizontal members with the profile angle' }, g);
}
export function recBylaw(F) {
  const { S, m, cur, sel } = F, SF = F.checks ? F.checks.SF : siteFrame(S), sg = SF.seg[sel.f], fr = sel.row.frame, cc = m.opening ? m.cc : 0;
  const dist = Math.max(0, insideBy(SF, sel.f, [fr.O[0] + fr.U[0] * cc, fr.O[1] + fr.U[1] * cc]));
  const head = sel.row.zb + (m.opening ? m.head : sel.row.h), sol = m.opening && cur.onFacade ? hSolution(m, cur.vsa, recUI.nh) : null;
  const what = sol ? (sol.n === 1 ? 'the ideal overhang' : 'the ideal ' + sol.n + ' louvres') : null;
  const note = '<p class="recnote">The ' + sel.f + ' side’s boundary is ' + SITE_KINDS[sg.kind].toLowerCase() + ', ' + m2(dist) + ' from this storey’s wall face (set under Site Parameters). '
    + (sol ? 'Drawn with <b>' + what + '</b> from above - one of the ideal solutions, not the shading as built: the code checks test what is built.' : 'No ideal solution is needed at this instant.') + '</p>';
  let allow, sub, quote;
  if (isStreet(sg)) {
    const lim = projectionAt(head, sg.width), byCurb = Math.max(0, sg.curb - 0.6) * 1000;
    allow = dist + Math.min(lim.mm, byCurb) / 1000;
    sub = m2(dist) + ' to the property line + ' + fmt(Math.min(lim.mm, byCurb), 0) + ' mm into the ' + sg.kind + ' at the head, ' + m2(head) + ' up';
    quote = eq('VBBL 1.8.9.3.(3): into a street at least 10 m wide, at most 500 mm between 2.75 and 5.2 m above it, 915 mm between 5.2 and 7.62 m, 1370 mm above 7.62 m')
      + eq('1.8.9.3.(4): into a narrower street only at 7.62 m and up, at most 915 mm beyond the property line') + eq('1.8.9.3.(1): the device’s outer edge at least 600 mm from the curb')
      + eq('1.8.9.3.(2): height is measured from the device’s lowest point to the street below') + eq('here: ' + lim.band + (byCurb < lim.mm ? '; the curb governs, ' + fmt(sg.curb, 2) + ' − 0.6 m' : ''));
  } else if (sg.kind === 'property') {
    allow = dist; sub = 'no further than the adjoining property line';
    quote = eq('a device may not cross onto the adjoining property; VBBL 1.8.9 allows projection only into a street') + eq('1.8.9.3.(5): where it does project into a street, at least 600 mm from the production of an adjoining property line, unless noncombustible');
  } else { allow = Infinity; sub = 'open ground: no boundary condition on this side'; quote = eq('no limit is set on this side'); }
  // the members recommended above, each read at its own height
  let solFig = '';
  if (sol && !(sg.kind === 'open')) {
    const rows = sol.zs.map(z => { const Z = sel.row.zb + z, a = allowAt(sg, dist, Z); return { Z, a, ok: sol.d <= a + 1e-6 }; }), bad = rows.filter(r => !r.ok);
    const sized = sol.n === 1 ? m2(sol.d) + ' deep' : mm(sol.d) + ' deep each';
    solFig = fig('limPh', sol.n === 1 ? 'The ideal overhang' : 'The ideal ' + sol.n + ' louvres', bad.length ? 'too deep' : 'fits',
      bad.length ? sized + ': past the limit at ' + (bad.length === rows.length ? 'every member' : bad.length + ' of ' + rows.length + ' members') + ' - set the building back, or use more members' : sized + ': within the limit at every member',
      rows.map(r => eq('at ' + m2(r.Z) + ' up: ' + mm(sol.d) + ' against ' + (isFinite(r.a) ? m2(r.a) : 'no limit') + ' from the wall face' + (r.ok ? '' : ' - over'))).join(''), bad.length ? 'no' : 'ok');
  }
  return note + `<div class="recgrid"><div class="reccard">${bylawDiagram(F, sol, dist, sg, cur.vsa)}</div><div>`
    + figs(fig('lim', 'A device at the head may reach', isFinite(allow) ? m2(allow) : 'no limit', sub, quote, isFinite(allow) && allow > 0 ? 'key' : 'dim'), solFig)
    + '</div></div>';
}

/* ---------- the glass the by-law asks for ---------- */
import { SHGC_MAX } from '../library.js';
export { SHGC_MAX };
export function recGlazing(F) {
  const { m } = F;
  if (!m.opening) return '';
  const ok = m.shgc <= SHGC_MAX + 1e-9;
  return figs(
    fig('shgc', 'This window’s SHGC', fmt(m.shgc, 2), ok ? 'at or under the by-law’s 0.36' : 'over the by-law’s 0.36: choose a lower-SHGC glass',
      eq('VBBL 10.2.2.3.(1)(e): on the NECB path, vertical glazing SHGC no more than an assembly maximum of 0.36') + eq('the ASHRAE 90.1 path (10.2.2.2) sets its own limits, in the standard'), ok ? 'ok' : 'no'),
    fig('shgcIn', 'Heat from this beam, per m² of glass', F.cur.onFacade ? fmt(m.shgc * F.cur.cosInc, 2) + ' × DNI' : '—', 'unshaded, at ' + whenOf(F),
      eq('q = DNI × cos i × SHGC = DNI × ' + fmt(F.cur.cosInc || 0, 3) + ' × ' + fmt(m.shgc, 2))));
}

/* ---------- results: where the selected window's beam lands ---------- */
export function resInside(F, land) {
  const { m, cur } = F;
  if (!m.opening) return '';
  if (!cur.onFacade) return '<p class="calcnote">No direct sun comes through the selected window at ' + whenOf(F) + '.</p>';
  const dni = land ? land.dni : 0, onFloor = dni * m.shgc * Math.sin(cur.alt * D2R), enter = land ? land.enter : 0;
  const parts = land && land.total > 0 ? Object.entries(land.by).sort((a, b) => b[1] - a[1]) : [];
  return figs(
    fig('floorq', 'On the floor at ' + hhmm(F.S.hour), land && land.total > 0 ? fmt(onFloor, 0) + ' W/m²' : 'no patch', 'wherever the patch falls',
      eq('irradiance on the floor = DNI × SHGC × sin β = ' + fmt(dni, 0) + ' × ' + fmt(m.shgc, 2) + ' × ' + fmt(Math.sin(cur.alt * D2R), 3) + ' = ' + fmt(onFloor, 0) + ' W/m²')),
    fig('landed', 'Landing in the room at ' + hhmm(F.S.hour), fmt(land ? land.total : 0, 0) + ' W', parts.length ? parts.slice(0, 3).map(([k, v]) => fmt(v, 0) + ' W ' + SURFACE_NAMES[k]).join(' · ') : 'the beam is stopped before the room',
      eq('of the ' + fmt(enter, 0) + ' W entering through the selected window: ' + (parts.map(([k, v]) => fmt(v, 0) + ' W on ' + SURFACE_NAMES[k]).join(', ') || 'none in the room')
        + (enter - (land ? land.total : 0) > 1 ? ', and ' + fmt(enter - land.total, 0) + ' W on the inside of the reveal' : ''))));
}

/* ---------- results: how much comes in ---------- */
export function resGain(F, now, day, year) {
  const { S } = F;
  if (!now) return '';
  const dd = MONTHS[F.date.m - 1] + ' ' + F.date.d;
  const pc = (a, b) => b > 1e-9 ? fmt((1 - a / b) * 100, 0) + '%' : '—';
  const k = x => x >= 10000 ? fmt(x / 1000, 1) + ' kWh' : fmt(x, 0) + ' Wh';
  const sky = SKIES[S.sky].toLowerCase();
  const skyWhy = { clear: 'the ASHRAE clear-sky beam: the peak a sunny day delivers', average: 'the weather file’s mean beam for this month at each hour, clouds included', recorded: 'the weather file’s own record for this date, hour by hour' }[S.sky];
  const law = eq('entering = DNI × cos i × sunlit glass × SHGC'), rule = eq('DNI: ' + skyWhy) + eq('direct beam only; one SHGC at every angle of incidence, so grazing sun is somewhat overstated');
  return figs(
    fig('gNow', 'Now, ' + hhmm(S.hour), fmt(now.ent, 0) + ' W', pc(now.ent, now.bareEnt) + ' kept out · bare ' + fmt(now.bareEnt, 0) + ' W',
      law + eq('= ' + fmt(now.dni, 0) + ' W/m² × ' + fmt(now.cos, 3) + ' × ' + fmt(now.lit, 2) + ' m² × ' + fmt(now.shgc, 2) + (now.count > 1 ? ', summed over ' + now.count + ' units' : '') + ' = ' + fmt(now.ent, 0) + ' W') + rule),
    fig('gDay', 'Over ' + dd, day ? k(day.wh) : '…', day ? pc(day.wh, day.whBare) + ' kept out · bare ' + k(day.whBare) : 'working…',
      law + eq('every quarter hour of the day summed, ' + sky) + rule),
    fig('gYear', 'Over a year', year ? fmt(year.ent, 0) + ' kWh' : '…', year ? pc(year.ent, year.bare) + ' kept out · ' + (now.A > 0 ? fmt(year.ent / now.A, 0) + ' kWh/m² of glass' : 'bare ' + fmt(year.bare, 0) + ' kWh') : 'working…',
      law + eq('all 8,760 hours summed, ' + sky) + (year && now.A > 0 ? eq('unshaded, the same glass: ' + fmt(year.bare, 0) + ' kWh') : '') + rule));
}

/* the names the test suite and older callers know these by */
export const calcSun = recSun, calcProfile = recGeometry, calcInside = (F, land) => resInside(F, land), calcGain = resGain;
