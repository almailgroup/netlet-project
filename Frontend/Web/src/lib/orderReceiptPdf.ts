/**
 * An order as a receipt, saved as a PDF, on the owner's word ("an export to
 * PDF option that will show all the details of your order in the form of a
 * receipt").
 *
 * The receipt is drawn on a canvas and the canvas is the PDF's one page: the
 * browser shapes Arabic and lays out right-to-left text, which `pdf-lib`
 * cannot, so a receipt in Arabic reads as the page does. One tall page rather
 * than A4 sheets, which is what a receipt is, at 2.5 times its size so the
 * words print sharp. Everything it says arrives already in words
 * (`ReceiptDocument`, made by `OrderReceipt.tsx` from the order and the
 * shared rule `orderReceipt.ts`); this only lays them out.
 *
 * `pdf-lib` is fetched when the press asks for it, as the catalogue shrinker
 * does, so My orders downloads nothing for it until then.
 */
import type * as PdfLib from "pdf-lib";
import { appPath } from "@/lib/basePath";

export type ReceiptFact = { label: string; lines: string[] };
export type ReceiptItem = { title: string; lines: string[]; amount: string; note?: string; noteTone?: "saving" | "warning"; muted?: boolean };
export type ReceiptSum = { label: string; amount: string; strong?: boolean };

export type ReceiptDocument = {
  rtl: boolean;
  /** The PDF's own title, what a viewer shows in its bar. */
  docTitle: string;
  title: string;
  reference: string;
  facts: ReceiptFact[];
  itemsHeading: string;
  items: ReceiptItem[];
  sums: ReceiptSum[];
  /** How it stands with the money, in a band of its own under the total. */
  due: { label: string; amount: string; note?: string };
  footer: string[];
  fileName: string;
};

/** A4's width in points, the receipt's width. */
const WIDTH = 595.28;
const MARGIN = 44;
const SCALE = 2.5;
/** A canvas past this many pixels tall is refused by some browsers. */
const MAX_PIXELS_TALL = 30000;

const NAVY = "#0a285a";
const INK = "#1f2229";
const MUTED = "#536b8c";
const LINE = "#d5dfeb";
const SAVING = "#2f5d33";
const WARNING = "#8c2f22";

const FAMILY = '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif';
const font = (size: number, weight = 400) => `${weight} ${size}px ${FAMILY}`;

/** Words broken into lines no wider than `width`, at spaces. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const tried = current ? `${current} ${word}` : word;
    if (ctx.measureText(tried).width <= width || !current) {
      current = tried;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

/**
 * Lays the receipt out on `ctx`, drawing when `draw` is set and only
 * measuring otherwise, and answers how tall it came out — the same pass both
 * times, so the page is exactly as tall as what is on it.
 */
