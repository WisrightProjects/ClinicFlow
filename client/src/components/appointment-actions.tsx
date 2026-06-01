import React from 'react';
import { Button } from "@/components/ui/button";
import { Appointment } from "@shared/schema";

type AppointmentActionsProps = {
  appointment: Appointment & { patient?: any };
  onMarkAsStarted: () => void;
  onMarkAsCompleted: () => void;
  onHold: () => void;
  onNoShow: () => void;
  // A token cannot be started until the doctor is marked as arrived for its schedule.
  doctorHasArrived?: boolean;
};

export function AppointmentActions({
  appointment,
  onMarkAsStarted,
  onMarkAsCompleted,
  onHold,
  onNoShow,
  doctorHasArrived = true
}: AppointmentActionsProps) {
  const status = appointment.status;
  const startDisabledReason = doctorHasArrived
    ? undefined
    : "Mark the doctor as arrived before starting this token";

  return (
    <div className="flex gap-2 flex-wrap items-center">
      {(status === "scheduled" || status === "token_started") && (
        <>
          <Button
            size="sm"
            onClick={onMarkAsStarted}
            disabled={!doctorHasArrived}
            title={startDisabledReason}
          >
            Start
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onHold}
          >
            Hold
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={onNoShow}
          >
            No Show
          </Button>
          {!doctorHasArrived && (
            <span className="text-xs text-amber-600">Awaiting doctor arrival</span>
          )}
        </>
      )}

      {(status === "start" || status === "in_progress") && (
        <>
          <Button
            size="sm"
            onClick={onMarkAsCompleted}
          >
            Complete
          </Button>
        </>
      )}

      {status === "hold" && (
        <>
          <Button
            size="sm"
            onClick={onMarkAsStarted}
            disabled={!doctorHasArrived}
            title={startDisabledReason}
          >
            Start
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={onNoShow}
          >
            No Show
          </Button>
          {!doctorHasArrived && (
            <span className="text-xs text-amber-600">Awaiting doctor arrival</span>
          )}
        </>
      )}
    </div>
  );
}