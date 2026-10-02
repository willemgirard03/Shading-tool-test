/* The design state, the rules for changing it, and its history.

   The building is a list of storeys, each with a height, a slab, a floorplate
   of its own (width w across the N and S sides, depth d across E and W) and,
   for each of the four sides, a reference into the library (library.js): the
   window system its windows are set out by and the shading system they carry,
   or none. One condition is selected at a time - a side, a storey, and a
   window on it - and the panel edits the library entries that window uses.

   Every control writes through setValue(), which reads a key as a path:
     'doy', 'rot', ...        the building and the instant
     'plnW', 'plnD', 'sh'     the selected storey's floorplate and height
     'plnOX', 'plnOY'         its offset from the building's axis, east and north
     'rot'                    the building's north offset
     'plnRot', 'rotRel'       the storey's rotation, and what it is measured from
     'oxyIn'                  the axes the storey's offset is read along
     'g.winW', 'g.winSp', ... the selected window's unit type, or its system
     'g.sys', 'g.unit', 'g.shd'  which system, unit type and shading it uses
     'name.sys', 'name.unit', 'name.shd'  their names
     'slabT'                  the selected storey's slab
     'd.depth', 'd.dir', ...  its selected shading device
     'a.len', 'a.along', ...  that device's array
   and is where the few rules tying fields together live. Nothing here touches
   the page.                                                                  */

import { clamp, doyOf, wrap180, wrap360 } from './util.js';
import { GLAZING0, unitLayout, brokenUnits, buildCell, SLAB0 } from './geometry/cell.js';
import { DEVICE0, array0, arrayLen0, deviceFromV4, deviceName, lenFromWindow } from './geometry/device.js';
import { site0, SITE_KINDS, SITE_FIELDS, isStreet } from './geometry/site.js';
import { lib0, addEntry, duplicateEntry, nextName, entryName, newUnit, newSystem, flatGlazing, layoutGlazing, adoptGlazing, usage, SYSTEM_KEYS, SHGC_MAX } from './library.js';
import { arrayPositions } from './geometry/arrays.js';
import { solarPosition } from './solar.js';
import { pickSunAt } from './sunpick.js';
import { facadeLength, FACADES, facadeAzimuth, offsetIn, rotIn } from './geometry/building.js';

/* A storey: its height, its floorplate w x d, its rotation rot (clockwise,
   degrees) measured from the building's north offset, the floor below, or
   true north (rotRel: 'building' | 'below' | 'true'), and its offset ox, oy
   from the building's axis, read along its own axes, the building's, the
   floor below's, or true north (oxyIn: 'own' | 'building' | 'below' | 'global'). */
export const storey0 = (h = 3.6, w = 30, d = 18, ox = 0, oy = 0, rot = 0, oxyIn = 'own', rotRel = 'building', slab = SLAB0) => ({ h, slab, w, d, ox, oy, rot, rotRel, oxyIn, cells: { N: null, E: null, S: null, W: null } });

export function defaultState() {
  return {
    rot: 0,                               // the building's north offset, clockwise from true north
    storeys: [storey0()],
    lib: lib0(),                          // the window and shading types the design is made of
    site: site0(),                        // the boundary about the ground floor, side by side, and the streets
    views: [], viewSeq: 0, activeView: null,   // windows saved by name with their cuts, and the one that is the selection
    // an edit to the selected storey's floorplate, or to its glazing and
    // shading on the selected side, is also made to every storey above it
    // and an edit to a side's glazing and shading is also made to the storey's other sides
    matchAbove: { plate: true, glazing: false, sides: false },
    sel: { f: 'S', st: 0, unit: null },
    scope: 'unit',                        // what the chart and the studies analyse
    cutU: 0, cutV: 2.1,                   // where the section and the plan are cut, in the unit
    doy: 172, hour: 12.0, timeMode: 'sol',
    wx: 'gw10',
    sky: 'clear',                         // the beam: a clear day, or the weather file's typical day
    encroach: false, streetW: 18, devHeight: 6.0, curbDist: 2.0,
    expScope: 'unit'
  };
}

/** the live store every part of the tool reads */
export const S = defaultState();

/* ---------- the selected condition ----------
   A side of a storey holds a reference into the library: its window system,
   its shading system, and what its broken windows keep of their own. The
   panel edits the entries the selected window uses - the array's, or, for a
   window broken from the array, its own. The flat glazing records below are
   for reading; edits go through setValue, into the library. */
export const selStorey = (st = S) => st.storeys[clamp(st.sel.st, 0, st.storeys.length - 1)];
/** the selected side's reference: { sys, shd, dev, broken, brokenShd }, or null */
export const selCell = (st = S) => selStorey(st).cells[st.sel.f] || null;
/** the window system the selected side is set out by */
export const selSystem = (st = S) => { const r = selCell(st); return r ? st.lib.systems[r.sys] || null : null; };
/** the glazing of the selected side's array, as one flat record */
export const arrayGlazing = (st = S) => { const r = selCell(st); return r ? flatGlazing(st, r) : null; };
/** which unit of the array is selected: the one picked, or the middle one */
export function selUnitIndex(st = S) {
  const r = selCell(st), g = r ? layoutGlazing(st, r) : null;
  if (!g) return null;
  const n = unitLayout(g, facadeLength(st, st.sel.f, st.sel.st)).n;
  return st.sel.unit === null || st.sel.unit === undefined ? Math.floor((n - 1) / 2) : clamp(st.sel.unit, 0, n - 1);
}
/** is the selected window's window broken from its array - or, with part 'shd', its shading */
export const isBroken = (st = S, part = 'win') => {
  const r = selCell(st), i = selUnitIndex(st), m = part === 'shd' ? 'brokenShd' : 'broken';
  return !!(r && r[m] && r[m][i]);
};
/** the selected window's glazing, as one flat record: its unit, its system's layout, its shading */
export const selGlazing = (st = S) => { const r = selCell(st); return r ? flatGlazing(st, r, selUnitIndex(st)) : null; };
/** the unit type the selected window uses: its own, broken out, or its system's */
export function selUnitType(st = S) {
  const r = selCell(st);
  if (!r) return null;
  const b = r.broken && r.broken[selUnitIndex(st)], sys = selSystem(st);
  return st.lib.units[b ? b.unit : sys && sys.unit] || null;
}
/** the id of the shading system the selected window carries: its own, broken out, or the array's */
export function selShadingId(st = S) {
  const r = selCell(st);
  if (!r) return null;
  const b = r.brokenShd && r.brokenShd[selUnitIndex(st)];
  return (b ? b.shd : r.shd) || null;
}
/** the shading system the selected window carries, or null */
export const selShading = (st = S) => { const id = selShadingId(st); return id ? st.lib.shading[id] || null : null; };
/** the device type in the selected slot of that shading system */
export const selDevice = (st = S) => {
  const h = selShading(st), r = selCell(st);
  return h && h.devices.length ? st.lib.devices[h.devices[clamp(r.dev || 0, 0, h.devices.length - 1)]] || null : null;
};
/** the selected window's opening, as it is built, for sizing what it is first given */
function openingOf(st = S) {
  const g = selGlazing(st), s = selStorey(st);
  if (!g) return { u0: -1.5, u1: 1.5, v0: 0.9, v1: 3.3 };
  return buildCell(g, s.h, facadeLength(st, st.sel.f, st.sel.st), 0, s.slab ?? SLAB0).opening;
}
/** what a name box names: the system, the unit type or the shading system the selected window uses */
const nameTarget = (st, which) => which === 'sys' ? selSystem(st) : which === 'unit' ? selUnitType(st) : which === 'shd' ? selShading(st) : null;

