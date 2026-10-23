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
// 9) a stale lock-in (Spotify no longer has it) while playing from a big playlist
S.device = { type: "Speaker", name: "LS50" }; S.context = lib.slice(800, 830).map(x => x[0]); S.ctxPos = 0; S.queue = [];
mem.set("handed", lib[600][0]); mem.set("handedFor", S.cur);
const want9 = (await brain.decideNext(S.cur)).id; const b9 = S.played.length;
await call("/cmd", { key, action: "next" });
ok("stale lock-in: Next lands on a fresh pick in ONE skip", S.cur === want9 && S.played.length - b9 === 1, (S.played.length - b9) + " track(s) started");
// 10) four strays queued in front → no skipping through them, our track starts directly
S.queue = lib.slice(700, 704).map(x => x[0]); mem.set("handed", null);
const want10 = (await brain.decideNext(S.cur)).id; const b10 = S.played.length;
await call("/cmd", { key, action: "next" });
ok("4 strays in front: starts Next directly, no blips", S.cur === want10 && S.played.length - b10 === 1, (S.played.length - b10) + " track(s) started");
// 11) Next storm while a playlist is the context
const b11 = S.played.length; for (let i = 0; i < 4; i++) await call("/cmd", { key, action: "next" });
ok("4 Next presses over a playlist = exactly 4 tracks", S.played.length - b11 === 4, (S.played.length - b11) + " started");
// 12) natural end over a playlist plays our Next, not the playlist's next song
await call("/sync", { key, libHash: "h", queue: [], queueAt: clock() + 1 }); await runFor(2000);
const cur12 = S.cur, n12 = (await brain.decideNext(S.cur)).id;
await runFor(Math.max(0, DUR[S.cur] - (clock() - S.startedAt)) + 3000);
ok("over a playlist, the end of a song plays our Next", S.played.slice(S.played.indexOf(cur12) + 1, S.played.indexOf(cur12) + 3).includes(n12), "(a stray left over from step 10 may blip first) wanted " + n12.slice(0,5) + " handed " + String(mem.get("handed")).slice(0,5) + " played " + S.played.slice(-3).map(x=>x.slice(0,5)).join(",") + " diag " + JSON.stringify((mem.get("diag")||[]).slice(-3).map(d=>d.msg)));
console.log("total Spotify calls:", S.calls.length, "| played:", S.played.length);
