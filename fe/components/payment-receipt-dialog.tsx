"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ChevronDown, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";

export interface PaymentReceiptData {
  paymentKind: "due" | "credit" | "fund";
  organizationName: string;
  organizationReceiptLogoUrl?: string | null;
  membershipNo: string;
  membershipId: string;
  memberName?: string;
  paymentId: string;
  receiptNumber: string;
  paymentDate: string;
  paymentMethod?: string | null;
  paidAmount: number;
  appliedToDue: number;
  overpaymentToCredit: number;
  remainingAfter: number;
  outstandingAfterPayment: number;
  creditBalanceAfterPayment: number;
  note?: string | null;
  collectedBy?: string;
  memberQrValue?: string;
  receiptTitle?: string;
  primaryLabel?: string;
  nameLabel?: string;
  amountLabel?: string;
  showBalanceAfterPayment?: boolean;
  extraRows?: Array<{ label: string; value?: string | null }>;
}

type ReceiptEncoderInstance = {
  initialize(): ReceiptEncoderInstance;
  text(value: string): ReceiptEncoderInstance;
  line(value?: string): ReceiptEncoderInstance;
  newline(value?: number): ReceiptEncoderInstance;
  size(width: number, height?: number): ReceiptEncoderInstance;
  rule(options?: { style?: "single" | "double"; width?: number }): ReceiptEncoderInstance;
  align(value: "left" | "center" | "right"): ReceiptEncoderInstance;
  bold(value: boolean): ReceiptEncoderInstance;
  qrcode(
    value: string,
    model?: number | { model?: number; size?: number; errorlevel?: "l" | "m" | "q" | "h" },
    size?: number,
    errorlevel?: "l" | "m" | "q" | "h"
  ): ReceiptEncoderInstance;
  image(
    value: HTMLCanvasElement | HTMLImageElement | ImageData,
    width?: number,
    height?: number,
    algorithm?: "threshold" | "bayer" | "floydsteinberg" | "atkinson",
    threshold?: number
  ): ReceiptEncoderInstance;
  cut(value?: string): ReceiptEncoderInstance;
  encode(): Uint8Array;
};
type ReceiptPrinterEncoderClass = {
  new (options?: {
    columns?: number;
    language?: string;
    codepageMapping?: string;
    feedBeforeCut?: number;
    newline?: string;
    errors?: "strict" | "relaxed";
  }): ReceiptEncoderInstance;
};
type PosGlobalName = "ReceiptPrinterEncoder" | "qz";

type QzTrayConfig = {
  getPrinter(): string;
};

type QzTrayGlobal = {
  websocket: {
    isActive(): boolean;
    connect(options?: { retries?: number; delay?: number }): Promise<void>;
  };
  security: {
    setCertificatePromise(
      promiseHandler: (() => Promise<string>) | { then: (onfulfilled?: (value: string) => unknown) => unknown },
      options?: { rejectOnFailure?: boolean }
    ): void;
    setSignatureAlgorithm(algorithm: "SHA1" | "SHA256" | "SHA512"): void;
    setSignaturePromise(promiseFactory: (toSign: string) => Promise<string>): void;
  };
  printers: {
    find(query?: string): Promise<string | string[]>;
    getDefault(): Promise<string>;
  };
  configs: {
    create(
      printer: string,
      options?: { encoding?: string; forceRaw?: boolean; altPrinting?: boolean }
    ): QzTrayConfig;
  };
  print(
    config: QzTrayConfig,
    data: Array<
      | string
      | {
          type?: "raw";
          format?: "command";
          flavor?: "plain" | "base64" | "hex";
          data: string | Uint8Array;
        }
    >
  ): Promise<void>;
};

type PosPrinterProfile = {
  language: string;
  codepageMapping: string;
  columns: number;
};

type PosTextLine = {
  text: string;
  align: "left" | "right";
};

type PrintMethod = "qz" | "rawbt" | "browser";

