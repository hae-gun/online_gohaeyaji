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
 *   myName: string,
 *   onName(listener: (name: string) => void): void,
 *   rename(name: string): Promise<{ ok: boolean, name?: string, reason?: string }>,
 *   myFace: string|null,
 *   setFace(face: string|null): Promise<{ ok: boolean, reason?: string }>,
 *   report(pid: number): Promise<{ ok: boolean, reason?: string }>,
 *   sendEmote(id: string, at?: { x: number, z: number, ry: number }): void,
 *   onFaceRemoved(listener: (e: { reason: string, blockedMs: number }) => void): void,
 *   sendInquiry(kind: string, text: string): Promise<{ ok: boolean, reason?: string }>,
 *   canSwitchChannel?: boolean,
 *   listChannels?(): Promise<{ ok: boolean, current?: number, capacity?: number, channels?: { no: number, members: number }[], reason?: string }>,
 *   switchChannel?(channelNo: number): Promise<{ ok: boolean, channelNo?: number, reason?: string }>,
 * }} RoomClient
 *
 * Positions of other players (protocol v0.3). Rows are [pid, x, z, ry] or, in a reset,
 * [pid, x, z, ry, boothId or -1]. Names (v0.4) come as [pid, name] pairs, hand-drawn faces (v0.5)
 * as [pid, face] pairs ("" in a batch = back to the default face):
 * @typedef {{ kind: 'reset', you: number|null, players: number[][], names: [number, string][], faces: [number, string][], sitting?: number[] }
 *         | { kind: 'batch', moved: number[][], left: number[], named: [number, string][], faced: [number, string][],
 *             emoted: [number, string][] }
 *         | { kind: 'booth', boothId: number, pid: number|null }} PresenceEvent
 *
 * onForcedRelease fires when the server takes a booth away (IDLE safety net, LEASE_EXPIRED,
 * connection lost). It never fires for a release the client asked for itself.
 */

import { checkName, normalizeName, randomSaintName, storedName } from './names.js';
import { storedFace, normalizeFace } from './faces.js';

export const DEFAULT_IDLE = { limitMs: 90_000, warnMs: 20_000, dangerMs: 10_000 };
const RENAME_GAP_MS = 10_000;

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
  // no server: keep the remembered name if it still passes the basic rules, else pick one
  const remembered = storedName.load();
  let myName = remembered && checkName(remembered) === 'OK' ? normalizeName(remembered) : randomSaintName();
  storedName.save(myName);
  const nameListeners = [];
  let lastRename = 0;
  let myFace = storedFace.load();

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
    get myName() { return myName; },
    get myFace() { return myFace; },
    async report() { return { ok: false, reason: 'NO_FACE' }; },   // nobody else exists here
    sendEmote() { /* nobody to show it to */ },
    onFaceRemoved() { /* never happens without a server */ },
    // the inquiry box needs the server: nobody would read it here
    async sendInquiry() { return { ok: false, reason: 'OFFLINE' }; },
    async setFace(face) {
      myFace = normalizeFace(face);
      storedFace.save(myFace);
      return { ok: true };
    },
    onName(fn) { nameListeners.push(fn); fn(myName); },
    /** Basic rules only; the blocked word list is checked by the real server. */
    async rename(raw) {
      const verdict = checkName(raw);
      if (verdict !== 'OK') return { ok: false, reason: verdict };
      if (Date.now() - lastRename < RENAME_GAP_MS) return { ok: false, reason: 'TOO_SOON' };
      lastRename = Date.now();
      myName = normalizeName(raw);
      storedName.save(myName);
      nameListeners.forEach((fn) => fn(myName));
      return { ok: true, name: myName };
    },
  };
}
