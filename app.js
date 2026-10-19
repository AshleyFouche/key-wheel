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
  const toRec = a => ({ id: a[0], title: a[1], artist: a[2], tempo: +a[3] || 0, key: normKey(a[4]), crate: a[5] || "", euph: !!a[6], house: !!a[7] });
  async function loadLibrary() {
    let base = [];
    try { base = (await (await fetch("library.json", { cache: "no-cache" })).json()).tracks; }
    catch (e) { base = ls.get("kw.baseCache", []); }
    if (base.length) ls.set("kw.baseCache", base);
    const extra = ls.get("kw.extra", []);
    byId = new Map();
    base.forEach(a => byId.set(a[0], toRec(a)));
    extra.forEach(a => { const prev = byId.get(a[0]); const r = toRec(a); if (prev && !r.crate) r.crate = prev.crate; byId.set(a[0], r); });
    T = [...byId.values()].filter(t => t.key);
    counts = {}; T.forEach(t => counts[t.key] = (counts[t.key] || 0) + 1);
  }

  // ---------- state ----------
  const saved = ls.get("kw.state", {});
  const state = {
    key: saved.key === null ? null : (normKey(saved.key) || "8A"),
    on: Object.assign({}, ALL_ON, saved.on || {}),
    anchor: null, trail: [], shown: 60
  };
  const saveState = () => ls.set("kw.state", { key: state.key, on: state.on, trail: state.trail.map(t => t.id), anchor: state.anchor ? state.anchor.id : null });
  let crate = ls.get("kw.crate", []);
  const saveCrate = () => { ls.set("kw.crate", crate); const b = $("crateBadge"); b.textContent = crate.length; b.hidden = !crate.length; };

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

  // ---------- anchor + trail ----------
  function paintAnchor() {
    const a = $("anchor");
    if (state.anchor) {
      const t = state.anchor;
      a.innerHTML = `<span class="eyebrow">Mixing out of</span><span class="t">${esc(t.title)}</span>
        <span class="m">${esc(t.artist)} · ${t.key} ${NAMES[t.key]} · ${t.tempo || "–"} tempo</span>
        <span class="acts"><button class="btn ghost" type="button" id="aAdd">${crate.includes(t.id) ? "In crate ✓" : "+ Crate"}</button>${state.trail.length > 1 ? '<button class="btn ghost" type="button" id="back1">‹ Back one</button>' : ""}<button class="btn ghost" type="button" id="clr">${state.trail.length > 1 ? "Clear thread" : "Clear track"}</button><button class="btn" type="button" id="all">All tracks</button></span>`;
      $("clr").onclick = () => { state.trail = []; state.anchor = null; $("tmin").value = ""; $("tmax").value = ""; saveState(); render(); };
      $("aAdd").onclick = () => { toggleCrate(t.id); render(); };
      const b1 = $("back1");
      if (b1) b1.onclick = () => { state.trail.pop(); setAnchor(state.trail[state.trail.length - 1], true); };
    } else if (state.key) {
      a.innerHTML = `<span class="eyebrow">Selected key</span><span class="t">${state.key} · ${NAMES[state.key]}</span>
        <span class="m">Tap a track to mix out of it. Searching always looks across every track.</span>
        <span class="acts"><button class="btn" type="button" id="all">All tracks</button></span>`;
    } else {
      a.innerHTML = `<span class="eyebrow">Library</span><span class="t">All ${T.length.toLocaleString()} tracks</span>
        <span class="m">Search for what's playing, then tap it to see what mixes out of it.</span>`;
    }
    const all = $("all"); if (all) all.onclick = showAll;
    if (state.trail.length > 1) {
      const tr = document.createElement("div"); tr.className = "trail";
      tr.innerHTML = '<span class="eyebrow">Your thread so far</span>';
      const ol = document.createElement("ol");
      state.trail.forEach((t, i) => {
        const li = document.createElement("li"), b = document.createElement("button");
        b.type = "button"; b.className = "step" + (t === state.anchor ? " on" : "");
        b.innerHTML = `<span class="k" style="background:${col(parseInt(t.key))}">${t.key}</span>${esc(t.title)}`;
        b.onclick = () => { state.trail = state.trail.slice(0, i + 1); setAnchor(t, true); };
        li.appendChild(b); ol.appendChild(li);
      });
      tr.appendChild(ol);
      const sp = document.createElement("div"); sp.className = "acts";
      sp.innerHTML = '<button class="btn" type="button" id="pathCrate">Save thread as crate</button>';
      tr.appendChild(sp); a.appendChild(tr);
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
    if (keyed) rows.sort((a, b) => rk(a) - rk(b) || (ref ? Math.abs(a.tempo - ref) - Math.abs(b.tempo - ref) : a.tempo - b.tempo));
    else if (qq) rows.sort((a, b) => rk(a) - rk(b) || kord(a.key) - kord(b.key) || a.tempo - b.tempo);
    else rows.sort((a, b) => kord(a.key) - kord(b.key) || a.tempo - b.tempo);
    return { rows, rel, keyed, qq };
  }
  function rowEl(t, rel, onPick) {
    const r = document.createElement("div"); r.className = "row";
    const m = rel && rel[t.key] && state.on[rel[t.key]] ? MOVE_NAME[rel[t.key]] : "";
    const keyHtml = t.key ? `<span class="key" style="background:${col(parseInt(t.key))}">${t.key}</span>` : `<span class="key none">?</span>`;
    r.innerHTML = `${keyHtml}<span class="bpm">${t.tempo || "–"}</span>
      <span class="tt" role="button" tabindex="0">${m ? `<div class="rel">${m}</div>` : ""}<div>${esc(t.title)}</div><div class="a">${esc(t.artist)}</div></span>
      <button class="play" type="button" aria-label="Play in Spotify">▶</button>
      <button class="add${crate.includes(t.id) ? " in" : ""}" type="button" aria-label="Add to crate">${crate.includes(t.id) ? "✓" : "+"}</button>
      <button class="more-btn" type="button" aria-label="More options">⋯</button>`;
    r._track = t;
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
    $("count").textContent = `${rows.length.toLocaleString()} ${keyed ? "tracks in compatible keys" : (qq ? "tracks across your whole library" : "tracks, all keys")}`;
    const list = $("list"); list.innerHTML = "";
    rows.slice(0, state.shown).forEach(t => list.appendChild(rowEl(t, rel, setAnchor)));
    $("more").hidden = rows.length <= state.shown;
  }
  $("more").onclick = () => { state.shown += 60; paintList(); };

  function setAnchor(t, fromTrail, quiet) {
    if (!t.key) { toast("No key for this track yet"); return; }
    if (!fromTrail && state.trail[state.trail.length - 1] !== t) state.trail.push(t);
    state.anchor = t; state.key = t.key; q.value = "";
    if (t.tempo) { tmin.value = t.tempo - 6; tmax.value = t.tempo + 6; }
    state.shown = 60; saveState();
    if (quiet) { render(); return; }
    go("wheel"); render(); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function pick(k) { state.key = k; state.anchor = null; state.trail = []; state.shown = 60; saveState(); render(); }
  function showAll() { state.trail = []; state.key = null; state.anchor = null; tmin.value = ""; tmax.value = ""; sel.value = ""; state.shown = 60; saveState(); render(); }
  function render() { paintWheel(); paintMoves(); paintAnchor(); paintList(); }

  // ---------- crate ----------
  function toggleCrate(id) {
    const i = crate.indexOf(id);
    if (i >= 0) crate.splice(i, 1); else crate.push(id);
    saveCrate(); return i < 0;
  }
  function paintCrate() {
    const list = $("crateList"); list.innerHTML = "";
    const recs = crate.map(id => byId.get(id)).filter(Boolean);
    $("crateCount").textContent = recs.length ? `${recs.length} tracks · tempo ${Math.min(...recs.map(r => r.tempo || 999))}–${Math.max(...recs.map(r => r.tempo || 0))}` : "Empty for now.";
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
        const name = $("existingPl").selectedOptions[0].textContent;
        st.className = "status ok";
        st.innerHTML = `Added ${fresh.length} tracks to “${esc(name)}”${ids.length - fresh.length ? ` (${ids.length - fresh.length} ${ids.length - fresh.length === 1 ? "was" : "were"} already there)` : ""}. <a href="https://open.spotify.com/playlist/${esc(exId)}" target="_blank" rel="noopener">Open in Spotify</a>`;
      } else {
        const name = $("crateName").value.trim() || ("ASH//F crate · " + new Date().toLocaleDateString());
        const pl = await Spotify.createPlaylist(name, "Built in ASH//FLOW", ids);
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
  async function paintPlaylists() {
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
        d.onclick = () => openPlaylist(p);
        list.appendChild(d);
      });
      w.appendChild(list);
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
    $("plBack").onclick = paintPlaylists;
    try {
      const tracks = await Spotify.playlistTracks(p.id);
      const recs = tracks.map(t => byId.get(t.id) || { id: t.id, title: t.title, artist: t.artist, tempo: 0, key: null });
      const known = recs.filter(r => r.key).length;
      w.querySelector(".note").textContent = `${tracks.length} tracks · ${known} with a key in your library${known < tracks.length ? ` · ${tracks.length - known} still need one: screenshot this playlist in Spotify's Mix view, send it to Claude, then tap Add keys` : ""}`;
      const acts = document.createElement("div"); acts.className = "crate-actions";
      acts.innerHTML = '<button class="btn" type="button" id="plKeys">Add keys</button><button class="btn ghost" type="button" id="plAll">Add tracks with keys to crate</button>';
      w.appendChild(acts);
      const pb = document.createElement("div"); pb.className = "pastebox"; pb.hidden = true;
      pb.innerHTML = '<p class="note">Paste the lines Claude gave you for this playlist. They\'re matched to the exact tracks in it; anything not found here is searched on Spotify.</p><textarea id="plPaste" rows="6" placeholder="7B | 130 | Positive | Jamback | 2:49"></textarea><button class="btn" type="button" id="plMatch">Match</button>';
      w.appendChild(pb);
      $("plKeys").onclick = () => { pb.hidden = !pb.hidden; if (!pb.hidden) $("plPaste").focus(); };
      $("plMatch").onclick = () => startMatch($("plPaste").value, tracks, "playlists");
      $("plAll").onclick = () => { recs.filter(r => r.key).forEach(r => { if (!crate.includes(r.id)) crate.push(r.id); }); saveCrate(); toast("Added to crate"); };
      const list = document.createElement("div"); list.className = "list";
      recs.forEach(t => list.appendChild(rowEl(t, null, setAnchor)));
      w.appendChild(list);
    } catch (e) {
      w.querySelector(".note").textContent = "Couldn't load this playlist: " + e.message;
    }
  }

  // ---------- more ----------
  function paintMore() {
    const extra = ls.get("kw.extra", []);
    $("libInfo").textContent = `${T.length.toLocaleString()} tracks with keys (${extra.length} added on this phone). Your crate, settings and added tracks are stored on this phone; back them up now and then.`;
    $("spInfo").textContent = !Spotify.configured() ? "Not set up yet." : Spotify.connected() ? "Connected." : "Not connected.";
    $("logout").hidden = !Spotify.connected();
  }
  $("logout").onclick = () => { Spotify.logout(); plCache = null; clearInterval(npTimer); np = null; paintNp(); paintSpotifyBtn(); paintMore(); toast("Disconnected from Spotify"); };
  $("backup").onclick = () => {
    const data = { app: "key-wheel", saved: new Date().toISOString(), extra: ls.get("kw.extra", []), history: ls.get("kw.history", []), crate, state: { key: state.key, on: state.on } };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "ashflow-backup.json"; document.body.appendChild(a); a.click(); a.remove();
  };
  $("restore").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.app !== "key-wheel") throw new Error("not an ASH//FLOW backup");
      ls.set("kw.extra", d.extra || []); if (d.history) ls.set("kw.history", d.history); crate = d.crate || []; saveCrate();
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
      // key | tempo | title | artist | length   (length optional)
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
    const ok = matchResults.filter(r => r.status === "ok").length, warn = matchResults.filter(r => r.status === "warn").length, miss = matchResults.length - ok - warn;
    $("matchInfo").textContent = `${ok} matched${warn ? `, ${warn} to check` : ""}${miss ? `, ${miss} not found` : ""}. Untick anything that looks wrong.`;
    const box = $("matchList"); box.innerHTML = "";
    matchResults.forEach((r, i) => {
      const d = document.createElement("label"); d.className = "mrow " + r.status;
      const label = r.status === "ok" ? "✓ " + (r.source === "playlist" ? "Found in playlist" : r.source === "search" ? "Found on Spotify" : "Spotify ID given")
        : r.status === "warn" ? "⚠ Possible match — check it" : "✕ " + (r.note || "Not found");
      const m = r.matches.map(x => `<b>${esc(x.title)}</b> · ${esc(x.artist)}${x.duration ? " · " + fmtLen(x.duration) : ""}${x.album ? " · " + esc(x.album) : ""}`).join("<br>");
      if (r.checked === undefined) r.checked = r.status === "ok";
      d.innerHTML = `<input type="checkbox" ${r.checked ? "checked" : ""} ${r.matches.length ? "" : "disabled"}><div><div class="ms">${label}${r.matches.length > 1 ? ` (${r.matches.length} identical versions)` : ""}</div><div class="ml">${esc(r.line.raw)}</div>${m ? `<div class="mm">→ ${m}</div>` : ""}</div>`;
      d.querySelector("input").onchange = e => { r.checked = e.target.checked; };
      box.appendChild(d);
    });
  }
  $("matchBack").onclick = () => { go(matchReturn); window.scrollTo(0, 0); };
  $("matchSave").onclick = async () => {
    const extra = ls.get("kw.extra", []); const idx = new Map(extra.map((a, i) => [a[0], i]));
    let n = 0;
    matchResults.filter(r => r.checked && r.matches.length && r.line.key).forEach(r => r.matches.forEach(mt => {
      const prev = byId.get(mt.id);
      const rec = [mt.id, mt.title || r.line.title || prev?.title || "", mt.artist || r.line.artist || prev?.artist || "", r.line.tempo, r.line.key, prev?.crate || "", prev?.euph ? 1 : 0, prev?.house ? 1 : 0];
      if (idx.has(mt.id)) extra[idx.get(mt.id)] = rec; else { idx.set(mt.id, extra.length); extra.push(rec); }
      n++;
    }));
    ls.set("kw.extra", extra); await loadLibrary(); crateOptions(); render(); paintMore();
    $("matchStatus").className = "status ok"; $("matchStatus").textContent = `Saved keys for ${n} tracks.`;
    toast(`Saved keys for ${n} tracks`);
    $("paste").value = "";
    if (matchReturn === "playlists" && lastPlaylist) { go("playlists", true); openPlaylist(lastPlaylist); }
  };
  $("addPaste").onclick = () => startMatch($("paste").value, null, "more");

  // ---------- playback + now playing ----------
  let np = null, follow = ls.get("kw.follow", false), npTimer = null, lastNpId = null;
  const npBar = $("np");
  async function playTrack(t) {
    if (!Spotify.connected()) { toast("Connect Spotify first (top right)"); return; }
    if (!Spotify.canPlay()) { showReconnect(); return; }
    try {
      await Spotify.play(t.id); toast("Playing: " + t.title);
      setTimeout(pollNow, 900);
    } catch (e) { playError(e); }
  }
  function playError(e) {
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
    $("npPP").textContent = "↻"; $("npPP").onclick = () => Spotify.login().catch(err => toast(err.message));
  }
  function paintNp() {
    if (!np || np.none) { npBar.hidden = true; document.body.classList.remove("has-np"); return; }
    npBar.hidden = false; document.body.classList.add("has-np");
    const rec = byId.get(np.id);
    $("npArt").style.backgroundImage = np.art ? `url("${np.art}")` : "";
    $("npTitle").textContent = np.title;
    $("npSub").innerHTML = (rec && rec.key ? `<span class="k" style="background:${col(parseInt(rec.key))}">${rec.key}</span>${rec.tempo ? rec.tempo + " · " : ""}` : '<span class="k" style="background:var(--surface);color:var(--muted)">?</span>') + esc(np.artist);
    $("npPP").textContent = np.playing ? "❚❚" : "▶";
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
    follow = !follow; ls.set("kw.follow", follow); paintModes();
    toast(follow ? "Following what Spotify plays" : "Stopped following");
    if (follow && np) { const rec = byId.get(np.id); if (rec && rec.key && (!state.anchor || state.anchor.id !== rec.id)) setAnchor(rec, false, true); }
  };
  async function pollNow() {
    if (!Spotify.connected() || !Spotify.canPlay() || document.visibilityState !== "visible") return;
    try {
      np = await Spotify.playerState();
      if (np && np.progress >= 30000 && loggedFor !== np.id) { loggedFor = np.id; addHistory([{ id: np.id, title: np.title, artist: np.artist, at: np.at - np.progress, src: "app" }]); }
      if (Date.now() - lastRecentSync > 120000) syncRecent();
      if (np && handed && np.id === handed) { handed = null; saveQ(); }
      if (np && np.id !== lastNpId) {
        lastNpId = np.id;
        checkHanded();
        if (follow) { const rec = byId.get(np.id); if (rec && rec.key && (!state.anchor || state.anchor.id !== rec.id)) setAnchor(rec, false, true); }
      }
      paintNp(); paintPlaying(); pump();
    } catch (e) { if (e.code === "auth") paintSpotifyBtn(); }
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
      ? `<span class="k" style="background:${col(parseInt(rec.key))}">${rec.key}</span>${NAMES[rec.key]}${rec.tempo ? " · " + rec.tempo + " tempo" : ""}`
      : "No key yet in your library";
    $("pvDev").textContent = "";
    $("pvDevName").textContent = np.device || "Unknown device";
    $("pvDevIco").textContent = devIcon(np.deviceType);
    $("pvPP").textContent = np.playing ? "❚❚" : "▶";
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
  $("pvNext").onclick = async () => { try { await Spotify.next(); setTimeout(pollNow, 700); } catch (e) { playError(e); } };
  const devIcon = t => ({ Smartphone: "📱", Computer: "💻", Speaker: "🔊", TV: "📺", CastAudio: "🔊", CastVideo: "📺", AVR: "🔊", Tablet: "📱", Automobile: "🚗" }[t] || "🔈");
  const devHint = d => d.type === "Smartphone" || d.type === "Computer" || d.type === "Tablet"
    ? "Crossfade works here. Send the sound on with AirPlay, Bluetooth or a cable."
    : "Spotify Connect: best sound quality, but no crossfade.";
  $("pvDevice").onclick = async () => {
    const sh = $("sheet");
    sh.innerHTML = '<div class="grab"></div><div class="sh-t">Play on</div><div class="sh-a">Loading your devices…</div>';
    sh.hidden = false; $("sheetBg").hidden = false;
    try {
      const ds = await Spotify.devices();
      if (!ds.length) { sh.querySelector(".sh-a").textContent = "No devices found. Open Spotify on your phone or another device, then try again."; return; }
      sh.innerHTML = '<div class="grab"></div><div class="sh-t">Play on</div><div class="sh-a">Spotify only lists devices that are switched on and have used Spotify recently.</div>' +
        ds.map((d, i) => `<button class="item dev${d.is_active ? " on" : ""}" type="button" data-i="${i}"><span>${devIcon(d.type)}</span><div><div>${esc(d.name)}${d.is_active ? " · playing" : ""}</div><small>${esc(devHint(d))}</small></div></button>`).join("");
      sh.querySelectorAll("[data-i]").forEach(b => b.onclick = async () => {
        const d = ds[parseInt(b.dataset.i)];
        closeMenu();
        if (d.is_active) return;
        try { await Spotify.transfer(d.id); toast("Now playing on " + d.name); setTimeout(pollNow, 1200); setTimeout(checkHanded, 2500); }
        catch (e) { playError(e); }
      });
    } catch (e) { sh.querySelector(".sh-a").textContent = "Couldn't load devices: " + e.message; }
  };
  $("pvTitle").onclick = () => { if (np && np.albumId) openAlbum(np.albumId); };
  $("pvArtist").onclick = () => { if (np) chooseArtist(np.artists); };
  $("npTitle").onclick = () => { if (np) { go("playing"); window.scrollTo(0, 0); } };
  $("pvMix").onclick = () => { const rec = np && byId.get(np.id); if (rec && rec.key) setAnchor(rec); };
  // ---------- ASH//FLOW queue ----------
  // Spotify lets apps add to its queue but never remove, so the queue lives here.
  // Only the next track is handed to Spotify; when it starts playing, the following one is handed over.
  let appQ = ls.get("kw.appq", []), handed = ls.get("kw.handed", null), pumping = false;
  function saveQ() { ls.set("kw.appq", appQ); ls.set("kw.handed", handed); paintModes(); paintQueue(); }
  function enqueue(t) {
    if (!Spotify.connected()) { toast("Connect Spotify first (top right)"); return; }
    if (!Spotify.canPlay()) { showReconnect(); return; }
    appQ.push(t.id); saveQ();
    toast(`Queued: ${t.title} (${appQ.length + (handed ? 1 : 0)} in queue)`);
    pump();
  }
  async function pump() {
    if (pumping || handed || !appQ.length || !Spotify.connected() || !Spotify.canPlay()) return;
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
      del.onclick = () => { const qi = parseInt(r.dataset.qi); appQ.splice(qi, 1); saveQ(); toast("Removed from queue"); };
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
  makeSortable($("pvQueue"), ids => { appQ = ids; saveQ(); });
  $("qClear").onclick = () => {
    const b = $("qClear");
    if (!b.dataset.confirm) { b.dataset.confirm = "1"; b.textContent = "Tap again to clear"; setTimeout(() => { delete b.dataset.confirm; b.textContent = "Clear queue"; }, 3000); return; }
    appQ = []; saveQ(); delete b.dataset.confirm; b.textContent = "Clear queue"; toast("Queue cleared");
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
    sh.innerHTML = `<div class="grab"></div><div class="sh-t">${esc(t.title)}</div><div class="sh-a">${esc(t.artist)}${t.key ? ` · ${t.key} ${NAMES[t.key]}` : ""}${t.tempo ? ` · ${t.tempo} tempo` : ""}</div>
      <button class="item" data-a="play" type="button"><span>▶</span>Play now</button>
      <button class="item" data-a="queue" type="button"><span>⤓</span>Add to queue</button>
      <button class="item" data-a="crate" type="button"><span>${inCrate ? "✓" : "+"}</span>${inCrate ? "Remove from crate" : "Add to crate"}</button>
      <button class="item" data-a="mix" type="button" ${t.key ? "" : "disabled"}><span>◎</span>Mix out of this</button>
      <button class="item" data-a="artist" type="button"><span>👤</span>Go to artist</button>
      <button class="item" data-a="album" type="button"><span>💿</span>Go to album</button>
      <button class="item" data-a="open" type="button"><span>↗</span>Open in Spotify</button>`;
    sh.hidden = false; $("sheetBg").hidden = false;
    const act = a => sh.querySelector(`[data-a="${a}"]`);
    act("play").onclick = () => { closeMenu(); playTrack(t); };
    act("queue").onclick = () => { closeMenu(); enqueue(t); };
    act("crate").onclick = () => { closeMenu(); const inn = toggleCrate(t.id); toast(inn ? "Added to crate" : "Removed from crate"); render(); if (!$("view-crate").hidden) paintCrate(); };
    act("mix").onclick = () => { closeMenu(); setAnchor(t); };
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
        sh.innerHTML = '<div class="grab"></div><div class="sh-t">Which artist?</div>' + d.artists.map(a => `<button class="item" type="button" data-id="${esc(a.id)}"><span>👤</span>${esc(a.name)}</button>`).join("");
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
    sh.innerHTML = '<div class="grab"></div><div class="sh-t">Which artist?</div>' + artists.map(a => `<button class="item" type="button" data-id="${esc(a.id)}"><span>👤</span>${esc(a.name)}</button>`).join("");
    sh.hidden = false; $("sheetBg").hidden = false;
    sh.querySelectorAll("[data-id]").forEach(b => b.onclick = () => { closeMenu(); openArtist(b.dataset.id, b.textContent.trim()); });
  }
  async function renderBrowse() {
    const w = $("browseWrap"), page = browseStack[browseStack.length - 1];
    w.innerHTML = '<p class="note">Loading…</p>';
    try {
      if (page.type === "album") {
        const a = page.data || (page.data = await Spotify.getAlbum(page.id));
        a.tracks.forEach(t => qMeta.set(t.id, { title: t.title, artist: t.artist }));
        const known = a.tracks.filter(t => byId.get(t.id) && byId.get(t.id).key).length;
        w.innerHTML = `<div class="bhead"><div class="bimg" style="background-image:url('${esc(a.image)}')"></div><div><div class="bt">${esc(a.name)}</div>
          <div class="bs">${a.artists.map(x => `<a href="#" data-artist="${esc(x.id)}" style="color:inherit">${esc(x.name)}</a>`).join(", ")}${a.year ? " · " + a.year : ""} · ${a.total && a.total > a.tracks.length ? `showing ${a.tracks.length} of ${a.total} tracks` : a.tracks.length + " tracks"}</div>
          <div class="bs">${known} with a key in your library</div></div></div>
          <div class="crate-actions"><button class="btn ghost" type="button" id="bAllQ">Queue all with keys</button><a class="btn ghost" href="https://open.spotify.com/album/${esc(a.id)}">Open in Spotify</a></div>`;
        w.querySelectorAll("[data-artist]").forEach(el => el.onclick = e => { e.preventDefault(); openArtist(el.dataset.artist); });
        const list = document.createElement("div"); list.className = "list";
        a.tracks.forEach(t => list.appendChild(rowEl(recOf(t.id, t), null, setAnchor)));
        w.appendChild(list);
        $("bAllQ").onclick = () => { const ks = a.tracks.map(t => byId.get(t.id)).filter(r => r && r.key); if (!ks.length) { toast("None of these have a key yet"); return; } ks.forEach(r => appQ.push(r.id)); saveQ(); pump(); toast(`Queued ${ks.length} tracks`); };
      } else {
        let a = page.data;
        if (!a) { try { a = page.data = await Spotify.getArtist(page.id); } catch (e) { a = { id: page.id, name: page.name || "Artist", image: "", genres: [], albums: [], albumsError: e.message }; } }
        const name = a.name.toLowerCase();
        const mine = T.filter(t => t.artist.toLowerCase().split(/,\s*/).includes(name) || t.artist.toLowerCase() === name);
        w.innerHTML = `<div class="bhead artist"><div class="bimg" style="background-image:url('${esc(a.image)}')"></div><div><div class="bt">${esc(a.name)}</div>
          <div class="bs">${a.genres.slice(0, 3).map(esc).join(" · ")}</div><div class="bs">${mine.length} in your library</div></div></div>
          <div class="crate-actions"><a class="btn ghost" href="https://open.spotify.com/artist/${esc(a.id)}">Open in Spotify</a></div>`;
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
    const h = ls.get("kw.history", []);
    let changed = false;
    for (const e of entries) {
      if (!e.id || !e.at) continue;
      if (h.some(x => x.id === e.id && Math.abs(x.at - e.at) < 10 * 60 * 1000)) continue;
      h.push({ id: e.id, title: e.title, artist: e.artist, at: e.at }); changed = true;
    }
    if (!changed) return;
    h.sort((a, b) => a.at - b.at);
    ls.set("kw.history", h.slice(-3000));
    if (!$("view-history").hidden) paintHistory();
  }
  async function syncRecent() {
    lastRecentSync = Date.now();
    if (!Spotify.connected() || !Spotify.canPlay()) return;
    try { addHistory(await Spotify.recentlyPlayed()); } catch (e) {}
  }
  function sessions() {
    const h = ls.get("kw.history", []), out = [];
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
      box.innerHTML = `<div class="sess-h"><b>${i === 0 && Date.now() - ses.last < GAP ? "Tonight\'s flow · " : ""}${dayFmt.format(ses.start)}</b><span>${timeFmt.format(ses.start)} – ${timeFmt.format(ses.last)} · ${recs.length} tracks</span></div>
        <div class="sess-keys">${keys}</div>
        <div class="acts"><button class="btn" type="button" data-a="crate">Use as crate</button><button class="btn ghost" type="button" data-a="addcrate">Add to crate</button><button class="btn ghost" type="button" data-a="toggle">${openSess.has(key) ? "Hide tracks" : "Show tracks"}</button><button class="btn ghost danger" type="button" data-a="del">Delete</button></div>`;
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
        ls.set("kw.history", ls.get("kw.history", []).filter(e => !ses.plays.some(p => p.id === e.id && p.at === e.at)));
        paintHistory(); toast("Flow deleted");
      };
      w.appendChild(box);
    });
  }

  // ---------- tabs + spotify button ----------
  function go(v, skipPaint) {
    document.querySelectorAll(".view").forEach(s => s.hidden = s.id !== "view-" + v);
    const tabFor = v === "info" ? "more" : v === "browse" ? returnView : v === "match" ? matchReturn : v;
    document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.view === tabFor));
    document.body.classList.toggle("on-playing", v === "playing");
    if (v === "playing") { paintPlaying(); paintQueue(); if (Spotify.connected() && Spotify.canPlay()) startPolling(); }
    else if (typeof npTimer !== "undefined" && npTimer && Spotify.canPlay()) startPolling();
    if (v === "crate") paintCrate();
    if (v === "history") { paintHistory(); syncRecent(); }
    if (v === "playlists" && !skipPaint) paintPlaylists();
    if (v === "more") paintMore();
    if (v !== "browse" && v !== "info" && v !== "match") { try { sessionStorage.setItem("kw.view", v); } catch (e) {} }
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

  // ---------- boot ----------
  (async function boot() {
    buildWheel();
    const res = await Spotify.handleRedirect().catch(e => ({ error: e.message }));
    await loadLibrary();
    const tIds = saved.trail || [];
    state.trail = tIds.map(id => byId.get(id)).filter(t => t && t.key);
    if (saved.anchor) { const a = byId.get(saved.anchor); if (a && a.key) { state.anchor = a; state.key = a.key; if (a.tempo) { tmin.value = a.tempo - 6; tmax.value = a.tempo + 6; } } }
    crateOptions(); saveCrate(); paintSpotifyBtn(); render();
    let v = "wheel"; try { v = sessionStorage.getItem("kw.view") || "wheel"; } catch (e) {}
    go(v);
    paintModes();
    if (Spotify.connected()) { if (Spotify.canPlay()) { startPolling(); syncRecent(); } else showReconnect(); }
    if (res && res.ok) { toast("Connected to Spotify"); if (!Spotify.canPlay()) go("playlists"); }
    else if (res && res.error) toast("Spotify sign-in didn't finish: " + res.error, 5000);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  })();
})();
