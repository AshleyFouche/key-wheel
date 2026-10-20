// Genres for ASH//FLOW: fine Discogs styles per track, grouped into a handful of broad families.
// Families do the filtering and suggesting; fine styles are for display and tie-breaking.
(function () {
  // Eight families get the eight validated chart colours (reference order); the rest share a neutral grey,
  // but every family is still its own bucket for filtering and "Stay in genre".
  const GREY = "#6f6a76";
  const FAMILIES = [
    { id: "house", name: "House", col: "#3987e5" },
    { id: "techno", name: "Techno", col: "#d95926" },
    { id: "deep", name: "Deep House", col: "#199e70" },
    { id: "minimal", name: "Minimal & Dub", col: "#c98500" },
    { id: "prog", name: "Progressive & Trance", col: "#d55181" },
    { id: "down", name: "Downtempo & Trip Hop", col: "#008300" },
    { id: "dnb", name: "Drum & Bass", col: "#9085e9" },
    { id: "ukg", name: "UK Garage & Bass", col: "#e66767" },
    { id: "techhouse", name: "Tech House", col: GREY },
    { id: "breaks", name: "Breaks & Electro", col: GREY },
    { id: "disco", name: "Disco & Funk", col: GREY },
    { id: "pop", name: "Pop", col: GREY },
    { id: "rnb", name: "R&B & Soul", col: GREY },
    { id: "hiphop", name: "Hip Hop", col: GREY },
    { id: "afro", name: "Afro & Latin", col: GREY },
    { id: "rock", name: "Rock", col: GREY },
    { id: "other", name: "Other", col: GREY }
  ];
  const FAM = Object.fromEntries(FAMILIES.map(f => [f.id, f]));

  // Discogs style → family (lower-case keys).
  const STYLE = {};
  const put = (fam, list) => list.forEach(s => STYLE[s.toLowerCase()] = fam);
  put("house", ["House", "Funky House", "Tribal House", "Hard House", "Garage House", "Italo House", "Ghetto House", "Hip-House", "Acid House", "Electro House", "Euro House", "Jackin House", "Bass House", "Melodic House", "Organic House", "Lo-Fi House", "Piano House", "Ballroom"]);
  put("deep", ["Deep House"]);
  put("techhouse", ["Tech House"]);
  put("techno", ["Techno", "Hard Techno", "Acid", "Industrial", "EBM", "Schranz", "Hardcore", "Gabber", "Happy Hardcore", "Hardstyle", "Detroit Techno", "Peak Time Techno", "Raw Techno", "Hypnotic Techno", "Melodic Techno"]);
  put("minimal", ["Minimal", "Minimal Techno", "Microhouse", "Dub Techno", "Glitch", "Clicks & Cuts"]);
  put("prog", ["Progressive House", "Progressive Trance", "Trance", "Psy-Trance", "Goa Trance", "Hard Trance", "Tech Trance", "Euro-Trance", "Balearic", "Dream House"]);
  put("down", ["Downtempo", "Trip Hop", "Leftfield", "Ambient", "Abstract", "Experimental", "IDM", "Chillwave", "Electronica", "Dub", "Illbient", "Future Jazz", "Broken Beat", "Lo-Fi", "Instrumental", "Nu Jazz", "Acid Jazz"]);
  put("ukg", ["UK Garage", "Speed Garage", "2-Step", "Bassline", "Dubstep", "Grime", "UK Funky", "Future Garage", "Bass Music", "Juke", "Footwork", "Garage"]);
  put("breaks", ["Breakbeat", "Breaks", "Electro", "Big Beat", "Nu Skool Breaks", "Miami Bass", "Freestyle", "Ghetto"]);
  put("dnb", ["Drum n Bass", "Jungle", "Liquid Funk", "Halftime", "Neurofunk", "Darkstep", "Breakcore"]);
  put("disco", ["Disco", "Nu-Disco", "Italo-Disco", "Funk", "Boogie", "Disco Polo", "Italodance", "Hi NRG", "Cosmic"]);
  put("pop", ["Europop", "Dance-pop", "Synth-pop", "Electropop", "Vocal", "K-pop", "J-pop", "Ballad", "Teen Pop", "Indie Pop", "Bubblegum", "Pop Rock"]);
  put("rnb", ["Contemporary R&B", "RnB/Swing", "Neo Soul", "Soul", "Gospel", "Rhythm & Blues", "Swingbeat", "New Jack Swing"]);
  put("hiphop", ["Pop Rap", "Trap", "Boom Bap", "Conscious", "Gangsta", "Hardcore Hip-Hop", "Cloud Rap", "Thug Rap", "Grime Rap", "Drill", "Jazzy Hip-Hop", "Bass Music Rap"]);
  put("afro", ["Afrobeat", "Afrobeats", "Amapiano", "Afro House", "Reggaeton", "Dancehall", "Latin", "Cumbia", "Baile Funk", "Kuduro", "Gqom", "Salsa", "Bossa Nova", "Samba", "Moombahton"]);
  put("rock", ["Indie Rock", "Alternative Rock", "Punk", "Post-Punk", "New Wave", "Shoegaze", "Hard Rock", "Heavy Metal", "Garage Rock", "Psychedelic Rock", "Prog Rock", "Grunge", "Britpop", "Art Rock", "Krautrock", "Classic Rock", "Rock & Roll", "Emo", "Pop Punk"]);
  // Discogs' broad genre, used when none of the fine styles say anything.
  const BROAD = { "hip hop": "hiphop", "pop": "pop", "funk / soul": "rnb", "rock": "rock", "latin": "afro", "reggae": "other", "jazz": "other", "classical": "other", "stage & screen": "other", "folk, world, & country": "other", "blues": "rnb" };

  // Pick a family from a style list (earlier styles count more), falling back to the broad genre.
  function familyOf(styles, broad) {
    const score = {};
    (styles || []).forEach((s, i) => { const f = STYLE[String(s).toLowerCase()]; if (f) score[f] = (score[f] || 0) + (4 - Math.min(i, 3)); });
    const best = Object.keys(score).sort((a, b) => score[b] - score[a])[0];
    if (best) return best;
    for (const b of broad || []) { const f = BROAD[String(b).toLowerCase()]; if (f) return f; }
    return "other";
  }
  // Spotify artist genres are free text ("minimal techno", "uk garage"): map by keyword, most specific first.
  function familyFromSpotify(genres) {
    const g = (genres || []).join(" | ").toLowerCase();
    if (!g) return null;
    const rules = [["deep house", "deep"], ["tech house", "techhouse"], ["minimal|microhouse|dub techno", "minimal"], ["drum and bass|jungle|liquid funk|neurofunk", "dnb"],
      ["uk garage|bassline|dubstep|grime|bass music|uk funky|footwork", "ukg"], ["progressive|trance", "prog"], ["trip hop|downtempo|ambient|idm|electronica|leftfield|chill|nu jazz", "down"],
      ["afrobeat|amapiano|afro house|reggaeton|dancehall|latin|baile funk|gqom", "afro"], ["hip hop|rap|trap|drill", "hiphop"], ["r&b|rnb|soul|neo soul|new jack", "rnb"],
      ["breakbeat|big beat|electro(?! house)", "breaks"], ["techno|hard techno|acid", "techno"], ["disco|funk|boogie", "disco"], ["house", "house"],
      ["rock|indie|punk|metal|shoegaze|new wave|grunge|britpop", "rock"], ["pop", "pop"]];
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
    let ok = results.filter(r => artistOk(r, ours) && ((r.style || []).length || (r.genre || []).length));
    if (!wantsRemix) { const plain = ok.filter(r => !/\bremix(es)?\b/i.test(r.title || "")); if (plain.length) ok = plain; }
    return ok;
  }

  // ---- the background job ----
  let ctx = null, running = false, stopReq = false, runId = 0, lastAt = 0, lastErr = "";
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // Never wait forever: a request that hangs (common when iOS pauses the app mid-request) gives up after 15 s.
  async function fetchT(url, opts, ms = 15000) {
    const ac = "AbortController" in window ? new AbortController() : null;
    const t = setTimeout(() => ac && ac.abort(), ms);
    try { return await fetch(url, Object.assign({}, opts, ac ? { signal: ac.signal } : {})); }
    finally { clearTimeout(t); }
  }
  async function discogs(token, params, tries = 0) {
    const u = "https://api.discogs.com/database/search?" + new URLSearchParams(Object.assign({ type: "release", per_page: "8" }, params));
    let r;
    try { r = await fetchT(u, { headers: { Authorization: "Discogs token=" + token } }); }
    catch (e) {
      if (e && e.name === "AbortError") { if (tries < 1) return discogs(token, params, tries + 1); const x = new Error("Discogs was too slow"); x.code = "slow"; throw x; }
      if (tries < 2) { await wait(3000); return discogs(token, params, tries + 1); }
      const x = new Error("Discogs couldn't be reached"); x.code = "net"; throw x;
    }
    if (r.status === 401) { const x = new Error("Discogs didn't accept the token"); x.code = "token"; throw x; }
    if (r.status === 429) {
      // Slow down rather than retrying forever (two devices sharing one token can trip this).
      if (tries < 4) { lastErr = "Discogs asked to slow down"; await wait(10000 * (tries + 1)); return discogs(token, params, tries + 1); }
      const x = new Error("Discogs is limiting requests"); x.code = "net"; throw x;
    }
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
    const broad = ok[0].genre || [];
    return { s: styles, g: broad, f: familyOf(styles, broad), src: "discogs", rel: ok[0].title || "" };
  }
  const artistCache = {};
  // Spotify fallback. Returns undefined (not null) when Spotify couldn't be asked, so the track is tried again later.
  let spCoolUntil = 0;   // after Spotify says "slow down", leave it alone for 10 minutes
  async function viaSpotify(t) {
    if (!ctx.Spotify.connected() || Date.now() < spCoolUntil) return undefined;
    try {
      const ids = await ctx.Spotify.trackArtistIds(t.id); if (!ids.length) return null;
      let g = artistCache[ids[0]]; if (!g) { g = artistCache[ids[0]] = await ctx.Spotify.artistGenres(ids[0]); }
      const f = familyFromSpotify(g); if (!f) return null;
      return { s: g.slice(0, 3).map(x => x.replace(/\b\w/g, c => c.toUpperCase())), f, src: "spotify" };
    } catch (e) { if (e.code === "rate" || e.status === 429) spCoolUntil = Date.now() + 600000; lastErr = "Spotify fallback paused: " + e.message; return undefined; }
  }
  function todo() {
    const done = ctx.store(), seen = new Set(), out = [];
    // Tracks you're most likely to look at first: recent plays and the crate, then everything else.
    const first = [...ctx.recentIds(), ...ctx.crateIds()];
    first.concat(ctx.allTracks().map(t => t.id)).forEach(id => { if (!seen.has(id) && !done[id]) { seen.add(id); const t = ctx.track(id); if (t) out.push(t); } });
    return out;
  }
  const skipped = new Set();   // tracks that timed out this session; tried again next time the app opens
  async function run() {
    if (running) return; running = true; stopReq = false; lastAt = Date.now();
    const me = ++runId, token = ctx.token();
    try {
      const list = todo().filter(t => !skipped.has(t.id));
      for (let i = 0; i < list.length && !stopReq && me === runId; i++) {
        const t = list[i];
        // One track gets at most 60 s in total, so a single stuck lookup can't stall the whole job.
        const one = (async () => {
          let g = null;
          if (token) { try { g = await viaDiscogs(token, t); } catch (e) { if (e.code === "token" || e.code === "net") { lastErr = e.message; return { stop: e.message }; } if (e.code === "slow") { lastErr = e.message + " for " + t.title + "; skipped for now"; return { retry: true }; } } }
          if (!g) { const sp = await viaSpotify(t); if (sp === undefined) return { g: { s: [], f: null, src: "none", noSp: true } }; g = sp; }
          return { g };
        })();
        const res = await Promise.race([one, wait(60000).then(() => ({ timeout: true }))]);
        if (me !== runId) return;
        if (res.stop) { ctx.status(res.stop + ". Paused — tap Resume to try again."); break; }
        if (res.timeout || res.retry) { skipped.add(t.id); lastErr = res.timeout ? "A lookup took too long; skipped " + t.title : lastErr; }
        else { ctx.save(t.id, res.g || { s: [], f: null, src: "none" }); lastErr = ""; }
        lastAt = Date.now();
        ctx.status(null);
      }
    } finally { if (me === runId) { running = false; ctx.status(null); } }
  }
  // If the job has made no progress for 2 minutes, drop it and start a fresh one.
  function kick() { runId++; running = false; stopReq = false; run(); }
  window.FlowGenres = {
    FAMILIES, FAM, familyOf, familyFromSpotify, baseTitle, pick, VERSION: 2,
    init(c) { ctx = c; },
    start() { if (running && Date.now() - lastAt > 120000) kick(); else run(); }, stop() { stopReq = true; runId++; running = false; },
    running: () => running, todoCount: () => todo().length, kick,
    health: () => ({ running, lastAt, lastErr, skipped: skipped.size })
  };
})();
