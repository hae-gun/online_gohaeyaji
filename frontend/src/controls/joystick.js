/**
 * An on-screen joystick for touch screens: a ring at the bottom left with a knob that follows the
 * finger. Pushing it walks the character relative to where the camera looks, like the WASD keys;
 * tapping elsewhere to walk and dragging elsewhere to turn the camera keep working.
 *
 * On by default where the main pointer is a finger (phones, tablets), off on mouse screens; the
 * menu switches it, and the choice is remembered in this browser.
 */
const KEY = 'gohaeyaji-joystick';
const DEAD = 0.15;     // ignore tiny pushes
const RADIUS = 46;     // how far the knob travels (px)

export function joystickDefault() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === '1' || v === '0') return v === '1';
  } catch (_) { /* storage blocked */ }
  return matchMedia('(pointer: coarse)').matches;
}

export function saveJoystick(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_) { /* storage blocked */ }
}

/**
 * @param {HTMLElement} el the ring (contains .knob)
 * @returns {{ readonly x: number, readonly y: number, readonly active: boolean, reset(): void }}
 *   x right +, y forward + (finger up), both -1..1, 0 inside the dead zone
 */
export function createJoystick(el) {
  const knob = el.querySelector('.knob');
  let id = null, cx = 0, cy = 0, x = 0, y = 0;

  const move = (e) => {
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > RADIUS) { dx = (dx / d) * RADIUS; dy = (dy / d) * RADIUS; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const m = Math.min(1, d / RADIUS);
    if (m < DEAD) { x = 0; y = 0; return; }
    x = dx / RADIUS;
    y = -dy / RADIUS;
  };
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null; x = 0; y = 0;
    knob.style.transform = '';
    el.classList.remove('on');
  };

  el.addEventListener('pointerdown', (e) => {
    if (id !== null) return;
    e.preventDefault();
    e.stopPropagation();
    id = e.pointerId;
    el.setPointerCapture(id);
    const r = el.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    el.classList.add('on');
    move(e);
  });
  el.addEventListener('pointermove', (e) => { if (e.pointerId === id) { e.preventDefault(); move(e); } });
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);

  return {
    get x() { return x; },
    get y() { return y; },
    get active() { return x !== 0 || y !== 0; },
    reset() { id = null; x = 0; y = 0; knob.style.transform = ''; el.classList.remove('on'); },
  };
}
