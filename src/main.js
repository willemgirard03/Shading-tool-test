/* Vancouver Solar Shading Explorer 8 - the page.

   The page takes the question in four steps: where the sun is, what
   the shading cuts off, where the beam lands inside, and how much heat comes
   in. state.js holds the design, view.js how it is looked at. Every frame
   builds the building from the state (frame.js) and hands it to the drawings,
   the worked calculations and, on request, the Rhino exporter - so nothing on
   the page can disagree with anything else. This file only wires that to the
   document.                                                                 */

import { fmt, hhmm, MONTHS, wrap180, D2R } from './util.js';
import { CLOCK_NAME, sunriseSunsetSolar, solarToClock } from './solar.js';
import { S, setValue, getValue, addWindow, windowEachSide, insertStorey, applyTypology, createHistory, addStorey, duplicateStorey, removeStorey, moveStorey, removeGlazing,
  addDevice, addSavedDevice, removeDevice, createArray, removeArray, applyShadingPreset, copyCondition, selCell, breakUnit, rebindUnit, rebindAll, otherBroken, matchAbove,
  newSystemHere, useSystem, newUnitHere, duplicateHere, deleteEntry,
  saveWindow, openWindow, selectionChanged, keepCuts, windowState, savedWindow, removeWindow, renameWindow, windowName, windowSavedAs, selUnitIndex, shadingFromIdeal,
  addContextAt, removeContext, putContext, duplicateContext, instanceContext, makeUnique, pullContext, turnContext, contextGroup, plateTo } from './state.js';
import { V, AX_LAYERS } from './view.js';
import { buildFrame } from './frame.js';
import { SCOPES } from './geometry/building.js';
import { GLAZING_TYPES } from './geometry/cell.js';
import { roomOf } from './geometry/room.js';
import { lightUnits, floorNowAll, PLAN_LIGHT } from './geometry/floorsun.js';
import { maskStale, getMask, envStale, getEnvelopes, resetStudies, getDayGain, dayGainStale, getYearGain, yearGainStale, getFloorAll, floorAllStale,
  getFloor, floorStale, resetGains, getRegion, getHourly } from './studies.js';
import { SKIES, beamAt, unitGain, targetGain, floorNow, landing } from './energy.js';
import { drawSunPath, clearSunCache, DOT_SPANS } from './draw/sunpath.js';
import { drawSection, sectionHandle, secCutLine, sectionGrips, sectionDevHits, sectionPop } from './draw/section.js';
import { drawPlan, INTERIOR_MODES, planHandle, planCutLine, planGrips, planDevHits, planPop } from './draw/plan.js';
import { SHEETCAM0 } from './draw/sheetcam.js';
import { drawDetail, DETAIL_VIEWS, detailSun, detailHits, detailEye, detailWinPop } from './draw/detail.js';
import { drawAxon, axonHits, axonHandle, axonFocus, axonCtxHits, axonCtxEdit, axonCamera, axonPlateEdit, axonWinPop, axonSiteLines, axonSiteMids } from './draw/axon.js';
import { drawSunYear } from './draw/sunyear.js';
import { chartGainDay, chartGainYear, chartShadeYear } from './draw/charts.js';
import { WEATHER_FILES, parseEpw, addWeather } from './weather.js';
import { titleBlock, setSheet, SHEET0 } from './draw/svg.js';
import { sheetFor, buildLayout, wireLayout, margins, removeView, saveLayout } from './ui/layout.js';
import { createView, VIEW_TYPES, devicePopHTML, windowPopHTML, emptyPopHTML, storeyPopHTML, sitePopHTML } from './ui/views.js';
import { makeWidget, openWidget, closeWidget, hideWidget, showWidget } from './ui/widgets.js';
import { buildCell as liveCell, SLAB0 as LIVE_SLAB0 } from './geometry/cell.js';
import { facadeLength as liveLen, facadeAzimuth as liveAz } from './geometry/building.js';
import { solarPosition as liveSun } from './solar.js';
import { monthDayOf as liveDate, wrap180 as liveWrap } from './util.js';
import { selGlazing as liveGlz, selStorey as liveStorey } from './state.js';
import { MEMBERS_MAX } from './ui/calc.js';
import { liveToggle, liveOff, liveApply, liveSetKind, liveKind, applySitePreset, rotateSite, isBroken, selUnitType, SHADING_PRESETS, STOREYS_MAX, selShading, selDevice as selDev, selSystem, addShading, addSavedWindow, saveEntry, copyEntry, copyName, isSaved, deleteSaved } from './state.js';
import { SYSTEM_PRESETS, usage, entryName, defaultName } from './library.js';
import { deviceLabel } from './geometry/device.js';
import { openFloatEdit, openNudge, openAsk, openName, buildRail, buildCalcBar, RESULT_SCOPES, syncRail, syncClock, wireRail, copyUI, brkUI, regsControls } from './ui/rail.js';
import { stackLabel } from './ui/readout.js';
import { recSun, recGeometry, recBylaw, recFor, resGain, fxUI, recUI, idealSpec } from './ui/calc.js';
import { renderChecks, renderEnergy, staticProse } from './ui/prose.js';
import { wireView, viewPoint } from './ui/interact.js';
import { exportRhino } from './export/rhino.js';

const $ = id => document.getElementById(id);
const clampN = (x, a, b) => Math.min(b, Math.max(a, x));
// the page starts on the default template - a window in the middle of each side - on the summer clock
windowEachSide(S);
S.timeMode = 'pdt';
const H = createHistory(S);
const SCOPES_SHORT = { unit: 'The selected unit', storey: 'This storey, this side', level: 'This storey, all sides', facade: 'This side', building: 'The whole building' };
const opts = o => Object.entries(o).map(([k, l]) => `<option value="${k}">${l}</option>`).join('');

/* ---------- the views on the page ----------
   Any number of each kind, each an instance with its own bar and cameras
   (ui/views.js), in rows the user arranges (ui/layout.js). */
