// The drawing travels inside the figures exported from it: an SVG keeps it in
// its metadata, a TikZ file in comment lines at its end. Opening either brings
// back the whole drawing, dimensions, constraints and sketches, so there is no
// separate file to keep track of. It is compressed, and written as base64 so
// that it is plain text wherever it goes.

const NS = "https://mech-sketch.org/drawing";
const TAG = "mech-sketch-drawing";
const TEX_MARK = "% mech-sketch drawing:";

async function through(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text.replace(/\s+/g, ""));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** A drawing file's text, packed small: gzip, then base64. */
export async function packDrawing(json: string): Promise<string> {
  return toBase64(await through(new TextEncoder().encode(json), new CompressionStream("gzip")));
}

/** The drawing file's text back from what packDrawing made. */
export async function unpackDrawing(packed: string): Promise<string> {
  return new TextDecoder().decode(await through(fromBase64(packed), new DecompressionStream("gzip")));
}

/** An SVG file with the drawing in its metadata, right after the opening tag. */
export function svgWithDrawing(svg: string, packed: string): string {
  const open = /<svg\b[^>]*>/.exec(svg);
  if (!open) return svg;
  const at = open.index + open[0].length;
  return `${svg.slice(0, at)}\n<metadata><${TAG} xmlns="${NS}" encoding="gzip-base64">${packed}</${TAG}></metadata>${svg.slice(at)}`;
}

/** A TikZ file with the drawing in comment lines at its end, where LaTeX passes over them. */
export function texWithDrawing(tex: string, packed: string): string {
  const lines: string[] = [];
  for (let i = 0; i < packed.length; i += 96) lines.push(`${TEX_MARK} ${packed.slice(i, i + 96)}`);
  return `${tex.replace(/\n*$/, "\n")}% The drawing this figure was made from, for Mech Sketch (mech-sketch.org) to open again.\n${lines.join("\n")}\n`;
}

/** A figure that carries no drawing: an empty SVG page, so the drawing has somewhere to go. */
export const EMPTY_SVG = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10"></svg>\n`;

/**
 * What a file holds, as far as opening it goes: a drawing (the text of a
 * drawing file), an SVG with none in it, or nothing that can be opened.
 */
export async function readOpened(text: string): Promise<{ kind: "drawing"; json: string } | { kind: "svg" } | { kind: "none"; why: string }> {
  const head = text.trimStart();
  if (head.startsWith("{")) return { kind: "drawing", json: text };
  const svg = new RegExp(`<${TAG}\\b[^>]*>([^<]*)</${TAG}>`).exec(text);
  if (svg) return { kind: "drawing", json: await unpackDrawing(svg[1]) };
  if (/<svg\b/i.test(head.slice(0, 4000)) || /<svg\b/i.test(text)) return { kind: "svg" };
  const marks = text.split("\n").filter((l) => l.startsWith(TEX_MARK)).map((l) => l.slice(TEX_MARK.length).trim());
  if (marks.length) return { kind: "drawing", json: await unpackDrawing(marks.join("")) };
  if (/\\begin\{tikzpicture\}/.test(text)) return { kind: "none", why: "This TikZ file was not exported by Mech Sketch, so it has no drawing in it to open." };
  return { kind: "none", why: "This is not a Mech Sketch drawing, an SVG or a TikZ file exported by Mech Sketch." };
}
