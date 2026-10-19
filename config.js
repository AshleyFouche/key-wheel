// Your Spotify developer app's Client ID (not a secret). Set by Claude when publishing.
window.CONFIG = {
  spotifyClientId: "",
  // Must match the Redirect URI saved in the Spotify developer dashboard exactly.
  redirectUri: location.origin + location.pathname.replace(/index\.html$/, "")
};
