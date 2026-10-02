/* The control rail: the building - a typology to start from, its storeys and
   floorplates - then which way the window faces and what it is like, and what
   shades it. Copying and export wait in closed groups. What the results are
   for, and when, sit in the calculation settings bar over the drawings.

   It opens nearly empty: a date, a building of one storey, and nothing on it.
   Glazing is added to the selected condition - a side and a storey - and only
   then are its dimensions offered; shading is added to glazing, a member at a
   time, and only a member that is turned into an array shows array controls.
   So the panel is as long as the design is complicated, and no longer.

   The parts that change shape with the design are rebuilt only when their
   shape changes (a signature is kept for each), never while a slider in them
   is being dragged; values are synced into them every frame.               */

import { SHGC_MAX } from '../library.js';
import { fmt, clamp, hhmm, MONTHS, MDAYS, doyOf, monthDayOf } from '../util.js';
import { unitLayout, glazingLabel, offRange, buildCell, SLAB0 } from '../geometry/cell.js';
import { deviceName, deviceLabel, JUST_WORDS, hingeWords } from '../geometry/device.js';
import { FACADES, facadeLength, faceOffset, SCOPES, OFFSET_FRAMES, ROT_FROM } from '../geometry/building.js';
import { WEATHER_FILES } from '../weather.js';
import { TYPOLOGIES, SHADING_PRESETS, DEVICES_MAX, STOREYS_MAX, getValue, selGlazing, selShading, selShadingId, selDevice, selStorey, arrayGlazing, isBroken, selUnitIndex, otherBroken,
  selCell, selSystem, selUnitType } from '../state.js';
import { SYSTEM_PRESETS, UNIT_PRESETS, usage, entryName, defaultName, layoutGlazing } from '../library.js';
import { site0, SITE_KINDS, isStreet } from '../geometry/site.js';

/* ---------- the controls ----------
   Every slider is described once: label, limits, step, the unit it is shown
   in and the factor to it. A typed value keeps to the limits, not the step. */
const SPEC = {
  doy: ['Day of year', 1, 365, 1, '', 1, 0],
  hour: ['Time of day', 0, 24, 1 / 60, '', 1, 2],
  rot: ['Building north offset', -180, 180, 0.5, '°', 1, 1],
  plnW: ['Floorplate width (N–S)', 8, 80, 0.5, 'm', 1, 1],
  plnD: ['Floorplate depth (E–W)', 6, 60, 0.5, 'm', 1, 1],
  sh: ['Storey height', 2.4, 8, 0.05, 'm', 1, 2],
  sunAlt: ['Solar altitude β', 0.2, 89.9, 0.1, '°', 1, 1],
  sunAz: ['Solar azimuth', -180, 180, 0.1, '°', 1, 1],
  cutU: ['Section cut', -20, 20, 0.01, 'm', 1, 2],
  cutV: ['Plan cut', 0, 8, 0.01, 'm', 1, 2],
  gamma: ['γ', -89, 89, 0.1, '°', 1, 1],
  theta: ['Profile angle θ', 0.5, 89.5, 0.1, '°', 1, 1],
  plnOX: ['Offset east (+) / west (−)', -30, 30, 0.1, 'm', 1, 2],
  plnOY: ['Offset north (+) / south (−)', -30, 30, 0.1, 'm', 1, 2],
  h: ['Storey height', 2.4, 8, 0.05, 'm', 1, 2],
  'g.winW': ['Window width', 0.6, 8, 0.05, 'mm', 1000, 0],
  'g.winH': ['Window height', 0.6, 5, 0.05, 'mm', 1000, 0],
  'g.sill': ['Sill height', 0, 2, 0.05, 'mm', 1000, 0],
  'g.offU': ['Offset along bay', -4, 4, 0.01, 'mm', 1000, 0],
  'g.winN': ['Number of windows', 1, 120, 1, '', 1, 0],
  'g.winSp': ['Spacing', 0.3, 20, 0.05, 'mm', 1000, 0],
  'g.wallT': ['Wall thickness', 0.1, 0.8, 0.005, 'mm', 1000, 0],
  'g.reveal': ['Glass setback', 0, 0.8, 0.005, 'mm', 1000, 0],
  slabT: ['Slab thickness', 0, 2, 0.01, 'mm', 1000, 0],
  'd.depth': ['Depth', 0.02, 2.5, 0.01, 'mm', 1000, 0],
  'd.thick': ['Thickness', 0.005, 0.3, 0.005, 'mm', 1000, 0],
  'd.angle': ['Angle', -85, 85, 1, '°', 1, 0],
  'd.len': ['Length', 0.05, 12, 0.05, 'mm', 1000, 0],
  'd.lenX': ['Extension', -3, 6, 0.01, 'mm', 1000, 0],
  'd.offU': ['Horizontal offset', -3, 3, 0.01, 'mm', 1000, 0],
  'd.offV': ['Vertical offset', -3, 3, 0.01, 'mm', 1000, 0],
  'd.offset': ['Wall offset', 0, 1.5, 0.01, 'mm', 1000, 0],
  'a.len': ['Array length', 0, 12, 0.05, 'mm', 1000, 0],
  'a.spacing': ['Spacing', 0.02, 3, 0.01, 'mm', 1000, 0],
  'a.count': ['Members', 1, 40, 1, '', 1, 0],
  plnRot: ['Floor rotation', -180, 180, 0.5, '°', 1, 1],
  'site.off': ['Setback from the face', 0, 40, 0.1, 'm', 1, 2],
  'site.width': ['Street width', 3, 60, 0.5, 'm', 1, 1],
  'site.curb': ['Curb from the property line', 0, 15, 0.1, 'm', 1, 2],
  'g.shgc': ['SHGC', 0.1, SHGC_MAX, 0.01, '', 1, 2],
  streetW: ['Street width', 4, 40, 0.5, 'm', 1, 1],
  devHeight: ['Device height above street', 0, 60, 0.05, 'm', 1, 2],
  curbDist: ['Face to curb', 0, 12, 0.1, 'm', 1, 1]
};
const specOf = k => SPEC[k] || (k.startsWith('site.') ? SPEC['site.' + k.split('.').pop()] : SPEC[k.split('.')[0]]);
/* A long explanation is a tooltip on the name or button it explains, shown on
   hover; a name that has one is underlined with dots. */
const tipA = tip => tip ? ` title="${tip.replace(/"/g, '&quot;')}" class="tipped"` : '';
const rng = (k, label, tip) => {
  const [l, min, max, step] = specOf(k);
  return `<div class="ctl"><div class="ctlhd"><label for="c_${k}"${tipA(tip)}>${label || l}</label>
     <span class="val" data-val="${k}" tabindex="0" title="Click to type a value"></span></div>
   <input type="range" id="c_${k}" data-k="${k}" min="${min}" max="${max}" step="${step}"></div>`;
};
const seg = (k, opts, cls = '') => `<div class="seg ${cls}" data-seg="${k}">` +
  opts.map(([v, l]) => `<button type="button" data-k="${k}" data-v="${v}">${l}</button>`).join('') + '</div>';
const row = (label, inner, tip) => `<div class="ctl"><label><span${tipA(tip)}>${label}</span></label>${inner}</div>`;
/** a name that can be typed over; empty goes back to the automatic one */
const nameBox = (k, auto) => `<div class="ctl namectl"><label for="c_${k}"><span>Name</span></label>
  <input type="text" class="namebox" id="c_${k}" data-name="${k}" spellcheck="false" placeholder="${auto}" maxlength="40" title="Tab takes the suggested name"></div>`;