/** read a control's value by its path */
export function getValue(k, st = S) {
  const [head, rest] = k.includes('.') ? [k.slice(0, k.indexOf('.')), k.slice(k.indexOf('.') + 1)] : [null, k];
  if (head === 'g') {
    const r = selCell(st);
    if (rest === 'sys') return r ? r.sys : '';
    if (rest === 'unit') { const u = selUnitType(st); return u ? u.id : ''; }
    if (rest === 'shd') return selShadingId(st) || '';
    if (rest === 'offU') { const b = r && r.broken && r.broken[selUnitIndex(st)]; return b ? b.offU || 0 : 0; }
    if (SYSTEM_KEYS.includes(rest)) { const y = selSystem(st); return y ? y[rest] : undefined; }
    const u = selUnitType(st); return u ? u[rest] : undefined;
  }
  if (head === 'name') { const o = nameTarget(st, rest); return o ? o.name : undefined; }
  if (head === 'site') {
    const sg = st.site || site0();
    if (rest === 'edit') return sg.edit || 'S';
    const [f, fld] = rest.split('.');
    return sg[f] ? sg[f][fld] : undefined;
  }
  if (head === 'd' && rest === 'type') { const h = selShading(st), r = selCell(st); return h && h.devices.length ? h.devices[clamp(r.dev || 0, 0, h.devices.length - 1)] : ''; }
  if (head === 'd') {
    const D = selDevice(st);
    if (!D) return undefined;
    if (rest === 'lenRel') return lenFromWindow(D);
    // the extension past the window, shown on its own slider
    if (rest === 'lenX') return lenFromWindow(D) && D.lenRel !== undefined ? D.len : 0;
    return D[rest];
  }
  if (head === 'a') { const D = selDevice(st); return D && D.arr ? D.arr[rest] : undefined; }
  if (head === 'h') return st.storeys[+rest] ? st.storeys[+rest].h : undefined;
  if (k === 'plnW') return selStorey(st).w;
  if (k === 'plnD') return selStorey(st).d;
  if (k === 'sh') return selStorey(st).h;
  if (k === 'slabT') return selStorey(st).slab ?? SLAB0;
  if (k === 'plnOX') return selStorey(st).ox || 0;
  if (k === 'plnOY') return selStorey(st).oy || 0;
  if (k === 'plnRot') return selStorey(st).rot || 0;
  if (k === 'oxyIn') return selStorey(st).oxyIn || 'own';
  if (k === 'rotRel') return selStorey(st).rotRel || 'building';
  if (k === 'matchPlate') return st.matchAbove.plate;
  // the sun by its angles: altitude, and azimuth from due south, east negative
  if (k === 'sunAlt') return solarPosition(st.doy, st.hour, st.timeMode).alt;
  if (k === 'sunAz') return wrap180(solarPosition(st.doy, st.hour, st.timeMode).az - 180);
  // gamma = surface azimuth - solar azimuth; theta, the profile angle, square to the selected side
  if (k === 'gamma' || k === 'theta') {
    const sp = solarPosition(st.doy, st.hour, st.timeMode), g = wrap180(sp.az - facadeAzimuth(st, st.sel.f));
    if (k === 'gamma') return -g;
    return Math.cos(g * Math.PI / 180) > 1e-6 ? Math.atan2(Math.tan(sp.alt * Math.PI / 180), Math.cos(g * Math.PI / 180)) * 180 / Math.PI : 0;
  }
  if (k === 'matchGlazing') return st.matchAbove.glazing;
  if (k === 'matchSides') return !!st.matchAbove.sides;
  return st[k];
}

/** change one value, applying the rules that tie fields together; an edit to
 *  the selected glazing or shading is carried up to the storeys above when
 *  they are set to match */
export function setValue(k, v, st = S) {
  const head = k.includes('.') ? k.slice(0, k.indexOf('.')) : null;
  setOne(k, v, st);
  if (head === 'g' || head === 'd' || head === 'a') matchAbove(st);
}
function setOne(k, v, st) {
  const [head, rest] = k.includes('.') ? [k.slice(0, k.indexOf('.')), k.slice(k.indexOf('.') + 1)] : [null, k];
  if (head === 'g') {
    const r = selCell(st), i = selUnitIndex(st);
    if (!r) return;
    // which system, unit type and shading the window uses: a broken window's own, or the array's
    if (rest === 'sys') { if (st.lib.systems[v]) { r.sys = v; st.sel.unit = null; } return; }
    if (rest === 'unit') {
      if (!st.lib.units[v]) return;
      const b = r.broken && r.broken[i], y = selSystem(st);
      if (b) b.unit = v; else if (y) y.unit = v;
      return;
    }
    if (rest === 'shd') {
      const id = st.lib.shading[v] ? v : null, b = r.brokenShd && r.brokenShd[i];
      if (b) b.shd = id; else r.shd = id;
      r.dev = 0; return;
    }
    // a broken window moved along its bay takes the section cut with it
    if (rest === 'offU') { const b = r.broken && r.broken[i]; if (b) b.offU = v; st.cutU = v; return; }
    if (SYSTEM_KEYS.includes(rest)) {
      const y = selSystem(st); if (!y) return;
      // switching how the units are set out carries the layout across: the pitch
      // they stand at becomes the spacing, the count they make becomes the number
      if (rest === 'winBy' && v !== y.winBy) {
        const L = unitLayout(layoutGlazing(st, r), facadeLength(st, st.sel.f, st.sel.st));
        if (v === 'spacing') y.winSp = +L.pitch.toFixed(4); else y.winN = L.n;
      }
      y[rest] = v; return;
    }
    // the unit's glass, wherever the unit type is used; its SHGC no higher than the by-law allows
    if (rest === 'shgc') v = Math.min(v, SHGC_MAX);
    const u = selUnitType(st); if (u) u[rest] = v;
    return;
  }
  if (head === 'name') { const o = nameTarget(st, rest); if (o) { o.name = v; o.auto = false; } return; }
  // the site: which side is being set, and each side's condition, setback, street width and curb
  if (head === 'site') {
    if (!st.site) st.site = site0();
    const sg = st.site;
    if (rest === 'edit') { if (FACADES[v] !== undefined) sg.edit = v; return; }
    const [f, fld] = rest.split('.');
    if (!sg[f]) return;
    if (fld === 'kind') { if (SITE_KINDS[v]) { sg[f].kind = v; if (v === 'lane' && sg[f].width > 12) { sg[f].width = 6; sg[f].curb = 0; } if (v === 'street' && sg[f].width < 10) { sg[f].width = 20; sg[f].curb = 3; } } return; }
    const r = SITE_FIELDS[fld];
    if (r) sg[f][fld] = clamp(v, r[0], fld === 'curb' ? Math.min(r[1], sg[f].width) : r[1]);
    return;
  }
  if (head === 'd' && rest === 'type') {
    const h = selShading(st), r = selCell(st);
    if (h && h.devices.length && st.lib.devices[v]) h.devices[clamp(r.dev || 0, 0, h.devices.length - 1)] = v;
    return;
  }
  if (head === 'd') {
    const D = selDevice(st); if (!D) return;
    if (rest === 'name') D.auto = false;
    // measured from the window or outright: the member keeps its length across the switch
    if (rest === 'lenRel') {
      const o = openingOf(st), dim = D.dir === 'h' ? o.u1 - o.u0 : o.v1 - o.v0, was = lenFromWindow(D);
      const L = was ? dim + (D.lenRel === undefined ? 0 : D.len || 0) : D.len;
      if (v && !was) D.len = +(L - dim).toFixed(4);
      if (!v && was) D.len = +Math.max(0.05, L).toFixed(4);
      D.lenRel = !!v; return;
    }
    if (rest === 'lenX') { D.lenRel = true; D.len = v; return; }
    if (rest === 'len') { D.lenRel = false; D.len = v; return; }
    if (rest === 'dir' && v !== D.dir) {
      // turning a member swaps which of its justifications its array rides on,
      // so the array is laid out afresh along the new axis
      D.dir = v;
      if (D.arr) D.arr.len = arrayLen0(D, openingOf(st), D.arr.along === 'out');
      if (D.arr && D.arr.along === 'facade' && v === 'v') D.arr.spacing = Math.max(D.arr.spacing, 0.3);
      return;
    }
    D[rest] = v; return;
  }
  if (head === 'a') {
    const D = selDevice(st); if (!D || !D.arr) return;
    if (rest === 'along' && v !== D.arr.along) {
      D.arr.along = v;
      D.arr.len = arrayLen0(D, openingOf(st), v === 'out');
      // a pitch equal to the blade depth makes a solid plate when run outward
      if (v === 'out' && D.arr.spacing <= D.depth + 1e-6) D.arr.spacing = Math.min(2, Math.max(0.05, D.depth * 1.6));
      return;
    }
    if (rest === 'mode' && v !== D.arr.mode) { switchArrayMode(D, v); return; }
    D.arr[rest] = v; return;
  }
  if (head === 'h') { if (st.storeys[+rest]) st.storeys[+rest].h = clamp(v, 2.4, 8); return; }
  // the storey's shape - height, floorplate, offset - and, when matching, every storey above
  if (STOREY_KEYS[k]) {
    const [f, lo, hi] = STOREY_KEYS[k], x = f === 'rot' ? wrap180(v) : clamp(v, lo, hi);
    const i0 = clamp(st.sel.st, 0, st.storeys.length - 1), i1 = st.matchAbove.plate ? st.storeys.length - 1 : i0;
    for (let i = i0; i <= i1; i++) st.storeys[i][f] = x;
    return;
  }
  // what a floor's rotation is measured from: the figure changes, the floor stays as it is
  if (k === 'rotRel') {
    const i0 = clamp(st.sel.st, 0, st.storeys.length - 1), i1 = st.matchAbove.plate ? st.storeys.length - 1 : i0;
    for (let i = i0; i <= i1; i++) {
      const fr = v === 'below' && i === 0 ? 'building' : v, p = st.storeys[i];
      p.rot = +rotIn(st, i, fr).toFixed(6); p.rotRel = fr;
    }
    return;
  }
  // the building's north offset turns every storey measured from it, and those measured from them
  if (k === 'rot') { st.rot = wrap180(v); return; }
  // the axes the offset is read along: the figures change, the storey stays put
  if (k === 'oxyIn') {
    const i0 = clamp(st.sel.st, 0, st.storeys.length - 1), i1 = st.matchAbove.plate ? st.storeys.length - 1 : i0;
    for (let i = i0; i <= i1; i++) {
      const fr = v === 'below' && i === 0 ? 'building' : v, [x, y] = offsetIn(st, i, fr), p = st.storeys[i];
      p.ox = +x.toFixed(6); p.oy = +y.toFixed(6); p.oxyIn = fr;
    }
    return;
  }
  // turned on, the storeys above take this one's shape at once
  if (k === 'matchPlate') { st.matchAbove.plate = !!v; if (v) matchShapeAbove(st); return; }
  if (k === 'matchGlazing') { st.matchAbove.glazing = !!v; if (v) matchAbove(st); return; }
  if (k === 'matchSides') { st.matchAbove.sides = !!v; if (v) matchAbove(st); return; }
  // an angle typed for the sun: the date and time whose sun stands nearest it,
  // the other angle held
  // gamma swings the sun round with its altitude held; theta raises it with its azimuth held
  if (k === 'gamma' || k === 'theta') {
    const sp = solarPosition(st.doy, st.hour, st.timeMode), gf = facadeAzimuth(st, st.sel.f), g = wrap180(sp.az - gf);
    const r = k === 'gamma' ? pickSunAt(st, Math.max(0.2, sp.alt), wrap360(gf - clamp(v, -89, 89)))
      : pickSunAt(st, clamp(Math.atan(Math.tan(clamp(v, 0.5, 89.5) * Math.PI / 180) * Math.cos(g * Math.PI / 180)) * 180 / Math.PI, 0.2, 89.9), sp.az);
    if (r) { st.doy = r.doy; st.hour = r.hour; }
    return;
  }
  if (k === 'sunAlt' || k === 'sunAz') {
    const sp = solarPosition(st.doy, st.hour, st.timeMode);
    const r = k === 'sunAlt' ? pickSunAt(st, clamp(v, 0.2, 89.9), sp.az) : pickSunAt(st, Math.max(0.2, sp.alt), wrap360(v + 180));
    if (r) { st.doy = r.doy; st.hour = r.hour; }
    return;
  }
  if (k === 'doy') { st.doy = clamp(Math.round(v), 1, 365); return; }
  if (k === 'hour') { st.hour = clamp(v, 0, 24); return; }
  st[k] = v;
}

