/**
 * Room client: the only place that decides whether a booth is free.
 *
 * Two implementations share this contract:
 *  - createLocalRoomClient (this file): in-browser simulation, used when no server URL is set
 *    (GitHub Pages demo, `npm run dev`)
 *  - createWsRoomClient (ws-room-client.js): talks to backend/realtime-server over WebSocket,
 *    following docs/realtime-protocol.md
 *
 * @typedef {'connecting'|'ready'|'reconnecting'|'outdated'|'closed'} ConnectionState
 * @typedef {{ state: ConnectionState, channelNo: number }} Status
 * @typedef {{
 *   onChange(listener: (occupied: Set<number>) => void): void,
 *   onStatus(listener: (status: Status) => void): void,
 *   onForcedRelease(listener: (e: { boothId: number, reason: string }) => void): void,
 *   claim(boothId: number): Promise<{ ok: boolean, reason?: string }>,
 *   release(boothId: number, reason?: 'USER'|'IDLE'): void,
 *   activity(): void,
 *   onPresence(listener: (e: PresenceEvent) => void): void,
 *   sendMove(x: number, z: number, ry: number): void,
 *   sharesPresence: boolean,
 *   idle: { limitMs: number, warnMs: number, dangerMs: number },
 * }} RoomClient
 *
 * Positions of other players (protocol v0.3). Rows are [pid, x, z, ry] or, in a reset,
 * [pid, x, z, ry, boothId or -1]:
 * @typedef {{ kind: 'reset', you: number|null, players: number[][] }
 *         | { kind: 'batch', moved: number[][], left: number[] }
 *         | { kind: 'booth', boothId: number, pid: number|null }} PresenceEvent
 *
 * onForcedRelease fires when the server takes a booth away (IDLE safety net, LEASE_EXPIRED,
 * connection lost). It never fires for a release the client asked for itself.
 */

export const DEFAULT_IDLE = { limitMs: 90_000, warnMs: 20_000, dangerMs: 10_000 };

/**
 * @param {{ count: number, simulate?: boolean }} opts
 *   simulate: fake other confessors coming and going (off by default, turn on with ?sim=1)
 * @returns {RoomClient}
 */
export function createLocalRoomClient({ count, simulate = false }) {
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
    idle: DEFAULT_IDLE,
    onChange(fn) { listeners.push(fn); fn(new Set(occupied)); },
    onStatus(fn) { fn({ state: 'ready', channelNo: 1 }); },
    onForcedRelease() { /* the simulation never takes a booth away */ },
    async claim(boothId) {
      if (occupied.has(boothId)) return { ok: false, reason: 'OCCUPIED' };
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
    activity() { /* nothing to report */ },
    onPresence() { /* nobody else exists in the simulation */ },
    sendMove() { /* nobody to tell */ },
    sharesPresence: false,
  };
}
