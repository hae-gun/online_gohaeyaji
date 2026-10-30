/**
 * Keyboard state keyed by the physical key (KeyboardEvent.code), not the typed character.
 * With the Korean IME on, pressing W produces 'ㅈ' in e.key, so e.key-based checks
 * would ignore movement. e.code is the same regardless of the input language.
 */
const CODE = {
  KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyE: 'e', KeyV: 'v',
  ArrowUp: 'arrowup', ArrowDown: 'arrowdown', ArrowLeft: 'arrowleft', ArrowRight: 'arrowright',
  Space: ' ', Escape: 'escape',
};
const keyOf = (e) => CODE[e.code] || (e.key || '').toLowerCase();
const SCROLL_KEYS = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '];

/**
 * @param {(key: string) => void} onPress fired once per press (no auto-repeat), e.g. 'e', 'v', 'escape'
 * @returns {Record<string, boolean>} live map of keys currently held down
 */
export function createKeyboard(onPress) {
  const held = {};
  addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return; // typing a confession
    const k = keyOf(e);
    held[k] = true;
    if (SCROLL_KEYS.includes(k)) e.preventDefault();
    if (!e.repeat) onPress(k);
  });
  addEventListener('keyup', (e) => { held[keyOf(e)] = false; });
  // switching windows while holding W would otherwise keep walking forever
  addEventListener('blur', () => { for (const k in held) held[k] = false; });
  return held;
}
