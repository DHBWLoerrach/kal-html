import { parseICS, toBerlinTime } from './ics.js';
import {
  renderWeek,
  renderMonth,
  renderList,
  weekLabel,
  monthLabel,
  listLabel,
  startOfDay,
  startOfWeek,
  addDays,
  addMonths,
  parseISODate,
  updateTimeIndicators,
} from './views.js';

const ANSICHTEN = ['woche', 'monat', 'liste'];

const FAKULTAETEN = { T: 'Technik', W: 'Wirtschaft', G: 'Gesundheit' };
const PROGRAMS = [
  { code: 'TIF', name: 'Informatik' },
  { code: 'WWI', name: 'Wirtschaftsinformatik' },
  { code: 'WDS', name: 'Data Science und Künstliche Intelligenz' },
];

// „Jetzt" konsequent in Berliner Wandzeit, passend zu den Feed-Zeiten —
// sonst stimmen „heute" und Jetzt-Linie in anderen Gerätezeitzonen nicht.
const now = () => toBerlinTime(new Date());

const state = {
  kurs: '',
  ansicht: 'woche',
  datum: startOfDay(now()),
};

const FEED_TTL = 10 * 60 * 1000; // Plan-Änderungen auch ohne Reload sichtbar machen
const feedCache = new Map(); // kurs -> { time, promise }
let courses = [];
let renderGeneration = 0; // verwirft veraltete Feed-Antworten nach Kurswechsel
let lastRendered = null; // { kurs, text } des aktuell angezeigten Kalenders

export function q(sel, root = document) {
  return root.querySelector(sel);
}

export function qs(sel, root = document) {
  const node = q(sel, root);
  if (!node) throw new Error(`Element nicht gefunden: ${sel}`);
  return node;
}

export function normalizeCourse(kurs) {
  return String(kurs ?? '').trim().toUpperCase();
}

// ---- URL-Synchronisation -----------------------------------------------------

function readURL() {
  const p = new URLSearchParams(location.search);
  const kurs = normalizeCourse(p.get('kurs'));
  if (kurs) state.kurs = kurs;
  const ansicht = (p.get('ansicht') || '').toLowerCase();
  if (ANSICHTEN.includes(ansicht)) state.ansicht = ansicht;
  const datum = parseISODate(p.get('datum') || '');
  if (datum) state.datum = datum;
  state.datum = clampDateForView(state.datum, state.ansicht);
}

function writeURL() {
  history.replaceState(null, '', urlForState(location.pathname, location.search, state));
}

