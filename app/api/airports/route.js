import airports from "../../../data/airports.json";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalize(value) {
  return (value || "").toString().toLowerCase();
}

function matchesQuery(airport, query) {
  const needle = normalize(query);
  if (!needle) return false;
  const haystack = [
    airport.iata,
    airport.icao,
    airport.name,
    airport.city,
    airport.state,
    airport.country,
    `${airport.iata || ""} ${airport.name || ""}`,
    `${airport.city || ""} ${airport.name || ""}`,
  ]
    .filter(Boolean)
    .map(normalize);
  return haystack.some((value) => value.includes(needle));
}

function buildResponse(matches) {
  return matches.slice(0, 10).map((airport) => ({
    iata: airport.iata,
    icao: airport.icao,
    name: airport.name,
    city: airport.city,
    state: airport.state,
    country: airport.country,
  }));
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const results = q
    ? buildResponse(airports.filter((airport) => matchesQuery(airport, q)))
    : buildResponse(airports);

  return new Response(JSON.stringify({ airports: results }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const q = (body?.q || "").trim();
  if (!q) {
    return new Response(JSON.stringify({ airports: [] }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  }

  const results = buildResponse(airports.filter((airport) => matchesQuery(airport, q)));

  return new Response(JSON.stringify({ airports: results }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
