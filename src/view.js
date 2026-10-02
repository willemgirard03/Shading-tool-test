/* How the drawings are being looked at - cameras, layers, ghosting. None of
   this is design, so none of it is saved in the history.                     */

import { SHEETCAM0 } from './draw/sheetcam.js';

export const AXCAM0 = { daz: 220, el: 26, zoom: 1.25, panX: 0, panY: 0, focus: null };
export const DETCAM0 = { az: -32, el: 14, zoom: 1, panX: 0, panY: 0 };
export const AX_LAYERS = [
  ['dome', 'Sky dome and altitude rings'],
  ['seasons', 'Seasonal sun paths on the dome'],
  ['day', 'The selected day’s sun path'],
  ['compass', 'Compass rose on the ground plane'],
  ['azimuth', 'Surface azimuth: the facade normal from due south'],
  ['angles', 'Altitude β, solar azimuth and γ at the site'],
  ['triangle', 'Profile angle θ in the plane square to the facade'],
  ['ray', 'The sun and its ray'],
  ['shadow', 'Ground shadow of the block'],
  ['wxdots', 'Weather hours on the dome, by temperature'],
  ['grid', 'Ground grid'],
  ['site', 'Site boundary and streets']
];

export const V = {
  axcam: Object.assign({}, AXCAM0),
  detcam: Object.assign({}, DETCAM0),
  /** the plan and the section open on the window, and zoom out from it */
  plancam: SHEETCAM0('window'),
  seccam: SHEETCAM0('window'),
  // every layer on but the weather hours, which crowd the dome
  layers: Object.fromEntries(AX_LAYERS.map(([k]) => [k, k !== 'wxdots'])),
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
  sunFast: false
};
