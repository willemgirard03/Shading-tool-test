/* Dragging in the drawings: the sun and the clock on the chart, the bearing
   handle, the cut tabs in the window view, orbit, pan and zoom, turning the
   building, and clicking a window in the building view to select it. */

import { clamp, wrap360, wrap180 } from '../util.js';
import { solarPosition, sunVec } from '../solar.js';
import { sunSamples, pickSunAt } from '../sunpick.js';
import { FACADES, MULTI, facadeAzimuth, buildBuilding, resolveSel, unitModel, blankCell, faceOffset, plateMax } from '../geometry/building.js';
import { AXCAM0, DETCAM0 } from '../view.js';
import { setValue } from '../state.js';
import { sunGeom, bearing, dayStrip } from '../draw/sunpath.js';
import { yearGeom } from '../draw/sunyear.js';
import { detailCamera, cutLimits, sectionTab, planTab } from '../draw/detail.js';
import { axonCamera } from '../draw/axon.js';
import { zoomAt, SHEETCAM0 } from '../draw/sheetcam.js';
import { setSheet } from '../draw/svg.js';

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
    if (v && !e.shiftKey && e.button === 0) {
      const m = selModel(S);
      if (m.opening) {
        const cam = detailCamera(m, V.detcam, S);
        const hit = [{ key: 'cutU', axis: 0, at: sectionTab(S, cam) }, { key: 'cutV', axis: 1, at: planTab(S, cam) }]
          .find(t => { const q = cam.P(t.at); return Math.hypot(q[0] - v[0], q[1] - v[1]) < 14; });
        if (hit) {
          H.mark('cut:' + hit.key);
          drag = { cut: hit.key, from: S[hit.key], pt: v, step: axisStep(cam, hit.at, hit.axis), m };
          try { det.setPointerCapture(e.pointerId); } catch (_) { } det.classList.add('drag'); e.preventDefault();
          return;
        }
      }
    }
    drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 2 || e.button === 1, moved: 0, at: v };
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
    const scale = sheetScale(det);
    if (drag.pan) { V.detcam.panX += dx * scale; V.detcam.panY += dy * scale; }
    else { V.detcam.az = wrap180(V.detcam.az - dx * 0.35); V.detcam.el = clamp(V.detcam.el + dy * 0.3, -80, 85); }
    app.paint(inst);
  });
  const detEnd = e => {
    if (!drag) return;
    const d = drag; drag = null; det.classList.remove('drag');
    try { det.releasePointerCapture(e.pointerId); } catch (_) { }
    if (d.cut || d.sun) { app.schedule(); return; }
    // a click that did not orbit: the window under it, front-most first, is selected
    if (!d.pan && d.moved < 4 && d.at) {
      const hit = (inst.h.hits || []).slice().reverse().find(hh => inside(hh.pts, d.at[0], d.at[1]));
      if (hit) {
        // the eye keeps its direction in the world as the view moves to the new window's frame
        const eL = hit.eye(inst.h.eye);
        V.detcam.az = Math.atan2(eL[0], eL[2]) * 180 / Math.PI;
        app.select(hit.f, hit.st, hit.unit);
      }
    }
  };
  det.addEventListener('pointerup', detEnd);
  det.addEventListener('pointercancel', detEnd);
  det.addEventListener('contextmenu', e => e.preventDefault());
  det.addEventListener('wheel', e => { e.preventDefault(); V.detcam.zoom = clamp(V.detcam.zoom * Math.exp(-e.deltaY * 0.0012), 0.12, 6); app.paint(inst); }, { passive: false });
  return;
  }

  /* ---- the section and the plan: the wheel zooms about the pointer, a drag pans ---- */
  if (inst.type === 'section' || inst.type === 'plan') {
    const host = inst.host, isSec = inst.type === 'section', key = isSec ? 'seccam' : 'plancam';
    let pan = null, sunDrag = null, cutDrag = false;
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
    if (e.target.closest && e.target.closest('[data-edit]')) return;
      if (e.button !== 0) return;
      const v = viewPoint(host, e); if (!v) return;
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
      pan = { v, x: V[key].panX, y: V[key].panY };
      try { host.setPointerCapture(e.pointerId); } catch (_) { }
      host.classList.add('drag');
    });
    host.addEventListener('pointermove', e => {
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
      if (!pan) {
        const v = viewPoint(host, e);
        host.style.cursor = onCut(v) ? (isSec ? 'ns-resize' : 'ew-resize') : '';
        return;
      }
      const v = viewPoint(host, e); if (!v) return;
      V[key].panX = pan.x + v[0] - pan.v[0]; V[key].panY = pan.y + v[1] - pan.v[1];
      app.paint(inst);
    });
    const end = () => {
      const moved = !!(sunDrag || cutDrag);
      pan = null; sunDrag = null; cutDrag = false; host.classList.remove('drag'); H.release && H.release();
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
    if (!e.target.dataset.ax) return; V.layers[e.target.dataset.ax] = e.target.checked; app.paint(inst);
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
  ax.addEventListener('pointermove', e => { if (!ad) ax.classList.toggle('rot', onHandle(viewPoint(ax, e))); });
  document.addEventListener('click', e => { if (menu.isConnected && menu.open && !menu.contains(e.target)) menu.open = false; });
  const domeProject = () => { const cam = axonCamera(S, V.axcam); return (alt, az, vx, vy, vz) => cam.P([vx * cam.Rdome, vy * cam.Rdome, vz * cam.Rdome]); };
  let ad = null;
  ax.addEventListener('pointerdown', e => {
    if (e.target.closest && e.target.closest('[data-edit]')) return;
    const v = viewPoint(ax, e);
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
    ad = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, v, moved: false,
      pan: e.shiftKey || e.button === 2 || e.button === 1 };
    try { ax.setPointerCapture(e.pointerId); } catch (_) { } ax.classList.add('drag'); e.preventDefault();
  });
  ax.addEventListener('pointermove', e => {
    if (!ad) return;
    if (ad.sun) { const v = viewPoint(ax, e); if (v) applySun(pickSun(S, v[0], v[1], domeProject())); return; }
    if (ad.rot) { const v = viewPoint(ax, e); if (v) turnTo(v); return; }
    const dx = e.clientX - ad.x, dy = e.clientY - ad.y;
    ad.x = e.clientX; ad.y = e.clientY;
    if (Math.hypot(e.clientX - ad.x0, e.clientY - ad.y0) > 4) ad.moved = true;
    const scale = sheetScale(ax);
    if (ad.pan) { V.axcam.panX += dx * scale; V.axcam.panY += dy * scale; app.paint(inst); }
    else { V.axcam.daz = wrap360(V.axcam.daz + dx * 0.45); V.axcam.el = clamp(V.axcam.el + dy * 0.35, 0, 88); app.paint(inst); }
  });
  const axEnd = e => {
    if (!ad) return;
    const was = ad; ad = null; ax.classList.remove('drag');
    try { ax.releasePointerCapture(e.pointerId); } catch (_) { }
    if (was.sun || was.rot) app.schedule();
    // a click that did not move picks whatever window or storey band lies front-most under it
    if (!was.sun && !was.rot && !was.moved && !was.pan && was.v && e.type === 'pointerup') {
      const under = (inst.h.hits || []).filter(h => inside(h.pts, was.v[0], was.v[1]));
      const glass = under.filter(h => h.unit !== null);
      const hit = glass.length ? glass.reduce((a, b) => b.d > a.d ? b : a) : under[0];
      if (hit) app.select(hit.f, hit.st, hit.unit);
    }
  };
  ax.addEventListener('pointerup', axEnd);
  ax.addEventListener('pointercancel', axEnd);
  ax.addEventListener('contextmenu', e => e.preventDefault());
  ax.addEventListener('wheel', e => { e.preventDefault(); V.axcam.zoom = clamp(V.axcam.zoom * Math.exp(-e.deltaY * 0.0012), 1e-3, 1e4); app.paint(inst); }, { passive: false });
}
