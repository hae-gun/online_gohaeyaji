/**
 * How my parishioner looks: clothes (형제님 'm' or 자매님 'f'), skin tone and hair style, packed
 * into one short code so it travels as the existing `look` value (protocol v0.17):
 *
 *   "f32"       = 자매님, skin tone 3 of SKIN_TONES, hair style 2
 *   "mc98d5f4"  = 형제님, skin colour #c98d5f picked freely (RGB), hair style 4 (민머리)
 *   "m" / "f" alone (older clients) = default skin tone and hair style
 *
 * Chosen on the entry card (clothes) and in the face editor (skin, hair), remembered in this
 * browser and sent in hello and setLook so others see the same. world/figure.js builds it.
 */
const KEY = 'gohaeyaji-look';
export const LOOKS = ['m', 'f'];
export const LOOK_LABEL = { m: '형제님', f: '자매님' };

/** Skin tones, light to deep. Index 1 is the colour everyone had before (0xf3c9a4). */
export const SKIN_TONES = [0xfbe1cc, 0xf3c9a4, 0xe5b083, 0xc98d5f, 0xa66b43, 0x6f4429];
export const DEFAULT_SKIN = 1;

/** Hair styles per clothes. The last one is always 민머리 (bald). */
export const HAIR_STYLES = {
  m: ['짧은 머리', '가르마', '뽀글 파마', '삐죽 머리', '민머리'],
  f: ['긴 생머리', '단발', '포니테일', '양갈래 똥머리', '민머리'],
};
export const DEFAULT_HAIR = 0;

/** The skin part is one digit (a preset) or six lowercase hex digits (any RGB colour). */
const CODE = /^[mf](?:(?:[0-5]|[0-9a-f]{6})[0-4])?$/;
export const validLook = (v) => typeof v === 'string' && CODE.test(v);

/**
 * @returns {{ clothes: 'm'|'f', skin: string, hair: number }} skin is the code part: '0'..'5' or
 *   'rrggbb'. Defaults for anything missing or bad.
 */
export function parseLook(v) {
  if (!validLook(v) || v.length === 1) return { clothes: validLook(v) ? v : 'm', skin: String(DEFAULT_SKIN), hair: DEFAULT_HAIR };
  return { clothes: v[0], skin: v.slice(1, -1), hair: Number(v[v.length - 1]) };
}

/** The colour (0xrrggbb) of a skin part from parseLook. */
export const skinColor = (skin) => (String(skin).length === 6 ? parseInt(skin, 16) : SKIN_TONES[Number(skin)] ?? SKIN_TONES[DEFAULT_SKIN]);

/** skin: a preset index (number or digit) or 'rrggbb' / '#rrggbb'. */
export function makeLook(clothes, skin = DEFAULT_SKIN, hair = DEFAULT_HAIR) {
  let k = String(skin).replace('#', '').toLowerCase();
  if (!/^(?:[0-5]|[0-9a-f]{6})$/.test(k)) k = String(DEFAULT_SKIN);
  return `${clothes === 'f' ? 'f' : 'm'}${k}${hair}`;
}

export const storedLook = {
  load() { try { const v = localStorage.getItem(KEY); return validLook(v) ? v : null; } catch (_) { return null; } },
  save(v) { try { localStorage.setItem(KEY, v); } catch (_) { /* storage blocked */ } },
};
