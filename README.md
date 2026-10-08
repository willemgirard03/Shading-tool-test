# Vancouver Solar Shading Explorer — v8

**Use it online:** <https://willemgirard03.github.io/Shading-tool-test/>

A teaching tool for solar geometry and shading design. A student shapes a
shading device and sees, at once:

1. **Where the sun is** — the composition of angles at the site (altitude β,
   solar azimuth from due south, surface azimuth, γ) and the vertical sun path
   chart, with a dot for every daylit hour of the weather file.
2. **What the shading cuts off** — section and plan drawn the way shading is sized by hand,
   with the profile angle θ, Ph = h / tan θ, and the fin relations
   SW = Pd · tan γ and Pd = w / tan ζ, worked through with live numbers, and
   when the glass is in shade across the year. Both draw the whole storey,
   centred on the selected window, and zoom and pan; the plan carries the sun
   on the floor, at an instant or summed over the day or the year.
3. **Where the sun lands inside** — the whole storey in a 3D view that orbits
   the selected window all the way round, with the beam through that window
   ghosted to where it lands.
4. **How much solar heat comes in** — direct solar gain through the glass:
   DNI × cos i × sunlit glass × SHGC, now, over the day and over the year, for
   a unit, a storey, a side or the building, on a clear day, the weather
   file's average day, or the day as recorded.

It counts only the direct beam — the part shading geometry controls. It is a
reference for what the rest of the design has to handle, not a daylighting tool
or an energy model. The Vancouver by-law panel, the method and the sources sit
in one collapsed section at the bottom of the page.

## Running it

| | |
|---|---|
| **Hand it in / share it** | `dist/solar-shading.html` — one file, opens straight from disk. |
| **Work on it** | `npm install`, then `npm run serve` (or `serve.cmd`) and open <http://127.0.0.1:8774>. |
| **Test it** | `npm test` |
| **Rebuild the single file** | `npm run build` — writes `dist/solar-shading.html` and `docs/index.html` |
| **Publish** | `npm test`, `npm run build`, then commit and push: GitHub Pages serves `docs/index.html` |

## Weather

`weather/` holds the two NRC future-shifted typical years for Vancouver Intl A
(+1.0 °C and +2.0 °C warming), each 8,760 hourly records. `node tools/hourly.mjs`
packs their direct normal irradiance and dry-bulb temperature into
`src/data/hourly.js`, which drives the weather dots, the recorded-day sky and
every yearly total. `src/data/climate.js` keeps the monthly means for the
average-day sky and the climate panel. Another EPW can be packed the same way.

## What changed from v6

**Storeys one at a time.** A menu shows the working storey; ▾ ▴ step through
the building, and a storey can be moved up or down a level or copied above or
below, as sheets are. Each storey has its own floorplate. With *Match floors
above* on, a change to the floorplate is made to every storey above too; off,
the storey is unique and can be bigger or smaller than its neighbours. A storey
that stands out past the one below overhangs it, and its mass shades that
storey's glass - tested against the hand result Ph = P tan θ. Glazing and
shading have the same switch: on, the storeys above take this side's glazing
and shading as it is edited.

**The window drawings take in the whole storey.** The plan and the section are
cut through the whole floor - the section runs to the facade opposite - and
frame the window, the sun's reach or the whole floor, with wheel zoom about the
window and drag to pan. The interior plan is folded into the plan. The 3D view
models the whole storey, orbits the middle of the selected window, follows the
sun through that window only, and ghosts any other side that stands between
the eye and the room.

**The page: settings on top, drawings, then results.** A *Calculation
settings* bar stays at the top of the page as it scrolls: the weather file,
*Results for* (the selected window, this floor on this side, the whole floor,
this side on every floor, the whole building), the sky, and *Time settings ›*,
which opens the date, time, clock and play. The drawings follow in three rows,
then the chart of when the glass is in shade across the year, then every
result. *Results for* also sets which windows light the plan's floor - the
selected one, every window of its side, or every window of the storey - at an
instant and over the day or the year. Each drawing has one *Re-center view*,
and can be minimised to its bar or opened full screen (Esc to leave).