/* Switching an array between spacing and number keeps its members where they
   are. A spacing becomes the number of members it made, and the array's
   length is closed up to the last of them, so the count divides it the same
   way; a number becomes the pitch it divided the length at. Only an array
   that added a member at its far end to catch a remainder is uneven, and no
   count can repeat that exactly: it keeps its length and spreads out. */
function switchArrayMode(D, v) {
  const A = D.arr, just = A.along === 'out' ? 'start' : D.dir === 'h' ? D.justV : D.justU;
  const p = arrayPositions(A, [0, 0], 1, just), n = p.length;
  if (v === 'count') {
    const st = p.slice(1).map((x, i) => x - p[i]), even = st.every(x => Math.abs(x - st[0]) < 1e-6);
    A.count = n;
    if (n > 1 && even) A.len = +(st[0] * (n - 1)).toFixed(6);
  } else if (n > 1 && A.len > 1e-9) A.spacing = +(A.len / (n - 1)).toFixed(6);
  A.mode = v;
}

/* ---------- saved windows ----------
   A window saved by name, with its section and plan cuts, so a plan or a
   section can go on showing it whatever is selected after - several side by
   side, for different sides and storeys. Opening one makes it the selection,
   cuts and all; while it is the selection the shared cuts are its own, and
   moving them - in any view - moves it. Selecting a window that is not saved
   lets them go back to the middle of that window. */
export const savedWindow = (st, id) => (st.views || []).find(v => v.id === id) || null;
/** the saved window that is this side, storey and unit, if any */
export const windowSavedAs = (st, f, s, i) => (st.views || []).find(v => v.f === f && v.st === s && v.unit === i) || null;
/** the selected window saved under a name: its side, storey, unit and both cuts. A
 *  window is saved once - the shared cuts are its own while it is selected, so
 *  two saves of it could not keep two cuts apart - and saving it again gives
 *  back the one already saved */
export function saveWindow(st = S, name) {
  const i = selUnitIndex(st), was = windowSavedAs(st, st.sel.f, st.sel.st, i);
  if (was) { st.activeView = was.id; return was.id; }
  if (!st.views) st.views = [];
  const id = 'v' + (st.viewSeq = (st.viewSeq || 0) + 1);
  st.views.push({ id, name: (name && String(name).trim()) || windowName(st), f: st.sel.f, st: st.sel.st, unit: i, cutU: st.cutU, cutV: st.cutV });
  st.activeView = id;
  return id;
}
/** what a saved window is called when it is not named: where it is */
export const windowName = (st = S) => st.sel.f + ' · storey ' + (st.sel.st + 1) + (selUnitIndex(st) === null ? '' : ' · window ' + (selUnitIndex(st) + 1));
/** a saved window made the selection, with its cuts */
export function openWindow(st = S, id) {
  const v = savedWindow(st, id);
  if (!v) return false;
  st.sel = { f: v.f, st: clamp(v.st, 0, st.storeys.length - 1), unit: v.unit };
  st.cutU = v.cutU; st.cutV = v.cutV; st.activeView = id;
  return true;
}
/** after the selection changes: true if it is a saved window - its cuts are
 *  then put back - and false if not, so the caller re-centres the cuts */
export function selectionChanged(st = S) {
  const v = windowSavedAs(st, st.sel.f, st.sel.st, selUnitIndex(st));
  if (!v) { st.activeView = null; return false; }
  if (v.id !== st.activeView) { st.cutU = v.cutU; st.cutV = v.cutV; st.activeView = v.id; }
  return true;
}
/** the cuts as they now stand, written into the saved window that is the selection */
export function keepCuts(st = S) {
  const v = savedWindow(st, st.activeView);
  if (!v) { st.activeView = null; return; }
  if (v.f !== st.sel.f || v.st !== st.sel.st || v.unit !== selUnitIndex(st)) { st.activeView = null; return; }
  v.cutU = st.cutU; v.cutV = st.cutV;
}
export function renameWindow(id, name, st = S) {
  const v = savedWindow(st, id);
  if (!v || !String(name || '').trim()) return false;
  v.name = String(name).trim();
  return true;
}
export function removeWindow(id, st = S) {
  const n = (st.views || []).length;
  st.views = (st.views || []).filter(v => v.id !== id);
  if (st.activeView === id) st.activeView = null;
  return st.views.length < n;
}
/** the design as a saved window sees it: the same building, its window selected, its cuts */
export function windowState(st, id) {
  const v = savedWindow(st, id);
  if (!v) return null;
  return Object.assign({}, st, { sel: { f: v.f, st: clamp(v.st, 0, st.storeys.length - 1), unit: v.unit }, cutU: v.cutU, cutV: v.cutV });
}

