/* The code checks, the climate context, and the prose around them. Every
   statement carries one of three provenance marks - read from a document in
   Sources, cited from one not yet there, or not established - and nothing is
   asserted from general knowledge. */

import { D2R, fmt } from '../util.js';
import { facadeWWR } from '../geometry/building.js';
import { SHGC_MAX } from './calc.js';
import { deviceLabel } from '../geometry/device.js';
import { CLIMATE } from '../data/climate.js';

export const PROV = {
  file: ['file', 'read from a document in Sources'],
  ext: ['cited', 'cited from a document not yet in Sources'],
  none: ['none', 'not established by the documents in Sources']
};
export const provTag = p => `<span class="prov"><span class="mk ${PROV[p][0]}"></span>${PROV[p][1]}</span>`;

export function ruleRow(r) {
  return `<details class="rule"><summary>
      <span class="name">${r.name}</span>
      <span class="cite">${r.cite || ''}</span>
      <span class="verdict ${r.cls}">${r.verdict}</span>
    </summary>
    <div class="why">${r.why}${r.quote ? `<q>${r.quote}</q>` : ''}<span class="tag">Provenance &mdash; ${PROV[r.prov][1]}.</span></div>
  </details>`;
}


/* ---------- the code checks ----------
   Read from the two VBBL extracts in Sources: Book I, Division B, Part 1
   Section 1.8 (pp. 966-970) for a solar shading device encroaching in a
   street, and Part 10 (pp. 830-859) for the glazing. Each row says what was
   checked, on what, and the clause. */
