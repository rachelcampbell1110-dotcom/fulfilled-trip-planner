// app/api/hotels/route.js
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Tiny, dependency-free mock that returns a few name variants.
// You can swap this later for a real provider.
function makeHotelNames(q) {
  const base = (q || "").trim();
  if (!base) return [];
  const variants = [
    `${base} Hotel`,
    `${base} Inn`,
    `${base} Suites`,
    `${base} Resort`,
    `${base} Lodge`,
    `${base} Place`,
  ];
  // de-dupe & cap
  return Array.from(new Set(variants)).slice(0, 6);
}

export async function POST(req) {
  try {
    const { city, q } = await req.json().catch(() => ({}));
    if (!city || !q) {
      return new Response(JSON.stringify({ hotels: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    const names = makeHotelNames(q);
    const hotels = names.map((name) => ({ name, city }));

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