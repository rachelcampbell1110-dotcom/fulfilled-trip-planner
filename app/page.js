// app/page.js
"use client";

import { useForm, useFieldArray } from "react-hook-form";
import { useEffect, useMemo, useState } from "react";
import PlanPreview from "../components/PlanPreview.jsx";
import { buildPlan } from "../lib/buildPlan.js";

// Merge AI output into the rule-built plan
function mergeAiIntoPlan(basePlan, ai) {
  if (!basePlan) return basePlan;
  const next = structuredClone(basePlan);

  // 1) Trip blurb
  if (ai?.trip_blurb) next.ai_blurb = String(ai.trip_blurb);

  // 2) Venue tips + extra to-dos
  if (Array.isArray(ai?.venue_bag_policy_tips) && ai.venue_bag_policy_tips.length) {
    next.ai_venue_tips = Array.from(new Set([...(next.ai_venue_tips || []), ...ai.venue_bag_policy_tips]));
  }
  if (Array.isArray(ai?.extra_to_dos) && ai.extra_to_dos.length) {
    next.ai_extra_todos = Array.from(new Set([...(next.ai_extra_todos || []), ...ai.extra_to_dos]));
  }

  // 3) Packing additions → put into combined list (dedup)
  if (Array.isArray(ai?.packing_additions) && ai.packing_additions.length) {
    next.packing = next.packing || { byPerson: {}, combined: [] };
    const combined = new Set(next.packing.combined || []);
    ai.packing_additions.forEach((it) => { if (it && typeof it === "string") combined.add(it); });
    next.packing.combined = Array.from(combined);
  }

  // 4) Overpack additions
  next.overpack = next.overpack || { skip: [], lastMinute: [], housePrep: [] };
  const m = ai?.overpack_additions || {};
  if (Array.isArray(m.skip) && m.skip.length) {
    next.overpack.skip = Array.from(new Set([...(next.overpack.skip || []), ...m.skip]));
  }
  if (Array.isArray(m.lastMinute) && m.lastMinute.length) {
    next.overpack.lastMinute = Array.from(new Set([...(next.overpack.lastMinute || []), ...m.lastMinute]));
  }
  if (Array.isArray(m.housePrep) && m.housePrep.length) {
    next.overpack.housePrep = Array.from(new Set([...(next.overpack.housePrep || []), ...m.housePrep]));
  }

  // 5) Timeline additions (merge by day, dedup tasks, keep canonical order)
  const CANON = ["T-14", "T-7", "T-3", "T-1", "Day of"];
  const ensureArray = (x) => (Array.isArray(x) ? x : []);
  const timeline = ensureArray(next.timeline).map((e) => ({
    day: String(e?.day ?? e?.when ?? "").trim() || "",
    tasks: ensureArray(e?.tasks),
  })).filter(e => e.day);

  const map = new Map();
  // seed
  for (const entry of timeline) {
    const set = new Set(entry.tasks.filter(Boolean).map(String));
    map.set(entry.day, set);
  }
  // ai adds
  for (const add of ensureArray(ai?.timeline_additions)) {
    const day = String(add?.day || "").trim();
    if (!day) continue;
    if (!map.has(day)) map.set(day, new Set());
    const set = map.get(day);
    ensureArray(add?.tasks).forEach(t => { if (t) set.add(String(t)); });
  }
  // rebuild sorted
  const known = CANON.filter(d => map.has(d)).map(d => ({ day: d, tasks: Array.from(map.get(d)) }));
  const extra = Array.from(map.keys())
    .filter(d => !CANON.includes(d))
    .sort()
    .map(d => ({ day: d, tasks: Array.from(map.get(d)) }));
  next.timeline = [...known, ...extra];

  return next;
}

const ACTIVITY_OPTIONS = [
  { key: "lots_of_walking", label: "Lots of walking" },
  { key: "fancy_dinner", label: "Fancy dinner" },
  { key: "beach", label: "Beach" },
  { key: "pool", label: "Pool" },
  { key: "hiking", label: "Hiking" },
  { key: "boating_snorkeling", label: "Boating / Snorkeling" },
  { key: "skiing_snow", label: "Skiing / Snow play" },
  { key: "sports_event", label: "Sports event" },
  { key: "concert_show", label: "Concert / Show" },
  { key: "museums_tours", label: "Museums / Tours" },
  { key: "theme_park", label: "Theme Park 🎢" },
];

