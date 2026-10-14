/* The views on the page, as instances. A view is one of five kinds - the site
   and its sun, the sun path chart, the section, the plan, the storey in 3D -
   and any kind can be on the page more than once. Each instance has its own
   element, its own bar, and its own way of being looked at: cameras, layers,
   what the plan shows on its floor. What it draws is the one design.

   Instances fall back on the page's shared view state (view.js) for anything
   they do not keep themselves, such as a drag in progress.                 */

import { V as V0, AX_LAYERS, AX_GROUPS, AXCAM0, DETCAM0 } from '../view.js';
import { SHEETCAM0 } from '../draw/sheetcam.js';
import { DOT_SPANS } from '../draw/sunpath.js';
import { INTERIOR_MODES } from '../draw/plan.js';
import { deviceLabel, hingeWords, lenFromWindow } from '../geometry/device.js';
import { TYPOLOGIES } from '../state.js';
import { SITE_KINDS, SITE_PRESETS } from '../geometry/site.js';

export const VIEW_TYPES = { axon: 'Site and sun', sun: 'Sun path chart', section: 'Section', plan: 'Plan', detail: 'Window in 3D', gday: 'Heat gain · day', gyear: 'Heat gain · year' };
const CHARTS = { gday: 1, gyear: 1 };

/* the sun chart's key, read with the chart */
const sw = (css, t) => `<li><span class="key" style="${css}"></span>${t}</li>`;
const SUN_KEY = '<ul class="keylist">'
  + sw('background:linear-gradient(90deg,rgba(217,130,26,.1),rgba(36,50,48,.8))', 'share of the opening shaded, 0–100 %')
  + sw('background:var(--poche)', 'behind the facade: no sun at all')
  + sw('background:none;border:0;border-top:2px solid var(--ink);height:0', 'cut-off as built (1 % of the glass lit)')
  + sw('background:none;border:0;border-top:2px dashed var(--glass);height:0', 'profile-angle cut-off, as on a protractor')
  + sw('background:none;border:0;border-top:3px solid var(--poche);height:0', 'the day’s path while the sun is on the glass')
  + sw('background:none;border:0;border-top:3px dotted var(--poche);height:0', 'the same day, the opening fully shaded')
  + sw('background:linear-gradient(90deg,#4A6FA5 33%,#D9A625 33% 66%,#C0442B 66%);border-radius:5px', 'an hour of weather: under 20 · 20–27 · over 27 °C')
  + sw('background:var(--poche);opacity:.3', 'washed back: sky the sun never reaches here')
  + '</ul><p>The altitude is exaggerated so the low winter sun can be read. Analysed with the neighbours’ devices; the glazed area only - scale by the window-to-wall ratio for a whole-wall figure.</p>';

/** what each kind of view shows, behind its i */
export const INFO = {
  axon: ['Site and sun', '<p>The sun’s position is a composition of angles: its altitude β above the horizon, and its azimuth - measured here from due south, east negative, west positive. Against a facade, what matters is γ, the angle between the facade’s normal and the sun; the profile angle θ is drawn in the plane square to the facade, from the ground at its foot.</p><p>Right-drag to orbit; middle-drag (or Shift and right-drag) to pan; wheel to zoom. The left button selects and drags: the sun to set the time, the facade arrow on the ground to turn the building. Click a window or a wall to select it and its storey, and open its window settings: move the storey by its arrows, one axis at a time - click an arrow to type how far - or freely by the square between them (the ground floor stays centred); pull a side’s square to move that side, its roof’s square for its height, turn it by the arc at its gumball. Drag a window along its side to change the windows’ spacing, or their number; the dotted bracket over the windows gives both - click either to type it. Each facade’s SHGC is written above it - click to type it. Zoom to selected closes in on the window and orbits about it.</p><p>Context massing: drag Place Context Massing straight onto the view, or click it and then the ground; click a massing to select it, drag it to move it (Alt-drag to drag off a copy or an instance - an instance takes every push and pull made on the others; right-click it to let it pass its turns on to them, or to make it unique), pull the square on a face to move that face, turn it by the ring on the ground (Shift for 15° steps), click a figure to type it - its width, depth, height, turn and nearest distance to the building. Delete or Backspace removes it; Esc or a click elsewhere lets it go.</p>'],
  sun: ['Sun path chart', '<p>The sky seen from the selected facade: every sun position of the year by its bearing from due south and its altitude, the day’s path, the hours, and a dot for every daylit hour of the weather file, coloured by its temperature. The shading’s mask darkens the sky it blocks from the glass; the limit lines are the cut-offs as built and as a protractor would draw them.</p><p>Drag the sun to set the date and time, the strip for the clock, the marker (the facade normal) to turn the building.</p><p><b>Year</b> shows the same shading by day of the year across and time of day down, the night greyed out; click or drag in it to set the date and time.</p>' + SUN_KEY],
  section: ['Section', '<p>A cut through the window, across the whole floor. The sun comes down at the profile angle θ; a horizontal element shades a window of height h completely once θ is steep enough, and Ph = h / tan θ sizes it. The ghosted band is the beam that gets through, running to the floor.</p><p>Drag the sun handle to move the sun with its azimuth held, the plan cut up and down; wheel to zoom, drag to pan.</p>'],
  plan: ['Plan', '<p>The storey cut through the window, looking down. A fin’s shadow runs across the glass at γ: SW = Pd · tan γ, and Pd = w / tan γ shades a width w. On the floor is the sun that gets past, through the windows the results are for - now, over the day, or over the year.</p><p>Drag the sun handle to move the sun with its altitude held, the section cut across the window; wheel to zoom, drag to pan.</p>'],
  gday: ['Heat gain · day', '<p>The solar heat entering through the day, every quarter hour: with the shading as built, and the same glass bare. For what Results for names, under the sky set above.</p><p>Click or drag in the chart to set the time.</p>'],
  gyear: ['Heat gain · year', '<p>The solar heat entering each month, summed hour by hour: with the shading as built, and the same glass bare. For what Results for names, under the sky and weather file set above.</p><p>Click a month to go to its middle day.</p>'],
  detail: ['Window in 3D', '<p>The selected window in its bay, and the beam that gets past its shading carried through the glass to where it lands on the floor. Whole floor shows the storey round it, lit through the windows the results are for; orbit it all the way round - the walls nearest you drop away, and the other sides ghost when they stand between you and the room.</p><p>Its title gives the selected window’s beam at this instant: the watts that reach the room through it, and the irradiance on the floor where its patch falls (DNI × SHGC × sin β).</p><p>Right-drag to orbit; middle-drag (or Shift and right-drag) to pan; wheel to zoom. Click a window to select it, drag the end of the sun ray to move the sun, pull the tabs to move the cuts.</p>']
};