const insts = () => [...document.querySelectorAll('#views .view')].map(el => el._inst).filter(Boolean);
function makeInst(type, pin = null) {
  const inst = createView(type, pin && savedWindow(S, pin) ? pin : null), bar = inst.el.querySelector('.v3dbar');
  wireRail(bar, S, api);
  // the bar's own controls, for this view alone
  const q = c => inst.el.querySelector(c);
  if (type === 'sun') {
    q('.dotsSel').addEventListener('change', e => { inst.V.dots = e.target.value; clearSunCache(); paint(inst, true); });
    // the sun path, or the year by day and hour
    q('.sunModes').addEventListener('click', e => {
      const b = e.target.closest('[data-sm]'); if (!b) return;
      inst.V.sunMode = b.dataset.sm;
      q('.sunModes').querySelectorAll('[data-sm]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      q('.wxdots').hidden = inst.V.sunMode === 'year';
      paint(inst, true);
    });
  }
  if (type === 'detail') {

    q('.detReset').addEventListener('click', () => { Object.assign(inst.V.detcam, DETAIL_VIEWS.outside); paint(inst); });
  }
  if (type === 'section') q('.secReset').addEventListener('click', () => { inst.V.seccam = SHEETCAM0('window'); paint(inst); });
  if (type === 'axon') {
    // the typology, from the site view's own bar - every site view showing the one chosen
    q('.axTyp').addEventListener('change', e => { const k = e.target.value; document.querySelectorAll('.axTyp').forEach(x => { x.value = k; }); api.typology(k); });
    q('.axTyp').value = document.querySelector('.axTyp') ? document.querySelector('.axTyp').value : 'blank';
    // the site: its boundary's small window, the context massing placed, and whether it turns with the building
    q('.axBnd').addEventListener('click', () => { q('.axSite').open = false; openBoundary(null, inst); });
    q('.axSite').addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) { q('.axSite').open = false; api.act(b.dataset.act, b.dataset.v); } });
    q('.axSite').addEventListener('change', e => {
      const t = e.target;
      if (t.matches('input[type=checkbox][data-k]')) api.set(t.dataset.k, t.checked);
      if (t.matches('.axSitePre') && t.value) { const k = t.value; t.value = ''; q('.axSite').open = false; api.act('sitePreset', k); }
    });
  }
  // shading added from the drawing's own bar - a new member, a saved device or shading system, or a preset - picked, its window open
  const ad = q('.addShd');
  if (ad) ad.addEventListener('change', () => {
    const v = ad.value; ad.value = '';
    if (!v) return;
    stopPlay(); H.mark('device');
    if (addShading(v)) { const r = selCell(); pickOnly(r ? r.dev || 0 : 0, inst); }
    schedule();
  });
  // the bay alone or the whole floor; the edit handles shown or not - each view its own
  const wh = inst.el.querySelector('.vWhole'), vb = inst.el.querySelector('.vBeam'), va = inst.el.querySelector('.vAng');
  // the sun's angles at the window, in the floor view
  if (va) va.addEventListener('change', e => { inst.V.detAng = e.target.checked; paint(inst); });
  // the sunlight that gets in, shaded and outlined - or left to its grey outline
  if (vb) vb.addEventListener('change', e => { inst.V.beam = e.target.checked; paint(inst); });
  // the site's lines standing up from the boundary, on request
  const vs = inst.el.querySelector('.vSite');
  if (vs) vs.addEventListener('change', e => { inst.V.site = e.target.checked; paint(inst); });
  if (wh) wh.addEventListener('change', e => { inst.V.whole = e.target.checked; inst.V.detcam.whole = e.target.checked; paint(inst, true); });
  if (type === 'plan') {
    q('.planReset').addEventListener('click', () => { inst.V.plancam = SHEETCAM0('window'); paint(inst); });
    q('.inModes').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (!b) return; inst.V.inMode = b.dataset.mode; schedule(); });
  }
  // another kind of view in the same place
  q('.vtype').addEventListener('change', e => {
    const n = makeInst(e.target.value);
    n.el.style.flexGrow = inst.el.style.flexGrow;
    inst.el.replaceWith(n.el); margins(); saveLayout(); clearSunCache(); schedule();
  });
  if (type === 'plan' || type === 'section') {
    /* which window the view shows: the selected one, or a saved one, chosen
       in the view; a saved window is named when it is saved, and can be
       renamed or deleted from any view showing it */
    const ask = (btn, value, done) => {
      const box = document.createElement('input');
      box.type = 'text'; box.className = 'vname'; box.value = value; box.placeholder = windowName(S); box.spellcheck = false; box.setAttribute('aria-label', 'Name of the saved window');
      box.title = 'Tab takes the suggested name; Enter saves, Escape leaves it';
      btn.hidden = true; btn.after(box); box.focus(); box.select();
      let over = false;
      const close = ok => { if (over) return; over = true; const name = box.value; box.remove(); setPin(inst, inst.pin); if (ok) done(name); };
      box.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') close(true); else if (e.key === 'Escape') close(false); });
      box.addEventListener('blur', () => close(false));
    };
    q('.vsave').addEventListener('click', e => ask(e.currentTarget, '', name => { H.mark('saveview'); setPin(inst, saveWindow(S, name)); schedule(); }));
    q('.wren').addEventListener('click', e => { const v = savedWindow(S, inst.pin); if (v) ask(e.currentTarget, v.name, name => { H.mark('saveview'); renameWindow(inst.pin, name); refreshTypes(true); schedule(); }); });
    q('.wdel').addEventListener('click', () => { const id = inst.pin; if (!id) return; H.mark('saveview'); removeWindow(id); for (const i of insts()) if (i.pin === id) setPin(i, null); refreshTypes(true); schedule(); });
    q('.winSel').addEventListener('change', e => {
      const id = e.target.value || null;
      setPin(inst, id);
      if (id && openWindow(S, id)) { H.mark('select'); brkUI.pending = false; }
      schedule();
    });
    // clicking into a saved window's view makes it the selection, cuts and all
    inst.el.addEventListener('pointerdown', e => {
      if (!inst.pin || S.activeView === inst.pin || e.target.closest('.vtype, .vbtns, .grip, .vname, .wpick')) return;
      if (openWindow(S, inst.pin)) { H.mark('select'); brkUI.pending = false; schedule(); }
    }, true);
    setPin(inst, inst.pin);
  }
  wireView(inst, { S, V, H, schedule, scheduleLight, paint: i => paint(i), stopPlay, select, placeContext, selectContext,
    putContext: (id, C, a, dims) => { putContext(S, id, C, a, dims); scheduleLight(); },
    duplicateContext: id => { const nid = duplicateContext(id); schedule(); return nid; },
    pullContext: (id, key, dim, snaps) => { pullContext(S, id, key, dim, snaps); scheduleLight(); },
    turnContext: (id, a, snaps) => { turnContext(S, id, a, snaps); scheduleLight(); },
    askInstance, contextMenu,
    // the selected storey, edited in the site view
    plateTo: o => { plateTo(S, o); scheduleLight(); },
    pick,
    // one of the selected storey's icons in the site view: add, copy or move it, up or down
    act: (n, a) => api.act(n, a),
    // an array dragged down to nothing goes back to one member when it is let go
    endArray: () => { if (arrayGone('a.len', getValue('a.len'))) { setValue('a.on', false); schedule(); } },
    togglePop: i => { POP.at = i; POP.st = 'open'; paint(i); },
    nudge: (g, x, y) => openNudge(x, y, g, S, api),
    // a window or a storey's wall clicked: the storey to edit, and the window's own small window open where it has windows
    selectPlate: (f, st, unit = null) => { if (S.site && S.site.ctxSel) setValue('site.ctxSel', null); V.plate.on = true; openWidget(SW, inst); closeWidget(SITEW); V.siteEdit = false; select(f, st, unit); picked = unit === null ? 'wall' : 'window'; showWindowPop(inst); },
    selectWindow: (f, st, unit) => { select(f, st, unit); picked = 'window'; showWindowPop(inst); },
    // the storey's gumball arrow clicked: how far to move it along that axis, typed
    askPlateMove: (w, C0, x, y) => openAsk(x, y, 'move mm', n => { stopPlay(); H.mark('plate:move'); plateTo(S, { C: [C0[0] + w[0] * n / 1000, C0[1] + w[1] * n / 1000] }); schedule(); }),
    // a click on nothing lets the storey go, and the window with it: their handles and small windows go
    // the site's lines pushed and pulled; one clicked opens the boundary's small window on its side
    siteSet: (k, v) => { setValue(k, v); scheduleLight(); },
    siteSetMany: kvs => { for (const [k, v] of kvs) setValue(k, v); scheduleLight(); },
    openBoundary: (f, i) => openBoundary(f, i),
    endPlate: () => { V.plate.on = false; closeWidget(SW); closeWidget(SITEW); V.siteEdit = false; if (S.pick === 'window') { S.pick = null; picked = null; hideWidget(POP); } } });
  return inst;
}

/* the storey's study behind the selected window: the sun on its floor now, and the plan's day and year maps */
function roomStudy(F, dni, light, mode = 'now') {
  const { m, cur, S: st } = F;
  if (!m.opening) return null;
  const R = roomOf(m, st), region = getRegion(m, R, st, mode === 'year' ? 'year' : 'day'), study = { R, region };
  study.nowGrid = floorNow(m, region, cur.sl, cur.onFacade ? dni : 0);
  study.now = study.nowGrid;
  if (!light) {
    study.land = landing(m, R, cur.sl, cur.onFacade ? dni : 0, region);
    study.land.dni = dni;
    study.land.enter = cur.onFacade ? unitGain(m, cur.sl, dni, 61, 49, cur.frac).ent : 0;
  }
  // the plan's floor is lit through the windows the results are for
  study.light = PLAN_LIGHT[st.scope] || 'unit';
  if (study.light !== 'unit') {
    study.units = lightUnits(F);
    study.nowAll = floorNowAll(F, study.units, cur.up ? dni : 0);
    if (mode !== 'now') study[mode] = getFloorAll(F, study.units, R, mode);
  } else if (mode !== 'now') study[mode] = getFloor(m, R, st, mode);
  return study;
}

/* One view drawn: on the sheet its space gives it, with its own cameras, and
   what the drawing leaves for the pointer kept on the view, so two views of
   one kind never answer for each other. */
/** a view pinned to a saved window, or let go of one - its bar says which */
function setPin(inst, id) {
  inst.pin = id && savedWindow(S, id) ? id : null;
  inst.el.dataset.pin = inst.pin || '';
  const sv = inst.el.querySelector('.vsave'), ren = inst.el.querySelector('.wren'), del = inst.el.querySelector('.wdel');
  if (sv) sv.hidden = !!inst.pin;
  if (ren) ren.hidden = !inst.pin;
  if (del) del.hidden = !inst.pin;
  inst.el.classList.toggle('pinned', !!inst.pin);
  refreshTypes(true, inst); if (inst.el.isConnected) saveLayout();
}
/** each plan's and section's window menu: the selected window first, then every saved one */
function refreshTypes(force = false, only = null) {
  const views = S.views || [], sig = JSON.stringify(views.map(v => [v.id, v.name]));
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  for (const inst of only ? [only] : insts()) {
    const sel = inst.el.querySelector('.winSel');
    if (!sel) continue;
    if (force || sel.dataset.sig !== sig) {
      sel.innerHTML = '<option value="">Selected window</option>' + (views.length ? '<optgroup label="Bookmarks">' + views.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('') + '</optgroup>' : '');
      sel.dataset.sig = sig;
    }
    sel.value = inst.pin || '';
    // a window already saved is not saved again: the button says where it is
    const sv = inst.el.querySelector('.vsave'), was = windowSavedAs(S, S.sel.f, S.sel.st, selUnitIndex(S));
    if (sv) { sv.disabled = !!was; sv.title = was ? 'The selected window is bookmarked already, as ' + was.name + ' - choose it in the menu' : 'Bookmark the selected window and its section and plan cuts by name; this view then keeps showing it'; }
  }
}
/** a saved window's view not selected shows its own cuts in its bar */
function pinnedBars() {
  for (const inst of insts()) {
    const v = inst.pin && S.activeView !== inst.pin && savedWindow(S, inst.pin);
    if (!v) continue;
    for (const [k, x] of [['cutU', v.cutU], ['cutV', v.cutV]]) inst.el.querySelectorAll(`[data-val="${k}"]`).forEach(o => { if (!o.firstElementChild) o.textContent = fmt(x, 2) + ' m'; });
  }
}
/** a figure in a view's title that is read at a glance */
const big = v => '<strong class="tbig">' + v + '</strong>';
/* The picked device's small window: one on the page, hung off the gumball
   of the view it was picked or reopened in. It opens when a device is
   picked and goes when it is let go; its title moves it anywhere on the
   page, it folds, and it closes - the gumball's centre opens it again.    */
