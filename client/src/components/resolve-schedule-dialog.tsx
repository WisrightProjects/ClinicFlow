// Resolve-tokens dialog for an ENDED schedule. Lets the attender settle every
// leftover token (still token_started/hold/scheduled) in one place: bulk-first
// (one action for all), then override the few exceptions, then confirm.
// Outcomes map to the POST /api/schedules/:id/resolve-tokens contract:
//   seen -> completed (no refund) | no_show -> no_show (no refund) | refund -> cancel + wallet refund.
import { useMemo, useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, RotateCcw } from "lucide-react";

type Outcome = "seen" | "no_show" | "refund";

interface ResolvableAppointment {
  id: number;
  tokenNumber: number;
  status: string;
  isWalkIn?: boolean | null;
  isPaid?: boolean | null;
  patientId?: number | null;
  guestName?: string | null;
  consultationFee?: string | null;
  patient?: { name?: string | null } | null;
}

interface ResolveScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doctorName: string;
  scheduleLabel: string; // e.g. "9:00 AM - 1:00 PM"
  appointments: ResolvableAppointment[];
  isSubmitting: boolean;
  onConfirm: (resolutions: Array<{ appointmentId: number; outcome: Outcome }>) => void;
}

const SETTLEABLE = ["token_started", "hold", "scheduled"];

export function ResolveScheduleDialog({
  open,
  onOpenChange,
  doctorName,
  scheduleLabel,
  appointments,
  isSubmitting,
  onConfirm,
}: ResolveScheduleDialogProps) {
  const unsettled = useMemo(
    () => appointments.filter((a) => SETTLEABLE.includes(a.status)).sort((a, b) => a.tokenNumber - b.tokenNumber),
    [appointments]
  );

  const [outcomes, setOutcomes] = useState<Record<number, Outcome>>({});

  // Reset choices whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) setOutcomes({});
  }, [open]);

  const canRefund = (a: ResolvableAppointment) => !!a.isPaid && !a.isWalkIn && !!a.patientId;
  const patientLabel = (a: ResolvableAppointment) =>
    a.isWalkIn ? a.guestName || "Walk-in" : a.patient?.name || a.guestName || "Patient";

  const setAll = (fn: (a: ResolvableAppointment) => Outcome) => {
    const next: Record<number, Outcome> = {};
    unsettled.forEach((a) => (next[a.id] = fn(a)));
    setOutcomes(next);
  };

  const pick = (id: number, o: Outcome) => setOutcomes((prev) => ({ ...prev, [id]: o }));

  const counts = useMemo(() => {
    let completed = 0, noShow = 0, refund = 0, refundTotal = 0;
    unsettled.forEach((a) => {
      const o = outcomes[a.id];
      if (o === "seen") completed++;
      else if (o === "no_show") noShow++;
      else if (o === "refund") {
        refund++;
        if (canRefund(a)) refundTotal += parseFloat(a.consultationFee || "0") || 0;
      }
    });
    return { completed, noShow, refund, refundTotal };
  }, [outcomes, unsettled]);

  const decided = Object.keys(outcomes).length;
  const allDecided = unsettled.length > 0 && decided === unsettled.length;

  const submit = () => {
    const resolutions = unsettled
      .filter((a) => outcomes[a.id])
      .map((a) => ({ appointmentId: a.id, outcome: outcomes[a.id] }));
    if (resolutions.length) onConfirm(resolutions);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Resolve ended schedule</DialogTitle>
          <DialogDescription>
            {doctorName} · {scheduleLabel} · {unsettled.length} unsettled token{unsettled.length !== 1 ? "s" : ""}
          </DialogDescription>
        </DialogHeader>

        {unsettled.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No unsettled tokens — everything is already resolved.
          </p>
        ) : (
          <>
            {/* Bulk-first: one answer settles all, then override exceptions below. */}
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-800">What happened with the doctor?</p>
              <p className="mb-2 text-xs text-amber-700">
                Pick one to set all {unsettled.length}, then change individual exceptions.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setAll(() => "seen")}>
                  <CheckCircle2 className="mr-1 h-4 w-4" /> Doctor saw everyone — mark all completed
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setAll((a) => (canRefund(a) ? "refund" : "no_show"))}
                >
                  <RotateCcw className="mr-1 h-4 w-4" /> Doctor didn't attend — refund all unseen
                </Button>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {unsettled.map((a) => {
                const o = outcomes[a.id];
                const refundable = canRefund(a);
                return (
                  <div key={a.id} className="rounded-md border p-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-semibold text-blue-600">#{a.tokenNumber}</span>
                        <span className="font-medium">{patientLabel(a)}</span>
                        {a.isWalkIn ? (
                          <Badge variant="outline" className="text-[10px]">Walk-in</Badge>
                        ) : refundable ? (
                          <Badge variant="outline" className="text-[10px]">App · ₹{parseFloat(a.consultationFee || "0")}</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">Unpaid</Badge>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Button
                        size="sm"
                        variant={o === "seen" ? "default" : "outline"}
                        className="h-7 px-2 text-xs"
                        onClick={() => pick(a.id, "seen")}
                      >
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Seen
                      </Button>
                      <Button
                        size="sm"
                        variant={o === "no_show" ? "secondary" : "outline"}
                        className="h-7 px-2 text-xs"
                        onClick={() => pick(a.id, "no_show")}
                      >
                        <XCircle className="mr-1 h-3.5 w-3.5" /> No-show
                      </Button>
                      {refundable && (
                        <Button
                          size="sm"
                          variant={o === "refund" ? "destructive" : "outline"}
                          className="h-7 px-2 text-xs"
                          onClick={() => pick(a.id, "refund")}
                        >
                          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Refund
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Summary */}
            <div className="mt-3 rounded-md bg-muted p-3 text-sm">
              <div className="flex flex-wrap gap-3">
                <span>✓ Completed: <b>{counts.completed}</b></span>
                <span>⊘ No-show: <b>{counts.noShow}</b></span>
                <span>↩ Refund: <b>{counts.refund}</b></span>
              </div>
              <div className="mt-1 font-semibold">Total refund to wallets: ₹{counts.refundTotal}</div>
            </div>
          </>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!allDecided || isSubmitting}>
            {isSubmitting ? "Resolving…" : `Resolve ${unsettled.length} token${unsettled.length !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
