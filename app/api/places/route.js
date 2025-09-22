// app/api/places/route.js
// Lightweight place autocomplete via OpenStreetMap Nominatim
// NOTE: be respectful of rate limits; this is for low-traffic dev/testing.
// For production, consider Mapbox/Google/Geoapify/etc.

const CACHE = new Map();
const TTL_MS = 10 * 60 * 1000; // 10 minutes

function getCached(key) {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key, value) {
  CACHE.set(key, { value, timestamp: Date.now() });
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    if (!q) {
      return new Response(JSON.stringify({ results: [] }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(q)}`;
    const resp = await fetch(url, {
      // Help OSM know who you are; add your site/email if you want.
      headers: { "User-Agent": "fulfilled-trip-planner/1.0 (dev@yourdomain.com)" },
      cache: "no-store",
    });

    if (!resp.ok) {
      return new Response(JSON.stringify({ results: [] }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    const data = await resp.json();
    const results = (Array.isArray(data) ? data : []).map(r => {
      const name = r.display_name || "";
      // Try to compress to “City, State/Country”
      const city = r.address?.city || r.address?.town || r.address?.village || r.address?.hamlet || "";
      const state = r.address?.state || r.address?.region || r.address?.county || "";
      const country = r.address?.country || "";
      const short = [city, state || country].filter(Boolean).join(", ") || name;
      return {
        label: short,
        full: name,
        lat: r.lat,
        lon: r.lon,
      };
    });

    return new Response(JSON.stringify({ results }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ results: [] }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  }
}