const RECEIPT_WIDTH_INCHES = 2.8;
// XP-P801A: 80 mm paper, 72 mm printable width, Font A (12 dots) = 48 columns.
const XP_P801A_COLUMNS = 48;
const RECEIPT_QR_SIZE_PX = 96;
const RECEIPT_LOGO_WIDTH_PX = 384;
const RECEIPT_LOGO_HEIGHT_PX = 96;
const HUDHA_RECEIPT_LOGO_WIDTH_PX = 304;
const HUDHA_RECEIPT_LOGO_HEIGHT_PX = 264;
const HUDHA_RECEIPT_LOGO_URL = "/document/hudha_receipt_logo_thermal.png";
const RECEIPT_PRINT_METHOD_STORAGE_KEY = "subs.receipt-print-method";
const POS_SCRIPT_BASE = "/vendor";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const posScriptPromises = new Map<string, Promise<void>>();
let qzSecuritySetupPromise: Promise<void> | null = null;

function money(value: number): string {
  return Number(value || 0).toFixed(2);
}

function dateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function posDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function rowHtml(
  label: string,
  value?: string,
  options?: { labelBold?: boolean; valueBold?: boolean }
): string {
  const labelHtml = options?.labelBold === false ? escapeHtml(label) : `<strong>${escapeHtml(label)}</strong>`;
  const valueContent = value === undefined ? "" : escapeHtml(value);
  const valueHtml =
    value === undefined
      ? ""
      : options?.valueBold
        ? `<strong>${valueContent}</strong>`
        : valueContent;
  return `<div class="textbox-info"><p class="f-left">${labelHtml}</p><p class="f-right">${valueHtml}</p></div>`;
}

function receiptTitle(receipt: PaymentReceiptData): string {
  return receipt.receiptTitle || "PAYMENT RECEIPT";
}

function primaryLabel(receipt: PaymentReceiptData): string {
  return receipt.primaryLabel || "Member #";
}

function nameLabel(receipt: PaymentReceiptData): string {
  return receipt.nameLabel || "Name";
}

function amountLabel(receipt: PaymentReceiptData): string {
  return receipt.amountLabel || "Paid";
}

function shouldShowBalanceAfterPayment(receipt: PaymentReceiptData): boolean {
  return receipt.showBalanceAfterPayment !== false;
}

function receiptLogoUrl(receipt: PaymentReceiptData): string | null {
  if (receipt.organizationReceiptLogoUrl) return receipt.organizationReceiptLogoUrl;

  const normalizedName = receipt.organizationName.trim().toLowerCase();
  return normalizedName.includes("masjidul hudha") ? HUDHA_RECEIPT_LOGO_URL : null;
}

function isBundledHudhaLogo(url: string): boolean {
  return url.includes(HUDHA_RECEIPT_LOGO_URL);
}