/* ---------- storeys ---------- */
const STOREY_KEYS = { sh: ['h', 2.4, 8], slabT: ['slab', 0, 2], plnW: ['w', 8, 80], plnD: ['d', 6, 60], plnOX: ['ox', -30, 30], plnOY: ['oy', -30, 30], plnRot: ['rot', -180, 180] };
/** the storeys above take the selected one's height, floorplate, north offset and offset */
export function matchShapeAbove(st = S) {
  const s0 = selStorey(st);
  for (let i = st.sel.st + 1; i < st.storeys.length; i++) {
    for (const [f] of Object.values(STOREY_KEYS)) st.storeys[i][f] = s0[f] || 0;
    st.storeys[i].oxyIn = s0.oxyIn || 'own';
    st.storeys[i].rotRel = s0.rotRel || 'building';
  }
}
export const STOREYS_MAX = 40;
/** a new storey on top, blank, as tall and as big as the one below it */
export function addStorey(st = S) {
  if (st.storeys.length >= STOREYS_MAX) return false;
  const top = st.storeys[st.storeys.length - 1];
  st.storeys.push(storey0(top.h, top.w, top.d, top.ox || 0, top.oy || 0, top.rot || 0, top.oxyIn || 'own', top.rotRel || 'building', top.slab ?? SLAB0));
  st.sel.st = st.storeys.length - 1;
  st.sel.unit = null;
  return true;
}
/** a copy of the selected storey, placed directly above it or directly below;
 *  the copy becomes the selected storey, as a copied sheet does */
export function duplicateStorey(st = S, where = 'above') {
  if (st.storeys.length >= STOREYS_MAX) return false;
  const src = selStorey(st), at = st.sel.st + (where === 'below' ? 0 : 1);
  st.storeys.splice(at, 0, JSON.parse(JSON.stringify(src)));
  // saved windows stay on the storeys they were saved on
  for (const v of st.views || []) if (v.st >= at) v.st++;
  st.sel.st = at;
  return true;
}
/** the selected storey moved a level up (+1) or down (-1), trading places */
export function moveStorey(dir, st = S) {
  const i = st.sel.st, j = i + dir;
  if (j < 0 || j >= st.storeys.length) return false;
  [st.storeys[i], st.storeys[j]] = [st.storeys[j], st.storeys[i]];
  for (const v of st.views || []) v.st = v.st === i ? j : v.st === j ? i : v.st;
  st.sel.st = j;
  return true;
}
export function removeStorey(i, st = S) {
  if (st.storeys.length < 2) return false;
  st.storeys.splice(i, 1);
  // a saved window on the storey taken out goes with it
  st.views = (st.views || []).filter(v => v.st !== i);
  for (const v of st.views) if (v.st > i) v.st--;
  if (st.activeView && !savedWindow(st, st.activeView)) st.activeView = null;
  st.sel.st = clamp(st.sel.st > i ? st.sel.st - 1 : st.sel.st, 0, st.storeys.length - 1);
  return true;
}

/* ---------- matching the storeys above, and the other sides ----------
   With glazing set to match the floors above, the storeys above the selected
   one take its glazing and shading on the selected side; set to match all
   sides, the storey's other sides take it - and the other sides of the
   storeys above too, when both are on. Wherever they can: a storey with no
   room for the glass keeps what it had. Called after every glazing or
   shading change, so the matched conditions follow as it is made. */
export function matchAbove(st = S) {
  const m = st.matchAbove || {};
  if (!m.glazing && !m.sides) return { done: [], skipped: [] };
  const i0 = st.sel.st, sides = m.sides ? Object.keys(FACADES) : [st.sel.f], targets = [];
  for (let i = i0; i < (m.glazing ? st.storeys.length : i0 + 1); i++)
    for (const f of sides) if (!(i === i0 && f === st.sel.f)) targets.push({ f, st: i });
  if (!targets.length) return { done: [], skipped: [] };
  return copyCondition({ height: false, glazing: true, whole: true }, targets, st);
}

/* ---------- breaking a window from its array, and binding it back ----------
   The window and its shading break out apart. Broken, the window takes a copy
   of the array's unit type, or its shading a copy of the array's shading
   system, as its own - so its edits are its own - and it can then be given any
   other type in the library. The part not broken still follows the array.
   Bound back, a part either drops its own and takes the array's again, or
   gives its own to the array - and then the other windows broken in that part
   can be bound back too, taking the array's new settings, or kept as they are.
   A copy made by breaking that nothing uses any more leaves the library.
   part: 'win' the window's unit type and its offset; 'shd' its shading. */
const MAP = { win: 'broken', shd: 'brokenShd' };
export function breakUnit(st = S, part = 'win') {
  const r = selCell(st), i = selUnitIndex(st), m = MAP[part];
  if (!r || i === null || isBroken(st, part)) return false;
  const tag = ' · window ' + (i + 1);
  if (part === 'win') {
    const u = selUnitType(st);
    if (!u) return false;
    const id = duplicateEntry(st, 'units', u.id, nextName(st, 'units', (u.name || 'Glazing unit') + tag));
    st.lib.units[id].auto = true;
    r.broken = Object.assign(r.broken || {}, { [i]: { unit: id, offU: 0 } });
  } else {
    let id = null;
    if (r.shd && st.lib.shading[r.shd]) {
      id = duplicateEntry(st, 'shading', r.shd, nextName(st, 'shading', entryName(st, 'shading', r.shd) + tag));
      st.lib.shading[id].auto = true;
      st.lib.shading[id].devices.forEach(d => { st.lib.devices[d].auto = true; });
    }
    r.brokenShd = Object.assign(r.brokenShd || {}, { [i]: { shd: id } });
  }
  st.sel.unit = i;
  return true;
}
/** mode 'revert': the part takes the array's settings again; 'apply': the
 *  array takes the window's, and `others` says what the other broken ones do.
 *  The array's unit type is its system's, so applying a window's unit gives it
 *  to every side that system sets out. */
export function rebindUnit(mode, others = 'keep', st = S, part = 'win') {
  const r = selCell(st), i = selUnitIndex(st), m = MAP[part];
  if (!r || !isBroken(st, part)) return false;
  const own = r[m][i];
  if (mode === 'apply') {
    if (part === 'win') { const y = selSystem(st); if (y && st.lib.units[own.unit]) { y.unit = own.unit; st.lib.units[own.unit].auto = false; } }
    else {
      r.shd = own.shd; r.dev = 0;
      const h = own.shd && st.lib.shading[own.shd];
      if (h) { h.auto = false; h.devices.forEach(d => { if (st.lib.devices[d]) st.lib.devices[d].auto = false; }); }
    }
  }
  delete r[m][i];
  if (mode === 'apply' && others === 'rebind') delete r[m];
  if (r[m] && !Object.keys(r[m]).length) delete r[m];
  prune(st);
  return true;
}
/** every window of the selected array broken in that part bound back to it */
export function rebindAll(st = S, part = 'win') {
  const r = selCell(st), m = MAP[part];
  if (!r || !r[m]) return false;
  delete r[m];
  prune(st);
  return true;
}
/** the other windows of the selected array broken from it in that part */
export const otherBroken = (st = S, part = 'win') => brokenUnits(selCell(st), part).filter(i => i !== selUnitIndex(st));
/** copies that breaking made and nothing uses any more, dropped from the library */
function prune(st) {
  for (const kind of ['units', 'shading', 'devices']) {
    const used = usage(st);
    for (const [id, o] of Object.entries(st.lib[kind])) if (o.auto && !used[id]) delete st.lib[kind][id];
  }
}

