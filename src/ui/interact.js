/* Dragging in the drawings: the sun and the clock on the chart, the bearing
   handle, the cut tabs in the window view, orbit, pan and zoom, turning the
   building, and clicking a window in the building view to select it. */

import { clamp, wrap360, wrap180 } from '../util.js';
import { solarPosition, sunVec } from '../solar.js';
import { sunSamples, pickSunAt } from '../sunpick.js';
import { FACADES, MULTI, facadeAzimuth, buildBuilding, resolveSel, unitModel, blankCell, faceOffset, plateMax, contextPlace, storeyCentre, storeyRot } from '../geometry/building.js';
import { AXCAM0, DETCAM0 } from '../view.js';
import { setValue, getValue, contextSnaps } from '../state.js';
import { sunGeom, bearing, dayStrip } from '../draw/sunpath.js';
import { yearGeom } from '../draw/sunyear.js';
import { detailCamera, cutLimits, cutPlanes } from '../draw/detail.js';
import { axonCamera } from '../draw/axon.js';
import { zoomAt, SHEETCAM0 } from '../draw/sheetcam.js';
import { setSheet } from '../draw/svg.js';

/* The 3D views' buttons: the left button selects, and drags what it is
   pressed on - the sun, a handle, a massing; the right button orbits (with
   Shift, pans - for a trackpad); the middle button pans; the wheel zooms. A
   left drag on nothing moves nothing. */
/** how far a point stands from a segment, on the sheet */
const segDist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
export const camMode = e => e.button === 1 || (e.button === 2 && e.shiftKey) ? 'pan' : e.button === 2 ? 'orbit' : 'click';
/** the middle button's own scrolling kept off a 3D view, so its drag pans the view instead */
const noAutoScroll = el => el.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });

/** pointer position in the drawing frame of a view, whatever size its sheet is drawn at */
export function viewPoint(host, e) {
  const svg = host.querySelector('svg');
  if (!svg) return null;
  const r = svg.getBoundingClientRect(), vb = svg.viewBox && svg.viewBox.baseVal;
  if (!r.width || !r.height) return null;
  const w = vb && vb.width ? vb.width : 470, h = vb && vb.height ? vb.height : 500;
  // whatever the pointer does next is worked out on this drawing's own sheet
  setSheet(w, h);
  return [(e.clientX - r.left) / r.width * w, (e.clientY - r.top) / r.height * h];
}
const sheetScale = host => { const svg = host.querySelector('svg'), vb = svg && svg.viewBox && svg.viewBox.baseVal, r = svg && svg.getBoundingClientRect(); return vb && r && r.width ? vb.width / r.width : 1; };

/* Both sun drawings place the sun by (altitude, azimuth), so a pointer position
   is turned back into a date and time by finding the sample plotted nearest it
   and refining around that. Every sky position belongs to two dates, one either
   side of the solstice, so a near-tie goes to the date already selected - which
   keeps a drag continuous instead of flipping across the year. */
function pickSun(S, x, y, project) {
  const cyc = d => { const a = Math.abs(d - S.doy); return Math.min(a, 365 - a); };
  const LAM = 0.0004;
  let best = null, bs = Infinity;
  for (const p of sunSamples(S.timeMode)) {
    const q = project(p[2], p[3], p[4], p[5], p[6]);
    if (!q) continue;
    const sc = (q[0] - x) ** 2 + (q[1] - y) ** 2 + LAM * cyc(p[0]) ** 2;
    if (sc < bs) { bs = sc; best = p; }
  }
  if (!best) return null;
  let bDoy = best[0], bT = best[1];
  for (let dd = -3; dd <= 3; dd++) {
    const doy = clamp(best[0] + dd, 1, 365);
    for (let t = best[1] - 0.2; t <= best[1] + 0.2001; t += 0.02) {
      const sp = solarPosition(doy, t, S.timeMode);
      if (sp.alt <= 0) continue;
      const v = sunVec(sp.alt, sp.az), q = project(sp.alt, sp.az, v[0], v[1], v[2]);
      if (!q) continue;
      const sc = (q[0] - x) ** 2 + (q[1] - y) ** 2 + LAM * cyc(doy) ** 2;
      if (sc < bs) { bs = sc; bDoy = doy; bT = t; }
    }
  }
  return { doy: bDoy, hour: clamp(bT, 0, 24) };
}

/** the selected unit's model, for the window view's hit tests */
function selModel(S) {
  const B = buildBuilding(S), sel = resolveSel(S, B);
  return sel.row.cell ? unitModel(B, sel.f, sel.st, sel.unit) : blankCell(sel.row.h, sel.fac.gf);
}
const inside = (poly, x, y) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};

/* Each view on the page is wired on its own: its host, its own cameras (V),
   and what its last drawing left for the pointer (inst.h). app.V is the
   page's shared view state; app.paint(inst) repaints the one view. */