export default function Home() {
  const [submitted, setSubmitted] = useState(null);
  const [showAccessibility, setShowAccessibility] = useState(false);
  const [loadingWx, setLoadingWx] = useState(false);
  const [errorWx, setErrorWx] = useState("");
  const [destSuggestions, setDestSuggestions] = useState([]);

  // --- HOTEL AUTOSUGGEST STATE (NEW) ---
  const [hotelQuery, setHotelQuery] = useState("");
  const [hotelOptions, setHotelOptions] = useState([]); // [{name, city}]
  const [hotelDetectedCity, setHotelDetectedCity] = useState("");

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    defaultValues: {
      mode: "fly",
      trip_type: "personal",
      destination: "",
      start_date: "",
      end_date: "",
      accommodation: "",
      transportation: "",
      travelers: [
        { name: "", age: "", type: "adult" },
        { name: "", age: "", type: "child" },
      ],
      context_flags: { traveling_solo: false, single_parent: false },
      activities: [],
      accessibility: {
        mobility: false,
        sensory: false,
        medical: false,
        dietary: false,
        notes: "",
      },
      logistics: {
        fly: { departure_airport: "", airline: "", flight_time_local: "" },
        drive: { start_location: "", estimated_hours: "" },
        day_trip: { transport: "car" },
        hotel: { name: "", city: "" }, // NEW
      },
      venue_input: {
        name: "",
        city: "",
        type_hint: "",
        activities: [],
        known_venue_id: "",
      },
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "travelers",
  });

  const mode = watch("mode");
  const start = watch("start_date");
  const end = watch("end_date");
  const destination = watch("destination");
  const accommodation = watch("accommodation"); // NEW
  const endMin = start || "";

  // Small helper (NEW)
  function cityFromDestination(dest) {
    const t = (dest || "").split(",")[0]?.trim();
    return t || "";
  }

  // Keep Day Trip to single date (mirror start->end)
  useMemo(() => {
    if (mode === "day_trip" && start && start !== end) setValue("end_date", start);
  }, [mode, start, end, setValue]);

  // ---- Destination autosuggest (Open-Meteo geocoding) ----
  useEffect(() => {
    const q = (destination || "").trim();
    if (q.length < 3) {
      setDestSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const run = async () => {
      try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
          q
        )}&count=5&language=en&format=json`;
        const res = await fetch(url, {
          signal: ctrl.signal,
          headers: { "Cache-Control": "no-store" },
        });
        if (!res.ok) return;
        const data = await res.json();
        const items = Array.isArray(data?.results)
          ? data.results.map((p) => {
              const bits = [];
              if (p.name) bits.push(p.name);
              if (p.admin1 && p.country_code === "US") bits.push(p.admin1);
              if (p.country) bits.push(p.country);
              return bits.join(", ");
            })
          : [];
        setDestSuggestions(Array.from(new Set(items)).slice(0, 5));
      } catch {
        /* ignore */
      }
    };
    const t = setTimeout(run, 250); // debounce 250ms
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [destination]);

  // ---- Hotel name autosuggest (calls /api/hotels) (NEW) ----
  useEffect(() => {
    const q = (hotelQuery || "").trim();
    const city =
      hotelDetectedCity ||
      watch("logistics.hotel.city") ||
      cityFromDestination(destination);

    if (accommodation !== "hotel" || !city || q.length < 2) {
      setHotelOptions([]);
      return;
    }

    const ctrl = new AbortController();
    const run = async () => {
      try {
        const res = await fetch(`/api/hotels?cb=${Date.now()}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({ city, q }),
        });
        if (!res.ok) return;
        const data = await res.json();
        const items = Array.isArray(data?.hotels) ? data.hotels : [];
        setHotelOptions(items.slice(0, 10));
      } catch {
        /* ignore */
      }
    };

    const t = setTimeout(run, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [accommodation, hotelQuery, hotelDetectedCity, destination, watch]);

  const onSubmit = async (values) => {
    setErrorWx("");
    setLoadingWx(true);

    // Build trip_input
    const cleanedTravelers = (values.travelers || [])
      .filter((t) => t.name?.trim())
      .map((t) => ({
        name: t.name.trim(),
        age: Number(t.age || 0),
        type: t.type === "adult" ? "adult" : "child",
      }));

    const activities = values.activities || [];
    const hasVenueActivity = ["sports_event", "concert_show", "theme_park"].some(
      (a) => activities.includes(a)
    );

    const venue_input = hasVenueActivity
      ? {
          name: values.venue_input.name?.trim() || undefined,
          city: values.venue_input.city?.trim() || undefined,
          type_hint: values.venue_input.type_hint || undefined,
          activities: activities.filter((a) =>
            ["sports_event", "concert_show", "theme_park"].includes(a)
          ),
          known_venue_id: values.venue_input.known_venue_id?.trim() || undefined,
        }
      : undefined;

    const trip_input = {
      mode: values.mode,
      trip_type: values.trip_type,
      destination: values.destination.trim(),
      start_date: values.start_date,
      ...(values.mode !== "day_trip" ? { end_date: values.end_date } : {}),
      accommodation: values.accommodation || "",
      transportation: values.transportation || "",
      travelers: cleanedTravelers,
      context_flags: values.context_flags,
      activities,
      accessibility: values.accessibility,
      logistics: {
        ...(values.mode === "fly" ? { fly: values.logistics.fly } : {}),
        ...(values.mode === "drive" ? { drive: values.logistics.drive } : {}),
        ...(values.mode === "day_trip"
          ? { day_trip: values.logistics.day_trip }
          : {}),
        ...(values.accommodation === "hotel"
          ? {
              hotel: {
                name: values.logistics?.hotel?.name || hotelQuery,
                city:
                  values.logistics?.hotel?.city ||
                  hotelDetectedCity ||
                  cityFromDestination(values.destination),
              },
            }
          : {}),
      },
      ...(values.accommodation === "hotel"
        ? {
            hotel_input: {
              name: (values.logistics?.hotel?.name || hotelQuery || "").trim(),
              city_hint:
                (
                  values.logistics?.hotel?.city ||
                  hotelDetectedCity ||
                  cityFromDestination(values.destination) ||
                  ""
                ).trim(),
            },
          }
        : {}),
      ...(venue_input ? { venue_input } : {}),
    };

    // Fetch weather (POST with cache-buster)
    let weather_summary = null;
    try {
      const res = await fetch(`/api/weather?cb=${Date.now()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trip_input: {
            destination: trip_input.destination,
            start_date: trip_input.start_date,
            end_date: trip_input.end_date || trip_input.start_date,
          },
        }),
      });

      const ct = res.headers.get("content-type") || "";
      const data = ct.includes("application/json")
        ? await res.json()
        : { error_html: await res.text() };

      if (!res.ok) throw new Error(data?.error || "Weather error");

      weather_summary = {
        avg_high_f: data?.summary?.avg_high_f ?? null,
        avg_low_f: data?.summary?.avg_low_f ?? null,
        wet_days_pct: data?.summary?.wet_days_pct ?? null,
        notes: data?.summary?.notes ?? "",
        daily: Array.isArray(data?.daily) ? data.daily : [],
        matched_location:
          typeof data?.matched_location === "string"
            ? data.matched_location
            : undefined,
      };
    } catch (e) {
      console.error("Weather fetch failed:", e);
      setErrorWx(
        "Could not fetch weather. Please check destination & dates, then try again."
      );
    } finally {
      setLoadingWx(false);
    }

    const payload = {
      trip_input: { ...trip_input, ...(weather_summary ? { weather_summary } : {}) },
      constraints: {
        packing_groups_required: [
          "carry_on",
          "checked_bag",
          "day_bag",
          "car_backseat",
          "car_trunk",
        ],
        timebands_required: ["T-14", "T-7", "T-3", "T-1", "day_of"],
        stadium_or_venue_policy_expected: true,
        limit_items: true,
        tone: "concise, practical, family-friendly",
      },
    };

    // Build rule-based plan immediately
    const plan = buildPlan(payload);

    // Show plan right away; fetch AI tips, then merge
    setSubmitted({ ...payload, _plan: plan, ai: { status: "loading" } });

    try {
      const planRes = await fetch(`/api/plan?cb=${Date.now()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const planJson = await planRes.json();

      if (planRes.ok && planJson?.ai) {
        const enhancedPlan = mergeAiIntoPlan(plan, planJson.ai);
        setSubmitted((prev) => ({
          ...(prev || {}),
          ai: planJson.ai,
          _plan: enhancedPlan,   // <— update the visible plan with AI merges
        }));
      } else {
        setSubmitted((prev) => ({
          ...(prev || {}),
          ai: { error: planJson?.error || "AI unavailable" },
        }));
      }
    } catch (e) {
      console.error("Plan API error:", e);
      setSubmitted((prev) => ({
        ...(prev || {}),
        ai: { error: "AI unavailable" },
      }));
    }
  };//

  // Simple styles (mobile-friendly field wrapper)
  const card = {
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  };
  const label = { display: "block", fontWeight: 600, marginBottom: 6 };
  const row = { display: "flex", gap: 12, flexWrap: "wrap" };
  const field = { flex: "1 1 260px", minWidth: 240 };
  const input = {
    padding: "8px 10px",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    width: "100%",
  };

  return (
    <main style={{ padding: 20, maxWidth: 980, margin: "0 auto", fontFamily: "system-ui, Arial" }}>
      <h1 style={{ marginBottom: 8 }}>The Fulfilled Trip Planner - Beta</h1>
      <p style={{ marginBottom: 16 }}>
        Fill this out and submit to see your plan! We are in testing mode and welcome feedback!
      </p>

      <form onSubmit={handleSubmit(onSubmit)}>
        {/* Travel Mode */}
        <section style={card}>
          <div style={{ marginBottom: 10, fontWeight: 700 }}>Step 1: Travel Mode</div>
          <div style={row}>
            {["fly", "drive", "day_trip"].map((m) => (
              <label
                key={m}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  border: "1px solid #ddd",
                  borderRadius: 10,
                  padding: "8px 12px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
                title={m === "fly" ? "Fly ✈️" : m === "drive" ? "Drive 🚗" : "Day Trip 📅"}
              >
                <input type="radio" value={m} {...register("mode", { required: true })} />
                {m === "fly" ? "✈️ Fly" : m === "drive" ? "🚗 Drive / Road Trip" : "📅 Day Trip"}
              </label>
            ))}
          </div>
          {errors.mode && <div style={{ color: "crimson" }}>Please choose a mode.</div>}
        </section>

        {/* Trip Basics */}
        <section style={card}>
          <div style={{ marginBottom: 10, fontWeight: 700 }}>Trip Basics</div>
          <div style={row}>
            <div style={field}>
              <label style={label}>Trip Type</label>
              <select {...register("trip_type")} style={input}>
                <option value="personal">Personal</option>
                <option value="work">Work</option>
                <option value="both">Both</option>
              </select>
            </div>

            <div style={field}>
              <label style={label}>Destination</label>
              <input
                placeholder="City, State/Country"
                list="dest-options"
                {...register("destination", { required: true })}
                style={input}
              />
              <datalist id="dest-options">
                {destSuggestions.map((s, i) => (
                  <option key={i} value={s} />
                ))}
              </datalist>
              {errors.destination && (
                <div style={{ color: "crimson" }}>Destination is required.</div>
              )}
            </div>

            <div style={field}>
              <label style={label}>Start Date</label>
              <input type="date" {...register("start_date", { required: true })} style={input} />
              {errors.start_date && (
                <div style={{ color: "crimson" }}>Start date is required.</div>
              )}
            </div>

            <div style={field}>
              <label style={label}>{mode === "day_trip" ? "Date (Same Day)" : "End Date"}</label>
              <input
                type="date"
                {...register("end_date", { required: mode !== "day_trip" })}
                style={input}
                disabled={mode === "day_trip"}
                min={endMin}
              />
              {mode !== "day_trip" && errors.end_date && (
                <div style={{ color: "crimson" }}>End date is required.</div>
              )}
              {mode !== "day_trip" && start && end && end < start && (
                <div style={{ color: "crimson" }}>End date can’t be before start date.</div>
              )}
            </div>
          </div>

          {/* Accommodation + Getting Around */}
          <div style={{ ...row, marginTop: 10 }}>
            <div style={field}>
              <label style={label}>Accommodation</label>
              <select {...register("accommodation")} style={input}>
                <option value="">Select</option>
                <option value="hotel">Hotel</option>
                <option value="family">Family/Friends</option>
                <option value="rental">Vacation Rental</option>
              </select>
            </div>
            <div style={field}>
              <label style={label}>Getting Around</label>
              <select {...register("transportation")} style={input}>
                <option value="">Select</option>
                <option value="car">Car</option>
                <option value="subway">Subway/Metro</option>
                <option value="taxi">Taxi/Rideshare</option>
                <option value="walk">Walking</option>
              </select>
            </div>
          </div>
        </section>

        {/* Travelers */}
        <section style={card}>
          <div style={{ marginBottom: 10, fontWeight: 700 }}>Travelers</div>
          <div style={row}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
              <input type="checkbox" {...register("context_flags.traveling_solo")} /> I’m traveling solo
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
              <input type="checkbox" {...register("context_flags.single_parent")} /> I’m a single parent
            </label>
          </div>

          {fields.map((fieldItem, idx) => (
            <div key={fieldItem.id} style={{ ...row, marginTop: 10, alignItems: "flex-end" }}>
              <div style={field}>
                <label style={label}>Name</label>
                <input
                  placeholder="Name"
                  {...register(`travelers.${idx}.name`, { required: false })}
                  style={input}
                />
              </div>
              <div style={field}>
                <label style={label}>Age</label>
                <input
                  type="number"
                  min="0"
                  placeholder="Age"
                  {...register(`travelers.${idx}.age`)}
                  style={input}
                />
              </div>
              <div style={field}>
                <label style={label}>Type</label>
                <select {...register(`travelers.${idx}.type`)} style={input}>
                  <option value="adult">Adult</option>
                  <option value="child">Child</option>
                </select>
              </div>
              <button
                type="button"
                onClick={() => remove(idx)}
                style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd" }}
              >
                Remove
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={() => append({ name: "", age: "", type: "adult" })}
            style={{ marginTop: 12, padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd" }}
          >
            + Add Traveler
          </button>
        </section>

        {/* Logistics (dynamic) */}
        <section style={card}>
          <div style={{ marginBottom: 10, fontWeight: 700 }}>Logistics</div>

          {mode === "fly" && (
            <div style={row}>
              <div style={field}>
                <label style={label}>Departure Airport</label>
                <input
                  placeholder="e.g., MCO"
                  {...register("logistics.fly.departure_airport", { required: true })}
                  style={input}
                />
              </div>
              <div style={field}>
                <label style={label}>Airline</label>
                <input
                  placeholder="e.g., JetBlue"
                  {...register("logistics.fly.airline", { required: true })}
                  style={input}
                />
              </div>
              <div style={field}>
                <label style={label}>Flight Time (local)</label>
                <input
                  type="time"
                  {...register("logistics.fly.flight_time_local", { required: true })}
                  style={input}
                />
              </div>
            </div>
          )}

          {mode === "drive" && (
            <div style={row}>
              <div style={field}>
                <label style={label}>Starting Location</label>
                <input
                  placeholder="City, ST"
                  {...register("logistics.drive.start_location", { required: true })}
                  style={input}
                />
              </div>
              <div style={field}>
                <label style={label}>Estimated hours to final stop</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="e.g., 6"
                  {...register("logistics.drive.estimated_hours", { required: true })}
                  style={input}
                />
              </div>
            </div>
          )}

          {mode === "day_trip" && (
            <div style={row}>
              <div style={field}>
                <label style={label}>Transport</label>
                <select {...register("logistics.day_trip.transport")} style={input}>
                  <option value="car">Car</option>
                  <option value="train">Train</option>
                  <option value="subway">Subway</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
          )}

          {/* Hotel (only if Accommodation is Hotel) (NEW) */}
          {accommodation === "hotel" && (
            <div style={{ ...row, marginTop: 12 }}>
              <div style={field}>
                <label style={label}>Hotel Name</label>
                <input
                  list="hotel-options"
                  placeholder="Start typing your hotel…"
                  value={hotelQuery}
                  onChange={(e) => {
                    const v = e.target.value;
                    setHotelQuery(v);
                    setValue("logistics.hotel.name", v);
                    // Try to match a suggestion and auto-fill city
                    const match = hotelOptions.find(
                      (h) => (h?.name || "").toLowerCase() === v.toLowerCase()
                    );
                    if (match?.city) {
                      setHotelDetectedCity(match.city);
                      setValue("logistics.hotel.city", match.city);
                    }
                  }}
                  style={input}
                />
                <datalist id="hotel-options">
                  {hotelOptions.map((h, i) => (
                    <option key={i} value={h.name} />
                  ))}
                </datalist>
              </div>

              <div style={field}>
                <label style={label}>Hotel City (auto)</label>
                <input
                  placeholder="City"
                  value={
                    hotelDetectedCity ||
                    watch("logistics.hotel.city") ||
                    cityFromDestination(destination)
                  }
                  onChange={(e) => {
                    setHotelDetectedCity(e.target.value);
                    setValue("logistics.hotel.city", e.target.value);
                  }}
                  style={input}
                />
              </div>
            </div>
          )}
        </section>

        {/* Activities */}
        <section style={card}>
          <div style={{ marginBottom: 10, fontWeight: 700 }}>Activities (check all that apply)</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8 }}>
            {ACTIVITY_OPTIONS.map((opt) => (
              <label
                key={opt.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  border: "1px solid #eee",
                  borderRadius: 8,
                  padding: "6px 10px",
                }}
              >
                <input type="checkbox" value={opt.key} {...register("activities")} />
                {opt.label}
              </label>
            ))}
          </div>
        </section>

        {/* Venue (only if relevant) */}
        {(watch("activities") || []).some((a) =>
          ["sports_event", "concert_show", "theme_park"].includes(a)
        ) && (
          <section style={card}>
            <div style={{ marginBottom: 10, fontWeight: 700 }}>
              Venue Details (optional, helps with bag policy)
            </div>
            <div style={row}>
              <div style={field}>
                <label style={label}>Venue Name</label>
                <input
                  placeholder="e.g., Fenway Park"
                  {...register("venue_input.name")}
                  style={input}
                />
              </div>
              <div style={field}>
                <label style={label}>Venue City</label>
                <input
                  placeholder="e.g., Boston"
                  {...register("venue_input.city")}
                  style={input}
                />
              </div>
              <div style={field}>
                <label style={label}>Type Hint</label>
                <select {...register("venue_input.type_hint")} style={input}>
                  <option value="">(select)</option>
                  <option value="stadium">Stadium</option>
                  <option value="arena">Arena</option>
                  <option value="theme_park">Theme Park</option>
                </select>
              </div>
            </div>
          </section>
        )}

        {/* Accessibility */}
        <section style={card}>
          <button
            type="button"
            onClick={() => setShowAccessibility((s) => !s)}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", marginBottom: 10 }}
          >
            {showAccessibility ? "−" : "+"} Accessibility & Special Considerations
          </button>

          {showAccessibility && (
            <>
              <div style={row}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
                  <input type="checkbox" {...register("accessibility.mobility")} /> Mobility
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
                  <input type="checkbox" {...register("accessibility.sensory")} /> Sensory
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
                  <input type="checkbox" {...register("accessibility.medical")} /> Medical
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
                  <input type="checkbox" {...register("accessibility.dietary")} /> Dietary
                </label>
              </div>
              <div style={{ marginTop: 10 }}>
                <label style={label}>Notes</label>
                <textarea
                  rows={3}
                  placeholder="Any details you'd like us to account for…"
                  {...register("accessibility.notes")}
                  style={{ ...input, height: 90 }}
                />
              </div>
            </>
          )}
        </section>

        {/* Submit */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="submit"
            disabled={loadingWx}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              border: "1px solid #0ea5e9",
              background: loadingWx ? "#93c5fd" : "#0ea5e9",
              color: "white",
              fontWeight: 700,
              cursor: loadingWx ? "not-allowed" : "pointer",
              opacity: loadingWx ? 0.8 : 1,
            }}
          >
            {loadingWx ? "Fetching Weather…" : "🔮 Create My Trip Prep Plan"}
          </button>

          {loadingWx && <span aria-live="polite">Fetching weather… ⛅</span>}
          {errorWx && <span style={{ color: "crimson" }}>{errorWx}</span>}
        </div>
      </form>

      {/* Plan UI */}
      {submitted?._plan && (
        <PlanPreview
          plan={submitted._plan}
          ai={submitted.ai}          // <- passes AI to the preview
          loadingAi={submitted?.ai?.status === "loading"}
        />
      )}

      {/* (Optional) Debug payload – visible only if NEXT_PUBLIC_SHOW_DEBUG="1" */}
      {process.env.NEXT_PUBLIC_SHOW_DEBUG === "1" && submitted && (
        <section style={{ ...card, marginTop: 16 }}>
          <div style={{ marginBottom: 8, fontWeight: 700 }}>Preview Payload</div>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              overflowX: "auto",
              background: "#0b1020",
              color: "#e5f0ff",
              padding: 12,
              borderRadius: 10,
            }}
          >
            {JSON.stringify(submitted, null, 2)}
          </pre>
        </section>
      )}
    </main>
  );
}