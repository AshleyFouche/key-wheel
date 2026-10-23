import { S, startTrack, brain, call, runFor, rows, lib, mem, advance, clock, DUR } from "./sim.mjs";
const [, c] = await call("/connect", { refresh: "R1" }); const key = c.key;
await call("/sync", { key, libHash: "h", library: rows, settings: { autoPick: true }, queue: [], history: [] });
S.context = lib.slice(800, 830).map(x => x[0]); S.ctxPos = 0; startTrack(lib[5][0]);
await runFor(2000); console.log("cur", S.cur.slice(0,5), "elapsed", clock() - S.startedAt, "dur", DUR[S.cur]);
for (let i = 0; i < 30; i++) { await runFor(10000); console.log(Math.round((clock()-S.startedAt)/1000), S.cur.slice(0,5), "q", S.queue.map(x=>x.slice(0,5)).join(","), "handed", String(mem.get("handed")).slice(0,5), mem.get("note")); if (S.played.length > 2) break; }
console.log(S.played.map(x=>x.slice(0,5)).join(" → "), (mem.get("diag")||[]).map(d=>d.msg));