export function urlForState(pathname, search, nextState, today = now()) {
  const p = new URLSearchParams(search);

  if (!nextState.kurs) {
    p.delete('kurs');
    p.delete('ansicht');
    p.delete('datum');
    const query = p.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  p.set('kurs', nextState.kurs);
  p.set('ansicht', nextState.ansicht);
  // "heute" nicht festschreiben, damit Bookmarks aktuell bleiben
  if (nextState.datum.getTime() !== startOfDay(today).getTime()) {
    // nextState.datum ist immer eine UTC-Mitternacht → ISO-Präfix ist das Datum
    p.set('datum', nextState.datum.toISOString().slice(0, 10));
  } else {
    p.delete('datum');
  }

  const query = p.toString();
  return query ? `${pathname}?${query}` : pathname;
}

// ---- Kurskürzel deuten ---------------------------------------------------------

function parseCourse(kurs) {
  const m = /^([A-Z])([A-Z]{1,4})(\d{2})([A-Z]?)(?:-([A-Z]+))?$/.exec(kurs);
  if (!m) return null;
  const [, fak, sg, jahr, gruppe, suffix] = m;
  return { fak, sg, prefix: `${fak}${sg}`, jahr, gruppe, suffix };
}

function programForCourse(kurs) {
  const parsed = parseCourse(kurs);
  if (!parsed) return null;
  return PROGRAMS.find((program) => program.code === parsed.prefix) || null;
}

export function courseMeta(kurs) {
  const parsed = parseCourse(kurs);
  if (!parsed) return '';
  const { fak, prefix, jahr, gruppe, suffix } = parsed;
  const program = programForCourse(kurs);
  const parts = [
    FAKULTAETEN[fak] || `Fakultät ${fak}`,
    program?.name || prefix,
    `Jahrgang 20${jahr}`,
  ];
  if (gruppe) parts.push(`Kurs ${gruppe}`);
  if (suffix) parts.push(suffix);
  return parts.join(' · ');
}

export function groupCourses(courseList) {
  const uniqueCourses = [
    ...new Set(courseList.map(normalizeCourse).filter(Boolean)),
  ];
  return PROGRAMS.map((program) => ({
    ...program,
    label: `${program.name} (${program.code})`,
    courses: uniqueCourses
      .filter((kurs) => programForCourse(kurs)?.code === program.code)
      .sort(),
  })).filter((group) => group.courses.length);
}

// ---- Daten laden ---------------------------------------------------------------

function loadFeed(kurs) {
  const cached = feedCache.get(kurs);
  if (cached && Date.now() - cached.time < FEED_TTL) return cached.promise;

  const promise = fetch(`/ics/${encodeURIComponent(kurs.toLowerCase())}`).then(
    async (resp) => {
      if (!resp.ok)
        throw new Error((await resp.text()) || `Fehler ${resp.status}`);
      const text = await resp.text();
      return { text, events: parseICS(text) };
    },
  );
  const entry = { time: Date.now(), promise };
  // Fehler nicht cachen — auch Netzwerkfehler, die fetch() selbst rejecten lassen
  promise.catch(() => {
    if (feedCache.get(kurs) === entry) feedCache.delete(kurs);
  });
  feedCache.set(kurs, entry);
  return promise;
}

// ---- Rendern -------------------------------------------------------------------

async function render({ background = false } = {}) {
  state.datum = clampDateForView(state.datum, state.ansicht);
  const generation = ++renderGeneration;
  writeURL();

  if (!state.kurs) {
    renderCourseLanding();
    return;
  }

  qs('.controls').hidden = false;
  qs('#kursTitle').textContent = state.kurs;
  qs('#kursMeta').textContent = courseMeta(state.kurs);
  document.title = `${state.kurs} · Vorlesungsplan DHBW Lörrach`;
  qs('#icsLink').href = `/ics/${state.kurs.toLowerCase()}`;
  qs('#icsLink').textContent = `kal-${state.kurs.toLowerCase()}`;

  for (const btn of document.querySelectorAll('.view-switch button')) {
    btn.classList.toggle('is-active', btn.dataset.ansicht === state.ansicht);
  }
  const select = qs('#kursSelect');
  select.value = courses.includes(state.kurs) ? state.kurs : '';

  qs('#rangeLabel').textContent = {
    woche: weekLabel,
    monat: monthLabel,
    liste: listLabel,
  }[state.ansicht](state.datum);
  updateNavigationButtons();

  const container = qs('#calendar');
  if (!background)
    container.replaceChildren(el('p', 'loading', 'Lade Kalender…'));

  let feed;
  try {
    feed = await loadFeed(state.kurs);
  } catch (err) {
    if (generation !== renderGeneration) return;
    if (!background) {
      lastRendered = null;
      container.replaceChildren(errorBox(err.message));
    }
    return;
  }
  if (generation !== renderGeneration) return;

  // Unveränderter Feed → angezeigten Kalender stehen lassen, sonst spielen
  // Einblend-Animationen erneut ab und die Scroll-Position geht verloren.
  if (
    background &&
    lastRendered &&
    lastRendered.kurs === state.kurs &&
    lastRendered.text === feed.text
  )
    return;
  const events = feed.events;

  const today = now();
  const openDay = (day) => {
    state.datum = startOfDay(day);
    state.ansicht = state.ansicht === 'woche' ? 'liste' : 'woche';
    render();
  };

  const view = {
    woche: () => renderWeek(events, state.datum, today, openDay),
    monat: () => renderMonth(events, state.datum, today, openDay),
    liste: () => renderList(events, state.datum, openDay),
  }[state.ansicht]();

  container.replaceChildren(view);
  lastRendered = { kurs: state.kurs, text: feed.text };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

export function renderCourseStart(courseList, selectCourse) {
  const root = el('div', 'course-start', '');
  const groups = groupCourses(courseList);

  for (const group of groups) {
    const section = el('section', 'course-group', '');
    section.appendChild(el('h2', 'course-group-title', group.name));

    const grid = el('div', 'course-grid', '');
    for (const kurs of group.courses) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'course-card';
      card.addEventListener('click', () => selectCourse(kurs));
      card.appendChild(el('strong', 'course-card-code', kurs));
      grid.appendChild(card);
    }
    section.appendChild(grid);
    root.appendChild(section);
  }

  if (!groups.length) {
    root.appendChild(el('p', 'list-empty', 'Keine Kurse hinterlegt.'));
  }

  return root;
}

function renderCourseLanding() {
  qs('.controls').hidden = true;
  qs('#kursTitle').textContent = 'Kurs wählen';
  document.title = 'Vorlesungsplan DHBW Lörrach';
  qs('#icsLink').href = '#';
  qs('#icsLink').textContent = 'kein Kurs gewählt';
  qs('#kursSelect').value = '';
  qs('#rangeLabel').textContent = '';
  const limitHint = q('#navLimitHint');
  if (limitHint) limitHint.hidden = true;
  qs('#calendar').replaceChildren(renderCourseStart(courses, setKurs));
  lastRendered = null;
}

function errorBox(message) {
  const box = el('div', 'error', '');
  box.appendChild(el('h2', 'error-title', 'Kalender nicht verfügbar'));
  box.appendChild(el('p', 'error-text', message));
  box.appendChild(
    el(
      'p',
      'error-hint',
      'Kurskürzel prüfen (z. B. TIF25A) oder später erneut versuchen.',
    ),
  );
  return box;
}

// ---- Steuerung -----------------------------------------------------------------

function lastMonthStart() {
  const today = now();
  const monthStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
  );
  return addMonths(monthStart, -1);
}

