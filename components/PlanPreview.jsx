// components/PlanPreview.jsx
"use client";
import { useEffect, useMemo, useRef, useState } from "react";

const THEME_PRIMARY = "#569096";
const THEME_PRIMARY_DARK = "#3f7077";
const THEME_LIGHT = "#f4f8f9";

export default function PlanPreview({ plan, ai, loadingAi = false }) {
  if (!plan) return null;

  // Local editable copy (for add-item UX)
  const [localPlan, setLocalPlan] = useState(plan);
  useEffect(() => setLocalPlan(plan), [plan]);

  // --- Merge AI output when it arrives ---
  useEffect(() => {
    if (!ai || ai.error) return;

    setLocalPlan((prev) => {
      const next = structuredClone(prev || {});
      // trip blurb
      if (typeof ai.trip_blurb === "string" && ai.trip_blurb.trim()) {
        next.ai_blurb = ai.trip_blurb.trim();
      }
      // venue tips
      if (Array.isArray(ai.venue_bag_policy_tips)) {
        next.ai_venue_tips = Array.from(new Set([...(next.ai_venue_tips || []), ...ai.venue_bag_policy_tips]));
      }

      // packing additions (add to combined + per-person)
      if (Array.isArray(ai.packing_additions) && ai.packing_additions.length) {
        next.packing = next.packing || { byPerson: {}, combined: [] };
        const cset = new Set(next.packing.combined || []);
        ai.packing_additions.forEach((x) => x && cset.add(x));
        next.packing.combined = Array.from(cset);

        const names = Object.keys(next.packing.byPerson || {});
        names.forEach((nm) => {
          const pset = new Set(next.packing.byPerson[nm] || []);
          ai.packing_additions.forEach((x) => x && pset.add(x));
          next.packing.byPerson[nm] = Array.from(pset);
        });
      }

      // overpack additions
      next.overpack = next.overpack || { skip: [], lastMinute: [], housePrep: [] };
      const ok = ai.overpack_additions || {};
      ["skip", "lastMinute", "housePrep"].forEach((k) => {
        const adds = Array.isArray(ok[k]) ? ok[k] : [];
        if (!adds.length) return;
        const set = new Set(next.overpack[k] || []);
        adds.forEach((x) => x && set.add(x));
        next.overpack[k] = Array.from(set);
      });

      // timeline additions
      const CANON = ["T-14", "T-7", "T-3", "T-1", "Day of"];
      next.timeline = Array.isArray(next.timeline) ? [...next.timeline] : [];
      const addsTL = Array.isArray(ai.timeline_additions) ? ai.timeline_additions : [];
      addsTL.forEach((ent) => {
        const day = (ent?.day || "").trim();
        const tasks = (Array.isArray(ent?.tasks) ? ent.tasks : []).filter(Boolean);
        if (!day || !tasks.length) return;
        const idx = next.timeline.findIndex((e) => (e?.day || e?.when) === day);
        if (idx >= 0) {
          const s = new Set(next.timeline[idx].tasks || []);
          tasks.forEach((t) => s.add(t));
          next.timeline[idx].tasks = Array.from(s);
        } else {
          next.timeline.push({ day, tasks: Array.from(new Set(tasks)) });
        }
      });
      // sort known days canonical first
      next.timeline = [
        ...CANON.filter((d) => next.timeline.some((e) => (e.day || e.when) === d)).map((d) =>
          next.timeline.find((e) => (e.day || e.when) === d)
        ),
        ...next.timeline.filter((e) => !CANON.includes(e.day || e.when)),
      ].filter(Boolean);

      if (Array.isArray(ai.smart_must_haves) && ai.smart_must_haves.length) {
        const set = new Set(next.smart_must_haves || []);
        ai.smart_must_haves.forEach((item) => {
          if (item && typeof item === "string") set.add(item);
        });
        next.smart_must_haves = Array.from(set);
      }

      return next;
    });
  }, [ai]);

  const [packingMode, setPackingMode] = useState("person");
  const [minimalistMode, setMinimalistMode] = useState(false);
  const [newCombinedItem, setNewCombinedItem] = useState("");
  const [newPersonItems, setNewPersonItems] = useState({});
  const [newOverpack, setNewOverpack] = useState({ skip: "", lastMinute: "", housePrep: "" });
  const [newTimelineDay, setNewTimelineDay] = useState("");
  const [newTimelineTask, setNewTimelineTask] = useState("");

  const sectionRef = useRef(null);

  const card = { border: "1px solid #c7dfe3", borderRadius: 16, padding: 18, marginTop: 16, background: THEME_LIGHT, boxShadow: "0 8px 20px rgba(86, 144, 150, 0.08)" };
  const itemRowStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 };

  const getDayLabel = (entry) => (entry?.day ?? entry?.when ?? "").toString() || "???";

  const basics = localPlan.basics || {};
  const dates = basics.dates || {};
  const weather = localPlan.weather || {};

  // --- ICS helpers ---
  function parseOffset(label) {
    if (!label) return 0;
    if (/^day of$/i.test(label)) return 0;
    const m = /^T-(\d+)$/.exec(label);
    if (m) return -parseInt(m[1], 10);
    return 0;
  }
  function fmtDateYYYYMMDD(d) {
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, "0");
    const day = `${d.getDate()}`.padStart(2, "0");
    return `${y}${m}${day}`;
  }
  const icsEscape = (value) =>
    String(value ?? "")
      .replace(/\\r?\\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  function downloadICS() {
    const datesObj = basics?.dates || {};
    if (!datesObj?.start) return alert("Need a start date to build calendar.");
    const start = new Date(`${datesObj.start}T12:00:00`);
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fulfilled Trip Planner//EN"];

    (localPlan.timeline || []).forEach((entry, idx) => {
      const dayLabel = getDayLabel(entry);
      const offset = parseOffset(dayLabel);
      const eventDate = new Date(start);
      eventDate.setDate(eventDate.getDate() + offset);
      const dt = fmtDateYYYYMMDD(eventDate);

      const summary = icsEscape(`${dayLabel} - Trip prep`);
      const description = icsEscape(Array.isArray(entry.tasks) ? entry.tasks.join("\n") : String(entry.tasks || ""));

      lines.push(
        "BEGIN:VEVENT",
        `UID:ftp-${dt}-${idx}@fulfilledplanner`,
        `DTSTAMP:${fmtDateYYYYMMDD(new Date())}T000000Z`,
        `DTSTART;VALUE=DATE:${dt}`,
        `DTEND;VALUE=DATE:${dt}`,
        `SUMMARY:${summary}`,
        `DESCRIPTION:${description}`,
        "END:VEVENT"
      );
    });

    lines.push("END:VCALENDAR");
    const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trip-prep-${(basics.destination || "trip").replace(/\s+/g, "-").toLowerCase()}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadRemindersTodos() {
    const datesObj = basics?.dates || {};
    if (!datesObj?.start) {
      alert("Need a start date to build reminders.");
      return;
    }
    const start = new Date(`${datesObj.start}T12:00:00`);
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fulfilled Trip Planner//EN"];
    const stamp = fmtDateYYYYMMDD(new Date());
    let uid = 0;

    (timeline || []).forEach((entry) => {
      const dayLabel = getDayLabel(entry);
      const offset = parseOffset(dayLabel);
      const due = new Date(start);
      due.setDate(due.getDate() + offset);
      const dueDate = fmtDateYYYYMMDD(due);
      const tasks = Array.isArray(entry.tasks) ? entry.tasks : [];
      tasks.forEach((task) => {
        const summary = icsEscape(task);
        lines.push(
          "BEGIN:VTODO",
          `UID:ftp-todo-${uid++}@fulfilledplanner`,
          `DTSTAMP:${stamp}T000000Z`,
          `DUE;VALUE=DATE:${dueDate}`,
          `SUMMARY:${summary}`,
          `DESCRIPTION:${icsEscape(dayLabel)}`,
          "END:VTODO"
        );
      });
    });

    if (smartMustHavesAll.length) {
      smartMustHavesAll.forEach((item) => {
        const summary = icsEscape(item);
        lines.push(
          "BEGIN:VTODO",
          `UID:ftp-todo-${uid++}@fulfilledplanner`,
          `DTSTAMP:${stamp}T000000Z`,
          `SUMMARY:${summary}`,
          `DESCRIPTION:Smart must-have`,
          "END:VTODO"
        );
      });
    }

    if (uid === 0) {
      alert("No tasks to export yet. Add timeline tasks or smart must-haves.");
      return;
    }

    lines.push("END:VCALENDAR");
    const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trip-reminders-${(basics.destination || "trip").replace(/\s+/g, "-").toLowerCase()}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadGoogleTasksCsv() {
    const rows = [["Task", "Notes", "Due Date"]];
    const addRow = (task, note, dueDate) => {
      const esc = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
      rows.push([esc(task), esc(note), esc(dueDate)].join(","));
    };
    const datesObj = basics?.dates || {};
    const start = datesObj?.start ? new Date(`${datesObj.start}T12:00:00`) : null;

    (timeline || []).forEach((entry) => {
      const dayLabel = getDayLabel(entry);
      const tasks = Array.isArray(entry.tasks) ? entry.tasks : [];
      let due = "";
      if (start) {
        const offset = parseOffset(dayLabel);
        const dueDate = new Date(start);
        dueDate.setDate(dueDate.getDate() + offset);
        const y = dueDate.getFullYear();
        const m = `${dueDate.getMonth() + 1}`.padStart(2, "0");
        const d = `${dueDate.getDate()}`.padStart(2, "0");
        due = `${y}-${m}-${d}`;
      }
      tasks.forEach((task) => addRow(task, dayLabel, due));
    });

    if (smartMustHavesAll.length) {
      smartMustHavesAll.forEach((item) => addRow(item, "Smart must-have", ""));
    }

    if (rows.length === 1) {
      alert("No tasks to export yet.");
      return;
    }

    const blob = new Blob([rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trip-tasks-${(basics.destination || "trip").replace(/\s+/g, "-").toLowerCase()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const printPersonList = (name) => {
    if (typeof window === "undefined") return;
    const items = Array.isArray(byPerson[name]) ? byPerson[name] : [];
    const printable = `<!DOCTYPE html>
<html><head><meta charset=\"utf-8\"><title>${name} packing list</title><style>body{font-family:system-ui,Arial;padding:16px;}h1{font-size:20px;margin-bottom:12px;}ul{padding-left:18px;}li{margin:6px 0;}</style></head><body><h1>${name} packing list</h1><ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul></body></html>`;
    const w = window.open("", "_blank", "width=600,height=800");
    if (!w) {
      alert("Unable to open print preview window. Please allow pop-ups.");
      return;
    }
    w.document.write(printable);
    w.document.close();
    w.focus();
    setTimeout(() => {
      w.print();
      w.close();
    }, 150);
  };

  function printPDF() {
    // Print stylesheet (below) will hide everything except #trip-plan
    window.print();
  }

  // ------ Packing state helpers ------
  const byPerson = localPlan.packing?.byPerson || {};
  const minimalByPerson = localPlan.packing?.minimalByPerson || {};
  const combined = localPlan.packing?.combined || [];
  const minimalCombined = localPlan.packing?.minimalCombined || [];
  const personNames = useMemo(() => {
    const names = new Set([...Object.keys(byPerson), ...Object.keys(minimalByPerson)]);
    return Array.from(names);
  }, [byPerson, minimalByPerson]);
  const combinedDisplay = minimalistMode && minimalCombined.length ? minimalCombined : combined;

  const upsertLocalPlan = (mutateFn) => {
    setLocalPlan((prev) => {
      const next = structuredClone(prev);
      mutateFn(next);
      return next;
    });
  };

  const recomputeMinimalCombined = (packing, preserved = []) => {
    if (!packing) return;
    const lean = new Set();
    if (packing.minimalByPerson) {
      Object.values(packing.minimalByPerson).forEach((list) => {
        if (Array.isArray(list)) {
          list.forEach((item) => {
            if (item) lean.add(item);
          });
        }
      });
    }
    preserved.forEach((item) => {
      if (item) lean.add(item);
    });
    packing.minimalCombined = Array.from(lean);
  };

  const getPersonList = (name) => {
    const full = Array.isArray(byPerson[name]) ? byPerson[name] : [];
    if (!minimalistMode) return full;
    const lean = minimalByPerson[name];
    if (Array.isArray(lean) && lean.length) return lean;
    return full;
  };

  const addCombinedItem = () => {
    const text = (newCombinedItem || "").trim();
    if (!text) return;
    upsertLocalPlan((next) => {
      next.packing = next.packing || { byPerson: {}, combined: [], minimalByPerson: {}, minimalCombined: [] };
      const set = new Set(next.packing.combined || []);
      set.add(text);
      next.packing.combined = Array.from(set);
      const preserved = [text, ...(Array.isArray(next.packing.minimalCombined) ? next.packing.minimalCombined : [])];
      recomputeMinimalCombined(next.packing, preserved);
    });
    setNewCombinedItem("");
  };

  const addPersonItem = (name) => {
    const text = (newPersonItems[name] || "").trim();
    if (!text) return;
    upsertLocalPlan((next) => {
      next.packing = next.packing || { byPerson: {}, combined: [], minimalByPerson: {}, minimalCombined: [] };
      next.packing.byPerson = next.packing.byPerson || {};
      const arr = Array.isArray(next.packing.byPerson[name]) ? next.packing.byPerson[name] : [];
      const set = new Set(arr);
      set.add(text);
      next.packing.byPerson[name] = Array.from(set);
      next.packing.minimalByPerson = next.packing.minimalByPerson || {};
      const leanSet = new Set(next.packing.minimalByPerson[name] || []);
      leanSet.add(text);
      next.packing.minimalByPerson[name] = Array.from(leanSet);
      const all = new Set(next.packing.combined || []);
      all.add(text);
      next.packing.combined = Array.from(all);
      const preserved = Array.isArray(next.packing.minimalCombined) ? next.packing.minimalCombined : [];
      recomputeMinimalCombined(next.packing, preserved);
    });
    setNewPersonItems((s) => ({ ...s, [name]: "" }));
  };

  const removeCombinedItem = (item) => {
    if (!item) return;
    upsertLocalPlan((next) => {
      if (!next.packing) return;
      const combinedList = Array.isArray(next.packing.combined) ? next.packing.combined.filter((x) => x !== item) : [];
      next.packing.combined = combinedList;
      const preserved = Array.isArray(next.packing.minimalCombined) ? next.packing.minimalCombined.filter((x) => x !== item) : [];
      recomputeMinimalCombined(next.packing, preserved);
    });
  };

  const removePersonItem = (name, item) => {
    if (!name || !item) return;
    upsertLocalPlan((next) => {
      if (!next.packing?.byPerson?.[name]) return;
      next.packing.byPerson[name] = next.packing.byPerson[name].filter((x) => x !== item);
      if (next.packing?.minimalByPerson?.[name]) {
        next.packing.minimalByPerson[name] = next.packing.minimalByPerson[name].filter((x) => x !== item);
      }
      const preserved = Array.isArray(next.packing?.minimalCombined)
        ? next.packing.minimalCombined.filter((x) => x !== item)
        : [];
      recomputeMinimalCombined(next.packing, preserved);
    });
  };

  const removeSmartMustHave = (item) => {
    if (!item) return;
    upsertLocalPlan((next) => {
      next.smart_must_haves = Array.isArray(next.smart_must_haves)
        ? next.smart_must_haves.filter((x) => x !== item)
        : [];
    });
  };

  const smartMustHavesAll = Array.isArray(localPlan.smart_must_haves) ? localPlan.smart_must_haves : [];
  const smartMustHaves = minimalistMode ? smartMustHavesAll.slice(0, 10) : smartMustHavesAll;
  const showFullDetails = !minimalistMode;

  // ------ Pack Smarter helpers ------
  const overpack = localPlan.overpack || {};
  const addOverpackItem = (key) => {
    const text = (newOverpack[key] || "").trim();
    if (!text) return;
    upsertLocalPlan((next) => {
      next.overpack = next.overpack || { skip: [], lastMinute: [], housePrep: [] };
      const set = new Set(next.overpack[key] || []);
      set.add(text);
      next.overpack[key] = Array.from(set);
    });
    setNewOverpack((s) => ({ ...s, [key]: "" }));
  };

  const removeOverpackItem = (key, item) => {
    if (!key || !item) return;
    upsertLocalPlan((next) => {
      if (!next.overpack || !Array.isArray(next.overpack[key])) return;
      next.overpack[key] = next.overpack[key].filter((x) => x !== item);
    });
  };

  // ------ Timeline helpers ------
  const TIMELINE_CANON = ["T-14", "T-7", "T-3", "T-1", "Day of"];
  const timeline = Array.isArray(localPlan.timeline) ? localPlan.timeline : [];

  const addTimelineTask = () => {
    const day = (newTimelineDay || "").trim() || "T-7";
    const task = (newTimelineTask || "").trim();
    if (!task) return;
    upsertLocalPlan((next) => {
      next.timeline = Array.isArray(next.timeline) ? [...next.timeline] : [];
      const idx = next.timeline.findIndex((e) => (e?.day || e?.when) === day);
      if (idx >= 0) {
        const set = new Set(Array.isArray(next.timeline[idx].tasks) ? next.timeline[idx].tasks : []);
        set.add(task);
        next.timeline[idx].tasks = Array.from(set);
      } else {
        next.timeline.push({ day, tasks: [task] });
      }
      next.timeline = [
        ...TIMELINE_CANON.filter((d) => next.timeline.some((e) => (e.day || e.when) === d)).map((d) =>
          next.timeline.find((e) => (e.day || e.when) === d)
        ),
        ...next.timeline.filter((e) => !TIMELINE_CANON.includes(e.day || e.when)),
      ].filter(Boolean);
    });
    setNewTimelineTask("");
  };

  const removeTimelineTask = (dayLabel, task) => {
    upsertLocalPlan((next) => {
      if (!Array.isArray(next.timeline)) return;
      next.timeline = next.timeline
        .map((entry) => {
          const label = getDayLabel(entry);
          if (label !== dayLabel) return entry;
          const tasks = Array.isArray(entry.tasks) ? entry.tasks.filter((x) => x !== task) : [];
          if (tasks.length === 0) {
            return { day: entry.day || entry.when, tasks: [] };
          }
          return { ...entry, tasks };
        })
        .filter((entry) => {
          const tasks = Array.isArray(entry.tasks) ? entry.tasks : [];
          return tasks.length > 0;
        });
    });
  };

  const lodging = localPlan.lodging || null;

  return (
    // Give this section a stable id so we can print ONLY this area
    <section id="trip-plan" ref={sectionRef} style={{ ...card, marginTop: 0, borderRadius: 24, padding: 24 }}>
            <style>{`
        :root {
          --theme-primary: #569096;
          --theme-primary-dark: #3f7077;
          --theme-light: #f4f8f9;
          --theme-soft: #e2f0f2;
        }
        @media print {
          body * { visibility: hidden !important; }
          #trip-plan, #trip-plan * { visibility: visible !important; }
          #trip-plan { position: absolute; left: 0; top: 0; width: 100%; }
          .__no-print { display: none !important; }
        }
        #trip-plan {
          background: linear-gradient(180deg, #ffffff 0%, var(--theme-light) 100%);
          border: 1px solid #d3e6ea;
          border-radius: 24px;
        }
        #trip-plan h2 {
          color: var(--theme-primary-dark);
          letter-spacing: 0.02em;
        }
        #trip-plan strong { color: var(--theme-primary-dark); }
        #trip-plan p { color: #35555a; }
        ul.__checklist { list-style: none; padding-left: 0; margin: 0; }
        ul.__checklist li { margin: 6px 0; padding: 6px 10px; border-radius: 10px; background:#ffffff; border:1px solid #d8eaed; transition: box-shadow 0.2s ease; }
        ul.__checklist li:hover { box-shadow: 0 4px 12px rgba(86, 144, 150, 0.12); }
        input[type="checkbox"] {
          accent-color: var(--theme-primary);
          width: 16px;
          height: 16px;
        }
        .__addrow { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; }
        .__addrow input[type="text"] {
          flex:1 1 220px;
          padding:8px 10px;
          border:1px solid #b9d4d9;
          border-radius:10px;
          background:#ffffff;
          box-shadow: inset 0 1px 2px rgba(86, 144, 150, 0.1);
        }
        .__addrow input[type="text"]::placeholder { color:#6b8a8f; }
        .__smallbtn {
          padding:8px 14px;
          border-radius:999px;
          border:1px solid var(--theme-primary-dark);
          background: var(--theme-primary);
          color:#ffffff;
          cursor:pointer;
          box-shadow: 0 4px 12px rgba(86, 144, 150, 0.2);
          transition: background 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
        }
        .__smallbtn:hover {
          background: var(--theme-primary-dark);
          transform: translateY(-1px);
          box-shadow: 0 6px 16px rgba(63, 112, 119, 0.25);
        }
        .__deletebtn {
          border:none;
          background:transparent;
          color:var(--theme-primary-dark);
          cursor:pointer;
          font-size:14px;
          padding:0 6px;
          transition: color 0.2s ease, transform 0.2s ease;
        }
        .__deletebtn:hover {
          color:#274b52;
          transform: scale(1.1);
        }
        .__actionbtn {
          padding:10px 18px;
          border-radius:999px;
          border:1px solid var(--theme-primary-dark);
          background: var(--theme-primary);
          color:#ffffff;
          cursor:pointer;
          box-shadow: 0 6px 18px rgba(86, 144, 150, 0.25);
          transition: background 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
        }
        .__actionbtn:hover {
          background: var(--theme-primary-dark);
          transform: translateY(-1px);
          box-shadow: 0 8px 20px rgba(63, 112, 119, 0.3);
        }
      `}</style>

      {/* Title + tiny badge */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 style={{ margin: 0, color: THEME_PRIMARY_DARK }}>Your Trip Plan</h2>
          {loadingAi && (
            <span
              aria-live="polite"
              title="Adding tips..."
              style={{
                fontSize: 12,
                padding: "4px 12px",
                borderRadius: 999,
                border: `1px solid ${THEME_PRIMARY}`,
                background: "rgba(86, 144, 150, 0.12)",
                color: THEME_PRIMARY_DARK,
                fontWeight: 600
              }}
            >
              Adding tips...
            </span>
          )}
        </div>
        <button
          type="button"
          className="__smallbtn __no-print"
          onClick={() => setMinimalistMode((m) => !m)}
          style={{ fontSize: 12 }}
        >
          Minimalist mode: {minimalistMode ? "On" : "Off"}
        </button>
      </div>

      {/* Summary + Weather */}
      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <div style={{ ...card, marginTop: 0 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Summary</div>
          <div><strong>Destination:</strong> {basics.destination || "N/A"}</div>
          <div><strong>Dates:</strong> {dates.start ? (dates.end && dates.end !== dates.start ? `${dates.start} to ${dates.end}` : dates.start) : "N/A"}</div>
          <div>
            <strong>Travelers:</strong>{" "}
            {basics.travelers?.total ?? 0} total
            {typeof basics.travelers?.adults === "number" ? ` (${basics.travelers.adults} adult${basics.travelers.adults === 1 ? "" : "s"}` : ""}
            {typeof basics.travelers?.children === "number" ? `, ${basics.travelers.children} child${basics.travelers.children === 1 ? "" : "ren"}` : ""}
            {typeof basics.travelers?.adults === "number" ? ")" : ""}
          </div>
          <div><strong>Accommodation:</strong> {basics.accommodation || "N/A"}</div>
          <div><strong>Getting around:</strong> {basics.transportation || "N/A"}</div>
          {Array.isArray(basics.modes) && basics.modes.length > 0 && (
            <div><strong>Travel modes:</strong> {basics.modes.join(', ')}</div>
          )}
          {Array.isArray(basics.travelers?.names) && basics.travelers.names.length > 0 && (
            <div><strong>Names:</strong> {basics.travelers.names.join(", ")}</div>
          )}
          {/* AI trip blurb shows here */}
          {localPlan.ai_blurb && <p style={{ marginTop: 10, fontStyle: "italic" }}>{localPlan.ai_blurb}</p>}
        </div>

        <div style={{ ...card, marginTop: 0 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Weather</div>
          {weather.matched_location && (
            <div style={{ fontSize: 12, marginBottom: 6, opacity: 0.8 }}>
              Matched location: {weather.matched_location}
            </div>
          )}
          <div><strong>Average high:</strong> {typeof weather.avg_high_f === "number" ? `${Math.round(weather.avg_high_f)} deg F` : "-"}</div>
          <div><strong>Average low:</strong> {typeof weather.avg_low_f === "number" ? `${Math.round(weather.avg_low_f)} deg F` : "-"}</div>
          <div><strong>Wet days:</strong> {typeof weather.wet_days_pct === "number" ? `~${Math.round(weather.wet_days_pct)}%` : "-"}</div>
          {weather.notes && <div style={{ marginTop: 6 }}>{weather.notes}</div>}
        </div>
      </div>

      {/* Activities */}
      <div style={{ ...card }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Activities</div>
        {Array.isArray(localPlan.activities) && localPlan.activities.length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {localPlan.activities.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        ) : <div>N/A</div>}
      </div>

      {/* Venue Tips (AI) */}
      {showFullDetails && Array.isArray(localPlan.ai_venue_tips) && localPlan.ai_venue_tips.length > 0 && (
        <div style={{ ...card }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Venue & Bag Policy Tips</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {localPlan.ai_venue_tips.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      )}


      {smartMustHaves.length > 0 && (
        <div style={{ ...card, background: "linear-gradient(180deg, rgba(86, 144, 150, 0.14) 0%, #ffffff 100%)", borderColor: "#b7d6da" }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Smart Must-Haves</div>
          <ul className="__checklist">
            {smartMustHaves.map((item, idx) => (
              <li key={`smh-${idx}`} style={itemRowStyle}>
                <label style={{ display: "inline-flex", gap: 6, alignItems: "center", flex: "1 1 auto" }}>
                  <input type="checkbox" /> <span>{item}</span>
                </label>
                <button
                  type="button"
                  className="__deletebtn __no-print"
                  onClick={() => removeSmartMustHave(item)}
                  aria-label={`Remove ${item}`}
                >
                  -
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Packing Lists */}
      <div style={{ ...card }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontWeight: 700 }}>Packing Lists</div>
          <div>
            <label style={{ marginRight: 8 }}>
              <input
                type="radio"
                name="packmode"
                checked={packingMode === "person"}
                onChange={() => setPackingMode("person")}
              />{" "}
              Per person
            </label>
            <label>
              <input
                type="radio"
                name="packmode"
                checked={packingMode === "combined"}
                onChange={() => setPackingMode("combined")}
              />{" "}
              Combined
            </label>
          </div>
        </div>

        {packingMode === "person" ? (
          personNames.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12, marginTop: 12 }}>
              {personNames.map((name) => {
                const items = getPersonList(name);
                return (
                  <div key={name} style={{ border: "1px solid #cfe3e7", borderRadius: 12, padding: 14, background: "#ffffff" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <div style={{ fontWeight: 600 }}>{name}</div>
                      <button
                        type="button"
                        className="__smallbtn __no-print"
                        onClick={() => printPersonList(name)}
                        style={{ fontSize: 12 }}
                      >
                        Print
                      </button>
                    </div>
                    <ul className="__checklist">
                      {items.map((item, idx) => (
                        <li key={idx} style={itemRowStyle}>
                          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", flex: "1 1 auto" }}>
                            <input type="checkbox" /> <span>{item}</span>
                          </label>
                          <button
                            type="button"
                            className="__deletebtn __no-print"
                            onClick={() => removePersonItem(name, item)}
                            aria-label={`Remove ${item}`}
                          >
                            -
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="__addrow">
                      <input
                        type="text"
                        placeholder="Add item for this traveler..."
                        value={newPersonItems[name] || ""}
                        onChange={(e) => setNewPersonItems((s) => ({ ...s, [name]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPersonItem(name); } }}
                      />
                      <button className="__smallbtn __no-print" onClick={(e) => { e.preventDefault(); addPersonItem(name); }}>
                        + Add
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div>No traveler packing lists yet.</div>
          )
        ) : (
          <>
            {combinedDisplay.length > 0 ? (
              <ul className="__checklist">
                {combinedDisplay.map((item, idx) => (
                  <li key={idx} style={itemRowStyle}>
                    <label style={{ display: "inline-flex", gap: 6, alignItems: "center", flex: "1 1 auto" }}>
                      <input type="checkbox" /> <span>{item}</span>
                    </label>
                    <button
                      type="button"
                      className="__deletebtn __no-print"
                      onClick={() => removeCombinedItem(item)}
                      aria-label={`Remove ${item}`}
                    >
                      -
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div>No combined list yet.</div>
            )}
            <div className="__addrow">
              <input
                type="text"
                placeholder="Add to combined list..."
                value={newCombinedItem}
                onChange={(e) => setNewCombinedItem(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCombinedItem(); } }}
              />
              <button className="__smallbtn __no-print" onClick={(e) => { e.preventDefault(); addCombinedItem(); }}>
                + Add
              </button>
            </div>
          </>
        )}
      </div>

      {showFullDetails && (
        (Array.isArray(overpack.skip) && overpack.skip.length > 0) ||
        (Array.isArray(overpack.lastMinute) && overpack.lastMinute.length > 0) ||
        (Array.isArray(overpack.housePrep) && overpack.housePrep.length > 0)
      ? (
        <div style={{ ...card, background: "linear-gradient(180deg, rgba(86, 144, 150, 0.1) 0%, #ffffff 100%)", borderColor: "#b7d6da" }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Pack Smarter</div>

          <div style={{ fontWeight: 600, marginBottom: 6 }}>Consider leaving these at home</div>
          <ul className="__checklist">
            {(overpack.skip || []).map((t, i) => (
              <li key={`skip-${i}`} style={itemRowStyle}>
                <label style={{ display: "inline-flex", gap: 6, alignItems: "center", flex: "1 1 auto" }}>
                  <input type="checkbox" /> <span>{t}</span>
                </label>
                <button
                  type="button"
                  className="__deletebtn __no-print"
                  onClick={() => removeOverpackItem("skip", t)}
                  aria-label={`Remove ${t}`}
                >
                  -
                </button>
              </li>
            ))}
          </ul>
          <div className="__addrow">
            <input
              type="text"
              placeholder="Add an item to skip..."
              value={newOverpack.skip}
              onChange={(e) => setNewOverpack((s) => ({ ...s, skip: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOverpackItem("skip"); } }}
            />
            <button className="__smallbtn __no-print" onClick={(e) => { e.preventDefault(); addOverpackItem("skip"); }}>
              + Add
            </button>
          </div>

          <div style={{ fontWeight: 600, margin: "10px 0 6px" }}>Last-minute grab</div>
          <ul className="__checklist">
            {(overpack.lastMinute || []).map((t, i) => (
              <li key={`lm-${i}`} style={itemRowStyle}>
                <label style={{ display: "inline-flex", gap: 6, alignItems: "center", flex: "1 1 auto" }}>
                  <input type="checkbox" /> <span>{t}</span>
                </label>
                <button
                  type="button"
                  className="__deletebtn __no-print"
                  onClick={() => removeOverpackItem("lastMinute", t)}
                  aria-label={`Remove ${t}`}
                >
                  -
                </button>
              </li>
            ))}
          </ul>
          <div className="__addrow">
            <input
              type="text"
              placeholder="Add last-minute item..."
              value={newOverpack.lastMinute}
              onChange={(e) => setNewOverpack((s) => ({ ...s, lastMinute: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOverpackItem("lastMinute"); } }}
            />
            <button className="__smallbtn __no-print" onClick={(e) => { e.preventDefault(); addOverpackItem("lastMinute"); }}>
              + Add
            </button>
          </div>

          <div style={{ fontWeight: 600, margin: "10px 0 6px" }}>House prep</div>
          <ul className="__checklist">
            {(overpack.housePrep || []).map((t, i) => (
              <li key={`hp-${i}`} style={itemRowStyle}>
                <label style={{ display: "inline-flex", gap: 6, alignItems: "center", flex: "1 1 auto" }}>
                  <input type="checkbox" /> <span>{t}</span>
                </label>
                <button
                  type="button"
                  className="__deletebtn __no-print"
                  onClick={() => removeOverpackItem("housePrep", t)}
                  aria-label={`Remove ${t}`}
                >
                  -
                </button>
              </li>
            ))}
          </ul>
          <div className="__addrow">
            <input
              type="text"
              placeholder="Add house prep task..."
              value={newOverpack.housePrep}
              onChange={(e) => setNewOverpack((s) => ({ ...s, housePrep: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOverpackItem("housePrep"); } }}
            />
            <button className="__smallbtn __no-print" onClick={(e) => { e.preventDefault(); addOverpackItem("housePrep"); }}>
              + Add
            </button>
          </div>
        </div>
      ) : null)}

      {/* Infant/Toddler Lodging & Sleep (only show if any traveler age <= 2) */}
      {showFullDetails && (() => {
        const ages = localPlan?.basics?.travelers?.ages || [];
        const showInfant = Array.isArray(ages) && ages.some(a => typeof a === "number" && a <= 2);
        return showInfant &&
          lodging?.infantToddler &&
          Array.isArray(lodging.infantToddler) &&
          lodging.infantToddler.length > 0 ? (
          <div style={{ ...card }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Infant/Toddler Sleep Setup</div>
            <ul className="__checklist">
              {lodging.infantToddler.map((t, i) => (
                <li key={i}>
                  <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" /> <span>{t}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : null;
      })()}

      {showFullDetails && (
        <div style={{ ...card, background: "linear-gradient(180deg, rgba(86, 144, 150, 0.08) 0%, #ffffff 100%)", borderColor: "#b7d6da" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 700 }}>Timeline</div>
            <div className="__addrow" style={{ marginTop: 0 }}>
              <select
                value={newTimelineDay}
                onChange={(e) => setNewTimelineDay(e.target.value)}
                style={{ padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8 }}
                title="Choose a day label or type your own"
              >
                <option value="">(choose day)</option>
                {timeline.map((e, i) => {
                  const d = getDayLabel(e);
                  return <option key={`ex-${i}-${d}`} value={d}>{d}</option>;
                })}
                {TIMELINE_CANON.filter(d => !timeline.some(e => getDayLabel(e) === d)).map((d) => (
                  <option key={`sugg-${d}`} value={d}>{d}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Add a task..."
                value={newTimelineTask}
                onChange={(e) => setNewTimelineTask(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTimelineTask(); } }}
              />
              <button className="__smallbtn __no-print" onClick={(e) => { e.preventDefault(); addTimelineTask(); }}>
                + Add
              </button>
            </div>
          </div>

          {Array.isArray(timeline) && timeline.length > 0 ? (
            timeline.map((entry, idx) => {
              const dayLabel = getDayLabel(entry);
              const tasks = Array.isArray(entry.tasks) ? entry.tasks : [];
              return (
                <div key={idx} style={{ marginBottom: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{dayLabel}</div>
                  {tasks.length > 0 ? (
                    <ul className="__checklist">
                      {tasks.map((task, taskIdx) => (
                        <li key={taskIdx} style={itemRowStyle}>
                          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", flex: "1 1 auto" }}>
                            <input type="checkbox" /> <span>{task}</span>
                          </label>
                          <button
                            type="button"
                            className="__deletebtn __no-print"
                            onClick={() => removeTimelineTask(dayLabel, task)}
                            aria-label={`Remove ${task}`}
                          >
                            -
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ fontStyle: "italic", color: "#6b7280" }}>No tasks yet.</div>
                  )}
                </div>
              );
            })
          ) : (
            <p>No timeline entries.</p>
          )}
        </div>
      )}

      {/* Action row moved to BOTTOM */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 8 }} >
        <button className="__no-print __actionbtn" onClick={downloadRemindersTodos} style={btnStyle}>Export Reminders (.ics)</button>
        <button className="__no-print __actionbtn" onClick={downloadGoogleTasksCsv} style={btnStyle}>Export Google Tasks (.csv)</button>
        <button className="__no-print __actionbtn" onClick={downloadICS} style={btnStyle}>Add to calendar (.ics)</button>
        <button className="__no-print __actionbtn" onClick={printPDF} style={btnStyle}>Print / Save PDF</button>
      </div>
    </section>
  );
}

const btnStyle = {
  padding: "10px 18px",
  borderRadius: 999,
  border: `1px solid ${THEME_PRIMARY_DARK}`,
  background: THEME_PRIMARY,
  color: "#ffffff",
  cursor: "pointer",
  boxShadow: "0 6px 18px rgba(86, 144, 150, 0.25)",
  transition: "background 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease",
};


