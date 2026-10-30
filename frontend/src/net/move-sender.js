/**
 * Decides when to tell the server where I am (protocol section 13):
 *  - while walking: at most once per 200 ms
 *  - when I stop: once more, so others see where I actually ended up
 *  - on demand (entering the world, coming out of a booth): right away
 * Standing still sends nothing.
 */
const INTERVAL_MS = 200;

export function createMoveSender(rooms) {
  let last = 0;
  let wasMoving = false;

  function send(pos, ry, now) {
    rooms.sendMove(pos.x, pos.z, ry);
    last = now;
  }

  return {
    /** Call every frame while walking around. */
    update(pos, ry, moving, now = performance.now()) {
      if (moving) {
        if (now - last >= INTERVAL_MS) send(pos, ry, now);
      } else if (wasMoving) {
        send(pos, ry, now);
      }
      wasMoving = moving;
    },
    /** Send immediately (first appearance, after leaving a booth, after reconnecting). */
    now(pos, ry) {
      send(pos, ry, performance.now());
    },
  };
}
