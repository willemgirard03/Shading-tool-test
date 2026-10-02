/* The regression suite. Run:  node test/verify.mjs   (or npm test)

   1  golden master: a v4 system, rebuilt as members and arrays, gives v4's
      boxes and every one of v4's studies exactly
   2  closed form: array set-out, the hinge, the reveal and the slab edge, the
      wall tiling each glazing type, neighbours' shading, the glass-weighted mean
   3  hidden surfaces: the BSP split and paint order against an independent ray test
   4  the drawings build, for every scenario and scope, with no NaN in them
   5  the Rhino file: written, read back by a second instance, and matching the model
   6  the state: storeys, copying a condition, undo
   7  a worked example and the energy: the hand-sized overhang reproduced, the
      clear-sky beam, direct gain summed over units, and the beam that enters
      the glass accounted for on the floor, the walls and the reveal

   A section that needs something absent (v4 beside this folder, rhino3dm
   installed) says so and is skipped rather than failing.                    */

import { existsSync } from 'node:fs';
import { defaultState, applyCase, setValue, CASES, TYPOLOGIES, applyTypology, glazingFromV4, addStorey, duplicateStorey, removeStorey,
  addGlazing, addDevice, createArray, applyShadingPreset, copyCondition, createHistory, storey0, moveStorey,
  breakUnit, rebindUnit, rebindAll, selGlazing, arrayGlazing, isBroken, selDevice, selCell, duplicateHere, newSystemHere, newUnitHere, useSystem, removeGlazing,
  saveWindow, openWindow, selectionChanged, keepCuts, windowState, shadingFromIdeal } from '../src/state.js';
import { flatGlazing, usage } from '../src/library.js';
import { siteChecks, siteFrame, insideBy } from '../src/geometry/site.js';
/** a side's glazing read back through the library */
const G = (t, f = 'S', st = 0) => flatGlazing(t, t.storeys[st].cells[f]);
const selCellOf = (t, f, st = 0) => t.storeys[st].cells[f];
/** the selected side's glazing made a window wall or a curtain wall: units filling 1.5 m bays to the slab */
const wallOf = (t, kind) => { newUnitHere(kind, t); setValue('g.winBy', 'spacing', t); setValue('g.winSp', 1.5, t); };
import { buildCell, wallPieces, glazingBox, GLAZING0, GLASS_T, unitLayout, cellKey } from '../src/geometry/cell.js';
import { DEVICE0, buildDevice, reachBack } from '../src/geometry/device.js';
import { buildBuilding, resolveSel, unitModel, analysisTarget, facadeLength, facadeFrame, toWorld, storeyCentre, storeyRot } from '../src/geometry/building.js';
import { boxCorners, sliceBox, boxSpan } from '../src/geometry/boxes.js';
import { shadeFraction, computeMask, envelope, idealElements, annualStudy, dailyProfile, fracT, computeMaskT, envelopeT,
  fracW, annualStudyW, annualStudyBy, fracOfT } from '../src/geometry/analysis.js';
import { arrayPositions } from '../src/geometry/arrays.js';
import { sunLocal, solarPosition, solarAt } from '../src/solar.js';
import { pickSunAt } from '../src/sunpick.js';
import { lightUnits, floorTotalAll } from '../src/geometry/floorsun.js';
import { arrayPositions as arrPos } from '../src/geometry/arrays.js';
import { doyOf, fmt, wrap180 } from '../src/util.js';
import { CLIMATE } from '../src/data/climate.js';
import { bpoly, bspSplit, paintOrder } from '../src/geometry/bsp.js';
import { openingFaces, GLASS_GROUP } from '../src/draw/opening.js';
import { buildFrame } from '../src/frame.js';
import { drawSunPath } from '../src/draw/sunpath.js';
import { drawSection } from '../src/draw/section.js';
import { drawPlan } from '../src/draw/plan.js';
import { drawDetail } from '../src/draw/detail.js';
import { drawAxon, axonCamera } from '../src/draw/axon.js';
import { drawSunYear } from '../src/draw/sunyear.js';
import { exportModel, writeRhino } from '../src/export/rhino.js';
import { SHEETCAM0 } from '../src/draw/sheetcam.js';
import { V as VIEW0 } from '../src/view.js';
import { calcSun, calcProfile, calcInside, calcGain, recBylaw, recGlazing, projectionAt, recGeometry, recUI, hSolution, idealSpec } from '../src/ui/calc.js';
import { renderChecks } from '../src/ui/prose.js';
import { clearDNI, typicalDNI, beamAt, unitGain, targetGain, dayGain, yearGain, hourlyStudy, floorNow, floorTotal, landing } from '../src/energy.js';
import { roomOf, sunPatches, litGlass, reachRegion } from '../src/geometry/room.js';
import { hourly, recordAt } from '../src/weather.js';
import { getValue as getV } from '../src/state.js';

