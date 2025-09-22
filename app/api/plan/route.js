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
    const modes            = arr(t.modes).filter((m) => typeof m === "string" && m.trim());
    const trip_type       = safeStr(t.trip_type);
    const context_flags   = t && typeof t.context_flags === "object" ? t.context_flags : {};
    const traveler_list_raw = arr(t.travelers);
    const traveler_list = traveler_list_raw.map((p) => {
      const name = safeStr(p?.name);
      const type = safeStr(p?.type) === "child" ? "child" : "adult";
      let age = null;
      if (typeof p?.age === "number") {
        age = p.age;
      } else if (nonEmpty(p?.age)) {
        const maybe = Number(p.age);
        age = Number.isFinite(maybe) ? maybe : null;
      }
      return { name, type, age };
    });
    const traveler_summary = (() => {
      const total = traveler_list.length;
      const adults = traveler_list.filter((p) => p.type === "adult").length;
      const children = traveler_list.filter((p) => p.type === "child");
      const childAges = children
        .map((p) => (typeof p.age === "number" ? p.age : null))
        .filter((age) => age !== null);
      const hasInfantOrToddler = childAges.some((age) => typeof age === "number" && age <= 3);
      return {
        total,
        adults,
        children: children.length,
        names: traveler_list.map((p) => p.name).filter(Boolean),
        ages_children: childAges,
        has_infant_or_toddler: hasInfantOrToddler,
      };
    })();
    const solo_via_counts = traveler_summary.total <= 1;
    const traveling_solo_flag = Boolean(context_flags?.traveling_solo) || solo_via_counts;
    const has_children_flag = traveler_summary.children > 0;

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
You are a concierge-level, practical family trip assistant.
Produce a warm, useful, family-friendly trip guide with TWO parts:

1) TRIP BLURB (1-2 short paragraphs)
- Start with the destination's vibe (historic, coastal, outdoorsy, theme-park energy, etc.).
- Suggest location-specific activities spaced across the stay (free + ticketed options) and call out kid-friendly ideas when the context hints at children.
- Mention popular local dining ideas by name (casual/family-friendly or a classic local specialty), but do not guarantee availability.
- If a HOTEL name & city are provided: mention it by name and add practical reminders like: check pool hours, ask about cribs/pack-n-plays or mini-fridges, confirm parking/shuttle, and note nearby dining. Do not assert amenities; use "check", "confirm", or "if available" language.
- If WEATHER info is available: weave it in naturally (e.g., bring layers for cool evenings, rain gear if wet-day % is high).
- If FLYING (airline/airport present): include practical prep like downloading the airline app, checking baggage allowances, budgeting extra time for security, stroller/family lane availability may vary. Avoid specifics (no terminal numbers, no guarantees).
- If DRIVING: include road-trip prep such as snacks, car chargers, child seats, and planned rest stops.
- If using SUBWAY/TAXI/WALKING: suggest a transit card/app setup, stroller-friendly routes, and comfortable shoes.
- If CRUISE mode is included: note online check-in and boarding windows, required IDs, packing a small embarkation-day bag (swimsuit/meds/sunscreen), and checking dress-code nights.
- If trip_type equals "work": keep the blurb business-forward, mention quick productivity plays (coworking spaces, meeting prep touchpoints), and offer one light after-hours recharge idea.
- If traveler_summary.total <= 1 or context_flags.traveling_solo is true: speak directly to the solo traveler, weave in a gentle solo-safety reminder, and favor singular language.
- If traveler_summary.children === 0 and context_flags.single_parent is false: keep ideas adult-forward and skip kid-focused phrasing unless a venue requires it.
- Close with one energizing sentence that previews the biggest prep focus over the next two weeks (no bullet list).
- Tone: upbeat, welcoming, practical, and family-friendly. No emojis.
- Safety guard: never invent exact facilities, fees, or policies. Frame with "check", "confirm", and "consider".

2) JSON CHECKLISTS (strict JSON, no prose outside JSON)
Return:
{
  "trip_blurb": string,
  "venue_bag_policy_tips": string[],     // 0-6 items
  "extra_to_dos": string[],              // 0-6 items
  "packing_additions": string[],         // 0-6 items (in addition to baseline packing)
  "overpack_additions": {                // optional adds for "Pack Smarter"
    "skip": string[],                    // things to leave home
    "lastMinute": string[],              // last-minute grab
    "housePrep": string[]                // house prep
  },
  "timeline_additions": [
    { "day": "T-14"|"T-7"|"T-3"|"T-1"|"Day of", "tasks": string[] }
  ],
  "smart_must_haves": [                 // 10-30 concise, tailored items
    string
  ]
}

