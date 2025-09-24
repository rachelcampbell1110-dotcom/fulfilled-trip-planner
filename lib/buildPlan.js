// lib/buildPlan.js
export function buildPlan(payload) {
  const t = payload?.trip_input || {};
  const dates = { start: t.start_date, end: t.end_date || t.start_date };
  const modes = Array.isArray(t.modes) ? t.modes.filter(Boolean) : t.mode ? [t.mode] : [];
  const hasMode = (key) => modes.includes(key);
  const MODE_LABELS = {
    fly: "Fly",
    drive: "Drive / Road Trip",
    cruise: "Cruise",
    day_trip: "Day Trip",
  };

  // ---- Activity label map (for pretty display) ----
  const ACTIVITY_LABELS = {
    lots_of_walking: "Lots of walking",
    fancy_dinner: "Fancy dinner",
    beach: "Beach",
    pool: "Pool",
    hiking: "Hiking",
    boating_snorkeling: "Boating / Snorkeling",
    skiing_snow: "Skiing / Snow play",
    sports_event: "Sports event",
    concert_show: "Concert / Show",
    museums_tours: "Museums / Tours",
    fishing: "Fishing",
    camping: "Camping",
    theme_park: "Theme Park",
  };
  const prettyActivity = (a) =>
  ACTIVITY_LABELS[a] || a.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

  // Normalize travelers (do NOT force blank age to 0)
  const travelers = Array.isArray(t.travelers) ? t.travelers.map(p => {
    const ageNum = (p.age === "" || p.age === null || typeof p.age === "undefined")
      ? null
      : Number(p.age);
    return {
      ...p,
      age: Number.isFinite(ageNum) ? ageNum : null,
      type: p.type === "child" ? "child" : "adult",
      name: (p.name || "").trim(),
    };
  }) : [];

  const adults   = travelers.filter(p => p.type === "adult");
  const children = travelers.filter(p => p.type === "child");

  const contextFlags = t.context_flags || {};
  const tripType = (t.trip_type || "").toLowerCase();
  const isWorkTrip = tripType === "work";
  const isWorkBlend = tripType === "both";
  const hasKids = children.length > 0;
  const travelingSolo = Boolean(contextFlags.traveling_solo) || travelers.length <= 1;
  const travelingWithFriends = Boolean(contextFlags.traveling_with_friends);
  const agesChildren = children
    .map(p => (Number.isFinite(p.age) ? p.age : null))
    .filter(a => a !== null);
  const youngestChildAge = agesChildren.length ? Math.min(...agesChildren) : null;
  const hasInfantOrToddler = agesChildren.some(a => a <= 2);

  // Base packing sets
  const baseCommon = [
    "Photo ID / Passports",
    "Wallet & travel cards",
    "Phone & charger",
    "Medications + mini first-aid",
    "Toiletries (toothbrush, travel-size liquids)",
    "Sleepwear, underwear, socks",
    "Outfits for each day + 1 spare",
  ];

  const addItem = (collection, item, essential = false) => {
    if (!item) return;
    collection.push({ item, essential: Boolean(essential) });
  };

  const acts = Array.isArray(t.activities) ? t.activities : [];
  const lodgingType = (t.accommodation || "").toLowerCase();
  const stayingHotel = lodgingType === "hotel";
  const stayingWithFamily = lodgingType === "family";
  const stayingRental = lodgingType === "rental";
  const activityAdds = [];
  if (acts.includes("lots_of_walking")) {
    addItem(activityAdds, "Comfortable walking shoes", true);
    addItem(activityAdds, "Blister bandages");
  }
  if (acts.includes("fancy_dinner")) {
    addItem(activityAdds, "Nice outfit", true);
    addItem(activityAdds, "Dress shoes", true);
    addItem(activityAdds, "Restaurant reservation details");
  }
  if (acts.includes("beach")) {
    addItem(activityAdds, "Swimsuit", true);
    addItem(activityAdds, "Cover-up");
    addItem(activityAdds, "Reef-safe sunscreen", true);
    addItem(activityAdds, "Flip-flops");
  }
  if (acts.includes("pool")) {
    addItem(activityAdds, "Swimsuit", true);
    addItem(activityAdds, "Goggles");
  }
  if (acts.includes("hiking")) {
    addItem(activityAdds, "Daypack", true);
    addItem(activityAdds, "Reusable water bottle", true);
    addItem(activityAdds, "Bug spray");
  }
  if (acts.includes("boating_snorkeling")) {
    addItem(activityAdds, "Rash guard", true);
    addItem(activityAdds, "Snorkel set");
    addItem(activityAdds, "Dry bag");
  }
  if (acts.includes("skiing_snow")) {
    addItem(activityAdds, "Base layers", true);
    addItem(activityAdds, "Gloves", true);
    addItem(activityAdds, "Beanie", true);
    addItem(activityAdds, "Hand warmers");
  }
  if (acts.includes("fishing")) {
    addItem(activityAdds, "Fishing license/permits (if required)", true);
    addItem(activityAdds, "Compact tackle kit");
    addItem(activityAdds, "Waterproof gear bag");
  }
  if (acts.includes("camping")) {
    addItem(activityAdds, "Headlamp or flashlight", true);
    addItem(activityAdds, "Compact camp cookware");
    addItem(activityAdds, "Extra bug spray");
  }

  const OUTDOOR_ACTIVITIES = new Set([
    "beach",
    "pool",
    "hiking",
    "boating_snorkeling",
    "skiing_snow",
    "camping",
    "fishing",
    "sports_event",
    "theme_park",
  ]);
  if (acts.some((a) => OUTDOOR_ACTIVITIES.has(a))) {
    addItem(activityAdds, "Broad-spectrum sunscreen", true);
    addItem(activityAdds, "Sun hats or visors");
    addItem(activityAdds, "UV-blocking sunglasses");
  }
  if (acts.includes("theme_park")) {
    addItem(activityAdds, "Portable phone battery");
    addItem(activityAdds, "Cooling towel");
    addItem(activityAdds, "Clear stadium/park-approved bag", true);
  }

  const lodgingStr = (t.accommodation || "").toLowerCase();
  if (lodgingStr.includes("family") || lodgingStr.includes("relative")) {
    addItem(activityAdds, "Small thank-you gift for host");
    addItem(activityAdds, "House slippers / comfy clothes");
  }
  const transportStr = (t.transportation || "").toLowerCase();
  if (transportStr.includes("subway") || transportStr.includes("train")) {
    addItem(activityAdds, "Transit card/app set up", true);
    addItem(activityAdds, "Light day bag with zipper");
  }

  const addRoadTripBasics = () => {
    addItem(activityAdds, "Car snacks");
    addItem(activityAdds, "Car phone mount", true);
    addItem(activityAdds, "Charging cable (car)", true);
  };
  if (hasMode("drive")) {
    addRoadTripBasics();
  } else if (transportStr.includes("car")) {
    addRoadTripBasics();
  }

  if (hasMode("fly")) {
    addItem(activityAdds, "Download airline app & digital boarding passes", true);
    addItem(activityAdds, "Compression socks for long flights");
  }

  if (hasMode("cruise")) {
    addItem(activityAdds, "Cruise documents & luggage tags", true);
    addItem(activityAdds, "Lanyards for cruise cards");
    addItem(activityAdds, "Sea-sickness meds or bands", true);
    addItem(activityAdds, "Embarkation-day swim bag");
  }

  // Weather hints (if provided)
  const wx = t.weather_summary || {};
  const weatherAdds = [];
  const avgHigh = wx.avg_high_f ?? wx?.summary?.avg_high_f;
  const avgLow = wx.avg_low_f ?? wx?.summary?.avg_low_f;
  if (typeof avgHigh === "number" && avgHigh >= 80) {
    addItem(weatherAdds, "Extra sunscreen", true);
    addItem(weatherAdds, "Hat / sunglasses");
  }
  if (typeof avgLow === "number" && avgLow <= 45) {
    addItem(weatherAdds, "Warm jacket / layers", true);
    addItem(weatherAdds, "Gloves / scarf");
  }
  const wetPct = wx.wet_days_pct ?? wx?.summary?.wet_days_pct;
  if (typeof wetPct === "number" && wetPct >= 30) {
    addItem(weatherAdds, "Compact umbrella / rain jacket", true);
  }

  // Child adds
  const childCommon = [
    { item: "Favorite snack", essential: true },
    { item: "Lightweight jacket / extra layer", essential: true },
    { item: "Entertainment (small toys, tablet & headphones)", essential: false },
  ];
  const babyAdds = [
    { item: "Diapers / wipes", essential: true },
    { item: "Stroller", essential: true },
    { item: "Snack cups", essential: false },
    { item: "Change of clothes (extra)", essential: true },
  ];

  const workAddsAdult = [];
  if (isWorkTrip || isWorkBlend) {
    addItem(workAddsAdult, "Laptop + charger", true);
    addItem(workAddsAdult, "Work ID / badge", true);
    addItem(workAddsAdult, "Professional outfit for meetings", isWorkTrip);
    addItem(workAddsAdult, "Notebook & pen");
    if (isWorkTrip) addItem(workAddsAdult, "Slim business card holder");
  }

  const soloAdds = [];
  if (travelingSolo) {
    addItem(soloAdds, "Compact personal safety alarm");
    addItem(soloAdds, "Portable door lock / wedge (if allowed)");
  }

  // Build per-person lists
  const byPerson = {};
  const minimalByPerson = {};
  const applyEntries = (entries, ordered, seen) => {
    entries.forEach((entry) => {
      if (!entry || !entry.item) return;
      const label = entry.item.trim();
      if (!label) return;
      if (!seen.has(label)) {
        const obj = { item: label, essential: Boolean(entry.essential) };
        seen.set(label, obj);
        ordered.push(obj);
      } else if (entry.essential) {
        seen.get(label).essential = true;
      }
    });
  };

  travelers.forEach((p) => {
    const name = p.name?.trim() || (p.type === "child" ? "Child" : "Adult");
    const ordered = [];
    const seen = new Map();

    applyEntries(baseCommon.map((item) => ({ item, essential: true })), ordered, seen);
    applyEntries(activityAdds, ordered, seen);
    applyEntries(weatherAdds, ordered, seen);

    if (p.type === "child") {
      applyEntries(childCommon, ordered, seen);
      if (typeof p.age === "number" && p.age <= 3) applyEntries(babyAdds, ordered, seen);
      if ((acts.includes("pool") || acts.includes("beach")) && typeof p.age === "number" && p.age <= 3) {
        applyEntries([{ item: "Swim diapers (if needed)", essential: true }], ordered, seen);
      }
      if (acts.includes("theme_park")) applyEntries([{ item: "Stroller tag / identifier", essential: false }], ordered, seen);
    } else {
      if (hasMode("fly")) {
        applyEntries([{ item: "TSA-size liquids", essential: true }, { item: "Travel pillow (optional)", essential: false }], ordered, seen);
      }
      if (hasMode("cruise")) {
        applyEntries([{ item: "Motion-sickness remedy", essential: true }, { item: "Non-surge power strip (if allowed)", essential: false }], ordered, seen);
      }
      if (isWorkTrip || isWorkBlend) {
        applyEntries(workAddsAdult, ordered, seen);
      }
    }

    applyEntries(soloAdds, ordered, seen);

    const list = ordered.map((entry) => entry.item);
    const minimalList = ordered.filter((entry) => entry.essential).map((entry) => entry.item);
    byPerson[name] = Array.from(new Set(list));
    minimalByPerson[name] = Array.from(new Set(minimalList));
  });

  if (!Object.keys(byPerson).length) {
    const fallbackName = travelingSolo ? "Traveler" : "Adult";
    const ordered = [];
    const seen = new Map();
    applyEntries(baseCommon.map((item) => ({ item, essential: true })), ordered, seen);
    applyEntries(activityAdds, ordered, seen);
    applyEntries(weatherAdds, ordered, seen);
    applyEntries(workAddsAdult, ordered, seen);
    applyEntries(soloAdds, ordered, seen);
    const list = ordered.map((entry) => entry.item);
    const minimalList = ordered.filter((entry) => entry.essential).map((entry) => entry.item);
    byPerson[fallbackName] = Array.from(new Set(list));
    minimalByPerson[fallbackName] = Array.from(new Set(minimalList));
  }

  // Combined list (de-duped)
  const combined = Array.from(new Set(Object.values(byPerson).flat()));
  const minimalCombined = Array.from(new Set(Object.values(minimalByPerson).flat()));

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
      tasks.forEach((t) => set.add(t));
    }

    const knownDays = CANON_ORDER.filter((d) => map.has(d)).map((d) => ({
      day: d,
      tasks: Array.from(map.get(d)),
    }));

    const extraDays = Array.from(map.keys())
      .filter((d) => !CANON_ORDER.includes(d))
      .sort()
      .map((d) => ({ day: d, tasks: Array.from(map.get(d)) }));

    return [...knownDays, ...extraDays];
  }

  // Baseline timeline
  const baselineTimeline = [
    { day: "T-14", tasks: ["Start a shared packing list", "Check ID/passports and meds refills"] },
    { day: "T-7", tasks: ["Confirm tickets/reservations", "Arrange pet/house care if needed"] },
    { day: "T-3", tasks: ["Begin staging outfits", "Buy missing toiletries/snacks", "Get small bills for tips"] },
    { day: "T-1", tasks: ["Charge electronics", "Pack carry-on with essentials"] },
    { day: "Day of", tasks: ["Leave on time", "Final house checklist (trash, thermostat)"] },
  ];

  const addTimelineTasks = (day, items) => {
    if (!Array.isArray(items) || items.length === 0) return;
    const existing = baselineTimeline.find((entry) => entry.day === day);
    if (existing) {
      items.forEach((task) => {
        if (task && !existing.tasks.includes(task)) existing.tasks.push(task);
      });
    } else {
      baselineTimeline.push({ day, tasks: items.filter(Boolean) });
    }
  };

  if (isWorkTrip || isWorkBlend) {
    baselineTimeline.push({
      day: "T-7",
      tasks: ["Confirm meeting agenda & addresses"],
    });
    baselineTimeline.push({
      day: "T-3",
      tasks: ["Finalize presentation materials / talking points"],
    });
    baselineTimeline.push({
      day: "T-1",
      tasks: ["Set out-of-office reply and status message"],
    });
  }

  if (travelingWithFriends) {
    addTimelineTasks("T-7", ["Coordinate arrival times and rides with friends", "Confirm shared reservations or split costs"]);
    addTimelineTasks("T-3", ["Share packing plans or carpool details in the group chat"]);
    addTimelineTasks("Day of", ["Touch base with friends about meetup point and backups"]);
  }

  if (hasInfantOrToddler) {
    addTimelineTasks("T-7", ["Confirm crib/pack-n-play availability with your lodging"]);
    addTimelineTasks("T-3", ["Restock diapers, wipes, and baby snacks"]);
    addTimelineTasks("T-1", ["Pre-pack the diaper/baby day bag for travel day"]);
  }

  if (travelingSolo) {
    baselineTimeline.push({
      day: "T-3",
      tasks: ["Share itinerary with a trusted contact"],
    });
    baselineTimeline.push({
      day: "T-1",
      tasks: ["Enable location sharing / safety check-in plan"],
    });
  }

  if (stayingHotel) {
    baselineTimeline.push({
      day: "T-7",
      tasks: ["Confirm hotel reservation details and note check-in times"],
    });
    baselineTimeline.push({
      day: "T-1",
      tasks: ["Check in online or set up the hotel app for digital keys"],
    });
    baselineTimeline.push({
      day: "Day of",
      tasks: ["Have ID and credit card ready for hotel check-in"],
    });
  }

  if (stayingWithFamily) {
    baselineTimeline.push({
      day: "T-7",
      tasks: ["Coordinate arrival timing and plans with your hosts"],
    });
    baselineTimeline.push({
      day: "T-1",
      tasks: ["Pack a thank-you gift or treats for your hosts"],
    });
    baselineTimeline.push({
      day: "Day of",
      tasks: ["Send your hosts an updated ETA before you leave"],
    });
  }

  if (stayingRental) {
    baselineTimeline.push({
      day: "T-7",
      tasks: ["Review rental check-in instructions and parking details"],
    });
    baselineTimeline.push({
      day: "T-1",
      tasks: ["Verify lockbox or smart lock codes and Wi-Fi info"],
    });
    baselineTimeline.push({
      day: "Day of",
      tasks: ["Follow the self check-in steps and note any arrival issues"],
    });
  }

  // Add theme/stadium T-3 task (will merge with other T-3 tasks)
  if (acts.some((a) => ["sports_event", "concert_show", "theme_park"].includes(a))) {
    baselineTimeline.push({
      day: "T-3",
      tasks: ["Check venue bag policy; consider clear stadium bag"],
    });
  }

  // Merge & sort timeline, eliminating duplicate-day lines and duplicate tasks
  const timeline = mergeTimeline(baselineTimeline);

  // --- Basics summary used by PlanPreview (add agesChildren + hasInfantOrToddler) ---
  const basics = {
    destination: t.destination,
    dates,
    travelers: {
      total: travelers.length,
      adults: adults.length,
      children: children.length,
      names: travelers.map(p => p.name).filter(Boolean),
      agesChildren, // <- only children's ages
      ages: agesChildren,
      youngestChild: youngestChildAge,
    },
    accommodation: t.accommodation || "",
    transportation:
      t.transportation ||
      (modes.length
        ? modes.map((m) => MODE_LABELS[m] || m).join(", ")
        : ""),
    modes,
    hasInfantOrToddler, // <- explicit flag
  };

  // Weather shape expected by PlanPreview
  const weather = {
    avg_high_f: avgHigh ?? null,
    avg_low_f: avgLow ?? null,
    wet_days_pct: typeof wetPct === "number" ? wetPct : null,
    notes: wx.notes || "",
    matched_location: wx.matched_location || null,
  };

  // Overpack guard (optional UX content)
  const uniqList = (...groups) => {
    const seen = new Set();
    const list = [];
    groups.forEach((group) => {
      if (!group) return;
      const arr = Array.isArray(group) ? group : [group];
      arr.forEach((item) => {
        if (!item || typeof item !== "string") return;
        const trimmed = item.trim();
        if (!trimmed || seen.has(trimmed)) return;
        seen.add(trimmed);
        list.push(trimmed);
      });
    });
    return list;
  };

  const skipBase = [
    "Third pair of jeans",
    "Duplicate bulky sweatshirts",
    "Full-size toiletries",
    'Too many "just in case" shoes',
  ];
  const skipAdultsOnly = [
    "Multiple formal outfits you'll never wear",
    "Stack of unread books (pick one favorite)",
  ];
  const skipWithKids = [
    "Half the toy bin (let kids pick one or two favorites)",
    "Duplicate bedtime loveys",
    "Bulky baby gear your lodging can provide",
  ];
  const skipWork = [
    "Extra office supplies you can print onsite",
    "Large sample kits unless meetings require them",
  ];
  const skipSolo = [
    "Oversized suitcase - keep it carry-on friendly if you can",
  ];
  const skipHotel = [
    "Towels and extra bedding (request more from the hotel if needed)",
    "In-room coffee makers or kettles (the hotel already has them)",
  ];
  const skipFamily = [
    "Extra linens your hosts already have ready",
    "Overflow toiletries your hosts stock at home",
  ];
  const skipRental = [
    "Kitchen appliances on the rental amenities list",
    "Bulk paper goods if the rental stocks basics",
  ];

  const lastMinuteBase = [
    "Wallet, ID, and travel cards",
    "Phone charger and portable battery",
    "Reusable water bottle",
    "Medications and daily vitamins",
  ];
  const lastMinuteAdultsOnly = [
    "Noise-cancelling headphones",
    "Travel-size toiletries bag",
    "Offline copies of confirmations",
  ];
  const lastMinuteWithKids = [
    "Bedtime comfort item for each kid",
    "Charged tablet or activity kit",
    "Sound machine batteries or white noise app",
  ];
  const lastMinuteWork = [
    "Laptop and charger",
    "Access badge or keycard",
    "Presentation backup on a USB or cloud link",
  ];
  const lastMinuteSolo = [
    "Personal safety alarm or door wedge",
    "Emergency contact card tucked in your bag",
  ];
  const lastMinuteHotel = [
    "Hotel confirmation number and loyalty card",
    "Tip cash for housekeeping",
    "Download or refresh the hotel app for digital keys",
  ];
  const lastMinuteFamily = [
    "Host thank-you gift",
    "Favorite snacks or breakfast items to share",
  ];
  const lastMinuteRental = [
    "Lockbox or smart lock code saved offline",
    "Reusable grocery bags for a first-day shop",
  ];

  const housePrepBase = [
    "Hold mail or pause deliveries",
    "Run dishwasher",
    "Empty trash and fridge leftovers",
    "Set thermostat or smart home schedule",
  ];
  const housePrepWithKids = [
    "Leave caregiver schedule or school notes",
    "Set out kid snacks or breakfast for travel morning",
  ];
  const housePrepWork = [
    "Update calendar status for teammates",
    "Schedule bill payments that come due while you're gone",
  ];
  const housePrepSolo = [
    "Share itinerary and lodging details with a trusted contact",
    "Set lights or smart plugs on timers",
  ];
  const housePrepHotel = [
    "Confirm parking, resort fees, or shuttle details with the hotel",
  ];
  const housePrepFamily = [
    "Coordinate house rules or allergies with your hosts",
  ];
  const housePrepRental = [
    "Review the rental house manual for trash and Wi-Fi info",
  ];

  const overpack = {
    skip: uniqList(
      skipBase,
      hasKids ? skipWithKids : skipAdultsOnly,
      isWorkTrip || isWorkBlend ? skipWork : null,
      travelingSolo ? skipSolo : null,
      stayingHotel ? skipHotel : null,
      stayingWithFamily ? skipFamily : null,
      stayingRental ? skipRental : null
    ),
    lastMinute: uniqList(
      lastMinuteBase,
      hasKids ? lastMinuteWithKids : lastMinuteAdultsOnly,
      isWorkTrip || isWorkBlend ? lastMinuteWork : null,
      travelingSolo ? lastMinuteSolo : null,
      stayingHotel ? lastMinuteHotel : null,
      stayingWithFamily ? lastMinuteFamily : null,
      stayingRental ? lastMinuteRental : null
    ),
    housePrep: uniqList(
      housePrepBase,
      hasKids ? housePrepWithKids : null,
      isWorkTrip || isWorkBlend ? housePrepWork : null,
      travelingSolo ? housePrepSolo : null,
      stayingHotel ? housePrepHotel : null,
      stayingWithFamily ? housePrepFamily : null,
      stayingRental ? housePrepRental : null
    ),
  };

  // Infant/toddler lodging checklist (optional UX content)
  const lodging = {};
  if (hasInfantOrToddler) {
    lodging.infantToddler = [
      "Crib/pack-n-play (confirm availability or bring travel crib)",
      "Blackout solution (travel curtains/tape)",
      "Sound machine / app",
      "Monitor (if needed)",
      "Favorite sleep sack / lovey",
    ];
  }

  // Pretty activity names for display
  const activitiesPretty = acts.map(
    (k) => ACTIVITY_LABELS[k] || k.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())
  );

  return {
    basics,
    activities: activitiesPretty,
    weather,
    timeline,
    packing: { byPerson, combined, minimalByPerson, minimalCombined },
    overpack,
    lodging,
  };
}
