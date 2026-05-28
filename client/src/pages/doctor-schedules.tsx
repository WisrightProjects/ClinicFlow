import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { NavHeader } from "@/components/nav-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Edit, Trash2, Calendar, Clock } from "lucide-react";
import { format } from "date-fns";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import React from "react";
import { useAuth } from "@/hooks/use-auth";
import { NavigationButtons } from "@/components/navigation-buttons";
import { apiRequest } from "@/lib/queryClient";

// Define types
type Clinic = {
  id: number;
  name: string;
};

type Doctor = {
  id: number;
  name: string;
  specialty?: string;
};

type DoctorSchedule = {
  id: number;
  doctorId: number;
  clinicId: number;
  date: Date;
  startTime: string;
  endTime: string;
  isActive: boolean;
  isVisible: boolean;
  maxTokens: number;
  doctor?: Doctor;
  clinic?: Clinic;
};

const dayNames = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
];

export default function DoctorSchedulesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const attenderId = user?.id;
  const [activeTab, setActiveTab] = useState("list");
  const [selectedSchedule, setSelectedSchedule] = useState<DoctorSchedule | null>(null);
  const [selectedDoctor, setSelectedDoctor] = useState<number | null>(null);
  const [, setLocation] = useLocation();
  
  // Form state
  const [formData, setFormData] = useState({
    clinicId: "", // Initialize as empty string instead of 0
    date: new Date(),
    startTime: "09:00",
    endTime: "17:00",
    isActive: false,
    isVisible: false, // Default to hidden
    maxTokens: 20,
  });

  // Fetch clinics
  const { data: clinic, isLoading: isLoadingClinic } = useQuery<Clinic>({
    queryKey: [`/api/clinics/${user?.clinicId}`],
    enabled: !!user?.clinicId,
  });

  // Set clinic ID in form data when clinic data is loaded
  useEffect(() => {
    if (clinic?.id) {
      console.log('Setting clinic ID:', clinic.id);
      setFormData(prev => {
        const updated = {
          ...prev,
          clinicId: clinic.id.toString() // Convert to string to match expected format
        };
        console.log('Updated formData:', updated);
        return updated;
      });
    }
  }, [clinic]);

  // Fetch doctors based on user role
  const { 
    data: doctorsData = [], 
    isLoading: isLoadingDoctors 
  } = useQuery<{doctor: Doctor}[] | Doctor[]>({ 
    queryKey: ['user-doctors', user?.id, user?.role], 
    queryFn: async () => { 
      if (!user?.id) return []; 
      
      if (user.role === 'clinic_admin') {
        // For clinic admins, get all doctors in their clinic
        const res = await apiRequest('GET', `/api/clinics/${user.clinicId}/doctors`); 
        return await res.json(); // Returns Doctor[] directly
      } else {
        // For attenders, get assigned doctors
        const res = await apiRequest('GET', `/api/attender-doctor/${user.id}`); 
        return await res.json(); // Returns {doctor: Doctor}[]
      }
    }, 
    enabled: !!user?.id, 
    refetchOnMount: 'always',  // Always refetch when component mounts
    staleTime: 0,              // Consider data stale immediately
  });
  
  // Extract doctor objects based on user role
  const doctors = user?.role === 'clinic_admin' 
    ? (doctorsData as Doctor[]) // Clinic admin gets doctors directly
    : (doctorsData as {doctor: Doctor}[]).map(item => item.doctor); // Attender gets wrapped doctors
  
  // Auto-select first doctor if available and none is selected
  useEffect(() => {
    if (doctors?.length > 0 && selectedDoctor === null) {
      setSelectedDoctor(doctors[0].id);
    }
  }, [doctors, selectedDoctor]);
  
  // Fetch doctor schedules
  const { data: schedules, isLoading: isLoadingSchedules } = useQuery<DoctorSchedule[]>({
    queryKey: [`/api/doctors/${selectedDoctor}/schedules`],
    enabled: selectedDoctor !== null,
    queryFn: async () => {
      const response = await fetch(`/api/doctors/${selectedDoctor}/schedules`);
      if (!response.ok) {
        throw new Error("Failed to fetch schedules");
      }
      const data = await response.json();
      // Transform the data to ensure dates are properly parsed
      return data.map((schedule: any) => ({
        ...schedule,
        // Ensure we create a proper Date object from the ISO string
        date: new Date(schedule.date)
      }));
    },
  });

  // Create schedule mutation
  const createScheduleMutation = useMutation({
    mutationFn: async (data: typeof formData & { doctorId: number }) => {
      // Validate the date
      if (!data.date || data.date.getTime() === 0 || isNaN(data.date.getTime())) {
        throw new Error("Please select a valid date");
      }

      // Validate clinic ID
      if (!data.clinicId) {
        throw new Error("Please select a clinic");
      }

      // Format the date as YYYY-MM-DD string to avoid timezone issues
      const selectedDate = new Date(data.date);
      selectedDate.setHours(0, 0, 0, 0); // Reset time to start of day
      
      // Format as YYYY-MM-DD to avoid timezone conversion issues
      const year = selectedDate.getFullYear();
      const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const day = String(selectedDate.getDate()).padStart(2, '0');
      const dateString = `${year}-${month}-${day}`;

      const formattedData = {
        ...data,
        clinicId: parseInt(data.clinicId as string), // Convert string to number
        date: dateString,        
        attenderName: user?.name, 
      };

      const response = await fetch(`/api/doctors/${data.doctorId}/schedules`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formattedData),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create schedule");
      }
      
      return response.json();
    },
    onSuccess: () => {
      // Match the exact query key format used in the schedules query
      queryClient.invalidateQueries({ queryKey: [`/api/doctors/${selectedDoctor}/schedules`] });
      toast({
        title: "Success",
        description: "Schedule created successfully",
      });
      resetForm();
      setActiveTab("list");
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update schedule mutation
  const updateScheduleMutation = useMutation({
    mutationFn: async (data: { id: number, schedule: Partial<typeof formData> }) => {
      // Validate the date
      if (!data.schedule.date || data.schedule.date.getTime() === 0 || isNaN(data.schedule.date.getTime())) {
        throw new Error("Please select a valid date");
      }

      // Format the date as YYYY-MM-DD string to avoid timezone issues
      const selectedDate = new Date(data.schedule.date);
      selectedDate.setHours(0, 0, 0, 0); // Reset time to start of day
      
      // Format as YYYY-MM-DD to avoid timezone conversion issues
      const year = selectedDate.getFullYear();
      const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const day = String(selectedDate.getDate()).padStart(2, '0');
      const dateString = `${year}-${month}-${day}`;

      const formattedSchedule = {
        ...data.schedule,
        date: dateString,       
        attenderName: user?.name, 
      };

      const response = await fetch(`/api/doctors/schedules/${data.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formattedSchedule),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update schedule");
      }
      
      return response.json();
    },
    onSuccess: () => {
      // Match the exact query key format used in the schedules query
      queryClient.invalidateQueries({ queryKey: [`/api/doctors/${selectedDoctor}/schedules`] });
      toast({
        title: "Success",
        description: "Schedule updated successfully",
      });
      resetForm();
      setActiveTab("list");
      setSelectedSchedule(null);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete schedule mutation
  const deleteScheduleMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/doctors/schedules/${id}`, {
        method: "DELETE",
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete schedule");
      }
    },
    onSuccess: () => {
      // Match the exact query key format used in the schedules query
      queryClient.invalidateQueries({ queryKey: [`/api/doctors/${selectedDoctor}/schedules`] });
      toast({
        title: "Success",
        description: "Schedule deleted successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Form handlers
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'maxTokens') {
      setFormData({ ...formData, [name]: parseInt(value) || 0 });
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const handleSelectChange = (name: string, value: string) => {
    // Convert string values to numbers for number fields
    setFormData({ ...formData, [name]: value });
  };

  const handleSwitchChange = (name: string, checked: boolean) => {
    setFormData({ ...formData, [name]: checked });
  };

  const handleEditSchedule = (schedule: DoctorSchedule) => {
    console.log('Original schedule date:', schedule.date);
    console.log('Schedule date type:', typeof schedule.date);
    
    // Handle date properly to avoid timezone issues
    let scheduleDate: Date;
    
    if (schedule.date instanceof Date) {
      // If it's already a Date object, use it directly
      scheduleDate = new Date(schedule.date);
    } else {
      // If it's a string, parse it as a local date to avoid timezone shifts
      const dateStr = schedule.date.toString();
      if (dateStr.includes('T')) {
        // If it's an ISO string, extract just the date part
        const datePart = dateStr.split('T')[0];
        const [year, month, day] = datePart.split('-').map(Number);
        scheduleDate = new Date(year, month - 1, day); // month is 0-indexed
      } else {
        // If it's just a date string, parse it directly
        const [year, month, day] = dateStr.split('-').map(Number);
        scheduleDate = new Date(year, month - 1, day); // month is 0-indexed
      }
    }
    
    if (isNaN(scheduleDate.getTime())) {
      console.error('Invalid date received:', schedule.date);
      toast({
        title: "Error",
        description: "Invalid date in schedule",
        variant: "destructive",
      });
      return;
    }
    
    console.log('Parsed date without timezone issues:', scheduleDate);
    
    setSelectedSchedule(schedule);
    setFormData({
      clinicId: schedule.clinicId.toString(), // Convert to string for the form
      date: scheduleDate,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      isActive: schedule.isActive,
      isVisible: schedule.isVisible,
      maxTokens: schedule.maxTokens,
    });
    setActiveTab("create");
  };

  const handleDeleteSchedule = (id: number) => {
    if (window.confirm("Are you sure you want to delete this schedule?")) {
      deleteScheduleMutation.mutate(id);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    console.log('Form submission - formData:', formData);
    console.log('Selected doctor:', selectedDoctor);
    console.log('Clinic data:', clinic);
    
    if (!selectedDoctor) {
      toast({
        title: "Error",
        description: "Please select a doctor",
        variant: "destructive",
      });
      return;
    }

    // Check if clinic ID is empty or undefined
    console.log('Checking clinic ID:', formData.clinicId, typeof formData.clinicId);
    if (!formData.clinicId) {
      // If we have clinic data but formData.clinicId is empty, set it directly
      if (clinic?.id) {
        console.log('Setting clinic ID directly from clinic data:', clinic.id);
        formData.clinicId = clinic.id.toString();
      } else {
        toast({
          title: "Error",
          description: "Please select a clinic",
          variant: "destructive",
        });
        return;
      }
    }

    // Create a copy of formData with number values properly converted
    const processedData = {
      ...formData,
      clinicId: parseInt(formData.clinicId as string), // Convert string to number
      doctorId: selectedDoctor,
    };

    if (selectedSchedule) {
      updateScheduleMutation.mutate({
        id: selectedSchedule.id,
        schedule: processedData,
      });
    } else {
      createScheduleMutation.mutate(processedData);
    }
  };

  const resetForm = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Reset time to start of day
  
    // Keep the clinic ID if available
    const clinicIdToUse = clinic?.id ? clinic.id.toString() : "";
    console.log('Resetting form with clinic ID:', clinicIdToUse);
  
    setFormData({
      clinicId: clinicIdToUse,
      date: today,
      startTime: "09:00",
      endTime: "17:00",
      isActive: false,
      maxTokens: 20,
    });
    setSelectedSchedule(null);
  };

  const getClinicName = (clinicId: number) => {
    if (!clinic) return "Unknown";
    return clinic.name;
  };

  useEffect(() => {
    if (selectedSchedule === null && activeTab === "create") {
      resetForm();
    }
  }, [activeTab, selectedSchedule]);

  return (
    <div className="container mx-auto py-4">
      <NavHeader />
      <div className="flex flex-col gap-4 my-6">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl sm:text-3xl font-bold">Doctor Schedules</h1>
          <NavigationButtons />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Label htmlFor="doctor-select" className="shrink-0">Select Doctor:</Label>
          <Select
            value={selectedDoctor?.toString() || ""}
            onValueChange={(value) => setSelectedDoctor(Number(value))}
          >
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="Select doctor" />
            </SelectTrigger>
            <SelectContent>
              {isLoadingDoctors ? (
                <SelectItem value="loading" disabled>Loading...</SelectItem>
              ) : (
                doctors?.map((doctor) => (
                  <SelectItem key={doctor.id} value={doctor.id.toString()}>
                    {doctor.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          {selectedDoctor && (
            <Button onClick={() => setActiveTab("create")}>
              <Plus className="mr-2 h-4 w-4" /> Add Schedule
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="list">Schedules List</TabsTrigger>
          <TabsTrigger value="create" disabled={!selectedDoctor}>
            {selectedSchedule ? "Edit Schedule" : "Create Schedule"}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-4">
          {!selectedDoctor ? (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-10">
                  <Calendar className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium">No Doctor Selected</h3>
                  <p className="text-sm text-muted-foreground mt-2">
                    Please select a doctor to view their schedules.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : isLoadingSchedules ? (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-10">Loading schedules...</div>
              </CardContent>
            </Card>
          ) : (schedules && schedules.length > 0) ? (
            <Card>
              <CardContent className="pt-6">
                <div className="overflow-x-auto">
                <Table>
                  <TableCaption>List of doctor schedules</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Clinic</TableHead>
                      <TableHead>Start Time</TableHead>
                      <TableHead>End Time</TableHead>
                      <TableHead>Max Tokens</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created By</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {schedules.map((schedule) => (
                      <TableRow key={schedule.id}>
                        <TableCell>
                          {schedule.date instanceof Date 
                            ? format(schedule.date, "PPP")
                            : format(new Date(schedule.date), "PPP")}
                        </TableCell>
                        <TableCell>{getClinicName(schedule.clinicId)}</TableCell>
                        <TableCell>{schedule.startTime}</TableCell>
                        <TableCell>{schedule.endTime}</TableCell>
                        <TableCell>{schedule.maxTokens}</TableCell>
                        <TableCell>
                          {(() => {
                            const now = new Date();
                            const schDate = new Date(schedule.date);
                            const isToday = now.toDateString() === schDate.toDateString();
                            let isEndTimePassed = false;
                            if (isToday && schedule.endTime) {
                              const [endHour, endMin] = schedule.endTime.split(':').map(Number);
                              const endTimeToday = new Date();
                              endTimeToday.setHours(endHour, endMin, 0, 0);
                              isEndTimePassed = now > endTimeToday;
                            }
                            return (
                              <div className="flex flex-col gap-1">
                                <span className={isEndTimePassed ? "text-orange-500" : schedule.isActive ? "text-green-600" : "text-red-600"}>
                                  {isEndTimePassed ? "Ended" : schedule.isActive ? "Active" : "Inactive"}
                                </span>
                                <span className={schedule.isVisible ? "text-blue-600 text-sm" : "text-gray-400 text-sm"}>
                                  {schedule.isVisible ? "Visible" : "Hidden"}
                                </span>
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell>{schedule.createdByUser?.name || "Unknown"}</TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditSchedule(schedule)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteSchedule(schedule.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-10">
                  <Clock className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium">No Schedules Found</h3>
                  <p className="text-sm text-muted-foreground mt-2">
                    This doctor doesn't have any schedules yet.
                  </p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => setActiveTab("create")}
                  >
                    <Plus className="mr-2 h-4 w-4" /> Add Schedule
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="create">
          <Card>
            <CardHeader>
              <CardTitle>{selectedSchedule ? "Edit Schedule" : "Create New Schedule"}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="clinicId">Clinic</Label>
                    <div className="border rounded-md p-2 bg-muted/20">
                      {isLoadingClinic ? (
                        <span className="text-muted-foreground">Loading clinic information...</span>
                      ) : clinic ? (
                        <span>{clinic.name}</span>
                      ) : (
                        <span className="text-muted-foreground">No clinic found</span>
                      )}
                    </div>
                    <input type="hidden" name="clinicId" value={formData.clinicId} />
                  </div>

                  <div>
                    <Label>Date</Label>
                    <div className="mt-1">
                      <CalendarComponent
                        mode="single"
                        selected={formData.date}
                        onSelect={(date) => date && setFormData({ ...formData, date })}
                        className="rounded-md border"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="startTime">Start Time</Label>
                      <Input
                        id="startTime"
                        name="startTime"
                        type="time"
                        value={formData.startTime}
                        onChange={handleInputChange}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="endTime">End Time</Label>
                      <Input
                        id="endTime"
                        name="endTime"
                        type="time"
                        value={formData.endTime}
                        onChange={handleInputChange}
                        required
                      />
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="isActive"
                      checked={formData.isActive}
                      onCheckedChange={(checked) => handleSwitchChange("isActive", checked)}
                    />
                    <Label htmlFor="isActive">Start Booking</Label>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="isVisible"
                        checked={formData.isVisible}
                        onCheckedChange={(checked) => handleSwitchChange("isVisible", checked)}
                      />
                      <Label htmlFor="isVisible">Show to Patients (Booking Not Started)</Label>
                    </div>
                    <p className="text-sm text-muted-foreground ml-6">
                      When enabled, this schedule will be visible to patients for booking tokens
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="maxTokens">Max Tokens</Label>
                    <Input
                      id="maxTokens"
                      name="maxTokens"
                      type="number"
                      value={formData.maxTokens.toString()}
                      onChange={handleInputChange}
                      required
                    />
                  </div>
                </div>

                <div className="flex justify-end space-x-2">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => {
                      setActiveTab("list");
                      resetForm();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createScheduleMutation.isPending || updateScheduleMutation.isPending}>
                    {selectedSchedule ? "Update Schedule" : "Create Schedule"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
} 