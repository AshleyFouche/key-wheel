// ASH//FLOW helper — keeps the music going while the app is closed.
//
// One Durable Object ("the brain") holds a copy of your plan: library (keys, BPM, genres, playlists),
// queue, settings and recent plays. While the app pings it (every 30 s), it stands by. When the pings
// stop, it wakes itself with alarms, asks Spotify what's playing, and ~90 s before the end of each
// track hands Spotify the next one: your queue first, then Auto-pick's choice (same rules as the app).

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";
const HAND_MS = 15000;              // hand "Next" to Spotify this long before the end of the track
const CMD_QUIET_MS = 8000;
const SESSION_IDLE_MS = 3 * 3600e3;   // no contact from the app for this long → the brain steps back          // after a Next / Play command, don't second-guess what Spotify plays
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
    out.sort((a, b) => (set.dir || "any") === "any" ? (exact(b) - exact(a) || b.sc - a.sc) : (b.sc - a.sc));
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

// ---------- the brain: the ONLY thing that changes what Spotify plays next ----------
//
// Rules
//  • Spotify's queue holds at most ONE track from us: "Next", handed over 15 s before the current track ends.
//  • Next = the head of your queue; otherwise the app's #1 suggestion for the playing track (sent by the app);
//    otherwise the app's plan; otherwise the brain's own pick with the same rules.
//  • The Next button and Play now come here as commands, so nothing else ever queues or skips.
//  • A track you queued is removed from your queue when it starts playing (the app does the same).
//  • If Spotify falls back to a track already played this flow (its own playlist), the brain skips to Next.
export class Brain {
  constructor(state, env) { this.state = state; this.st = state.storage; this.env = env; this.lock = Promise.resolve(); }