/* The picked device's behaviours, in a small window off its gumball - its
   figures are on the drawing. Align is a move, made once: the outermost
   hinge, or the member's end, onto the window's edge or middle. Justify is
   the end that holds; on the axis its array runs along, the hinge it turns
   about and how the array is set out; on the other, whether its length
   follows the window. Its title moves it; it folds, and closes.           */
const popSeg = (key, opts, cur) => `<span class="seg mini">${opts.map(([v, l]) => `<button type="button" data-set="${key}" data-v="${v}"${cur === undefined ? '' : ` aria-pressed="${v === cur}"`}>${l}</button>`).join('')}</span>`;
const popGrp = (lab, tip, body) => `<div class="dvgrp"><span class="dvlab tipped" title="${tip}">${lab}</span>${body}</div>`;
const popChk = (key, on, label, tip) => `<label class="barchk" data-set="${key}" data-v="${!on}" title="${tip}"><input type="checkbox"${on ? ' checked' : ''}> ${label}</label>`;
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const popBtns = min => `<span class="dvbtns"><button type="button" data-popact="min" title="${min ? 'Unfold' : 'Fold'}">${min ? '▸' : '▾'}</button><button type="button" data-popact="close" title="Close - click it again on the drawing to open it">×</button></span>`;
const popHead = (title, min) => `<div class="dvhd" title="Drag to move"><span class="dvttl">${esc(title)}</span>${popBtns(min)}</div>`;
/** a title that is the thing's name, typed over in place; Enter or leaving it keeps it */
const popHeadName = (key, name, min, tip, ico) => `<div class="dvhd" title="Drag to move">${ico ? namePick(key, name, ico, tip) : `<input class="dvname" data-name="${key}" value="${esc(name)}" spellcheck="false" aria-label="Name" title="${esc(tip || 'Its name: click to type a new one')}">`}${popBtns(min)}</div>`;
/* A name in the library: a menu of the others of its kind it can be switched
   for - linked, as everything named is - with Rename and Copy beside it. A copy
   is the way to change this use alone. */
