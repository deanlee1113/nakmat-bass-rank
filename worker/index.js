// 낚맛 배스 순위 — 이용 통계 + 사진 인증 실시간 랭킹 Worker
// 바인딩: env.DB (D1), env.ADMIN_KEY (secret), env.ASSETS (정적 파일 docs/)
// sid는 브라우저가 만든 무작위 값. 랭킹 사진은 브라우저에서 줄여 보낸 JPEG(EXIF 없음).

const EVENTS = new Set(['visit', 'rank', 'name', 'region_empty', 'photo', 'card_save', 'card_share', 'copy', 'app_cta', 'lunker_app', 'region_app', 'entry', 'board_view']);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Admin-Key',
};

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      sid TEXT, ev TEXT NOT NULL,
      m INTEGER, reg TEXT, len REAL, pct REAL, tier TEXT, annual INTEGER, photo INTEGER,
      src TEXT, ref TEXT, country TEXT, name TEXT
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_ev_ts ON events(ev, ts)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_ev_sid ON events(ev, sid)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL, sid TEXT NOT NULL, name TEXT NOT NULL,
      m INTEGER NOT NULL, reg TEXT NOT NULL, len REAL NOT NULL,
      photo TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, country TEXT
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_entries_board ON entries(m, hidden, reg, len)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_entries_sid ON entries(sid, ts)`),
  ]);
  for (const sql of [`ALTER TABLE events ADD COLUMN name TEXT`, `ALTER TABLE entries ADD COLUMN rank_at INTEGER`, `ALTER TABLE entries ADD COLUMN prev_rank INTEGER`, `ALTER TABLE entries ADD COLUMN beat TEXT`]) {
    try { await db.prepare(sql).run(); } catch (e) { /* 이미 있음 */ }
  }
  schemaReady = true;
}

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra } });
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : null);
const num = (v, lo, hi) => (typeof v === 'number' && isFinite(v) && v >= lo && v <= hi ? v : null);
const isAdmin = (request, url, env) => {
  const key = request.headers.get('X-Admin-Key') || url.searchParams.get('key');
  return !!env.ADMIN_KEY && key === env.ADMIN_KEY;
};

async function track(request, env) {
  const text = await request.text();
  if (text.length > 2000) return json({ ok: false }, 413);
  let b;
  try { b = JSON.parse(text); } catch (e) { return json({ ok: false }, 400); }
  if (!b || !EVENTS.has(b.ev)) return json({ ok: false }, 400);
  await ensureSchema(env.DB);
  await env.DB.prepare(
    `INSERT INTO events (ts, sid, ev, m, reg, len, pct, tier, annual, photo, src, ref, country, name)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`
  ).bind(
    Date.now(), str(b.sid, 40), b.ev,
    num(b.m, 1, 12), str(b.reg, 8), num(b.len, 10, 70), num(b.pct, 0, 100), str(b.tier, 8),
    num(b.annual, 0, 1), num(b.photo, 0, 1), str(b.src, 60), str(b.ref, 80),
    (request.cf && request.cf.country) || null, str(b.name, 20)
  ).run();
  return json({ ok: true });
}

async function count(env) {
  await ensureSchema(env.DB);
  const r = await env.DB.prepare(`SELECT COUNT(DISTINCT sid) AS c FROM events WHERE ev='rank'`).first();
  return json({ people: r ? r.c : 0 }, 200, { 'Cache-Control': 'public, max-age=60' });
}

/* ---------- 랭킹 ---------- */
async function entry(request, env) {
  const text = await request.text();
  if (text.length > 420000) return json({ ok: false, error: 'too_big' }, 413);
  let b;
  try { b = JSON.parse(text); } catch (e) { return json({ ok: false, error: 'bad' }, 400); }
  const sid = str(b.sid, 40), name = str(b.name, 12), m = num(b.m, 1, 12), len = num(b.len, 10, 70);
  const reg = str(b.reg, 8) || '전국';
  const pre = 'data:image/jpeg;base64,';
  const photo = typeof b.photo === 'string' && b.photo.startsWith(pre) ? b.photo.slice(pre.length) : null;
  if (!sid || !name || !m || len == null || !photo || photo.length > 400000) return json({ ok: false, error: 'invalid' }, 400);
  await ensureSchema(env.DB);
  const prev = await env.DB.prepare(`SELECT ts FROM entries WHERE sid=?1 ORDER BY ts DESC LIMIT 1`).bind(sid).first();
  if (prev && Date.now() - prev.ts < 20000) return json({ ok: false, error: 'too_fast' }, 429);
  const L = Math.round(len * 100) / 100;
  const rankOf = (v) => env.DB.prepare(
    `SELECT COUNT(*) + 1 AS r FROM (SELECT sid, MAX(len) AS best FROM entries WHERE m=?1 AND hidden=0 GROUP BY sid) WHERE best > ?2`
  ).bind(m, v).first();
  const [mine, leader] = await env.DB.batch([
    env.DB.prepare(`SELECT MAX(len) AS best FROM entries WHERE m=?1 AND sid=?2 AND hidden=0`).bind(m, sid),
    env.DB.prepare(`SELECT sid, name, len FROM entries WHERE m=?1 AND hidden=0 ORDER BY len DESC, ts ASC LIMIT 1`).bind(m),
  ]);
  const prevBest = mine.results[0] ? mine.results[0].best : null;
  const prevRank = prevBest != null ? (await rankOf(prevBest)).r : null;
  const top = leader.results[0] || null;
  const r = await env.DB.prepare(
    `INSERT INTO entries (ts, sid, name, m, reg, len, photo, country) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  ).bind(Date.now(), sid, name, m, reg, L, photo, (request.cf && request.cf.country) || null).run();
  const id = r.meta.last_row_id;
  const best = prevBest != null && prevBest > L ? prevBest : L;
  const rank = (await rankOf(best)).r;
  const beat = rank === 1 && top && top.sid !== sid && L > top.len ? top.name : null;
  await env.DB.prepare(`UPDATE entries SET rank_at=?2, prev_rank=?3, beat=?4 WHERE id=?1`).bind(id, rank, prevRank, beat).run();
  return json({ ok: true, id, rank, prevRank, beat });
}

