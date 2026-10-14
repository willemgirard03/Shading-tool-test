/* The library: the window and shading types a design is made of.

   Four kinds of entry, each named and kept in the design (S.lib), each used
   by reference, so editing one changes everything that uses it:
     units     a glazing unit type - its glass's width, height, sill, set-back
               and SHGC. A unit can fill its bay (glass to glass, no wall
               between) and its height up to the slab; a window wall and a
               curtain wall are just such units, differing in sill and set-back.
     systems   a window system - how units are set out along a side (by number
               or spacing), the wall they stand in, and the unit type it lays
     devices   a shading device type - one member, or a member array
     shading   a shading system - the set of device types on a unit
   A side of a storey holds a reference to a system and a shading system:
     { sys, shd, dev, broken: { i: { unit, offU } }, brokenShd: { i: { shd } } }
   where a window broken from the array takes a unit type, or a shading
   system, of its own. flatGlazing() reads a reference back as the one flat
   record the geometry is built from.                                       */

import { DEVICE0 } from './geometry/device.js';
import { normGlazing } from './geometry/cell.js';

/* The SHGC a unit may have: VBBL 10.2.2.3.(1)(e), vertical glazing on the
   NECB path, an assembly maximum of 0.36. The control stops there, so a
   design cannot be made over it; glass found over it is drawn red. */
export const SHGC_MAX = 0.36;
export const UNIT0 = () => ({ name: null, winW: 1.8, winH: 1.8, sill: 0.9, reveal: 0, shgc: SHGC_MAX, fillW: false, fillH: false });
export const UNIT_KEYS = ['winW', 'winH', 'sill', 'reveal', 'shgc', 'fillW', 'fillH'];
export const SYSTEM0 = () => ({ name: null, winBy: 'spacing', winN: 4, winSp: 3.0, wallT: 0.30, unit: null });
export const SYSTEM_KEYS = ['winBy', 'winN', 'winSp', 'wallT'];

/* A window wall and a curtain wall are punched openings that fill their bay
   glass to glass and their storey up to the slab; the window wall's glass is
   set back so the slab edge stands proud of it, the curtain wall's is flush. */
export const UNIT_PRESETS = {
  punched: { label: 'Punched opening', make: () => ({ name: 'Punched window', winW: 1.5, winH: 1.8, sill: 0.9, reveal: 0.10, shgc: SHGC_MAX }) },
  windowwall: { label: 'Window wall', make: () => ({ name: 'Window wall', sill: 0, reveal: 0.15, fillW: true, fillH: true, shgc: 0.33 }) },
  curtainwall: { label: 'Curtain wall', make: () => ({ name: 'Curtain wall', sill: 0, reveal: 0, fillW: true, fillH: true, shgc: 0.28 }) }
};
export const SYSTEM_PRESETS = {
  punched: { label: 'Punched windows', make: () => ({ name: 'Punched windows', winBy: 'spacing', winSp: 3.0, wallT: 0.30 }), unit: 'punched' },
  windowwall: { label: 'Window wall', make: () => ({ name: 'Window wall', winBy: 'spacing', winSp: 1.5, wallT: 0.30 }), unit: 'windowwall' },
  curtainwall: { label: 'Curtain wall', make: () => ({ name: 'Curtain wall', winBy: 'spacing', winSp: 1.5, wallT: 0.30 }), unit: 'curtainwall' }
};

export const lib0 = () => ({ seq: 0, units: {}, systems: {}, devices: {}, shading: {} });
const KINDS = { units: 'u', systems: 's', devices: 'd', shading: 'h' };
const fresh = (st, kind) => { if (!st.lib) st.lib = lib0(); return KINDS[kind] + (++st.lib.seq); };
const copyOf = o => JSON.parse(JSON.stringify(o));

/** a new entry of a kind, from the fields given; returns its id */
export function addEntry(st, kind, o) {
  const id = fresh(st, kind), base = kind === 'units' ? UNIT0() : kind === 'systems' ? SYSTEM0() : kind === 'devices' ? DEVICE0(o && o.dir) : { name: null, devices: [] };
  st.lib[kind][id] = Object.assign(base, copyOf(o || {}), { id });
  return id;
}
/** a copy of an entry, under a name of its own; a shading system copies its devices too, so the copy can be edited apart */
export function duplicateEntry(st, kind, id, name) {
  const src = st.lib[kind][id];
  if (!src) return null;
  const o = copyOf(src);
  delete o.saved;                                  // a copy is not in the library until it is saved itself
  if (kind === 'shading') o.devices = src.devices.map(d => duplicateEntry(st, 'devices', d, st.lib.devices[d] && st.lib.devices[d].name)).filter(Boolean);
  const nid = addEntry(st, kind, o);
  st.lib[kind][nid].name = name || nextName(st, kind, src.name || defaultName(kind, src));
  return nid;
}
export const defaultName = (kind, o) => kind === 'units' ? 'Glazing unit' : kind === 'systems' ? 'Window system' : kind === 'devices' ? (o && o.dir === 'v' ? 'Fin' : 'Blade') : 'Shading';
/** the name itself while it is free - a number it ends in is part of it - then "Name 2", "Name 3" ... */
export function nextName(st, kind, base) {
  const taken = new Set(Object.values(st.lib[kind]).map(o => o.name));
  if (!taken.has(String(base))) return String(base);
  const b = String(base).replace(/ \d+$/, '');
  if (!taken.has(b)) return b;
  for (let k = 2; ; k++) if (!taken.has(b + ' ' + k)) return b + ' ' + k;
}
export const entryName = (st, kind, id) => { const o = st.lib && st.lib[kind][id]; return o ? o.name || defaultName(kind, o) : '—'; };

