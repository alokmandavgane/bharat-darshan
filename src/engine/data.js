// @ts-check
// Fetches manifest.json and the raster packs of one tier. Nothing here knows three.js.
import { loadPack } from './pack.js';

export const DATA_BASE = '/data/';

export async function loadJson(path) {
  const res = await fetch(DATA_BASE + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

export async function loadManifest() {
  return loadJson('manifest.json');
}

function versioned(manifest, rel) {
  const f = manifest.files?.[rel];
  return DATA_BASE + rel + (f ? `?v=${f.sha256}` : '');
}

/**
 * @param {any} manifest
 * @param {string} tier  key of manifest.tiers, e.g. '1024'
 */
export async function loadTier(manifest, tier) {
  const t = manifest.tiers[tier];
  if (!t) throw new Error(`no tier ${tier} in manifest`);
  const [heights, shade, ids, borders, edge] = await Promise.all(
    [t.heights, t.shade, t.ids, t.borders, t.edge].map((rel) => (rel ? loadPack(versioned(manifest, rel)) : null)));
  return { tier, heights, shade, ids, borders, edge };
}

/** The wide backdrop, fetched the first time Surroundings is switched on. */
export async function loadWorld(manifest) {
  const w = manifest.world;
  if (!w) return null;
  const [heights, shade] = await Promise.all([w.heights, w.shade].map((rel) => loadPack(versioned(manifest, rel))));
  return { heights, shade };
}

export async function loadStates(manifest) {
  return loadJson(manifest.regions.states);
}

/** The state-package index, or null when the build did not make any. */
export async function loadStateIndex(manifest) {
  return manifest.states ? loadJson(manifest.states.replace(DATA_BASE, '')) : null;
}

/**
 * One unit's hi-res rasters (PLAN.md D3). Four packs covering the unit's padded bbox
 * at about 0.35 km per pixel, against roughly 1.7 km for the country tier.
 * @param {any} manifest
 * @param {any} entry  the unit's row from the state index
 * @param {AbortSignal} [signal]
 */
export async function loadStatePackage(manifest, entry, signal) {
  const [heights, shade, ids, edge] = await Promise.all(
    [entry.heights, entry.shade, entry.ids, entry.edge]
      .map((rel) => loadPack(versioned(manifest, rel), signal)));
  return { heights, shade, ids, edge, rect: entry.rect };
}

/** Bounding box of every unit together, in scene km: [x0, z0, x1, z1]. */
export function unionBbox(units) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const u of units) {
    b[0] = Math.min(b[0], u.bbox[0]); b[1] = Math.min(b[1], u.bbox[1]);
    b[2] = Math.max(b[2], u.bbox[2]); b[3] = Math.max(b[3], u.bbox[3]);
  }
  return b;
}