export function renderChecks(F) {
  const { S, B, m } = F, R = [];
  // the glass of every unit built, by name
  const units = new Map();
  for (const fc of Object.values(B.facades)) for (const r of fc.rows) for (const q of r.units) {
    const g = q.cell.glz, k = (g.name || 'Glazing') + '|' + (g.shgc ?? 0.4);
    if (!units.has(k)) units.set(k, { name: g.name || 'Glazing', shgc: g.shgc ?? 0.4 });
  }
  const over = [...units.values()].filter(u => u.shgc > SHGC_MAX + 1e-9);
  R.push({ name: 'Vertical glazing SHGC', cite: 'VBBL 10.2.2.3.(1)(e) · p. 834', prov: 'file',
    verdict: !units.size ? 'No glazing' : over.length ? over.length + ' over 0.36' : 'All ≤ 0.36', cls: !units.size ? 'v-na' : over.length ? 'v-no' : 'v-ok',
    why: `On the NECB path, vertical glazing has an assembly maximum SHGC of 0.36. The SHGC control stops at 0.36. ${over.length ? 'Over it, drawn red in the 3D views: ' + over.map(u => u.name + ' (' + fmt(u.shgc, 2) + ')').join(', ') + '.' : units.size ? 'Every glazing unit in the building is at or under it.' : ''} The ASHRAE 90.1 path (10.2.2.2) sets its limits in the standard, which is not in Sources.`,
    quote: 'e) a vertical glazing Solar Heat Gain Coefficient which does not exceed an assembly maximum of 0.36' });
  let wall = 0, glass = 0;
  for (const f of Object.keys(B.facades)) { const w = facadeWWR(B, f); wall += w.wall; glass += w.glass; }
  const wwr = wall > 0 ? glass / wall : 0;
  R.push({ name: 'Window-to-wall ratio', cite: 'VBBL 10.2.2.3.(1)(d) · p. 833', prov: 'file',
    verdict: fmt(wwr * 100, 0) + '%' + (wwr > 0.4 ? ' - reference held at 40%' : ''), cls: 'v-info',
    why: `Glazed area over gross wall area, every side and storey: ${fmt(glass, 0)} m² of ${fmt(wall, 0)} m². On the NECB path the reference building takes the proposed building's ratio up to a maximum of 40%; above it, the reference stays at 40% and the extra glass has to be made up elsewhere in the energy model.` });
  R.push({ name: 'Climate zone', cite: 'VBBL 10.2.2.2.(2)(b), 10.2.2.3.(1)(a) · pp. 832-833', prov: 'file', verdict: 'Zone 4', cls: 'v-ok',
    why: 'Both the ASHRAE 90.1 and NECB paths are to be designed with a climate zone of 4.' });

  // every device on the building, against the site, and the selected window's in detail
  const C = F.checks, mine = (C && C.map.get(F.sel.f + '|' + F.sel.st + '|' + F.sel.unit)) || [], na = !C || !C.past;
  R.push({ name: 'Shading devices against the site', cite: 'VBBL 1.8.9.3 · pp. 969-970', prov: 'file',
    verdict: !C || !C.devices ? 'No devices' : C.bad ? C.bad + ' of ' + C.devices + ' not compliant' : C.past ? 'All compliant' : 'All within the property lines',
    cls: !C || !C.devices ? 'v-na' : C.bad ? 'v-no' : 'v-ok',
    why: !C || !C.devices ? 'There is no shading device on the building.' : `Every device on every window, read against its side's boundary under Site Parameters: ${C.past} of ${C.devices} reach past the property line. Past an adjoining property line a device is not allowed at all; into a street or lane it may project as far as its height above the street and the street's width allow, keeping its outer edge 600 mm from the curb. Devices that are not compliant are drawn red in the 3D views. Street level is taken at the ground floor.`,
    quote: 'the maximum projection of a solar shading device into a street which is at least 10 m wide, shall be a) 500 mm for a solar shading device located between 2.75 and 5.2m above the street, b) 915 mm for a solar shading device located between 5.2m and 7.62m above the street, and c) 1370 mm for a solar shading device located more than 7.62m above the street' });
  R.push({ name: 'The selected window’s devices', cite: 'VBBL 1.8.9.3.(1)-(4) · pp. 969-970', prov: 'file',
    verdict: !mine.length ? 'No device' : mine.some(x => !x.ok) ? mine.filter(x => !x.ok).length + ' not compliant' : 'Compliant', cls: !mine.length ? 'v-na' : mine.some(x => !x.ok) ? 'v-no' : 'v-ok',
    why: mine.length ? mine.map(x => deviceLabel(x.D) + ': reaches ' + fmt(x.reach * 1000, 0) + ' mm off the wall, lowest point ' + fmt(x.low, 2) + ' m up - ' + (x.beyond > 1e-3 ? x.why : 'stays ' + fmt(-x.beyond * 1000, 0) + ' mm inside the property line')).join('. ') + '.' : 'The selected window has no shading device.' });
  const thin = C && C.devices ? Math.min(...[...C.map.values()].flat().map(x => x.D ? x.D.thick : 1)) : 0;
  [['Distance from an adjoining property line', 'VBBL 1.8.9.3.(5)-(6) · p. 970', 'v-need', 'Needs input',
    'Where a device projects into a street, at least 600 mm from an adjoining property line or its production into the street, unless entirely noncombustible; next to a lane, 600 mm from the production of the property line whatever it is made of. Neighbouring lots along the street are not yet modelled.'],
  ['Materials', 'VBBL 1.8.9.2 · p. 969', 'v-info', 'Thinnest member ' + fmt(thin * 1000, 1) + ' mm',
    'Noncombustible, except on a building or wall of combustible construction; supported entirely by the building; glass wired or laminated safety glass; metal at least 0.56 mm thick; wood plank at least 60 mm, sheathed top and soffit. Noncombustible wherever the exposing wall face must be (Division B, 3.2.3.7). The tool records each member\'s thickness but not its material.'],
  ['Not spanning unprotected openings', 'VBBL 1.8.9.4 · p. 970', 'v-need', 'Not modelled', 'A solar shading device shall not span unprotected openings in separate fire compartments. Fire compartments are not modelled.'],
  ['Structural design', 'VBBL 1.8.9.5 · p. 970', 'v-info', 'Design requirement', 'Designed to support the expected loads due to weather, withstand seismic design loads, and shed snow and ice so as to minimize risk to persons and property below.']
  ].forEach(([name, cite, cls, verdict, why]) => R.push({ name, cite, prov: 'file', verdict: na && cls !== 'v-need' ? 'Not applicable' : verdict, cls: na && cls !== 'v-need' ? 'v-na' : cls, why }));
  // balconies used as shading are part of the envelope's thermal bridging
  const balc = [...units.values()].length && Object.values(B.facades).some(fc => fc.rows.some(r => r.cell && r.cell.glz.devices.some(D => /balcon/i.test(D.name || ''))));
  if (balc) R.push({ name: 'Balconies and exposed slab edges', cite: 'VBBL 10.2.2.6, 10.2.1.1.(5) · pp. 830, 837', prov: 'file', verdict: 'RSI ≥ 0.42', cls: 'v-info',
    why: 'Balconies are unconditioned space, outside the envelope. For buildings under 10.2.1.4 (residential, 1 to 3 storeys), concrete balconies, eyebrows and exposed slab edges need an effective RSI of at least 0.42, wrapped or thermally broken - a balcony slab that shades is also a thermal bridge.' });
  R.push({ name: 'Projection into a required yard', cite: 'Zoning and Development By-law', prov: 'none', verdict: 'Not established', cls: 'v-need',
    why: 'Yard projections sit in the Zoning and Development By-law and the City\'s shading-devices bulletin, neither of which is in Sources.' });
  return R.map(ruleRow).join('');
}