  json(o, status = 200) { return new Response(JSON.stringify(o), { status }); }
  async get(k, d) { const v = await this.st.get(k); return v === undefined ? d : v; }
  async log(msg) { const l = await this.get("diag", []); l.push({ at: Date.now(), msg }); await this.st.put("diag", l.slice(-60)); }
  // One thing at a time: commands and the background loop never interleave.
  serial(fn) { const p = this.lock.then(fn, fn); this.lock = p.catch(() => {}); return p; }

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
    const tk = await this.access(); if (!tk) { const e = new Error("The helper isn't signed in to Spotify"); e.code = "auth"; throw e; }
    const r = await fetch(API + path, Object.assign({}, opts, { headers: { Authorization: "Bearer " + tk, "Content-Type": "application/json" } }));
    if (r.status === 204 || r.status === 202) return null;
    if (r.status === 429) { const e = new Error("Spotify is busy"); e.rate = parseInt(r.headers.get("Retry-After") || "10", 10); throw e; }
    const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
    if (!r.ok) { const e = new Error((j && j.error && (j.error.message || j.error)) || ("Spotify error " + r.status)); e.status = r.status; e.reason = j && j.error && j.error.reason;
      if (path !== "/me/player/queue" || (opts.method || "GET") !== "GET") await this.log(`${opts.method || "GET"} ${path.split("?")[0]} → ${r.status} ${e.message}${e.reason ? " (" + e.reason + ")" : ""}`);
      throw e; }
    return j;
  }
  async player() {
    const p = await this.sp("/me/player");
    if (!p || !p.item || p.item.type !== "track") return null;
    return { id: p.item.id, title: p.item.name, artist: (p.item.artists || []).map(x => x.name).join(", "), dur: p.item.duration_ms, prog: p.progress_ms || 0, playing: !!p.is_playing, device: p.device || {}, at: Date.now(),
      noSkip: !!(p.actions && p.actions.disallows && p.actions.disallows.skipping_next) };
  }
  // Spotify's up-next list: tracks queued by apps first, then the playlist it's playing from.
  // Skip; if Spotify refuses ("Restriction violated" — it happens with some speakers and single-track play),
  // start the wanted track directly instead.
  async skipTo(p, target) {
    if (!p.noSkip) {
      try { await this.sp("/me/player/next", { method: "POST" }); return "skip"; }
      catch (e) { if (!(e.status === 403 || /restriction/i.test(e.message))) throw e; await this.log("Spotify refused to skip (" + e.message + ") — starting the track directly"); }
    }
    if (!target) throw new Error("Spotify won't skip here and there's nothing to start instead");
    const dev = p.device && p.device.id ? "?device_id=" + encodeURIComponent(p.device.id) : "";
    await this.sp("/me/player/play" + dev, { method: "PUT", body: JSON.stringify({ uris: ["spotify:track:" + target] }) });
    return "direct";
  }
  async upNext() { const j = await this.sp("/me/player/queue"); return ((j && j.queue) || []).filter(t => t && t.id).map(t => t.id); }
  async waitChange(fromId, ms = 5000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { await sleep(350); const p = await this.player().catch(() => null); if (p && p.id !== fromId) return p; }
    return null;
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

  // ----- HTTP -----
  async fetch(req) {
    const url = new URL(req.url), body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (url.pathname === "/" || url.pathname === "/health") return this.json({ ok: true, service: "ashflow-helper", engine: 5, connected: !!(await this.get("auth", null)) });
    if (url.pathname === "/connect" && req.method === "POST") return this.connect(body);
    const key = await this.get("key", null);
    if (!key || body.key !== key) return this.json({ error: "not connected" }, 401);
    if (url.pathname === "/sync") return this.serial(() => this.sync(body));
    if (url.pathname === "/cmd") return this.serial(() => this.cmd(body));
    if (url.pathname === "/status") return this.json({ ok: true, state: await this.view(), diag: await this.get("diag", []) });
    if (url.pathname === "/disconnect" && req.method === "POST") { await this.st.deleteAll(); return this.json({ ok: true }); }
    return this.json({ error: "unknown" }, 404);
  }

  async connect(body) {
    if (!body.refresh) return this.json({ error: "missing sign-in" }, 400);
    const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: body.refresh, client_id: this.env.SPOTIFY_CLIENT_ID }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return this.json({ error: "Spotify didn't accept the sign-in: " + (j.error_description || j.error || r.status) }, 400);
    const me = await (await fetch(API + "/me", { headers: { Authorization: "Bearer " + j.access_token } })).json().catch(() => ({}));
    const prev = await this.get("auth", null), key = await this.get("key", null);
    if (prev && prev.user && me.id && prev.user !== me.id && body.key !== key) return this.json({ error: "This helper belongs to a different Spotify account." }, 403);
    await this.st.put("auth", { refresh: j.refresh_token || body.refresh, access: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000, user: me.id || null, name: me.display_name || "" });
    const nk = crypto.randomUUID() + crypto.randomUUID();
    await this.st.put("key", nk);
    await this.log("Connected for " + (me.display_name || me.id || "you"));
    await this.st.setAlarm(Date.now() + 3000);
    return this.json({ ok: true, key: nk, name: me.display_name || me.id });
  }

  // The app shares its plan; the brain answers with what it's doing.
  async sync(b) {
    const now = Date.now();
    if ((await this.get("engine", 1)) < 5) { await this.st.put("session", { on: false, at: Date.now(), why: "engine 5: off until you use Ashflow" }); await this.st.put("engine", 5); }
    if ((await this.get("engine", 1)) < 4) { for (const k of ["handed", "handedFor", "queuedFor", "ping", "verified", "lastSeen", "plan", "appNext", "strays", "cur"]) await this.st.delete(k); await this.st.put("engine", 4); await this.log("Engine 4: cleared old state"); }
    if (b.library && b.libHash) await this.putLibrary(b.library, b.libHash);
    if (b.settings) await this.st.put("settings", b.settings);
    if (b.started) await this.st.put("started", b.started);
    if (b.history) {
      const mine = await this.get("history", []), seen = new Set(), all = [];
      mine.concat(b.history).sort((x, y) => x.at - y.at).forEach(e => { const k = e.id + "|" + Math.round(e.at / 60000); if (!seen.has(k)) { seen.add(k); all.push(e); } });
      await this.st.put("history", all.slice(-400));
    }
    // Queue: the app's copy wins unless the brain changed it (a queued track started) after the app last sent it.
    const bq = await this.get("qAt", 0), brainNewer = bq > (b.queueAt || 0);
    if (Array.isArray(b.queue) && !brainNewer) await this.st.put("queue", b.queue);
    if (b.next !== undefined) await this.st.put("appNext", b.next);            // { id, for } — the app's #1 for the playing track
    if (b.plan) await this.st.put("plan", b.plan);
    if (b.engage) await this.startSession("you changed your queue in Ashflow");
    else if (!(await this.inSession()) && (await this.get("handed", null))) await this.forgetHanded();   // clears leftovers like a week-old "Strobe"
    await this.st.put("seen", now);
    const al = await this.st.getAlarm(); if (!al || al - now > 20000) await this.st.setAlarm(now + 1000);
    const acts = (await this.get("acts", [])).filter(a => a.at > (b.since || 0));
    return this.json({ ok: true, now, needLib: (await this.get("libHash", "")) !== b.libHash, acts, state: await this.view(),
      queue: brainNewer ? await this.get("queue", []) : null });
  }

  async view() {
    const a = await this.get("auth", null);
    const ss = await this.get("session", null);
    return { engine: 5, session: !!(ss && ss.on), sessionWhy: ss ? ss.why : "", connected: !!a, dead: !!(a && a.dead), cur: await this.get("cur", null), handed: await this.get("handed", null),
      handedFor: await this.get("handedFor", null), lastCheck: await this.get("lastCheck", 0), note: await this.get("note", ""), lastAct: await this.get("lastAct", null) };
  }
  async note(s) { await this.st.put("note", s); }
  async act(a) {
    a.at = a.at || Date.now();
    const l = await this.get("acts", []); l.push(a); await this.st.put("acts", l.slice(-200)); await this.st.put("lastAct", a);
    if (a.type === "play") { const h = await this.get("history", []); h.push({ id: a.id, title: a.title, artist: a.artist, at: a.at, src: "helper" }); await this.st.put("history", h.slice(-400)); }
  }

  // Which track should follow `curId`?
  async decideNext(curId) {
    const q = await this.get("queue", []);
    if (q.length && q[0] !== curId) return { id: q[0], why: "your queue" };
    const set = await this.get("settings", {});
    if (set.autoPick === false) return null;
    const an = await this.get("appNext", null), flow = await this.flowIds();
    if (an && an.for === curId && an.id && an.id !== curId && !flow.has(an.id)) return { id: an.id, why: "your #1 suggestion" };
    const plan = await this.get("plan", []), heard = new Set((await this.get("history", [])).slice(-60).map(e => e.id));
    const step = plan.find(([after, nxt]) => after === curId && !heard.has(nxt));
    if (step) return { id: step[1], why: "your plan" };
    const lib = await this.library(); if (!lib.length) return null;
    let from = this._byId.get(curId);
    const h = await this.get("history", []);
    if (!from || !from.key) { for (let i = h.length - 1; i >= 0; i--) { if (Date.now() - h[i].at > 3 * 3600e3) break; const r = this._byId.get(h[i].id); if (r && r.key) { from = r; break; } } }
    if (!from || !from.key) return null;
    const breaks = set.flowBreaks || [], skip = new Set([curId, ...(await this.get("started", []))]);
    for (let i = h.length - 1; i >= 0; i--) {
      if (i < h.length - 1 && (h[i + 1].at - h[i].at > GAP || breaks.some(x => h[i].at < x && x <= h[i + 1].at))) break;
      if (Date.now() - h[i].at > 8 * 3600e3) break; skip.add(h[i].id);
    }
    const best = pickNext(lib, from, set, skip);
    return best ? { id: best.t.id, why: best.why } : null;
  }
  async flowIds() {
    const h = await this.get("history", []), set = await this.get("settings", {}), breaks = set.flowBreaks || [], out = new Set();
    for (let i = h.length - 1; i >= 0; i--) {
      if (i < h.length - 1 && (h[i + 1].at - h[i].at > GAP || breaks.some(x => h[i].at < x && x <= h[i + 1].at))) break;
      out.add(h[i].id);
    }
    return out;
  }

  // A new track started: bookkeeping, and keep a pending hand-over as the new Next (it's still in Spotify's queue).
  // A session = you're using Ashflow. It starts when you press Next / Play / Previous or change your queue in the app,
  // and ends the moment Spotify plays something Ashflow didn't choose (you took over in Spotify), or after 3 quiet hours.
  // Outside a session the brain does NOTHING to Spotify — it only watches.
  async inSession() {
    const ss = await this.get("session", null);
    if (!ss || !ss.on) return false;
    if (Date.now() - Math.max(ss.at || 0, await this.get("seen", 0)) > SESSION_IDLE_MS) { await this.endSession("no contact from the app for 3 hours"); return false; }
    return true;
  }
  async startSession(why) { const ss = await this.get("session", null); if (!ss || !ss.on) await this.log("Session on — " + why); await this.st.put("session", { on: true, at: Date.now(), why }); }
  async endSession(why) { const ss = await this.get("session", null); if (ss && ss.on) await this.log("Stepped back — " + why); await this.st.put("session", { on: false, at: Date.now(), why }); await this.forgetHanded(); }
  // Drop any memory of a track we handed to Spotify — once we're not in charge, it's not ours to track.
  async forgetHanded() { if (await this.get("handed", null)) await this.log("Forgot old hand-over"); for (const k of ["handed", "handedFor", "verified"]) await this.st.delete(k); }

  async onNewTrack(p, commanded) {
    const prev = await this.get("cur", null), handed = await this.get("handed", null);
    await this.st.put("cur", { id: p.id, title: p.title, artist: p.artist, dur: p.dur, startedAt: Date.now() - p.prog });
    const q = await this.get("queue", []);
    if (q[0] === p.id) { q.shift(); await this.st.put("queue", q); await this.st.put("qAt", Date.now()); }
    const wasHeard = (await this.flowIds()).has(p.id);
    await this.act({ type: "play", id: p.id, title: p.title, artist: p.artist, at: Date.now() - p.prog });
    if (handed === p.id) { await this.st.put("handed", null); await this.st.put("handedFor", null); }
    else if (handed && !commanded) await this.forgetHanded();                    // Spotify moved on without it: it's not "ours" any more
    else if (handed) await this.st.put("handedFor", p.id);                      // mid-skip: still waiting in Spotify, it's this track's Next now
    // Something started that Ashflow didn't choose (not our Next, not a command): you're driving from Spotify now.
    // Step back — never skip it, never "correct" it.
    if (!commanded && handed !== p.id && prev && prev.id !== p.id && (await this.inSession())) {
      await this.endSession("Spotify played " + p.title + ", which Ashflow didn't choose");
    }
  }

  // Skip to Next, making sure Next is what actually plays.
  // 1) Check Spotify really still has our locked-in track; if not, forget it and choose again.
  // 2) Find where our track sits in Spotify's up-next list. Right at the front: one skip.
  //    A few strays in front (tracks something else queued): skip exactly those. Deeper or missing: start it directly.
  async goNext(p, why) {
    // Some speakers (e.g. the LS50) don't report Spotify's queue reliably, so the listing is only a hint:
    // a track we handed over for THIS song is trusted; we never queue the same track twice.
    let handed = await this.get("handed", null), handedFor = await this.get("handedFor", null), target = null, d = null;
    let up = await this.upNext().catch(() => null);
    // "Ghosts": tracks Spotify's listing claimed were queued, but which never arrived. Don't believe the listing about them.
    const ghosts = new Set(await this.get("ghosts", []));
    if (up) up = up.filter(id => !ghosts.has(id));
    // Trust our hand-over if Spotify lists it — or if Spotify lists nothing at all (some speakers don't report the queue).
    if (handed && ((up && up.includes(handed)) || (handedFor === p.id && (!up || !up.length || ghosts.has(handed))))) target = handed;
    else {
      if (handed) { await this.st.put("handed", null); await this.st.put("handedFor", null); }
      d = await this.decideNext(p.id);
      if (d) {
        target = d.id;
        if (!up || !up.includes(d.id)) { await this.sp("/me/player/queue?uri=" + encodeURIComponent("spotify:track:" + d.id), { method: "POST" }); await sleep(600); up = await this.upNext().catch(() => up); }
        await this.st.put("handed", d.id); await this.st.put("handedFor", p.id); await this.act({ type: "queue", id: d.id, after: p.id, why: d.why });
      }
    }
    const idx = target && up ? up.indexOf(target) : -1;
    if (idx > 0) await this.addStrays(up.slice(0, idx));
    let now = null, strays = 0, direct = false;
    if (idx > 3) {
      // Lots of strays in front: start ours directly (if the speaker allows it).
      try { const dev = p.device && p.device.id ? "?device_id=" + encodeURIComponent(p.device.id) : "";
        await this.sp("/me/player/play" + dev, { method: "PUT", body: JSON.stringify({ uris: ["spotify:track:" + target] }) }); direct = true; now = await this.waitChange(p.id); }
      catch (e) { now = null; }
    }
    if (!direct) {
      // Skip, one track at a time, until ours plays (at most past the strays we know about).
      let from = p.id;
      const maxSkips = idx >= 0 ? idx + 1 : 1;     // unknown position: one skip, never a blind run
      for (let k = 0; k < maxSkips; k++) {
        try { await this.safeNext(from); }
        catch (e) {
          if (!target || !(e.status === 403 || /restriction/i.test(e.message))) throw e;
          // Spotify keeps refusing to skip: start our track directly as a last resort.
          await this.log("Skip refused three times — starting the next track directly");
          const dev = p.device && p.device.id ? "?device_id=" + encodeURIComponent(p.device.id) : "";
          await this.sp("/me/player/play" + dev, { method: "PUT", body: JSON.stringify({ uris: ["spotify:track:" + target] }) }); direct = true;
          now = await this.waitChange(from); break;
        }
        now = await this.waitChange(from); if (!now) break;
        from = now.id; if (!target || now.id === target) break; strays++;
        // Before skipping again, check Spotify's listing agrees our track is now closer. If it doesn't, the listing
        // can't be trusted: stop here (one press = one track), and put our track back in properly for next time.
        const up2 = await this.upNext().catch(() => null), i2 = up2 ? up2.indexOf(target) : -1;
        if (!(i2 >= 0 && idx >= 0 && i2 < idx - (k))) {
          if (!up2 || !up2.length) break;           // speaker shows no queue at all: just stop, don't add duplicates
          ghosts.add(target); await this.st.put("ghosts", [...ghosts].slice(-30));
          await this.log("Spotify's queue listing was wrong about the next track — re-adding it");
          await this.sp("/me/player/queue?uri=" + encodeURIComponent("spotify:track:" + target), { method: "POST" });
          await this.st.put("handed", target); await this.st.put("handedFor", now.id);
          break;
        }
      }
    }
    if (now) await this.onNewTrack(now, true);
    if (direct && now && now.id === target) { await this.st.put("handed", null); await this.st.put("handedFor", null); }
    await this.st.put("cmdAt", Date.now()); await this.st.put("cmdTarget", now ? now.id : target);
    if (target && now && now.id !== target) await this.log(`Wanted ${target} but Spotify played ${now.id}`);
    return { now, target, strays, why, direct };
  }
  // "next", retried once after a short pause: speakers sometimes refuse ("Restriction violated") while they're
  // still taking in a track that was just queued.
  async safeNext(fromId) {
    for (let t = 0; t < 3; t++) {
      try { await this.sp("/me/player/next", { method: "POST" }); return; }
      catch (e) { if (!(e.status === 403 || /restriction/i.test(e.message)) || t === 2) throw e; await sleep(900 + t * 600); const p = await this.player().catch(() => null); if (p && p.id !== fromId) return; }
    }
  }

  // Strays: tracks sitting in Spotify's queue in front of ours that nobody chose now (left by older versions,
  // or queued in the Spotify app). When one starts by itself, the brain skips it straight to Next.
  async addStrays(ids) { const cur = new Set(await this.get("strays", [])); ids.forEach(x => cur.add(x)); await this.st.put("strays", [...cur].slice(-50)); }

  async cmd(b) {
    try {
      const p = await this.player();
      await this.startSession("you pressed " + b.action + " in Ashflow");
      if (b.next && b.next.id && b.next.for) await this.st.put("appNext", b.next);
      if (b.action === "next") {
        if (!p) { await this.sp("/me/player/next", { method: "POST" }).catch(() => {}); return this.json({ ok: true, state: await this.view() }); }
        if ((await this.get("cur", {})).id !== p.id) await this.onNewTrack(p, true);
        const r = await this.goNext(p, "next button");
        await this.st.setAlarm(Date.now() + 2000);
        return this.json({ ok: true, playing: r.now && r.now.id, wanted: r.target, strays: r.strays, state: await this.view() });
      }
      if (b.action === "prev") {
        // You asked for the previous song: do it here, and remember it was asked for,
        // so the brain doesn't mistake the old song for Spotify falling back and skip forward again.
        await this.sp("/me/player/previous", { method: "POST" });
        const now = p ? await this.waitChange(p.id, 3000) : null;   // no change = Spotify just restarted the song
        if (now) await this.onNewTrack(now, true);
        await this.st.put("cmdAt", Date.now()); await this.st.put("cmdTarget", now ? now.id : (p && p.id));
        await this.st.setAlarm(Date.now() + 2000);
        return this.json({ ok: true, playing: now ? now.id : p && p.id, state: await this.view() });
      }
      if (b.action === "play" && b.id) {
        const handed = await this.get("handed", null);
        if (p && p.device && p.device.id) await this.st.put("lastDev", p.device.id);
        const dev = (p && p.device && p.device.id) || (await this.get("lastDev", null));
        const playUrl = "/me/player/play" + (dev ? "?device_id=" + encodeURIComponent(dev) : "");
        if (!p || !p.playing || (p.device && p.device.type === "Smartphone" && handed)) {
          // Start it directly, on the device Spotify was last using. (On the iPhone with something already lined up, direct play is the only clean way.)
          await this.sp(playUrl, { method: "PUT", body: JSON.stringify({ uris: ["spotify:track:" + b.id] }) });
        } else if (p.device && p.device.type === "Smartphone") {
          // Direct play has knocked the iPhone off Spotify before: queue it and skip to it instead.
          await this.sp("/me/player/queue?uri=" + encodeURIComponent("spotify:track:" + b.id), { method: "POST" }); await sleep(250);
          await this.skipTo(p, b.id);
        } else {
          await this.sp("/me/player/play", { method: "PUT", body: JSON.stringify({ uris: ["spotify:track:" + b.id] }) });
        }
        const now = await this.waitChange(p ? p.id : null, 5000);
        if (now) await this.onNewTrack(now, true);
        // Did it really start? (Spotify can accept the command while the speaker does nothing.)
        const after = now || (await this.player().catch(() => null));
        const started = !!(after && after.id === b.id && after.playing);
        if (!started) await this.log("Play: Spotify accepted it but " + (after ? "is on " + after.title + (after.playing ? "" : " (paused)") : "nothing is playing") + " — the app will try itself");
        await this.st.put("cmdAt", Date.now()); await this.st.put("cmdTarget", now ? now.id : b.id); await this.st.setAlarm(Date.now() + 2000);
        return this.json({ ok: true, playing: after && after.id, started, state: await this.view() });
      }
      return this.json({ error: "unknown command" }, 400);
    } catch (e) {
      await this.log("Command " + b.action + " failed: " + e.message);
      return this.json({ error: e.message, reason: e.reason || null, status: e.status || null }, 502);
    }
  }

  // ----- the loop: watch the track, hand Next over 15 s before the end -----
  async alarm() {
    return this.serial(() => this.tick());
  }
  async tick() {
    const next = ms => this.st.setAlarm(Date.now() + Math.max(1500, ms));
    try {
      const a = await this.get("auth", null);
      if (!a || a.dead) return;
      await this.st.put("lastCheck", Date.now());
      let p;
      try { p = await this.player(); }
      catch (e) { await this.note(e.rate ? "Spotify busy — waiting" : "Couldn't reach Spotify: " + e.message); return next(e.rate ? Math.min(e.rate, 120) * 1000 : 30000); }
      if (!p) { await this.note("Nothing playing"); const idle = Date.now() - (await this.get("seen", 0)); return next(idle > 30 * 60000 ? 5 * 60000 : 30000); }
      const cur = await this.get("cur", null);
      // Only the track a command just asked for counts as "commanded"; anything else that starts is Spotify's own doing.
      if (!cur || cur.id !== p.id) await this.onNewTrack(p, Date.now() - (await this.get("cmdAt", 0)) < CMD_QUIET_MS && p.id === (await this.get("cmdTarget", null)));
      if (!(await this.inSession())) { await this.note("Standing back — Spotify is in charge until you use Ashflow"); return next(60000); }
      if (!p.playing) { await this.note("Paused"); return next(30000); }
      const left = p.dur - p.prog;
      const handedFor = await this.get("handedFor", null), handed = await this.get("handed", null);
      if (handed && handedFor === (await this.get("cur", {})).id) {
        if (left <= HAND_MS + 5000 && !(await this.get("verified", null) === handed)) {
          const up = await this.upNext().catch(() => null);
          if (up && up.length && !up.includes(handed)) { await this.log("Locked-in track missing from Spotify's queue — handing over again"); await this.st.put("handed", null); await this.st.put("handedFor", null); return next(500); }
          await this.st.put("verified", handed);
        }
        await this.note("Next is lined up"); return next(left > 25000 ? Math.min(20000, left - 20000) : left + 2500);
      }
      if (left <= HAND_MS + 3000) {
        const d = await this.decideNext(p.id);
        if (!d) { await this.note("Nothing suitable to line up"); return next(left + 2500); }
        let up0 = await this.upNext().catch(() => null);
        try { if (!up0 || !up0.includes(d.id)) await this.sp("/me/player/queue?uri=" + encodeURIComponent("spotify:track:" + d.id), { method: "POST" }); }
        catch (e) { await this.note("Couldn't line up the next track: " + e.message); return next(3000); }
        const up1 = await this.upNext().catch(() => null), pos = up1 ? up1.indexOf(d.id) : -1;
        if (pos > 0) await this.addStrays(up1.slice(0, pos));
        await this.st.put("handed", d.id); await this.st.put("handedFor", p.id);
        await this.act({ type: "queue", id: d.id, after: p.id, why: d.why });
        await this.note("Next is lined up");
        return next(left + 2500);
      }
      await this.note("Playing — Next goes to Spotify 15 s before the end");
      // Check every 20 s (to notice skips), and wake just before the hand-over point.
      return next(Math.min(20000, left - HAND_MS - 2000));
    } catch (e) { await this.log("Error: " + (e && e.message)); return next(30000); }
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