function paint(ctx: CanvasRenderingContext2D, doc: ReceiptDocument, logo: HTMLImageElement | null, draw: boolean): number {
  const start = doc.rtl ? WIDTH - MARGIN : MARGIN;
  const end = doc.rtl ? MARGIN : WIDTH - MARGIN;
  const inner = WIDTH - 2 * MARGIN;
  ctx.direction = doc.rtl ? "rtl" : "ltr";
  ctx.textBaseline = "alphabetic";

  const text = (value: string, x: number, y: number, align: "start" | "end" | "center", size: number, weight: number, colour: string) => {
    if (!draw) return;
    ctx.font = font(size, weight);
    ctx.fillStyle = colour;
    ctx.textAlign = align;
    ctx.fillText(value, x, y);
  };
  const rule = (y: number, dashed = true) => {
    if (!draw) return;
    ctx.save();
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.setLineDash(dashed ? [4, 3] : []);
    ctx.beginPath();
    ctx.moveTo(MARGIN, y);
    ctx.lineTo(WIDTH - MARGIN, y);
    ctx.stroke();
    ctx.restore();
  };

  let y = MARGIN;

  /* The shop and what this is: the logo at the start, the title and the
     order's number at the end. */
  const logoHeight = 30;
  if (logo && logo.naturalWidth > 0) {
    const logoWidth = (logo.naturalWidth / logo.naturalHeight) * logoHeight;
    if (draw) ctx.drawImage(logo, doc.rtl ? WIDTH - MARGIN - logoWidth : MARGIN, y, logoWidth, logoHeight);
  } else {
    text("NetLet", start, y + 24, "start", 22, 800, NAVY);
  }
  text(doc.title, end, y + 14, "end", 17, 800, NAVY);
  text(doc.reference, end, y + 31, "end", 11, 600, MUTED);
  y += logoHeight + 22;
  rule(y, false);
  y += 22;

  /* The facts: a label column and the value beside it, each value wrapped. */
  const labelWidth = 118;
  const valueWidth = inner - labelWidth;
  const valueX = doc.rtl ? start - labelWidth : start + labelWidth;
  for (const fact of doc.facts) {
    text(fact.label, start, y, "start", 10.5, 600, MUTED);
    ctx.font = font(11.5, 600);
    const lines = fact.lines.flatMap(line => wrap(ctx, line, valueWidth));
    lines.forEach((line, index) => text(line, valueX, y + index * 16, "start", 11.5, index === 0 ? 700 : 500, INK));
    y += Math.max(1, lines.length) * 16 + 8;
  }
  y += 4;
  rule(y);
  y += 24;

  /* The items, each with what it came to at the end of its line. */
  text(doc.itemsHeading, start, y, "start", 13, 800, NAVY);
  y += 20;
  const amountWidth = 104;
  const itemWidth = inner - amountWidth - 12;
  for (const item of doc.items) {
    ctx.font = font(11.5, 700);
    const titleLines = wrap(ctx, item.title, itemWidth);
    titleLines.forEach((line, index) => text(line, start, y + index * 15, "start", 11.5, 700, item.muted ? MUTED : INK));
    text(item.amount, end, y, "end", 11.5, 700, item.muted ? MUTED : INK);
    y += titleLines.length * 15;
    ctx.font = font(10.5, 500);
    for (const line of item.lines.flatMap(entry => wrap(ctx, entry, itemWidth))) {
      text(line, start, y + 1, "start", 10.5, 500, MUTED);
      y += 14;
    }
    if (item.note) {
      ctx.font = font(10.5, 700);
      for (const line of wrap(ctx, item.note, itemWidth)) {
        text(line, start, y + 1, "start", 10.5, 700, item.noteTone === "warning" ? WARNING : SAVING);
        y += 14;
      }
    }
    y += 12;
  }
  rule(y - 2);
  y += 20;

  /* The sum, in the till's order, the total larger under a solid line. */
  for (const sum of doc.sums) {
    if (sum.strong) {
      y += 4;
      rule(y - 14, false);
      y += 6;
      text(sum.label, start, y, "start", 14, 800, NAVY);
      text(sum.amount, end, y, "end", 14, 800, NAVY);
      y += 24;
    } else {
      text(sum.label, start, y, "start", 11, 500, INK);
      text(sum.amount, end, y, "end", 11, 600, INK);
      y += 19;
    }
  }

  /* How it stands with the money, in a pale band. */
  const bandTop = y - 2;
  ctx.font = font(10, 500);
  const noteLines = doc.due.note ? wrap(ctx, doc.due.note, inner - 24) : [];
  const bandHeight = 34 + noteLines.length * 14;
  if (draw) {
    ctx.save();
    ctx.fillStyle = "#eef3fa";
    ctx.beginPath();
    ctx.roundRect(MARGIN, bandTop, inner, bandHeight, 10);
    ctx.fill();
    ctx.restore();
  }
  const inset = doc.rtl ? -12 : 12;
  text(doc.due.label, start + inset, bandTop + 22, "start", 12, 800, NAVY);
  text(doc.due.amount, end - inset, bandTop + 22, "end", 12, 800, NAVY);
  noteLines.forEach((line, index) => text(line, start + inset, bandTop + 38 + index * 14, "start", 10, 500, MUTED));
  y = bandTop + bandHeight + 28;

  /* The thanks and when it was made, in the middle. */
  for (const line of doc.footer) {
    text(line, WIDTH / 2, y, "center", 10, 500, MUTED);
    y += 15;
  }
  return y + MARGIN - 15;
}

function loadLogo(): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = appPath("/brand/netlet-logo.webp");
  });
}

/** The receipt as PDF bytes. */
export async function receiptPdf(doc: ReceiptDocument): Promise<Uint8Array> {
  /* Inter has to be in before the canvas draws with it, or the receipt is
     laid out in the fallback and drawn in Inter, or the other way round. */
  await Promise.all([document.fonts.load(font(12, 400)), document.fonts.load(font(12, 700)), document.fonts.load(font(12, 800))]).catch(() => undefined);
  const logo = await loadLogo();

  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("No canvas");
  const height = Math.ceil(paint(measure, doc, logo, false));
  const scale = Math.min(SCALE, MAX_PIXELS_TALL / height);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(WIDTH * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas");
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WIDTH, height);
  paint(ctx, doc, logo, true);

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The receipt could not be drawn");
  const lib: typeof PdfLib = await import("pdf-lib");
  const pdf = await lib.PDFDocument.create();
  pdf.setTitle(doc.docTitle);
  pdf.setAuthor("NetLet");
  pdf.setCreator("NetLet");
  pdf.setProducer("NetLet");
  pdf.setLanguage(doc.rtl ? "ar" : "en");
  const image = await pdf.embedPng(new Uint8Array(await blob.arrayBuffer()));
  const page = pdf.addPage([WIDTH, height]);
  page.drawImage(image, { x: 0, y: 0, width: WIDTH, height });
  return pdf.save();
}

/** Makes the receipt and hands it to the browser as a download. */
export async function downloadReceipt(doc: ReceiptDocument): Promise<void> {
  const bytes = await receiptPdf(doc);
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = doc.fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  /* Long enough for a slow phone to start the download. */
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