export function renderEnergy(S) {
  const C = CLIMATE[S.wx], C1 = CLIMATE.gw10, C2 = CLIMATE.gw20, M = CLIMATE.meta;
  const R = [];
  R.push({
    name: 'Weather file for Section 10.2 energy modelling', cite: 'VBBL 10.2.2.5.(2) · p. 835', prov: 'none',
    verdict: 'Set by the modelling guidelines', cls: 'v-need',
    why: 'Part 10 leaves energy modelling to Part 8 of the NECB and the City of Vancouver Energy Modelling Guidelines. The guidelines, which name the weather file, are not in Sources, so the tool does not say which file is required. The NRC GW1.0 typical year is the default here.'
  });
  R.push({
    name: 'GW1.0 file identity and content', cite: M.files.gw10, prov: 'file',
    verdict: 'Loaded', cls: 'v-ok',
    why: `Weather files/${M.files.gw10}. Header: ${M.station}, ${M.prov}, ${M.country}; source tag ${M.source}; WMO ${M.wmo}; ${M.lat}\u00B0N ${Math.abs(M.lon)}\u00B0W; time zone UTC${M.tz}; elevation ${M.elev} m; 8760 hourly records; standard time throughout (the header sets daylight saving to none).
      Derived from the file: mean dry bulb ${C1.tmean} \u00B0C, extremes ${C1.tmin} to ${C1.tmax} \u00B0C, HDD18 ${C1.hdd18}, CDD18 ${C1.cdd18}, annual global horizontal ${C1.ghiAnnual} kWh/m\u00B2, direct normal ${C1.dniAnnual} kWh/m\u00B2, diffuse horizontal ${C1.dhiAnnual} kWh/m\u00B2.`
  });
  R.push({
    name: 'Weather file for overheating analysis', cite: 'Energy Modelling Guidelines', prov: 'none',
    verdict: 'Not established', cls: 'v-need',
    why: 'No overheating criterion, threshold or weather file is given in the Part 10 extract. The GW2.0 file is offered for comparison; no overheating limit is applied.'
  });
  R.push({
    name: 'GW2.0 warm-season signal', cite: M.files.gw20, prov: 'file',
    verdict: C2.hrs26 + ' h above 26 \u00B0C', cls: 'v-info',
    why: `Counted from Weather files/${M.files.gw20}: ${C2.hrs26} hours above 26 \u00B0C and ${C2.hrs28} above 28 \u00B0C, peak ${C2.tmax} \u00B0C, mean ${C2.tmean} \u00B0C, CDD18 ${C2.cdd18}. The GW1.0 file over the same year gives ${C1.hrs26} hours above 26 \u00B0C and a ${C1.tmax} \u00B0C peak, so the two scenarios differ enough that a shading study tuned to GW1.0 should be re-checked against GW2.0. Thresholds shown are conventional reference points chosen by this tool, not criteria taken from any supplied document.`
  });
  R.push({
    name: 'Fenestration U-values', cite: 'VBBL 10.2.2.7, Table 10.2.2.7.(1) · p. 838', prov: 'file',
    verdict: 'Not modelled', cls: 'v-na',
    why: 'For buildings under 10.2.1.4 (residential, 1 to 3 storeys): windows, curtain wall and window wall at most USI 1.44 W/m²K on the performance path and 1.22 on the prescriptive path; storefront 2.27. The tool models solar gain, not conduction, so U-values are not checked.'
  });
  R.push({
    name: 'Converting geometric shading into an effective SHGC or g<sub>tot</sub>', cite: 'ISO 52022-3:2017', prov: 'ext',
    verdict: 'Not performed', cls: 'v-na',
    why: `Nothing in Sources authorises turning an avoided-radiation percentage into a code SHGC, so the tool does not do it. The standard also makes clear why the substitution would be wrong on its own terms. ISO 52022-3 Table 4 builds g<sub>tot</sub> as the sum of four parts: direct solar transmittance, a thermal-radiation factor, a convection factor and a ventilation factor. Only the first is geometric. Clause 6.3.1 requires spectral transmittance, spectral reflectance of both faces, thermal transmittance and both emissivities for every layer, none of which this tool holds. Clause 6.4.6 fixes the boundary conditions at which any g<sub>tot</sub> must be quoted \u2014 reference 5 \u00B0C outside, 20 \u00B0C inside, 300 W/m\u00B2; summer 25 \u00B0C both sides, 500 W/m\u00B2.`
  });
  R.push({
    name: 'Scope of ISO 52022-3 against this geometry', cite: 'ISO 52022-3:2017, Scope and Annex D', prov: 'ext',
    verdict: 'Partly outside', cls: 'v-info',
    why: `Worth knowing before importing louvre optical data into an energy model. The standard's scope covers devices parallel to the glazing, treats radiation as normally incident with no angular dependence, and is limited to vertical installation within \u00B115\u00B0. Annex D, which derives equivalent optical properties for louvres and venetian blinds, assumes the slats are adjusted so that direct beam transmission is eliminated and that the material reflects and transmits diffusely. This tool computes exactly the case Annex D assumes away: the angular geometry of direct beam getting past, or being caught by, the blades. Annex D.6 also recommends mixing direct and diffuse transmittance as \u03C4 = 0,85 \u03C4<sub>D</sub> + 0,15 \u03C4<sub>d</sub>, and notes that for louvres the diffuse transmittance can exceed the direct.`
  });
  R.push({
    name: 'Whole-building energy compliance', cite: '\u2014', prov: 'none',
    verdict: 'Out of scope', cls: 'v-na',
    why: 'This is a geometry tool. It has no thermal zones, no loads, no systems and no annual simulation. A shaded-percentage figure from these drawings is an input to an energy model, never a substitute for one.'
  });
  return R.map(ruleRow).join('');
}