const ICON_RENAME = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 10l.6-2.6L8.4 1.6l2 2L4.6 9.4z" fill="none" stroke="currentColor"/><path d="M7.4 2.6l2 2" stroke="currentColor"/></svg>', ICON_COPY = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><rect x="1.5" y="1.5" width="6.5" height="6.5" fill="none" stroke="currentColor"/><rect x="4" y="4" width="6.5" height="6.5" fill="var(--panel)" stroke="currentColor"/></svg>';
const WHAT = { device: 'device', group: 'shading group', window: 'window group' };
function namePick(key, name, { kind, opts = [], cur }, tip) {
  const list = opts.some(([v]) => v === cur) ? opts : [[cur, name]].concat(opts);
  return `<select class="dvname dvpick" data-pick="${kind}" title="${esc(tip || 'This ' + WHAT[kind] + ': switch it for another in the library')}" aria-label="${WHAT[kind]}">${list.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`
    + `<span class="dvicons"><button type="button" class="icobtn" data-ico="rename:${kind}" data-key="${key}" title="Rename this ${WHAT[kind]} - everywhere it is used">${ICON_RENAME}</button>`
    + `<button type="button" class="icobtn" data-ico="copy:${kind}" title="Make a copy of this ${WHAT[kind]} for this use alone, under a new name">${ICON_COPY}</button></span>`;
}
/** a name in the body of a small window, as its menu, with its icons */
const nameRow = (label, key, name, ico, tip) => `<div class="dvrow namerow"><span class="dvlab">${label}</span>${namePick(key, name, ico, tip)}</div>`;
/** a button that does something, once */
const popBtn = (act, v, label, tip, cls = '') => `<button type="button" class="pbtn${cls ? ' ' + cls : ''}" data-pact="${act}" data-v="${esc(v)}" title="${esc(tip || '')}">${label}</button>`;
/** a menu that does something when an item is chosen, then goes back to its prompt */
const popMenu = (act, prompt, items, tip) => items.length ? `<select class="pmenu" data-pact="${act}" title="${esc(tip || '')}"><option value="" hidden selected>${esc(prompt)}</option>${items.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>` : '';
/** a menu of groups of items: [[label or '', [[value, text], ...]], ...] */
const popMenuG = (act, prompt, groups, tip) => `<select class="pmenu" data-pact="${act}" title="${esc(tip || '')}"><option value="" hidden selected>${esc(prompt)}</option>${groups.filter(([, xs]) => xs.length).map(([l, xs]) => (l ? `<optgroup label="${esc(l)}">` : '') + xs.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('') + (l ? '</optgroup>' : '')).join('')}</select>`;
/* What is wanted only now and then waits under More, folded; it stays as it was left. */
const popMore = (open, body) => body ? `<button type="button" class="pbtn more" data-popact="more" aria-expanded="${!!open}">${open ? 'Less ▴' : 'More ▸'}</button>` + (open ? `<div class="dvmore">${body}</div>` : '') : '';
/** a Save that asks for a name */
const popSave = (what, label, tip) => `<button type="button" class="pbtn" data-save="${what}" title="${esc(tip)}">${label}</button>`;
/* The selected window against its array: break it out to take its own glazing
   unit, or bind it back - reverting to the array, or giving the array its own. */
function breakHTML(b) {
  if (!b || !b.can) return '';
  const many = xs => xs.length === 1 ? 'Window ' + (xs[0] + 1) + ' is' : 'Windows ' + xs.map(x => x + 1).join(', ') + ' are';
  if (!b.broken) return `<div class="dvrow">${popBtn('breakUnit', 'win', 'Break window ' + (b.i + 1) + ' from array', 'The window keeps its place in the array but takes its own glass and its own shading, to be changed apart; the layout and the wall still follow the array. It remembers the array, and can be bound back.')}</div>`
    + (b.others.length ? `<div class="dvnote">${many(b.others)} broken. ${popBtn('rebindAll', 'win', 'Rebind all', 'Every broken window on this side follows the array again', 'link')}</div>` : '');
  let s = `<div class="dvnote"><b>Window ${b.i + 1} · broken from array</b></div>`;
  if (b.pending && b.others.length) s += `<div class="dvnote">${many(b.others)} broken too:</div><div class="dvrow">${popBtn('rebindApplyAll', 'win', 'Rebind them', 'They take the array’s new settings')}${popBtn('rebindApplyKeep', 'win', 'Keep broken')}${popBtn('rebindCancel', 'win', 'Cancel', '', 'quiet')}</div>`;
  else s += `<div class="dvrow">${popBtn('rebindRevert', 'win', 'Revert to array', 'This window drops its own glass and shading and follows the array again')}${popBtn('rebindApply', 'win', 'Apply to array', 'Every window of the array takes this window’s glass and shading')}</div>`;
  return s;
}

