import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { User } from "@shared/schema";
import { NavHeader } from "@/components/nav-header";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { invalidateWalletQueries } from "@/utils/wallet-utils";
import { Loader2 } from "lucide-react";
import React from "react";

const timeSlots = [
  "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
  "14:00", "14:30", "15:00", "15:30", "16:00", "16:30"
];

export default function BookingPage() {
  const { doctorId } = useParams();
  const [_, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [selectedTime, setSelectedTime] = useState<string>();

  // Get scheduleId and clinicId from URL query parameters
  const urlParams = new URLSearchParams(window.location.search);
  const scheduleId = urlParams.get('scheduleId');
  const clinicId = urlParams.get('clinicId');

  const { data: doctor, isLoading } = useQuery<User>({
    queryKey: [`/api/doctors/${doctorId}`],
  });

  // Fetch user's existing appointments with the selected doctor
  const { data: existingAppointments = [] } = useQuery({
    queryKey: ["user-appointments", doctorId],
    queryFn: async () => {
      if (!doctorId || !user) return [];
      const response = await fetch(`/api/patient/appointments?doctorId=${doctorId}`);
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!doctorId && !!user,
  });

  // Check if user already has an appointment for this specific schedule
  const hasExistingAppointment = () => {
    if (!scheduleId) {
      // Fallback to doctor-level check if no scheduleId
      return existingAppointments.some((appointment: any) => 
        appointment.doctorId === Number(doctorId) && 
        appointment.status !== 'cancelled'
      );
    }
    
    return existingAppointments.some((appointment: any) => 
      appointment.scheduleId === Number(scheduleId) && 
      appointment.status !== 'cancelled'
    );
  };

  const bookingMutation = useMutation({
    mutationFn: async () => {
      // Check for duplicate booking first
      if (hasExistingAppointment()) {
        throw new Error("You already have an appointment booked with this doctor. Please check your existing appointments.");
      }

      if (!selectedDate || !selectedTime || !doctorId || !user) {
        throw new Error("Please select a date and time");
      }

      // Create a new date object for the selected date and time
      const [hours, minutes] = selectedTime.split(":");
      const appointmentDate = new Date(selectedDate);
      appointmentDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);

      const res = await apiRequest("POST", "/api/appointments", {
        doctorId: Number(doctorId),
        date: appointmentDate.toISOString(),
        status: "token_started",
        ...(scheduleId && { scheduleId: Number(scheduleId) }),
        ...(clinicId && { clinicId: Number(clinicId) })
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      // Invalidate user appointments to refresh duplicate checks
      queryClient.invalidateQueries({ queryKey: ["user-appointments", doctorId] });
      // Invalidate schedules to update appointment counts
      queryClient.invalidateQueries({ queryKey: ["schedulesToday"] });
      // Invalidate wallet queries to refresh wallet balance
      invalidateWalletQueries(queryClient);
      toast({
        title: "Appointment Booked Successfully! ✅",
        description: "Your appointment has been confirmed. You cannot book another appointment with the same doctor.",
      });
      navigate("/");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavHeader />
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (!doctor) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavHeader />
        <div className="container mx-auto px-4 py-8">
          <Card>
            <CardContent className="p-6">
              <h1 className="text-2xl font-bold text-red-600">Doctor Not Found</h1>
              <p className="mt-2 text-gray-600">The requested doctor could not be found.</p>
              <Button className="mt-4" onClick={() => navigate("/")}>
                Return to Home
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavHeader />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-3xl mx-auto">
          <Card>
            <CardContent className="p-6">
              <h1 className="text-2xl font-bold mb-6">
                Book Appointment with {doctor.name}
              </h1>

              <div className="grid md:grid-cols-2 gap-8">
                <div>
                  <h2 className="text-lg font-semibold mb-4">Select Date</h2>
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={setSelectedDate}
                    disabled={(date) => 
                      date < new Date() || 
                      date.getDay() === 0 || 
                      date.getDay() === 6
                    }
                    className="rounded-md border"
                  />
                </div>

                <div>
                  <h2 className="text-lg font-semibold mb-4">Select Time</h2>
                  <div className="grid grid-cols-3 gap-2">
                    {timeSlots.map((time) => (
                      <Button
                        key={time}
                        variant={selectedTime === time ? "default" : "outline"}
                        onClick={() => setSelectedTime(time)}
                        className="w-full"
                      >
                        {time}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-8 flex justify-end gap-4">
                <Button
                  variant="outline"
                  onClick={() => navigate(`/doctors/${doctorId}`)}
                >
                  Cancel
                </Button>
                {hasExistingAppointment() ? (
                  <div className="flex flex-col items-end">
                    <p className="text-amber-600 font-medium mb-2 text-sm">
                      ⚠️ You already have an appointment with this doctor
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => navigate("/appointments")}
                    >
                      View My Appointments
                    </Button>
                  </div>
                ) : (
                  <Button
                    onClick={() => bookingMutation.mutate()}
                    disabled={!selectedDate || !selectedTime || bookingMutation.isPending}
                  >
                    {bookingMutation.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Confirm Booking
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}