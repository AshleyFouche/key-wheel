// Read tracks (title, artist, BPM, key, length) from screenshots or screen recordings of Spotify's Mix view.
// Runs entirely on the phone with Tesseract (downloaded once from a public CDN, then cached by the browser).
(function () {
  const LIB = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  let workerP = null;

  function loadLib() {
    if (window.Tesseract) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = LIB; s.onload = res;
      s.onerror = () => rej(new Error("Couldn't download the text reader. Check your connection and try again."));
      document.head.appendChild(s);
    });
  }
  async function worker() {
    if (!workerP) workerP = loadLib().then(() => Tesseract.createWorker("eng"));
    return workerP;
  }

  // ---- canvas helpers ----
  const mkCanvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  function crop(src, x, y, w, h, scale) {
    scale = scale || 1;
    const c = mkCanvas(Math.round(w * scale), Math.round(h * scale)), g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
    return c;
  }
  function invertGray(c) {
    const g = c.getContext("2d"), d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) { const v = 255 - (p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114); p[i] = p[i + 1] = p[i + 2] = v; }
    g.putImageData(d, 0, 0); return c;
  }
  function binarise(c, cut) {
    const g = c.getContext("2d"), d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) { const v = (p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114) > cut ? 255 : 0; p[i] = p[i + 1] = p[i + 2] = v; }
    g.putImageData(d, 0, 0); return c;
  }
  function padWhite(c, pad) {
    const o = mkCanvas(c.width + pad * 2, c.height + pad * 2), g = o.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, o.width, o.height); g.drawImage(c, pad, pad); return o;
  }

  // Key badges are the only brightly coloured shapes in the right-hand column: find them by colour.
  function findBadges(full) {
    const W = full.width, H = full.height, x0 = Math.floor(W * 0.70), x1 = Math.floor(W * 0.93);
    const d = full.getContext("2d").getImageData(x0, 0, x1 - x0, H).data, rw = x1 - x0;
    const rows = new Array(H);
    for (let y = 0; y < H; y++) {
      let n = 0, mn = 1e9, mx = -1;
      for (let x = 0; x < rw; x += 2) {
        const i = (y * rw + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2], hi = Math.max(r, g, b), lo = Math.min(r, g, b);
        if (hi > 110 && hi - lo > 45) { n++; if (x < mn) mn = x; if (x > mx) mx = x; }
      }
      rows[y] = { n, mn, mx };
    }
    const out = [], minH = Math.round(H * 0.006);
    for (let y = 0; y < H; y++) {
      if (rows[y].n < 6) continue;
      const ys = y; let mn = 1e9, mx = -1;
      while (y < H && rows[y].n >= 6) { mn = Math.min(mn, rows[y].mn); mx = Math.max(mx, rows[y].mx); y++; }
      const h = y - ys;
      if (h >= minH && h <= H * 0.03 && mx - mn > h * 0.9) out.push({ x0: x0 + mn, y0: ys, x1: x0 + mx, y1: y });
    }
    return out;
  }

  async function recognise(canvas, params) {
    const w = await worker();
    await w.setParameters(Object.assign({ tessedit_char_whitelist: "", tessedit_pageseg_mode: "4" }, params || {}));
    const { data } = await w.recognize(canvas);
    let words = data.words;
    if (!words && data.blocks) {
      words = [];
      data.blocks.forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(l => (l.words || []).forEach(x => words.push(x)))));
    }
    return { text: (data.text || "").trim(), words: (words || []).filter(x => x.text && x.text.trim()) };
  }

  // Count the separate characters printed on a badge: "6A" has 2, "11A" has 3.
  // More reliable than the badge's width at screen-recording resolution.
  function glyphCount(c) {
    const W = c.width, H = c.height, d = c.getContext("2d").getImageData(0, 0, W, H).data;
    const dark = new Uint8Array(W * H), seen = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) dark[i] = d[i * 4] < 128 ? 1 : 0;
    let n = 0; const minA = H * H * 0.02, st = [];
    for (let i = 0; i < W * H; i++) {
      if (!dark[i] || seen[i]) continue;
      seen[i] = 1; st.push(i); let area = 0, touch = false, y0 = H, y1 = 0;
      while (st.length) {
        const j = st.pop(), x = j % W, y = (j - x) / W; area++;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touch = true;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (const k of [j + 1, j - 1, j + W, j - W]) if (k >= 0 && k < W * H && Math.abs((k % W) - x) <= 1 && dark[k] && !seen[k]) { seen[k] = 1; st.push(k); }
      }
      if (!touch && area > minA && y1 - y0 > H * 0.4) n++;
    }
    return n;
  }
  async function readKey(full, b) {
    const bh = b.y1 - b.y0, pad = Math.round(bh * 0.12);
    const probe = binarise(crop(full, b.x0 + pad, b.y0 + pad, b.x1 - b.x0 - pad * 2, bh - pad * 2, 4), 90), g = glyphCount(probe);
    const two = g === 3 ? true : g === 2 ? false : (b.x1 - b.x0) / bh >= 1.9;
    const fit = t => {
      const m = t.match(/(1[0-2]|[0-9])([AB])$/); if (!m) return null;
      let n = m[1];
      if (two && n.length === 1) n = "1" + n;                 // a thin "1" got dropped
      if (!two && n.length === 2) n = n.slice(-1);             // a stray "1" crept in
      return /^(1[0-2]|[1-9])$/.test(n) ? n + m[2] : null;
    };
    let fallback = null;
    for (const cut of [90, 130]) {
      let c = crop(full, b.x0 + pad, b.y0 + pad, b.x1 - b.x0 - pad * 2, bh - pad * 2, 4);
      c = padWhite(binarise(c, cut), 40);
      for (const psm of ["7", "8", "13"]) {
        const t = (await recognise(c, { tessedit_pageseg_mode: psm, tessedit_char_whitelist: "0123456789AB" })).text.replace(/\s+/g, "");
        const raw = (t.match(/(1[0-2]|[0-9])([AB])$/) || [""])[0];
        const k = fit(t); if (!k) continue;
        if (raw.length === k.length) return k;                // read matches the badge shape: trust it
        fallback = fallback || k;                             // corrected read: keep looking for a clean one
      }
    }
    return fallback;
  }

  function groupLines(words, tol) {
    words = words.map(w => ({ text: w.text.trim(), x: w.bbox.x0, y: w.bbox.y0, h: w.bbox.y1 - w.bbox.y0, cy: (w.bbox.y0 + w.bbox.y1) / 2 }))
      .sort((a, b) => a.cy - b.cy);
    const L = [];
    words.forEach(w => {
      const last = L[L.length - 1];
      if (last && Math.abs(last.cy - w.cy) < tol) { last.w.push(w); last.cy = (last.cy + w.cy) / 2; }
      else L.push({ cy: w.cy, w: [w] });
    });
    L.forEach(l => { l.w.sort((a, b) => a.x - b.x); l.text = l.w.map(w => w.text).join(" "); });
    return L;
  }

  // The green download arrow before the artist sometimes reads as junk ("@", "©", "6", "CL)"): drop it.
  const cleanArtist = s => {
    s = s.replace(/^[^\p{L}\p{N}]+/u, "").trim();
    const parts = s.split(/\s+/);
    if (parts.length > 1 && (/^(?:[@©®OoQG0-9]{1,2})$/.test(parts[0]) || (parts[0].length <= 3 && /[^\p{L}.]/u.test(parts[0])))) parts.shift();
    return parts.join(" ").trim();
  };

  // One screenshot (or video frame) → tracks.
  async function readImage(full) {
    // Screen recordings are lower resolution than screenshots: enlarge to screenshot size first.
    if (full.width < 1200) full = crop(full, 0, 0, full.width, full.height, 1320 / full.width);
    const W = full.width, H = full.height, x0 = Math.floor(W * 0.165), x1 = Math.floor(W * 0.93);
    const main = invertGray(crop(full, x0, 0, x1 - x0, H));
    const { words } = await recognise(main, { tessedit_pageseg_mode: "4" });
    words.forEach(w => { w.bbox = { x0: w.bbox.x0 + x0, x1: w.bbox.x1 + x0, y0: w.bbox.y0, y1: w.bbox.y1 }; });
    const L = groupLines(words, H * 0.006);
    const keys = [];
    for (const b of findBadges(full)) {
      // only badges that sit on a track row (skips the battery icon, play button, etc.)
      const cy = (b.y0 + b.y1) / 2;
      if (!L.some((l, i) => /\d{2,3}\s*b\S{0,2}m\b/i.test(l.text) && L[i + 1] && Math.abs(L[i + 1].cy - cy) < H * 0.015)) continue;
      const k = await readKey(full, b); if (k) keys.push({ cy, k });
    }
    const out = [];
    L.forEach((l, i) => {
      const m = l.text.match(/(\d{2,3})\s*b\S{0,2}m\b/i); if (!m) return;
      if (l.cy < H * 0.105 || l.cy > H * 0.81) return;     // half-hidden under the top buttons or the player bar
      const bpm = parseInt(m[1], 10);
      const nums = l.w.filter(w => /^\d{2,3}$/.test(w.text)), cut = nums.length ? nums[nums.length - 1].x : W * 0.75;
      const title = l.w.filter(w => w.x < cut - 5).map(w => w.text).join(" ").trim();
      const nx = L[i + 1]; if (!nx || nx.cy - l.cy > H * 0.03 || !title) return;
      const dm = nx.w.filter(w => /^\d{1,2}:\d{2}$/.test(w.text)).pop();
      let len = dm ? dm.text : ""; if (len && parseInt(len, 10) > 20) len = "";     // drop impossible lengths
      const artist = cleanArtist(nx.w.filter(w => w.x < W * 0.70).map(w => w.text).join(" "));
      const kk = keys.find(k => Math.abs(k.cy - nx.cy) < H * 0.012);
      if (!kk) return;                                    // half-visible row at the edge: skip, it shows up whole in the next shot
      out.push({ key: kk.k, bpm, title, artist, len });
    });
    return out;
  }

  // ---- images ----
  function loadImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => { const c = mkCanvas(img.naturalWidth, img.naturalHeight); c.getContext("2d").drawImage(img, 0, 0); URL.revokeObjectURL(url); res(c); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Couldn't open " + file.name)); };
      img.src = url;
    });
  }

  // ---- videos ----
  // Screen recordings are sharp even mid-scroll, so there's no need to wait for pauses. Instead, track how far
  // the list has scrolled and read a frame each time about half a screen of new tracks has come into view.
  const PROF_H = 350;
  function profile(c) {
    const s = mkCanvas(16, PROF_H), g = s.getContext("2d");
    g.drawImage(c, c.width * 0.165, c.height * 0.12, c.width * 0.6, c.height * 0.7, 0, 0, 16, PROF_H);
    const d = g.getImageData(0, 0, 16, PROF_H).data, out = new Float32Array(PROF_H);
    for (let r = 0; r < PROF_H; r++) { let t = 0; for (let x = 0; x < 16; x++) { const i = (r * 16 + x) * 4; t += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; } out[r] = t / 16; }
    return out;
  }
  function scrollBetween(a, b, maxs) {          // rows the list moved between two frames (best-aligned shift)
    let best = 1e9, bs = 0;
    for (let s = -maxs; s <= maxs; s++) {
      const lo = Math.max(0, s), hi = Math.min(PROF_H, PROF_H + s); if (hi - lo < 100) continue;
      let e = 0; for (let i = lo; i < hi; i++) e += Math.abs(a[i] - b[i - s]);
      e /= hi - lo; if (e < best) { best = e; bs = s; }
    }
    return Math.abs(bs);
  }
  async function videoFrames(file, onFrame, onProgress) {
    const url = URL.createObjectURL(file), v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error("Couldn't open that video on this device")); });
    const dur = v.duration, step = 0.1, W = v.videoWidth, H = v.videoHeight;
    const c = mkCanvas(W, H), g = c.getContext("2d");
    let prev = null, moved = 0, n = 0, last = -1;
    const take = async () => { const copy = mkCanvas(W, H); copy.getContext("2d").drawImage(c, 0, 0); await onFrame(copy); n++; moved = 0; };
    for (let t = 0.05; t < dur; t += step) {
      await new Promise(res => { v.onseeked = res; v.currentTime = Math.min(t, dur - 0.02); });
      g.drawImage(v, 0, 0, W, H);
      const p = profile(c);
      if (prev) moved += scrollBetween(prev, p, 140);
      if (!prev || moved >= PROF_H * 0.38) { await take(); last = t; }
      prev = p;
      onProgress && onProgress(t / dur);
    }
    if (moved > PROF_H * 0.1) await take();       // whatever scrolled in at the very end
    URL.revokeObjectURL(url);
    return n;
  }

  // The same track read from two frames can differ by a letter ("Mondmelodie" / "Mondmeliodie"):
  // same key + same BPM + nearly the same title counts as one track.
  const norm = s => (s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  function similar(a, b) {
    if (a === b) return 1; if (!a || !b) return 0;
    const m = a.length, n = b.length, row = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      let prev = row[0]; row[0] = i;
      for (let j = 1; j <= n; j++) { const tmp = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = tmp; }
    }
    return 1 - row[n] / Math.max(m, n);
  }

  // Public: read a set of files (screenshots and/or recordings) and return unique tracks in order.
  async function readFiles(files, onStatus) {
    const tracks = [];
    const add = list => list.forEach(t => {
      const tn = norm(t.title);
      const same = tracks.find(x => x.bpm === t.bpm && similar(norm(x.title), tn) >= 0.8 &&
        (x.key === t.key || !x.artist || !t.artist || similar(norm(x.artist), norm(t.artist)) >= 0.8));
      if (same) {
        if (!same.artist && t.artist) same.artist = t.artist; if (!same.len && t.len) same.len = t.len;
        if (same.key !== t.key && t.key.length > same.key.length && t.key.endsWith(same.key)) same.key = t.key;   // "2A" vs "12A": the 1 got dropped
        return;
      }
      tracks.push(t);
    });
    onStatus("Loading the text reader (first time takes a few seconds)…");
    await worker();
    let i = 0;
    for (const f of files) {
      i++;
      if (/^video\//.test(f.type) || /\.(mov|mp4|m4v|webm)$/i.test(f.name)) {
        let frames = 0, pct = 0;
        await videoFrames(f, async c => { frames++; onStatus(`Recording ${i} of ${files.length}: ${pct}% · reading screen ${frames} · ${tracks.length} tracks so far`); add(await readImage(c)); },
          p => { pct = Math.round(p * 100); onStatus(`Recording ${i} of ${files.length}: ${pct}% · ${tracks.length} tracks so far`); });
      } else {
        onStatus(`Reading screenshot ${i} of ${files.length}… (${tracks.length} tracks so far)`);
        add(await readImage(await loadImage(f)));
      }
    }
    return tracks;
  }
  const toLines = tracks => tracks.map(t => [t.key, t.bpm, t.title, t.artist, t.len].filter((x, j) => j < 4 || x).join(" | ")).join("\n");

  window.FlowOCR = { readFiles, toLines };
})();
