// components/PlanPreview.jsx
"use client";
import { useMemo, useRef, useState } from "react";

export default function PlanPreview({ plan, loadingAi = false }) {
  if (!plan) return null;

  const [packingMode, setPackingMode] = useState("person");
  const sectionRef = useRef(null);

  const card = { border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, marginTop: 16 };

  const getDayLabel = (entry) => (entry?.day ?? entry?.when ?? "").toString() || "–";
  const tasksToString = (tasks) => (Array.isArray(tasks) ? tasks.join("; ") : String(tasks || ""));

  const basics = plan.basics || {};
  const dates = basics.dates || {};
  const weather = plan.weather || {};

  // ---- Pretty labels for activities
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
    theme_park: "Theme Park 🎢",
  };
  const labelForActivity = (key) =>
    ACTIVITY_LABELS[key] ||
    key
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

  // --- ICS helpers
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
    if (!dates?.start) return alert("Need a start date to build calendar.");
    const start = new Date(`${dates.start}T12:00:00`);
    const lines = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Fulfilled Trip Planner//EN"];

    (plan.timeline || []).forEach((entry, idx) => {
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

  function printPDF() { window.print(); }

  const byPerson = plan.packing?.byPerson || {};
  const combined = plan.packing?.combined || [];
  const personNames = useMemo(() => Object.keys(byPerson), [byPerson]);

  const overpack = plan.overpack || {};
  const lodging = plan.lodging || null;

  return (
    <section ref={sectionRef} style={card}>
      <style>{`
        @media print {
          button.__no-print { display: none !important; }
          a.__no-print { display: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        ul.__checklist { list-style: none; padding-left: 0; margin: 0; }
        ul.__checklist li { margin: 4px 0; }
      `}</style>

      {/* Action row */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="__no-print" onClick={downloadICS} style={btnStyle}>⬇️ Add to calendar (.ics)</button>
        <button className="__no-print" onClick={printPDF} style={btnStyle}>🖨️ Print / Save PDF</button>
      </div>

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
          {plan.ai_blurb && <p style={{ marginTop: 10, fontStyle: "italic" }}>{plan.ai_blurb}</p>}
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
        {Array.isArray(plan.activities) && plan.activities.length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {plan.activities.map((a, i) => <li key={i}>{labelForActivity(a)}</li>)}
          </ul>
        ) : <div>—</div>}
      </div>

      {/* Venue Tips (AI) */}
      {Array.isArray(plan.ai_venue_tips) && plan.ai_venue_tips.length > 0 && (
        <div style={{ ...card }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Venue & Bag Policy Tips</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {plan.ai_venue_tips.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      )}

      {/* Packing Lists */}
      <div style={{ ...card }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700 }}>Packing Lists</div>
          <div>
            <label style={{ marginRight: 8 }}>
              <input type="radio" name="packmode" checked={packingMode === "person"} onChange={() => setPackingMode("person")} />{" "}
              Per person
            </label>
            <label>
              <input type="radio" name="packmode" checked={packingMode === "combined"} onChange={() => setPackingMode("combined")} />{" "}
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
                </div>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>No named travelers to build per-person lists.</div>
          )
        ) : (
          <ul className="__checklist" style={{ marginTop: 8 }}>
            {combined.map((item, idx) => (
              <li key={idx}>
                <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" /> <span>{item}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Overpack Guard */}
      {(Array.isArray(overpack.skip) && overpack.skip.length > 0) ||
       (Array.isArray(overpack.lastMinute) && overpack.lastMinute.length > 0) ||
       (Array.isArray(overpack.housePrep) && overpack.housePrep.length > 0) ? (
        <div style={{ ...card }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Pack Smarter</div>

          {Array.isArray(overpack.skip) && overpack.skip.length > 0 && (
            <>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Consider leaving these at home</div>
              <ul className="__checklist">
                {overpack.skip.map((t, i) => (
                  <li key={i}>
                    <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" /> <span>{t}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}

          {Array.isArray(overpack.lastMinute) && overpack.lastMinute.length > 0 && (
            <>
              <div style={{ fontWeight: 600, margin: "10px 0 6px" }}>Last-minute grab</div>
              <ul className="__checklist">
                {overpack.lastMinute.map((t, i) => (
                  <li key={i}>
                    <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" /> <span>{t}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}

          {Array.isArray(overpack.housePrep) && overpack.housePrep.length > 0 && (
            <>
              <div style={{ fontWeight: 600, margin: "10px 0 6px" }}>House prep</div>
              <ul className="__checklist">
                {overpack.housePrep.map((t, i) => (
                  <li key={i}>
                    <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" /> <span>{t}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}

      {/* Extra To-Dos (AI) */}
      {Array.isArray(plan.ai_extra_todos) && plan.ai_extra_todos.length > 0 && (
        <div style={{ ...card }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Extra To-Dos</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {plan.ai_extra_todos.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      )}

      {/* Timeline */}
      <div style={{ ...card }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Timeline</div>
        {Array.isArray(plan.timeline) && plan.timeline.length > 0 ? (
          plan.timeline.map((entry, idx) => (
            <div key={idx} style={{ marginBottom: 8 }}>
              <span style={{ fontWeight: 600 }}>{getDayLabel(entry)}:</span>{" "}
              {tasksToString(entry.tasks)}
            </div>
          ))
        ) : (
          <p>No timeline entries.</p>
        )}
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