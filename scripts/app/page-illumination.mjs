/* Page illumination — the sigil behind the Review frontispiece.
 *
 * Review is the one leaf that is a frontispiece rather than a working page: it
 * presents a finished character instead of offering choices, so it has room for
 * a figure behind its content. It gets a sigil drawn from the character's own
 * name, which means the same character always sits on the same figure.
 *
 * This module started out bleeding the compendium's artwork behind every pick
 * step's head, chosen on an availability rule. That is gone. In practice the
 * item images are emblems (classes) or alpha cutouts (species) rather than the
 * scenes the design assumed — an emblem bled behind a title reads as a
 * watermark, and a cutout floats rather than bleeds because it has no ground in
 * it to fade out. Neither survived cropping and scrimming. The heads are also
 * compact now, which leaves no room behind them for a figure regardless.
 *
 * What is left is deliberately narrow: one sigil, on one leaf, with nothing
 * competing with it.
 */

/**
 * Turn a name into a stable set of sigil parameters, so the same character
 * always draws the same figure and two rarely share one.
 * @param {string} name
 * @returns {{points: number, skip: number, rings: number}}
 */
function sigilSpec(name) {
  let h = 0;
  for ( let i = 0; i < name.length; i++ ) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return {
    points: 5 + (h % 5),                 // 5..9
    skip: 2 + (Math.floor(h / 5) % 2),   // 2..3, always under points/2 for that range
    rings: 2 + (Math.floor(h / 11) % 3)  // 2..4
  };
}

/**
 * Draw the sigil. Static by design — an ambient rotation would pull the eye
 * away from the character sheet it sits behind.
 * @param {HTMLCanvasElement} cv
 */
function drawSigil(cv) {
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if ( !w || !h ) return;

  const { points, skip, rings } = sigilSpec(cv.dataset.seed ?? "");
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);

  const g = cv.getContext("2d");
  if ( !g ) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  // Read the palette rather than hard-coding it. These strokes were still being drawn in
  // the violet and gold the creator used before the colour system was made semantic, which
  // no amount of looking at the stylesheet would have revealed. Taking the tokens from the
  // live element means the figure follows the palette from now on. `globalAlpha` carries
  // the weighting so the token can stay a plain hex value.
  const styles = getComputedStyle(cv);
  const brass = styles.getPropertyValue("--cc-settled").trim() || "#c9a227";
  const teal = styles.getPropertyValue("--cc-open").trim() || "#4fb3a8";

  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * 0.46;

  // Concentric rings — brass outermost, teal within.
  for ( let r = 0; r < rings; r++ ) {
    g.beginPath();
    g.arc(cx, cy, R * (1 - r * 0.17), 0, Math.PI * 2);
    g.strokeStyle = r === 0 ? brass : teal;
    g.globalAlpha = r === 0 ? 0.45 : 0.26;
    g.lineWidth = r === 0 ? 1.25 : 1;
    g.stroke();
  }

  // Tick marks around the outer ring, longer every fourth.
  const ticks = points * 8;
  g.strokeStyle = brass;
  g.globalAlpha = 0.34;
  g.lineWidth = 1;
  for ( let t = 0; t < ticks; t++ ) {
    const a = (t / ticks) * Math.PI * 2 - Math.PI / 2;
    const inner = R * 1.02;
    const outer = R * (t % 4 === 0 ? 1.09 : 1.05);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    g.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
    g.stroke();
  }

  // The star polygon {points/skip}.
  const pr = R * (1 - (rings - 1) * 0.17);
  g.beginPath();
  for ( let i = 0; i <= points; i++ ) {
    const ang = (((i * skip) % points) / points) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(ang) * pr;
    const y = cy + Math.sin(ang) * pr;
    if ( i === 0 ) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.strokeStyle = brass;
  g.globalAlpha = 0.38;
  g.lineWidth = 1.15;
  g.stroke();

  // Radial spokes out to the vertices.
  g.strokeStyle = teal;
  g.globalAlpha = 0.2;
  for ( let p = 0; p < points; p++ ) {
    const pa = (p / points) * Math.PI * 2 - Math.PI / 2;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(pa) * R, cy + Math.sin(pa) * R);
    g.stroke();
  }
  g.globalAlpha = 1;
}

/**
 * Put the sigil behind the Review portrait. Safe to call on every render: it
 * clears the previous pass first, so repeated renders never stack figures.
 *
 * Draws nothing in an Ember world. The sigil works because it is the only figure
 * on the leaf — the note at the top of this file is the whole design. Ember's
 * ground already carries one: its fullscreen view lays the weathered cosmos
 * design behind everything, which is a large concentric figure in the same
 * place, at the same weight, doing the same job. Two of them do not read as a
 * frontispiece and a background, they read as a collision.
 *
 * Suppressed here rather than hidden from ember-skin.css so the canvas is never
 * built or painted: a `display: none` would leave us drawing a figure nobody
 * sees on every Review render, and would hide the fault if this stopped working.
 * @param {HTMLElement} root  The application's root element.
 */