const POP = makeWidget('', { change: w => { if (w.at) paint(w.at); }, avoid: () => [SW, SITEW] });
/* the selected storey's small window, in the site view: it stays where it opened */
const SW = makeWidget('stpop', { stay: true, change: w => { if (w.at) paint(w.at); }, avoid: () => [POP] });
const view3d = t => t === 'axon' || t === 'detail';
/** the library: every entry of a kind the design has made by name - not the copies a break or the optimization makes on their own */
const libOf = kind => Object.values(S.lib[kind]).filter(o => !o.auto);
/** the saved entries of a kind, by name */
const libList = kind => Object.values(S.lib[kind]).map(o => [o.id, kind === 'devices' ? o.name || deviceLabel(o) : o.name || defaultName(kind, o)]);
/** the selected window against its array, for its small window */
function brkInfo(F) {
  const row = F.B && F.B.facades[S.sel.f] && F.B.facades[S.sel.f].rows[S.sel.st], n = row && row.units ? row.units.length : 0;
  return { can: n > 1 && !!selUnitType(), broken: isBroken(S, 'win'), i: selUnitIndex(S), others: otherBroken(S, 'win'), pending: brkUI.pending === 'win' };
}
function devPop(inst, F) {
  if (inst !== POP.at) return;
  // a bare side has no window for the frame to carry the pick on: the pick itself says so
  const P = inst.h.pop, has = !!selCell(), isWin = !!(P && (P.kind === 'window' || P.kind === 'wall') && (F.pick === 'window' || (!has && S.pick === 'window')));
  if (!(P && (isWin || F.selD) && POP.st !== 'closed')) { hideWidget(POP); return; }
  const min = POP.st === 'min';
  let html;
  if (isWin && !has) {
    // a bare side: in a 3D view, a window system added to it
    if (!view3d(inst.type)) { hideWidget(POP); return; }
    html = emptyPopHTML(min, { presets: Object.entries(SYSTEM_PRESETS).map(([k, p]) => [k, p.label]), saved: libOf('systems').map(y => [y.id, y.name || 'Window group']) });
  } else if (isWin) {
    const r = selCell(), u = selUnitType(), b = brkInfo(F), row = F.B && F.B.facades[S.sel.f] && F.B.facades[S.sel.f].rows[S.sel.st], nU = row && row.units ? row.units.length : 1;
    html = windowPopHTML(F.m, min, { view3d: view3d(inst.type), mode: inst.type === 'axon' && picked === 'wall' ? 'facade' : 'window', more: POP.more,
      title: 'Window ' + (selUnitIndex(S) + 1) + (nU > 1 ? ' of ' + nU : ''), devs: shadingDevs(), cur: r.dev || 0, add: addGroups('both'), side: S.sel.f + ' side', st: S.sel.st,
      live: !!(S.live && S.live.f === S.sel.f && S.live.st === S.sel.st),
      sysName: entryName(S, 'systems', r.sys), unitName: u ? entryName(S, 'units', u.id) : '', brk: b,
      grpName: (selShading(S) || {}).name || 'Shading group', grpId: (selShading(S) || {}).id, grpOpts: libOf('shading').map(x => [x.id, x.name || 'Shading group']),
      sysId: r.sys, winOpts: libOf('systems').map(y => [y.id, y.name || 'Window group']),
      arr: getValue('g.arrOn'), by: getValue('g.arrBy'), sides: getValue('matchSides'), up: getValue('matchGlazing'), above: S.sel.st < S.storeys.length - 1 });
  } else html = devicePopHTML(F.selD, P.ax, P.arrayView, min, { more: POP.more, grpName: (selShading(S) || {}).name || 'Shading group', grpId: (selShading(S) || {}).id,
    grpOpts: libOf('shading').map(x => [x.id, x.name || 'Shading group']), devOpts: libOf('devices').filter(D => D.dir === F.selD.dir).map(D => [D.id, D.name || deviceLabel(D)]) });
  // in the site view, to the window's left, clear of the storey's own small window on its right
  showWidget(POP, html, { x: P.x, y: P.y, side: inst.type === 'axon' ? 'left' : 'right', mid: inst.type === 'axon' });
}
/** the selected storey's small window, beside it in the site view */
function storeyPop(inst) {
  if (SW.at !== inst) return;
  const pe = inst.h.plateEdit;
  // the storey's own small window opens with its wall or its roof, or from the window's
  if (!(V.plate.on && pe && pe.anchor)) { hideWidget(SW); return; }
  const n = S.storeys.length, p = S.storeys[S.sel.st];
  showWidget(SW, storeyPopHTML(SW.st === 'min', { i: S.sel.st, n, full: n >= STOREYS_MAX, match: getValue('matchPlate'), rotBelow: (p.rotRel || 'building') === 'below' }),
    { x: pe.anchor[0], y: pe.anchor[1], side: 'right', mid: true });
}
/* the site boundary's small window, off the middle of the side being set; the side picked out while it is open */
const SITEW = makeWidget('sitepop', { change: w => { V.siteEdit = w.st !== 'closed'; if (w.at) paint(w.at); } });
function openBoundary(f, inst) {
  if (f) setValue('site.edit', f);
  // the site picked lets the storey and its window go
  V.plate.on = false; closeWidget(SW);
  if (S.pick === 'window') { S.pick = null; picked = null; hideWidget(POP); }
  if (inst.V.layers) inst.V.layers.site = true;
  openWidget(SITEW, inst); V.siteEdit = true; schedule();
}
function sitePop(inst) {
  if (SITEW.at !== inst) return;
  const f = (S.site && S.site.edit) || 'S', mids = inst.h.siteMids;
  if (!mids || !mids[f]) { hideWidget(SITEW); return; }
  showWidget(SITEW, sitePopHTML(SITEW.st === 'min', { f, kind: S.site[f] ? S.site[f].kind : 'open' }), { x: mids[f][0], y: mids[f][1], side: 'right', mid: true });
}
/** the shading menu on a plan's or a section's bar: a new member, or what is saved - kept to the design's library */
function shadingMenu(inst) {
  const sel = inst.el.querySelector('.addShd');
  if (!sel) return;
  const has = !!(selCell() && selUnitType()), dir = sel.dataset.dir === 'v' ? 'v' : 'h', groups = addGroups(dir), sig = has + JSON.stringify(groups);
  if (sel.dataset.sig === sig) return;
  sel.dataset.sig = sig;
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  sel.innerHTML = '<option value="" hidden selected>Add shading device</option>' + groups.filter(([, xs]) => xs.length).map(([l, xs]) => (l ? `<optgroup label="${esc(l)}">` : '')
    + xs.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('') + (l ? '</optgroup>' : '')).join('');
  sel.disabled = !has || !!S.live;
  sel.title = has ? 'A shading device on the selected window - and every window of its array: a new one, a preset, or one you have saved. It is picked, ready to shape here.' : 'Shading hangs on a window: select one first';
}
/* What shading can be added: new devices, the presets, and what the user has
   saved - on a plan or a section only what runs the way it cuts. */
