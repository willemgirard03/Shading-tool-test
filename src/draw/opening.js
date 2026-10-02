/* One glazing unit as faces for the hidden-surface tree - the same assembly for
   the window view and for every unit of the building view.

   The glazing is a group of faces in one plane, kept in this order, which the
   tree preserves: the glass itself in shade, the patch of it the reveal lets the
   beam reach, the shadows the elements throw over that, and the outline. The
   wall comes from the cell; every element contributes its six faces. Across a
   window wall or curtain wall the glass runs on past the unit, so the window
   view lays the neighbouring panes in beside it, unanalysed.               */

import { wallFaces, revealLit } from '../geometry/cell.js';
import { boxFaces } from '../geometry/boxes.js';
import { glassShadowsOf } from '../geometry/shadows.js';
import { bpoly } from '../geometry/bsp.js';

export const GLASS_GROUP = ['glassN', 'glass', 'lit', 'shadow', 'opening'];
export const BACK_KINDS = ['wall', 'spandrel', 'cut', 'return', ...GLASS_GROUP];

/** every shadow the elements throw on the glass, clipped to it */
export const glassShadows = (m, sl) => glassShadowsOf(m, sl);

export function openingFaces(m, cur, rect, withCuts, elements = m.elements) {
  const o = m.opening, up = [0, 0, 1], out = [];
  const quad = (u0, u1, v0, v1) => [[u0, v0, 0], [u1, v0, 0], [u1, v1, 0], [u0, v1, 0]];
  if (m.run) {
    // a unit filling its bay runs on glass to glass: the panes either side, to the edge of the patch, each with its mullion line
    for (let u = o.u0 - m.pitch; u + m.pitch > rect.u0 + 1e-9; u -= m.pitch) {
      const a = Math.max(u, rect.u0);
      out.push(bpoly(quad(a, u + m.pitch, o.v0, o.v1), up, 'glassN'));
    }
    for (let u = o.u1; u < rect.u1 - 1e-9; u += m.pitch) {
      const b = Math.min(u + m.pitch, rect.u1);
      out.push(bpoly(quad(u, b, o.v0, o.v1), up, 'glassN'));
    }
  }
  out.push(bpoly(quad(o.u0, o.u1, o.v0, o.v1), up, 'glass'));
  if (cur.onFacade) {
    const lit = revealLit(m, cur.sl);
    if (lit) out.push(bpoly(quad(lit.u0, lit.u1, lit.v0, lit.v1), up, 'lit'));
    (glassShadows(m, cur.sl) || []).forEach(p => out.push(bpoly(p.map(([u, v]) => [u, v, 0]), up, 'shadow')));
  }
  out.push(bpoly(quad(o.u0, o.u1, o.v0, o.v1), up, 'opening'));
  for (const f of wallFaces(m, rect, withCuts)) out.push(bpoly(f.pts, f.n, f.kind));
  for (const b of elements) for (const f of boxFaces(b)) out.push(bpoly(f.pts, f.n, b.ctx ? 'ctx' : 'dev', { sys: b.sys }));
  return out;
}

/** a storey with no glazing, as the one face a drawing needs */
export function blankFaces(rect, withCuts, wallT) {
  const { u0, u1, v0, v1 } = rect, out = [bpoly([[u0, v0, 0], [u1, v0, 0], [u1, v1, 0], [u0, v1, 0]], [0, 0, 1], 'wall')];
  if (withCuts) {
    const cor = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    for (let i = 0; i < 4; i++) {
      const a = cor[i], b = cor[(i + 1) % 4], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      out.push(bpoly([[a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], -wallT], [a[0], a[1], -wallT]], [dy / len, -dx / len, 0], 'cut'));
    }
  }
  return out;
}
