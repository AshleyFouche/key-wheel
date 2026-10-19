// Key Wheel app: library, Camelot wheel, set path, crate builder, Spotify playlists.
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
        <span class="acts"><button class="btn ghost" type="button" id="aAdd">${crate.includes(t.id) ? "In crate ✓" : "+ Crate"}</button>${state.trail.length > 1 ? '<button class="btn ghost" type="button" id="back1">‹ Back one</button>' : ""}<button class="btn ghost" type="button" id="clr">${state.trail.length > 1 ? "Clear path" : "Clear track"}</button><button class="btn" type="button" id="all">All tracks</button></span>`;
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
      tr.innerHTML = '<span class="eyebrow">Your path so far</span>';
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
      sp.innerHTML = '<button class="btn" type="button" id="pathCrate">Save path as crate</button>';
      tr.appendChild(sp); a.appendChild(tr);
      $("pathCrate").onclick = () => {
        crate = [...new Set(state.trail.map(t => t.id))]; saveCrate();
        const first = state.trail[0], last = state.trail[state.trail.length - 1];
        $("crateName").value = `ASH//F Set · ${first.title} → ${last.title}`.slice(0, 100);
        go("crate"); window.scrollTo(0, 0); toast(`Crate set to your ${crate.length}-track path`);
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
      <button class="play${playMode === "queue" ? " queue" : ""}" type="button" aria-label="${playMode === "queue" ? "Add to Spotify queue" : "Play in Spotify"}">${playMode === "queue" ? "⤓" : "▶"}</button>
      <button class="add${crate.includes(t.id) ? " in" : ""}" type="button" aria-label="Add to crate">${crate.includes(t.id) ? "✓" : "+"}</button>`;
    if (np && np.id === t.id) r.classList.add("now");
    r.dataset.tid = t.id;
    r.querySelector(".play").onclick = () => playTrack(t);
    const tt = r.querySelector(".tt");
    tt.onclick = () => onPick(t);
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
  (function enableDrag() {
    const list = $("crateList");
    let dragRow = null, scrollTimer = null, lastY = 0;
    list.addEventListener("pointerdown", e => {
      const h = e.target.closest(".drag"); if (!h) return;
      dragRow = h.closest(".row"); dragRow.classList.add("dragging");
      h.setPointerCapture(e.pointerId); lastY = e.clientY; e.preventDefault();
      scrollTimer = setInterval(() => {
        if (!dragRow) return;
        const edge = 80, H = innerHeight;
        if (lastY < edge) window.scrollBy(0, -12);
        else if (lastY > H - edge - 70) window.scrollBy(0, 12);
      }, 16);
    });
    list.addEventListener("pointermove", e => {
      if (!dragRow) return;
      lastY = e.clientY;
      const rows = [...list.children].filter(r => r !== dragRow);
      let before = null;
      for (const r of rows) { const b = r.getBoundingClientRect(); if (e.clientY < b.top + b.height / 2) { before = r; break; } }
      if (before) { if (dragRow.nextSibling !== before) list.insertBefore(dragRow, before); }
      else if (list.lastChild !== dragRow) list.appendChild(dragRow);
    });
    const end = () => {
      if (!dragRow) return;
      dragRow.classList.remove("dragging"); dragRow = null; clearInterval(scrollTimer);
      crate = [...list.children].map(r => r.dataset.id).filter(Boolean); saveCrate();
    };
    list.addEventListener("pointerup", end); list.addEventListener("pointercancel", end);
  })();
  $("fromPath").onclick = () => { state.trail.forEach(t => { if (!crate.includes(t.id)) crate.push(t.id); }); saveCrate(); paintCrate(); toast(state.trail.length ? "Set path added" : "No set path yet — tap tracks on the wheel first"); };
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
        const pl = await Spotify.createPlaylist(name, "Built in Key Wheel", ids);
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
  async function openPlaylist(p) {
    const w = $("plWrap");
    w.innerHTML = `<button class="btn ghost back" id="plBack" type="button">‹ All playlists</button><h2>${esc(p.name)}</h2><p class="note">Loading tracks…</p>`;
    $("plBack").onclick = paintPlaylists;
    try {
      const tracks = await Spotify.playlistTracks(p.id);
      const recs = tracks.map(t => byId.get(t.id) || { id: t.id, title: t.title, artist: t.artist, tempo: 0, key: null });
      const known = recs.filter(r => r.key).length;
      w.querySelector(".note").textContent = `${tracks.length} tracks · ${known} with a key in your library${known < tracks.length ? ` · ${tracks.length - known} still need one (send Claude a screen recording of this playlist in Mix view)` : ""}`;
      const acts = document.createElement("div"); acts.className = "crate-actions";
      acts.innerHTML = '<button class="btn ghost" type="button" id="plAll">Add tracks with keys to crate</button>';
      w.appendChild(acts);
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
    const data = { app: "key-wheel", saved: new Date().toISOString(), extra: ls.get("kw.extra", []), crate, state: { key: state.key, on: state.on } };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "key-wheel-backup.json"; document.body.appendChild(a); a.click(); a.remove();
  };
  $("restore").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.app !== "key-wheel") throw new Error("not a Key Wheel backup");
      ls.set("kw.extra", d.extra || []); crate = d.crate || []; saveCrate();
      await loadLibrary(); crateOptions(); render(); paintMore(); toast("Backup restored");
    } catch (err) { toast("Couldn't restore: " + err.message); }
    e.target.value = "";
  };
  $("addPaste").onclick = async () => {
    const st = $("pasteStatus"); const extra = ls.get("kw.extra", []); const idx = new Map(extra.map((a, i) => [a[0], i]));
    let added = 0, bad = 0;
    $("paste").value.split(/\n+/).forEach(line => {
      if (!line.trim()) return;
      const parts = (line.includes("|") ? line.split("|") : line.split(/[,\t]/)).map(s => s.trim());
      let id = (parts[0] || "").trim(); const m = id.match(/track[/:]([A-Za-z0-9]{22})/); if (m) id = m[1];
      const key = normKey(parts[1]), tempo = Math.round(parseFloat(parts[2])) || 0;
      if (!/^[A-Za-z0-9]{22}$/.test(id) || !key) { bad++; return; }
      const prev = byId.get(id);
      const rec = [id, parts[3] || prev?.title || "", parts.slice(4).join(", ") || prev?.artist || "", tempo, key, prev?.crate || "", prev?.euph ? 1 : 0, prev?.house ? 1 : 0];
      if (idx.has(id)) extra[idx.get(id)] = rec; else { idx.set(id, extra.length); extra.push(rec); }
      added++;
    });
    ls.set("kw.extra", extra); await loadLibrary(); crateOptions(); render(); paintMore();
    st.className = "status " + (added ? "ok" : "err");
    st.textContent = `${added} tracks added or updated${bad ? `, ${bad} lines skipped (need a Spotify track id and a key like 8A)` : ""}.`;
    if (added) $("paste").value = "";
  };

  // ---------- playback + now playing ----------
  let np = null, playMode = ls.get("kw.playMode", "play"), follow = ls.get("kw.follow", false), npTimer = null, lastNpId = null;
  const npBar = $("np");
  async function playTrack(t) {
    if (!Spotify.connected()) { toast("Connect Spotify first (top right)"); return; }
    if (!Spotify.canPlay()) { showReconnect(); return; }
    try {
      if (playMode === "queue") { await Spotify.queue(t.id); toast("Queued: " + t.title); setTimeout(loadUpNext, 800); }
      else { await Spotify.play(t.id); toast("Playing: " + t.title); }
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
    $("npTitle").textContent = "Reconnect Spotify to play from Key Wheel";
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
    document.querySelectorAll(".chip-seg button").forEach(b => b.classList.toggle("on", b.dataset.mode === playMode));
    $("npFollow").setAttribute("aria-pressed", follow ? "true" : "false");
    $("npFollow").textContent = follow ? "Following ✓" : "Follow";
  }
  document.querySelectorAll(".chip-seg button").forEach(b => b.onclick = () => { playMode = b.dataset.mode; ls.set("kw.playMode", playMode); paintModes(); paintList(); if (!$("view-crate").hidden) paintCrate(); });
  $("npFollow").onclick = () => {
    follow = !follow; ls.set("kw.follow", follow); paintModes();
    toast(follow ? "Following what Spotify plays" : "Stopped following");
    if (follow && np) { const rec = byId.get(np.id); if (rec && rec.key && (!state.anchor || state.anchor.id !== rec.id)) setAnchor(rec, false, true); }
  };
  async function pollNow() {
    if (!Spotify.connected() || !Spotify.canPlay() || document.visibilityState !== "visible") return;
    try {
      np = await Spotify.playerState();
      if (np && np.id !== lastNpId) {
        lastNpId = np.id;
        if (!$("view-playing").hidden) loadUpNext();
        if (follow) { const rec = byId.get(np.id); if (rec && rec.key && (!state.anchor || state.anchor.id !== rec.id)) setAnchor(rec, false, true); }
      }
      paintNp(); paintPlaying();
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
    $("pvDev").textContent = np.device ? "on " + np.device : "";
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
  $("pvMix").onclick = () => { const rec = np && byId.get(np.id); if (rec && rec.key) setAnchor(rec); };
  async function loadUpNext() {
    const box = $("pvQueue");
    if (!np) { box.innerHTML = ""; return; }
    try {
      const items = (await Spotify.upNext()).slice(0, 10);
      const cur = byId.get(np.id), rel = cur && cur.key ? relations(cur.key) : null;
      box.innerHTML = items.length ? "" : '<p class="note">Spotify\'s queue is empty. Switch to ＋ Queue and tap ⤓ on tracks to line them up.</p>';
      items.forEach(it => {
        const rec = byId.get(it.id) || { id: it.id, title: it.title, artist: it.artist, tempo: 0, key: null };
        const r = rowEl(rec, null, setAnchor);
        const lab = document.createElement("div"); lab.className = "rel";
        const m = rel && rec.key ? rel[rec.key] : null;
        lab.textContent = !rec.key ? "No key yet" : m ? MOVE_NAME[m] : "Key clash";
        if (!m) lab.style.color = rec.key ? "var(--warn)" : "var(--muted)";
        r.querySelector(".tt").prepend(lab);
        box.appendChild(r);
      });
    } catch (e) { box.innerHTML = '<p class="note">Couldn\'t load Spotify\'s queue.</p>'; }
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pollNow(); });

  // ---------- tabs + spotify button ----------
  function go(v) {
    document.querySelectorAll(".view").forEach(s => s.hidden = s.id !== "view-" + v);
    document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.view === v));
    document.body.classList.toggle("on-playing", v === "playing");
    if (v === "playing") { paintPlaying(); loadUpNext(); if (Spotify.connected() && Spotify.canPlay()) startPolling(); }
    else if (typeof npTimer !== "undefined" && npTimer && Spotify.canPlay()) startPolling();
    if (v === "crate") paintCrate();
    if (v === "playlists") paintPlaylists();
    if (v === "more") paintMore();
    try { sessionStorage.setItem("kw.view", v); } catch (e) {}
  }
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
    if (Spotify.connected()) { if (Spotify.canPlay()) startPolling(); else showReconnect(); }
    if (res && res.ok) { toast("Connected to Spotify"); if (!Spotify.canPlay()) go("playlists"); }
    else if (res && res.error) toast("Spotify sign-in didn't finish: " + res.error, 5000);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  })();
})();