const PRESET_DIR = { fins: 'v', canopy: 'h', louvredCanopy: 'h', louvres: 'h', eggcrate: 'both', balcony: 'h' };
function addGroups(dir) {
  const ok = d => dir === 'both' || d === dir, saved = libOf;
  const fresh = [['new:h', 'New horizontal device'], ['new:v', 'New vertical device']].filter(([v]) => ok(v.slice(4)));
  return [['', fresh], ['Presets', Object.entries(SHADING_PRESETS).filter(([k]) => ok(PRESET_DIR[k] || 'both')).map(([k, p]) => ['pre:' + k, p.label])],
    ['Library devices', saved('devices').filter(D => ok(D.dir || 'h')).map(D => ['dev:' + D.id, D.name || deviceLabel(D)])],
    ['Library shading groups', dir === 'both' ? saved('shading').filter(x => x.devices.length).map(x => ['grp:' + x.id, x.name || 'Shading group']) : []]];
}
/** the selected window's shading, a device at a time */
function shadingDevs() {
  const h = selShading(S);
  return h ? h.devices.map((id, i) => { const D = S.lib.devices[id]; return D ? { i, name: D.name || deviceLabel(D), dir: D.dir } : null; }).filter(Boolean) : [];
}
/** what the last click in a 3D view took: a window, or a storey's wall - what Delete takes out */
let picked = null;
/** the selected side's windows picked, and their small window opened off the view clicked in - where the side has windows */
function showWindowPop(inst) {
  if (!selCell() && !view3d(inst.type)) return;
  if (S.pick !== 'window' || POP.st === 'closed') openWidget(POP, inst);
  S.pick = 'window'; POP.at = inst; POP.st = 'open';
}
/** a device picked - in the panel, or on a drawing; picked afresh, its window opens */
function pickOnly(i, inst) {
  // the live members are the optimization's: not picked to edit while it is on
  if (S.live) return;
  const r = selCell();
  if (S.pick !== 'device' || (r && (r.dev || 0) !== i) || POP.st === 'closed') openWidget(POP, inst || POP.at);
  POP.at = inst || POP.at || insts().find(x => x.type === 'section' || x.type === 'plan') || null;
  if (r) r.dev = i;
  S.pick = 'device';
}
/** an array with nothing left to repeat: no length, a single member by number, or no spacing */
function arrayGone(k, v) {
  if (!getValue('a.on')) return false;
  return (k === 'a.arrSp' && !(v > 0)) || !(getValue('a.len') > 0.004) || (getValue('a.mode') === 'count' && getValue('a.arrN') <= 1);
}
/** a click on a plan or a section: the window and its wall, a device, or nothing - which hides every handle */
function pick(i, inst) {
  // a click on a plan or a section: Delete then takes the window system, never the storey
  picked = i === 'win' ? 'window' : null;
  if (i === null) { if (!S.pick) return; S.pick = null; }
  else if (i === 'site') S.pick = 'site';
  else if (i === 'win') {
    // the window picked - or clicked again - opens its own small window
    if (S.pick !== 'window' || POP.st === 'closed') openWidget(POP, inst || POP.at);
    POP.st = 'open'; POP.at = inst || POP.at; S.pick = 'window';
  }
  else pickOnly(i, inst);
  if (!S.pick) hideWidget(POP);
  schedule();
}
function drawInst(inst, F0, ctx) {
  shadingMenu(inst); liveBar(inst);
  // a saved window's view draws its own window and cuts - the selection's frame when it is the selection
  if (inst.pin && !savedWindow(S, inst.pin)) setPin(inst, null);
  const pin = inst.pin && S.activeView !== inst.pin ? inst.pin : null;
  const F = pin ? (ctx.frames[pin] || (ctx.frames[pin] = buildFrame(windowState(S, pin), V, ctx.light))) : F0;
  const { cur, sel, T, m } = F, Fi = Object.assign({}, F, { V: inst.V });
  setSheet(...sheetFor(inst.el));
  const pct = F.res ? fmt(F.res.frac * 100, 1) + '%' : '—', md = F.date, dateStr = MONTHS[md.m - 1] + ' ' + md.d;
  const where = sel.f + ' · storey ' + (sel.st + 1) + (sel.unit !== null ? ' · unit ' + (sel.unit + 1) : '');
  const sk = mode => (pin ? pin + ':' : '') + mode;
  const study = mode => { if (!(sk(mode) in ctx.studies)) ctx.studies[sk(mode)] = roomStudy(F, ctx.dni, ctx.light, mode); return ctx.studies[sk(mode)]; };
  switch (inst.type) {
    case 'axon':
      inst.host.innerHTML = drawAxon(Fi); inst.h = { hits: axonHits, handle: axonHandle, focus: axonFocus, ctxHits: axonCtxHits, ctxEdit: axonCtxEdit, plateEdit: axonPlateEdit, pop: axonWinPop, siteLines: axonSiteLines, siteMids: axonSiteMids };
      devPop(inst, F); storeyPop(inst); sitePop(inst);
      inst.title.innerHTML = titleBlock('Site angles', [
        ['β', cur.up ? fmt(cur.alt, 1) + '°' : 'sun down'], ['solar azimuth', cur.up ? fmt(wrap180(cur.az - 180), 1) + '° from S' : '—'], ['γ', cur.up ? fmt(-cur.gamma, 1) + '°' : '—']]);
      break;
    case 'sun':
      inst.host.innerHTML = inst.V.sunMode === 'year' ? drawSunYear(Fi, getHourly(T)) : drawSunPath(Fi); inst.h = {};
      inst.title.innerHTML = titleBlock(inst.V.sunMode === 'year' ? 'Sun across the year' : 'Sun path chart', [
        ['facade', sel.f + ' side · ' + fmt(wrap180(cur.gf - 180), 0) + '° from S'],
        ['shading', SCOPES[S.scope].toLowerCase() + (T.units > 1 ? ' (' + T.units + ' units)' : '')],
        ['plotted', dateStr + ' ' + hhmm(S.hour) + ' ' + CLOCK_NAME[S.timeMode]]]);
      break;
    case 'section':
      inst.host.innerHTML = drawSection(Fi, study('now')); inst.h = { handle: sectionHandle, cut: secCutLine, grips: sectionGrips, devHits: sectionDevHits, pop: sectionPop };
      devPop(inst, F);
      inst.title.innerHTML = titleBlock('Section · profile angle', [
        ['θ', cur.onFacade ? fmt(cur.vsa, 1) + '°' : 'no direct sun'], ['device', stackLabel(F)], ['shaded', pct]]);
      break;
    case 'plan':
      inst.host.innerHTML = drawPlan(Fi, study(inst.V.inMode)); inst.h = { handle: planHandle, cut: planCutLine, grips: planGrips, devHits: planDevHits, pop: planPop };
      devPop(inst, F);
      inst.title.innerHTML = titleBlock('Plan · γ and floor sun', [
        ['γ', cur.up ? fmt(-cur.gamma, 1) + '°' : '—'], ['floor', INTERIOR_MODES[inst.V.inMode].toLowerCase()], ['condition', where]]);
      inst.el.querySelectorAll('.inModes button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === inst.V.inMode)));
      break;
    case 'gday': case 'gyear': {
      // the day's and the year's solar heat, for what the results are for; cached figures only, so a drag never waits on them
      const v = inst.type === 'gday' ? getDayGain(T, S) : getYearGain(T, S);
      inst.host.innerHTML = v ? (inst.type === 'gday' ? chartGainDay(v, S.hour) : chartGainYear(v))
        : '<p class="vwait">' + (T.items.length ? 'Working out the ' + (inst.type === 'gday' ? 'day…' : 'year…') : 'No glazing in what the results are for: add a window system under Window Parameters.') + '</p>';
      inst.h = {};
      inst.title.innerHTML = titleBlock(inst.type === 'gday' ? 'Solar heat gain · ' + dateStr : 'Solar heat gain · the year', [
        ['for', RESULT_SCOPES[S.scope].toLowerCase()], ['sky', SKIES[S.sky].toLowerCase()]].concat(inst.type === 'gyear' || S.sky !== 'clear' ? [['weather', WEATHER_FILES[S.wx]]] : []));
      break;
    }
    case 'detail': {
      inst.host.innerHTML = drawDetail(Fi); inst.h = { sun: detailSun, hits: detailHits, eye: detailEye, pop: detailWinPop };
      devPop(inst, F);
      // the selected window's beam into the room: worked out on a full redraw, kept while the day plays
      if (!ctx.light) {
        const land = m.opening && cur.onFacade ? (study('now') || {}).land : null, lit = land && land.total > 0;
        inst._beam = !m.opening ? [] : [['into the room', big(cur.onFacade ? fmt(land ? land.total : 0, 0) + ' W' : 'no sun')],
          ['on the floor', big(lit ? fmt(land.dni * m.shgc * Math.sin(cur.alt * D2R), 0) + ' W/m²' : '—')]];
      }
      inst.title.innerHTML = titleBlock('Window in 3D', [
        ['system', m.opening ? (m.glz.sysName || 'glazing').toLowerCase() : 'none'], ['sun on the glass', big(m.opening && cur.onFacade ? fmt((1 - cur.frac) * 100, 0) + '%' : 'none')]].concat(inst._beam || []));
      break;
    }
  }
}
/** one view repainted on its own, lightly - an orbit, a zoom, a pan */
const paintQ = new Set();
let paintRaf = null;
function paint(inst, full = false) {
  paintQ.add(inst);
  if (paintRaf) return;
  paintRaf = requestAnimationFrame(() => {
    paintRaf = null;
    const F = buildFrame(S, V, !full), { dni } = beamAt(S.sky, S.wx, S.doy, S.hour, S.timeMode), ctx = { dni, light: false, studies: {}, frames: {} };
    for (const i of paintQ) if (i.el.isConnected) drawInst(i, F, ctx);
    paintQ.clear();
  });
}

/* ---------- a frame ----------
   `light` redraws the drawings and the instant figures only. The day's and
   the year's totals wait while the day is playing or a drag is held. */
/* Live optimization kept to the moment: before each drawing, the ideal for the
   window it is on - at the date and time set, with the member counts chosen -
   is worked out from that window's glass and the sun, and written into its members. */
function liveUpdate() {
  const L = S.live;
  if (!L) return;
  const st2 = Object.assign({}, S, { sel: { f: L.f, st: L.st, unit: L.unit } }), g = liveGlz(st2), s = liveStorey(st2);
  if (!g || !S.storeys[L.st]) { S.live = null; return; }
  const m = liveCell(g, s.h, liveLen(S, L.f, L.st), 0, s.slab ?? LIVE_SLAB0), sp = liveSun(S.doy, S.hour, S.timeMode), gf = liveAz(S, L.f);
  const onFacade = sp.alt > 0 && Math.cos(liveWrap(gf - sp.az) * Math.PI / 180) > 0;
  const Fp = { m, cur: { gf, az: sp.az, vsa: getValue('theta', st2), onFacade }, date: liveDate(S.doy), S };
  liveApply({ h: idealSpec(Fp, 'h'), v: idealSpec(Fp, 'v'), c: idealSpec(Fp, 'c') });
}
/* While it is on, every view says so along its top: the member counts to the
   left, and the way to turn it off to the right. */
const LIVE_VIEWS = { axon: 1, detail: 1, section: 1, plan: 1 };
const LIVE_KINDS = [['h', 'Horizontal'], ['v', 'Vertical'], ['hv', 'Egg-crate'], ['c', 'Louvred canopy']];
function liveBar(inst) {
  let el = inst.el.querySelector('.livebar');
  const on = inst.el.querySelector('.liveon');
  if (on) on.hidden = !!S.live;
  // on the drawings only: the charts follow what it puts on the window, without a bar of their own
  if (!S.live || !LIVE_VIEWS[inst.type]) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.className = 'livebar'; inst.el.querySelector('.v3dbar').appendChild(el); }
  const L = S.live, sig = liveKind(L) + L.f + L.st;
  const sl = (k, label) => `<label class="recn" title="How many members share the work: one deep member, or n each 1/n as deep at 1/n the spacing - ${label === 'H' ? 'horizontal' : label === 'V' ? 'vertical' : 'members'}"><span>${label}</span><input type="range" min="1" max="${MEMBERS_MAX}" step="1" value="${recUI[k]}" data-livn="${k}" aria-label="${label}"><output>${recUI[k]}</output></label>`;
  if (el.dataset.sig !== sig) {
    el.dataset.sig = sig;
    const kind = liveKind(L);
    el.innerHTML = `<span class="liveset"><b title="Live optimization on the ${L.f} side, storey ${L.st + 1}">Live</b>`
      + `<select class="livekind" aria-label="What the optimization puts on the window" title="What the optimization puts on the window: horizontal members, vertical members, both, or a louvred canopy of upright members standing out from the facade">${LIVE_KINDS.map(([k, l]) => `<option value="${k}"${k === kind ? ' selected' : ''}>${l}</option>`).join('')}</select>`
      + `${L.h ? sl('nh', L.v ? 'H' : 'Members') : ''}${L.v ? sl('nv', L.h ? 'V' : 'Members') : ''}${L.c ? sl('nc', 'Members') : ''}</span><button type="button" class="minibtn liveoff" title="Turn off live optimization: keep the shading under a name, or put back what the window had">Turn off</button>`;
  } else el.querySelectorAll('[data-livn]').forEach(i => { if (document.activeElement !== i) { i.value = recUI[i.dataset.livn]; i.nextElementSibling.textContent = recUI[i.dataset.livn]; } });
}
document.addEventListener('input', e => {
  const k = e.target.dataset && e.target.dataset.livn;
  if (!k) return;
  recUI[k] = +e.target.value; e.target.nextElementSibling.textContent = e.target.value;
  scheduleLight();
});
document.addEventListener('change', e => {
  if (e.target.dataset && (e.target.dataset.livn || e.target.dataset.recn)) schedule();
  if (e.target.matches && e.target.matches('.livekind')) api.act('liveKind', e.target.value);
});
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('.liveon');
  if (!b) return;
  if (!selCell() || !selUnitType()) { b.title = 'Select a window first: the optimization goes on the selected window'; return; }
  api.act('liveToggle', 'h');
});
/* Turning the optimization off asks what the window keeps: what it carried before, or the last of the optimization */
const KIND_NAME = { h: 'Ideal horizontal', v: 'Ideal vertical', hv: 'Ideal egg-crate', c: 'Ideal louvred canopy' };
function askLiveEnd(el) {
  const r = el.getBoundingClientRect(), md = liveDate(S.doy);
  const name = KIND_NAME[liveKind(S.live)] + ' - ' + MONTHS[md.m - 1] + ' ' + md.d + ', ' + hhmm(S.hour);
  const m = openPop(r.left, r.bottom, `<p>Turn off live optimization</p><input type="text" class="livename" value="${name.replace(/"/g, '&quot;')}" spellcheck="false" aria-label="Name to keep it under" title="The name the shading keeps, in the library">`
    + '<button type="button" data-liveend="keep">Keep it, under this name</button><button type="button" data-liveend="revert">Revert to the previous shading</button><button type="button" data-liveend="">Cancel</button>');
  const box = m.querySelector('.livename');
  box.focus(); box.select();
  box.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') m.querySelector('[data-liveend="keep"]').click(); else if (ev.key === 'Escape') closePop(); });
}
document.addEventListener('click', e => {
  const off = e.target.closest && e.target.closest('.liveoff');
  if (off) { askLiveEnd(off); return; }
  const end = e.target.closest && e.target.closest('[data-liveend]');
  if (end) {
    const m = end.dataset.liveend, box = end.parentElement && end.parentElement.querySelector('.livename'), name = box && box.value.trim();
    closePop();
    if (m === 'keep') { stopPlay(); H.mark('live'); liveOff('keep', S, name || null); schedule(); }
    else if (m) api.act('liveOff', m);
  }
});
function render(light = false) {
  liveUpdate();
  // the cuts kept in the saved window that is the selection, however they were moved
  keepCuts(S);
  const F = buildFrame(S, V, light);
  const { m, cur, res, sel, T } = F, md = F.date;
  const dateStr = MONTHS[md.m - 1] + ' ' + md.d, pct = res ? fmt(res.frac * 100, 1) + '%' : '—';
  const where = sel.f + ' · storey ' + (sel.st + 1) + (sel.unit !== null ? ' · unit ' + (sel.unit + 1) : '');
  const { dni } = beamAt(S.sky, S.wx, S.doy, S.hour, S.timeMode);

  // every view on the page, each on its own sheet
  const ctx = { dni, light, studies: {}, frames: {} };
  for (const inst of insts()) drawInst(inst, F, ctx);
  const study = ctx.studies.now || roomStudy(F, dni, light);
  // design recommendations: the selected window's face, at this instant; the bar says which, so it reads collapsed
  lastF = F;
  $('dockFor').textContent = recFor(F);
  $('rec1').innerHTML = recSun(F);
  putRec($('rec2'), recGeometry(F));
  $('rec3').innerHTML = recBylaw(F);

  // the solar heat coming in, under the settings that say what it is for: the day's and the year's as they are ready
  const unit = m.opening && cur.onFacade ? unitGain(m, cur.sl, dni, 61, 49, cur.frac) : null;
  const tot = T.items.length ? (S.scope === 'unit' && unit ? unit : targetGain(T, cur.alt, cur.az, cur.up ? dni : 0)) : null;
  const now = tot ? Object.assign({}, tot, { dni, cos: unit ? cur.sl[2] : 0, lit: unit ? unit.lit : 0, shgc: m.shgc, count: T.units }) : null;
  $('calc4').innerHTML = now ? resGain(F, now, getDayGain(T, S), getYearGain(T, S))
    : '<p class="calcnote">No glazing in what the results are for: add a window system under Window Parameters.</p>';
  if (!light) {
    $('checks').innerHTML = renderChecks(F);
    $('energyRules').innerHTML = renderEnergy(S);
    syncRail(S); refreshTypes();
  } else syncClock(S);
  pinnedBars();
}

