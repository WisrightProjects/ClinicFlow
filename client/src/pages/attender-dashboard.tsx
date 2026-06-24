import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { User, Appointment } from "@shared/schema";
import { NavHeader } from "@/components/nav-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { constructNow, format, isSameDay } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2, XCircle, Clock, Calendar as CalendarIcon, Building, Plus } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { 
  Tooltip, 
  TooltipContent, 
  TooltipTrigger,
  TooltipProvider 
} from "@/components/ui/tooltip";
import { InfoIcon } from "lucide-react";
import { AppointmentActions } from "@/components/appointment-actions";
import { ResolveScheduleDialog } from "@/components/resolve-schedule-dialog";
import { ETADisplay } from "@/components/eta-display";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { NavigationButtons } from "@/components/navigation-buttons";
import { useBookingConfig } from "@/hooks/use-app-config";
import React, { useEffect } from "react";

// Updated type definition without presence info in schedules
type DoctorSchedule = {
  id: number;
  doctorId: number;
  clinicId: number;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isActive: boolean;
  maxTokens?: number;
  isPaused?: boolean;
  pauseReason?: string;
  scheduleStatus?: 'active' | 'completed';
  bookingStatus?: 'open' | 'closed';
  createdAt?: string;
  updatedAt?: string;
  appointments: (Appointment & { patient?: User })[];
};

type DoctorWithAppointments = {
  doctor: User;
  appointments: (Appointment & { patient?: User })[];
  clinicId: number;
  schedules: DoctorSchedule[];
};

// Tokens that still need settling once a schedule has ended.
const SETTLEABLE_STATUSES = ["token_started", "hold", "scheduled"];

// A schedule has ended when its date + endTime is in the past (server enforces this too).
function isScheduleEnded(schedule: { date?: any; endTime?: string }): boolean {
  if (!schedule?.date || !schedule?.endTime) return false;
  const d = new Date(schedule.date);
  if (isNaN(d.getTime())) return false;
  const [h, m] = String(schedule.endTime).split(":").map(Number);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h || 0, m || 0, 0, 0);
  return new Date() > end;
}

function getUnsettledCount(schedule: { appointments?: any[] }): number {
  return (schedule.appointments || []).filter((a: any) => SETTLEABLE_STATUSES.includes(a.status)).length;
}

