// ASH//FLOW helper — keeps the music going while the app is closed.
//
// One Durable Object ("the brain") holds a copy of your plan: library (keys, BPM, genres, playlists),
// queue, settings and recent plays. While the app pings it (every 30 s), it stands by. When the pings
// stop, it wakes itself with alarms, asks Spotify what's playing, and ~90 s before the end of each
// track hands Spotify the next one: your queue first, then Auto-pick's choice (same rules as the app).

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";
const PRESENT_MS = 40000;           // app pinged within this → app is in charge (it pings every 15 s while open)
const LEAD_MS = 90000;              // queue the next track this long before the end
const GAP = 60 * 60 * 1000;         // an hour's break starts a new flow
const LIB_CHUNK = 700;              // tracks per stored chunk (storage values are capped)

// ---------- Camelot ----------
const wrap = n => ((n - 1 + 120) % 12) + 1;
const MOVES = [
  ["same", (n, l) => [[n, l]]],
  ["adj", (n, l) => [[wrap(n - 1), l], [wrap(n + 1), l]]],
  ["rel", (n, l) => [[n, l === "A" ? "B" : "A"]]],
  ["boost", (n, l) => [[wrap(n + 2), l]]],
  ["diag", (n, l) => l === "A" ? [[wrap(n + 1), "B"]] : [[wrap(n - 1), "A"]]]
];
const MOVE_W = { same: 1, adj: 0.9, rel: 0.85, diag: 0.75, boost: 0.7 };
function relations(key) {
  if (!key) return {};
  const n = parseInt(key), l = key.slice(-1), map = {};
  MOVES.forEach(([id, f]) => f(n, l).forEach(([a, b]) => { if (!map[a + b]) map[a + b] = id; }));
  return map;
}
const tdist = (a, b) => !a || !b ? 40 : Math.min(Math.abs(a - b), Math.abs(a - 2 * b) + 10, Math.abs(2 * a - b) + 10);

// Library rows arrive compact: [id, key, tempo, family, styles[], playlists[]]
const rowObj = r => ({ id: r[0], key: r[1], tempo: r[2] || 0, f: r[3] || null, s: r[4] || [], src: r[5] || [] });

function dirBonus(dir, from, t, m, dt) {
  const toB = from.key.endsWith("A") && t.key.endsWith("B"), toA = from.key.endsWith("B") && t.key.endsWith("A");
  if (dir === "build") return (m === "boost" ? 0.4 : 0) + (toB ? 0.25 : 0) + (m === "same" ? -0.1 : 0) + (dt < 0 ? -0.4 : 0);
  if (dir === "hold") return (m === "same" || m === "adj" ? 0.25 : 0) + (m === "boost" ? -0.5 : 0) + (m === "rel" || m === "diag" ? -0.15 : 0);
  if (dir === "cool") return (m === "boost" ? -0.6 : 0) + (toA ? 0.25 : 0) + (m === "same" ? -0.1 : 0) + (dt > 0 ? -0.4 : 0);
  return 0;
}
function scoreFor(set, from, t, m) {
  const dir = set.dir || "any", dt = from.tempo && t.tempo ? t.tempo - from.tempo : 0;
  let sc = MOVE_W[m] || 0;
  if (dir === "any" || !from.tempo || !t.tempo) sc += (1 - Math.min(Math.abs(dt), 8) / 8) * 0.8;
  else { const target = { build: 3, hold: 0, cool: -3 }[dir]; sc += (1 - Math.min(Math.abs(dt - target), 6) / 6) * 1.2; }
  sc += dirBonus(dir, from, t, m, dt);
  if (from.f && t.f) { if (from.f === t.f) sc += 0.5; sc += Math.min(0.3, 0.1 * t.s.filter(x => from.s.includes(x)).length); }
  return sc;
}
// Same logic as the app: close matches first (same genre preferred); if none, widen — same playlists, then BPM, then key.
export function pickNext(lib, from, set, skip) {
  if (!from || !from.key) return null;
  const rel = relations(from.key), genres = set.genres || [], stay = !!set.stayGenre;
  const passes = t => !(genres.length && (!t.f || !genres.includes(t.f))) && !(stay && from.f && (!t.f || t.f !== from.f));
  const out = [];
  for (const t of lib) {
    if (!t.key || skip.has(t.id) || !passes(t)) continue;
    const m = rel[t.key]; if (!m) continue;
    if (from.tempo && t.tempo && Math.abs(t.tempo - from.tempo) > 8) continue;
    out.push({ t, m, sc: scoreFor(set, from, t, m) });
  }
  if (out.length) {
    const exact = x => { const ex = x.m === "same" && from.tempo && x.t.tempo === from.tempo, same = !from.f || !x.t.f || x.t.f === from.f; return ex && same ? 3 : same && from.f && x.t.f ? 2 : ex ? 1 : 0; };
    out.sort((a, b) => exact(b) - exact(a) || b.sc - a.sc);
    return { t: out[0].t, why: out[0].m };
  }
  const fSrc = new Set(from.src || []), fStyles = new Set(from.s.map(x => x.toLowerCase()));
  let best = null, bk = null;
  for (const t of lib) {
    if (!t.key || skip.has(t.id) || !passes(t)) continue;
    const shared = t.src.filter(p => fSrc.has(p)).length;
    const world = shared ? 2 + shared : (from.f && t.f && (t.f === from.f || t.s.some(x => fStyles.has(x.toLowerCase())))) ? 1 : 0;
    const m = rel[t.key] || "any", k = [world, -Math.round(tdist(from.tempo, t.tempo) / 2), MOVE_W[m] || 0];
    if (!bk || k[0] > bk[0] || (k[0] === bk[0] && (k[1] > bk[1] || (k[1] === bk[1] && k[2] > bk[2])))) { bk = k; best = { t, why: m === "any" ? "key change" : m }; }
  }
  return best;
}

