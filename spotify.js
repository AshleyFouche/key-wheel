// Spotify sign-in (Authorization Code with PKCE, no server) and the few Web API calls the app needs.
(function () {
  const AUTH = "https://accounts.spotify.com/authorize";
  const TOKEN = "https://accounts.spotify.com/api/token";
  const API = "https://api.spotify.com/v1";
  const SCOPES = "playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public";
  const KEY = "kw.spotify";

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
    try { sessionStorage.setItem("kw.pkce", verifier); localStorage.setItem("kw.pkce", verifier); } catch (e) {}
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
    try { verifier = sessionStorage.getItem("kw.pkce") || localStorage.getItem("kw.pkce"); } catch (e) {}
    const st = u.searchParams.get("state") || "";
    if (!verifier && st.includes(".")) verifier = st.split(".").slice(1).join(".");
    if (!verifier) return { error: "missing_verifier" };
    const r = await fetch(TOKEN, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: window.CONFIG.spotifyClientId, grant_type: "authorization_code", code, redirect_uri: window.CONFIG.redirectUri, code_verifier: verifier })
    });
    try { sessionStorage.removeItem("kw.pkce"); localStorage.removeItem("kw.pkce"); } catch (e) {}
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
    if (r.status === 401) { store.clear(); const e = new Error("Spotify sign-in expired"); e.code = "auth"; throw e; }
    const text = await r.text();
    const j = text ? JSON.parse(text) : {};
    if (!r.ok) { const e = new Error((j.error && j.error.message) || ("Spotify error " + r.status)); e.status = r.status; throw e; }
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
        out.push({ id: t.id, title: t.name, artist: (t.artists || []).map(a => a.name).join(", "), uri: t.uri });
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

  async function createPlaylist(name, description, trackIds) {
    const pl = await api("/me/playlists", { method: "POST", body: JSON.stringify({ name, description, public: false }) });
    await addTracks(pl.id, trackIds);
    return pl;
  }

  window.Spotify = {
    login, handleRedirect, connected: () => !!store.get(), logout: () => store.clear(),
    me, myPlaylists, playlistTracks, createPlaylist, addTracks, configured: () => !!window.CONFIG.spotifyClientId
  };
})();