function firstAllowedWeekStart() {
  const limit = lastMonthStart();
  const weekStart = startOfWeek(limit);
  return weekStart < limit ? addDays(weekStart, 7) : weekStart;
}

function clampDateForView(date, view) {
  if (view === 'monat') {
    const limit = lastMonthStart();
    const monthStart = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
    );
    return monthStart < limit ? limit : date;
  }

  if (view === 'woche') {
    const minWeekStart = firstAllowedWeekStart();
    const weekStart = startOfWeek(date);
    return weekStart < minWeekStart ? minWeekStart : date;
  }

  return date;
}

function canNavigate(direction) {
  if (direction >= 0) return true;
  if (state.ansicht !== 'woche' && state.ansicht !== 'monat') return true;

  if (state.ansicht === 'monat') {
    const limit = lastMonthStart();
    const monthStart = new Date(
      Date.UTC(state.datum.getUTCFullYear(), state.datum.getUTCMonth(), 1),
    );
    const target = addMonths(monthStart, direction);
    return target >= limit;
  }

  const minWeekStart = firstAllowedWeekStart();
  const target = addDays(startOfWeek(state.datum), direction * 7);
  return target >= minWeekStart;
}

function updateNavigationButtons() {
  const prevBlocked = !canNavigate(-1);
  const prevButton = qs('#navPrev');
  const limitHint = q('#navLimitHint');
  const showLimitHint =
    prevBlocked && (state.ansicht === 'woche' || state.ansicht === 'monat');

  prevButton.disabled = prevBlocked;
  prevButton.setAttribute('aria-disabled', String(prevBlocked));
  prevButton.title = prevBlocked
    ? 'Ältere Termine werden im Feed nicht ausgeliefert.'
    : '';

  if (limitHint) {
    limitHint.hidden = !showLimitHint;
  }
}

function navigate(direction) {
  if (!canNavigate(direction)) return;

  if (state.ansicht === 'monat') {
    state.datum = addMonths(state.datum, direction);
  } else {
    const base =
      state.ansicht === 'woche' ? startOfWeek(state.datum) : state.datum;
    state.datum = addDays(base, direction * 7);
  }
  render();
}

export function scrollToTopForListView(view, win = globalThis.window) {
  if (view !== 'liste') return;
  win?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
}

function setKurs(kurs) {
  kurs = normalizeCourse(kurs);
  if (!kurs || kurs === state.kurs) return;
  state.kurs = kurs;
  render();
}

function buildKursSelect() {
  const select = qs('#kursSelect');
  const placeholder = select.querySelector('option[value=""]');
  select.replaceChildren();
  if (placeholder) select.appendChild(placeholder);
  for (const groupInfo of groupCourses(courses)) {
    const group = document.createElement('optgroup');
    group.label = groupInfo.label;
    for (const kurs of groupInfo.courses) {
      const opt = document.createElement('option');
      opt.value = kurs;
      opt.textContent = kurs;
      group.appendChild(opt);
    }
    select.appendChild(group);
  }
}

async function init() {
  try {
    courses = await fetch('courses.json').then((r) => r.json());
  } catch {
    courses = [];
  }
  readURL();
  buildKursSelect();

  qs('#kursSelect').addEventListener('change', (e) => setKurs(e.target.value));
  qs('#kursForm').addEventListener('submit', (e) => {
    e.preventDefault();
    setKurs(qs('#kursInput').value);
    qs('#kursInput').value = '';
  });
  for (const btn of document.querySelectorAll('.view-switch button')) {
    btn.addEventListener('click', () => {
      state.ansicht = btn.dataset.ansicht;
      render();
    });
  }
  qs('#navPrev').addEventListener('click', () => navigate(-1));
  qs('#navNext').addEventListener('click', () => navigate(1));
  qs('#navToday').addEventListener('click', () => {
    state.datum = startOfDay(now());
    scrollToTopForListView(state.ansicht);
    render();
  });

  // Planänderungen auch ohne Interaktion sichtbar machen (README: ~20 Minuten):
  // neu rendern, sobald der Feed-Cache abgelaufen ist — minütlich geprüft und
  // beim Zurückkehren in den Tab. Frische Caches und unverändert zurückkommende
  // Feeds lösen kein DOM-Rebuild aus.
  const refresh = () => {
    if (!state.kurs) return;
    if (document.hidden) return;
    updateTimeIndicators(qs('#calendar'), now());

    const cached = feedCache.get(state.kurs);
    if (cached && Date.now() - cached.time < FEED_TTL) return;
    render({ background: true });
  };
  setInterval(refresh, 60 * 1000);
  document.addEventListener('visibilitychange', refresh);

  render();
}

if (typeof document !== 'undefined' && document.querySelector?.('#calendar')) {
  init();
}
