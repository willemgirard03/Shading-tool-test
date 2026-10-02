/* Rhino export: real .3dm geometry on named layers, in millimetres and world
   axes (Z up, +Y north), with the design parameters carried inside the file.

   openNURBS is the file format and the data structures, not the modelling
   kernel: no booleans, no offsets, no planar face with a hole. So nothing is
   cut. The wall leaves as the pieces the model already decomposes it into, and
   every solid - wall, glazing, element - leaves as an extrusion of its own base
   quad along its own axis, which is the only way openNURBS will write a box that
   is not axis aligned. Everything comes from the same model the drawings and the
   ray test read, so the file cannot drift from what the tool reports.       */

import { fmt, dateLabel, hhmm } from '../util.js';
import { buildBuilding, resolveSel, unitModel, toWorld, facadeAzimuth, FACADES } from '../geometry/building.js';
import { wallPieces, glazingBox, GLAZING_KEYS, BLANK_WALL_T } from '../geometry/cell.js';
import { boxCorners, aaBox } from '../geometry/boxes.js';
import { DEVICE_KEYS, deviceLabel } from '../geometry/device.js';
import { shadeFraction } from '../geometry/analysis.js';
import { solarAt } from '../solar.js';
import { flatGlazing } from '../library.js';

/* Run as a project, rhino3dm is served from node_modules and works offline; as
   the single-file build it comes from the CDN, the first time only. The paths
   are held in variables so the bundler leaves them for the browser to resolve. */
const LOCAL = 'node_modules/rhino3dm/rhino3dm.module.min.js';
const CDN = 'https://cdn.jsdelivr.net/npm/rhino3dm@8.4.0/rhino3dm.module.min.js';
let lib = null;
/** where rhino3dm was loaded from, once it has been */
export let rhinoSource = null;
export function loadRhino() {
  if (lib) return lib;
  // resolved against the page, not this module, or it looks in src/export/
  const local = new URL(LOCAL, document.baseURI).href, cdn = CDN;
  lib = import(local).then(mod => { rhinoSource = 'local'; return mod; })
    .catch(() => import(cdn).then(mod => { rhinoSource = 'CDN'; return mod; }))
    .then(mod => mod.default());
  lib.catch(() => { lib = null; });       // a failed fetch must not be cached
  return lib;
}

const M = 1000;                           // metres to millimetres
const LAYER_COLOURS = { 'A-WALL': [176, 168, 152], 'A-SPAN': [140, 150, 150], 'A-GLAZ': [122, 168, 186], 'A-SUN': [217, 130, 26] };

/** a facade-coordinate box as an extrusion: its -e3 face, the direction of e3
 *  in world axes, and twice its half-thickness */
function solidOf(b, fr, cc, zb, rev, layer, name) {
  const k = boxCorners(b);                // 0-3 is the -e3 face
  const w = p => toWorld(fr, cc + p[0], zb + p[1], p[2], rev).map(x => x * M);
  const e3 = b.e3, dir = [0, 1, 2].map(i => fr.U[i] * e3[0] + fr.V[i] * e3[1] + fr.W[i] * e3[2]);
  return { layer, name, base: k.slice(0, 4).map(w), dir, dist: 2 * b.h[2] * M };
}

export const EXPORT_SCOPES = { unit: 'unit', storey: 'storey', level: 'storey all round', facade: 'side', building: 'building' };

/** the model as plain data, so nothing here depends on rhino3dm. Every cell in
 *  scope leaves as its units - wall pieces, glazing, members - with the plain
 *  wall a spaced layout leaves at the ends, and a storey of a side with no
 *  glazing as one slab of blank wall. The scopes follow the chart's: a unit, a
 *  storey of one side, a storey all round, one side, the whole building.    */