async function feed(env) {
  await ensureSchema(env.DB);
  const since = Date.now() - 48 * 3600 * 1000;
  const [ents, checks] = await env.DB.batch([
    env.DB.prepare(`SELECT id, ts, name, m, reg, len, rank_at, prev_rank, beat FROM entries WHERE hidden=0 ORDER BY ts DESC LIMIT 20`),
    env.DB.prepare(`SELECT ts, m, reg, len, pct FROM events WHERE ev='rank' AND ts > ?1 AND len IS NOT NULL ORDER BY ts DESC LIMIT 20`).bind(since),
  ]);
  return json({ entries: ents.results, checks: checks.results }, 200, { 'Cache-Control': 'public, max-age=10' });
}

async function board(url, env) {
  const m = num(Number(url.searchParams.get('m')), 1, 12);
  if (!m) return json({ rows: [], total: 0 });
  await ensureSchema(env.DB);
  const best = `SELECT sid, MAX(len) AS best FROM entries WHERE m=?1 AND hidden=0 GROUP BY sid`;
  const [rows, total] = await env.DB.batch([
    env.DB.prepare(`SELECT e.id, e.name, e.len, e.reg, e.ts FROM entries e JOIN (${best}) t ON e.sid=t.sid AND e.len=t.best
      WHERE e.m=?1 AND e.hidden=0 GROUP BY e.sid ORDER BY e.len DESC, e.ts ASC LIMIT 20`).bind(m),
    env.DB.prepare(`SELECT COUNT(*) AS c FROM (${best})`).bind(m),
  ]);
  return json({ rows: rows.results, total: total.results[0] ? total.results[0].c : 0 }, 200, { 'Cache-Control': 'public, max-age=10' });
}

async function photo(id, request, url, env) {
  await ensureSchema(env.DB);
  const r = await env.DB.prepare(`SELECT photo, hidden FROM entries WHERE id=?1`).bind(id).first();
  if (!r || (r.hidden && !isAdmin(request, url, env))) return new Response('not found', { status: 404, headers: CORS });
  const bin = atob(r.photo);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': r.hidden ? 'no-store' : 'public, max-age=3600', ...CORS } });
}

