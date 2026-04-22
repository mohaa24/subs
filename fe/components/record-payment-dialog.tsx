"use client";

import type { FormEvent } from "react";
import { DollarSign } from "lucide-react";
import type { PaymentDue } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getPaymentDueSubtitle, getPaymentDueTitle } from "@/lib/payment-due";

export type PaymentMethod = "cash" | "bank_transfer" | "card" | "other";

export function getPaymentMethodLabel(method: PaymentMethod) {
  switch (method) {
    case "cash":
      return "Cash";
    case "bank_transfer":
      return "Bank Transfer";
    case "card":
      return "Card";
    default:
      return "Other";
  }
}

type RecordPaymentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  due: PaymentDue | null;
  amount: string;
  onAmountChange: (value: string) => void;
  paymentMethod: PaymentMethod;
  onPaymentMethodChange: (value: PaymentMethod) => void;
  note: string;
  onNoteChange: (value: string) => void;
  error?: string;
  submitting?: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  memberName?: string;
  membershipNo?: string;
  contextDescription?: string;
  title?: string;
  submitLabel?: string;
  submittingLabel?: string;
  cancelLabel?: string;
};

export function RecordPaymentDialog({
  open,
  onOpenChange,
  due,
  amount,
  onAmountChange,
  paymentMethod,
  onPaymentMethodChange,
  note,
  onNoteChange,
  error,
  submitting = false,
  onSubmit,
  memberName,
  membershipNo,
  contextDescription,
  title = "Record Payment",
  submitLabel = "Record Payment",
  submittingLabel = "Recording…",
  cancelLabel = "Cancel",
}: RecordPaymentDialogProps) {
  const displayName =
    memberName ||
    due?.membership?.hod?.fullName ||
    due?.membership?.hod?.nameWithInitials ||
    "—";
  const displayMembershipNo = membershipNo || due?.membership?.membershipNo || "";
  const displayTitle = due ? getPaymentDueTitle(due) : "";
  const displaySubtitle = due ? getPaymentDueSubtitle(due) : null;
  const displayMeta = [displayMembershipNo, displayTitle].filter(Boolean).join(" · ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            {title}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="rounded-lg bg-muted/50 border p-4 space-y-2">
            <p className="text-sm font-semibold">{displayName}</p>
            <div className="text-xs text-muted-foreground">
              {displayMeta ? <p>{displayMeta}</p> : null}
              {displaySubtitle && <p className="mt-0.5">{displaySubtitle}</p>}
            </div>
            {due ? (
              <div className="grid grid-cols-3 gap-3 pt-1 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Due</p>
                  <p className="font-semibold tabular-nums">{Number(due.amountDue).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Paid</p>
                  <p className="font-semibold tabular-nums text-emerald-600">
                    {Number(due.amountPaid).toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Remaining</p>
                  <p className="font-semibold tabular-nums text-red-600">
                    {(Number(due.amountDue) - Number(due.amountPaid)).toFixed(2)}
                  </p>
                </div>
              </div>
            ) : contextDescription ? (
              <p className="pt-1 text-xs text-muted-foreground">
                {contextDescription}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>Amount</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => onAmountChange(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Payment Method</Label>
            <Select value={paymentMethod} onValueChange={(value) => onPaymentMethodChange(value as PaymentMethod)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Note / Remark (optional)</Label>
            <Input
              value={note}
              onChange={(e) => {
                if (e.target.value.length <= 50) onNoteChange(e.target.value);
              }}
              placeholder="Optional remark..."
              maxLength={50}
            />
            <p className="text-xs text-muted-foreground text-right">{note.length}/50</p>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex gap-2">
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting ? submittingLabel : submitLabel}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {cancelLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
