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
  axon: ['Site and sun', '<p>The sun’s position is a composition of angles: its altitude β above the horizon, and its azimuth - measured here from due south, east negative, west positive. Against a facade, what matters is γ, the angle between the facade’s normal and the sun; the profile angle θ is drawn in the plane square to the facade, from the ground at its foot.</p><p>Right-drag to orbit; middle-drag (or Shift and right-drag) to pan; wheel to zoom. The left button selects and drags: the sun to set the time, the facade arrow on the ground to turn the building. Click a window or a wall to select it and its storey: drag the storey to move it (the ground floor stays centred), pull a side’s square to move that side, turn it by its ring; the dotted bracket over the windows gives their number and spacing - click either to type it. Each facade’s SHGC is written above it - click to type it. Zoom to selected closes in on the window and orbits about it.</p><p>Context massing: drag Place Context Massing straight onto the view, or click it and then the ground; click a massing to select it, drag it to move it (Alt-drag to drag off a copy or an instance - an instance takes every push and pull made on the others; right-click it to let it pass its turns on to them, or to make it unique), pull the square on a face to move that face, turn it by the ring on the ground (Shift for 15° steps), click a figure to type it - its width, depth, height, turn and nearest distance to the building. Delete or Backspace removes it; Esc or a click elsewhere lets it go.</p>'],
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
const popHead = (title, min) => `<div class="dvhd" title="Drag to move"><span class="dvttl">${String(title).replace(/</g, '&lt;')}</span><span class="dvbtns">`
  + `<button type="button" data-popact="min" title="${min ? 'Unfold' : 'Fold'}">${min ? '▸' : '▾'}</button><button type="button" data-popact="close" title="Close - click it again on the drawing to open it">×</button></span></div>`;

export function devicePopHTML(D, ax, arrayView, min, g) {
  const words = ax === 'V' ? ['Top', 'Middle', 'Bottom'] : ['Left', 'Middle', 'Right'], A = D.arr, along = A && A.along !== 'out', out = A && A.along === 'out';
  const seg = popSeg, grp = popGrp, three = ['start', 'centre', 'end'].map((v, i) => [v, words[i]]);
  let s = popHead(deviceLabel(D), min);
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
/* The picked window's own small window: how its glass fills its bay. */
export function windowPopHTML(m, min) {
  const g = m.glz || {};
  return popHead(g.name || 'Window', min)
    + popChk('g.fillW', !!g.fillW, 'Full bay width', 'The glass fills its bay, with no wall between it and the next window: a window wall or a curtain wall. Otherwise pull its jambs in the plan.')
    + popChk('g.fillH', !!g.fillH, 'Full height', 'The glass runs from its sill to the underside of the slab above. Otherwise drag its head in the section.');
}

const opts = (o, sel) => Object.entries(o).map(([k, l]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${l}</option>`).join('');
const val = (k, lab, tip) => `<span class="barval"><span class="scrub" data-scrub="${k}" title="Drag left or right to change">${lab}</span> <span class="val" data-val="${k}" tabindex="0" title="${tip}"></span></span>`;
const SUNVALS = val('sunAlt', 'β', 'Click to type an altitude') + val('sunAz', 'az', 'Click to type an azimuth from due south, east negative');
const CUTS = { section: val('cutV', 'plan cut', 'Click to type the plan cut height'), plan: val('cutU', 'section cut', 'Click to type the section cut position'),
  detail: val('cutU', 'section', 'Click to type the section cut position') + val('cutV', 'plan', 'Click to type the plan cut height') };

/* A plan or a section follows the selection, or keeps a saved window: saved,
   the window and both its cuts are kept by name, and the view shows that
   window whatever is selected after; clicking into it selects it. */
const SAVE = `<span class="wpick"><select class="winSel" title="Selected window: this view follows the selection. A saved window: it keeps showing that window and its cuts; clicking into the view selects it, and moving its cuts while it is selected moves them in the saved window." aria-label="Window shown"><option value="">Selected window</option></select>
  <button type="button" class="minibtn vsave" title="Save the selected window and its section and plan cuts by name; this view then keeps showing it">Save</button>
  <button type="button" class="minibtn wren" hidden title="Rename this saved window">Rename</button>
  <button type="button" class="minibtn wdel quiet" hidden title="Delete this saved window; views showing it go back to the selected window">Delete</button></span>`;
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
      <button type="button" class="minibtn axReset">Re-center view</button>
      <button type="button" class="minibtn axZoom" title="Close in on the selected window; the orbit then turns about it">Zoom to selected</button>`;
    case 'detail': return `<label class="barchk" title="Off: the selected window's bay alone, its sun landing on a floor left unseen. On: the whole storey round it."><input type="checkbox" class="vWhole"${v.whole ? ' checked' : ''}> Whole floor</label>
      <button type="button" class="minibtn detReset">Re-center view</button>
      <button type="button" class="minibtn detWall" aria-pressed="true">Ghost wall</button>
      <button type="button" class="minibtn detSolid" aria-pressed="false">Solid device</button>
      <label class="barchk" title="Shade the sunlight that gets in, and outline it; the whole window’s beam stays dotted in grey either way"><input type="checkbox" class="vBeam"${v.beam !== false ? ' checked' : ''}> Shade beam</label>
      <button type="button" class="minibtn detCentre">Centre the cuts</button>`;
    case 'section': return `<label class="barchk" title="The property line, the curb and the furthest the by-law lets a shading device reach past the line, standing up from the site - the line and the curb dragged"><input type="checkbox" class="vSite"${v.site ? ' checked' : ''}> Site constraints</label><label class="barchk" title="Shade the sunlight that gets in, and outline it; the whole window’s beam stays dotted in grey either way"><input type="checkbox" class="vBeam"${v.beam !== false ? ' checked' : ''}> Shade beam</label><button type="button" class="minibtn addShd" data-dir="h" title="A blade across the facade over the selected window - one member, picked and ready to shape">Add horizontal shading</button><button type="button" class="minibtn secReset">Re-center view</button>` + SAVE;
    case 'plan': return `<div class="seg mini inModes">${Object.entries(INTERIOR_MODES).map(([k, l]) => `<button type="button" data-mode="${k}">${l}</button>`).join('')}</div>
      <label class="barchk" title="Off: the selected window's bay alone, its sun landing on a floor left unseen. On: the whole storey round it."><input type="checkbox" class="vWhole"${v.whole ? ' checked' : ''}> Whole floor</label>
      <label class="barchk" title="Shade the sunlight that gets in, and outline it; the whole window’s beam stays dotted in grey either way"><input type="checkbox" class="vBeam"${v.beam !== false ? ' checked' : ''}> Shade beam</label><label class="barchk" title="The property line, the curb and the furthest the by-law lets a shading device reach past the line, standing up from the site - the line and the curb dragged"><input type="checkbox" class="vSite"${v.site ? ' checked' : ''}> Site constraints</label><button type="button" class="minibtn addShd" data-dir="v" title="A fin up the facade beside the selected window - one member, picked and ready to shape">Add vertical shading</button><button type="button" class="minibtn planReset">Re-center view</button>` + SAVE;
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
