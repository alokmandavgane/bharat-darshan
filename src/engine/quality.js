// @ts-check
// Quality tier from cheap device hints (PLAN.md section 8). A startup micro-benchmark
// can refine this later; the hints already separate a budget phone from a laptop.

export function pickQuality() {
  const nav = /** @type {any} */ (navigator);
  // ?quality=low|medium|high forces a tier: for testing on a device, and for headless runs.
  const forced = new URLSearchParams(location.search).get('quality');
  const mem = nav.deviceMemory || 4;
  const cores = nav.hardwareConcurrency || 4;
  const saveData = !!nav.connection?.saveData;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  let name = 'medium';
  if (saveData || mem <= 2 || (coarse && cores <= 4)) name = 'low';
  else if (mem >= 8 && !coarse) name = 'high';
  if (forced === 'low' || forced === 'medium' || forced === 'high') name = forced;
  const table = {
    low: { grid: 256, heightTier: '1024', dprCap: 1 },
    medium: { grid: 512, heightTier: '2048', dprCap: 1.5 },
    high: { grid: 1024, heightTier: '2048', dprCap: 2 },
  };
  return { name, saveData, ...table[name] };
}