/* A member count being slid on a recommendation is kept in hand: the
   recommendations are put back part by part round it, never over it. */
let lastF = null;
function putRec(host, html) {
  const act = document.activeElement, mine = act && host.contains(act) && act.tagName === 'INPUT';
  const t = document.createElement('template'); t.innerHTML = html;
  // the control in hand is a member count or a name being typed: it stays, if what is redrawn still has it
  const sel = !mine ? null : act.dataset.recn ? `[data-recn="${act.dataset.recn}"]` : act.dataset.for ? `[data-ideal="${act.dataset.for}"]` : null;
  if (!sel || !t.content.querySelector(sel)) { host.innerHTML = html; return; }
  host.querySelectorAll('[data-part]').forEach(el => { const n = t.content.querySelector(`[data-part="${el.dataset.part}"]`); if (n) el.replaceWith(n); });
}
$('recs').addEventListener('input', e => {
  const k = e.target.dataset && e.target.dataset.recn;
  if (!k || !lastF) return;
  recUI[k] = +e.target.value;
  const o = e.target.parentElement.querySelector('output'); if (o) o.textContent = e.target.value;
  putRec($('rec2'), recGeometry(lastF)); $('rec3').innerHTML = recBylaw(lastF);
  // live, the window's members follow the count
  if (S.live) scheduleLight();
});

/* An ideal made a shading system type: named in place of its button, and put on the selected window */
$('recs').addEventListener('click', e => {
  const lv = e.target.closest('[data-live]');
  if (lv) {
    // the last kind turned off ends the optimization: ask what the window keeps
    const L = S.live, d = lv.dataset.live, last = L && L[d] && ['h', 'v', 'c'].filter(k => L[k]).length === 1;
    if (last) askLiveEnd(lv); else api.act('liveToggle', d);
    return;
  }
  const b = e.target.closest('[data-ideal]');
  if (!b || !lastF) return;
  const spec0 = idealSpec(lastF, b.dataset.ideal);
  if (!spec0) return;
  const box = document.createElement('input');
  box.type = 'text'; box.className = 'vname idealname'; box.dataset.for = b.dataset.ideal; box.value = spec0.name; box.placeholder = spec0.name; box.spellcheck = false;
  box.setAttribute('aria-label', 'Name of the new shading system type'); box.title = 'Tab takes the suggested name; Enter makes it and puts it on the selected window; Escape leaves it';
  b.hidden = true; b.after(box); box.focus(); box.select();
  let over = false;
  const close = ok => {
    if (over) return; over = true;
    const name = box.value; box.remove(); b.hidden = false;
    // the ideal as it stands when the name is entered: the member count may have been changed meanwhile
    const spec = ok && lastF && idealSpec(lastF, b.dataset.ideal);
    if (spec) { stopPlay(); H.mark('library'); shadingFromIdeal(spec, name); schedule(); }
  };
  box.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') close(true); else if (ev.key === 'Escape') close(false); });
  box.addEventListener('blur', () => close(false));
});

let raf = null, rafLight = null, heavyTimer = null;
const scheduleLight = () => { if (!rafLight) rafLight = requestAnimationFrame(() => { rafLight = null; render(true); }); };
const schedule = () => {
  if (!raf) raf = requestAnimationFrame(() => { raf = null; render(); });
  clearTimeout(heavyTimer);
  heavyTimer = setTimeout(heavyPass, 170);
};
/** the sky mask, the totals over a storey or more, and the room's day and
 *  year maps are too slow for every tick, so they settle once a control is let
 *  go - one study a turn, the page redrawn after each, so that on a big
 *  building the figures arrive one by one and the page never waits on all */
function heavyPass() {
  const F = buildFrame(S, V);
  const steps = [
    [() => maskStale(F.T), () => getMask(F.T, true)],
    [() => envStale(F.T), () => getEnvelopes(F.T, true)],
    [() => dayGainStale(F.T, S), () => getDayGain(F.T, S, true)],
    [() => yearGainStale(F.T, S), () => getYearGain(F.T, S, true)],
    ...[...new Map(insts().filter(i => i.type === 'plan' && i.V.inMode !== 'now').map(i => {
      const pin = i.pin && S.activeView !== i.pin && savedWindow(S, i.pin) ? i.pin : '';
      return [pin + '|' + i.V.inMode, { mode: i.V.inMode, pin }];
    })).values()].map(({ mode, pin }) => {
      const Fx = pin ? buildFrame(windowState(S, pin), V) : F, Sx = Fx.S;
      return [() => Fx.m.opening && (PLAN_LIGHT[S.scope] === 'unit' ? floorStale(Fx.m, Sx, mode) : floorAllStale(Fx, mode)),
        () => PLAN_LIGHT[S.scope] === 'unit' ? getFloor(Fx.m, roomOf(Fx.m, Sx), Sx, mode, true) : getFloorAll(Fx, lightUnits(Fx), roomOf(Fx.m, Sx), mode, true)];
    })];
  for (const [stale, run] of steps) if (stale()) {
    run(); render();
    heavyTimer = setTimeout(heavyPass, 0);
    return;
  }
}

/* ---------- playing the day: clock time advances with real time ---------- */
let anim = null;
const DAY_SECONDS = 13;
function stopPlay() {
  if (!anim) return;
  cancelAnimationFrame(anim.raf); anim = null;
  $('playBtn').textContent = '▶ Play day'; $('playBtn').classList.remove('on');
}
function togglePlay() {
  if (anim) { stopPlay(); render(); return; }
  $('playBtn').textContent = '■ Stop'; $('playBtn').classList.add('on');
  const ss = sunriseSunsetSolar(S.doy);
  const a = ss ? Math.max(0, solarToClock(ss[0], S.doy, S.timeMode) - 0.4) : 4;
  const b = ss ? Math.min(24, solarToClock(ss[1], S.doy, S.timeMode) + 0.4) : 20;
  if (S.hour < a || S.hour > b) S.hour = a;
  anim = { a, b, rate: (b - a) / DAY_SECONDS, last: performance.now(), drawn: 0, raf: 0 };
  const step = now => {
    S.hour += Math.min(0.12, (now - anim.last) / 1000) * anim.rate;
    anim.last = now;
    if (S.hour > anim.b) S.hour = anim.a;
    if (now - anim.drawn > 40) { anim.drawn = now; render(true); }   // capped at 25 frames a second
    anim.raf = requestAnimationFrame(step);
  };
  anim.raf = requestAnimationFrame(step);
}

