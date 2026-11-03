/**
 * 형제님 ('m') or 자매님 ('f'): which parishioner clothes I wear (world/figure.js parishioner).
 * Chosen on the entry card, changeable in the 세례명 panel, remembered in this browser and sent
 * to the server in hello and setLook so others see the same (protocol v0.16).
 */
const KEY = 'gohaeyaji-look';
export const LOOKS = ['m', 'f'];
export const LOOK_LABEL = { m: '형제님', f: '자매님' };
export const validLook = (v) => LOOKS.includes(v);
export const storedLook = {
  load() { try { const v = localStorage.getItem(KEY); return validLook(v) ? v : null; } catch (_) { return null; } },
  save(v) { try { localStorage.setItem(KEY, v); } catch (_) { /* storage blocked */ } },
};