const btn = (act, label, arg = '', cls = '', tip = '') => `<button type="button" class="${cls}" data-act="${act}" data-arg="${arg}"${/\boff\b/.test(cls) ? ' disabled' : ''}${tip ? ` title="${tip.replace(/"/g, '&quot;')}"` : ''}>${label}</button>`;

/* ---------- the calculation settings ----------
   What every result is worked out for - the weather file, which windows, which
   sky - and when, in a bar that stays at the top of the page as it scrolls.
   The time settings open from it to the side. */
export { SCOPES as RESULT_SCOPES };
export function buildCalcBar(host) {
  host.innerHTML = `
  <button type="button" class="tuck" id="barTuck" title="Tuck the calculation settings away" aria-expanded="true">▴</button>
  <span class="cbtitle">Calculation settings</span>
  <label class="barsel"><span class="tipped" title="An hour-by-hour typical year for Vancouver, shifted for warming. It colours the sun chart's dots by temperature and gives the beam for the average and recorded days and every yearly total; a clear day does not depend on it.">Weather file</span> <select data-k="wx" id="c_wx">${Object.entries(WEATHER_FILES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
  <label class="barsel"><span class="tipped" title="Which windows the plan's floor, the 3D view's light, the sun chart's shading, the solar heat gain and its charts are for.">Results for</span> <select data-k="scope" id="c_scope">${Object.entries(SCOPES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
  <label class="barsel">Sky ${seg('sky', [['clear', 'Clear day'], ['average', 'Average day'], ['recorded', 'Recorded day']], 'mini')}</label>
  <div class="tset">
    <button type="button" class="minibtn tbtn" id="timeBtn" aria-expanded="false">Time settings <span class="arr">›</span></button>
    <span class="barval"><span class="scrub" data-scrub="doy" title="Drag left or right to change the date">date</span> <span class="val" data-val="doy" tabindex="0" title="Click to type a date, e.g. Jun 21 or 6/21"></span></span>
    <span class="barval"><span class="scrub" data-scrub="hour" title="Drag left or right to change the time">time</span> <span class="val" data-val="hour" tabindex="0" title="Click to type a time, e.g. 14:30"></span></span>
    <select data-k="timeMode" id="c_timeMode" class="clocksel" aria-label="Clock" title="Solar time is the sun's own: noon is when it is due south. PST is the standard clock (UTC−8), PDT the summer clock an hour ahead."><option value="sol">Solar time</option><option value="lst">PST</option><option value="pdt">PDT</option></select>
    <div class="tmenu" id="timeMenu" hidden>
      <div class="ctl"><div class="ctlhd"><label for="c_doy">Date</label>
        <span class="md"><input type="text" id="c_month" class="mdbox" spellcheck="false" aria-label="Month" title="Month: a number or a name">
        <input type="text" id="c_day" class="mdbox day" spellcheck="false" aria-label="Day of the month"></span></div>
        <input type="range" id="c_doy" data-k="doy" min="1" max="365" step="1"></div>
      <div class="ctl"><div class="ctlhd"><label for="c_hour">Time of day</label>
        <span class="val" data-val="hour" tabindex="0" title="Click to type a time, e.g. 14:30"></span></div>
        <input type="range" id="c_hour" data-k="hour" min="0" max="24" step="${1 / 60}"></div>
      <div class="seg"><button type="button" id="playBtn">Play day</button></div>
      <p class="subhd">Sun angles</p>
      <div class="ctl"><div class="ctlhd"><label>Altitude β</label><span class="val" data-val="sunAlt" tabindex="0" title="Click to type an altitude"></span></div></div>
      <div class="ctl"><div class="ctlhd"><label><span class="tipped" title="From due south, east negative">Azimuth</span></label><span class="val" data-val="sunAz" tabindex="0" title="Click to type an azimuth, east negative"></span></div></div>
    </div>
  </div>
  <button type="button" class="minibtn" id="layoutReset" title="Put the drawings back in their first arrangement">Reset layout</button>
  <div class="gainrow" id="gainRow">
    <button type="button" class="tuck" id="gainTuck" title="Tuck the solar heat gain away" aria-expanded="true">▴</button>
    <span class="cbtitle"><span class="tipped" title="Direct solar gain through the glass, for what Results for names, under the sky and weather file set above: the beam, times the cosine of its angle to the glass, times the glass it still reaches, times the SHGC. A reference for the cooling, insulation and interior shading to come - not a daylight or energy model.">Solar heat gain</span></span>
    <div class="gainfigs" id="calc4"></div>
  </div>
`;
}

