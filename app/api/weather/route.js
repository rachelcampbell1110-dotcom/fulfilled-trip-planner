// app/api/weather/route.js
export const dynamic = "force-dynamic";
export const revalidate = 0;

const OM_GEOCODE  = "https://geocoding-api.open-meteo.com/v1/search";
const OM_FORECAST = "https://api.open-meteo.com/v1/forecast";
const OM_CLIMATE  = "https://climate-api.open-meteo.com/v1/climate";
const OM_ARCHIVE  = "https://archive-api.open-meteo.com/v1/era5"; // NEW fallback

// -------------------- utils --------------------
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
function daysBetweenInclusive(a, b) { const d1 = new Date(a); const d2 = new Date(b); d1.setHours(0,0,0,0); d2.setHours(0,0,0,0); return Math.floor((d2 - d1)/86400000) + 1; }
function isWithinNextNDays(dateStr, n = 16) {
  const today = new Date();
  const target = new Date(dateStr);
  if (Number.isNaN(target.getTime())) return false;
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target - today) / 86400000);
  return diffDays >= 0 && diffDays <= n;
}
async function fetchJSON(url, opts) {
  const res = await fetch(url, { ...opts, headers: { ...(opts?.headers || {}), "Cache-Control": "no-store" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text?.slice(0, 200)}`);
  }
  return res.json();
}

// -------------------- geocoding with fallbacks & state preference --------------------
const US_STATE_NAMES = {
  AL:"Alabama", AK:"Alaska", AZ:"Arizona", AR:"Arkansas", CA:"California", CO:"Colorado", CT:"Connecticut",
  DE:"Delaware", FL:"Florida", GA:"Georgia", HI:"Hawaii", ID:"Idaho", IL:"Illinois", IN:"Indiana", IA:"Iowa",
  KS:"Kansas", KY:"Kentucky", LA:"Louisiana", ME:"Maine", MD:"Maryland", MA:"Massachusetts", MI:"Michigan",
  MN:"Minnesota", MS:"Mississippi", MO:"Missouri", MT:"Montana", NE:"Nebraska", NV:"Nevada", NH:"New Hampshire",
  NJ:"New Jersey", NM:"New Mexico", NY:"New York", NC:"North Carolina", ND:"North Dakota", OH:"Ohio",
  OK:"Oklahoma", OR:"Oregon", PA:"Pennsylvania", RI:"Rhode Island", SC:"South Carolina", SD:"South Dakota",
  TN:"Tennessee", TX:"Texas", UT:"Utah", VT:"Vermont", VA:"Virginia", WA:"Washington", WV:"West Virginia",
  WI:"Wisconsin", WY:"Wyoming", DC:"District of Columbia"
};

function extractUsStatePreference(rawInput) {
  const tokens = (rawInput || "").toUpperCase().split(/[,\s]+/).filter(Boolean);
  const code = tokens.find(t => US_STATE_NAMES[t]);
  return code ? { code, name: US_STATE_NAMES[code] } : null;
}

async function tryGeocodeRaw(q, count = 5) {
  const url = `${OM_GEOCODE}?name=${encodeURIComponent(q)}&count=${count}&language=en&format=json`;
  console.log("[/api/weather] geocode ->", url);
  const data = await fetchJSON(url);
  return Array.isArray(data?.results) ? data.results : [];
}

async function geocodeWithFallbacks(input) {
  const attempts = [];
  const raw = (input || "").trim();
  if (raw) attempts.push(raw);
  const firstToken = raw.split(",")[0]?.trim();
  if (firstToken && firstToken !== raw) attempts.push(firstToken);

  const seen = new Set();
  const queries = attempts.filter(q => { const k = q.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });

  let allCandidates = [];
  for (const q of queries) {
    try {
      const results = await tryGeocodeRaw(q, 5);
      allCandidates = allCandidates.concat(results);
      if (results.length > 0) break;
    } catch { /* continue */ }
  }
  if (!allCandidates.length) return null;

  let candidates = allCandidates.filter(r => r?.country_code === "US");
  if (!candidates.length) candidates = allCandidates;

  const pref = extractUsStatePreference(input);
  if (pref) {
    const inState = candidates.find(r => (r?.admin1 || "").toLowerCase() === pref.name.toLowerCase());
    if (inState) return inState;
  }
  return candidates[0];
}

// -------------------- climate parsing helpers --------------------
function pickFirstNumber(arr) {
  if (!arr || !Array.isArray(arr)) return null;
  for (const v of arr) if (typeof v === "number" && !Number.isNaN(v)) return v;
  return null;
}
function firstNumericInObj(o) {
  if (!o || typeof o !== "object") return null;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (Array.isArray(v)) {
      const n = pickFirstNumber(v);
      if (n !== null) return n;
    }
  }
  return null;
}
function deepFindFuzzy(obj, baseKeys, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 6) return null;
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    const keyLc = key.toLowerCase();
    if (baseKeys.some(b => keyLc.includes(b))) {
      if (typeof v === "number" && !Number.isNaN(v)) return v;
      if (Array.isArray(v)) {
        const n = pickFirstNumber(v);
        if (n !== null) return n;
        for (const el of v) {
          const nn = deepFindFuzzy(el, baseKeys, depth + 1);
          if (nn !== null) return nn;
        }
      }
      if (v && typeof v === "object") {
        const n2 = firstNumericInObj(v);
        if (n2 !== null) return n2;
      }
    }
    if (v && typeof v === "object") {
      const n3 = deepFindFuzzy(v, baseKeys, depth + 1);
      if (n3 !== null) return n3;
    }
  }
  return null;
}
function getMonthlyNumberFlexible(climateObj, keyCandidates, fuzzyBases) {
  const monthly = climateObj?.monthly ?? climateObj?.data ?? climateObj?.month ?? null;

  for (const key of keyCandidates) {
    const a1 = monthly?.[key];
    const v1 = pickFirstNumber(a1);
    if (v1 !== null) return v1;

    if (typeof a1 === "number" && !Number.isNaN(a1)) return a1;

    if (Array.isArray(monthly)) {
      const v2 = pickFirstNumber(monthly.map(m => (typeof m?.[key] === "number" ? m[key] : null)));
      if (v2 !== null) return v2;
    }

    const aTop = climateObj?.[key];
    const vTop = pickFirstNumber(aTop);
    if (vTop !== null) return vTop;
    if (typeof aTop === "number" && !Number.isNaN(aTop)) return aTop;
  }

  const fuzzy = deepFindFuzzy(climateObj, fuzzyBases.map(s => s.toLowerCase()));
  return fuzzy;
}

// -------------------- route handlers --------------------
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const t = body?.trip_input || {};
    const dest  = (t.destination || "").trim();
    const start = t.start_date;
    const end   = t.end_date || t.start_date;

    if (!dest)  return new Response(JSON.stringify({ error: "Destination is required." }), { status: 400, headers: { "Content-Type": "application/json" } });
    if (!start) return new Response(JSON.stringify({ error: "Start date is required." }),   { status: 400, headers: { "Content-Type": "application/json" } });

    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return new Response(JSON.stringify({ error: "Invalid trip dates." }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    if (endDate < startDate) {
      return new Response(JSON.stringify({ error: "End date must be on or after the start date." }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const place = await geocodeWithFallbacks(dest);
    if (!place?.latitude || !place?.longitude) {
      return new Response(JSON.stringify({ error: "Could not find that destination. Try a city, region, or country." }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }
    const latitude  = place.latitude;
    const longitude = place.longitude;
    const timezone  = place.timezone || "auto";

    const useForecast = isWithinNextNDays(endDate, 16);

    if (useForecast) {
      // ---- Forecast (next ~16 days)
      const params = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
        timezone: timezone === "auto" ? "auto" : String(timezone),
        daily: ["temperature_2m_max", "temperature_2m_min", "precipitation_sum"].join(","),
        start_date: start,
        end_date: end,
      });
      const url = `${OM_FORECAST}?${params.toString()}`;
      console.log("[/api/weather] forecast ->", url);
      const data = await fetchJSON(url);

      const d = data?.daily || {};
      const len = Math.min(
        d?.time?.length ?? 0,
        d?.temperature_2m_max?.length ?? 0,
        d?.temperature_2m_min?.length ?? 0,
        d?.precipitation_sum?.length ?? 0
      );

      const daily = [];
      let sumMaxC = 0;
      let sumMinC = 0;
      let maxCount = 0;
      let minCount = 0;
      let wetDays = 0;

      for (let i = 0; i < len; i++) {
        const date = d.time[i];
        const tmaxC = d.temperature_2m_max[i];
        const tminC = d.temperature_2m_min[i];
        const precip = d.precipitation_sum?.[i];

        if (typeof tmaxC === "number") {
          sumMaxC += tmaxC;
          maxCount++;
        }
        if (typeof tminC === "number") {
          sumMinC += tminC;
          minCount++;
        }
        if (typeof precip === "number" && precip > 0) {
          wetDays++;
        }

        daily.push({
          date,
          tmax_f: toF(tmaxC),
          tmin_f: toF(tminC),
          precipitation_mm: typeof precip === "number" ? precip : null,
        });
      }

      const daysCount = len || Math.max(1, daysBetweenInclusive(startDate, endDate));
      const avgHighF = maxCount ? toF(sumMaxC / maxCount) : null;
      const avgLowF = minCount ? toF(sumMinC / minCount) : null;
      const wetPct = clampPct((wetDays / daysCount) * 100);
      const summary = {
        avg_high_f: typeof avgHighF === "number" ? Math.round(avgHighF) : null,
        avg_low_f:  typeof avgLowF  === "number" ? Math.round(avgLowF)  : null,
        wet_days_pct: wetPct !== null ? Math.round(wetPct) : null,
        notes: "Forecast-based averages for your dates.",
      };

      return new Response(JSON.stringify({ summary, daily, matched_location: fmtMatched(place) }), {
        status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
      });
    }

    // ---- Outside forecast window: climate normals attempts
    const s = new Date(startDate);
    const e = new Date(endDate);
    const months = new Set();
    for (let d = new Date(s); d <= e; d.setMonth(d.getMonth() + 1, 1)) {
      months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    const [y, m] = Array.from(months)[0].split("-");
    const yearNum = Number(y);
    const monthNum = Number(m);
    const lastDay = new Date(yearNum, monthNum, 0).getDate();
    const monthStartISO = `${y}-${m}-01`;
    const monthEndISO = `${y}-${m}-${String(lastDay).padStart(2, "0")}`;

    // Attempt A: monthly aggregates
    const climateUrlA =
      `${OM_CLIMATE}?latitude=${latitude}&longitude=${longitude}` +
      `&start_year=1991&end_year=2020` +
      `&month=${encodeURIComponent(m)}` +
      `&temperature_2m_max=true&temperature_2m_min=true&precipitation_days=true&precipitation_sum=true`;

    console.log("[/api/weather] climate A (monthly) ->", climateUrlA);
    let climateA = null;
    try { climateA = await fetchJSON(climateUrlA); } catch (eA) { console.warn("[/api/weather] climate A fetch failed:", eA?.message || eA); }

    let maxC = null, minC = null, precipDays = null;
    if (climateA) {
      try {
        console.log("[/api/weather] climate A keys ->", {
          topKeys: Object.keys(climateA || {}),
          monthlyKeys: Object.keys(climateA?.monthly || {}),
        });
      } catch {}
      maxC = getMonthlyNumberFlexible(climateA, ["temperature_2m_max","temperature_2m_max_mean","temperature_2m_max_avg"], ["temperature_2m_max"]);
      minC = getMonthlyNumberFlexible(climateA, ["temperature_2m_min","temperature_2m_min_mean","temperature_2m_min_avg"], ["temperature_2m_min"]);
      precipDays = getMonthlyNumberFlexible(climateA, ["precipitation_days","precipitation_days_mean","precipitation_days_avg"], ["precipitation_days","wet_days"]);
    }

    if (typeof maxC === "number" || typeof minC === "number" || typeof precipDays === "number") {
      const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
      const wetPct = (typeof precipDays === "number" && daysInMonth) ? Math.round((precipDays / daysInMonth) * 100) : null;

      const summary = {
        avg_high_f: (typeof maxC === "number") ? Math.round(toF(maxC)) : null,
        avg_low_f:  (typeof minC === "number") ? Math.round(toF(minC)) : null,
        wet_days_pct: wetPct,
        notes: "Climate normals for this month (1991-2020).",
      };
      return new Response(JSON.stringify({ summary, daily: [], matched_location: fmtMatched(place) }), {
        status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
      });
    }

    // Attempt B skipped: daily climate with models often returns 400, so fall back to the archive API.

    // Attempt C (NEW): ERA5 archive daily for the same month last year
    const lastYear = new Date().getFullYear() - 1;
    const lastStart = `${lastYear}-${m}-01`;
    const lastEnd   = `${lastYear}-${m}-${String(lastDay).padStart(2, "0")}`;
    const archiveUrl =
      `${OM_ARCHIVE}?latitude=${latitude}&longitude=${longitude}` +
      `&start_date=${encodeURIComponent(lastStart)}` +
      `&end_date=${encodeURIComponent(lastEnd)}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum` +
      `&timezone=${encodeURIComponent(timezone)}`;
    console.log("[/api/weather] archive C (last-year month) ->", archiveUrl);

    let archive = null;
    try { archive = await fetchJSON(archiveUrl); } catch (eC) { console.warn("[/api/weather] archive fetch failed:", eC?.message || eC); }

    if (archive?.daily?.time?.length) {
      const d = archive.daily;
      const n = Math.min(
        d.time.length,
        d.temperature_2m_max?.length ?? 0,
        d.temperature_2m_min?.length ?? 0,
        d.precipitation_sum?.length ?? 0
      );
      let sumMax = 0, sumMin = 0, cnt = 0, wet = 0;
      for (let i = 0; i < n; i++) {
        const tmax = d.temperature_2m_max[i];
        const tmin = d.temperature_2m_min[i];
        const psum = d.precipitation_sum[i];
        if (typeof tmax === "number") { sumMax += tmax; cnt++; }
        if (typeof tmin === "number") { sumMin += tmin; }
        if (typeof psum === "number" && psum > 1) wet++; // treat >1mm as a wet day
      }
      const avgMaxC = cnt ? sumMax / cnt : null;
      const avgMinC = cnt ? sumMin / cnt : null;
      const wetPct = n ? Math.round((wet / n) * 100) : null;

      const summary = {
        avg_high_f: (typeof avgMaxC === "number") ? Math.round(toF(avgMaxC)) : null,
        avg_low_f:  (typeof avgMinC === "number") ? Math.round(toF(avgMinC)) : null,
        wet_days_pct: wetPct,
        notes: `Typical conditions for this month (ERA5 archive, ${lastYear}).`,
      };
      return new Response(JSON.stringify({ summary, daily: [], matched_location: fmtMatched(place) }), {
        status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
      });
    }

    console.warn("[/api/weather] climate A and archive C yielded no numeric data");
    return new Response(JSON.stringify({
      summary: {
        avg_high_f: null,
        avg_low_f:  null,
        wet_days_pct: null,
        notes: "Climate normals for this month (unavailable, try another nearby city).",
      },
      daily: [],
      matched_location: fmtMatched(place),
    }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

  } catch (err) {
    console.error("WEATHER ROUTE ERROR:", err);
    return new Response(JSON.stringify({ error: "Weather service unavailable. Try again." }), {
      status: 502, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
}

export async function GET() {
  return new Response("Use POST.", { status: 405, headers: { Allow: "POST", "Content-Type": "text/plain" } });
}