function buildReceiptHtml(receipt: PaymentReceiptData, qrDataUrl: string): string {
  const noteHtml = receipt.note ? rowHtml("Note", receipt.note) : "";
  const paymentMethodHtml = rowHtml("Payment Method", receipt.paymentMethod || "-");
  const extraRowsHtml = (receipt.extraRows ?? [])
    .filter((row) => row.value)
    .map((row) => rowHtml(row.label, row.value || "-"))
    .join("");
  const balanceHtml = shouldShowBalanceAfterPayment(receipt)
    ? `
      <div style="height: 10px;"></div>
      ${rowHtml("Balance After Payment", undefined, { labelBold: false })}
      ${rowHtml("Total Outstanding", `Rs ${money(receipt.outstandingAfterPayment)}`)}
      ${rowHtml("Total Credit Balance", `Rs ${money(receipt.creditBalanceAfterPayment)}`)}
      <div class="border-bottom"></div>`
    : `<div class="border-bottom"></div>`;
  const logoUrl = receiptLogoUrl(receipt);
  const logoHtml = logoUrl
    ? `<div class="logo-box${isBundledHudhaLogo(logoUrl) ? " hudha-logo" : ""}"><img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(receipt.organizationName)} logo" /></div>`
    : "";
  const qrHtml = qrDataUrl
    ? `<div class="qr-wrap"><img src="${qrDataUrl}" alt="Member QR" /></div>`
    : "";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Payment Receipt</title>
    <style>
      html, body { margin: 0; padding: 0; background: #fff; color: #000; }
      body {
        font-family: "Times New Roman", Times, serif;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .ticket {
        width: 100%;
        box-sizing: border-box;
        margin: 0 auto;
        font-size: 11px;
        line-height: 1.3;
      }
      .centered { text-align: center; }
      .headings { font-size: 15px; font-weight: 700; text-transform: uppercase; }
      .logo-box {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        min-height: 0.68in;
        margin-bottom: 4px;
      }
      .logo-box img {
        max-width: 2.35in;
        max-height: 0.58in;
        object-fit: contain;
      }
      .logo-box.hudha-logo {
        width: 1.55in;
        height: 1.35in;
        min-height: 0;
        margin: 0 auto 4px;
        overflow: hidden;
      }
      .logo-box.hudha-logo img {
        width: 1.55in;
        max-width: none;
        height: auto;
        max-height: none;
        transform: translateY(-0.04in);
      }
      .text-box { width: 100%; }
      .textbox-info {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 48%);
        align-items: flex-start;
        gap: 8px;
        margin: 0 0 2px;
      }
      .textbox-info p {
        margin: 0;
      }
      .f-left {
        min-width: 0;
      }
      .f-right {
        min-width: 0;
        text-align: right;
        word-break: break-word;
      }
      .border-top { border-top: 1px solid #242424; padding-top: 6px; margin-top: 6px; }
      .border-bottom { border-bottom: 1px solid #242424; margin: 6px 0; }
      .qr-wrap { text-align: center; margin-top: 8px; }
      .qr-wrap img { width: ${RECEIPT_QR_SIZE_PX}px; height: ${RECEIPT_QR_SIZE_PX}px; image-rendering: pixelated; }
      @page { size: ${RECEIPT_WIDTH_INCHES}in auto; margin: 0.16in 0.08in; }
    </style>
  </head>
  <body>
    <div class="ticket">
      <div class="text-box centered">
        ${logoHtml}
        <div class="headings">${escapeHtml(receipt.organizationName)}</div>
        <div>${escapeHtml(receiptTitle(receipt))}</div>
      </div>
      <div class="border-top"></div>
      ${rowHtml("Receipt #", receipt.receiptNumber)}
      ${rowHtml("Date", dateTime(receipt.paymentDate))}
      ${rowHtml(primaryLabel(receipt), receipt.membershipNo)}
      ${rowHtml(nameLabel(receipt), receipt.memberName || "-")}
      ${paymentMethodHtml}
      ${extraRowsHtml}
      <div class="border-bottom"></div>
      ${rowHtml(amountLabel(receipt), `Rs ${money(receipt.paidAmount)}`, { valueBold: true })}
      ${balanceHtml}
      ${rowHtml("Collected By", receipt.collectedBy || "-")}
      ${noteHtml}
      <div class="border-bottom"></div>
      <div style="height: 20px;"></div>
      ${qrHtml}
      <div class="centered" style="margin-top: 6px;">Keep this receipt for records</div>
      <div class="centered" style="margin-top: 10px; text-size: 8px">Developed by civica.lk</div>
    </div>
    <script>
      window.addEventListener("load", function () {
        setTimeout(function () {
          window.print();
        }, 150);
      });
    </script>
  </body>
</html>`;
}

function getStoredPrintMethod(): PrintMethod {
  if (typeof window === "undefined") return "browser";
  const storedValue = window.localStorage.getItem(RECEIPT_PRINT_METHOD_STORAGE_KEY);
  return storedValue === "qz" || storedValue === "rawbt" || storedValue === "browser"
    ? storedValue
    : "browser";
}

function setStoredPrintMethod(method: PrintMethod) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(RECEIPT_PRINT_METHOD_STORAGE_KEY, method);
}

async function loadReceiptPrinterEncoderClass(): Promise<ReceiptPrinterEncoderClass> {
  await loadPosBrowserScript(
    `${POS_SCRIPT_BASE}/receipt-printer-encoder.umd.js`,
    "ReceiptPrinterEncoder"
  );
  if (!window.ReceiptPrinterEncoder) {
    throw new Error("Receipt encoder library failed to load.");
  }
  return window.ReceiptPrinterEncoder as unknown as ReceiptPrinterEncoderClass;
}

async function loadQzTray(): Promise<QzTrayGlobal> {
  await loadPosBrowserScript(`${POS_SCRIPT_BASE}/qz-tray.js`, "qz");
  if (!window.qz) {
    throw new Error("QZ Tray script failed to load.");
  }
  const qz = window.qz as QzTrayGlobal;
  try {
    await setupQzTraySecurity(qz);
  } catch (error) {
    console.warn("QZ Tray signing is not configured yet.", error);
  }
  return qz;
}

function loadPosBrowserScript(src: string, globalName: PosGlobalName): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("POS printing is only available in the browser."));
  }

  if (window[globalName]) {
    return Promise.resolve();
  }

  const existingPromise = posScriptPromises.get(src);
  if (existingPromise) return existingPromise;

  const promise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(`script[data-pos-src="${src}"]`);
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.posSrc = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });

  posScriptPromises.set(src, promise);
  return promise;
}

function normalizeQzPrinterList(input: string | string[]): string[] {
  if (Array.isArray(input)) return input;
  return input ? [input] : [];
}

function wrapText(value: string, width: number): string[] {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return [""];

  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`;
      continue;
    }

    lines.push(current);
    current = word;
  }

  if (current) lines.push(current);
  return lines;
}

function formatKeyValueLines(label: string, value: string, width = XP_P801A_COLUMNS): PosTextLine[] {
  const cleanLabel = label.trim();
  const cleanValue = value.trim();
  if (!cleanValue) return [{ text: cleanLabel, align: "left" }];

  if (cleanLabel.length + cleanValue.length + 1 <= width) {
    return [{
      text: `${cleanLabel}${" ".repeat(width - cleanLabel.length - cleanValue.length)}${cleanValue}`,
      align: "left",
    }];
  }

  const wrappedValue = wrapText(cleanValue, width);
  return [
    { text: cleanLabel, align: "left" },
    ...wrappedValue.map((line) => ({ text: line, align: "right" as const })),
  ];
}

function formatTwoColumnLines(label: string, value: string, width = XP_P801A_COLUMNS, valueWidth = 22): PosTextLine[] {
  const cleanLabel = label.trim();
  const cleanValue = value.trim() || "-";
  const normalizedValueWidth = Math.min(Math.max(valueWidth, 8), width - 4);
  const labelWidth = width - normalizedValueWidth - 1;
  const wrappedValue = wrapText(cleanValue, normalizedValueWidth);

  return wrappedValue.map((line, index) => index === 0
    ? {
        text: `${cleanLabel.padEnd(labelWidth)} ${line.padStart(normalizedValueWidth)}`,
        align: "left" as const,
      }
    : { text: line, align: "right" as const });
}

function printPosLines(encoder: ReceiptEncoderInstance, lines: PosTextLine[]) {
  for (const line of lines) {
    encoder.align(line.align).line(line.text);
  }
  encoder.align("left");
}

async function loadReceiptLogoCanvas(url: string): Promise<HTMLCanvasElement> {
  const image = await new Promise<HTMLImageElement>((resolveImage, rejectImage) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolveImage(img);
    img.onerror = () => rejectImage(new Error("Failed to load receipt logo"));
    img.src = url;
  });

  const canvas = document.createElement("canvas");
  const hudhaLogo = isBundledHudhaLogo(url);
  canvas.width = hudhaLogo ? HUDHA_RECEIPT_LOGO_WIDTH_PX : RECEIPT_LOGO_WIDTH_PX;
  canvas.height = hudhaLogo ? HUDHA_RECEIPT_LOGO_HEIGHT_PX : RECEIPT_LOGO_HEIGHT_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable");

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const sourceX = hudhaLogo ? Math.round(image.naturalWidth * 0.03) : 0;
  const sourceY = hudhaLogo ? Math.round(image.naturalHeight * 0.04) : 0;
  const sourceWidth = hudhaLogo ? Math.round(image.naturalWidth * 0.94) : image.naturalWidth;
  const sourceHeight = hudhaLogo ? Math.round(image.naturalHeight * 0.82) : image.naturalHeight;
  const scale = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight);
  const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
  const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
  const x = Math.round((canvas.width - drawWidth) / 2);
  const y = Math.round((canvas.height - drawHeight) / 2);
  ctx.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    x,
    y,
    drawWidth,
    drawHeight
  );

  return canvas;
}

