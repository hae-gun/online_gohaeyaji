/**
 * Which priest sits in the booth. Drawn once, when someone walks in, so nobody can pick a
 * priest by choosing a door.
 *
 * A persona with a numeric `chance` (answers.json "personas", e.g. the easter egg priest with
 * `"chance": 0.01`) gets exactly that probability. Everyone else splits what is left equally:
 * with one 1% priest, the three regular priests get 33% each.
 *
 * Kept outside engine.js on purpose: the answer engine moves to the server later (step 7),
 * and the draw should move with it so the server decides who answers.
 *
 * @param {{ id: string, chance?: number }[]} personas
 * @param {() => number} [random]
 */
export function pickPersona(personas, random = Math.random) {
  if (!personas || !personas.length) return null;
  const special = personas.filter((p) => typeof p.chance === 'number' && p.chance > 0);
  const regular = personas.filter((p) => !special.includes(p));
  let r = random();
  for (const p of special) {
    if (r < p.chance) return p;
    r -= p.chance;
  }
  const pool = regular.length ? regular : personas;
  const left = Math.max(1e-9, 1 - special.reduce((s, p) => s + p.chance, 0));
  return pool[Math.min(pool.length - 1, Math.floor((r / left) * pool.length))];
}


/**
 * Dev builds only (npm run dev, npm run dev:server): booth 20 always has the rare priest, so his
 * look, voice and lines can be checked without entering a hundred times. Vite strips this branch
 * from the production build, so the deployed site never does it.
 * @param {{ id: string, chance?: number }[]} personas
 * @param {number} boothId 0-based
 */
export function testPersona(personas, boothId) {
  if (!import.meta.env.DEV || boothId !== TEST_BOOTH) return null;
  return (personas || []).find((p) => typeof p.chance === 'number' && p.chance > 0) || null;
}
export const TEST_BOOTH = 19;   // "20번 고해소"