/* ---------- the static shell ---------- */
export function buildRail(host) {
  host.innerHTML = `
  <button type="button" class="tuck railtuck" id="railTuck" title="Tuck the panel away" aria-expanded="true">‹</button>
  <details class="grp" open><summary>Building Parameters</summary><div class="grpbody">
    <div class="ctl"><label for="c_typ"><span class="tipped" title="Choosing one replaces the building - floorplate, storeys and every side's glazing - and keeps the date, time and orientation. None comes with shading except the balconies: that is yours to design.">Typology template</span></label>
      <select id="c_typ" title="${TYPOLOGIES.blank.about}">${Object.entries(TYPOLOGIES).map(([k, t]) => `<option value="${k}"${k === 'blank' ? ' selected' : ''}>${t.label} - ${t.sub}</option>`).join('')}</select></div>
    ${rng('rot', null, "The whole building turned from true north, clockwise: east +, west −. Every floor's rotation that is measured from it turns with it. Dragging the facade normal under the sun chart, or the facade arrow in the site view, turns this.")}
    <p class="subhd">Working storey</p>
    <div id="storeyHost" class="dyn"></div>
    <label class="chk"><input type="checkbox" data-k="matchPlate" id="c_matchPlate"><span class="tipped" title="The storeys above take this storey's height, slab, floorplate, rotation and offset - at once, and as they are changed. Off, this storey can differ from the ones above and below.">Match floors above</span></label>
    ${rng('sh')}
    ${rng('slabT', null, "The slab at the top of this storey, under the floor above. The glass stands between its sill and the slab, so a window is never taller than the storey less its slab and sill; glass set to full height runs up to it.")}
    <p class="subhd"><span class="tipped" id="plateNote">Floorplate</span></p>
    ${rng('plnRot', null, "This floor turned on its own, clockwise +, measured from what is chosen below. Every side's surface azimuth - and so every sun angle to its glass - follows from the building's north offset and this.")}
    ${row('Rotation from', `<select data-k="rotRel" id="c_rotRel">${Object.entries(ROT_FROM).map(([k, l]) => `<option value="${k}">${l[0].toUpperCase() + l.slice(1)}</option>`).join('')}</select>`, "What the floor's rotation is measured from: the building's north offset (it turns with the building), the floor below (it turns with that floor - a run of floors each at +2° twists), or true north (it stays put however the building turns). Switching keeps the floor as it is and rewrites the figure.")}
    ${rng('plnW')}${rng('plnD')}
    ${row('Offset axes', `<select data-k="oxyIn" id="c_oxyIn">${Object.entries(OFFSET_FRAMES).map(([k, l]) => `<option value="${k}">${l[0].toUpperCase() + l.slice(1)}</option>`).join('')}</select>`, "The axes the offset is read along: this floor's own, turned with it (turning the floor swings it round the axis); the building's; the floor below's; or true north and east. Switching keeps the storey where it is and rewrites the figures.")}
    ${rng('plnOX')}${rng('plnOY')}
  </div></details>

  <details class="grp" open><summary><span class="tipped" title="The site boundary: a rectangle about the ground floor, each side set back from its wall face and each a street, a lane, an adjoining property line or open ground. Shading devices are read against it, and those that break the by-law turn red in the 3D views.">Site Parameters</span></summary><div class="grpbody">
    <div id="siteHost" class="dyn"></div>
  </div></details>

  <details class="grp" open><summary>Window Parameters <span class="sumtag" id="glzTag"></span></summary><div class="grpbody">
    <div id="condHost" class="dyn"></div>
    <div id="glzHost" class="dyn"></div>
  </div></details>

  <details class="grp" open id="shdGrp"><summary>Shading Parameters <span class="sumtag" id="shdTag"></span></summary><div class="grpbody">
    <div id="shdHost" class="dyn"></div>
  </div></details>

  <details class="grp"><summary><span class="tipped" title="Copy this condition's storey height, window system or shading to other storeys and sides">Copy</span></summary><div class="grpbody">
    <div id="copyHost" class="dyn"></div>
  </div></details>

  <details class="grp"><summary><span class="tipped" title="Every window system, glazing unit, shading system and shading device in this design, and how many sides, systems and windows use each. They are linked: editing one where it is used edits it everywhere. Nothing uses an entry marked unused, and it can be deleted.">Saved types</span></summary><div class="grpbody">
    <div id="libHost" class="dyn"></div>
  </div></details>

  <details class="grp"><summary>Export to Rhino</summary><div class="grpbody">
    ${row('Scope', `<select data-k="expScope" id="c_expScope">${Object.entries(EXPORT_WORDS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>`)}
    <div class="seg"><button type="button" id="expBtn" title="Real Rhino geometry on named layers, in millimetres and world axes: walls, slab edges and spandrels, the glazing, every shading member as a solid, and the sun ray. The parameters ride along inside the file.">Export .3dm</button></div>
    <p class="hint" id="expNote"></p>
  </div></details>`;
}

/** the street-encroachment inputs live with the by-law, not in the rail */
export function regsControls() {
  return `<label class="chk"><input type="checkbox" id="c_encroach" data-k="encroach">
      <span class="tipped" title="The selected window's shading projects into a street: the code checks then test it against VBBL 1.8.9. Leave off if it stays on the property. Which sides meet a street is not yet modelled.">Encroaches into street</span></label>
    <div class="regsgrid">${rng('streetW', null, 'The street the side meets, from the property line across - a street under 10 m wide allows projection only at 7.62 m and up')}${rng('curbDist', null, 'From the wall face to the outer face of the curb; a device must keep its outer edge 600 mm from it')}</div>`;
}

const EXPORT_WORDS = { unit: 'The selected unit', storey: 'The selected storey, this side', level: 'The selected storey, all sides',
  facade: 'This side, every storey', building: 'The whole building' };

/* ---------- the parts that change shape ---------- */
/* one storey at a time: a menu of them, top of the building first, and the
   moves a stack of sheets allows - up or down a level, a copy above or below */
const storeyWords = (s, i) => 'Storey ' + (i + 1) + ' · ' + fmt(s.h, 2) + ' m · ' + fmt(s.w, 1) + ' × ' + fmt(s.d, 1) + ' m · '
  + (Object.keys(FACADES).filter(f => s.cells[f]).join(' ') || 'blank');
function storeyPanel(S) {
  const n = S.storeys.length, i = S.sel.st, full = n >= STOREYS_MAX;
  const opts = S.storeys.map((s, k) => k).reverse().map(k => `<option value="${k}"${k === i ? ' selected' : ''}>${storeyWords(S.storeys[k], k)}</option>`).join('');
  return `<div class="stpick">${btn('selStorey', '▾', i - 1, i <= 0 ? 'off' : '', 'Work on the storey below')}<select id="stSel" aria-label="Working storey">${opts}</select>${btn('selStorey', '▴', i + 1, i >= n - 1 ? 'off' : '', 'Work on the storey above')}</div>
    <div class="seg wrap stops">
      ${btn('moveStorey', 'Move up', 1, i >= n - 1 ? 'off' : '', 'Swap this storey with the one above it')}${btn('moveStorey', 'Move down', -1, i <= 0 ? 'off' : '', 'Swap this storey with the one below it')}
      ${btn('dupStorey', 'Copy above', 'above', full ? 'off' : '', "A copy of this storey, every side's glazing and shading with it, placed above it; the copy becomes the working storey")}${btn('dupStorey', 'Copy below', 'below', full ? 'off' : '', "A copy of this storey, every side's glazing and shading with it, placed below it; the copy becomes the working storey")}
      ${btn('addStorey', 'New on top', '', full ? 'off' : '', 'A new blank storey on top of the building, as tall and as big as the one below it')}${n > 1 ? btn('delStorey', 'Remove', i, 'quiet', 'Take this storey out of the building') : ''}</div>`;
}
const storeySig = S => [S.storeys.length, S.sel.st, S.storeys.map(s => [s.h, s.w, s.d, Object.keys(FACADES).filter(f => s.cells[f]).join('')].join(':')).join(',')].join('|');

function condPanel(S) {
  const r = selCell(S), g = r && selUnitType(S) ? layoutGlazing(S, r) : null, len = facadeLength(S, S.sel.f);
  let unit = '';
  if (g) {
    const n = unitLayout(g, len).n, u = S.sel.unit === null ? Math.floor((n - 1) / 2) : clamp(S.sel.unit, 0, n - 1);
    unit = row('Window', `<div class="seg stepper">${btn('selUnit', '‹', u - 1)}<span class="stepv">${u + 1} of ${n}</span>${btn('selUnit', '›', u + 1)}</div>`);
  }
  const match = (S.sel.st < S.storeys.length - 1 ? `<label class="chk"><input type="checkbox" data-k="matchGlazing" id="c_matchGlazing"><span class="tipped" title="The storeys above take this side's glazing and shading - at once, and as it is edited.">Match floors above</span></label>` : '')
    + `<label class="chk"><input type="checkbox" data-k="matchSides" id="c_matchSides"><span class="tipped" title="The storey's other sides take this side's glazing and shading - at once, and as it is edited; with Match floors above on as well, so do every side of the storeys above. Sides with no glazing get it too.">Match all sides</span></label>`;
  return row('Side', seg('selF', Object.keys(FACADES).map(f => [f, f]))) + unit + match;
}
const condSig = S => { const r = selCell(S), g = r && selUnitType(S) ? layoutGlazing(S, r) : null; return [S.sel.f, S.sel.st, S.storeys.length, S.sel.unit, g ? unitLayout(g, facadeLength(S, S.sel.f)).n : 0].join('|'); };
/** what the floorplate note says: how this storey's sides stand against the storeys above and below */
function plateNote(S) {
  const i = S.sel.st;
  const cmp = (j, word) => {
    if (j < 0 || j >= S.storeys.length) return '';
    const bits = [];
    for (const f of ['N', 'E', 'S', 'W']) {
      const d = faceOffset(S, f, i) - faceOffset(S, f, j);
      if (Math.abs(d) > 1e-6) bits.push(f + ' ' + fmt(Math.abs(d), 2) + ' m ' + (d > 0 ? 'out' : 'in'));
    }
    return bits.length ? 'against the storey ' + word + ': ' + bits.join(', ') : 'the same as the storey ' + word;
  };
  const parts = [cmp(i - 1, 'below'), cmp(i + 1, 'above')].filter(Boolean);
  return (parts.length ? 'This storey is ' + parts.join('; ') + '. ' : '')
    + 'A side that stands out past the storey below overhangs it and shades its glass. Floors are open plan: sun runs on until it meets the floor or the outside walls.';
}

/* choosing what the other broken windows do is not design either:
   pending is the part ('win' or 'shd') whose choice is being asked */
export const brkUI = { pending: false };
const PART = { win: ['window', 'glazing unit - a copy of the array’s, or any saved one - and its place in its bay'], shd: ['shading', 'shading system - a copy of the array’s, or any saved one'] };
/** the selected window's window, or its shading, against its array: break it out, or bind it back */
function unitBlock(S, part) {
  const lay = layoutGlazing(S, selCell(S)), i = selUnitIndex(S), others = otherBroken(S, part), [word, what] = PART[part];
  if (!lay || !selUnitType(S) || unitLayout(lay, facadeLength(S, S.sel.f)).n < 2) return '';
  const list = xs => xs.length === 1 ? 'Window ' + (xs[0] + 1) + ' is' : 'Windows ' + xs.map(x => x + 1).join(', ') + ' are';
  if (!isBroken(S, part)) {
    let s = `<div class="seg">${btn('breakUnit', 'Break window ' + (i + 1) + (part === 'shd' ? ' shading' : '') + ' from array', part, '',
      'The window keeps its place in the array but takes its own ' + what + '; everything else still follows the array. It remembers the array, and can be bound back.')}</div>`;
    if (others.length) s += `<p class="hint">${list(others)} broken${part === 'shd' ? ' (shading)' : ''}. ${btn('rebindAll', 'Rebind all', part, 'quiet linkbtn')}</p>`;
    return s;
  }
  let s = `<div class="brk" title="This window uses its own ${part === 'shd' ? 'shading system; its glazing still follows the array' : 'glazing unit; its shading, the layout and the wall still follow the array'}."><b>Window ${i + 1}${part === 'shd' ? ' shading' : ''} · broken from array</b></div>`;
  if (brkUI.pending === part && others.length) s += `<p class="hint">${list(others)} broken too:</p>
    <div class="seg wrap">${btn('rebindApplyAll', 'Rebind them', part, 'primary', 'They take the array’s new settings')}${btn('rebindApplyKeep', 'Keep broken', part)}${btn('rebindCancel', 'Cancel', part, 'quiet')}</div>`;
  else s += `<div class="seg wrap">${btn('rebindRevert', 'Revert to array', part, '', 'This window drops its own ' + word + ' and follows the array again')}${btn('rebindApply', 'Apply to array', part, '', part === 'win' ? 'The array takes this window’s unit - as its system does, so every side on that system takes it' : 'The whole array takes this window’s shading')}</div>`;
  return s;
}
const SHGC_TIP = 'SHGC: the share of the beam striking the glass that ends up as heat inside. Clear double glazing is about 0.7, low-e 0.4, solar-control 0.25. Held to 0.36 at most: VBBL 10.2.2.3.(1)(e), vertical glazing on the NECB path.';
/* ---------- the library in the panel ----------
   A window system, a glazing unit, a shading system and a shading device are
   each picked from the design's library by name, made new - from scratch or
   from a preset - or duplicated to be changed apart. They are linked: an edit
   changes everything that uses them. */
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const devWord = D => D.name || deviceName(D) + ' · ' + D.id;
const libOpts = (S, kind) => Object.values(S.lib[kind]).map(o => [o.id, kind === 'devices' ? devWord(o) : o.name || defaultName(kind, o)]);
/** a library pick, set like any other control */
const pick = (k, entries, none) => `<select data-k="${k}" id="c_${k}">${none ? `<option value="">${none}</option>` : ''}${entries.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>`;
/** a menu that does something when an item is chosen, then goes back to its prompt */
const menu = (act, items, label) => `<select class="newsel" data-newact="${act}" aria-label="${label}"><option value="">${label}</option>${items.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>`;
const chk = (k, label, tip) => `<label class="chk"><input type="checkbox" data-k="${k}" id="c_${k}"><span${tipA(tip)}>${label}</span></label>`;
const linkTip = (n, id, what) => 'Linked: ' + (n[id] || 0) + ' ' + what + ' ' + ((n[id] || 0) === 1 ? 'uses' : 'use') + ' it, and change' + ((n[id] || 0) === 1 ? 's' : '') + ' with it. Duplicate it to change this one alone.';
const SYS_NEW = [['scratch', 'From scratch'], ...Object.entries(SYSTEM_PRESETS).map(([k, p]) => [k, 'From preset: ' + p.label])];
const UNIT_NEW = [['scratch', 'From scratch'], ...Object.entries(UNIT_PRESETS).map(([k, p]) => [k, 'From preset: ' + p.label])];
const SHD_NEW = [['scratch', 'From scratch'], ...Object.entries(SHADING_PRESETS).map(([k, p]) => [k, 'From preset: ' + p.label])];
const libSig = S => Object.values(S.lib.systems).concat(Object.values(S.lib.units), Object.values(S.lib.shading), Object.values(S.lib.devices)).map(o => o.id + '=' + (o.name || '')).join(',');

function glzPanel(S) {
  const r = selCell(S), systems = libOpts(S, 'systems');
  if (!r) return `<p class="hint">No window system on storey ${S.sel.st + 1} of the ${S.sel.f} side.</p>`
    + row('New system', menu('newSystem', SYS_NEW, 'Create…'), 'From scratch: an empty system - choose how its windows are set out, then add the glazing unit it lays. From a preset: a system with its unit, ready to adjust.')
    + (systems.length ? row('Saved system', menu('useSystem', systems, 'Choose…'), 'A system already in this design. It stays linked: editing it here edits it everywhere it is used.') : '');
  const y = selSystem(S), u = selUnitType(S), n = usage(S), brk = isBroken(S);
  let s = `<p class="subhd">Window system</p>`
    + row('System', `<div class="libpick">${pick('g.sys', systems)}${menu('newSystem', SYS_NEW, 'New…')}</div>`, linkTip(n, r.sys, 'sides'))
    + `<div class="seg wrap">${btn('dup', 'Duplicate', 'sys', '', 'A copy of this system under a new name, used here instead; the other sides keep the original')}${btn('delGlazing', 'Remove', '', 'quiet', 'Take the window system off this side')}</div>`
    + nameBox('name.sys', 'Window system')
    + row('Layout', seg('g.winBy', [['number', 'Number'], ['spacing', 'Spacing']])) + (y.winBy === 'spacing' ? rng('g.winSp') : rng('g.winN'))
    + '<p class="hint" id="layNote"></p>'
    + rng('g.wallT', null, 'The wall the windows stand in: under each sill, over each head up to the slab, and between windows that do not fill their bays.');
  s += '<p class="subhd">Glazing unit</p>' + unitBlock(S, 'win');
  const units = libOpts(S, 'units');
  if (!u) return s + '<p class="hint">This system has no glazing unit yet.</p>'
    + row('Add unit', menu('newUnit', UNIT_NEW, 'Add…'), 'From scratch, or from a preset: a punched opening, a window wall or a curtain wall. A window wall and a curtain wall are units that fill their bay glass to glass and their storey up to the slab.')
    + (units.length ? row('Saved unit', menu('useUnit', units, 'Choose…')) : '');
  s += row(brk ? 'Unit (this window)' : 'Unit', `<div class="libpick">${pick('g.unit', units)}${menu('newUnit', UNIT_NEW, 'New…')}</div>`, linkTip(n, u.id, 'systems and windows'))
    + `<div class="seg">${btn('dup', 'Duplicate', 'unit', '', 'A copy of this unit under a new name, used here instead')}</div>`
    + nameBox('name.unit', 'Glazing unit')
    + chk('g.fillW', 'Full bay width', 'The glass fills its bay, so there is no wall between it and the next unit: a window wall or a curtain wall. Otherwise the glass is never wider than its bay.')
    + (u.fillW ? '' : rng('g.winW'))
    + chk('g.fillH', 'Full height', 'The glass runs from its sill to the slab at the top of the storey. Otherwise it is never taller than the storey less its slab and sill.')
    + (u.fillH ? '' : rng('g.winH')) + rng('g.sill')
    + (brk && !u.fillW ? rng('g.offU') : '')
    + rng('g.reveal', null, 'Set-back glass is shaded by its own opening: the head acts as an overhang of that depth, the jambs as fins of it. Glass that fills its bay has no jambs, and its set-back is the slab edge standing proud of it - a window wall; flush, a curtain wall.')
    + rng('g.shgc', null, SHGC_TIP) + '<p class="hint" id="unitNote"></p>';
  return s;
}
const glzSig = S => {
  const r = selCell(S), u = selUnitType(S), y = selSystem(S), lay = r && layoutGlazing(S, r);
  return [S.sel.f, S.sel.st, r ? r.sys : '-', u ? [u.id, u.fillW, u.fillH].join(',') : '-', y ? y.winBy : '-', isBroken(S), selUnitIndex(S), otherBroken(S).join(','),
    brkUI.pending === 'win', lay ? unitLayout(lay, facadeLength(S, S.sel.f)).n > 1 : '-', libSig(S)].join('|');
};

function shdPanel(S) {
  if (!selGlazing(S)) return '<p class="hint">Shading hangs on a glazing unit. Add one above first.</p>';
  const r = selCell(S), h = selShading(S), D = selDevice(S), n = usage(S), brk = isBroken(S, 'shd'), sid = selShadingId(S);
  let s = unitBlock(S, 'shd')
    + row(brk ? 'Shading (this window)' : 'Shading system', `<div class="libpick">${pick('g.shd', libOpts(S, 'shading'), 'None')}${menu('newShading', SHD_NEW, 'New…')}</div>`,
      h ? linkTip(n, sid, 'arrays and windows') : 'A set of shading devices, saved by name, that any array or broken window can carry. Each preset is sized to this glazing.');
  if (!h) return s;
  s += `<div class="seg">${btn('dup', 'Duplicate', 'shd', '', 'A copy of this shading system and its devices under a new name, used here instead')}</div>` + nameBox('name.shd', 'Shading');
  const saved = libOpts(S, 'devices').filter(([id]) => !h.devices.includes(id));
  const tabs = h.devices.length ? `<div class="seg wrap">${h.devices.map((id, i) =>
    btn('selDevice', (i + 1) + ' · ' + esc(S.lib.devices[id] ? deviceLabel(S.lib.devices[id]) : '?'), i, i === (r.dev || 0) ? 'on' : '')).join('')}</div>` : '';
  const add = h.devices.length < DEVICES_MAX ? `<div class="seg wrap">${btn('addDevice', 'Add horizontal', 'h', h.devices.length ? '' : 'primary', 'A blade across the facade, which can then be made an array')}${btn('addDevice', 'Add vertical', 'v', '', 'A fin up the facade, which can then be made an array')}</div>`
    + (saved.length ? row('Saved device', menu('addSavedDevice', saved, 'Add…')) : '') : '';
  if (!D) return s + tabs + add;
  const h0 = D.dir === 'h', HW = hingeWords(D);
  s += tabs + add + '<p class="subhd">Device</p>'
    + row('Device type', `<div class="libpick">${pick('d.type', libOpts(S, 'devices'))}</div>`, linkTip(n, D.id, 'shading systems'))
    + `<div class="seg">${btn('dup', 'Duplicate', 'dev', '', 'A copy of this device under a new name, used in this slot instead')}${btn('delDevice', 'Remove', '', 'quiet', 'Take this device out of the shading system')}</div>`
    + nameBox('d.name', deviceName(D));
  s += row('Member', seg('d.dir', [['h', 'Horizontal'], ['v', 'Vertical']]));
  s += rng('d.depth') + rng('d.thick')
    + rng('d.angle', null, h0 ? 'A positive angle drops the outer edge; the wall edge is then the top.' : 'A positive angle swings the outer edge right, seen from outside; the wall edge is then the left.')
    + chk('d.lenRel', 'Relative to window', 'On, the member is the window’s own ' + (h0 ? 'width' : 'height') + ' plus the length beyond it - negative for shorter - and follows the window wherever the device is used. Off, its length is given outright. Switching keeps the member as long as it is.')
    + (getValue('d.lenRel', S) ? rng('d.lenX', 'Length extension', 'Added to the window’s own ' + (h0 ? 'width' : 'height') + ', shared out by the justification: centred, half each side. Negative is shorter than the window.')
      : rng('d.len', 'Length'));
  s += row('Hinge', seg('d.hinge', [['start', HW.start], ['centre', HW.centre], ['end', HW.end]]),
    'The member turns about its hinge, and the offset is measured to it; if the hinge would put part of the member into the wall, it is held out until it just clears.');
  s += row('Horizontal justification', seg('d.justU', [['start', JUST_WORDS.u.start], ['centre', JUST_WORDS.u.centre], ['end', JUST_WORDS.u.end]]));
  s += row('Vertical justification', seg('d.justV', [['start', JUST_WORDS.v.start], ['centre', JUST_WORDS.v.centre], ['end', JUST_WORDS.v.end]]));
  s += `<label class="chk"><input type="checkbox" data-k="d.offOn" id="c_d.offOn"><span class="tipped" title="Move the member off its justification point">Offset</span></label>`;
  if (D.offOn) s += rng('d.offU', 'Horizontal offset (right +)') + rng('d.offV', 'Vertical offset (up +)');
  s += rng('d.offset');
  s += '<p class="subhd">Array</p>';
  if (!D.arr) s += `<div class="seg">${btn('createArray', 'Create array', '', '', 'Repeats the member ' + (h0 ? 'down the facade' : 'across the facade') + ' or out from the wall, anchored where it stands')}</div>`;
  else {
    s += row('Direction', seg('a.along', h0 ? [['facade', 'Down the facade'], ['out', 'Out from the wall']] : [['facade', 'Across the facade'], ['out', 'Out from the wall']]),
      'The array keeps the member’s justification: ' + (D.arr.along === 'out' ? 'it runs out from the wall offset.' : h0 ? 'from the top it runs down, from the bottom up, from the centre both ways.' : 'from the left it runs right, from the right left, from the centre both ways.'));
    s += row('Set out by', seg('a.mode', [['spacing', 'Spacing'], ['count', 'Number']]));
    s += D.arr.mode === 'count' ? rng('a.count') : rng('a.spacing');
    s += rng('a.len');
    if (D.arr.mode !== 'count') s += `<label class="chk"><input type="checkbox" data-k="a.ends" id="c_a.ends"><span class="tipped" title="Add a member at the far end when the spacing does not divide the array evenly">Add member at end</span></label>`;
    s += `<div class="seg">${btn('removeArray', 'Remove array', '', 'quiet')}</div>`;
  }
  return s;
}
const shdSig = S => {
  if (!selGlazing(S)) return 'none';
  const r = selCell(S), h = selShading(S), D = selDevice(S);
  return [S.sel.f, S.sel.st, selUnitIndex(S), isBroken(S, 'shd'), otherBroken(S, 'shd').join(','), brkUI.pending === 'shd', unitLayout(layoutGlazing(S, r), facadeLength(S, S.sel.f)).n > 1,
    selShadingId(S) || '-', r.dev || 0, h ? h.devices.join(',') : '-', D ? [D.dir, !!D.arr, D.arr && D.arr.along, D.arr && D.arr.mode, D.offOn, getValue('d.lenRel', S)].join(',') : '-', libSig(S)].join('|');
};

/* choosing what to copy and where is not design, so it lives here, not in the store */
export const copyUI = { what: { height: false, glazing: true, shading: false }, targets: new Set(), note: '' };
function copyPanel(S) {
  const r = selCell(S), fs = Object.keys(FACADES), sid = r && r.shd;
  const what = `<label class="chk"><input type="checkbox" data-copy="height"><span>Height and slab (${fmt(selStorey(S).h, 2)} m, ${fmt((selStorey(S).slab ?? 0.3) * 1000, 0)} mm)</span></label>
    <label class="chk"><input type="checkbox" data-copy="glazing"><span>${r ? 'Window system: ' + esc(entryName(S, 'systems', r.sys)) : 'No glazing (clears targets)'}</span></label>
    ${r ? `<label class="chk"><input type="checkbox" data-copy="shading"><span>Shading: ${sid ? esc(entryName(S, 'shading', sid)) : 'none (clears targets)'}</span></label>` : ''}`;
  const grid = `<table class="cgrid"><tr><th></th>${fs.map(f => `<th><button type="button" data-cpcol="${f}" title="Every storey of the ${f} side">${f}</button></th>`).join('')}</tr>
    ${S.storeys.map((s, i) => i).reverse().map(i => `<tr><th><button type="button" data-cprow="${i}" title="Every side of storey ${i + 1}">${i + 1}</button></th>${fs.map(f => {
      const src = f === S.sel.f && i === S.sel.st;
      return `<td>${src ? '<span class="src" title="The selected condition">●</span>' : `<input type="checkbox" data-cpt="${f}:${i}" aria-label="${f} storey ${i + 1}">`}</td>`;
    }).join('')}</tr>`).join('')}</table>`;
  return `<p class="hint"><span class="tipped" title="Choose what to copy, then where. The targets take the same, linked systems; a target with no room for the glass under its slab is passed over and said why.">From <b>${S.sel.f} storey ${S.sel.st + 1}</b></span></p>
    ${what}<p class="subhd">To</p>${grid}
    <div class="seg">${btn('copyGo', 'Apply', '', 'primary', 'Copy to the ticked conditions')}${btn('copyClear', 'Clear')}</div>
    <p class="hint" id="copyNote">${copyUI.note}</p>`;
}
const copySig = S => { const r = selCell(S); return [S.sel.f, S.sel.st, S.storeys.length, r ? r.sys + '/' + r.shd : '-', selStorey(S).h, selStorey(S).slab, copyUI.note, libSig(S)].join('|'); };

/* the library itself: every saved type, what uses it, and those nothing uses can go */
const LIB_KINDS = [['systems', 'Window systems'], ['units', 'Glazing units'], ['shading', 'Shading systems'], ['devices', 'Shading devices']];
function libPanel(S) {
  const n = usage(S), wins = S.views || [];
  return `<p class="subhd">Saved windows</p>` + (wins.length ? '<ul class="liblist">' + wins.map(v => `<li><span class="libname" title="${esc(v.f + ' side, storey ' + (v.st + 1) + ', window ' + ((v.unit ?? 0) + 1))}">${esc(v.name)}</span>${btn('delWindow', 'Delete', v.id, 'quiet linkbtn')}</li>`).join('') + '</ul>'
    : '<p class="hint">None yet: Save view in a plan or section.</p>') + LIB_KINDS.map(([kind, title]) => {
    const list = libOpts(S, kind);
    return `<p class="subhd">${title}</p>` + (list.length ? '<ul class="liblist">' + list.map(([id, name]) => `<li><span class="libname">${esc(name)}</span><span class="libuse">${n[id] ? n[id] + ' ×' : 'unused'}</span>${n[id] ? '' : btn('delEntry', 'Delete', kind + ':' + id, 'quiet linkbtn')}</li>`).join('') + '</ul>' : '<p class="hint">None yet.</p>');
  }).join('');
}
const libPanelSig = S => { const n = usage(S); return libSig(S) + '|' + Object.entries(n).map(([k, v]) => k + v).join(',') + '|' + (S.views || []).map(v => v.id + v.name).join(','); };

/* the site, a side at a time */
function sitePanel(S) {
  const sg = Object.assign(site0(), S.site || {}), f = sg.edit || 'S', s = sg[f];
  let h = row('Side', seg('site.edit', ['N', 'E', 'S', 'W'].map(x => [x, x])), 'The side of the site boundary being set: the boundary is set back from the ground floor’s wall faces')
    + row('Boundary', `<select data-k="site.${f}.kind" id="c_site_kind">${Object.entries(SITE_KINDS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>`,
      'Street or lane: a device may project into it as far as the by-law allows. Adjoining property: a device may not cross the line. Open ground: no condition. Two street sides that meet wrap the corner.')
    + rng('site.' + f + '.off', null, 'From the ground floor’s wall face to the property line on this side; also shown, and typed over, in the site view');
  if (isStreet(s)) h += rng('site.' + f + '.width', s.kind === 'lane' ? 'Lane width' : 'Street width', 'From this property line to the one across; under 10 m wide, a device may project into it only at 7.62 m and up')
    + rng('site.' + f + '.curb', null, 'From the property line to the outer face of the curb; a device must keep its outer edge 600 mm from it');
  return h;
}
const siteSig = S => { const sg = S.site || {}, f = sg.edit || 'S'; return f + '|' + (sg[f] ? sg[f].kind : ''); };

const PANELS = [['siteHost', sitePanel, siteSig], ['storeyHost', storeyPanel, storeySig], ['condHost', condPanel, condSig], ['glzHost', glzPanel, glzSig],
  ['shdHost', shdPanel, shdSig], ['copyHost', copyPanel, copySig], ['libHost', libPanel, libPanelSig]];

/* ---------- values ---------- */
function readout(k, S) {
  const v = getValue(k, S);
  if (v === undefined) return '';
  const [, , , , unit, mul, dec] = specOf(k);
  if (k === 'hour') return hhmm(v);
  if (k === 'doy') { const md = monthDayOf(v); return MONTHS[md.m - 1] + ' ' + md.d; }
  if (k === 'sunAz') return fmt(v, 1) + '°' + (Math.abs(v) < 0.05 ? '' : v < 0 ? ' E' : ' W');
  if (k === 'rot') return Math.abs(v) < 0.05 ? 'true north · 0°' : fmt(Math.abs(v), 1) + '° ' + (v < 0 ? 'W' : 'E') + ' of N';
  if (k === 'plnRot') return Math.abs(v) < 0.05 ? '0°' : (v < 0 ? '−' : '+') + fmt(Math.abs(v), 1) + '°';
  if (k === 'd.lenX') return (v < -0.0005 ? '−' : '+') + fmt(Math.abs(v) * 1000, 0) + ' mm · ' + fmt((openingDim(S) + v) * 1000, 0) + ' mm long';
  if (k === 'a.len' && v <= 0) return 'single member';
  return (v * mul).toFixed(dec) + (unit ? ' ' + unit : '');
}
/** the unit's own dimension along the selected member */
function openingDim(S) {
  const c = selCellModel(S), D = selDevice(S);
  if (!c || !D) return 0;
  return D.dir === 'h' ? c.winW : c.winH;
}
/** the selected window as it is built: its glass held to its bay and under its slab */
function selCellModel(S) {
  const g = selGlazing(S), s = selStorey(S);
  return g ? buildCell(g, s.h, facadeLength(S, S.sel.f), 0, s.slab ?? SLAB0) : null;
}

/** just the clock and the calendar, for the per-frame pass of a drag or a play */
export function syncClock(S) {
  const el = document.getElementById('c_hour');
  if (el) el.value = S.hour;
  // the date and time, the sun's angles and the cuts, which the handles and the drags move
  document.querySelectorAll('[data-val="hour"], [data-val="doy"], [data-val="sunAlt"], [data-val="sunAz"], [data-val="cutU"], [data-val="cutV"]').forEach(o => {
    if (!o.firstElementChild) o.textContent = readout(o.dataset.val, S);
  });
  syncDate(S);
}
function syncDate(S) {
  const md = monthDayOf(S.doy), mo = document.getElementById('c_month'), dy = document.getElementById('c_day');
  document.getElementById('c_doy').value = S.doy;
  if (document.activeElement !== mo) mo.value = MONTHS[md.m - 1];
  if (document.activeElement !== dy) dy.value = md.d;
}

export function syncRail(S) {
  for (const [id, render, sig] of PANELS) {
    const host = document.getElementById(id), s = sig(S);
    if (host.dataset.sig !== s) { host.innerHTML = render(S); host.dataset.sig = s; }
  }
  document.querySelectorAll('.ctlzone input[type=range][data-k]').forEach(el => {
    const v = getValue(el.dataset.k, S);
    if (v !== undefined) el.value = v;
  });
  document.querySelectorAll('.ctlzone [data-val]').forEach(out => { if (!out.firstElementChild) out.textContent = readout(out.dataset.val, S); });
  document.querySelectorAll('.ctlzone [data-seg]').forEach(s => {
    const k = s.dataset.seg, v = k === 'selF' ? S.sel.f : getValue(k, S);
    s.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(v === b.dataset.v)));
  });
  document.querySelectorAll('.ctlzone input[type=checkbox][data-k]').forEach(el => { el.checked = !!getValue(el.dataset.k, S); });
  document.querySelectorAll('.ctlzone select[data-k]').forEach(el => { el.value = getValue(el.dataset.k, S); });
  // the copy panel's ticks are the panel's own, so they are put back after a rebuild
  document.querySelectorAll('#rail [data-copy]').forEach(el => {
    el.checked = !!copyUI.what[el.dataset.copy];
  });
  document.querySelectorAll('#rail [data-cpt]').forEach(el => { el.checked = copyUI.targets.has(el.dataset.cpt); });
  document.querySelectorAll('#rail [data-name]').forEach(el => { if (document.activeElement !== el) el.value = getValue(el.dataset.name, S) || ''; });
  const g = selGlazing(S), ln = document.getElementById('layNote'), lay = layoutGlazing(S, selCell(S));
  if (ln && lay) {
    const len = facadeLength(S, S.sel.f), L = unitLayout(lay, len);
    const endW = L.byNumber ? 0 : (len - L.n * L.pitch) / 2;
    ln.textContent = L.n + (L.n === 1 ? ' bay' : ' bays') + ' at ' + fmt(L.pitch * 1000, 0) + ' mm along ' + fmt(len, 1) + ' m'
      + (endW > 0.0005 ? ', ' + fmt(endW * 1000, 0) + ' mm of wall at each end' : endW < -0.0005 ? ', the end bays running off the side' : '') + '.';
  }
  const un = document.getElementById('unitNote'), cm = un && selCellModel(S);
  if (un && cm) un.textContent = 'Here: ' + fmt(cm.winW * 1000, 0) + ' × ' + fmt(cm.winH * 1000, 0) + ' mm of glass, sill ' + fmt(cm.sill * 1000, 0) + ' mm' + (cm.run ? ', glass to glass' : '') + '.'
    + (cm.notes.length ? ' ' + cm.notes.filter(t => /held|moved/.test(t)).join(' ') : '');
  const on = document.querySelector('label[for="c_g.offU"]');
  if (on && g) {
    const r = offRange(g, unitLayout(layoutGlazing(S, selCell(S)), facadeLength(S, S.sel.f)).pitch);
    on.title = r > 1e-4 ? 'It can move up to ' + fmt(r * 1000, 0) + ' mm either way and stay inside its bay.' : 'The window fills its bay, so there is no room to move it.';
    on.classList.add('tipped');
  }
  // the ground floor has no floor below to measure from
  for (const id of ['c_oxyIn', 'c_rotRel']) { const ob = document.querySelector('#' + id + ' option[value="below"]'); if (ob) ob.disabled = S.sel.st === 0; }
  const pn = document.getElementById('plateNote');
  if (pn) pn.title = plateNote(S);
  const ty = document.getElementById('c_typ');
  if (ty) ty.title = TYPOLOGIES[ty.value].about;
  const y = selSystem(S);
  document.getElementById('glzTag').textContent = S.sel.f + ' · storey ' + (S.sel.st + 1) + (y ? ' · ' + (y.name || defaultName('systems')).toLowerCase() : ' · none') + (isBroken(S) ? ' · broken' : '');
  const sh = g ? selShading(S) : null;
  document.getElementById('shdTag').textContent = g ? (sh ? (sh.name || 'shading') + ' · ' + sh.devices.length + (sh.devices.length === 1 ? ' device' : ' devices') : 'none') + (isBroken(S, 'shd') ? ' · broken' : '') : '';
  syncDate(S);
}

