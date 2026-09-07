import { readFileSync, writeFileSync } from "node:fs";

const ICS_URL = "https://pack110.trooptrack.com/troops/6ltDIuBAf6pK0KXwFIjJCg/calendar";
const YEAR_START = new Date("2026-09-01T00:00:00-05:00");
const YEAR_END = new Date("2027-08-31T23:59:59-05:00");

function unfold(text) {
  const lines = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith(" ") || line.startsWith("\t")) lines[lines.length - 1] += line.slice(1);
    else lines.push(line);
  }
  return lines;
}

function parseICS(text) {
  const events = [];
  let cur = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT") events.push(cur);
    else if (cur && line.includes(":")) {
      const i = line.indexOf(":");
      cur[line.slice(0, i).split(";")[0]] = line.slice(i + 1);
    }
  }
  return events;
}

function parseDate(raw) {
  if (!raw) return null;
  const v = raw.includes(":") ? raw.split(":").pop() : raw;
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!m) return null;
  if (v.endsWith("Z")) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
}

function isLion(ev) {
  const title = (ev.SUMMARY || "").trim();
  const blob = `${title} ${ev.DESCRIPTION || ""}`.toLowerCase();
  if (/end of year|eoy|celebration|crossover/.test(blob)) return false;
  return /\blions?\s+den\s+meeting\b/i.test(title) || /\blion den\b/i.test(title);
}

const res = await fetch(ICS_URL, { headers: { "user-agent": "LionDenSnacks/1.0" } });
if (!res.ok) throw new Error(`ICS HTTP ${res.status}`);
const incoming = parseICS(await res.text())
  .filter(isLion)
  .map((ev) => {
    const start = parseDate(ev.DTSTART);
    const end = parseDate(ev.DTEND) || (start ? new Date(start.getTime() + 3600000) : null);
    return {
      id: ev.UID || `lion-${ev.DTSTART}`,
      title: (ev.SUMMARY || "Lion Den Meeting").replace(/\\,/g, ","),
      start: start ? start.toISOString() : null,
      end: end ? end.toISOString() : null,
      timezone: "America/Chicago",
      location: (ev.LOCATION || "").replace(/\\,/g, ","),
    };
  })
  .filter((m) => m.start && new Date(m.start) >= YEAR_START && new Date(m.start) <= YEAR_END);

const path = "data/meetings.json";
const current = JSON.parse(readFileSync(path, "utf8"));
const map = new Map((current.meetings || []).map((m) => [m.id, m]));
for (const m of incoming) {
  const prev = map.get(m.id);
  map.set(m.id, prev ? { ...prev, title: m.title, start: m.start, end: m.end, location: m.location } : m);
}
const next = {
  year: "2026-27",
  source: ICS_URL,
  updatedAt: new Date().toISOString(),
  meetings: [...map.values()].sort((a, b) => new Date(a.start) - new Date(b.start)),
};
writeFileSync(path, JSON.stringify(next, null, 2) + "\n");
console.log(`Meetings: ${next.meetings.length}`);
