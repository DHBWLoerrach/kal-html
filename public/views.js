// Renderer für Wochen-, Monats- und Listenansicht. Reines DOM-Building.

const wallTimeOptions = { timeZone: "UTC" };
const fmtTime = new Intl.DateTimeFormat("de-DE", { ...wallTimeOptions, hour: "2-digit", minute: "2-digit" });
const fmtDayHead = new Intl.DateTimeFormat("de-DE", { ...wallTimeOptions, weekday: "short", day: "2-digit", month: "2-digit" });
const fmtDayLong = new Intl.DateTimeFormat("de-DE", { ...wallTimeOptions, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtMonth = new Intl.DateTimeFormat("de-DE", { ...wallTimeOptions, month: "long", year: "numeric" });
const fmtShortDate = new Intl.DateTimeFormat("de-DE", { ...wallTimeOptions, day: "2-digit", month: "2-digit" });
const fmtDayMonth = new Intl.DateTimeFormat("de-DE", { ...wallTimeOptions, day: "numeric", month: "long" });
const fmtDayMonthYear = new Intl.DateTimeFormat("de-DE", { ...wallTimeOptions, day: "numeric", month: "long", year: "numeric" });

const PX_PER_MIN = 1.1;

// ---- Datums-Helfer ----------------------------------------------------------

export function startOfDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function startOfWeek(d) {
  const day = startOfDay(d);
  const offset = (day.getUTCDay() + 6) % 7; // Montag = 0
  day.setUTCDate(day.getUTCDate() - offset);
  return day;
}

export function addDays(d, n) {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

export function addMonths(d, n) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

export function parseISODate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = +m[1];
  const month = +m[2];
  const day = +m[3];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? date
    : null;
}

function sameDay(a, b) {
  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate();
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

export function eventsOnDay(events, day) {
  // Ganztägige Termine können mehrere Tage umfassen; DTEND ist im
  // DHBW-Feed inklusiv (eintägige Termine haben DTEND == DTSTART).
  return events.filter((e) =>
    e.allDay ? e.start <= day && day <= e.end : sameDay(e.start, day)
  );
}

// ---- DOM-Helfer --------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function locationNode(ev) {
  if (!ev.location) return null;
  if (/^https?:\/\//.test(ev.location)) {
    const a = el("a", "ev-location ev-location--online", "Online-Raum ↗");
    a.href = ev.location;
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  }
  return el("span", "ev-location", ev.location);
}

function descriptionNode(ev) {
  const text = ev.description?.trim();
  return text ? el("p", "ev-description", text) : null;
}

function eventTimeLabel(ev) {
  return ev.allDay ? "ganztägig" : `${fmtTime.format(ev.start)}–${fmtTime.format(ev.end)}`;
}

function monthDetailNode(ev, onClose) {
  const detail = el("article", "month-detail");
  const card = el("div", "month-detail-card");
  const head = el("div", "month-detail-head");
  const text = el("div", "month-detail-main");
  text.appendChild(el("h3", "ev-title", ev.title));
  text.appendChild(el("time", "ev-time", eventTimeLabel(ev)));
  head.appendChild(text);

  const close = el("button", "month-detail-close", "×");
  close.type = "button";
  close.title = "Schließen";
  close.setAttribute("aria-label", "Schließen");
  close.addEventListener("click", onClose);
  head.appendChild(close);
  card.appendChild(head);

  const loc = locationNode(ev);
  if (loc) card.appendChild(loc);
  const description = descriptionNode(ev);
  if (description) card.appendChild(description);
  detail.appendChild(card);
  return detail;
}

export function updateTimeIndicators(root, today) {
  const todayKey = dateKey(today);
  let todayColumn = null;

  for (const node of root.querySelectorAll("[data-date]")) {
    const isToday = node.dataset.date === todayKey;
    node.classList.toggle("is-today", isToday);
    if (isToday && node.classList.contains("week-day")) todayColumn = node;
  }

  let line = root.querySelector(".now-line");
  const body = todayColumn?.querySelector(".day-body");
  if (!body) {
    line?.remove();
    return;
  }

  const dayStartMin = Number(body.dataset.startMinute);
  const totalMin = Number(body.dataset.totalMinutes);
  const nowMin = today.getUTCHours() * 60 + today.getUTCMinutes();
  if (nowMin < dayStartMin || nowMin > dayStartMin + totalMin) {
    line?.remove();
    return;
  }

  if (!line) {
    line = root.ownerDocument.createElement("div");
    line.classList.add("now-line");
  }
  if (line.parentNode !== body) body.appendChild(line);
  line.style.top = `${(nowMin - dayStartMin) * PX_PER_MIN}px`;
}

// Überlappende Termine eines Tages in Spalten legen (greedy)
function layoutColumns(events) {
  const placed = [];
  let cluster = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const n = Math.max(...cluster.map((p) => p.col), 0) + 1;
    cluster.forEach((p) => (p.cols = n));
    placed.push(...cluster);
    cluster = [];
  };

  const colEnds = [];
  for (const ev of events) {
    const start = ev.start.getTime();
    if (cluster.length && start >= clusterEnd) {
      flush();
      colEnds.length = 0;
    }
    let col = colEnds.findIndex((end) => end <= start);
    if (col < 0) col = colEnds.length;
    colEnds[col] = ev.end.getTime();
    cluster.push({ ev, col });
    clusterEnd = Math.max(clusterEnd, ev.end.getTime());
  }
  if (cluster.length) flush();
  return placed;
}

// ---- Wochenansicht -----------------------------------------------------------

export function renderWeek(events, anchor, today, onDayClick) {
  const monday = startOfWeek(anchor);
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday, i));
  const perDay = days.map((d) => eventsOnDay(events, d));
  // Sa/So nur zeigen, wenn dort Termine liegen
  const visible = days.filter((_, i) => i < 5 || perDay[i].length > 0);

  const weekEvents = visible.flatMap((_, i) => perDay[days.indexOf(visible[i])]);
  let startHour = 8;
  let endHour = 18;
  for (const ev of weekEvents) {
    if (ev.allDay) continue;
    startHour = Math.min(startHour, ev.start.getUTCHours());
    endHour = Math.max(endHour, ev.end.getUTCHours() + (ev.end.getUTCMinutes() > 0 ? 1 : 0));
  }
  const dayStartMin = startHour * 60;
  const totalMin = (endHour - startHour) * 60;
  const bodyHeight = totalMin * PX_PER_MIN;

  // Ganztägige Termine (Feiertage) liegen außerhalb des Zeitrasters und
  // bekommen eine eigene Banner-Zeile; gleiche Höhe in allen Spalten.
  const allDayOf = (day) => eventsOnDay(events, day).filter((e) => e.allDay);
  const maxAllDay = Math.max(0, ...visible.map((d) => allDayOf(d).length));
  const allDaySlot = () => {
    const slot = el("div", "day-allday");
    // Feste Höhe (26px je Banner-Zeile + 2px Padding + 1px Rand), damit alle
    // Spalten exakt gleich hoch sind und das Zeitraster bündig bleibt.
    slot.style.height = `${maxAllDay * 26 + 3}px`;
    return slot;
  };

  const root = el("div", "week");
  root.style.setProperty("--day-count", visible.length);

  const times = el("div", "week-times");
  times.appendChild(el("div", "day-head day-head--spacer", ""));
  if (maxAllDay > 0) times.appendChild(allDaySlot());
  const timesBody = el("div", "times-body");
  timesBody.style.height = `${bodyHeight}px`;
  for (let h = startHour + 1; h <= endHour; h++) {
    const label = el("div", "time-label", `${String(h).padStart(2, "0")}:00`);
    label.style.top = `${(h * 60 - dayStartMin) * PX_PER_MIN}px`;
    timesBody.appendChild(label);
  }
  times.appendChild(timesBody);
  root.appendChild(times);

  let animIndex = 0;
  for (const day of visible) {
    const col = el("div", "week-day");
    col.dataset.date = dateKey(day);
    const head = el("button", "day-head", fmtDayHead.format(day));
    head.type = "button";
    head.title = "Listenansicht ab diesem Tag";
    head.setAttribute("aria-label", `${fmtDayHead.format(day)}: Listenansicht öffnen`);
    head.addEventListener("click", () => onDayClick(day));
    col.appendChild(head);

    if (maxAllDay > 0) {
      const slot = allDaySlot();
      for (const ev of allDayOf(day)) {
        const banner = el("div", "event-allday", ev.title);
        banner.title = ev.title;
        slot.appendChild(banner);
      }
      col.appendChild(slot);
    }

    const body = el("div", "day-body");
    body.dataset.startMinute = String(dayStartMin);
    body.dataset.totalMinutes = String(totalMin);
    body.style.height = `${bodyHeight}px`;
    body.style.setProperty("--hour-px", `${60 * PX_PER_MIN}px`);

    const timedEvents = eventsOnDay(events, day).filter((e) => !e.allDay);
    for (const { ev, col: c, cols } of layoutColumns(timedEvents)) {
      const durationMin = (ev.end - ev.start) / 60000;
      const block = el("article", "event" + (durationMin < 45 ? " event--compact" : ""));
      const top = ((ev.start.getUTCHours() * 60 + ev.start.getUTCMinutes()) - dayStartMin) * PX_PER_MIN;
      const height = Math.max(((ev.end - ev.start) / 60000) * PX_PER_MIN, 24);
      block.style.top = `${top}px`;
      block.style.height = `${height - 2}px`;
      block.style.left = `${(c / cols) * 100}%`;
      block.style.width = `calc(${100 / cols}% - 3px)`;
      block.style.animationDelay = `${Math.min(animIndex++ * 35, 500)}ms`;

      block.appendChild(el("h3", "ev-title", ev.title));
      block.appendChild(el("time", "ev-time", `${fmtTime.format(ev.start)}–${fmtTime.format(ev.end)}`));
      const description = descriptionNode(ev);
      if (description) block.appendChild(description);
      const loc = locationNode(ev);
      if (loc) block.appendChild(loc);
      body.appendChild(block);
    }

    col.appendChild(body);
    root.appendChild(col);
  }

  updateTimeIndicators(root, today);
  return root;
}

