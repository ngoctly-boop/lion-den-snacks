(() => {
  const YEAR_START = new Date("2026-09-01T00:00:00-05:00");
  const YEAR_END = new Date("2027-08-31T23:59:59-05:00");
  const ICS_URL = "https://pack110.trooptrack.com/troops/6ltDIuBAf6pK0KXwFIjJCg/calendar";
  const LIVE_URL = "https://ngoctly-boop.github.io/lion-den-snacks/";
  const TZ = "America/Chicago";
  const params = new URLSearchParams(location.search);
  const isPreview = params.has("preview") || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const signupFile = isPreview ? "data/preview-signups.json" : "data/live-signups.json";
  const state = { meetings: [], signups: {}, filter: "upcoming", activeId: null };
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2200); }
  function envLabel() { return isPreview ? "preview" : "live"; }
  function parseICSDate(raw) {
    if (!raw) return null;
    const v = raw.includes(":") ? raw.split(":").pop() : raw;
    const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
    if (!m) return null;
    if (v.endsWith("Z")) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
  }
  function unfoldICS(text) {
    const lines = [];
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith(" ") || line.startsWith("\t")) lines[lines.length - 1] += line.slice(1);
      else lines.push(line);
    }
    return lines;
  }
  function parseICS(text) {
    const events = []; let cur = null;
    for (const line of unfoldICS(text)) {
      if (line === "BEGIN:VEVENT") cur = {};
      else if (line === "END:VEVENT") events.push(cur);
      else if (cur && line.includes(":")) { const idx = line.indexOf(":"); cur[line.slice(0, idx).split(";")[0]] = line.slice(idx + 1); }
    }
    return events;
  }
  function isLionMeeting(ev) {
    const title = (ev.SUMMARY || "").trim();
    const blob = `${title} ${ev.DESCRIPTION || ""}`.toLowerCase();
    if (/end of year|eoy|celebration|crossover/.test(blob)) return false;
    return /\blions?\s+den\s+meeting\b/i.test(title) || /\blion den\b/i.test(title);
  }
  function inScoutYear(d) { return d && d >= YEAR_START && d <= YEAR_END; }
  function normalizeEvent(ev) {
    const start = parseICSDate(ev.DTSTART);
    const end = parseICSDate(ev.DTEND) || (start ? new Date(start.getTime() + 3600000) : null);
    return { id: ev.UID || `lion-${ev.DTSTART}`, title: (ev.SUMMARY || "Lion Den Meeting").replace(/\\,/g, ","), start: start ? start.toISOString() : null, end: end ? end.toISOString() : null, location: (ev.LOCATION || "").replace(/\\,/g, ","), timezone: TZ };
  }
  function mergeMeetings(fromFile, fromICS) {
    const map = new Map();
    for (const m of fromFile || []) map.set(m.id, { ...m });
    for (const m of fromICS || []) {
      const prev = map.get(m.id);
      map.set(m.id, prev ? { ...prev, title: m.title || prev.title, start: m.start || prev.start, end: m.end || prev.end, location: m.location || prev.location } : m);
    }
    return [...map.values()].sort((a, b) => new Date(a.start) - new Date(b.start));
  }
  async function loadJSON(path) {
    const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(path);
    return res.json();
  }
  async function loadICS() {
    const proxies = [ICS_URL, `https://api.allorigins.win/raw?url=${encodeURIComponent(ICS_URL)}`];
    for (const url of proxies) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) continue;
        const text = await res.text();
        if (!text.includes("BEGIN:VCALENDAR")) continue;
        return parseICS(text).filter(isLionMeeting).map(normalizeEvent).filter((m) => m.start && inScoutYear(new Date(m.start)));
      } catch (_) {}
    }
    return [];
  }
  function fmtDay(iso) { return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric", timeZone: TZ }).format(new Date(iso)); }
  function fmtTime(iso) { return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ }).format(new Date(iso)); }
  function fmtRange(m) { return `${fmtTime(m.start)}–${fmtTime(m.end)}`; }
  function isPast(m) { return new Date(m.end || m.start) < new Date(); }
  function isTaken(id) { const s = state.signups[id]; return !!(s && s.parent && s.scout); }
  function filtered() {
    return state.meetings.filter((m) => {
      if (state.filter === "upcoming") return !isPast(m);
      if (state.filter === "open") return !isTaken(m.id) && !isPast(m);
      if (state.filter === "taken") return isTaken(m.id);
      return true;
    });
  }
  function escapeHtml(s) { return String(s || "").replace(/&/g,"&").replace(/</g,"<").replace(/>/g,">").replace(/"/g,"""); }
  function renderCounts() {
    const upcoming = state.meetings.filter((m) => !isPast(m));
    $("#openCount").textContent = upcoming.filter((m) => !isTaken(m.id)).length;
    $("#takenCount").textContent = upcoming.filter((m) => isTaken(m.id)).length;
  }
  function renderList() {
    const root = $("#meetings");
    const rows = filtered();
    if (!rows.length) { root.innerHTML = `<p class="empty">No meetings in this view.</p>`; return; }
    root.innerHTML = rows.map((m) => {
      const taken = isTaken(m.id);
      const s = state.signups[m.id] || {};
      return `<article class="card"><div class="card-top"><div><p class="when">${fmtDay(m.start)}</p><p class="title">${escapeHtml(m.title)}</p><p class="meta">${fmtRange(m)}${m.location ? " · " + escapeHtml(m.location) : ""}</p></div><span class="badge-status ${taken ? "taken" : "open"}">${taken ? "Taken" : "Open"}</span></div>${taken ? `<p class="taken-by">${escapeHtml(s.parent)} <span>then</span> ${escapeHtml(s.scout)}</p>` : `<button class="signup-btn" data-signup="${m.id}" type="button">I’ll bring snacks</button>`}</article>`;
    }).join("");
  }
  function persistLocal() { localStorage.setItem(`lion-den-snacks:${envLabel()}`, JSON.stringify(state.signups)); }
  function readLocal() { try { return JSON.parse(localStorage.getItem(`lion-den-snacks:${envLabel()}`) || "{}"); } catch { return {}; } }
  function mergeSignups(remote, local) {
    const out = { ...(remote || {}) };
    for (const [id, val] of Object.entries(local || {})) {
      if (out[id] && out[id].parent && out[id].scout) continue;
      if (val && val.parent && val.scout) out[id] = val;
    }
    return out;
  }
  async function saveSignup(id, parent, scout) {
    if (state.signups[id]?.parent) throw new Error("taken");
    state.signups[id] = { parent, scout, at: new Date().toISOString() };
    persistLocal();
  }
  function dtStamp(iso) {
    const d = new Date(iso); const p = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}${p(d.getUTCMonth()+1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}00Z`;
  }
  function icsFor(m, signup) {
    const desc = signup ? `${signup.parent} then ${signup.scout} — Lion Den snacks` : "Lion Den snacks";
    return ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Lion Den Snacks//Pack 110//EN","BEGIN:VEVENT",`UID:${m.id}@lion-den-snacks`,`DTSTAMP:${dtStamp(new Date().toISOString())}`,`DTSTART:${dtStamp(m.start)}`,`DTEND:${dtStamp(m.end)}`,`SUMMARY:Lion Den snacks — ${m.title}`,`DESCRIPTION:${desc}`,`LOCATION:${m.location || ""}`,"END:VEVENT","END:VCALENDAR"].join("\r\n");
  }
  function googleCal(m) {
    const fmt = (iso) => new Date(iso).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"");
    const url = new URL("https://calendar.google.com/calendar/render");
    url.searchParams.set("action","TEMPLATE"); url.searchParams.set("text",`Lion Den snacks — ${m.title}`);
    url.searchParams.set("dates",`${fmt(m.start)}/${fmt(m.end)}`); url.searchParams.set("details","Castle Hills Pack 110 Lion Den snacks");
    url.searchParams.set("location", m.location || ""); url.searchParams.set("ctz", TZ); return url.toString();
  }
  function outlookCal(m) {
    const url = new URL("https://outlook.live.com/calendar/0/action/compose");
    url.searchParams.set("rru","addevent"); url.searchParams.set("subject",`Lion Den snacks — ${m.title}`);
    url.searchParams.set("startdt", new Date(m.start).toISOString()); url.searchParams.set("enddt", new Date(m.end).toISOString());
    url.searchParams.set("body","Castle Hills Pack 110 Lion Den snacks"); url.searchParams.set("location", m.location || ""); return url.toString();
  }
  function icsURL(m, signup) { return URL.createObjectURL(new Blob([icsFor(m, signup)], { type: "text/calendar;charset=utf-8" })); }
  function openSignup(id) {
    if (isTaken(id)) return; state.activeId = id;
    const m = state.meetings.find((x) => x.id === id);
    $("#signupWhen").textContent = m ? `${fmtDay(m.start)} · ${fmtRange(m)}` : "";
    $("#parentName").value = ""; $("#scoutName").value = ""; $("#signupDlg").showModal(); $("#parentName").focus();
  }
  function showConfirm(id) {
    const m = state.meetings.find((x) => x.id === id); const s = state.signups[id];
    $("#confirmText").textContent = `${s.parent} then ${s.scout} — ${fmtDay(m.start)}`;
    $("#calGoogle").href = googleCal(m); $("#calOutlook").href = outlookCal(m);
    const apple = icsURL(m, s); $("#calApple").href = apple; $("#calApple").download = "lion-den-snacks.ics";
    $("#calIcs").onclick = () => { const a = document.createElement("a"); a.href = apple; a.download = "lion-den-snacks.ics"; a.click(); };
    $("#confirmDlg").showModal();
  }
  function drawQR() {
    const box = $("#qrBox"); box.innerHTML = "";
    const img = document.createElement("img"); img.alt = "Share sheet";
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(LIVE_URL)}`;
    box.appendChild(img);
  }
  async function boot() {
    let fileMeetings = [];
    try { const data = await loadJSON("data/meetings.json"); fileMeetings = (data.meetings || []).filter((m) => m.start && inScoutYear(new Date(m.start))); } catch (_) {}
    let icsMeetings = []; try { icsMeetings = await loadICS(); } catch (_) {}
    state.meetings = mergeMeetings(fileMeetings, icsMeetings);
    let remote = {}; try { remote = (await loadJSON(signupFile)).signups || {}; } catch (_) {}
    state.signups = mergeSignups(remote, readLocal()); persistLocal(); renderCounts(); renderList(); drawQR();
  }
  document.addEventListener("click", (e) => {
    const f = e.target.closest("[data-filter]");
    if (f) { state.filter = f.dataset.filter; $$(".filters button").forEach((b) => b.setAttribute("aria-pressed", b === f ? "true" : "false")); renderList(); }
    const s = e.target.closest("[data-signup]"); if (s) openSignup(s.dataset.signup);
    if (e.target.id === "shareBtn") $("#shareDlg").showModal();
    if (e.target.id === "copyLink") navigator.clipboard.writeText(LIVE_URL).then(() => toast("Link copied")).catch(() => toast("Copy failed"));
    if (e.target.id === "printSheet") { $("#shareDlg").close(); window.print(); }
  });
  $("#signupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const parent = $("#parentName").value.trim(); const scout = $("#scoutName").value.trim();
    if (!parent || !scout || !state.activeId) return;
    try { await saveSignup(state.activeId, parent, scout); }
    catch { toast("That date is already taken."); $("#signupDlg").close(); renderCounts(); renderList(); return; }
    const id = state.activeId; $("#signupDlg").close(); renderCounts(); renderList(); showConfirm(id);
  });
  $$("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
  boot();
})();
