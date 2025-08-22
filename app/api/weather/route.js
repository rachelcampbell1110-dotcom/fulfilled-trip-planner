// app/api/weather/route.js

export const dynamic = "force-dynamic";
export const revalidate = 0;

const OM_GEOCODE  = "https://geocoding-api.open-meteo.com/v1/search";
const OM_FORECAST = "https://api.open-meteo.com/v1/forecast";
const OM_CLIMATE  = "https://climate-api.open-meteo.com/v1/climate";

// Optional GET (health check / dev)
export async function GET() {
  console.log("[/api/weather] GET ping");
  return new Response(JSON.stringify({ ok: true, route: "weather" }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// ---------- small helpers ----------
function toF(c) { if (typeof c !== "number" || Number.isNaN(c)) return null; return (c * 9) / 5 + 32; }
function clampPct(n) { if (typeof n !== "number" || Number.isNaN(n)) return null; return Math.max(0, Math.min(100, n)); }
function fmtMatched(place) {
  if (!place) return null;
  const parts = [];
  if (place.name) parts.push(place.name);
  if (place.admin1 && place.country && place.country_code === "US") parts.push(place.admin1);
  if (place.country) parts.push(place.country);
  return parts.join(", ");
}
function daysBetweenInclusive(a, b) {
  const d1 = new Date(a), d2 = new Date(b);
  d1.setHours(0,0,0,0); d2.setHours(0,0,0,0);
  return Math.floor((d2 - d1) / 86400000) + 1;
}
function isWithinNextNDays(dateStr, n = 16) {
  if (!dateStr) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(dateStr); target.setHours(0,0,0,0);
  const diffDays = Math.round((target - today) / 86400000);
  return diffDays <= n;
}
async function fetchJSON(url, opts) {
  const res = await fetch(url, { ...opts, headers: { ...(opts?.headers || {}), "Cache-Control": "no-store" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text?.slice(0, 200)}`);
  }
  return res.json();
}
async function resolvePlace(dest) {
  const tryQuery = async (name) => {
    const url = `${OM_GEOCODE}?name=${encodeURIComponent(name)}&count=5&language=en&format=json`;
    console.log("[/api/weather] geocode →", url);
    const geo = await fetchJSON(url);
    const list = Array.isArray(geo?.results) ? geo.results : [];
    return { url, list, raw: geo };
  };

  // 1st pass: full string
  let { list, raw, url } = await tryQuery(dest);

  // 2nd pass: head token (before comma), for “Boston, MA” or “Portland, Maine”
  if (list.length === 0) {
    const head = dest.split(",")[0].trim();
    if (head && head.toLowerCase() !== dest.toLowerCase()) {
      ({ list, raw, url } = await tryQuery(head));
    }
  }

  if (list.length === 0) {
    console.warn("[/api/weather] geocode: no results", { dest, lastUrl: url, raw });
    return null;
  }

  // Prefer US match when user typed a US state/region
  const wantState = dest.split(",")[1]?.trim();
  const us = list.filter(p => p.country_code === "US");
  const prefer = (us.length ? us : list);

  if (wantState) {
    const byState = prefer.find(p => (p.admin1 || "").toLowerCase().startsWith(wantState.toLowerCase()));
    if (byState) return byState;
  }
  return prefer[0];
}

// ---------- main handler ----------
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const t = body?.trip_input || {};
    const dest  = (t.destination || "").trim();
    const start = t.start_date;
    const end   = t.end_date || t.start_date;

    // Validation as 4xx, not 5xx
    if (!dest) {
      return new Response(JSON.stringify({ error: "Destination is required." }), {
        status: 400, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
    if (!start) {
      return new Response(JSON.stringify({ error: "Start date is required." }), {
        status: 400, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    // 1) Geocode (with fuzzy fallback)
    const place = await resolvePlace(dest);
    if (!place?.latitude || !place?.longitude) {
      return new Response(JSON.stringify({
        error: "Could not find that destination. Try a city, region, or country."
      }), {
        status: 404, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
    const latitude  = place.latitude;
    const longitude = place.longitude;
    const timezone  = place.timezone || "auto";

    // 2) Forecast if within next ~16 days; otherwise climate normals
    const useForecast = isWithinNextNDays(end, 16);

    if (useForecast) {
      // ---- Forecast path ----
      const params = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
        timezone: timezone === "auto" ? "auto" : String(timezone),
        daily: ["temperature_2m_max","temperature_2m_min","precipitation_sum"].join(","),
        start_date: start,
        end_date:   end,
      });
      const url = `${OM_FORECAST}?${params.toString()}`;
      console.log("[/api/weather] forecast →", url);
      const data = await fetchJSON(url);

      const d = data?.daily;
      const len = Math.min(
        d?.time?.length ?? 0,
        d?.temperature_2m_max?.length ?? 0,
        d?.temperature_2m_min?.length ?? 0,
        d?.precipitation_sum?.length ?? 0
      );

      const daily = [];
      let sumMaxC = 0, sumMinC = 0, wetDays = 0;

      for (let i = 0; i < len; i++) {
        const date   = d.time[i];
        const tmaxC  = d.temperature_2m_max[i];
        const tminC  = d.temperature_2m_min[i];
        const precip = d.precipitation_sum[i];

        sumMaxC += (typeof tmaxC === "number" ? tmaxC : 0);
        sumMinC += (typeof tminC === "number" ? tminC : 0);
        if (typeof precip === "number" && precip > 0) wetDays++;

        daily.push({
          date,
          tmax_f: toF(tmaxC),
          tmin_f: toF(tminC),
          precipitation_mm: (typeof precip === "number" ? precip : null),
        });
      }

      const daysCount = len || Math.max(1, daysBetweenInclusive(start, end));
      const avgHighF  = toF(sumMaxC / (len || 1));
      const avgLowF   = toF(sumMinC / (len || 1));
      const wetPct    = clampPct((wetDays / daysCount) * 100);

      const summary = {
        avg_high_f: typeof avgHighF === "number" ? Math.round(avgHighF) : null,
        avg_low_f:  typeof avgLowF  === "number" ? Math.round(avgLowF)  : null,
        wet_days_pct: wetPct !== null ? Math.round(wetPct) : null,
        notes: "Forecast-based averages for your dates.",
      };

      return new Response(JSON.stringify({
        summary,
        daily,
        matched_location: fmtMatched(place),
      }), {
        status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    // ---- Climate normals path (outside ~16-day window) ----
    try {
      // Compute month within the date range (use the first month spanned)
      const s = new Date(start);
      const e = new Date(end);
      const months = new Set();
      for (let d = new Date(s); d <= e; d.setMonth(d.getMonth() + 1, 1)) {
        months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      }
      const [ym] = Array.from(months);
      const [y, m] = ym.split("-");

      // Correct model domain for climate endpoint: CMIP6 (ERA5 is not valid here)
      const climateUrl =
        `${OM_CLIMATE}?latitude=${latitude}&longitude=${longitude}` +
        `&start_year=${encodeURIComponent(y)}&end_year=${encodeURIComponent(y)}` +
        `&models=CMIP6&month=${encodeURIComponent(m)}` +
        `&temperature_2m_max=true&temperature_2m_min=true&precipitation_days=true`;

      console.log("[/api/weather] climate →", climateUrl);
      const climate = await fetchJSON(climateUrl);

      const mon = climate?.monthly || {};
      // Be defensive about formats
      const maxC = Array.isArray(mon?.temperature_2m_max) ? mon.temperature_2m_max[0]
                 : (typeof mon?.temperature_2m_max === "number" ? mon.temperature_2m_max : null);
      const minC = Array.isArray(mon?.temperature_2m_min) ? mon.temperature_2m_min[0]
                 : (typeof mon?.temperature_2m_min === "number" ? mon.temperature_2m_min : null);
      const precipDays = Array.isArray(mon?.precipitation_days) ? mon.precipitation_days[0]
                        : (typeof mon?.precipitation_days === "number" ? mon.precipitation_days : null);

      const daysInMonth = new Date(Number(y), Number(m), 0).getDate();
      const wetPct = (typeof precipDays === "number" && daysInMonth)
        ? Math.round((precipDays / daysInMonth) * 100)
        : null;

      const summary = {
        avg_high_f: (typeof maxC === "number") ? Math.round(toF(maxC)) : null,
        avg_low_f:  (typeof minC === "number") ? Math.round(toF(minC)) : null,
        wet_days_pct: wetPct,
        notes: "Climate normals for this month (typical conditions).",
      };

      return new Response(JSON.stringify({
        summary,
        daily: [],
        matched_location: fmtMatched(place),
      }), {
        status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    } catch (climateErr) {
      console.warn("[/api/weather] climate fallback:", climateErr?.message || climateErr);
      // Graceful fallback so the UI still renders
      return new Response(JSON.stringify({
        summary: {
          avg_high_f: null,
          avg_low_f:  null,
          wet_days_pct: null,
          notes: "Climate normals temporarily unavailable; showing generic guidance.",
        },
        daily: [],
        matched_location: fmtMatched(place),
      }), {
        status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

  } catch (err) {
    console.error("WEATHER ROUTE ERROR:", err);
    return new Response(JSON.stringify({ error: "Weather service unavailable. Try again." }), {
      status: 502, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
}