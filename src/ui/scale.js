// @ts-check
// The scale bar's arithmetic: how long a bar to draw, and what to write under it.
//
// An atlas page says how big it is. This one can, exactly: the camera is orthographic, so
// a pixel across the screen is the same number of kilometres everywhere in the view, at
// any yaw, and tilting the view compresses only the screen's vertical axis. So the bar
// measures ground distance along the screen's horizontal and is true, not indicative --
// which is why it is worth drawing at all. No DOM here, so it can be tested.

/** 1, 2, 5, 10, 20, 50... the lengths a reader can halve and quarter in their head. */
const STEPS = [1, 2, 5];

/**
 * The longest nice round distance that fits in `maxPx`, and the pixels it occupies.
 * @param {number} kmPerPx  from camera-math's kmPerPixel
 * @param {number} maxPx    the most the bar may take up
 * @returns {{ km: number, px: number }}  km 0 when there is nothing sensible to draw
 */
export function scaleBar(kmPerPx, maxPx) {
  if (!(kmPerPx > 0) || !(maxPx > 0)) return { km: 0, px: 0 };
  const want = kmPerPx * maxPx;
  // Walk the decades down from the first one too big: the winner is the last that fits.
  const decade = Math.floor(Math.log10(want));
  let best = 0;
  for (let e = decade + 1; e >= decade - 1; e -= 1) {
    for (const s of STEPS) {
      const km = s * 10 ** e;
      if (km <= want && km > best) best = km;
    }
  }
  if (!best) return { km: 0, px: 0 };
  return { km: best, px: best / kmPerPx };
}
