// Temporary Korean Series collector for /wizpark. Delete this folder after the series.
// One process asks Naver's unofficial API, then Nginx serves the result as a static file,
// so visitor count never changes how often Naver is called.
// Play text is rebuilt from facts here; Naver's written copy is not republished.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const UPSTREAM = process.env.UPSTREAM || 'https://api-gw.sports.naver.com';
const OUT = process.env.OUT_DIR || '/srv/wiz';
const TEAM = process.env.TEAM_CODE || 'KT';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const HEARTBEAT_MS = 30_000;
const MAX_BACKOFF_MS = 120_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kstDate = () => new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10);

async function naver(path, referer) {
  const res = await fetch(UPSTREAM + path, {
    headers: { 'user-agent': UA, accept: 'application/json', referer },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  const body = await res.json();
  if (!body.success) throw new Error(`rejected ${path}`);
  return body.result;
}

const PITCH = { B: '볼', S: '헛스윙', T: '루킹 스트라이크', F: '파울' };
const RESULTS = [
  [/홈런/, '홈런'], [/3루타/, '3루타'], [/2루타/, '2루타'], [/안타|1루타/, '안타'],
  [/삼진/, '삼진'], [/볼넷/, '볼넷'], [/몸에 맞/, '몸에 맞는 공'], [/병살/, '병살타'],
  [/뜬공|땅볼|직선타|아웃/, '아웃'],
];

export function ownText(o) {
  if (o.pitchResult && PITCH[o.pitchResult]) {
    const detail = [o.stuff, o.speed && `${o.speed}km`].filter(Boolean).join(' ');
    return `${o.pitchNum ? `${o.pitchNum}구 ` : ''}${detail ? `${detail} ` : ''}${PITCH[o.pitchResult]}`;
  }
  const text = (o.text || '').trim();
  const up = text.match(/^(\d+)번타자\s+(\S+)/);
  if (up) return `${up[1]}번 타자 ${up[2]}`;
  if (/교체/.test(text)) return '선수 교체';
  const hit = RESULTS.find(([re]) => re.test(text));
  if (!hit) return /홈인/.test(text) ? '득점' : null;
  const name = text.match(/^([^\s:]+)\s*:/)?.[1];
  const label = /홈인/.test(text) && hit[1] !== '홈런' ? `${hit[1]}, 득점` : hit[1];
  return name ? `${name} ${label}` : label;
}

const pickPlayer = ({ pcode, name, posName, pos, batOrder, backnum, ab, hit, inn, kk, seasonEra, hitType, hittype, pitchingStyle }) =>
  ({ pcode, name, posName, pos, batOrder, backnum, ab, hit, inn, kk, seasonEra, hitType: hitType || hittype, pitchingStyle });
const pickTeam = (t) => ({ batter: (t?.batter || []).map(pickPlayer), pitcher: (t?.pitcher || []).map(pickPlayer) });

export function slimRelay(d) {
  if (!d) return null;
  const textRelays = [...(d.textRelays || [])]
    .sort((a, b) => (b.no ?? 0) - (a.no ?? 0))
    .slice(0, 14)
    .map((r) => ({
      no: r.no, inn: r.inn, homeOrAway: r.homeOrAway,
      textOptions: (r.textOptions || [])
        .map((o) => ({ seqno: o.seqno, text: ownText(o) }))
        .filter((o) => o.text),
    }));
  return {
    inn: d.inn, homeOrAway: d.homeOrAway, inningScore: d.inningScore, currentGameState: d.currentGameState,
    homeLineup: pickTeam(d.homeLineup), awayLineup: pickTeam(d.awayLineup),
    homeEntry: pickTeam(d.homeEntry), awayEntry: pickTeam(d.awayEntry), textRelays,
  };
}

export function pickGame(games, team = TEAM) {
  const mine = (games || []).filter((g) => g.categoryId === 'kbo' && !g.cancel
    && (g.homeTeamCode === team || g.awayTeamCode === team));
  const g = mine.find((x) => x.statusCode === 'STARTED') || mine[0];
  if (!g) return null;
  const { gameId, homeTeamName, awayTeamName, homeTeamCode, awayTeamCode, statusCode,
    gameDateTime, homeStarterName, awayStarterName } = g;
  return { gameId, homeTeamName, awayTeamName, homeTeamCode, awayTeamCode, statusCode,
    gameDateTime, homeStarterName, awayStarterName };
}

const delayFor = (g) => {
  if (!g) return 600_000;
  if (g.statusCode === 'STARTED') return 5_000;
  if (g.statusCode === 'RESULT') return 300_000;
  return 60_000;
};

let lastBody = '';
let lastWrite = 0;
function publish(game, relay) {
  const body = JSON.stringify({ game, relay });
  const now = Date.now();
  // unchanged content keeps the same ETag, so browsers get a cheap 304 between pitches
  if (body === lastBody && now - lastWrite < HEARTBEAT_MS) return;
  lastBody = body;
  lastWrite = now;
  const file = join(OUT, 'state.json');
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ checkedAt: now, game, relay }), { mode: 0o644 });
  renameSync(tmp, file); // atomic, so Nginx never serves half a file
}

export async function tick(previous) {
  const date = kstDate();
  const schedule = await naver(
    `/schedule/games?upperCategoryId=kbaseball&fromDate=${date}&toDate=${date}`,
    'https://m.sports.naver.com/kbaseball/schedule/index',
  );
  const game = pickGame(schedule.games);
  let relay = previous?.game?.gameId === game?.gameId ? previous?.relay ?? null : null;
  if (game && !/BEFORE|READY/.test(game.statusCode)) {
    const r = await naver(`/schedule/games/${game.gameId}/relay`, `https://m.sports.naver.com/game/${game.gameId}/relay`);
    relay = slimRelay(r.textRelayData) ?? relay;
  }
  publish(game, relay);
  return { game, relay };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  let state = null;
  let failures = 0;
  for (;;) {
    try {
      state = await tick(state);
      failures = 0;
      await sleep(delayFor(state.game));
    } catch (e) {
      failures += 1;
      const wait = Math.min(5_000 * 2 ** failures, MAX_BACKOFF_MS);
      console.error(new Date().toISOString(), e.message, `retry in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