/* A slider is quick but coarse. Clicking its figure turns it into a text field
   seeded with the value in the units shown, so a pitch of 630 mm or a blade at
   37 degrees can simply be stated. Typed values keep to the limits but not to
   the step; a time may be typed as 14:30. */
function editVal(out, S, api) {
  if (out.firstElementChild) return;
  const k = out.dataset.val, sp = specOf(k);
  if (!sp) return;
  const [, min, max, , unit, mul, dec] = sp, v = getValue(k, S);
  const box = document.createElement('input');
  box.type = 'text'; box.className = 'valbox'; box.spellcheck = false;
  let txt = k === 'hour' ? hhmm(v) : k === 'doy' ? readout('doy', S) : v * mul === 0 ? '0' : (v * mul).toFixed(dec);
  if (k !== 'hour' && k !== 'doy' && txt.includes('.')) txt = txt.replace(/0+$/, '').replace(/\.$/, '');   // 600 mm must stay 600
  box.value = txt;
  out.textContent = ''; out.appendChild(box);
  if (unit && k !== 'hour') out.appendChild(document.createTextNode(' ' + unit));
  box.focus(); box.select();
  let done = false;
  const close = commit => {
    if (done) return;
    done = true;
    let n;
    const t = box.value.trim();
    if (k === 'hour') {
      // 14:30, 14h30 and 1430 are all half past two; 14.5 is too
      const hm = t.match(/^(\d{1,2})\s*[:h]\s*(\d{1,2})$/);
      if (hm) n = +hm[1] + +hm[2] / 60;
      else if (/^\d{3,4}$/.test(t)) n = Math.floor(+t / 100) + (+t % 100) / 60;
      else n = parseFloat(t.replace(',', '.'));
    } else if (k === 'doy') n = parseDate(t);
    else n = parseFloat(t.replace(/[^0-9.\-]/g, '')) / mul;
    out.textContent = '';
    if (commit && isFinite(n)) api.set(k, clamp(n, min, max));
    else api.refresh();
  };
  box.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') close(true);
    else if (e.key === 'Escape') close(false);
  });
  box.addEventListener('blur', () => close(true));
}

