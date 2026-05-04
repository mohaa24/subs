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
      .headings { font-size: 14px; font-weight: 700; text-transform: uppercase; }
      .text-box { width: 100%; }
      .textbox-info {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        margin: 0 0 2px;
      }
      .textbox-info p {
        margin: 0;
      }
      .f-left {
        flex: 1 1 auto;
        min-width: 0;
      }
      .f-right {
        flex: 0 0 auto;
        white-space: nowrap;
        text-align: right;
      }
      .border-top { border-top: 1px solid #242424; padding-top: 6px; margin-top: 6px; }
      .border-bottom { border-bottom: 1px solid #242424; margin: 6px 0; }
      .qr-wrap { text-align: center; margin-top: 8px; }
      .qr-wrap img { width: 84px; height: 84px; image-rendering: pixelated; }
      @page { size: 2in auto; margin: 0.16in 0.08in; }
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
      ${rowHtml("Balance After Payment", undefined, { labelBold: false })}
      ${rowHtml("Total Outstanding", `Rs ${money(receipt.outstandingAfterPayment)}`)}
      ${rowHtml("Total Credit Balance", `Rs ${money(receipt.creditBalanceAfterPayment)}`)}
      ${noteHtml}
      <div class="border-bottom"></div>
      ${rowHtml("Collected By", receipt.collectedBy || "-")}
      <div class="border-bottom"></div>
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

  function handlePrint() {
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Payment Receipt</DialogTitle>
        </DialogHeader>
        {receipt && (
          <div className="space-y-4">
            <div className="mx-auto w-[2in] rounded-md border border-dashed bg-white p-2 font-['Times_New_Roman'] text-[11px] leading-snug text-black">
              <div className="text-center">
                <p className="text-[14px] font-bold uppercase">{receipt.organizationName}</p>
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
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 font-semibold">Name</p>
                <p className="shrink-0 text-right">{receipt.memberName || "-"}</p>
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
              {receipt.note ? (
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 font-semibold">Note</p>
                  <p className="text-right">{receipt.note}</p>
                </div>
              ) : null}
              <div className="my-1 border-b border-black" />
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 font-semibold">Collected By</p>
                <p className="text-right">{receipt.collectedBy || "-"}</p>
              </div>

              <div className="my-1 border-b border-black" />
              {qrDataUrl ? (
                <div className="text-center">
                  <img
                    src={qrDataUrl}
                    alt={`QR for ${receipt.membershipNo}`}
                    className="mx-auto h-[84px] w-[84px]"
                  />
                </div>
              ) : null}
              <p className="mt-1 text-center">Keep this receipt for records</p>
              <p className="mt-1 text-center">developed by civica.lk</p>
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