export function devicePopHTML(D, ax, arrayView, min, o = {}) {
  return deviceBody(D, ax, arrayView, min, o) + popMore(o.more, (o.grpName !== undefined ? nameRow('Shading group', 'name.shd', o.grpName, { kind: 'group', opts: o.grpOpts, cur: o.grpId }) : '')
    + `<div class="dvrow">${popBtn('delDevice', '', 'Remove', 'Take this device off the window (Delete)', 'quiet')}</div>`);
}
function deviceBody(D, ax, arrayView, min, o = {}) {
  const words = ax === 'V' ? ['Top', 'Middle', 'Bottom'] : ['Left', 'Middle', 'Right'], A = D.arr, along = A && A.along !== 'out', out = A && A.along === 'out';
  const seg = popSeg, grp = popGrp, three = ['start', 'centre', 'end'].map((v, i) => [v, words[i]]);
  let s = popHeadName('d.name', D.name || deviceLabel(D), min, '', { kind: 'device', opts: o.devOpts, cur: D.id });
  const alignTip = arrayView && A && !out ? 'Move the device so its ' + (ax === 'U' ? 'outermost fin’s hinge' : 'outermost member’s hinge') + ' sits on the window’s edge - or its middle on the window’s middle. A move, made once.'
    : arrayView ? 'Move the member so its hinge sits on the window’s edge, or its middle. A move, made once.' : 'Move the member so its end sits on the window’s edge - or its middle on the window’s middle. A move, made once.';
  s += grp('Align', alignTip, seg('d.align' + ax, three));
  if (arrayView) {
    if (along) s += grp('Justify', 'The end of the array that holds: the handle at its other end lengthens it - both ends, held in the middle', seg('d.just' + ax, three, D['just' + ax]));
    const HW = hingeWords(D);
    s += grp('Hinge', 'The line across the depth the member turns about - its wall edge, its middle or its outer edge; moving it leaves the member where it is', seg('d.hinge', [['start', HW.start], ['centre', HW.centre], ['end', HW.end]], D.hinge));
  } else {
    s += grp('Justify', 'The end of the member that holds: the handle at its other end lengthens it - both ends, held in the middle', seg('d.just' + ax, three, D['just' + ax]));
    s += grp('Length', 'To window: the window’s own ' + (ax === 'U' ? 'width' : 'height') + ' and what it runs past it, following the window wherever the device is used. Fixed: a length of its own.',
      seg('d.lenRel', [['true', 'To window'], ['false', 'Fixed']], String(lenFromWindow(D))));
  }
  // the array: off, one member; on, its direction and setting out
  if (arrayView || out) {
    s += popChk('a.on', !!A, 'Array', 'Repeat the member, down or across the facade, or out from the wall. Dragged or typed to nothing, it goes back to one member.');
    if (A) {
      s += grp('Direction', 'Along the facade, or stepping out from the wall', seg('a.along', [['facade', D.dir === 'h' ? 'Down facade' : 'Across facade'], ['out', 'Out from wall']], A.along));
      s += grp('Set out', 'Lengthened, an array set out by spacing gains members; one set out by number spreads them wider', seg('a.mode', [['spacing', 'Spacing'], ['count', 'Number']], A.mode));
      if (along) s += grp('Length', 'To window: the window’s own ' + (D.dir === 'h' ? 'height' : 'width') + ' and what it runs past it, following the window. Fixed: a length of its own.', seg('a.rel', [['true', 'To window'], ['false', 'Fixed']], String(!!A.rel)));
      if (A.mode !== 'count') s += popChk('a.ends', !!A.ends, 'Member at far end', 'A last member on the far end when the spacing does not divide the array evenly');
    }
  }
  return s;
}
/* The picked window's own small window. In a 3D view a wall clicked gives the
   side's: its window system by name, the array and how it is set out, where else
   it applies. A window clicked gives the window's: the shading it carries,
   shading added to it, and the window broken from its array. On a plan or a
   section, the window itself: how its glass fills its bay. The rest under More. */
