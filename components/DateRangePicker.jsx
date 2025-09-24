import { useEffect, useMemo, useRef, useState } from "react";

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const displayFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

function parseISODate(value) {
  if (!value) return null;
  const parts = value.split("-").map((part) => Number(part));
  if (parts.length !== 3) return null;
  const [year, month, day] = parts;
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isSameDay(isoA, isoB) {
  return Boolean(isoA) && isoA === isoB;
}

function isBetween(iso, start, end) {
  if (!start || !end) return false;
  if (end < start) return false;
  return iso >= start && iso <= end;
}

const baseTriggerStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  background: "#ffffff",
  textAlign: "left",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  fontSize: "0.95rem",
  cursor: "pointer",
  color: "#1f2937",
  transition: "border 0.15s ease, box-shadow 0.15s ease, background 0.15s ease",
};

const popoverStyle = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  zIndex: 24,
  background: "#ffffff",
  border: "1px solid #d1d5db",
  borderRadius: 12,
  boxShadow: "0 16px 32px rgba(15, 23, 42, 0.18)",
  padding: 12,
  width: 300,
};

const dayGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(7, 1fr)",
  gap: 4,
  marginTop: 8,
};

export default function DateRangePicker({
  start = "",
  end = "",
  onChange,
  singleDay = false,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => parseISODate(start) || parseISODate(end) || new Date());
  const [pendingStart, setPendingStart] = useState("");
  const [pendingEnd, setPendingEnd] = useState("");
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const nextStart = start || "";
    const nextEnd = singleDay ? nextStart : end || "";
    setPendingStart(nextStart);
    setPendingEnd(nextEnd);
    const anchor = parseISODate(nextStart) || parseISODate(nextEnd) || new Date();
    setViewDate(new Date(anchor.getFullYear(), anchor.getMonth(), 1));

    const handleClick = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleKey = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, start, end, singleDay]);

  const calendarDays = useMemo(() => {
    const firstOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const monthStartWeekday = firstOfMonth.getDay();
    const firstVisible = new Date(firstOfMonth);
    firstVisible.setDate(firstVisible.getDate() - monthStartWeekday);

    return Array.from({ length: 42 }, (_, idx) => {
      const day = new Date(firstVisible);
      day.setDate(firstVisible.getDate() + idx);
      return day;
    });
  }, [viewDate]);

  const displayLabel = useMemo(() => {
    if (!start && !end) {
      return singleDay ? "Select date" : "Select dates";
    }
    const startLabel = start ? displayFormatter.format(parseISODate(start)) : "";
    if (singleDay) {
      return startLabel || "Select date";
    }
    const endLabel = end ? displayFormatter.format(parseISODate(end)) : "";
    if (startLabel && endLabel) {
      return `${startLabel} - ${endLabel}`;
    }
    return startLabel || endLabel || "Select dates";
  }, [start, end, singleDay]);

  const activeStart = pendingStart || (singleDay ? start : start);
  const activeEnd = singleDay ? pendingStart || start : pendingEnd || end;

  const handleDayClick = (date) => {
    if (disabled) return;
    const iso = toISODate(date);
    if (singleDay) {
      onChange({ start: iso, end: iso });
      setOpen(false);
      return;
    }

    if (!pendingStart || (pendingStart && pendingEnd)) {
      setPendingStart(iso);
      setPendingEnd("");
      return;
    }

    if (iso < pendingStart) {
      setPendingStart(iso);
      setPendingEnd("");
      return;
    }

    setPendingEnd(iso);
    onChange({ start: pendingStart, end: iso });
    setOpen(false);
  };

  const handleClear = () => {
    setPendingStart("");
    setPendingEnd("");
    onChange({ start: "", end: "" });
    setOpen(false);
  };

  const moveMonth = (offset) => {
    setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
  };

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
        style={{
          ...baseTriggerStyle,
          border: open ? "1px solid #3f7077" : baseTriggerStyle.border,
          boxShadow: open ? "0 0 0 3px rgba(86, 144, 150, 0.18)" : "none",
          background: disabled ? "#f3f4f6" : "#ffffff",
          color: disabled ? "#9ca3af" : "#1f2937",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        <span>{displayLabel}</span>
        <span style={{ fontSize: 12, color: "#6b7280" }}>{open ? "^" : "v"}</span>
      </button>

      {open && (
        <div style={popoverStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <button
              type="button"
              onClick={() => moveMonth(-1)}
              style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 18, lineHeight: 1 }}
            >
              {"<"}
            </button>
            <div style={{ fontWeight: 600 }}>{monthFormatter.format(viewDate)}</div>
            <button
              type="button"
              onClick={() => moveMonth(1)}
              style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 18, lineHeight: 1 }}
            >
              {">"}
            </button>
          </div>

          <div style={{ ...dayGridStyle, fontSize: 12, color: "#6b7280" }}>
            {DAY_LABELS.map((label) => (
              <div key={label} style={{ textAlign: "center" }}>
                {label}
              </div>
            ))}
          </div>

          <div style={dayGridStyle}>
            {calendarDays.map((date) => {
              const iso = toISODate(date);
              const inCurrentMonth = date.getMonth() === viewDate.getMonth();
              const isStart = isSameDay(activeStart, iso);
              const isEnd = isSameDay(activeEnd, iso);
              const isInRange = !singleDay && isBetween(iso, activeStart, activeEnd) && !isStart && !isEnd;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => handleDayClick(date)}
                  style={{
                    padding: "6px 0",
                    borderRadius: 6,
                    border: "none",
                    background: isStart || isEnd ? "#569096" : isInRange ? "rgba(86, 144, 150, 0.18)" : "transparent",
                    color: isStart || isEnd ? "#ffffff" : inCurrentMonth ? "#1f2937" : "#9ca3af",
                    cursor: "pointer",
                    fontWeight: isStart || isEnd ? 600 : 400,
                  }}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", fontSize: 12 }}>
            <div style={{ color: "#6b7280" }}>
              {singleDay ? "Select a date" : "Select start and end date"}
            </div>
            {(start || end) && (
              <button
                type="button"
                onClick={handleClear}
                style={{ border: "none", background: "transparent", color: "#3f7077", cursor: "pointer" }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}








