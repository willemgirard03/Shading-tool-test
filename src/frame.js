/* One frame of the tool: the building, the selected condition, the analysis
   target, the instant and the headline figure, built once from the state and
   handed to every drawing and panel.                                        */

import { monthDayOf } from './util.js';
import { solarAt } from './solar.js';
import { buildBuilding, resolveSel, unitModel, analysisTarget, blankCell } from './geometry/building.js';
import { shadeFraction } from './geometry/analysis.js';
import { clampCuts } from './draw/detail.js';
import { siteChecks } from './geometry/site.js';

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
  return { S, V, B, sel, m, T, cur, res, light, checks, date: monthDayOf(S.doy) };
}
