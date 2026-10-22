// 낚맛 배스 순위 — 익명 이용 통계 Worker
// 바인딩: env.DB (D1), env.ADMIN_KEY (secret), env.ASSETS (정적 파일 docs/)
// 이름·연락처·사진은 받지 않는다. sid는 브라우저가 만든 무작위 값.

const EVENTS = new Set(['visit', 'rank', 'region_empty', 'photo', 'card_save', 'card_share', 'copy', 'app_cta', 'lunker_app', 'region_app']);
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
      src TEXT, ref TEXT, country TEXT
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_ev_ts ON events(ev, ts)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_ev_sid ON events(ev, sid)`),
  ]);
  schemaReady = true;
}

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra } });
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
const num = (v, lo, hi) => (typeof v === 'number' && isFinite(v) && v >= lo && v <= hi ? v : null);

async function track(request, env) {
  const text = await request.text();
  if (text.length > 2000) return json({ ok: false }, 413);
  let b;
  try { b = JSON.parse(text); } catch (e) { return json({ ok: false }, 400); }
  if (!b || !EVENTS.has(b.ev)) return json({ ok: false }, 400);
  await ensureSchema(env.DB);
  await env.DB.prepare(
    `INSERT INTO events (ts, sid, ev, m, reg, len, pct, tier, annual, photo, src, ref, country)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`
  ).bind(
    Date.now(), str(b.sid, 40), b.ev,
    num(b.m, 1, 12), str(b.reg, 8), num(b.len, 10, 70), num(b.pct, 0, 100), str(b.tier, 8),
    num(b.annual, 0, 1), num(b.photo, 0, 1), str(b.src, 60), str(b.ref, 80),
    (request.cf && request.cf.country) || null
  ).run();
  return json({ ok: true });
}

async function count(env) {
  await ensureSchema(env.DB);
  const r = await env.DB.prepare(`SELECT COUNT(DISTINCT sid) AS c FROM events WHERE ev='rank'`).first();
  return json({ people: r ? r.c : 0 }, 200, { 'Cache-Control': 'public, max-age=60' });
}

async function stats(request, env) {
  const url = new URL(request.url);
  const key = request.headers.get('X-Admin-Key') || url.searchParams.get('key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return json({ error: 'unauthorized' }, 401);
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
    q(`SELECT ts, ev, m, reg, len, tier, country FROM events ORDER BY ts DESC LIMIT 25`),
  ]);
  const [byEv, daily, byReg, byTier, byLen, emptyReg, bySrc, byRef, recent] = res.map((r) => r.results);
  return json({ byEv, daily, byReg, byTier, byLen, emptyReg, bySrc, byRef, recent });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) return new Response(null, { headers: CORS });
    try {
      if (request.method === 'POST' && url.pathname === '/api/track') return await track(request, env);
      if (request.method === 'GET' && url.pathname === '/api/count') return await count(env);
      if (request.method === 'GET' && url.pathname === '/api/stats') return await stats(request, env);
    } catch (e) {
      return json({ ok: false, error: 'server' }, 500);
    }
    return env.ASSETS.fetch(request);
  },
};