/* ---------- the library on the selected condition ---------- */
/** a structural change to the selected glazing, and the floors above after it */
const andAbove = (fn) => (...a) => {
  const st = a[a.length - 1] && a[a.length - 1].storeys ? a[a.length - 1] : S;
  const r = fn(...a);
  if (r) matchAbove(st);
  return r;
};
/** the selected side set out by a system: a new reference, or the existing one re-pointed */
function useSystemOn(st, id) {
  const s = selStorey(st), r = s.cells[st.sel.f];
  if (r) r.sys = id; else s.cells[st.sel.f] = { sys: id, shd: null, dev: 0 };
  st.sel.unit = null;
}
/** a new window system on the selected side: from a preset, with its unit, or from scratch, with none yet */
export const newSystemHere = andAbove(function newSystemHere(preset, st = S) { useSystemOn(st, newSystem(st, preset)); return true; });
/** a saved window system on the selected side */
export const useSystem = andAbove(function useSystem(id, st = S) { if (!st.lib.systems[id]) return false; useSystemOn(st, id); return true; });
/** a new unit type for the selected window - the system's, or a broken window's own - from a preset or from scratch */
export const newUnitHere = andAbove(function newUnitHere(preset, st = S) {
  if (!selCell(st)) return false;
  setOne('g.unit', newUnit(st, preset), st);
  return true;
});
/** the entry the selected window uses, copied under a new name and used in its place */
export const duplicateHere = andAbove(function duplicateHere(kind, st = S) {
  const r = selCell(st);
  if (!r) return false;
  if (kind === 'sys') { const id = duplicateEntry(st, 'systems', r.sys); if (id) r.sys = id; return !!id; }
  if (kind === 'unit') { const u = selUnitType(st), id = u && duplicateEntry(st, 'units', u.id); if (id) setOne('g.unit', id, st); return !!id; }
  if (kind === 'shd') { const id = selShadingId(st), nid = id && duplicateEntry(st, 'shading', id); if (nid) setOne('g.shd', nid, st); return !!nid; }
  if (kind === 'dev') {
    const h = selShading(st), D = selDevice(st), nid = D && duplicateEntry(st, 'devices', D.id);
    if (nid) h.devices[clamp(r.dev || 0, 0, h.devices.length - 1)] = nid;
    return !!nid;
  }
  return false;
});
/** an entry nothing uses taken out of the library */
export function deleteEntry(kind, id, st = S) {
  if (!st.lib[kind] || !st.lib[kind][id] || usage(st)[id]) return false;
  delete st.lib[kind][id];
  return true;
}
/** the glazing as the worked cases and the tests first give it: four 3 m windows by number */
export const addGlazing = andAbove(function addGlazing(st = S) {
  const s = selStorey(st);
  if (s.cells[st.sel.f]) return false;
  const g = GLAZING0(), top = s.h - (s.slab ?? SLAB0);
  g.shgc = Math.min(g.shgc, SHGC_MAX);
  // a window has to fit under the slab of the storey it is put in
  if (g.sill + g.winH > top) g.winH = Math.max(0.6, top - g.sill);
  s.cells[st.sel.f] = adoptGlazing(st, g, nextName(st, 'systems', 'Punched windows')).ref;
  st.sel.unit = null;
  return true;
});
export const removeGlazing = andAbove(function removeGlazing(st = S) {
  const s = selStorey(st);
  if (!s.cells[st.sel.f]) return false;
  s.cells[st.sel.f] = null;
  prune(st);
  return true;
});
export const DEVICES_MAX = 4;
/** a shading system for the selected window, making one if it has none */
function shadingHere(st) {
  let h = selShading(st);
  if (!h) { const id = addEntry(st, 'shading', { name: nextName(st, 'shading', 'Shading') }); setOne('g.shd', id, st); h = st.lib.shading[id]; }
  return h;
}
/** a new member, horizontal or vertical, on the selected window's shading system */
export const addDevice = andAbove(function addDevice(dir = 'h', st = S) {
  const r = selCell(st);
  if (!r || !selGlazing(st)) return false;
  const h = shadingHere(st);
  if (h.devices.length >= DEVICES_MAX) return false;
  h.devices.push(addEntry(st, 'devices', DEVICE0(dir)));
  r.dev = h.devices.length - 1;
  return true;
});
/** a saved device type added to the selected window's shading system */
export const addSavedDevice = andAbove(function addSavedDevice(id, st = S) {
  const r = selCell(st);
  if (!r || !selGlazing(st) || !st.lib.devices[id]) return false;
  const h = shadingHere(st);
  if (h.devices.length >= DEVICES_MAX) return false;
  h.devices.push(id);
  r.dev = h.devices.length - 1;
  return true;
});
export const removeDevice = andAbove(function removeDevice(st = S) {
  const h = selShading(st), r = selCell(st);
  if (!h || !h.devices.length) return false;
  h.devices.splice(clamp(r.dev || 0, 0, h.devices.length - 1), 1);
  r.dev = clamp(r.dev || 0, 0, Math.max(0, h.devices.length - 1));
  return true;
});
export const createArray = andAbove(function createArray(st = S) {
  const D = selDevice(st);
  if (!D || D.arr) return false;
  D.arr = array0(D, openingOf(st));
  return true;
});
export const removeArray = andAbove(function removeArray(st = S) {
  const D = selDevice(st);
  if (!D || !D.arr) return false;
  D.arr = null;
  return true;
});

/* ---------- shading presets: a shading system to start from ----------
   Each makes a new shading system for the selected window, its devices sized
   to the opening they land on. Across units that fill their bays the units
   abut, so an array that ran the full unit would put a member on each joint
   twice over - there the far end is left off, and the next unit's first
   member closes the pitch. */
export const SHADING_PRESETS = {
  fins: { label: 'Vertical fins', make: (o, run) => [Object.assign(DEVICE0('v'), { name: 'Vertical fins',
    depth: 0.30, thick: 0.03, justU: 'start', offset: 0.05,
    arr: { along: 'facade', mode: 'spacing', count: 5, spacing: 0.50, len: o.u1 - o.u0, ends: !run } })] },
  // a solid canopy just over the head; over a window in a wall it runs 300 past each jamb
  canopy: { label: 'Canopy', make: (o, run) => [Object.assign(DEVICE0('h'), { name: 'Canopy',
    depth: 0.90, thick: 0.10, justV: 'start', offOn: true, offV: 0.05, lenRel: true, len: run ? 0 : 0.6 })] },
  louvredCanopy: { label: 'Louvred canopy', make: o => [Object.assign(DEVICE0('h'), { name: 'Louvred canopy',
    depth: 0.15, thick: 0.03, justV: 'start', offOn: true, offV: 0.15,
    arr: { along: 'out', mode: 'spacing', count: 6, spacing: 0.24, len: 1.2, ends: true } })] },
  louvres: { label: 'Horizontal louvres', make: (o, run) => [Object.assign(DEVICE0('h'), { name: 'Horizontal louvres',
    depth: 0.30, thick: 0.03, justV: 'start', offset: 0.05,
    arr: { along: 'facade', mode: 'spacing', count: 5, spacing: 0.30, len: o.v1 - o.v0, ends: true } })] },
  eggcrate: { label: 'Egg-crate', make: (o, run) => [...SHADING_PRESETS.louvres.make(o, run), ...SHADING_PRESETS.fins.make(o, run)] },
  balcony: { label: 'Balcony', make: (o, run, h) => [balcony(o, run, h)] }
};
/** the floor above run out as a balcony: its top at the floor above, and the
 *  unit's width, so that abutting units make one continuous slab */