Guidelines:
- Venue tips: if sports/concert/theme_park, include a gentle bag-policy reminder and arrive-early tip (no guarantees).
- Extra to-dos: include concrete planning moves (backup rainy-day ideas, kid snacks, confirm reservations) tied to provided context.
- Packing additions: tailor to weather, travel modes, activities, ages inferred from context (be concise).
- Overpack additions: realistic suggestions to skip, last-minute grabs, and house-prep. Tie each item to travel mode, weather, or hotel info when possible.
- Timeline additions: deliver a ready-to-act two-week countdown. Cover each marker (T-14, T-7, T-3, T-1, Day of) when it genuinely applies; otherwise omit that marker. Give 3-6 crisp tasks per marker, lead with an action verb, and reference the relevant airline, hotel, venue, weather, or family logistics.
- Smart must-haves: tailor to travel modes, activities, children's ages, weather, venue/stadium, and hotel details. Mix must-pack gear, digital prep, and pro-tips. Use short context tags like "Flight:", "Hotel:", "Weather:", "Kids:", "Local:" when it improves scanning.
- Smart must-haves micro-guidance (use only when relevant):
  - If flying: chewing gum or lollipops (kids) for ear pressure, wired + wireless headphones (or BT transmitter for seat-back screens), empty water bottle, hand sanitizer/wipes, snacks, compression socks (long flights), travel-size meds, portable battery, luggage scale (optional), TSA liquids, kid entertainment.
  - If driving: motion-sickness fixes, age-appropriate car seat/booster, window shade, car trash bag, paper towels, cooler with ice packs, charging cables for the car, offline maps.
  - If cruise: lanyard for cruise card, sea-sickness meds/bands, non-surge power strip, embarkation-day swim bag, dress-code night outfit.
  - If stadium/concert/theme park: clear bag compliant with local policies, portable battery, sun/heat kit (hat, SPF, cooling towel), ponchos, ear protection for kids.
  - If beach/pool: reef-safe sunscreen, rash guard, water shoes, waterproof phone pouch, after-sun lotion, swim diapers (if needed).
  - If weather is wet/cold/hot: compact umbrella/poncho, waterproof layer, warm layers/hat/gloves, breathable fabrics, electrolytes.
  - If trip_type is "work": Work: laptop lock or slim cable, microfibre lint roller, backup presentation on a drive/cloud, wrinkle-release spray, badge lanyard.
  - If traveler_summary.total <= 1 or context_flags.traveling_solo is true: Solo: photocopy of ID kept separate, hotel door wedge/personal alarm, emergency contacts card, lightweight crossbody with zipper, extra portable battery.
- Fold cruise guidance, if selected, into all applicable sections (timeline, packing, smart must-haves) with reminders about online check-in windows, required IDs, embarkation-day essentials, and verifying dress-code nights.
- If trip_type is "work": keep every checklist business-forward (laptop + charger, meeting materials, coworking passes, garment care) and note out-of-office or agenda reviews when relevant.
- If traveler_summary.total <= 1 or context_flags.traveling_solo is true: reinforce solo-safety habits (share itinerary, duplicate IDs) and keep packing lean across sections.
- If traveler_summary.children === 0 and context_flags.single_parent is false: avoid kid-specific items unless a venue/activity absolutely requires them.
- If hotel name + city present: use "check" language only (pool hours, crib/mini-fridge, parking/shuttle, laundry).
- All lists should feel like a one-stop prep hub; avoid fluff, stay under the caps, and keep language natural. No emojis. No markdown. No claims of specifics.
`.trim();

    // User context we pass to the model
    const userContext = {
      destination,
      dates: { start_date, end_date },
      transportation,
      accommodation,
      activities,
      trip_type,
      context_flags: {
        traveling_solo: traveling_solo_flag,
        single_parent: Boolean(context_flags?.single_parent),
      },
      travelers: traveler_list,
      traveler_summary: {
        ...traveler_summary,
        traveling_solo: traveling_solo_flag,
        has_children: has_children_flag,
      },
      modes,
      mode_flags: {
        fly: modes.includes("fly"),
        drive: modes.includes("drive"),
        cruise: modes.includes("cruise"),
        day_trip: modes.includes("day_trip"),
      },
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
      smart_must_haves: takeN(arr(parsed?.smart_must_haves), 30),
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
