// @ts-check
// Episodes: a story page shown one chapter at a time. A tour's stops come in groups --
// the categories its layers share (childhood, the dice, the forest, the war) -- and a
// long story with every group drawn at once is a tangle of pins and arrows. With an
// episode chosen, a page's layers draw that group alone, plus the pins its arrows set
// out from and land on, so an arrow never starts in empty air.
// Pure functions: the engine feeds them the layer files it has loaded.

/**
 * The page's episodes in story order: the order their groups first come up along the
 * tour. Empty when the page has no tour, or when one of its layers has a group the tour
 * never visits -- an episode made only of arrows could never be stepped to, so such a
 * page keeps drawing everything at once.
 * @param {{ tour?: { stops: string[] } } | null} plate
 * @param {{ id: string, category?: string }[]} tourItems  the tour layer's items
 * @param {{ id: string }[][]} layerCategories  each of the page's layers' categories
 * @returns {string[]}
 */
export function episodeList(plate, tourItems, layerCategories) {
  if (!plate?.tour?.stops?.length) return [];
  const cat = new Map(tourItems.map((i) => [i.id, i.category]));
  const out = [];
  for (const id of plate.tour.stops) {
    const c = cat.get(id);
    if (c && !out.includes(c)) out.push(c);
  }
  const every = new Set(layerCategories.flat().map((c) => c.id));
  for (const c of every) if (!out.includes(c)) return [];
  return out.length > 1 ? out : [];
}

/**
 * The pins shown beside an episode's own: one at each place its arrows start or end
 * that the episode has no pin of its own for. Where several stops share the spot (a
 * capital visited again and again), the latest visit before this episode is the one
 * shown, or failing that the next after it -- so tapping it steps back in the story.
 * @param {number[][]} ends  [x, z] of every arrow end in the episode
 * @param {{ layer: string, item: { id: string, x: number, z: number, category?: string } }[]} candidates
 *   pins of the page's layers that are not in the episode
 * @param {Map<string, number>} tourIndex  a stop's place in the tour
 * @param {string[]} order  the episodes in story order
 * @param {string} cat  the episode shown
 * @param {{ ownPins?: number[][], km?: number }} [opts]
 * @returns {Set<string>}  `layer:id` of each pin to show
 */
export function contextStops(ends, candidates, tourIndex, order, cat, { ownPins = [], km = 3 } = {}) {
  const near = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 <= km * km;
  const here = order.indexOf(cat);
  // How good a stand-in each candidate is: earlier visits first, latest of them first;
  // then later ones, soonest first; a pin the tour never visits last of all.
  const rank = (c) => {
    const e = order.indexOf(c.item.category || '');
    const t = tourIndex.get(c.item.id) ?? Infinity;
    return e >= 0 && e <= here ? [0, -t] : [1, t];
  };
  const better = (a, b) => {
    const ra = rank(a), rb = rank(b);
    return ra[0] !== rb[0] ? ra[0] < rb[0] : ra[1] < rb[1];
  };
  const out = new Set();
  for (const end of ends) {
    if (ownPins.some((p) => near(p, end))) continue;
    let best = null;
    for (const c of candidates) {
      if (near([c.item.x, c.item.z], end) && (!best || better(c, best))) best = c;
    }
    if (best) out.add(`${best.layer}:${best.item.id}`);
  }
  return out;
}

/**
 * The next episode from `at` (null: everything at once), `by` steps along; stepping off
 * either end wraps round, and from everything at once it goes to the first or the last.
 * @param {string[]} order
 * @param {string | null} at
 * @param {number} by
 */
export function stepEpisode(order, at, by) {
  if (!order.length) return null;
  const i = at === null ? -1 : order.indexOf(at);
  if (i < 0) return by > 0 ? order[0] : order[order.length - 1];
  return order[(i + by + order.length) % order.length];
}

/**
 * A pin's part in the episode on show: null when no episode touches its layer, 'own'
 * for one of the episode's stops, 'context' for a pin an arrow of it needs, 'out'
 * for the rest, which are not drawn.
 * @param {{ cat: string, layers: Set<string>, context: Set<string> } | null} episode
 * @param {string} layer
 * @param {{ id: string, category?: string }} item
 */
export function episodeRole(episode, layer, item) {
  if (!episode || !episode.layers.has(layer)) return null;
  if (item.category === episode.cat) return 'own';
  return episode.context.has(`${layer}:${item.id}`) ? 'context' : 'out';
}
