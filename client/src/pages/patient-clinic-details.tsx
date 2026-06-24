import { useState, useEffect, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { CalendarDays, Search, Clock, Calendar, Loader2, Star, StarOff, Navigation, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { invalidateWalletQueries } from "@/utils/wallet-utils";
import { NavigationButtons } from "@/components/navigation-buttons";
import { NavHeader } from "@/components/nav-header";
import axios from "axios";
import React from "react";

export default function PatientClinicDetails() {
  // Get clinic ID from URL
  const [, params] = useRoute("/patient/clinics/:id");
  const clinicId = params?.id;
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  
  // Get doctorId from URL query parameters
  const urlParams = new URLSearchParams(location.split('?')[1]);
  const doctorIdFromUrl = urlParams.get('doctorId');

  // Fetch clinic data from API
  const { data: clinic, isLoading: isClinicLoading, error: clinicError } = useQuery({
    queryKey: ["clinic", clinicId],
    queryFn: async () => {
      const response = await fetch(`/api/clinics/${clinicId}`);
      return response.json();
    },
    enabled: !!clinicId
  });

  // Fetch doctors data from API
  const { data: doctors = [], isLoading: isDoctorsLoading, error: doctorsError } = useQuery({
    queryKey: ["doctors", clinicId],
    queryFn: async () => {
      const response = await fetch(`/api/clinics/${clinicId}/doctors`);
      return response.json();
    },
    enabled: !!clinicId
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDoctor, setSelectedDoctor] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ day: string, time: string } | null>(null);
  const [showBookingDialog, setShowBookingDialog] = useState(false);
  const [pendingBookingData, setPendingBookingData] = useState<any>(null);
  const [isOnBehalf, setIsOnBehalf] = useState(false);
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [beneficiaryPhone, setBeneficiaryPhone] = useState("");
  
  // Auto-select doctor from URL parameter when doctors data loads
  useEffect(() => {
    if (doctorIdFromUrl && doctors.length > 0 && !selectedDoctor) {
      const doctorExists = doctors.some((doc: any) => doc.id === doctorIdFromUrl);
      if (doctorExists) {
        setSelectedDoctor(doctorIdFromUrl);
      }
    }
  }, [doctorIdFromUrl, doctors, selectedDoctor]);
  
  // Track schedule status for notifications
  const previousScheduleData = useRef<any[]>([]);
  
  // Fetch schedules for selected doctor
  const { data: scheduleData = [], isLoading: isSchedulesLoading } = useQuery({
    queryKey: ["schedules", selectedDoctor],
    queryFn: async () => {
      if (!selectedDoctor) return [];
      const response = await fetch(`/api/doctors/${selectedDoctor}/schedules`);
      return response.json();
    },
    enabled: !!selectedDoctor,
    refetchInterval: 5000, // Refetch every 5 seconds to catch schedule status changes
    refetchIntervalInBackground: true, // Continue refetching even when window is not focused
  });
  
  // Fetch user's existing appointments with the selected doctor
  const { data: existingAppointments = [] } = useQuery({
    queryKey: ["user-appointments", selectedDoctor],
    queryFn: async () => {
      if (!selectedDoctor || !user) return [];
      const response = await fetch(`/api/patient/appointments?doctorId=${selectedDoctor}`);
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!selectedDoctor && !!user,
  });
  
  // Booking mutation for appointment creation
  const bookingMutation = useMutation({
    mutationFn: async (appointmentData: { doctorId: number; clinicId: number; scheduleId: number; date: string; time: string; isOnBehalf?: boolean; guestName?: string; guestPhone?: string }) => {
      if (!user) {
        throw new Error("You must be logged in to book an appointment");
      }

      // Create a new date object for the selected date and time
      // Extract the start time from the time range if it's in that format
      const timeStr = appointmentData.time.includes(" - ") 
        ? appointmentData.time.split(" - ")[0] 
        : appointmentData.time;
      const [hours, minutes] = timeStr.split(":");
      const appointmentDate = new Date(appointmentData.date);
      appointmentDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);

      // Generate the next token number for this appointment
      // First get existing appointments for this doctor/clinic/date to calculate token number
      const existingAppointmentsRes = await fetch(`/api/doctors/${appointmentData.doctorId}/appointments?date=${appointmentDate.toISOString().split('T')[0]}&clinicId=${appointmentData.clinicId}`);
      let tokenNumber = 1;
      
      if (existingAppointmentsRes.ok) {
        const existingAppointments = await existingAppointmentsRes.json();
        // Get the highest token number and add 1
        const highestToken = existingAppointments.reduce((max: number, apt: any) => 
          apt.tokenNumber > max ? apt.tokenNumber : max, 0);
        tokenNumber = highestToken + 1;
      }

      // Log the appointment data being sent
      console.log('Booking appointment with data:', {
        doctorId: appointmentData.doctorId,
        clinicId: appointmentData.clinicId,
        scheduleId: appointmentData.scheduleId,
        date: appointmentDate.toISOString(),
        tokenNumber: tokenNumber,
        status: "token_started"
      });

      // Try using fetch directly instead of apiRequest
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          doctorId: appointmentData.doctorId,
          clinicId: appointmentData.clinicId,
          scheduleId: appointmentData.scheduleId,
          date: appointmentDate.toISOString(),
          tokenNumber: tokenNumber,
          status: "token_started",
          isOnBehalf: appointmentData.isOnBehalf || false,
          guestName: appointmentData.guestName || null,
          guestPhone: appointmentData.guestPhone || null,
        })
      });
      
      const data = await res.json();
      
      // If the response is not ok, throw an error with the message
      if (!res.ok) {
        throw new Error(data.message || 'Failed to book appointment');
      }
      
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
      // Also invalidate the schedules data for attenders
      queryClient.invalidateQueries({ queryKey: ["schedulesToday"] });
      queryClient.invalidateQueries({ queryKey: ["attender"] });
      // Invalidate user appointments to refresh the duplicate check
      queryClient.invalidateQueries({ queryKey: ["user-appointments", selectedDoctor] });
      // Invalidate wallet queries to refresh wallet balance
      invalidateWalletQueries(queryClient);
      toast({
        title: "Appointment Booked Successfully! ✅",
        description: "Your appointment has been confirmed. You cannot book another appointment for the same schedule.",
      });
      navigate("/appointments");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to book appointment. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Favorite toggle mutation
  const favoriteMutation = useMutation({
    mutationFn: async ({ scheduleId, doctorId, isFavorite }: { scheduleId: number; doctorId: number; isFavorite: boolean }) => {
      if (!user) {
        throw new Error("You must be logged in to manage favorites");
      }

      if (isFavorite) {
        // Remove from favorites
        const res = await fetch(`/api/favorites/schedules/${scheduleId}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.message || 'Failed to remove from favorites');
        }
      } else {
        // Add to favorites
        const res = await fetch('/api/favorites/schedules', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            scheduleId,
            doctorId,
            clinicId: parseInt(clinicId || '0')
          })
        });
        
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.message || 'Failed to add to favorites');
        }
      }
    },
    onSuccess: () => {
      // Refetch schedules to update favorite status
      queryClient.invalidateQueries({ queryKey: ["schedules", selectedDoctor] });
      toast({
        title: "Success",
        description: "Favorites updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update favorites. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Handler for toggling favorite status
  const handleToggleFavorite = (schedule: any) => {
    if (!user || user.role !== 'patient') {
      toast({
        title: "Error",
        description: "You must be logged in as a patient to use favorites.",
        variant: "destructive",
      });
      return;
    }

    favoriteMutation.mutate({
      scheduleId: parseInt(schedule.id),
      doctorId: parseInt(selectedDoctor || '0'),
      isFavorite: schedule.isFavorite || false
    });
  };

  // Check if user already has an appointment for this schedule
  const hasExistingAppointment = (scheduleId: string) => {
    return existingAppointments.some((appointment: any) => 
      appointment.scheduleId === parseInt(scheduleId) && 
      appointment.status !== 'cancelled'
    );
  };

  // Handler for booking appointment
  const handleBookAppointment = (schedule: any) => {
    // Check for duplicate booking first
    if (hasExistingAppointment(schedule.id)) {
      toast({
        title: "Appointment Already Exists",
        description: "You already have an appointment booked for this schedule. Please check your existing tokens.",
        variant: "destructive",
      });
      return;
    }

    if (!selectedSlot) {
      toast({
        title: "Error",
        description: "Please select a time slot",
        variant: "destructive",
      });
      return;
    }

    if (!selectedDoctor) {
      toast({
        title: "Error",
        description: "Please select a doctor",
        variant: "destructive",
      });
      return;
    }

    try {
      // Get the current date to use as a fallback
      const currentDate = new Date();
      
      // Extract the start time from the time range (e.g., "18:00 - 19:00" -> "18:00")
      const startTime = selectedSlot.time.split(" - ")[0];
      const [hours, minutes] = startTime.split(":").map(Number);
      
      // Create a date object using the schedule's raw date if available, or current date as fallback
      let appointmentDate;
      if (schedule.rawDate) {
        // If we have the raw date from the API response
        appointmentDate = new Date(schedule.rawDate);
      } else {
        // Try to parse the formatted date string
        try {
          // Use the raw date from the schedule data if available
          appointmentDate = new Date(schedule.date);
          if (isNaN(appointmentDate.getTime())) {
            // If that fails, use the current date but set it to the selected day
            appointmentDate = currentDate;
            appointmentDate.setDate(currentDate.getDate());
          }
        } catch (e) {
          // If parsing fails, use current date
          appointmentDate = currentDate;
        }
      }
      
      // Set the hours and minutes from the selected time slot
      appointmentDate.setHours(hours, minutes, 0, 0);
      
      // Make sure the date is valid
      if (isNaN(appointmentDate.getTime())) {
        throw new Error("Invalid appointment date");
      }
      
      // Make sure we have valid numeric IDs
      const doctorIdNum = parseInt(selectedDoctor);
      const clinicIdNum = parseInt(clinicId || '0');
      const scheduleIdNum = parseInt(schedule.id);
      
      console.log('Attempting to book appointment:', {
        doctorId: doctorIdNum,
        clinicId: clinicIdNum,
        scheduleId: scheduleIdNum,
        selectedDoctor,
        date: appointmentDate.toISOString(),
        time: selectedSlot.time
      });
      
      setPendingBookingData({
        doctorId: doctorIdNum,
        clinicId: clinicIdNum,
        scheduleId: scheduleIdNum,
        date: appointmentDate.toISOString(),
        time: selectedSlot.time,
      });
      setIsOnBehalf(false);
      setBeneficiaryName("");
      setBeneficiaryPhone("");
      setShowBookingDialog(true);
    } catch (error) {
      toast({
        title: "Error",
        description: "There was a problem processing the appointment date. Please try again.",
        variant: "destructive",
      });
      console.error("Date parsing error:", error);
    }
  };

  const confirmBooking = () => {
    if (isOnBehalf) {
      if (!beneficiaryName.trim()) {
        toast({ title: "Error", description: "Patient name is required", variant: "destructive" });
        return;
      }
      if (!/^\d{10}$/.test(beneficiaryPhone.trim())) {
        toast({ title: "Error", description: "Enter a valid 10-digit phone number", variant: "destructive" });
        return;
      }
    }
    setShowBookingDialog(false);
    bookingMutation.mutate({
      ...pendingBookingData,
      isOnBehalf,
      guestName: isOnBehalf ? beneficiaryName.trim() : undefined,
      guestPhone: isOnBehalf ? beneficiaryPhone.trim() : undefined,
    });
  };

  // Check for schedule status changes and show notifications
  useEffect(() => {
    if (!Array.isArray(scheduleData) || scheduleData.length === 0 || !user || user.role !== 'patient') {
      return;
    }

    // Convert single schedule to array for consistency
    const currentSchedules = Array.isArray(scheduleData) ? scheduleData : [scheduleData];
    
    // Check if we have previous data to compare with
    if (previousScheduleData.current.length > 0) {
      currentSchedules.forEach(currentSchedule => {
        const previousSchedule = previousScheduleData.current.find(prev => prev.id === currentSchedule.id);
        
        // Check if a favorited schedule became active
        if (previousSchedule && 
            currentSchedule.isFavorite && 
            !previousSchedule.isActive && 
            currentSchedule.isActive) {
          
          // Show toast notification
          toast({
            title: "🌟 Favorited Schedule is Now Active!",
            description: `Booking is now open for Dr. ${doctors.find(d => d.id === selectedDoctor)?.name}. You can now book your appointment.`,
            duration: 8000,
          });

          // Show browser notification if permission is granted.
          // Guard for the Notification API — it is absent in the Android WebView (Capacitor).
          if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('Booking Started!', {
              body: `Your favorited schedule is now active. Book your appointment now!`,
              icon: '/favicon.ico'
            });
          }
        }
      });
    }
    
    // Update the previous data reference
    previousScheduleData.current = currentSchedules;
  }, [scheduleData, user, selectedDoctor, doctors, toast]);

  // Request notification permission on component mount.
  // Guard for the Notification API — it is absent in the Android WebView (Capacitor),
  // where an unguarded reference throws and blanks the whole page (no error boundary).
  useEffect(() => {
    if (
      user &&
      user.role === 'patient' &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'default'
    ) {
      Notification.requestPermission();
    }
  }, [user]);

  // Process schedule data into a format suitable for the UI
  const processedSchedules = React.useMemo(() => {
    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0); // Set to start of day for comparison

    if (!Array.isArray(scheduleData)) {
      // If we got a single schedule object, convert it to an array
      const schedule = scheduleData;
      if (schedule && schedule.date) {
        const scheduleDate = new Date(schedule.date);
        scheduleDate.setHours(0, 0, 0, 0); // Set to start of day for comparison

        // Apply filtering logic:
        // 1. Never show past dates
        if (scheduleDate < currentDate) {
          return [];
        }

        // 2. Always show current date schedules
        const isToday = scheduleDate.getTime() === currentDate.getTime();

        // 3. For future dates, only show if isVisible is true
        const isFuture = scheduleDate > currentDate;
        if (isFuture && !schedule.isVisible) {
          return [];
        }

        const date = new Date(schedule.date);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
        const formattedDate = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        
        // Create a single time range slot instead of individual slots
        const slots = [];
        if (schedule.startTime && schedule.endTime) {
          slots.push(`${schedule.startTime} - ${schedule.endTime}`);
        }
        
        return [{
          id: schedule.id.toString(),
          day: dayName,
          date: formattedDate,
          rawDate: schedule.date, // Store the original date string for booking
          slots: slots,
          maxTokens: schedule.maxTokens,
          isActive: schedule.isActive,
          isFavorite: schedule.isFavorite || false,
          isVisible: schedule.isVisible || false
        }];
      }
      return [];
    }
    
   // If we have an array of schedules, filter them first, then map
   return scheduleData
     .filter(schedule => {
       const scheduleDate = new Date(schedule.date);
       scheduleDate.setHours(0, 0, 0, 0); // Set to start of day for comparison

       // Apply filtering logic:
       // 1. Never show past dates
       if (scheduleDate < currentDate) {
         return false;
       }

       // 2. Always show current date schedules
       const isToday = scheduleDate.getTime() === currentDate.getTime();
       if (isToday) {
         return true;
       }

       // 3. For future dates, only show if isVisible is true
       const isFuture = scheduleDate > currentDate;
       if (isFuture && schedule.isVisible) {
         return true;
       }

       return false;
     })
     .map(schedule => {
       const date = new Date(schedule.date);
       const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
       const formattedDate = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

       // Create a single time range slot instead of individual slots
       const slots = [];
       if (schedule.startTime && schedule.endTime) {
         slots.push(`${schedule.startTime} - ${schedule.endTime}`);
       }

       // Check availability based on multiple conditions (colleague's logic)
       const isScheduleCompleted = schedule.scheduleStatus === 'completed';
       const isBookingClosed = schedule.bookingStatus === 'closed';

       // Check if today's schedule end time has already passed
       const now = new Date();
       const schDate = new Date(schedule.date);
       const isTodaySchedule = now.toDateString() === schDate.toDateString();
       let isEndTimePassed = false;
       if (isTodaySchedule && schedule.endTime) {
         const [endHour, endMin] = schedule.endTime.split(':').map(Number);
         const endTimeToday = new Date();
         endTimeToday.setHours(endHour, endMin, 0, 0);
         isEndTimePassed = now > endTimeToday;
       }

       const isAvailable = schedule.isActive && !isScheduleCompleted && !isBookingClosed && !isEndTimePassed;

       return {
         id: schedule.id.toString(),
         day: dayName,
         date: formattedDate,
         rawDate: schedule.date, // Store the original date string for booking
         slots: slots,
         maxTokens: schedule.maxTokens,
         isActive: schedule.isActive,
         scheduleStatus: schedule.scheduleStatus || 'active',
         bookingStatus: schedule.bookingStatus || 'open',
         isAvailable: isAvailable,
         isFavorite: schedule.isFavorite || false,
         isVisible: schedule.isVisible || false,
         statusMessage: isScheduleCompleted ? 'Schedule completed - doctor has finished' :
                       isBookingClosed ? 'Booking closed - new tokens not accepted' :
                       isEndTimePassed ? `Schedule ended at ${schedule.endTime}` : ''
       };
     });
  }, [scheduleData]);

  // Filter doctors based on search term
  const filteredDoctors = doctors.filter(doctor => 
    doctor.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    doctor.specialty.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const isLoading = isClinicLoading || isDoctorsLoading;
  const error = clinicError || doctorsError;
  
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavHeader />
        <div className="container mx-auto py-8 px-4">
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading clinic details...</p>
          </div>
        </div>
      </div>
    );
  }
  
  if (error || !clinic) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavHeader />
        <div className="container mx-auto py-8 px-4">
          <div className="text-center py-12">
            <p className="text-red-500">Error loading clinic details. Please try again later.</p>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gray-50">
      <NavHeader />
      <div className="container mx-auto py-8 px-4">
        {/* Clinic Header */}
      <div className="mb-8">
        <div className="flex flex-col md:flex-row gap-6 items-start">
          <div className="w-full md:w-1/3 lg:w-1/4">
            <div className="aspect-video rounded-lg overflow-hidden">
              <img 
                src={clinic.imageUrl || "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d"} 
                alt={clinic.name} 
                className="w-full h-full object-cover"
              />
            </div>
          </div>
          <div className="flex-1">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <h1 className="text-2xl sm:text-3xl font-bold flex-1">{clinic.name}</h1>
              <NavigationButtons />
            </div>
            <div className="flex items-start gap-2 mt-2">
              <p className="text-muted-foreground flex-1">{clinic.address}</p>
              <Button 
                variant="outline" 
                size="sm"
                className="flex items-center gap-2 shrink-0"
                onClick={() => {
                  const address = encodeURIComponent(`${clinic.address}, ${clinic.city || ''}, ${clinic.state || ''}`);
                  window.open(`https://www.google.com/maps/search/?api=1&query=${address}`, '_blank');
                }}
              >
                <Navigation className="h-4 w-4" />
                Navigate
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div>
                <h3 className="font-medium">Contact Information</h3>
                <p className="text-sm mt-1">{clinic.phone}</p>
                <p className="text-sm">{clinic.email}</p>
              </div>
              <div>
                <h3 className="font-medium">Hours</h3>
                <p className="text-sm mt-1">{clinic.hours}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Side - Doctors List */}
        <div className="lg:col-span-1">
          <div className="bg-card rounded-lg border p-4">
            <h2 className="text-xl font-semibold mb-4">Doctors</h2>
            
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search doctors..."
                className="pl-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            
            <div className="space-y-4">
              {isDoctorsLoading ? (
                <p className="text-center py-4 text-muted-foreground">Loading doctors...</p>
              ) : filteredDoctors.length === 0 ? (
                <p className="text-center py-4 text-muted-foreground">No doctors found matching your search criteria.</p>
              ) : (
                filteredDoctors.map((doctor) => (
                  <Card 
                    key={doctor.id} 
                    className={`cursor-pointer transition-colors ${selectedDoctor === doctor.id ? 'border-primary' : ''}`}
                    onClick={() => setSelectedDoctor(doctor.id)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <Avatar className="h-12 w-12">
                          <AvatarImage src={doctor.imageUrl} alt={doctor.name} />
                          <AvatarFallback>
                            {doctor.name.split(" ").map(n => n[0]).join("")}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <h3 className="font-semibold">{doctor.name}</h3>
                          <p className="text-sm text-muted-foreground">{doctor.specialty}</p>
                          {/* <div className="mt-2 flex flex-wrap gap-1">
                            {doctor.languages.map((lang, idx) => (
                              <Badge key={idx} variant="outline" className="text-xs">{lang}</Badge>
                            ))}
                          </div> */}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        </div>
        
        {/* Right Side - Doctor Schedule */}
        <div className="lg:col-span-2">
          {selectedDoctor ? (
            <div className="bg-card rounded-lg border p-6">
              <div className="flex items-start gap-6 mb-6">
                <Avatar className="h-16 w-16">
                  <AvatarImage 
                    src={doctors.find(d => d.id === selectedDoctor)?.imageUrl} 
                    alt={doctors.find(d => d.id === selectedDoctor)?.name} 
                  />
                  <AvatarFallback>
                    {doctors.find(d => d.id === selectedDoctor)?.name.split(" ").map(n => n[0]).join("")}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h2 className="text-2xl font-bold">{doctors.find(d => d.id === selectedDoctor)?.name}</h2>
                  <p className="text-muted-foreground">{doctors.find(d => d.id === selectedDoctor)?.specialty}</p>
                  <p className="mt-2">{doctors.find(d => d.id === selectedDoctor)?.bio}</p>
                  <p className="text-sm mt-1">
                    <span className="font-medium">Education:</span> {doctors.find(d => d.id === selectedDoctor)?.education}
                  </p>
                </div>
              </div>
              
              <div className="mt-8">
                <h3 className="text-xl font-semibold mb-4 flex items-center">
                  <CalendarDays className="mr-2 h-5 w-5" />
                  Available Schedules
                </h3>
                
                <Tabs defaultValue={processedSchedules[0]?.id}>
                  {isSchedulesLoading ? (
                    <div className="text-center py-4">
                      <p className="text-muted-foreground">Loading schedules...</p>
                    </div>
                  ) : processedSchedules.length === 0 ? (
                    <div className="text-center py-4">
                      <p className="text-muted-foreground">No schedules available for this doctor.</p>
                    </div>
                  ) : (
                    <>
                      <div className="overflow-x-auto pb-1">
                        <TabsList className="mb-4 min-w-max">
                          {processedSchedules.map((schedule) => (
                            <TabsTrigger key={schedule.id} value={schedule.id}>
                              <div className="text-center">
                                <div className="font-medium">{schedule.day}</div>
                                <div className="text-xs text-muted-foreground">{schedule.date}</div>
                              </div>
                            </TabsTrigger>
                          ))}
                        </TabsList>
                      </div>
                      
                      {processedSchedules.map((schedule) => (
                        <TabsContent key={schedule.id} value={schedule.id}>
                          <div className="mb-4">
                            <div className="flex flex-col sm:flex-row sm:items-start gap-2">
                              <p className="text-sm text-muted-foreground flex-1">
                                <span className="font-medium">Available Time:</span> {schedule.slots[0] || 'No slots'}
                                {schedule.maxTokens && (
                                  <> | <span className="font-medium">Max Tokens:</span> {schedule.maxTokens}</>
                                )}
                                {schedule.statusMessage && (
                                  <span className="ml-2 text-red-500"> ({schedule.statusMessage})</span>
                                )}
                                {schedule.isAvailable && schedule.isFavorite && (
                                  <span className="ml-2 text-green-600 font-medium"> ⭐ Available & Favorited</span>
                                )}
                                {hasExistingAppointment(schedule.id) && (
                                  <span className="ml-2 text-amber-600 font-medium"> ✓ Already Booked</span>
                                )}
                              </p>

                              {/* Status Badge */}
                              <div className="flex items-center gap-2">
                                {hasExistingAppointment(schedule.id) && (
                                  <Badge variant="outline" className="border-amber-500 text-amber-700">
                                    Already Booked
                                  </Badge>
                                )}
                                {schedule.scheduleStatus === 'completed' && (
                                  <Badge variant="secondary">Schedule Completed</Badge>
                                )}
                                {schedule.bookingStatus === 'closed' && schedule.scheduleStatus !== 'completed' && (
                                  <Badge variant="secondary">Booking Closed</Badge>
                                )}
                                {!schedule.isActive && schedule.scheduleStatus !== 'completed' && schedule.bookingStatus !== 'closed' && (
                                  <Badge variant="destructive">Booking Not Started</Badge>
                                )}
                                {schedule.isAvailable && !hasExistingAppointment(schedule.id) && (
                                  <Badge variant="default">Available</Badge>
                                )}
                              </div>
                            </div>
                            
                            {/* Favorite Toggle */}
                            {user && user.role === 'patient' && (
                              <div
                                onClick={() => handleToggleFavorite(schedule)}
                                className="flex items-center gap-2 cursor-pointer"
                              >
                                {favoriteMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : schedule.isFavorite ? (
                                  <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                                ) : (
                                  <>
                                    <StarOff className="h-4 w-4 text-gray-400 hover:text-yellow-400" />
                                    <span className="text-sm font-medium text-gray-600 hover:text-yellow-600">Add to Favorites</span>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                          
                          <div className="flex justify-center">
                            {schedule.slots.map((time) => (
                              <Button
                                key={time}
                                variant={selectedSlot?.day === schedule.day && selectedSlot?.time === time ? "default" : "outline"}
                                className={`flex items-center justify-center px-8 py-6 text-lg ${
                                  hasExistingAppointment(schedule.id) ? 'opacity-60' : ''
                                }`}
                                onClick={() => (schedule.isAvailable && !hasExistingAppointment(schedule.id)) ? setSelectedSlot({ day: schedule.day, time }) : undefined}
                                disabled={!schedule.isAvailable || hasExistingAppointment(schedule.id)}
                                title={hasExistingAppointment(schedule.id) ? "You already have an appointment for this schedule" : ""}
                              >
                                <Clock className="mr-2 h-5 w-5" />
                                {time}
                                {hasExistingAppointment(schedule.id) && (
                                  <span className="ml-2 text-xs">✓</span>
                                )}
                              </Button>
                            ))}
                          </div>
                          
                          {selectedSlot?.day === schedule.day && (
                            <div className="mt-6 flex justify-end">
                              {hasExistingAppointment(schedule.id) ? (
                                <div className="text-center">
                                  <p className="text-amber-600 font-medium mb-2">
                                    ⚠️ You already have an appointment booked for this schedule
                                  </p>
                                  <Button 
                                    variant="outline"
                                    onClick={() => navigate("/appointments")}
                                  >
                                    View My Tokens
                                  </Button>
                                </div>
                              ) : (
                                <Button 
                                  disabled={!schedule.isAvailable || bookingMutation.isPending}
                                  onClick={() => handleBookAppointment(schedule)}
                                >
                                  {bookingMutation.isPending ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  ) : (
                                    <Calendar className="mr-2 h-4 w-4" />
                                  )}
                                  Book Token
                                </Button>
                              )}
                            </div>
                          )}
                        </TabsContent>
                      ))}
                    </>
                  )}
                </Tabs>
              </div>
            </div>
          ) : (
            <div className="bg-card rounded-lg border p-6 flex flex-col items-center justify-center h-full min-h-[400px]">
              <CalendarDays className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="text-xl font-medium text-center">Select a Doctor</h3>
              <p className="text-muted-foreground text-center mt-2">
                Choose a doctor from the list to view their available appointment slots.
              </p>
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Booking confirmation dialog with "Book for someone else" toggle */}
      <Dialog open={showBookingDialog} onOpenChange={(open) => { if (!open) setShowBookingDialog(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Appointment</DialogTitle>
            <DialogDescription>
              ₹21 will be deducted from your wallet.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="flex items-center gap-3">
              <Checkbox
                id="onBehalf"
                checked={isOnBehalf}
                onCheckedChange={(v) => setIsOnBehalf(!!v)}
              />
              <Label htmlFor="onBehalf" className="flex items-center gap-2 cursor-pointer">
                <Users className="h-4 w-4 text-muted-foreground" />
                Booking for someone else
              </Label>
            </div>

            {isOnBehalf && (
              <div className="space-y-3 pl-7 border-l-2 border-primary/20 ml-1">
                <div className="space-y-1">
                  <Label htmlFor="beneficiaryName">Patient Name <span className="text-red-500">*</span></Label>
                  <Input
                    id="beneficiaryName"
                    value={beneficiaryName}
                    onChange={(e) => setBeneficiaryName(e.target.value)}
                    placeholder="Full name of the patient"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="beneficiaryPhone">Patient Phone <span className="text-red-500">*</span></Label>
                  <Input
                    id="beneficiaryPhone"
                    value={beneficiaryPhone}
                    onChange={(e) => setBeneficiaryPhone(e.target.value)}
                    placeholder="10-digit mobile number"
                    maxLength={10}
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBookingDialog(false)}>
              Cancel
            </Button>
            <Button onClick={confirmBooking} disabled={bookingMutation.isPending}>
              {bookingMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Calendar className="mr-2 h-4 w-4" />
              )}
              Confirm Booking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