/** a date as typed: Jun 21, 21 June, 6/21, or a day of the year */
function parseDate(t) {
  const s = t.trim().toLowerCase(), mi = MONTHS.findIndex(x => s.includes(x.toLowerCase().slice(0, 3)));
  const nums = (s.match(/\d+/g) || []).map(Number);
  let m, d;
  if (mi >= 0) { m = mi + 1; d = nums[0] || 1; }
  else if (nums.length >= 2) { m = nums[0]; d = nums[1]; }
  else return nums.length ? nums[0] : NaN;
  if (!(m >= 1 && m <= 12)) return NaN;
  return doyOf(m, clamp(d, 1, MDAYS[m - 1]));
}

/* A figure in a drawing is typed over in place: a box opens on the figure,
   seeded with its value, and Enter or leaving it sets it. */
export function openFloatEdit(el, k, S, api) {
  const sp = specOf(k);
  if (!sp) return;
  const [, min, max, , unit, mul, dec] = sp, r = el.getBoundingClientRect();
  const box = document.createElement('input');
  box.type = 'text'; box.className = 'floatedit'; box.spellcheck = false;
  box.value = (getValue(k, S) * mul).toFixed(dec).replace(/\.?0+$/, '') || '0';
  Object.assign(box.style, { left: Math.round(r.left + window.scrollX) + 'px', top: Math.round(r.top + window.scrollY - 2) + 'px', minWidth: Math.round(Math.max(56, r.width)) + 'px' });
  document.body.appendChild(box);
  box.focus(); box.select();
  let done = false;
  const close = commit => {
    if (done) return;
    done = true;
    const n = parseFloat(box.value.replace(',', '.').replace(/[^0-9.\-]/g, '')) / mul;
    box.remove();
    if (commit && isFinite(n)) api.set(k, clamp(n, min, max)); else api.refresh();
  };
  box.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') close(true); else if (e.key === 'Escape') close(false); });
  box.addEventListener('blur', () => close(true));
}
/* A figure's name can be scrubbed, as in a drawing program: pressed and drawn
   left or right, the value runs down or up with the pointer. */
