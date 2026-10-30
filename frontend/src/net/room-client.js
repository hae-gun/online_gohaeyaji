/**
 * Room client: the only place that decides whether a booth is free.
 *
 * Today this is a local simulation so the demo runs without a server.
 * The realtime server (backend/realtime-server) will implement the same contract
 * over WebSocket, and main.js will not need to change:
 *
 *   client -> server   { type: 'claim',   boothId }
 *                      { type: 'release', boothId }
 *   server -> client   { type: 'snapshot',    channelId, occupied: number[] }
 *                      { type: 'claimResult', boothId, ok: boolean }
 *
 * The server must grant a claim atomically (e.g. Redis SET NX with a TTL that the
 * client keeps alive), so two people pressing E at the same moment never both get in.
 * A dropped connection or an expired TTL releases the booth.
 *
 * @typedef {{
 *   onChange(listener: (occupied: Set<number>) => void): void,
 *   claim(boothId: number): Promise<{ ok: boolean }>,
 *   release(boothId: number): void,
 * }} RoomClient
 */

/**
 * @param {{ count: number, simulate?: boolean }} opts
 *   simulate: fake other confessors coming and going (turn off with ?sim=0)
 * @returns {RoomClient}
 */
export function createLocalRoomClient({ count, simulate = true }) {
  const occupied = new Set();
  const listeners = [];
  let mine = null;
  const emit = () => listeners.forEach((fn) => fn(new Set(occupied)));

  if (simulate) {
    for (let i = 0; i < count; i++) if (Math.random() < 0.3) occupied.add(i);
    setInterval(() => {
      const id = Math.floor(Math.random() * count);
      if (id === mine) return;
      if (occupied.has(id)) { if (Math.random() < 0.5) occupied.delete(id); }
      else if (Math.random() < 0.35) occupied.add(id);
      emit();
    }, 2500);
  }

  return {
    onChange(fn) { listeners.push(fn); fn(new Set(occupied)); },
    async claim(boothId) {
      if (occupied.has(boothId)) return { ok: false };
      occupied.add(boothId);
      mine = boothId;
      emit();
      return { ok: true };
    },
    release(boothId) {
      occupied.delete(boothId);
      if (mine === boothId) mine = null;
      emit();
    },
  };
}