/* ---------- history ---------- */
function afterRestore() { resetStudies(); resetGains(); clearSunCache(); schedule(); }
function wireHistory() {
  const u = $('undoBtn'), r = $('redoBtn');
  H.onChange = () => {
    u.disabled = !H.undo.length; r.disabled = !H.redo.length;
    u.title = 'Undo the last edit (Ctrl+Z) · ' + H.undo.length + ' to go back through';
    r.title = 'Redo (Ctrl+Shift+Z) · ' + H.redo.length + ' to come forward through';
  };
  const back = () => { stopPlay(); if (H.back()) afterRestore(); };
  const fwd = () => { stopPlay(); if (H.forward()) afterRestore(); };
  u.addEventListener('click', back);
  r.addEventListener('click', fwd);
  // a drag holds its run open, and letting go closes it: one drag, one step
  addEventListener('pointerdown', () => { H.hold = true; }, true);
  addEventListener('pointerup', () => H.release(), true);
  addEventListener('pointercancel', () => H.release(), true);
  addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = (e.key || '').toLowerCase();
    if (k !== 'z' && k !== 'y') return;
    const t = e.target;                   // a text field keeps its own undo
    if (t && t.tagName === 'INPUT' && /^(text|search|number|email|url|password)$/.test(t.type)) return;
    e.preventDefault();
    (k === 'y' || e.shiftKey) ? fwd() : back();
  });
  H.onChange();
}

/* ---------- selecting a condition: the cuts go back to the middle of its glass ---------- */
function recentre() {
  if (selectionChanged(S)) return;
  const m = buildFrame(S, V, true).m;
  S.cutU = 0;
  S.cutV = m.opening ? (m.sill + m.head) / 2 : m.storeyH / 2;
}
function select(f, st, unit) {
  stopPlay();
  S.sel.f = f; S.sel.st = st; S.sel.unit = unit; brkUI.pending = false;
  recentre(); schedule();
}

/* ---------- context buildings: placed by a click in the site view, picked by one ---------- */
const siteViews = () => insts().filter(i => i.type === 'axon');
function endPlacing() { V.place.on = false; V.place.P = null; document.querySelectorAll('.view .v3dhost.placing').forEach(h => h.classList.remove('placing')); }
function placeContext(P) { stopPlay(); H.mark('ctx:place'); addContextAt(P); endPlacing(); openSite(); schedule(); }
function selectContext(id) { stopPlay(); setValue('site.ctxSel', id); if (id) V.plate.on = false; schedule(); }
/** the panel's Site Parameters opened, so the building just placed or picked can be set */
function openSite() { const d = $('siteHost') && $('siteHost').closest('details'); if (d) d.open = true; }
/* A small menu at the pointer, closed by a click anywhere else or by Esc. */
let popMenu = null;
function closePop() { if (popMenu) { const m = popMenu; popMenu = null; m.remove(); if (m._onClose) m._onClose(); } }
function openPop(x, y, html, onClose) {
  closePop();
  const m = document.createElement('div');
  m.className = 'ctxmenu'; m.innerHTML = html; m._onClose = onClose;
  Object.assign(m.style, { left: Math.round(x + window.scrollX + 4) + 'px', top: Math.round(y + window.scrollY + 4) + 'px' });
  document.body.appendChild(m);
  // kept on the screen
  const r = m.getBoundingClientRect();
  if (r.right > window.innerWidth - 8) m.style.left = Math.round(window.innerWidth - r.width - 8 + window.scrollX) + 'px';
  if (r.bottom > window.innerHeight - 8) m.style.top = Math.round(window.innerHeight - r.height - 8 + window.scrollY) + 'px';
  popMenu = m;
  return m;
}
document.addEventListener('pointerdown', e => { if (popMenu && !popMenu.contains(e.target)) closePop(); }, true);
/** an Alt-drag let go: the massing it left is a copy - its own - or an instance, which takes the other's pushes and pulls */
function askInstance(fromId, id, x, y) {
  const m = openPop(x, y, '<p>The massing dragged off is</p><button type="button" data-ci="copy" title="Its own massing: edits to one do not touch the other">A copy</button>'
    + '<button type="button" data-ci="inst" title="An instance: a face pushed or pulled on one is pushed or pulled on all its instances, each in its own axes. Where each stands is its own.">An instance</button>');
  m.addEventListener('click', e => {
    const b = e.target.closest('[data-ci]');
    if (!b) return;
    if (b.dataset.ci === 'inst') { H.mark('ctx:instance'); instanceContext(S, fromId, id); schedule(); }
    closePop();
  });
}
/** a massing right-clicked: its instance menu */
function contextMenu(id, x, y) {
  const c = ((S.site && S.site.ctx) || []).find(k => k.id === id);
  if (!c) return;
  if (S.site.ctxSel !== id) selectContext(id);
  const n = contextGroup(S, id).length, inst = n > 1, why = inst ? '' : ' title="Only an instance has this: Alt-drag a massing and choose An instance"';
  const m = openPop(x, y, `<p>${inst ? 'Instance · one of ' + n : 'Massing · not an instance'}</p>`
    + `<label class="chk"${why}><input type="checkbox" data-ci="rot"${c.inheritRot ? ' checked' : ''}${inst ? '' : ' disabled'}><span class="tipped" title="On: turning this massing turns its other instances by as much, each about its own middle. Set instance by instance - another instance can leave it off, and its turns stay its own.">Instances Inherit Rotation</span></label>`
    + `<button type="button" data-ci="unique"${inst ? '' : ' disabled'}${why}>Make Unique</button>`);
  m.addEventListener('change', e => { if (e.target.dataset.ci === 'rot') { H.mark('ctx:inheritRot'); c.inheritRot = e.target.checked; schedule(); } });
  m.addEventListener('click', e => { const b = e.target.closest('button[data-ci="unique"]'); if (!b || b.disabled) return; H.mark('ctx:unique'); makeUnique(S, id); schedule(); closePop(); });
}

/* The Place Context Massing button can also be dragged straight out: the
   ghost follows the pointer over the site view, and letting go there places
   the massing; let go anywhere else, nothing is placed. A plain click still
   waits for a click in the site view. */
let swallowClick = false;
document.addEventListener('click', e => { if (swallowClick) { swallowClick = false; e.stopPropagation(); e.preventDefault(); } }, true);
document.addEventListener('pointerdown', e => {
  const b = e.target.closest && e.target.closest('[data-act="placeContext"]');
  if (!b || e.button !== 0) return;
  const x0 = e.clientX, y0 = e.clientY;
  let dragging = false;
  const viewAt = ev => { const el = document.elementFromPoint(ev.clientX, ev.clientY), v = el && el.closest('.view[data-type=axon]'); return v && v._inst; };
  const groundOf = (inst, ev) => { const p = viewPoint(inst.host, ev); return p ? axonCamera(S, inst.V.axcam).ground(p[0], p[1]) : null; };
  const move = ev => {
    if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
    if (!dragging) { dragging = true; stopPlay(); V.place.on = true; V.place.P = null; document.body.classList.add('placedrag'); schedule(); }
    const inst = viewAt(ev);
    V.place.P = inst ? groundOf(inst, ev) : null;
    for (const i of siteViews()) paint(i);
  };
  const up = ev => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    document.body.classList.remove('placedrag');
    if (!dragging) return;
    swallowClick = true; setTimeout(() => { swallowClick = false; }, 0);
    const inst = viewAt(ev), P = inst && groundOf(inst, ev);
    if (P) placeContext(P); else { endPlacing(); schedule(); }
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  e.preventDefault();
}, true);

// Esc stops placing, or lets the selected massing go; Delete or Backspace removes the selected one
document.addEventListener('keydown', e => {
  const t = e.target, typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  if (e.key === 'Escape' && popMenu) { closePop(); return; }
  if (e.key === 'Escape' && V.place.on) { endPlacing(); schedule(); return; }
  if (e.key === 'Escape' && V.plate.on && !(S.site && S.site.ctxSel)) { V.plate.on = false; schedule(); return; }
  const id = S.site && S.site.ctxSel;
  // a window picked: its side's windows taken off; a storey's wall picked in the site view: the storey taken out
  if (!id && !typing && (e.key === 'Delete' || e.key === 'Backspace')) {
    // a shading device picked: it comes out of its shading system
    if (S.pick === 'device' && selCell()) { e.preventDefault(); stopPlay(); H.mark('device'); removeDevice(); S.pick = null; hideWidget(POP); schedule(); return; }
    if (picked === 'wall' && V.plate.on && S.storeys.length > 1) { e.preventDefault(); stopPlay(); H.mark('storey'); removeStorey(S.sel.st); picked = null; recentre(); schedule(); return; }
    if ((picked === 'window' || S.pick === 'window') && selCell()) { e.preventDefault(); stopPlay(); H.mark('window'); removeGlazing(); schedule(); return; }
  }
  if (!id || typing) return;
  if (e.key === 'Escape') { setValue('site.ctxSel', null); schedule(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); stopPlay(); H.mark('ctx:delete'); removeContext(id); schedule(); }
});

