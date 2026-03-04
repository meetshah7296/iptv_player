/**
 * app.js
 * Main application orchestrator for IPTV Player.
 *
 * Handles:
 *  - Playlist CRUD (add, delete, activate)
 *  - Channel list rendering (grouped by category, with logos)
 *  - Live search / filter
 *  - EPG lazy-loading per playlist
 *  - Modal open/close/validation
 *  - Persisting and restoring last active playlist
 */

(function () {
  "use strict";

  /* ================================================================
     DOM REFERENCES
  ================================================================ */
  const playlistListEl = document.getElementById("playlist-list");
  const channelListEl = document.getElementById("channel-list");
  const emptyChannelsEl = document.getElementById("empty-channels");
  const channelCountEl = document.getElementById("channel-count");
  const searchInput = document.getElementById("input-search");

  const modalOverlay = document.getElementById("modal-overlay");
  const modalTitle = document.getElementById("modal-title");
  const inputName = document.getElementById("input-playlist-name");
  const inputM3uUrl = document.getElementById("input-m3u-url");
  const inputEpgUrl = document.getElementById("input-epg-url");
  const modalError = document.getElementById("modal-error");
  const btnModalCancel = document.getElementById("btn-modal-cancel");
  const btnModalSave = document.getElementById("btn-modal-save");
  const btnModalSaveText = document.getElementById("btn-modal-save-text");
  const btnModalSpinner = document.getElementById("btn-modal-spinner");
  const btnAddPlaylist = document.getElementById("btn-add-playlist");

  // Proxy toggle
  const btnProxyToggle = document.getElementById("btn-proxy-toggle");
  const proxyToggleLabel = document.getElementById("proxy-toggle-label");

  // Channel panel toggle
  const btnToggleChannels = document.getElementById("btn-toggle-channels");
  const appLayout = document.querySelector(".app-layout");

  /* ================================================================
     STATE
  ================================================================ */
  let activePlaylistId = null; // currently viewed playlist
  let activeChannelUrl = null; // currently playing channel URL
  let allChannels = []; // channels of active playlist (unfiltered)
  let epgLoadingFor = null; // playlist id for which EPG is being loaded
  let defaultPlaylistChannels = null; // in-memory cache (not persisted to localStorage)

  /* ================================================================
     INIT
  ================================================================ */
  document.addEventListener("DOMContentLoaded", () => {
    Player.init();

    // Wire up all event listeners first
    btnAddPlaylist.addEventListener("click", openAddModal);
    btnModalCancel.addEventListener("click", closeModal);
    btnModalSave.addEventListener("click", handleModalSave);
    modalOverlay.addEventListener("click", (e) => {
      if (e.target === modalOverlay) closeModal();
    });
    searchInput.addEventListener("input", handleSearch);
    btnProxyToggle.addEventListener("click", handleProxyToggle);
    updateProxyButton();
    btnToggleChannels.addEventListener("click", handleToggleChannels);
    // Restore previous collapsed state
    if (localStorage.getItem("iptv_channels_hidden") === "true") {
      appLayout.classList.add("channels-hidden");
      btnToggleChannels.title = "Show channel list";
    }
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modalOverlay.classList.contains("hidden"))
        closeModal();
    });

    // Always ensure the built-in "My IPTV" playlist exists
    ensureDefaultPlaylist();
    // Set up mobile bottom tab navigation
    setupMobileTabs();
  });

  /* ================================================================
     MOBILE TAB NAVIGATION
  ================================================================ */
  const MOBILE_BREAKPOINT = 600;

  function isMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  }

  function setupMobileTabs() {
    const tabs = document.querySelectorAll(".mobile-tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => setMobileTab(tab.dataset.tab));
    });
    // Initial state: show playlists panel
    if (isMobile()) setMobileTab("playlists");
    // Re-apply on resize / orientation change
    const onViewportChange = () => {
      if (!isMobile()) {
        document
          .querySelectorAll(".sidebar, .channel-panel, .player-panel")
          .forEach((el) => el.classList.remove("mobile-active"));
      } else {
        // Re-trigger resize so Video.js repaints after rotation
        window.dispatchEvent(new Event("resize"));
        setTimeout(() => window.dispatchEvent(new Event("resize")), 300);
      }
    };
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("orientationchange", () => {
      setTimeout(onViewportChange, 200);
    });
  }

  function setMobileTab(name) {
    if (!isMobile()) return;
    // Update tab button active state
    document.querySelectorAll(".mobile-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === name);
    });
    // Show correct panel
    const map = {
      playlists: document.getElementById("sidebar"),
      channels: document.getElementById("channel-panel"),
      player: document.getElementById("player-panel"),
    };
    Object.values(map).forEach(
      (el) => el && el.classList.remove("mobile-active"),
    );
    if (map[name]) map[name].classList.add("mobile-active");
    // Trigger resize so Video.js fills the new space when switching to player
    if (name === "player") {
      window.dispatchEvent(new Event("resize"));
      setTimeout(() => window.dispatchEvent(new Event("resize")), 150);
      setTimeout(() => window.dispatchEvent(new Event("resize")), 400);
    }
  }

  /* ================================================================
     DEFAULT PLAYLIST — always present
  ================================================================ */
  const DEFAULT_PLAYLIST_ID = "builtin-my-iptv";
  const DEFAULT_PLAYLIST = {
    id: DEFAULT_PLAYLIST_ID,
    name: "My IPTV",
    url: "https://iptv-org.github.io/iptv/index.m3u",
    epgUrl: "",
  };

  /**
   * Called on every page load.
   * Ensures the built-in "My IPTV" entry exists in localStorage (metadata only,
   * no channels stored — channels are fetched fresh and kept in memory to avoid
   * exceeding the ~5 MB localStorage quota with large playlists).
   */
  function ensureDefaultPlaylist() {
    const existing = Storage.getPlaylist(DEFAULT_PLAYLIST_ID);

    if (!existing) {
      // Save metadata entry so the sidebar shows it immediately
      Storage.addPlaylistWithId({
        id: DEFAULT_PLAYLIST_ID,
        name: DEFAULT_PLAYLIST.name,
        url: DEFAULT_PLAYLIST.url,
        epgUrl: DEFAULT_PLAYLIST.epgUrl,
        channels: [], // channels are never persisted — kept in memory only
      });
    }

    renderPlaylistNav();

    const lastId = Storage.loadLastActive();
    const targetId =
      lastId && Storage.getPlaylist(lastId) ? lastId : DEFAULT_PLAYLIST_ID;
    activatePlaylist(targetId, false);
  }

  let defaultPlaylistFetching = false; // prevent duplicate in-flight fetches

  /** Fetch the default playlist's channels and cache them in memory. */
  async function fetchDefaultPlaylistChannels() {
    if (defaultPlaylistFetching) return; // already in flight
    defaultPlaylistFetching = true;

    // Show loading indicator
    channelListEl.innerHTML = "";
    const hint = document.createElement("div");
    hint.className = "empty-state";
    hint.innerHTML = "<p>\uD83D\uDCE1</p><p>Loading My IPTV playlist\u2026</p>";
    channelListEl.appendChild(hint);

    let channels = null;

    // Try 1: with proxy (if enabled)
    const proxyUrl = Storage.loadProxyUrl();
    if (proxyUrl) {
      try {
        const result = await M3UParser.fetchAndParse(
          DEFAULT_PLAYLIST.url,
          proxyUrl,
        );
        channels = result.channels;
      } catch (e) {
        console.warn("Default playlist fetch via proxy failed:", e.message);
      }
    }

    // Try 2: direct (no proxy) fallback
    if (!channels) {
      try {
        const result = await M3UParser.fetchAndParse(DEFAULT_PLAYLIST.url, "");
        channels = result.channels;
      } catch (e) {
        console.warn("Default playlist direct fetch failed:", e.message);
      }
    }

    defaultPlaylistFetching = false;

    if (channels && channels.length) {
      defaultPlaylistChannels = channels;
      renderPlaylistNav(); // update sidebar count

      if (activePlaylistId === DEFAULT_PLAYLIST_ID) {
        allChannels = channels;
        searchInput.value = "";
        renderChannelList(allChannels);
      }
    } else {
      // Both attempts failed — show a retry button
      channelListEl.innerHTML = "";
      const errDiv = document.createElement("div");
      errDiv.className = "empty-state";
      errDiv.innerHTML =
        "<p>\u26A0\uFE0F</p>" +
        "<p>Could not load My IPTV channels.<br>Check your connection or proxy settings.</p>" +
        "<button class='btn btn-primary btn-sm' style='margin-top:12px' id='btn-retry-default'>Retry</button>";
      channelListEl.appendChild(errDiv);
      document
        .getElementById("btn-retry-default")
        .addEventListener("click", fetchDefaultPlaylistChannels);
    }
  }

  /* ================================================================
     PLAYLIST NAV
  ================================================================ */

  /** Re-render the left sidebar playlist list. */
  function renderPlaylistNav() {
    playlistListEl.innerHTML = "";
    const playlists = Storage.loadPlaylists();

    if (!playlists.length) {
      const hint = document.createElement("div");
      hint.className = "playlist-empty-hint";
      hint.textContent = 'No playlists yet. Click "+ Add" to get started.';
      playlistListEl.appendChild(hint);
      return;
    }

    playlists.forEach((pl) => {
      const item = document.createElement("div");
      item.className =
        "playlist-item" + (pl.id === activePlaylistId ? " active" : "");
      item.dataset.id = pl.id;

      const icon = document.createElement("span");
      icon.className = "playlist-item-icon";
      icon.textContent = "📺";

      const name = document.createElement("span");
      name.className = "playlist-item-name";
      name.textContent = pl.name;
      name.title = pl.name;

      const count = document.createElement("span");
      count.className = "playlist-item-count";
      count.textContent =
        pl.id === DEFAULT_PLAYLIST_ID && defaultPlaylistChannels !== null
          ? defaultPlaylistChannels.length
          : pl.channels.length;

      const del = document.createElement("button");
      del.className = "playlist-item-delete";
      del.textContent = "✕";
      del.title = "Delete playlist";
      // Hide delete for the built-in default playlist
      if (pl.id === DEFAULT_PLAYLIST_ID) {
        del.style.display = "none";
      }
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        handleDeletePlaylist(pl.id);
      });

      item.appendChild(icon);
      item.appendChild(name);
      item.appendChild(count);
      item.appendChild(del);

      item.addEventListener("click", () => activatePlaylist(pl.id, true));
      playlistListEl.appendChild(item);
    });
  }

  /* ================================================================
     ACTIVATE PLAYLIST
  ================================================================ */

  /**
   * Load and display a playlist's channels.
   * @param {string} id
   * @param {boolean} persist  whether to save as last-active
   */
  function activatePlaylist(id, persist) {
    const pl = Storage.getPlaylist(id);
    if (!pl) return;

    activePlaylistId = id;
    if (persist) Storage.saveLastActive(id);
    // On mobile, clicking a playlist auto-navigates to the channels tab
    if (persist) setMobileTab("channels");

    renderPlaylistNav(); // refresh active state

    if (id === DEFAULT_PLAYLIST_ID) {
      if (defaultPlaylistChannels !== null) {
        // Already fetched this session — use memory cache
        allChannels = defaultPlaylistChannels;
        searchInput.value = "";
        renderChannelList(allChannels);
      } else {
        // First access — fetch now (async, shows its own loading UI)
        allChannels = [];
        fetchDefaultPlaylistChannels();
      }
    } else {
      allChannels = pl.channels;
      searchInput.value = "";
      renderChannelList(allChannels);
    }

    // Lazy-load EPG
    if (pl.epgUrl && pl.id !== epgLoadingFor) {
      epgLoadingFor = pl.id;
      EPGParser.reset();
      EPGParser.load(pl.epgUrl, Storage.loadProxyUrl())
        .then(() => {
          console.log(`EPG loaded for playlist "${pl.name}"`);
          // Refresh rows with EPG tagline, and update now-playing if relevant
          renderChannelList(getFilteredChannels());
          Player.refreshEpg(null);
        })
        .catch((err) => {
          console.warn("EPG load failed:", err.message);
          // Non-fatal — just show no EPG data
        });
    } else if (!pl.epgUrl) {
      EPGParser.reset();
    }
  }

  /* ================================================================
     DELETE PLAYLIST
  ================================================================ */
  function handleDeletePlaylist(id) {
    if (!confirm("Delete this playlist? This cannot be undone.")) return;
    Storage.deletePlaylist(id);

    if (activePlaylistId === id) {
      activePlaylistId = null;
      activeChannelUrl = null;
      allChannels = [];
      renderChannelList([]);
      EPGParser.reset();
    }

    renderPlaylistNav();

    // If there are remaining playlists, activate the first one
    const remaining = Storage.loadPlaylists();
    if (remaining.length) activatePlaylist(remaining[0].id, true);
  }

  /* ================================================================
     CHANNEL LIST RENDERING
  ================================================================ */

  /**
   * Render channel list grouped by group-title.
   * @param {Channel[]} channels
   */
  function renderChannelList(channels) {
    channelListEl.innerHTML = "";

    if (!channels.length) {
      channelListEl.appendChild(emptyChannelsEl);
      emptyChannelsEl.querySelector("p:last-child").textContent =
        allChannels.length
          ? "No channels match your search."
          : "Add a playlist to get started.";
      channelCountEl.textContent = "";
      return;
    }

    // Update channel count
    channelCountEl.textContent = `${channels.length} channel${channels.length !== 1 ? "s" : ""}`;

    // Group channels
    const groups = {};
    channels.forEach((ch) => {
      const g = ch.group || "Uncategorized";
      if (!groups[g]) groups[g] = [];
      groups[g].push(ch);
    });

    const groupNames = Object.keys(groups).sort((a, b) => {
      if (a === "Uncategorized") return 1;
      if (b === "Uncategorized") return -1;
      return a.localeCompare(b);
    });

    groupNames.forEach((groupName) => {
      const groupChannels = groups[groupName];
      const details = document.createElement("details");
      details.className = "channel-group";
      details.open = true; // start expanded

      const summary = document.createElement("summary");
      const groupCount = document.createElement("span");
      groupCount.className = "group-count";
      groupCount.textContent = groupChannels.length;
      summary.textContent = groupName;
      summary.appendChild(groupCount);
      details.appendChild(summary);

      groupChannels.forEach((ch) => {
        details.appendChild(buildChannelRow(ch));
      });

      channelListEl.appendChild(details);
    });
  }

  /**
   * Build a single channel row DOM element.
   * @param {object} ch
   * @returns {HTMLElement}
   */
  function buildChannelRow(ch) {
    const row = document.createElement("div");
    row.className =
      "channel-row" + (ch.url === activeChannelUrl ? " active" : "");
    row.dataset.url = ch.url;

    // Logo or placeholder
    if (ch.logo) {
      const img = document.createElement("img");
      img.className = "channel-logo";
      img.src = ch.logo;
      img.alt = ch.name;
      img.loading = "lazy";
      img.onerror = () => img.replaceWith(logoPlaceholder());
      row.appendChild(img);
    } else {
      row.appendChild(logoPlaceholder());
    }

    // Info
    const info = document.createElement("div");
    info.className = "channel-row-info";

    const nameEl = document.createElement("div");
    nameEl.className = "channel-row-name";
    nameEl.textContent = ch.name;
    info.appendChild(nameEl);

    // EPG tagline
    if (EPGParser.isLoaded) {
      const { now } = EPGParser.getNowAndNext(ch.id);
      if (now) {
        const epgEl = document.createElement("div");
        epgEl.className = "channel-row-epg";
        epgEl.textContent = now.title;
        info.appendChild(epgEl);
      }
    }

    row.appendChild(info);

    row.addEventListener("click", () => handleChannelClick(ch));
    return row;
  }

  function logoPlaceholder() {
    const div = document.createElement("div");
    div.className = "channel-logo-placeholder";
    div.textContent = "📺";
    return div;
  }

  /* ================================================================
     CHANNEL SELECTION / PLAY
  ================================================================ */
  function handleChannelClick(channel) {
    activeChannelUrl = channel.url;
    Player.play(channel);
    // On mobile, clicking a channel auto-navigates to the player tab
    setMobileTab("player");

    // Re-render to show active highlight without full re-render
    document.querySelectorAll(".channel-row").forEach((row) => {
      if (row.dataset.url === channel.url) {
        row.classList.add("active");
      } else {
        row.classList.remove("active");
      }
    });
  }

  /* ================================================================
     SEARCH
  ================================================================ */
  function handleSearch() {
    renderChannelList(getFilteredChannels());
  }

  function getFilteredChannels() {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) return allChannels;
    return allChannels.filter(
      (ch) =>
        ch.name.toLowerCase().includes(q) ||
        (ch.group && ch.group.toLowerCase().includes(q)),
    );
  }

  /* ================================================================
     MODAL
  ================================================================ */
  function openAddModal() {
    modalTitle.textContent = "Add Playlist";
    btnModalSaveText.textContent = "Load & Save";
    inputName.value = "";
    inputM3uUrl.value = "";
    inputEpgUrl.value = "";
    hideModalError();
    modalOverlay.classList.remove("hidden");
    setTimeout(() => inputName.focus(), 50);
  }

  function closeModal() {
    modalOverlay.classList.add("hidden");
    setModalLoading(false);
  }

  function showModalError(msg) {
    modalError.textContent = msg;
    modalError.classList.remove("hidden");
  }

  function hideModalError() {
    modalError.textContent = "";
    modalError.classList.add("hidden");
  }

  function setModalLoading(loading) {
    btnModalSave.disabled = loading;
    btnModalCancel.disabled = loading;
    btnModalSpinner.classList.toggle("hidden", !loading);
    btnModalSaveText.textContent = loading ? "Loading…" : "Load & Save";
  }

  async function handleModalSave() {
    hideModalError();

    const name = inputName.value.trim();
    const m3uUrl = inputM3uUrl.value.trim();
    const epgUrl = inputEpgUrl.value.trim();

    // Validation
    if (!name) {
      showModalError("Please enter a playlist name.");
      inputName.focus();
      return;
    }
    if (!m3uUrl) {
      showModalError("Please enter an M3U URL.");
      inputM3uUrl.focus();
      return;
    }
    if (!isValidUrl(m3uUrl)) {
      showModalError("The M3U URL does not appear to be valid.");
      inputM3uUrl.focus();
      return;
    }
    if (epgUrl && !isValidUrl(epgUrl)) {
      showModalError("The EPG URL does not appear to be valid.");
      inputEpgUrl.focus();
      return;
    }

    setModalLoading(true);

    try {
      const { epgUrlHint, channels } = await M3UParser.fetchAndParse(
        m3uUrl,
        Storage.loadProxyUrl(),
      );

      if (!channels.length) {
        throw new Error("No channels found in this M3U. Please check the URL.");
      }

      const playlist = Storage.addPlaylist({
        name,
        url: m3uUrl,
        epgUrl,
        channels,
        epgUrlHint,
      });
      closeModal();
      renderPlaylistNav();
      activatePlaylist(playlist.id, true);
    } catch (err) {
      setModalLoading(false);
      const msg = err.message || String(err);
      if (
        msg.includes("CORS") ||
        msg.includes("Failed to fetch") ||
        msg.includes("NetworkError") ||
        msg.includes("blocked")
      ) {
        Player.showCorsWarning();
        showModalError(
          "Could not fetch the M3U URL — possible CORS restriction. See the warning in the player area.",
        );
      } else {
        showModalError(msg);
      }
    }
  }

  function isValidUrl(str) {
    try {
      const u = new URL(str);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }

  /* ================================================================
     PROXY TOGGLE
  ================================================================ */
  function handleToggleChannels() {
    const hidden = appLayout.classList.toggle("channels-hidden");
    localStorage.setItem("iptv_channels_hidden", hidden);
    btnToggleChannels.title = hidden
      ? "Show channel list"
      : "Hide channel list";
    // Video.js only responds to window resize — trigger it so the player
    // recalculates and fills the newly available space after the CSS transition.
    window.dispatchEvent(new Event("resize"));
    setTimeout(() => window.dispatchEvent(new Event("resize")), 220);
  }

  function handleProxyToggle() {
    const nowEnabled = !Storage.isProxyEnabled();
    Storage.setProxyEnabled(nowEnabled);
    updateProxyButton();
    // Force EPG to reload with new proxy setting on next playlist activation
    epgLoadingFor = null;
  }

  function updateProxyButton() {
    const enabled = Storage.isProxyEnabled();
    proxyToggleLabel.textContent = enabled ? "Proxy ON" : "Proxy OFF";
    btnProxyToggle.classList.toggle("proxy-on", enabled);
    btnProxyToggle.classList.toggle("proxy-off", !enabled);
    btnProxyToggle.title = enabled
      ? `CORS proxy active \u2014 click to disable`
      : "CORS proxy disabled \u2014 click to enable";
  }
})();
