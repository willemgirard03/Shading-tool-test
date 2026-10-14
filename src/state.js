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

import { clamp, doyOf, wrap180, wrap360, D2R } from './util.js';
import { GLAZING0, unitLayout, brokenUnits, buildCell, SLAB0 } from './geometry/cell.js';
import { DEVICE0, array0, arrayLen0, deviceFromV4, deviceName, lenFromWindow, memberLen, buildDevice, reachBack, HINGE_F, arrayOn, arraySpan } from './geometry/device.js';
import { arrayAnchor } from './geometry/arrays.js';
import { site0, SITE_KINDS, SITE_FIELDS, SITE_PRESETS, isStreet, siteFrame, CTX_FIELDS } from './geometry/site.js';
import { lib0, addEntry, duplicateEntry, nextName, entryName, newUnit, newSystem, flatGlazing, layoutGlazing, adoptGlazing, usage, SYSTEM_KEYS, SHGC_MAX } from './library.js';
import { arrayPositions } from './geometry/arrays.js';
import { solarPosition } from './solar.js';
import { pickSunAt } from './sunpick.js';
import { facadeLength, FACADES, facadeAzimuth, offsetIn, rotIn, storeyRot, contextPlace, contextLocal, contextAxes, contextGap, storeyCentre, CTX_DRAFT0 } from './geometry/building.js';

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
    if (rest === 'headGap') { const u = selUnitType(st); return u ? ceilingOf(st) - (u.fillH ? ceilingOf(st) : Math.min(u.sill + u.winH, ceilingOf(st))) : undefined; }
    if (rest === 'sillK' || rest === 'head') {
      const u = selUnitType(st); if (!u) return undefined;
      return rest === 'sillK' ? u.sill : u.fillH ? ceilingOf(st) : Math.min(u.sill + u.winH, ceilingOf(st));
    }
    if (rest === 'arrN' || rest === 'arrSp') { const lay = r && layoutGlazing(st, r); if (!lay) return undefined; const L = unitLayout(lay, facadeLength(st, st.sel.f, st.sel.st)); return rest === 'arrN' ? L.n : L.pitch; }
    // the windows an array, or one window alone; and whether the array is set out by number or by spacing
    if (rest === 'arrOn') { const y = selSystem(st); return !!y && !(y.winBy === 'number' && y.winN <= 1); }
    if (rest === 'arrBy') { const y = selSystem(st); return y ? y.winBy : undefined; }
    if (SYSTEM_KEYS.includes(rest)) { const y = selSystem(st); return y ? y[rest] : undefined; }
    const u = selUnitType(st); return u ? u[rest] : undefined;
  }
  if (head === 'name') { const o = nameTarget(st, rest); return o ? o.name : undefined; }
  if (head === 'shgc') return sideShgc(st, rest);
  if (head === 'site') {
    const sg = st.site || site0();
    if (rest === 'edit') return sg.edit || 'S';
    if (rest === 'ctxFrame') return sg.ctxFrame || 'building';
    if (rest === 'ctxSel') return sg.ctxSel || '';
    if (rest === 'ctxFollow') return (sg.ctxFrame || 'building') === 'building';
    const [f, fld] = rest.split('.');
    // the context building being edited - its distance to the building worked out - and the size the next one is added at
    if (f === 'k') { const c = selContext(st); return !c ? undefined : fld === 'gap' ? contextGap(st, c).d : c[fld]; }
    if (f === 'draft') return (sg.draft || CTX_DRAFT0())[fld];
    if (fld === 'curb2') return sg[f] ? sg[f].curb2 ?? sg[f].curb : undefined;
    return sg[f] ? sg[f][fld] : undefined;
  }
  if (head === 'a' && (rest === 'arrN' || rest === 'arrSp')) { const f = arrayFigures(selDevice(st)); return f ? (rest === 'arrN' ? f.n : f.sp) : undefined; }
  if (head === 'd' && rest === 'type') { const h = selShading(st), r = selCell(st); return h && h.devices.length ? h.devices[clamp(r.dev || 0, 0, h.devices.length - 1)] : ''; }
  if (head === 'd') {
    const D = selDevice(st);
    if (!D) return undefined;
    if (rest === 'lenRel') return lenFromWindow(D);
    // the member's whole length, however it is given
    if (rest === 'full') { const o = openingOf(st); return memberLen(D, D.dir === 'h' ? [o.u0, o.u1] : [o.v0, o.v1]); }
    if (rest === 'offU' || rest === 'offV') return D.offOn ? D[rest] : 0;
    // the gap between the wall and the member's nearest point, as it stands
    if (rest === 'clear') return Math.max(D.offset + (HINGE_F[D.hinge] ?? 0) * D.depth, reachBack(D)) - reachBack(D);
    // how far the turned member stands out from the wall, across its depth and thickness
    if (rest === 'proj') { const a = D.angle * D2R; return D.depth * Math.abs(Math.cos(a)) + D.thick * Math.abs(Math.sin(a)); }
    // the extension past the window, shown on its own slider
    if (rest === 'lenX') return lenFromWindow(D) && D.lenRel !== undefined ? D.len : 0;
    return D[rest];
  }
  if (head === 'a') {
    const D = selDevice(st);
    if (rest === 'on') return !!(D && D.arr);
    if (!D || !D.arr) return undefined;
    // the array's length as laid out, whether it follows the window or is its own
    if (rest === 'len') return arrayOn(D, openingOf(st)).len;
    if (rest === 'rel') return !!D.arr.rel && D.arr.along !== 'out';
    return D.arr[rest];
  }
  if (head === 'h') return st.storeys[+rest] ? st.storeys[+rest].h : undefined;
  if (k === 'plnW') return selStorey(st).w;
  if (k === 'plnD') return selStorey(st).d;
  if (k === 'sh') return selStorey(st).h;
  if (k === 'slabT') return selStorey(st).slab ?? SLAB0;
  if (k === 'surfAz') return wrap180(facadeAzimuth(st, st.sel.f, st.sel.st) - 180);
  if (k === 'plnOX') return selStorey(st).ox || 0;
  if (k === 'plnOY') return selStorey(st).oy || 0;
  if (k === 'plnRot') return selStorey(st).rot || 0;
  if (k === 'oxyIn') return selStorey(st).oxyIn || 'own';
  if (k === 'rotRel') return selStorey(st).rotRel || 'building';
  if (k === 'rotBelow') return (selStorey(st).rotRel || 'building') === 'below';
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
    /* The window's sill and head, set on the section. Moving the sill keeps the
       head where it is and the window grows or shrinks to it; moving the head
       keeps the sill; a height typed keeps the sill. The glass stays between the
       floor and the ceiling - the underside of this storey's slab. */
    if (rest === 'headGap') { setOne('g.head', ceilingOf(st) - v, st); return; }
    if (rest === 'sillK' || rest === 'head' || rest === 'winH') {
      const u = selUnitType(st); if (!u) return;
      const ceil = ceilingOf(st), head = u.fillH ? ceil : Math.min(u.sill + u.winH, ceil);
      if (rest === 'sillK') { const s = clamp(v, 0, head - 0.2); if (!u.fillH) u.winH = +(head - s).toFixed(4); u.sill = s; }
      else if (rest === 'head') { if (!u.fillH) u.winH = +(clamp(v, u.sill + 0.2, ceil) - u.sill).toFixed(4); }
      else u.winH = clamp(v, 0.2, Math.max(0.2, ceil - u.sill));
      return;
    }
    // the windows made an array - at a spacing that leaves wall between them - or one window again
    if (rest === 'arrOn') {
      const y = selSystem(st), u = selUnitType(st); if (!y) return;
      if (v) { y.winBy = 'spacing'; y.winSp = +Math.max(3, (u ? u.winW : 1.5) + 1.2).toFixed(3); }
      else { y.winBy = 'number'; y.winN = 1; }
      return;
    }
    // the array set out by number or by spacing, keeping what it has
    if (rest === 'arrBy') {
      const y = selSystem(st); if (!y || (v !== 'number' && v !== 'spacing') || y.winBy === v) return;
      const n = getValue('g.arrN', st), sp = getValue('g.arrSp', st);
      y.winBy = v; if (v === 'number') y.winN = n; else y.winSp = +sp.toFixed(3);
      return;
    }
    // the window array set on its bracket: a number of windows, or their spacing - the way it is set out follows
    if (rest === 'arrN' || rest === 'arrSp') {
      const y = selSystem(st); if (!y) return;
      const want = rest === 'arrN' ? 'number' : 'spacing';
      if (y.winBy !== want) setOne('g.winBy', want, st);
      if (rest === 'arrN') y.winN = clamp(Math.round(v), 1, 200); else y.winSp = clamp(v, 0.3, 60);
      return;
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
  if (head === 'shgc') { if (FACADES[rest] !== undefined) { st.shgc = st.shgc || {}; st.shgc[rest] = clamp(v, 0.05, SHGC_MAX); } return; }
  // the site: which side is being set, and each side's condition, setback, street width and curb
  if (head === 'site') {
    const sg = siteOf(st);
    if (rest === 'edit') { if (FACADES[v] !== undefined) sg.edit = v; return; }
    if (rest === 'ctxFrame') { contextFrame(st, v); return; }
    if (rest === 'ctxSel') { sg.ctxSel = sg.ctx.some(c => c.id === v) ? v : null; return; }
    if (rest === 'ctxFollow') { contextFrame(st, v ? 'building' : 'world'); return; }
    const [f, fld] = rest.split('.');
    if (f === 'k' && fld === 'gap') { const c = selContext(st); if (c) contextToGap(st, c, Math.max(0, v)); return; }
    if (f === 'k' && (fld === 'w' || fld === 'd' || fld === 'h' || fld === 'a')) {
      const c = selContext(st);
      if (!c) return;
      if (fld === 'a') { const da = wrap180(v - c.a); for (const m of contextGroup(st, c.id)) if (m === c || c.inheritRot) m.a = wrap180(m.a + da); return; }
      for (const m of contextGroup(st, c.id)) m[fld] = clamp(v, CTX_FIELDS[fld][0], CTX_FIELDS[fld][1]);
      return;
    }
    if (f === 'k' || f === 'draft') {
      const o = f === 'k' ? selContext(st) : (sg.draft || (sg.draft = CTX_DRAFT0())), r = CTX_FIELDS[fld];
      if (o && r) o[fld] = fld === 'a' ? wrap180(v) : clamp(v, r[0], r[1]);
      return;
    }
    if (!sg[f]) return;
    if (fld === 'kind') { if (SITE_KINDS[v]) { sg[f].kind = v; if (v === 'lane' && sg[f].width > 12) { sg[f].width = 6; sg[f].curb = 0; } if (v === 'street' && sg[f].width < 10) { sg[f].width = 20; sg[f].curb = 3; } } return; }
    const r = SITE_FIELDS[fld];
    if (r) sg[f][fld] = clamp(v, r[0], fld === 'curb' || fld === 'curb2' ? Math.min(r[1], sg[f].width) : r[1]);
    return;
  }
  // a shading array set on its bracket: a number of members, or their spacing - the way it is set out follows
  if (head === 'a' && (rest === 'arrN' || rest === 'arrSp')) {
    const D = selDevice(st); if (!D || !D.arr) return;
    const want = rest === 'arrN' ? 'count' : 'spacing';
    if (D.arr.mode !== want) switchArrayMode(D, want, st);
    if (rest === 'arrN') D.arr.count = clamp(Math.round(v), 1, 200); else D.arr.spacing = clamp(v, 0.02, 3);
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
    if (rest === 'offU' || rest === 'offV') { if (!D.offOn) { D.offOn = true; D.offU = 0; D.offV = 0; } D[rest] = v; return; }
    // the justification turned: the device stays where it is, and holds the new end from now on
    if (rest === 'justU' || rest === 'justV') { justKeep(st, D, rest.slice(4), v); return; }
    // aligned to the window: a move, once - the outermost hinge, or the member's end, onto the window's edge or middle
    if (rest === 'alignU' || rest === 'alignV') { alignTo(st, D, rest.slice(5), v); return; }
    // the hinge moved along the depth: the member stays, and turns about the new line
    if (rest === 'hinge') { hingeKeep(D, v); return; }
    // the gap to the wall typed as it stands: the offset takes the difference
    if (rest === 'clear') { D.offset = Math.max(0, +(D.offset + Math.max(0, v) - getValue('d.clear', st)).toFixed(6)); return; }
    // the projection typed: the depth that, turned as it is, stands that far out
    if (rest === 'proj') { const a = D.angle * D2R; D.depth = Math.max(0.02, +((v - D.thick * Math.abs(Math.sin(a))) / Math.max(0.05, Math.abs(Math.cos(a)))).toFixed(4)); return; }
    // measured from the window or outright: the member keeps its length across the switch
    if (rest === 'lenRel') {
      const o = openingOf(st), dim = D.dir === 'h' ? o.u1 - o.u0 : o.v1 - o.v0, was = lenFromWindow(D);
      const L = was ? dim + (D.lenRel === undefined ? 0 : D.len || 0) : D.len;
      if (v && !was) D.len = +(L - dim).toFixed(4);
      if (!v && was) D.len = +Math.max(0.05, L).toFixed(4);
      D.lenRel = !!v; return;
    }
    if (rest === 'lenX') { D.lenRel = true; D.len = v; return; }
    // a whole length typed or dragged: kept as an extension past the window when the member follows the window
    if (rest === 'full') {
      const o = openingOf(st), dim = D.dir === 'h' ? o.u1 - o.u0 : o.v1 - o.v0, L = Math.max(0.05, v);
      if (lenFromWindow(D)) { D.lenRel = true; D.len = +(L - dim).toFixed(4); } else D.len = L;
      return;
    }
    if (rest === 'len') { D.lenRel = false; D.len = v; return; }
    if (rest === 'dir' && v !== D.dir) {
      // turning a member swaps which of its justifications its array rides on,
      // so the array is laid out afresh along the new axis
      D.dir = v;
      if (D.arr) D.arr.len = D.arr.rel && D.arr.along !== 'out' ? 0 : arrayLen0(D, openingOf(st), D.arr.along === 'out');
      if (D.arr && D.arr.along === 'facade' && v === 'v') D.arr.spacing = Math.max(D.arr.spacing, 0.3);
      return;
    }
    D[rest] = v; return;
  }
  // the array switched on - starting from the window's own length, at the member's default spacing - or off
  if (head === 'a' && rest === 'on') {
    const D = selDevice(st); if (!D) return;
    if (v && !D.arr) D.arr = Object.assign(array0(D, openingOf(st)), { rel: true, len: 0 });
    if (!v) D.arr = null;
    return;
  }
  if (head === 'a') {
    const D = selDevice(st); if (!D || !D.arr) return;
    const o = openingOf(st), follows = D.arr.rel && D.arr.along !== 'out';
    // a length dragged or typed is kept as what it runs past the window, while the array follows the window
    if (rest === 'len') { const L = Math.max(0, v); D.arr.len = follows ? +(L - arraySpan(D, o)).toFixed(6) : L; return; }
    // following the window, or not: the array keeps the length it has
    if (rest === 'rel') { const L = arrayOn(D, o).len; D.arr.rel = !!v; D.arr.len = v ? +(L - arraySpan(D, o)).toFixed(6) : L; return; }
    if (rest === 'along' && v !== D.arr.along) {
      D.arr.along = v;
      D.arr.len = D.arr.rel && v !== 'out' ? 0 : arrayLen0(D, openingOf(st), v === 'out');
      // a pitch equal to the blade depth makes a solid plate when run outward
      if (v === 'out' && D.arr.spacing <= D.depth + 1e-6) D.arr.spacing = Math.min(2, Math.max(0.05, D.depth * 1.6));
      return;
    }
    if (rest === 'mode' && v !== D.arr.mode) { switchArrayMode(D, v, st); return; }
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
  // turning with the floor below, or with the building: a run of floors each turned on the one below twists
  if (k === 'rotBelow') { setOne('rotRel', v ? 'below' : 'building', st); return; }
  // the building's north offset turns every storey measured from it, and those measured from them
  if (k === 'rot') { st.rot = wrap180(v); return; }
  // the selected side's surface azimuth typed: the whole building turns by the difference
  if (k === 'surfAz') { st.rot = wrap180((st.rot || 0) + wrap180(v - getValue('surfAz', st))); return; }
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
/* A device's offset along an axis of the facade, switched on when first used. */
function addOff(D, ax, dv) {
  if (!D.offOn) { D.offOn = true; D.offU = 0; D.offV = 0; }
  D['off' + ax] = +((D['off' + ax] || 0) + dv).toFixed(6);
}
/* What a device sets out along an axis: the array along the facade on the
   axis it runs, the member's own length on the other. */
function axisRun(st, D, ax) {
  const o = openingOf(st), span = ax === 'U' ? [o.u0, o.u1] : [o.v0, o.v1], dir = ax === 'U' ? 1 : -1;
  const arrAx = D.dir === 'h' ? 'V' : 'U';
  const len = ax === arrAx ? (D.arr && D.arr.along !== 'out' ? Math.max(0, arrayOn(D, o).len) : 0) : memberLen(D, span);
  return { o, span, dir, len, arrAx };
}
function justKeep(st, D, ax, v) {
  const { span, dir, len } = axisRun(st, D, ax);
  addOff(D, ax, arrayAnchor(span, dir, len, D['just' + ax]) - arrayAnchor(span, dir, len, v));
  D['just' + ax] = v;
}
function alignTo(st, D, ax, where) {
  const { o, arrAx } = axisRun(st, D, ax), ai = ax === 'U' ? 0 : 1;
  const bs = buildDevice(D, { u0: o.u0, u1: o.u1, v0: o.v0, v1: o.v1, reveal: 0 });
  if (!bs.length) return;
  // on the array's own axis the members' hinge lines; across it, the member's ends
  const xs = ax === arrAx ? bs.map(b => b.anchor) : bs.flatMap(b => { const hl = D.dir === 'h' ? b.h[0] : b.h[1]; return [b.c[ai] - hl, b.c[ai] + hl]; });
  const lo = Math.min(...xs), hi = Math.max(...xs), w0 = ax === 'U' ? o.u0 : o.v0, w1 = ax === 'U' ? o.u1 : o.v1;
  // left and top are the start of their axes, as the justification words have them
  const to = where === 'centre' ? (w0 + w1) / 2 - (lo + hi) / 2
    : (where === 'start') === (ax === 'U') ? w0 - lo : w1 - hi;
  addOff(D, ax, to);
}
function hingeKeep(D, v) {
  const f0 = HINGE_F[D.hinge] ?? 0, f1 = HINGE_F[v] ?? 0, a = D.angle * D2R, d = D.depth;
  // the member's middle sits (0.5 - f) of its depth from its hinge, along the turned depth
  const along = D.dir === 'h' ? -Math.sin(a) : Math.sin(a), ax = D.dir === 'h' ? 'V' : 'U';
  D.offset = Math.max(0, +(D.offset - d * (f1 - f0) * (1 - Math.cos(a))).toFixed(6));
  if (Math.abs(a) > 1e-9) addOff(D, ax, -d * (f0 - f1) * along);
  D.hinge = v;
}
function switchArrayMode(D, v, stt = S) {
  const A = D.arr, o = openingOf(stt), E = arrayOn(D, o), just = A.along === 'out' ? 'start' : D.dir === 'h' ? D.justV : D.justU;
  const p = arrayPositions(E, [0, 0], 1, just), n = p.length, follows = A.rel && A.along !== 'out';
  if (v === 'count') {
    const st = p.slice(1).map((x, i) => x - p[i]), even = st.every(x => Math.abs(x - st[0]) < 1e-6);
    A.count = n;
    if (n > 1 && even) { const L = +(st[0] * (n - 1)).toFixed(6); A.len = follows ? +(L - arraySpan(D, o)).toFixed(6) : L; }
  } else if (n > 1 && E.len > 1e-9) A.spacing = +(E.len / (n - 1)).toFixed(6);
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
const STOREY_KEYS = { sh: ['h', 2.4, 8], slabT: ['slab', 0, 2], plnW: ['w', 4, 200], plnD: ['d', 4, 200], plnOX: ['ox', -200, 200], plnOY: ['oy', -200, 200], plnRot: ['rot', -180, 180] };
/* The selected storey's floorplate set from the site view: its size, where
   its middle stands in the world, and its turn from true north. The offset is
   written along the building's axes from then on, so floors matched above
   stack over it however each is turned; the turn is written from what the
   floor turns with (the building, or the floor below). With Match floors
   above on, the floors above take the same figures - turned on the floor
   below, a stack of them twists. */
export function plateTo(st, o) {
  const i0 = clamp(st.sel.st, 0, st.storeys.length - 1), i1 = st.matchAbove.plate ? st.storeys.length - 1 : i0, p = st.storeys[i0];
  const set = (f, x) => { const [, lo, hi] = Object.values(STOREY_KEYS).find(s => s[0] === f); for (let i = i0; i <= i1; i++) st.storeys[i][f] = f === 'rot' ? wrap180(x) : clamp(x, lo, hi); };
  if (o.w !== undefined) set('w', o.w);
  if (o.d !== undefined) set('d', o.d);
  if (o.h !== undefined) set('h', o.h);
  if (o.a !== undefined) set('rot', o.a - (storeyRot(st, i0) - (p.rot || 0)));
  const r = (st.rot || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  const placeAt = (i, C) => { const q = st.storeys[i]; q.oxyIn = 'building'; q.ox = C[0] * c - C[1] * s; q.oy = C[0] * s + C[1] * c; };
  if (o.C && i0 === 0) {
    // the ground floor stays centred on the site: what would move it moves the floors above it the
    // other way - those not matched to it - and the massing that follows the building, so all of
    // them keep their place against the side that did not move
    const C0 = storeyCentre(st, 0), sh = [o.C[0] - C0[0], o.C[1] - C0[1]];
    if (Math.hypot(sh[0], sh[1]) > 1e-12) {
      for (let i = i1 + 1; i < st.storeys.length; i++) { const Ci = storeyCentre(st, i); placeAt(i, [Ci[0] - sh[0], Ci[1] - sh[1]]); }
      if (st.site && st.site.ctx && (st.site.ctxFrame || 'building') === 'building')
        for (const k of st.site.ctx) { const p = contextPlace(st, k), L = contextLocal(st, [p.C[0] - sh[0], p.C[1] - sh[1]]); k.x = L[0]; k.y = L[1]; }
    }
  } else if (o.C) {
    for (let i = i0; i <= i1; i++) placeAt(i, o.C);
  }
  return true;
}
/** a site to start from; the context massing and the side being set are kept */
export function applySitePreset(key, st = S) {
  const p = SITE_PRESETS[key];
  if (!p) return false;
  const sg = siteOf(st);
  Object.assign(sg, p.make());
  return true;
}
/** every side's condition handed on to the next side round, clockwise: north's to east, east's to south... */
export function rotateSite(st = S) {
  const sg = siteOf(st), o = { N: sg.N, E: sg.E, S: sg.S, W: sg.W };
  sg.E = o.N; sg.S = o.E; sg.W = o.S; sg.N = o.W;
  return true;
}
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
/** a blank storey - no glazing - the size of the selected one, put directly above it or directly below; it becomes the selected storey */
export function insertStorey(where = 'above', st = S) {
  if (st.storeys.length >= STOREYS_MAX) return false;
  const p = selStorey(st), at = st.sel.st + (where === 'below' ? 0 : 1);
  st.storeys.splice(at, 0, storey0(p.h, p.w, p.d, p.ox || 0, p.oy || 0, p.rot || 0, p.oxyIn || 'own', p.rotRel || 'building', p.slab ?? SLAB0));
  for (const v of st.views || []) if (v.st >= at) v.st++;
  st.sel.st = at; st.sel.unit = null;
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
/** what nothing in the design uses any more, dropped: what the user keeps is saved apart */
export function prune(st = S) {
  for (const kind of ['systems', 'units', 'shading', 'devices']) {
    const used = usage(st);
    for (const id of Object.keys(st.lib[kind])) if (!used[id] && st.lib[kind][id].auto) delete st.lib[kind][id];
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
/** a window in the middle of each side of the selected storey, each its own system so each side changes alone */
export function windowEachSide(st = S) {
  const f0 = st.sel.f;
  // each named for its side
  for (const f of Object.keys(FACADES)) { st.sel.f = f; if (addWindow(st)) { const y = st.lib.systems[selStorey(st).cells[f].sys]; if (y) { y.name = f + ' window'; y.auto = false; const u = st.lib.units[y.unit]; if (u) { u.name = f + ' window'; u.auto = false; } } } }
  st.sel.f = f0; st.sel.unit = null;
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
/** one window on the selected side, in the middle of it - an array is made of it from its window */
export const addWindow = andAbove(function addWindow(st = S) {
  const s = selStorey(st);
  if (s.cells[st.sel.f]) return false;
  const g = GLAZING0(), top = s.h - (s.slab ?? SLAB0);
  Object.assign(g, { winW: 1.5, winH: 1.8, winBy: 'number', winN: 1 });
  g.shgc = Math.min(g.shgc, SHGC_MAX);
  if (g.sill + g.winH > top) g.winH = Math.max(0.6, top - g.sill);
  s.cells[st.sel.f] = adoptGlazing(st, g, nextName(st, 'systems', 'Window')).ref;
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
  if (!h) { const id = addEntry(st, 'shading', { name: nextName(st, 'shading', 'Shading group') }); setOne('g.shd', id, st); h = st.lib.shading[id]; }
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

/* ---------- the library: what the user saves, linked wherever it is used ----------
   A shading device, a shading group - the devices a window carries - and a
   window group - a side's window system and its glass - can each be saved to
   the library under the name it already has. Saved, it is offered wherever
   such a thing can be added; added, it is the same thing, linked: an edit to
   it anywhere is an edit everywhere it is used, and the library keeps it as it
   now is. A copy, named apart, is the way to change one use alone. */
const KIND_OF = { device: 'devices', group: 'shading', window: 'systems' };
function entryHere(kind, st) { return kind === 'device' ? selDevice(st) : kind === 'group' ? selShading(st) : kind === 'window' ? selSystem(st) : null; }
/** is the selected device, group or window group in the library */
export const isSaved = (kind, st = S) => { const e = entryHere(kind, st); return !!(e && e.saved); };
/** the name a copy is offered: "Name - Copy 01", the first number free */
export function copyName(kind, st = S) {
  const e = entryHere(kind, st);
  if (!e) return '';
  const lk = KIND_OF[kind], base = String(e.name || defaultName(lk, e)).replace(/ - Copy \d+$/, ''), taken = new Set(Object.values(st.lib[lk]).map(o => o.name));
  for (let n = 1; ; n++) { const t = base + ' - Copy ' + String(n).padStart(2, '0'); if (!taken.has(t)) return t; }
}
/** every use of one entry made a use of another */
function repoint(st, lk, from, to) {
  for (const s of st.storeys) for (const r of Object.values(s.cells)) {
    if (!r || r.sys === undefined) continue;
    if (lk === 'systems' && r.sys === from) r.sys = to;
    if (lk === 'shading') { if (r.shd === from) r.shd = to; for (const b of Object.values(r.brokenShd || {})) if (b.shd === from) b.shd = to; }
  }
  if (lk === 'devices') for (const h of Object.values(st.lib.shading)) h.devices = h.devices.map(d => d === from ? to : d);
}
/** the selected device, group or window group saved under its name; one saved under that name before gives way to it, its uses taking this one */
export function saveEntry(kind, st = S) {
  const e = entryHere(kind, st), lk = KIND_OF[kind];
  if (!e) return false;
  for (const o of Object.values(st.lib[lk])) if (o !== e && o.saved && o.name === e.name) { repoint(st, lk, o.id, e.id); delete st.lib[lk][o.id]; }
  e.saved = true; e.auto = false;
  return true;
}
/** taken out of the library: still used where it is, but no longer offered */
export function deleteSaved(lk, id, st = S) {
  const o = st.lib[lk] && st.lib[lk][id];
  if (!o) return false;
  o.saved = false; prune(st);
  return true;
}
/** a copy of the selected device, group or window group, under a name of its own, used here in its place */
export const copyEntry = andAbove(function copyEntry(kind, name, st = S) {
  const r = selCell(st), e = entryHere(kind, st);
  if (!r || !e || !name) return false;
  if (kind === 'device') {
    const h = selShading(st);
    h.devices[clamp(r.dev || 0, 0, h.devices.length - 1)] = duplicateEntry(st, 'devices', e.id, name);
  } else if (kind === 'group') {
    const nid = duplicateEntry(st, 'shading', e.id, name), b = r.brokenShd && r.brokenShd[selUnitIndex(st)];
    if (b) b.shd = nid; else r.shd = nid;
  } else {
    const nid = duplicateEntry(st, 'systems', e.id, name), y = st.lib.systems[nid];
    if (st.lib.units[y.unit]) y.unit = duplicateEntry(st, 'units', y.unit, st.lib.units[y.unit].name);
    r.sys = nid;
  }
  return true;
});
/** a saved window group on the selected side, linked */
export const addSavedWindow = andAbove(function addSavedWindow(id, st = S) {
  if (!st.lib.systems[id]) return false;
  useSystemOn(st, id);
  return true;
});
/** shading added to the selected window: new devices, a preset's, a saved device
 *  (linked), or a saved shading group - linked as a whole where the window has
 *  none yet, its devices linked one by one where it has */
export const addShading = andAbove(function addShading(what, st = S) {
  const r = selCell(st), g = selGlazing(st);
  if (!r || !g) return false;
  const k = String(what).slice(0, String(what).indexOf(':')), id = String(what).slice(String(what).indexOf(':') + 1);
  let devs = [], ids = [];
  if (k === 'new') devs = [DEVICE0(id === 'v' ? 'v' : 'h')];
  else if (k === 'pre' && SHADING_PRESETS[id]) {
    const o = openingOf(st), run = o.u1 - o.u0 >= unitLayout(g, facadeLength(st, st.sel.f, st.sel.st)).pitch - 1e-9;
    devs = SHADING_PRESETS[id].make(o, run, selStorey(st).h);
  }
  else if (k === 'dev' && st.lib.devices[id]) ids = [id];
  else if (k === 'grp' && st.lib.shading[id]) {
    const h0 = selShading(st);
    if (!h0 || !h0.devices.length) { setOne('g.shd', id, st); r.dev = 0; return true; }
    ids = st.lib.shading[id].devices.slice();
  }
  if (!devs.length && !ids.length) return false;
  const h = shadingHere(st);
  if (h.devices.length + devs.length + ids.length > DEVICES_MAX) return false;
  const first = h.devices.length;
  for (const D of devs) h.devices.push(addEntry(st, 'devices', D));
  for (const d of ids) h.devices.push(d);
  r.dev = first;
  return true;
});

/** the underside of the selected storey's slab, above its floor: the highest a window's head can go */
export function ceilingOf(st = S) { const p = selStorey(st); return p.h - (p.slab ?? SLAB0); }
/** a shading array's number of members and their spacing, as its bracket reads them */
export function arrayFigures(D, g = openingOf()) {
  const A = arrayOn(D, g);
  if (!A) return null;
  const just = A.along === 'out' ? 'start' : D.dir === 'h' ? D.justV : D.justU, p = arrayPositions(A, [0, 0], 1, just);
  // set out by spacing, that is the spacing - the first gap of a centred array can be the remainder
  return { n: p.length, sp: A.mode === 'count' ? (p.length > 1 ? A.len / (p.length - 1) : A.spacing) : A.spacing };
}

/* ---------- SHGC, side by side ----------
   One SHGC for all the glass of a side, on every storey: typed on its facade
   in the site view. Until it is typed, a side reads what its glass has. */
export function sideShgc(st, f) {
  if (st.shgc && st.shgc[f] !== undefined) return st.shgc[f];
  for (const s of st.storeys) { const g = s.cells[f] && flatGlazing(st, s.cells[f]); if (g) return g.shgc ?? SHGC_MAX; }
  return SHGC_MAX;
}

/* ---------- context buildings ----------
   Added at the size set for the next one, where the site view is clicked (or,
   with no site view on the page, just south of the site), square to the axes
   they are read in; then moved, turned and resized by their own controls. */
/** the site, with every field it has now - a design made before context buildings has none of theirs */
export function siteOf(st = S) {
  if (!st.site) st.site = site0();
  const d = site0();
  for (const k of ['ctx', 'ctxFrame', 'ctxSel', 'ctxSeq', 'draft', 'grpSeq']) if (st.site[k] === undefined) st.site[k] = d[k] ?? 0;
  return st.site;
}
export const selContext = (st = S) => { const sg = st.site; return sg && sg.ctx ? sg.ctx.find(c => c.id === sg.ctxSel) || null : null; };
/** a context building added with its centre at a point in the world (or, given none, south of the site); returns its id */
export function addContextAt(P, st = S) {
  const sg = siteOf(st), dr = sg.draft || CTX_DRAFT0();
  if (!P) { const SF = siteFrame(st); P = SF.toW(0, SF.y0 - dr.d / 2 - 12); }
  const L = contextLocal(st, P), id = 'k' + (++sg.ctxSeq);
  sg.ctx.push({ id, w: dr.w, d: dr.d, h: dr.h, x: +L[0].toFixed(2), y: +L[1].toFixed(2), a: 0 });
  sg.ctxSel = id;
  return id;
}
/** a copy of a context building, in the same place, selected - its own, not an instance; returns its id */
export function duplicateContext(id, st = S) {
  const sg = siteOf(st), c = sg.ctx.find(x => x.id === id);
  if (!c) return null;
  const nid = 'k' + (++sg.ctxSeq), cp = Object.assign({}, c, { id: nid });
  delete cp.grp; delete cp.inheritRot;
  sg.ctx.push(cp);
  sg.ctxSel = nid;
  return nid;
}

/* ---------- instances ----------
   Massings made instances of one another share a group (grp). A face pushed
   or pulled on one is pushed or pulled on every one - the same face, by the
   same amount, each in its own axes, so each grows the same way from where it
   stands; a size typed is typed on all. Where each stands is its own. A turn
   is its own too, unless the one turned passes its turns on (inheritRot, off
   at first, set instance by instance): then the others turn by as much, each
   about its own middle. Made unique, a massing leaves its group; a group of
   one is no group. */
export const contextGroup = (st, id) => {
  const sg = siteOf(st), c = sg.ctx.find(x => x.id === id);
  return !c ? [] : c.grp ? sg.ctx.filter(x => x.grp === c.grp) : [c];
};
/** a massing made an instance of another: the two share the other's group, or a new one */
export function instanceContext(st, fromId, id) {
  const sg = siteOf(st), a = sg.ctx.find(x => x.id === fromId), b = sg.ctx.find(x => x.id === id);
  if (!a || !b || a === b) return false;
  if (!a.grp) a.grp = 'g' + (++sg.grpSeq);
  b.grp = a.grp; b.inheritRot = false;
  for (const k of ['w', 'd', 'h']) b[k] = a[k];
  return true;
}
export function makeUnique(st, id) {
  const sg = siteOf(st), c = sg.ctx.find(x => x.id === id);
  if (!c || !c.grp) return false;
  const g = c.grp;
  delete c.grp; c.inheritRot = false;
  const rest = sg.ctx.filter(x => x.grp === g);
  if (rest.length === 1) { delete rest[0].grp; rest[0].inheritRot = false; }
  return true;
}
/** where every massing of a group stands, as a drag begins: id -> { C, a, w, d, h } in the world */
export function contextSnaps(st, id) {
  const out = {};
  for (const c of contextGroup(st, id)) { const p = contextPlace(st, c); out[c.id] = { C: p.C.slice(), a: p.a, w: c.w, d: c.d, h: c.h }; }
  return out;
}
/** a face of one massing moved to make its size dim, and the same face of every instance, each in its own axes, from where they stood at snaps */
export function pullContext(st, id, key, dim, snaps) {
  const k = key === 'top' ? 'h' : key[1] === 'x' ? 'w' : 'd', s0 = snaps[id];
  if (!s0) return;
  const dt = dim - s0[k];
  for (const [mid, s] of Object.entries(snaps)) {
    let C = s.C;
    if (k !== 'h') {
      const r = s.a * D2R, ax = key[1] === 'x' ? [Math.cos(r), -Math.sin(r)] : [Math.sin(r), Math.cos(r)], sg = key[0] === '+' ? 1 : -1;
      C = [s.C[0] + sg * ax[0] * dt / 2, s.C[1] + sg * ax[1] * dt / 2];
    }
    putContext(st, mid, C, s.a, { [k]: s[k] + dt });
  }
}
/** one massing turned to aWorld about its middle, and - if it passes its turns on - every instance by as much, from where they stood at snaps */
export function turnContext(st, id, aWorld, snaps) {
  const sg = siteOf(st), c = sg.ctx.find(x => x.id === id), s0 = snaps[id];
  if (!c || !s0) return;
  const da = aWorld - s0.a;
  for (const [mid, s] of Object.entries(snaps)) if (mid === id || c.inheritRot) putContext(st, mid, s.C, s.a + da);
}
export function removeContext(id, st = S) {
  const sg = siteOf(st), n = sg.ctx.length;
  sg.ctx = sg.ctx.filter(c => c.id !== id);
  if (sg.ctxSel === id) sg.ctxSel = null;
  return sg.ctx.length < n;
}
/** a context building set from where it stands in the world: its centre, its turn from true north, and its size */
export function putContext(st, id, C, aWorld, dims) {
  const sg = siteOf(st), c = sg.ctx.find(x => x.id === id);
  if (!c) return false;
  const L = contextLocal(st, C);
  c.x = L[0]; c.y = L[1]; c.a = wrap180(aWorld - contextAxes(st).a);
  if (dims) for (const k of ['w', 'd', 'h']) if (dims[k] !== undefined) c[k] = clamp(dims[k], CTX_FIELDS[k][0], CTX_FIELDS[k][1]);
  return true;
}
/* A distance to the building typed for a context building: it is moved
   straight toward or away from the building - along the line of its nearest
   approach, or, where it overlaps, from the building's middle - until the
   nearest point is that far. The nearest point can change as it moves, so the
   step is taken again until it settles. */
function contextToGap(st, c, want) {
  for (let i = 0; i < 6; i++) {
    const g = contextGap(st, c), p = contextPlace(st, c);
    if (Math.abs(g.d - want) < 1e-4) return;
    let dir = g.d > 1e-6 ? [g.a[0] - g.b[0], g.a[1] - g.b[1]] : (C0 => [p.C[0] - C0[0], p.C[1] - C0[1]])(storeyCentre(st, 0));
    const n = Math.hypot(dir[0], dir[1]) || 1, s = want - g.d;
    dir = n > 1e-9 ? [dir[0] / n, dir[1] / n] : [0, -1];
    putContext(st, c.id, [p.C[0] + dir[0] * s, p.C[1] + dir[1] * s], p.a);
  }
}

/* Following the building, or locked to true north: switched, every context
   building keeps where it stands in the world - its figures are re-read in
   the new axes - and from then on follows (or does not follow) what the
   building does. */
export function contextFrame(st, mode) {
  const sg = siteOf(st), to = mode === 'world' ? 'world' : 'building';
  if ((sg.ctxFrame || 'building') === to) return;
  const aTo = contextAxes(st, to).a;
  for (const c of sg.ctx) {
    const p = contextPlace(st, c), L = contextLocal(st, p.C, to);
    c.x = L[0]; c.y = L[1]; c.a = wrap180(p.a - aTo);
  }
  sg.ctxFrame = to;
}

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
/** the ideal members as one device: blades from the head, or fins from the jamb the sun comes from */
export function idealDevice(spec) {
  const r4 = x => +x.toFixed(4), h = spec.dir === 'h', n = Math.round(spec.n);
  // upright members standing on the head, out from the facade: the first one spacing off the wall, the rest stepping out
  if (spec.out) {
    const D = Object.assign(DEVICE0('h'), { name: 'Upright members', depth: r4(spec.d), thick: IDEAL_THICK, angle: -90, hinge: 'start',
      justV: 'start', justU: 'centre', offset: r4(spec.pitch), lenRel: true, len: r4(Math.max(0, spec.ext || 0)) });
    if (n > 1) D.arr = { along: 'out', mode: 'count', count: n, spacing: r4(spec.pitch), len: r4((n - 1) * spec.pitch), ends: true };
    return D;
  }
  const D = Object.assign(DEVICE0(h ? 'h' : 'v'), { name: h ? (n === 1 ? 'Overhang' : 'Horizontal louvres') : (n === 1 ? 'Fin' : 'Vertical fins'),
    depth: r4(spec.d), thick: IDEAL_THICK, lenRel: true, len: r4(Math.max(0, spec.ext || 0)) },
    h ? { justV: 'start', justU: 'centre' } : { justU: spec.side === 'end' ? 'end' : 'start', justV: 'end' });
  if (n > 1) D.arr = { along: 'facade', mode: 'count', count: n, spacing: r4(spec.pitch), len: r4((n - 1) * spec.pitch), ends: true };
  return D;
}
/* Live optimization: the recommendations' ideal put on a window and kept to
   the moment set. While it is on, the window carries the ideal members -
   horizontal, vertical or both - remade as the date and the time change, in a
   shading group of their own in place of what it carried; turned off, the last
   of them stays, as ordinary shading. It stays with the window it was turned
   on for: turned on for another, it moves there. */
export function liveToggle(dir, st = S) {
  const r = selCell(st);
  if (!r || !selGlazing(st)) return false;
  const L = st.live, here = L && L.f === st.sel.f && L.st === st.sel.st;
  if (L && !here) liveOff('keep', st);
  if (!st.live) {
    // what the window carried, kept, so that turning the optimization off can put it back
    const prev = selShadingId(st) || null;
    const id = addEntry(st, 'shading', { name: nextName(st, 'shading', 'Optimized shading'), devices: [], auto: true });
    setOne('g.shd', id, st);
    st.live = { f: st.sel.f, st: st.sel.st, unit: st.sel.unit, shd: id, prev, h: false, v: false, c: false, dev: {} };
    matchAbove(st);
  }
  st.live[dir] = !st.live[dir];
  if (!st.live.h && !st.live.v && !st.live.c) liveOff('keep', st);
  return true;
}
/** what the optimization puts on the window: 'h' horizontal, 'v' vertical, 'hv' both, 'c' a louvred canopy of upright members */
export function liveSetKind(kind, st = S) {
  const L = st.live;
  if (!L || !['h', 'v', 'hv', 'c'].includes(kind)) return false;
  L.h = kind === 'h' || kind === 'hv'; L.v = kind === 'v' || kind === 'hv'; L.c = kind === 'c';
  return true;
}
export const liveKind = L => L ? (L.c ? 'c' : L.h && L.v ? 'hv' : L.v ? 'v' : 'h') : null;
/** the optimization turned off: 'revert' puts back what the window carried before; 'keep' leaves the last of it as ordinary shading, under the name given */
export function liveOff(mode = 'keep', st = S, name = null) {
  const L = st.live;
  if (!L) return false;
  st.live = null;
  if (mode === 'revert') {
    const sel0 = st.sel;
    st.sel = { f: L.f, st: L.st, unit: L.unit };
    setOne('g.shd', L.prev && st.lib.shading[L.prev] ? L.prev : '', st);
    matchAbove(st);
    st.sel = sel0;
  } else {
    const h = st.lib.shading[L.shd];
    if (h) {
      h.auto = false;
      if (name) h.name = nextName(st, 'shading', name);
      h.devices.forEach(d => {
        const D = st.lib.devices[d];
        if (!D) return;
        D.auto = false;
        if (name) D.name = nextName(st, 'devices', h.devices.length > 1 ? name + (D.dir === 'v' ? ' - vertical' : ' - horizontal') : name);
      });
    }
  }
  prune(st);
  return true;
}
/** the live members written for the moment: { h, v } specs as the recommendations work them out, null where there is none */
export function liveApply(specs, st = S) {
  const L = st.live, h = L && st.lib.shading[L.shd];
  if (!h) { st.live = null; return false; }
  const devs = [];
  for (const dir of ['h', 'v', 'c']) {
    if (!L[dir] || !specs[dir] || !(specs[dir].d > 0)) continue;
    const D = Object.assign(idealDevice(specs[dir]), { auto: true });
    let id = L.dev[dir];
    if (!id || !st.lib.devices[id]) id = L.dev[dir] = addEntry(st, 'devices', D);
    else { const keep = st.lib.devices[id]; for (const k of Object.keys(keep)) if (k !== 'id') delete keep[k]; Object.assign(keep, D, { id }); }
    devs.push(id);
  }
  h.devices = devs;
  return true;
}
export const shadingFromIdeal = andAbove(function shadingFromIdeal(spec, name, st = S) {
  if (!selGlazing(st) || !selCell(st) || !(spec && spec.d > 0 && spec.n >= 1)) return false;
  const D = idealDevice(spec);
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
  N: { kind: 'property', off: 3, width: 6, curb: 0 }, W: { kind: 'lane', off: 1.5, width: 6, curb: 0 },
  // across each street, a building that shades it: a 22 m slab across the narrow street, a low block across the wide one
  ctx: [{ id: 'k1', w: 16, d: 30, h: 22, x: 38, y: 0, a: 0 }, { id: 'k2', w: 40, d: 14, h: 9, x: 0, y: -41, a: 0 }], ctxSeq: 2, ctxFrame: 'building', ctxSel: null };
export const TYPOLOGIES = {
  blank: { label: 'Default', sub: 'one storey, a window each side', about: 'A single 3.6 m storey on a 30 × 18 m floorplate, a 1.5 × 1.8 m window in the middle of each side and no shading: build it up yourself.', each: true, plnW: 30, plnD: 18, runs: [[1, 3.6, 0.3, null]], st: 0 },
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
  demo: { label: 'Stress test: mixed site', sub: 'two streets · podium · overhang', about: 'Every condition at once, kept to six storeys: a three-storey podium on a 20 m street (south) and an 8 m street (east), an adjoining property (north) and a lane (west); a tower stepped back above it, its top storey overhanging the one below. The same 900 mm canopy runs over every podium window on both streets - too deep at grade, fine higher up, and the narrow street stricter than the wide one. Curtain wall and punched windows both, and a building across each street that shades it.',
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
    const s = storey0(h, p.w, p.d, p.ox, p.oy, 0, 'building', 'building', slab);
    if (g) for (const gg of [].concat(g)) for (const f of gg.sides) s.cells[f] = refOf(gg.recipe);
    st.storeys.push(s);
  }
  if (t.each) { st.sel = { f: 'S', st: 0, unit: null }; st.matchAbove.sides = false; windowEachSide(st); }
  // a building of many storeys starts with its windows and shading carried up its floors
  st.matchAbove.glazing = st.storeys.length > 1;
  // each side takes the SHGC most of its storeys' glass has
  st.shgc = {};
  for (const f of Object.keys(FACADES)) {
    const n = new Map();
    for (const s of st.storeys) { const g = s.cells[f] && flatGlazing(st, s.cells[f]); if (g) n.set(g.shgc, (n.get(g.shgc) || 0) + 1); }
    if (n.size) st.shgc[f] = [...n.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  // a typology that brings its site sets it; the others leave the site as it was
  if (t.site) st.site = Object.assign(site0(), JSON.parse(JSON.stringify(t.site)));
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
