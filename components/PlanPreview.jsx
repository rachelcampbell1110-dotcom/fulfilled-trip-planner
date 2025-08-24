// components/PlanPreview.jsx
"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export default function PlanPreview({ plan, loadingAi = false }) {
  if (!plan) return null;

  // Local editable copy (for add-item UX)
  const [localPlan, setLocalPlan] = useState(plan);
  useEffect(() => setLocalPlan(plan), [plan]);

  const [packingMode, setPackingMode] = useState("person");
  const [newCombinedItem, setNewCombinedItem] = useState("");
  const [newPersonItems, setNewPersonItems] = useState({});
  const [newOverpack, setNewOverpack] = useState({ skip: "", lastMinute: "", housePrep: "" });
  const [newTimelineDay, setNewTimelineDay] = useState("");
  const [newTimelineTask, setNewTimelineTask] = useState("");

  const sectionRef = useRef(null);

  const card = { border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, marginTop: 16 };

  const getDayLabel = (entry) => (entry?.day ?? entry?.when ?? "").toString() || "–";
  const tasksToString = (tasks) => (Array.isArray(tasks) ? tasks.join("; ") : String(tasks || ""));

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

      const summary = `${dayLabel} – Trip prep`;
      const description = (Array.isArray(entry.tasks) ? entry.tasks.join("\\n") : String(entry.tasks || "")).replace(/\n/g, "\\n");

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

  function printPDF() {
    // Print stylesheet (below) will hide everything except #trip-plan
    window.print();
  }

  // ------ Packing state helpers ------
  const byPerson = localPlan.packing?.byPerson || {};
  const combined = localPlan.packing?.combined || [];
  const personNames = useMemo(() => Object.keys(byPerson), [byPerson]);

  const upsertLocalPlan = (mutateFn) => {
    setLocalPlan((prev) => {
      const next = structuredClone(prev);
      mutateFn(next);
      return next;
    });
  };

  const addCombinedItem = () => {
    const text = (newCombinedItem || "").trim();
    if (!text) return;
    upsertLocalPlan((next) => {
      next.packing = next.packing || { byPerson: {}, combined: [] };
      const set = new Set(next.packing.combined || []);
      set.add(text);
      next.packing.combined = Array.from(set);
    });
    setNewCombinedItem("");
  };

  const addPersonItem = (name) => {
    const text = (newPersonItems[name] || "").trim();
    if (!text) return;
    upsertLocalPlan((next) => {
      next.packing = next.packing || { byPerson: {}, combined: [] };
      next.packing.byPerson = next.packing.byPerson || {};
      const arr = Array.isArray(next.packing.byPerson[name]) ? next.packing.byPerson[name] : [];
      const set = new Set(arr);
      set.add(text);
      next.packing.byPerson[name] = Array.from(set);
      const all = new Set(next.packing.combined || []);
      all.add(text);
      next.packing.combined = Array.from(all);
    });
    setNewPersonItems((s) => ({ ...s, [name]: "" }));
  };

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

  const lodging = localPlan.lodging || null;

  return (
    // Give this section a stable id so we can print ONLY this area
    <section id="trip-plan" ref={sectionRef} style={card}>
      <style>{`
        /* Print just the plan */
        @media print {
          body * { visibility: hidden !important; }
          #trip-plan, #trip-plan * { visibility: visible !important; }
          #trip-plan { position: absolute; left: 0; top: 0; width: 100%; }
          /* No print buttons */
          .__no-print { display: none !important; }
        }
        /* general */
        ul.__checklist { list-style: none; padding-left: 0; margin: 0; }
        ul.__checklist li { margin: 4px 0; }
        /* tiny inline add form */
        .__addrow { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; }
        .__addrow input[type="text"] { flex:1 1 220px; padding:8px 10px; border:1px solid #d1d5db; border-radius:8px; }
        .__smallbtn { padding:8px 12px; border-radius:8px; border:1px solid #d1d5db; background:#f8fafc; cursor:pointer; }
      `}</style>

      {/* Title + tiny badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <h2 style={{ margin: 0 }}>Your Trip Plan</h2>
        {loadingAi && (
          <span
            aria-live="polite"
            title="Adding tips…"
            style={{
              fontSize: 12,
              padding: "2px 8px",
              borderRadius: 999,
              border: "1px solid #cbd5e1",
              background: "#f8fafc"
            }}
          >
            Adding tips…
          </span>
        )}
      </div>

      {/* Summary + Weather */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ ...card, marginTop: 0 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Summary</div>
          <div><strong>Destination:</strong> {basics.destination || "—"}</div>
          <div><strong>Dates:</strong> {dates.start ? (dates.end && dates.end !== dates.start ? `${dates.start} → ${dates.end}` : dates.start) : "—"}</div>
          <div>
            <strong>Travelers:</strong>{" "}
            {basics.travelers?.total ?? 0} total
            {typeof basics.travelers?.adults === "number" ? ` (${basics.travelers.adults} adult${basics.travelers.adults === 1 ? "" : "s"}` : ""}
            {typeof basics.travelers?.children === "number" ? `, ${basics.travelers.children} child${basics.travelers.children === 1 ? "" : "ren"}` : ""}
            {typeof basics.travelers?.adults === "number" ? ")" : ""}
          </div>
          <div><strong>Accommodation:</strong> {basics.accommodation || "—"}</div>
          <div><strong>Getting around:</strong> {basics.transportation || "—"}</div>
          {Array.isArray(basics.travelers?.names) && basics.travelers.names.length > 0 && (
            <div><strong>Names:</strong> {basics.travelers.names.join(", ")}</div>
          )}
          {localPlan.ai_blurb && <p style={{ marginTop: 10, fontStyle: "italic" }}>{localPlan.ai_blurb}</p>}
        </div>

        <div style={{ ...card, marginTop: 0 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Weather</div>
          {weather.matched_location && (
            <div style={{ fontSize: 12, marginBottom: 6, opacity: 0.8 }}>
              Matched location: {weather.matched_location}
            </div>
          )}
          <div><strong>Avg high:</strong> {typeof weather.avg_high_f === "number" ? `${Math.round(weather.avg_high_f)}°F` : "—"}</div>
          <div><strong>Avg low:</strong> {typeof weather.avg_low_f === "number" ? `${Math.round(weather.avg_low_f)}°F` : "—"}</div>
          <div><strong>Wet days:</strong> {typeof weather.wet_days_pct === "number" ? `~${Math.round(weather.wet_days_pct)}%` : "—"}</div>
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
        ) : <div>—</div>}
      </div>

      {/* Venue Tips (AI) */}
      {Array.isArray(localPlan.ai_venue_tips) && localPlan.ai_venue_tips.length > 0 && (
        <div style={{ ...card }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Venue & Bag Policy Tips</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {localPlan.ai_venue_tips.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      )}

      {/* Packing Lists */}
      <div style={{ ...card }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
          (Array.isArray(Object.keys(byPerson)) && Object.keys(byPerson).length > 0) ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12, marginTop: 12 }}>
              {Object.keys(byPerson).map((name) => (
                <div key={name} style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>{name}</div>
                  <ul className="__checklist">
                    {byPerson[name].map((item, idx) => (
                      <li key={idx}>
                        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <input type="checkbox" /> <span>{item}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <div className="__addrow">
                    <input
                      type="text"
                      placeholder={`Add for ${name}…`}
                      value={newPersonItems[name] || ""}
                      onChange={(e) => setNewPersonItems((s) => ({ ...s, [name]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPersonItem(name); } }}
                    />
                    <button className="__smallbtn __no-print" onClick={(e) => { e.preventDefault(); addPersonItem(name); }}>
                      + Add
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>No named travelers to build per-person lists.</div>
          )
        ) : (
          <>
            <ul className="__checklist" style={{ marginTop: 8 }}>
              {combined.map((item, idx) => (
                <li key={idx}>
                  <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" /> <span>{item}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="__addrow">
              <input
                type="text"
                placeholder="Add to combined list…"
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

      {/* Pack Smarter */}
      {(Array.isArray(overpack.skip) && overpack.skip.length > 0) ||
       (Array.isArray(overpack.lastMinute) && overpack.lastMinute.length > 0) ||
       (Array.isArray(overpack.housePrep) && overpack.housePrep.length > 0) ? (
        <div style={{ ...card }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Pack Smarter</div>

          <div style={{ fontWeight: 600, marginBottom: 6 }}>Consider leaving these at home</div>
          <ul className="__checklist">
            {(overpack.skip || []).map((t, i) => (
              <li key={`skip-${i}`}>
                <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" /> <span>{t}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="__addrow">
            <input
              type="text"
              placeholder="Add an item to skip…"
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
              <li key={`lm-${i}`}>
                <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" /> <span>{t}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="__addrow">
            <input
              type="text"
              placeholder="Add last-minute item…"
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
              <li key={`hp-${i}`}>
                <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" /> <span>{t}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="__addrow">
            <input
              type="text"
              placeholder="Add house prep task…"
              value={newOverpack.housePrep}
              onChange={(e) => setNewOverpack((s) => ({ ...s, housePrep: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOverpackItem("housePrep"); } }}
            />
            <button className="__smallbtn __no-print" onClick={(e) => { e.preventDefault(); addOverpackItem("housePrep"); }}>
              + Add
            </button>
          </div>
        </div>
      ) : null}

      {/* Infant/Toddler (≤ 2 yrs) */}
      {lodging?.infantToddler &&
        Array.isArray(lodging.infantToddler) &&
        lodging.infantToddler.length > 0 &&
        Array.isArray(plan?.basics?.travelers?.ages) &&
        plan.basics.travelers.ages.some((age) => typeof age === "number" && age <= 2) && (
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
        )}

      {/* Extra To-Dos (AI) */}
      {Array.isArray(localPlan.ai_extra_todos) && localPlan.ai_extra_todos.length > 0 && (
        <div style={{ ...card }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Extra To-Dos</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {localPlan.ai_extra_todos.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      )}

      {/* Timeline */}
      <div style={{ ...card }}>
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
              placeholder="Add a task…"
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
          timeline.map((entry, idx) => (
            <div key={idx} style={{ marginBottom: 8 }}>
              <span style={{ fontWeight: 600 }}>{getDayLabel(entry)}:</span>{" "}
              {tasksToString(entry.tasks)}
            </div>
          ))
        ) : (
          <p>No timeline entries.</p>
        )}
      </div>

      {/* Action row moved to BOTTOM */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
        <button className="__no-print" onClick={downloadICS} style={btnStyle}>⬇️ Add to calendar (.ics)</button>
        <button className="__no-print" onClick={printPDF} style={btnStyle}>🖨️ Print / Save PDF</button>
      </div>
    </section>
  );
}

const btnStyle = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  background: "#f8fafc",
  cursor: "pointer",
};
