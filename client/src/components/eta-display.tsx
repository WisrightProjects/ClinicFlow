import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import React from "react";

interface ETADisplayProps {
  appointmentId: number;
  tokenNumber: number;
  className?: string;
  showDetails?: boolean;
}

function getStageInfo(status: string, doctorHasArrived: boolean, avgConsultationTime?: number) {
  if (status === "completed") {
    return { label: "Completed", variant: "secondary" as const, description: "Consultation completed", isLive: false };
  }
  if (status === "no_show") {
    return { label: "No Show", variant: "destructive" as const, description: "Patient did not show up", isLive: false };
  }
  if (status === "cancel") {
    return { label: "Cancelled", variant: "destructive" as const, description: "Appointment cancelled", isLive: false };
  }
  if (status === "expired") {
    return { label: "Expired", variant: "destructive" as const, description: "Walk-in reservation expired", isLive: false };
  }
  if (status === "hold") {
    return { label: "On Hold", variant: "outline" as const, description: "Appointment on hold", isLive: false };
  }
  if (status === "pause") {
    return { label: "Paused", variant: "outline" as const, description: "Schedule paused", isLive: false };
  }
  // "scheduled" and "token_started" are both pre-consultation waiting states (just two
  // initial values saved by different booking paths). Treat them identically so a waiting
  // token never shows the misleading "Live" badge before the doctor has arrived.
  if ((status === "token_started" || status === "scheduled") && !doctorHasArrived) {
    return { label: "Scheduled", variant: "outline" as const, description: "Based on scheduled start time", isLive: false };
  }
  if ((status === "token_started" || status === "scheduled") && doctorHasArrived) {
    return { label: "Updated", variant: "secondary" as const, description: "Updated for doctor arrival", isLive: false };
  }
  if (status === "in_progress") {
    return { label: "In Progress", variant: "default" as const, description: "Currently in consultation", isLive: true };
  }
  return {
    label: "Live",
    variant: "default" as const,
    description: avgConsultationTime ? `Based on ${avgConsultationTime}min avg consultation` : "Real-time estimate",
    isLive: true,
  };
}

export function ETADisplay({ appointmentId, tokenNumber, className = "", showDetails = false }: ETADisplayProps) {
  const { data: eta, isLoading } = useQuery({
    queryKey: [`/api/appointments/${appointmentId}/eta`],
    refetchInterval: 10000,
    retry: 1,
    staleTime: 5000,
  });

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 text-sm ${className}`}>
        <Timer className="h-4 w-4 animate-pulse" />
        <span>Loading...</span>
      </div>
    );
  }

  if (!eta || !eta.estimatedStartTime) {
    return (
      <div className={`flex items-center gap-2 text-sm text-muted-foreground ${className}`}>
        <Timer className="h-4 w-4" />
        <span>ETA pending...</span>
      </div>
    );
  }

  const etaDate = new Date(eta.estimatedStartTime);
  const stageInfo = getStageInfo(
    eta.currentAppointmentStatus || "token_started",
    !!eta.doctorHasArrived,
    eta.avgConsultationTime
  );

  return (
    <div className={`flex flex-col gap-1 p-3 bg-gray-50 rounded-lg border ${className}`}>
      <div className="flex items-center gap-2 text-sm">
        <Timer className="h-4 w-4 text-blue-500" />
        <span className="font-medium">ETA: {format(etaDate, "h:mm a")}</span>
        <Badge variant={stageInfo.variant}>{stageInfo.label}</Badge>
        {stageInfo.isLive && (
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        )}
      </div>
      <p className="text-xs text-muted-foreground">{stageInfo.description}</p>
      {showDetails && (
        <div className="text-xs text-muted-foreground mt-1">
          {eta.currentAppointmentStatus === "completed" ? (
            `Your Token: ${eta.tokenNumber} | Avg time: ${eta.avgConsultationTime} min`
          ) : (
            `Current Token: ${eta.currentConsultingToken || "-"} | Completed: ${eta.completedTokenCount ?? "-"} | Avg time: ${eta.avgConsultationTime} min`
          )}
        </div>
      )}
    </div>
  );
}
