/**
 * Confession history kept only in this browser (localStorage). Never sent to the server.
 * Storage can be unavailable (private mode, blocked site data), so every call is guarded.
 */
const KEY = 'gohaeyaji-history';
const MAX = 50;

export const history = {
  /** @returns {{t:number, q:string, c:string, p:string}[]} oldest first */
  load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; }
  },
  add(entry) {
    const list = history.load();
    list.push(entry);
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch (_) { /* storage full or blocked */ }
  },
  clear() {
    try { localStorage.removeItem(KEY); } catch (_) { /* ignore */ }
  },
};
