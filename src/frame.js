/* One frame of the tool: the building, the selected condition, the analysis
   target, the instant and the headline figure, built once from the state and
   handed to every drawing and panel.                                        */

import { monthDayOf } from './util.js';
import { solarAt } from './solar.js';
import { buildBuilding, resolveSel, unitModel, analysisTarget, blankCell } from './geometry/building.js';
import { shadeFraction } from './geometry/analysis.js';
import { clampCuts } from './draw/detail.js';
import { siteChecks } from './geometry/site.js';
import { selDevice } from './state.js';
import { entryName } from './library.js';

/** `light` is a drag or an animation frame: the headline is sampled a little
 *  more coarsely, and nothing else changes */
export function buildFrame(S, V, light = false) {
  const B = buildBuilding(S);
  const sel = resolveSel(S, B);
  const m = sel.row.cell ? unitModel(B, sel.f, sel.st, sel.unit) : blankCell(sel.row.h, sel.fac.gf);
  clampCuts(S, m);
  const T = analysisTarget(B, sel, S.scope);
  const cur = solarAt(S.doy, S.hour, S.timeMode, sel.fac.gf);
  const res = m.opening ? shadeFraction(m, cur.sl, light ? 41 : 61, light ? 33 : 49) : null;
  cur.frac = res ? res.frac : 1;
  // every device on the building, read against the site boundary and the by-law
  const checks = siteChecks(S, B);
  // what the plan's and the section's grips edit: the selected window's unit type and its selected device - each a type, shared
  // what is picked on a plan or a section - the window and its wall, or a device - is what shows its handles
  const selD = m.opening && S.pick === 'device' ? selDevice(S) : null;
  return { S, V, B, sel, m, T, cur, res, light, checks, selD, pick: m.opening ? S.pick || null : null, editing: editingWords(S, B, m, selD), date: monthDayOf(S.doy) };
}
/* A grip or a typed figure in the plan or the section edits a type: the
   window's glazing unit, the selected shading device. Every window that uses
   it changes with it, so the drawing says which, and how many. */
function editingWords(S, B, m, D) {
  if (!m.opening || !m.glz || !S.lib) return '';
  let nu = 0, nd = 0;
  for (const fc of Object.values(B.facades)) for (const r of fc.rows) for (const q of r.units) {
    const g = q.cell.glz;
    if (g && g.unitId === m.glz.unitId) nu++;
    if (D && g && (g.devices || []).includes(D)) nd++;
  }
  const many = n => n + (n === 1 ? ' window' : ' windows');
  return 'editing glazing unit ' + entryName(S, 'units', m.glz.unitId) + ' (' + many(nu) + ')'
    + (D ? ' · shading device ' + (D.name || (D.dir === 'v' ? 'fin' : 'blade')) + ' (' + many(nd) + ')' : '');
}