let pass = 0, fail = 0, skipped = 0;
const section = t => console.log('\n' + t);
function check(label, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? '   ' + detail : ''}`);
  ok ? pass++ : fail++;
}
const skip = why => { console.log('  skip ' + why); skipped++; };

/* ---------- the v4 configurations every comparison runs over ---------- */
const CONFIGS = {
  'louvres, default': {},
  'louvres, 200 mm reveal': { reveal: 0.2, wallT: 0.35 },
  'fins at 30 deg, west': { facade: 'W', systems: [{ dev: 'fin-v', spacing: 0.75, angle: 30 }] },
  'tilted louvres, rotated 37': { rot: 37, systems: [{ dev: 'louvre-h', angle: 25 }] },
  'overhang, bottom-justified': { systems: [{ dev: 'overhang', depth: 0.9, arrJust: 'end' }] },
  'canopy, 300 reveal': { reveal: 0.3, wallT: 0.4,
    systems: [{ dev: 'louvre-oh', depth: 0.3, spacing: 0.45, arrLen: 1.2, angle: 20 }] },
  'egg-crate, short elements': { systems: [
    { dev: 'louvre-h', depth: 0.45, spacing: 0.45, arrLen: 2.85, arrOff: -0.45, elemLen: 2.2, elemJust: 'start' },
    { dev: 'fin-v', depth: 0.45, spacing: 0.5, arrLen: 3.5, arrJust: 'centre', elemLen: 2.9, angle: -15 }] },
  'count mode, centred, north': { facade: 'N', reveal: 0.1,
    systems: [{ dev: 'louvre-h', arrMode: 'count', count: 7, arrJust: 'centre', thick: 0.1 }] },
  'no device, deep reveal': { reveal: 0.45, wallT: 0.6, systems: [{ dev: 'none' }] }
};
const WIN0 = { type: 'punched', winW: 3.0, winH: 2.4, sill: 0.9, winN: 4, wallT: 0.28, reveal: 0 };
/** a v4 configuration as a one-storey v5 building, the glazing on its side */
function v5State(c) {
  const st = defaultState(), f = c.facade || 'S';
  st.rot = c.rot || 0;
  const win = Object.assign({}, WIN0, ...['winW', 'winH', 'sill', 'wallT', 'reveal'].filter(k => k in c).map(k => ({ [k]: c[k] })));
  st.storeys[0].cells[f] = glazingFromV4(win, c.systems || [{}]);
  st.sel = { f, st: 0, unit: null };
  return st;
}
const SKY = [];
for (let alt = 5; alt <= 85; alt += 10) for (let gam = -80; gam <= 80; gam += 20) SKY.push([alt, gam]);

/* ---------- 1  golden master ---------- */
section('1. Golden master: members and arrays reproduce v4');
const V4 = new URL('../../v4/src/', import.meta.url);
if (!existsSync(V4)) skip('v4 not found beside the v5 folder');
else {
  const v4s = await import(new URL('state.js', V4));
  const v4m = await import(new URL('geometry/model.js', V4));
  const v4a = await import(new URL('geometry/analysis.js', V4));
  const v4sol = await import(new URL('solar.js', V4));
  let worst = 0;
  for (const mode of ['lst', 'pdt', 'sol']) for (let d = 1; d <= 365; d += 11) for (let t = 0; t <= 24; t += 1.7) {
    const a = v4sol.solarPosition(d, t, mode), b = solarPosition(d, t, mode);
    worst = Math.max(worst, Math.abs(a.alt - b.alt), Math.abs(a.az - b.az));
  }
  check('solar position, 3 clocks x 34 days x 15 hours', worst === 0, 'worst ' + worst.toExponential(1) + ' deg');

  for (const [name, c] of Object.entries(CONFIGS)) {
    const s4 = v4s.defaultState();
    Object.assign(s4, c, { systems: (c.systems || [{}]).map(o => Object.assign(v4m.DEV0(), o)) });
    const m4 = v4m.buildModel(s4);
    const s5 = v5State(c), B = buildBuilding(s5), sel = resolveSel(s5, B);
    const m5 = B.facades[sel.f].rows[0].cell;                       // the cell alone: v4 had no neighbours
    const b4 = m4.elements, b5 = m5.elements;
    let bw = b4.length === b5.length && m4.gf === m5.gf ? 0 : Infinity;
    if (bw === 0) b4.forEach((b, i) => {
      for (const k of ['c', 'h', 'e1', 'e2', 'e3']) for (let j = 0; j < 3; j++) bw = Math.max(bw, Math.abs(b[k][j] - b5[i][k][j]));
    });
    const gf = m4.gf;
    let fw = 0;
    for (const [alt, gam] of SKY) {
      const sl = sunLocal(alt, gf + gam, gf);
      fw = Math.max(fw, Math.abs(v4a.shadeFraction(m4, sl, 41, 33).frac - shadeFraction(m5, sl, 41, 33).frac));
    }
    const k4 = v4a.computeMask(m4), k5 = computeMask(m5);
    let mw = 0;
    k5.cells.forEach((x, i) => { mw = Math.max(mw, Math.abs(x - k4.cells[i])); });
    const envDiff = (a, b) => a.length !== b.length ? Infinity : Math.max(0, ...a.map((c4, i) =>
      (c4.lo === null) !== (b[i].lo === null) ? Infinity
        : c4.lo === null ? 0 : Math.max(Math.abs(c4.lo - b[i].lo), Math.abs(c4.hi - b[i].hi), Math.abs(c4.gam - b[i].gam))));
    const er = envDiff(v4a.envelope(m4, m4.elements, 72), envelope(m5, m5.elements, 72));
    const ei = envDiff(v4a.envelope(m4, v4a.idealElements(m4, s4.systems), 72), envelope(m5, idealElements(m5), 72));
    const a4 = v4a.annualStudy(m4, CLIMATE.gw10, doyOf), a5 = annualStudy(m5, CLIMATE.gw10, doyOf);
    const d4 = v4a.dailyProfile(m4, s4.doy, s4.timeMode), d5 = dailyProfile(m5, s4.doy, s4.timeMode);
    const dd = Math.max(...d4.map((p, i) => p.frac === null ? (d5[i].frac === null ? 0 : 1) : Math.abs(p.frac - d5[i].frac)));
    // and through the target path a whole-facade study takes, for a target of this one cell
    const T = { scope: 'unit', gf, items: [{ m: Object.assign({}, m5), w: 7.2, count: 1 }], area: 7.2, units: 1, key: 'gm' };
    let tw = 0;
    for (const [alt, gam] of SKY) { const sl = sunLocal(alt, gf + gam, gf); tw = Math.max(tw, Math.abs(fracT(T, sl, 41, 33) - shadeFraction(m5, sl, 41, 33).frac)); }
    computeMaskT(T).cells.forEach((x, i) => { tw = Math.max(tw, Math.abs(x - k5.cells[i])); });
    const et = envDiff(envelope(m5, m5.elements, 72), envelopeT(T, false, 72));
    // boxes agree to rounding - an offset is now added after the set-out, not
    // inside it - and every study agrees exactly
    check(name, bw < 1e-12 && fw === 0 && mw === 0 && er === 0 && ei === 0 && a4.bare === a5.bare && a4.shaded === a5.shaded && dd === 0 && tw === 0 && et === 0,
      `${b5.length} members, ${SKY.length} suns, mask ${k5.cells.length} cells, both limits, annual, daily, target path`
      + (bw ? ', boxes within ' + bw.toExponential(0) + ' m' : '') + (fw || mw || tw ? `  [frac ${fw} mask ${mw} target ${tw}]` : ''));
  }
  // the four scenarios: v4's headline figure for each, unit alone and with its neighbours
  for (const n of [1, 2, 3, 4]) {
    const s4 = v4s.defaultState(); v4s.applyPreset(n, s4);
    const m4 = v4m.buildModel(s4), c4 = solarAt(s4.doy, s4.hour, s4.timeMode, m4.gf);
    const f4 = v4a.shadeFraction(m4, c4.sl, 61, 49).frac;
    const s5 = defaultState(); applyCase(n, s5);
    const F = buildFrame(s5, null), alone = shadeFraction(F.sel.row.cell, F.cur.sl, 61, 49).frac;
    check('scenario ' + n + ': the unit alone is v4\'s figure', alone === f4,
      `v4 ${fmt(f4 * 100, 1)}%, v5 alone ${fmt(alone * 100, 1)}%, with neighbours ${fmt(F.res.frac * 100, 1)}%`);
  }
}

/* ---------- 2  closed form ---------- */
section('2. Closed form');
{
  const r = xs => xs.map(x => +x.toFixed(4)).join(',');
  const A = o => Object.assign({ along: 'facade', mode: 'spacing', count: 5, spacing: 0.6, len: 2.4, ends: true }, o);
  const vs = [0.9, 3.3], us = [-1.5, 1.5];
  const cases = [
    ['one member at the head', arrayPositions(null, vs, -1, 'start'), '3.3'],
    ['one member at mid-height', arrayPositions(null, vs, -1, 'centre'), '2.1'],
    ['one member on the sill', arrayPositions(null, vs, -1, 'end'), '0.9'],
    ['600 pitch from the head', arrayPositions(A({}), vs, -1, 'start'), '3.3,2.7,2.1,1.5,0.9'],
    ['600 pitch from the sill, upward', arrayPositions(A({ len: 1.5, ends: false }), vs, -1, 'end'), '2.4,1.8,1.2'],
    ['count 4 over the opening', arrayPositions(A({ mode: 'count', count: 4 }), vs, -1, 'start'), '3.3,2.5,1.7,0.9'],
    ['700 centred, even count straddles', arrayPositions(A({ spacing: 0.7, ends: false }), vs, -1, 'centre'), '3.15,2.45,1.75,1.05'],
    ['700 fins centred, odd count on the centreline', arrayPositions(A({ spacing: 0.7, ends: false, len: 3 }), us, 1, 'centre'), '-1.4,-0.7,0,0.7,1.4'],
    ['700 from the head, end member added', arrayPositions(A({ spacing: 0.7 }), vs, -1, 'start'), '3.3,2.6,1.9,1.2,0.9']];
  for (const [label, got, want] of cases) check('array: ' + label, r(got) === want, r(got));

  // the hinge: the member turns about it, so the hinge point stays put at any angle
  const g = { u0: -1.5, u1: 1.5, v0: 0.9, v1: 3.3, reveal: 0.1 };
  let hw = 0;
  for (const hinge of ['start', 'centre', 'end']) for (const dir of ['h', 'v']) for (const angle of [-40, 0, 25, 60]) {
    const D = Object.assign(DEVICE0(dir), { depth: 0.5, thick: 0.04, angle, hinge, offset: 0.6 });
    const b = buildDevice(D, g)[0], f = { start: 0, centre: 0.5, end: 1 }[hinge];
    const eD = dir === 'h' ? b.e2 : b.e1, hDep = dir === 'h' ? b.h[1] : b.h[0];
    const pivot = b.c.map((x, i) => x - (0.5 - f) * 2 * hDep * eD[i]);
    const want = dir === 'h' ? [0, 3.3, 0.7] : [-1.5, 2.1, 0.7];
    hw = Math.max(hw, ...pivot.map((x, i) => i === (dir === 'h' ? 0 : 1) ? 0 : Math.abs(x - want[i])));
  }
  check('hinge: wall edge, centre and outer edge stay on the set-out point at every angle', hw < 1e-12, 'worst ' + hw.toExponential(1) + ' m');
  // a centre-hinged blade at 90 deg stands half above and half below its set-out
  // line, its thickness now lying across the facade
  const bc = buildDevice(Object.assign(DEVICE0('h'), { depth: 0.6, angle: 90, hinge: 'centre', offset: 0.4 }), g)[0];
  // a member whose hinge would bury it is held out until its nearest point is on the wall face,
  // whatever the hinge, the angle or the direction; the offset keeps its value
  let cw = 0, n0 = 0;
  for (const hinge of ['start', 'centre', 'end']) for (const dir of ['h', 'v']) for (const angle of [-60, -20, 0, 35, 80]) for (const offset of [0, 0.05]) {
    const D = Object.assign(DEVICE0(dir), { depth: 0.5, thick: 0.04, angle, hinge, offset });
    const b = buildDevice(D, g)[0], lo = Math.min(...boxCorners(b).map(p => p[2]));
    const want = g.reveal + Math.max(0, offset - reachBack(D));      // the face, or the offset past it
    cw = Math.max(cw, Math.abs(lo - (reachBack(D) > offset ? g.reveal : lo)), lo < g.reveal - 1e-12 ? 1 : 0);
    if (reachBack(D) > offset) n0++;
  }
  check('clearance: no hinge or tilt puts a member into the wall; a buried one just touches it', cw < 1e-12,
    n0 + ' of 60 cases held out, worst ' + cw.toExponential(1) + ' m');
  check('hinge: a centre-hinged blade turned upright straddles its line', Math.abs(bc.c[1] - 3.3) < 1e-12 && Math.abs(boxSpan(bc, 1) - 0.3) < 1e-9,
    'centre at ' + fmt(bc.c[1], 4) + ' m, reaches ±' + fmt(boxSpan(bc, 1), 4));

  // the reveal and the window-wall slab edge cut the sun off at atan(height / set-back)
  const cutoff = m => {
    let lo = 0, hi = 89.9;
    for (let i = 0; i < 40; i++) { const x = (lo + hi) / 2; if (shadeFraction(m, sunLocal(x, m.gf, m.gf), 201, 161).frac > 0.9999) hi = x; else lo = x; }
    return hi;
  };
  let worst = 0;
  for (const rv of [0.05, 0.1, 0.2, 0.4]) {
    const m = buildCell(Object.assign(GLAZING0(), { reveal: rv, wallT: 0.6 }), 3.6, 30, 180);
    worst = Math.max(worst, Math.abs(cutoff(m) - Math.atan2(2.4, rv) * 180 / Math.PI));
  }
  check('punched reveal cut-off against atan(winH / r), four depths', worst < 0.05, 'worst ' + worst.toFixed(3) + ' deg (sampling grid)');
  worst = 0;
  for (const rv of [0.1, 0.3]) {
    const m = buildCell(Object.assign(GLAZING0(), { type: 'windowwall', reveal: rv, slabT: 0.3 }), 3.6, 30, 180);
    worst = Math.max(worst, Math.abs(cutoff(m) - Math.atan2(3.3, rv) * 180 / Math.PI));
  }
  check('window-wall slab edge cut-off against atan((h - slab) / r)', worst < 0.05, 'worst ' + worst.toFixed(3) + ' deg');
  // a window wall has no jambs: sun from 80 deg off the normal still reaches set-back glass
  const ww = buildCell(Object.assign(GLAZING0(), { type: 'windowwall', reveal: 0.3 }), 3.6, 30, 180);
  const pw = buildCell(Object.assign(GLAZING0(), { reveal: 0.3, wallT: 0.4 }), 3.6, 30, 180);
  const obl = sunLocal(10, 180 + 80, 180);
  check('window wall runs on past the unit; a punched jamb does not', shadeFraction(ww, obl).frac < 0.2 && shadeFraction(pw, obl).frac > 0.5,
    'window wall ' + fmt(shadeFraction(ww, obl).frac * 100, 0) + '% shaded, punched ' + fmt(shadeFraction(pw, obl).frac * 100, 0) + '%');

  // the glass is a sealed unit whose outside face is the plane the rays leave from
  const gb = glazingBox(pw);
  check('the glass sits behind its outside face', Math.abs(gb.c[2] + gb.h[2]) < 1e-15 && Math.abs(gb.c[2] - gb.h[2] + GLASS_T) < 1e-15,
    'w from ' + fmt(gb.c[2] - gb.h[2], 3) + ' to ' + fmt(gb.c[2] + gb.h[2], 3) + ' m');

  // each glazing type: wall, spandrel and glass tile the storey band of a unit
  for (const type of ['punched', 'windowwall', 'curtainwall']) {
    const m = buildCell(Object.assign(GLAZING0(), { type, reveal: type === 'curtainwall' ? 0 : 0.12, wallT: 0.35 }), 3.6, 30, 180);
    const rect = { u0: -m.pitch / 2, u1: m.pitch / 2, v0: 0, v1: 3.6 };
    const area = wallPieces(m, rect).reduce((a, p) => a + 4 * p.h[0] * p.h[1], 0) + m.winW * m.winH;
    check('tiling: ' + type, Math.abs(area - m.pitch * 3.6) < 1e-9, fmt(area, 4) + ' of ' + fmt(m.pitch * 3.6, 4) + ' m2');
  }

  // units set out by number divide the side; by spacing they stand at the pitch, centred, plain wall at the ends
  const L1 = unitLayout(Object.assign(GLAZING0(), { winBy: 'spacing', winSp: 8 }), 30);
  const L2 = unitLayout(Object.assign(GLAZING0(), { type: 'windowwall', modBy: 'number', modN: 12 }), 18);
  const L3 = unitLayout(Object.assign(GLAZING0(), { type: 'curtainwall', module: 1.6 }), 30);
  check('layout: 3 m windows at 8 m on 30 m', L1.n === 4 && Math.abs(L1.first + 12) < 1e-12 && L1.pitch === 8, L1.n + ' from ' + L1.first);
  check('layout: 12 window-wall modules on 18 m', L2.n === 12 && Math.abs(L2.pitch - 1.5) < 1e-12);
  check('layout: 1.6 m curtain-wall modules on 30 m leave 0.6 m of wall at each end', L3.n === 18 && Math.abs((30 - L3.n * L3.pitch) / 2 - 0.6) < 1e-9);
  const sp = defaultState();
  sp.storeys[0].cells.S = Object.assign(GLAZING0(), { type: 'curtainwall', module: 1.6 });
  const rowS = buildBuilding(sp).facades.S.rows[0];
  const cover = rowS.units.reduce((a, q) => a + q.r1 - q.r0, 0) + rowS.ends.reduce((a, [x, y]) => a + y - x, 0);
  check('layout: bays and end walls cover the side exactly', Math.abs(cover - 30) < 1e-9, rowS.ends.length + ' end walls');

  // a section through a tilted blade is exactly its profile
  const b = buildDevice(Object.assign(DEVICE0('h'), { angle: 30, offset: 0.1 }), g)[0], cut = sliceBox(b, 0, 0);
  const prof = boxCorners(b).map(p => [p[1], p[2]]);
  const far = Math.max(...cut.map(q => Math.min(...prof.map(pp => Math.hypot(q[0] - pp[0], q[1] - pp[1])))));
  check('section through a tilted blade is its own profile', cut.length === 4 && far < 1e-12, cut.length + ' corners');

  // neighbours: a 1 m blade on the sill of storey 2 shades storey 1 for tan(omega) >= 4.5 - v
  const s = defaultState();
  s.storeys = [storey0(3.6), storey0(3.6)];
  s.storeys[0].cells.S = Object.assign(GLAZING0(), { winN: 1, winW: 3 });
  s.storeys[1].cells.S = Object.assign(GLAZING0(), { winN: 1, winW: 3,
    devices: [Object.assign(DEVICE0('h'), { depth: 1.0, thick: 1e-4, justV: 'end', len: 29.9 })] });
  const Bn = buildBuilding(s), m1 = unitModel(Bn, 'S', 0, 0);
  let nw = 0;
  for (const tanO of [1.8, 2.4, 3.0]) {
    const alt = Math.atan(tanO) * 180 / Math.PI, f = shadeFraction(m1, sunLocal(alt, 180, 180), 5, 481).frac;
    nw = Math.max(nw, Math.abs(f - Math.min(1, Math.max(0, (3.3 - (4.5 - tanO)) / 2.4))));
  }
  check('neighbours: the storey above shades the one below, by closed form', m1.ctx.length === 1 && m1.own.length === 0 && nw < 2 / 481,
    'worst ' + fmt(nw * 100, 2) + ' % against (head - (4.5 - tan Ω)) / winH');

  // the glass-weighted mean over distinct units equals the brute-force sum over every unit
  const s2 = defaultState(); applyCase(4, s2);
  s2.storeys.push(JSON.parse(JSON.stringify(s2.storeys[0])), JSON.parse(JSON.stringify(s2.storeys[0])));
  s2.storeys[1].cells.S.winN = 3;
  const B2 = buildBuilding(s2), sl = sunLocal(35, 225 + 30, 225);
  for (const sc of ['storey', 'facade']) {
    const T = analysisTarget(B2, resolveSel(s2, B2), sc);
    let a = 0, w = 0;
    B2.facades.S.rows.forEach(rw => { if (sc === 'facade' || rw.st === 0) rw.units.forEach(q => {
      const um = unitModel(B2, 'S', rw.st, q.i), ww2 = um.winW * um.winH;
      a += ww2 * shadeFraction(um, sl, 21, 17).frac; w += ww2; }); });
    const got = fracT(T, sl, 21, 17);
    check('the ' + sc + ' mean over distinct units is the mean over every unit', Math.abs(got - a / w) < 1e-12,
      `${T.units} units as ${T.items.length} distinct · ${fmt(got * 100, 3)}%`);
  }
  // round the corner: every unit takes the sun in its own frame, glass the sun is behind counts as shade
  s2.storeys[0].cells.W = JSON.parse(JSON.stringify(s2.storeys[0].cells.S));
  s2.storeys[2].cells.E = Object.assign(GLAZING0(), { type: 'windowwall', reveal: 0.1 });
  const B3 = buildBuilding(s2), alt = 35, az = 225 + 30;
  for (const sc of ['level', 'building']) {
    const T = analysisTarget(B3, resolveSel(s2, B3), sc);
    let a = 0, w = 0;
    for (const f of ['N', 'E', 'S', 'W']) B3.facades[f].rows.forEach(rw => { if (sc === 'building' || rw.st === 0) rw.units.forEach(q => {
      const um = unitModel(B3, f, rw.st, q.i), ww2 = um.winW * um.winH;
      a += ww2 * shadeFraction(um, sunLocal(alt, az, um.gf), 21, 17).frac; w += ww2; }); });
    const got = fracW(T, alt, az, 21, 17);
    check('the ' + sc + ' mean, all sides, is the mean over every unit', T.multi && Math.abs(got - a / w) < 1e-12,
      `${T.units} units on ${T.sides.join('')} as ${T.items.length} distinct · ${fmt(got * 100, 2)}%`);
  }
  // on one side only, the all-round study is the one-side study
  const s4 = defaultState(); applyCase(4, s4);
  const B4 = buildBuilding(s4), Tb = analysisTarget(B4, resolveSel(s4, B4), 'building'), Tf = analysisTarget(B4, resolveSel(s4, B4), 'facade');
  const aw = annualStudyW(Tb, CLIMATE.gw10, doyOf), ab = annualStudyBy(Tf.gf, fracOfT(Tf, 17, 13), CLIMATE.gw10, doyOf);
  check('a building glazed on one side studies as that side', Math.abs(aw.bare - ab.bare) < 1e-9 && Math.abs(aw.shaded - ab.shaded) < 1e-9,
    fmt(aw.bare, 3) + ' / ' + fmt(aw.shaded, 3) + ' kWh/m2');
  // a name is not geometry: renaming leaves every cached study valid
  const gN = Object.assign(GLAZING0(), { devices: [DEVICE0('h')] }), k1 = cellKey(gN, 3.6, 30, 180);
  gN.name = 'South screen'; gN.devices[0].name = 'Brise-soleil';
  check('renaming changes no geometry key', cellKey(gN, 3.6, 30, 180) === k1);
}

/* ---------- 3  hidden surfaces ---------- */
section('3. Hidden surfaces: the BSP tree');
{
  const area3 = pts => {
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    return Math.hypot(nx, ny, nz) / 2;
  };
  const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  let seed = 7; const rnd = (a, b) => { seed = (seed * 16807) % 2147483647; return a + (b - a) * seed / 2147483647; };
  const unit = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
  let wa = 0, wl = 0, cuts = 0;
  for (let t = 0; t < 3000; t++) {
    const n = unit([rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)]);
    const t1 = unit(Math.abs(n[1]) < 0.9 ? [n[2], 0, -n[0]] : [0, -n[2], n[1]]);
    const t2 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
    const mk = (a, b) => [0, 1, 2].map(i => a * t1[i] + b * t2[i]);
    const pts = [mk(-1, -1), mk(1, -1), mk(1, 1), mk(-1, 1)];
    const co = [], f = [], b = [];
    bspSplit(bpoly(pts, n, 'x'), { n: unit([rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)]), d: rnd(-0.9, 0.9) }, co, f, b);
    const all = co.concat(f, b);
    if (f.length && b.length) cuts++;
    wa = Math.max(wa, Math.abs(all.reduce((s, q) => s + area3(q.pts), 0) - area3(pts)));
    const lines = all.reduce((s, q) => s + q.pts.reduce((a, p, i) => a + (q.edge[i] ? len(p, q.pts[(i + 1) % q.pts.length]) : 0), 0), 0);
    wl = Math.max(wl, Math.abs(lines - pts.reduce((a, p, i) => a + len(p, pts[(i + 1) % 4]), 0)));
  }
  check('splitting conserves area', wa < 1e-12, `${cuts} of 3000 random quads cut, worst ${wa.toExponential(1)}`);
  check('splitting invents no line and loses none', wl < 1e-12, `worst perimeter error ${wl.toExponential(1)}`);

  const cover = (order, e) => {
    const t1 = unit(Math.abs(e[1]) < 0.9 ? [e[2], 0, -e[0]] : [1, 0, 0]);
    const t2 = [e[1] * t1[2] - e[2] * t1[1], e[2] * t1[0] - e[0] * t1[2], e[0] * t1[1] - e[1] * t1[0]];
    const Pp = p => [p[0] * t1[0] + p[1] * t1[1] + p[2] * t1[2], p[0] * t2[0] + p[1] * t2[1] + p[2] * t2[2]];
    const inside = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    const vis = order.filter(q => q.n[0] * e[0] + q.n[1] * e[1] + q.n[2] * e[2] > 0.002);
    const proj = vis.map(q => q.pts.map(Pp));
    let bad = 0;
    vis.forEach((p, i) => {
      const c = p.pts.reduce((s, q) => [s[0] + q[0] / p.pts.length, s[1] + q[1] / p.pts.length, s[2] + q[2] / p.pts.length], [0, 0, 0]);
      for (const X of [c, ...p.pts.map(q => [0, 1, 2].map(k => c[k] + (q[k] - c[k]) * 0.72))]) {
        const sx = Pp(X);
        vis.forEach((q, j) => {
          if (j === i || !inside(proj[j], sx[0], sx[1])) return;
          const den = q.n[0] * e[0] + q.n[1] * e[1] + q.n[2] * e[2];
          if (Math.abs(den) < 1e-9) return;
          const gap = (q.d - (q.n[0] * X[0] + q.n[1] * X[1] + q.n[2] * X[2])) / den;
          if (Math.abs(gap) > 1e-6 && (gap > 0) !== (j > i)) bad++;
        });
      }
    });
    return bad;
  };
  const eyes = [];
  for (const az of [-80, -40, -10, 25, 60]) for (const el of [-40, 10, 50]) {
    const a = az * Math.PI / 180, b = el * Math.PI / 180;
    eyes.push([Math.sin(a) * Math.cos(b), Math.sin(b), Math.cos(a) * Math.cos(b)]);
  }
  const cellOf = (c, over) => {
    const s = v5State(Object.assign({ reveal: 0.2, wallT: 0.4 }, c));
    Object.assign(s.storeys[0].cells[s.sel.f], over || {});
    const B = buildBuilding(s);
    return B.facades[s.sel.f].rows[0].cell;
  };
  for (const [name, m] of [['egg-crate in a 200 mm reveal', cellOf(CONFIGS['egg-crate, short elements'])],
    ['canopy in a 300 mm reveal', cellOf(CONFIGS['canopy, 300 reveal'])], ['tilted louvres', cellOf(CONFIGS['tilted louvres, rotated 37'])],
    ['window wall with louvres', cellOf({}, { type: 'windowwall', reveal: 0.15 })], ['curtain wall with fins', cellOf(CONFIGS['fins at 30 deg, west'], { type: 'curtainwall' })]]) {
    const cur = solarAt(172, 15.5, 'lst', m.gf);
    const rect = { u0: -2.2, u1: 2.2, v0: 0.4, v1: 3.8 };
    const polys = openingFaces(Object.assign({}, m, { own: m.elements, ctx: [] }), cur, rect, true);
    let bsp = 0, depth = 0;
    for (const e of eyes) {
      bsp += cover(paintOrder(polys, e, GLASS_GROUP).order, e);
      const sorted = polys.slice().sort((a, b) => Math.max(...a.pts.map(p => p[0] * e[0] + p[1] * e[1] + p[2] * e[2]))
        - Math.max(...b.pts.map(p => p[0] * e[0] + p[1] * e[1] + p[2] * e[2])));
      depth += cover(sorted, e);
    }
    check(`paint order, ${name}`, bsp === 0, `${polys.length} faces x ${eyes.length} views: BSP ${bsp} wrong, a depth sort ${depth}`);
  }
}

/* ---------- 4  drawings ---------- */
function mixedBuilding() {
  const s = defaultState();
  addGlazing(s); applyShadingPreset('eggcrate', s);
  addStorey(s); addGlazing(s); wallOf(s, 'windowwall'); setValue('g.reveal', 0.15, s); applyShadingPreset('louvredCanopy', s);
  addStorey(s); addGlazing(s); wallOf(s, 'curtainwall'); addDevice('v', s); createArray(s);
  setValue('d.hinge', 'centre', s); setValue('d.angle', 35, s); setValue('d.offset', 0.3, s);
  s.sel = { f: 'E', st: 0, unit: null }; addGlazing(s); addDevice('h', s);
  s.sel = { f: 'S', st: 1, unit: null };
  return s;
}
section('4. The drawings build for every scenario and scope');
{
  const V = { axcam: { daz: 220, el: 26, zoom: 1, panX: 0, panY: 0 }, detcam: { az: -26, el: 13, zoom: 1, panX: 0, panY: 0 },
    layers: { dome: true, seasons: true, day: true, compass: true, azimuth: true, angles: true, triangle: true, ray: true, shadow: true, grid: true },
    detSolid: false, detWall: true, sunFast: false, dots: true, inMode: 'now', plancam: SHEETCAM0('reach'), seccam: SHEETCAM0('window') };
  // the interior plan and the worked calculations are drawn with the room's study
  const drawRoom = F => {
    const m = F.m, st = F.S, { dni } = beamAt(st.sky, st.wx, st.doy, st.hour, st.timeMode);
    let study = null;
    if (m.opening) {
      const R = roomOf(m, st), region = reachRegion(m, R, [st.doy]);
      study = { R, region, nowGrid: floorNow(m, region, F.cur.sl, F.cur.onFacade ? dni : 0) };
      study.now = study.nowGrid; study.land = landing(m, R, F.cur.sl, F.cur.onFacade ? dni : 0, region);
      study.land.dni = dni; study.land.enter = 0;
    }
    const svgs = ['now', 'day', 'year'].map(md => { F.V.inMode = md; if (md !== 'now' && study) study[md] = floorTotal(m, study.region, st.sky, st.wx, md, st.doy, st.timeMode); return drawPlan(F, study) + drawSection(F, study); });
    F.V.inMode = 'now';
    const html = calcSun(F) + calcProfile(F) + calcInside(F, study && study.land, study) + recBylaw(F) + recGlazing(F) + renderChecks(F);
    if (/NaN|undefined/.test(html)) throw new Error('a worked calculation printed NaN or undefined');
    if (svgs.some(x => /NaN/.test(x))) throw new Error('the interior plan has NaN in it');
    return svgs[0];
  };
  const views = { drawSunPath, drawSunYear: F => drawSunYear(F, null), drawSection, drawPlan, drawDetail, drawAxon, drawRoom };
  const scen = [['the empty default', () => defaultState()],
    ...Object.keys(CASES).map(n => ['case ' + n, () => { const s = defaultState(); applyCase(+n, s); return s; }]),
    ...Object.keys(TYPOLOGIES).map(k => ['typology ' + k, () => { const s = defaultState(); applyTypology(k, s); return s; }]),
    ['balcony tower, whole building', () => { const s = defaultState(); applyTypology('balcTower', s); s.scope = 'building'; return s; }],
    ...Object.entries(CONFIGS).map(([n, c]) => [n, () => v5State(c)]),
    ...['unit', 'storey', 'level', 'facade', 'building'].flatMap(sc => [0, 1, 2].map(st => ['mixed building, ' + sc + ', storey ' + (st + 1),
      () => { const s = mixedBuilding(); s.scope = sc; s.sel.st = st; return s; }])),
    ['mixed building, a blank side', () => { const s = mixedBuilding(); s.sel = { f: 'N', st: 0, unit: null }; s.scope = 'facade'; return s; }],
    ['spaced windows and modules', () => { const s = mixedBuilding(); s.storeys[0].cells.S.winBy = 'spacing'; s.storeys[0].cells.S.winSp = 8;
      s.storeys[1].cells.S.module = 1.6; s.scope = 'building'; return s; }]];
  // the 30-storey balcony tower is the stress case: timed apart, against its own limit
  let worstMs = 0, worstName = '', heavyMs = 0;
  for (const [name, setup] of scen) {
    const st = setup();
    let ok = true, why = '';
    for (const [vn, fn] of Object.entries(views)) {
      try {
        const t0 = performance.now(), F = buildFrame(st, V), out = fn(F), ms = performance.now() - t0;
        if (/balcTower|balcony tower/.test(name)) heavyMs = Math.max(heavyMs, ms);
        else if (ms > worstMs && vn !== 'drawSunPath') { worstMs = ms; worstName = name + ' / ' + vn; }
        if (!/^<svg[\s\S]*<\/svg>$/.test(out) || /="[^"]*(NaN|undefined|Infinity)|>\s*(NaN|undefined)|NaN[\s,]/.test(out)) { ok = false; why = vn + ' has NaN or undefined in its geometry'; }
      } catch (e) { ok = false; why = vn + ': ' + e.message; }
    }
    check('every drawing: ' + name, ok, why);
  }
  check('slowest drawing under 150 ms', worstMs < 150, fmt(worstMs, 0) + ' ms, ' + worstName);
  check('the 30-storey balcony tower draws in under 350 ms, frame and all', heavyMs < 350, fmt(heavyMs, 0) + ' ms');
}

/* ---------- 5  the Rhino file ---------- */
section('5. The Rhino file');
let rhino3dm = null;
try { rhino3dm = (await import('rhino3dm')).default; } catch (e) { /* not installed */ }
if (!rhino3dm) skip('rhino3dm not installed (npm install)');
else {
  const rhino = await rhino3dm();
  const cases = [['one unit, egg-crate, 200 reveal', v5State(Object.assign({ reveal: 0.2, wallT: 0.4 }, CONFIGS['egg-crate, short elements'])), 'unit'],
    ['one unit, canopy on a rotated west side', v5State(Object.assign({}, CONFIGS['canopy, 300 reveal'], { facade: 'W', rot: 37 })), 'unit'],
    ['a storey of window wall', mixedBuilding(), 'storey'],
    ['a whole side, three systems', mixedBuilding(), 'facade'],
    ['a storey all round', mixedBuilding(), 'level'],
    ['the whole building', mixedBuilding(), 'building']];
  for (const [name, st, scope] of cases) {
    const model = exportModel(st, scope), out = writeRhino(rhino, model);
    const r2 = await rhino3dm(), back = r2.File3dm.fromByteArray(out.bytes);
    let ext = 0, crv = 0;
    const layers = {};
    for (let i = 0; i < back.objects().count; i++) {
      const o = back.objects().get(i), g = o.geometry().constructor.name;
      g === 'Extrusion' ? ext++ : crv++;
      const L = back.layers().get(o.attributes().layerIndex).name; layers[L] = (layers[L] || 0) + 1;
    }
    // the selected unit's members against the boxes the ray test uses, corner for corner
    const B = buildBuilding(st), sel = resolveSel(st, B), um = unitModel(B, sel.f, sel.st, sel.unit);
    const fr = facadeFrame(st, sel.f), tag = '-' + sel.f + (sel.st + 1) + '-' + (sel.unit + 1) + '-';
    const dev = model.solids.filter(s => s.layer.startsWith('A-SHADE') && s.name.includes(tag));
    let worst = dev.length === um.own.length ? 0 : Infinity;
    um.own.forEach((b, i) => {
      if (!dev[i]) return;
      const got = dev[i].base.concat(dev[i].base.map(q => q.map((x, k) => x + dev[i].dir[k] * dev[i].dist)));
      for (const p of boxCorners(b).map(p => toWorld(fr, um.cc + p[0], um.zb + p[1], p[2], um.reveal).map(x => x * 1000)))
        worst = Math.max(worst, Math.min(...got.map(q => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]))));
    });
    const txt = back.strings().getvalue('VSSE.params');
    check(name, back.objects().count === out.solids + out.curves && out.failed === 0 && ext === out.solids && crv === out.curves
      && back.settings().modelUnitSystem === r2.UnitSystem.Millimeters && txt && JSON.parse(txt).unitsWritten >= 1 && worst < 1e-6,
      `${out.solids} solids + ${out.curves} curve, ${Object.entries(layers).map(([k, v]) => k + ' ' + v).join(', ')}; members within ${worst.toExponential(1)} mm`);
  }
  // a whole side's wall, spandrels and glass tile its face, storey by storey
  const st = mixedBuilding();
  st.storeys[0].cells.S.winBy = 'spacing'; st.storeys[0].cells.S.winSp = 8; st.storeys[1].cells.S.module = 1.6;   // end walls on two storeys
  const model = exportModel(st, 'facade');
  const faceArea = model.solids.filter(s => ['A-WALL', 'A-SPAN', 'A-GLAZ'].includes(s.layer)).reduce((t, s) => {
    const p = s.base, d = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    // an extrusion whose axis is the facade normal shows its base to the street; others are seen edge on
    return Math.abs(s.dir[1]) > 0.999 ? t + d(p[0], p[1]) * d(p[0], p[3]) : t;
  }, 0) / 1e6;
  const want = facadeLength(st, 'S') * st.storeys.reduce((a, s) => a + s.h, 0);
  check('a side\'s wall, spandrels and glass tile its face', Math.abs(faceArea - want) < 1e-6, fmt(faceArea, 3) + ' of ' + fmt(want, 3) + ' m2');
  const faceY = Math.min(...model.solids.filter(s => s.layer === 'A-WALL').flatMap(s => s.base.concat(s.base.map(q => q.map((x, k) => x + s.dir[k] * s.dist)))).map(p => p[1]));
  check('the wall face lands on the plate line', Math.abs(faceY + st.storeys[0].d / 2 * 1000) < 1e-6, 'south face at y = ' + fmt(faceY, 3) + ' mm');
}

/* ---------- 6  the state ---------- */
section('6. The state');
{
  const s = defaultState();
  check('the default is one blank storey', s.storeys.length === 1 && Object.values(s.storeys[0].cells).every(c => c === null));
  addGlazing(s); applyShadingPreset('louvres', s);
  duplicateStorey(s); addStorey(s);
  check('add and duplicate: a copy above carries the glazing, a new storey is blank',
    s.storeys.length === 3 && s.storeys[1].cells.S && G(s, 'S', 1).devices.length === 1 && s.storeys[2].cells.S === null);
  removeStorey(1, s);
  check('remove a storey', s.storeys.length === 2 && s.sel.st === 1);
  s.sel = { f: 'S', st: 0, unit: null };
  const r = copyCondition({ height: false, glazing: true, shading: true }, [{ f: 'E', st: 0 }, { f: 'W', st: 1 }, { f: 'N', st: 1 }], s);
  check('copy the window system and its shading to three conditions: they use the same, linked entries',
    r.done.length === 3 && G(s, 'W', 1).devices.length === 1 && s.storeys[0].cells.E.sys === s.storeys[0].cells.S.sys && s.storeys[1].cells.N.shd === s.storeys[0].cells.S.shd,
    r.done.join(', '));
  // a target whose slab leaves the glass no room is passed over
  s.storeys[1].slab = 2.6;
  const r2 = copyCondition({ glazing: true }, [{ f: 'E', st: 1 }, { f: 'N', st: 0 }], s);
  check('a condition with no room for the glass under its slab is passed over, and said why', r2.skipped.length === 1 && /E storey 2/.test(r2.skipped[0]) && /no room/.test(r2.skipped[0]) && r2.done.length === 1,
    r2.skipped.join('; '));
  s.storeys[1].slab = 0.3;
  const r3 = copyCondition({ shading: true }, [{ f: 'N', st: 1 }, { f: 'S', st: 1 }], Object.assign(s, { sel: { f: 'S', st: 0, unit: null } }));
  check('shading is not copied where there is no glazing to carry it', r3.skipped.some(x => /S storey 2/.test(x)), r3.skipped.join('; '));
  // a window is never taller than its storey less its slab and sill
  s.storeys[1].h = 3.0;
  const c4 = buildBuilding(s).facades.W.rows[1].cell;
  check('a window is held under the slab: the storey less its slab and sill', Math.abs(c4.winH - (3.0 - 0.3 - 0.9)) < 1e-9 && c4.notes.some(x => /held under the slab/.test(x)),
    fmt(c4.winH * 1000, 0) + ' mm of a 2400 mm unit in a 3.0 m storey under a 300 mm slab');

  const H = createHistory(s), before = JSON.stringify(s);
  H.mark('a'); addStorey(s); H.mark('b'); G(s).devices[0].depth = 0.9;
  H.back(); H.back();
  check('undo walks back through storeys and devices', JSON.stringify(s) === before);
  H.forward(); H.forward();
  check('and redo comes forward again', s.storeys.length === 3 && G(s).devices[0].depth === 0.9);

  // storeys as sheets: a copy below, and moves up and down a level
  {
    const t = defaultState(); addGlazing(t); addStorey(t); t.sel.st = 0;
    duplicateStorey(t, 'below');
    const ok1 = t.storeys.length === 3 && t.sel.st === 0 && t.storeys[0].cells.S && t.storeys[1].cells.S && !t.storeys[2].cells.S;
    moveStorey(1, t); moveStorey(1, t);
    const ok2 = t.sel.st === 2 && !t.storeys[1].cells.S && !!t.storeys[2].cells.S && moveStorey(1, t) === false;
    check('a copy below becomes the working storey; a storey moves up a level at a time, and not past the top', ok1 && ok2);
  }
  // floorplates, storey by storey
  {
    const t = defaultState(); addStorey(t); addStorey(t); addStorey(t); t.sel.st = 1;
    setValue('plnD', 22, t);
    const a = t.storeys.map(x => x.d).join(',');
    t.matchAbove.plate = false; t.sel.st = 2; setValue('plnW', 26, t);
    const b = t.storeys.map(x => x.w).join(',');
    check('floorplate: matching floors above carries a change up; made unique, one storey changes', a === '18,22,22,22' && b === '30,30,26,30', 'depths ' + a + ' · widths ' + b);
  }
  // glazing matched up the building
  {
    const t = defaultState(); addStorey(t); addStorey(t); t.sel.st = 0; t.matchAbove.glazing = true;
    addGlazing(t); setValue('g.winW', 2.2, t); applyShadingPreset('fins', t);
    const ok1 = [0, 1, 2].every(i => G(t, 'S', i) && G(t, 'S', i).winW === 2.2 && G(t, 'S', i).devices.length === 1);
    // from storey 2 up, a system and unit of their own; then storey 3 alone
    t.sel.st = 1; duplicateHere('sys', t); duplicateHere('unit', t); setValue('g.winW', 1.6, t);
    const ok2 = G(t, 'S', 0).winW === 2.2 && G(t, 'S', 1).winW === 1.6 && G(t, 'S', 2).winW === 1.6;
    t.sel.st = 2; t.matchAbove.glazing = false; duplicateHere('sys', t); duplicateHere('unit', t); setValue('g.winW', 1.2, t);
    check('glazing: matching floors above shares the system up and never down; duplicated, a storey goes its own way',
      ok1 && ok2 && G(t, 'S', 1).winW === 1.6 && G(t, 'S', 2).winW === 1.2 && G(t, 'S', 0).winW === 2.2);
  }
  // windows broken from their array, and bound back
  {
    const t = defaultState(); addGlazing(t); t.sel.unit = 1;
    const before = JSON.stringify(t.storeys);
    breakUnit(t); breakUnit(t, 'shd'); setValue('g.winW', 1.8, t); applyShadingPreset('fins', t);
    const B = buildBuilding(t), row = B.facades.S.rows[0];
    const ok1 = row.units[1].cell.winW === 1.8 && row.units[1].cell.elements.length > 0 && row.units[0].cell.winW === 3 && row.units[0].cell.elements.length === 0;
    // across a window wall the modules abut: the one beside a broken module counts its fins, one far off does not
    const t2 = defaultState(); addGlazing(t2); setValue('g.fillW', true, t2); setValue('g.winBy', 'spacing', t2); setValue('g.winSp', 1.5, t2);
    t2.sel.unit = 5; breakUnit(t2, 'shd'); applyShadingPreset('fins', t2);
    const B2 = buildBuilding(t2), ok2 = unitModel(B2, 'S', 0, 4).ctx.length > 0 && unitModel(B2, 'S', 0, 15).ctx.length === 0;
    setValue('g.winN', 3, t);                               // a layout edit goes to the array
    const ok3 = arrayGlazing(t).winN === 3 && selGlazing(t).winW === 1.8;
    setValue('g.winN', 4, t);
    rebindUnit('revert', 'keep', t); rebindUnit('revert', 'keep', t, 'shd');
    check('a broken window takes its own size and shading, its neighbours see them, and bound back it reverts',
      ok1 && ok2 && ok3 && !isBroken(t) && !isBroken(t, 'shd') && JSON.stringify(t.storeys) === before);
    // the window and its shading break out apart: the part left bound still follows the array
    {
      const u = defaultState(); addGlazing(u);
      u.sel.unit = 1; breakUnit(u, 'shd'); applyShadingPreset('fins', u);    // unit 2: its own fins
      u.sel.unit = 2; breakUnit(u); setValue('g.winW', 1.5, u);            // unit 3: its own window
      u.sel.unit = 0; setValue('g.winW', 2.4, u); applyShadingPreset('canopy', u);   // the array: a wider window, a canopy
      const rw = buildBuilding(u).facades.S.rows[0].units.map(q => q.cell);
      const kinds = c => c.glz.devices.map(D => D.name || D.dir).join(',');
      check('the window and its shading break out apart, and the part left bound follows the array',
        rw[1].winW === 2.4 && kinds(rw[1]) !== kinds(rw[0]) && rw[1].glz.devices[0].dir === 'v'
          && rw[2].winW === 1.5 && kinds(rw[2]) === kinds(rw[0]) && rw[0].glz.devices[0].name === 'Canopy',
        'unit 2: array window, own fins · unit 3: own window, the array’s canopy');
      // the building view is redrawn when a window's own shading changes, not only its window
      const a = drawAxon(buildFrame(u, VIEW0));
      u.lib.devices[u.lib.shading[u.storeys[0].cells.S.brokenShd[1].shd].devices[0]].depth = 0.9;
      check('the building view redraws when a window’s own shading is edited', a !== drawAxon(buildFrame(u, VIEW0)));
    }
    // storeys turned their own ways: the neighbours and the mass above are turned into the unit's frame
    {
      const t = defaultState(); addGlazing(t); t.sel.unit = 1; applyShadingPreset('fins', t);
      addStorey(t); t.storeys[1].w = 36; t.storeys[1].d = 24; addGlazing(t); applyShadingPreset('canopy', t);
      const suns = [[60, 180], [30, 205], [45, 150], [20, 240], [70, 120]];
      const fr = () => { const B = buildBuilding(t), m = unitModel(B, 'S', 0, 1); return { m, f: suns.map(([al, az]) => shadeFraction(m, sunLocal(al, az, m.gf), 21, 17).frac) }; };
      const sq = fr();
      t.storeys[1].rot = 1e-7;                 // turned by next to nothing: the turned path must agree with the square one
      const nearly = fr(), worst = Math.max(...sq.f.map((x, k) => Math.abs(x - nearly.f[k])));
      t.storeys[1].rot = 15;
      const turned = fr(), B = buildBuilding(t);
      const gfs = B.facades.S.rows.map(r => r.gf);
      const T = analysisTarget(B, { f: 'S', st: 0, unit: 1 }, 'facade');
      check('a storey turned against the one below: its devices and mass are turned into the unit, and agree with the square case as the turn goes to zero',
        worst < 2e-3 && turned.m.ctx.some(b => b.mass) && Math.abs(gfs[1] - gfs[0] - 15) < 1e-9 && T.multi && turned.f.some((x, k) => Math.abs(x - sq.f[k]) > 1e-3),
        'worst ' + fmt(worst * 100, 3) + '% at a turn of 1e-7°; turned 15°, one side reads ' + T.items.length + ' distinct units over the whole sky');
    }
    // the site view keeps its size as the building turns, and draws its angles wherever they are asked for
    {
      const t = defaultState(); applyTypology('midPunched', t);
      const cam0 = { daz: 220, el: 0, zoom: 1, panX: 0, panY: 0 };
      const spans = [0, 17, 45, 90, 133].map(r => { t.rot = r; return axonCamera(t, cam0).span; });
      const same = spans.every(x => Math.abs(x - spans[0]) < 1e-9);
      t.rot = 30;
      const Vw = Object.assign(Object.create(VIEW0), { layers: Object.assign({}, VIEW0.layers, { wxdots: true }), axcam: cam0 });
      const svgs = ['ground', 'level', 'window'].map(a => { Vw.angAt = a; return drawAxon(buildFrame(t, Vw)); });
      const clean = svgs.every(x => /^<svg[\s\S]*<\/svg>$/.test(x) && !/NaN|undefined/.test(x));
      check('the site view keeps its size however the building is turned, looks level with the horizon, and draws its angles on the ground, at the window’s floor or about the window',
        same && clean && new Set(svgs).size === 3 && VIEW0.layers.wxdots === false, 'span ' + fmt(spans[0], 1) + ' m at every turn');
    }
    // a floor's rotation, from the building, the floor below or true north: the building's north offset turns what hangs on it
    {
      const t = defaultState(); addStorey(t); addStorey(t); t.matchAbove.plate = false;
      setValue('rot', 30, t);
      t.sel.st = 1; setValue('plnRot', 5, t);
      t.sel.st = 2; setValue('rotRel', 'below', t); setValue('plnRot', 5, t);
      const a = [0, 1, 2].map(i => storeyRot(t, i));           // 30, 35, 40
      t.sel.st = 1; setValue('rotRel', 'true', t);
      const kept = storeyRot(t, 1), fig = t.storeys[1].rot;    // 35 from true north
      setValue('rot', 0, t);
      const b = [0, 1, 2].map(i => storeyRot(t, i));           // 0, 35, 40
      check('a floor’s rotation is measured from the building, the floor below or true north; the building’s north offset turns only what is measured from it',
        a.join() === '30,35,40' && kept === 35 && fig === 35 && b.join() === '0,35,40', a.join('/') + ' → ' + b.join('/') + ' with the building turned back to north');
    }
    // the axes an offset is read along: switching them keeps the storey put; turning then swings it or spins it
    {
      const t = defaultState(); setValue('plnRot', 20, t); setValue('plnOX', 5, t); setValue('plnOY', 2, t);
      const c0 = storeyCentre(t, 0);
      setValue('oxyIn', 'global', t);
      const c1 = storeyCentre(t, 0), moved = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]), rewrote = Math.abs(t.storeys[0].ox - 5) > 0.1;
      setValue('plnRot', 50, t);
      const c2 = storeyCentre(t, 0);
      setValue('oxyIn', 'own', t); setValue('plnRot', 20, t);
      const c3 = storeyCentre(t, 0);
      check('an offset read along the floor’s own axes, true north or the floor below’s: switching keeps the storey in place',
        moved < 1e-5 && rewrote && Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) < 1e-9 && Math.hypot(c3[0] - c0[0], c3[1] - c0[1]) > 0.5,
        'moved ' + moved.toExponential(1) + ' m on switching; spun in place on true north; swung round the axis on its own axes');
    }
    // apply one window's edits to the array while another stays broken, then bind them all
    t.sel.unit = 0; breakUnit(t); setValue('g.shgc', 0.25, t);
    t.sel.unit = 2; breakUnit(t); setValue('g.sill', 0.6, t);
    rebindUnit('apply', 'keep', t);
    const ok4 = arrayGlazing(t).sill === 0.6 && arrayGlazing(t).broken && !!arrayGlazing(t).broken[0] && arrayGlazing(t).shgc === 0.36;
    t.sel.unit = 0; rebindUnit('apply', 'rebind', t);
    check('bound back with its edits: the array takes them, and the others stay broken or are bound back too',
      // the window gives the array all its settings - its sill is still the one it was broken with
      ok4 && arrayGlazing(t).shgc === 0.25 && arrayGlazing(t).sill === 0.9 && !arrayGlazing(t).broken);
  }
  // a storey offset from the axis: it overhangs on one side and steps in on the other
  {
    const t = defaultState(); addGlazing(t); setValue('g.winN', 1, t); t.sel.f = 'N'; addGlazing(t); setValue('g.winN', 1, t); t.sel.f = 'S';
    addStorey(t); t.storeys[1].oy = -1;                     // 1 m south: out past storey 1 on S, in from it on N
    const B = buildBuilding(t), mS = unitModel(B, 'S', 0, 0), mN = unitModel(B, 'N', 0, 0);
    const sl = [0, Math.sin(45 * Math.PI / 180), Math.cos(45 * Math.PI / 180)];
    const want = (1.0 * Math.tan(45 * Math.PI / 180) - (3.6 - mS.head)) / mS.winH;
    const okS = mS.ctx.some(b => b.mass) && Math.abs(shadeFraction(mS, sl, 61, 97).frac - want) < 0.012, okN = !mN.ctx.some(b => b.mass);
    // offset east by more than half the side: the storey above no longer covers the window at all
    t.storeys[1].oy = -1; t.storeys[1].ox = 40;
    const mS2 = unitModel(buildBuilding(t), 'S', 0, 0);
    check('an offset storey overhangs on one side, steps in on the other, and its overhang moves with it along the side',
      okS && okN && shadeFraction(mS2, sl, 61, 97).frac === 0, 'S shaded ' + fmt(shadeFraction(mS, sl, 61, 97).frac * 100, 1) + '% (1 m overhang ' + fmt(want * 100, 1) + '%)');
  }
  // match floors above: turned on it takes effect at once, and it carries the storey height too
  {
    const t = defaultState(); addStorey(t); addStorey(t); t.sel.st = 0; t.matchAbove.plate = false;
    setValue('sh', 4.5, t); setValue('plnW', 36, t); setValue('plnOX', 2, t);
    const before = t.storeys.map(x => [x.h, x.w, x.ox].join('/')).join(' ');
    setValue('matchPlate', true, t);
    const after = t.storeys.map(x => [x.h, x.w, x.ox].join('/')).join(' ');
    t.sel.st = 1; t.matchAbove.plate = true; setValue('sh', 3.0, t);
    check('match floors above takes effect when turned on, height and offset included; a later change still runs upward only',
      before === '4.5/36/2 3.6/30/0 3.6/30/0' && after === '4.5/36/2 4.5/36/2 4.5/36/2' && t.storeys.map(x => x.h).join(',') === '4.5,3,3', before + ' → ' + after);
    const tg = defaultState(); addGlazing(tg); addStorey(tg); tg.sel.st = 0;
    setValue('matchGlazing', true, tg);
    check('matching glazing takes effect when turned on', !!tg.storeys[1].cells.S && tg.storeys[1].cells.S.sys === tg.storeys[0].cells.S.sys && G(tg, 'S', 1).winW === G(tg, 'S', 0).winW);
  }
  // switching between spacing and number keeps the layout
  {
    const t = defaultState(); addGlazing(t); setValue('g.winN', 5, t);
    const pos = () => { const B = buildBuilding(t); return B.facades.S.rows[0].units.map(q => q.cc.toFixed(4)).join(','); };
    const a = pos(); setValue('g.winBy', 'spacing', t); const b = pos(); setValue('g.winBy', 'number', t); const c = pos();
    setValue('g.fillW', true, t); setValue('g.winBy', 'spacing', t); setValue('g.winSp', 1.5, t);
    const d = pos(); setValue('g.winBy', 'number', t); const n2 = buildBuilding(t).facades.S.rows[0].units.length; setValue('g.winBy', 'spacing', t); const e = pos();
    check('windows and glass-to-glass units: number to spacing and back keeps them where they are', a === b && b === c && d === e && n2 === 20, '5 windows, then 20 full-bay units');
    const sp = x => arrPos(x.arr, [0.9, 3.3], -1, 'start').map(v => v.toFixed(6)).join(',');
    const t2 = defaultState(); addGlazing(t2); addDevice('h', t2);
    const D = Object.assign(selDevice(t2), { justV: 'start', arr: { along: 'facade', mode: 'spacing', count: 5, spacing: 0.35, len: 2.4, ends: false } });
    const p0 = sp(D); setValue('a.mode', 'count', t2); const p1 = sp(D); setValue('a.mode', 'spacing', t2); const p2 = sp(D);
    check('a shading array: spacing to number and back keeps every member in place', p0 === p1 && p1 === p2 && D.arr.count === 7,
      D.arr.count + ' members, the array closed up to ' + fmt(D.arr.len * 1000, 0) + ' mm');
  }
  // the library: a system from scratch takes a unit; types are linked; a unit broken out of a curtain wall gets a wall of its own
  {
    const t = defaultState(); newSystemHere('scratch', t);
    const empty = !G(t) && !!selCell(t) && !buildBuilding(t).facades.S.rows[0].cell;
    newUnitHere('curtainwall', t); setValue('g.winBy', 'spacing', t); setValue('g.winSp', 1.5, t);
    const cw = buildBuilding(t).facades.S.rows[0];
    t.sel.f = 'N'; useSystem(selCellOf(t, 'S').sys, t);                       // the north side on the same system
    setValue('g.winSp', 2.0, t);                                             // edited on the north side ...
    const linked = buildBuilding(t).facades.S.rows[0].cell.pitch === 2.0;   // ... it changes on the south side too
    t.sel.f = 'S'; t.sel.unit = 4; breakUnit(t); newUnitHere('punched', t);   // one bay of the curtain wall: a punched window
    const row = buildBuilding(t).facades.S.rows[0], q = row.units[4];
    const walls = wallPieces(q.cell, { u0: q.r0, u1: q.r1, v0: 0, v1: 3.6 }).map(p => p.name);
    const n = usage(t);
    check('the library: a system from scratch waits for a unit; types are linked across sides; a bay of curtain wall broken out takes a punched window in a wall of its own',
      empty && cw.cell.run && cw.cell.sill === 0 && Math.abs(cw.cell.head - 3.3) < 1e-9 && linked && !q.cell.run && walls.includes('pier-left') && row.units[3].cell.run && n[t.storeys[0].cells.S.sys] === 2,
      'curtain wall ' + cw.units.length + ' bays glass to glass, under a 300 mm slab; bay 5 punched: ' + walls.join(', '));
  }
  // match all sides: the storey's other sides take the side's glazing and shading, and with floors above, every side above too
  {
    const t = defaultState(); addStorey(t); t.sel.st = 0;
    setValue('matchSides', true, t); addGlazing(t); applyShadingPreset('canopy', t);
    const one = ['N', 'E', 'W'].every(f => t.storeys[0].cells[f] && t.storeys[0].cells[f].shd === t.storeys[0].cells.S.shd) && !t.storeys[1].cells.N;
    setValue('matchGlazing', true, t);
    const all = ['N', 'E', 'S', 'W'].every(f => t.storeys[1].cells[f] && t.storeys[1].cells[f].sys === t.storeys[0].cells.S.sys);
    check('match all sides: the other sides take the glazing and shading at once; with floors above, every side above too', one && all);
  }
  // a member's length: the window's own plus an extension, or outright - switching keeps it as long as it is
  {
    const t = defaultState(); addGlazing(t); setValue('g.winW', 2.0, t); addDevice('h', t);
    const span = () => { const b = buildBuilding(t).facades.S.rows[0].cell.elements[0]; return 2 * b.h[0]; };
    const a = span();                                        // unset: the window's width
    setValue('d.lenX', 0.6, t); const b = span();           // 600 past it
    setValue('g.winW', 1.5, t); const c = span();           // follows the window
    setValue('d.lenRel', false, t); const d = span(), lenAbs = getV('d.len', t);
    setValue('g.winW', 2.5, t); const e = span();           // outright: it stays
    setValue('d.lenRel', true, t); const x = getV('d.lenX', t);
    check('a member is the window’s width plus an extension, following the window, or a length outright; switching keeps its length',
      Math.abs(a - 2.0) < 1e-9 && Math.abs(b - 2.6) < 1e-9 && Math.abs(c - 2.1) < 1e-9 && Math.abs(d - 2.1) < 1e-9 && Math.abs(lenAbs - 2.1) < 1e-9 && Math.abs(e - 2.1) < 1e-9 && Math.abs(x + 0.4) < 1e-9,
      '2000 → +600: 2600 → window 1500: 2100 → outright 2100, window 2500: 2100 → from the window: ' + fmt(x * 1000, 0) + ' mm');
  }
  // saved windows: a window kept by name with its cuts; opened it is the selection, and its cuts move with the shared ones
  {
    const t = defaultState(); applyTypology('midPunched', t);
    t.sel = { f: 'S', st: 3, unit: 2 }; t.cutU = 0.3; t.cutV = 1.4;
    const a = saveWindow(t, 'South level 4');
    t.sel = { f: 'E', st: 1, unit: null }; const other = selectionChanged(t);          // an unsaved window: re-centred by the page
    t.cutU = 0; t.cutV = 1.6;
    const Fa = buildFrame(windowState(t, a), null);                                   // the saved one, drawn while something else is selected
    openWindow(t, a); const back = t.cutU === 0.3 && t.cutV === 1.4 && t.sel.st === 3;
    t.cutU = -0.4; keepCuts(t);                                                       // moved in any view while it is the selection
    t.sel = { f: 'S', st: 3, unit: 2 }; t.activeView = null; selectionChanged(t);     // picked again by clicking the window
    check('a saved window keeps its cuts: drawn apart from the selection, opened it selects its window and cuts, and the cuts moved while it is selected are kept',
      !other && Fa.sel.st === 3 && Fa.sel.unit === 2 && Math.abs(Fa.S.cutU - 0.3) < 1e-9 && back && t.views[0].cutU === -0.4 && t.cutU === -0.4 && t.activeView === a,
      t.views[0].name + ': window 3 of S storey 4, cuts kept apart from the selection');
    const again = saveWindow(t, 'Another name');
    check('a window is saved once: saving it again gives back the saved one', again === a && t.views.length === 1 && t.views[0].name === 'South level 4');
  }
  // the year's shading counts the glass the sun is in front of, so a whole building's far sides do not read as shade
  {
    const t = defaultState(); applyTypology('midPunched', t); t.scope = 'building';
    const T = buildFrame(t, null).T, Hh = hourlyStudy(T);
    let all = 0, faced = 0, n = 0;
    for (let i = 0; i < 8760; i++) if (!Number.isNaN(Hh.fface[i])) { all += Hh.frac[i]; faced += Hh.fface[i]; n++; }
    check('the year’s shading reads the glass the sun is in front of: the whole building is not counted as shade for its far sides',
      n > 3000 && faced / n < all / n - 0.2 && Hh.face.every(x => x >= 0 && x <= 1 + 1e-6),
      'mean shaded ' + fmt(all / n * 100, 0) + '% of all the glass, ' + fmt(faced / n * 100, 0) + '% of the glass facing the sun');
  }
  // the by-law's projection bands, read from VBBL 1.8.9.3, and the glazing check from 10.2.2.3
  {
    const bands = [[2, 12], [3, 12], [6, 12], [8, 12], [6, 8], [8, 8]].map(([h, w]) => projectionAt(h, w).mm).join(',');
    const t = defaultState(); addGlazing(t);
    const F0 = buildFrame(t, null), clean = renderChecks(F0), geo = recGeometry(F0);
    setValue('g.shgc', 0.6, t); const capped = getV('g.shgc', t);
    Object.values(t.lib.units)[0].shgc = 0.4;                 // a design made some other way than the control
    const F = buildFrame(t, null), checks = renderChecks(F);
    check('the by-law: projection allowed by height and street width; SHGC held to 0.36, and glass over it flagged and drawn red',
      bands === '0,500,915,1370,0,915' && capped === 0.36 && !/over 0\.36/.test(clean) && /1 over 0\.36/.test(checks)
        && F.checks.glassOver === 4 && F.checks.glassBad('S', 0, 0) && !F0.checks.glassOver && /Ideal solutions/.test(geo),
      'bands ' + bands + ' mm, SHGC set to 0.6 held at ' + capped + ', ' + F.checks.glassOver + ' units over');
  }
  // the recommendation in n members: each 1/n as deep at 1/n the spacing, the top at the head, the last shading down to the sill
  {
    const t = defaultState(); addGlazing(t); t.doy = 172; t.hour = 14; t.timeMode = 'sol';
    const F = buildFrame(t, null), m = F.m, sol = hSolution(m, F.cur.vsa, 3);
    recUI.nh = 3; recUI.nv = 4;
    const html = recGeometry(F) + recBylaw(F);
    recUI.nh = 1; recUI.nv = 1;
    // the solar heat gain row before the day's and the year's figures are ready
    let early = '';
    try { early = calcGain(F, { ent: 1, bareEnt: 2, dni: 800, cos: .5, lit: 1, shgc: .4, count: 1, A: 2 }, null, null); } catch (e) { early = 'threw ' + e.message; }
    check('the solar heat gain row draws before the day and the year are worked out', /working…/.test(early) && !/threw|NaN|undefined/.test(early), early.slice(0, 80));
    check('the recommendation in n members: the same cut-off from members 1/n as deep, at 1/n the spacing, read against the by-law each at its height',
      Math.abs(sol.d * 3 - sol.Ph) < 1e-9 && Math.abs(sol.zs[0] - m.head) < 1e-9 && Math.abs(sol.zs[2] - sol.pitch - m.sill) < 1e-9
        && /3 louvres at/.test(html) && /4 fins at/.test(html) && /The ideal 3 louvres/.test(html) && !/NaN|undefined/.test(html),
      'Ph ' + fmt(sol.Ph, 3) + ' m, 3 × ' + fmt(sol.d, 3) + ' m at ' + fmt(sol.pitch, 3) + ' m');
  }
  // the stress-test typology: one canopy, read differently by height and by street width; a podium, a step back and an overhang
  {
    const t = defaultState(); applyTypology('demo', t);
    const B = buildBuilding(t), C = siteChecks(t, B), side = (f, st) => { const cs = [...C.map].filter(([k]) => k.startsWith(f + '|' + st + '|')).flatMap(([, v]) => v); return cs.length ? cs.every(x => x.ok) ? 'ok' : cs.every(x => !x.ok) ? 'bad' : 'mixed' : 'none'; };
    const pat = ['S', 'E'].map(f => [0, 1, 2].map(st => side(f, st)).join('/')).join(' ');
    const sF = st => B.facades.S.rows[st].frame.O, yS = st => sF(st)[1];
    const shd = new Set(['S', 'E'].flatMap(f => [1, 2].map(st => t.storeys[st].cells[f].shd)));
    const kinds = new Set(Object.values(t.lib.units).map(u => u.fillW ? 'wall' : 'punched'));
    check('the stress test: the same canopy too deep at grade, fine higher up, the narrow street stricter; stepped back, then overhanging; curtain wall and punched',
      pat === 'bad/ok/ok bad/bad/ok' && shd.size === 1 && yS(3) > yS(2) + 1 && yS(5) < yS(4) - 1 && kinds.size === 2 && t.site.E.width < 10 && t.site.S.width >= 10,
      pat + ' · south faces ' + [0, 2, 3, 4, 5].map(st => yS(st).toFixed(1)).join(', '));
  }
  // under an overhanging storey the section draws the overhang first, the sun ray and the profile angle over it
  {
    const t = defaultState(); applyTypology('demo', t); t.sel = { f: 'S', st: 4, unit: 3 }; t.doy = 172; t.hour = 12; t.timeMode = 'sol';
    const F = buildFrame(t, Object.assign(Object.create(VIEW0), { seccam: { zoom: 1, panX: 0, panY: 0, fit: 'window' } })), svg = drawSection(F, null);
    const iMass = svg.lastIndexOf('var(--shade)'), iRay = svg.indexOf('url(#ar)');
    check('the section draws the storey overhanging the window under the sun ray and the profile angle, not over them',
      (F.m.ctx || []).some(b => b.mass) && iRay > 0 && iMass < iRay, 'overhang at ' + iMass + ', ray at ' + iRay);
  }
  // the name given to a new entry is kept as it is, a number it ends in and all
  {
    const t = defaultState(); addGlazing(t); t.doy = 172; t.hour = 14.5; t.timeMode = 'sol';
    shadingFromIdeal(idealSpec(buildFrame(t, null), 'h'), 'Louvres 600', t);
    check('a name ending in a number is kept as typed', getV('name.shd', t) === 'Louvres 600', getV('name.shd', t));
  }
  // an ideal made a shading system on the window shades the whole glass at its instant, by the ray test
  {
    const run = (dir, n) => {
      const t = defaultState(); addGlazing(t); t.doy = 172; t.hour = 14.5; t.timeMode = 'sol';
      if (dir === 'h') recUI.nh = n; else recUI.nv = n;
      const spec = idealSpec(buildFrame(t, null), dir);
      recUI.nh = 1; recUI.nv = 1;
      const made = shadingFromIdeal(spec, 'My ideal', t), F = buildFrame(t, null);
      const h = Object.values(t.lib.shading).find(x => x.name === 'My ideal');
      return { made, frac: F.cur.frac, named: !!h && F.m.glz.shdId === h.id };
    };
    const rs = [['h', 1], ['h', 4], ['v', 1], ['v', 3]].map(([d, n]) => run(d, n));
    check('an ideal solution made a named shading system on the window shades its glass at that instant, overhang, louvres, fin and fins',
      rs.every(r => r.made && r.named && r.frac > 0.985), rs.map(r => fmt(r.frac * 100, 1) + '%').join(', '));
  }
  // the site: a canopy on the ground floor against a street, then an adjoining property, at its setbacks
  {
    const t = defaultState(); addGlazing(t); applyShadingPreset('canopy', t);       // a 900 mm canopy at a 3.3 m head, on all four south windows
    const bad = () => siteChecks(t, buildBuilding(t)).bad;
    const atLine = bad();                                   // at the street line: 900 mm into the street where 500 is allowed
    setValue('site.S.off', 0.5, t); const set500 = bad();   // set back 500: 400 mm into it
    setValue('site.S.kind', 'property', t); const prop = bad();   // the same 400 mm onto a neighbour
    setValue('site.S.off', 2, t); const inside = bad();
    setValue('rot', 30, t); setValue('site.S.off', 1.25, t);
    const SF = siteFrame(t), fr = buildBuilding(t).facades.S.rows[0].frame, gap = insideBy(SF, 'S', [fr.O[0], fr.O[1]]);
    check('the site: a device past the property line is checked by the street rules, refused over a neighbour, and setbacks hold however the building turns',
      atLine === 4 && set500 === 0 && prop === 4 && inside === 0 && Math.abs(gap - 1.25) < 1e-9, 'not compliant at the line, set back 500 mm, onto a neighbour, set back 2 m: ' + [atLine, set500, prop, inside].join(', '));
  }
  // a window broken from its array, moved along its bay, and held inside it
  {
    const t = defaultState(); addGlazing(t); setValue('g.winW', 2.0, t); t.sel.unit = 1; breakUnit(t);
    setValue('g.offU', 1.5, t);
    const c1 = buildBuilding(t).facades.S.rows[0].units[1].cell;
    setValue('g.offU', 9, t);
    const c2 = buildBuilding(t).facades.S.rows[0].units[1].cell, room = (7.5 - 2.0) / 2;
    check('a broken window moves along its bay, the section cut with it, and stops at the bay\'s edge',
      Math.abs(c1.opening.u0 - 0.5) < 1e-9 && Math.abs(c2.opening.u1 - (room + 1.0)) < 1e-9 && c2.notes.some(x => /inside its bay/.test(x)) && t.cutU === 9 - 0 && c1.elements.length === 0,
      'moved 1500 mm, then held at ' + fmt(room * 1000, 0) + ' mm');
  }
  // the sun handles: an angle asked for is found as a date and a time
  {
    const t = defaultState(); t.doy = 100; t.timeMode = 'sol';
    const sp = solarPosition(120, 10.5, 'sol'), r = pickSunAt(t, sp.alt, sp.az), back = solarPosition(r.doy, r.hour, 'sol');
    const hi = pickSunAt(t, 80, 180), hs = solarPosition(hi.doy, hi.hour, 'sol');
    check('a sun asked for by altitude and azimuth is found on the side of the year already set; one out of reach snaps to the nearest',
      Math.abs(back.alt - sp.alt) < 0.3 && Math.abs(back.az - sp.az) < 0.5 && r.doy < 172 && hs.alt > 63 && Math.abs(hi.doy - 172) < 8,
      'asked β ' + fmt(sp.alt, 1) + '°, got ' + fmt(back.alt, 1) + '° on day ' + r.doy + ' · asked 80°, got ' + fmt(hs.alt, 1) + '°');
  }
  // the sun typed in by its angles: the other one held, the date and time found
  {
    const t = defaultState(); t.doy = 120; t.hour = 10; t.timeMode = 'sol';
    const az0 = getV('sunAz', t);
    setValue('sunAlt', 40, t);
    const a1 = getV('sunAlt', t), z1 = getV('sunAz', t);
    setValue('sunAz', 30, t);
    const a2 = getV('sunAlt', t), z2 = getV('sunAz', t);
    check('the sun typed in by altitude or azimuth moves the date and time, holding the other angle',
      Math.abs(a1 - 40) < 0.4 && Math.abs(z1 - az0) < 1 && Math.abs(z2 - 30) < 0.6 && Math.abs(a2 - a1) < 0.6,
      'β 40° → ' + fmt(a1, 1) + '° at ' + fmt(z1, 1) + '°; azimuth 30° → ' + fmt(z2, 1) + '° at β ' + fmt(a2, 1) + '°');
  }
  // the plan's floor lit through every window the results are for
  {
    const t = defaultState(); applyTypology('midPunched', t); t.doy = 355; t.hour = 11; t.scope = 'unit';
    const Fu = buildFrame(t, null), Ru = roomOf(Fu.m, t);
    const one = floorTotalAll(Fu, lightUnits(Fu), Ru, 'clear', 'gw10', 'day', t.doy, 'sol'), ref = floorTotal(Fu.m, Ru, 'clear', 'gw10', 'day', t.doy, 'sol');
    const same = one.v.length === ref.v.length && one.v.every((x, i) => Math.abs(x - ref.v[i]) < 1e-6);
    // every window of the side: the floor takes what each window puts on it, window by window
    t.scope = 'storey';
    const Fs = buildFrame(t, null), Us = lightUnits(Fs), all = floorTotalAll(Fs, Us, Ru, 'clear', 'gw10', 'day', t.doy, 'sol');
    const cellA = all.du * all.dw, sumAll = all.v.reduce((a, b) => a + b, 0) * cellA;
    let sumEach = 0;
    for (const x of Us) { const g = floorTotal(x.m, x.R, 'clear', 'gw10', 'day', t.doy, 'sol'); sumEach += g.v.reduce((a, b) => a + b, 0) * g.du * g.dw; }
    t.scope = 'level';
    const Fl = buildFrame(t, null), Ul = lightUnits(Fl);
    check("the plan's floor: through the selected window it is the window's own map; through the whole side it holds what each window puts on it",
      same && Us.length === 15 && Math.abs(sumAll / sumEach - 1) < 0.03 && Ul.length === 44,
      fmt(sumAll / 1000, 1) + ' kWh on the floor from ' + Us.length + ' windows, ' + fmt(sumEach / 1000, 1) + ' kWh window by window');
  }
  // a storey that stands out past the one below shades it, as an overhang of that depth
  {
    const t = defaultState(); addGlazing(t); setValue('g.winN', 1, t); addStorey(t);
    t.storeys[1].d = 20;                                  // 1 m out past storey 1 on the S side
    t.sel = { f: 'S', st: 0, unit: null };
    const Fm = buildFrame(t, null), m = Fm.m, P = 1.0, gap = t.storeys[0].h - m.head;
    let worst = 0;
    for (const th of [20, 35, 45, 60]) {
      const sl = [0, Math.sin(th * Math.PI / 180), Math.cos(th * Math.PI / 180)];
      const want = Math.min(1, Math.max(0, (P * Math.tan(th * Math.PI / 180) - gap) / m.winH));
      worst = Math.max(worst, Math.abs(shadeFraction(m, sl, 61, 97).frac - want));
    }
    const plain = defaultState(); addGlazing(plain); setValue('g.winN', 1, plain); addStorey(plain); plain.sel = { f: 'S', st: 0, unit: null };
    check('an overhanging storey shades the one below as a 1 m overhang would', worst < 0.012 && buildFrame(plain, null).m.ctx.length === 0 && m.ctx.some(b => b.mass),
      'worst ' + fmt(worst * 100, 2) + '% of the glass, against Ph = P tan θ');
  }
}

/* ---------- 7  a worked example and the energy ---------- */
section('7. A worked example and the energy');
{
  // the worked overhang: early August, 10:00 solar time, a window 20 deg east of south, h = 1.5 m
  const s = defaultState(); applyCase(0, s);
  const F = buildFrame(s, null), c = F.cur;
  const gamL = -c.gamma, Ph = 1.5 / Math.tan(c.vsa * Math.PI / 180);
  check('the worked overhang: beta, gamma, theta and Ph as the hand method finds them',
    Math.abs(c.alt - 49) < 1 && Math.abs(gamL - 27.5) < 3 && Math.abs(c.vsa - 53) < 1 && Math.abs(Ph - 1.13) < 0.05,
    `β ${fmt(c.alt, 1)}° (by hand 49°), γ ${fmt(gamL, 1)}° (25°), θ ${fmt(c.vsa, 1)}° (53°), Ph ${fmt(Ph, 2)} m (1.13 m)`);
  check('the worked overhang: the overhang sized to Ph shades the whole window at that instant', F.res.frac > 0.999, fmt(F.res.frac * 100, 2) + '% shaded');
  check('the building’s north offset turns the facade: 20° west of north faces it 20° east of south', wrap180(getV('rot', s)) === -20 && Math.abs(wrap180(F.cur.gf - 180) + 20) < 1e-9);

  // the ASHRAE clear-sky beam, against its own coefficients on the 21sts
  const worst = Math.max(Math.abs(clearDNI(172, 90) - 1088 * Math.exp(-0.205)), Math.abs(clearDNI(355, 30) - 1233 * Math.exp(-0.142 / 0.5)));
  const mid = clearDNI(187, 60), lo = clearDNI(172, 60), hi = clearDNI(202, 60);
  check('clear-sky beam: ASHRAE A exp(-B / sin beta), interpolated between the 21sts', worst < 1e-9 && mid <= Math.max(lo, hi) && mid >= Math.min(lo, hi),
    `21 Jun at the zenith ${fmt(clearDNI(172, 90), 1)} W/m², 21 Dec at 30° ${fmt(clearDNI(355, 30), 1)} W/m²`);
  const tw = Math.max(...[0, 5, 11].map(mo => { const d = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349][mo]; return Math.abs(typicalDNI('gw10', d, 12.5) - CLIMATE.gw10.dni[mo][12]); }));
  check('typical beam: the weather file\'s mean hour, read at the half hours', tw < 1e-9);

  // gains add up: a storey of identical, unshaded units is n times one of them
  const s2 = defaultState(); addGlazing(s2);
  const B2 = buildBuilding(s2), T1 = analysisTarget(B2, resolveSel(s2, B2), 'unit'), T4 = analysisTarget(B2, resolveSel(s2, B2), 'storey');
  const g1 = targetGain(T1, 40, 190, 800), g4 = targetGain(T4, 40, 190, 800);
  check('direct gain is summed over units, not averaged', Math.abs(g4.ent - 4 * g1.ent) < 1e-9 && g1.ent > 0, fmt(g1.ent, 1) + ' W a unit, ' + fmt(g4.ent, 1) + ' W for four');
  const um = T1.items[0].m, sl = sunLocal(40, 190, um.gf), ug = unitGain(um, sl, 800);
  check('entering = DNI x cos i x sunlit glass x SHGC', Math.abs(ug.ent - 800 * sl[2] * um.winW * um.winH * 0.36) < 1e-9, fmt(ug.ent, 1) + ' W');
  const dg = dayGain(T1, 'clear', 'gw10', 172, 'sol');
  check('a day is the quarter hours summed', Math.abs(dg.wh - dg.pts.slice(0, 96).reduce((a, p) => a + p.ent * 0.25, 0)) < 1e-6 && dg.whBare >= dg.wh);
  const d0 = defaultState(), B0 = buildBuilding(d0);
  check('no glazing, no gain', analysisTarget(B0, resolveSel(d0, B0), 'unit').items.length === 0 && targetGain(analysisTarget(B0, resolveSel(d0, B0), 'unit'), 40, 180, 800).ent === 0);

  // the weather files, hour by hour: 8760 records, and the monthly means they condense to
  let hw = 0;
  for (const wx of ['gw10', 'gw20']) {
    const hr = hourly(wx);
    for (const mo of [0, 6]) for (const h of [9, 13]) {
      const days = CLIMATE[wx].ndays[mo], start = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334][mo];
      let a = 0; for (let d = 0; d < days; d++) a += hr.dni[(start + d) * 24 + h];
      hw = Math.max(hw, Math.abs(a / days - CLIMATE[wx].dni[mo][h]));
    }
  }
  check('the hourly weather condenses to the monthly means the tool used to carry', hourly('gw10').dni.length === 8760 && hw < 0.51, 'worst ' + fmt(hw, 2) + ' W/m²');
  check('a recorded hour reads back at its half hour', recordAt('gw10', 'dni', 200, 13.5) === hourly('gw10').dni[199 * 24 + 13]);
  // the year, hour by hour: the two weather skies agree over a year, and the hours sum
  const Hh = hourlyStudy(T1), ya = yearGain(Hh, 'average', 'gw10'), yr = yearGain(Hh, 'recorded', 'gw10'), yc = yearGain(Hh, 'clear', 'gw10');
  let sumR = 0; for (let i = 0; i < 8760; i++) sumR += hourly('gw10').dni[i] * Hh.ent[i] / 1000;
  check('a year of direct gain is the 8760 hours summed', Math.abs(yr.ent - sumR) < 1e-6 && yc.ent > yr.ent && Math.abs(ya.bare - yr.bare) / yr.bare < 0.1,
    `clear ${fmt(yc.ent, 0)}, average ${fmt(ya.ent, 0)}, recorded ${fmt(yr.ent, 0)} kWh`);

  // the beam through the glass is all accounted for inside: floor, walls and,
  // for a punched opening in a thick wall, the inside of the reveal
  for (const [name, setup, hr, doy] of [
    ['window wall, no inner reveal, winter', st => { addGlazing(st); wallOf(st, 'windowwall'); setValue('g.reveal', 0, st); }, 11, 355],
    ['punched in a 280 mm wall, summer', st => { addGlazing(st); }, 12, 172],
    ['west fins, autumn afternoon', st => applyCase(2, st), 17, 264]]) {
    const st = defaultState(); setup(st); st.hour = hr; st.doy = doy;
    const Fm = buildFrame(st, null), m = Fm.m, R = roomOf(m, st), { dni } = beamAt('clear', 'gw10', doy, hr, st.timeMode);
    const enter = unitGain(m, Fm.cur.sl, dni, 201, 161).ent, L = landing(m, R, Fm.cur.sl, dni, reachRegion(m, R, [doy]));
    const tight = m.type !== 'punched';
    check('energy balance inside: ' + name, tight ? Math.abs(L.total - enter) / enter < 0.03 : L.total <= enter * 1.03 && L.total > 0,
      `${fmt(enter, 0)} W through the glass, ${fmt(L.total, 0)} W landing in the room` + (tight ? '' : `, ${fmt(enter - L.total, 0)} W on the inside of the reveal`));
  }
  // the crisp floor patch and the traced floor agree
  const s3 = defaultState(); addGlazing(s3); wallOf(s3, 'windowwall'); setValue('g.reveal', 0, s3); s3.hour = 11; s3.doy = 355;
  const F3 = buildFrame(s3, null), R3 = roomOf(F3.m, s3), { dni: dn3 } = beamAt('clear', 'gw10', 355, 11, 'sol');
  const fl = sunPatches(F3.m, R3, F3.cur.sl).find(p => p.S.key === 'floor');
  const area = poly => Math.abs(poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  const Wpoly = fl ? area(fl.lit) * dn3 * F3.m.shgc * F3.cur.sl[1] : 0, Wgrid = landing(F3.m, R3, F3.cur.sl, dn3, reachRegion(F3.m, R3, [355])).by.floor || 0;
  // open plan: the floor runs to the building's other walls, and the view reaches as far as the sun does
  const Rg3 = reachRegion(F3.m, R3, [355]);
  check('open plan: the interior is the storey, to the building\'s other walls', Math.abs(R3.w1 - R3.w0 - (18 - 0.3 - 0.024)) < 1e-9 && Math.abs(R3.u1 - R3.u0 - (30 - 0.6)) < 1e-9,
    fmt(R3.u1 - R3.u0, 1) + ' × ' + fmt(R3.w1 - R3.w0, 1) + ' m');
  const fl3 = fl ? Math.min(...fl.lit.map(q => q[1])) : 0;
  check('the region shown reaches past the deepest patch of the day', Rg3.w0 <= fl3 + 1e-9 && Rg3.w0 >= R3.w0 - 1e-9, 'patch to ' + fmt(fl3, 1) + ' m, shown to ' + fmt(Rg3.w0, 1) + ' m');
  check('the floor patch drawn and the floor traced carry the same energy', fl && Math.abs(Wpoly - Wgrid) / Wpoly < 0.03, fmt(Wpoly, 0) + ' W drawn, ' + fmt(Wgrid, 0) + ' W traced');

  // a tall building: hundreds of distinct units share their ray samples by glass, and the sums still hold
  {
    const sb = defaultState(); applyTypology('balcTower', sb); sb.scope = 'facade';
    const Bb = buildBuilding(sb), selb = resolveSel(sb, Bb);
    const Tsh = analysisTarget(Bb, selb, 'facade'), Tfi = analysisTarget(buildBuilding(sb), selb, 'facade');
    Tfi.items.forEach(x => { x.m.grid = null; });
    let gS = 0, gF = 0;
    for (const doy of [80, 172, 264, 355]) for (const h of [9, 12, 15]) {
      const sp = solarPosition(doy, h, 'sol'); if (sp.alt <= 2) continue;
      gS += targetGain(Tsh, sp.alt, sp.az, 800, 7, 5).ent; gF += targetGain(Tfi, sp.alt, sp.az, 800, 15, 11).ent;
    }
    check('a 30-storey balcony tower: shared sampling sums to the fine-grid gain', Tsh.items.length > 24 && Math.abs(gS / gF - 1) < 0.03,
      Tsh.items.length + ' distinct units, ' + fmt(100 * (gS / gF - 1), 1) + '% against a 15 × 11 grid on every unit');
  }}

/* ---------- report ---------- */
console.log(`\n${fail ? 'FAILURES' : 'ALL PASS'}  ${pass} passed, ${fail} failed${skipped ? ', ' + skipped + ' skipped' : ''}`);
process.exit(fail ? 1 : 0);