**Working in the drawings.** The plan and the section zoom out without limit.
The section's cut can be dragged across the window in the plan, and the plan's
cut up and down the storey in the section. Every view's bar gives the sun's
altitude and azimuth, and the cuts it shows, as figures that take a typed value
on a click; a typed angle finds the date and time with the other angle held. The
3D view shows the sun through every window the results are for - lit glass,
patches, ghosted beams - selects a window when its glass is clicked, and has a
sun handle on the end of its ray. Lengths are dimensioned with ticks; arrowheads
are kept for rays and directions.

**Views: any number, anywhere.** The drawings are views of five kinds - the
site and its sun, the sun path chart, the section, the plan, the storey in 3D -
and any kind can be on the page more than once, each with its own camera. A
view's bar has a menu to turn it into another kind, a ⠿ grip to move it (to a
row's top or bottom edge for a row of its own, to a view's side to sit beside
it, onto a view to swap), a – to take it off the page (the rest of its row
closes up), and full screen. The margins between the views are white; drag one
between two views to share the row's width differently, or one between two
rows to make the row above taller or shorter (double-click to let it size
itself). Every margin shows a + at its middle on hover, which adds a view of
any kind there. Each view is drawn on a sheet the shape of its space. The
arrangement is kept in the browser; *Reset layout* puts it back. What each view
shows is behind the *i* in its bar. The panel at the side and the calculation
settings along the top each tuck away. The typology templates are a menu,
starting at *Blank block*. Long explanations are tooltips on the names and
buttons they explain (dotted underline), not text in the panel.

**Views that stay put.** Each view's bar stays on screen, under the
calculation settings, until its drawing has scrolled past. Full screen fills
the drawing area only - the panel and the calculation settings stay - and
redraws the sheet at that shape, so its frame runs edge to edge. Figures drawn
in the views (β, the solar azimuth, γ, θ, the cuts) open a box to type into
when clicked; the names of the figures in a view's bar can be dragged left or
right to slide the value (Shift for fine steps). Choosing another window - in
the 3D view or anywhere - brings its light, its patches and the plan's day and
year maps up to date at once.

**Offsets, and the layout kept across a toggle.** A storey can be offset from
the building's axis east-west and north-south, so it overhangs on one side and
steps in on the other; *Match floors above* carries its height, floorplate and
offset up the building, and takes effect the moment it is turned on (so does
matching glazing). A punched window broken from its array can be moved along
its bay, as far as its bay allows. Switching windows, modules or a shading array
between spacing and number carries the layout across: number to spacing is
exact; spacing to number is exact for a shading array (its length is closed up
to its last member) and for windows whose spacing divides the side, and
otherwise spreads the same count evenly along the side.

**Sun handles in the section and the plan.** Drag the knob on the sun ray: in
section it turns the profile angle with the solar azimuth held, in plan it
swings the azimuth with the altitude held, and the date and time move to where
the sun stands that way - the nearest the sun actually reaches, on the side of
the year already set.

**Windows broken from their array.** Any unit can be broken from its array,
its window and its shading each on their own: broken in its window it takes its
own size, glass and offset; broken in its shading, its own devices - and the
part left bound still follows every edit to the array, so a window can carry a
different device while the array's window is still being worked on. It keeps its
place, remembers the array, and its neighbours see what it has. Bound back, it either takes the array's
settings again or gives the array its own - and then the other broken windows
are bound back too or kept broken. The system, the layout and the wall stay the
array's.

## What changed from v5

