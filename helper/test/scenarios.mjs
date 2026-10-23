// Simulated-Spotify scenarios for the brain. Run: node helper/test/scenarios.mjs — every line must say PASS.
import { S, startTrack, brain, call, runFor, rows, lib, mem, advance, clock, DUR } from "./sim.mjs";
const ok = (name, cond, info = "") => console.log((cond ? "PASS " : "FAIL ") + name + (info ? "  — " + info : ""));
const [, c] = await call("/connect", { refresh: "R1" }); const key = c.key;
await call("/sync", { key, libHash: "h", library: rows, settings: { autoPick: true, dir: "any" }, queue: [], history: [], started: [] });
const OLD = lib[0][0]; S.context = [OLD]; startTrack(lib[0][0]);          // like PUT play: single-track context = an old song
// 1) natural end, app open: app says #1 for track 0 is lib[1]
await call("/sync", { key, libHash: "h", next: { id: lib[1][0], for: lib[0][0] }, queueAt: 0 });
await runFor(260000);
ok("natural end plays the app's #1", S.played[1] === lib[1][0], S.played.slice(0, 3).map(x => x.slice(0, 5)).join(" → "));
// 2) one hour unattended: no stops, no repeats, never the old fallback song
const before = S.played.length; await runFor(3600000);
const hour = S.played.slice(before - 1);
ok("an hour unattended keeps playing", hour.length > 12, hour.length + " tracks");
ok("…never falls back to the old song", !hour.includes(OLD));
ok("…no repeats", new Set(S.played).size === S.played.length);
// 3) Next storm: 5 commands back to back
const b3 = S.played.length;
for (let i = 0; i < 5; i++) { const [st, r] = await call("/cmd", { key, action: "next" }); if (st !== 200) console.log("cmd error", r); }
const storm = S.played.slice(b3);
ok("5 quick Next presses = 5 new tracks", storm.length >= 5, storm.length + " played");
ok("…none old or repeated", !storm.includes(OLD) && new Set(S.played).size === S.played.length);
// 4) a stray left in Spotify's queue, then Next
S.queue.push(lib[200][0]);
const exp = await brain.decideNext(S.cur); await call("/cmd", { key, action: "next" });
ok("Next steps past a stray", S.cur === exp.id, "stray " + lib[200][0].slice(0, 5));
// 5) lock-screen skips (Spotify next, brain not told) twice in a row
const sim = async () => { const nxt = S.queue.length ? S.queue.shift() : S.context[S.ctxPos++ % S.context.length]; startTrack(nxt); };
await sim(); advance(2000); await sim(); await runFor(30000);
ok("lock-screen double skip: fallback song is corrected", S.cur !== OLD, "now " + S.cur.slice(0, 5) + (S.played.slice(-3).includes(OLD) ? " (old song blipped, then skipped)" : ""));
// 6) your queue wins
await call("/sync", { key, libHash: "h", queue: [lib[300][0], lib[301][0]], queueAt: clock() + 1 });
await runFor(DUR[S.cur] + 5000); await runFor(DUR[S.cur] + 5000);
ok("queued tracks play in order", S.played.slice(-2).join() === [lib[300][0], lib[301][0]].join(), S.played.slice(-2).map(x => x.slice(0, 5)).join(" → "));
const [, sy] = await call("/sync", { key, libHash: "h", queueAt: 0 });
ok("…and the app is told the queue is empty now", sy.queue && sy.queue.length === 0);
// 7) play now on a speaker keeps a lined-up Next
await runFor(Math.max(0, DUR[S.cur] - (clock() - S.startedAt) - 10000)); const handed = mem.get("handed");
await call("/cmd", { key, action: "play", id: lib[400][0] });
ok("Play now starts the track", S.cur === lib[400][0]);
await runFor(DUR[S.cur] + 3000);
ok("…and the already lined-up Next follows it", !handed || S.played.slice(-1)[0] === handed || S.played.includes(handed));
// 8) play now on the iPhone (queue + skip)
S.device = { type: "Smartphone", name: "iPhone" }; mem.set("handed", null);
await call("/cmd", { key, action: "play", id: lib[500][0] });
ok("Play now on iPhone uses queue+skip and lands", S.cur === lib[500][0]);
console.log("total Spotify calls:", S.calls.length, "| played:", S.played.length);
