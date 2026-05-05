"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

export interface PaymentReceiptData {
  paymentKind: "due" | "credit";
  organizationName: string;
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
  memberQrValue: string;
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
};

const RECEIPT_WIDTH_INCHES = 3;
const POS_COLUMNS = 48;
const RECEIPT_QR_SIZE_PX = 104;
const QZ_PRINTER_STORAGE_KEY = "subs.qz-printer-name";
const POS_SCRIPT_BASE = "/vendor";
const posScriptPromises = new Map<string, Promise<void>>();

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

function buildReceiptHtml(receipt: PaymentReceiptData, qrDataUrl: string): string {
  const noteHtml = receipt.note ? rowHtml("Note", receipt.note) : "";
  const paymentMethodHtml = rowHtml("Payment Method", receipt.paymentMethod || "-");
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
        <div class="headings">${escapeHtml(receipt.organizationName)}</div>
        <div>PAYMENT RECEIPT</div>
      </div>
      <div class="border-top"></div>
      ${rowHtml("Receipt #", receipt.receiptNumber)}
      ${rowHtml("Date", dateTime(receipt.paymentDate))}
      ${rowHtml("Member #", receipt.membershipNo)}
      ${rowHtml("Name", receipt.memberName || "-")}
      ${paymentMethodHtml}
      <div class="border-bottom"></div>
      ${rowHtml("Paid", `Rs ${money(receipt.paidAmount)}`, { valueBold: true })}
      <div style="height: 10px;"></div>
      ${rowHtml("Balance After Payment", undefined, { labelBold: false })}
      ${rowHtml("Total Outstanding", `Rs ${money(receipt.outstandingAfterPayment)}`)}
      ${rowHtml("Total Credit Balance", `Rs ${money(receipt.creditBalanceAfterPayment)}`)}
      <div class="border-bottom"></div>
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

function getStoredQzPrinterName(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(QZ_PRINTER_STORAGE_KEY) || "";
}

function setStoredQzPrinterName(printerName: string) {
  if (typeof window === "undefined") return;
  if (!printerName) {
    window.localStorage.removeItem(QZ_PRINTER_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(QZ_PRINTER_STORAGE_KEY, printerName);
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
  return window.qz as QzTrayGlobal;
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

function formatKeyValueLines(label: string, value: string, width = POS_COLUMNS): string[] {
  const cleanLabel = label.trim();
  const cleanValue = value.trim();
  if (!cleanValue) return [cleanLabel];

  if (cleanLabel.length + cleanValue.length + 1 <= width) {
    return [`${cleanLabel}${" ".repeat(width - cleanLabel.length - cleanValue.length)}${cleanValue}`];
  }

  const wrappedValue = wrapText(cleanValue, width);
  return [cleanLabel, ...wrappedValue.map((line) => line.padStart(width))];
}

function formatTwoColumnLines(label: string, value: string, width = POS_COLUMNS, valueWidth = 22): string[] {
  const cleanLabel = label.trim();
  const cleanValue = value.trim() || "-";
  const normalizedValueWidth = Math.min(Math.max(valueWidth, 8), width - 4);
  const labelWidth = width - normalizedValueWidth - 1;
  const wrappedValue = wrapText(cleanValue, normalizedValueWidth);

  return wrappedValue.map((line, index) => {
    const left = index === 0 ? cleanLabel : "";
    return `${left.padEnd(labelWidth)} ${line.padStart(normalizedValueWidth)}`;
  });
}

function formatCenteredLines(value: string, width = POS_COLUMNS): string[] {
  return wrapText(value.trim(), Math.max(width - 4, 1)).map((line) => {
    const totalPadding = Math.max(width - line.length, 0);
    const leftPadding = Math.floor(totalPadding / 2);
    return `${" ".repeat(leftPadding)}${line}`;
  });
}

async function encodePosReceipt(
  receipt: PaymentReceiptData,
  profile: PosPrinterProfile
): Promise<Uint8Array> {
  const ReceiptPrinterEncoder = await loadReceiptPrinterEncoderClass();
  const encoder = new ReceiptPrinterEncoder({
    columns: POS_COLUMNS,
    language: profile.language,
    codepageMapping: profile.codepageMapping,
    feedBeforeCut: 3,
    errors: "relaxed",
  });

  encoder.initialize();
  encoder.align("left");
  encoder.bold(true).size(1, 2);
  for (const line of formatCenteredLines(receipt.organizationName.toUpperCase())) {
    encoder.line(line);
  }
  encoder.size(1, 1);
  encoder.bold(false);
  for (const line of formatCenteredLines("PAYMENT RECEIPT")) {
    encoder.line(line);
  }
  encoder.rule();

  encoder.align("left");
  for (const line of formatKeyValueLines("Receipt #", receipt.receiptNumber)) encoder.line(line);
  for (const line of formatKeyValueLines("Date", posDateTime(receipt.paymentDate))) encoder.line(line);
  for (const line of formatKeyValueLines("Member #", receipt.membershipNo)) encoder.line(line);
  for (const line of formatTwoColumnLines("Name", receipt.memberName || "-")) encoder.line(line);

  for (const line of formatKeyValueLines("Payment Method", receipt.paymentMethod || "-")) {
    encoder.line(line);
  }

  encoder.rule();
  encoder.bold(true);
  for (const line of formatKeyValueLines("Paid", `Rs ${money(receipt.paidAmount)}`)) encoder.line(line);
  encoder.bold(false);
  encoder.newline();
  encoder.line("Balance After Payment");
  for (const line of formatKeyValueLines("Total Outstanding", `Rs ${money(receipt.outstandingAfterPayment)}`)) {
    encoder.line(line);
  }
  for (const line of formatKeyValueLines("Total Credit Balance", `Rs ${money(receipt.creditBalanceAfterPayment)}`)) {
    encoder.line(line);
  }

  encoder.rule();
  for (const line of formatTwoColumnLines("Collected By", receipt.collectedBy || "-")) {
    encoder.line(line);
  }
  if (receipt.note) {
    for (const line of formatTwoColumnLines("Note", receipt.note)) {
      encoder.line(line);
    }
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

function isAndroidDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
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
  const [qzLoadingPrinters, setQzLoadingPrinters] = useState(false);
  const [qzPrinters, setQzPrinters] = useState<string[]>([]);
  const [qzPrinterName, setQzPrinterName] = useState("");
  const [qzStatus, setQzStatus] = useState(
    "QZ Tray can print through the installed Windows printer queue."
  );
  const [isAndroid, setIsAndroid] = useState(false);

  useEffect(() => {
    if (!open || !receipt) {
      setQrDataUrl("");
      return;
    }
    let cancelled = false;
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

    setIsAndroid(isAndroidDevice());
    const storedPrinterName = getStoredQzPrinterName();
    if (storedPrinterName) {
      setQzPrinterName(storedPrinterName);
    }

    void loadQzPrinters(false);
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

  async function loadQzPrinters(showToast = true): Promise<string> {
    try {
      setQzLoadingPrinters(true);
      setQzStatus("Checking QZ Tray and installed printers...");

      const qz = await ensureQzConnection();
      const [printerResult, defaultPrinter] = await Promise.all([
        qz.printers.find(),
        qz.printers.getDefault().catch(() => ""),
      ]);

      const printers = normalizeQzPrinterList(printerResult);
      setQzPrinters(printers);

      const storedPrinterName = getStoredQzPrinterName();
      const nextPrinterName =
        (storedPrinterName && printers.includes(storedPrinterName) && storedPrinterName) ||
        (qzPrinterName && printers.includes(qzPrinterName) && qzPrinterName) ||
        (defaultPrinter && printers.includes(defaultPrinter) && defaultPrinter) ||
        printers[0] ||
        "";

      setQzPrinterName(nextPrinterName);
      setStoredQzPrinterName(nextPrinterName);

      if (printers.length === 0) {
        setQzStatus("QZ Tray is running, but no installed printers were found.");
        throw new Error(
          "QZ Tray is running, but no printers were found. Pair or install the receipt printer in Windows first."
        );
      }

      setQzStatus(`QZ Tray connected. ${printers.length} printer${printers.length === 1 ? "" : "s"} found.`);

      if (showToast) {
        toast({
          title: "QZ Tray connected",
          description: nextPrinterName
            ? `Selected printer: ${nextPrinterName}`
            : "Installed printers are ready to use.",
        });
      }

      return nextPrinterName;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "QZ Tray is not available. Install it and keep it running on this computer.";

      setQzStatus(message);
      if (showToast) {
        toast({
          variant: "destructive",
          title: "QZ Tray unavailable",
          description: message,
        });
      }
      return "";
    } finally {
      setQzLoadingPrinters(false);
    }
  }

  async function handleQzTrayPrint() {
    if (!receipt) return;

    try {
      setQzPrinting(true);

      const printerName = qzPrinterName || (await loadQzPrinters(false));
      if (!printerName) {
        throw new Error(
          "No QZ printer is selected. Install QZ Tray, make sure the printer is installed in Windows, then refresh the printer list."
        );
      }

      const qz = await ensureQzConnection();
      const data = await encodePosReceipt(receipt, {
        language: "esc-pos",
        codepageMapping: "epson",
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

      setStoredQzPrinterName(printerName);
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

      // if (!isAndroidDevice()) {
      //   throw new Error("RAWBT printing is only available on Android devices.");
      // }

      const data = await encodePosReceipt(receipt, {
        language: "esc-pos",
        codepageMapping: "epson",
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Payment Receipt</DialogTitle>
        </DialogHeader>
        {receipt && (
          <div className="space-y-4">
            <div
              className="mx-auto rounded-md border border-dashed bg-white p-2 font-['Times_New_Roman'] text-[11px] leading-snug text-black"
              style={{ width: `${RECEIPT_WIDTH_INCHES}in` }}
            >
              <div className="text-center">
                <p className="text-[15px] font-bold uppercase">{receipt.organizationName}</p>
                <p>PAYMENT RECEIPT</p>
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
                <p className="min-w-0 flex-1 font-semibold">Member #</p>
                <p className="shrink-0 whitespace-nowrap text-right">{receipt.membershipNo}</p>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,48%)] items-start gap-2">
                <p className="min-w-0 flex-1 font-semibold">Name</p>
                <p className="min-w-0 break-words text-right">{receipt.memberName || "-"}</p>
              </div>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 font-semibold">Payment Method</p>
                <p className="shrink-0 whitespace-nowrap text-right">{receipt.paymentMethod || "-"}</p>
              </div>

              <div className="my-1 border-b border-black" />
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 font-semibold">Paid</p>
                <p className="shrink-0 whitespace-nowrap text-right font-bold">
                  Rs {money(receipt.paidAmount)}
                </p>
              </div>
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

            <div className="space-y-2">

              <div className="grid gap-2 rounded-md border p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Select
                    value={qzPrinterName || "__none__"}
                    onValueChange={(value) => {
                      const nextValue = value === "__none__" ? "" : value;
                      setQzPrinterName(nextValue);
                      setStoredQzPrinterName(nextValue);
                    }}
                    disabled={qzLoadingPrinters || qzPrinters.length === 0}
                  >
                    <SelectTrigger className="sm:flex-1">
                      <SelectValue placeholder="Select installed printer" />
                    </SelectTrigger>
                    <SelectContent>
                      {qzPrinters.length === 0 ? (
                        <SelectItem value="__none__">No printers found</SelectItem>
                      ) : (
                        qzPrinters.map((printerName) => (
                          <SelectItem key={printerName} value={printerName}>
                            {printerName}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void loadQzPrinters(true)}
                    disabled={qzLoadingPrinters}
                  >
                    {qzLoadingPrinters ? "Checking printers..." : "Refresh QZ Printers"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{qzStatus}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={handleQzTrayPrint}
                  className="gap-1.5"
                  disabled={qzPrinting}
                >
                  <Printer className="h-4 w-4" />
                  {qzPrinting ? "Sending with QZ Tray..." : "QZ Tray Print"}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleRawBtPrint}
                  className="gap-1.5"
                  disabled={rawBtPrinting}
                >
                  <Printer className="h-4 w-4" />
                  {rawBtPrinting ? "Opening RAWBT..." : "RAWBT Print"}
                </Button>
                <Button variant="outline" onClick={handleBrowserPrint}>
                  Browser Print
                </Button>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
