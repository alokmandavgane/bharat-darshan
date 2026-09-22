// @ts-check
// The graticule (PLAN.md section 3, item 6): parallels and meridians scored into the table
// the model stands on.
//
// It is furniture, not a layer -- no items, no legend, no picking, no card -- so it is a
// few hairlines and nothing else. The lines arrive pre-projected from the pipeline
// (08_graticule.py), because the runtime has no projection code (D3), and they are drawn
// a hair above the paper: land stands kilometres higher than that, so the model hides its
// own lines and they show on the table around it. Meridians come out straight and
// parallels curved, which is what a Lambert conformal conic does and is the thing that
// makes a turned view legible.
import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments } from 'three';

export const GRATICULE = {
  y: 0.25,                 // km above the paper: clear of it, far under any land
  color: 0x8a7458,         // the ink of a printed grid, not a drawn line
  opacity: 0.32,
};

/**
 * @param {{ lines: { points: [number, number][] }[] }} data  from public/data/graticule.json
 */
export function createGraticule(data) {
  const xyz = [];
  for (const line of data.lines || []) {
    const p = line.points || [];
    // Segments rather than one strip per line: a single buffer draws the whole grid in
    // one call, and a grid has no ends worth joining.
    for (let i = 1; i < p.length; i += 1) {
      xyz.push(p[i - 1][0], GRATICULE.y, p[i - 1][1], p[i][0], GRATICULE.y, p[i][1]);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(xyz, 3));
  const material = new LineBasicMaterial({
    color: GRATICULE.color,
    transparent: true,
    opacity: GRATICULE.opacity,
    // Written the way the other overlays are (see lines.js): no depth of its own, drawn
    // after the terrain, and left to the depth *test* to place. That test is the whole
    // trick -- the lines sit a quarter of a km up, above the sea sheet and far below any
    // land, so the model hides its own lines and they show on the table around it.
    depthWrite: false,
  });
  const mesh = new LineSegments(geometry, material);
  mesh.frustumCulled = false;        // the grid is the size of the board; culling it by its
                                     // own box only ever gets it wrong at the edges
  // After the terrain, before the line layers (renderOrder 3). Drawing order is not the
  // same as ignoring depth: the Himalaya still occludes the grid, the terrain no longer
  // paints over it, and switching Surroundings on does not lose the grid under the sea.
  mesh.renderOrder = 1;
  return {
    mesh,
    segments: xyz.length / 6,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
