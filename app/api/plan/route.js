// app/api/plan/route.js
import OpenAI from "openai";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Small wait helper
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Lazy client init (prevents build-time explosions)
let _client = null;
function getClient() {
  if (_client) return _client;
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    // Throw only at request time (not at import/build time)
    throw new Error("OPENAI_API_KEY not set");
  }
  _client = new OpenAI({ apiKey: key });
  return _client;
}

// Retry wrapper for OpenAI calls
async function callOpenAIWithRetry({ condensed, instructions, maxAttempts = 3, timeoutMs = 12000 }) {
  let attempt = 0, lastErr;
  while (attempt < maxAttempts) {
    attempt++;
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(new Error("Request timed out")), timeoutMs);

    try {
      const resp = await getClient().responses.create(
        {
          model: "gpt-4o-mini",
          input: [
            { role: "system", content: instructions },
            { role: "user", content: JSON.stringify(condensed) },
          ],
        },
        { signal: ac.signal }
      );
      clearTimeout(to);

      const text = resp.output_text || "";
      try {
        return { ok: true, data: JSON.parse(text) };
      } catch {
        return { ok: true, data: { trip_blurb: text.trim() } };
      }
    } catch (err) {
      clearTimeout(to);
      lastErr = err;
      const status = err?.status ?? err?.statusCode ?? err?.response?.status;
      const retryable = status === 429 || (status >= 500 && status < 600) || err?.name === "AbortError";
      if (!retryable || attempt >= maxAttempts) break;

      const base = [300, 800, 1500][attempt - 1] ?? 2000;
      const jitter = Math.floor(Math.random() * 200);
      await wait(base + jitter);
    }
  }
  return { ok: false, error: lastErr?.message || "AI request failed" };
}

export async function POST(req) {
  try {
    const input = await req.json(); // expects { trip_input, constraints }
    const t = input?.trip_input || {};
    const wx = t?.weather_summary || {};

    const condensed = {
      destination: t.destination,
      dates: { start: t.start_date, end: t.end_date || t.start_date },
      mode: t.mode,
      trip_type: t.trip_type,
      accommodation: t.accommodation || "",
      transportation: t.transportation || "",
      travelers: (t.travelers || []).map(p => ({ name: p.name, age: p.age, type: p.type })),
      activities: t.activities || [],
      accessibility: t.accessibility || {},
      venue_input: t.venue_input || {},
      weather_summary: {
        avg_high_f: wx?.avg_high_f ?? wx?.summary?.avg_high_f ?? null,
        avg_low_f:  wx?.avg_low_f  ?? wx?.summary?.avg_low_f  ?? null,
        wet_days_pct: wx?.wet_days_pct ?? wx?.summary?.wet_days_pct ?? null,
        notes: wx?.notes ?? wx?.summary?.notes ?? "",
      },
      logistics: t.logistics || {},
    };

    const instructions = `
You are a friendly family trip-prep assistant.
Return ONLY valid JSON with this exact shape:
{
  "trip_blurb": string,
  "venue_bag_policy_tips": string[],
  "extra_to_dos": string[],
  "timeline": [
    { "day": "T-14" | "T-7" | "T-3" | "T-1" | "Day of", "tasks": string[] }
  ]
}
Guidelines:
- Use simple, practical, family-friendly language.
- Avoid duplicates; add complementary tips.
- Factor in accommodation and local transportation where relevant.
- Reference weather naturally (no robotic repetition of numbers).
`;

    const result = await callOpenAIWithRetry({ condensed, instructions });

    if (!result.ok) {
      return new Response(JSON.stringify({ error: result.error || "AI unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ ai: result.data }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("[/api/plan] ERROR:", err);
    const msg = err?.message || String(err || "Internal error");
    const status = /OPENAI_API_KEY not set/i.test(msg) ? 500 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { "Content-Type": "application/json" }
    });
  }
}