export function exportModel(S, scope) {
  const B = buildBuilding(S), sel = resolveSel(S, B);
  const solids = [], curves = [], layers = [['A-WALL', LAYER_COLOURS['A-WALL']]], used = new Set();
  const layer = (name, c) => { if (!used.has(name)) { used.add(name); if (name !== 'A-WALL') layers.push([name, c]); } return name; };
  used.add('A-WALL');
  const allRound = scope === 'building' || scope === 'level', oneStorey = scope === 'unit' || scope === 'storey' || scope === 'level';
  const sides = allRound ? Object.keys(FACADES) : [sel.f];
  const slug = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let units = 0;
  for (const f of sides) {
    const fac = B.facades[f];
    for (const r of fac.rows) {
      const fr = r.frame;
      if (oneStorey && r.st !== sel.st) continue;
      const tagR = f + (r.st + 1);
      if (!r.cell) {
        if (scope === 'unit') continue;
        solids.push(solidOf(aaBox(-r.len / 2, r.len / 2, 0, r.h, -BLANK_WALL_T, 0), fr, 0, r.zb, 0, 'A-WALL', 'wall-' + tagR));
        continue;
      }
      const c = r.cell;
      if (scope !== 'unit') r.ends.forEach(([a, b], k) => solids.push(solidOf(aaBox(a, b, 0, r.h, c.reveal - Math.max(c.wallT, 0.2), c.reveal),
        fr, 0, r.zb, c.reveal, 'A-WALL', 'wall-end-' + tagR + '-' + (k + 1))));
      for (const q of r.units) {
        const rect = { u0: q.r0, u1: q.r1, v0: 0, v1: r.h };
        if (scope === 'unit' && q.i !== sel.unit) continue;
        const tag = '-' + tagR + '-' + (q.i + 1);
        units++;
        const qc = q.cell;
        for (const p of wallPieces(qc, rect)) solids.push(solidOf(p, fr, q.cc, r.zb, qc.reveal,
          layer(p.role === 'spandrel' ? 'A-SPAN' : 'A-WALL', LAYER_COLOURS['A-SPAN']), p.name + tag));
        solids.push(solidOf(glazingBox(qc), fr, q.cc, r.zb, qc.reveal, layer('A-GLAZ', LAYER_COLOURS['A-GLAZ']), 'glazing' + tag));
        for (const { D, i, boxes } of qc.live) {
          const L = layer('A-SHADE-' + (i + 1), [58, 78, 74]);
          boxes.forEach((b, bi) => solids.push(solidOf(b, fr, q.cc, r.zb, qc.reveal, L,
            slug(deviceLabel(D)) + tag + '-' + String(bi + 1).padStart(2, '0'))));
        }
      }
    }
  }

  // the beam this study is about, from the middle of the selected unit's glass
  const cur = solarAt(S.doy, S.hour, S.timeMode, sel.fac.gf);
  const um = sel.row.cell ? unitModel(B, sel.f, sel.st, sel.unit) : null;
  if (cur.onFacade && um) {
    layer('A-SUN', LAYER_COLOURS['A-SUN']);
    const fr = sel.row.frame, v0 = (um.sill + um.head) / 2;
    const at = (u, v, w) => toWorld(fr, um.cc + u, um.zb + v, w, um.reveal).map(x => x * M);
    curves.push({ layer: 'A-SUN', name: 'sun ' + dateLabel(S.doy) + ' ' + hhmm(S.hour),
      pts: [at(0, v0, 0), at(cur.sl[0] * 6, v0 + cur.sl[1] * 6, cur.sl[2] * 6)] });
  }

  const res = um ? shadeFraction(um, cur.sl, 61, 49) : null;
  return { layers, solids, curves, scope, info: {
    tool: 'Vancouver Solar Shading Explorer 7', units: 'mm', axes: 'world, Z up, +Y north; wall face on the plate line',
    site: '49.19N 123.18W', northOffset: S.rot || 0,
    selected: { side: sel.f, storey: sel.st + 1, unit: sel.unit === null ? null : sel.unit + 1, facadeAzimuth: +fmt(facadeAzimuth(S, sel.f), 2) },
    date: dateLabel(S.doy), doy: S.doy, hour: S.hour, timeMode: S.timeMode, weather: S.wx,
    library: S.lib, savedWindows: S.views || [],
    storeys: S.storeys.map((s, i) => ({ storey: i + 1, height: s.h, slab: s.slab, plate: { width: s.w, depth: s.d, rotation: s.rot || 0, rotationFrom: s.rotRel || 'building', offsetEast: s.ox || 0, offsetNorth: s.oy || 0, offsetAlong: s.oxyIn || 'own' }, sides: Object.fromEntries(Object.entries(s.cells).map(([f, r]) => [f, r && flatGlazing(S, r)]).filter(([, g]) => g).map(([f, g]) =>
      [f, Object.assign(Object.fromEntries(GLAZING_KEYS.map(k => [k, g[k]])), { devices: g.devices.map(D => Object.fromEntries(DEVICE_KEYS.map(k => [k, D[k]]))) })])) })),
    shadedFraction: res ? +res.frac.toFixed(6) : null, unitsWritten: units, scope
  } };
}

