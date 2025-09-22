// app/page.js
"use client";

import { useForm, useFieldArray, Controller } from "react-hook-form";
import { useEffect, useState } from "react";
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

const TRAVEL_MODE_OPTIONS = [
  { key: "fly", label: "Fly", title: "Flying or taking a plane" },
  { key: "drive", label: "Drive / Road Trip", title: "Driving between stops" },
  { key: "cruise", label: "Cruise", title: "Traveling by cruise ship" },
  { key: "day_trip", label: "Day Trip", title: "Out-and-back same day" },
];

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
  { key: "fishing", label: "Fishing" },
  { key: "camping", label: "Camping" },
  { key: "theme_park", label: "Theme Park 🎢" },
];

const LOADING_MESSAGES = [
  "Fetching weather details...",
  "Checking out the area...",
  "Gathering handy tips...",
  "Making all the lists...",
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
  const [airportQuery, setAirportQuery] = useState("");
  const [airportOptions, setAirportOptions] = useState([]);
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    defaultValues: {
      modes: ["fly"],
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
        cruise: { cruise_line: "", ship_name: "", embark_port: "", disembark_port: "", embark_time_local: "" },
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

  const modes = watch("modes") || [];
  const start = watch("start_date");
  const end = watch("end_date");
  const destination = watch("destination");
  const accommodation = watch("accommodation"); // NEW
  const departureAirportValue = watch("logistics.fly.departure_airport");
  const hotelCityValue = watch("logistics.hotel.city");
  const hotelNameValue = watch("logistics.hotel.name");
  const dayTripSelected = modes.includes("day_trip");
  const endMin = start || "";

  useEffect(() => {
    if (!modes.includes("fly")) {
      setAirportQuery("");
      setValue("logistics.fly.departure_airport", "");
      return;
    }
    setAirportQuery(departureAirportValue || "");
  }, [departureAirportValue, modes, setValue]);

  useEffect(() => {
    setHotelQuery(hotelNameValue || "");
  }, [hotelNameValue]);

  useEffect(() => {
    if (hotelCityValue) {
      setHotelDetectedCity(hotelCityValue);
    }
  }, [hotelCityValue]);

  useEffect(() => {
    if (!loadingWx) {
      setLoadingMsgIndex(0);
      return;
    }
    setLoadingMsgIndex(0);
    const interval = setInterval(() => {
      setLoadingMsgIndex((idx) => (idx + 1) % LOADING_MESSAGES.length);
    }, 1800);
    return () => clearInterval(interval);
  }, [loadingWx]);

  const includesMode = (key) => modes.includes(key);

  // Small helper (NEW)
  function cityFromDestination(dest) {
    const t = (dest || "").split(",")[0]?.trim();
    return t || "";
  }

  // Keep Day Trip to single date (mirror start->end)
  useEffect(() => {
    if (dayTripSelected && start && start !== end) setValue("end_date", start);
  }, [dayTripSelected, start, end, setValue]);

  // ---- Destination autosuggest (Places API) ----
  useEffect(() => {
    const q = (destination || "").trim();
    if (q.length < 2) {
      setDestSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const run = async () => {
      try {
        const res = await fetch(`/api/places?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
          headers: { "Cache-Control": "no-store" },
        });
        if (!res.ok) {
          setDestSuggestions([]);
          return;
        }
        const data = await res.json();
        const items = Array.isArray(data?.results)
          ? data.results
              .map((entry) => entry?.label || entry?.full || "")
              .filter(Boolean)
          : [];
        setDestSuggestions(items.slice(0, 8));
      } catch {
        setDestSuggestions([]);
      }
    };
    const t = setTimeout(run, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [destination]);

  // ---- Airport lookup (local dataset) ----
  useEffect(() => {
    const q = (airportQuery || "").trim();
    if (!modes.includes("fly")) {
      setAirportOptions([]);
      return;
    }
    if (q.length < 2) {
      setAirportOptions([]);
      return;
    }
    const ctrl = new AbortController();
    const run = async () => {
      try {
        const res = await fetch(`/api/airports?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
          headers: { "Cache-Control": "no-store" },
        });
        if (!res.ok) {
          setAirportOptions([]);
          return;
        }
        const data = await res.json();
        const items = Array.isArray(data?.airports) ? data.airports : [];
        const seen = new Set();
        const unique = [];
        items.forEach((item) => {
          const key = (item?.iata || item?.icao || item?.name || "").toLowerCase();
          if (!key || seen.has(key)) return;
          seen.add(key);
          unique.push(item);
        });
        setAirportOptions(unique.slice(0, 12));
      } catch {
        setAirportOptions([]);
      }
    };
    const t = setTimeout(run, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [airportQuery, modes]);

  // ---- Hotel name autosuggest (calls /api/hotels) (NEW) ----
  useEffect(() => {
    const q = (hotelQuery || "").trim();
    const city =
      hotelDetectedCity ||
      hotelCityValue ||
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
        if (!res.ok) {
          setHotelOptions([]);
          return;
        }
        const data = await res.json();
        const items = Array.isArray(data?.hotels) ? data.hotels : [];
        const seen = new Set();
        const unique = [];
        items.forEach((item) => {
          const key = (item?.name || "").toLowerCase();
          if (!key || seen.has(key)) return;
          seen.add(key);
          unique.push(item);
        });
        setHotelOptions(unique.slice(0, 12));
      } catch {
        setHotelOptions([]);
      }
    };

    const t = setTimeout(run, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [accommodation, hotelQuery, hotelDetectedCity, destination, hotelCityValue]);

  const onSubmit = async (values) => {
    setErrorWx("");
    setLoadingMsgIndex(0);
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

    const selectedModesList = Array.isArray(values.modes)
      ? values.modes.filter(Boolean)
      : [];
    const selectedModes = selectedModesList.length ? selectedModesList : ["fly"];
    const logisticsForm = values.logistics || {};

    const trip_input = {
      modes: selectedModes,
      trip_type: values.trip_type,
      destination: values.destination.trim(),
      start_date: values.start_date,
      end_date: selectedModes.includes("day_trip")
        ? values.start_date
        : values.end_date || values.start_date,
      accommodation: values.accommodation || "",
      transportation: values.transportation || "",
      travelers: cleanedTravelers,
      context_flags: values.context_flags,
      activities,
      accessibility: values.accessibility,
      logistics: {
        ...(selectedModes.includes("fly") ? { fly: logisticsForm.fly } : {}),
        ...(selectedModes.includes("drive") ? { drive: logisticsForm.drive } : {}),
        ...(selectedModes.includes("cruise") ? { cruise: logisticsForm.cruise } : {}),
        ...(selectedModes.includes("day_trip") ? { day_trip: logisticsForm.day_trip } : {}),
        ...(values.accommodation === "hotel"
          ? {
              hotel: {
                name: logisticsForm?.hotel?.name || hotelQuery,
                city:
                  logisticsForm?.hotel?.city ||
                  hotelDetectedCity ||
                  cityFromDestination(values.destination),
              },
            }
          : {}),
      },
      ...(values.accommodation === "hotel"
        ? {
            hotel_input: {
              name: (logisticsForm?.hotel?.name || hotelQuery || "").trim(),
              city_hint:
                (
                  logisticsForm?.hotel?.city ||
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

    const plan = buildPlan(payload);

    let enhancedPlan = plan;
    let aiState = {};

    try {
      const planRes = await fetch(`/api/plan?cb=${Date.now()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const planJson = await planRes.json();

      if (planRes.ok && planJson?.ai) {
        aiState = planJson.ai;
        enhancedPlan = mergeAiIntoPlan(plan, planJson.ai);
      } else {
        aiState = { error: planJson?.error || "AI unavailable" };
      }
    } catch (e) {
      console.error("Plan API error:", e);
      aiState = { error: "AI unavailable" };
    } finally {
      setSubmitted({ ...payload, _plan: enhancedPlan, ai: aiState });
      setLoadingWx(false);
    }

  };//

  const currentLoadingMessage = LOADING_MESSAGES[loadingMsgIndex] || LOADING_MESSAGES[0];

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
        {/* Travel Modes */}
        <section style={card}>
          <div style={{ marginBottom: 10, fontWeight: 700 }}>Step 1: Travel Modes</div>
          <Controller
            control={control}
            name="modes"
            rules={{
              validate: (value) =>
                Array.isArray(value) && value.length > 0
                  ? true
                  : "Please choose at least one travel mode.",
            }}
            render={({ field }) => {
              const value = Array.isArray(field.value) ? field.value : [];
              const toggle = (modeKey) => {
                if (modeKey === "day_trip") {
                  field.onChange(value.includes("day_trip") ? [] : ["day_trip"]);
                  return;
                }
                const set = new Set(value.filter(Boolean));
                if (set.has(modeKey)) {
                  set.delete(modeKey);
                } else {
                  set.add(modeKey);
                }
                set.delete("day_trip");
                field.onChange(Array.from(set));
              };
              return (
                <div style={row}>
                  {TRAVEL_MODE_OPTIONS.map((opt) => (
                    <label
                      key={opt.key}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        border: "1px solid #ddd",
                        borderRadius: 10,
                        padding: "8px 12px",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        opacity:
                          opt.key !== "day_trip" && value.includes("day_trip") ? 0.6 : 1,
                      }}
                      title={opt.title || opt.label}
                    >
                      <input
                        type="checkbox"
                        value={opt.key}
                        checked={value.includes(opt.key)}
                        onChange={() => toggle(opt.key)}
                        onBlur={field.onBlur}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              );
            }}
          />
          {errors.modes && (
            <div style={{ color: "crimson" }}>
              {errors.modes.message || "Please choose at least one travel mode."}
            </div>
          )}
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
              <label style={label}>{dayTripSelected ? "Date (Same Day)" : "End Date"}</label>
              <input
                type="date"
                {...register("end_date", { required: !dayTripSelected })}
                style={input}
                disabled={dayTripSelected}
                min={endMin}
              />
              {!dayTripSelected && errors.end_date && (
                <div style={{ color: "crimson" }}>End date is required.</div>
              )}
              {!dayTripSelected && start && end && end < start && (
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

          {includesMode("fly") && (
            <div style={row}>
              <div style={field}>
                <label style={label}>Departure Airport</label>
                <Controller
                  control={control}
                  name="logistics.fly.departure_airport"
                  rules={{ required: true }}
                  render={({ field }) => (
                    <>
                      <input
                        {...field}
                        list="airport-options"
                        placeholder="Start typing an airport code or name"
                        value={airportQuery}
                        onChange={(e) => {
                          const v = e.target.value;
                          setAirportQuery(v);
                          field.onChange(v);
                        }}
                        onBlur={field.onBlur}
                        style={input}
                      />
                      <datalist id="airport-options">
                        {airportOptions.map((opt, idx) => {
                          const locationBits = [opt?.city, opt?.state, opt?.country].filter(Boolean).join(", ");
                          const label = [
                            opt?.iata || opt?.icao || null,
                            opt?.name || null,
                            locationBits ? `(${locationBits})` : null,
                          ]
                            .filter(Boolean)
                            .join(" ");
                          const value = opt?.iata || opt?.icao || opt?.name || "";
                          return (
                            <option
                              key={`airport-${opt?.iata || opt?.icao || idx}`}
                              value={value}
                              label={label}
                            />
                          );
                        })}
                      </datalist>
                    </>
                  )}
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

          {includesMode("drive") && (
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

          {includesMode("cruise") && (
            <>
              <div style={row}>
                <div style={field}>
                  <label style={label}>Cruise Line</label>
                  <input
                    placeholder="e.g., Disney Cruise Line"
                    {...register("logistics.cruise.cruise_line", { required: true })}
                    style={input}
                  />
                </div>
                <div style={field}>
                  <label style={label}>Ship Name</label>
                  <input
                    placeholder="e.g., Disney Wish"
                    {...register("logistics.cruise.ship_name", { required: true })}
                    style={input}
                  />
                </div>
                <div style={field}>
                  <label style={label}>Embarkation Port</label>
                  <input
                    placeholder="City, Country"
                    {...register("logistics.cruise.embark_port", { required: true })}
                    style={input}
                  />
                </div>
              </div>
              <div style={row}>
                <div style={field}>
                  <label style={label}>Embarkation Time (local)</label>
                  <input
                    type="datetime-local"
                    {...register("logistics.cruise.embark_time_local")}
                    style={input}
                  />
                </div>
                <div style={field}>
                  <label style={label}>Disembark Port</label>
                  <input
                    placeholder="Final port"
                    {...register("logistics.cruise.disembark_port")}
                    style={input}
                  />
                </div>
              </div>
            </>
          )}

          {dayTripSelected && (

            <div style={row}>
              <div style={field}>
                <label style={label}>Transport</label>
                <select {...register("logistics.day_trip.transport")} style={input}>
                  <option value="car">Car</option>
                  <option value="train">Train</option>
                  <option value="subway">Subway/Metro</option>
                  <option value="taxi">Taxi/Rideshare</option>
                  <option value="walk">Walking</option>
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
                    const match = hotelOptions.find(
                      (h) => (h?.name || "").toLowerCase() === v.toLowerCase()
                    );
                    if (match) {
                      const cityGuess = [match.city, match.state, match.country].filter(Boolean).join(", ");
                      if (cityGuess) {
                        setHotelDetectedCity(cityGuess);
                        setValue("logistics.hotel.city", cityGuess);
                      }
                    }
                  }}
                  style={input}
                />
                <datalist id="hotel-options">
                  {hotelOptions.map((h, i) => {
                    const detail = [h.city, h.state, h.country].filter(Boolean).join(", ");
                    const label = detail ? `${h.name} - ${detail}` : h.name;
                    return (
                      <option key={i} value={h.name} label={label} />
                    );
                  })}
                </datalist>
              </div>

              <div style={field}>
                <label style={label}>Hotel City (auto)</label>
                <input
                  placeholder="City"
                  value={
                    hotelDetectedCity ||
                    hotelCityValue ||
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
              border: "1px solid #3f7077",
              background: loadingWx ? "#88b7bc" : "#569096",
              color: "#ffffff",
              fontWeight: 700,
              cursor: loadingWx ? "not-allowed" : "pointer",
              opacity: loadingWx ? 0.8 : 1,
            }}
          >
            {loadingWx ? currentLoadingMessage : "?? Create My Trip Prep Plan"}
          </button>

          {loadingWx && <span aria-live="polite">{currentLoadingMessage}</span>}
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