function balcony(o, run, h, depth = 1.8, t = 0.2) {
  return Object.assign(DEVICE0('h'), { name: 'Balcony', depth, thick: t, justV: 'start',
    offOn: true, offV: Math.max(t / 2, h - o.v1 - t / 2), lenRel: true, len: run ? 0 : 1.2 });
}
/** a new shading system from a preset - or an empty one - on the selected window */
export const applyShadingPreset = andAbove(function applyShadingPreset(name, st = S) {
  const g = selGlazing(st), p = SHADING_PRESETS[name];
  if (!g || !selCell(st)) return false;
  const o = openingOf(st), run = o.u1 - o.u0 >= unitLayout(g, facadeLength(st, st.sel.f, st.sel.st)).pitch - 1e-9;
  const devs = p ? p.make(o, run, selStorey(st).h) : [];
  const id = addEntry(st, 'shading', { name: nextName(st, 'shading', p ? p.label : 'Shading'), devices: devs.map(D => addEntry(st, 'devices', D)) });
  setOne('g.shd', id, st);
  return true;
});

/* ---------- a shading system from an ideal solution ----------
   The ideal members the design recommendations draw - n of them, each 1/n as
   deep at 1/n the spacing - made a shading system type of their own, named,
   on the selected window. Thin, flush and long: each runs on past the window
   by as far as the sun slips along it across its depth, so that at the instant
   it was worked out for it shades the whole of the glass.
     spec: { dir: 'h' | 'v', n, d, pitch, ext, side: 'start' | 'end' }
   Blades hang from the head, down the window at the pitch; fins stand from the
   jamb the sun comes from (side), across it, from the sill up.             */
export const IDEAL_THICK = 0.02;
export const shadingFromIdeal = andAbove(function shadingFromIdeal(spec, name, st = S) {
  if (!selGlazing(st) || !selCell(st) || !(spec && spec.d > 0 && spec.n >= 1)) return false;
  const r4 = x => +x.toFixed(4), h = spec.dir === 'h', n = Math.round(spec.n);
  const D = Object.assign(DEVICE0(h ? 'h' : 'v'), { name: h ? (n === 1 ? 'Overhang' : 'Horizontal louvres') : (n === 1 ? 'Fin' : 'Vertical fins'),
    depth: r4(spec.d), thick: IDEAL_THICK, lenRel: true, len: r4(Math.max(0, spec.ext || 0)) },
    h ? { justV: 'start', justU: 'centre' } : { justU: spec.side === 'end' ? 'end' : 'start', justV: 'end' });
  if (n > 1) D.arr = { along: 'facade', mode: 'count', count: n, spacing: r4(spec.pitch), len: r4((n - 1) * spec.pitch), ends: true };
  const nm = String(name || '').trim() || spec.name || 'Ideal shading';
  D.name = nextName(st, 'devices', nm);
  const id = addEntry(st, 'shading', { name: nextName(st, 'shading', nm), devices: [addEntry(st, 'devices', D)] });
  setOne('g.shd', id, st);
  return true;
});

/* ---------- copying a condition to others ----------
   What is copied is chosen piece by piece - the storey height and slab, the
   window system, the shading system - and so are the targets, any storey of
   any side. What is copied is the reference: the target uses the same
   library entries, so it changes with them. A target is only changed if the
   glass still has room under its slab, and shading needs glazing to hang on.
   Returns what was done and, for each target passed over, why.            */
export function copyCondition(what, targets, st = S) {
  const src = selStorey(st), r0 = selCell(st), done = [], skipped = [];
  const name = t => t.f + ' storey ' + (t.st + 1);
  const fits = (ref, h, slab) => {
    const g = ref && flatGlazing(st, ref);
    if (!g) return null;
    if (h - slab - (g.sill || 0) < 0.3) return 'the glass would have no room under a ' + (slab * 1000).toFixed(0) + ' mm slab in a ' + h.toFixed(2) + ' m storey';
    return null;
  };
  const copy = o => o ? JSON.parse(JSON.stringify(o)) : null;
  for (const t of targets) {
    if (t.f === st.sel.f && t.st === st.sel.st) continue;
    const S2 = st.storeys[t.st];
    if (!S2) continue;
    const h = what.height ? src.h : S2.h, slab = what.height ? src.slab ?? SLAB0 : S2.slab ?? SLAB0;
    let ref = copy(S2.cells[t.f]);
    if (what.whole) ref = copy(r0);
    else {
      if (what.glazing) ref = r0 ? { sys: r0.sys, shd: ref ? ref.shd : null, dev: 0 } : null;
      if (what.shading) {
        if (!ref) { skipped.push(name(t) + ' — there is no glazing there to carry the shading'); continue; }
        ref.shd = r0 ? r0.shd : null; ref.dev = 0;
      }
    }
    let why = fits(ref, h, slab);
    // a new height must suit every side of that storey, not only this one
    if (!why && what.height) for (const f of Object.keys(FACADES)) {
      const w2 = f !== t.f && fits(S2.cells[f], h, slab);
      if (w2) { why = f + ' side: ' + w2; break; }
    }
    if (why) { skipped.push(name(t) + ' — ' + why); continue; }
    if (what.height) { S2.h = src.h; S2.slab = src.slab ?? SLAB0; }
    S2.cells[t.f] = ref;
    done.push(name(t));
  }
  return { done, skipped };
}

/* ---------- building typologies ----------
   Starting points for the whole building: a floorplate, a stack of storeys and
   glazing on every side. They carry no shading - that is what is to be
   designed - except the balcony tower, whose balconies are the shading. The
   date, the time, the orientation and the weather are left as they are.
     Each storey run is [how many, storey height, slab, recipe]; a recipe is a
   window system with its unit (and, for the balconies, a shading system),
   entered in the library once and used by every storey and side that has it,
   so editing it edits them all.                                            */
const R = (sys, unit, devices) => ({ sys, unit, devices });
const FILL = { sill: 0, fillW: true, fillH: true };
const CW_OFFICE = R({ name: 'Office curtain wall', winBy: 'spacing', winSp: 1.5, wallT: 0.30 }, Object.assign({ name: 'Curtain wall, solar control', reveal: 0, shgc: 0.28 }, FILL));
const CW_LOBBY = R({ name: 'Lobby curtain wall', winBy: 'spacing', winSp: 1.5, wallT: 0.30 }, Object.assign({ name: 'Lobby curtain wall', reveal: 0, shgc: 0.28 }, FILL));
const WW_RES = R({ name: 'Residential window wall', winBy: 'spacing', winSp: 1.5, wallT: 0.30 }, Object.assign({ name: 'Residential window wall', reveal: 0.05, shgc: 0.33 }, FILL));
const WW_BALC = R({ name: 'Window wall behind balconies', winBy: 'spacing', winSp: 1.5, wallT: 0.30 }, Object.assign({ name: 'Residential window wall', reveal: 0.05, shgc: 0.33 }, FILL),
  // the slab above each storey run out 1.8 m: its top at the floor above, 250 mm thick, one continuous plate
  [Object.assign(DEVICE0('h'), { name: 'Balcony', depth: 1.8, thick: 0.25, justV: 'start', offOn: true, offV: 0.125, len: 0 })]);
const WW_OFFICE = R({ name: 'Office window wall', winBy: 'spacing', winSp: 1.5, wallT: 0.30 }, Object.assign({ name: 'Office window wall', reveal: 0.05, shgc: 0.30 }, FILL));
const STOREFRONT = R({ name: 'Storefront', winBy: 'spacing', winSp: 2.0, wallT: 0.30 }, Object.assign({ name: 'Storefront glazing', reveal: 0.10, shgc: 0.36 }, FILL));
const PUNCHED_APT = R({ name: 'Punched windows', winBy: 'spacing', winSp: 3.0, wallT: 0.30 }, { name: 'Apartment window', winW: 1.2, winH: 1.8, sill: 0.75, reveal: 0.10, shgc: 0.35 });
const PUNCHED_TH = R({ name: 'Punched windows', winBy: 'spacing', winSp: 3.0, wallT: 0.30 }, { name: 'Townhouse window', winW: 1.5, winH: 1.8, sill: 0.6, reveal: 0.08, shgc: 0.35 });
const PUNCHED_HOUSE = R({ name: 'Punched windows', winBy: 'number', winN: 3, wallT: 0.30 }, { name: 'House window', winW: 1.2, winH: 1.5, sill: 0.9, reveal: 0.06, shgc: 0.35 });
const ALL = (recipe, sides = ['N', 'E', 'S', 'W']) => ({ recipe, sides });

