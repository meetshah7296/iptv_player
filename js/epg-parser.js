/**
 * epg-parser.js
 * Fetches and parses an XMLTV EPG file, providing now/next info per channel.
 *
 * XMLTV format reference: https://wiki.xmltv.org/index.php/XMLTVFormat
 *
 * Built map:  tvg-id (channel id) → sorted array of programmes:
 *   { start: Date, stop: Date, title: string, desc: string }
 */

const EPGParser = (() => {
  /** Map: channelId → Programme[] */
  let programMap = {};
  let loaded = false;
  let currentUrl = "";
  let savedProxyUrl = "";

  /**
   * Parse a XMLTV datetime string like "20260303143000 +0000" → Date
   * @param {string} str
   * @returns {Date|null}
   */
  function parseXmltvDate(str) {
    if (!str) return null;
    // Format: YYYYMMDDHHmmss TZOFFSET  or  YYYYMMDDHHmmss
    const m = str
      .trim()
      .match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?/);
    if (!m) return null;
    const [, yr, mo, dy, hr, mn, sc, tz] = m;
    const tzStr = tz ? `${tz.slice(0, 3)}:${tz.slice(3)}` : "+00:00";
    return new Date(`${yr}-${mo}-${dy}T${hr}:${mn}:${sc}${tzStr}`);
  }

  /**
   * Parse XMLTV XML text into the internal programMap.
   * @param {string} xmlText
   */
  function parseXml(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");

    const parseError = doc.querySelector("parsererror");
    if (parseError)
      throw new Error(
        "EPG XML parse error: " + parseError.textContent.slice(0, 120),
      );

    const programmes = doc.querySelectorAll("programme");
    const newMap = {};

    programmes.forEach((prog) => {
      const channelId = (prog.getAttribute("channel") || "").trim();
      if (!channelId) return;

      const start = parseXmltvDate(prog.getAttribute("start"));
      const stop = parseXmltvDate(prog.getAttribute("stop"));
      if (!start) return;

      const titleEl = prog.querySelector("title");
      const descEl = prog.querySelector("desc");
      const title = titleEl ? titleEl.textContent.trim() : "";
      const desc = descEl ? descEl.textContent.trim() : "";

      if (!newMap[channelId]) newMap[channelId] = [];
      newMap[channelId].push({ start, stop, title, desc });
    });

    // Sort each channel's programmes by start time
    for (const id of Object.keys(newMap)) {
      newMap[id].sort((a, b) => a.start - b.start);
    }

    programMap = newMap;
    loaded = true;
  }

  /**
   * Fetch and parse EPG from a URL.
   * @param {string} url
   * @param {string} [proxyUrl]  optional CORS proxy base URL
   * @returns {Promise<void>}
   */
  async function load(url, proxyUrl) {
    if (!url) return;
    if (url === currentUrl && loaded && proxyUrl === savedProxyUrl) return; // already loaded

    currentUrl = url;
    savedProxyUrl = proxyUrl || "";
    loaded = false;
    programMap = {};

    const fetchUrl = proxyUrl
      ? `${proxyUrl}?url=${encodeURIComponent(url)}`
      : url;

    const res = await fetch(fetchUrl, { mode: "cors" });
    if (!res.ok) throw new Error(`EPG fetch failed: HTTP ${res.status}`);

    const text = await res.text();
    parseXml(text);
  }

  /**
   * Get now-playing and next programme for a channel tvg-id.
   * Tries exact match first, then case-insensitive, then partial match.
   * @param {string} tvgId
   * @returns {{ now: Programme|null, next: Programme|null }}
   */
  function getNowAndNext(tvgId) {
    if (!loaded || !tvgId) return { now: null, next: null };

    // Try to find programmes for this channel
    let progs = programMap[tvgId];
    if (!progs) {
      // Case-insensitive + partial key scan
      const lower = tvgId.toLowerCase();
      const key =
        Object.keys(programMap).find((k) => k.toLowerCase() === lower) ||
        Object.keys(programMap).find(
          (k) =>
            k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase()),
        );
      progs = key ? programMap[key] : null;
    }
    if (!progs || !progs.length) return { now: null, next: null };

    const now = new Date();
    let nowProg = null;
    let nextProg = null;

    for (let i = 0; i < progs.length; i++) {
      const p = progs[i];
      if (p.start <= now && (p.stop == null || p.stop > now)) {
        nowProg = p;
        nextProg = progs[i + 1] || null;
        break;
      }
      // Future programme — could be "next" if nothing current found
      if (p.start > now && !nowProg) {
        nextProg = p;
        break;
      }
    }

    return { now: nowProg, next: nextProg };
  }

  /** Format a Date to HH:MM */
  function formatTime(date) {
    if (!date) return "";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  /** Reset (used when switching playlists with different EPG URLs) */
  function reset() {
    programMap = {};
    loaded = false;
    currentUrl = "";
    savedProxyUrl = "";
  }

  return {
    load,
    getNowAndNext,
    formatTime,
    reset,
    get isLoaded() {
      return loaded;
    },
  };
})();
