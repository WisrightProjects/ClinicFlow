// Simulated payment screen for the "Online" option (Phase 1).
// Presentational only — the parent runs the real booking request and drives `status`,
// so "Payment Successful" is never shown for a booking that actually failed.

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, ShieldCheck } from "lucide-react";

export type DummyPaymentStatus = "processing" | "success" | "failed";

interface DummyPaymentScreenProps {
  open: boolean;
  /** Amount being charged, in rupees. */
  amount: number;
  status: DummyPaymentStatus;
  /** Shown when status is "failed". */
  errorMessage?: string;
  /** Called when the patient dismisses a failed payment. */
  onClose: () => void;
}

export function DummyPaymentScreen({
  open,
  amount,
  status,
  errorMessage,
  onClose,
}: DummyPaymentScreenProps) {
  return (
    <Dialog
      open={open}
      // Closing mid-payment would leave the patient unsure whether they were charged.
      onOpenChange={(next) => {
        if (!next && status === "failed") onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-sm"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          if (status !== "failed") e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            Secure Payment
          </DialogTitle>
        </DialogHeader>

        <div className="py-6 flex flex-col items-center text-center space-y-4">
          <p className="text-3xl font-bold">₹{amount.toFixed(2)}</p>

          {status === "processing" && (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <div>
                <p className="font-medium">Processing payment…</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Please do not close this screen.
                </p>
              </div>
            </>
          )}

          {status === "success" && (
            <>
              <CheckCircle2 className="h-12 w-12 text-green-600" />
              <div>
                <p className="font-medium text-green-700">Payment Successful</p>
                <p className="text-xs text-muted-foreground mt-1">Booking your token…</p>
              </div>
            </>
          )}

          {status === "failed" && (
            <>
              <XCircle className="h-12 w-12 text-destructive" />
              <div>
                <p className="font-medium text-destructive">Payment Failed</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {errorMessage || "Something went wrong. You have not been charged."}
                </p>
              </div>
              <Button variant="outline" onClick={onClose} className="mt-2">
                Close
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