/* The stress test: every condition the tool reads, on a building light enough
   to stay smooth - six storeys. A three-storey podium sits on the property
   line of a 20 m street to the south and an 8 m street to the east; above it a
   tower steps back, and its top storey overhangs the one below by 4 m on the
   south and 2 m on the east. The same 900 mm canopy is on every podium window
   on both streets: by VBBL 1.8.9.3 it is too deep on the ground floor of
   either, fits the first floor on the wide street but not the narrow one, and
   fits the second floor of both. The tower is curtain wall to the streets and
   punched to the north (an adjoining property) and west (a lane).          */
const CANOPY_900 = [Object.assign(DEVICE0('h'), { name: 'Canopy 900', depth: 0.9, thick: 0.1, justV: 'start', offOn: true, offV: 0.05, lenRel: true, len: 0.6 })];
const STOREFRONT_CANOPY = [Object.assign(DEVICE0('h'), { name: 'Storefront canopy 900', depth: 0.9, thick: 0.1, justV: 'start', offOn: true, offV: 0.05, lenRel: true, len: 0 })];
const DEMO_SHOP = Object.assign(R({ name: 'Shopfront curtain wall', winBy: 'spacing', winSp: 2.0, wallT: 0.30 }, Object.assign({ name: 'Shopfront glazing', reveal: 0, shgc: 0.33 }, FILL), STOREFRONT_CANOPY), { shdName: 'Storefront canopy' });
const DEMO_SHOP_BARE = R({ name: 'Shopfront curtain wall', winBy: 'spacing', winSp: 2.0, wallT: 0.30 }, Object.assign({ name: 'Shopfront glazing', reveal: 0, shgc: 0.33 }, FILL));
const DEMO_APT = Object.assign(R({ name: 'Podium punched windows', winBy: 'spacing', winSp: 3.0, wallT: 0.30 }, { name: 'Podium window', winW: 1.5, winH: 1.8, sill: 0.75, reveal: 0.10, shgc: 0.33 }, CANOPY_900), { shdName: 'Canopy 900' });
const DEMO_APT_BARE = R({ name: 'Podium punched windows', winBy: 'spacing', winSp: 3.0, wallT: 0.30 }, { name: 'Podium window', winW: 1.5, winH: 1.8, sill: 0.75, reveal: 0.10, shgc: 0.33 });
const DEMO_CW = R({ name: 'Tower curtain wall', winBy: 'spacing', winSp: 1.5, wallT: 0.30 }, Object.assign({ name: 'Curtain wall, solar control', reveal: 0, shgc: 0.28 }, FILL));
const DEMO_PUNCH = R({ name: 'Tower punched windows', winBy: 'spacing', winSp: 3.0, wallT: 0.30 }, { name: 'Tower window', winW: 1.2, winH: 1.8, sill: 0.75, reveal: 0.10, shgc: 0.33 });
const PODIUM = { w: 40, d: 24, ox: 0, oy: 0 }, TOWER = { w: 28, d: 16, ox: -4, oy: 3 }, CROWN = { w: 30, d: 20, ox: -3, oy: 1 };
const DEMO_SITE = { edit: 'S', S: { kind: 'street', off: 0, width: 20, curb: 3 }, E: { kind: 'street', off: 0, width: 8, curb: 2 },
  N: { kind: 'property', off: 3, width: 6, curb: 0 }, W: { kind: 'lane', off: 1.5, width: 6, curb: 0 } };
export const TYPOLOGIES = {
  blank: { label: 'Blank block', sub: 'one storey, nothing on it', about: 'A single 3.6 m storey on a 30 × 18 m floorplate, with no glazing: build it up yourself.', plnW: 30, plnD: 18, runs: [[1, 3.6, 0.3, null]], st: 0 },
  officeTower: { label: 'Glazed office tower', sub: 'curtain wall · 20 storeys', about: 'A 36 × 30 m office floorplate, 20 storeys: a 6 m lobby and 4 m office floors in curtain wall on a 1.5 m module, glass to glass, under a 1 m slab band, solar-control glass (SHGC 0.28).', plnW: 36, plnD: 30,
    runs: [[1, 6.0, 0.6, ALL(CW_LOBBY)], [19, 4.0, 1.0, ALL(CW_OFFICE)]], st: 9 },
  resTower: { label: 'Glazed residential tower', sub: 'window wall · 30 storeys', about: 'A 24 × 24 m point tower, 30 storeys: a 4.5 m storefront base, then 2.9 m residential floors in window wall, set back 50 mm behind 250 mm slab edges (SHGC 0.33).', plnW: 24, plnD: 24,
    runs: [[1, 4.5, 0.5, ALL(STOREFRONT)], [29, 2.9, 0.25, ALL(WW_RES)]], st: 14 },
  balcTower: { label: 'Tower with balconies', sub: 'window wall · 1.8 m balconies', about: 'The glazed residential tower with 1.8 m balconies wrapping every floor above the base: the slab above each storey is its shading.', plnW: 24, plnD: 24,
    runs: [[1, 4.5, 0.5, ALL(STOREFRONT)], [29, 2.9, 0.25, ALL(WW_BALC)]], st: 14 },
  midGlazed: { label: 'Mid-rise glazed', sub: 'window wall · 6 storeys', about: 'A deep 48 × 30 m floorplate, 6 storeys: a 5 m storefront base and 4 m floors in window wall under 400 mm slabs (SHGC 0.30).', plnW: 48, plnD: 30,
    runs: [[1, 5.0, 0.5, ALL(STOREFRONT)], [5, 4.0, 0.4, ALL(WW_OFFICE)]], st: 2 },
  midPunched: { label: 'Mid-rise punched', sub: 'storefront base, punched above', about: 'A 45 × 20 m block, 6 storeys: a 4.5 m storefront at grade, then 3 m floors with 1.2 × 1.8 m windows at 3 m centres, set 100 mm into a 300 mm wall.', plnW: 45, plnD: 20,
    runs: [[1, 4.5, 0.5, ALL(STOREFRONT)], [5, 3.0, 0.3, ALL(PUNCHED_APT)]], st: 2 },
  townhouse: { label: 'Townhouse row', sub: 'punched · 3 storeys', about: 'A 36 × 12 m row, 3 storeys of 3 m: 1.5 × 1.8 m windows front and back, blank party-wall ends.', plnW: 36, plnD: 12,
    runs: [[3, 3.0, 0.3, ALL(PUNCHED_TH, ['N', 'S'])]], st: 1 },
  demo: { label: 'Stress test: mixed site', sub: 'two streets · podium · overhang', about: 'Every condition at once, kept to six storeys: a three-storey podium on a 20 m street (south) and an 8 m street (east), an adjoining property (north) and a lane (west); a tower stepped back above it, its top storey overhanging the one below. The same 900 mm canopy runs over every podium window on both streets - too deep at grade, fine higher up, and the narrow street stricter than the wide one. Curtain wall and punched windows both.',
    plnW: PODIUM.w, plnD: PODIUM.d, site: DEMO_SITE, st: 1,
    runs: [[1, 4.5, 0.5, [ALL(DEMO_SHOP, ['S', 'E']), ALL(DEMO_SHOP_BARE, ['N', 'W'])], PODIUM],
      [2, 3.2, 0.3, [ALL(DEMO_APT, ['S', 'E']), ALL(DEMO_APT_BARE, ['N', 'W'])], PODIUM],
      [2, 3.2, 0.3, [ALL(DEMO_CW, ['S', 'E']), ALL(DEMO_PUNCH, ['N', 'W'])], TOWER],
      [1, 3.6, 0.3, [ALL(DEMO_CW, ['S', 'E']), ALL(DEMO_PUNCH, ['N', 'W'])], CROWN]] },
  house: { label: 'Two-storey house', sub: 'punched · 12 × 9 m', about: 'A 12 × 9 m house, two 2.8 m storeys, three 1.2 × 1.5 m windows on each side.', plnW: 12, plnD: 9,
    runs: [[2, 2.8, 0.3, ALL(PUNCHED_HOUSE)]], st: 0 }
};
export function applyTypology(key, st = S) {
  const t = TYPOLOGIES[key];
  if (!t) return false;
  st.lib = lib0();
  st.views = []; st.activeView = null;
  st.storeys = [];
  const made = new Map(), shdMade = new Map();
  const refOf = rc => {
    if (!made.has(rc)) {
      const unit = addEntry(st, 'units', rc.unit), sys = addEntry(st, 'systems', Object.assign({}, rc.sys, { unit }));
      // recipes with the same devices share one shading system, so it is one device wherever it is
      let shd = null;
      if (rc.devices) {
        if (!shdMade.has(rc.devices)) shdMade.set(rc.devices, addEntry(st, 'shading', { name: rc.shdName || 'Balconies', devices: rc.devices.map(D => addEntry(st, 'devices', D)) }));
        shd = shdMade.get(rc.devices);
      }
      made.set(rc, { sys, shd });
    }
    return Object.assign({ dev: 0 }, made.get(rc));
  };
  for (const [n, h, slab, g, pl] of t.runs) for (let i = 0; i < n; i++) {
    const p = pl || { w: t.plnW, d: t.plnD, ox: 0, oy: 0 };
    const s = storey0(h, p.w, p.d, p.ox, p.oy, 0, 'own', 'building', slab);
    if (g) for (const gg of [].concat(g)) for (const f of gg.sides) s.cells[f] = refOf(gg.recipe);
    st.storeys.push(s);
  }
  // a typology that brings its site sets it; the others leave the site as it was
  if (t.site) st.site = JSON.parse(JSON.stringify(t.site));
  st.sel = { f: 'S', st: clamp(t.st, 0, st.storeys.length - 1), unit: null };
  st.scope = 'unit'; st.expScope = 'unit';
  const o = selGlazing(st) ? openingOf(st) : null;
  st.cutU = 0; st.cutV = o ? (o.v0 + o.v1) / 2 : 2.1;
  return true;
}

