/**
 * player.js
 * Video.js wrapper for the IPTV player.
 *
 * Responsibilities:
 *  - Initialize a Video.js player instance once
 *  - Play a channel (accepts a Channel object from the M3U parser)
 *  - Update the Now Playing bar and EPG strip
 *  - Handle source type auto-detection
 */

const Player = (() => {
  let vjsPlayer = null;
  let currentChannel = null;

  // DOM refs (set during init)
  let npLogo, npChannelName, npProgram;
  let epgStrip, epgStripInner, epgPlaceholder;
  let corsWarning;

  /**
   * Initialize the Video.js player and cache DOM references.
   * Must be called after DOMContentLoaded.
   */
  // iOS Safari has native HLS — let it handle streams natively.
  // Forcing overrideNative=true on iOS causes stalling and random stops.
  const isIOS = /iP(hone|ad|od)/i.test(navigator.userAgent);

  function init() {
    vjsPlayer = videojs("iptv-video", {
      controls: true,
      autoplay: false,
      preload: "auto",
      fluid: false,
      fill: true,
      liveui: true,
      html5: {
        vhs: {
          overrideNative: !isIOS,
          enableLowInitialPlaylist: true,
          smoothQualityChange: true,
          // Larger buffer on mobile to survive brief network hiccups
          bufferBasedABR: true,
          maxBufferLength: isIOS ? 60 : 30,
        },
        nativeAudioTracks: isIOS,
        nativeVideoTracks: isIOS,
      },
      errorDisplay: true,
    });

    // On stall/error, attempt a single automatic recovery
    vjsPlayer.on("error", () => {
      const err = vjsPlayer.error();
      console.error("Video.js error:", err);
    });

    vjsPlayer.on("stalled", () => {
      // Short pause then resume to kick iOS out of a stall
      if (isIOS && !vjsPlayer.paused()) {
        setTimeout(() => {
          if (!vjsPlayer.paused()) vjsPlayer.play();
        }, 1500);
      }
    });

    // Cache DOM refs
    npLogo = document.getElementById("np-logo");
    npChannelName = document.getElementById("np-channel-name");
    npProgram = document.getElementById("np-program");
    epgStrip = document.getElementById("epg-strip");
    epgStripInner = document.getElementById("epg-strip-inner");
    epgPlaceholder = document.getElementById("epg-placeholder");
    corsWarning = document.getElementById("cors-warning");
    // Hide strip by default until real EPG data arrives
    epgStrip.classList.add("hidden");
  }

  /**
   * Play a channel.
   * @param {object} channel  - { id, name, logo, group, url, mimeType }
   */
  function play(channel) {
    if (!vjsPlayer) {
      console.warn("Player not initialised");
      return;
    }

    currentChannel = channel;
    hideCorsWarning();

    vjsPlayer.src({
      src: channel.url,
      type: channel.mimeType || "application/x-mpegURL",
    });

    vjsPlayer.play().catch((err) => {
      // Autoplay might be blocked — user will click the play button
      console.warn("Autoplay prevented:", err.message);
    });

    updateNowPlaying(channel);
  }

  /**
   * Update the Now Playing bar with channel info + optional EPG.
   * @param {object} channel
   */
  function updateNowPlaying(channel) {
    // Channel name
    npChannelName.textContent = channel.name;

    // Logo
    if (channel.logo) {
      npLogo.src = channel.logo;
      npLogo.classList.remove("hidden");
      npLogo.onerror = () => npLogo.classList.add("hidden");
    } else {
      npLogo.src = "";
      npLogo.classList.add("hidden");
    }

    // EPG info
    refreshEpg(channel);
  }

  /**
   * Refresh EPG strip for the current channel.
   * Can be called externally when EPG finishes loading.
   */
  function refreshEpg(channel) {
    const ch = channel || currentChannel;
    if (!ch) return;

    const { now, next } = EPGParser.getNowAndNext(ch.id);

    if (!EPGParser.isLoaded) {
      showEpgPlaceholder("EPG not loaded");
      npProgram.textContent = "";
      return;
    }

    if (!now && !next) {
      showEpgPlaceholder("No EPG data for this channel");
      npProgram.textContent = "";
      return;
    }

    epgStripInner.innerHTML = "";
    if (epgStrip) epgStrip.classList.remove("hidden");

    if (now) {
      epgStripInner.appendChild(buildEpgCard("NOW", now));
      npProgram.textContent = now.title;
    } else {
      npProgram.textContent = "";
    }

    if (next) {
      epgStripInner.appendChild(buildEpgCard("NEXT", next));
    }
  }

  /**
   * Build an EPG card DOM element.
   * @param {'NOW'|'NEXT'} label
   * @param {object} prog  - { start, stop, title, desc }
   * @returns {HTMLElement}
   */
  function buildEpgCard(label, prog) {
    const card = document.createElement("div");
    card.className = "epg-card " + (label === "NOW" ? "now" : "next");

    const lbl = document.createElement("span");
    lbl.className = "epg-card-label";
    lbl.textContent = label;

    const title = document.createElement("span");
    title.className = "epg-card-title";
    title.textContent = prog.title || "—";

    const time = document.createElement("span");
    time.className = "epg-card-time";
    const startStr = EPGParser.formatTime(prog.start);
    const stopStr = EPGParser.formatTime(prog.stop);
    time.textContent = stopStr ? `${startStr} – ${stopStr}` : startStr;

    card.appendChild(lbl);
    card.appendChild(title);
    card.appendChild(time);
    return card;
  }

  function showEpgPlaceholder(msg) {
    // Hide the strip entirely — no point showing "EPG not loaded" to the user
    if (epgStrip) epgStrip.classList.add("hidden");
    epgStripInner.innerHTML = "";
    if (epgPlaceholder) {
      epgPlaceholder.textContent = msg;
      epgStripInner.appendChild(epgPlaceholder);
    }
  }

  function showCorsWarning() {
    if (corsWarning) corsWarning.classList.remove("hidden");
  }

  function hideCorsWarning() {
    if (corsWarning) corsWarning.classList.add("hidden");
  }

  return {
    init,
    play,
    refreshEpg,
    showCorsWarning,
    hideCorsWarning,
    get currentChannel() {
      return currentChannel;
    },
  };
})();