// ---------- worker entry: CORS + hand everything to the brain ----------
const cors = (env, extra = {}) => Object.assign({
  "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
}, extra);
export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors(env) });
    const brain = env.BRAIN.get(env.BRAIN.idFromName("ashflow"));
    const r = await brain.fetch(req);
    return new Response(r.body, { status: r.status, headers: cors(env, { "Content-Type": "application/json" }) });
  }
};

// ---------- the brain ----------
export class Brain {
  constructor(state, env) { this.state = state; this.st = state.storage; this.env = env; }

  json(o, status = 200) { return new Response(JSON.stringify(o), { status }); }
  async get(k, d) { const v = await this.st.get(k); return v === undefined ? d : v; }

  async log(msg) {
    const l = await this.get("diag", []); l.push({ at: Date.now(), msg }); await this.st.put("diag", l.slice(-40));
  }

  // ----- Spotify -----
  async access() {
    const a = await this.get("auth", null); if (!a) return null;
    if (a.access && Date.now() < a.exp) return a.access;
    const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: a.refresh, client_id: this.env.SPOTIFY_CLIENT_ID }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { await this.log("Spotify sign-in refresh failed: " + (j.error_description || j.error || r.status)); if (j.error === "invalid_grant") { a.dead = true; await this.st.put("auth", a); } return null; }
    a.access = j.access_token; a.exp = Date.now() + (j.expires_in - 60) * 1000; if (j.refresh_token) a.refresh = j.refresh_token; a.dead = false;
    await this.st.put("auth", a);
    return a.access;
  }
  async sp(path, opts = {}) {
    const tk = await this.access(); if (!tk) throw new Error("not signed in");
    const r = await fetch(API + path, Object.assign({}, opts, { headers: { Authorization: "Bearer " + tk, "Content-Type": "application/json" } }));
    if (r.status === 204) return null;
    if (r.status === 429) { const e = new Error("Spotify busy"); e.rate = parseInt(r.headers.get("Retry-After") || "30", 10); throw e; }
    const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
    if (!r.ok) throw new Error("Spotify " + r.status + (j && j.error ? ": " + (j.error.message || j.error) : ""));
    return j;
  }

  // ----- library (chunked) -----
  async library() {
    if (this._lib) return this._lib;
    const n = await this.get("libChunks", 0), rows = [];
    for (let i = 0; i < n; i++) rows.push(...(await this.get("lib" + i, [])));
    this._lib = rows.map(rowObj); this._byId = new Map(this._lib.map(t => [t.id, t]));
    return this._lib;
  }
  async putLibrary(rows, hash) {
    const n = Math.ceil(rows.length / LIB_CHUNK), old = await this.get("libChunks", 0);
    for (let i = 0; i < n; i++) await this.st.put("lib" + i, rows.slice(i * LIB_CHUNK, (i + 1) * LIB_CHUNK));
    for (let i = n; i < old; i++) await this.st.delete("lib" + i);
    await this.st.put("libChunks", n); await this.st.put("libHash", hash); this._lib = null;
  }

  async auth(req, body) {
    const key = await this.get("key", null);
    return key && body && body.key === key;
  }

  async fetch(req) {
    const url = new URL(req.url), body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (url.pathname === "/" || url.pathname === "/health") return this.json({ ok: true, service: "ashflow-helper", connected: !!(await this.get("auth", null)) });

    // First connection (or reconnection by the same Spotify user): store the helper's own Spotify sign-in.
    if (url.pathname === "/connect" && req.method === "POST") {
      if (!body.refresh) return this.json({ error: "missing sign-in" }, 400);
      const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: body.refresh, client_id: this.env.SPOTIFY_CLIENT_ID }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return this.json({ error: "Spotify didn't accept the sign-in: " + (j.error_description || j.error || r.status) }, 400);
      const me = await (await fetch(API + "/me", { headers: { Authorization: "Bearer " + j.access_token } })).json().catch(() => ({}));
      const prev = await this.get("auth", null);
      if (prev && prev.user && me.id && prev.user !== me.id && !(await this.auth(req, body))) return this.json({ error: "This helper belongs to a different Spotify account." }, 403);
      await this.st.put("auth", { refresh: j.refresh_token || body.refresh, access: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000, user: me.id || null, name: me.display_name || "" });
      const key = crypto.randomUUID() + crypto.randomUUID();
      await this.st.put("key", key);
      await this.log("Connected for " + (me.display_name || me.id || "you"));
      await this.st.setAlarm(Date.now() + 5000);
      return this.json({ ok: true, key, name: me.display_name || me.id });
    }

    if (!(await this.auth(req, body))) return this.json({ error: "not connected" }, 401);

    if (url.pathname === "/sync") {
      const now = Date.now();
      // If the helper changed the queue (played or lined up tracks) after the app last sent it, the helper's
      // version wins: read it before anything is overwritten, and send it back for the app to adopt.
      const hQAt = await this.get("helperQAt", 0), helperNewer = hQAt > (body.queueAt || 0);
      const hQueue = await this.get("queue", []), hHanded = await this.get("handed", null);
      if (helperNewer) { delete body.queue; delete body.handed; }
      if (body.library && body.libHash) await this.putLibrary(body.library, body.libHash);
      if (body.settings) await this.st.put("settings", body.settings);
      if (body.history) {   // merge the app's plays with the ones the helper saw itself
        const mine = await this.get("history", []), seen = new Set(), all = [];
        mine.concat(body.history).sort((a, b) => a.at - b.at).forEach(e => { const k = e.id + "|" + Math.round(e.at / 60000); if (!seen.has(k)) { seen.add(k); all.push(e); } });
        await this.st.put("history", all.slice(-400));
      }
      if (body.queue) { await this.st.put("queue", body.queue); await this.st.put("handed", body.handed || null); await this.st.put("qAt", now); }
      if (body.handingFor) await this.st.put("queuedFor", body.handingFor);
      if (body.plan) await this.st.put("plan", body.plan);
      if (body.started) await this.st.put("started", body.started);
      if (body.leaving) await this.st.put("ping", 0); else await this.st.put("ping", now);
      // Hand back what happened while the app was away.
      const since = body.since || 0, acts = (await this.get("acts", [])).filter(a => a.at > since);
      const out = {
        ok: true, now, needLib: (await this.get("libHash", "")) !== body.libHash,
        acts, status: await this.status(),
        // If the helper changed the queue after the app last sent it, the app should take the helper's version.
        queue: helperNewer ? hQueue : null,
        handed: helperNewer ? hHanded : undefined
      };
      // Make sure the brain is awake to take over if the app goes quiet.
      const al = await this.st.getAlarm(); if (!al || body.leaving || al - now > 20000) await this.st.setAlarm(now + (body.leaving ? 2000 : 15000));
      return this.json(out);
    }
    if (url.pathname === "/status") return this.json({ ok: true, status: await this.status(), diag: await this.get("diag", []) });
    if (url.pathname === "/disconnect" && req.method === "POST") { await this.st.deleteAll(); return this.json({ ok: true }); }
    return this.json({ error: "unknown" }, 404);
  }

  async status() {
    const ping = await this.get("ping", 0), a = await this.get("auth", null), last = await this.get("lastAct", null);
    return { connected: !!a, dead: !!(a && a.dead), appPresent: Date.now() - ping < PRESENT_MS, lastCheck: await this.get("lastCheck", 0), lastAct: last, lastNote: await this.get("lastNote", "") };
  }

  async note(s) { await this.st.put("lastNote", s); }

  // ----- the loop -----
  async alarm() {
    const now = Date.now(), next = ms => this.st.setAlarm(Date.now() + Math.max(3000, ms));
    try {
      const a = await this.get("auth", null);
      if (!a || a.dead) return;                                          // not connected: sleep until the app connects
      // While the app is open, check back every 15 s, so a locked phone (which may not say goodbye) is noticed fast.
      if (now - (await this.get("ping", 0)) < PRESENT_MS) { await this.note("Standing by — the app is open"); return next(15000); }
      await this.st.put("lastCheck", now);
      let p;
      try { p = await this.sp("/me/player"); }
      catch (e) { await this.note(e.rate ? "Spotify busy — waiting" : "Couldn't reach Spotify: " + e.message); return next(e.rate ? Math.min(e.rate, 300) * 1000 : 60000); }
      if (!p || !p.item || p.item.type !== "track") {
        const idle = await this.get("idleSince", now); if (!(await this.get("idleSince", 0))) await this.st.put("idleSince", now);
        await this.note("Nothing playing");
        return next(now - idle > 30 * 60000 ? 5 * 60000 : 60000);       // back off when nothing has played for a while
      }
      await this.st.delete("idleSince");
      const item = p.item, left = item.duration_ms - (p.progress_ms || 0);
      // A new track started: record it, and clear it from the queue / handed slot.
      if ((await this.get("lastSeen", null)) !== item.id) {
        await this.st.put("lastSeen", item.id);
        const q = await this.get("queue", []), handed = await this.get("handed", null);
        if (handed === item.id) { await this.st.put("handed", null); await this.st.put("helperQAt", now); }
        else if (q[0] === item.id) { q.shift(); await this.st.put("queue", q); await this.st.put("helperQAt", now); }
        await this.act({ at: now - (p.progress_ms || 0), type: "play", id: item.id, title: item.name, artist: (item.artists || []).map(x => x.name).join(", ") });
      }
      if (!p.is_playing) { await this.note("Paused"); return next(60000); }
      // Keep exactly one track lined up at all times, and look every 15 s, so skipping (on the lock screen,
      // in Spotify, on the speaker) never runs the queue dry and lets Spotify fall back to an old track.
      const soon = Math.min(15000, Math.max(3000, left + 2000));
      if ((await this.get("queuedFor", null)) === item.id) { await this.note("Playing — next track already lined up"); return next(soon); }
      const handed = await this.get("handed", null);
      if (handed && handed !== item.id) { await this.st.put("queuedFor", item.id); await this.note("Playing — next track already lined up"); return next(soon); }
      const pick = await this.choose(item.id);
      if (!pick) { await this.note("Nothing suitable to line up"); await this.st.put("queuedFor", item.id); return next(soon); }
      try { await this.sp("/me/player/queue?uri=" + encodeURIComponent("spotify:track:" + pick.id), { method: "POST" }); }
      catch (e) { await this.note("Couldn't queue: " + e.message); return next(e.rate ? 15000 : 20000); }
      await this.st.put("queuedFor", item.id); await this.st.put("handed", pick.id); await this.st.put("helperQAt", now);
      if (pick.fromQueue) { const q = await this.get("queue", []); if (q[0] === pick.id) q.shift(); await this.st.put("queue", q); }
      await this.act({ at: now, type: "queue", id: pick.id, after: item.id, why: pick.why });
      await this.note("Lined up the next track");
      return next(soon);
    } catch (e) {
      await this.log("Error: " + (e && e.message)); return next(60000);
    }
  }

  async act(a) {
    const l = await this.get("acts", []); l.push(a); await this.st.put("acts", l.slice(-200));
    await this.st.put("lastAct", a);
    if (a.type === "play") { const h = await this.get("history", []); h.push({ id: a.id, title: a.title, artist: a.artist, at: a.at, src: "helper" }); await this.st.put("history", h.slice(-400)); }
  }

  // Your queue first; otherwise (with Auto-pick on) the best fit for what's playing.
  async choose(playingId) {
    const q = await this.get("queue", []), set = await this.get("settings", {});
    if (q.length) return { id: q[0], fromQueue: true, why: "your queue" };
    if (set.autoPick === false) return null;
    // 1) The app's plan — the same picks you saw in Suggested next. Follow it while it matches what's playing.
    const plan = await this.get("plan", []), hist = await this.get("history", []), heard = new Set(hist.slice(-60).map(e => e.id));
    const step = plan.find(([after, nxt]) => after === playingId && !heard.has(nxt));
    if (step) return { id: step[1], why: "your plan" };
    // 2) Off the plan (Spotify played something else): pick fresh with the same rules.
    const lib = await this.library(); if (!lib.length) return null;
    let from = this._byId.get(playingId);
    if (!from || !from.key) {                                            // playing track has no key: follow the last one that did (3 h)
      const h = await this.get("history", []);
      for (let i = h.length - 1; i >= 0; i--) { if (Date.now() - h[i].at > 3 * 3600e3) break; const r = this._byId.get(h[i].id); if (r && r.key) { from = r; break; } }
    }
    if (!from || !from.key) return null;
    // No repeats within the flow (an hour's gap or a "Start a new flow" tap ends it).
    const h = await this.get("history", []), breaks = set.flowBreaks || [], skip = new Set([playingId, ...(await this.get("started", []))]);
    for (let i = h.length - 1; i >= 0; i--) {
      if (i < h.length - 1 && (h[i + 1].at - h[i].at > GAP || breaks.some(b => h[i].at < b && b <= h[i + 1].at))) break;
      if (Date.now() - h[i].at > 8 * 3600e3) break; skip.add(h[i].id);
    }
    const best = pickNext(lib, from, set, skip);
    return best ? { id: best.t.id, why: best.why } : null;
  }
}
