// app/api/weather/route.js

// Helper: pick best geocode hit given optional state/country hints
function pickBestResult(results, hints = {}) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const { state, countryCode } = hints;

  // 1) Exact country + state/admin1 match
  let best = results.find(
    r =>
      (!countryCode || r.country_code?.toUpperCase() === countryCode.toUpperCase()) &&
      (!state || (r.admin1 || "").toLowerCase().includes(state.toLowerCase()))
  );
  if (best) return best;

  // 2) Exact country match
  best = results.find(r => !countryCode || r.country_code?.toUpperCase() === countryCode.toUpperCase());
  if (best) return best;

  // 3) First result as fallback
  return results[0];
}

function parseDestination(raw) {
  // Examples:
  // "Boston, MA" -> { city:"Boston", state:"MA", countryCode:"US" (inferred) }
  // "Boston, Massachusetts" -> { city:"Boston", state:"Massachusetts" }
  // "Boston" -> { city:"Boston" }
  const s = (raw || "").trim();
  const parts = s.split(",").map(p => p.trim()).filter(Boolean);
  let city = parts[0] || "";
  let state = parts[1] || "";

  // Infer US if they used a 2-letter state code
  let countryCode = "";
  if (state && /^[A-Za-z]{2}$/.test(state)) countryCode = "US";

  return { city, state, countryCode };
}

async function geocodeFlexible(q) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=en`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`);
  const data = await res.json();
  return data?.results || [];
}

async function geocodeDestination(dest) {
  const { city, state, countryCode } = parseDestination(dest);

  // Attempt 1: full string (e.g., "Boston, MA")
  let results = await geocodeFlexible(dest);
  let picked = pickBestResult(results, { state, countryCode });
  if (picked) return picked;

  // Attempt 2: just the city (e.g., "Boston")
  if (city && city.toLowerCase() !== dest.toLowerCase()) {
    results = await geocodeFlexible(city);
    picked = pickBestResult(results, { state, countryCode });
    if (picked) return picked;
  }

  // Attempt 3: remove punctuation & try again
  const cleaned = dest.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (cleaned && cleaned.toLowerCase() !== dest.toLowerCase()) {
    results = await geocodeFlexible(cleaned);
    picked = pickBestResult(results, { state, countryCode });
    if (picked) return picked;
  }

  return null;
}

// --- GET: quick browser test ---
// Example: /api/weather?city=Boston, MA&startDate=2025-08-29&endDate=2025-09-01
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const city = searchParams.get("city");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  if (!city || !startDate || !endDate) {
    return new Response(
      JSON.stringify({ ok: true, note: "Add ?city=...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD or POST JSON." }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
  return POST(new Request(request.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ city, startDate, endDate }),
  }));
}

// --- POST: used by your form ---
export async function POST(request) {
  try {
    const body = await request.json();

    const city =
      body?.city ||
      body?.trip_input?.destination ||
      "";
    const startDate =
      body?.startDate ||
      body?.trip_input?.start_date ||
      "";
    const endDate =
      body?.endDate ||
      body?.trip_input?.end_date ||
      body?.trip_input?.start_date ||
      "";

    if (!city || !startDate || !endDate) {
      return new Response(JSON.stringify({ error: "city, startDate, endDate are required" }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }

    // Robust geocoding with fallbacks
    const g0 = await geocodeDestination(city);
    if (!g0) {
      return new Response(JSON.stringify({ error: `Could not geocode "${city}"` }), {
        status: 404, headers: { "Content-Type": "application/json" }
      });
    }

    const latitude = g0.latitude;
    const longitude = g0.longitude;
    const timezone = g0.timezone || "auto";

    // Daily forecast
    const dailyParams = [
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_sum",
      "precipitation_probability_mean",
    ].join(",");

    const forecastUrl =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${latitude}` +
      `&longitude=${longitude}` +
      `&start_date=${startDate}` +
      `&end_date=${endDate}` +
      `&daily=${dailyParams}` +
      `&temperature_unit=fahrenheit` +
      `&precipitation_unit=inch` +
      `&timezone=${encodeURIComponent(timezone)}`;

    const wxRes = await fetch(forecastUrl);
    if (!wxRes.ok) throw new Error(`Forecast failed: ${wxRes.status}`);
    const wx = await wxRes.json();

    const d = wx?.daily;
    if (!d?.time?.length) {
      return new Response(JSON.stringify({ error: "No daily forecast returned" }), {
        status: 502, headers: { "Content-Type": "application/json" }
      });
    }

    const days = d.time.map((date, i) => ({
      date,
      highF: d.temperature_2m_max?.[i] ?? null,
      lowF: d.temperature_2m_min?.[i] ?? null,
      precipInches: d.precipitation_sum?.[i] ?? null,
      precipChancePct: d.precipitation_probability_mean?.[i] ?? null,
    }));

    const avg = (arr) => arr.length ? Math.round((arr.reduce((a,b)=>a+b,0)/arr.length)*10)/10 : null;
    const highs = days.map(x => x.highF).filter(v => typeof v === "number");
    const lows  = days.map(x => x.lowF).filter(v => typeof v === "number");
    const wetDaysPct = Math.round((days.filter(x => (x.precipInches ?? 0) > 0).length / days.length) * 100);

    const payload = {
      city: city,
      matched_location: {
        name: g0.name,
        admin1: g0.admin1 || null,
        country: g0.country || null,
        country_code: g0.country_code || null,
        latitude, longitude,
      },
      range: { startDate, endDate },
      summary: {
        avg_high_f: avg(highs),
        avg_low_f: avg(lows),
        wet_days_pct: wetDaysPct,
        notes: wetDaysPct >= 40
          ? "Expect some wet weather—pack umbrellas/light rain jackets."
          : "Mostly dry—pack layers for temps.",
      },
      daily: days,
    };

    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}


