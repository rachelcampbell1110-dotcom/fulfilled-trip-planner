// app/api/plan/route.js
export const dynamic = "force-dynamic";
export const revalidate = 0;

import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function safeStr(x) {
  return typeof x === "string" ? x.trim() : "";
}
function arr(x) {
  return Array.isArray(x) ? x : [];
}
function nonEmpty(str) {
  return typeof str === "string" && str.trim().length > 0;
}

// Very small helper to cap list sizes
function takeN(list, n = 8) {
  return list.slice(0, n);
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const t = body?.trip_input || {};

    // Inputs the model can leverage
    const destination     = safeStr(t.destination);
    const start_date      = safeStr(t.start_date);
    const end_date        = safeStr(t.end_date || t.start_date);
    const activities      = arr(t.activities);
    const transportation  = safeStr(t.transportation);
    const accommodation   = safeStr(t.accommodation);

    // Hotel micro-context
    const hotel_name      = safeStr(t?.logistics?.hotel?.name);
    const hotel_city      = safeStr(t?.logistics?.hotel?.city);

    // Airline / airport micro-context
    const fly                 = t?.logistics?.fly || {};
    const departure_airport   = safeStr(fly.departure_airport); // e.g., "BOS"
    const airline             = safeStr(fly.airline);           // e.g., "JetBlue"

    // Venue micro-context
    const venue_input   = t?.venue_input || {};
    const venue_name    = safeStr(venue_input.name);
    const venue_city    = safeStr(venue_input.city);
    const venue_types   = arr(venue_input.activities); // ["sports_event","concert_show","theme_park"]

    // Weather summary (already fetched in your app)
    const wx = t.weather_summary || {};
    const avg_high_f       = (typeof wx.avg_high_f === "number" ? wx.avg_high_f : null);
    const avg_low_f        = (typeof wx.avg_low_f  === "number" ? wx.avg_low_f  : null);
    const wet_days_pct     = (typeof wx.wet_days_pct === "number" ? wx.wet_days_pct : null);
    const matched_location = safeStr(wx.matched_location);
    const wx_note          = safeStr(wx.notes);

    if (!client.apiKey) {
      return new Response(JSON.stringify({ error: "Server missing OPENAI_API_KEY." }), { status: 500 });
    }

    // ------- System + micro-prompts (IMPROVED) -------
    const SYSTEM_RULES = `
You are a concise, practical family trip assistant.
Produce a warm, useful, family-friendly trip guide with TWO parts:

1) TRIP BLURB (1–2 short paragraphs)
- Start with the destination’s vibe (historic, coastal, outdoorsy, theme-park energy, etc.).
- Suggest a few location-specific activities: family-friendly attractions, parks, walks, cultural stops. If children are present, include kid-friendly ideas.
- Mention popular local dining ideas by name (casual/family-friendly or a classic local specialty), but do not guarantee availability.
- If a HOTEL name & city are provided: mention it by name and add practical reminders like: check pool hours, ask about cribs/pack-n-plays or mini-fridges, confirm parking/shuttle, and note nearby dining. Do not assert amenities; use “check,” “confirm,” or “if available.”
- If WEATHER info is available: weave it in naturally (e.g., bring layers for cool evenings, rain gear if wet-day % is high).
- If FLYING (airline/airport present): include practical prep like downloading the airline app, checking baggage allowances, budgeting extra time for security, stroller/family lane availability may vary. Avoid specifics (no terminal numbers, no guarantees).
- If DRIVING: include road-trip prep such as snacks, car chargers, child seats, and planned rest stops.
- If using SUBWAY/TAXI/WALKING: suggest a transit card/app setup, stroller-friendly routes, and comfortable shoes.
- Tone: upbeat, welcoming, practical, and family-friendly. No emojis.
- Safety guard: never invent exact facilities, fees, or policies. Frame with “check,” “confirm,” and “consider.”

2) JSON CHECKLISTS (strict JSON, no prose outside JSON)
Return:
{
  "trip_blurb": string,
  "venue_bag_policy_tips": string[],     // 0–6 items
  "extra_to_dos": string[],              // 0–6 items
  "packing_additions": string[],         // 0–6 items (in addition to baseline packing)
  "overpack_additions": {                // optional adds for “Pack Smarter”
    "skip": string[],                    // things to leave home
    "lastMinute": string[],              // last-minute grab
    "housePrep": string[]                // house prep
  },
  "timeline_additions": [
    { "day": "T-14"|"T-7"|"T-3"|"T-1"|"Day of", "tasks": string[] }
  ]
}

Guidelines:
- Venue tips: if sports/concert/theme_park, include a gentle bag-policy reminder and arrive-early tip (no guarantees).
- Extra to-dos: practical planning tasks (backup rainy-day ideas, kid snacks, confirm reservations).
- Packing additions: tailor to weather, activities, and transport mode (concise).
- Overpack additions: realistic suggestions to skip, last-minute grabs, and house-prep.
- Timeline additions: a few lightweight prep tasks at appropriate offsets.
- Lists short (up to ~6 each). No emojis. No markdown. No claims of specifics.
`.trim();

    // User context we pass to the model
    const userContext = {
      destination,
      dates: { start_date, end_date },
      transportation,
      accommodation,
      activities,
      venue: { name: venue_name, city: venue_city, activity_types: venue_types },
      flight: { departure_airport, airline },
      hotel: { name: hotel_name, city: hotel_city },
      weather_summary: {
        matched_location,
        avg_high_f,
        avg_low_f,
        wet_days_pct,
        notes: wx_note,
      },
    };

    // Call the model
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: SYSTEM_RULES },
        {
          role: "user",
          content: [
            { type: "text", text: "Generate the JSON exactly as specified. Here is the trip input:" },
            { type: "text", text: JSON.stringify(userContext) },
          ],
        },
      ],
    });

    const raw = completion?.choices?.[0]?.message?.content || "{}";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Very defensive: try to salvage a JSON block if the model included extra text
      const match = raw.match(/\{[\s\S]*\}$/);
      parsed = match ? JSON.parse(match[0]) : {};
    }

    // Normalize + trim sizes (defensive)
    const ai = {
      trip_blurb: safeStr(parsed?.trip_blurb),
      venue_bag_policy_tips: takeN(arr(parsed?.venue_bag_policy_tips), 6),
      extra_to_dos: takeN(arr(parsed?.extra_to_dos), 6),
      packing_additions: takeN(arr(parsed?.packing_additions), 6),
      overpack_additions: {
        skip: takeN(arr(parsed?.overpack_additions?.skip || []), 6),
        lastMinute: takeN(arr(parsed?.overpack_additions?.lastMinute || []), 6),
        housePrep: takeN(arr(parsed?.overpack_additions?.housePrep || []), 6),
      },
      timeline_additions: takeN(
        arr(parsed?.timeline_additions)
          .map((e) => ({
            day: safeStr(e?.day),
            tasks: takeN(arr(e?.tasks), 6),
          }))
          .filter((e) => e.day && e.tasks.length > 0),
        5
      ),
    };

    return new Response(
      JSON.stringify({ ai }),
      { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[/api/plan] error:", err);
    return new Response(JSON.stringify({ error: "AI unavailable." }), {
      status: 503, headers: { "Content-Type": "application/json" },
    });
  }
}

// Optional: prevent GET usage
export async function GET() {
  return new Response("Use POST.", { status: 405, headers: { Allow: "POST", "Content-Type": "text/plain" } });
}
