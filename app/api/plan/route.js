// app/api/plan/route.js
import OpenAI from "openai";

// Helps avoid static rendering of this route in some setups
export const dynamic = "force-dynamic";
export const revalidate = 0;

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Simple GET so you can test quickly in the browser: /api/plan
export async function GET() {
  console.log("[/api/plan] GET ping");
  return new Response(JSON.stringify({ ok: true, route: "plan" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function callOpenAIWithRetry({ condensed, instructions, maxAttempts = 3, timeoutMs = 12000 }) {
  let attempt = 0, lastErr;

  while (attempt < maxAttempts) {
    attempt++;
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(new Error("Request timed out")), timeoutMs);

    try {
      const resp = await client.responses.create(
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

      const raw = (resp.output_text || "").trim();
      return { ok: true, raw };
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

function stripCodeFences(s) {
  return s
    .replace(/```json\s*([\s\S]*?)\s*```/gi, "$1")
    .replace(/```\s*([\s\S]*?)\s*```/gi, "$1");
}
function desmart(s) {
  return s
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u2014/g, "--")
    .replace(/\u2026/g, "...");
}
function tryJSON(s) {
  try { return JSON.parse(s); } catch {}
  try { return JSON.parse(desmart(stripCodeFences(s))); } catch {}
  const loose = desmart(stripCodeFences(s))
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]");
  try { return JSON.parse(loose); } catch {}
  return null;
}
function asStringArray(v) {
  if (Array.isArray(v)) return v.map(x => String(x)).filter(Boolean);
  if (v == null) return [];
  return [String(v)].filter(Boolean);
}
function normalizeAI(obj) {
  const CANON_DAYS = new Set(["T-14", "T-7", "T-3", "T-1", "Day of"]);
  const out = { trip_blurb: "", venue_bag_policy_tips: [], extra_to_dos: [], timeline: [] };

  if (obj && typeof obj === "object") {
    out.trip_blurb = typeof obj.trip_blurb === "string" ? obj.trip_blurb.trim() : "";
    out.venue_bag_policy_tips = asStringArray(obj.venue_bag_policy_tips);
    out.extra_to_dos = asStringArray(obj.extra_to_dos);

    const aiTL = Array.isArray(obj.timeline) ? obj.timeline : [];
    const byDay = new Map();
    for (const e of aiTL) {
      const day = String(e?.day ?? e?.when ?? "").trim() || "T-3";
      const canon = CANON_DAYS.has(day) ? day : day;
      const tasks = asStringArray(e?.tasks);
      if (tasks.length === 0) continue;
      if (!byDay.has(canon)) byDay.set(canon, new Set());
      const set = byDay.get(canon);
      tasks.forEach(t => set.add(t));
    }
    out.timeline = Array.from(byDay.entries()).map(([day, set]) => ({
      day,
      tasks: Array.from(set),
    }));
  } else if (typeof obj === "string" && obj.trim()) {
    out.trip_blurb = obj.trim();
  }

  out.venue_bag_policy_tips = out.venue_bag_policy_tips.slice(0, 10);
  out.extra_to_dos = out.extra_to_dos.slice(0, 12);
  out.timeline = out.timeline.filter(e => e.tasks.length > 0);

  return out;
}

export async function POST(req) {
  console.log("[/api/plan] POST hit");
  if (!process.env.OPENAI_API_KEY) {
    console.warn("[/api/plan] Missing OPENAI_API_KEY");
    return new Response(JSON.stringify({ ai: { error: "OPENAI_API_KEY not set" } }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const input = await req.json().catch(() => ({}));
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
- Prefer concise lists; avoid duplicates.
- Refer to weather naturally (no robotic repeats).
- Consider accommodation and local transport when suggesting items.
- Output JSON only. No commentary, no code fences.
`.trim();

    const result = await callOpenAIWithRetry({ condensed, instructions });

    if (!result.ok) {
      console.warn("[/api/plan] OpenAI fail:", result.error);
      return new Response(JSON.stringify({ ai: { error: result.error || "AI unavailable" } }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    const parsed = tryJSON(result.raw);
    const ai = normalizeAI(parsed ?? result.raw);

    return new Response(JSON.stringify({ ai }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[/api/plan] Handler error:", err);
    return new Response(JSON.stringify({ ai: { error: "AI service error. Please try again." } }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
}