async function encodePosReceipt(
  receipt: PaymentReceiptData,
  profile: PosPrinterProfile
): Promise<Uint8Array> {
  const ReceiptPrinterEncoder = await loadReceiptPrinterEncoderClass();
  const encoder = new ReceiptPrinterEncoder({
    columns: profile.columns,
    language: profile.language,
    codepageMapping: profile.codepageMapping,
    feedBeforeCut: 3,
    errors: "relaxed",
  });

  encoder.initialize();
  // Flush initialization before the first centred line. Otherwise the
  // XP-P801A resets after the encoder's leading centring spaces and drops them.
  encoder.newline();
  const logoUrl = receiptLogoUrl(receipt);
  if (logoUrl) {
    try {
      const logoCanvas = await loadReceiptLogoCanvas(logoUrl);
      encoder.align("center");
      encoder.image(logoCanvas, logoCanvas.width, logoCanvas.height, "atkinson");
      encoder.newline();
    } catch (error) {
      console.warn("Receipt logo could not be printed; falling back to text header.", error);
    }
  }
  // Apply size before alignment. Some XPrinter firmware resets the active
  // alignment when its character-size command is received.
  encoder.size(1, 2).align("center").bold(true);
  for (const line of wrapText(receipt.organizationName.toUpperCase(), profile.columns - 4)) {
    encoder.align("center");
    encoder.line(line);
  }
  encoder.size(1, 1).align("center").bold(false);
  for (const line of wrapText(receiptTitle(receipt), profile.columns - 4)) {
    encoder.align("center");
    encoder.line(line);
  }
  encoder.align("left");
  encoder.rule();

  printPosLines(encoder, formatKeyValueLines("Receipt #", receipt.receiptNumber));
  printPosLines(encoder, formatKeyValueLines("Date", posDateTime(receipt.paymentDate)));
  printPosLines(encoder, formatKeyValueLines(primaryLabel(receipt), receipt.membershipNo));
  printPosLines(encoder, formatTwoColumnLines(nameLabel(receipt), receipt.memberName || "-"));

  printPosLines(encoder, formatKeyValueLines("Payment Method", receipt.paymentMethod || "-"));
  for (const row of receipt.extraRows ?? []) {
    if (!row.value) continue;
    printPosLines(encoder, formatTwoColumnLines(row.label, row.value));
  }

  encoder.rule();
  encoder.bold(true);
  printPosLines(encoder, formatKeyValueLines(amountLabel(receipt), `Rs ${money(receipt.paidAmount)}`));
  encoder.bold(false);
  if (shouldShowBalanceAfterPayment(receipt)) {
    encoder.newline();
    encoder.line("Balance After Payment");
    printPosLines(encoder, formatKeyValueLines("Total Outstanding", `Rs ${money(receipt.outstandingAfterPayment)}`));
    printPosLines(encoder, formatKeyValueLines("Total Credit Balance", `Rs ${money(receipt.creditBalanceAfterPayment)}`));
  }

  encoder.rule();
  printPosLines(encoder, formatTwoColumnLines("Collected By", receipt.collectedBy || "-"));
  if (receipt.note) {
    printPosLines(encoder, formatTwoColumnLines("Note", receipt.note));
  }
  encoder.rule();

  if (receipt.memberQrValue) {
    encoder.align("center");
    encoder.newline(2);
    encoder.qrcode(receipt.memberQrValue, { model: 2, size: 5, errorlevel: "m" });
  }

  encoder.align("center");
  encoder.line("Keep this receipt for records");
  encoder.line("Developed by civica.lk");
  encoder.newline(2);
  encoder.cut();

  return encoder.encode();
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...Array.from(chunk));
  }

  return window.btoa(binary);
}