export default function AttenderDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { reservationTimeoutSeconds } = useBookingConfig();
  const [isPaused, setIsPaused] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>("");
  const [isWalkInDialogOpen, setIsWalkInDialogOpen] = useState(false);
  const [walkInFormValues, setWalkInFormValues] = useState({
    doctorId: 0,
    clinicId: 0,
    scheduleId: 0,
    guestName: "",
    guestPhone: ""
  });
  const [walkInCurrentDoctor, setWalkInCurrentDoctor] = useState<{
    doctorId: number;
    doctorName: string;
    clinicId: number;
    scheduleId: number;
    date: Date;
  } | null>(null);
  const [walkInReservation, setWalkInReservation] = useState<{
    id: number;
    tokenNumber: number;
    expiresAt: string;
    scheduleId: number;
  } | null>(null);
  const [walkInStep, setWalkInStep] = useState<'idle' | 'reserving' | 'filling'>('idle');
  const [reservationSecondsLeft, setReservationSecondsLeft] = useState(0);

  // Main query for fetching doctor data with schedules and appointments  
  const { data: managedDoctors, isLoading, error } = useQuery<DoctorWithAppointments[]>({
    queryKey: [`/api/attender/${user?.id}/doctors/appointments`, selectedDate, user?.role],
    enabled: !!user?.id,
    // Refresh every 30 seconds to keep appointments data current
    refetchInterval: 30000,
    queryFn: async () => {
      // The shared route already handles both attender and clinic_admin roles
      const res = await apiRequest("GET", `/api/attender/${user?.id}/doctors/appointments`);
      const data = await res.json();
      
      // Ensure each doctor has schedules initialized as an array
      return data.map((doctorData: any) => ({
        ...doctorData,
        schedules: doctorData.schedules || [],
        appointments: doctorData.appointments || []
      }));
    }
  });

  // Mutations for appointment status updates
  const updateAppointmentMutation = useMutation({
    mutationFn: async ({ 
      appointmentId, 
      status = "Pause", 
      statusNotes 
    }: { 
      appointmentId: number; 
      status: string; 
      statusNotes?: string 
    }) => {
      const res = await apiRequest("PATCH", `/api/appointments/${appointmentId}/status`, { 
        status, 
        statusNotes 
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/attender/${user?.id}/doctors/appointments`] });
      // Invalidate schedules to update appointment counts
      queryClient.invalidateQueries({ queryKey: ["schedulesToday"] });
      toast({
        title: "Success",
        description: "Appointment status updated successfully",
      });
    },
  });

  // Add a mutation for updating doctor arrival status
  const updateDoctorArrivalMutation = useMutation({
    mutationFn: async ({ 
      doctorId, 
      clinicId, 
      scheduleId, 
      hasArrived 
    }: { 
      doctorId: number; 
      clinicId: number; 
      scheduleId: number | null; 
      hasArrived: boolean; 
    }) => {
      const res = await apiRequest("PATCH", `/api/doctors/${doctorId}/arrival`, { 
        hasArrived, 
        clinicId, 
        scheduleId, 
        date: selectedDate.toISOString() 
      });
      return res.json();
    },
    onSuccess: (data) => {
      // Invalidate all relevant queries to ensure data consistency
      queryClient.invalidateQueries({ queryKey: [`/api/attender/${user?.id}/doctors/appointments`] });
      queryClient.invalidateQueries({ queryKey: ['doctorPresences', managedDoctors, selectedDate] });
      
      toast({
        title: "Success",
        description: data.hasArrived ? "Doctor marked as arrived" : "Doctor marked as not arrived",
      });
    },
    onError: (error) => {
      console.error('Error updating doctor arrival:', error);
      toast({
        title: "Error",
        description: "Failed to update doctor arrival status. Please try again.",
        variant: "destructive"
      });
    }
  });

  // Add a mutation for toggling schedule pause status
  const toggleSchedulePauseMutation = useMutation({
    mutationFn: async ({ 
      scheduleId, 
      isPaused, 
      pauseReason 
    }: { 
      scheduleId: number;
      isPaused: boolean;
      pauseReason?: string;
    }) => {
      const endpoint = isPaused ? `/api/schedules/${scheduleId}/pause` : `/api/schedules/${scheduleId}/resume`;
      const res = await apiRequest("PATCH", endpoint, { 
        reason: pauseReason,
        date: selectedDate.toISOString()
      });
      return res.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: [`/api/attender/${user?.id}/doctors/appointments`] });
      toast({
        title: "Success",
        description: variables.isPaused ? "Schedule paused successfully" : "Schedule resumed successfully",
      });
    },
  });

  // Add a query for fetching doctor presence data for the selected date
  const { data: doctorPresences } = useQuery({
    queryKey: ['doctorPresences', managedDoctors, selectedDate],
    enabled: !!managedDoctors && managedDoctors.length > 0,
    staleTime: 0, // Always consider data stale to ensure fresh updates
    refetchOnWindowFocus: true, // Refetch when window gets focus
    queryFn: async () => {
      // Collect all doctor IDs and their schedules
      const presenceData: Record<number, Record<number, { hasArrived: boolean }>> = {};
      
      if (!managedDoctors) return presenceData;
      
      // Create a map of doctor ID -> schedule ID -> presence data
      for (const doctorData of managedDoctors) {
        const { doctor, schedules, clinicId } = doctorData;
        
        // For clinic admins, use user's clinicId as fallback if doctorData.clinicId is undefined
        const actualClinicId = clinicId || user?.clinicId;
        
        // Skip if no schedules or no clinic ID
        if (!schedules || schedules.length === 0 || !actualClinicId) continue;
        
        // Initialize record for this doctor
        presenceData[doctor.id] = {};
        
        // For each schedule, fetch presence data with schedule ID
        for (const schedule of schedules) {
          try {
            const res = await apiRequest("GET", 
              `/api/doctors/${doctor.id}/arrival?clinicId=${actualClinicId}&date=${selectedDate.toISOString()}`
            );
            const presence = await res.json();
            
            // Check if the presence record explicitly matches this schedule
            if (presence.scheduleId === schedule.id) {
              presenceData[doctor.id][schedule.id] = {
                hasArrived: presence.hasArrived
              };
            } else {
              // Default to not arrived for this schedule
              presenceData[doctor.id][schedule.id] = {
                hasArrived: false
              };
            }
          } catch (error) {
            console.error("Error fetching presence data:", error);
            presenceData[doctor.id][schedule.id] = {
              hasArrived: false
            };
          }
        }
      }
      
      return presenceData;
    }
  });

  // Reset all walk-in dialog state (defined early so useEffects can reference it)
  const resetWalkInDialog = () => {
    setWalkInStep('idle');
    setWalkInReservation(null);
    setWalkInCurrentDoctor(null);
    setWalkInFormValues({ doctorId: 0, clinicId: 0, scheduleId: 0, guestName: '', guestPhone: '' });
    setReservationSecondsLeft(reservationTimeoutSeconds);
  };

  // Auto-select the first doctor when data loads
  useEffect(() => {
    if (managedDoctors && managedDoctors.length > 0 && !selectedDoctorId) {
      setSelectedDoctorId(managedDoctors[0].doctor.id.toString());
    }
  }, [managedDoctors, selectedDoctorId]);

  // Countdown timer for walk-in reservation
  useEffect(() => {
    if (walkInStep !== 'filling') return;
    if (reservationSecondsLeft <= 0) {
      toast({ title: "Reservation expired. Please try again.", variant: "destructive" });
      // Cancel the reservation so the token is freed immediately
      if (walkInReservation) {
        cancelReservationMutation.mutate({
          scheduleId: walkInReservation.scheduleId,
          reservationId: walkInReservation.id
        });
      }
      resetWalkInDialog();
      setIsWalkInDialogOpen(false);
      return;
    }
    const timer = setInterval(() => setReservationSecondsLeft(s => s - 1), 1000);
    return () => clearInterval(timer);
  }, [walkInStep, reservationSecondsLeft]);

  // Helper function to get presence data for a doctor's schedule
  const getPresenceData = (doctorId: number, scheduleId: number) => {
    if (!doctorPresences || !doctorPresences[doctorId] || !doctorPresences[doctorId][scheduleId]) {
      return { hasArrived: false };
    }
    return doctorPresences[doctorId][scheduleId];
  };

  // Handler functions for updating status
  const handleUpdateStatus = (appointmentId: number, status: string, notes?: string) => {
    updateAppointmentMutation.mutate({ 
      appointmentId, 
      status, 
      statusNotes: notes 
    });
  };

  // Status update handlers
  const handleMarkAsCompleted = (appointmentId: number) => {
    handleUpdateStatus(appointmentId, "completed");
  };

  const handleMarkInProgress = (appointmentId: number) => {
    // Simple transition: scheduled/token_started/hold → in_progress
    handleUpdateStatus(appointmentId, "in_progress");
  };

  const handleHoldAppointment = (appointmentId: number) => {
    const notes = prompt("Please enter reason for holding:");
    if (notes !== null) {
      handleUpdateStatus(appointmentId, "hold", notes);
    }
  };
  
  const handleCancelAppointment = (appointmentId: number) => {
    const notes = prompt("Please enter reason for cancellation:");
    if (notes !== null) {
      handleUpdateStatus(appointmentId, "cancel", notes);
    }
  };

  const handleNoShowAppointment = (appointmentId: number) => {
    if (confirm("Mark this patient as No Show? This patient will NOT be eligible for refund.")) {
      handleUpdateStatus(appointmentId, "no_show", "Patient did not show up");
    }
  };

  // Handler for doctor arrival toggle
  const handleToggleDoctorArrival = (
    doctorId: number, 
    clinicId: number, 
    scheduleId: number | null, 
    hasArrived: boolean = true
  ) => {
    // Directly make the API call without optimistic updates to avoid race conditions
    updateDoctorArrivalMutation.mutate({ 
      doctorId, 
      clinicId, 
      scheduleId, 
      hasArrived
    });
  };

  // Add this mutation
  const createWalkInAppointmentMutation = useMutation({
    mutationFn: async ({ 
      doctorId, 
      clinicId, 
      scheduleId, 
      date, 
      guestName, 
      guestPhone 
    }: { 
      doctorId: number;
      clinicId: number;
      scheduleId: number;
      date: Date;
      guestName: string;
      guestPhone?: string;
    }) => {
      const res = await apiRequest("POST", "/api/attender/walk-in-appointments", {
        doctorId,
        clinicId,
        scheduleId,
        date,
        guestName,
        guestPhone
      });
      return res.json();
    },
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["/api/attender/doctors"] });
      // Invalidate schedules to update appointment counts
      queryClient.invalidateQueries({ queryKey: ["schedulesToday"] });
      toast({
        title: "Success",
        description: "Walk-in appointment created successfully",
      });
      // Close the dialog
      setIsWalkInDialogOpen(false);
      // Reset the form
      setWalkInFormValues({
        doctorId: 0,
        clinicId: 0,
        scheduleId: 0,
        guestName: "",
        guestPhone: ""
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const reserveTokenMutation = useMutation({
    mutationFn: async (scheduleId: number) => {
      const res = await apiRequest("POST", `/api/schedules/${scheduleId}/reserve-token`, {});
      return res.json();
    },
    onSuccess: (data) => {
      setWalkInReservation(data);
      setWalkInStep('filling');
      setReservationSecondsLeft(reservationTimeoutSeconds);
    },
    onError: () => {
      toast({ title: "Failed to reserve token", variant: "destructive" });
      setWalkInStep('idle');
    }
  });

  const confirmWalkInMutation = useMutation({
    mutationFn: async ({ scheduleId, reservationId, guestName, guestPhone }: {
      scheduleId: number; reservationId: number; guestName: string; guestPhone: string;
    }) => {
      const res = await apiRequest("POST", `/api/schedules/${scheduleId}/confirm-walkin`, {
        reservationId, guestName, guestPhone
      });
      return res.json();
    },
    onSuccess: (data) => {
      const reservedToken = walkInReservation?.tokenNumber;
      const confirmedToken = data?.tokenNumber;
      if (reservedToken && confirmedToken && reservedToken !== confirmedToken) {
        toast({
          title: `Walk-in assigned Token #${confirmedToken}`,
          description: `Reserved slot #${reservedToken} was taken; reassigned to #${confirmedToken}.`,
          variant: "destructive"
        });
      } else {
        toast({ title: `Walk-in Token #${confirmedToken ?? reservedToken} confirmed!` });
      }
      resetWalkInDialog();
      setIsWalkInDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: [`/api/attender/${user?.id}/doctors/appointments`] });
    },
    onError: (error: any) => {
      toast({ title: error.message || "Failed to confirm walk-in", variant: "destructive" });
    }
  });

  const cancelReservationMutation = useMutation({
    mutationFn: async ({ scheduleId, reservationId }: { scheduleId: number; reservationId: number }) => {
      await apiRequest("DELETE", `/api/schedules/${scheduleId}/reservation/${reservationId}`, {});
    }
  });

  // Mutation for canceling a schedule with automatic refunds
  const cancelScheduleMutation = useMutation({
    mutationFn: async ({
      scheduleId,
      cancelReason
    }: {
      scheduleId: number;
      cancelReason: string;
    }) => {
      const res = await apiRequest("POST", `/api/schedules/${scheduleId}/cancel-with-refunds`, {
        cancelReason
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries([`/api/attender/${user?.id}/doctors/appointments`]);
      toast({
        title: "Schedule cancelled",
        description: `Schedule cancelled. ${data.refundedAppointments} patient(s) refunded ₹${data.totalRefundAmount}.`
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: "Failed to cancel schedule: " + error.message,
        variant: "destructive"
      });
    }
  });

  // Mutation for completing a schedule
  const completeScheduleMutation = useMutation({
    mutationFn: async (scheduleId: number) => {
      const res = await apiRequest("PATCH", `/api/schedules/${scheduleId}/complete`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries([`/api/attender/${user?.id}/doctors/appointments`]);
      queryClient.invalidateQueries({ queryKey: ["schedulesToday"] });
      toast({
        title: "Schedule completed",
        description: "The schedule has been marked as completed."
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: "Failed to complete schedule: " + error.message,
        variant: "destructive"
      });
    }
  });

  // State + mutation for resolving an ENDED schedule's leftover tokens
  const [resolveTarget, setResolveTarget] = useState<{ schedule: any; doctorName: string } | null>(null);

  const resolveTokensMutation = useMutation({
    mutationFn: async ({ scheduleId, resolutions }: { scheduleId: number; resolutions: Array<{ appointmentId: number; outcome: string }> }) => {
      const res = await apiRequest("POST", `/api/schedules/${scheduleId}/resolve-tokens`, { resolutions });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries([`/api/attender/${user?.id}/doctors/appointments`]);
      queryClient.invalidateQueries({ queryKey: ["schedulesToday"] });
      setResolveTarget(null);
      toast({
        title: "Tokens resolved",
        description: `${data?.completed || 0} completed · ${data?.noShow || 0} no-show · ${data?.refunded || 0} refunded (₹${data?.totalRefund || 0}).`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: "Failed to resolve tokens: " + error.message,
        variant: "destructive",
      });
    },
  });

  // Mutation for toggling booking status
  const toggleBookingMutation = useMutation({
    mutationFn: async ({ 
      scheduleId, 
      isClosing 
    }: { 
      scheduleId: number; 
      isClosing: boolean;
    }) => {
      const endpoint = isClosing ? 'booking-close' : 'booking-open';
      const res = await apiRequest("PATCH", `/api/schedules/${scheduleId}/${endpoint}`);
      return res.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries([`/api/attender/${user?.id}/doctors/appointments`]);
      queryClient.invalidateQueries({ queryKey: ["schedulesToday"] });
      toast({
        title: "Booking status updated",
        description: variables.isClosing ? "Booking has been closed for new appointments." : "Booking has been reopened for new appointments."
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: "Failed to update booking status: " + error.message,
        variant: "destructive"
      });
    }
  });

  // Handler for canceling a schedule
  const handleCancelSchedule = async (scheduleId: number) => {
    if (!confirm("Are you sure you want to cancel this schedule? All pending appointments will be cancelled and eligible patients will be refunded.")) {
      return;
    }

    const reason = prompt("Please enter a reason for cancellation (required):");
    if (!reason || !reason.trim()) {
      toast({ title: "Cancellation reason required", description: "Please provide a reason to cancel the schedule.", variant: "destructive" });
      return;
    }

    await cancelScheduleMutation.mutate({
      scheduleId,
      cancelReason: reason.trim()
    });
  };

  // Handler for completing a schedule
  const handleCompleteSchedule = async (scheduleId: number) => {
    if (!confirm("Are you sure you want to mark this schedule as completed? This indicates the doctor has finished and left.")) {
      return;
    }

    await completeScheduleMutation.mutate(scheduleId);
  };

  // Handler for toggling booking status
  const handleToggleBooking = async (scheduleId: number, currentStatus: 'open' | 'closed' = 'open') => {
    const isClosing = currentStatus === 'open';
    const action = isClosing ? 'close' : 'reopen';
    
    if (!confirm(`Are you sure you want to ${action} booking for this schedule?`)) {
      return;
    }

    await toggleBookingMutation.mutate({ scheduleId, isClosing });
  };

  const handleCreateWalkInAppointment = () => {
    if (!walkInCurrentDoctor) return;

    if (!walkInFormValues.guestName.trim()) {
      toast({
        title: "Error",
        description: "Patient name is required",
        variant: "destructive",
      });
      return;
    }

    createWalkInAppointmentMutation.mutate({
      doctorId: walkInCurrentDoctor.doctorId,
      clinicId: walkInCurrentDoctor.clinicId,
      scheduleId: walkInCurrentDoctor.scheduleId,
      date: walkInCurrentDoctor.date,
      guestName: walkInFormValues.guestName,
      guestPhone: walkInFormValues.guestPhone
    });
  };

  const handleWalkInDialogClose = (open: boolean) => {
    if (!open && walkInReservation && walkInStep === 'filling') {
      cancelReservationMutation.mutate({
        scheduleId: walkInReservation.scheduleId,
        reservationId: walkInReservation.id
      });
    }
    if (!open) resetWalkInDialog();
    setIsWalkInDialogOpen(open);
  };

  // Open the walk-in dialog — immediately reserve a token (2-step flow)
  const openWalkInDialog = (doctorId: number, doctorName: string, clinicId: number, scheduleId: number) => {
    const appointmentDate = new Date(selectedDate);
    setWalkInCurrentDoctor({ doctorId, doctorName, clinicId, scheduleId, date: appointmentDate });
    setWalkInFormValues({ doctorId, clinicId, scheduleId, guestName: "", guestPhone: "" });
    setIsWalkInDialogOpen(true);
    setWalkInStep('reserving');
    reserveTokenMutation.mutate(scheduleId);
  };

  // Handler for toggling schedule pause
  const handleToggleSchedulePause = (scheduleId: number, isPaused: boolean) => {
    const reason = isPaused ? prompt("Please enter reason for pausing the schedule:") : undefined;
    if (isPaused && !reason) return; // Don't pause if no reason provided
    
    setIsPaused(isPaused);
    toggleSchedulePauseMutation.mutate({ 
      scheduleId, 
      isPaused, 
      pauseReason: reason 
    }, {
      onSuccess: () => {
        // Find all appointments for this schedule and update their statuses
        if (managedDoctors) {
          managedDoctors.forEach(doctor => {
            doctor.schedules?.forEach(schedule => {
              if (schedule.id === scheduleId) {
                schedule.appointments?.forEach(appointment => {
                  if (isPaused && ["scheduled", "start"].includes(appointment.status || "")) {
                    // Update to pause if pausing
                    updateAppointmentMutation.mutate({
                      appointmentId: appointment.id,
                      status: "pause",
                      statusNotes: reason || "Schedule paused"
                    });
                  } else if (!isPaused && appointment.status === "pause") {
                    // Update back to scheduled if resuming
                    updateAppointmentMutation.mutate({
                      appointmentId: appointment.id,
                      status: "scheduled",
                      statusNotes: "Schedule resumed"
                    });
                  }
                });
              }
            });
          });
        }
      }
    });
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavHeader />
        <main className="container mx-auto px-4 py-8">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Please log in to access the dashboard.
            </AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavHeader />
        <main className="container mx-auto px-4 py-8">
          <Skeleton className="h-[400px]" />
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavHeader />
        <main className="container mx-auto px-4 py-8">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load appointments. Please try again later.
            </AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  if (!managedDoctors || managedDoctors.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavHeader />
        <main className="container mx-auto px-4 py-8">
          <Card>
            <CardContent className="p-6">
              <p className="text-center text-muted-foreground">
                No doctors assigned to manage. Please contact your administrator.
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavHeader />
      <TooltipProvider>
        <main className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-lg sm:text-2xl font-bold">Today's Doctor Appointments</h1>
            <NavigationButtons showBack={false} />
          </div>

          {/* <Card>
            <CardContent className="p-6">
              <h2 className="text-lg font-semibold mb-4">Select Date</h2>
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => setSelectedDate(date || new Date())}
                className="rounded-md border"
              />
            </CardContent>
          </Card> */}

          <Card>
              <CardContent className="p-6">
                {/* Doctor Selection Dropdown */}
                <div className="mb-4">
                  <Select
                    value={selectedDoctorId}
                    onValueChange={(value) => setSelectedDoctorId(value)}
                  >
                    <SelectTrigger className="w-full sm:w-[200px]">
                      <SelectValue placeholder="Select a doctor" />
                    </SelectTrigger>
                    <SelectContent>
                      {managedDoctors?.map((item) => (
                        <SelectItem 
                          key={item.doctor.id} 
                          value={item.doctor.id.toString()}
                        >
                          {item.doctor.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Show selected doctor's content */}
                {selectedDoctorId && managedDoctors?.map((doctorData) => {
                  // Only show the selected doctor
                  if (doctorData.doctor.id.toString() !== selectedDoctorId) {
                    return null;
                  }

                  // Filter schedules for the selected date by checking if schedule.date matches selectedDate
                  const schedulesForDay = doctorData.schedules?.filter(
                    schedule => isSameDay(new Date(schedule.date), selectedDate)
                  ) || [];
                  
                  // Filter appointments for the selected date
                  const appointmentsForDay = doctorData.appointments?.filter(
                    apt => isSameDay(new Date(apt.date), selectedDate)
                  ) || [];
                  
                  return (
                    <div key={doctorData.doctor.id}>
                      <div className="flex justify-between items-center mb-6">
                        <div>
                          <h2 className="text-xl font-semibold">{doctorData.doctor.name}</h2>
                          <p className="text-muted-foreground">{doctorData.doctor.specialty}</p>
                        </div>
                      </div>

                      {/* Ended-schedule resolution banner */}
                      {(() => {
                        const needsResolution = schedulesForDay.filter(
                          (s: any) => s.scheduleStatus !== 'completed' && isScheduleEnded(s) && getUnsettledCount(s) > 0
                        );
                        if (needsResolution.length === 0) return null;
                        return (
                          <Alert className="mb-4 border-amber-300 bg-amber-50">
                            <AlertCircle className="h-4 w-4 text-amber-600" />
                            <AlertDescription className="text-amber-800">
                              {needsResolution.length} ended schedule{needsResolution.length !== 1 ? 's' : ''} need
                              {needsResolution.length === 1 ? 's' : ''} resolution — settle the unsettled tokens (refund or close).
                              <div className="mt-2 flex flex-wrap gap-2">
                                {needsResolution.map((s: any) => (
                                  <Button
                                    key={s.id}
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setResolveTarget({ schedule: s, doctorName: doctorData.doctor.name })}
                                  >
                                    Resolve {s.startTime}–{s.endTime} ({getUnsettledCount(s)})
                                  </Button>
                                ))}
                              </div>
                            </AlertDescription>
                          </Alert>
                        );
                      })()}

                      {schedulesForDay.length === 0 ? (
                        <div className="bg-muted p-6 rounded-lg text-center">
                          <CalendarIcon className="mx-auto h-10 w-10 text-muted-foreground mb-2" />
                          <p className="text-muted-foreground">No schedules for this doctor on {format(selectedDate, "EEEE")}.</p>
                        </div>
                      ) : (
                        // Implement nested tabs for schedules
                        <Tabs defaultValue={schedulesForDay[0]?.id?.toString()} className="w-full">
                          <div className="overflow-x-auto py-4">
                            <TabsList className="flex space-x-4 p-1 min-w-max bg-transparent">
                              {schedulesForDay.map(schedule => {
                                // Get presence status for visual indication
                                const hasArrived = getPresenceData(doctorData.doctor.id, schedule.id).hasArrived;
                                
                                // Count appointments for this schedule that are not canceled
                                const activeAppointments = schedule.appointments
                                  .filter(apt => 
                                    isSameDay(new Date(apt.date), selectedDate) && 
                                    apt.status !== "cancel"
                                  ).length;
                                
                                return (
                                  <TabsTrigger 
                                    key={schedule.id} 
                                    value={schedule.id.toString()}
                                    className="min-w-[240px] flex-col items-start px-4 py-3 rounded-lg border data-[state=active]:border-blue-300 data-[state=active]:bg-blue-50 data-[state=active]:shadow-sm"
                                  >
                                    <div className="flex items-center w-full mb-2">
                                      <Clock className="h-5 w-5 text-blue-500 mr-2" />
                                      <span className="text-base font-medium">{schedule.startTime} - {schedule.endTime}</span>
                                    </div>
                                    <div className="flex items-center gap-3 w-full">
                                      {hasArrived ? (
                                        <div className="px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">Doctor Arrived</div>
                                      ) : (
                                        <div className="px-3 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">Awaiting Doctor</div>
                                      )}
                                      <div className="px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                        {activeAppointments} Patient{activeAppointments !== 1 ? 's' : ''}
                                      </div>
                                    </div>
                                  </TabsTrigger>
                                );
                              })}
                            </TabsList>
                          </div>

                          {schedulesForDay.map(schedule => {
                              const appointmentsForDay = schedule.appointments
                                .filter(apt => isSameDay(new Date(apt.date), selectedDate));

                              // Then filter appointments that belong to this schedule's time range
                              const scheduleAppointments = appointmentsForDay
                                .sort((a, b) => a.tokenNumber - b.tokenNumber);
                                
                              return (
                                <TabsContent 
                                  key={schedule.id} 
                                  value={schedule.id.toString()}
                                >
                                  <Card>
                                    <CardHeader className="pb-0">
                                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                                        <div>
                                          <CardTitle className="flex items-center gap-2">
                                            <Building className="h-5 w-5" />
                                            Clinic Hours: {schedule.startTime} - {schedule.endTime}
                                          </CardTitle>
                                          <p className="text-sm text-muted-foreground mt-1">
                                            Maximum Tokens: {schedule.maxTokens || "Unlimited"}
                                          </p>
                                          {schedule.isPaused && (
                                            <div className="mt-2 flex items-center gap-2">
                                              <Badge variant="destructive">Schedule Paused</Badge>
                                              {schedule.pauseReason && (
                                                <Tooltip>
                                                  <TooltipTrigger>
                                                    <InfoIcon className="h-4 w-4 text-muted-foreground" />
                                                  </TooltipTrigger>
                                                  <TooltipContent>
                                                    <p>{schedule.pauseReason}</p>
                                                  </TooltipContent>
                                                </Tooltip>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                        <div className="flex flex-wrap gap-2 items-center">
                                          <Button
                                            variant={getPresenceData(doctorData.doctor.id, schedule.id).hasArrived ? "default" : "outline"}
                                            className="gap-2"
                                            disabled={getPresenceData(doctorData.doctor.id, schedule.id).hasArrived || schedule.scheduleStatus === 'completed'}
                                            onClick={() => handleToggleDoctorArrival(
                                              doctorData.doctor.id,
                                              schedule.clinicId || doctorData.clinicId || user?.clinicId,
                                              schedule.id,
                                              !getPresenceData(doctorData.doctor.id, schedule.id).hasArrived
                                            )}
                                          >
                                            {getPresenceData(doctorData.doctor.id, schedule.id).hasArrived ? (
                                              <>
                                                <CheckCircle2 className="h-4 w-4" />
                                                Doctor Arrived
                                              </>
                                            ) : (
                                              <>
                                                <Clock className="h-4 w-4" />
                                                Mark as Arrived
                                              </>
                                            )}
                                          </Button>
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="gap-2"
                                            disabled={schedule.scheduleStatus === 'completed'}
                                            onClick={() => handleCompleteSchedule(schedule.id)}
                                          >
                                            Complete Schedule
                                          </Button>
                                          {schedule.scheduleStatus !== 'completed' && isScheduleEnded(schedule) && getUnsettledCount(schedule) > 0 && (
                                            <Button
                                              size="sm"
                                              className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"
                                              onClick={() => setResolveTarget({ schedule, doctorName: doctorData.doctor.name })}
                                            >
                                              Resolve {getUnsettledCount(schedule)} Token{getUnsettledCount(schedule) !== 1 ? 's' : ''}
                                            </Button>
                                          )}
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="gap-2"
                                            disabled={schedule.scheduleStatus === 'completed'}
                                            onClick={() => handleToggleBooking(schedule.id, schedule.bookingStatus)}
                                          >
                                            {schedule.bookingStatus === 'closed' ? 'Open Booking' : 'Close Booking'}
                                          </Button>
                                            <div className="flex gap-2">
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={schedule.scheduleStatus === 'completed'}
                                                onClick={() => handleToggleSchedulePause(schedule.id, !schedule.isPaused)}
                                              >
                                                {schedule.isPaused ? "Resume Schedule" : "Pause Schedule"}
                                              </Button>
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                className="hover:bg-red-500 hover:text-white"
                                                disabled={schedule.scheduleStatus === 'completed'}
                                                onClick={() => handleCancelSchedule(schedule.id)}
                                              >
                                                Cancel Schedule
                                              </Button>
                                            </div>
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              className="gap-2"
                                              disabled={schedule.scheduleStatus === 'completed'}
                                              onClick={() => openWalkInDialog(
                                                doctorData.doctor.id,
                                                doctorData.doctor.name,
                                                schedule.clinicId,
                                                schedule.id
                                              )}
                                            >
                                            <Plus className="h-4 w-4" />
                                            New Walk-in
                                            </Button>
                                        </div>
                                      </div>
                                    </CardHeader>
                                    <CardContent className="pt-4">
                                      {/* Mobile card view */}
                                      <div className="md:hidden space-y-3">
                                        {scheduleAppointments.length === 0 ? (
                                          <p className="text-center py-8 text-muted-foreground">
                                            No appointments scheduled for {format(selectedDate, "d MMM, yyyy")}
                                          </p>
                                        ) : (
                                          scheduleAppointments.map((appointment) => (
                                            <div
                                              key={appointment.id}
                                              className={`border rounded-lg p-3 ${appointment.status === "in_progress" ? "bg-blue-50 border-blue-200" : "bg-white"}`}
                                            >
                                              <div className="flex items-start justify-between mb-2">
                                                <div className="flex items-start gap-2 min-w-0">
                                                  <span className="text-sm font-bold text-blue-600 shrink-0">#{appointment.tokenNumber}</span>
                                                  <div className="min-w-0">
                                                    {appointment.isWalkIn ? (
                                                      <div>
                                                        <div className="font-medium text-sm truncate">{appointment.guestName}</div>
                                                        <Badge variant="outline" className="mt-0.5 text-xs">Walk-in</Badge>
                                                      </div>
                                                    ) : appointment.isOnBehalf ? (
                                                      <div>
                                                        <div className="font-medium text-sm truncate">{appointment.guestName}</div>
                                                        <Badge variant="secondary" className="mt-0.5 text-xs">On behalf</Badge>
                                                        {appointment.patient?.name && (
                                                          <div className="text-xs text-muted-foreground">by {appointment.patient.name}</div>
                                                        )}
                                                      </div>
                                                    ) : (
                                                      <div className="font-medium text-sm truncate">{appointment.patient?.name}</div>
                                                    )}
                                                  </div>
                                                </div>
                                                <div className="ml-2 shrink-0 flex items-center gap-1">
                                                  <Badge
                                                    className="text-xs"
                                                    variant={
                                                      appointment.status === "completed" ? "outline" :
                                                      appointment.status === "in_progress" ? "default" :
                                                      appointment.status === "hold" ? "secondary" :
                                                      ["pause", "cancel", "no_show", "expired"].includes(appointment.status) ? "destructive" :
                                                      "outline"
                                                    }
                                                  >
                                                    {appointment.status === "token_started" ? "Scheduled" :
                                                    appointment.status === "scheduled" ? "Scheduled" :
                                                    appointment.status === "in_progress" ? "In Progress" :
                                                    appointment.status === "hold" ? "On Hold" :
                                                    appointment.status === "pause" ? "Paused" :
                                                    appointment.status === "cancel" ? "Cancelled" :
                                                    appointment.status === "no_show" ? "No Show" :
                                                    appointment.status === "completed" ? "Completed" :
                                                    appointment.status === "expired" ? "Expired" :
                                                    "Unknown"}
                                                  </Badge>
                                                  {appointment.statusNotes && (
                                                    <Tooltip>
                                                      <TooltipTrigger asChild>
                                                        <InfoIcon className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                                                      </TooltipTrigger>
                                                      <TooltipContent>
                                                        <p>{appointment.statusNotes}</p>
                                                      </TooltipContent>
                                                    </Tooltip>
                                                  )}
                                                </div>
                                              </div>
                                              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mb-2">
                                                {appointment.actualStartTime && (
                                                  <span>In: {format(new Date(appointment.actualStartTime), "hh:mm a")}</span>
                                                )}
                                                {appointment.actualEndTime && (
                                                  <span>Out: {format(new Date(appointment.actualEndTime), "hh:mm a")}</span>
                                                )}
                                                {appointment.status === "in_progress" ? (
                                                  <span className="text-blue-600 font-medium">In consultation</span>
                                                ) : !["expired", "completed", "cancel", "no_show"].includes(appointment.status) && (
                                                  <ETADisplay
                                                    appointmentId={appointment.id}
                                                    tokenNumber={appointment.tokenNumber}
                                                    className="text-xs"
                                                  />
                                                )}
                                              </div>
                                              <div className="pt-2 border-t">
                                                <AppointmentActions
                                                  appointment={appointment}
                                                  doctorHasArrived={getPresenceData(doctorData.doctor.id, schedule.id).hasArrived}
                                                  onMarkAsStarted={() => handleMarkInProgress(appointment.id)}
                                                  onMarkAsCompleted={() => handleMarkAsCompleted(appointment.id)}
                                                  onHold={() => handleHoldAppointment(appointment.id)}
                                                  onNoShow={() => handleNoShowAppointment(appointment.id)}
                                                />
                                              </div>
                                            </div>
                                          ))
                                        )}
                                      </div>

                                      {/* Desktop table view */}
                                      <div className="hidden md:block overflow-x-auto">
                                        <table className="w-full">
                                          <thead>
                                            <tr className="border-b">
                                              <th className="text-left py-4 px-4">Token #</th>
                                              <th className="text-left py-4 px-4">Patient</th>
                                              <th className="text-left py-4 px-4">In Time</th>
                                              <th className="text-left py-4 px-4">Out Time</th>
                                              <th className="text-left py-4 px-4">ETA</th>
                                              <th className="text-left py-4 px-4">Status</th>
                                              <th className="text-left py-4 px-4">Actions</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {scheduleAppointments.length === 0 ? (
                                              <tr>
                                                <td colSpan={7} className="text-center py-8 text-muted-foreground">
                                                  No appointments scheduled for {format(selectedDate, "PPP")}
                                                </td>
                                              </tr>
                                            ) : (
                                              scheduleAppointments.map((appointment) => (
                                                <tr
                                                  key={appointment.id}
                                                  className={`border-b ${appointment.status === "in_progress" ? "bg-blue-50" : ""}`}
                                                >
                                                  <td className="py-4 px-4">{appointment.tokenNumber}</td>
                                                  <td className="py-4 px-4">
                                                    {appointment.isWalkIn ? (
                                                      <div>
                                                        <div className="font-medium">{appointment.guestName}</div>
                                                        <Badge variant="outline" className="mt-1">Walk-in</Badge>
                                                      </div>
                                                    ) : appointment.isOnBehalf ? (
                                                      <div>
                                                        <div className="font-medium">{appointment.guestName}</div>
                                                        <Badge variant="secondary" className="mt-1">On behalf</Badge>
                                                        {appointment.patient?.name && (
                                                          <div className="text-xs text-muted-foreground mt-1">by {appointment.patient.name}</div>
                                                        )}
                                                      </div>
                                                    ) : (
                                                      <div className="font-medium">{appointment.patient?.name}</div>
                                                    )}
                                                  </td>
                                                  <td className="py-4 px-4">
                                                    {appointment.actualStartTime ?
                                                      format(new Date(appointment.actualStartTime), "hh:mm a") :
                                                      "-"
                                                    }
                                                  </td>
                                                  <td className="py-4 px-4">
                                                    {appointment.actualEndTime ?
                                                      format(new Date(appointment.actualEndTime), "hh:mm a") :
                                                      "-"
                                                    }
                                                  </td>
                                                  <td className="py-4 px-4">
                                                    {["expired", "completed", "cancel", "no_show"].includes(appointment.status) ? (
                                                      <span className="text-xs text-muted-foreground">—</span>
                                                    ) : appointment.status === "in_progress" ? (
                                                      <span className="text-xs text-blue-600 font-medium">In consultation</span>
                                                    ) : (
                                                      <ETADisplay
                                                        appointmentId={appointment.id}
                                                        tokenNumber={appointment.tokenNumber}
                                                        className="text-xs"
                                                      />
                                                    )}
                                                  </td>
                                                  <td className="py-4 px-4">
                                                    <Badge
                                                      variant={
                                                        appointment.status === "completed" ? "outline" :
                                                        appointment.status === "in_progress" ? "default" :
                                                        appointment.status === "hold" ? "secondary" :
                                                        appointment.status === "pause" ? "destructive" :
                                                        appointment.status === "cancel" ? "destructive" :
                                                        appointment.status === "no_show" ? "destructive" :
                                                        appointment.status === "expired" ? "destructive" :
                                                        appointment.status === "token_started" ? "outline" :
                                                        "outline"
                                                      }
                                                    >
                                                      {appointment.status === "token_started" ? "Scheduled" :
                                                      appointment.status === "scheduled" ? "Scheduled" :
                                                      appointment.status === "in_progress" ? "In Progress" :
                                                      appointment.status === "hold" ? "On Hold" :
                                                      appointment.status === "pause" ? "Paused" :
                                                      appointment.status === "cancel" ? "Cancelled" :
                                                      appointment.status === "no_show" ? "No Show" :
                                                      appointment.status === "completed" ? "Completed" :
                                                      appointment.status === "expired" ? "Expired" :
                                                      "Unknown"}
                                                    </Badge>
                                                    {appointment.statusNotes && (
                                                      <Tooltip>
                                                        <TooltipTrigger asChild>
                                                          <InfoIcon className="inline-block ml-2 h-4 w-4 text-muted-foreground cursor-help" />
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                          <p>{appointment.statusNotes}</p>
                                                        </TooltipContent>
                                                      </Tooltip>
                                                    )}
                                                  </td>
                                                  <td className="py-4 px-4">
                                                    <AppointmentActions
                                                      appointment={appointment}
                                                      doctorHasArrived={getPresenceData(doctorData.doctor.id, schedule.id).hasArrived}
                                                      onMarkAsStarted={() => handleMarkInProgress(appointment.id)}
                                                      onMarkAsCompleted={() => handleMarkAsCompleted(appointment.id)}
                                                      onHold={() => handleHoldAppointment(appointment.id)}
                                                      onNoShow={() => handleNoShowAppointment(appointment.id)}
                                                    />
                                                  </td>
                                                </tr>
                                              ))
                                            )}
                                          </tbody>
                                        </table>
                                      </div>
                                    </CardContent>
                                  </Card>
                                </TabsContent>
                              );
                            })}
                          </Tabs>
                        )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
        </main>
      </TooltipProvider>
      <Dialog open={isWalkInDialogOpen} onOpenChange={handleWalkInDialogClose}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Create Walk-in Token</DialogTitle>
            <DialogDescription>
              {walkInCurrentDoctor && (
                <span>Creating Token for Dr. {walkInCurrentDoctor.doctorName} on {format(selectedDate, "PPP")}</span>
              )}
            </DialogDescription>
          </DialogHeader>

          {/* Step: Reserving (loading state) */}
          {walkInStep === 'reserving' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              <p className="text-muted-foreground">Reserving your token...</p>
            </div>
          )}

          {/* Step: Filling details */}
          {walkInStep === 'filling' && walkInReservation && (
            <div className="space-y-4">
              {/* Reserved token badge */}
              <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-200">
                <div>
                  <p className="text-sm text-blue-600 font-medium">Token Reserved</p>
                  <p className="text-2xl font-bold text-blue-700">#{walkInReservation.tokenNumber}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Expires in</p>
                  <p className={`text-lg font-bold ${reservationSecondsLeft < 60 ? 'text-red-500' : 'text-orange-500'}`}>
                    {Math.floor(reservationSecondsLeft / 60)}:{String(reservationSecondsLeft % 60).padStart(2, '0')}
                  </p>
                </div>
              </div>

              {/* Guest details form */}
              <div className="space-y-3">
                <div>
                  <Label>Patient Name *</Label>
                  <Input
                    placeholder="Enter patient name"
                    value={walkInFormValues.guestName}
                    onChange={e => setWalkInFormValues(v => ({ ...v, guestName: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Phone Number (optional)</Label>
                  <div className="flex">
                    <span className="flex items-center px-3 border border-r-0 rounded-l-md bg-muted text-sm text-muted-foreground select-none">+91</span>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="Enter 10-digit number"
                      className="rounded-l-none"
                      maxLength={10}
                      value={walkInFormValues.guestPhone}
                      onChange={e => setWalkInFormValues(v => ({ ...v, guestPhone: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                    />
                  </div>
                </div>
              </div>

              <Button
                className="w-full"
                disabled={!walkInFormValues.guestName.trim() || confirmWalkInMutation.isPending}
                onClick={() => {
                  if (!walkInReservation || !walkInCurrentDoctor) return;
                  confirmWalkInMutation.mutate({
                    scheduleId: walkInReservation.scheduleId,
                    reservationId: walkInReservation.id,
                    guestName: walkInFormValues.guestName,
                    guestPhone: walkInFormValues.guestPhone
                  });
                }}
              >
                {confirmWalkInMutation.isPending ? "Confirming..." : "Confirm Walk-in"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Resolve ended-schedule tokens */}
      {resolveTarget && (
        <ResolveScheduleDialog
          open={!!resolveTarget}
          onOpenChange={(o) => { if (!o) setResolveTarget(null); }}
          doctorName={resolveTarget.doctorName}
          scheduleLabel={`${resolveTarget.schedule.startTime} - ${resolveTarget.schedule.endTime}`}
          appointments={resolveTarget.schedule.appointments || []}
          isSubmitting={resolveTokensMutation.isPending}
          onConfirm={(resolutions) =>
            resolveTokensMutation.mutate({ scheduleId: resolveTarget.schedule.id, resolutions })
          }
        />
      )}
    </div>
  );
}