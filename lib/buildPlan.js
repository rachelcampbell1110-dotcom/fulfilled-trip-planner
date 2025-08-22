// lib/buildPlan.js
export function buildPlan(payload) {
  const t = payload?.trip_input || {};
  const dates = { start: t.start_date, end: t.end_date || t.start_date };

  // ---- Travelers ----
  const travelers = Array.isArray(t.travelers) ? t.travelers : [];
  const adults = travelers.filter(p => (p.type || "adult") === "adult");
  const children = travelers.filter(p => (p.type || "adult") !== "adult");

  // ---- Packing seeds ----
  const baseCommon = [
    "Photo ID / Passports",
    "Wallet & travel cards",
    "Phone & charger",
    "Medications + mini first-aid",
    "Toiletries (toothbrush, travel-size liquids)",
    "Sleepwear, underwear, socks",
    "Outfits for each day + 1 spare",
  ];

  const acts = t.activities || [];
  const activityAdds = [];
  if (acts.includes("lots_of_walking")) activityAdds.push("Comfortable walking shoes", "Blister bandages");
  if (acts.includes("fancy_dinner")) activityAdds.push("Nice outfit", "Dress shoes", "Restaurant reservation details");
  if (acts.includes("beach")) activityAdds.push("Swimsuit", "Cover-up", "Reef-safe sunscreen", "Flip-flops");
  if (acts.includes("pool")) activityAdds.push("Swimsuit", "Goggles", "Swim diapers (if needed)");
  if (acts.includes("hiking")) activityAdds.push("Daypack", "Reusable water bottle", "Bug spray");
  if (acts.includes("boating_snorkeling")) activityAdds.push("Rash guard", "Snorkel set", "Dry bag");
  if (acts.includes("skiing_snow")) activityAdds.push("Base layers", "Gloves", "Beanie", "Hand warmers");
  if (acts.includes("theme_park")) activityAdds.push("Portable phone battery", "Cooling towel", "Clear stadium/park-approved bag");

  // Lodging & transport adjustments
  const lodgingStr = (t.accommodation || "").toLowerCase();
  if (lodgingStr.includes("family") || lodgingStr.includes("relative")) {
    activityAdds.push("Small thank-you gift for host", "House slippers / comfy clothes");
  }
  const transportStr = (t.transportation || "").toLowerCase();
  if (transportStr.includes("subway") || transportStr.includes("train")) {
    activityAdds.push("Transit card/app set up", "Light day bag with zipper");
  } else if (transportStr.includes("car")) {
    activityAdds.push("Car snacks", "Car phone mount", "Charging cable (car)");
  }

  // Weather hints (if provided)
  const wx = t.weather_summary || {};
  const wxAdds = [];
  const avgHigh = wx.avg_high_f ?? wx?.summary?.avg_high_f;
  const avgLow  = wx.avg_low_f  ?? wx?.summary?.avg_low_f;
  if (typeof avgHigh === "number" && avgHigh >= 80) {
    wxAdds.push("Extra sunscreen", "Hat / sunglasses");
  }
  if (typeof avgLow === "number" && avgLow <= 45) {
    wxAdds.push("Warm jacket / layers", "Gloves / scarf");
  }
  const wetPct = wx.wet_days_pct ?? wx?.summary?.wet_days_pct;
  if (typeof wetPct === "number" && wetPct >= 30) {
    wxAdds.push("Compact umbrella / rain jacket");
  }

  // Child adds
  const childCommon = [
    "Favorite snack",
    "Lightweight jacket / extra layer",
    "Entertainment (small toys, tablet & headphones)",
  ];
  const babyAdds = ["Diapers / wipes", "Stroller", "Snack cups", "Change of clothes (extra)"];

  // Per-person lists
  const byPerson = {};
  travelers.forEach(p => {
    const name = p.name?.trim() || (p.type === "child" ? "Child" : "Adult");
    let list = [...baseCommon, ...activityAdds, ...wxAdds];

    if (p.type === "child") {
      list = [...list, ...childCommon];
      if (typeof p.age === "number" && p.age <= 3) list = [...list, ...babyAdds];
      if (acts.includes("theme_park")) list.push("Stroller tag / identifier");
    } else {
      if (t.mode === "fly") list.push("TSA-size liquids", "Travel pillow (optional)");
    }

    byPerson[name] = Array.from(new Set(list));
  });

  const combined = Array.from(new Set(Object.values(byPerson).flat()));

  // ---- Timeline helpers (merge & order) ----
  const CANON_ORDER = ["T-14", "T-7", "T-3", "T-1", "Day of"];
  function mergeTimeline(entries) {
    const map = new Map(); // day -> Set(tasks)
    for (const e of entries) {
      const day = String(e?.day ?? e?.when ?? "").trim();
      if (!day) continue;
      const tasks = Array.isArray(e?.tasks)
        ? e.tasks.map(String).filter(Boolean)
        : [String(e?.tasks || "")].filter(Boolean);
      if (!map.has(day)) map.set(day, new Set());
      const set = map.get(day);
      tasks.forEach(t => set.add(t));
    }
    const knownDays = CANON_ORDER
      .filter(d => map.has(d))
      .map(d => ({ day: d, tasks: Array.from(map.get(d)) }));
    const extraDays = Array.from(map.keys())
      .filter(d => !CANON_ORDER.includes(d))
      .sort()
      .map(d => ({ day: d, tasks: Array.from(map.get(d)) }));
    return [...knownDays, ...extraDays];
  }

  // Baseline timeline (+ optional venue item that will be merged into the same T-3)
  const baselineTimeline = [
    { day: "T-14", tasks: ["Start a shared packing list", "Check ID/passports and meds refills"] },
    { day: "T-7",  tasks: ["Confirm tickets/reservations", "Arrange pet/house care if needed"] },
    { day: "T-3",  tasks: ["Begin staging outfits", "Buy missing toiletries/snacks"] },
    { day: "T-1",  tasks: ["Charge electronics", "Pack carry-on with essentials"] },
    { day: "Day of", tasks: ["Leave on time", "Final house checklist (trash, thermostat)"] },
  ];
  if (acts.some(a => ["sports_event", "concert_show", "theme_park"].includes(a))) {
    baselineTimeline.push({ day: "T-3", tasks: ["Check venue bag policy; consider clear stadium bag"] });
  }

  const timeline = mergeTimeline(baselineTimeline);

  // Basics
  const basics = {
    destination: t.destination,
    dates,
    travelers: {
      total: travelers.length,
      adults: adults.length,
      children: children.length,
      names: travelers.map(p => p.name).filter(Boolean),
    },
    accommodation: t.accommodation || "",
    transportation:
      t.transportation ||
      (t.mode === "fly" ? "subway/taxi/walking" : t.mode === "drive" ? "car" : ""),
  };

  // Weather (normalized)
  const weather = {
    avg_high_f: avgHigh ?? null,
    avg_low_f:  avgLow  ?? null,
    wet_days_pct: typeof wetPct === "number" ? wetPct : null,
    notes: wx.notes || "",
    matched_location: wx.matched_location || null,
  };

  // Overpack guard (optional UX)
  const overpack = {
    skip: [
      "Third pair of jeans",
      "Duplicate bulky sweatshirts",
      "Full-size toiletries",
      "Too many ‘just in case’ shoes",
    ],
    lastMinute: ["White noise app download", "Nightlight", "Sound machine batteries", "Favorite blanket"],
    housePrep: ["Hold mail", "Run dishwasher", "Empty trash", "Set thermostat"],
  };

  // Infant/toddler lodging checklist (optional UX)
  const lodging = {
    infantToddler: [
      "Crib/pack-n-play (confirm availability or bring travel crib)",
      "Blackout solution (travel curtains/tape)",
      "Sound machine / app",
      "Monitor (if needed)",
      "Favorite sleep sack / lovey",
    ],
  };

  return {
    basics,
    activities: acts,
    weather,
    timeline,
    packing: { byPerson, combined },
    overpack,
    lodging,
  };
}