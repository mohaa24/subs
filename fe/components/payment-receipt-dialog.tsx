"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface PaymentReceiptData {
  organizationName: string;
  membershipNo: string;
  membershipId: string;
  memberName?: string;
  period: string;
  paymentId: string;
  paymentDate: string;
  paidAmount: number;
  appliedToDue: number;
  overpaymentToCredit: number;
  remainingAfter: number;
  note?: string | null;
  collectedBy?: string;
  memberQrValue: string;
}

function money(value: number): string {
  return Number(value || 0).toFixed(2);
}

function dateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function rowHtml(label: string, value: string): string {
  return `<div class="row"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
}

function buildReceiptHtml(receipt: PaymentReceiptData, qrDataUrl: string): string {
  const noteHtml = receipt.note ? rowHtml("Note", receipt.note) : "";
  const qrHtml = qrDataUrl
    ? `<div class="qr-wrap"><img src="${qrDataUrl}" alt="Member QR" /><p class="qr-text">${escapeHtml(
        receipt.memberQrValue
      )}</p></div>`
    : "";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Payment Receipt</title>
    <style>
      html, body { margin: 0; padding: 0; background: #fff; color: #000; }
      body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
      .receipt {
        width: 2in;
        padding: 8px;
        box-sizing: border-box;
        margin: 0 auto;
        font-size: 10px;
        line-height: 1.35;
      }
      .center { text-align: center; }
      .strong { font-weight: 700; }
      .title { font-size: 11px; }
      .sep { border-top: 1px dashed #000; margin: 6px 0; }
      .row { display: flex; justify-content: space-between; gap: 6px; }
      .qr-wrap { text-align: center; margin-top: 6px; }
      .qr-wrap img { width: 84px; height: 84px; image-rendering: pixelated; }
      .qr-text { margin: 4px 0 0; font-size: 8px; word-break: break-all; }
      @page { size: 2in auto; margin: 0; }
    </style>
  </head>
  <body>
    <div class="receipt">
      <div class="center">
        <div class="strong title">${escapeHtml(receipt.organizationName)}</div>
        <div>PAYMENT RECEIPT</div>
      </div>
      <div class="sep"></div>
      ${rowHtml("Receipt #", receipt.paymentId.slice(-8).toUpperCase())}
      ${rowHtml("Date", dateTime(receipt.paymentDate))}
      ${rowHtml("Member #", receipt.membershipNo)}
      ${rowHtml("Name", receipt.memberName || "-")}
      ${rowHtml("Period", receipt.period)}
      <div class="sep"></div>
      ${rowHtml("Paid", `Rs ${money(receipt.paidAmount)}`)}
      ${rowHtml("Applied To Due", `Rs ${money(receipt.appliedToDue)}`)}
      ${rowHtml("To Credit", `Rs ${money(receipt.overpaymentToCredit)}`)}
      ${rowHtml("Outstanding", `Rs ${money(receipt.remainingAfter)}`)}
      ${noteHtml}
      <div class="sep"></div>
      ${rowHtml("Collected By", receipt.collectedBy || "-")}
      <div class="sep"></div>
      ${qrHtml}
      <div class="center" style="margin-top: 6px;">Keep this receipt for records</div>
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

  const printableReceiptId = useMemo(
    () => (receipt ? receipt.paymentId.slice(-8).toUpperCase() : ""),
    [receipt]
  );

  function handlePrint() {
    if (!receipt) return;
    const popup = window.open("", "_blank", "width=420,height=900");
    if (!popup) return;
    popup.document.open();
    popup.document.write(buildReceiptHtml(receipt, qrDataUrl));
    popup.document.close();
    popup.focus();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Payment Receipt</DialogTitle>
        </DialogHeader>
        {receipt && (
          <div className="space-y-4">
            <div className="mx-auto w-[2in] rounded-md border border-dashed bg-white p-2 font-mono text-[10px] leading-tight text-black">
              <div className="text-center">
                <p className="text-[11px] font-bold">{receipt.organizationName}</p>
                <p>PAYMENT RECEIPT</p>
              </div>
              <div className="my-1 border-t border-dashed border-black" />

              <div className="flex justify-between gap-2">
                <span>Receipt #</span>
                <span>{printableReceiptId}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Date</span>
                <span>{dateTime(receipt.paymentDate)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Member #</span>
                <span>{receipt.membershipNo}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Name</span>
                <span>{receipt.memberName || "-"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Period</span>
                <span>{receipt.period}</span>
              </div>

              <div className="my-1 border-t border-dashed border-black" />
              <div className="flex justify-between gap-2">
                <span>Paid</span>
                <span>Rs {money(receipt.paidAmount)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Applied To Due</span>
                <span>Rs {money(receipt.appliedToDue)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>To Credit</span>
                <span>Rs {money(receipt.overpaymentToCredit)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Outstanding</span>
                <span>Rs {money(receipt.remainingAfter)}</span>
              </div>
              {receipt.note ? (
                <div className="flex justify-between gap-2">
                  <span>Note</span>
                  <span>{receipt.note}</span>
                </div>
              ) : null}
              <div className="my-1 border-t border-dashed border-black" />
              <div className="flex justify-between gap-2">
                <span>Collected By</span>
                <span>{receipt.collectedBy || "-"}</span>
              </div>

              <div className="my-1 border-t border-dashed border-black" />
              {qrDataUrl ? (
                <div className="text-center">
                  <img
                    src={qrDataUrl}
                    alt={`QR for ${receipt.membershipNo}`}
                    className="mx-auto h-[84px] w-[84px]"
                  />
                  <p className="mt-1 text-[8px] break-all">{receipt.memberQrValue}</p>
                </div>
              ) : null}
              <p className="mt-1 text-center">Keep this receipt for records</p>
            </div>

            <div className="flex gap-2">
              <Button onClick={handlePrint} className="gap-1.5">
                <Printer className="h-4 w-4" />
                Print 2&quot; Receipt
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