/* ---------- the panel's actions ---------- */
const ACTS = {
  selStorey: a => { const i = +a; if (i < 0 || i >= S.storeys.length) return; S.sel.st = i; S.sel.unit = null; brkUI.pending = false; recentre(); },
  selFacade: a => { S.sel.f = a; S.sel.unit = null; brkUI.pending = false; recentre(); },
  selUnit: a => { S.sel.unit = Math.max(0, +a); brkUI.pending = false; },
  // breaking a window out of its array, and binding it back; the floors above follow when set to
  // the part is 'win' (the window) or 'shd' (its shading), each broken and bound back on its own
  breakUnit: () => { H.mark('break'); breakUnit(S, 'win'); breakUnit(S, 'shd'); matchAbove(); },
  rebindRevert: () => { H.mark('break'); for (const p of ['win', 'shd']) rebindUnit('revert', 'keep', S, p); brkUI.pending = false; matchAbove(); },
  rebindApply: () => {
    if (otherBroken(S, 'win').length || otherBroken(S, 'shd').length) { brkUI.pending = 'win'; return; }
    H.mark('break'); for (const p of ['win', 'shd']) rebindUnit('apply', 'keep', S, p); matchAbove();
  },
  rebindApplyAll: () => { H.mark('break'); for (const p of ['win', 'shd']) rebindUnit('apply', 'rebind', S, p); brkUI.pending = false; matchAbove(); },
  rebindApplyKeep: () => { H.mark('break'); for (const p of ['win', 'shd']) rebindUnit('apply', 'keep', S, p); brkUI.pending = false; matchAbove(); },
  rebindCancel: () => { brkUI.pending = false; },
  rebindAll: () => { H.mark('break'); for (const p of ['win', 'shd']) rebindAll(S, p); matchAbove(); },
  // shading added to the selected window from its small window; a device of it picked, to shape in the plan or the section; or taken off
  addShading: v => { H.mark('device'); addShading(v); },
  pickDev: a => {
    const h = selShading(S), D = h && S.lib.devices[h.devices[+a]], want = D && D.dir === 'v' ? 'plan' : 'section';
    pickOnly(+a, insts().find(x => x.type === want) || insts().find(x => x.type === 'section' || x.type === 'plan') || null);
  },
  delDev: a => { H.mark('device'); const r = selCell(); if (r) r.dev = +a; removeDevice(); },
  addSavedWindow: id => { H.mark('window'); addSavedWindow(id); recentre(); },
  // the storey's own small window, opened from the window's
  openStorey: () => { const i = POP.at && POP.at.type === 'axon' ? POP.at : insts().find(x => x.type === 'axon'); if (i) { V.plate.on = true; openWidget(SW, i); } },
  // the site: a preset, or every side's condition turned on to the next
  sitePreset: k => { H.mark('site'); applySitePreset(k); },
  siteRotate: () => { H.mark('site'); rotateSite(); },
  // live optimization, from a recommendation's card, or off from any view
  liveToggle: d => { H.mark('live'); liveToggle(d === 'v' || d === 'c' ? d : 'h'); if (S.pick === 'device') S.pick = null; },
  liveOff: m => { H.mark('live'); liveOff(m === 'revert' ? 'revert' : 'keep'); },
  liveKind: k => { H.mark('live'); liveSetKind(k); },
  delSaved: a => { const k = String(a).slice(0, String(a).indexOf(':')), id = String(a).slice(String(a).indexOf(':') + 1); deleteSaved(k, id); },
  selDevice: a => { pickOnly(+a, null); },
  addStorey: () => { H.mark('storey'); addStorey(); recentre(); },
  insStorey: a => { H.mark('storey'); insertStorey(a === 'below' ? 'below' : 'above'); recentre(); },
  dupStorey: a => { H.mark('storey'); duplicateStorey(S, a === 'below' ? 'below' : 'above'); recentre(); },
  moveStorey: a => { H.mark('storey'); moveStorey(+a); recentre(); },
  delStorey: a => { H.mark('storey'); removeStorey(+a); recentre(); },
  // a bare side's single window, from its own small window
  addWin: () => { H.mark('window'); addWindow(); recentre(); },
  matchPlate: a => { H.mark('storey'); setValue('matchPlate', a === '1' || a === true); },
  rotBelow: a => { H.mark('storey'); setValue('rotBelow', a === '1' || a === true); },
  // the library: systems, units and shading made new, picked, copied, or deleted when unused
  newSystem: a => { H.mark('library'); newSystemHere(a); recentre(); },
  useSystem: a => { H.mark('library'); useSystem(a); recentre(); },
  newUnit: a => { H.mark('library'); newUnitHere(a); recentre(); },
  useUnit: a => { H.mark('library'); setValue('g.unit', a); recentre(); },
  newShading: a => { H.mark('library'); applyShadingPreset(a); },
  dup: a => { H.mark('library'); duplicateHere(a); },
  delEntry: a => { const [k, id] = String(a).split(':'); H.mark('library'); deleteEntry(k, id); },
  delGlazing: () => { H.mark('glazing'); removeGlazing(); recentre(); },
  addDevice: a => { H.mark('device'); addDevice(a === 'v' ? 'v' : 'h'); },
  addSavedDevice: a => { H.mark('device'); addSavedDevice(a); },
  delDevice: () => { H.mark('device'); removeDevice(); },
  createArray: () => { H.mark('array'); createArray(); },
  removeArray: () => { H.mark('array'); removeArray(); },
  preset: a => { H.mark('shpreset'); applyShadingPreset(a); },
  copyGo: () => {
    const what = { height: copyUI.what.height, glazing: copyUI.what.glazing, shading: copyUI.what.shading };
    const targets = [...copyUI.targets].map(k => { const [f, st] = k.split(':'); return { f, st: +st }; });
    if (!targets.length || !(what.height || what.glazing || what.shading)) {
      copyUI.note = 'Tick something to copy and at least one condition to copy it to.'; return;
    }
    H.mark('copy');
    const r = copyCondition(what, targets);
    copyUI.note = (r.done.length ? 'Applied to ' + r.done.join(', ') + '.' : 'Nothing was changed.')
      + (r.skipped.length ? ' Passed over: ' + r.skipped.join('; ') + '.' : '');
  },
  copyClear: () => { copyUI.targets.clear(); copyUI.note = ''; },
  delWindow: a => { H.mark('saveview'); removeWindow(a); for (const i of insts()) if (i.pin === a) setPin(i, null); },
  // a context building: placed with a click in the site view - or, with none on the page, just south of the site
  placeContext: () => { if (siteViews().length) { V.place.on = true; V.place.P = null; } else { H.mark('ctx:place'); addContextAt(null); } },
  cancelContext: () => endPlacing(),
  delContext: a => { H.mark('ctx:delete'); removeContext(a); }
};

/* A name box that suggests a name - in grey, as its placeholder - takes it
   with Tab, and stays open to be added to. */
document.addEventListener('keydown', e => {
  const t = e.target;
  if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || !t || !t.matches || !t.matches('input.vname, input.namebox')) return;
  if (t.value || !t.placeholder) return;
  e.preventDefault();
  t.value = t.placeholder; t.setSelectionRange(t.value.length, t.value.length);
  t.dispatchEvent(new Event('input', { bubbles: true }));
}, true);

// Escape lets go of what is picked, and every handle with it
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))) return;
  if (SITEW.st !== 'closed') { closeWidget(SITEW); V.siteEdit = false; schedule(); }
  if (S.pick) pick(null);
});

