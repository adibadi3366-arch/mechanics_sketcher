// The connection list: every wire of the guide as a row of a CSV file, so a
// guide can be written from a spreadsheet and a guide's wiring kept in one.
//
//   from_device,from_port,from_pin,to_device,to_port,to_pin,colour,label
//   H743,GPS,Tx3,GPS,GPS,Rx,,
//
// A port may be left empty where the device has only one, or only one with a
// pin of that name. The colour is a name (red, black, yellow ...) or a hex
// colour; left empty, a wire takes the colour of what its first pin does.

import {
  type Circuit, type Wire, type WireEnd, type Device, type PartDef,
  deviceById, deviceByName, partOf, readColor, colorName, circuitId, sameEnd, freeName,
} from "./model";
import { starterPart, useStarter, STARTER } from "./starter";
import { autoPlace } from "./autolayout";

export const CSV_COLUMNS = ["from_device", "from_port", "from_pin", "to_device", "to_port", "to_pin", "colour", "label"] as const;
export type CsvRow = Record<(typeof CSV_COLUMNS)[number], string>;

/** One line of a CSV file split into its fields: commas inside quotes are kept, doubled quotes are one. */
export function splitCsvLine(line: string, sep = ","): string[] {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/** What the columns can be called, besides their own names. */
const ALIASES: Record<string, (typeof CSV_COLUMNS)[number]> = {
  from: "from_device", from_device: "from_device", device_a: "from_device", source: "from_device", from_part: "from_device",
  from_port: "from_port", from_connector: "from_port", port_a: "from_port",
  from_pin: "from_pin", pin_a: "from_pin",
  to: "to_device", to_device: "to_device", device_b: "to_device", target: "to_device", to_part: "to_device",
  to_port: "to_port", to_connector: "to_port", port_b: "to_port",
  to_pin: "to_pin", pin_b: "to_pin",
  colour: "colour", color: "colour", wire_colour: "colour", wire_color: "colour",
  label: "label", note: "label", notes: "label", comment: "label",
};

/**
 * The rows of a connection list. Lines starting with # are notes; the first
 * other line names the columns. Semicolons or tabs between fields are taken
 * as well as commas, as spreadsheets in some countries write them.
 */
export function readCsv(text: string): { rows: CsvRow[]; problems: string[] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (!lines.length) return { rows: [], problems: ["The file is empty."] };
  const first = lines[0];
  const sep = first.includes(",") ? "," : first.includes(";") ? ";" : first.includes("\t") ? "\t" : ",";
  const head = splitCsvLine(first, sep).map((h) => ALIASES[h.toLowerCase().replace(/[\s-]+/g, "_")] ?? null);
  const problems: string[] = [];
  for (const need of ["from_device", "from_pin", "to_device", "to_pin"] as const) {
    if (!head.includes(need)) problems.push(`The first line has no column called ${need}.`);
  }
  if (problems.length) return { rows: [], problems };
  const rows: CsvRow[] = [];
  lines.slice(1).forEach((line, i) => {
    const v = splitCsvLine(line, sep);
    const row = Object.fromEntries(CSV_COLUMNS.map((c) => [c, ""])) as CsvRow;
    head.forEach((h, j) => { if (h) row[h] = v[j] ?? ""; });
    if (!row.from_device || !row.from_pin || !row.to_device || !row.to_pin) {
      problems.push(`Line ${i + 2} is missing a device or a pin.`);
      return;
    }
    rows.push(row);
  });
  return { rows, problems };
}

/** The guide's wires as a connection list. */
export function writeCsv(c: Circuit): string {
  const q = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = c.wires.map((w) => {
    const a = deviceById(c, w.a.dev), b = deviceById(c, w.b.dev);
    return [a?.name ?? "", w.a.port, w.a.pin, b?.name ?? "", w.b.port, w.b.pin, w.color ? colorName(w.color) : "", w.label ?? ""].map(q).join(",");
  });
  return [CSV_COLUMNS.join(","), ...rows].join("\n") + "\n";
}

export interface CsvReport {
  added: number;
  /** Rows that were in the guide already. */
  kept: number;
  /** Devices that were placed because the list names them. */
  placed: string[];
  problems: string[];
}

/** The part a device of this name is placed from: one of the guide's own, or a starter part. */
function partFor(c: Circuit, name: string): { part: PartDef } | { starter: string } | null {
  const key = name.trim().toLowerCase();
  const bare = key.replace(/\s*\d+$/, "");
  const match = (p: Pick<PartDef, "ref" | "name">) => [p.ref.toLowerCase(), p.name.toLowerCase()].some((n) => n === key || n === bare);
  const own = c.parts.find(match);
  if (own) return { part: own };
  for (const s of STARTER) {
    const p = starterPart(s.key);
    if (p && match(p)) return { starter: s.key };
  }
  return null;
}

/**
 * Adds the wires of a connection list to the guide. Devices it names that are
 * not on the guide are placed, from the guide's parts or the starter parts,
 * when one goes by that name. Rows that name no pin there are reported.
 */
export function applyCsv(c: Circuit, rows: CsvRow[]): CsvReport {
  const report: CsvReport = { added: 0, kept: 0, placed: [], problems: [] };
  const unknown = new Set<string>();
  const device = (name: string): Device | null => {
    const had = deviceByName(c, name);
    if (had) return had;
    if (unknown.has(name.toLowerCase())) return null;
    const found = partFor(c, name);
    if (!found) {
      unknown.add(name.toLowerCase());
      report.problems.push(`No part is called ${name}: draw it, import it, or rename the device on the guide to match.`);
      return null;
    }
    const part = "part" in found ? found.part : useStarter(c, found.starter, () => circuitId(c, "p"))!;
    // Where it goes is worked out once all its wires are known.
    const d: Device = { id: circuitId(c, "d"), part: part.id, name: freeName(c, name), x: 0, y: 0, turn: 0 };
    c.devices.push(d);
    report.placed.push(d.name);
    return d;
  };
  const end = (devName: string, port: string, pin: string, line: number): WireEnd | null => {
    const d = device(devName);
    if (!d) return null;
    const part = partOf(c, d);
    const ports = part?.ports ?? [];
    const p = port.trim()
      ? ports.find((x) => x.name.toLowerCase() === port.trim().toLowerCase())
      : ports.length === 1 ? ports[0] : (() => { const has = ports.filter((x) => x.pins.some((q) => q.name.toLowerCase() === pin.trim().toLowerCase())); return has.length === 1 ? has[0] : undefined; })();
    if (!p) {
      report.problems.push(port.trim() ? `Line ${line}: ${d.name} has no port ${port}.` : `Line ${line}: say which port of ${d.name} the pin ${pin} is on.`);
      return null;
    }
    const q = p.pins.find((x) => x.name === pin.trim()) ?? p.pins.find((x) => x.name.toLowerCase() === pin.trim().toLowerCase());
    if (!q) {
      report.problems.push(`Line ${line}: port ${p.name} of ${d.name} has no pin ${pin}.`);
      return null;
    }
    return { dev: d.id, port: p.name, pin: q.name };
  };
  rows.forEach((r, i) => {
    const line = i + 2;
    const a = end(r.from_device, r.from_port, r.from_pin, line), b = end(r.to_device, r.to_port, r.to_pin, line);
    if (!a || !b) return;
    if (a.dev === b.dev && a.port === b.port) {
      report.problems.push(`Line ${line}: both ends are on the same port.`);
      return;
    }
    const color = readColor(r.colour);
    if (color === null) report.problems.push(`Line ${line}: ${r.colour} is not a colour; the wire takes the colour of its pin.`);
    const had = c.wires.find((w) => (sameEnd(w.a, a) && sameEnd(w.b, b)) || (sameEnd(w.a, b) && sameEnd(w.b, a)));
    if (had) {
      if (color) had.color = color;
      if (r.label) had.label = r.label;
      report.kept++;
      return;
    }
    const w: Wire = { id: circuitId(c, "w"), a, b, ...(color ? { color } : {}), ...(r.label ? { label: r.label } : {}) };
    c.wires.push(w);
    report.added++;
  });
  autoPlace(c, report.placed.map((n) => deviceByName(c, n)!.id));
  return report;
}
