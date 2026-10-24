// Patient-facing cancellation dialog: collects a reason and states the refund.
//
// Shared by both places a patient can cancel — today's appointment cards and the
// upcoming list — so the wording, the required-reason rule and the refund notice cannot
// drift between them.

import { useEffect, useState } from "react";
import { RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface CancellableAppointment {
  id: number;
  tokenNumber: number | null;
  isPaid?: boolean | null;
  isRefundEligible?: boolean | null;
  consultationFee?: string | number | null;
  doctor: { name: string };
}

interface Props {
  appointment: CancellableAppointment;
  onConfirm: (appointmentId: number, reason: string) => void;
  isPending: boolean;
  /**
   * Controlled by the parent, because only the parent knows when the cancellation
   * actually succeeded. Owning `open` internally would leave the dialog sitting there
   * after a successful cancel with Confirm still enabled — one more tap would send a
   * second request and show "Cancellation Failed" straight after "Appointment Cancelled".
   */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "full" for the card layout, "compact" for a table cell. */
  variant?: "full" | "compact";
}

export function CancelAppointmentDialog({
  appointment,
  onConfirm,
  isPending,
  open,
  onOpenChange,
  variant = "full",
}: Props) {
  const [reason, setReason] = useState("");

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) setReason("");
  };

  // Also clear when the PARENT closes us — on a successful cancellation it sets its own
  // state directly, which changes `open` without Radix ever calling onOpenChange. Without
  // this the old reason survives, and a stray tap before the refetch lands would reopen
  // the dialog prefilled and fire a second request.
  useEffect(() => {
    if (!open) setReason("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onOpenChange(true)}
          className={
            variant === "full"
              ? "w-full border-red-300 text-red-600 hover:bg-red-50"
              : "border-red-300 text-red-600 hover:bg-red-50"
          }
        >
          <XCircle className="h-4 w-4 mr-2" />
          Cancel
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel Appointment</DialogTitle>
          <DialogDescription>
            Cancel your appointment with {appointment.doctor.name} (Token #
            {appointment.tokenNumber})
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor={`cancelReason-${appointment.id}`}>
              Reason for cancellation *
            </Label>
            <Textarea
              id={`cancelReason-${appointment.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Unable to attend, feeling better, etc."
              className="mt-1"
            />
          </div>
          {appointment.isPaid && appointment.isRefundEligible && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
              ₹{parseFloat(String(appointment.consultationFee ?? "21")).toFixed(0)} will be
              refunded to your wallet.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={() => onConfirm(appointment.id, reason)}
            disabled={isPending || !reason.trim()}
            className="bg-red-600 hover:bg-red-700"
          >
            {isPending && <RefreshCw className="h-4 w-4 mr-2 animate-spin" />}
            Confirm Cancellation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
