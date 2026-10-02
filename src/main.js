/* Vancouver Solar Shading Explorer 7 - the page.

   The page takes the question in four steps: where the sun is, what
   the shading cuts off, where the beam lands inside, and how much heat comes
   in. state.js holds the design, view.js how it is looked at. Every frame
   builds the building from the state (frame.js) and hands it to the drawings,
   the worked calculations and, on request, the Rhino exporter - so nothing on
   the page can disagree with anything else. This file only wires that to the
   document.                                                                 */

import { fmt, hhmm, MONTHS, wrap180, D2R } from './util.js';
import { CLOCK_NAME, sunriseSunsetSolar, solarToClock } from './solar.js';
import { S, setValue, applyTypology, createHistory, addStorey, duplicateStorey, removeStorey, moveStorey, removeGlazing,
  addDevice, addSavedDevice, removeDevice, createArray, removeArray, applyShadingPreset, copyCondition, selCell, breakUnit, rebindUnit, rebindAll, otherBroken, matchAbove,
  newSystemHere, useSystem, newUnitHere, duplicateHere, deleteEntry,
  saveWindow, openWindow, selectionChanged, keepCuts, windowState, savedWindow, removeWindow, renameWindow, windowName, windowSavedAs, selUnitIndex, shadingFromIdeal } from './state.js';
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
import { drawSection, sectionHandle, secCutLine } from './draw/section.js';
import { drawPlan, INTERIOR_MODES, planHandle, planCutLine } from './draw/plan.js';
import { SHEETCAM0 } from './draw/sheetcam.js';
import { drawDetail, DETAIL_VIEWS, detailSun, detailHits, detailEye } from './draw/detail.js';
import { drawAxon, axonHits, axonHandle, axonFocus } from './draw/axon.js';
import { drawSunYear } from './draw/sunyear.js';
import { chartGainDay, chartGainYear, chartShadeYear } from './draw/charts.js';
import { WEATHER_FILES } from './weather.js';
import { titleBlock, setSheet, SHEET0 } from './draw/svg.js';
import { sheetFor, buildLayout, wireLayout, margins, removeView, saveLayout } from './ui/layout.js';
import { createView, VIEW_TYPES } from './ui/views.js';
import { openFloatEdit, buildRail, buildCalcBar, RESULT_SCOPES, syncRail, syncClock, wireRail, copyUI, brkUI, regsControls } from './ui/rail.js';
import { stackLabel } from './ui/readout.js';
import { recSun, recGeometry, recBylaw, recFor, resGain, fxUI, recUI, idealSpec } from './ui/calc.js';
import { renderChecks, renderEnergy, staticProse } from './ui/prose.js';
import { wireView } from './ui/interact.js';
import { exportRhino } from './export/rhino.js';