const SCRUB = { sunAlt: 0.25, sunAz: 0.5, gamma: 0.5, theta: 0.25, cutU: 0.01, cutV: 0.01, doy: 0.5, hour: 0.02, plnRot: 0.5, rot: 0.5 };
function scrub(el, e, S, api) {
  const k = el.dataset.scrub, rate = SCRUB[k] || 0.01, sp = specOf(k);
  if (!sp) return;
  const x0 = e.clientX, v0 = getValue(k, S);
  try { el.setPointerCapture(e.pointerId); } catch (_) { }
  document.body.classList.add('scrubbing');
  // followed on the window, so the scrub holds however far the pointer travels
  const move = ev => api.scrub(k, clamp(v0 + (ev.clientX - x0) * rate * (ev.shiftKey ? 0.2 : 1), sp[1], sp[2]));
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    document.body.classList.remove('scrubbing'); api.scrubEnd();
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  e.preventDefault();
}

/** a month typed as a number or a name, and a day kept inside it */
function commitDate(S, api) {
  const mo = document.getElementById('c_month'), dy = document.getElementById('c_day');
  const t = mo.value.trim().toLowerCase();
  let m = parseInt(t, 10);
  if (!isFinite(m)) m = MONTHS.findIndex(x => t.startsWith(x.toLowerCase())) + 1;
  const cur = monthDayOf(S.doy);
  if (!(m >= 1 && m <= 12)) m = cur.m;
  let d = parseInt(dy.value, 10);
  if (!isFinite(d)) d = cur.d;
  d = clamp(d, 1, MDAYS[m - 1]);
  api.set('doy', doyOf(m, d));
}