export function weekLabel(anchor) {
  const monday = startOfWeek(anchor);
  const friday = addDays(monday, 4);
  const sameMonth = monday.getUTCMonth() === friday.getUTCMonth();
  const left = sameMonth
    ? `${monday.getUTCDate()}.`
    : fmtDayMonth.format(monday);
  const right = fmtDayMonthYear.format(friday);
  return `${left}–${right}`;
}

// ---- Monatsansicht -----------------------------------------------------------

export function renderMonth(events, anchor, today, onDayClick) {
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const gridStart = startOfWeek(first);
  const daysInMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)).getUTCDate();
  const leading = (first.getUTCDay() + 6) % 7;
  const weeks = Math.ceil((leading + daysInMonth) / 7);

  const root = el("div", "month");
  let openDetail = null;
  let openChip = null;
  const closeDetail = () => {
    if (openChip) openChip.setAttribute("aria-expanded", "false");
    openDetail?.remove();
    openDetail = null;
    openChip = null;
  };
  const showDetailAfterWeek = (cell, detail) => {
    const cells = [...root.querySelectorAll(".month-cell")];
    const cellIndex = cells.indexOf(cell);
    const span = 3;
    const column = cellIndex % 7 + 1;
    const startColumn = Math.min(column, 8 - span);
    detail.style.gridColumn = "1 / -1";
    detail.style.setProperty("--detail-start", String(startColumn));
    detail.style.setProperty("--detail-span", String(span));
    const rowEndCell = cells[Math.floor(cellIndex / 7) * 7 + 6];
    const rowEndIndex = [...root.children].indexOf(rowEndCell);
    root.insertBefore(detail, root.children[rowEndIndex + 1] || null);
  };
  const setWeekActive = (week, active) => {
    for (const node of root.querySelectorAll(".month-cell")) {
      if (node.dataset.week === week) node.classList.toggle("is-week-active", active);
    }
  };

  for (const name of ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]) {
    root.appendChild(el("div", "month-headcell", name));
  }

  for (let i = 0; i < weeks * 7; i++) {
    const day = addDays(gridStart, i);
    const outside = day.getUTCMonth() !== anchor.getUTCMonth();
    const week = String(Math.floor(i / 7));
    const cell = el(
      "div",
      "month-cell" + (i % 7 === 0 ? " month-cell--week-start" : "") + (outside ? " is-outside" : ""),
    );
    cell.dataset.date = dateKey(day);
    cell.dataset.week = week;

    const num = el("button", "month-daynum", String(day.getUTCDate()));
    num.type = "button";
    num.title = "Woche öffnen";
    num.setAttribute("aria-label", `Woche für ${fmtShortDate.format(day)} öffnen`);
    num.addEventListener("mouseenter", () => setWeekActive(week, true));
    num.addEventListener("mouseleave", () => setWeekActive(week, false));
    num.addEventListener("focus", () => setWeekActive(week, true));
    num.addEventListener("blur", () => setWeekActive(week, false));
    num.addEventListener("click", () => onDayClick(day));
    cell.appendChild(num);

    if (i % 7 === 6) {
      const cue = el("span", "month-week-cue");
      cue.setAttribute("aria-hidden", "true");
      cell.appendChild(cue);
    }

    for (const ev of eventsOnDay(events, day)) {
      const chip = el("button", "month-chip");
      chip.type = "button";
      chip.setAttribute("aria-expanded", "false");
      chip.setAttribute("aria-label", `Details zu ${ev.title} anzeigen`);
      chip.appendChild(el("span", "chip-time", ev.allDay ? "ganztägig" : fmtTime.format(ev.start)));
      chip.appendChild(el("span", "chip-title", ev.title));
      chip.title = `${ev.title}${ev.location ? " · " + ev.location : ""}`;
      chip.addEventListener("click", () => {
        if (openChip === chip) {
          closeDetail();
          return;
        }
        closeDetail();
        openChip = chip;
        openChip.setAttribute("aria-expanded", "true");
        openDetail = monthDetailNode(ev, closeDetail);
        showDetailAfterWeek(cell, openDetail);
      });
      cell.appendChild(chip);
    }
    root.appendChild(cell);
  }
  updateTimeIndicators(root, today);
  return root;
}