const $ = id => document.getElementById(id);
const clampN = (x, a, b) => Math.min(b, Math.max(a, x));
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
    q('.detBeam').addEventListener('click', e => { inst.V.beam = !inst.V.beam; e.target.textContent = inst.V.beam ? 'Hide the beam' : 'Show the beam'; paint(inst); });
    q('.detReset').addEventListener('click', () => { Object.assign(inst.V.detcam, DETAIL_VIEWS.outside); paint(inst); });
  }
  if (type === 'section') q('.secReset').addEventListener('click', () => { inst.V.seccam = SHEETCAM0('window'); paint(inst); });
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
  wireView(inst, { S, V, H, schedule, scheduleLight, paint: i => paint(i), stopPlay, select });
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
      sel.innerHTML = '<option value="">Selected window</option>' + (views.length ? '<optgroup label="Saved windows">' + views.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('') + '</optgroup>' : '');
      sel.dataset.sig = sig;
    }
    sel.value = inst.pin || '';
    // a window already saved is not saved again: the button says where it is
    const sv = inst.el.querySelector('.vsave'), was = windowSavedAs(S, S.sel.f, S.sel.st, selUnitIndex(S));
    if (sv) { sv.disabled = !!was; sv.title = was ? 'The selected window is saved already, as ' + was.name + ' - choose it in the menu' : 'Save the selected window and its section and plan cuts by name; this view then keeps showing it'; }
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
function drawInst(inst, F0, ctx) {
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
      inst.host.innerHTML = drawAxon(Fi); inst.h = { hits: axonHits, handle: axonHandle, focus: axonFocus };
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
      inst.host.innerHTML = drawSection(Fi, study('now')); inst.h = { handle: sectionHandle, cut: secCutLine };
      inst.title.innerHTML = titleBlock('Section · profile angle', [
        ['θ', cur.onFacade ? fmt(cur.vsa, 1) + '°' : 'no direct sun'], ['device', stackLabel(F)], ['shaded', pct]]);
      break;
    case 'plan':
      inst.host.innerHTML = drawPlan(Fi, study(inst.V.inMode)); inst.h = { handle: planHandle, cut: planCutLine };
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
      inst.host.innerHTML = drawDetail(Fi); inst.h = { sun: detailSun, hits: detailHits, eye: detailEye };
      // the selected window's beam into the room: worked out on a full redraw, kept while the day plays
      if (!ctx.light) {
        const land = m.opening && cur.onFacade ? (study('now') || {}).land : null, lit = land && land.total > 0;
        inst._beam = !m.opening ? [] : [['into the room', big(cur.onFacade ? fmt(land ? land.total : 0, 0) + ' W' : 'no sun')],
          ['on the floor', big(lit ? fmt(land.dni * m.shgc * Math.sin(cur.alt * D2R), 0) + ' W/m²' : '—')]];
      }
      inst.title.innerHTML = titleBlock('Storey in 3D', [
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
function render(light = false) {
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
});

/* An ideal made a shading system type: named in place of its button, and put on the selected window */
$('recs').addEventListener('click', e => {
  const b = e.target.closest('[data-ideal]');
  if (!b || !lastF) return;
  const spec0 = idealSpec(lastF, b.dataset.ideal);
  if (!spec0) return;
  const box = document.createElement('input');
  box.type = 'text'; box.className = 'vname idealname'; box.dataset.for = b.dataset.ideal; box.placeholder = spec0.name; box.spellcheck = false;
  box.setAttribute('aria-label', 'Name of the new shading system type'); box.title = 'Tab takes the suggested name; Enter makes it and puts it on the selected window; Escape leaves it';
  b.hidden = true; b.after(box); box.focus();
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
  $('playBtn').textContent = 'Play the day';
}
function togglePlay() {
  if (anim) { stopPlay(); render(); return; }
  $('playBtn').textContent = 'Stop';
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

/* ---------- the panel's actions ---------- */
const ACTS = {
  selStorey: a => { const i = +a; if (i < 0 || i >= S.storeys.length) return; S.sel.st = i; S.sel.unit = null; brkUI.pending = false; recentre(); },
  selFacade: a => { S.sel.f = a; S.sel.unit = null; brkUI.pending = false; recentre(); },
  selUnit: a => { S.sel.unit = Math.max(0, +a); brkUI.pending = false; },
  // breaking a window out of its array, and binding it back; the floors above follow when set to
  // the part is 'win' (the window) or 'shd' (its shading), each broken and bound back on its own
  breakUnit: part => { H.mark('break'); breakUnit(S, part || 'win'); matchAbove(); },
  rebindRevert: part => { H.mark('break'); rebindUnit('revert', 'keep', S, part); brkUI.pending = false; matchAbove(); },
  rebindApply: part => {
    if (otherBroken(S, part).length) { brkUI.pending = part; return; }
    H.mark('break'); rebindUnit('apply', 'keep', S, part); matchAbove();
  },
  rebindApplyAll: part => { H.mark('break'); rebindUnit('apply', 'rebind', S, part); brkUI.pending = false; matchAbove(); },
  rebindApplyKeep: part => { H.mark('break'); rebindUnit('apply', 'keep', S, part); brkUI.pending = false; matchAbove(); },
  rebindCancel: () => { brkUI.pending = false; },
  rebindAll: part => { H.mark('break'); rebindAll(S, part); matchAbove(); },
  selDevice: a => { const r = selCell(); if (r) r.dev = +a; },
  addStorey: () => { H.mark('storey'); addStorey(); recentre(); },
  dupStorey: a => { H.mark('storey'); duplicateStorey(S, a === 'below' ? 'below' : 'above'); recentre(); },
  moveStorey: a => { H.mark('storey'); moveStorey(+a); recentre(); },
  delStorey: a => { H.mark('storey'); removeStorey(+a); recentre(); },
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
  delWindow: a => { H.mark('saveview'); removeWindow(a); for (const i of insts()) if (i.pin === a) setPin(i, null); }
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
  set(k, v) { stopPlay(); H.mark('c:' + k); setValue(k, v); schedule(); },
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
wireRail($('calcBar'), S, api);
// a figure in a drawing clicked: a box opens on it to type the value
document.addEventListener('click', e => {
  const el = e.target.closest && e.target.closest('.view [data-edit]');
  if (!el) return;
  e.stopPropagation();
  const k = el.getAttribute('data-edit'), txt = el.tagName.toLowerCase() === 'text' ? el : el.nextElementSibling || el;
  openFloatEdit(txt, k, S, api);
});
// the panel at the side and the settings along the top each tuck away, and come back
const TUCKED = { railTuck: 'the panel', barTuck: 'the calculation settings', gainTuck: 'the solar heat gain' };
for (const [btn, cls, open, shut] of [['railTuck', 'railtucked', '‹', '›'], ['barTuck', 'bartucked', '▴', '▾'], ['gainTuck', 'gaintucked', '▴', '▾']]) $(btn).addEventListener('click', () => {
  const on = document.body.classList.toggle(cls);
  $(btn).textContent = on ? shut : open; $(btn).setAttribute('aria-expanded', String(!on));
  $(btn).title = (on ? 'Bring back ' : 'Tuck away ') + TUCKED[btn];
  barHeight(); fitFull(); fitDock(); clearSunCache(); render();
});
$('timeBtn').addEventListener('click', () => {
  const m = $('timeMenu'), open = m.hidden;
  m.hidden = !open; $('timeBtn').setAttribute('aria-expanded', String(open));
});
// the time settings and a view's note close when the page is clicked anywhere else
document.addEventListener('pointerdown', e => {
  const t = e.target;
  if (!$('timeMenu').hidden && !t.closest('.tset') && !t.closest('.floatedit')) { $('timeMenu').hidden = true; $('timeBtn').setAttribute('aria-expanded', 'false'); }
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
const DOCK_KEY = 'solar-shading-dock-v7';
const dock = { h: Math.round(window.innerHeight * 0.38), min: false, full: false };
try { Object.assign(dock, JSON.parse(localStorage.getItem(DOCK_KEY) || '{}'), { full: false }); } catch (_) { }
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
