/**
 * storage.js
 * Thin wrapper around localStorage for persisting playlists.
 *
 * Playlist schema:
 * {
 *   id:       string  (uuid-like)
 *   name:     string
 *   url:      string  (M3U URL)
 *   epgUrl:   string  (XMLTV URL, may be empty)
 *   channels: Channel[]
 *   addedAt:  number  (Date.now())
 * }
 *
 * Channel schema:
 * {
 *   id:     string  (tvg-id or generated)
 *   name:   string
 *   logo:   string
 *   group:  string
 *   url:    string
 * }
 */

const Storage = (() => {
  const PLAYLISTS_KEY = "iptv_playlists";
  const LAST_ACTIVE_KEY = "iptv_last_active";
  const PROXY_KEY = "iptv_proxy_url";
  const PROXY_ENABLED_KEY = "iptv_proxy_enabled";

  // Default built-in proxy — change this if you redeploy the Worker
  const DEFAULT_PROXY_URL = "https://iptv-proxy.meetshah7296.workers.dev";

  /** Generate a simple unique ID */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /** Load all playlists from localStorage. Returns an array. */
  function loadPlaylists() {
    try {
      const raw = localStorage.getItem(PLAYLISTS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  /** Save the full playlists array to localStorage. */
  function savePlaylists(playlists) {
    try {
      localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
    } catch (e) {
      console.error("Storage: failed to save playlists", e);
    }
  }

  /** Add a new playlist object (channels must already be parsed). Returns the new playlist. */
  function addPlaylist({ name, url, epgUrl, channels, epgUrlHint }) {
    const playlists = loadPlaylists();
    const playlist = {
      id: uid(),
      name: name.trim(),
      url,
      epgUrl: epgUrl || epgUrlHint || "",
      channels,
      addedAt: Date.now(),
    };
    playlists.push(playlist);
    savePlaylists(playlists);
    return playlist;
  }

  /** Add a playlist with a specific fixed id (used for built-in playlists). */
  function addPlaylistWithId({ id, name, url, epgUrl, channels }) {
    const playlists = loadPlaylists().filter((p) => p.id !== id);
    const playlist = {
      id,
      name: name.trim(),
      url,
      epgUrl: epgUrl || "",
      channels,
      addedAt: Date.now(),
    };
    // Prepend so it always appears first in the sidebar
    playlists.unshift(playlist);
    savePlaylists(playlists);
    return playlist;
  }

  /** Remove a playlist by id. */
  function deletePlaylist(id) {
    const playlists = loadPlaylists().filter((p) => p.id !== id);
    savePlaylists(playlists);
    if (loadLastActive() === id) clearLastActive();
  }

  /** Get a single playlist by id. */
  function getPlaylist(id) {
    return loadPlaylists().find((p) => p.id === id) || null;
  }

  /** Save the id of the last active (opened) playlist. */
  function saveLastActive(id) {
    localStorage.setItem(LAST_ACTIVE_KEY, id);
  }

  /** Load the id of the last active playlist. */
  function loadLastActive() {
    return localStorage.getItem(LAST_ACTIVE_KEY) || null;
  }

  /** Clear the last active playlist record. */
  function clearLastActive() {
    localStorage.removeItem(LAST_ACTIVE_KEY);
  }

  /** Save a custom CORS proxy base URL. Pass empty string to revert to default. */
  function saveProxyUrl(url) {
    if (url && url.trim()) {
      localStorage.setItem(PROXY_KEY, url.trim().replace(/\/$/, ""));
    } else {
      localStorage.removeItem(PROXY_KEY);
    }
  }

  /** Load the active proxy URL. Returns empty string when proxy is disabled. */
  function loadProxyUrl() {
    if (!isProxyEnabled()) return "";
    return localStorage.getItem(PROXY_KEY) || DEFAULT_PROXY_URL;
  }

  /** Returns true if proxy is enabled (default: true). */
  function isProxyEnabled() {
    const val = localStorage.getItem(PROXY_ENABLED_KEY);
    return val === null ? true : val === "true"; // default ON
  }

  /** Enable or disable the proxy. */
  function setProxyEnabled(enabled) {
    localStorage.setItem(PROXY_ENABLED_KEY, String(enabled));
  }

  /** Get the default built-in proxy URL (for display purposes). */
  function getDefaultProxyUrl() {
    return DEFAULT_PROXY_URL;
  }

  return {
    uid,
    loadPlaylists,
    savePlaylists,
    addPlaylist,
    addPlaylistWithId,
    deletePlaylist,
    getPlaylist,
    saveLastActive,
    loadLastActive,
    clearLastActive,
    saveProxyUrl,
    loadProxyUrl,
    isProxyEnabled,
    setProxyEnabled,
    getDefaultProxyUrl,
  };
})();