export function windowPopHTML(m, min, o = {}) {
  const g = m.glz || {};
  if (!o.view3d) {
    return popHeadName('name.unit', o.unitName || g.name || 'Window', min, 'The window’s name: click to type a new one')
      + popChk('g.fillW', !!g.fillW, 'Full bay width', 'The glass fills its bay, with no wall between it and the next window: a window wall or a curtain wall. Otherwise pull its jambs in the plan.')
      + popChk('g.fillH', !!g.fillH, 'Full height', 'The glass runs from its sill to the underside of the slab above. Otherwise drag its head in the section.')
      + popMore(o.more, breakHTML(o.brk));
  }
  if (o.mode === 'window') {
    // the shading this window carries - and its array, and the sides matched to it - one chip a device
    const chips = (o.devs || []).map(d => `<span class="chip${d.i === o.cur ? ' on' : ''}"><button type="button" class="pbtn chipname" data-pact="pickDev" data-v="${d.i}" title="Edit this device in the ${d.dir === 'h' ? 'section' : 'plan'}">${esc(d.name)}</button><button type="button" class="pbtn chipx" data-pact="delDev" data-v="${d.i}" title="Take this device off">×</button></span>`).join('');
    // the window's own, then its side's windows - so the wall need not be found between the glass - and the storey's own small window a click away
    return popHead(o.title || 'Window', min)
      + (o.live ? `<div class="dvnote"><b>Live optimization</b> is on: this window carries the ideal members for the date and time set. Its shading is the optimization’s until it is turned off.</div>` : (o.devs || []).length ? nameRow('Shading group', 'name.shd', o.grpName || 'Shading group', { kind: 'group', opts: o.grpOpts, cur: o.grpId }) : '')
      + (o.live ? '' : `<div class="dvlab">${(o.devs || []).length ? 'Devices' : 'Shading'}${o.brk && o.brk.can && !o.brk.broken ? ' · on every window of the array' : ''}</div>`
      + `<div class="dvrow chips">${chips || '<span class="dvnote">None yet</span>'}</div>`
      + `<div class="dvrow">${popMenuG('addShading', '+ Add shading', o.add || [], 'Shading for this window - and every window of its array, and the sides matched to it: a new device, a preset, or one you have saved. Shape it in the plan and the section.')}</div>`)
      + `<div class="dvsec">${esc(o.side || 'This side')} · window group</div>` + nameRow('Name', 'name.sys', o.sysName || 'Window group', { kind: 'window', opts: o.winOpts, cur: o.sysId }) + sideHTML(o)
      + popMore(o.more, breakHTML(o.brk));
  }
  let s = popHeadName('name.sys', o.sysName || 'Window group', min, '', { kind: 'window', opts: o.winOpts, cur: o.sysId }) + sideHTML(o);
  s += popMore(o.more, `<div class="dvrow">${popBtn('delGlazing', '', 'Remove', 'Take the windows off this side (Delete)', 'quiet')}</div>`);
  return s;
}
/** a side's windows: the array, how it is set out, and where else it applies */
function sideHTML(o) {
  let s = popChk('g.arrOn', !!o.arr, 'Array', 'Repeat the window along the side. Its number or spacing is typed on its dotted bracket in the site view.');
  if (o.arr) s += popGrp('Set out', 'By spacing, the windows keep their pitch as the side changes length; by number, their count', popSeg('g.arrBy', [['spacing', 'Spacing'], ['number', 'Number']], o.by));
  s += popChk('matchSides', !!o.sides, 'Apply to all sides', 'The storey’s other sides take this side’s windows and shading, and follow every later change - with Apply to storeys above on too, so do every side of the storeys above.');
  if (o.above) s += popChk('matchGlazing', !!o.up, 'Apply to storeys above', 'The storeys above take this side’s windows and shading, and follow every later change.');
  return s;
}
/** a side with no windows, clicked in a 3D view: a window system added to it */
export function emptyPopHTML(min, o = {}) {
  return popHead('Add window system', min)
    + `<div class="dvrow">${popBtn('addWin', '', 'One window', 'A single 1.5 × 1.8 m window in the middle of this side; make it an array from the wall’s own small window')}</div>`
    + `<div class="dvrow">${popMenu('newSystem', 'From preset…', o.presets || [], 'A window system ready to adjust: punched windows, a window wall or a curtain wall')}</div>`
    + `<div class="dvrow">${popMenu('addSavedWindow', 'From the library…', o.saved || [], 'A window group already in this design, linked: a change to it on any side changes it everywhere it is used')}</div>`;
}
/* The selected storey's own small window: a blank storey added above or
   below it, a copy of it put above or below, it moved up or down a level, it
   taken out; its shape matched by the floors above; its turn taken from the
   floor below. It stays where it opened, so a button can be pressed again and
   again as the storeys change under it. */
