/* Setting members out along an axis.

   A shading device is a member and, optionally, an array of it. A member on
   its own is simply an array of one - of zero length - so both go through the
   same rule, and a louvre array and a fin array are the same object turned
   ninety degrees. `dir` is +1 when the array runs the way the axis does - fins
   from the left jamb rightward - and -1 when it runs against it, which is how
   blades are set out, from the head downward.

     align     where on the opening the array is anchored: its start, middle
               or end - unset, the justification's own end
     just      which end of the array stands on that point, so it runs on
               from there - the start, the middle or the end of the array
     len       how far the array runs from there; 0 is a single member
     ends      whether a pitch that does not divide evenly gets a last member
               on the far end or simply stops short

   Everything here is a pure function of the parameters and a span.          */

import { clamp } from '../util.js';

export const ARRAY_MAX = 200;             // a hard ceiling, so a typo cannot build a million boxes
export const PITCH_MIN = 0.02;

export function arrayAnchor(span, dir, len, just, align = just) {
  const [lo, hi] = span;
  const P = align === 'centre' ? (lo + hi) / 2 : align === 'end' ? (dir > 0 ? hi : lo) : (dir > 0 ? lo : hi);
  return P - dir * len * (just === 'centre' ? 0.5 : just === 'end' ? 1 : 0);
}

/** where the members sit along the axis. `A` is the array, or null for one
 *  member standing at the justification point. */
export function arrayPositions(A, span, dir, just, align = just) {
  const len = A ? Math.max(0, A.len) : 0;
  const start = arrayAnchor(span, dir, len, just, align);
  const ts = [];
  if (!A || len <= 1e-9) ts.push(0);
  else if (A.mode === 'count') {
    // a count divides the array exactly, first member on one end and last on
    // the other, so there is no remainder for an added end member to catch
    const n = clamp(Math.round(A.count) || 1, 1, ARRAY_MAX);
    // a lone member takes the justification, so it can sit at either end or the middle
    if (n === 1) ts.push(just === 'centre' ? len / 2 : just === 'end' ? len : 0);
    else { const q = len / (n - 1); for (let i = 0; i < n; i++) ts.push(i * q); }
  } else if (just === 'centre') {
    // centred means centred on the members, not merely on the length they are
    // given: an odd number puts one exactly on the centre of the span
    const q = Math.max(PITCH_MIN, A.spacing);
    const n = Math.floor(len / q + 1e-9) + 1, t0 = (len - (n - 1) * q) / 2;
    for (let i = 0; i < n && ts.length < ARRAY_MAX; i++) ts.push(t0 + i * q);
    if (A.ends && t0 > 1e-6) { ts.unshift(0); ts.push(len); }
  } else {
    const q = Math.max(PITCH_MIN, A.spacing);
    for (let t = 0; t <= len + 1e-9 && ts.length < ARRAY_MAX; t += q) ts.push(t);
    if (A.ends && (!ts.length || len - ts[ts.length - 1] > 1e-6)) ts.push(len);
  }
  return ts.map(t => start + dir * t);
}

/** the run of one member along its own length, as [centre, half-length].
 *  A length of 0 takes the opening's own dimension on that axis. */
export function memberSpan(len, span, dir, just, align = just) {
  const L = len > 0 ? len : span[1] - span[0];
  const a = arrayAnchor(span, dir, L, just, align);
  return [a + dir * L / 2, L / 2];
}

/** what the controls held back, so the page can say so rather than silently
 *  building something other than what was asked for */
export function arrayLimits(A) {
  const notes = [];
  if (!A || A.len <= 1e-9) return notes;
  if (A.mode === 'count' && Math.round(A.count) > ARRAY_MAX) notes.push('number of members held to ' + ARRAY_MAX);
  if (A.mode !== 'count' && A.spacing < PITCH_MIN) notes.push('spacing held to ' + PITCH_MIN * 1000 + ' mm');
  if (A.mode !== 'count' && A.len / Math.max(PITCH_MIN, A.spacing) + 1 > ARRAY_MAX) notes.push('array stopped at ' + ARRAY_MAX + ' members');
  return notes;
}
