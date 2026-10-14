/* The weather files, hour by hour.

   Two NRC future-shifted typical years for Vancouver: every hour's direct
   normal irradiance and dry-bulb temperature. Hour index (doy - 1) * 24 + h
   covers h..h+1 Pacific Standard Time, so a value belongs to the half hour. */

import { HOURLY_RAW } from './data/hourly.js';
import { doyOf } from './util.js';

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
/* An EnergyPlus weather file read in: its direct normal irradiance (field 15)
   and dry-bulb temperature (field 7), an hour a row after its eight header
   lines, each row the hour ending at its time. A leap day is left out, so the
   year is 8760 hours as the tool's own are; a missing irradiance reads as none. */
export function parseEpw(text) {
  const lines = String(text).split(/\r?\n/), loc = (lines[0] || '').split(',');
  if (!/^LOCATION/i.test(loc[0] || '')) throw new Error('this is not an EnergyPlus weather file');
  const dni = new Int16Array(8760), db = new Int16Array(8760);
  let n = 0;
  for (let k = 8; k < lines.length; k++) {
    const f = lines[k].split(',');
    if (f.length < 15) continue;
    const mo = +f[1], d = +f[2], h = +f[3];
    if (!(mo >= 1 && mo <= 12) || (mo === 2 && d === 29)) continue;
    const i = (doyOf(mo, d) - 1) * 24 + (h - 1);
    if (i < 0 || i >= 8760) continue;
    const q = +f[14], t = +f[6];
    dni[i] = q >= 0 && q < 2000 ? Math.round(q) : 0; db[i] = Math.round((isFinite(t) && t < 90 ? t : 0) * 10); n++;
  }
  if (n < 8700) throw new Error('only ' + n + ' of the 8760 hours could be read');
  return { dni, db, place: (loc[1] || '').trim(), lat: +loc[6], lon: +loc[7], tz: +loc[8] };
}
let epwSeq = 0;
/** a weather file read in, added to the list under its own name; its key */
export function addWeather(label, rec) {
  const key = 'epw' + (++epwSeq);
  WEATHER_FILES[key] = label;
  cache[key] = { dni: rec.dni, db: rec.db, file: label };
  return key;
}
/** the record at a moment of PST on a day, read between the half hours */
export function recordAt(wx, arr, doy, lst) {
  const a = hourly(wx)[arr], x = (doy - 1) * 24 + lst - 0.5;
  const i0 = Math.floor(x), f = x - i0;
  const at = i => a[((i % 8760) + 8760) % 8760];
  return at(i0) + (at(i0 + 1) - at(i0)) * f;
}