function getQzAuthHeaders(): HeadersInit {
  if (typeof window === "undefined") return {};
  const token = window.localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchQzCertificate(): Promise<string> {
  const response = await fetch(new URL("/integrations/qz/certificate", API_URL), {
    cache: "no-store",
    headers: {
      ...getQzAuthHeaders(),
      "Content-Type": "text/plain",
    },
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || "QZ Tray certificate is not configured.");
  }

  return response.text();
}

async function fetchQzSignature(request: string): Promise<string> {
  const response = await fetch(new URL("/integrations/qz/sign", API_URL), {
    method: "POST",
    cache: "no-store",
    headers: {
      ...getQzAuthHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ request }),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || "Failed to sign QZ Tray request.");
  }

  return response.text();
}

async function setupQzTraySecurity(qz: QzTrayGlobal): Promise<void> {
  if (qzSecuritySetupPromise) return qzSecuritySetupPromise;

  qzSecuritySetupPromise = (async () => {
    const certificate = await fetchQzCertificate();
    qz.security.setCertificatePromise(async () => certificate);
    qz.security.setSignatureAlgorithm("SHA512");
    qz.security.setSignaturePromise(async (toSign: string) => fetchQzSignature(toSign));
  })().catch((error) => {
    qzSecuritySetupPromise = null;
    throw error;
  });

  return qzSecuritySetupPromise;
}

