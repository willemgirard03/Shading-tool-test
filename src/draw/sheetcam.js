/* The camera of a flat drawing - the plan and the section. The whole storey
   is drawn; the camera chooses how much of it the sheet shows. Three framings
   are offered - the window and its devices, as far as the sun reaches inside
   today, or the whole floor - and on top of any of them the wheel zooms and a
   drag pans. Zooming holds the window where it is on the sheet, so the view
   stays centred on the window being worked on.                              */

import { W, H } from './svg.js';

export const FITS = { window: 'Window', reach: 'Sun’s reach', floor: 'Whole floor' };
export const SHEETCAM0 = fit => ({ fit, zoom: 1, panX: 0, panY: 0 });

/** box [x0, x1, y0, y1] in drawing axes (x right, y down, metres), the margins
 *  of the sheet, the camera, and the anchor - the point zooming holds still */
export function sheetCam(box, M, cam, anchor = [0, 0], key) {
  // framed once for a window and kept: a change to the design does not rescale or shift the sheet under the eye
  if (key !== undefined) { if (!cam.fix || cam.fix.key !== key) cam.fix = { key, box, anchor }; ({ box, anchor } = cam.fix); }
  // while a grip is dragged the framing holds still, so the drawing does not slide or scale under the pointer;
  // it is fitted afresh when the grip is let go
  if (cam.grab) { if (!cam.hold) cam.hold = { box, anchor }; ({ box, anchor } = cam.hold); }
  const [x0, x1, y0, y1] = box, aw = W - M.l - M.r, ah = H - M.t - M.b;
  const k0 = Math.min(aw / Math.max(1e-6, x1 - x0), ah / Math.max(1e-6, y1 - y0));
  const Ax = M.l + aw / 2 + (anchor[0] - (x0 + x1) / 2) * k0, Ay = M.t + ah / 2 + (anchor[1] - (y0 + y1) / 2) * k0;
  const k = k0 * cam.zoom;
  // kept on the camera, so a wheel turn can hold the point under the pointer
  cam._A = [Ax, Ay];
  const X = x => Ax + (x - anchor[0]) * k + cam.panX, Y = y => Ay + (y - anchor[1]) * k + cam.panY;
  return { k, X, Y, area: [M.l, M.t, W - M.r, H - M.b] };
}

/** a wheel turn at sheet point (sx, sy): the zoom changes and the point under the pointer stays;
 *  it is held only far past any use, so a floor of any size can be taken in */
export function zoomAt(cam, sx, sy, factor) {
  const z0 = cam.zoom, z1 = Math.min(1e4, Math.max(1e-4, z0 * factor)), A = cam._A || [W / 2, H / 2];
  cam.panX = sx - A[0] - (sx - A[0] - cam.panX) * z1 / z0;
  cam.panY = sy - A[1] - (sy - A[1] - cam.panY) * z1 / z0;
  cam.zoom = z1;
}
