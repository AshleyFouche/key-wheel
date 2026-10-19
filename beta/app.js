// ASH//FLOW: library, Camelot wheel, thread, crate builder, flows, Spotify playback and playlists.
(function () {
  const $ = id => document.getElementById(id);
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const toast = (msg, ms = 2600) => { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, ms); };

  // ---------- keys ----------
  const NAMES = {
    "1B": "B major", "2B": "F♯ major", "3B": "D♭ major", "4B": "A♭ major", "5B": "E♭ major", "6B": "B♭ major",
    "7B": "F major", "8B": "C major", "9B": "G major", "10B": "D major", "11B": "A major", "12B": "E major",
    "1A": "A♭ minor", "2A": "E♭ minor", "3A": "B♭ minor", "4A": "F minor", "5A": "C minor", "6A": "G minor",
    "7A": "D minor", "8A": "A minor", "9A": "E minor", "10A": "B minor", "11A": "F♯ minor", "12A": "D♭ minor"
  };
  const wrap = n => ((n - 1 + 120) % 12) + 1;
  const hue = n => ((n - 1) * 30 + 165) % 360;
  const col = n => `hsl(${hue(n)} 58% 52%)`;
  const normKey = k => { k = String(k || "").trim().toUpperCase(); return NAMES[k] ? k : null; };
  const MOVES = [
    { id: "same", name: "Same key", f: (n, l) => [[n, l]] },
    { id: "adj", name: "One step", f: (n, l) => [[wrap(n - 1), l], [wrap(n + 1), l]] },
    { id: "rel", name: "Mood switch", f: (n, l) => [[n, l === "A" ? "B" : "A"]] },
    { id: "boost", name: "Energy boost", f: (n, l) => [[wrap(n + 2), l]] },
    { id: "diag", name: "Diagonal", f: (n, l) => l === "A" ? [[wrap(n + 1), "B"]] : [[wrap(n - 1), "A"]] }
  ];
  const ALL_ON = { same: 1, adj: 1, rel: 1, boost: 1, diag: 1 };
  const MOVE_NAME = Object.fromEntries(MOVES.map(m => [m.id, m.name]));
  function relations(key) {
    if (!key) return null;
    const n = parseInt(key), l = key.slice(-1), map = {};
    MOVES.forEach(m => m.f(n, l).forEach(([a, b]) => { if (!map[a + b]) map[a + b] = m.id; }));
    return map;
  }

  // ---------- library ----------
  let T = [], byId = new Map(), counts = {};
  let PL = {};
  const toRec = a => ({ id: a[0], title: a[1], artist: a[2], tempo: +a[3] || 0, key: normKey(a[4]), crate: a[5] || "", euph: !!a[6], house: !!a[7], src: a[8] || [], crates: a[9] || [] });
  async function loadLibrary() {
    let base = [];
    try { const lib = await (await fetch("library.json", { cache: "no-cache" })).json(); base = lib.tracks; PL = lib.playlists || {}; ls.set("kwb.plNames", PL); }
    catch (e) { base = ls.get("kwb.baseCache", []); PL = ls.get("kwb.plNames", {}); }
    if (base.length) ls.set("kwb.baseCache", base);
    const extra = ls.get("kwb.extra", []);
    byId = new Map();
    base.forEach(a => byId.set(a[0], toRec(a)));
    extra.forEach(a => { const prev = byId.get(a[0]); const r = toRec(a); if (prev) { if (!r.crate) r.crate = prev.crate; if (!r.src.length) r.src = prev.src; if (!r.crates.length) r.crates = prev.crates; } byId.set(a[0], r); });
    T = [...byId.values()].filter(t => t.key);
    counts = {}; T.forEach(t => counts[t.key] = (counts[t.key] || 0) + 1);
  }

  // ---------- state ----------
  const saved = ls.get("kwb.state", {});
  const state = {
    // Every launch starts clean: all tracks, all moves on. Only Direction carries over.
    key: null,
    on: { ...ALL_ON },
    anchor: null, trail: [], shown: 60,
    dir: ["build", "hold", "cool"].includes(saved.dir) ? saved.dir : "any"
  };
  const saveState = () => ls.set("kwb.state", { key: state.key, on: state.on, trail: state.trail.map(t => t.id), anchor: state.anchor ? state.anchor.id : null, dir: state.dir });
  let crate = ls.get("kwb.crate", []);
  const saveCrate = () => { ls.set("kwb.crate", crate); const b = $("crateBadge"); b.textContent = crate.length; b.hidden = !crate.length; };

  // ---------- wheel ----------
  const svg = $("wheel"), NS = "http://www.w3.org/2000/svg", C = 260;
  const R = { bOut: 250, bIn: 178, aOut: 174, aIn: 104 };
  const segs = {};
  function el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); (parent || svg).appendChild(e); return e; }
  function arc(r1, r2, a0, a1) {
    const p = (r, a) => [C + r * Math.sin(a), C - r * Math.cos(a)];
    const [x1, y1] = p(r2, a0), [x2, y2] = p(r2, a1), [x3, y3] = p(r1, a1), [x4, y4] = p(r1, a0);
    return `M${x1},${y1} A${r2},${r2} 0 0 1 ${x2},${y2} L${x3},${y3} A${r1},${r1} 0 0 0 ${x4},${y4} Z`;
  }
  const SHORT = k => k.endsWith("B") ? NAMES[k].replace(" major", "") : NAMES[k].replace(" minor", "m");
  let ct1, ct2, ct3;
  function buildWheel() {
    svg.innerHTML = "";
    for (let n = 1; n <= 12; n++) {
      const mid = (n % 12) * Math.PI / 6, a0 = mid - Math.PI / 12 + 0.006, a1 = mid + Math.PI / 12 - 0.006;
      [["B", R.bIn, R.bOut], ["A", R.aIn, R.aOut]].forEach(([l, r1, r2]) => {
        const key = n + l, g = el("g", {});
        const path = el("path", { d: arc(r1, r2, a0, a1), class: "seg", tabindex: 0, role: "button", "aria-label": `${key}, ${NAMES[key]}` }, g);
        path.addEventListener("click", () => pick(key));
        path.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(key); } });
        const rm = (r1 + r2) / 2, x = C + rm * Math.sin(mid), y = C - rm * Math.cos(mid);
        const t1 = el("text", { x, y: y - 4, "text-anchor": "middle", class: "lbl", "font-size": l === "B" ? 17 : 15 }, g); t1.textContent = key;
        const t2 = el("text", { x, y: y + 13, "text-anchor": "middle", class: "kname", "font-size": l === "B" ? 12 : 11 }, g);
        segs[key] = { path, t1, t2, n };
      });
    }
    const hub = el("circle", { cx: C, cy: C, r: R.aIn - 6, class: "hub", tabindex: 0, role: "button", "aria-label": "Show all tracks" });
    hub.addEventListener("click", showAll);
    ct1 = el("text", { x: C, y: C - 2, "text-anchor": "middle", class: "center-key", "font-size": 36 });
    ct2 = el("text", { x: C, y: C + 22, "text-anchor": "middle", class: "center-sub", "font-size": 13 });
    ct3 = el("text", { x: C, y: C + 40, "text-anchor": "middle", class: "center-sub", "font-size": 11 });
  }
  function paintWheel() {
    const rel = relations(state.key);
    for (const k in segs) {
      const s = segs[k], m = rel ? rel[k] : "all", active = !rel || (m && state.on[m]);
      s.path.style.fill = active ? col(s.n) : "var(--dim-seg)";
      s.path.setAttribute("stroke", k === state.key ? "#fff" : "var(--bg)");
      s.path.setAttribute("stroke-width", k === state.key ? 3 : 1.5);
      const tc = active ? "#fff" : "var(--dim-text)";
      s.t1.style.fill = tc; s.t2.style.fill = tc;
      s.t2.textContent = SHORT(k) + " · " + (counts[k] || 0);
    }
    if (!state.key) { ct1.textContent = "All"; ct2.textContent = T.length.toLocaleString() + " tracks"; ct3.textContent = "tap a key"; }
    else { ct1.textContent = state.key; ct2.textContent = NAMES[state.key]; ct3.textContent = "tap for all"; }
  }

  // ---------- moves ----------
  function paintMoves() {
    const box = $("moves"); box.innerHTML = "";
    box.hidden = !state.key;
    if (!state.key) return;
    const n = parseInt(state.key), l = state.key.slice(-1);
    MOVES.forEach(m => {
      const ks = m.f(n, l).map(([a, b]) => a + b);
      const b = document.createElement("button"); b.className = "move"; b.type = "button";
      b.setAttribute("aria-pressed", state.on[m.id] ? "true" : "false");
      b.innerHTML = ks.map(k => `<span class="k" style="background:${col(parseInt(k))}">${k}</span>`).join("") + esc(m.name);
      b.onclick = () => {
        const onIds = Object.keys(state.on).filter(k => state.on[k]);
        state.on = (onIds.length === 1 && onIds[0] === m.id) ? { ...ALL_ON } : { same: 0, adj: 0, rel: 0, boost: 0, diag: 0, [m.id]: 1 };
        state.shown = 60; saveState(); render();
      };
      box.appendChild(b);
    });
  }

  // ---------- where to find a track ----------
  const plShort = n => String(n || "").replace(/^ASH\/\/F\s*/, "").replace(/\s·\s[\d–-]+\s*★*$/, "").replace(/\s*★+$/, "");
  function whereHtml(t) {
    if (!t) return "";
    t = { src: t.src || [], crates: t.crates || [] };
    if (!t.src.length && !t.crates.length) return "";
    const chip = id => `<button type="button" class="wchip" data-pl="${esc(id)}">${esc(plShort(PL[id] || "Playlist"))}</button>`;
    return `<div class="where">${t.src.length ? `<div class="wrow"><span class="wl">Found in</span>${t.src.map(chip).join("")}</div>` : ""}${t.crates.length ? `<div class="wrow"><span class="wl">Crate</span>${t.crates.map(chip).join("")}</div>` : ""}</div>`;
  }
  document.addEventListener("click", e => {
    const b = e.target.closest(".wchip"); if (!b) return;
    const id = b.dataset.pl, name = PL[id] || "Playlist";
    closeMenu && closeMenu();
    if (Spotify.connected()) { go("playlists", true); window.scrollTo(0, 0); openPlaylist({ id, name }); }
    else location.href = "https://open.spotify.com/playlist/" + id;
  });

  // ---------- anchor + trail ----------
  function paintAnchor() {
    const a = $("anchor");
    if (state.anchor) {
      const t = state.anchor;
      a.innerHTML = `<div class="ahead"><span class="eyebrow">Mixing out of</span><button class="link" type="button" id="all">All tracks</button></div><span class="t">${esc(t.title)}</span>
        <span class="m">${esc(t.artist)} · ${t.key} ${NAMES[t.key]} · ${t.tempo || "–"} BPM</span>${whereHtml(t)}${noteHtml(t.id)}
        <span class="acts"><button class="btn ghost" type="button" id="aAdd">${crate.includes(t.id) ? "In crate ✓" : "+ Crate"}</button>${state.trail.length > 1 ? '<button class="btn ghost" type="button" id="back1">‹ Back one</button>' : ""}<button class="btn ghost" type="button" id="clr">${state.trail.length > 1 ? "Clear thread" : "Clear track"}</button></span>`;
      $("clr").onclick = () => { state.trail = []; state.anchor = null; $("tmin").value = ""; $("tmax").value = ""; saveState(); render(); };
      $("aAdd").onclick = () => { toggleCrate(t.id); render(); };
      const b1 = $("back1");
      if (b1) b1.onclick = () => { state.trail.pop(); setAnchor(state.trail[state.trail.length - 1], true); };
    } else if (state.key) {
      a.innerHTML = `<div class="ahead"><span class="eyebrow">Selected key</span><button class="link" type="button" id="all">All tracks</button></div><span class="t">${state.key} · ${NAMES[state.key]}</span>
        <span class="m">Tap a track to mix out of it. Search looks across every track.</span>`;
    } else {
      a.innerHTML = `<span class="eyebrow">Library</span><span class="t">All ${T.length.toLocaleString()} tracks</span>
        <span class="m">Search for what's playing, then tap it to see what mixes out of it.</span>`;
    }
    const all = $("all"); if (all) all.onclick = showAll;
    if (state.trail.length > 1) {
      const tr = document.createElement("div"); tr.className = "trail";
      tr.innerHTML = '<div class="ahead"><span class="eyebrow">Your thread so far</span><button class="link" type="button" id="pathCrate">Save as crate</button></div>';
      const ol = document.createElement("ol");
      state.trail.forEach((t, i) => {
        const li = document.createElement("li"), b = document.createElement("button");
        b.type = "button"; b.className = "step" + (t === state.anchor ? " on" : "");
        b.innerHTML = `<span class="k" style="background:${col(parseInt(t.key))}">${t.key}</span>${esc(t.title)}`;
        b.onclick = () => { state.trail = state.trail.slice(0, i + 1); setAnchor(t, true); };
        li.appendChild(b); ol.appendChild(li);
      });
      tr.appendChild(ol); a.appendChild(tr);
      $("pathCrate").onclick = () => {
        crate = [...new Set(state.trail.map(t => t.id))]; saveCrate();
        const first = state.trail[0], last = state.trail[state.trail.length - 1];
        $("crateName").value = `ASH//FLOW · ${first.title} → ${last.title}`.slice(0, 100);
        go("crate"); window.scrollTo(0, 0); toast(`Crate set to your ${crate.length}-track thread`);
      };
    }
  }

  // ---------- list ----------
  const q = $("q"), tmin = $("tmin"), tmax = $("tmax"), sel = $("crate");
  function crateOptions() {
    const crates = [...new Set(T.map(t => t.crate).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">All crates</option><option value="__euph">E Euphoric · Hands-in-the-Air</option><option value="__house">All House crates (H1–H6)</option>';
    crates.forEach(c => { const o = document.createElement("option"); o.value = c; o.textContent = c; sel.appendChild(o); });
  }
  [q, tmin, tmax, sel].forEach(e => e.addEventListener("input", () => { state.shown = 60; paintList(); }));
  let currentRows = [];
  function filtered() {
    const rel = relations(state.key), qq = q.value.trim().toLowerCase();
    const lo = parseFloat(tmin.value) || 0, hi = parseFloat(tmax.value) || 999, cr = sel.value;
    const keyed = rel && !qq;
    const order = { same: 0, adj: 1, rel: 2, boost: 3, diag: 4 };
    let rows = T.filter(t => {
      if (keyed) { if (t === state.anchor) return false; const m = rel[t.key]; if (!m || !state.on[m]) return false; }
      if (t.tempo && (t.tempo < lo || t.tempo > hi)) return false;
      if (cr === "__euph" && !t.euph) return false;
      if (cr === "__house" && !t.house) return false;
      if (cr && cr[0] !== "_" && t.crate !== cr) return false;
      if (qq && !(t.title + " " + t.artist).toLowerCase().includes(qq)) return false;
      return true;
    });
    const ref = state.anchor ? state.anchor.tempo : null;
    const kord = k => parseInt(k) * 2 + (k.endsWith("B") ? 1 : 0);
    const rk = t => rel && rel[t.key] && state.on[rel[t.key]] ? order[rel[t.key]] : 9;
    if (keyed && state.dir !== "any" && state.anchor) { const sc = new Map(rows.map(t => [t, scoreFor(state.anchor, t, rel[t.key])])); rows.sort((a, b) => sc.get(b) - sc.get(a)); }
    else if (keyed) rows.sort((a, b) => (state.anchor ? Math.min(pairCount(state.anchor.id, b.id), 3) - Math.min(pairCount(state.anchor.id, a.id), 3) : 0) || rk(a) - rk(b) || (ref ? Math.abs(a.tempo - ref) - Math.abs(b.tempo - ref) : a.tempo - b.tempo));
    else if (qq) rows.sort((a, b) => rk(a) - rk(b) || kord(a.key) - kord(b.key) || a.tempo - b.tempo);
    else rows.sort((a, b) => kord(a.key) - kord(b.key) || a.tempo - b.tempo);
    // Spotify sometimes has the same song twice (same title, artist, key and BPM): show it once.
    const seenRow = new Set();
    rows = rows.filter(t => { const k = normS(t.title) + "|" + normS(t.artist) + "|" + t.key + "|" + t.tempo; if (seenRow.has(k)) return false; seenRow.add(k); return true; });
    return { rows, rel, keyed, qq };
  }
  // ---------- album art ----------
  // Spotify no longer offers "look up many tracks at once", so artwork is collected from what the app already
  // sees (your playlists, search, albums, what's playing) and, for anything left, fetched one track at a time
  // when it scrolls into view.
  let art = ls.get("kwb.art", {}), artDirty = false;
  function noteArt(id, url) { if (id && url && art[id] !== url) { art[id] = url; artDirty = true; } }
  setInterval(() => { if (artDirty) { artDirty = false; ls.set("kwb.art", art); } }, 4000);
  const artQ = [], artTried = new Set(); let artBusy = 0;
  function artPump() {
    while (artBusy < 2 && artQ.length) {
      const { id, el } = artQ.shift(); if (art[id]) { paintArt(el, id); continue; }
      artBusy++;
      Spotify.trackArt(id).then(u => { noteArt(id, u); paintArt(el, id); }).catch(() => {}).finally(() => { artBusy--; setTimeout(artPump, 120); });
    }
  }
  const paintArt = (el, id) => { if (art[id] && el) { el.style.backgroundImage = `url("${art[id]}")`; el.classList.add("has"); } };
  const artObs = "IntersectionObserver" in window ? new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return; artObs.unobserve(e.target);
    const id = e.target.dataset.aid; if (art[id]) return paintArt(e.target, id);
    if (artTried.has(id) || !Spotify.connected()) return; artTried.add(id); artQ.push({ id, el: e.target }); artPump();
  }), { rootMargin: "200px" }) : null;
  // Background: collect artwork from your own playlists (one request per 50 tracks), at most once a day.
  async function syncArt() {
    if (!Spotify.connected() || Date.now() - ls.get("kwb.artSync", 0) < 864e5) return;
    ls.set("kwb.artSync", Date.now());
    try {
      const me = await Spotify.me(), pls = (await Spotify.myPlaylists()).filter(p => p && p.owner && p.owner.id === me.id);
      for (const p of pls) {
        try { (await Spotify.playlistTracks(p.id)).forEach(t => noteArt(t.id, t.art)); } catch (e) {}
        await new Promise(r => setTimeout(r, 300));
      }
      document.querySelectorAll(".row .art:not(.has)").forEach(el => paintArt(el, el.dataset.aid));
    } catch (e) {}
  }

  // ---------- Liked Songs ----------
  // Green ✓ = in your Spotify library (Liked Songs / saved albums), checked 40 at a time and remembered for this session.
  const liked = new Map();
  let likeWant = new Set(), likeTimer = 0;
  function likeCheck(uri) {
    if (!uri || liked.has(uri) || !Spotify.connected() || !Spotify.canLibrary()) return;
    likeWant.add(uri); clearTimeout(likeTimer); likeTimer = setTimeout(likeFlush, 250);
  }
  async function likeFlush() {
    const uris = [...likeWant]; likeWant.clear(); if (!uris.length) return;
    try { const r = await Spotify.libContains(uris); uris.forEach((u, i) => liked.set(u, r[i])); paintLikes(); } catch (e) {}
  }
  function paintLikes() {
    document.querySelectorAll("[data-lk]").forEach(el => {
      const on = liked.get(el.dataset.lk) === true;
      el.classList.toggle("on", on);
      if (el.classList.contains("albumlike")) el.innerHTML = on ? IC.liked + "Saved" : IC.likeAdd + "Save album";
    });
    paintLikeBtns();
  }
  function paintLikeBtns() {
    const uri = np && np.id ? "spotify:track:" + np.id : null, on = !!uri && liked.get(uri) === true;
    ["npLike", "pvLike"].forEach(id => { const b = $(id); if (!b) return; b.innerHTML = on ? IC.liked : IC.likeAdd; b.classList.toggle("on", on); b.setAttribute("aria-label", on ? "Remove from Liked Songs" : "Add to Liked Songs"); b.hidden = !uri; });
    if (uri) likeCheck(uri);
  }
  async function toggleLike(uri, label) {
    if (!Spotify.connected()) { toast("Connect Spotify first (top right)"); return; }
    if (!Spotify.canLibrary()) { toast("One-time step: reconnecting Spotify so ASH//FLOW can add to your library…", 3000); setTimeout(() => Spotify.login().catch(e => toast(e.message)), 1500); return; }
    const on = liked.get(uri) === true, what = uri.includes(":album:") ? "album" : "song";
    liked.set(uri, !on); paintLikes();
    try {
      if (on) await Spotify.libRemove([uri]); else await Spotify.libSave([uri]);
      toast(on ? `Removed ${what} from your library` : `Added to your library${label ? ": " + label : ""}`);
    } catch (e) { liked.set(uri, on); paintLikes(); playError(e); }
  }
  $("npLike").onclick = () => { if (np) toggleLike("spotify:track:" + np.id, np.title); };
  $("pvLike").onclick = () => { if (np) toggleLike("spotify:track:" + np.id, np.title); };

  function rowEl(t, rel, onPick, from) {
    const r = document.createElement("div"); r.className = "row";
    const m = rel && rel[t.key] && state.on[rel[t.key]] ? MOVE_NAME[rel[t.key]] : "";
    const pc = from ? pairCount(from.id, t.id) : 0;
    const dTxt = m && from && from.tempo && t.tempo ? " · " + (t.tempo === from.tempo ? "same BPM" : (t.tempo > from.tempo ? "+" : "") + (t.tempo - from.tempo) + " BPM") : "";
    const relLine = (m || pc) ? `<div class="rel">${m}${dTxt}${pc ? `<span class="mem">${m ? " · " : ""}★ played after this${pc > 1 ? " " + pc + "×" : ""}</span>` : ""}</div>` : "";
    const keyHtml = t.key ? `<span class="key" style="background:${col(parseInt(t.key))}">${t.key}</span>` : `<span class="key none">?</span>`;
    r.innerHTML = `<span class="art" data-aid="${esc(t.id)}"></span>
      <span class="tt" role="button" tabindex="0">${relLine}<div>${esc(t.title)}${noteOf(t.id) ? ' <span class="hasnote" title="Has a note">✎</span>' : ""}</div><div class="a"><span class="lk${liked.get("spotify:track:" + t.id) === true ? " on" : ""}" data-lk="spotify:track:${esc(t.id)}"></span>${esc(t.artist)}</div></span>
      <span class="meta"><span class="bpm">${t.tempo || "–"}</span>${keyHtml}</span>
      <button class="play" type="button" aria-label="Play in Spotify">${IC.play}</button>
      <button class="add${crate.includes(t.id) ? " in" : ""}" type="button" aria-label="Add to crate">${crate.includes(t.id) ? "✓" : "+"}</button>
      <button class="more-btn" type="button" aria-label="More options">⋯</button>`;
    r._track = t; likeCheck("spotify:track:" + t.id);
    { const a = r.querySelector(".art"); if (art[t.id]) paintArt(a, t.id); else if (t.art) { noteArt(t.id, t.art); paintArt(a, t.id); } else if (artObs) artObs.observe(a); }
    r.querySelector(".more-btn").onclick = () => openMenu(t);
    if (np && np.id === t.id) r.classList.add("now");
    r.dataset.tid = t.id;
    r.querySelector(".play").onclick = () => playTrack(t);
    const tt = r.querySelector(".tt");
    tt.onclick = () => { if (Date.now() < suppressTap) return; onPick(t); };
    tt.onkeydown = e => { if (e.key === "Enter") onPick(t); };
    const add = r.querySelector(".add");
    add.onclick = () => { const inn = toggleCrate(t.id); add.classList.toggle("in", inn); add.textContent = inn ? "✓" : "+"; };
    return r;
  }
  function paintList() {
    const { rows, rel, keyed, qq } = filtered();
    currentRows = rows;
    const dd = DIRS.find(d => d.id === state.dir);
    const offMoves = keyed ? MOVES.filter(m => !state.on[m.id]) : [];
    const onlyNames = MOVES.filter(m => state.on[m.id]).map(m => m.name).join(" + ");
    $("count").innerHTML = esc(`${rows.length.toLocaleString()} ${keyed ? "tracks in compatible keys" : (qq ? "tracks across your whole library" : "tracks, all keys")}` +
      (keyed && state.anchor && state.dir !== "any" ? ` · ${dd.sym} ${dd.name} order: ${{ build: "BPM up, boosts, minor to major first", hold: "same BPM, same or next-door key first", cool: "BPM down, major to minor first" }[state.dir]}` : "")) +
      (offMoves.length ? `<div class="onlyline">Showing only <b>${esc(onlyNames)}</b> <button class="link" type="button" data-fix="moves">Show all moves</button></div>` : "");
    const list = $("list"); list.innerHTML = "";
    rows.slice(0, state.shown).forEach(t => list.appendChild(rowEl(t, rel, setAnchor, state.anchor)));
    $("more").hidden = rows.length <= state.shown;
    if (!rows.length) {
      const lo = parseFloat(tmin.value), hi = parseFloat(tmax.value), fixes = [];
      if (offMoves.length) fixes.push(`<button class="btn" type="button" data-fix="moves">Show all moves</button>`);
      if (lo || hi) fixes.push(`<button class="btn ghost" type="button" data-fix="BPM">Widen BPM</button>`);
      if (sel.value) fixes.push(`<button class="btn ghost" type="button" data-fix="crate">All crates</button>`);
      list.innerHTML = `<div class="empty"><p class="note">Nothing matches${offMoves.length ? ` — only <b>${esc(onlyNames)}</b> is switched on` : ""}${lo || hi ? `${offMoves.length ? "," : " —"} BPM ${lo || "any"} to ${hi || "any"}` : ""}${sel.value ? ", one crate only" : ""}.</p><div class="acts">${fixes.join("")}</div></div>`;
    }
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-fix]"); if (!b) return;
    const f = b.dataset.fix;
    if (f === "moves") state.on = { ...ALL_ON };
    if (f === "BPM") { const lo = parseFloat(tmin.value), hi = parseFloat(tmax.value); if (lo) tmin.value = Math.max(0, lo - 6); if (hi) tmax.value = hi + 6; }
    if (f === "crate") sel.value = "";
    state.shown = 60; saveState(); render();
  });
  $("more").onclick = () => { state.shown += 60; paintList(); };

  function setAnchor(t, fromTrail, quiet) {
    if (!t.key) { toast("No key for this track yet"); return; }
    if (!fromTrail && state.trail[state.trail.length - 1] !== t) state.trail.push(t);
    state.anchor = t; state.key = t.key; q.value = "";
    if (t.tempo) { const [lo, hi] = tempoWindow(t); tmin.value = lo; tmax.value = hi; }
    state.shown = 60; saveState();
    if (quiet) { render(); return; }
    go("wheel"); render(); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function pick(k) { state.key = k; state.anchor = null; state.trail = []; state.shown = 60; saveState(); render(); }
  function showAll() { state.trail = []; state.key = null; state.anchor = null; tmin.value = ""; tmax.value = ""; sel.value = ""; state.shown = 60; saveState(); render(); }
  function render() { paintWheel(); paintDir(); paintMoves(); paintAnchor(); paintList(); }

  // ---------- set direction ----------
  const DIRS = [
    { id: "any", name: "Any", tip: "No lean — closest key and BPM first" },
    { id: "build", name: "Build", sym: "↑", tip: "Lifting the energy — a few BPM up, energy boosts, minor to major" },
    { id: "hold", name: "Hold", sym: "→", tip: "Keeping it steady — near-same BPM, same or next-door keys" },
    { id: "cool", name: "Cool", sym: "↓", tip: "Bringing it down — BPM down, major to minor, no boosts" }
  ];
  // BPM range shown around the selected track, per direction.
  const tempoWindow = t => [t.tempo - 6, t.tempo + 6];   // direction re-orders; it never hides tracks
  function paintDir() {
    const box = $("dir"); if (!box) return;
    box.innerHTML = '<span class="eyebrow">Direction</span>' + DIRS.map(d =>
      `<button type="button" data-d="${d.id}" aria-pressed="${state.dir === d.id}" title="${d.tip}">${d.sym ? `<span aria-hidden="true">${d.sym}</span> ` : ""}${d.name}</button>`).join("");
    box.querySelectorAll("button").forEach(b => b.onclick = () => {
      state.dir = b.dataset.d; saveState();
      state.shown = 60; render(); paintSuggest();
      toast(state.anchor || state.dir === "any" ? DIRS.find(d => d.id === state.dir).tip : "Now pick a track — direction ranks what comes after the track you're mixing out of");
    });
  }

  // ---------- crate ----------
  function toggleCrate(id) {
    const i = crate.indexOf(id);
    if (i >= 0) crate.splice(i, 1); else crate.push(id);
    saveCrate(); return i < 0;
  }
  function paintCrate() {
    const list = $("crateList"); list.innerHTML = "";
    const recs = crate.map(id => byId.get(id)).filter(Boolean);
    $("crateCount").textContent = recs.length ? `${recs.length} tracks · BPM ${Math.min(...recs.map(r => r.tempo || 999))}–${Math.max(...recs.map(r => r.tempo || 0))}` : "Empty for now.";
    recs.forEach(t => {
      const r = rowEl(t, null, setAnchor);
      r.classList.add("crow"); r.dataset.id = t.id;
      const h = document.createElement("span"); h.className = "drag"; h.textContent = "≡"; h.setAttribute("aria-label", "Drag to reorder");
      r.prepend(h);
      r.querySelector(".add").onclick = () => { toggleCrate(t.id); paintCrate(); };
      list.appendChild(r);
    });
  }
  // Drag to reorder (touch and mouse), using the ≡ handle.
  function makeSortable(list, onEnd) {
    let dragRow = null, scrollTimer = null, lastY = 0;
    list.addEventListener("pointerdown", e => {
      const h = e.target.closest(".drag"); if (!h || h.closest(".locked")) return;
      dragRow = h.closest(".row"); dragRow.classList.add("dragging");
      h.setPointerCapture(e.pointerId); lastY = e.clientY; e.preventDefault();
      scrollTimer = setInterval(() => {
        if (!dragRow) return;
        if (lastY < 80) window.scrollBy(0, -12);
        else if (lastY > innerHeight - 150) window.scrollBy(0, 12);
      }, 16);
    });
    list.addEventListener("pointermove", e => {
      if (!dragRow) return;
      lastY = e.clientY;
      const rows = [...list.children].filter(r => r !== dragRow && r.classList.contains("row") && !r.classList.contains("locked"));
      let before = null;
      for (const r of rows) { const b = r.getBoundingClientRect(); if (e.clientY < b.top + b.height / 2) { before = r; break; } }
      if (before) { if (dragRow.nextSibling !== before) list.insertBefore(dragRow, before); }
      else { const last = rows[rows.length - 1]; if (last && last.nextSibling !== dragRow) list.insertBefore(dragRow, last.nextSibling); }
    });
    const end = () => {
      if (!dragRow) return;
      dragRow.classList.remove("dragging"); dragRow = null; clearInterval(scrollTimer);
      onEnd([...list.children].filter(r => r.dataset.id && !r.classList.contains("locked")).map(r => r.dataset.id));
    };
    list.addEventListener("pointerup", end); list.addEventListener("pointercancel", end);
  }
  makeSortable($("crateList"), ids => { crate = ids; saveCrate(); });
  $("fromPath").onclick = () => { state.trail.forEach(t => { if (!crate.includes(t.id)) crate.push(t.id); }); saveCrate(); paintCrate(); toast(state.trail.length ? "Thread added" : "No thread yet — tap tracks on the wheel first"); };
  $("fromList").onclick = () => { currentRows.slice(0, 100).forEach(t => { if (!crate.includes(t.id)) crate.push(t.id); }); saveCrate(); paintCrate(); toast("Added the current list"); };
  $("clearCrate").onclick = () => {
    const b = $("clearCrate");
    if (b.dataset.confirm) { crate = []; saveCrate(); paintCrate(); b.textContent = "Clear"; delete b.dataset.confirm; return; }
    b.dataset.confirm = "1"; b.textContent = "Tap again to clear"; setTimeout(() => { b.textContent = "Clear"; delete b.dataset.confirm; }, 3000);
  };
  const dest = () => (document.querySelector('input[name="dest"]:checked') || {}).value || "new";
  document.querySelectorAll('input[name="dest"]').forEach(r => r.onchange = () => {
    $("destNew").hidden = dest() !== "new"; $("destExisting").hidden = dest() !== "existing";
    if (dest() === "existing") fillExisting();
  });
  async function fillExisting() {
    const selEx = $("existingPl");
    if (!Spotify.connected()) { selEx.innerHTML = '<option value="">Connect Spotify first</option>'; return; }
    try {
      const me = await Spotify.me();
      plCache = plCache || await Spotify.myPlaylists();
      const own = plCache.filter(p => p && p.owner && p.owner.id === me.id);
      const keep = selEx.value;
      selEx.innerHTML = '<option value="">Choose a playlist</option>' + own.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
      if (keep) selEx.value = keep;
    } catch (e) { selEx.innerHTML = '<option value="">Couldn\'t load playlists</option>'; }
  }
  $("saveCrate").onclick = async () => {
    const st = $("saveStatus"); st.className = "status";
    if (!crate.length) { st.textContent = "Add some tracks first."; st.className = "status err"; return; }
    if (!Spotify.connected()) { st.textContent = "Connect Spotify first (top right)."; st.className = "status err"; return; }
    let ids = crate.slice();
    if ($("crateOrder").checked) ids.sort((a, b) => (byId.get(a)?.tempo || 0) - (byId.get(b)?.tempo || 0));
    const toExisting = dest() === "existing", exId = $("existingPl").value;
    if (toExisting && !exId) { st.textContent = "Choose which playlist to add to."; st.className = "status err"; return; }
    const btn = $("saveCrate"); btn.disabled = true; st.textContent = "Saving to Spotify…";
    try {
      if (toExisting) {
        const have = new Set((await Spotify.playlistTracks(exId)).map(t => t.id));
        const fresh = ids.filter(id => !have.has(id));
        if (fresh.length) await Spotify.addTracks(exId, fresh);
        keepPairs(ids);
        const name = $("existingPl").selectedOptions[0].textContent;
        st.className = "status ok";
        st.innerHTML = `Added ${fresh.length} tracks to “${esc(name)}”${ids.length - fresh.length ? ` (${ids.length - fresh.length} ${ids.length - fresh.length === 1 ? "was" : "were"} already there)` : ""}. <a href="https://open.spotify.com/playlist/${esc(exId)}" target="_blank" rel="noopener">Open in Spotify</a>`;
      } else {
        const name = $("crateName").value.trim() || ("ASH//F crate · " + new Date().toLocaleDateString());
        const pl = await Spotify.createPlaylist(name, "Built in ASH//FLOW", ids);
        keepPairs(ids);
        st.className = "status ok";
        st.innerHTML = `Saved “${esc(name)}” with ${ids.length} tracks. <a href="${esc(pl.external_urls?.spotify || "#")}" target="_blank" rel="noopener">Open in Spotify</a>`;
        plCache = null;
      }
    } catch (e) {
      st.className = "status err";
      st.textContent = e.code === "auth" ? "Spotify sign-in expired. Tap Connect Spotify and try again." : ("Couldn't save: " + e.message);
      paintSpotifyBtn();
    } finally { btn.disabled = false; }
  };

  // ---------- playlists ----------
  let plCache = null;
  let plScroll = 0, plLastId = null;
  async function paintPlaylists(restore) {
    const w = $("plWrap");
    if (!Spotify.configured()) { w.innerHTML = '<p class="note">Spotify isn\'t set up in this copy of the app yet.</p>'; return; }
    if (!Spotify.connected()) { w.innerHTML = '<p class="note">Connect Spotify to see your playlists here, with keys from your library.</p><button class="btn" id="plConnect" type="button">Connect Spotify</button>'; $("plConnect").onclick = () => Spotify.login().catch(e => toast(e.message)); return; }
    w.innerHTML = '<p class="note">Loading your playlists…</p>';
    try {
      const me = await Spotify.me();
      plCache = plCache || await Spotify.myPlaylists();
      const own = plCache.filter(p => p && p.owner && p.owner.id === me.id);
      const other = plCache.length - own.length;
      w.innerHTML = `<p class="note">${own.length} playlists you own.${other ? ` ${other} others you follow are hidden, because Spotify only shares the tracks of playlists you own.` : ""}</p>`;
      const list = document.createElement("div");
      own.forEach(p => {
        const d = document.createElement("div"); d.className = "pl"; d.tabIndex = 0; d.setAttribute("role", "button");
        const img = p.images && p.images.length ? `<img src="${esc(p.images[p.images.length - 1].url)}" alt="">` : '<span class="ph"></span>';
        const n = (p.items && p.items.total) ?? (p.tracks && p.tracks.total) ?? "";
        d.innerHTML = `${img}<div style="min-width:0"><div class="n">${esc(p.name)}</div><div class="c">${n !== "" ? n + " tracks" : ""}</div></div><span class="c">›</span>`;
        d.onclick = () => { plScroll = window.scrollY; plLastId = p.id; openPlaylist(p); window.scrollTo(0, 0); };
        if (p.id === plLastId) d.classList.add("last");
        list.appendChild(d);
      });
      w.appendChild(list);
      if (restore && plScroll) requestAnimationFrame(() => window.scrollTo(0, plScroll));
    } catch (e) {
      w.innerHTML = `<p class="note">${e.code === "auth" ? "Spotify sign-in expired. Tap Connect Spotify." : "Couldn't load playlists: " + esc(e.message)}</p>`;
      paintSpotifyBtn();
    }
  }
  let lastPlaylist = null;
  async function openPlaylist(p) {
    lastPlaylist = p;
    const w = $("plWrap");
    w.innerHTML = `<button class="btn ghost back" id="plBack" type="button">‹ All playlists</button><h2>${esc(p.name)}</h2><p class="note">Loading tracks…</p>`;
    $("plBack").onclick = () => paintPlaylists(true);
    try {
      const tracks = await Spotify.playlistTracks(p.id);
      tracks.forEach(t => noteArt(t.id, t.art));
      const recs = tracks.map(t => byId.get(t.id) || { id: t.id, title: t.title, artist: t.artist, tempo: 0, key: null });
      const known = recs.filter(r => r.key).length;
      w.querySelector(".note").textContent = `${tracks.length} tracks · ${known} with a key in your library${known < tracks.length ? ` · ${tracks.length - known} still need one: screenshot this playlist in Spotify's Mix view, send it to Claude, then tap Add keys` : ""}`;
      const acts = document.createElement("div"); acts.className = "crate-actions";
      acts.innerHTML = '<button class="btn" type="button" id="plKeys">Add keys</button><button class="btn ghost" type="button" id="plAll">Add tracks with keys to crate</button><button class="btn ghost" type="button" id="plReorder">Reorder</button>';
      w.appendChild(acts);
      const pb = document.createElement("div"); pb.className = "pastebox"; pb.hidden = true;
      pb.innerHTML = '<p class="note">Pick screenshots or a screen recording of this playlist in Spotify\'s <b>Mix</b> view, or paste lines from Claude. They\'re matched to the exact tracks in it.</p><div class="crate-actions"><label class="btn" for="plShots">From screenshots or recording</label><input id="plShots" type="file" accept="image/*,video/*" multiple hidden></div><p class="note" id="plOcr" role="status"></p><textarea id="plPaste" rows="6" placeholder="7B | 130 | Positive | Jamback | 2:49"></textarea><button class="btn" type="button" id="plMatch">Match</button>';
      w.appendChild(pb);
      $("plKeys").onclick = () => { pb.hidden = !pb.hidden; if (!pb.hidden) $("plPaste").focus(); };
      $("plMatch").onclick = () => startMatch($("plPaste").value, tracks, "playlists");
      $("plShots").onchange = e => readShots(e.target, $("plPaste"), $("plOcr"));
      $("plAll").onclick = () => { recs.filter(r => r.key).forEach(r => { if (!crate.includes(r.id)) crate.push(r.id); }); saveCrate(); toast("Added to crate"); };
      const list = document.createElement("div"); list.className = "list";
      // order[i] = original index of the track now at position i, kept in step with Spotify.
      let order = recs.map((_, i) => i), reorder = false, snap = null, chain = Promise.resolve();
      const paintRows = () => {
        list.innerHTML = "";
        order.forEach(i => {
          const r = rowEl(recs[i], null, setAnchor);
          if (reorder) { r.classList.add("crow"); r.dataset.id = String(i); const h = document.createElement("span"); h.className = "drag"; h.textContent = "≡"; h.setAttribute("aria-label", "Drag to reorder"); r.prepend(h); }
          list.appendChild(r);
        });
      };
      paintRows();
      w.appendChild(list);
      $("plReorder").onclick = () => {
        reorder = !reorder; $("plReorder").textContent = reorder ? "Done" : "Reorder"; $("plReorder").classList.toggle("on", reorder);
        if (reorder) toast("Drag the ≡ handles. Each move saves to Spotify straight away.");
        paintRows();
      };
      makeSortable(list, ids => {
        if (!reorder) return;
        const next = ids.map(Number);
        let i = 0; while (i < next.length && next[i] === order[i]) i++;
        if (i === next.length) return;
        let from, before;
        const upCheck = order.slice(); const idx = upCheck.indexOf(next[i]); upCheck.splice(idx, 1); upCheck.splice(i, 0, next[i]);
        if (upCheck.every((v, k) => v === next[k])) { from = idx; before = i; }          // dragged up
        else { from = i; before = next.indexOf(order[i]) + 1; }                            // dragged down
        const prev = order; order = next;
        chain = chain.then(async () => {
          try { snap = await Spotify.moveInPlaylist(p.id, from, before, snap) || snap; toast("Saved to Spotify"); }
          catch (e) {
            order = prev; paintRows();
            toast(e.status === 403 ? "Spotify won't let this playlist be reordered (only your own playlists can be)" : e.code === "auth" ? "Spotify sign-in expired — tap Connect Spotify" : "Couldn't save the new order: " + e.message);
          }
        });
      });
    } catch (e) {
      w.querySelector(".note").textContent = "Couldn't load this playlist: " + e.message;
    }
  }

  // ---------- more ----------
  // ---------- version ----------
  // Bump with each release so it's clear which build the phone is running.
  const APP_VERSION = "2.10";
  $("appVer").textContent = "beta " + APP_VERSION;

  // ---------- search the whole Spotify catalogue ----------
  let sTimer = 0, sSeq = 0, sState = { q: "", items: [], offset: 0, next: false, total: 0, err: "" };
  const sPick = t => t.key ? setAnchor(t) : openMenu(t);
  function sRec(it) {
    const r = byId.get(it.id);
    return r ? Object.assign({}, r, { art: it.art }) : { id: it.id, title: it.title, artist: it.artist, tempo: 0, key: null, art: it.art, album: it.album };
  }
  function paintSearch() {
    const out = $("sOut"), q = sState.q;
    out.innerHTML = "";
    if (!q) { out.innerHTML = '<p class="note">Type a song or artist. Tracks already in your library show their key; anything else you can still play, queue or add to your crate. Tap a track with no key for options.</p>'; return; }
    const qq = q.toLowerCase(), words = qq.split(/\s+/).filter(Boolean);
    const lib = T.filter(t => { const h = (t.title + " " + t.artist).toLowerCase(); return words.every(w => h.includes(w)); }).slice(0, 5);
    if (lib.length) {
      out.insertAdjacentHTML("beforeend", '<div class="eyebrow shead">In your library</div>');
      const l = document.createElement("div"); l.className = "list"; lib.forEach(t => l.appendChild(rowEl(t, null, sPick, state.anchor))); out.appendChild(l);
    }
    out.insertAdjacentHTML("beforeend", `<div class="eyebrow shead">On Spotify${sState.total ? " · " + sState.total.toLocaleString() + " results" : ""}</div>`);
    if (!Spotify.connected()) { out.insertAdjacentHTML("beforeend", '<p class="note">Connect Spotify (top right) to search everything.</p>'); return; }
    if (sState.err) { out.insertAdjacentHTML("beforeend", `<p class="note">${esc(sState.err)}</p>`); return; }
    if (sState.loading && !sState.items.length) { out.insertAdjacentHTML("beforeend", '<p class="note">Searching…</p>'); return; }
    if (!sState.items.length) { out.insertAdjacentHTML("beforeend", '<p class="note">Nothing found.</p>'); return; }
    const l = document.createElement("div"); l.className = "list";
    sState.items.forEach(it => {
      const t = sRec(it), r = rowEl(t, null, sPick, state.anchor);
      if (!t.key) r.querySelector(".tt .a").insertAdjacentHTML("beforeend", ' <span class="nokey">· not in library</span>');
      if (it.album) r.querySelector(".tt .a").title = it.album;
      l.appendChild(r);
    });
    out.appendChild(l);
    if (sState.next) {
      const b = document.createElement("button"); b.className = "btn ghost smore"; b.type = "button"; b.textContent = sState.loading ? "Loading…" : "More results";
      b.onclick = () => runSearch(true); out.appendChild(b);
    }
  }
  async function runSearch(more) {
    const q = sState.q, seq = ++sSeq;
    if (!q || !Spotify.connected()) { paintSearch(); return; }
    if (!more) sState = { q, items: [], offset: 0, next: false, total: 0, err: "" };
    sState.loading = true; paintSearch();
    try {
      const r = await Spotify.searchAll(q, more ? sState.items.length : 0);
      if (seq !== sSeq) return;
      const have = new Set(sState.items.map(i => i.id));
      sState.items = sState.items.concat(r.items.filter(i => !have.has(i.id)));
      sState.next = r.next && r.items.length > 0 && sState.items.length < 200; sState.total = r.total;
    } catch (e) {
      if (seq !== sSeq) return;
      if (more) sState.next = false; else sState.err = e.code === "auth" ? "Spotify sign-in expired. Tap Connect Spotify." : "Search didn't work: " + e.message;
    }
    sState.loading = false; paintSearch();
  }
  $("sq").addEventListener("input", () => {
    clearTimeout(sTimer);
    sState.q = $("sq").value.trim();
    sTimer = setTimeout(() => runSearch(false), 350);
  });
  $("sq").addEventListener("keydown", e => { if (e.key === "Enter") { clearTimeout(sTimer); $("sq").blur(); runSearch(false); } });

  // ---------- connection check ----------
  $("connCheck").onclick = async () => {
    const out = $("connOut"); out.hidden = false; out.innerHTML = '<p class="note">Checking…</p>';
    const lines = [], time = t => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
    lines.push("ASH//FLOW " + APP_VERSION + " · " + new Date().toLocaleString());
    try {
      const p = await Spotify.rawPlayer();
      if (!p || !p.device) lines.push("NOW: Spotify reports nothing playing and no active device.");
      else lines.push(`NOW: ${p.is_playing ? "playing" : "paused"} "${p.item ? p.item.name : "?"}" on ${p.device.name} (${p.device.type}${p.device.is_restricted ? ", LOCKED — Spotify won't take commands for it" : ""}${p.device.is_private_session ? ", private session" : ""}) · context: ${p.context ? p.context.type + (live.pl && p.context.uri === "spotify:playlist:" + live.pl ? " (your Live set)" : "") : "single track"}`);
    } catch (e) { lines.push("NOW: couldn't ask Spotify — " + e.message); }
    try {
      const ds = await Spotify.devices();
      lines.push("DEVICES Spotify can see: " + (ds.length ? "" : "none"));
      ds.forEach(d => lines.push(`  • ${d.name} — ${d.type}${d.is_active ? ", ACTIVE" : ""}${d.is_restricted ? ", LOCKED" : ""} · id …${(d.id || "").slice(-6)}`));
    } catch (e) { lines.push("DEVICES: couldn't ask Spotify — " + e.message); }
    let last = ""; try { last = localStorage.getItem("kwb.lastDevice") || ""; } catch (e) {}
    lines.push("Live set: " + (liveOn ? "on" : "off") + (live.pl ? " · playlist …" + live.pl.slice(-6) + " · " + live.items.length + " tracks, playing #" + (live.cur + 1) : " · not started yet"));
    lines.push("Last device ASH//FLOW saw playing: " + (last ? "id …" + last.slice(-6) : "none yet"));
    if (isLive()) {
      try {
        const up = (await Spotify.upNext()).filter(t => t.id !== np.id).slice(0, 5).map(t => t.title);
        lines.push("SPOTIFY UP NEXT: " + (up.join(" · ") || "nothing"));
        lines.push("APP UP NEXT:     " + (appQ.slice(0, 5).map(id => recOf(id, qMeta.get(id)).title).join(" · ") || "nothing"));
      } catch (e) {}
    }
    lines.push("Other open copy of ASH//FLOW also controls Spotify: if stable is open too, close it while testing.");
    const log = Spotify.log();
    lines.push("RECENT COMMANDS (newest last): " + (log.length ? "" : "none yet"));
    log.forEach(l => lines.push(`  ${time(l.at)}  ${l.m} ${l.p}  →  ${l.s}${l.msg ? " " + l.msg : ""}`));
    const text = lines.join("\n");
    out.innerHTML = `<pre class="conn">${esc(text)}</pre><button class="btn ghost" type="button" id="connCopy">Copy report</button>`;
    $("connCopy").onclick = () => { navigator.clipboard.writeText(text).then(() => toast("Copied — paste it to Claude"), () => toast("Couldn't copy — take a screenshot instead")); };
  };

  // ---------- genre test (Discogs) ----------
  // Looks up a sample of tracks on Discogs (styles are per release, and very fine-grained for electronic music).
  // A test only: shows what was found, saves nothing.
  try { $("dgToken").value = localStorage.getItem("kwb.discogsToken") || ""; } catch (e) {}
  $("dgToken").onchange = () => { try { localStorage.setItem("kwb.discogsToken", $("dgToken").value.trim()); } catch (e) {} };
  async function fillDgPlaylists() {
    if (!Spotify.connected() || $("dgPl").options.length > 1) return;
    try {
      const me = await Spotify.me(); plCache = plCache || await Spotify.myPlaylists();
      plCache.filter(p => p && p.owner && p.owner.id === me.id).forEach(p => { const o = document.createElement("option"); o.value = p.id; o.textContent = p.name; $("dgPl").appendChild(o); });
    } catch (e) {}
  }
  $("dgPl").onfocus = fillDgPlaylists;
  const dgWait = ms => new Promise(r => setTimeout(r, ms));
  async function dgSearch(token, params) {
    const u = "https://api.discogs.com/database/search?" + new URLSearchParams(Object.assign({ type: "release", per_page: "5" }, params));
    let r;
    try { r = await fetch(u, { headers: { Authorization: "Discogs token=" + token } }); }
    catch (e) { const x = new Error("Discogs couldn't be reached from this phone (the request was blocked)."); x.code = "blocked"; throw x; }
    if (r.status === 401) { const x = new Error("Discogs didn't accept that token. Check it and try again."); x.code = "token"; throw x; }
    if (r.status === 429) { await dgWait(5000); return dgSearch(token, params); }
    if (!r.ok) throw new Error("Discogs error " + r.status);
    return (await r.json()).results || [];
  }
  const dgBase = t => t.replace(/\s*[-–]\s*(?:.*\b(?:remix|mix|edit|version|dub|rework|original)\b.*)$/i, "").replace(/\s*[\(\[].*?[\)\]]\s*/g, " ").trim();
  async function dgLookup(token, t) {
    const artist = (t.artist || "").split(",")[0].trim(), title = dgBase(t.title || "");
    let res = await dgSearch(token, { artist, track: title });
    await dgWait(1100);
    if (!res.length) { res = await dgSearch(token, { q: artist + " " + title }); await dgWait(1100); }
    if (!res.length) return null;
    // Styles from the best few releases, most common first.
    const count = {};
    res.slice(0, 3).forEach((r, i) => (r.style || []).forEach(s => count[s] = (count[s] || 0) + (3 - i)));
    const styles = Object.keys(count).sort((a, b) => count[b] - count[a]).slice(0, 4);
    const top = res[0];
    return { styles, genres: top.genre || [], release: top.title || "", year: top.year || "" };
  }
  $("dgRun").onclick = async () => {
    const token = $("dgToken").value.trim(), pl = $("dgPl").value, st = $("dgStatus"), out = $("dgOut");
    if (!token) { st.textContent = "Paste your Discogs token first."; return; }
    try { localStorage.setItem("kwb.discogsToken", token); } catch (e) {}
    if (!pl) { st.textContent = "Choose a playlist to test."; fillDgPlaylists(); return; }
    $("dgRun").disabled = true; out.innerHTML = ""; const t0 = Date.now();
    try {
      const tracks = (await Spotify.playlistTracks(pl)).slice(0, 25);
      let found = 0, i = 0;
      const list = document.createElement("div"); list.className = "dglist"; out.appendChild(list);
      for (const t of tracks) {
        i++; st.textContent = `Looking up ${i} of ${tracks.length}… (${found} found so far)`;
        const r = await dgLookup(token, t);
        if (r && r.styles.length) found++;
        const d = document.createElement("div"); d.className = "dgrow" + (r && r.styles.length ? "" : " miss");
        d.innerHTML = `<b>${esc(t.title)}</b> · ${esc(t.artist)}<br>` + (r && r.styles.length
          ? `<span class="dgs">${r.styles.map(esc).join(" · ")}</span> <small>${esc(r.genres.join(", "))} — from “${esc(r.release)}”${r.year ? " (" + esc(String(r.year)) + ")" : ""}</small>`
          : `<small>${r ? "Found on Discogs but no styles listed" : "Not found on Discogs"}</small>`);
        list.appendChild(d);
      }
      st.textContent = `Done: styles found for ${found} of ${tracks.length} tracks in ${Math.round((Date.now() - t0) / 1000)} seconds. Check whether they look right.`;
    } catch (e) { st.textContent = e.message; }
    $("dgRun").disabled = false;
  };

  function paintMore() {
    const extra = ls.get("kwb.extra", []);
    $("libInfo").textContent = `${T.length.toLocaleString()} tracks with keys (${extra.length} added on this phone). Your crate, settings and added tracks are stored on this phone; back them up now and then.`;
    $("spInfo").textContent = !Spotify.configured() ? "Not set up yet." : Spotify.connected() ? "Connected." : "Not connected.";
    $("logout").hidden = !Spotify.connected();
  }
  $("logout").onclick = () => { Spotify.logout(); plCache = null; clearInterval(npTimer); np = null; paintNp(); paintSpotifyBtn(); paintMore(); toast("Disconnected from Spotify"); };
  $("backup").onclick = () => {
    const data = { app: "key-wheel", saved: new Date().toISOString(), extra: ls.get("kwb.extra", []), history: ls.get("kwb.history", []), notes, kept: ls.get("kwb.kept", {}), crate, state: { key: state.key, on: state.on, dir: state.dir } };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "ashflow-backup.json"; document.body.appendChild(a); a.click(); a.remove();
  };
  $("restore").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.app !== "key-wheel") throw new Error("not an ASH//FLOW backup");
      ls.set("kwb.extra", d.extra || []); if (d.history) ls.set("kwb.history", d.history); if (d.notes) { notes = d.notes; ls.set("kwb.notes", notes); } if (d.kept) ls.set("kwb.kept", d.kept); crate = d.crate || []; saveCrate();
      await loadLibrary(); crateOptions(); render(); paintMore(); toast("Backup restored");
    } catch (err) { toast("Couldn't restore: " + err.message); }
    e.target.value = "";
  };
  // ---------- adding keys: parse, match, review ----------
  const normS = x => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const baseTitle = x => normS(String(x || "").split(/\s[-–]\s|\(|\[/)[0]);
  const toks = x => new Set(normS(x).split(" ").filter(Boolean));
  const artistSet = x => new Set(String(x || "").split(/,|&| x | and | feat\.? | ft\.? | with /i).map(normS).filter(Boolean));
  function parseLen(x) { const m = String(x || "").trim().match(/^(\d{1,2}):(\d{2})$/); return m ? (parseInt(m[1]) * 60 + parseInt(m[2])) * 1000 : 0; }
  function parseLines(text) {
    const out = [];
    text.split(/\n+/).forEach(raw => {
      const line = raw.trim(); if (!line) return;
      const parts = (line.includes("|") ? line.split("|") : line.split(/\t|,(?=\s*\S)/)).map(x => x.trim());
      let id = null, m = (parts[0] || "").match(/track[/:]([A-Za-z0-9]{22})/);
      if (m) id = m[1]; else if (/^[A-Za-z0-9]{22}$/.test(parts[0] || "")) id = parts[0];
      if (id) { out.push({ raw: line, id, key: normKey(parts[1]), tempo: Math.round(parseFloat(parts[2])) || 0, title: parts[3] || "", artist: parts.slice(4).join(", ") }); return; }
      // key | BPM | title | artist | length   (length optional)
      let len = 0; if (parts.length >= 5 && parseLen(parts[parts.length - 1])) len = parseLen(parts.pop());
      out.push({ raw: line, key: normKey(parts[0]), tempo: Math.round(parseFloat(parts[1])) || 0, title: parts[2] || "", artist: parts.slice(3).join(", "), len });
    });
    return out;
  }
  function score(line, cand) {
    const lt = normS(line.title), ct = normS(cand.title);
    let t = lt && lt === ct ? 1 : (baseTitle(line.title) && baseTitle(line.title) === baseTitle(cand.title) ? 0.75 : 0);
    if (!t) { const a = toks(line.title), b = toks(cand.title); const inter = [...a].filter(x => b.has(x)).length; t = inter ? 0.7 * inter / Math.max(a.size, b.size) : 0; }
    const la = artistSet(line.artist), ca = artistSet(cand.artist);
    let ar = [...la].some(x => ca.has(x)) ? 1 : 0;
    if (!ar && la.size) { const a = toks(line.artist), b = toks(cand.artist); ar = [...a].some(x => b.has(x)) ? 0.5 : 0; }
    let sc = t * 0.65 + ar * 0.35;
    if (line.len && cand.duration) { const d = Math.abs(line.len - cand.duration); if (d <= 3000) sc += 0.15; else if (d > 15000) sc -= 0.25; }
    return sc;
  }
  const CONF = 0.85, MAYBE = 0.55;
  async function matchLines(lines, pool) {
    const used = new Set(), results = [];
    for (const ln of lines) {
      const r = { line: ln, matches: [], status: "miss", source: "" };
      if (!ln.key) { r.note = "No valid key (like 8A) in this line"; results.push(r); continue; }
      if (ln.id) { r.matches = [{ id: ln.id, title: ln.title, artist: ln.artist }]; r.status = "ok"; r.source = "id"; results.push(r); continue; }
      // 1. the playlist you screenshotted
      if (pool && pool.length) {
        let best = null, bs = 0;
        pool.forEach(c => { if (used.has(c.id)) return; const sc = score(ln, c); if (sc > bs) { bs = sc; best = c; } });
        if (best && bs >= MAYBE) { used.add(best.id); r.matches = [best]; r.status = bs >= CONF ? "ok" : "warn"; r.source = "playlist"; }
      }
      // 2. fall back to Spotify search
      if (r.status !== "ok") {
        try {
          const found = await Spotify.searchTracks(ln.title, ln.artist);
          const scored = found.map(c => ({ c, sc: score(ln, c) })).sort((a, b) => b.sc - a.sc);
          if (scored.length && scored[0].sc >= MAYBE && (!r.matches.length || scored[0].sc > score(ln, r.matches[0]))) {
            const top = scored[0];
            // identical versions (same title, artist and length) all get the key
            const twins = scored.filter(x => x.sc >= top.sc - 0.001 && normS(x.c.title) === normS(top.c.title) && Math.abs((x.c.duration || 0) - (top.c.duration || 0)) <= 2000);
            r.matches = twins.map(x => x.c); r.status = top.sc >= CONF ? "ok" : "warn"; r.source = "search";
          }
        } catch (e) { if (!r.matches.length) r.note = "Search failed: " + e.message; }
      }
      results.push(r);
    }
    return results;
  }
  let matchResults = [], matchReturn = "more";
  async function startMatch(text, pool, ret) {
    const lines = parseLines(text);
    if (!lines.length) { toast("Paste some lines first"); return; }
    if (!Spotify.connected() && lines.some(l => !l.id)) { toast("Connect Spotify first so tracks can be found"); return; }
    matchReturn = ret; go("match"); window.scrollTo(0, 0);
    $("matchList").innerHTML = ""; $("matchStatus").textContent = ""; $("matchInfo").textContent = `Matching ${lines.length} tracks…`;
    matchResults = await matchLines(lines, pool);
    paintMatches();
  }
  const fmtLen = ms => { if (!ms) return ""; const sec = Math.floor(ms / 1000); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); };
  function paintMatches() {
    // Compare with what's already saved: same key and BPM → nothing to do; different → it'll be updated.
    matchResults.forEach(r => {
      if (r.prior !== undefined) return;
      const ex = r.matches.map(m => byId.get(m.id)).filter(x => x && x.key);
      r.prior = !ex.length ? null : ex.every(x => x.key === r.line.key && (!r.line.tempo || x.tempo === r.line.tempo)) ? "same" : ex[0];
    });
    const same = matchResults.filter(r => r.prior === "same").length;
    const ok = matchResults.filter(r => r.status === "ok" && r.prior !== "same").length, warn = matchResults.filter(r => r.status === "warn" && r.prior !== "same").length, miss = matchResults.filter(r => !r.matches.length).length;
    $("matchInfo").textContent = `${ok} matched${warn ? `, ${warn} possible` : ""}${same ? `, ${same} already saved` : ""}${miss ? `, ${miss} not found` : ""}. Untick anything that looks wrong.`;
    const box = $("matchList"); box.innerHTML = "";
    matchResults.forEach((r, i) => {
      const d = document.createElement("label"); d.className = "mrow " + r.status + (r.prior === "same" ? " same" : "");
      let label = r.status === "ok" ? "✓ " + (r.source === "playlist" ? "Found in playlist" : r.source === "search" ? "Found on Spotify" : "Spotify ID given")
        : r.status === "warn" ? "⚠ Possible match — check it" : "✕ " + (r.note || "Not found");
      if (r.prior === "same") label = `= Already saved as ${r.line.key}${r.line.tempo ? " · " + r.line.tempo + " BPM" : ""} — no change`;
      else if (r.prior) label += ` · updates ${r.prior.key}${r.prior.tempo ? " · " + r.prior.tempo : ""} → ${r.line.key}${r.line.tempo ? " · " + r.line.tempo : ""}`;
      const m = r.matches.map(x => `<b>${esc(x.title)}</b> · ${esc(x.artist)}${x.duration ? " · " + fmtLen(x.duration) : ""}${x.album ? " · " + esc(x.album) : ""}`).join("<br>");
      // Matches and possible matches start ticked; ones with nothing new to save start unticked.
      if (r.checked === undefined) r.checked = (r.status === "ok" || r.status === "warn") && r.prior !== "same";
      d.innerHTML = `<input type="checkbox" ${r.checked ? "checked" : ""} ${r.matches.length ? "" : "disabled"}><div><div class="ms">${label}${r.matches.length > 1 ? ` (${r.matches.length} identical versions)` : ""}</div><div class="ml">${esc(r.line.raw)}</div>${m ? `<div class="mm">→ ${m}</div>` : ""}</div>`;
      d.querySelector("input").onchange = e => { r.checked = e.target.checked; };
      box.appendChild(d);
    });
  }
  $("matchBack").onclick = () => { go(matchReturn); window.scrollTo(0, 0); };
  $("matchSave").onclick = async () => {
    const extra = ls.get("kwb.extra", []); const idx = new Map(extra.map((a, i) => [a[0], i]));
    let n = 0;
    matchResults.filter(r => r.checked && r.matches.length && r.line.key).forEach(r => r.matches.forEach(mt => {
      const prev = byId.get(mt.id);
      const rec = [mt.id, mt.title || r.line.title || prev?.title || "", mt.artist || r.line.artist || prev?.artist || "", r.line.tempo, r.line.key, prev?.crate || "", prev?.euph ? 1 : 0, prev?.house ? 1 : 0];
      if (idx.has(mt.id)) extra[idx.get(mt.id)] = rec; else { idx.set(mt.id, extra.length); extra.push(rec); }
      n++;
    }));
    ls.set("kwb.extra", extra); await loadLibrary(); crateOptions(); render(); paintMore();
    $("matchStatus").className = "status ok"; $("matchStatus").textContent = `Saved keys for ${n} tracks.`;
    toast(`Saved keys for ${n} tracks`);
    $("paste").value = "";
    if (matchReturn === "playlists" && lastPlaylist) { go("playlists", true); openPlaylist(lastPlaylist); }
  };
  $("addPaste").onclick = () => startMatch($("paste").value, null, "more");
  // Screenshots / screen recordings of Spotify's Mix view → lines in the box, ready to Match.
  async function readShots(input, box, status) {
    const files = [...input.files]; input.value = "";
    if (!files.length) return;
    try {
      const tracks = await FlowOCR.readFiles(files, msg => { status.textContent = msg; });
      if (!tracks.length) { status.textContent = "Couldn't find any tracks. Make sure the screenshots are of Spotify's Mix view, uncropped."; return; }
      const lines = FlowOCR.toLines(tracks);
      box.value = (box.value.trim() ? box.value.trim() + "\n" : "") + lines;
      status.textContent = `Read ${tracks.length} tracks. Check the lines below, then tap ${box.id === "paste" ? "Find tracks" : "Match"}.`;
    } catch (e) { status.textContent = "Couldn't read those: " + e.message; }
  }
  $("moreShots").onchange = e => readShots(e.target, $("paste"), $("pasteStatus"));

  // ---------- playback + now playing ----------
  let np = null, follow = ls.get("kwb.follow", false), npTimer = null, lastNpId = null;
  const npBar = $("np");
  // "Play now". Spotify's direct play command (replace everything with this track) has been knocking
  // the iPhone off Spotify while it plays in the background, but queue-then-skip works reliably.
  // So when something is already playing, queue the track and skip to it. Only use the direct
  // command to wake Spotify when nothing is playing.
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function playNow(id) {
    if (liveOn) {
      if (isLive()) { await liveRun(() => liveInsertNext(id)); await waitUpNext(id); await Spotify.next(); return; }
      await startLive(id); return;
    }
    if (!np || !np.playing) { await Spotify.play(id); return; }
    // Spotify adds our track to the END of its queue, so step past anything queued ahead of it,
    // then hand those tracks back to the front of the app queue, in the same order.
    const skipped = []; let last = np.id;
    await Spotify.queue(id);
    await sleep(250);
    await Spotify.next();
    for (let i = 0; i < 30; i++) {
      await sleep(350);
      const st = await Spotify.playerState().catch(() => null);
      if (!st || st.id === last) continue;          // hasn't moved on yet
      if (st.id === id) break;                       // arrived
      skipped.push(st.id); last = st.id;
      qMeta.set(st.id, { title: st.title, artist: st.artist });
      if (skipped.length > 12) break;
      await Spotify.next();
    }
    if (skipped.length) {
      if (handed && skipped.includes(handed)) handed = null;
      appQ = skipped.concat(appQ.filter(x => !skipped.includes(x)));
      saveQ(); paintQueue();
      toast(`Playing now — ${skipped.length} queued ${skipped.length === 1 ? "track" : "tracks"} kept, up next`);
    }
  }
  async function playTrack(t) {
    if (!Spotify.connected()) { toast("Connect Spotify first (top right)"); return; }
    if (!Spotify.canPlay()) { showReconnect(); return; }
    try {
      toast("Playing: " + t.title);
      await playNow(t.id);
      setTimeout(pollNow, 900);
    } catch (e) { playError(e); }
  }
  // "Where should this play?" — shown when Spotify has no active device, instead of guessing one.
  Spotify.setDeviceChooser((ds, last) => new Promise(resolve => {
    const rank = d => (d.type === "Smartphone" ? 0 : d.id === last ? 1 : 2);
    ds = ds.slice().sort((a, b) => rank(a) - rank(b));
    const sh = $("sheet");
    sh.innerHTML = `<div class="grab"></div><div class="sh-t">Where should this play?</div><div class="sh-a">Nothing is playing on Spotify right now.</div>` +
      ds.map((d, i) => `<button class="item" data-i="${i}" type="button"><span>${devIcon(d.type)}</span>${esc(d.name)}${d.id === last ? ' <small class="muted">· last used</small>' : ""}</button>`).join("") +
      (ds.length ? "" : '<p class="note">Spotify can\'t see any devices. Open the Spotify app on your phone, then try again.</p>') +
      '<button class="item" data-i="x" type="button"><span>✕</span>Cancel</button>';
    sh.hidden = false; $("sheetBg").hidden = false;
    let done = false;
    const finish = v => { if (done) return; done = true; sh.hidden = true; $("sheetBg").hidden = true; $("sheetBg").removeEventListener("click", bg); resolve(v); };
    const bg = () => finish("cancel");
    $("sheetBg").addEventListener("click", bg);
    sh.querySelectorAll("[data-i]").forEach(b => b.onclick = () => finish(b.dataset.i === "x" ? "cancel" : ds[+b.dataset.i]));
  }));
  function playError(e) {
    if (e.code === "cancel") return;
    if (e.code === "auth") { toast("Spotify sign-in expired. Tap Connect Spotify."); paintSpotifyBtn(); return; }
    if (e.code === "nodevice") { toast(e.message, 5000); return; }
    if (e.status === 403) { toast("Spotify refused: playback needs Premium and an active Spotify app.", 5000); return; }
    toast("Couldn't play: " + e.message, 4000);
  }
  function showReconnect() {
    npBar.hidden = false; document.body.classList.add("has-np");
    $("npArt").style.backgroundImage = "";
    $("npTitle").textContent = "Reconnect Spotify to play from ASH//FLOW";
    $("npSub").textContent = "One-time step to allow playback control.";
    $("npPP").innerHTML = IC.reconnect; $("npPP").onclick = () => Spotify.login().catch(err => toast(err.message));
  }
  function paintNp() {
    paintLikeBtns();
    if (!np || np.none) { npBar.hidden = true; document.body.classList.remove("has-np"); return; }
    npBar.hidden = false; document.body.classList.add("has-np");
    const rec = byId.get(np.id);
    $("npArt").style.backgroundImage = np.art ? `url("${np.art}")` : "";
    $("npTitle").textContent = np.title;
    $("npSub").innerHTML = (rec && rec.key ? `<span class="k" style="background:${col(parseInt(rec.key))}">${rec.key}</span>${rec.tempo ? rec.tempo + " · " : ""}` : '<span class="k" style="background:var(--surface);color:var(--muted)">?</span>') + esc(np.artist);
    $("npPP").innerHTML = np.playing ? IC.pause : IC.play;
    paintVolume();
    $("npPP").onclick = async () => {
      try { if (np.playing) await Spotify.pause(); else await Spotify.resume(); np.playing = !np.playing; paintNp(); setTimeout(pollNow, 800); } catch (e) { playError(e); }
    };
    $("npMix").disabled = !(rec && rec.key);
    $("npMix").textContent = rec && rec.key ? "Mix out of this" : "No key yet";
    document.querySelectorAll(".row.now").forEach(r => r.classList.remove("now"));
    document.querySelectorAll(`.row[data-tid="${CSS.escape(np.id)}"]`).forEach(r => r.classList.add("now"));
  }
  $("npMix").onclick = () => { const rec = np && byId.get(np.id); if (rec && rec.key) setAnchor(rec); };
  function paintModes() {
    $("npQueue").textContent = "Queue · " + (appQ.length + (handed ? 1 : 0));
    $("npFollow").setAttribute("aria-pressed", follow ? "true" : "false");
    $("npFollow").textContent = follow ? "Following ✓" : "Follow";
  }
  $("npQueue").onclick = () => { go("playing"); window.scrollTo(0, document.body.scrollHeight); };
  $("npFollow").onclick = () => {
    follow = !follow; ls.set("kwb.follow", follow); paintModes();
    toast(follow ? "Following what Spotify plays" : "Stopped following");
    if (follow && np) { const rec = byId.get(np.id); if (rec && rec.key && (!state.anchor || state.anchor.id !== rec.id)) setAnchor(rec, false, true); }
  };
  let lastPoll = 0;
  async function pollNow() {
    if (!Spotify.connected() || !Spotify.canPlay() || document.visibilityState !== "visible") return;
    lastPoll = Date.now();
    try {
      const fresh = await Spotify.playerState();
      // Spotify briefly reports "nothing playing" between tracks or when the phone's connection blips.
      // Keep showing the last track unless it has said so for 12 seconds straight.
      if (fresh) {
        emptySince = 0; np = fresh; noteArt(fresh.id, fresh.art);
        const kr = byId.get(fresh.id); if (kr && kr.key) { lastKeyed = { id: kr.id, at: Date.now() }; ls.set("kwb.lastKeyed", lastKeyed); }
      }
      else { if (!emptySince) emptySince = Date.now(); if (!np || Date.now() - emptySince >= 12000) np = null; }
      if (np && np.progress >= 30000 && loggedFor !== np.id) { loggedFor = np.id; addHistory([{ id: np.id, title: np.title, artist: np.artist, at: np.at - np.progress, src: "app" }]); }
      if (Date.now() - lastRecentSync > 120000) syncRecent();
      if (np && handed && np.id === handed) { handed = null; saveQ(); }
      if (np && np.id !== lastNpId) {
        lastNpId = np.id; noteStarted(np.id);
        liveTrack(); checkHanded(); headsKey = "";
        if (!$("view-playing").hidden) paintSuggest();
        if (follow) { const rec = byId.get(np.id); if (rec && rec.key && (!state.anchor || state.anchor.id !== rec.id)) setAnchor(rec, false, true); }
      }
      paintNp(); paintPlaying(); pump();
    } catch (e) { if (e.code === "auth") paintSpotifyBtn(); }
  }
  let emptySince = 0;
  // What suggestions are based on: the playing track if it has a key; otherwise the last track that did
  // (within 3 hours), so an unknown song from Spotify's autoplay doesn't break the chain.
  let lastKeyed = ls.get("kwb.lastKeyed", null);
  function mixRef() {
    const cur = np && byId.get(np.id);
    if (cur && cur.key) return { rec: cur, fallback: false };
    if (lastKeyed && Date.now() - lastKeyed.at < 3 * 3600e3) { const r = byId.get(lastKeyed.id); if (r && r.key) return { rec: r, fallback: true }; }
    return { rec: null, fallback: false };
  }
  function startPolling() {
    clearInterval(npTimer); pollNow();
    npTimer = setInterval(pollNow, !$("view-playing").hidden ? 3000 : 5000);
  }

  // ---------- Playing tab ----------
  const fmt = ms => { ms = Math.max(0, ms || 0); const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  let seeking = false;
  const posNow = () => !np ? 0 : Math.min(np.duration || 0, np.progress + (np.playing ? Date.now() - (np.at || Date.now()) : 0));
  function paintProgress() {
    if (!np || seeking || $("view-playing").hidden) return;
    const pos = posNow(), d = np.duration || 1, v = Math.round(pos / d * 1000), sk = $("pvSeek");
    sk.value = v; sk.style.setProperty("--pct", (v / 10) + "%");
    $("pvPos").textContent = fmt(pos); $("pvLeft").textContent = "-" + fmt(d - pos);
  }
  setInterval(paintProgress, 500);
  function paintPlaying() {
    if ($("view-playing").hidden) return;
    $("pvEmpty").hidden = !!np; $("pv").hidden = !np;
    if (!np) return;
    const rec = byId.get(np.id);
    $("pvArt").style.backgroundImage = np.artLarge || np.art ? `url("${np.artLarge || np.art}")` : "";
    $("pvTitle").textContent = np.title; $("pvArtist").textContent = np.artist;
    $("pvKey").innerHTML = rec && rec.key
      ? `<span class="k" style="background:${col(parseInt(rec.key))}">${rec.key}</span>${NAMES[rec.key]}${rec.tempo ? " · " + rec.tempo + " BPM" : ""}`
      : "No key yet in your library";
    $("pvWhere").innerHTML = (isLive() ? '<div class="livechip"><span></span>Playing from your Live set</div>' : "") + (rec ? whereHtml(rec) + noteHtml(rec.id) : "");
    $("pvDev").textContent = "";
    $("pvDevName").textContent = np.device || "Unknown device";
    $("pvDevIco").innerHTML = devIcon(np.deviceType); paintVolume();
    $("pvPP").innerHTML = np.playing ? IC.pause : IC.play;
    $("pvMix").disabled = !(rec && rec.key);
    paintProgress();
  }
  const seekEl = $("pvSeek");
  seekEl.addEventListener("input", () => {
    if (!np) return; seeking = true;
    const pos = seekEl.value / 1000 * (np.duration || 0);
    seekEl.style.setProperty("--pct", (seekEl.value / 10) + "%");
    $("pvPos").textContent = fmt(pos); $("pvLeft").textContent = "-" + fmt((np.duration || 0) - pos);
  });
  seekEl.addEventListener("change", async () => {
    if (!np) { seeking = false; return; }
    const pos = seekEl.value / 1000 * (np.duration || 0);
    np.progress = pos; np.at = Date.now(); seeking = false;
    try { await Spotify.seek(pos); setTimeout(pollNow, 900); } catch (e) { playError(e); }
  });
  $("pvPP").onclick = () => $("npPP").click();
  $("pvPrev").onclick = async () => { try { await Spotify.previous(); setTimeout(pollNow, 700); } catch (e) { playError(e); } };
  // Next: if Spotify has nothing lined up, skipping would just stop the music, so play something instead.
  async function smartNext() {
    try {
      if (isLive()) {
        if (!appQ.length) {
          const cur = mixRef().rec, s = cur ? suggest(cur, 1)[0] : null;
          if (s) { await liveRun(() => liveInsertNext(s.t.id)); await waitUpNext(s.t.id); toast("Nothing was lined up — playing " + s.t.title); }
        }
        await Spotify.next(); setTimeout(pollNow, 700); return;
      }
      if (!handed && appQ.length) {
        const id = appQ.shift(); saveQ(); await playNow(id);
        toast("Playing: " + recOf(id, qMeta.get(id)).title); setTimeout(pollNow, 900); return;
      }
      if (!handed) {
        let up = []; try { up = await Spotify.upNext(); } catch (e) {}
        up = up.filter(t => !np || t.id !== np.id);
        if (!up.length) {
          const cur = mixRef().rec, s = cur ? suggest(cur, 1)[0] : null;
          if (s) { await playNow(s.t.id); toast("Nothing was lined up — playing " + s.t.title); setTimeout(pollNow, 900); return; }
        }
      }
      await Spotify.next(); setTimeout(pollNow, 700);
    } catch (e) { playError(e); }
  }
  $("pvNext").onclick = smartNext;
  const devIcon = t => ({ Smartphone: IC.phone, Computer: IC.laptop, Speaker: IC.speaker, TV: IC.tv, CastAudio: IC.speaker, CastVideo: IC.tv, AVR: IC.speaker, Tablet: IC.phone, Automobile: IC.car }[t] || IC.speaker);
  const isCast = d => /cast/i.test(d.type || "") || /google|nest|chromecast/i.test(d.name || "");
  const devHint = d => d.type === "Smartphone" || d.type === "Computer" || d.type === "Tablet"
    ? "Crossfade works here. Send the sound on with AirPlay, Bluetooth or a cable."
    : isCast(d) ? "Google speaker: switching to it often only works from the Spotify app."
    : "Spotify Connect: best sound quality, but no crossfade.";
  // Spotify sometimes accepts a switch but never moves playback (common with Google speakers). Check, and say so.
  async function verifySwitch(d) {
    await new Promise(r => setTimeout(r, 2500));
    try {
      const st = await Spotify.playerState();
      if (st && st.device === d.name) { toast("Now playing on " + d.name); pollNow(); setTimeout(checkHanded, 1500); return; }
    } catch (e) {}
    showSwitchFailed(d);
  }
  function showSwitchFailed(d) {
    const sh = $("sheet");
    sh.innerHTML = `<div class="grab"></div><div class="sh-t">Couldn't switch to ${esc(d.name)}</div>
      <div class="sh-a">${isCast(d) ? "Google and Chromecast speakers can only be started reliably from the Spotify app itself, because the app has to find them on your home Wi-Fi. Pick it in Spotify; ASH//FLOW keeps controlling the music once it's playing there." : "Spotify didn't move playback to this device. Check it's switched on and connected, open Spotify on it if you can, then try again."}</div>
      <a class="item" href="spotify:"><span>${IC.open}</span>Open Spotify</a>
      <button class="item" type="button" id="swClose"><span>${IC.close}</span>Close</button>`;
    sh.hidden = false; $("sheetBg").hidden = false;
    $("swClose").onclick = closeMenu;
    pollNow();
  }
  $("pvDevice").onclick = async () => {
    const sh = $("sheet");
    sh.innerHTML = '<div class="grab"></div><div class="sh-t">Play on</div><div class="sh-a">Loading your devices…</div>';
    sh.hidden = false; $("sheetBg").hidden = false;
    try {
      const ds = await Spotify.devices();
      if (!ds.length) { sh.querySelector(".sh-a").textContent = "No devices found. Open Spotify on your phone or another device, then try again."; return; }
      sh.innerHTML = '<div class="grab"></div><div class="sh-t">Play on</div>' +
        ds.map((d, i) => `<button class="item dev${d.is_active ? " on" : ""}" type="button" data-i="${i}"><span>${devIcon(d.type)}</span><div><div>${esc(d.name)}${d.is_active ? " · playing" : ""}</div><small>${esc(devHint(d))}</small></div></button>`).join("") +
        `<div class="devhelp"><b>Missing a device?</b><br>Your iPhone: open the Spotify app for a few seconds, then tap Refresh.<br>Google, Nest or Chromecast speakers: Spotify only lets other apps see these once a session has started on them, so pick it once in the Spotify app; after that you can switch to and from it here.</div><button class="item" type="button" id="devRefresh"><span>${IC.refresh}</span>Refresh</button>`;
      $("devRefresh").onclick = () => $("pvDevice").click();
      sh.querySelectorAll("[data-i]").forEach(b => b.onclick = async () => {
        const d = ds[parseInt(b.dataset.i)];
        closeMenu();
        if (d.is_active) return;
        toast("Switching to " + d.name + "…");
        try { await Spotify.transfer(d.id); verifySwitch(d); }
        catch (e) { showSwitchFailed(d); }
      });
    } catch (e) { sh.querySelector(".sh-a").textContent = "Couldn't load devices: " + e.message; }
  };
  // ---------- volume ----------
  let volTimer = null, volDragging = false, pendingVol = null;
  function volIcon(v) { return v == null ? IC.vol1 : v === 0 ? IC.vol0 : v < 50 ? IC.vol1 : IC.vol2; }
  function paintVolume() {
    const can = !!(np && np.canVolume && np.volume != null);
    const v = can ? (pendingVol ?? np.volume) : null;
    [["pvVol", "pvVolPct"], ["npVol", "npVolPct"]].forEach(([sl, pc]) => {
      const el = $(sl); el.disabled = !can;
      if (!volDragging && v != null) { el.value = v; el.style.setProperty("--pct", v + "%"); }
      $(pc).textContent = can ? v + "%" : "—";
    });
    $("pvVolIco").innerHTML = volIcon(v); $("npVolBtn").innerHTML = volIcon(v);
    $("pvVolRow").title = can ? "" : "This device doesn't allow volume control from other apps";
    $("npVolDown").disabled = $("npVolUp").disabled = !can;
  }
  function sendVolume(v) {
    pendingVol = v; if (np) np.volume = v;
    clearTimeout(volTimer);
    volTimer = setTimeout(async () => {
      try { await Spotify.setVolume(v); } catch (e) { if (e.status === 403) toast("This device doesn't allow volume control from ASH//FLOW"); else playError(e); }
      setTimeout(() => { pendingVol = null; }, 1500);
    }, 180);
  }
  ["pvVol", "npVol"].forEach(id => {
    const el = $(id);
    el.addEventListener("input", () => { volDragging = true; const v = parseInt(el.value); el.style.setProperty("--pct", v + "%"); sendVolume(v); volDragging = false; paintVolume(); });
  });
  $("npVolBtn").onclick = () => { $("npVolRow").hidden = !$("npVolRow").hidden; document.body.classList.toggle("np-vol-open", !$("npVolRow").hidden); paintVolume(); };
  $("npVolDown").onclick = () => { if (np && np.volume != null) sendVolume(Math.max(0, (pendingVol ?? np.volume) - 5)), paintVolume(); };
  $("npVolUp").onclick = () => { if (np && np.volume != null) sendVolume(Math.min(100, (pendingVol ?? np.volume) + 5)), paintVolume(); };
  $("pvPrev").innerHTML = IC.prev; $("pvNext").innerHTML = IC.next; $("pvPP").innerHTML = IC.play; $("npPP").innerHTML = IC.play;
  $("pvChev").innerHTML = IC.chev; $("pvDevIco").innerHTML = IC.speaker; $("npVolBtn").innerHTML = IC.vol1; $("pvVolIco").innerHTML = IC.vol1;
  $("pvTitle").onclick = () => { if (np && np.albumId) openAlbum(np.albumId); };
  $("pvArtist").onclick = () => { if (np) chooseArtist(np.artists); };
  $("npTitle").onclick = () => { if (np) { go("playing"); window.scrollTo(0, 0); } };
  $("pvMix").onclick = () => { const rec = np && byId.get(np.id); if (rec && rec.key) setAnchor(rec); };
  // ---------- ASH//FLOW queue ----------
  // Spotify lets apps add to its queue but never remove, so the queue lives here.
  // Only the next track is handed to Spotify; when it starts playing, the following one is handed over.
  let appQ = ls.get("kwb.appq", []), handed = ls.get("kwb.handed", null), pumping = false;
  function saveQ() { ls.set("kwb.appq", appQ); ls.set("kwb.handed", handed); paintModes(); paintQueue(); if (typeof paintSuggest === "function") paintSuggest(); }
  function enqueue(t) {
    if (!Spotify.connected()) { toast("Connect Spotify first (top right)"); return; }
    if (!Spotify.canPlay()) { showReconnect(); return; }
    if (isLive()) { appQ.push(t.id); paintQueue(); liveDo(() => liveAppend([t.id])); toast(`Queued: ${t.title} (${appQ.length} in queue)`); return; }
    appQ.push(t.id); saveQ();
    toast(`Queued: ${t.title} (${appQ.length + (handed ? 1 : 0)} in queue)`);
    pump();
  }
  // ---------- Live set ----------
  // Spotify plays from a private playlist, "ASH//FLOW Live", which the app edits. Everything after the
  // playing track IS your queue, so tracks can be inserted, moved and removed — no skipping, no blips.
  // The Live set is retired: Spotify's players don't reliably follow playlist edits. The plain queue is used instead.
  let liveOn = false;
  let live = ls.get("kwb.live", { pl: null, items: [], cur: -1 });
  const saveLive = () => ls.set("kwb.live", live);
  $("liveTog").checked = liveOn;
  $("liveTog").onchange = () => { liveOn = $("liveTog").checked; ls.set("kwb.liveOn", liveOn); toast(liveOn ? "Live set on — the next track you play starts it" : "Live set off — using Spotify's queue"); paintPlaying(); };
  let liveChain = Promise.resolve();
  // Playlist edits run one at a time, in order; a failed one doesn't block the rest.
  const liveRun = fn => { const p = liveChain.catch(() => {}).then(fn); liveChain = p.catch(() => {}); return p; };
  const liveDo = fn => liveRun(fn).catch(liveError);
  const isLive = () => !!(liveOn && live.pl && np && np.context === "spotify:playlist:" + live.pl);
  function liveError(e) {
    if (e && e.status === 404) { live.pl = null; saveLive(); toast("The Live set playlist was missing. It'll be recreated next time you play a track."); }
    else playError(e);
  }
  const setTail = () => { appQ = live.items.slice(live.cur + 1); ls.set("kwb.appq", appQ); paintQueue(); paintModes(); if (typeof paintSuggest === "function") paintSuggest(); };
  async function ensureLivePl() {
    if (live.pl) return live.pl;
    const pl = await Spotify.createPlaylist("ASH//FLOW Live (beta)", "Your live set from ASH//FLOW beta. The app edits this as you queue, so leave it be.", []);
    live.pl = pl.id; saveLive(); return pl.id;
  }
  // Keep the mirror in step when Spotify moves on to another track.
  function liveTrack() {
    if (!isLive() || live.items[live.cur] === np.id) return;
    let i = live.items.indexOf(np.id, live.cur + 1);
    if (i < 0) i = live.items.indexOf(np.id);
    if (i < 0) return;                         // e.g. a track still sitting in Spotify's own queue
    live.cur = i; saveLive(); setTail();
  }
  async function startLive(firstId) {
    const pl = await ensureLivePl();
    const ids = [firstId, ...appQ.filter(x => x !== firstId)];
    try { await Spotify.liveReplace(pl, ids); }
    catch (e) { if (e.status === 404) { live.pl = null; saveLive(); return startLive(firstId); } throw e; }
    live.items = ids; live.cur = 0; saveLive(); setTail();
    await Spotify.playPlaylist(pl, 0);
  }
  // Give the phone a moment to pick up the playlist change before skipping.
  async function waitUpNext(id) {
    for (let i = 0; i < 8; i++) {
      await sleep(400);
      try { const up = (await Spotify.upNext()).filter(t => !np || t.id !== np.id); if (up.length && up[0].id === id) return true; } catch (e) {}
    }
    return false;
  }
  // Re-read the playlist from Spotify and confirm where it's playing, using Spotify's own "up next" to pick the
  // right spot if the playing song appears more than once. Stops the app inserting in the wrong place.
  let liveSyncedAt = 0;
  async function liveResync(force) {
    if (!isLive() || (!force && Date.now() - liveSyncedAt < 3000)) return;
    const ids = (await Spotify.playlistTracks(live.pl)).map(t => t.id);
    let up = []; try { up = (await Spotify.upNext()).map(t => t.id).filter(x => x !== np.id); } catch (e) {}
    const hits = []; ids.forEach((x, i) => { if (x === np.id) hits.push(i); });
    if (!hits.length) return;                       // playing something outside the set
    let cur = hits.length === 1 ? hits[0] : (hits.find(i => up.length && ids[i + 1] === up[0]) ?? hits[hits.length - 1]);
    live.items = ids; live.cur = cur; saveLive(); setTail(); liveSyncedAt = Date.now();
  }
  async function liveInsertNext(id) {
    await liveResync(true);
    const pos = live.cur + 1;
    await Spotify.liveAdd(live.pl, [id], pos);
    live.items.splice(pos, 0, id); saveLive(); setTail();
  }
  async function liveAppend(ids) {
    await liveResync();
    await Spotify.liveAdd(live.pl, ids);
    live.items.push(...ids); saveLive(); setTail();
  }
  // Take a track out of "up next": move it to just before the playing track (into the played part).
  async function liveRemoveAt(qi) {
    await liveResync();
    const pos = live.cur + 1 + qi, id = live.items[pos]; if (!id) return;
    await Spotify.liveMove(live.pl, pos, live.cur);
    live.items.splice(pos, 1); live.items.splice(live.cur, 0, id); live.cur += 1; saveLive(); setTail();
  }
  async function liveReorder(newTail) {
    await liveResync();
    const old = live.items.slice(live.cur + 1);
    let i = 0; while (i < old.length && old[i] === newTail[i]) i++;
    if (i === old.length) return;
    let from, before;
    const up = old.slice(); const idx = up.indexOf(newTail[i], i); up.splice(idx, 1); up.splice(i, 0, newTail[i]);
    if (up.every((v, k) => v === newTail[k])) { from = idx; before = i; } else { from = i; before = newTail.indexOf(old[i], i) + 1; }
    await Spotify.liveMove(live.pl, live.cur + 1 + from, live.cur + 1 + before);
    const base = live.cur + 1, [it] = live.items.splice(base + from, 1); live.items.splice(base + (before > from ? before - 1 : before), 0, it);
    saveLive(); setTail();
  }
  // Queue several tracks (end of the list) — Live set or Spotify's queue, whichever is in use.
  function enqueueIds(ids, label) {
    if (!Spotify.connected()) { toast("Connect Spotify first (top right)"); return; }
    if (!Spotify.canPlay()) { showReconnect(); return; }
    if (!ids.length) return;
    if (isLive()) { appQ.push(...ids); paintQueue(); liveDo(() => liveAppend(ids)); }
    else { ids.forEach(id => appQ.push(id)); saveQ(); pump(); }
    toast(label || `Queued ${ids.length} tracks`);
  }
  // Put a track straight after the playing one, without skipping to it.
  function playNextUp(id, title) {
    if (isLive()) liveDo(() => liveInsertNext(id));
    else { appQ.unshift(id); saveQ(); pump(); }
    toast("Up next: " + title);
  }

  // Hand the next track to Spotify only in the last 15 seconds of the current one (or straight away if nothing
  // is playing, or the app is being closed). Until then Spotify's own queue stays empty, so "play now" can
  // queue a track and skip straight to it, with nothing in between.
  const HANDOVER_MS = 15000;
  async function pump(force) {
    if (isLive()) return;
    if (pumping || handed || !appQ.length || !Spotify.connected() || !Spotify.canPlay()) return;
    if (!force && np && np.playing && np.duration && np.duration - posNow() > HANDOVER_MS && document.visibilityState === "visible") return;
    pumping = true;
    const id = appQ[0];
    try { await Spotify.queue(id); appQ.shift(); handed = id; saveQ(); }
    catch (e) { playError(e); }
    finally { pumping = false; }
  }
  // If Spotify lost the handed track (new device, cleared queue), hand the next one over again.
  async function checkHanded() {
    if (!handed || !np || np.id === handed) return;
    try {
      const raw = await Spotify.upNext();
      if (!raw.some(it => it.id === handed)) { handed = null; saveQ(); pump(); }
    } catch (e) {}
  }
  function recOf(id, fallback) { return byId.get(id) || Object.assign({ id, title: "Unknown track", artist: "", tempo: 0, key: null }, fallback || {}); }
  const qMeta = new Map();
  function paintQueue() {
    const box = $("pvQueue"); if (!box) return;
    box.innerHTML = "";
    const ids = (handed ? [handed] : []).concat(appQ);
    $("qClear").hidden = !appQ.length;
    if (!ids.length) { box.innerHTML = '<p class="note">Your queue is empty. Swipe right on any track to add it.</p>'; return; }
    let prev = np ? byId.get(np.id) : null;
    ids.forEach((id, i) => {
      const rec = recOf(id, qMeta.get(id)), locked = i === 0 && !!handed;
      const r = rowEl(rec, null, setAnchor);
      r.classList.add("qrow", "noswipe"); if (locked) r.classList.add("locked");
      r.dataset.id = id; r.dataset.qi = locked ? "" : String(i - (handed ? 1 : 0));
      const h = document.createElement("span"); h.className = "drag"; h.textContent = "≡"; r.prepend(h);
      r.querySelector(".add").remove();
      const del = document.createElement("button"); del.type = "button"; del.className = "del"; del.textContent = "✕"; del.setAttribute("aria-label", "Remove from queue");
      if (locked) { del.disabled = true; del.style.visibility = "hidden"; }
      r.querySelector(".play").replaceWith(del);
      del.onclick = () => { const qi = parseInt(r.dataset.qi); if (isLive()) { liveDo(() => liveRemoveAt(qi)); toast("Removed from queue"); return; } appQ.splice(qi, 1); saveQ(); toast("Removed from queue"); };
      const lab = document.createElement("div"); lab.className = "rel";
      const rel = prev && prev.key ? relations(prev.key) : null, m = rel && rec.key ? rel[rec.key] : null;
      lab.textContent = !rec.key ? "No key yet" : !prev || !prev.key ? "" : m ? MOVE_NAME[m] : "Key clash";
      if (rec.key && prev && prev.key && !m) lab.style.color = "var(--warn)";
      const tt = r.querySelector(".tt");
      if (locked) { const lk = document.createElement("div"); lk.className = "lock"; lk.textContent = "Next · sent to Spotify"; tt.prepend(lk); }
      if (lab.textContent) tt.prepend(lab);
      box.appendChild(r);
      prev = rec;
    });
  }
  makeSortable($("pvQueue"), ids => { if (isLive()) { const nt = ids.slice(); liveDo(() => liveReorder(nt)); return; } appQ = ids; saveQ(); });
  $("qClear").onclick = () => {
    const b = $("qClear");
    if (!b.dataset.confirm) { b.dataset.confirm = "1"; b.textContent = "Tap again to clear"; setTimeout(() => { delete b.dataset.confirm; b.textContent = "Clear queue"; }, 3000); return; }
    delete b.dataset.confirm; b.textContent = "Clear queue";
    if (isLive()) { const n = appQ.length; liveDo(async () => { for (let i = n - 1; i >= 0; i--) await liveRemoveAt(i); }); toast("Queue cleared"); return; }
    appQ = []; saveQ(); toast("Queue cleared");
  };
  function loadUpNext() { paintQueue(); }

  // ---------- swipe right to queue ----------
  // iPhone needs touch events (with preventDefault once a sideways swipe is detected); mouse uses pointer events.
  let suppressTap = 0;
  (function enableSwipe() {
    let row = null, x0 = 0, y0 = 0, dx = 0, mode = null;
    const startAt = (target, x, y) => {
      const r = target.closest(".row");
      if (!r || r.classList.contains("noswipe") || !r._track || target.closest("button,.drag,a,input")) return false;
      row = r; x0 = x; y0 = y; dx = 0; mode = null; return true;
    };
    const moveTo = (x, y, ev) => {
      if (!row) return;
      const ddx = x - x0, ddy = y - y0;
      if (!mode) {
        if (Math.abs(ddx) > 8 && Math.abs(ddx) > Math.abs(ddy) && ddx > 0) mode = "swipe";
        else if (Math.abs(ddy) > 8 || ddx < -8) { row = null; return; }
        else return;
      }
      if (ev && ev.cancelable) ev.preventDefault();          // stop the page scrolling sideways or vertically mid-swipe
      dx = Math.max(0, Math.min(140, ddx));
      row.classList.add("swiping"); row.style.transform = `translateX(${dx}px)`;
    };
    const finish = () => {
      if (!row) return;
      const r = row; row = null;
      if (mode !== "swipe") return;
      suppressTap = Date.now() + 400;
      r.classList.remove("swiping"); r.style.transform = "";
      if (dx > 60) { r.classList.add("swiped"); enqueue(r._track); setTimeout(() => r.classList.remove("swiped"), 450); }
    };
    // touch (iPhone)
    document.addEventListener("touchstart", e => { if (e.touches.length === 1) startAt(e.target, e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    document.addEventListener("touchmove", e => { if (row && e.touches.length === 1) moveTo(e.touches[0].clientX, e.touches[0].clientY, e); }, { passive: false });
    document.addEventListener("touchend", finish); document.addEventListener("touchcancel", finish);
    // mouse (desktop)
    document.addEventListener("pointerdown", e => { if (e.pointerType === "mouse" && e.button === 0) startAt(e.target, e.clientX, e.clientY); });
    document.addEventListener("pointermove", e => { if (e.pointerType === "mouse") moveTo(e.clientX, e.clientY, null); });
    document.addEventListener("pointerup", e => { if (e.pointerType === "mouse") finish(); });
  })();

  // ---------- track menu ----------
  function closeMenu() { $("sheet").hidden = true; $("sheetBg").hidden = true; }
  $("sheetBg").onclick = closeMenu;
  function openMenu(t) {
    const sh = $("sheet");
    const inCrate = crate.includes(t.id);
    sh.innerHTML = `<div class="grab"></div><div class="sh-t">${esc(t.title)}</div><div class="sh-a">${esc(t.artist)}${t.key ? ` · ${t.key} ${NAMES[t.key]}` : ""}${t.tempo ? ` · ${t.tempo} BPM` : ""}</div>${whereHtml(byId.get(t.id) || t)}${noteHtml(t.id)}
      <button class="item" data-a="play" type="button"><span>${IC.play}</span>Play now</button>
      <button class="item" data-a="queue" type="button"><span>${IC.queue}</span>Add to queue</button>
      <button class="item" data-a="crate" type="button"><span>${IC.crate}</span>${inCrate ? "Remove from crate" : "Add to crate"}</button>
      <button class="item" data-a="note" type="button"><span>✎</span>${noteOf(t.id) ? "Edit note" : "Add note"}</button>
      <button class="item" data-a="mix" type="button" ${t.key ? "" : "disabled"}><span>${IC.mix}</span>Mix out of this</button>
      <button class="item" data-a="artist" type="button"><span>${IC.artist}</span>Go to artist</button>
      <button class="item" data-a="album" type="button"><span>${IC.album}</span>Go to album</button>
      <button class="item" data-a="like" type="button"><span>${liked.get("spotify:track:" + t.id) ? IC.liked : IC.likeAdd}</span>${liked.get("spotify:track:" + t.id) ? "Remove from Liked Songs" : "Add to Liked Songs"}</button>
      <button class="item" data-a="open" type="button"><span>${IC.open}</span>Open in Spotify</button>`;
    sh.hidden = false; $("sheetBg").hidden = false;
    const act = a => sh.querySelector(`[data-a="${a}"]`);
    act("play").onclick = () => { closeMenu(); playTrack(t); };
    act("queue").onclick = () => { closeMenu(); enqueue(t); };
    act("crate").onclick = () => { closeMenu(); const inn = toggleCrate(t.id); toast(inn ? "Added to crate" : "Removed from crate"); render(); if (!$("view-crate").hidden) paintCrate(); };
    act("mix").onclick = () => { closeMenu(); setAnchor(t); };
    act("note").onclick = () => editNote(t);
    act("like").onclick = () => { closeMenu(); toggleLike("spotify:track:" + t.id, t.title); };
    act("open").onclick = () => { closeMenu(); location.href = "https://open.spotify.com/track/" + t.id; };
    const needSpotify = () => { if (!Spotify.connected()) { toast("Connect Spotify first (top right)"); return false; } return true; };
    act("album").onclick = async () => {
      if (!needSpotify()) return;
      closeMenu();
      try { const d = await Spotify.getTrack(t.id); if (d.album) openAlbum(d.album.id); } catch (e) { toast("Couldn't load the album"); }
    };
    act("artist").onclick = async () => {
      if (!needSpotify()) return;
      try {
        const d = await Spotify.getTrack(t.id);
        if (d.artists.length === 1) { closeMenu(); openArtist(d.artists[0].id, d.artists[0].name); return; }
        sh.innerHTML = '<div class="grab"></div><div class="sh-t">Which artist?</div>' + d.artists.map(a => `<button class="item" type="button" data-id="${esc(a.id)}"><span>${IC.artist}</span>${esc(a.name)}</button>`).join("");
        sh.querySelectorAll("[data-id]").forEach(b => b.onclick = () => { closeMenu(); openArtist(b.dataset.id, b.textContent.trim()); });
      } catch (e) { closeMenu(); toast("Couldn't load the artist"); }
    };
  }

  // ---------- artist and album pages ----------
  const browseStack = [];
  let returnView = "wheel";
  function currentView() { const v = document.querySelector(".view:not([hidden])"); return v ? v.id.replace("view-", "") : "wheel"; }
  function showBrowse(page) {
    if (currentView() !== "browse") { returnView = currentView(); browseStack.length = 0; }
    browseStack.push(page);
    go("browse"); window.scrollTo(0, 0); renderBrowse();
  }
  $("browseBack").onclick = () => {
    browseStack.pop();
    if (browseStack.length) { renderBrowse(); window.scrollTo(0, 0); } else { go(returnView); window.scrollTo(0, 0); }
  };
  const openAlbum = id => showBrowse({ type: "album", id });
  const openArtist = (id, name) => showBrowse({ type: "artist", id, name });
  function chooseArtist(artists) {
    if (!artists || !artists.length) return;
    if (artists.length === 1) { openArtist(artists[0].id, artists[0].name); return; }
    const sh = $("sheet");
    sh.innerHTML = '<div class="grab"></div><div class="sh-t">Which artist?</div>' + artists.map(a => `<button class="item" type="button" data-id="${esc(a.id)}"><span>${IC.artist}</span>${esc(a.name)}</button>`).join("");
    sh.hidden = false; $("sheetBg").hidden = false;
    sh.querySelectorAll("[data-id]").forEach(b => b.onclick = () => { closeMenu(); openArtist(b.dataset.id, b.textContent.trim()); });
  }
  // ---------- play or shuffle a whole album / artist ----------
  function shuffled(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  async function playMany({ album, ids, name, shuffle }) {
    if (!Spotify.connected()) { toast("Connect Spotify first (top right)"); return; }
    if (!Spotify.canPlay()) { showReconnect(); return; }
    try {
      if (album) await Spotify.playContext("spotify:album:" + album);
      else { if (!ids.length) { toast("No tracks to play"); return; } await Spotify.playList(ids); }
      // We shuffle in the app, so keep Spotify's own shuffle off; that also keeps "Play" in order.
      Spotify.setShuffle(false).catch(() => {});
      toast((shuffle ? "Shuffling: " : "Playing: ") + name + (ids ? ` · ${Math.min(ids.length, 100)} tracks` : ""));
      setTimeout(pollNow, 900);
    } catch (e) { playError(e); }
  }
  async function playArtist(a, mine, shuffle) {
    toast(`Gathering ${a.name}'s tracks…`);
    const lower = a.name.toLowerCase(), seen = new Set(), ids = [];
    const add = (id, title, artist) => {
      const k = (title || "").toLowerCase().replace(/\s*[-(\[].*$/, "").trim();
      if (!id || seen.has(id) || (k && seen.has("t:" + k))) return;
      if (artist && !artist.toLowerCase().includes(lower)) return;
      seen.add(id); if (k) seen.add("t:" + k); ids.push(id);
    };
    const rel = (a.albums || []).slice(0, 15);
    const albums = await Promise.all(rel.map(al => Spotify.getAlbum(al.id).catch(() => null)));
    albums.forEach(al => al && al.tracks.forEach(t => add(t.id, t.title, t.artist)));
    mine.forEach(t => add(t.id, t.title, t.artist));
    if (!ids.length) { toast("Couldn't get any tracks for this artist from Spotify"); return; }
    playMany({ ids: shuffle ? shuffled(ids) : ids, name: a.name, shuffle });
  }
  async function renderBrowse() {
    const w = $("browseWrap"), page = browseStack[browseStack.length - 1];
    w.innerHTML = '<p class="note">Loading…</p>';
    try {
      if (page.type === "album") {
        const a = page.data || (page.data = await Spotify.getAlbum(page.id));
        a.tracks.forEach(t => { qMeta.set(t.id, { title: t.title, artist: t.artist }); noteArt(t.id, a.smallImg); });
        const known = a.tracks.filter(t => byId.get(t.id) && byId.get(t.id).key).length;
        w.innerHTML = `<div class="bhead"><div class="bimg" style="background-image:url('${esc(a.image)}')"></div><div><div class="bt">${esc(a.name)}</div>
          <div class="bs">${a.artists.map(x => `<a href="#" data-artist="${esc(x.id)}" style="color:inherit">${esc(x.name)}</a>`).join(", ")}${a.year ? " · " + a.year : ""} · ${a.total && a.total > a.tracks.length ? `showing ${a.tracks.length} of ${a.total} tracks` : a.tracks.length + " tracks"}</div>
          <div class="bs">${known} with a key in your library</div></div></div>
          <div class="crate-actions"><button class="btn" type="button" id="bPlay">${IC.play}Play all ${a.tracks.length}</button><button class="btn" type="button" id="bShuf">${IC.shuffle}Shuffle all</button><button class="btn ghost" type="button" id="bAllQ">Queue all</button><button class="btn ghost albumlike${liked.get("spotify:album:" + a.id) ? " on" : ""}" type="button" id="bLike" data-lk="spotify:album:${esc(a.id)}">${liked.get("spotify:album:" + a.id) ? IC.liked + "Saved" : IC.likeAdd + "Save album"}</button><a class="btn ghost" href="https://open.spotify.com/album/${esc(a.id)}">Open in Spotify</a></div>`;
        likeCheck("spotify:album:" + a.id);
        $("bLike").onclick = () => toggleLike("spotify:album:" + a.id, a.name);
        w.querySelectorAll("[data-artist]").forEach(el => el.onclick = e => { e.preventDefault(); openArtist(el.dataset.artist); });
        const list = document.createElement("div"); list.className = "list";
        a.tracks.forEach(t => list.appendChild(rowEl(recOf(t.id, t), null, setAnchor)));
        w.appendChild(list);
        $("bPlay").onclick = () => playMany({ album: a.id, name: a.name });
        $("bShuf").onclick = () => playMany({ ids: shuffled(a.tracks.map(t => t.id)), name: a.name, shuffle: true });
        $("bAllQ").onclick = () => {
          if (!Spotify.connected()) { toast("Connect Spotify first (top right)"); return; }
          if (!Spotify.canPlay()) { showReconnect(); return; }
          const ids = a.tracks.map(t => t.id).filter(id => !appQ.includes(id) && id !== handed);
          enqueueIds(ids, `Queued ${ids.length} tracks from ${a.name}`);
        };
      } else {
        let a = page.data;
        if (!a) { try { a = page.data = await Spotify.getArtist(page.id); } catch (e) { a = { id: page.id, name: page.name || "Artist", image: "", genres: [], albums: [], albumsError: e.message }; } }
        const name = a.name.toLowerCase();
        const mine = T.filter(t => t.artist.toLowerCase().split(/,\s*/).includes(name) || t.artist.toLowerCase() === name);
        w.innerHTML = `<div class="bhead artist"><div class="bimg" style="background-image:url('${esc(a.image)}')"></div><div><div class="bt">${esc(a.name)}</div>
          <div class="bs">${a.genres.slice(0, 3).map(esc).join(" · ")}</div><div class="bs">${mine.length} in your library</div></div></div>
          <div class="crate-actions"><button class="btn" type="button" id="bPlay">${IC.play}Play all</button><button class="btn" type="button" id="bShuf">${IC.shuffle}Shuffle all</button><a class="btn ghost" href="https://open.spotify.com/artist/${esc(a.id)}">Open in Spotify</a></div>`;
        $("bPlay").onclick = () => playArtist(a, mine, false);
        $("bShuf").onclick = () => playArtist(a, mine, true);
        if (mine.length) {
          const h = document.createElement("h2"); h.textContent = "In your library"; w.appendChild(h);
          const list = document.createElement("div"); list.className = "list";
          mine.sort((x, y) => x.tempo - y.tempo).forEach(t => list.appendChild(rowEl(t, null, setAnchor)));
          w.appendChild(list);
        }
        const h2 = document.createElement("h2"); h2.textContent = "Releases"; w.appendChild(h2);
        if (!a.albums.length) { const n = document.createElement("p"); n.className = "note"; n.textContent = a.albumsError ? "Spotify wouldn't send this artist's releases (" + a.albumsError + "). Use Open in Spotify to see them." : "No releases found."; w.appendChild(n); }
        const g = document.createElement("div"); g.className = "albums";
        a.albums.forEach(al => {
          const b = document.createElement("button"); b.type = "button"; b.className = "alb";
          b.innerHTML = `<span class="ai" style="background-image:url('${esc(al.image)}')"></span><span class="an">${esc(al.name)}</span><span class="ay">${al.year}${al.type ? " · " + al.type : ""}</span>`;
          b.onclick = () => openAlbum(al.id);
          g.appendChild(b);
        });
        w.appendChild(g);
      }
    } catch (e) { w.innerHTML = '<p class="note">Couldn\'t load this from Spotify. ' + esc(e.message) + "</p>"; }
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pollNow(); });

  // ---------- history ----------
  let loggedFor = null, lastRecentSync = 0;
  const GAP = 60 * 60 * 1000;
  function addHistory(entries) {
    const h = ls.get("kwb.history", []);
    let changed = false;
    for (const e of entries) {
      if (!e.id || !e.at) continue;
      if (h.some(x => x.id === e.id && Math.abs(x.at - e.at) < 10 * 60 * 1000)) continue;
      h.push({ id: e.id, title: e.title, artist: e.artist, at: e.at }); changed = true;
    }
    if (!changed) return;
    h.sort((a, b) => a.at - b.at);
    ls.set("kwb.history", h.slice(-3000));
    if (!$("view-history").hidden) paintHistory();
  }
  async function syncRecent() {
    lastRecentSync = Date.now();
    if (!Spotify.connected() || !Spotify.canPlay()) return;
    try { addHistory(await Spotify.recentlyPlayed()); } catch (e) {}
  }
  function sessions() {
    const h = ls.get("kwb.history", []), out = [];
    let cur = null;
    h.forEach(e => {
      if (!cur || e.at - cur.last > GAP) { cur = { start: e.at, last: e.at, plays: [] }; out.push(cur); }
      cur.plays.push(e); cur.last = e.at;
    });
    return out.reverse();
  }
  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  const openSess = new Set();
  // Label a flow by when it started: morning 5–12, afternoon 12–17, evening 17–21, night 21–5.
  function partOfDay(t) {
    const h = new Date(t).getHours();
    if (h >= 5 && h < 12) return { word: "morning", live: "This morning" };
    if (h >= 12 && h < 17) return { word: "afternoon", live: "This afternoon" };
    if (h >= 17 && h < 21) return { word: "evening", live: "This evening" };
    return { word: "night", live: "Tonight" };
  }
  // BPM across a flow: one line, each dot coloured by its key. Tap a dot for the track.
  function flowChart(recs) {
    const pts = recs.map((r, i) => ({ r, i })).filter(p => p.r.tempo);
    if (pts.length < 2) return "";
    const W = 340, H = 92, L = 30, R = 8, Tp = 8, B = 14;
    let lo = Math.min(...pts.map(p => p.r.tempo)), hi = Math.max(...pts.map(p => p.r.tempo));
    if (hi - lo < 6) { const mid = (hi + lo) / 2; lo = Math.floor(mid - 3); hi = Math.ceil(mid + 3); }
    const x = i => L + (recs.length === 1 ? 0 : i * (W - L - R) / (recs.length - 1));
    const y = v => Tp + (hi - v) * (H - Tp - B) / (hi - lo);
    const path = pts.map((p, j) => (j ? "L" : "M") + x(p.i).toFixed(1) + " " + y(p.r.tempo).toFixed(1)).join(" ");
    const grid = [hi, Math.round((hi + lo) / 2), lo].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${v}</text>`).join("");
    const dots = pts.map(p => `<g class="pt" data-i="${p.i}"><circle cx="${x(p.i)}" cy="${y(p.r.tempo)}" r="14" fill="transparent"/><circle cx="${x(p.i)}" cy="${y(p.r.tempo)}" r="4.5" class="d" style="fill:${p.r.key ? col(parseInt(p.r.key)) : "var(--muted)"}"/></g>`).join("");
    return `<div class="fchart" data-tips="${esc(JSON.stringify(recs.map(r => r.title + " · " + (r.key || "?") + " · " + (r.tempo || "–") + " BPM")))}">
      <div class="fc-t">BPM through the flow</div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="BPM from ${pts[0].r.tempo} to ${pts[pts.length - 1].r.tempo} across ${recs.length} tracks">${grid}<path d="${path}" class="ln"/>${dots}<text x="${L}" y="${H - 2}">start</text><text x="${W - R}" y="${H - 2}" text-anchor="end">end</text></svg>
      <div class="fc-tip" hidden></div></div>`;
  }
  document.addEventListener("click", e => {
    const g = e.target.closest(".fchart .pt"), fc = e.target.closest(".fchart");
    document.querySelectorAll(".fchart .pt.on").forEach(n => { if (n !== g) n.classList.remove("on"); });
    document.querySelectorAll(".fc-tip").forEach(tp => { if (!fc || !fc.contains(tp)) tp.hidden = true; });
    if (!g) { if (fc) fc.querySelector(".fc-tip").hidden = true; return; }
    const tip = fc.querySelector(".fc-tip"), tips = JSON.parse(fc.dataset.tips), i = +g.dataset.i;
    tip.textContent = (i + 1) + ". " + tips[i]; tip.hidden = false; g.classList.add("on");
    const svg = fc.querySelector("svg").getBoundingClientRect(), c = g.querySelector(".d").getBoundingClientRect(), box = fc.getBoundingClientRect();
    const left = c.left + c.width / 2 - box.left;
    tip.style.top = (c.top - box.top - 8) + "px";
    tip.style.left = Math.max(4, Math.min(box.width - tip.offsetWidth - 4, left - tip.offsetWidth / 2)) + "px";
  });
  function paintHistory() {
    const w = $("histWrap"), ss = sessions();
    w.innerHTML = "";
    if (!ss.length) { w.innerHTML = '<p class="note">Nothing yet. Play some tracks through Spotify (from ASH//FLOW or Spotify itself) and they\'ll appear here once each has played for 30 seconds.</p>'; return; }
    ss.forEach((ses, i) => {
      const key = String(ses.start);
      if (i === 0 && !openSess.size) openSess.add(key);
      const recs = ses.plays.map(e => byId.get(e.id) || { id: e.id, title: e.title, artist: e.artist, tempo: 0, key: null });
      const box = document.createElement("div"); box.className = "sess";
      const keys = recs.filter(r => r.key).map(r => `<span class="k" style="background:${col(parseInt(r.key))}">${r.key}</span>`).join("");
      box.innerHTML = `<div class="sess-h"><b>${i === 0 && Date.now() - ses.last < GAP ? partOfDay(ses.start).live + "\'s flow · " + dayFmt.format(ses.start) : dayFmt.format(ses.start) + " · " + partOfDay(ses.start).word}</b><span>${timeFmt.format(ses.start)} – ${timeFmt.format(ses.last)} · ${recs.length} tracks</span></div>
        <div class="sess-keys">${keys}</div>${flowChart(recs)}
        <div class="acts"><button class="btn" type="button" data-a="crate">Use as crate</button><button class="btn ghost" type="button" data-a="addcrate">Add to crate</button><button class="btn ghost" type="button" data-a="toggle">${openSess.has(key) ? "Hide" : "Tracks"}</button><button class="btn ghost danger" type="button" data-a="del">Delete</button></div>`;
      if (openSess.has(key)) {
        const list = document.createElement("div"); list.className = "list";
        recs.forEach((r, j) => {
          const row = rowEl(r, null, setAnchor);
          const when = document.createElement("div"); when.className = "when"; when.textContent = timeFmt.format(ses.plays[j].at);
          row.querySelector(".tt").prepend(when);
          list.appendChild(row);
        });
        box.appendChild(list);
      }
      box.querySelector(".sess-h").onclick = box.querySelector('[data-a="toggle"]').onclick = () => { openSess.has(key) ? openSess.delete(key) : openSess.add(key); paintHistory(); };
      box.querySelector('[data-a="crate"]').onclick = () => {
        crate = [...new Set(ses.plays.map(e => e.id))]; saveCrate();
        $("crateName").value = "ASH//FLOW · " + dayFmt.format(ses.start) + " " + new Date(ses.start).getFullYear();
        go("crate"); window.scrollTo(0, 0); toast(`Crate set to this flow (${crate.length} tracks)`);
      };
      box.querySelector('[data-a="addcrate"]').onclick = () => {
        let n = 0; ses.plays.forEach(e => { if (!crate.includes(e.id)) { crate.push(e.id); n++; } });
        saveCrate();
        toast(n ? `Added ${n} ${n === 1 ? "track" : "tracks"} to your crate (${crate.length} now)` : "All of these are already in your crate");
      };
      const del = box.querySelector('[data-a="del"]');
      del.onclick = () => {
        if (!del.dataset.confirm) { del.dataset.confirm = "1"; del.textContent = "Tap again to delete"; setTimeout(() => { delete del.dataset.confirm; del.textContent = "Delete"; }, 3000); return; }
        const set = new Set(ses.plays);
        ls.set("kwb.history", ls.get("kwb.history", []).filter(e => !ses.plays.some(p => p.id === e.id && p.at === e.at)));
        paintHistory(); toast("Flow deleted");
      };
      w.appendChild(box);
    });
  }

  // ---------- suggestion engine ----------
  const MOVE_W = { same: 1, adj: 0.9, rel: 0.85, diag: 0.75, boost: 0.7 };
  // Every track that starts playing is remembered for 3 hours, even if skipped before it counts as "played".
  let started = ls.get("kwb.started", {});
  function noteStarted(id) {
    const now = Date.now(); started[id] = now;
    for (const k in started) if (now - started[k] > 3 * 3600e3) delete started[k];
    ls.set("kwb.started", started);
  }
  function playedThisFlow() {
    const h = ls.get("kwb.history", []), out = new Set(Object.keys(started).filter(k => Date.now() - started[k] < 3 * 3600e3));
    for (let i = h.length - 1; i >= 0; i--) { if (i < h.length - 1 && h[i + 1].at - h[i].at > GAP) break; if (Date.now() - h[i].at > 8 * 3600e3) break; out.add(h[i].id); }
    return out;
  }
  // Higher is better. Hooks for set direction and transition memory.
  function scoreFor(from, t, m) {
    const dt = from.tempo && t.tempo ? t.tempo - from.tempo : 0;
    let sc = MOVE_W[m] || 0;
    if (state.dir === "any" || !from.tempo || !t.tempo) sc += (1 - Math.min(Math.abs(dt), 8) / 8) * 0.8;
    else { const target = { build: 3, hold: 0, cool: -3 }[state.dir]; sc += (1 - Math.min(Math.abs(dt - target), 6) / 6) * 1.2; }
    sc += dirBonus(from, t, m, dt);
    sc += memBonus(from.id, t.id);
    return sc;
  }
  function suggest(from, n) {
    if (!from || !from.key) return [];
    const rel = relations(from.key), skip = playedThisFlow();
    skip.add(from.id); if (handed) skip.add(handed); appQ.forEach(id => skip.add(id));
    const out = [];
    for (const t of T) {
      if (skip.has(t.id)) continue;
      const m = rel[t.key]; if (!m) continue;
      if (from.tempo && t.tempo && Math.abs(t.tempo - from.tempo) > 8) continue;
      out.push({ t, m, sc: scoreFor(from, t, m) });
    }
    // Exact matches (same key and same BPM) always come first, then the rest by score.
    const exact = x => x.m === "same" && from.tempo && x.t.tempo === from.tempo ? 1 : 0;
    return out.sort((a, b) => exact(b) - exact(a) || b.sc - a.sc).slice(0, n);
  }
  function dirBonus(from, t, m, dt) {
    const toB = from.key.endsWith("A") && t.key.endsWith("B"), toA = from.key.endsWith("B") && t.key.endsWith("A");
    if (state.dir === "build") return (m === "boost" ? 0.4 : 0) + (toB ? 0.25 : 0) + (m === "same" ? -0.1 : 0) + (dt < 0 ? -0.4 : 0);
    if (state.dir === "hold") return (m === "same" || m === "adj" ? 0.25 : 0) + (m === "boost" ? -0.5 : 0) + (m === "rel" || m === "diag" ? -0.15 : 0);
    if (state.dir === "cool") return (m === "boost" ? -0.6 : 0) + (toA ? 0.25 : 0) + (m === "same" ? -0.1 : 0) + (dt > 0 ? -0.4 : 0);
    return 0;
  }
  // ---------- transition memory ----------
  // Pairs you've actually played back to back (within 20 minutes), plus pairs from crates you've saved.
  let memCache = null, memSig = "";
  function pairs() {
    const h = ls.get("kwb.history", []), kept = ls.get("kwb.kept", {});
    const sig = h.length + ":" + (h.length ? h[h.length - 1].at : 0) + ":" + Object.keys(kept).length;
    if (memCache && sig === memSig) return memCache;
    const m = new Map(), bump = (a, b, n) => { if (!a || !b || a === b) return; if (!m.has(a)) m.set(a, new Map()); const x = m.get(a); x.set(b, (x.get(b) || 0) + n); };
    for (let i = 1; i < h.length; i++) if (h[i].at - h[i - 1].at <= 20 * 60e3) bump(h[i - 1].id, h[i].id, 1);
    Object.entries(kept).forEach(([k, n]) => { const [a, b] = k.split(">"); bump(a, b, n); });
    memCache = m; memSig = sig; return m;
  }
  const pairCount = (a, b) => (pairs().get(a) || new Map()).get(b) || 0;
  const memBonus = (a, b) => Math.min(pairCount(a, b), 3) * 0.25;
  function keepPairs(ids) {
    const kept = ls.get("kwb.kept", {});
    for (let i = 1; i < ids.length; i++) { const k = ids[i - 1] + ">" + ids[i]; kept[k] = (kept[k] || 0) + 1; }
    ls.set("kwb.kept", kept);
  }
  // ---------- notes ----------
  let notes = ls.get("kwb.notes", {});
  const noteOf = id => notes[id] || "";
  const noteHtml = id => noteOf(id) ? `<div class="tnote">✎ ${esc(noteOf(id))}</div>` : "";
  function editNote(t) {
    const sh = $("sheet");
    sh.innerHTML = `<div class="grab"></div><div class="sh-t">Note for ${esc(t.title)}</div><div class="sh-a">Cue points, what it mixes well with, how the crowd took it — anything.</div>
      <textarea id="noteBox" rows="4" maxlength="400" placeholder="e.g. Mix in at the second breakdown. Great after 'Sad Piano House'.">${esc(noteOf(t.id))}</textarea>
      <div class="acts"><button class="btn" type="button" id="noteSave">Save note</button>${noteOf(t.id) ? '<button class="btn ghost danger" type="button" id="noteDel">Delete note</button>' : ""}<button class="btn ghost" type="button" id="noteCancel">Cancel</button></div>`;
    sh.hidden = false; $("sheetBg").hidden = false;
    setTimeout(() => $("noteBox").focus(), 50);
    const done = msg => { ls.set("kwb.notes", notes); closeMenu(); render(); if (!$("view-playing").hidden) { paintPlaying(); paintSuggest(); } if (!$("view-history").hidden) paintHistory(); toast(msg); };
    $("noteSave").onclick = () => { const v = $("noteBox").value.trim(); if (v) notes[t.id] = v; else delete notes[t.id]; done(v ? "Note saved" : "Note removed"); };
    if ($("noteDel")) $("noteDel").onclick = () => { delete notes[t.id]; done("Note removed"); };
    $("noteCancel").onclick = () => closeMenu();
  }
  const tempoDelta = (from, t) => { const d = from.tempo && t.tempo ? t.tempo - from.tempo : 0; return d ? (d > 0 ? "+" : "") + d + " BPM" : "same BPM"; };

  // ---------- heads-up before the track ends ----------
  const headsDismissed = new Set(), autoDone = new Set();
  // Auto-pick: if nothing is queued, the top suggestion is queued this long before the end,
  // so Spotify has it in time (and before any crossfade starts).
  const AUTO_MS = 8000;
  let autoPick = ls.get("kwb.autopick", true);
  function headsState() {
    if (!np || !np.playing || !np.duration) return null;
    const left = np.duration - posNow();
    if (left > 60000 || left < 1500 || headsDismissed.has(np.id)) return null;
    const ref = mixRef(), cur = ref.rec, nextId = handed || appQ[0] || null, next = nextId ? recOf(nextId, qMeta.get(nextId)) : null;
    let mode = "ok";
    if (!next) mode = "empty";
    else if (cur && cur.key && next.key && !relations(cur.key)[next.key]) mode = "clash";
    return { left, cur, next, mode, fallback: ref.fallback };
  }
  let headsKey = "";
  function paintHeads() {
    const box = $("npHeads"), st = headsState();
    if (!st || npBar.hidden) { if (!box.hidden) { box.hidden = true; document.body.classList.remove("has-heads"); headsKey = ""; } return; }
    const secs = Math.ceil(st.left / 1000), clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    const key = st.mode + "|" + np.id + "|" + (st.next ? st.next.id : "") + "|" + appQ.length;
    const autoIn = Math.ceil((st.left - AUTO_MS) / 1000);
    if (st.mode === "empty" && autoPick && st.left <= AUTO_MS && !autoDone.has(np.id) && st.cur && st.cur.key) {
      const top = suggest(st.cur, 1)[0];
      autoDone.add(np.id);
      if (top) { enqueue(top.t); toast("Auto-queued: " + top.t.title); headsKey = ""; return; }
    }
    if (key === headsKey) {
      const c = box.querySelector(".hclock"); if (c) c.textContent = clock + " left";
      const a = box.querySelector(".hauto"); if (a) a.textContent = autoIn > 0 ? `Auto-picks the top one in ${autoIn}s` : "";
      return;
    }
    headsKey = key;
    box.hidden = false; document.body.classList.add("has-heads");
    let html = `<div class="hline ${st.mode}"><span class="hclock">${clock} left</span><span class="hmsg">`;
    if (st.mode === "empty") html += "Queue is empty — pick what plays next";
    else if (st.mode === "clash") html += `Next up clashes: ${st.cur.key} → ${st.next.key} · ${esc(st.next.title)}`;
    else { const m = st.cur && st.cur.key && st.next.key ? relations(st.cur.key)[st.next.key] : null; html += `Next: ${esc(st.next.title)}${m ? " · " + MOVE_NAME[m] : ""}`; }
    html += `</span><button type="button" class="hx" aria-label="Dismiss">${IC.close}</button></div>`;
    if (st.mode === "empty" && st.cur && st.cur.key) html += `<div class="hautoline"><span class="hauto">${autoPick && autoIn > 0 ? `Auto-picks the top one in ${autoIn}s` : ""}</span><label class="htog"><input type="checkbox" id="autoTog" ${autoPick ? "checked" : ""}> Auto-pick</label></div>`;
    if (st.mode !== "ok" && st.cur && st.cur.key) {
      if (st.fallback) html += `<div class="hautoline"><span>This track has no key yet — following <b>${esc(st.cur.title)}</b>, the last one that did</span></div>`;
      const sug = suggest(st.cur, 3);
      html += sug.map(x => `<div class="hsug"><span class="hart" data-aid="${esc(x.t.id)}"></span><span class="k" style="background:${col(parseInt(x.t.key))}">${x.t.key}</span><span class="ht"><b>${esc(x.t.title)}</b><small>${esc(x.t.artist)} · ${x.t.tempo || "–"} · ${MOVE_NAME[x.m]}${pairCount(st.cur.id, x.t.id) ? ' · <span class="mem">★ played after</span>' : ""}</small></span><button type="button" class="hq" data-id="${esc(x.t.id)}">${st.mode === "clash" && !handed ? "Play next" : "Queue"}</button></div>`).join("");
      if (!sug.length) html += '<div class="hsug"><small>No close matches in your library for this one.</small></div>';
    }
    box.innerHTML = html;
    box.querySelectorAll(".hart").forEach(el => { if (art[el.dataset.aid]) paintArt(el, el.dataset.aid); else if (artObs) artObs.observe(el); });
    box.querySelector(".hx").onclick = () => { headsDismissed.add(np.id); paintHeads(); };
    const tog = box.querySelector("#autoTog");
    if (tog) tog.onchange = () => setAuto(tog.checked);
    box.querySelectorAll(".hq").forEach(b => b.onclick = () => {
      const t = byId.get(b.dataset.id); if (!t) return;
      if (b.textContent === "Play next") playNextUp(t.id, t.title); else enqueue(t);
      headsKey = ""; paintHeads();
    });
  }
  function setAuto(on) {
    autoPick = on; ls.set("kwb.autopick", on); $("autoTog2").checked = on;
    toast(on ? "Auto-pick on — if nothing is queued, the top suggestion queues itself 8 seconds before the end" : "Auto-pick off");
    headsKey = ""; paintHeads();
  }
  $("autoTog2").checked = autoPick;
  $("autoTog2").onchange = () => setAuto($("autoTog2").checked);
  setInterval(paintHeads, 1000);
  // Near the end of a track, check Spotify every second so a late jump or a short track still gets its auto-pick.
  setInterval(() => { if (np && np.playing && np.duration && np.duration - posNow() < 20000 && Date.now() - lastPoll > 950) pollNow(); }, 1000);
  setInterval(() => { if (appQ.length && !handed) pump(); }, 1000);
  // Leaving the app (locking the phone, switching apps): hand the next track over now, while we still can.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") pump(true); });
  window.addEventListener("pagehide", () => pump(true));

  // ---------- Suggested next on the Playing tab ----------
  function paintSuggest() {
    const box = $("pvSuggest"); if (!box || $("view-playing").hidden) return;
    const ref = mixRef(), cur = ref.rec;
    box.innerHTML = "";
    if (!cur) { $("sugNote").textContent = "Suggestions appear once a track with a key in your library has played."; return; }
    const sug = suggest(cur, 6);
    if (!sug.length) { box.innerHTML = '<p class="note">No close matches in your library.</p>'; return; }
    const d = DIRS.find(d => d.id === state.dir);
    $("sugNote").textContent = (ref.fallback ? `This track has no key yet, so these follow “${cur.title}”, the last one that did. ` : "") +
      (state.dir === "any" ? (ref.fallback ? "" : "Best matches from what's playing, by key and BPM.") : `Leaning ${d.name.toLowerCase()} ${d.sym} — change it on the Wheel tab.`) + " Swipe right to queue.";
    sug.forEach(x => {
      const r = rowEl(x.t, null, setAnchor, cur);
      let lab = r.querySelector(".tt .rel");
      if (!lab) { lab = document.createElement("div"); lab.className = "rel"; r.querySelector(".tt").prepend(lab); }
      lab.insertAdjacentText("afterbegin", MOVE_NAME[x.m] + " · " + tempoDelta(cur, x.t) + (lab.textContent ? " · " : ""));
      box.appendChild(r);
    });
  }

  // ---------- tabs + spotify button ----------
  function go(v, skipPaint) {
    document.querySelectorAll(".view").forEach(s => s.hidden = s.id !== "view-" + v);
    const tabFor = v === "info" ? "more" : v === "browse" ? returnView : v === "match" ? matchReturn : v;
    document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.view === tabFor));
    document.body.classList.toggle("on-playing", v === "playing");
    if (v === "playing") { paintPlaying(); paintQueue(); paintSuggest(); if (Spotify.connected() && Spotify.canPlay()) startPolling(); }
    else if (typeof npTimer !== "undefined" && npTimer && Spotify.canPlay()) startPolling();
    if (v === "crate") paintCrate();
    if (v === "search") paintSearch();
    if (v === "history") { paintHistory(); syncRecent(); }
    if (v === "playlists" && !skipPaint) paintPlaylists(true);
    if (v === "more") paintMore();
    if (v !== "browse" && v !== "info" && v !== "match") { try { sessionStorage.setItem("kwb.view", v); } catch (e) {} }
  }
  (function swatches() {
    const box = $("swatches"); if (!box) return;
    const names = ["teal", "sky blue", "blue", "indigo", "purple", "magenta", "pink", "orange-red", "amber", "lime", "green", "emerald"];
    for (let n = 1; n <= 12; n++) {
      const sp = document.createElement("span"); sp.style.background = col(n);
      sp.innerHTML = `${n}A·${n}B<small>${names[n - 1]}</small>`;
      box.appendChild(sp);
    }
  })();
  $("openInfo").onclick = () => { go("info"); window.scrollTo(0, 0); };
  $("infoBack").onclick = () => { go("more"); window.scrollTo(0, 0); };
  document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => { go(b.dataset.view); window.scrollTo(0, 0); });
  function paintSpotifyBtn() {
    const b = $("spotifyBtn");
    if (!Spotify.configured()) { b.hidden = true; return; }
    const on = Spotify.connected();
    b.textContent = on ? "Spotify ✓" : "Connect Spotify"; b.classList.toggle("on", on);
    b.onclick = on ? () => go("more") : () => Spotify.login().catch(e => toast(e.message));
  }

  // ---------- copy data from the stable app ----------
  // Both apps live on the same site, so the beta can read stable's saved data and copy it under its own names.
  const FROM_STABLE = ["spotify", "extra", "history", "crate", "notes", "kept", "follow", "autopick", "state", "plNames", "baseCache", "liveOn"];
  function stableHasData() { try { return ["spotify", "crate", "history", "extra"].some(k => localStorage.getItem("kw." + k)); } catch (e) { return false; } }
  function copyFromStable() {
    let n = 0;
    try { FROM_STABLE.forEach(k => { const v = localStorage.getItem("kw." + k); if (v != null) { localStorage.setItem("kwb." + k, v); n++; } }); localStorage.setItem("kwb.importAsked", "1"); } catch (e) {}
    toast(n ? "Copied from stable — reloading" : "Can't see stable's data from here. On iPhone, each home-screen app keeps its own storage: use More → Back up in stable, then Restore here.", 7000);
    if (n) setTimeout(() => location.reload(), 800);
  }
  $("fromStable").onclick = copyFromStable;
  function offerImport() {
    let asked = true; try { asked = !!localStorage.getItem("kwb.importAsked"); } catch (e) {}
    if (asked || !stableHasData()) return;
    try { localStorage.setItem("kwb.importAsked", "1"); } catch (e) {}
    const sh = $("sheet");
    sh.innerHTML = `<div class="grab"></div><div class="sh-t">Welcome to the beta</div><div class="sh-a">Start from where you are in ASH//FLOW: your Spotify sign-in, crate, notes, flows and added tracks. Your stable app isn't changed.</div>
      <button class="item" type="button" id="impYes"><span>⤓</span>Copy my data from stable</button>
      <button class="item" type="button" id="impNo"><span>✕</span>Start fresh</button>`;
    sh.hidden = false; $("sheetBg").hidden = false;
    $("impYes").onclick = () => { sh.hidden = true; $("sheetBg").hidden = true; copyFromStable(); };
    $("impNo").onclick = () => { sh.hidden = true; $("sheetBg").hidden = true; };
  }

  // ---------- boot ----------
  (async function boot() {
    buildWheel();
    const res = await Spotify.handleRedirect().catch(e => ({ error: e.message }));
    await loadLibrary();
    saveState();
    crateOptions(); saveCrate(); paintSpotifyBtn(); render();
    let v = "wheel"; try { v = sessionStorage.getItem("kwb.view") || "wheel"; } catch (e) {}
    go(v);
    paintModes();
    if (Spotify.connected()) { if (Spotify.canPlay()) { startPolling(); syncRecent(); } else showReconnect(); }
    if (res && res.ok) { toast("Connected to Spotify"); if (!Spotify.canPlay()) go("playlists"); }
    else if (res && res.error) toast("Spotify sign-in didn't finish: " + res.error, 5000);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
    offerImport();
    setTimeout(syncArt, 4000);
  })();
})();