export function wireView(inst, app) {
  const { S, H } = app, V = inst.V, G0 = app.V;
  const applySun = pick => {
    if (!pick) return;
    app.stopPlay(); H.mark('sun');
    S.doy = pick.doy; S.hour = pick.hour;
    app.scheduleLight();
  };

  /* ---- the heat gain charts: the day's is dragged for the time, the year's clicked for a month ---- */
  if (inst.type === 'gday' || inst.type === 'gyear') {
    const host = inst.host, day = inst.type === 'gday', M0 = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
    let on = false;
    const at = e => {
      const p = viewPoint(host, e);
      if (!p) return;
      const f = clamp((p[0] - 46) / (440 - 46 - 12), 0, 1);       // the charts' plotting width
      app.stopPlay(); H.mark('sun');
      if (day) S.hour = Math.round(f * 24 * 12) / 12;
      else S.doy = M0[Math.min(11, Math.floor(f * 12))] + 14;
      app.scheduleLight();
    };
    host.addEventListener('pointerdown', e => { if (e.button !== 0 || !host.querySelector('svg')) return; on = day; at(e); });
    host.addEventListener('pointermove', e => { if (on) at(e); });
    const end = () => { if (on || !day) app.schedule(); on = false; };
    host.addEventListener('pointerup', end); host.addEventListener('pointercancel', () => { on = false; });
    return;
  }

  /* ---- the chart: drag the sun, scrub the strip, or turn the building ---- */
  if (inst.type === 'sun') {
  const sun = inst.host;
  let mode = null;
  const act = e => {
    const v = viewPoint(sun, e); if (!v) return false;
    if (V.sunMode === 'year') {
      const Y = yearGeom();
      if (mode !== 'year' && !Y.inside(v[0], v[1])) return false;
      if (mode !== 'year') { app.stopPlay(); H.mark('clock'); }
      mode = 'year';
      S.doy = Y.doyAt(v[0]); S.hour = Math.round(Y.hourAt(v[1]) * 4) / 4;
      app.scheduleLight(); return true;
    }
    const G = sunGeom(facadeAzimuth(S, S.sel.f), !!MULTI[S.scope]);
    const st = dayStrip(G, S.doy, S.timeMode);
    const onStrip = st && v[1] > G.TY - 9 && v[1] < G.TY + 22 && v[0] > st.x0 - 8 && v[0] < st.x1 + 8;
    const inPlot = v[0] >= G.X0 && v[0] <= G.X1 && v[1] >= G.Y0 && v[1] <= G.Y1;
    const onBearing = Math.abs(v[0] - G.px(G.fb)) < 15 && v[1] > G.Y1 - 6 && v[1] < G.Y1 + 22;
    if (mode === 'bear' || (mode === null && onBearing)) {
      mode = 'bear'; app.stopPlay(); G0.sunFast = true; H.mark('bearing');
      const b = clamp((v[0] - G.X0) / (G.X1 - G.X0) * (G.AZ1 - G.AZ0) + G.AZ0, G.AZ0, G.AZ1);
      setValue('rot', wrap180(Math.round((S.rot || 0) + wrap180(wrap360(b + 180) - facadeAzimuth(S, S.sel.f)))), S);
      app.scheduleLight(); return true;
    }
    if (mode === 'strip' || (mode === null && onStrip)) {
      mode = 'strip'; app.stopPlay(); H.mark('clock');
      // the strip lies under the sun's bearing, so the clock is read back off it
      if (st) S.hour = clamp(st.t(v[0]), 0, 24);
      app.scheduleLight(); return true;
    }
    if (mode === 'plot' || (mode === null && inPlot)) {
      mode = 'plot';
      applySun(pickSun(S, v[0], v[1], (alt, az) => { const b = bearing(az); return (b < G.AZ0 || b > G.AZ1) ? null : [G.px(b), G.py(alt)]; }));
      return true;
    }
    return false;
  };
  sun.addEventListener('pointerdown', e => {
    if (e.target.closest && e.target.closest('[data-edit]')) return;
    if (e.target.closest('select, button, label')) return;
    mode = null;
    if (act(e)) { try { sun.setPointerCapture(e.pointerId); } catch (_) { } e.preventDefault(); } else mode = 'off';
  });
  sun.addEventListener('pointermove', e => { if (mode && mode !== 'off') act(e); });
  const sunEnd = e => {
    const was = mode; mode = null;
    try { sun.releasePointerCapture(e.pointerId); } catch (_) { }
    if (was === 'bear') G0.sunFast = false;
    if (was && was !== 'off') app.schedule();           // the studies catch up
  };
  sun.addEventListener('pointerup', sunEnd);
  sun.addEventListener('pointercancel', sunEnd);
  return;
  }

  /* ---- the window view: pull the cuts, or orbit ---- */
  if (inst.type === 'detail') {
  const det = inst.host;
  inst.el.querySelector('.detCentre').addEventListener('click', () => {
    const m = selModel(S);
    H.mark('cutcentre'); S.cutU = 0; S.cutV = m.opening ? (m.sill + m.head) / 2 : m.storeyH / 2; app.schedule();
  });
  const toggle = (id, key, on, off) => {
    const b = inst.el.querySelector('.' + id);
    b.addEventListener('click', () => {
      V[key] = !V[key];
      b.setAttribute('aria-pressed', String(V[key])); b.textContent = V[key] ? on : off;
      app.paint(inst);
    });
  };
  toggle('detSolid', 'detSolid', 'Ghost device', 'Solid device');
  toggle('detWall', 'detWall', 'Ghost wall', 'Solid wall');
  let drag = null;
  const axisStep = (cam, at, axis) => { const b = at.slice(); b[axis] += 1; const p0 = cam.P(at), p1 = cam.P(b); return [p1[0] - p0[0], p1[1] - p0[1]]; };
  det.addEventListener('pointerdown', e => {
    if (e.target.closest && e.target.closest('[data-edit]')) return;
    const v = viewPoint(det, e);
    // the end of the sun ray: dragged, the sun goes where it points
    const ds = inst.h.sun;
    if (v && e.button === 0 && ds && Math.hypot(v[0] - ds.knob[0], v[1] - ds.knob[1]) < 12) {
      app.stopPlay(); H.mark('sun');
      drag = { sun: ds.project };
      try { det.setPointerCapture(e.pointerId); } catch (_) { } det.classList.add('drag'); e.preventDefault();
      return;
    }
    // a press on a cut plane: once it moves, it takes the plane the pointer runs along - a press left still is a click
    let planes = null;
    if (v && !e.shiftKey && e.button === 0) {
      const m = selModel(S);
      if (m.opening) {
        const cam = detailCamera(m, V.detcam, S);
        planes = cutPlanes(S, cam).filter(p => inside(p.pts.map(cam.P), v[0], v[1])).map(p => ({ key: p.key, step: axisStep(cam, p.at, p.axis), m }));
        if (!planes.length) planes = null;
      }
    }
    drag = { x: e.clientX, y: e.clientY, mode: camMode(e), moved: 0, at: v, planes };
    try { det.setPointerCapture(e.pointerId); } catch (_) { } det.classList.add('drag'); e.preventDefault();
  });
  det.addEventListener('pointermove', e => {
    if (!drag) return;
    if (drag.sun) {
      const v = viewPoint(det, e); if (!v) return;
      applySun(pickSun(S, v[0], v[1], (alt, az) => drag.sun(alt, az)));
      return;
    }
    if (drag.cut) {
      const v = viewPoint(det, e); if (!v) return;
      const s = drag.step, len2 = s[0] * s[0] + s[1] * s[1] || 1;
      const move = ((v[0] - drag.pt[0]) * s[0] + (v[1] - drag.pt[1]) * s[1]) / len2;
      const c = cutLimits(drag.m);
      S[drag.cut] = drag.cut === 'cutU' ? clamp(drag.from + move, c.u0, c.u1) : clamp(drag.from + move, c.v0, c.v1);
      app.scheduleLight();
      return;
    }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.mode === 'click' && drag.planes && drag.moved > 3) {
      // the plane whose own direction on the sheet the pointer follows best
      const v = viewPoint(det, e); if (!v) return;
      const mv = [v[0] - drag.at[0], v[1] - drag.at[1]], fit = p => Math.abs(mv[0] * p.step[0] + mv[1] * p.step[1]) / (Math.hypot(p.step[0], p.step[1]) || 1);
      const p = drag.planes.reduce((a, b) => fit(b) > fit(a) ? b : a);
      H.mark('cut:' + p.key);
      drag = { cut: p.key, from: S[p.key], pt: drag.at, step: p.step, m: p.m };
      return;
    }
    if (drag.mode === 'click') return;
    const scale = sheetScale(det);
    if (drag.mode === 'pan') { V.detcam.panX += dx * scale; V.detcam.panY += dy * scale; }
    else { V.detcam.az = wrap180(V.detcam.az - dx * 0.35); V.detcam.el = clamp(V.detcam.el + dy * 0.3, -80, 85); }
    app.paint(inst);
  });
  const detEnd = e => {
    if (!drag) return;
    const d = drag; drag = null; det.classList.remove('drag');
    try { det.releasePointerCapture(e.pointerId); } catch (_) { }
    if (d.cut || d.sun) { app.schedule(); return; }
    // a click that did not orbit: the window under it, front-most first, is selected
    if (d.mode === 'click' && d.moved < 4 && d.at) {
      const hit = (inst.h.hits || []).slice().reverse().find(hh => inside(hh.pts, d.at[0], d.at[1]));
      if (hit) {
        // the eye keeps its direction in the world as the view moves to the new window's frame
        const eL = hit.eye(inst.h.eye);
        V.detcam.az = Math.atan2(eL[0], eL[2]) * 180 / Math.PI;
        app.selectWindow(hit.f, hit.st, hit.unit);
      }
    }
  };
  det.addEventListener('pointerup', detEnd);
  det.addEventListener('pointercancel', detEnd);
  det.addEventListener('contextmenu', e => e.preventDefault());
  noAutoScroll(det);
  det.addEventListener('wheel', e => { e.preventDefault(); V.detcam.zoom = clamp(V.detcam.zoom * Math.exp(-e.deltaY * 0.0012), 0.12, 6); app.paint(inst); }, { passive: false });
  return;
  }

  /* ---- the section and the plan: the wheel zooms about the pointer, a drag pans ---- */
  if (inst.type === 'section' || inst.type === 'plan') {
    const host = inst.host, isSec = inst.type === 'section', key = isSec ? 'seccam' : 'plancam';
    let pan = null, sunDrag = null, cutDrag = false, gripDrag = null, popDown = false, press = null, travel = 0, memDrag = null;
    noAutoScroll(host);
    host.addEventListener('contextmenu', e => e.preventDefault());
    /* A grip - the sill, the head, a jamb, the glass's set-back, a device's
       tip: dragged, its figure follows the pointer's run along the grip's own
       direction, to the nearest 5 mm. */
    const GRIP_MIN = { 'g.winW': 0.3, 'd.depth': 0.02, 'g.reveal': 0, 'd.offset': 0, 'g.wallT': 0.1, 'a.len': 0, 'd.full': 0.05, slabT: 0 };
    // a click on the drawing picks the window's device under it - inside its outline, or within a few pixels of a thin one
    const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
    const inPoly = (p, q) => { let c = false; for (let i = 0, j = q.length - 1; i < q.length; j = i++) if ((q[i][1] > p[1]) !== (q[j][1] > p[1]) && p[0] < (q[j][0] - q[i][0]) * (p[1] - q[i][1]) / (q[j][1] - q[i][1]) + q[i][0]) c = !c; return c; };
    // what the plane cuts comes before what is seen beyond it, and the smaller outline before the larger
    const area = q => Math.abs(q.reduce((s, p, j) => s + p[0] * q[(j + 1) % q.length][1] - q[(j + 1) % q.length][0] * p[1], 0)) / 2;
    const hitAt = v => {
      const hs = ((v && inst.h.devHits) || []).filter(h => inPoly(v, h.pts) || h.pts.some((q, j) => segD(v, q, h.pts[(j + 1) % h.pts.length]) < 5));
      hs.sort((a, b) => (b.cut - a.cut) || area(a.pts) - area(b.pts));
      return hs[0] || null;
    };
    const devAt = v => { const h = hitAt(v); return h ? h.i : null; };
    // a grip under the pointer; a line that drags whole - the site's - only where no grip is
    const gripAt = v => v && ((inst.h.grips || []).find(g => !g.line && Math.hypot(v[0] - g.p[0], v[1] - g.p[1]) < 8)
      || (inst.h.grips || []).find(g => g.line && segD(v, g.line[0], g.line[1]) < 5));
    const handle = () => inst.h.handle;
    // the other drawing's cut, as it crosses this one: the plan carries the section's, the section the plan's
    const onCut = v => {
      const c = inst.h.cut;
      if (!c || !v) return false;
      return isSec ? Math.abs(v[1] - c.y) < 6 && v[0] > c.x0 - 8 && v[0] < c.x1 + 8 : Math.abs(v[0] - c.x) < 6 && v[1] > c.y0 - 8 && v[1] < c.y1 + 8;
    };
    host.addEventListener('wheel', e => {
      const v = viewPoint(host, e); if (!v) return;
      e.preventDefault();
      zoomAt(V[key], v[0], v[1], Math.exp(-e.deltaY * 0.0015));
      app.paint(inst);
    }, { passive: false });
    host.addEventListener('pointerdown', e => {
    if (e.target.closest && e.target.closest('[data-edit], [data-set]')) return;
      const v = viewPoint(host, e); if (!v) return;
      travel = 0;
      // the middle or the right button pans - the sheet has nothing to orbit
      if (e.button === 1 || e.button === 2) {
        pan = { v, x: V[key].panX, y: V[key].panY };
        try { host.setPointerCapture(e.pointerId); } catch (_) { }
        host.classList.add('drag'); e.preventDefault(); return;
      }
      if (e.button !== 0) return;
      const gp = gripAt(v);
      if (gp && gp.pop) { popDown = true; e.preventDefault(); return; }
      if (gp) {
        app.stopPlay(); H.mark('grip:' + (gp.key || gp.axes.map(a => a.key).join('+')));
        gripDrag = { g: gp, v0: v, t0: gp.rot ? Math.atan2(v[1] - gp.pivot[1], v[0] - gp.pivot[0]) : 0 }; V[key].grab = true;
        try { host.setPointerCapture(e.pointerId); } catch (_) { }
        host.classList.add('drag'); e.preventDefault(); return;
      }
      // the sun handle: the section holds the azimuth and turns the altitude,
      // the plan holds the altitude and turns the azimuth
      const hd = handle();
      if (hd && Math.hypot(v[0] - hd.knob[0], v[1] - hd.knob[1]) < 12) {
        const sp = solarPosition(S.doy, S.hour, S.timeMode), gf = facadeAzimuth(S, S.sel.f);
        app.stopPlay(); H.mark('sun');
        sunDrag = { pivot: hd.pivot, alt: sp.alt, az: sp.az, gf };
        try { host.setPointerCapture(e.pointerId); } catch (_) { }
        host.classList.add('drag'); e.preventDefault(); return;
      }
      if (onCut(v)) {
        app.stopPlay(); H.mark('cut'); cutDrag = true;
        try { host.setPointerCapture(e.pointerId); } catch (_) { }
        e.preventDefault(); return;
      }
      // a press on the drawing itself: let go where it was pressed, it picks the device there, or lets the picked one go
      press = { v, hit: hitAt(v) };
    });
    host.addEventListener('pointermove', e => {
      if (gripDrag) {
        const v = viewPoint(host, e); if (!v) return;
        const { g, v0 } = gripDrag;
        travel = Math.max(travel, Math.hypot(v[0] - v0[0], v[1] - v0[1]));
        // an arrow or the turning arc clicked rather than dragged asks how far instead
        if ((g.arrow || g.rot) && travel < 3) return;
        // the knob swings the member about its hinge, a degree at a time
        if (g.rot) {
          const t = Math.atan2(v[1] - g.pivot[1], v[0] - g.pivot[0]), d = ((t - gripDrag.t0) * 180 / Math.PI + 540) % 360 - 180;
          setValue('d.angle', clamp(Math.round(g.from + g.sgn * d), -85, 85), S);
          app.scheduleLight(); return;
        }
        for (const ax of g.axes || [g]) {
          const d2 = ax.dir[0] * ax.dir[0] + ax.dir[1] * ax.dir[1] || 1, t = ((v[0] - v0[0]) * ax.dir[0] + (v[1] - v0[1]) * ax.dir[1]) / d2;
          setValue(ax.key, Math.max(GRIP_MIN[ax.key] ?? -1e9, Math.round((ax.from + t * (ax.mul || 1)) / 0.005) * 0.005), S);
        }
        app.scheduleLight();
        return;
      }
      if (sunDrag) {
        const v = viewPoint(host, e); if (!v) return;
        const dx = v[0] - sunDrag.pivot[0], dy = v[1] - sunDrag.pivot[1], D = sunDrag;
        let alt = D.alt, az = D.az;
        if (isSec) {
          // the profile angle off the pointer; with the azimuth held, tan beta = tan theta cos gamma
          const th = clamp(Math.atan2(-dy, -dx) * 180 / Math.PI, 0.5, 89.5), gam = wrap180(D.az - D.gf) * Math.PI / 180;
          alt = Math.atan(Math.tan(th * Math.PI / 180) * Math.cos(gam)) * 180 / Math.PI;
        } else {
          // gamma off the pointer, the altitude held
          az = D.gf + clamp(Math.atan2(-dx, dy) * 180 / Math.PI, -88, 88);
        }
        applySun(pickSunAt(S, Math.max(0.2, alt), wrap360(az)));
        return;
      }
      if (cutDrag) {
        const v = viewPoint(host, e); if (!v) return;
        // the frame holds the cut to what the window and its devices span
        if (isSec) S.cutV = inst.h.cut.toV(v[1]); else S.cutU = inst.h.cut.toU(v[0]);
        app.scheduleLight(); return;
      }
      if (memDrag) {
        // a member dragged along its array: the spacing it implies, from the array's first member - or its last, for the first
        const v = viewPoint(host, e); if (!v) return;
        const h = memDrag.mem, s = h.dA, d2 = s[0] * s[0] + s[1] * s[1] || 1, a = h.a0 + ((v[0] - memDrag.v0[0]) * s[0] + (v[1] - memDrag.v0[1]) * s[1]) / d2;
        const sp = Math.max(0.02, h.idx > 0 ? (a - h.first) * h.sd / h.idx : (h.last - a) * h.sd / (h.n - 1));
        if (h.mode === 'count') setValue('a.count', clamp(Math.round(h.L / sp) + 1, 2, 200), S);
        else setValue('a.spacing', Math.min(3, Math.round(sp / 0.005) * 0.005), S);
        app.scheduleLight(); return;
      }
      if (press) {
        const v = viewPoint(host, e); if (v) travel = Math.max(travel, Math.hypot(v[0] - press.v[0], v[1] - press.v[1]));
        // a member of an array pressed and moved: it is picked, and drags the array's spacing or number
        if (travel >= 3 && press.hit && press.hit.mem) {
          app.pick(press.hit.i, inst); H.mark('grip:member');
          memDrag = { mem: press.hit.mem, v0: press.v }; press = null; V[key].grab = true;
          try { host.setPointerCapture(e.pointerId); } catch (_) { }
          host.classList.add('drag');
        }
        return;
      }
      if (!pan) {
        const v = viewPoint(host, e);
        const gp = gripAt(v);
        host.style.cursor = gp ? (gp.pop ? 'pointer' : gp.rot ? 'grab' : Math.abs(gp.dir[0]) > Math.abs(gp.dir[1]) ? 'ew-resize' : 'ns-resize')
          : onCut(v) ? (isSec ? 'ns-resize' : 'ew-resize') : devAt(v) !== null ? 'pointer' : '';
        return;
      }
      const v = viewPoint(host, e); if (!v) return;
      travel = Math.max(travel, Math.hypot(v[0] - pan.v[0], v[1] - pan.v[1]));
      V[key].panX = pan.x + v[0] - pan.v[0]; V[key].panY = pan.y + v[1] - pan.v[1];
      app.paint(inst);
    });
    const end = e => {
      const moved = !!(sunDrag || cutDrag || gripDrag || memDrag), click = travel < 3 && e.type === 'pointerup';
      memDrag = null;
      const g = gripDrag && gripDrag.g, wasPress = !!press, wasPop = popDown;
      pan = null; sunDrag = null; cutDrag = false; gripDrag = null; popDown = false; press = null; host.classList.remove('drag'); H.release && H.release();
      // the gumball's centre opens the device's settings; an arrow clicked asks how far; a click elsewhere picks a device, or lets it go
      if (wasPop && click) app.togglePop(inst);
      else if (g && (g.arrow || g.rot) && click) app.nudge(g, e.clientX, e.clientY);
      // a line pressed and let go where it was is a click on what lies under it
      else if (g && g.line && click) app.pick(devAt(viewPoint(host, e)), inst);
      else if (wasPress && click) app.pick(devAt(viewPoint(host, e)), inst);
      if (V[key].grab) { V[key].grab = false; V[key].hold = null; if (!moved) app.paint(inst); }
      if (g && g.key === 'a.len') app.endArray();
      if (moved) app.schedule();                // the day's and year's figures settle once it is let go
    };
    host.addEventListener('pointerup', end); host.addEventListener('pointercancel', end);
    host.addEventListener('dblclick', () => { Object.assign(V[key], SHEETCAM0(V[key].fit)); app.paint(inst); });
    return;
  }

  /* ---- the building view: drag the sun, orbit or turn the building, click to select ---- */
  if (inst.type !== 'axon') return;
  const ax = inst.host, menu = inst.el.querySelector('.axLayers');
  menu.addEventListener('change', e => {
    if (e.target.classList.contains('angAt')) { V.angAt = e.target.value; app.paint(inst); return; }
    const d = e.target.dataset;
    if (d.axg) { V.groups[d.axg] = e.target.checked; e.target.closest('.laygrp').classList.toggle('off', !e.target.checked); app.paint(inst); return; }
    if (d.axl) { V.labels[d.axl] = e.target.checked; app.paint(inst); return; }
    if (!d.ax) return; V.layers[d.ax] = e.target.checked; app.paint(inst);
  });
  inst.el.querySelector('.axReset').addEventListener('click', () => {
    Object.assign(V.axcam, AXCAM0, { daz: wrap360(facadeAzimuth(S, S.sel.f) + 40), focus: null });   // three-quarter view of the side studied
    app.paint(inst);
  });
  // close in on the selected window, looking at it three-quarters on; the orbit then turns about it
  inst.el.querySelector('.axZoom').addEventListener('click', () => {
    if (!inst.h.focus) return;
    const cam = axonCamera(S, Object.assign({}, V.axcam, { zoom: 1 })), Rfit = Math.max(cam.Rdome, cam.Rground);
    Object.assign(V.axcam, { focus: inst.h.focus.slice(), zoom: Rfit / 4.5, panX: 0, panY: 0, daz: wrap360(facadeAzimuth(S, S.sel.f) + 30), el: 18 });
    app.paint(inst);
  });
  /* the facade-azimuth arrow on the ground is a handle: near it, a drag turns
     the building so the selected side looks where the pointer is */
  const onHandle = v => {
    const hd = inst.h.handle;
    if (!v || !hd) return false;
    // the building drawn over its line is picked first: the line is taken only off the building
    if ((inst.h.hits || []).some(h => inside(h.pts, v[0], v[1]))) return false;
    const { a, b } = hd, dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
    const t = clamp(((v[0] - a[0]) * dx + (v[1] - a[1]) * dy) / L2, 0, 1);
    return Math.hypot(a[0] + dx * t - v[0], a[1] + dy * t - v[1]) < 9 || Math.hypot(b[0] - v[0], b[1] - v[1]) < 11;
  };
  const turnTo = v => {
    const p = axonCamera(S, V.axcam).ground(v[0], v[1]);
    if (!p || Math.hypot(p[0], p[1]) < 1e-6) return;
    const brg = Math.atan2(p[0], p[1]) * 180 / Math.PI;
    const rot = wrap180(Math.round((S.rot || 0) + wrap180(brg - facadeAzimuth(S, S.sel.f))));
    if (rot !== (S.rot || 0)) { setValue('rot', rot, S); app.scheduleLight(); }
  };
  /* placing a context building: its ghost follows the pointer on the ground, and a click puts it there */
  const groundAt = e => { const v = viewPoint(ax, e); return v ? axonCamera(S, V.axcam).ground(v[0], v[1]) : null; };
  /* Context massing, once placed: its body dragged moves it on the ground; the
     selected one's face handles push or pull that face alone, the opposite
     face staying put; its ring turns it about its middle (Shift: by 15°).
     Alt-dragged, its body leaves a copy where it was and the drag carries the
     other; let go, the page asks whether that is a copy or an instance. A
     face pulled or a turn given goes to its instances too, as they inherit it.
     Right-clicked, a massing opens its instance menu. A
     massing in front of the block is taken before the block; one behind it,
     only where it shows. A window under the pointer comes first, unless the
     massing over it is the one selected. */
  const ctxRec = id => ((S.site && S.site.ctx) || []).find(c => c.id === id);
  const snap = c => { const p = contextPlace(S, c); return { C: p.C.slice(), a: p.a, w: c.w, d: c.d, h: c.h }; };
  const nearPt = (v, p, r) => Math.hypot(p[0] - v[0], p[1] - v[1]) < r;
  const ctxAt = v => {
    const ed = inst.h.ctxEdit;
    if (ed && ctxRec(ed.id)) {
      if (nearPt(v, ed.rot.p, 10)) return { kind: 'rot', id: ed.id };
      const f = ed.faces.find(f => nearPt(v, f.p, 8));
      if (f) return { kind: 'face', id: ed.id, f };
    }
    const hits = (inst.h.hits || []).filter(h => inside(h.pts, v[0], v[1])), glass = hits.some(h => h.unit !== null);
    const sel = S.site && S.site.ctxSel;
    const hit = (inst.h.ctxHits || []).filter(h => inside(h.pts, v[0], v[1]) && (h.id === sel || (h.front ? !glass : !hits.length)))
      .sort((a, b) => (b.id === sel) - (a.id === sel) || b.front - a.front)[0];
    return hit && ctxRec(hit.id) ? { kind: 'move', id: hit.id } : null;
  };
  const ctxGrab = (v, e) => {
    const at = ctxAt(v);
    if (!at) return null;
    app.stopPlay();
    // Alt on the body: the copy is made when the drag first moves, so an Alt-click alone makes none
    const alt = at.kind === 'move' && e.altKey;
    if (at.kind === 'move' && !alt && S.site.ctxSel !== at.id) app.selectContext(at.id);
    const d = { ctx: at.kind, id: at.id, s0: snap(ctxRec(at.id)), snaps: contextSnaps(S, at.id), f: at.f, v0: v, G0: groundAt(e), moved: false, alt };
    if (at.kind === 'rot') d.C = d.s0.C;
    return d;
  };
  const ctxDrag = (d, e) => {
    const s = d.s0;
    // the drag is one step of the history, taken when it first moves - a click that only selects takes none
    if (!d.moved) {
      d.moved = true; H.mark('ctx:' + d.ctx + (d.alt ? ':copy' : ''));
      if (d.alt) { const nid = app.duplicateContext(d.id); if (nid) { d.dupFrom = d.id; d.id = nid; } }
    }
    if (d.ctx === 'move' || d.ctx === 'rot') {
      const G = groundAt(e);
      if (!G || !d.G0) return;
      if (d.ctx === 'move') { app.putContext(d.id, [s.C[0] + G[0] - d.G0[0], s.C[1] + G[1] - d.G0[1]], s.a); return; }
      const brg = p => Math.atan2(p[0] - d.C[0], p[1] - d.C[1]) * 180 / Math.PI, step = e.shiftKey ? 15 : 1;
      app.turnContext(d.id, s.a + Math.round(wrap180(brg(G) - brg(d.G0)) / step) * step, d.snaps);
      return;
    }
    // a face: the pointer's run along its normal on the drawing, in metres, to the nearest 100 mm
    const v = viewPoint(ax, e), f = d.f;
    if (!v) return;
    const t = ((v[0] - d.v0[0]) * f.sv[0] + (v[1] - d.v0[1]) * f.sv[1]) / (f.sv[0] * f.sv[0] + f.sv[1] * f.sv[1] || 1);
    const k = f.key === 'top' ? 'h' : f.key[1] === 'x' ? 'w' : 'd';
    app.pullContext(d.id, f.key, Math.max(1, Math.round((s[k] + t) * 10) / 10), d.snaps);
  };
  /* The selected storey, once its wall has been clicked: dragged anywhere on
     it, it moves; its side handles push or pull a side; its ring turns it.
     A click on it that does not move goes on to pick what is under it. Its
     arc, at the gumball, turns it; the square on its roof sets its height. */
  const plateAt = v => {
    const pe = inst.h.plateEdit;
    if (!pe || !V.plate.on || pe.st !== S.sel.st) return null;
    const f = pe.faces.find(f => nearPt(v, f.p, 9));
    if (f) return { kind: 'face', f };
    // its arc, at the gumball: turns it
    const arc = pe.rot.arc;
    for (let k = 1; k < arc.length; k++) if (segDist(v, arc[k - 1], arc[k]) < 6) return { kind: 'rot' };
    if (nearPt(v, arc[0], 9) || nearPt(v, arc[arc.length - 1], 9)) return { kind: 'rot' };
    if (f) return { kind: 'face', f };
    // its gumball: an arrow moves it along one of its axes, the square between them freely
    const gm = pe.gum;
    if (gm) {
      const a = gm.axes.find(a => Math.hypot(v[0] - a.tip[0], v[1] - a.tip[1]) < 10 || segDist(v, gm.o, a.tip) < 5);
      if (a) return { kind: 'axis', a };
      if (inside(gm.plane, v[0], v[1])) return { kind: 'move' };
    }
    return null;
  };
  // the pointer read on the selected storey's floor, where its gumball stands, rather than on the ground
  const floorAt = e => {
    const v = viewPoint(ax, e), pe = inst.h.plateEdit, dz = pe && pe.rot.dz || [0, 0];
    return v ? axonCamera(S, V.axcam).ground(v[0] - dz[0], v[1] - dz[1]) : null;
  };
  /* The site's lines: one pressed and dragged pushes or pulls its figure -
     a setback, a curb, a street's width - straight out from the building, to
     the nearest 100 mm; pressed and let go, it opens the boundary's small window
     on its side. The building drawn over a line is picked first. */
  const siteLineAt = v => {
    const ls = inst.h.siteLines;
    if (!v || !ls || !ls.length || (inst.h.hits || []).some(h => inside(h.pts, v[0], v[1]))) return null;
    let best = null, bd = 5;
    for (const l of ls) { const d = Math.min(segDist(v, l.a, l.b), Math.hypot(v[0] - l.grip[0], v[1] - l.grip[1]) - 2); if (d < bd) { bd = d; best = l; } }
    return best;
  };
  const siteDrag = (d, e) => {
    const v = viewPoint(ax, e), l = d.site, s = l.sv;
    if (!v || d.still) return;
    if (!d.moved) { if (Math.hypot(v[0] - d.v0[0], v[1] - d.v0[1]) < 3) return; d.moved = true; app.stopPlay(); H.mark('site:' + l.f); }
    const t = Math.round(((v[0] - d.v0[0]) * s[0] + (v[1] - d.v0[1]) * s[1]) / (s[0] * s[0] + s[1] * s[1] || 1) * 10) / 10;
    app.siteSetMany(l.set(t));
  };
  const plateSnap = () => { const i = S.sel.st, p = S.storeys[i]; return { C: storeyCentre(S, i).slice(), a: storeyRot(S, i), w: p.w, d: p.d, h: p.h }; };
  const plateDrag = (d, e) => {
    const s = d.s0;
    if (!d.moved) { d.moved = true; app.stopPlay(); H.mark('plate:' + d.plate); }
    if (d.plate === 'axis') {
      // along the storey's own axis only: the pointer's run along the arrow, to the nearest 50 mm
      const v = viewPoint(ax, e); if (!v) return;
      const s = d.a.s, t = Math.round(((v[0] - d.v0[0]) * s[0] + (v[1] - d.v0[1]) * s[1]) / (s[0] * s[0] + s[1] * s[1] || 1) / 0.05) * 0.05;
      app.plateTo({ C: [d.s0.C[0] + d.a.w[0] * t, d.s0.C[1] + d.a.w[1] * t] });
      return;
    }
    if (d.plate === 'move' || d.plate === 'rot') {
      const G = floorAt(e);
      if (!G || !d.G0) return;
      if (d.plate === 'move') { app.plateTo({ C: [s.C[0] + G[0] - d.G0[0], s.C[1] + G[1] - d.G0[1]] }); return; }
      const brg = p => Math.atan2(p[0] - s.C[0], p[1] - s.C[1]) * 180 / Math.PI, step = e.shiftKey ? 15 : 1;
      app.plateTo({ a: s.a + Math.round(wrap180(brg(G) - brg(d.G0)) / step) * step, C: s.C });
      return;
    }
    const v = viewPoint(ax, e), f = d.f;
    if (!v) return;
    const t = ((v[0] - d.v0[0]) * f.sv[0] + (v[1] - d.v0[1]) * f.sv[1]) / (f.sv[0] * f.sv[0] + f.sv[1] * f.sv[1] || 1);
    // its top: the storey's height, to the nearest 50 mm - the floors above ride up or down on it
    if (f.key === 'top') { app.plateTo({ h: clamp(Math.round((s.h + t) / 0.05) * 0.05, 2.4, 8) }); return; }
    const k = f.key[1] === 'x' ? 'w' : 'd', dim = Math.max(4, Math.round((s[k] + t) * 10) / 10), dt = dim - s[k];
    app.plateTo({ [k]: dim, C: [s.C[0] + f.n[0] * dt / 2, s.C[1] + f.n[1] * dt / 2] });
  };
  ax.addEventListener('pointermove', e => {
    ax.classList.toggle('placing', !!V.place.on);
    if (V.place.on && !ad) { const p = groundAt(e); if (p) { V.place.P = p; app.paint(inst); } return; }
    if (ad) return;
    const v = viewPoint(ax, e), pa = v && plateAt(v), at = !pa && v && ctxAt(v);
    ax.classList.toggle('rot', !at && !pa && onHandle(v));
    const k = pa ? pa.kind : at ? at.kind : v && siteLineAt(v) ? 'site' : null;
    ax.style.cursor = !k ? '' : k === 'move' || k === 'axis' ? (e.altKey && at ? 'copy' : 'move') : k === 'rot' || k === 'site' ? 'grab' : 'ns-resize';
  });
  ax.addEventListener('pointerleave', () => { if (V.place.on && V.place.P) { V.place.P = null; app.paint(inst); } });
  document.addEventListener('click', e => { if (menu.isConnected && menu.open && !menu.contains(e.target)) menu.open = false; });
  const domeProject = () => { const cam = axonCamera(S, V.axcam); return (alt, az, vx, vy, vz) => cam.P([vx * cam.Rdome, vy * cam.Rdome, vz * cam.Rdome]); };
  let ad = null;
  ax.addEventListener('pointerdown', e => {
    if (e.target.closest && e.target.closest('[data-edit]')) return;
    if (V.place.on && e.button === 0) { const p = groundAt(e); if (p) app.placeContext(p); e.preventDefault(); return; }
    const v = viewPoint(ax, e);
    if (v && e.button === 0 && !e.shiftKey) {
      const pa = plateAt(v);
      if (pa) {
        ad = { plate: pa.kind, f: pa.f, a: pa.a, s0: plateSnap(), v0: v, v, G0: floorAt(e), moved: false, mode: 'click' };
        try { ax.setPointerCapture(e.pointerId); } catch (_) { } ax.classList.add('drag'); e.preventDefault(); return;
      }
      const d = ctxGrab(v, e);
      if (d) { ad = d; try { ax.setPointerCapture(e.pointerId); } catch (_) { } ax.classList.add('drag'); e.preventDefault(); return; }
      // a site line: pressed while the site is not selected, it selects it; selected, it is dragged
      const sl = siteLineAt(v);
      if (sl) { ad = { site: sl, v0: v, moved: false, still: !V.siteEdit }; try { ax.setPointerCapture(e.pointerId); } catch (_) { } ax.classList.add('drag'); e.preventDefault(); return; }
    }
    const sp = solarPosition(S.doy, S.hour, S.timeMode);
    if (v && !e.shiftKey && e.button === 0 && onHandle(v)) {
      app.stopPlay(); H.mark('rotate');
      ad = { rot: true }; try { ax.setPointerCapture(e.pointerId); } catch (_) { } ax.classList.add('drag'); e.preventDefault(); return;
    }
    if (v && sp.alt > 0 && !e.shiftKey && e.button === 0) {
      const sv = sunVec(sp.alt, sp.az), q = domeProject()(sp.alt, sp.az, sv[0], sv[1], sv[2]);
      if (Math.hypot(q[0] - v[0], q[1] - v[1]) < 16) {
        ad = { sun: true }; try { ax.setPointerCapture(e.pointerId); } catch (_) { } ax.classList.add('drag'); e.preventDefault(); return;
      }
    }
    ad = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, v, moved: false, mode: camMode(e) };
    // a window of an array under a left press: moved, it drags the array's spacing; let go where it was, it is a click
    if (v && ad.mode === 'click') {
      const glass = (inst.h.hits || []).filter(h => h.unit !== null && inside(h.pts, v[0], v[1]));
      const front = glass.length ? glass.reduce((a, b) => b.d > a.d ? b : a) : null;
      if (front && front.win) ad.winHit = front;
    }
    try { ax.setPointerCapture(e.pointerId); } catch (_) { } ax.classList.add('drag'); e.preventDefault();
  });
  ax.addEventListener('pointermove', e => {
    if (!ad) return;
    if (ad.site) { siteDrag(ad, e); return; }
    if (ad.plate) {
      // the storey's arrow clicked rather than dragged asks how far to move it instead
      if (ad.plate === 'axis' && !ad.moved) { const v = viewPoint(ax, e); if (!v || Math.hypot(v[0] - ad.v0[0], v[1] - ad.v0[1]) < 3) return; }
      plateDrag(ad, e); return;
    }
    if (ad.winHit) {
      // a window dragged along its side: the pitch it implies, from the side's first window - or its last, for the first
      const v = viewPoint(ax, e); if (!v) return;
      if (!ad.winOn) {
        if (Math.hypot(v[0] - ad.v[0], v[1] - ad.v[1]) < 4) return;
        const hh = ad.winHit; ad.winOn = true; ad.moved = true; app.stopPlay(); app.select(hh.f, hh.st, hh.unit); H.mark('window:array');
      }
      const h = ad.winHit.win, s = h.sU, u = h.cc + ((v[0] - ad.v[0]) * s[0] + (v[1] - ad.v[1]) * s[1]) / (s[0] * s[0] + s[1] * s[1] || 1);
      const p = Math.max(0.3, h.idx > 0 ? (u - h.first) / h.idx : (h.last - u) / (h.n - 1));
      if (getValue('g.arrBy', S) === 'number') setValue('g.arrN', clamp(Math.round(h.len / p), 1, 200), S);
      else setValue('g.arrSp', Math.round(p / 0.05) * 0.05, S);
      app.scheduleLight(); return;
    }
    if (ad.ctx) { ctxDrag(ad, e); return; }
    if (ad.sun) { const v = viewPoint(ax, e); if (v) applySun(pickSun(S, v[0], v[1], domeProject())); return; }
    if (ad.rot) { const v = viewPoint(ax, e); if (v) turnTo(v); return; }
    const dx = e.clientX - ad.x, dy = e.clientY - ad.y;
    ad.x = e.clientX; ad.y = e.clientY;
    if (Math.hypot(e.clientX - ad.x0, e.clientY - ad.y0) > 4) ad.moved = true;
    if (ad.mode === 'click') return;
    const scale = sheetScale(ax);
    if (ad.mode === 'pan') { V.axcam.panX += dx * scale; V.axcam.panY += dy * scale; app.paint(inst); }
    else { V.axcam.daz = wrap360(V.axcam.daz + dx * 0.45); V.axcam.el = clamp(V.axcam.el + dy * 0.35, 0, 88); app.paint(inst); }
  });
  const axEnd = e => {
    if (!ad) return;
    const was = ad; ad = null; ax.classList.remove('drag');
    try { ax.releasePointerCapture(e.pointerId); } catch (_) { }
    if (was.site) { if (was.moved) app.schedule(); else app.openBoundary(was.site.f, inst); return; }
    // a storey dragged settles; a storey clicked without moving goes on to pick what is under it
    if (was.plate && was.moved) { app.schedule(); return; }
    if (was.plate === 'axis' && e.type === 'pointerup') { app.askPlateMove(was.a.w, was.s0.C, e.clientX, e.clientY); return; }
    if (was.winOn) { app.schedule(); return; }
    if (was.ctx) {
      // an Alt-drag let go: a copy, or an instance?
      if (was.dupFrom) app.askInstance(was.dupFrom, was.id, e.clientX, e.clientY);
      app.schedule(); return;
    }
    // a right-click that did not move, on a massing: its instance menu
    if (was.mode === 'orbit' && !was.moved && was.v && e.type === 'pointerup') {
      const at = ctxAt(was.v);
      if (at) { app.contextMenu(at.id, e.clientX, e.clientY); return; }
    }
    if (was.sun || was.rot) app.schedule();
    // a click that did not move picks whatever window or storey band lies front-most under it
    if (!was.sun && !was.rot && !was.moved && was.mode === 'click' && was.v && e.type === 'pointerup') {
      const under = (inst.h.hits || []).filter(h => inside(h.pts, was.v[0], was.v[1]));
      const glass = under.filter(h => h.unit !== null);
      // a click anywhere but on a massing lets the selected one go
      if (S.site && S.site.ctxSel) app.selectContext(null);
      /* a window selects it; a storey's wall selects that side and storey, and its exposed roof the storey,
         each the storey to edit; nothing lets the storey go. What is drawn last under the click is taken:
         storey by storey upward, and in each its walls, then its glass, then its roof */
      const rank = h => h.st * 3 + (h.unit !== null ? 1 : h.roof ? 2 : 0);
      const hit = under.length ? under.reduce((a, b) => rank(b) > rank(a) || (rank(b) === rank(a) && b.unit !== null && b.d > a.d) ? b : a) : null;
      if (hit) app.selectPlate(hit.f, hit.st, hit.unit);
      else { app.endPlate(); app.schedule(); }
    }
  };
  ax.addEventListener('pointerup', axEnd);
  ax.addEventListener('pointercancel', axEnd);
  ax.addEventListener('contextmenu', e => e.preventDefault());
  noAutoScroll(ax);
  ax.addEventListener('wheel', e => { e.preventDefault(); V.axcam.zoom = clamp(V.axcam.zoom * Math.exp(-e.deltaY * 0.0012), 1e-3, 1e4); app.paint(inst); }, { passive: false });
}
