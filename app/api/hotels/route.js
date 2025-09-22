// app/api/hotels/route.js
export const dynamic = "force-dynamic";
export const revalidate = 0;

const HOTEL_TYPES = new Set([
  "hotel",
  "hostel",
  "motel",
  "guest_house",
  "lodging",
  "apartments",
  "resort",
]);

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

export async function POST(req) {
  try {
    const { city, q } = await req.json().catch(() => ({}));
    const searchCity = (city || "").trim();
    const searchCityLower = searchCity.toLowerCase();
    const searchQuery = (q || "").trim();
    if (!searchCity || !searchQuery) {
      return new Response(JSON.stringify({ hotels: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=10&q=${encodeURIComponent(`${searchQuery} ${searchCity}`)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "fulfilled-trip-planner/1.0 (+https://thefulfilledhustle.com)",
        "Accept-Language": "en",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ hotels: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    const data = await res.json();
    const candidates = Array.isArray(data) ? data : [];
    const filtered = candidates.filter((entry) => {
      const cls = entry?.class;
      const type = entry?.type;
      if (!cls || !type) return false;
      if (cls === "tourism" && HOTEL_TYPES.has(type)) return true;
      if (cls === "amenity" && HOTEL_TYPES.has(type)) return true;
      return false;
    });

    const mapped = filtered.map((entry) => {
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
        return hotel.city.toLowerCase().includes(searchCityLower);
      });

    const hotels = uniqueHotels(mapped).slice(0, 12);

    return new Response(JSON.stringify({ hotels }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[/api/hotels] error:", err);
    return new Response(JSON.stringify({ hotels: [] }), {
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