export function PaymentReceiptDialog({
  open,
  onOpenChange,
  receipt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receipt: PaymentReceiptData | null;
}) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [qzPrinting, setQzPrinting] = useState(false);
  const [rawBtPrinting, setRawBtPrinting] = useState(false);
  const [selectedPrintMethod, setSelectedPrintMethod] = useState<PrintMethod>("browser");

  useEffect(() => {
    if (!open || !receipt) {
      setQrDataUrl("");
      return;
    }
    let cancelled = false;
    if (!receipt.memberQrValue) {
      setQrDataUrl("");
      return;
    }
    QRCode.toDataURL(receipt.memberQrValue, {
      width: 180,
      margin: 1,
      color: { dark: "#000000", light: "#FFFFFF" },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [open, receipt]);

  useEffect(() => {
    if (!open) return;
    setSelectedPrintMethod(getStoredPrintMethod());
  }, [open]);

  function handleBrowserPrint() {
    if (!receipt) return;
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.visibility = "hidden";

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      iframe.remove();
      window.removeEventListener("afterprint", cleanup);
    };

    window.addEventListener("afterprint", cleanup);
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      cleanup();
      return;
    }

    doc.open();
    doc.write(buildReceiptHtml(receipt, qrDataUrl));
    doc.close();

    const frameWindow = iframe.contentWindow;
    if (!frameWindow) {
      cleanup();
      return;
    }

    frameWindow.addEventListener("afterprint", cleanup, { once: true });
    frameWindow.focus();
    window.setTimeout(() => {
      frameWindow.print();
    }, 150);
  }

  async function ensureQzConnection(): Promise<QzTrayGlobal> {
    const qz = await loadQzTray();
    if (!qz.websocket.isActive()) {
      await qz.websocket.connect({ retries: 2, delay: 1 });
    }
    return qz;
  }

  async function handleQzTrayPrint() {
    if (!receipt) return;

    try {
      setQzPrinting(true);

      const qz = await ensureQzConnection();
      const [defaultPrinter, printerResult] = await Promise.all([
        qz.printers.getDefault().catch(() => ""),
        qz.printers.find().catch(() => [] as string[]),
      ]);
      const printerName = defaultPrinter || normalizeQzPrinterList(printerResult)[0] || "";
      if (!printerName) {
        throw new Error(
          "No QZ printer was found. Install QZ Tray and make sure the printer is installed in Windows."
        );
      }

      const data = await encodePosReceipt(receipt, {
        language: "esc-pos",
        codepageMapping: "epson",
        columns: XP_P801A_COLUMNS,
      });

      const config = qz.configs.create(printerName, {
        encoding: "Cp1252",
        forceRaw: true,
      });

      await qz.print(config, [
        {
          type: "raw",
          format: "command",
          flavor: "hex",
          data,
        },
      ]);

      toast({
        title: "Receipt sent with QZ Tray",
        description: `Printed to ${printerName}.`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to print with QZ Tray.";

      toast({
        variant: "destructive",
        title: "QZ Tray print failed",
        description: message,
      });
    } finally {
      setQzPrinting(false);
    }
  }

  async function handleRawBtPrint() {
    if (!receipt) return;

    try {
      setRawBtPrinting(true);

      const data = await encodePosReceipt(receipt, {
        language: "esc-pos",
        codepageMapping: "epson",
        columns: XP_P801A_COLUMNS,
      });
      const base64 = toBase64(data);
      const rawBtUrl =
        `intent:base64,${base64}` +
        "#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;";

      window.location.href = rawBtUrl;

      toast({
        title: "Opening RAWBT",
        description: "Sending receipt to RAWBT...",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open RAWBT.";

      toast({
        variant: "destructive",
        title: "RAWBT print failed",
        description: message,
      });
    } finally {
      setRawBtPrinting(false);
    }
  }

  async function runPrintMethod(method: PrintMethod) {
    setSelectedPrintMethod(method);
    setStoredPrintMethod(method);

    if (method === "qz") {
      await handleQzTrayPrint();
      return;
    }

    if (method === "rawbt") {
      await handleRawBtPrint();
      return;
    }

    handleBrowserPrint();
  }

  const isPrinting = qzPrinting || rawBtPrinting;
  const previewLogoUrl = receipt ? receiptLogoUrl(receipt) : null;
  const previewUsesBundledHudhaLogo = previewLogoUrl
    ? isBundledHudhaLogo(previewLogoUrl)
    : false;
  const currentPrintLabel =
    selectedPrintMethod === "qz"
      ? qzPrinting
        ? "Printing..."
        : "Print"
      : selectedPrintMethod === "rawbt"
        ? rawBtPrinting
          ? "Printing..."
          : "Print"
        : "Print";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{receipt ? receiptTitle(receipt) : "Payment Receipt"}</DialogTitle>
        </DialogHeader>
        {receipt && (
          <div className="space-y-4">
            <div
              className="mx-auto rounded-md border border-dashed bg-white p-2 font-['Times_New_Roman'] text-[11px] leading-snug text-black"
              style={{ width: `${RECEIPT_WIDTH_INCHES}in` }}
            >
              <div className="text-center">
                {previewLogoUrl ? (
                  <div
                    className={previewUsesBundledHudhaLogo
                      ? "mx-auto mb-1 h-[1.35in] w-[1.55in] overflow-hidden"
                      : "mb-1 flex min-h-[0.68in] items-center justify-center"}
                  >
                    <img
                      src={previewLogoUrl}
                      alt={`${receipt.organizationName} logo`}
                      className={previewUsesBundledHudhaLogo
                        ? "h-auto w-[1.55in] max-w-none -translate-y-[0.04in]"
                        : "max-h-[0.58in] max-w-[2.35in] object-contain"}
                    />
                  </div>
                ) : null}
                <p className="text-[15px] font-bold uppercase">{receipt.organizationName}</p>
                <p>{receiptTitle(receipt)}</p>
              </div>
              <div className="mt-1 border-t border-black pt-1" />

              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 font-semibold">Receipt #</p>
                <p className="shrink-0 whitespace-nowrap text-right">{receipt.receiptNumber}</p>
              </div>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 font-semibold">Date</p>
                <p className="shrink-0 whitespace-nowrap text-right">{dateTime(receipt.paymentDate)}</p>
              </div>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 font-semibold">{primaryLabel(receipt)}</p>
                <p className="shrink-0 whitespace-nowrap text-right">{receipt.membershipNo}</p>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,48%)] items-start gap-2">
                <p className="min-w-0 flex-1 font-semibold">{nameLabel(receipt)}</p>
                <p className="min-w-0 break-words text-right">{receipt.memberName || "-"}</p>
              </div>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 font-semibold">Payment Method</p>
                <p className="shrink-0 whitespace-nowrap text-right">{receipt.paymentMethod || "-"}</p>
              </div>
              {(receipt.extraRows ?? []).filter((row) => row.value).map((row) => (
                <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,48%)] items-start gap-2">
                  <p className="min-w-0 flex-1 font-semibold">{row.label}</p>
                  <p className="min-w-0 break-words text-right">{row.value}</p>
                </div>
              ))}

              <div className="my-1 border-b border-black" />
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 font-semibold">{amountLabel(receipt)}</p>
                <p className="shrink-0 whitespace-nowrap text-right font-bold">
                  Rs {money(receipt.paidAmount)}
                </p>
              </div>
              {shouldShowBalanceAfterPayment(receipt) ? (
                <>
                  <div className="h-2" />
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1">Balance After Payment</p>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 font-semibold">Total Outstanding</p>
                    <p className="shrink-0 whitespace-nowrap text-right">
                      Rs {money(receipt.outstandingAfterPayment)}
                    </p>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 font-semibold">Total Credit Balance</p>
                    <p className="shrink-0 whitespace-nowrap text-right">
                      Rs {money(receipt.creditBalanceAfterPayment)}
                    </p>
                  </div>
                </>
              ) : null}
              <div className="my-1 border-b border-black" />
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,48%)] items-start gap-2">
                <p className="min-w-0 flex-1 font-semibold">Collected By</p>
                <p className="min-w-0 break-words text-right">{receipt.collectedBy || "-"}</p>
              </div>
              {receipt.note ? (
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,48%)] items-start gap-2">
                  <p className="min-w-0 flex-1 font-semibold">Note</p>
                  <p className="min-w-0 break-words text-right">{receipt.note}</p>
                </div>
              ) : null}

              <div className="my-1 border-b border-black" />
              <div className="h-4" />
              {qrDataUrl ? (
                <div className="text-center">
                  <img
                    src={qrDataUrl}
                    alt={`QR for ${receipt.membershipNo}`}
                    className="mx-auto"
                    style={{ height: `${RECEIPT_QR_SIZE_PX}px`, width: `${RECEIPT_QR_SIZE_PX}px` }}
                  />
                </div>
              ) : null}
              <p className="mt-1 text-center">Keep this receipt for records</p>
              <p className="mt-1 text-center">developed by civica.lk</p>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <div className="flex items-center">
                <Button
                  onClick={() => void runPrintMethod(selectedPrintMethod)}
                  className="gap-1.5 rounded-r-none"
                  disabled={isPrinting}
                >
                  <Printer className="h-4 w-4" />
                  {currentPrintLabel}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      className="px-2 rounded-l-none border-l border-primary-foreground/20"
                      disabled={isPrinting}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuRadioGroup
                      value={selectedPrintMethod}
                      onValueChange={(value) => {
                        void runPrintMethod(value as PrintMethod);
                      }}
                    >
                      <DropdownMenuRadioItem value="qz">QZ Tray Print</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="rawbt">RAWBT Print</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="browser">Browser Print</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