export function wireRail(host, S, api) {
  host.addEventListener('input', e => {
    const el = e.target;
    if (el.matches('input[type=range][data-k]')) api.set(el.dataset.k, +el.value);
    else if (el.matches('input[type=checkbox][data-k]')) api.set(el.dataset.k, el.checked);
    else if (el.id === 'c_encroach') api.set('encroach', el.checked);
    else if (el.dataset.copy) {
      copyUI.what[el.dataset.copy] = el.checked;
    } else if (el.dataset.cpt) { el.checked ? copyUI.targets.add(el.dataset.cpt) : copyUI.targets.delete(el.dataset.cpt); }
  });
  host.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.newact) { const v = el.value; el.value = ''; if (v) api.act(el.dataset.newact, v); }
    else if (el.matches('select[data-k]')) api.set(el.dataset.k, el.value);
    else if (el.id === 'c_month' || el.id === 'c_day') commitDate(S, api);
    else if (el.id === 'stSel') api.act('selStorey', el.value);
    else if (el.id === 'c_typ') { api.typology(el.value); el.title = TYPOLOGIES[el.value].about; }
    else if (el.dataset.name) api.set(el.dataset.name, el.value.trim() || null);
  });
  host.addEventListener('pointerdown', e => {
    const sc = e.target.closest && e.target.closest('[data-scrub]');
    if (sc && e.button === 0) scrub(sc, e, S, api);
  });
  host.addEventListener('keydown', e => {
    if ((e.target.id === 'c_month' || e.target.id === 'c_day') && e.key === 'Enter') { e.preventDefault(); commitDate(S, api); e.target.blur(); }
    if (e.target.dataset && e.target.dataset.name && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  });
  host.addEventListener('click', e => {
    const out = e.target.closest('.val');
    if (out && out.dataset.val) { e.stopPropagation(); editVal(out, S, api); return; }
    const b = e.target.closest('button, [data-act]');
    if (!b) return;
    if (b.dataset.typ) return api.typology(b.dataset.typ);
    if (b.id === 'playBtn') return api.play();
    if (b.id === 'expBtn') return api.exportRhino();
    if (b.dataset.cpcol || b.dataset.cprow !== undefined) {
      // a whole column or row of targets at once; a second press clears it
      const keys = b.dataset.cpcol ? S.storeys.map((_, i) => b.dataset.cpcol + ':' + i) : Object.keys(FACADES).map(f => f + ':' + b.dataset.cprow);
      const pick = keys.filter(k => k !== S.sel.f + ':' + S.sel.st);
      const all = pick.every(k => copyUI.targets.has(k));
      pick.forEach(k => all ? copyUI.targets.delete(k) : copyUI.targets.add(k));
      return api.refresh();
    }
    if (b.dataset.act) return api.act(b.dataset.act, b.dataset.arg);
    if (b.dataset.k === 'selF') return api.act('selFacade', b.dataset.v);
    if (b.dataset.k) api.set(b.dataset.k, b.dataset.v);
  });
}
export { STOREYS_MAX };
