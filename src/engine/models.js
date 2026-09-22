// @ts-check
// Figurines from recipes (PLAN.md section 5, `model` markers). A recipe is a few
// primitives -- sphere, cylinder, cone, box, torus, a lathe profile, an extruded outline
// -- each placed, turned, scaled and coloured, and this turns one into a single
// flat-shaded geometry with a colour per vertex. Nothing is fetched but the recipe
// itself, a few hundred bytes; the mesh is made here, once per kind of thing.
//
// Units: 1 unit is one screen pixel at the marker's base scale, y up, the thing standing
// on y = 0. A part marked `tint: true` takes the item's colour instead of its own, so one
// saree serves four silks.
import { BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Euler, ExtrudeGeometry,
  LatheGeometry, Matrix4, Quaternion, Shape, SphereGeometry, TorusGeometry, Vector2, Vector3 } from 'three';

const DEG = Math.PI / 180;

/** The primitive a part asks for, in its own frame. */
function primitive(part) {
  const seg = part.segments;
  switch (part.shape) {
    case 'sphere': return new SphereGeometry(part.r, seg || 10, Math.max(4, Math.round((seg || 10) * 0.7)));
    case 'cylinder': return new CylinderGeometry(part.rt, part.rb, part.h, seg || 10);
    case 'cone': return new ConeGeometry(part.r, part.h, seg || 10);
    case 'box': return new BoxGeometry(part.w, part.h, part.d);
    case 'torus': return new TorusGeometry(part.r, part.tube, 6, seg || 14);
    case 'lathe': return new LatheGeometry(part.profile.map(([x, y]) => new Vector2(x, y)), seg || 12);
    case 'extrude': {
      const shape = new Shape(part.outline.map(([x, y]) => new Vector2(x, y)));
      const g = new ExtrudeGeometry(shape, { depth: part.depth, bevelEnabled: false });
      g.translate(0, 0, -part.depth / 2);            // centred on its own plane
      return g;
    }
    default: throw new Error(`unknown shape ${part.shape}`);
  }
}

/**
 * Build a recipe into one geometry: `position`, `normal` (flat, per face), `color`
 * (the part's own) and `tint` (1 where the item's colour replaces it).
 *
 * A `lathe` profile runs bottom to top: three.js winds the surface in the order of the
 * points, so a profile written downwards faces inward and the part disappears behind
 * whatever is inside it. `test/models.test.js` checks every recipe for this.
 * @param {{ id: string, footprint?: number, parts: any[] }} recipe
 * @returns {{ geometry: BufferGeometry, footprint: number, height: number }}
 */
export function buildModel(recipe) {
  const chunks = [];
  let verts = 0;
  for (const part of recipe.parts) {
    const g0 = primitive(part);
    const g = g0.index ? g0.toNonIndexed() : g0;    // no shared vertices: every face is flat
    // Turn (y) after tilt (x) after roll (z): a petal is leaned outward and then fanned
    // round, which is the order a hand would do it in.
    const rot = part.rot || [0, 0, 0];
    const m = new Matrix4().compose(
      new Vector3(...(part.at || [0, 0, 0])),
      new Quaternion().setFromEuler(new Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'YXZ')),
      new Vector3(...(part.scale || [1, 1, 1])),
    );
    g.applyMatrix4(m);
    const n = g.getAttribute('position').count;
    const c = new Color(part.color);
    const colour = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { colour[i * 3] = c.r; colour[i * 3 + 1] = c.g; colour[i * 3 + 2] = c.b; }
    const tint = new Float32Array(n).fill(part.tint ? 1 : 0);
    chunks.push({ pos: g.getAttribute('position').array, colour, tint, n });
    verts += n;
    g.dispose();
  }
  const position = new Float32Array(verts * 3);
  const color = new Float32Array(verts * 3);
  const tint = new Float32Array(verts);
  let at = 0;
  for (const ch of chunks) {
    position.set(ch.pos, at * 3);
    color.set(ch.colour, at * 3);
    tint.set(ch.tint, at);
    at += ch.n;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('color', new BufferAttribute(color, 3));
  geometry.setAttribute('tint', new BufferAttribute(tint, 1));
  geometry.computeVertexNormals();                 // unshared vertices, so these are face normals
  geometry.computeBoundingBox();
  const height = geometry.boundingBox ? geometry.boundingBox.max.y : 20;
  return { geometry, footprint: recipe.footprint || 1, height };
}

/** The bead a `dot` layer draws: a low-poly sphere of radius 1, standing on the ground. */
export function beadGeometry() {
  return buildModel({ id: 'bead', footprint: 1.15, parts: [{ shape: 'sphere', r: 1, at: [0, 1, 0], color: '#ffffff', tint: true, segments: 10 }] });
}

/**
 * The counter a `symbols` layer draws: a low clay disc of radius 1 lying on the ground,
 * splayed a little at the base as clay pressed down would be. It is read by its area, so
 * it carries no glyph and its shape is self-similar -- twice the radius is twice the rim
 * and four times the face, which is what keeps one counter comparable with the next.
 */
export function coinGeometry() {
  // A dome rather than a flat top: a cylinder's face and its rim meet the wrapped light
  // at nearly the same angle, so a flat counter reads as a blot. Across a shallow dome
  // the light falls away from the key side, which is what makes it read as a thing.
  return buildModel({ id: 'coin', footprint: 1.42, parts: [
    // The pale collar a cartographer draws round a proportional circle, so that two
    // counters which overlap still read as two.
    { shape: 'cylinder', rt: 1.14, rb: 1.14, h: 0.12, at: [0, 0.06, 0], color: '#f4ecdc', segments: 22 },
    // Bottom to top: a lathe is wound in the order of its profile, and one written from
    // the top down turns the surface inside out.
    { shape: 'lathe', profile: [[1, 0.1], [1, 0.2], [0.82, 0.31], [0.5, 0.35], [0, 0.36]],
      color: '#ffffff', tint: true, segments: 22 },
  ] });
}

/** Where a peg's head is, so the glyph decal can sit on it (model units). */
export const PEG = { headY: 8.6, headR: 5 };

/**
 * The clay token a place is marked with: a pale post and a head in the category's
 * colour, the glyph going on the head as a decal (marks.js). Ten units across the head,
 * so a size of 2.6 is the 26 px token close up.
 */
export function pegGeometry() {
  return buildModel({ id: 'peg', footprint: 4.6, parts: [
    { shape: 'cylinder', rt: 1.0, rb: 1.7, h: 5, at: [0, 2.5, 0], color: '#e6dbc6', segments: 10 },
    { shape: 'sphere', r: PEG.headR, at: [0, PEG.headY, 0], color: '#ffffff', tint: true, segments: 16 },
  ] });
}