export function staticProse() {
  const out = {};
  out.energyIntro = `
  <div class="callout">
    <h3>Context, not compliance</h3>
    <p>The weather files are read directly, so anything derived from them can be checked. Part 10 leaves the modelling itself - and the weather file it uses - to the NECB and the City's Energy Modelling Guidelines.</p>
  </div>`;

  out.method = `
  <div class="cols2">
    <div>
      <h3>What this tool is for</h3>
      <p>It is for learning how shading geometry works. Change a shading device and every drawing, every angle and every number follows at once, so the relation between a device's geometry, the profile angle it cuts off, where the sun lands inside and how much solar heat comes in can be felt rather than calculated. It is quicker to read than a Climate Consultant chart and much simpler than Climate Studio or Ladybug, and it counts only the direct beam - the part shading geometry controls.</p>

      <h3>The angles</h3>
      <div class="eq">solar altitude        β   the sun's height above the horizon
solar azimuth             the sun's direction from due south (east negative)
surface azimuth           the facade normal's direction from due south
surface solar azimuth γ = surface azimuth − solar azimuth
profile angle         θ = tan⁻¹(tan β / cos γ)
angle of incidence    i :  cos i = cos β · cos γ</div>
      <p>Compass bearings from north are shown alongside, since many sun-path charts label due south 180°.</p>
      <h3>Three clocks</h3>
      <p><b>PST</b>, Pacific Standard Time, is the zone's clock, UTC−8, set for the meridian at 120°W. <b>PDT</b> is the summer clock, an hour ahead. <b>Solar time</b> is the sun's own: 12:00 is the moment it crosses due south. Vancouver lies 3.2° west of its zone meridian, so the sun reaches south about 13 minutes after 12:00 PST - and a further 16 minutes early to 14 minutes late through the year, because the Earth's orbit is elliptical and its axis tilted (the equation of time). On the sun chart the dashed hour lines show this: at a fixed clock hour the sun traces a figure-eight through the year, the analemma, while at a fixed solar hour it only moves up and down, so the figure-eight collapses to a simple curve. Solar time is the natural clock for geometry; clock time is the one a building's occupants live by. The worked example is set in solar time - early August, 10:00 solar, a window 20° east of south - giving β 49.5°, γ 27.5°, θ 52.9° and Ph = 1.5 m / tan θ = 1.13 m.</p>

      <h3>Sizing, the hand method</h3>
      <div class="eq">horizontal element   Ph = h / tan θ     shades a window of height h
louvres              θc = tan⁻¹(pitch / depth)
vertical element     SW = Pd · tan |γ|  shadow across the glass
                     Pd = w / tan ζ     shades a width w beyond ζ</div>
      <p>The worked calculations under steps 1 and 2 put the live numbers into these, and the section and plan draw them. They are the hand method's idealisation: an overhang flush on the head, running on for ever, infinitely thin.</p>

      <h3>What is really computed</h3>
      <p>Every blade and fin is an oriented box with its real depth, thickness, tilt, length and standoff. The glass is sampled on a grid; from each point a ray runs toward the sun and is tested against every box and against the reveal of the opening. The share of rays that get out is the sunlit share of the glass. This is what colours the drawings and the sun chart, and it carries what the hand method leaves out: the leak past a standoff at the head, the sun round the end of a finite overhang, the thickness of a blade. Units along a facade are analysed with their neighbours' devices; storeys, sides and the whole building are sums over units.</p>
      <p>The sun chart is Climate Consultant's vertical chart: solar bearing across, altitude up. The shading drawn on it is the ray test repeated over the sky; the dashed line is the profile-angle cut-off a protractor gives, the solid line the cut-off the device as built achieves. The dots are the weather file's hours, every daylit one, each placed where the sun stood at that hour and coloured by the dry-bulb temperature recorded then, in Climate Consultant's three bands - below 20 °C, 20–27 °C, above 27 °C: sun is wanted over the cool dots and not over the warm ones. The sun crosses the same sky twice a year, rising toward June and falling toward December, so by default only the half of the year the selected date lies in is plotted.</p>
    </div>
    <div>
      <h3>Direct solar gain</h3>
      <div class="eq">beam on the glass   q = DNI × cos i            W/m²
entering            q × sunlit glass area × SHGC   W</div>
      <p>DNI is the direct normal irradiance. On a <b>clear day</b> it is the ASHRAE clear-sky beam, DNI = A·exp(−B / sin β), with A and B for the 21st of each month interpolated between - the peak a sunny day brings, the figure to size cooling or interior shading against. On an <b>average day</b> it is the weather file's mean beam for that month and hour, clouds included - a smooth typical day. On a <b>recorded day</b> it is the file's own hour, as recorded: one real day, sunny or overcast. Over a year both weather skies are summed hour by hour, all 8,760 of them, at the sun's true position each hour. The SHGC is the glass's solar heat gain coefficient, the share of the beam striking it that ends up as heat inside, taken as constant with angle. The unshaded figure is the same glass with no devices and no reveal.</p>
      <p>Only the direct beam is counted. Diffuse sky and reflected light, conduction, thermal mass and people are not: this is a reference for what the rest of the design - insulation, glazing, cooling, interior blinds - has to deal with, not an energy model or a daylight simulation.</p>

      <h3>Inside the room</h3>
      <p>Every storey is open plan, its own floorplate, with no partitions or columns: the beam through a window runs on until it meets the floor or the building's outside walls. A point inside is sunlit when a ray from it toward the sun gets out through the opening: past the inside of the wall, through the glass, past the reveal and the devices. Over the day or the year the plan traces this from a grid on the floor at every step; at an instant, the patches in the plan and the 3D view are the lit part of the glass carried along the beam onto each surface. The irradiance on the floor is DNI × SHGC × sin β, and on a wall parallel to the facade DNI × SHGC × cos i. The energy landing on the floor, the walls and the inside of the reveal adds up to the energy through the glass.</p>

      <h3>What is not modelled</h3>
      <ul>
        <li>Diffuse and reflected radiation; light bouncing between blades or off the floor.</li>
        <li>Any optical property of the devices: every one is opaque and non-reflecting.</li>
        <li>Frames, mullion caps and interior blinds.</li>
        <li>Shading by the block itself, by devices on the other sides, by neighbours, terrain or trees.</li>
        <li>How the SHGC changes with the angle of incidence: one SHGC is used at every angle, though real glass passes noticeably less once the sun is more than about 50–60° off its normal, so the gain at grazing sun is somewhat overstated.</li>
        <li>Anything thermal beyond the solar gain itself.</li>
      </ul>
      <p>Solar position uses Cooper's declination and a Spencer-type equation of time at 49.19°N 123.18°W, good to about a tenth of a degree.</p>
    </div>
  </div>
`;

  out.sources = `
  <table class="notestab">
    <tr><th style="width:150px">Mark</th><th>Meaning</th></tr>
    <tr><td>${provTag('file')}</td><td>Read from a document in the Sources folder, cited by clause and page.</td></tr>
    <tr><td>${provTag('ext')}</td><td>Cited from a document that is to be added to Sources.</td></tr>
    <tr><td>${provTag('none')}</td><td>Not established by the documents in Sources; no figure is asserted.</td></tr>
  </table>
  <table class="notestab" style="margin-top:18px">
    <tr><th style="width:230px">Document</th><th style="width:120px">In Sources</th><th>Used for</th></tr>
    <tr><td class="n">Vancouver Building By-law, Book I, Division B, Part 1, Sections 1.8.6-1.8.11 (pp. 966-970)<br><span class="mono">VBBL Shading.pdf</span></td><td>Yes</td>
      <td>Solar shading devices in a street (1.8.9): definition, materials, projection limits by height and street width, curb and property-line clearances, unprotected openings, structure. Canopies (1.8.8), awnings (1.8.7) and ornamental projections (1.8.6) for comparison.</td></tr>
    <tr><td class="n">Vancouver Building By-law, Part 10, Energy and Water Efficiency (pp. 830-859)<br><span class="mono">VBBL Energy and Water Efficiency.pdf</span></td><td>Yes</td>
      <td>Vertical glazing SHGC ≤ 0.36 and the 40% window-to-wall cap of the NECB reference building (10.2.2.3); climate zone 4; fenestration U-values (10.2.2.7); balconies and exposed slab edges (10.2.1.1, 10.2.2.6).</td></tr>
    <tr><td class="n">NRC future-shifted typical year, Vancouver, GW1.0 and GW2.0<br><span class="mono">Weather files/weatherfile-fsstat-typical-year-gw*.epw</span></td><td>Yes</td>
      <td>The two weather files offered: the beam for the average and recorded days and every yearly total, the temperature of the sun chart's dots, site coordinates and time zone.</td></tr>
    <tr><td class="n">Morphed CWEC 2020, Vancouver Int'l, SSP1-2.6 / 2-4.5 / 5-8.5, 2040s-2080s<br><span class="mono">Weather files/MORPHED_SSP*.epw</span></td><td>Yes</td>
      <td>Not yet offered in the tool.</td></tr>
    <tr><td class="n">Reference drawings: 3D view, section, fin cut-off plan, shadow angles, shading devices<br><span class="mono">3D.png, Section.webp, Plan-view-…webp, The-shadow-angles-…webp, shading-devices.jpg</span></td><td>Yes</td>
      <td>Conventions for the drawings, which are drawn from the model.</td></tr>
    <tr><td class="n">BS EN ISO 52022-3:2017</td><td>To be added</td><td>Why geometric shading is not converted to an effective SHGC or g<sub>tot</sub>; the standard's scope against louvre geometry.</td></tr>
    <tr><td class="n">Zoning and Development By-law; shading-devices bulletin; City of Vancouver Energy Modelling Guidelines</td><td>No</td><td>Nothing: yard projections and the modelling weather file are not established.</td></tr>
  </table>`;
  return out;
}