/** a closed polyline curve wound so that its own normal points the way we mean
 *  to extrude. Get this wrong and every solid lands one thickness out. */
function profile(rhino, pts, dir) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const use = (nx * dir[0] + ny * dir[1] + nz * dir[2]) < 0 ? pts.slice().reverse() : pts;
  const pl = new rhino.Polyline();
  for (const q of use) pl.add(q[0], q[1], q[2]);
  pl.add(use[0][0], use[0][1], use[0][2]);
  const crv = pl.toPolylineCurve();
  try { pl.delete(); } catch (e) { /* not every build exposes delete */ }
  return crv;
}
const openCurve = (rhino, pts) => {
  const pl = new rhino.Polyline();
  for (const q of pts) pl.add(q[0], q[1], q[2]);
  const crv = pl.toPolylineCurve();
  try { pl.delete(); } catch (e) { }
  return crv;
};

/** WASM objects are not garbage collected, so every intermediate is freed */
export function writeRhino(rhino, model) {
  const free = o => { try { o.delete(); } catch (e) { } };
  const file = new rhino.File3dm();
  file.settings().modelUnitSystem = rhino.UnitSystem.Millimeters;
  file.applicationName = 'Vancouver Solar Shading Explorer 5';
  file.applicationDetails = 'Preliminary shading geometry. Solids only; nothing is boolean cut.';
  const idx = {};
  for (const [name, c] of model.layers) {
    if (idx[name] !== undefined) continue;
    const L = new rhino.Layer();
    L.name = name; L.color = { r: c[0], g: c[1], b: c[2], a: 255 };
    idx[name] = file.layers().add(L);
    free(L);
  }
  const attr = (layer, name) => { const a = new rhino.ObjectAttributes(); a.layerIndex = idx[layer]; a.name = name; return a; };
  let solids = 0, curves = 0, failed = 0;
  for (const sd of model.solids) {
    const crv = profile(rhino, sd.base, sd.dir);
    const ex = rhino.Extrusion.create(crv, sd.dist, true);
    free(crv);
    if (!ex) { failed++; continue; }
    const a = attr(sd.layer, sd.name);
    file.objects().addExtrusion(ex, a);
    free(ex); free(a); solids++;
  }
  for (const cv of model.curves) {
    const crv = openCurve(rhino, cv.pts), a = attr(cv.layer, cv.name);
    file.objects().addCurve(crv, a);
    free(crv); free(a); curves++;
  }
  file.strings().set('VSSE.params', JSON.stringify(model.info));
  const bytes = file.toByteArray();
  free(file);
  return { bytes, solids, curves, failed };
}

/** the whole export, from state to a download */
export async function exportRhino(S, say) {
  say('Fetching rhino3dm…');
  const rhino = await loadRhino();
  say('Building the model…');
  const model = exportModel(S, S.expScope);
  const { bytes, solids, curves, failed } = writeRhino(rhino, model);
  const sel = model.info.selected;
  const name = 'shading-' + ({ building: 'building', level: 'storey' + sel.storey, facade: sel.side }[model.scope]
    || sel.side + sel.storey + (model.scope === 'unit' ? '-' + sel.unit : '')) + '.3dm';
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  say(name + ' · ' + solids + ' solids, ' + curves + ' curve' + (curves === 1 ? '' : 's') + ', '
    + new Set(model.layers.map(l => l[0])).size + ' layers, ' + Math.round(bytes.length / 1024) + ' kB'
    + (failed ? ' · ' + failed + ' could not be built' : '') + ' · millimetres, world axes · rhino3dm from ' + (rhinoSource === 'local' ? 'this folder' : 'the CDN') + '.');
}
