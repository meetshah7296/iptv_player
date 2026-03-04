/**
 * Cloudflare Worker — CORS Proxy for IPTV Player
 *
 * Deploy this at: https://dash.cloudflare.com → Workers & Pages → Create Worker
 *
 * Usage (from the browser):
 *   fetch("https://your-worker.your-subdomain.workers.dev/?url=https://example.com/playlist.m3u")
 *
 * Security: restrict to your own domain by setting ALLOWED_ORIGIN below.
 * Set to "*" to allow any origin (fine for personal use).
 */

const ALLOWED_ORIGIN = "*"; // or e.g. 'https://your-iptv-site.netlify.app'

export default {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return corsResponse(null, 204);
    }

    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get("url");

    if (!targetUrl) {
      return corsResponse(
        JSON.stringify({ error: "Missing ?url= parameter" }),
        400,
        "application/json",
      );
    }

    // Only allow http / https targets
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return corsResponse(
        JSON.stringify({ error: "Invalid URL" }),
        400,
        "application/json",
      );
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return corsResponse(
        JSON.stringify({ error: "Only http/https URLs are allowed" }),
        403,
        "application/json",
      );
    }

    // Forward the request
    let upstream;
    try {
      upstream = await fetch(targetUrl, {
        method: request.method === "GET" ? "GET" : "GET", // always GET for M3U/EPG
        headers: {
          "User-Agent": "Mozilla/5.0 IPTV-Proxy/1.0",
          Accept: "*/*",
        },
        redirect: "follow",
      });
    } catch (err) {
      return corsResponse(
        JSON.stringify({ error: "Upstream fetch failed", detail: err.message }),
        502,
        "application/json",
      );
    }

    // Stream the response body back, adding CORS headers
    const contentType =
      upstream.headers.get("content-type") || "application/octet-stream";
    const responseHeaders = {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Cache-Control": "no-store",
    };

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  },
};

/** Build a response with CORS headers. */
function corsResponse(body, status = 200, contentType = "text/plain") {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}