/* ---------- 관리 ---------- */
async function stats(request, env) {
  await ensureSchema(env.DB);
  const day = `date(ts/1000, 'unixepoch', '+9 hours')`;
  const q = (sql) => env.DB.prepare(sql);
  const res = await env.DB.batch([
    q(`SELECT ev, COUNT(*) AS n, COUNT(DISTINCT sid) AS people FROM events GROUP BY ev`),
    q(`SELECT ${day} AS d,
         COUNT(DISTINCT CASE WHEN ev='visit' THEN sid END) AS visitors,
         COUNT(DISTINCT CASE WHEN ev='rank' THEN sid END) AS rankers,
         SUM(ev IN ('card_save','card_share')) AS cards,
         SUM(ev='copy') AS copies,
         SUM(ev IN ('app_cta','lunker_app','region_app')) AS app
       FROM events WHERE ts > (strftime('%s','now') - 14*86400) * 1000 GROUP BY d ORDER BY d`),
    q(`SELECT COALESCE(reg,'?') AS reg, COUNT(*) AS n FROM events WHERE ev='rank' GROUP BY reg ORDER BY n DESC`),
    q(`SELECT COALESCE(tier,'?') AS tier, COUNT(*) AS n FROM events WHERE ev='rank' GROUP BY tier ORDER BY n DESC`),
    q(`SELECT CAST(len/5 AS INTEGER)*5 AS b, COUNT(*) AS n FROM events WHERE ev='rank' AND len IS NOT NULL GROUP BY b ORDER BY b`),
    q(`SELECT COALESCE(reg,'?') AS reg, COUNT(*) AS n FROM events WHERE ev='region_empty' GROUP BY reg ORDER BY n DESC`),
    q(`SELECT COALESCE(src,'?') AS src, COUNT(DISTINCT sid) AS people FROM events WHERE ev='visit' GROUP BY src ORDER BY people DESC`),
    q(`SELECT COALESCE(NULLIF(ref,''),'(직접·앱 안)') AS ref, COUNT(DISTINCT sid) AS people FROM events WHERE ev='visit' GROUP BY ref ORDER BY people DESC LIMIT 12`),
    q(`SELECT ts, ev, m, reg, len, tier, country, name FROM events ORDER BY ts DESC LIMIT 25`),
    q(`SELECT name, MAX(len) AS best, MAX(reg) AS reg, COUNT(*) AS n, MAX(ts) AS last FROM events WHERE name IS NOT NULL AND name <> '' GROUP BY sid, name ORDER BY last DESC LIMIT 50`),
    q(`SELECT id, ts, name, m, reg, len, hidden, country FROM entries ORDER BY ts DESC LIMIT 60`),
    q(`SELECT COUNT(*) AS n, COUNT(DISTINCT sid) AS people, SUM(hidden) AS hidden FROM entries`),
  ]);
  const [byEv, daily, byReg, byTier, byLen, emptyReg, bySrc, byRef, recent, names, entriesList, entriesSum] = res.map((r) => r.results);
  return json({ byEv, daily, byReg, byTier, byLen, emptyReg, bySrc, byRef, recent, names, entries: entriesList, entriesSum: entriesSum[0] || {} });
}

async function hide(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return json({ ok: false }, 400); }
  const id = num(b.id, 1, 1e12), h = num(b.hidden, 0, 1);
  if (id == null || h == null) return json({ ok: false }, 400);
  await ensureSchema(env.DB);
  await env.DB.prepare(`UPDATE entries SET hidden=?2 WHERE id=?1`).bind(id, h).run();
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (request.method === 'OPTIONS' && p.startsWith('/api/')) return new Response(null, { headers: CORS });
    try {
      if (request.method === 'POST' && p === '/api/track') return await track(request, env);
      if (request.method === 'GET' && p === '/api/count') return await count(env);
      if (request.method === 'POST' && p === '/api/entry') return await entry(request, env);
      if (request.method === 'GET' && p === '/api/board') return await board(url, env);
      if (request.method === 'GET' && p === '/api/feed') return await feed(env);
      const ph = p.match(/^\/api\/photo\/(\d+)$/);
      if (request.method === 'GET' && ph) return await photo(Number(ph[1]), request, url, env);
      if (p === '/api/stats' || p === '/api/admin/hide') {
        if (!isAdmin(request, url, env)) return json({ error: 'unauthorized' }, 401);
        if (request.method === 'GET' && p === '/api/stats') return await stats(request, env);
        if (request.method === 'POST' && p === '/api/admin/hide') return await hide(request, env);
      }
    } catch (e) {
      return json({ ok: false, error: 'server' }, 500);
    }
    return env.ASSETS.fetch(request);
  },
};
