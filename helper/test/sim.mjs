// Simulated clock + simulated Spotify (with its real quirks) to test the brain end to end.
let T0 = 1_800_000_000_000, now = T0;
const realSetTimeout = globalThis.setTimeout;
Date.now = () => now;
globalThis.setTimeout = (fn, ms = 0) => { now += ms; return realSetTimeout(fn, 0); };
const { Brain } = await import("../src/index.js");
import fs from "fs";
const lib = JSON.parse(fs.readFileSync(new URL("../../beta/library.json", import.meta.url))).tracks.filter(t => t[4] && t[3]);
const rows = lib.map(t => [t[0], t[4], t[3], null, [], t[8] || []]);
const DUR = Object.fromEntries(lib.map((t, i) => [t[0], 180000 + (i % 7) * 20000]));
export const S = { cur: null, startedAt: 0, playing: true, queue: [], context: [], ctxPos: 0, played: [], device: { type: "Speaker", name: "LS50" }, calls: [] };
export function startTrack(id) { S.cur = id; S.startedAt = now; S.played.push(id); }
function advanceNatural() {   // when the current track ends, Spotify plays queue first, then its context
  while (S.cur && S.playing && now - S.startedAt >= (DUR[S.cur] || 200000)) {
    const end = S.startedAt + (DUR[S.cur] || 200000);
    const nxt = S.queue.length ? S.queue.shift() : S.context[S.ctxPos++ % S.context.length];
    S.cur = nxt; S.startedAt = end; S.played.push(nxt);
  }
}
const res = (status, obj) => new Response(obj === undefined ? null : JSON.stringify(obj), { status });
globalThis.fetch = async (url, opts = {}) => {
  url = String(url); const m = (opts.method || "GET");
  if (url.includes("/api/token")) return res(200, { access_token: "A", refresh_token: "R", expires_in: 3600 });
  if (url.endsWith("/v1/me")) return res(200, { id: "ash", display_name: "Ash" });
  advanceNatural();
  S.calls.push(m + " " + url.replace("https://api.spotify.com/v1", ""));
  if (url.endsWith("/me/player") && m === "GET") return S.cur ? res(200, { is_playing: S.playing, progress_ms: now - S.startedAt, device: S.device, actions: { disallows: {} }, item: { type: "track", id: S.cur, name: "T" + S.cur.slice(0, 4), duration_ms: DUR[S.cur] || 200000, artists: [{ name: "A" }] } }) : res(204);
  if (url.endsWith("/me/player/queue") && m === "GET") { const ctxNext = []; for (let k = 0; k < 10 && S.context.length; k++) ctxNext.push(S.context[(S.ctxPos + k) % S.context.length]); return res(200, { queue: S.queue.concat(ctxNext).map(id => ({ type: "track", id })) }); }
  if (url.includes("/me/player/queue") && m === "POST") { S.queue.push(decodeURIComponent(url.split("uri=")[1]).split(":")[2]); return res(204); }
  if (url.includes("/me/player/next") && S.noSkip) return res(403, { error: { status: 403, message: "Player command failed: Restriction violated", reason: "UNKNOWN" } });
  if (url.includes("/me/player/next")) { const nxt = S.queue.length ? S.queue.shift() : S.context[S.ctxPos++ % S.context.length]; startTrack(nxt); return res(204); }
  if (url.includes("/me/player/play") && m === "PUT") { const b = JSON.parse(opts.body || "{}"); if (b.uris) { S.context = [b.uris[0].split(":")[2]]; S.ctxPos = 0; startTrack(S.context[0]); S.ctxPos = 1; } S.playing = true; return res(204); }
  return res(404, {});
};
export const mem = new Map(); export let alarmAt = null;
const st = { get: async k => mem.has(k) ? structuredClone(mem.get(k)) : undefined, put: async (k, v) => { mem.set(k, structuredClone(v)); }, delete: async k => mem.delete(k), deleteAll: async () => mem.clear(), getAlarm: async () => alarmAt, setAlarm: async t => { alarmAt = t; } };
export const brain = new Brain({ storage: st }, { SPOTIFY_CLIENT_ID: "x" });
export const call = async (path, body) => { const r = await brain.fetch(new Request("https://h" + path, { method: "POST", body: JSON.stringify(body) })); return [r.status, await r.json()]; };
export async function runFor(ms) { const end = now + ms; while (now < end) { if (alarmAt && alarmAt <= now) { alarmAt = null; await brain.alarm(); } else { now = Math.min(end, alarmAt || end); } } advanceNatural(); }
export const clock = () => now; export const advance = ms => { now += ms; };
export { rows, lib, DUR };