export function illuminatePages(root) {
  if ( root.classList.contains("sogrom-ember") ) return;
  for ( const frame of root.querySelectorAll(".creator-review-portrait") ) {
    for ( const old of frame.querySelectorAll(".creator-page-sigil") ) old.remove();

    const cv = document.createElement("canvas");
    cv.className = "creator-page-sigil";
    // Seed from the character's name where there is one, so the figure is
    // theirs; the portrait's alt/src is a poor seed and changes with the image.
    cv.dataset.seed = root.querySelector("[name='name']")?.value?.trim()
      || frame.closest(".creator-review")?.querySelector("h2")?.textContent?.trim()
      || "";
    cv.setAttribute("aria-hidden", "true");
    frame.prepend(cv);
    // Lay out first, then measure: the canvas has no size until it is in flow.
    requestAnimationFrame(() => drawSigil(cv));
  }
}

/**
 * Draw the frame-tier sigil on every `.creator-sigil` canvas under `root`.
 *
 * The entry screens' third art tier. Where the threshold's cards and the chooser's paths find no
 * artwork in any installed book, they fall back to a gradient and this figure, seeded from the
 * option's own identifier — so an art-free card is still distinctly *that* option rather than an
 * empty plate, and a world with no premium content still gets a designed screen rather than a
 * degraded one.
 *
 * Distinct from {@link illuminatePages} in two ways that matter. It is not suppressed in an Ember
 * world: the note that justifies that suppression is about the Review frontispiece competing with
 * Ember's own large concentric ground, and these are small plates in a grid, not a frontispiece.
 * And the canvas is authored in the template rather than created here, because these are laid out
 * in flow by CSS while Review's is prepended to a frame it must exactly cover.
 * @param {HTMLElement} root  The application's root element.
 */
export function drawFrameSigils(root) {
  for ( const cv of root.querySelectorAll("canvas.creator-sigil") ) {
    // Lay out first, then measure: a canvas has no size until it is in flow.
    requestAnimationFrame(() => drawSigil(cv));
  }
}

/**
 * How much of a plate's width an image must natively cover before it is allowed to fill it.
 *
 * Below this it is enlarged rather than shown at size, and enlarging past about 1.7x is where a
 * 256px emblem starts to look like a 256px emblem someone stretched. Measured against what content
 * actually ships: dnd5e species icons are 256, its class icons and the Player's Handbook's are 512,
 * and PHB subject paintings are 512–1024. So the large illustrations bleed and the small emblems
 * do not, which is the distinction that matters and the one a fixed pixel threshold would miss on
 * a wide window.
 */
const FILL_RATIO = 0.58;

/**
 * Decide, per image, whether a card's art can fill its plate or should sit on it.
 *
 * The three art tiers assume a banner is a scene and an icon is an emblem, and mostly that holds.
 * But "icon" is really just "the item's own image", and plenty of content — homebrew species
 * especially — ships a full illustration there. Shown at emblem size that looks like a small
 * picture in a big empty box, which is what this fixes.
 *
 * It cannot be answered in CSS, because it depends on the file's natural size, which is not known
 * until it loads. So: measure on load, and mark the plate. An image big enough for the space gets
 * `object-fit: cover` and bleeds like a banner; one that is not keeps its contained size over a
 * blurred copy of itself, so the square is filled either way and nothing is ever stretched.
 *
 * This is not a reversal of the note at the top of this file. That finding is about bleeding an
 * emblem *behind a page heading*, where it reads as a watermark. These are art plates whose whole
 * job is to carry a picture, and an illustration that fills one is doing what it is there for.
 * @param {HTMLElement} root  The application's root element.
 */
export function fitCardArt(root) {
  for ( const img of root.querySelectorAll(".creator-threshold-art.is-icon > img") ) {
    const plate = img.parentElement;
    // The blurred ground, from the element's own resolved src rather than from the template: an
    // HTML-escaped attribute would turn an apostrophe in the path into `&#x27;` and break the
    // url(). Quotes and backslashes are escaped for the same reason, one layer down.
    const src = img.getAttribute("src") ?? "";
    if ( src ) plate.style.setProperty("--cc-art", `url("${src.replace(/["\\]/g, "\\$&")}")`);
    const decide = () => {
      // A plate with no width yet (a hidden or not-yet-laid-out card) tells us nothing; leaving it
      // contained is the safe answer, and the next render will ask again.
      const width = plate.clientWidth;
      if ( !width || !img.naturalWidth ) return;
      plate.classList.toggle("is-full", img.naturalWidth >= width * FILL_RATIO);
    };
    if ( img.complete ) requestAnimationFrame(decide);
    else img.addEventListener("load", decide, { once: true });
  }
}