const ICO = {
  ins: '<rect x="-5" y="-4" width="10" height="8" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M-2.5 0H2.5M0 -2.5V2.5" stroke="currentColor" stroke-width="1.2"/>',
  dup: '<rect x="-6" y="-5" width="8" height="7" fill="none" stroke="currentColor" stroke-width="1.1"/><rect x="-2" y="-2" width="8" height="7" fill="var(--panel)" stroke="currentColor" stroke-width="1.1"/>',
  mov: '<rect x="-4" y="-2.5" width="8" height="5" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M0 -3.5V-6.5M0 3.5V6.5" stroke="currentColor"/><path d="M0 -8.5L2.2 -6H-2.2ZM0 8.5L2.2 6H-2.2Z" fill="currentColor"/>'
};
const ico = k => `<svg class="stico" viewBox="-7 -9 14 18" width="14" height="16" aria-hidden="true">${ICO[k]}</svg>`;
export function storeyPopHTML(min, o) {
  const row = (k, act, tip, upOk, dnOk) => {
    const b = (up, ok) => `<button type="button" class="pbtn arw" data-pact="${act}" data-v="${act === 'moveStorey' ? (up ? 1 : -1) : up ? 'above' : 'below'}"${ok ? '' : ' disabled'} title="${tip} ${act === 'moveStorey' ? (up ? 'up a level' : 'down a level') : up ? 'above it' : 'below it'}">${up ? '▲' : '▼'}</button>`;
    return `<div class="strow"><span title="${tip}">${ico(k)}</span>${b(true, upOk)}${b(false, dnOk)}</div>`;
  };
  const { i, n, full } = o;
  return popHead('Storey ' + (i + 1), min)
    + `<div class="stgrid">${row('ins', 'insStorey', 'Add a blank storey', !full, !full)}${row('dup', 'dupStorey', 'Add a copy of this storey', !full, !full)}${row('mov', 'moveStorey', 'Move this storey', i < n - 1, i > 0)}</div>`
    + `<div class="dvrow">${n > 1 ? popBtn('delStorey', i, 'Remove storey', 'Take this storey out of the building (Delete)', 'danger') : ''}</div>`
    + popChk('matchPlate', !!o.match, 'Match floors above', 'The storeys above take this storey’s height, slab, floorplate, rotation and offset - at once, and as they change. Their windows and shading are set apart, in the window’s own small window.')
    + (i > 0 ? popChk('rotBelow', !!o.rotBelow, 'Rotate with floor below', 'This floor’s turn is taken from the floor below, so it turns with it. With Match floors above on as well, turning a floor turns each floor above by as much again on the one below it - a twisting tower. Off, its turn is from the building’s north offset.') : '');
}

/* The site boundary's own small window: a side picked, and what it is. Its
   setback, the street's width and its curb are pushed and pulled on the
   drawing, and typed there. */