/* a bar's menu - Layers, Site, Library, Export - closes on a click anywhere outside it, or on Escape */
document.addEventListener('pointerdown', e => {
  for (const d of document.querySelectorAll('details.dd[open]')) if (!d.contains(e.target)) d.open = false;
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') for (const d of document.querySelectorAll('details.dd[open]')) d.open = false; });
/* the small windows' own buttons and menus: each does its action, as the panel's did; a name typed in a title is kept on Enter or leaving it */
/* A name's icons: save it to the library under that name; or copy it for this use alone, the copy's name asked for - its own, numbered */
document.addEventListener('pointerdown', e => {
  const b = e.button === 0 && e.target.closest && e.target.closest('.devpop [data-ico]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const [act, kind] = b.dataset.ico.split(':'), r = b.getBoundingClientRect();
  if (act === 'rename') {
    const key = b.dataset.key, cur = getValue(key);
    openName(r.left - 150, r.bottom + 14, cur || '', name => api.set(key, name));
    return;
  }
  openName(r.left - 150, r.bottom + 14, copyName(kind), name => { stopPlay(); H.mark('copy'); copyEntry(kind, name); schedule(); });
}, true);
document.addEventListener('change', e => {
  const t = e.target;
  if (!(t.matches && t.matches('.devpop select[data-pick]'))) return;
  const kind = t.dataset.pick, id = t.value;
  stopPlay(); H.mark('library');
  if (kind === 'device') setValue('d.type', id); else if (kind === 'group') setValue('g.shd', id); else setValue('g.sys', id);
  if (kind === 'group') { const rr = selCell(); if (rr) rr.dev = 0; }
  schedule();
});
document.addEventListener('pointerdown', e => {
  const b = e.button === 0 && e.target.closest && e.target.closest('.devpop button[data-pact]');
  if (!b || b.disabled) return;
  e.preventDefault(); e.stopPropagation();
  api.act(b.dataset.pact, b.dataset.v);
});
document.addEventListener('change', e => {
  const t = e.target;
  if (!t.matches) return;
  if (t.matches('.devpop select[data-pact]')) { const v = t.value; t.value = ''; if (v) api.act(t.dataset.pact, v); }
  else if (t.matches('.devpop input[data-name]')) { const v = t.value.trim(); if (v) api.set(t.dataset.name, v); }
  else if (t.matches('.devpop select[data-k]')) api.set(t.dataset.k, t.value);
});
document.addEventListener('keydown', e => {
  if (e.target.matches && e.target.matches('.devpop input[data-name]')) { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); }
}, true);

/* ---------- boot ---------- */
buildRail($('rail'));
buildCalcBar($('calcBar'));
const prose = staticProse();
for (const id of ['energyIntro', 'method', 'sources']) $(id).innerHTML = prose[id];
// a figure's calculation opens from its ƒ, and stays open as the page redraws, until it is closed or another opens
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-fx]');
  if (b) {
    fxUI.open = fxUI.open === b.dataset.fx ? null : b.dataset.fx;
    document.querySelectorAll('[data-fx]').forEach(x => { const on = x.dataset.fx === fxUI.open; x.setAttribute('aria-expanded', String(on)); const p = x.parentElement.querySelector('.fxpop'); if (p) p.hidden = !on; });
    return;
  }
  if (fxUI.open && !(e.target.closest && e.target.closest('.fxpop'))) {
    fxUI.open = null;
    document.querySelectorAll('.fxpop').forEach(p => { p.hidden = true; });
    document.querySelectorAll('[data-fx]').forEach(x => x.setAttribute('aria-expanded', 'false'));
  }
});
const api = {
  set(k, v) {
    stopPlay(); H.mark('c:' + k); setValue(k, v);
    // an array typed down to nothing goes back to one member
    if ((k === 'a.len' || k === 'a.arrN' || k === 'a.arrSp') && arrayGone(k, v)) setValue('a.on', false);
    schedule();
  },
  // a value slid by its name: drawn lightly as it moves, settled when let go
  scrub(k, v) { stopPlay(); H.mark('c:' + k); H.hold = true; setValue(k, v); scheduleLight(); },
  scrubEnd() { H.release(); schedule(); },
  refresh() { syncRail(S); },
  act(name, arg) { stopPlay(); if (ACTS[name]) { ACTS[name](arg); schedule(); } },
  typology(k) { stopPlay(); H.mark('typology'); applyTypology(k); recentre(); schedule(); },
  play: togglePlay,
  async exportRhino() {
    const btn = $('expBtn'), say = t => { $('expNote').textContent = t; };
    btn.disabled = true;
    try { await exportRhino(S, say); }
    catch (e) { say('Could not export: ' + (e && e.message ? e.message : e) + ' — rhino3dm could not be loaded. Run the project from its folder to use the local copy, or connect once for the CDN.'); }
    finally { btn.disabled = false; }
  }
};
wireRail($('rail'), S, api);
/* A weather file of the user's own: Load an .epw file… opens the file chooser -
   the list keeps showing the file in use meanwhile - and the file read in joins
   the list under its own name, and is used. */
{
  const sel = $('c_wx'), inp = $('epwFile');
  sel.addEventListener('change', e => {
    if (sel.value !== '__epw') return;
    e.stopImmediatePropagation(); sel.value = S.wx; inp.value = ''; inp.click();
  }, true);
  inp.addEventListener('change', async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    try {
      const rec = parseEpw(await f.text()), name = f.name.replace(/\.epw$/i, '') + (rec.tz !== -8 && isFinite(rec.tz) ? ' (UTC' + (rec.tz >= 0 ? '+' : '−') + Math.abs(rec.tz) + ', read as PST)' : '');
      const key = addWeather(name, rec), o = document.createElement('option');
      o.value = key; o.textContent = name; sel.insertBefore(o, sel.querySelector('option[value="__epw"]'));
      api.set('wx', key); clearSunCache();
    } catch (err) { alert('Could not read ' + f.name + ': ' + (err && err.message ? err.message : err)); }
  });
}
wireRail($('calcBar'), S, api);
// a figure in a drawing clicked: a box opens on it to type the value
document.addEventListener('click', e => {
  const el = e.target.closest && e.target.closest('.view [data-edit]');
  if (!el) return;
  e.stopPropagation();
  const k = el.getAttribute('data-edit'), txt = el.tagName.toLowerCase() === 'text' ? el : el.nextElementSibling || el;
  openFloatEdit(txt, k, S, api);
});
// a choice on a drawing's bar pressed: it sets its value, as the panel would - on the press, since the
// drawing can be redrawn under the pointer before it is let go
document.addEventListener('pointerdown', e => {
  const el = e.button === 0 && e.target.closest && e.target.closest('.view [data-set], .devpop [data-set]');
  if (!el) return;
  e.stopPropagation();
  const v = el.getAttribute('data-v');
  api.set(el.getAttribute('data-set'), v === 'true' ? true : v === 'false' ? false : v);
});
// the panel at the side and the settings along the top each tuck away, and come back
const TUCKED = { barTuck: 'the calculation settings', gainTuck: 'the solar heat gain' };
for (const [btn, cls, open, shut] of [['barTuck', 'bartucked', '▴', '▾'], ['gainTuck', 'gaintucked', '▴', '▾']]) $(btn).addEventListener('click', () => {
  const on = document.body.classList.toggle(cls);
  $(btn).textContent = on ? shut : open; $(btn).setAttribute('aria-expanded', String(!on));
  $(btn).title = (on ? 'Bring back ' : 'Tuck away ') + TUCKED[btn];
  barHeight(); fitFull(); fitDock(); clearSunCache(); render();
});
// the time settings and a view's note close when the page is clicked anywhere else
document.addEventListener('pointerdown', e => {
  const t = e.target;
  document.querySelectorAll('.infopop:not([hidden])').forEach(p => {
    if (!p.contains(t) && !(t.closest('[data-info]') && t.closest('.view') === p.closest('.view'))) { p.hidden = true; p.closest('.view').querySelector('[data-info]').setAttribute('aria-expanded', 'false'); }
  });
});
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-info]');
  if (!b) return;
  const p = b.closest('.view').querySelector('.infopop'), open = p.hidden;
  document.querySelectorAll('.infopop').forEach(x => { x.hidden = true; });
  p.hidden = !open; b.setAttribute('aria-expanded', String(open));
});
/* Minimise folds a view to its bar. Full screen lays the view over the
   drawings only - the panel on the left and the calculation settings stay -
   and draws its sheet at the shape of that space, so the drawing's frame runs
   edge to edge. While one view is full, every drawing is made on that sheet;
   leaving it puts the page's own size back. */
function fitFull() {
  const v = document.querySelector('.view.full');
  // the settings bar kept at the top of the window, however the page was laid out or resized meanwhile
  let bar = $('calcBar').getBoundingClientRect();
  if (v && Math.abs(bar.top) > 1) { window.scrollTo(0, Math.max(0, bar.top + window.scrollY)); bar = $('calcBar').getBoundingClientRect(); }
  const rail = $('rail').getBoundingClientRect();
  // the panel is a column at the side on a wide screen, and stacks above the drawings on a narrow one
  const side = rail.width < window.innerWidth * 0.6;
  document.documentElement.style.setProperty('--fullL', (side ? Math.max(0, rail.right) : 0) + 'px');
  // and never so low that the drawing is left no room
  document.documentElement.style.setProperty('--fullT', clampN(bar.bottom, 0, Math.max(0, window.innerHeight - 240)) + 'px');
}
function setFull(v, on) {
  document.querySelectorAll('.view.full').forEach(x => {
    x.classList.remove('full');
    const b = x.querySelector('[data-vfull]'); if (b) { b.textContent = '⤢'; b.title = 'Full screen'; }
  });
  if (on) {
    // the settings bar taken to the top first, so the drawing has all the height below it
    const top = $('calcBar').getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(window.scrollY, top));
    v.classList.add('full'); v.classList.remove('min');
    const b = v.querySelector('[data-vfull]'); b.textContent = '⤡'; b.title = 'Leave full screen';
  }
  document.body.classList.toggle('hasfull', !!on);
  fitFull(); clearSunCache(); render();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-vclose], [data-vfull]');
  if (!b) return;
  const v = b.closest('.view');
  if (b.dataset.vfull !== undefined) { setFull(v, !v.classList.contains('full')); return; }
  // taken off the page: the rest of its row closes up; a + in any margin brings a view back
  if (v.classList.contains('full')) setFull(v, false);
  removeView(v); clearSunCache(); schedule();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.querySelector('.view.full')) setFull(null, false);
});
// the view bars stay under the calculation settings as the page scrolls
const barHeight = () => document.documentElement.style.setProperty('--cbh', $('calcBar').offsetHeight + 'px');
// the sheets follow the space each view has, so a resize redraws them, once it settles
let resizeT = null;
window.addEventListener('resize', () => { barHeight(); clearTimeout(resizeT); resizeT = setTimeout(() => { fitFull(); fitDock(); clearSunCache(); render(); }, 120); });
/* ---------- the dock ----------
   The design recommendations sit at the foot of the drawings. The dock's top
   edge is dragged to resize it; it collapses to its bar, or goes full screen
   over the drawings - the panel and the settings bar stay. How it was left is
   kept in this browser. */
const DOCK_KEY = 'solar-shading-dock-v8';
const dock = { h: Math.round(window.innerHeight * 0.38), min: false, full: false };
try { Object.assign(dock, JSON.parse(localStorage.getItem(DOCK_KEY) || '{}'), { full: false }); } catch (_) { }
// the recommendations start folded away; opened, they keep the height they were last given
dock.min = true;
function fitDock() {
  const el = $('dock'), root = document.documentElement.style;
  const rail = $('rail').getBoundingClientRect(), side = rail.width < window.innerWidth * 0.6;
  root.setProperty('--dockL', (side ? Math.max(0, rail.right) : 0) + 'px');
  root.setProperty('--dockH', clampN(dock.h, 140, Math.max(160, window.innerHeight - 140)) + 'px');
  root.setProperty('--dockT', clampN($('calcBar').getBoundingClientRect().bottom, 0, window.innerHeight - 200) + 'px');
  el.classList.toggle('min', dock.min); el.classList.toggle('full', dock.full);
  $('dockMin').textContent = dock.min ? '▴' : '▾'; $('dockMin').title = dock.min ? 'Expand' : 'Collapse';
  $('dockFull').textContent = dock.full ? '⤡' : '⤢'; $('dockFull').title = dock.full ? 'Leave full screen' : 'Full screen';
  root.setProperty('--dockVis', (dock.full ? 0 : el.getBoundingClientRect().height) + 'px');
  try { localStorage.setItem(DOCK_KEY, JSON.stringify({ h: dock.h, min: dock.min })); } catch (_) { }
}
$('dockMin').addEventListener('click', () => { dock.min = !dock.min; if (dock.min) dock.full = false; fitDock(); });
$('dockFull').addEventListener('click', () => { dock.full = !dock.full; if (dock.full) dock.min = false; fitDock(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && dock.full) { dock.full = false; fitDock(); } });
$('dockGrip').addEventListener('pointerdown', e => {
  e.preventDefault();
  const move = ev => { dock.h = window.innerHeight - ev.clientY; fitDock(); };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
});
fitDock();
barHeight();
if (window.ResizeObserver) new ResizeObserver(barHeight).observe($('calcBar'));
wireHistory();
buildLayout(makeInst);
let sizeRaf = null;
wireLayout(makeInst, () => { clearSunCache(); schedule(); },
  () => { if (!sizeRaf) sizeRaf = requestAnimationFrame(() => { sizeRaf = null; clearSunCache(); render(true); }); });
$('layoutReset').addEventListener('click', () => { buildLayout(makeInst, true); clearSunCache(); schedule(); });
recentre();
getMask(buildFrame(S, V).T, true);
render();
