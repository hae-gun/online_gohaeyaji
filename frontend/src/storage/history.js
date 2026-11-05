/**
 * Confession history kept only in this browser (localStorage). Never sent to the server.
 * Storage can be unavailable (private mode, blocked site data), so every call is guarded.
 */
const KEY = 'gohaeyaji-history';
const MAX = 50;

export const history = {
  /**
   * @returns {{t:number, q:string, c:string, p:string, pr?:string, k?:string, n?:number,
   *            g?:string, lg?:boolean, ref?:object}[]} oldest first.
   *   pr priest id, k the keyword caught (죄목), n how many times this sin so far, g the verdict
   *   stamp, lg the legendary priest, ref what the card link needs (card/link.js). Entries from
   *   before these were kept have only t, q, c, p (and maybe pr).
   */
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
