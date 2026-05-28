import { useQuery, useMutation } from "@tanstack/react-query";
import { Appointment, User } from "@shared/schema";
import { NavHeader } from "@/components/nav-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { Progress } from "@/components/ui/progress";
import { Clock, Ticket, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { AppointmentStatusBadge } from "@/components/appointment-status-badge";
import { ETADisplay } from "@/components/eta-display";
import { NavigationButtons } from "@/components/navigation-buttons";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import React, { useEffect, useState, useRef, useCallback } from "react";


type AppointmentWithDoctor = Appointment & {
  doctor: User;
};

type TokenProgress = {
  currentToken: number;
  status: 'start' | 'completed' | 'scheduled' | 'hold' | 'pause' | 'cancel' | 'not_started' | 'no_appointments';
  appointment?: Appointment;
  walkInPatients?: number;
};

// Helper function to calculate tokens ahead of a patient
const calculateTokensAhead = (
  appointment: AppointmentWithDoctor,
  progress: TokenProgress | undefined,
  allAppointments: AppointmentWithDoctor[]
) => {
  if (!progress?.currentToken) return null;
  
  // Filter out appointments that should be counted
  const validAppointments = allAppointments.filter(apt => {
    // Only count appointments with active statuses
    return apt.status !== "cancel" && 
           apt.status !== "pause" && 
           apt.status !== "hold" &&
           // Only count appointments between current token and patient token
           apt.tokenNumber > progress.currentToken && 
           apt.tokenNumber < appointment.tokenNumber;
  });
  
  // Count of regular appointments between current token and patient token
  const appointmentsAhead = validAppointments.length;
  
  // Add walk-in patients count
  const walkInCount = progress.walkInPatients || 0;
  
  return appointmentsAhead + walkInCount;
};

export default function BookingHistoryPage() {
  // State to store doctor arrival status
  const { toast } = useToast();
  const [doctorArrivals, setDoctorArrivals] = useState<Record<string, boolean>>({});
  const [cancelReason, setCancelReason] = useState('');
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  // Ref to track if we've already fetched arrivals
  const arrivedFetchedRef = useRef(false);
  // Ref to store interval ID
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const cancelMutation = useMutation({
    mutationFn: async ({ appointmentId, reason }: { appointmentId: number; reason: string }) => {
      const res = await apiRequest('PATCH', `/api/appointments/${appointmentId}/cancel-patient`, { reason });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/patient/appointments'] });
      setCancelReason('');
      setCancellingId(null);
      toast({
        title: 'Appointment Cancelled',
        description: data.refunded
          ? `Your appointment has been cancelled and ₹${data.refundAmount} has been refunded to your wallet.`
          : 'Your appointment has been cancelled.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Cancellation Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const { data: appointments, isLoading } = useQuery<AppointmentWithDoctor[]>({
    queryKey: ["/api/patient/appointments"],
    // Refresh every 30 seconds to keep token status current
    refetchInterval: 30000
  });

  const todayAppointments = appointments?.filter(
    apt => format(new Date(apt.date), "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd")
      && apt.status !== "cancel"
      && apt.status !== "no_show"
  ) || [];

  // Group today's appointments by doctor and clinic
  const doctorClinicPairs = todayAppointments.map(apt => ({
    doctorId: apt.doctorId,
    clinicId: apt.clinicId
  }));

  // Create a unique key for each doctor-clinic pair
  const uniquePairs = Array.from(new Set(doctorClinicPairs.map(p => `${p.doctorId}-${p.clinicId}`)))
    .map(key => {
      const [doctorId, clinicId] = key.split('-').map(Number);
      return { doctorId, clinicId };
    });

  // Create a stable string representation of today's scheduled appointments to use in dependency array
  const scheduledAppointmentsKey = todayAppointments
    .filter(apt => apt.status === "token_started")
    .map(apt => `${apt.doctorId}-${apt.clinicId}`)
    .sort()
    .join('|');

  // Fetch doctor arrival status - memoize this function to avoid recreating it on every render
  const fetchDoctorArrivals = useCallback(async () => {
    // Skip if no active appointments
    const scheduledAppts = todayAppointments.filter(
      apt => !["cancel", "completed", "no_show"].includes(apt.status)
    );
    if (scheduledAppts.length === 0) return;
    
    const arrivalsMap: Record<string, boolean> = {};
    
    // Create a Set to track unique doctor-clinic pairs to avoid duplicate requests
    const processed = new Set<string>();
    
    for (const appointment of scheduledAppts) {
      const key = `${appointment.doctorId}-${appointment.clinicId}`;
      
      // Skip if we've already processed this doctor-clinic pair
      if (processed.has(key)) continue;
      processed.add(key);
      
      try {
        const res = await fetch(
          `/api/doctors/${appointment.doctorId}/arrival?clinicId=${appointment.clinicId}&date=${new Date().toISOString()}`
        );
        const data = await res.json();
        arrivalsMap[key] = data.hasArrived;
      } catch (error) {
        console.error("Error fetching doctor arrival:", error);
      }
    }
    
    setDoctorArrivals(arrivalsMap);
  }, [todayAppointments]);

  // Setup the initial fetch and interval
  useEffect(() => {
    // Only run this effect if we have active appointments (any non-terminal status) and haven't fetched yet
    const hasScheduledAppointments = todayAppointments.some(
      apt => !["cancel", "completed", "no_show"].includes(apt.status)
    );
    
    if (hasScheduledAppointments) {
      // Run the initial fetch if we haven't already
      if (!arrivedFetchedRef.current) {
        fetchDoctorArrivals();
        arrivedFetchedRef.current = true;
      }
      
      // Clear any existing interval before setting a new one
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      
      // Set up interval for periodic refresh (every 30 seconds)
      intervalRef.current = setInterval(fetchDoctorArrivals, 30000);
      
      // Clean up interval on unmount or when dependencies change
      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    }
  }, [fetchDoctorArrivals, scheduledAppointmentsKey]);

  // Helper function to check if a doctor has arrived
  const hasDoctorArrived = (doctorId: number, clinicId: number) => {
    return doctorArrivals[`${doctorId}-${clinicId}`] || false;
  };

  const { data: tokenProgressMap } = useQuery<Record<string, TokenProgress>>({
    queryKey: ["token-progress", uniquePairs],
    queryFn: async () => {
      const progressPromises = uniquePairs.map(async ({ doctorId, clinicId }) => {
        const res = await fetch(`/api/doctors/${doctorId}/token-progress?clinicId=${clinicId}`);
        if (!res.ok) throw new Error('Failed to fetch token progress');
        const progress = await res.json();
        return { key: `${doctorId}-${clinicId}`, progress };
      });

      const progressResults = await Promise.all(progressPromises);
      return Object.fromEntries(progressResults.map(({ key, progress }) => [key, progress]));
    },
    enabled: uniquePairs.length > 0,
    // Refresh every 30 seconds to keep token status current
    refetchInterval: 30000
  });

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

  return (
    <div className="min-h-screen bg-gray-50">
      <NavHeader />
      <main className="container mx-auto px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h1 className="text-xl sm:text-2xl font-bold">My Appointments</h1>
          <NavigationButtons />
        </div>
        <Card>
          <CardContent className="p-6">
            {!appointments?.length ? (
              <p className="text-center text-muted-foreground py-8">
                No appointments found
              </p>
            ) : (
              <div className="space-y-6">
                {todayAppointments.length > 0 && (
                  <div className="mb-8">
                    <h2 className="text-xl font-semibold mb-4">Today's Appointments</h2>
                    <div className="space-y-4">
                      {todayAppointments
                        // Sort appointments by status priority
                        .sort((a, b) => {
                          // Define status priority (higher number = higher priority)
                          const getStatusPriority = (status: string): number => {
                            switch (status) {
                              case "in_progress": return 5; // Currently in consultation (highest priority)
                              case "token_started": return 4; // Waiting (next in line)
                              case "hold": return 3;      // On hold (temporarily waiting)
                              case "pause": return 2;     // Paused (longer wait)
                              case "completed": return 1; // Completed (low priority)
                              case "cancel": return 0;    // Canceled (lowest priority)
                              default: return 0;
                            }
                          };
                          
                          // Compare based on status priority
                          const priorityDiff = getStatusPriority(b.status) - getStatusPriority(a.status);
                          
                          // If same status, sort by token number (lower number first)
                          if (priorityDiff === 0) {
                            return a.tokenNumber - b.tokenNumber;
                          }
                          
                          return priorityDiff;
                        })
                        .map((appointment) => {
                        const progress = tokenProgressMap?.[`${appointment.doctorId}-${appointment.clinicId}`];

                        // Get all appointments for this doctor at this clinic today
                        const doctorClinicAppointments = todayAppointments.filter(
                          apt => apt.doctorId === appointment.doctorId && apt.clinicId === appointment.clinicId
                        );

                        const maxTokenNumber = Math.max(
                          ...doctorClinicAppointments.map(apt => apt.tokenNumber)
                        );

                        // Use our helper function to calculate tokens ahead
                        const tokensAhead = calculateTokensAhead(
                          appointment, 
                          progress, 
                          doctorClinicAppointments
                        );

                        // Check if doctor has arrived using the helper function
                        const doctorHasArrived = hasDoctorArrived(appointment.doctorId, appointment.clinicId);

                        return (
                          <Card key={appointment.id} className="overflow-hidden">
                            <CardContent className="p-4">
                              {appointment.status === "in_progress" && (
                                <div className="bg-blue-100 -mx-4 -mt-4 px-4 py-2 mb-3">
                                  <p className="text-blue-700 font-medium text-sm text-center">
                                    Currently in consultation
                                  </p>
                                </div>
                              )}
                              <div className="flex items-center justify-between mb-4">
                                <div>
                                  <h3 className="font-medium">{appointment.doctor.name}</h3>
                                  <p className="text-sm text-muted-foreground">
                                    {appointment.doctor.specialty}
                                  </p>
                                  {appointment.isOnBehalf && appointment.guestName && (
                                    <p className="text-sm text-blue-600 font-medium mt-1">
                                      Patient: {appointment.guestName}
                                    </p>
                                  )}
                                </div>
                                <AppointmentStatusBadge status={appointment.status} />
                              </div>
                              
                              <div className="space-y-4">
                                <div className="flex items-center justify-between text-sm">
                                  <div className="flex items-center gap-2">
                                    <Clock className="h-4 w-4 text-muted-foreground" />
                                    <span>{format(new Date(appointment.date), "MMM d, yyyy")}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Ticket className="h-4 w-4 text-muted-foreground" />
                                    <span>Token #{appointment.tokenNumber}</span>
                                  </div>
                                </div>
                                
                                {/* ETA Display for waiting and in-progress tokens */}
                                {(appointment.status === "token_started" || appointment.status === "in_progress") && (
                                  <ETADisplay
                                    appointmentId={appointment.id}
                                    tokenNumber={appointment.tokenNumber}
                                    showDetails={true}
                                  />
                                )}
                                
                                {appointment.status === "cancel" ? (
                                  <div className="text-sm text-center text-red-600 font-medium mt-1">
                                    Appointment cancelled
                                  </div>
                                ) : appointment.status === "no_show" ? (
                                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 mt-3 text-center">
                                    <span className="text-red-700 font-semibold block mb-2">❌ Appointment Missed</span>
                                    <span className="text-red-600 text-sm block mb-2">
                                      You didn't arrive at the clinic on time for your appointment.
                                    </span>
                                    <span className="text-red-600 text-sm font-medium">
                                      Please book a new appointment to schedule your consultation.
                                    </span>
                                  </div>
                                ) : appointment.status === "cancel" ? (
                                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mt-3 text-center">
                                    <span className="text-orange-700 font-semibold block mb-2">🚫 Appointment Cancelled</span>
                                    <span className="text-orange-600 text-sm block mb-2">
                                      This appointment was cancelled by the clinic.
                                    </span>
                                    <span className="text-orange-600 text-sm font-medium">
                                      Please contact the clinic or book a new appointment.
                                    </span>
                                  </div>
                                ) : appointment.status === "completed" ? (
                                  <div>
                                    <div className="flex justify-between text-sm mb-1">
                                      <span className="text-muted-foreground">Current token: -</span>
                                      <span className="text-muted-foreground">Your token: {appointment.tokenNumber}</span>
                                    </div>
                                    <Progress value={100} className="h-2" />
                                    <div className="text-sm text-center mt-1">
                                      <span className="text-gray-600 font-medium">Consultation completed</span>
                                    </div>
                                  </div>
                                ) : progress?.currentToken !== undefined && (
                                  <div>
                                    <div className="flex justify-between text-sm mb-1">
                                      <span className="text-muted-foreground text-right w-full">Your token: {appointment.tokenNumber}</span>
                                    </div>
                                    <Progress value={(progress.currentToken / maxTokenNumber) * 100} className="h-2" />
                                    <div className="text-sm text-center mt-1">
                                      {appointment.status === "in_progress" ? (
                                        <span className="text-blue-600 font-medium">Currently being consulted</span>
                                      ) : appointment.status === "hold" ? (
                                        <span className="text-yellow-600 font-medium">Appointment on hold</span>
                                      ) : appointment.status === "pause" ? (
                                        <span className="text-orange-600 font-medium">Appointment paused</span>
                                      ) : appointment.tokenNumber === progress.currentToken + 1 ? (
                                        <span className="text-green-600 font-medium">You're next!</span>
                                      ) : tokensAhead && tokensAhead > 0 ? (
                                        <span>
                                          {tokensAhead} token{tokensAhead > 1 ? 's' : ''} ahead of you
                                          {progress?.walkInPatients && progress.walkInPatients > 0 ? 
                                            ` (includes ${progress.walkInPatients} walk-in patient${progress.walkInPatients > 1 ? 's' : ''})` : 
                                            ''}
                                        </span>
                                      ) : (
                                        <span className="text-muted-foreground">Waiting for your appointment</span>
                                      )}
                                    </div>
                                  </div>
                                )}
                                
                                {doctorHasArrived && appointment.status !== "completed" && (
                                  <div className="text-sm text-center text-green-600 font-medium mt-2 flex items-center justify-center gap-2">
                                    <CheckCircle2 className="h-4 w-4" />
                                    Your doctor has arrived at the clinic
                                  </div>
                                )}

                                {/* Doctor arrived — cancellation blocked */}
                                {appointment.status === "token_started" && doctorHasArrived && (
                                  <div className="mt-3 pt-3 border-t text-sm text-center text-muted-foreground">
                                    Cancellation unavailable — doctor has arrived
                                  </div>
                                )}

                                {/* Patient self-cancellation — only before doctor arrives */}
                                {appointment.status === "token_started" && !doctorHasArrived && (
                                  <div className="mt-3 pt-3 border-t">
                                    <Dialog open={cancellingId === appointment.id} onOpenChange={(open) => {
                                      if (!open) { setCancellingId(null); setCancelReason(''); }
                                    }}>
                                      <DialogTrigger asChild>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="w-full border-red-300 text-red-600 hover:bg-red-50"
                                          onClick={() => setCancellingId(appointment.id)}
                                        >
                                          <XCircle className="h-4 w-4 mr-2" />
                                          Cancel Appointment
                                        </Button>
                                      </DialogTrigger>
                                      <DialogContent>
                                        <DialogHeader>
                                          <DialogTitle>Cancel Appointment</DialogTitle>
                                          <DialogDescription>
                                            Cancel your appointment with {appointment.doctor.name} (Token #{appointment.tokenNumber})
                                          </DialogDescription>
                                        </DialogHeader>
                                        <div className="space-y-4">
                                          <div>
                                            <Label htmlFor="cancelReason">Reason for cancellation *</Label>
                                            <Textarea
                                              id="cancelReason"
                                              value={cancelReason}
                                              onChange={(e) => setCancelReason(e.target.value)}
                                              placeholder="e.g., Unable to attend, feeling better, etc."
                                              className="mt-1"
                                            />
                                          </div>
                                          {appointment.isPaid && appointment.isRefundEligible && (
                                            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
                                              ₹{parseFloat(appointment.consultationFee || '21').toFixed(0)} will be refunded to your wallet.
                                            </div>
                                          )}
                                        </div>
                                        <DialogFooter>
                                          <Button
                                            onClick={() => cancelMutation.mutate({ appointmentId: appointment.id, reason: cancelReason })}
                                            disabled={cancelMutation.isPending || !cancelReason.trim()}
                                            className="bg-red-600 hover:bg-red-700"
                                          >
                                            {cancelMutation.isPending && <RefreshCw className="h-4 w-4 mr-2 animate-spin" />}
                                            Confirm Cancellation
                                          </Button>
                                        </DialogFooter>
                                      </DialogContent>
                                    </Dialog>
                                  </div>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="mt-8">
                  <h2 className="text-xl font-semibold mb-4">Past Appointments</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-3 px-2 sm:py-4 sm:px-4">Token #</th>
                          <th className="text-left py-3 px-2 sm:py-4 sm:px-4">Doctor</th>
                          <th className="text-left py-3 px-2 sm:py-4 sm:px-4">Date & Time</th>
                          <th className="text-left py-3 px-2 sm:py-4 sm:px-4">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {appointments?.filter(apt =>
                          format(new Date(apt.date), "yyyy-MM-dd") !== format(new Date(), "yyyy-MM-dd")
                          || apt.status === "cancel"
                          || apt.status === "no_show"
                        ).map((appointment) => (
                          <tr key={appointment.id} className="border-b">
                            <td className="py-3 px-2 sm:py-4 sm:px-4">
                              {String(appointment.tokenNumber).padStart(3, '0')}
                            </td>
                            <td className="py-3 px-2 sm:py-4 sm:px-4">
                              <div>
                                <div className="font-medium text-sm sm:text-base">{appointment.doctor.name}</div>
                                <div className="text-xs sm:text-sm text-muted-foreground">
                                  {appointment.doctor.specialty}
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-2 sm:py-4 sm:px-4 text-sm whitespace-nowrap">
                              <span className="hidden sm:inline">{format(new Date(appointment.date), "PPP p")}</span>
                              <span className="sm:hidden">{format(new Date(appointment.date), "d MMM yy, h:mm a")}</span>
                            </td>
                            <td className="py-3 px-2 sm:py-4 sm:px-4">
                              <AppointmentStatusBadge
                                status={appointment.status}
                                statusNotes={appointment.statusNotes}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}