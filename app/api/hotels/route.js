// app/api/hotels/route.js
export const dynamic = "force-dynamic";
export const revalidate = 0;

import fallbackHotelsData from "../../../data/hotels.json";

const HOTEL_TYPES = new Set([
  "hotel",
  "hostel",
  "motel",
  "guest_house",
  "lodging",
  "apartments",
  "resort",
]);

const FALLBACK_HOTELS = fallbackHotelsData.map((entry) => ({
  city: (entry?.city || "").trim(),
  state: (entry?.state || "").trim(),
  country: (entry?.country || "United States").trim(),
  hotels: Array.isArray(entry?.hotels) ? entry.hotels : [],
}));

function pickName(entry, fallback) {
  const display = (entry?.display_name || "").split(",")[0]?.trim();
  return display || fallback || "";
}

function buildCity(entry, providedCity) {
  const addr = entry?.address || {};
  const city = addr.city || addr.town || addr.village || addr.hamlet || providedCity || "";
  const state = addr.state || addr.region || "";
  const country = addr.country || "";
  return {
    city,
    state,
    country,
  };
}

function uniqueHotels(list) {
  const seen = new Set();
  const results = [];
  list.forEach((hotel) => {
    const key = `${hotel.name.toLowerCase()}|${(hotel.city || "").toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(hotel);
  });
  return results;
}

function fallbackHotelMatches(city, query) {
  const cityLower = (city || "").toLowerCase();
  const queryLower = (query || "").toLowerCase();
  if (!cityLower) return [];
  const matches = [];
  FALLBACK_HOTELS.forEach((entry) => {
    if (!entry.city || entry.city.toLowerCase() !== cityLower) return;
    entry.hotels.forEach((hotelName) => {
      if (!hotelName) return;
      if (queryLower && !hotelName.toLowerCase().includes(queryLower)) return;
      matches.push({
        name: hotelName,
        city: entry.city,
        state: entry.state,
        country: entry.country,
        lat: null,
        lon: null,
      });
    });
  });
  return matches;
}

function combineHotelResults(remoteList, fallbackList, limit = 12) {
  const combined = uniqueHotels([...remoteList, ...fallbackList]);
  return combined.slice(0, limit);
}

export async function POST(req) {
  let remoteResults = [];
  try {
    const { city, q } = await req.json().catch(() => ({}));
    const searchCity = (city || "").trim();
    const searchQuery = (q || "").trim();
    if (!searchCity || !searchQuery) {
      const fallbackOnly = fallbackHotelMatches(searchCity, searchQuery);
      return new Response(
        JSON.stringify({ hotels: combineHotelResults([], fallbackOnly) }),
        { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
      );
    }

    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=10&q=${encodeURIComponent(`${searchQuery} ${searchCity}`)}`;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "fulfilled-trip-planner/1.0 (+https://thefulfilledhustle.com)",
          "Accept-Language": "en",
        },
        cache: "no-store",
      });

      if (res.ok) {
        const data = await res.json();
        const candidates = Array.isArray(data) ? data : [];
        remoteResults = candidates
          .filter((entry) => {
            const cls = entry?.class;
            const type = entry?.type;
            if (!cls || !type) return false;
            if (cls === "tourism" && HOTEL_TYPES.has(type)) return true;
            if (cls === "amenity" && HOTEL_TYPES.has(type)) return true;
            return false;
          })
          .map((entry) => {
            const name = pickName(entry, searchQuery);
            const location = buildCity(entry, searchCity);
            return {
              name,
              city: location.city,
              state: location.state,
              country: location.country,
              lat: entry?.lat || null,
              lon: entry?.lon || null,
            };
          })
          .filter((hotel) => {
            if (!hotel.city) return true;
            return hotel.city.toLowerCase().includes(searchCity.toLowerCase());
          });
      }
    } catch (err) {
      console.error("[/api/hotels] remote fetch error:", err);
    }

    const fallbackList = fallbackHotelMatches(searchCity, searchQuery);
    const hotels = combineHotelResults(remoteResults, fallbackList);

    return new Response(JSON.stringify({ hotels }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[/api/hotels] error:", err);
    return new Response(JSON.stringify({ hotels: combineHotelResults([], []) }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
}

export async function GET() {
  return new Response("Use POST.", {
    status: 405,
    headers: { Allow: "POST", "Content-Type": "text/plain" },
  });
}
