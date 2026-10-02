/* The figures at the selected instant. */

import { D2R, fmt, hhmm } from '../util.js';
import { sunriseSunsetSolar, solarToClock } from '../solar.js';
import { deviceLabel } from '../geometry/device.js';
import { GLAZING_TYPES, glazingLabel } from '../geometry/cell.js';
import { analysisTarget, facadeWWR } from '../geometry/building.js';
import { systemPitch, fracT, fracW } from '../geometry/analysis.js';

export function stackLabel(F) {
  if (!F.m.live || !F.m.live.length) return 'none';
  return F.m.live.map(({ D, boxes }) => {
    const q = systemPitch(boxes);
    return deviceLabel(D).toLowerCase() + ' ' + fmt(D.depth * 1000, 0) + (isFinite(q) ? ' @ ' + fmt(q * 1000, 0) : '');
  }).join(' + ');
}

export function renderReadout(F, host, noteHost) {
  const { S, m, cur, res, sel, B, light } = F;
  const has = !!m.opening, A = has ? m.winW * m.winH : 0;
  const g = sel.row.glz, D = g && g.devices.length ? g.devices[Math.min(g.dev, g.devices.length - 1)] : null;
  const mine = D ? (m.live.find(x => x.D === D) || { boxes: [] }).boxes : [];
  const pitch = systemPitch(mine);
  const ss = sunriseSunsetSolar(cur.doy);
  const sr = ss ? solarToClock(ss[0], cur.doy, S.timeMode) : null, sset = ss ? solarToClock(ss[1], cur.doy, S.timeMode) : null;
  const tm = t => t === null ? '—' : hhmm(t);
  const proj = D ? D.depth * Math.cos(D.angle * D2R) : NaN;
  const projV = D && cur.onFacade ? proj * Math.tan(cur.vsa * D2R) : NaN;
  const projH = D && cur.onFacade ? proj * Math.abs(Math.tan(cur.gamma * D2R)) : NaN;
  const dash = '—', mm = x => fmt(x * 1000, 0) + ' mm', pc = x => x === null ? dash : fmt(x * 100, 1) + '%';
  const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  // the same instant over the storey and the whole side, a little more coarsely
  const scopeFrac = sc => {
    const T = analysisTarget(B, sel, sc);
    if (!T.items.length) return null;
    const nu = light ? 11 : 21, nv = light ? 9 : 17;
    return { f: T.multi ? (cur.up ? fracW(T, cur.alt, cur.az, nu, nv) : 1) : cur.onFacade ? fracT(T, cur.sl, nu, nv) : 1, T };
  };
  const st = has ? scopeFrac('storey') : null, fa = scopeFrac('facade'), wr = facadeWWR(B, sel.f);
  // round the corner the sums are over every side; glass the sun is behind is glass in shade
  const lv = light ? null : scopeFrac('level'), bd = light ? null : scopeFrac('building');
  host.innerHTML = `
  <dl><h4>Sun</h4>
    ${row('Solar altitude β', fmt(cur.alt, 2) + '°')}
    ${row('Solar azimuth γ<sub>s</sub>', fmt(cur.az, 2) + '°')}
    ${row('Declination δ', fmt(cur.dec, 2) + '°')}
    ${row('Equation of time', fmt(cur.eot, 1) + ' min')}
    ${row('Apparent solar time', tm(cur.solarTime))}
    ${row('Sunrise – sunset', tm(sr) + ' – ' + tm(sset))}
  </dl>
  <dl><h4>Facade and sun · ${sel.f} side</h4>
    ${row('Facade azimuth γ<sub>f</sub>', fmt(cur.gf, 1) + '°')}
    ${row('Surface solar azimuth γ', fmt(cur.gamma, 2) + '°')}
    ${row('Angle of incidence θ', cur.up ? fmt(cur.inc, 2) + '°' : dash)}
    ${row('Vertical profile angle Ω', cur.onFacade ? fmt(cur.vsa, 2) + '°' : dash)}
    ${row('Horizontal profile angle', cur.onFacade ? fmt(cur.hsa, 2) + '°' : dash)}
    ${row('cos θ (beam on facade)', cur.up ? fmt(Math.max(0, cur.cosInc), 3) : dash)}
  </dl>
  <dl><h4>Shading${D ? ' · ' + deviceLabel(D) + ' (' + (g.dev + 1) + ' of ' + g.devices.length + ')' : ''}</h4>
    ${row('Devices on this condition', stackLabel(F))}
    ${row('Effective projection of this device', D ? mm(proj) : dash)}
    ${row('Vertical drop d·tanΩ', isFinite(projV) ? mm(projV) : dash)}
    ${row('Lateral throw d·|tanγ|', isFinite(projH) ? mm(projH) : dash)}
    ${row('Members in this device', D ? String(mine.length) : dash)}
    ${row('Pitch as built', isFinite(pitch) ? mm(pitch) : dash)}
    ${row('Free area between members', isFinite(pitch) && D ? mm(Math.max(0, pitch - D.thick)) : dash)}
    ${row('Neighbours’ members counted', has ? String(m.ctx.length) : dash)}
  </dl>
  <dl><h4>Glazing · ${sel.f} storey ${sel.st + 1}${has ? ' · unit ' + (sel.unit + 1) + ' of ' + sel.row.units.length : ''}</h4>
    ${row('System', has ? (g.sysName ? g.sysName + ' · ' : '') + glazingLabel(g) : 'none')}
    ${row('Unit glazing area', has ? fmt(A, 3) + ' m²' : dash)}
    ${row('Shaded area of this unit', has ? fmt(A * res.frac, 3) + ' m²' : dash)}
    <dt>This unit shaded</dt><dd class="big">${has ? pc(res.frac) : dash}</dd>
    ${row('This storey shaded, this side', st ? pc(st.f) + ' · ' + st.T.units + ' units' : dash)}
    ${row('This side shaded, every storey', fa ? pc(fa.f) + ' · ' + fa.T.units + ' units' : dash)}
    ${row('This storey shaded, all sides', lv ? pc(lv.f) + ' · ' + lv.T.units + ' units' : light ? '…' : dash)}
    ${row('Whole building shaded', bd ? pc(bd.f) + ' · ' + bd.T.units + ' units' : light ? '…' : dash)}
    ${row('Set back from the face', has ? mm(m.reveal) : dash)}
    ${row('The reveal alone shades it all', has && m.reveal > 0.001
      ? 'above Ω ' + fmt(Math.atan2(m.winH, m.reveal) / D2R, 1) + '°' + (m.type === 'punched' ? ', beyond HSA ' + fmt(Math.atan2(m.winW, m.reveal) / D2R, 1) + '°' : '')
      : has ? 'flush glazing — no reveal' : dash)}
    ${row('Window-to-wall ratio, ' + sel.f + ' side', fmt(wr.ratio * 100, 1) + ' %')}
  </dl>`;

  // what the controls held back, and anything the numbers need read with
  const notes = [];
  if (!has) notes.push(`There is no glazing on storey ${sel.st + 1} of the ${sel.f} side. Add a glazing system in the panel, or click a window in the building view.`);
  else if (!cur.up) notes.push('The sun is below the horizon at this time. Everything reported as shaded is simply unlit.');
  else if (!cur.onFacade) notes.push(`The sun is up but behind the facade plane (γ = ${fmt(cur.gamma, 1)}°, |γ| &gt; 90°). No direct beam can reach this glazing regardless of the device, so the 100% figure describes orientation, not the device.`);
  else if (!m.elements.length) notes.push(m.reveal > 0.001
    ? 'No device is applied. The shaded fraction is the reveal alone.'
    : 'No device is applied and the glazing is flush, so nothing shades it but the facade plane.');
  (m.notes || []).forEach(n => notes.push(n));
  noteHost.innerHTML = notes.map(n => `<div class="nosun">${n}</div>`).join('');
}