/** a unit from a preset, or from scratch */
export const newUnit = (st, preset) => addEntry(st, 'units', UNIT_PRESETS[preset]
  ? Object.assign(UNIT_PRESETS[preset].make(), { name: nextName(st, 'units', UNIT_PRESETS[preset].make().name) })
  : { name: nextName(st, 'units', 'Glazing unit') });
/** a system from a preset - with its unit - or from scratch, with no unit yet */
export function newSystem(st, preset) {
  const p = SYSTEM_PRESETS[preset];
  if (!p) return addEntry(st, 'systems', { name: nextName(st, 'systems', 'Window system') });
  return addEntry(st, 'systems', Object.assign(p.make(), { name: nextName(st, 'systems', p.make().name), unit: newUnit(st, p.unit) }));
}

/* ---------- reading a side's reference back ---------- */
/** the glazing of a side's array - or of its window i, where that is broken
 *  out - as one flat record: the unit's glass and the system's layout, the
 *  window's own offset, and the shading's devices. Null without a unit. */
export function flatGlazing(st, ref, i) {
  // a flat record written straight into a side - as the test fixtures and older designs do - is read as it is
  if (ref && ref.sys === undefined) return ref.winW !== undefined || ref.type ? normGlazing(ref) : null;
  const L = st.lib, sys = ref && L && L.systems[ref.sys];
  if (!sys) return null;
  const b = i === undefined || i === null ? null : ref.broken && ref.broken[i];
  const bs = i === undefined || i === null ? null : ref.brokenShd && ref.brokenShd[i];
  const uid = b ? b.unit : sys.unit, unit = L.units[uid];
  if (!unit) return null;
  const sid = bs ? bs.shd : ref.shd, shd = sid ? L.shading[sid] : null;
  const g = { type: 'punched', name: unit.name || defaultName('units'), sysName: sys.name || defaultName('systems'), sysId: ref.sys, unitId: uid, shdId: sid || null };
  for (const k of UNIT_KEYS) g[k] = unit[k];
  for (const k of SYSTEM_KEYS) g[k] = sys[k];
  g.offU = b ? b.offU || 0 : 0;
  g.devices = shd ? shd.devices.map(id => L.devices[id]).filter(Boolean) : [];
  g.dev = ref.dev || 0;
  if (ref.broken) g.broken = ref.broken;
  if (ref.brokenShd) g.brokenShd = ref.brokenShd;
  return g;
}
/** how the units of a side are set out, even before its system has a unit */
export function layoutGlazing(st, ref) {
  if (ref && ref.sys === undefined) return flatGlazing(st, ref);
  const sys = ref && st.lib && st.lib.systems[ref.sys];
  if (!sys) return null;
  const unit = st.lib.units[sys.unit] || { winW: 0.3, fillW: false };
  return { type: 'punched', winBy: sys.winBy, winN: sys.winN, winSp: sys.winSp, winW: unit.winW, fillW: unit.fillW };
}

/* ---------- a flat glazing taken into the library ----------
   The test fixtures, the worked cases and older designs describe glazing as
   one flat record. Taken in, it becomes a system, its unit and a shading
   system of its devices; a window wall or curtain wall of the old kind
   becomes units that fill their bays, and its slab the storey's. */
export function adoptGlazing(st, g, name) {
  if (!st.lib) st.lib = lib0();
  const old = g.type && g.type !== 'punched', nm = name || g.name;
  const oldName = g.type === 'windowwall' ? 'Window wall' : 'Curtain wall';
  const unit = old
    ? { name: nm || oldName, sill: 0, reveal: g.type === 'windowwall' ? g.reveal || 0 : 0, shgc: g.shgc ?? 0.4, fillW: true, fillH: true }
    : Object.assign({ name: nm || 'Punched window' }, ...UNIT_KEYS.filter(k => k in g).map(k => ({ [k]: g[k] })));
  const sys = old
    ? { name: nm || oldName, winBy: g.modBy === 'number' ? 'number' : 'spacing', winN: g.modN || 20, winSp: g.module || 1.5, wallT: 0.30 }
    : Object.assign({ name: nm || 'Punched windows' }, ...SYSTEM_KEYS.filter(k => k in g).map(k => ({ [k]: g[k] })));
  sys.unit = addEntry(st, 'units', unit);
  const sysId = addEntry(st, 'systems', sys);
  const devs = (g.devices || []).map(D => addEntry(st, 'devices', D));
  const shd = devs.length ? addEntry(st, 'shading', { name: nm || 'Shading', devices: devs }) : null;
  return { ref: { sys: sysId, shd, dev: g.dev || 0 }, slab: old ? g.slabT : undefined };
}

/* ---------- what uses what ---------- */
/** how many sides and windows use each entry: { id: count } */
export function usage(st) {
  const n = {}, inc = id => { if (id) n[id] = (n[id] || 0) + 1; };
  const sysUsed = new Set(), shdUsed = new Set();
  for (const s of st.storeys) for (const ref of Object.values(s.cells)) {
    if (!ref) continue;
    inc(ref.sys); sysUsed.add(ref.sys);
    if (ref.shd) { inc(ref.shd); shdUsed.add(ref.shd); }
    for (const b of Object.values(ref.broken || {})) inc(b.unit);
    for (const b of Object.values(ref.brokenShd || {})) if (b.shd) { inc(b.shd); shdUsed.add(b.shd); }
  }
  for (const id of sysUsed) { const s = st.lib.systems[id]; if (s) inc(s.unit); }
  for (const id of shdUsed) { const h = st.lib.shading[id]; if (h) h.devices.forEach(inc); }
  return n;
}
