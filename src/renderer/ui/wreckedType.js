/**
 * Wrecked display type.
 *
 * The title and the death headline want the eroded, salt-eaten look of a
 * distressed display face. Rather than ship a font binary, the erosion is done
 * in CSS: an SVG turbulence mask eats holes out of whatever face is set, and a
 * second, coarser mask streaks it vertically the way water damage runs down a
 * painted sign.
 *
 * Doing it this way rather than with a real font has three advantages that
 * matter here:
 *
 *   - no asset to license, download or keep in the repo
 *   - it works in the packaged `file://` build, where anything fetched from a
 *     CDN silently fails
 *   - the erosion is independent of the glyphs, so it composes with the
 *     existing UI-colour gradient wash instead of replacing it
 *
 * The masks are inline data URIs, so there is nothing to load at all.
 */

/**
 * An SVG turbulence field as a data URI, for use as a CSS mask.
 *
 * `feColorMatrix` on the alpha channel turns the noise into a hard-ish
 * threshold — a soft mask just fades the text evenly, which reads as low
 * opacity rather than as erosion. The slope/intercept pair is what decides how
 * much of the letter survives.
 *
 * @param {object} o
 * @param {number} o.frequency base turbulence frequency; higher is finer pitting
 * @param {number} o.octaves detail levels
 * @param {number} o.slope alpha contrast — higher bites harder
 * @param {number} o.intercept alpha offset — higher keeps more of the letter
 * @param {number} o.seed so two masks on the same element do not line up
 */
function turbulenceMask({ frequency, octaves, slope, intercept, seed = 1, stretch = 1 }) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">` +
    `<filter id="e" x="0" y="0" width="100%" height="100%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${frequency} ${frequency * stretch}" ` +
    `numOctaves="${octaves}" seed="${seed}" result="n"/>` +
    `<feColorMatrix in="n" type="matrix" values="` +
    `0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  ${slope} 0 0 0 ${intercept}"/>` +
    `</filter>` +
    `<rect width="240" height="240" filter="url(#e)"/>` +
    `</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/** Fine pitting — salt and rust eating into the face of the letters. */
const PITTING = turbulenceMask({ frequency: 0.62, octaves: 4, slope: 3.4, intercept: 0.42, seed: 7 })
/** Coarse vertical streaking — water running down the sign. */
const STREAKING = turbulenceMask({
  frequency: 0.035,
  octaves: 3,
  slope: 2.2,
  intercept: 0.62,
  seed: 19,
  stretch: 16
})
/** Heavier bite — closer to the painted title wordmark’s scorched metal. */
const PITTING_HEAVY = turbulenceMask({ frequency: 0.55, octaves: 5, slope: 4.2, intercept: 0.28, seed: 11 })
const STREAKING_HEAVY = turbulenceMask({
  frequency: 0.028,
  octaves: 4,
  slope: 2.8,
  intercept: 0.48,
  seed: 23,
  stretch: 18
})

/**
 * CSS for the wrecked treatment, scoped under whatever selector you pass.
 *
 * Applied to the element itself rather than a pseudo-element so it composes
 * with a `background-clip: text` gradient already on the element.
 *
 * @param {string} selector
 * @param {{ heavy?: boolean }} [opts] heavy = deeper pitting for death / title-like weight
 */
export function wreckedTypeCSS(selector, opts = {}) {
  const pitting = opts.heavy ? PITTING_HEAVY : PITTING
  const streaking = opts.heavy ? STREAKING_HEAVY : STREAKING
  return `
${selector} {
  /* Condensed and heavy: a display face reads as *display* mostly through
     weight and tight tracking, and that part does not need a font file. */
  font-family: "Impact", "Haettenschweiler", "Arial Narrow Bold", "Helvetica Neue", sans-serif;
  font-weight: 900;
  -webkit-mask-image: ${pitting}, ${streaking};
  mask-image: ${pitting}, ${streaking};
  -webkit-mask-composite: source-in;
  mask-composite: intersect;
  -webkit-mask-size: 240px 240px, 300px 900px;
  mask-size: 240px 240px, 300px 900px;
  /* Drift the erosion slowly so it never looks like a static texture pasted
     over the words — it should feel like the sign is still corroding. */
  animation: wreckDrift 34s linear infinite;
}
@keyframes wreckDrift {
  from { -webkit-mask-position: 0 0, 0 0; mask-position: 0 0, 0 0; }
  to   { -webkit-mask-position: 240px 120px, 0 900px; mask-position: 240px 120px, 0 900px; }
}
/* Anyone who has asked for less motion gets the erosion without the crawl. */
@media (prefers-reduced-motion: reduce) {
  ${selector} { animation: none; }
}
`
}
