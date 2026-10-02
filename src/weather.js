/* The weather files, hour by hour.

   Two NRC future-shifted typical years for Vancouver: every hour's direct
   normal irradiance and dry-bulb temperature. Hour index (doy - 1) * 24 + h
   covers h..h+1 Pacific Standard Time, so a value belongs to the half hour. */

import { HOURLY_RAW } from './data/hourly.js';

export const WEATHER_FILES = { gw10: 'NRC typical year, +1.0 °C warming', gw20: 'NRC typical year, +2.0 °C warming' };

const cache = {};
function decode(b64) {
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Int16Array(u8.buffer);
}
/** { dni: W/m2, db: tenths of a degree } for each of the 8760 hours */
export function hourly(wx) {
  if (!cache[wx]) { const r = HOURLY_RAW[wx]; cache[wx] = { dni: decode(r.dni), db: decode(r.db), file: r.file }; }
  return cache[wx];
}
/** the record at a moment of PST on a day, read between the half hours */
export function recordAt(wx, arr, doy, lst) {
  const a = hourly(wx)[arr], x = (doy - 1) * 24 + lst - 0.5;
  const i0 = Math.floor(x), f = x - i0;
  const at = i => a[((i % 8760) + 8760) % 8760];
  return at(i0) + (at(i0 + 1) - at(i0)) * f;
}
