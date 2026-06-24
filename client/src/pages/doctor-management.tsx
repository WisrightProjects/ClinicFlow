import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { NavHeader } from "@/components/nav-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PlusCircle, Edit, Trash2, CheckCircle, XCircle } from "lucide-react";
import React from "react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";

// Define types
type Clinic = {
  id: number;
  name: string;
};

type Doctor = {
  id: number;
  name: string;
  username: string;
  specialty: string;
  clinicId: number;
  bio?: string;
  details?: DoctorDetails;
};

type DoctorDetails = {
  id: number;
  doctorId: number;
  consultationFee: number;
  consultationDuration: number;
  qualifications?: string;
  experience?: number;
  registrationNumber?: string;
  isEnabled: boolean;
};

export default function DoctorManagementPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const attenderId = user?.id;
  const [activeTab, setActiveTab] = useState("list");
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    user: {
      name: "",
      username: "",
      specialty: "",
      bio: "",
      clinicId: 0,
    },
    details: {
      consultationFee: 0,
      consultationDuration: 30,
      qualifications: "",
      experience: 0,
      registrationNumber: "",
      isEnabled: true,
    },
  });

  // Fetch clinics
  const { data: clinics, isLoading: isLoadingClinics } = useQuery<Clinic[]>({
    queryKey: ["/api/clinics"],
  });

  // Fetch doctors based on attender assignment
  const { 
    data: attenderDoctors = [], 
    isLoading: isLoadingAttenderDoctors 
  } = useQuery<{doctor: Doctor}[]>({ 
    queryKey: ['attender-doctors', attenderId], 
    queryFn: async () => { 
      if (!attenderId) return []; 
      const res = await apiRequest('GET', `/api/attender-doctor/${attenderId}`); 
      return await res.json(); 
    }, 
    enabled: !!attenderId, 
    refetchOnMount: 'always',  // Always refetch when component mounts
    staleTime: 0,              // Consider data stale immediately
  });
  
  // Extract just the doctor objects from attenderDoctors
  const doctors = attenderDoctors.map(item => item.doctor);
  const isLoadingDoctors = isLoadingAttenderDoctors;

  // Create doctor mutation
  const createDoctorMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await fetch("/api/doctors", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create doctor");
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/doctors"] });
      toast({
        title: "Success",
        description: "Doctor created successfully",
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

  // Update doctor mutation
  const updateDoctorMutation = useMutation({
    mutationFn: async (data: { id: number, data: typeof formData }) => {
      const response = await fetch(`/api/doctors/${data.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data.data),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update doctor");
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/doctors"] });
      toast({
        title: "Success",
        description: "Doctor updated successfully",
      });
      resetForm();
      setActiveTab("list");
      setSelectedDoctor(null);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Toggle doctor status mutation
  const toggleDoctorStatusMutation = useMutation({
    mutationFn: async ({ doctorId, isEnabled }: { doctorId: number; isEnabled: boolean }) => {
      const response = await fetch(`/api/doctors/${doctorId}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ isEnabled }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update doctor status");
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/doctors"] });
      toast({
        title: "Success",
        description: "Doctor status updated successfully",
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

  // Handle form input changes
  const handleUserInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      user: {
        ...formData.user,
        [name]: name === "clinicId" ? parseInt(value) : value,
      },
    });
  };

  const handleDetailsInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      details: {
        ...formData.details,
        [name]: ["consultationFee", "consultationDuration", "experience"].includes(name)
          ? parseInt(value)
          : value,
      },
    });
  };

  const handleStatusChange = (checked: boolean) => {
    setFormData({
      ...formData,
      details: {
        ...formData.details,
        isEnabled: checked,
      },
    });
  };

  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedDoctor) {
      updateDoctorMutation.mutate({ id: selectedDoctor.id, data: formData });
    } else {
      createDoctorMutation.mutate(formData);
    }
  };

  // Reset form
  const resetForm = () => {
    setFormData({
      user: {
        name: "",
        username: "",
        specialty: "",
        bio: "",
        clinicId: 0,
      },
      details: {
        consultationFee: 0,
        consultationDuration: 30,
        qualifications: "",
        experience: 0,
        registrationNumber: "",
        isEnabled: true,
      },
    });
    setSelectedDoctor(null);
  };

  // Handle doctor status toggle
  const handleToggleStatus = (doctorId: number, currentStatus: boolean) => {
    if (currentStatus === undefined) {
      toast({
        title: "Error",
        description: "Cannot toggle status: Current status is unknown",
        variant: "destructive",
      });
      return;
    }
    
    toggleDoctorStatusMutation.mutate({
      doctorId,
      isEnabled: !currentStatus,
    });
  };

  // Handle edit button click
  const handleEditClick = (doctor: Doctor) => {
    setFormData({
      user: {
        name: doctor.name,
        username: doctor.username,
        specialty: doctor.specialty || "",
        bio: doctor.bio || "",
        clinicId: doctor.clinicId,
      },
      details: {
        consultationFee: doctor.details?.consultationFee || 0,
        consultationDuration: doctor.details?.consultationDuration || 30,
        qualifications: doctor.details?.qualifications || "",
        experience: doctor.details?.experience || 0,
        registrationNumber: doctor.details?.registrationNumber || "",
        isEnabled: doctor.details?.isEnabled !== undefined ? doctor.details.isEnabled : true,
      },
    });
    setSelectedDoctor(doctor);
    setActiveTab("form");
  };

  if (isLoadingClinics || isLoadingDoctors) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavHeader />
        <main className="container mx-auto px-4 py-8">
          <Skeleton className="h-[600px]" />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavHeader />
      <main className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Doctor Management</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="mb-6">
                <TabsTrigger value="list">Doctor List</TabsTrigger>
                <TabsTrigger value="form">{selectedDoctor ? "Edit Doctor" : "Create Doctor"}</TabsTrigger>
              </TabsList>
              
              <TabsContent value="list">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-4 px-4">Name</th>
                        <th className="text-left py-4 px-4">Specialty</th>
                        <th className="text-left py-4 px-4">Consultation Fee</th>
                        <th className="text-left py-4 px-4">Duration</th>
                        <th className="text-left py-4 px-4">Status</th>
                        <th className="text-left py-4 px-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doctors?.map((doctor) => (
                        <tr key={doctor.id} className="border-b">
                          <td className="py-4 px-4">
                            <div className="font-medium">{doctor.name}</div>
                            <div className="text-sm text-muted-foreground">
                              {doctor.username}
                            </div>
                          </td>
                          <td className="py-4 px-4">{doctor.specialty}</td>
                          <td className="py-4 px-4">
                            ${doctor.details?.consultationFee || "N/A"}
                          </td>
                          <td className="py-4 px-4">
                            {doctor.details?.consultationDuration || "N/A"} min
                          </td>
                          <td className="py-4 px-4">
                            {doctor.details?.isEnabled !== undefined ? (
                              doctor.details.isEnabled ? (
                                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                  Active
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                                  Inactive
                                </Badge>
                              )
                            ) : (
                              <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200">
                                Unknown
                              </Badge>
                            )}
                          </td>
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => handleEditClick(doctor)}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => handleToggleStatus(doctor.id, doctor.details?.isEnabled || false)}
                              >
                                {doctor.details?.isEnabled ? (
                                  <XCircle className="h-4 w-4 text-red-500" />
                                ) : (
                                  <CheckCircle className="h-4 w-4 text-green-500" />
                                )}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </TabsContent>
              
              <TabsContent value="form">
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-6">
                      <h3 className="text-lg font-medium">Basic Information</h3>
                      
                      <div className="space-y-2">
                        <Label htmlFor="name">Name</Label>
                        <Input
                          id="name"
                          name="name"
                          value={formData.user.name}
                          onChange={handleUserInputChange}
                          required
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="username">Username</Label>
                        <Input
                          id="username"
                          name="username"
                          value={formData.user.username}
                          onChange={handleUserInputChange}
                          required
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="specialty">Specialty</Label>
                        <Select
                          value={formData.user.specialty}
                          onValueChange={(value) => 
                            handleUserInputChange({
                              target: { name: "specialty", value },
                            } as any)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select specialty" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Cardiologist">Cardiologist</SelectItem>
                            <SelectItem value="Dermatologist">Dermatologist</SelectItem>
                            <SelectItem value="Pediatrician">Pediatrician</SelectItem>
                            <SelectItem value="Orthopedic Surgeon">Orthopedic Surgeon</SelectItem>
                            <SelectItem value="Neurologist">Neurologist</SelectItem>
                            <SelectItem value="Psychiatrist">Psychiatrist</SelectItem>
                            <SelectItem value="Gynecologist">Gynecologist</SelectItem>
                            <SelectItem value="General Practitioner">General Practitioner</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="clinicId">Clinic</Label>
                        <Select
                          value={(formData.user.clinicId || "").toString()}
                          onValueChange={(value) => 
                            handleUserInputChange({
                              target: { name: "clinicId", value },
                            } as any)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select clinic" />
                          </SelectTrigger>
                          <SelectContent>
                            {clinics?.map((clinic) => (
                              <SelectItem key={clinic.id} value={clinic.id.toString()}>
                                {clinic.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="bio">Bio</Label>
                        <Textarea
                          id="bio"
                          name="bio"
                          value={formData.user.bio}
                          onChange={handleUserInputChange}
                          rows={3}
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-6">
                      <h3 className="text-lg font-medium">Professional Details</h3>
                      
                      <div className="space-y-2">
                        <Label htmlFor="consultationFee">Consultation Fee ($)</Label>
                        <Input
                          id="consultationFee"
                          name="consultationFee"
                          type="number"
                          min="0"
                          value={formData.details.consultationFee}
                          onChange={handleDetailsInputChange}
                          required
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="consultationDuration">Consultation Duration (minutes)</Label>
                        <Input
                          id="consultationDuration"
                          name="consultationDuration"
                          type="number"
                          min="5"
                          value={formData.details.consultationDuration}
                          onChange={handleDetailsInputChange}
                          required
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="qualifications">Qualifications</Label>
                        <Textarea
                          id="qualifications"
                          name="qualifications"
                          value={formData.details.qualifications}
                          onChange={handleDetailsInputChange}
                          rows={3}
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="experience">Experience (years)</Label>
                        <Input
                          id="experience"
                          name="experience"
                          type="number"
                          min="0"
                          value={formData.details.experience}
                          onChange={handleDetailsInputChange}
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="registrationNumber">Registration Number</Label>
                        <Input
                          id="registrationNumber"
                          name="registrationNumber"
                          value={formData.details.registrationNumber}
                          onChange={handleDetailsInputChange}
                        />
                      </div>
                      
                      <div className="flex items-center space-x-2 pt-4">
                        <Switch
                          id="isEnabled"
                          checked={formData.details.isEnabled}
                          onCheckedChange={handleStatusChange}
                        />
                        <Label htmlFor="isEnabled">Active</Label>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex justify-end space-x-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={resetForm}
                    >
                      Cancel
                    </Button>
                    <Button type="submit">
                      {selectedDoctor ? (
                        <>
                          <Edit className="mr-2 h-4 w-4" />
                          Update Doctor
                        </>
                      ) : (
                        <>
                          <PlusCircle className="mr-2 h-4 w-4" />
                          Create Doctor
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </main>
    </div>
  );
} 