/* How the drawings are being looked at - cameras, layers, ghosting. None of
   this is design, so none of it is saved in the history.                     */

import { SHEETCAM0 } from './draw/sheetcam.js';

export const AXCAM0 = { daz: 220, el: 26, zoom: 1.25, panX: 0, panY: 0, focus: null };
export const DETCAM0 = { az: -32, el: 14, zoom: 1, panX: 0, panY: 0 };
export const AX_LAYERS = [
  ['dome', 'Altitude rings', 'sky'],
  ['seasons', 'Seasonal sun paths', 'sky'],
  ['day', 'The selected day’s path', 'sky'],
  ['wxdots', 'Weather hours, by temperature', 'sky'],
  ['ray', 'The sun and its ray', 'sky'],
  ['angles', 'Altitude β, solar azimuth and γ', 'angles'],
  ['azimuth', 'Surface azimuth', 'angles'],
  ['triangle', 'Profile angle θ', 'angles'],
  ['compass', 'Compass rose', 'ground'],
  ['grid', 'Grid', 'ground'],
  ['site', 'Site boundary and streets', 'ground']
];
/** the layers' groups: a group switched off hides all of its layers; each group's labels switch on their own */
export const AX_GROUPS = [['sky', 'Sky dome'], ['angles', 'Sun angles'], ['ground', 'Ground']];

export const V = {
  axcam: Object.assign({}, AXCAM0),
  detcam: Object.assign({}, DETCAM0),
  /** the plan and the section open on the window, and zoom out from it */
  plancam: SHEETCAM0('window'),
  seccam: SHEETCAM0('window'),
  // every layer on but the weather hours, which crowd the dome
  layers: Object.fromEntries(AX_LAYERS.map(([k]) => [k, k !== 'wxdots'])),
  groups: { sky: true, angles: true, ground: true },
  labels: { sky: true, angles: true, ground: true },
  /** the plan and the window in 3D show the selected window's bay alone, its sun on a floor left unseen - or the whole floor */
  whole: false,
  /** the plan's and the section's handles and typed figures, shown on request */
  edit: false,
  /** where the site view draws its angles: 'ground', the window's 'level', or about the 'window' */
  angAt: 'ground',
  /** the device is see-through by default: a solid array stands between the eye
   *  and the sunlit glass, which is the one thing the window view is for */
  detSolid: false,
  /** the wall is nearer the eye than the glass, so it is solid by default */
  detWall: true,
  /** the sun chart's weather dots: 'half' the year the date is in, the whole 'year', or 'off' */
  dots: 'year',
  /** the ghosted volume of sunlight coming in, in the window view */
  beam: true,
  /** what the plan shows on the floor: this instant, the day's total, the year's */
  inMode: 'now',
  /** true while the bearing handle is dragged: the costly sky layers wait */
  sunFast: false,
  /** a context building being placed: on while the site view waits for a click, P where the pointer is on the ground */
  place: { on: false, P: null },
  /** the selected storey being edited in the site view: on once its wall is clicked */
  plate: { on: false }
};