**The page is four steps.** Four numbered steps replace the old grid of
drawings and tables. The panel starts with the weather file and the building —
a typology to start from (blank block, glazed office tower in curtain wall,
glazed residential tower in window wall, the same tower with 1.8 m balconies,
mid-rise glazed, mid-rise punched over a storefront base, townhouse row,
two-storey house), the floorplate and the storeys — then the sun, the window
and the shading, with copying and export in closed groups. Typologies carry no
shading except the balconies. Shading starts from a preset (vertical fins,
canopy, louvred canopy, horizontal louvres, egg-crate, balcony) or is built a
member at a time.

**Large buildings.** A unit is analysed with every neighbour within reach, so
a tall building with deep balconies has hundreds of distinct units. Past 24,
ray samples are shared out by glass area — the big run of identical units
keeps the full grid, edge units take coarser ones set off by different
phases — and the settled studies run one per turn so the page stays live.

The test suite keeps a worked overhang (20° east of south, early August,
10:00 solar: β 49.5°, γ 27.5°, θ 52.9°, Ph = 1.13 m, shading the window
completely) and four worked cases as fixtures; they are no longer offered
on the page.

**Conventions.** Azimuths are measured from due south, east
negative; γ = surface azimuth − solar azimuth; θ is the profile angle; i is the
angle of incidence. The facade is set by the direction it faces, in those terms.

**Direct solar gain** (`energy.js`). The beam is the ASHRAE clear-sky model
(A·exp(−B / sin β), coefficients for the 21st of each month), the weather file's
average day, or its recorded day; each glazing system has an SHGC. Gains are
summed over units, and a year over all 8,760 hours at the sun's true position.

**The interior** (`geometry/room.js`). Floors are open plan: the beam runs on
until it meets the floor or the building's outside walls, and the drawings show
as much of the storey as the sun reaches on the date. An interior point is sunlit when a ray from it toward the sun
gets out through the opening, so the interior is traced back with the same ray
test; the patches drawn are the lit glass carried along the beam onto each
surface. What enters the glass lands on the floor, the walls or the inside of
the reveal, and the tests hold it to that.

**The drawings.** The building view draws β, the solar azimuth, the surface
azimuth, γ and θ together at the foot of the selected facade, with a close-up
camera for them. The sun chart carries temperature dots. The window view
includes the room, orbits 360° with the nearest walls dropping away, and has
outside, inside and above presets. The interior plan is new.

## Layout

```
src/
  main.js              the page: four steps, their drawings and calculations
  energy.js            the beam (clear or typical) and direct solar gain
  state.js view.js frame.js studies.js solar.js util.js
  geometry/            cells, devices, arrays, the building, the storey, the room, the ray test, BSP
  draw/                sun chart, building view, section, plan (with the floor), the window in its storey, charts
  ui/                  the panel, the worked calculations, the prose, dragging and picking
  export/rhino.js      .3dm from the same model
test/verify.mjs        147 checks
```

## What the tests prove

Everything v5's suite proved — the golden master against v4, closed-form array,
hinge, reveal and tiling checks, the BSP order, every drawing for every scope,
the Rhino file, the state and undo — and, new:

- the worked overhang example reproduced, and the overhang sized to it
  shading the whole window at that instant;
- the hourly weather condensing to the monthly means, and a year of gain being
  its 8,760 hours summed;
- the ASHRAE clear-sky beam against its coefficients, and the weather file's
  mean hour read back;
- direct gain summed over units, and the entering-gain formula;
- the beam through the glass accounted for inside, three ways, to within 3 %;
- the drawn floor patch and the traced floor carrying the same energy;
- storeys moved and copied as sheets, floorplates and glazing matched up the
  building or made unique, and an overhanging storey shading the one below as
  an overhang of that depth would;
- a broken window taking its own size and shading, its neighbours seeing
  them, and binding back either way, with the other broken windows kept or
  bound back.

## Known limits

Direct beam only; SHGC constant with angle; floors open plan; devices on
other sides do not shade a unit, and of the block itself only a storey
overhanging the one below does. The by-law panel is
carried over from v5 unchanged and still awaits the VBBL extracts in `Sources/`.
