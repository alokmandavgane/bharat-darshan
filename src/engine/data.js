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
  const [heights, shade, ids, borders] = await Promise.all(
    [t.heights, t.shade, t.ids, t.borders].map((rel) => loadPack(versioned(manifest, rel))));
  return { tier, heights, shade, ids, borders };
}

export async function loadStates(manifest) {
  return loadJson(manifest.regions.states);
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
