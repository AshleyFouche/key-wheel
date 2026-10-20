// Genres for ASH//FLOW: fine Discogs styles per track, grouped into a handful of broad families.
// Families do the filtering and suggesting; fine styles are for display and tie-breaking.
(function () {
  // Eight families get the eight validated chart colours (reference order); the rest share a neutral grey.
  const FAMILIES = [
    { id: "house", name: "House", col: "#3987e5" },
    { id: "techhouse", name: "Tech House", col: "#d95926" },
    { id: "deep", name: "Deep House", col: "#199e70" },
    { id: "minimal", name: "Minimal & Dub", col: "#c98500" },
    { id: "prog", name: "Progressive & Trance", col: "#d55181" },
    { id: "down", name: "Downtempo & Leftfield", col: "#008300" },
    { id: "techno", name: "Techno", col: "#9085e9" },
    { id: "ukg", name: "UK Garage & Bass", col: "#e66767" },
    { id: "breaks", name: "Breaks & Electro", col: "#6f6a76" },
    { id: "dnb", name: "Drum & Bass", col: "#6f6a76" },
    { id: "disco", name: "Disco & Funk", col: "#6f6a76" },
    { id: "other", name: "Other", col: "#6f6a76" }
  ];
  const FAM = Object.fromEntries(FAMILIES.map(f => [f.id, f]));

  // Discogs style → family (lower-case keys).
  const STYLE = {};
  const put = (fam, list) => list.forEach(s => STYLE[s.toLowerCase()] = fam);
  put("house", ["House", "Funky House", "Tribal House", "Hard House", "Garage House", "Italo House", "Ghetto House", "Hip-House", "Acid House", "Latin", "Electro House", "Dance-pop", "Euro House", "Vocal", "Jackin House", "Afro House", "Amapiano", "Ballroom", "Bass House", "Melodic House", "Organic House", "Lo-Fi House", "Piano House"]);
  put("deep", ["Deep House"]);
  put("techhouse", ["Tech House"]);
  put("techno", ["Techno", "Hard Techno", "Acid", "Industrial", "EBM", "Schranz", "Hardcore", "Gabber", "Happy Hardcore", "Hardstyle", "Detroit Techno", "Peak Time Techno", "Raw Techno", "Hypnotic Techno", "Melodic Techno"]);
  put("minimal", ["Minimal", "Minimal Techno", "Microhouse", "Dub Techno", "Glitch", "Clicks & Cuts"]);
  put("prog", ["Progressive House", "Progressive Trance", "Trance", "Psy-Trance", "Goa Trance", "Hard Trance", "Tech Trance", "Euro-Trance", "Balearic", "Dream House"]);
  put("down", ["Downtempo", "Leftfield", "Ambient", "Abstract", "Trip Hop", "Experimental", "IDM", "Chillwave", "Electronica", "Dub", "Illbient", "Future Jazz", "Broken Beat", "Lo-Fi", "Synth-pop", "Indie Rock", "Neo Soul", "Instrumental"]);
  put("ukg", ["UK Garage", "Speed Garage", "2-Step", "Bassline", "Dubstep", "Grime", "UK Funky", "Future Garage", "Bass Music", "Juke", "Footwork", "Garage"]);
  put("breaks", ["Breakbeat", "Breaks", "Electro", "Big Beat", "Nu Skool Breaks", "Miami Bass", "Freestyle", "Ghetto"]);
  put("dnb", ["Drum n Bass", "Jungle", "Liquid Funk", "Halftime", "Neurofunk", "Darkstep", "Breakcore"]);
  put("disco", ["Disco", "Nu-Disco", "Italo-Disco", "Funk", "Boogie", "Soul", "Disco Polo", "Italodance", "Hi NRG", "Cosmic"]);

  // Pick a family from a style list: earlier styles count more.
  function familyOf(styles) {
    const score = {};
    (styles || []).forEach((s, i) => { const f = STYLE[String(s).toLowerCase()]; if (f) score[f] = (score[f] || 0) + (4 - Math.min(i, 3)); });
    const best = Object.keys(score).sort((a, b) => score[b] - score[a])[0];
    return best || "other";
  }
  // Spotify artist genres are free text ("minimal techno", "uk garage"): map by keyword, most specific first.
  function familyFromSpotify(genres) {
    const g = (genres || []).join(" | ").toLowerCase();
    if (!g) return null;
    const rules = [["deep house", "deep"], ["tech house", "techhouse"], ["minimal|microhouse|dub techno", "minimal"], ["drum and bass|jungle|liquid funk|neurofunk", "dnb"],
      ["uk garage|bassline|dubstep|grime|bass music|uk funky|footwork", "ukg"], ["progressive|trance", "prog"], ["breakbeat|big beat|electro(?! house)", "breaks"],
      ["techno|hard techno|acid", "techno"], ["disco|funk|boogie", "disco"], ["ambient|downtempo|trip hop|idm|electronica|leftfield|chill", "down"], ["house", "house"]];
    for (const [re, f] of rules) if (new RegExp(re).test(g)) return f;
    return "other";
  }

  // ---- matching a track to a Discogs release ----
  const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\(\d+\)|\*/g, "").replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
  function similar(a, b) {
    if (a === b) return 1; if (!a || !b) return 0;
    const m = a.length, n = b.length, row = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { let prev = row[0]; row[0] = i; for (let j = 1; j <= n; j++) { const t = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; } }
    return 1 - row[n] / Math.max(m, n);
  }
  const REMIX = /\b(remix|rmx|mix|edit|rework|version|dub|bootleg)\b/i;
  const baseTitle = t => String(t || "").replace(/\s*[-–]\s*(?:.*\b(?:remix|mix|edit|version|dub|rework|original|remaster(?:ed)?)\b.*)$/i, "").replace(/\s*[\(\[].*?[\)\]]\s*/g, " ").trim();
  // Discogs result titles look like "Artist - Release" (artist may carry "(4)", "*", "Ft. …", or be "Various").
  function artistOk(result, ourArtists) {
    const dArt = String(result.title || "").split(" - ")[0];
    if (/^various$/i.test(dArt.trim())) return true;            // compilation found via the track-artist search
    const parts = dArt.split(/\s*(?:,|&|\bft\.?|\bfeat\.?|\bfeaturing|\bvs\.?|\band\b|\bx\b)\s*/i).map(norm).filter(Boolean);
    return ourArtists.some(a => parts.some(p => p === a || similar(p, a) >= 0.85));
  }
  function pick(results, track) {
    const ours = String(track.artist || "").split(/\s*,\s*/).map(norm).filter(Boolean);
    const wantsRemix = REMIX.test(track.title || "");
    let ok = results.filter(r => artistOk(r, ours) && (r.style || []).length);
    if (!wantsRemix) { const plain = ok.filter(r => !/\bremix(es)?\b/i.test(r.title || "")); if (plain.length) ok = plain; }
    return ok;
  }

  // ---- the background job ----
  let ctx = null, running = false, stopReq = false;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function discogs(token, params) {
    const u = "https://api.discogs.com/database/search?" + new URLSearchParams(Object.assign({ type: "release", per_page: "8" }, params));
    let r;
    try { r = await fetch(u, { headers: { Authorization: "Discogs token=" + token } }); }
    catch (e) { const x = new Error("Discogs couldn't be reached"); x.code = "net"; throw x; }
    if (r.status === 401) { const x = new Error("Discogs didn't accept the token"); x.code = "token"; throw x; }
    if (r.status === 429) { await wait(8000); return discogs(token, params); }
    if (!r.ok) return [];
    return (await r.json()).results || [];
  }
  async function viaDiscogs(token, t) {
    const artist = String(t.artist || "").split(",")[0].trim(), title = baseTitle(t.title);
    let ok = pick(await discogs(token, { artist, track: title }), t); await wait(1100);
    if (!ok.length) { ok = pick(await discogs(token, { q: artist + " " + title }), t); await wait(1100); }
    if (!ok.length) return null;
    const count = {};
    ok.slice(0, 3).forEach((r, i) => (r.style || []).forEach(s => count[s] = (count[s] || 0) + (3 - i)));
    const styles = Object.keys(count).sort((a, b) => count[b] - count[a]).slice(0, 4);
    return { s: styles, f: familyOf(styles), src: "discogs", rel: ok[0].title || "" };
  }
  const artistCache = {};
  async function viaSpotify(t) {
    if (!ctx.Spotify.connected()) return null;
    try {
      const ids = await ctx.Spotify.trackArtistIds(t.id); if (!ids.length) return null;
      let g = artistCache[ids[0]]; if (!g) { g = artistCache[ids[0]] = await ctx.Spotify.artistGenres(ids[0]); }
      const f = familyFromSpotify(g); if (!f) return null;
      return { s: g.slice(0, 3).map(x => x.replace(/\b\w/g, c => c.toUpperCase())), f, src: "spotify" };
    } catch (e) { return null; }
  }

  function todo() {
    const done = ctx.store(), seen = new Set(), out = [];
    // Tracks you're most likely to look at first: recent plays and the crate, then everything else.
    const first = [...ctx.recentIds(), ...ctx.crateIds()];
    first.concat(ctx.allTracks().map(t => t.id)).forEach(id => { if (!seen.has(id) && !done[id]) { seen.add(id); const t = ctx.track(id); if (t) out.push(t); } });
    return out;
  }
  async function run() {
    if (running) return; running = true; stopReq = false;
    const token = ctx.token();
    try {
      const list = todo();
      for (let i = 0; i < list.length && !stopReq; i++) {
        const t = list[i];
        let g = null;
        if (token) { try { g = await viaDiscogs(token, t); } catch (e) { if (e.code === "token" || e.code === "net") { ctx.status(e.message + ". Paused."); break; } } }
        if (!g) g = await viaSpotify(t);
        ctx.save(t.id, g || { s: [], f: null, src: "none" });
        ctx.status(null);
      }
    } finally { running = false; ctx.status(null); }
  }

  window.FlowGenres = {
    FAMILIES, FAM, familyOf, familyFromSpotify, baseTitle, pick,
    init(c) { ctx = c; },
    start() { run(); }, stop() { stopReq = true; }, running: () => running, todoCount: () => todo().length
  };
})();