/* ---------- test cases ----------
   Not offered on the page: the test suite's fixtures. A worked overhang and
   four worked cases, each on one storey of one side, written in the
   v4 form and turned into members and arrays exactly as the golden master is. */
const WIN = { type: 'punched', winW: 3.0, winH: 2.4, sill: 0.9, winN: 4, wallT: 0.28, reveal: 0 };
const V4DEV0 = { dev: 'louvre-h', depth: 0.60, thick: 0.05, angle: 0, offset: 0.10, ohV: 0,
  arrMode: 'spacing', count: 5, spacing: 0.60, arrLen: 0, arrJust: 'start', arrOff: 0, ends: true,
  elemLen: 0, elemJust: 'centre', elemOff: 0 };
export const CASES = {
  0: { label: 'Worked example: size an overhang', sub: '20° E of S · early Aug 10:00 solar · 1.5 m window',
    f: 'S', set: { rot: 340, doy: doyOf(8, 5), hour: 10, timeMode: 'sol', encroach: false },
    win: { winW: 1.8, winH: 1.5, sill: 0.9, winN: 4 },
    // Ph = h / tan(theta) = 1.5 / tan 53 deg: an overhang 1.13 m deep, flush on the head
    devices: [{ dir: 'h', depth: 1.13, thick: 0.02, angle: 0, len: 3.6, justV: 'start', justU: 'centre', offOn: true, offU: 0, offV: 0.01, offset: 0 }] },
  1: { label: 'Case 1 · South horizontal shading', sub: '21 Jun solar noon · 600 mm louvres at 600',
    f: 'S', set: { rot: 0, doy: doyOf(6, 21), hour: 12, timeMode: 'sol', encroach: false },
    systems: [{ dev: 'louvre-h', depth: 0.6, spacing: 0.6, thick: 0.05, angle: 0, offset: 0.1 }] },
  2: { label: 'Case 2 · West vertical shading', sub: '21 Sep 17:00 · 600 mm fins at 750, 30°',
    f: 'W', set: { rot: 0, doy: doyOf(9, 21), hour: 17, timeMode: 'lst', encroach: false },
    systems: [{ dev: 'fin-v', depth: 0.6, spacing: 0.75, thick: 0.05, angle: 30, offset: 0.1 }] },
  3: { label: 'Case 3 · Street projection', sub: 'Encroaching device, 6.0 m above an 18 m street',
    f: 'S', set: { rot: 0, doy: doyOf(6, 21), hour: 12, timeMode: 'sol',
      encroach: true, streetW: 18, devHeight: 6.0, curbDist: 2.0 },
    systems: [{ dev: 'overhang', depth: 0.9, spacing: 0.6, thick: 0.05, angle: 0, offset: 0.1 }] },
  4: { label: 'Case 4 · Egg-crate, south-west', sub: '450 mm blades and fins together, run past the opening',
    f: 'S', set: { rot: 45, doy: doyOf(8, 15), hour: 16, timeMode: 'lst', encroach: false },
    systems: [
      { dev: 'louvre-h', depth: 0.45, spacing: 0.45, thick: 0.04, angle: 0, offset: 0.08,
        arrLen: 2.85, arrJust: 'start', arrOff: -0.45, elemLen: 3.5, elemJust: 'centre' },
      { dev: 'fin-v', depth: 0.45, spacing: 0.50, thick: 0.04, angle: 0, offset: 0.08,
        arrLen: 3.5, arrJust: 'centre', elemLen: 2.9, elemJust: 'centre' }] }
};
/** a v4 system list on a glazing system of the v4 shape */
export const glazingFromV4 = (win, systems) => Object.assign(GLAZING0(), win, {
  devices: systems.map(o => deviceFromV4(Object.assign({}, V4DEV0, o), win.winW, win.winH)).filter(Boolean), dev: 0 });
export function applyCase(n, st = S) {
  const p = CASES[n], keep = { storeys: [storey0()], scope: 'unit', expScope: st.expScope, wx: st.wx, sky: st.sky };
  Object.assign(st, keep, p.set, { views: [], activeView: null });
  const win = Object.assign({}, WIN, p.win || {});
  const flat = p.devices ? Object.assign(GLAZING0(), win, { devices: p.devices.map(d => Object.assign(DEVICE0(d.dir), d)), dev: 0 })
    : glazingFromV4(win, p.systems);
  st.lib = lib0();
  st.storeys[0].cells[p.f] = adoptGlazing(st, flat, 'Case window').ref;
  st.sel = { f: p.f, st: 0, unit: null };
  st.cutU = 0; st.cutV = win.sill + win.winH / 2;
}

export const describeDevice = D => deviceName(D);

/* ---------- history ----------
   Every control writes into the store, so history is a stack of snapshots of
   the design rather than a log of operations, and nothing has to know how to
   reverse itself. How a view is orbited or ghosted is not design and is not
   kept, so undo never moves the camera. The selection is kept, because the
   panel has to come back showing the condition whose figure is put back.
     A run of changes to one control is one step: while the pointer is down the
   run stays open however long the drag lasts; a run by keyboard closes after a
   second's pause or when another control is touched.                        */
export function createHistory(st = S, max = 120) {
  const H = { undo: [], redo: [], tag: '', at: -1e9, hold: false, onChange: () => { } };
  const snap = () => JSON.stringify(st);
  const restore = o => {
    const x = JSON.parse(o);
    for (const k of Object.keys(st)) if (!(k in x)) delete st[k];
    Object.assign(st, x);
  };
  H.mark = (tag, now = Date.now()) => {
    if (tag && tag === H.tag && (H.hold || now - H.at < 1000)) { H.at = now; return; }
    H.undo.push(snap());
    if (H.undo.length > max) H.undo.shift();
    H.redo.length = 0;
    H.tag = tag; H.at = now;
    H.onChange();
  };
  H.back = () => {
    if (!H.undo.length) return false;
    H.redo.push(snap()); restore(H.undo.pop()); H.tag = ''; H.onChange(); return true;
  };
  H.forward = () => {
    if (!H.redo.length) return false;
    H.undo.push(snap()); restore(H.redo.pop()); H.tag = ''; H.onChange(); return true;
  };
  H.release = () => { H.hold = false; H.tag = ''; };
  return H;
}