export function monthLabel(anchor) {
  return fmtMonth.format(anchor);
}

// ---- Listenansicht -----------------------------------------------------------

// Gruppiert die kommenden Termine (max. 200) nach Tag; `from` ist ein Tagesbeginn.
export function listGroups(events, from) {
  const upcoming = events.filter((e) => e.end >= from).slice(0, 200);
  const groups = [];
  for (const ev of upcoming) {
    // Bereits laufende Mehrtagestermine unter dem Anker-Tag einsortieren,
    // nicht unter ihrem vor dem Anker liegenden Starttag
    const day = ev.start < from ? from : startOfDay(ev.start);
    const last = groups[groups.length - 1];
    if (last && sameDay(last.day, day)) last.events.push(ev);
    else groups.push({ day, events: [ev] });
  }
  return groups;
}

export function renderList(events, anchor, onDayClick) {
  const groups = listGroups(events, startOfDay(anchor));

  const root = el("div", "list");
  if (!groups.length) {
    root.appendChild(el("p", "list-empty", "Keine Termine ab diesem Datum im Feed."));
    return root;
  }

  let animIndex = 0;
  for (const { day, events: dayEvents } of groups) {
    const head = el("h2", "list-dayhead");
    if (onDayClick) {
      const btn = el("button", "list-dayhead-button", fmtDayLong.format(day));
      btn.type = "button";
      btn.title = "Woche öffnen";
      btn.addEventListener("click", () => onDayClick(day));
      head.appendChild(btn);
    } else {
      head.textContent = fmtDayLong.format(day);
    }
    root.appendChild(head);
    const dayList = el("div", "list-day");
    root.appendChild(dayList);
    for (const ev of dayEvents) {
      const row = el("article", "list-row");
      if (onDayClick) row.classList.add("list-row--action");
      row.style.animationDelay = `${Math.min(animIndex++ * 25, 400)}ms`;
      const timeText = ev.allDay
        ? (sameDay(ev.start, ev.end) ? "ganztägig" : `${fmtShortDate.format(ev.start)}–${fmtShortDate.format(ev.end)}`)
        : `${fmtTime.format(ev.start)}–${fmtTime.format(ev.end)}`;
      row.appendChild(el("time", "list-time", timeText));
      const main = el("div", "list-main");
      main.appendChild(el("h3", "ev-title", ev.title));
      const loc = locationNode(ev);
      if (loc) main.appendChild(loc);
      const description = descriptionNode(ev);
      if (description) main.appendChild(description);
      row.appendChild(main);
      if (onDayClick) {
        const action = el("button", "list-row-action", "→");
        action.type = "button";
        action.title = "Woche öffnen";
        action.setAttribute("aria-label", `${ev.title}: Woche öffnen`);
        action.addEventListener("click", () => onDayClick(day));
        row.appendChild(action);
      }
      dayList.appendChild(row);
    }
  }
  return root;
}

export function listLabel(anchor) {
  return `ab ${fmtDayLong.format(anchor)}`;
}
