/**
 * m3u-parser.js
 * Parses an M3U/M3U8 playlist string into a structured channel list.
 *
 * Supports:
 *  - #EXTM3U header with x-tvg-url attribute
 *  - #EXTINF lines with tvg-id, tvg-name, tvg-logo, group-title attributes
 *  - Fallback display names and generated IDs
 */

const M3UParser = (() => {
  /**
   * Extract value of a named attribute from an #EXTINF / #EXTM3U line.
   * Handles both quoted and unquoted values.
   * @param {string} line
   * @param {string} attr  e.g. 'tvg-id'
   * @returns {string}
   */
  function extractAttr(line, attr) {
    // Try quoted: attr="value" or attr='value'
    const quoted = new RegExp(attr + "\\s*=\\s*[\"']([^\"']*)[\"']", "i");
    const m = line.match(quoted);
    if (m) return m[1].trim();
    // Try unquoted: attr=value (stops at space or comma)
    const unquoted = new RegExp(attr + "\\s*=\\s*([^\\s,]+)", "i");
    const m2 = line.match(unquoted);
    if (m2) return m2[1].trim();
    return "";
  }

  /**
   * Auto-detect MIME type from a stream URL.
   * @param {string} url
   * @returns {string}
   */
  function detectMimeType(url) {
    const u = url.split("?")[0].toLowerCase();
    if (u.endsWith(".m3u8") || u.includes(".m3u8"))
      return "application/x-mpegURL";
    if (u.endsWith(".ts")) return "video/mp2t";
    if (u.endsWith(".mp4")) return "video/mp4";
    if (u.endsWith(".mkv")) return "video/x-matroska";
    if (u.endsWith(".avi")) return "video/x-msvideo";
    if (u.endsWith(".flv")) return "video/x-flv";
    if (u.endsWith(".webm")) return "video/webm";
    // Default to HLS for IPTV (most streams are HLS or MPEG-TS via HTTP)
    return "application/x-mpegURL";
  }

  /**
   * Parse raw M3U text.
   * @param {string} text
   * @returns {{ epgUrlHint: string, channels: Channel[] }}
   */
  function parse(text) {
    const channels = [];
    let epgUrlHint = "";

    const lines = text.replace(/\r/g, "").split("\n");
    let idx = 0;

    // Expect first line to be #EXTM3U
    if (lines[0] && lines[0].startsWith("#EXTM3U")) {
      epgUrlHint =
        extractAttr(lines[0], "x-tvg-url") || extractAttr(lines[0], "url-tvg");
      idx = 1;
    }

    let currentInf = null;

    for (; idx < lines.length; idx++) {
      const line = lines[idx].trim();
      if (!line) continue;

      if (line.startsWith("#EXTINF")) {
        // Parse the EXTINF line
        const tvgId = extractAttr(line, "tvg-id");
        const tvgName = extractAttr(line, "tvg-name");
        const tvgLogo = extractAttr(line, "tvg-logo");
        const group = extractAttr(line, "group-title") || "Uncategorized";

        // Display name is after the last comma on the #EXTINF line
        let displayName = tvgName;
        if (!displayName) {
          const commaIdx = line.lastIndexOf(",");
          displayName = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : "";
        }
        if (!displayName) displayName = "Unknown Channel";

        currentInf = { tvgId, name: displayName, logo: tvgLogo, group };
      } else if (!line.startsWith("#")) {
        // This is the stream URL
        if (currentInf) {
          const url = line;
          channels.push({
            id: currentInf.tvgId || Storage.uid(),
            name: currentInf.name,
            logo: currentInf.logo,
            group: currentInf.group,
            url,
            mimeType: detectMimeType(url),
          });
          currentInf = null;
        }
      }
      // Skip other directives (#EXTVLCOPT, #KODIPROP, etc.)
    }

    return { epgUrlHint, channels };
  }

  /**
   * Fetch and parse an M3U URL.
   * Returns { epgUrlHint, channels } or throws on network / CORS error.
   * @param {string} url
   * @param {string} [proxyUrl]  optional CORS proxy base URL
   * @returns {Promise<{ epgUrlHint: string, channels: Channel[] }>}
   */
  async function fetchAndParse(url, proxyUrl) {
    const fetchUrl = proxyUrl
      ? `${proxyUrl}?url=${encodeURIComponent(url)}`
      : url;
    const res = await fetch(fetchUrl, { mode: "cors" });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const text = await res.text();
    return parse(text);
  }

  return { parse, fetchAndParse, detectMimeType };
})();
