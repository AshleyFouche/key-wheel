// Spotify sign-in (Authorization Code with PKCE, no server) and the few Web API calls the app needs.
(function () {
  const AUTH = "https://accounts.spotify.com/authorize";
  const TOKEN = "https://accounts.spotify.com/api/token";
  const API = "https://api.spotify.com/v1";
  const SCOPES = "playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public user-read-playback-state user-modify-playback-state user-read-currently-playing user-read-recently-played user-library-read user-library-modify";
  const PLAYER_SCOPES = ["user-read-playback-state", "user-modify-playback-state", "user-read-currently-playing", "user-read-recently-played"];
  const KEY = "kwb.spotify";

  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} },
    clear() { try { localStorage.removeItem(KEY); } catch (e) {} }
  };

  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  function randomString(n) {
    const a = new Uint8Array(n); crypto.getRandomValues(a);
    return b64url(a).slice(0, n);
  }

  async function login() {
    const cid = window.CONFIG.spotifyClientId;
    if (!cid) throw new Error("No Spotify Client ID set yet.");
    const verifier = randomString(64);
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    // The verifier also rides in `state`, so sign-in still completes if iPhone returns to Safari instead of the home-screen app.
    const state = randomString(16) + "." + verifier;
    try { sessionStorage.setItem("kwb.pkce", verifier); localStorage.setItem("kwb.pkce", verifier); } catch (e) {}
    const p = new URLSearchParams({
      client_id: cid, response_type: "code", redirect_uri: window.CONFIG.redirectUri,
      scope: SCOPES, code_challenge_method: "S256", code_challenge: challenge, state
    });
    location.href = AUTH + "?" + p.toString();
  }

  async function handleRedirect() {
    const u = new URL(location.href);
    const code = u.searchParams.get("code"), err = u.searchParams.get("error");
    if (!code && !err) return null;
    history.replaceState(null, "", window.CONFIG.redirectUri);
    if (err) return { error: err };
    let verifier = null;
    try { verifier = sessionStorage.getItem("kwb.pkce") || localStorage.getItem("kwb.pkce"); } catch (e) {}
    const st = u.searchParams.get("state") || "";
    if (!verifier && st.includes(".")) verifier = st.split(".").slice(1).join(".");
    if (!verifier) return { error: "missing_verifier" };
    const r = await fetch(TOKEN, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: window.CONFIG.spotifyClientId, grant_type: "authorization_code", code, redirect_uri: window.CONFIG.redirectUri, code_verifier: verifier })
    });
    try { sessionStorage.removeItem("kwb.pkce"); localStorage.removeItem("kwb.pkce"); } catch (e) {}
    const j = await r.json();
    if (!r.ok) return { error: j.error_description || j.error || "token_failed" };
    saveToken(j);
    return { ok: true };
  }

  function saveToken(j) {
    const prev = store.get() || {};
    store.set({
      access: j.access_token,
      refresh: j.refresh_token || prev.refresh,
      expires: Date.now() + (j.expires_in - 60) * 1000,
      scope: j.scope || prev.scope || "",
      user: prev.user
    });
  }

  async function token() {
    const t = store.get();
    if (!t) return null;
    if (Date.now() < t.expires) return t.access;
    if (!t.refresh) return null;
    const r = await fetch(TOKEN, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh, client_id: window.CONFIG.spotifyClientId })
    });
    if (!r.ok) { store.clear(); return null; }
    saveToken(await r.json());
    return store.get().access;
  }

  // Recent player commands and Spotify's replies, for the Connection check on the More tab.
  const LOG = [];
  const logIt = (opts, path, status, msg) => {
    const m = opts.method || "GET";
    if (!/\/me\/player/.test(path) && !(m !== "GET" && /\/playlists\/|\/me\/library/.test(path))) return;
    if (m === "GET" && status < 300 && !/devices/.test(path)) return;   // skip routine polling
    LOG.push({ at: Date.now(), m: opts.method || "GET", p: path.replace(API, "").replace(/uris=[^&]+/, "uris=…"), s: status, msg: msg || "" });
    if (LOG.length > 25) LOG.shift();
  };
  async function api(path, opts = {}) {
    const tk = await token();
    if (!tk) { const e = new Error("Not connected to Spotify"); e.code = "auth"; throw e; }
    const r = await fetch(path.startsWith("http") ? path : API + path, {
      ...opts, headers: { Authorization: "Bearer " + tk, "Content-Type": "application/json", ...(opts.headers || {}) }
    });
    if (r.status === 429) {
      const wait = parseInt(r.headers.get("Retry-After") || "2", 10);
      await new Promise(res => setTimeout(res, Math.min(wait, 10) * 1000));
      return api(path, opts);
    }
    logIt(opts, path, r.status, "");
    if (r.status === 401) { store.clear(); const e = new Error("Spotify sign-in expired"); e.code = "auth"; throw e; }
    const text = await r.text();
    let j = {}; try { j = text ? JSON.parse(text) : {}; } catch (e) { j = {}; }
    if (!r.ok && LOG.length && LOG[LOG.length - 1].s === r.status) LOG[LOG.length - 1].msg = (j.error && (j.error.reason || j.error.message)) || "";
    if (!r.ok) { const e = new Error((j.error && j.error.message) || ("Spotify error " + r.status)); e.status = r.status; e.reason = j.error && j.error.reason; throw e; }
    return j;
  }

  async function me() {
    const t = store.get();
    if (t && t.user) return t.user;
    const u = await api("/me");
    const s = store.get(); s.user = { id: u.id, name: u.display_name || u.id }; store.set(s);
    return s.user;
  }

  async function myPlaylists() {
    let url = "/me/playlists?limit=50", out = [];
    while (url) {
      const j = await api(url);
      out = out.concat(j.items || []);
      url = j.next;
    }
    return out;
  }

  // Playlist contents. Feb 2026 API uses /items and `item`; older shape used /tracks and `track`.
  async function playlistTracks(id) {
    let url = `/playlists/${id}/items?limit=50`, out = [];
    while (url) {
      const j = await api(url);
      for (const it of (j.items || [])) {
        const t = it.item || it.track;
        if (!t || t.type === "episode" || !t.id) continue;
        out.push({ id: t.id, title: t.name, artist: (t.artists || []).map(a => a.name).join(", "), uri: t.uri, duration: t.duration_ms || 0, art: t.album && t.album.images && t.album.images.length ? t.album.images[t.album.images.length - 1].url : "" });
      }
      url = j.next;
    }
    return out;
  }

  async function addTracks(playlistId, trackIds) {
    const uris = trackIds.map(id => "spotify:track:" + id);
    for (let i = 0; i < uris.length; i += 100) {
      await api(`/playlists/${playlistId}/items`, { method: "POST", body: JSON.stringify({ uris: uris.slice(i, i + 100) }) });
    }
  }

  // Move one track: the item at `from` goes in front of the item now at `before` (positions count from 0).
  async function moveInPlaylist(playlistId, from, before, snapshot) {
    const body = { range_start: from, insert_before: before, range_length: 1 };
    if (snapshot) body.snapshot_id = snapshot;
    const r = await api(`/playlists/${playlistId}/items`, { method: "PUT", body: JSON.stringify(body) });
    return r && r.snapshot_id;
  }

  // ---- Live set: a private playlist the app edits so "up next" can be changed freely ----
  const uriOf = id => "spotify:track:" + id;
  async function liveAdd(plId, ids, position) {
    let snap = null;
    for (let i = 0; i < ids.length; i += 100) {
      const body = { uris: ids.slice(i, i + 100).map(uriOf) };
      if (position != null) body.position = position + i;
      snap = (await api(`/playlists/${plId}/items`, { method: "POST", body: JSON.stringify(body) })).snapshot_id || snap;
    }
    return snap;
  }
  const liveRemove = (plId, ids) => api(`/playlists/${plId}/items`, { method: "DELETE", body: JSON.stringify({ items: [...new Set(ids)].map(id => ({ uri: uriOf(id) })) }) });
  const liveMove = (plId, from, before) => api(`/playlists/${plId}/items`, { method: "PUT", body: JSON.stringify({ range_start: from, insert_before: before, range_length: 1 }) });
  async function liveReplace(plId, ids) {
    await api(`/playlists/${plId}/items`, { method: "PUT", body: JSON.stringify({ uris: ids.slice(0, 100).map(uriOf) }) });
    if (ids.length > 100) await liveAdd(plId, ids.slice(100));
  }
  const playPlaylist = (plId, position) => withDevice(dev => api("/me/player/play" + q(dev), { method: "PUT", body: JSON.stringify({ context_uri: "spotify:playlist:" + plId, offset: { position: position || 0 } }) }));

  async function createPlaylist(name, description, trackIds) {
    const pl = await api("/me/playlists", { method: "POST", body: JSON.stringify({ name, description, public: false }) });
    await addTracks(pl.id, trackIds);
    return pl;
  }

  // ---- playback (Spotify Connect: plays on whichever device Spotify is active on) ----
  // Liked Songs / saved albums (Spotify's /me/library, February 2026). Up to 40 URIs per request.
  const LIB_SCOPES = ["user-library-read", "user-library-modify"];
  const canLibrary = () => { const t = store.get(); return !!t && LIB_SCOPES.every(sc => (t.scope || "").split(" ").includes(sc)); };
  async function libContains(uris) {
    const out = [];
    for (let i = 0; i < uris.length; i += 40) {
      const part = uris.slice(i, i + 40);
      const r = await api("/me/library/contains?uris=" + part.map(encodeURIComponent).join(","));
      part.forEach((u, j) => out.push(!!(Array.isArray(r) ? r[j] : false)));
    }
    return out;
  }
  const libSave = uris => api("/me/library?uris=" + uris.map(encodeURIComponent).join(","), { method: "PUT" });
  const libRemove = uris => api("/me/library?uris=" + uris.map(encodeURIComponent).join(","), { method: "DELETE" });
  const canPlay = () => { const t = store.get(); return !!t && PLAYER_SCOPES.every(sc => (t.scope || "").includes(sc)); };
  async function devices() { return (await api("/me/player/devices")).devices || []; }
  const setVolume = pct => api("/me/player/volume?volume_percent=" + Math.max(0, Math.min(100, Math.round(pct))), { method: "PUT" });
  const transfer = deviceId => api("/me/player", { method: "PUT", body: JSON.stringify({ device_ids: [deviceId], play: true }) });
  // When Spotify reports no active device, go back to the device that was last playing (normally the phone).
  // Never fall back to some other device in the list — that silently moves the music off the phone.
  async function pickDevice() {
    const ds = await devices(), last = localStorage.getItem("kwb.lastDevice");
    const ok = ds.filter(d => !d.is_restricted);
    // Same order as before 1.18 (active, phone, then whatever Spotify lists first), but the device last seen playing wins.
    return ds.find(d => d.is_active) || (last && ok.find(d => d.id === last)) || ok.find(d => d.type === "Smartphone") || ok.find(d => d.type === "Automobile") || ok[0] || ds[0] || null;
  }
  // When nothing is playing, the app can ask the person which device to use instead of guessing.
  let chooser = null;
  async function withDevice(fn) {
    try { return await fn(null); }
    catch (e) {
      if (e.status !== 404) throw e;           // 404 = no active device
      if (chooser) {
        // Google Cast speakers can't be started by other apps, so leave them out.
        const ds = (await devices()).filter(x => !x.is_restricted && !/^Cast/.test(x.type || ""));
        const pick = ds.length === 1 ? ds[0] : await chooser(ds, localStorage.getItem("kwb.lastDevice"));
        if (pick === "cancel") { const c = new Error("Cancelled"); c.code = "cancel"; throw c; }
        if (pick) return fn(pick.id);
      }
      const d = await pickDevice();
      if (!d) {
        const seen = (await devices().catch(() => [])).map(x => `${x.name} (${x.type}${x.is_restricted ? ", locked" : ""})`);
        const err = new Error("Spotify can't see your phone right now. " + (seen.length ? "It only sees: " + seen.join(", ") + "." : "It sees no devices at all.") + " Open the Spotify app for a second, then try again.");
        err.code = "nodevice"; throw err;
      }
      return fn(d.id);
    }
  }
  const q = id => id ? "?device_id=" + encodeURIComponent(id) : "";
  const play = trackId => withDevice(dev => api("/me/player/play" + q(dev), { method: "PUT", body: JSON.stringify({ uris: ["spotify:track:" + trackId] }) }));
  const queue = trackId => withDevice(dev => api("/me/player/queue?uri=" + encodeURIComponent("spotify:track:" + trackId) + (dev ? "&device_id=" + encodeURIComponent(dev) : ""), { method: "POST" }));
  // Play a whole album in order (Spotify carries on through it), optionally starting at one track.
  const playContext = (contextUri, startTrackId) => withDevice(dev => api("/me/player/play" + q(dev), { method: "PUT", body: JSON.stringify(startTrackId ? { context_uri: contextUri, offset: { uri: "spotify:track:" + startTrackId } } : { context_uri: contextUri }) }));
  // Play a list of tracks (up to 100) one after another.
  const playList = trackIds => withDevice(dev => api("/me/player/play" + q(dev), { method: "PUT", body: JSON.stringify({ uris: trackIds.slice(0, 100).map(id => "spotify:track:" + id) }) }));
  const setShuffle = on => api("/me/player/shuffle?state=" + (on ? "true" : "false"), { method: "PUT" });
  const setRepeat = st => api("/me/player/repeat?state=" + st, { method: "PUT" });
  const pause = () => api("/me/player/pause", { method: "PUT" });
  const resume = () => withDevice(dev => api("/me/player/play" + q(dev), { method: "PUT" }));
  async function nowPlaying() {
    const j = await api("/me/player/currently-playing");
    if (!j || !j.item || j.currently_playing_type !== "track") return j && j.is_playing !== undefined ? { playing: false, none: true } : null;
    const t = j.item;
    return {
      id: t.id, title: t.name, artist: (t.artists || []).map(a => a.name).join(", "),
      art: t.album && t.album.images && t.album.images.length ? t.album.images[t.album.images.length - 1].url : "",
      playing: !!j.is_playing, progress: j.progress_ms || 0, duration: t.duration_ms || 0
    };
  }

  const trackOf = t => t && t.type === "track" ? {
    id: t.id, title: t.name, artist: (t.artists || []).map(a => a.name).join(", "),
    art: t.album && t.album.images && t.album.images.length ? t.album.images[t.album.images.length - 1].url : "",
    artLarge: t.album && t.album.images && t.album.images.length ? t.album.images[0].url : "",
    album: t.album ? t.album.name : "", albumId: t.album ? t.album.id : null,
    artists: (t.artists || []).map(x => ({ id: x.id, name: x.name })), duration: t.duration_ms || 0
  } : null;
  async function playerState() {
    const j = await api("/me/player");
    if (!j || !j.item) return null;
    const t = trackOf(j.item); if (!t) return null;
    if (j.device && j.device.id) { try { localStorage.setItem("kwb.lastDevice", j.device.id); } catch (e) {} }
    return Object.assign(t, { context: j.context && j.context.uri ? j.context.uri : null, playing: !!j.is_playing, repeat: j.repeat_state || "off", shuffle: !!j.shuffle_state, progress: j.progress_ms || 0, at: Date.now(), device: j.device ? j.device.name : "", deviceType: j.device ? j.device.type : "",
      volume: j.device && typeof j.device.volume_percent === "number" ? j.device.volume_percent : null, canVolume: j.device ? j.device.supports_volume !== false : false });
  }
  async function upNext() {
    const j = await api("/me/player/queue");
    return (j.queue || []).map(trackOf).filter(Boolean);
  }
  const seek = ms => api("/me/player/seek?position_ms=" + Math.max(0, Math.round(ms)), { method: "PUT" });
  const next = () => withDevice(dev => api("/me/player/next" + q(dev), { method: "POST" }));
  const previous = () => withDevice(dev => api("/me/player/previous" + q(dev), { method: "POST" }));

  async function recentlyPlayed() {
    const j = await api("/me/player/recently-played?limit=50");
    return (j.items || []).map(it => {
      const t = it.track; if (!t || !t.id) return null;
      return { id: t.id, title: t.name, artist: (t.artists || []).map(a => a.name).join(", "), at: Date.parse(it.played_at) - (t.duration_ms || 0), src: "spotify" };
    }).filter(Boolean);
  }

  // ---- catalogue: track, album, artist ----
  const img = imgs => imgs && imgs.length ? imgs[0].url : "";
  async function getTrack(id) {
    const t = await api("/tracks/" + id);
    return { id: t.id, title: t.name, artists: (t.artists || []).map(a => ({ id: a.id, name: a.name })), album: t.album ? { id: t.album.id, name: t.album.name } : null };
  }
  async function getAlbum(id) {
    const a = await api("/albums/" + id);
    let tracks = (a.tracks && a.tracks.items) || [], next = a.tracks && a.tracks.next;
    try { while (next) { const j = await api(next); tracks = tracks.concat(j.items || []); next = j.next; } } catch (e) {}
    const total = a.total_tracks || (a.tracks && a.tracks.total) || tracks.length;
    // Spotify sometimes returns only part of the track list with the album; fetch the full list directly if so.
    if (tracks.length < total) {
      for (const lim of [50, 20, 10, 5]) {
        try {
          let list = [], url = `/albums/${id}/tracks?limit=${lim}`;
          for (let i = 0; url && i < 20; i++) { const j = await api(url); list = list.concat(j.items || []); url = j.next; }
          if (list.length > tracks.length) tracks = list;
          break;
        } catch (e) { /* try a smaller page size */ }
      }
    }
    const smallImg = a.images && a.images.length ? a.images[a.images.length - 1].url : "";
    return {
      id: a.id, name: a.name, image: img(a.images), smallImg, year: (a.release_date || "").slice(0, 4), type: a.album_type, total,
      artists: (a.artists || []).map(x => ({ id: x.id, name: x.name })),
      tracks: tracks.filter(t => t && t.id).map(t => ({ id: t.id, title: t.name, artist: (t.artists || []).map(x => x.name).join(", ") }))
    };
  }

  async function getArtist(id) {
    const a = await api("/artists/" + id);
    // Spotify has tightened page sizes on this endpoint; try smaller requests until one is accepted.
    const base = `/artists/${id}/albums?include_groups=album,single`;
    let items = [], albumsError = null;
    for (const first of [base + "&limit=10", base + "&limit=5", base, `/artists/${id}/albums`]) {
      try {
        let next = first; items = [];
        for (let i = 0; next && i < 5; i++) { const j = await api(next); items = items.concat(j.items || []); next = j.next; }
        albumsError = null; break;
      } catch (e) { albumsError = e.message; if (items.length) break; }
    }
    const seen = new Set();
    const albums = items.filter(x => x && x.id).filter(x => { const k = (x.name || "").toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
      .map(x => ({ id: x.id, name: x.name, image: img(x.images), year: (x.release_date || "").slice(0, 4), type: x.album_type }));
    return { id: a.id, name: a.name, image: img(a.images), genres: a.genres || [], albums, albumsError: albums.length ? null : albumsError };
  }

  // Search allows at most 10 results per request since February 2026.
  async function searchTracks(title, artist) {
    const run = async q => ((await api("/search?type=track&limit=10&q=" + encodeURIComponent(q))).tracks || {}).items || [];
    let items = [];
    try { items = await run(`track:${title} artist:${artist}`); } catch (e) {}
    if (!items.length) items = await run(`${title} ${artist}`);
    return items.filter(t => t && t.id).map(t => ({ id: t.id, title: t.name, artist: (t.artists || []).map(a => a.name).join(", "), duration: t.duration_ms || 0, album: t.album ? t.album.name : "" }));
  }

  // Free search across the whole Spotify catalogue. Spotify returns at most 10 per page.
  async function searchAll(q, offset = 0) {
    const r = (await api(`/search?type=track&limit=10&offset=${offset}&q=` + encodeURIComponent(q))).tracks || {};
    return { total: r.total || 0, next: !!r.next, items: (r.items || []).filter(t => t && t.id).map(t => ({ id: t.id, title: t.name, artist: (t.artists || []).map(a => a.name).join(", "), album: t.album ? t.album.name : "", art: t.album && t.album.images && t.album.images.length ? t.album.images[t.album.images.length - 1].url : "", duration: t.duration_ms || 0 })) };
  }

  window.Spotify = {
    searchAll, searchTracks, moveInPlaylist, getTrack, getAlbum, getArtist, transfer, setVolume,
    recentlyPlayed, playerState, upNext, seek, next, previous,
    log: () => LOG.slice(), rawPlayer: () => api("/me/player"),
    trackArt: async id => { const t = await api("/tracks/" + id); return t.album && t.album.images && t.album.images.length ? t.album.images[t.album.images.length - 1].url : ""; },
    trackArtistIds: async id => ((await api("/tracks/" + id)).artists || []).map(a => a.id).filter(Boolean),
    artistGenres: async id => (await api("/artists/" + id)).genres || [],
    canLibrary, libContains, libSave, libRemove,
    setDeviceChooser: f => { chooser = f; },
    liveAdd, liveRemove, liveMove, liveReplace, playPlaylist,
    canPlay, play, playContext, playList, setShuffle, setRepeat, queue, pause, resume, nowPlaying, devices,
    login, handleRedirect, connected: () => !!store.get(), logout: () => store.clear(),
    me, myPlaylists, playlistTracks, createPlaylist, addTracks, configured: () => !!window.CONFIG.spotifyClientId
  };
})();