export function sitePopHTML(min, o) {
  return popHead('Site boundary', min)
    + `<span class="seg mini">${['N', 'E', 'S', 'W'].map(f => `<button type="button" data-set="site.edit" data-v="${f}" aria-pressed="${f === o.f}" title="The ${f} side">${f}</button>`).join('')}</span>`
    + popGrp('Boundary', 'Street or lane: a device may project into it as far as the by-law allows. Adjoining property: a device may not cross the line. Open ground: no condition. Two street sides that meet wrap the corner.',
      `<select class="pmenu" data-k="site.${o.f}.kind" aria-label="Boundary">${Object.entries(SITE_KINDS).map(([k, l]) => `<option value="${k}"${k === o.kind ? ' selected' : ''}>${l}</option>`).join('')}</select>`)
    + `<div class="dvrow">${popBtn('siteRotate', '', 'Rotate 90° ↻', 'Every side’s condition handed on to the next side round, clockwise: north’s to east, east’s to south, south’s to west, west’s to north')}</div>`
    + `<div class="dvnote">Push and pull its lines in the view by their grips; click a figure to type it.</div>`;
}
const opts = (o, sel) => Object.entries(o).map(([k, l]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${l}</option>`).join('');
const val = (k, lab, tip) => `<span class="barval"><span class="scrub" data-scrub="${k}" title="Drag left or right to change">${lab}</span> <span class="val" data-val="${k}" tabindex="0" title="${tip}"></span></span>`;
const SUNVALS = val('sunAlt', 'β', 'Click to type an altitude') + val('sunAz', 'az', 'Click to type an azimuth from due south, east negative');
const CUTS = { section: val('cutV', 'plan cut', 'Click to type the plan cut height'), plan: val('cutU', 'section cut', 'Click to type the section cut position'),
  detail: val('cutU', 'section', 'Click to type the section cut position') + val('cutV', 'plan', 'Click to type the plan cut height') };

/* A plan or a section follows the selection, or keeps a saved window: saved,
   the window and both its cuts are kept by name, and the view shows that
   window whatever is selected after; clicking into it selects it. */
const SAVE = `<span class="wpick"><select class="winSel" title="Selected window: this view follows the selection. A bookmark: it keeps showing that window and its cuts; clicking into the view selects it, and moving its cuts while it is selected moves them in the bookmark." aria-label="Window shown"><option value="">Selected window</option></select>
  <button type="button" class="minibtn vsave" title="Bookmark the selected window and its section and plan cuts by name; this view then keeps showing it">Bookmark</button>
  <button type="button" class="minibtn wren" hidden title="Rename this bookmark">Rename</button>
  <button type="button" class="minibtn wdel quiet" hidden title="Delete this bookmark; views showing it go back to the selected window">Delete</button></span>`;
/** the bar's own controls, by kind */
function controls(type, v) {
  switch (type) {
    case 'sun': return `<div class="seg mini sunModes"><button type="button" data-sm="path" aria-pressed="true" title="Sun positions by bearing and altitude">Sun path</button><button type="button" data-sm="year" aria-pressed="false" title="The same shading by day of the year and time of day; click or drag to set the date and time">Year</button></div>
      <label class="barsel wxdots">Weather dots <select class="dotsSel">${opts(DOT_SPANS, v.dots)}</select></label>`;
    case 'axon': return `<details class="dd axLayers"><summary>Layers</summary><div class="ddmenu">${AX_GROUPS.map(([gk, gl]) =>
      `<div class="laygrp${v.groups[gk] === false ? ' off' : ''}" data-grp="${gk}"><div class="layhd"><label class="chk"><input type="checkbox" data-axg="${gk}" ${v.groups[gk] !== false ? 'checked' : ''}><span><b>${gl}</b></span></label>
        <label class="chk laylab" title="Show or hide this group's figures and names"><input type="checkbox" data-axl="${gk}" ${v.labels[gk] !== false ? 'checked' : ''}><span>Labels</span></label></div>
        ${AX_LAYERS.filter(x => x[2] === gk).map(([k, l]) => `<label class="chk layitem"><input type="checkbox" data-ax="${k}" ${v.layers[k] ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`).join('')}
      <label class="barsel angsel"><span class="tipped" title="Where the angle constructions - β, the solar azimuth, γ, the surface azimuth and the profile angle θ - are drawn: on the ground at the foot of the selected facade, at the floor of the selected window's storey, or with their pivot at the middle of the selected window.">Angles drawn</span>
        <select class="angAt">${opts({ ground: 'On the ground', level: 'At the window’s floor', window: 'About the window' }, v.angAt)}</select></label></div></details>
      <select class="axTyp" title="Typology template: choosing one replaces the building - floorplate, storeys and every side's glazing - and keeps the date, time and orientation. None comes with shading except the balconies: that is yours to design." aria-label="Typology template">${Object.entries(TYPOLOGIES).map(([k, t]) => `<option value="${k}" title="${t.about.replace(/"/g, '&quot;')}">${t.label}</option>`).join('')}</select>
      <details class="dd axSite"><summary title="The site boundary and the context massing">Site</summary><div class="ddmenu">
        <button type="button" class="minibtn axBnd" title="Each side of the site boundary: a street, a lane, an adjoining property or open ground. Its lines are pushed and pulled in the view, and their figures typed there.">Site boundary…</button>
        <label class="barsel">Preset <select class="axSitePre" title="A site to start from: streets, lanes and neighbours on its sides. The massing is kept."><option value="" hidden selected>Choose…</option>${Object.entries(SITE_PRESETS).map(([k, p]) => `<option value="${k}" title="${p.about}">${p.label}</option>`).join('')}</select></label>
        <button type="button" class="minibtn" data-act="placeContext" title="A massing that may shade the building. Drag this straight onto the site view and let go to place it - or click it, then click the ground. Click a massing to select it: drag it to move, pull a face to resize, turn it by its ring, click a figure to type it, Delete to remove it.">Place context massing</button>
        <label class="chk"><input type="checkbox" data-k="site.ctxFollow"><span title="On: the massing moves and turns with the building and its site. Off: it stays where it is in the world, whatever the building does.">Massing follows building rotation</span></label>
      </div></details>
<button type="button" class="minibtn liveon" title="Live optimization: the selected window carries the ideal shading for the date and time set - remade as they change, and as you play through the day - in place of its own. Choose horizontal, vertical, both, or a louvred canopy, and how many members, from the bar it opens.">Live optimization</button>
      <button type="button" class="minibtn axReset">Re-center view</button>
      <button type="button" class="minibtn axZoom" title="Close in on the selected window; the orbit then turns about it">Zoom to selected</button>`;
    case 'detail': return `<label class="barchk" title="Off: the selected window's bay alone, its sun landing on a floor left unseen. On: the whole storey round it."><input type="checkbox" class="vWhole"${v.whole ? ' checked' : ''}> Whole floor</label>
      <button type="button" class="minibtn detReset">Re-center view</button>
      <button type="button" class="minibtn detWall" aria-pressed="true">Ghost wall</button>
      <button type="button" class="minibtn detSolid" aria-pressed="false">Solid device</button>
      <label class="barchk" title="Shade the sunlight that gets in, and outline it; the whole window’s beam stays dotted in grey either way"><input type="checkbox" class="vBeam"${v.beam !== false ? ' checked' : ''}> Shade beam</label>
      <label class="barchk" title="The sun's angles at the window: altitude β, γ from the facade's normal, and the profile angle θ - each typed over to move the sun"><input type="checkbox" class="vAng"${v.detAng ? ' checked' : ''}> Angles</label>
      <button type="button" class="minibtn detCentre">Centre the cuts</button><button type="button" class="minibtn liveon" title="Live optimization: the selected window carries the ideal shading for the date and time set - remade as they change, and as you play through the day - in place of its own. Choose horizontal, vertical, both, or a louvred canopy, and how many members, from the bar it opens.">Live optimization</button>`;
    case 'section': return `<label class="barchk" title="The property line, the curb and the furthest the by-law lets a shading device reach past the line, standing up from the site - the line and the curb dragged"><input type="checkbox" class="vSite"${v.site ? ' checked' : ''}> Site constraints</label><label class="barchk" title="Shade the sunlight that gets in, and outline it; the whole window’s beam stays dotted in grey either way"><input type="checkbox" class="vBeam"${v.beam !== false ? ' checked' : ''}> Shade beam</label><select class="addShd newsel" data-dir="h" title="Shading on the selected window: a new blade across the facade, one member, picked and ready to shape - or one already saved in this design"><option value="">Add shading device</option></select><button type="button" class="minibtn liveon" title="Live optimization: the selected window carries the ideal shading for the date and time set - remade as they change, and as you play through the day - in place of its own. Choose horizontal, vertical, both, or a louvred canopy, and how many members, from the bar it opens.">Live optimization</button><button type="button" class="minibtn secReset">Re-center view</button>` + SAVE;
    case 'plan': return `<div class="seg mini inModes">${Object.entries(INTERIOR_MODES).map(([k, l]) => `<button type="button" data-mode="${k}">${l}</button>`).join('')}</div>
      <label class="barchk" title="Off: the selected window's bay alone, its sun landing on a floor left unseen. On: the whole storey round it."><input type="checkbox" class="vWhole"${v.whole ? ' checked' : ''}> Whole floor</label>
      <label class="barchk" title="Shade the sunlight that gets in, and outline it; the whole window’s beam stays dotted in grey either way"><input type="checkbox" class="vBeam"${v.beam !== false ? ' checked' : ''}> Shade beam</label><label class="barchk" title="The property line, the curb and the furthest the by-law lets a shading device reach past the line, standing up from the site - the line and the curb dragged"><input type="checkbox" class="vSite"${v.site ? ' checked' : ''}> Site constraints</label><select class="addShd newsel" data-dir="v" title="Shading on the selected window: a new fin up the facade, one member, picked and ready to shape - or one already saved in this design"><option value="">Add shading device</option></select><button type="button" class="minibtn liveon" title="Live optimization: the selected window carries the ideal shading for the date and time set - remade as they change, and as you play through the day - in place of its own. Choose horizontal, vertical, both, or a louvred canopy, and how many members, from the bar it opens.">Live optimization</button><button type="button" class="minibtn planReset">Re-center view</button>` + SAVE;
  }
  return '';
}

/** a view's own way of being looked at, over the page's shared state */
function viewState() {
  return Object.assign(Object.create(V0), {
    axcam: Object.assign({}, AXCAM0), detcam: Object.assign({}, DETCAM0),
    plancam: SHEETCAM0('window'), seccam: SHEETCAM0('window'),
    layers: Object.assign({}, V0.layers), groups: Object.assign({}, V0.groups), labels: Object.assign({}, V0.labels),
    dots: V0.dots, angAt: V0.angAt, sunMode: 'path', beam: true, detSolid: false, detWall: true, inMode: 'now', whole: false, edit: false
  });
}

let seq = 0;
/** a new view of a kind: { id, type, el, host, title, V, h } - h holds what its drawing leaves for the pointer */
export function createView(type, pin = null) {
  const el = document.createElement('div'), V = viewState();
  el.className = 'view'; el.dataset.type = type; el.id = 'w' + (++seq); el.dataset.pin = pin || '';
  el.innerHTML = `<div class="v3dbar ctlzone">
      <span class="grip" title="Drag to move this view: to a row's top or bottom edge for a row of its own, to a view's side to sit beside it, onto a view to swap">⠿</span>
      <select class="vtype" title="Show a different view here">${opts(VIEW_TYPES, type)}</select>
      ${controls(type, V)}
      <button type="button" class="info" data-info aria-expanded="false" title="What this view shows">i</button>
      <div class="infopop" hidden><h4>${INFO[type][0]}</h4>${INFO[type][1]}</div>
      ${CHARTS[type] ? '' : `<span class="barvals">${SUNVALS}${CUTS[type] || ''}</span>`}
      <span class="vbtns"><button type="button" class="minibtn vb" data-vclose title="Remove this view - the others in its row take its place; add one back with the + in any margin">–</button><button type="button" class="minibtn vb" data-vfull title="Full screen">⤢</button></span>
    </div>
    <div class="v3dhost vhost${type === 'section' || type === 'plan' ? ' sheethost' : ''}${CHARTS[type] ? ' charthost' : ''}"></div><div class="vtitle"></div>`;
  const inst = { id: el.id, type, el, host: el.querySelector('.vhost'), title: el.querySelector('.vtitle'), V, h: {}, pin: pin || null };
  el._inst = inst;
  return inst;
}
