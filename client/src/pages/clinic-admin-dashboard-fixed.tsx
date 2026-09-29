import React from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Redirect, useLocation, useRoute } from 'wouter';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  Building2, 
  Users, 
  Calendar, 
  Clock, 
  Edit, 
  Phone, 
  Mail, 
  MapPin, 
  CheckCircle2, 
  XCircle,
  AlertCircle,
  User,
  UserCheck,
  Loader2
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/queryClient';
import { useToast } from '../hooks/use-toast';

// Define interfaces for the data types
interface Clinic {
  id: number;
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string;
  email: string;
  openingHours: string;
  description?: string;
  imageUrl?: string;
}

interface Doctor {
  id: number;
  name: string;
  username: string;
  specialty: string;
  bio?: string;
  imageUrl?: string;
  clinicId?: number;
  isPresent?: boolean;
  appointmentsToday?: number;
  completedToday?: number;
}

interface Attender {
  id: number;
  name: string;
  username: string;
  email: string;
  phone: string;
  clinicId?: number;
  isOnDuty?: boolean;
  assignedDoctors?: number[];
  imageUrl?: string | null;
}

interface Appointment {
  id: number;
  patientName: string;
  doctorId: number;
  doctorName: string;
  time: string;
  tokenNumber: number;
  status: string;
  isWalkIn: boolean;
}

interface TodayStats {
  scheduled: number;
  completed: number;
  cancelled: number;
}

export default function ClinicAdminDashboard() {
  const { user } = useAuth();
  const [_, navigate] = useLocation();
  const [match, params] = useRoute<{ id: string }>("/clinic-admin/:id");
  const { toast } = useToast();
  
  // Fetch clinic details
  const { 
    data: clinicData = {
      id: 0,
      name: '',
      address: '',
      city: '',
      state: '',
      zipCode: '',
      phone: '',
      email: '',
      openingHours: '',
    }, 
    isLoading: isClinicLoading, 
    isError: isClinicError 
  } = useQuery<Clinic>({ 
    queryKey: ['clinic', params?.id || user?.clinicId], 
    queryFn: async () => { 
      const clinicId = params?.id || user?.clinicId; 
      if (!clinicId) return null; 
      const res = await apiRequest('GET', `/api/clinics/${clinicId}`); 
      return await res.json(); 
    }, 
    enabled: !!(params?.id || user?.clinicId), 
  });

  // Fetch today's stats
  const { 
    data: todayStats = { scheduled: 0, completed: 0, cancelled: 0 }, 
    isLoading: isStatsLoading, 
    isError: isStatsError 
  } = useQuery<TodayStats>({ 
    queryKey: ['clinic-stats', params?.id || user?.clinicId], 
    queryFn: async () => { 
      const clinicId = params?.id || user?.clinicId; 
      if (!clinicId) return { scheduled: 0, completed: 0, cancelled: 0 }; 
      const res = await apiRequest('GET', `/api/clinics/${clinicId}/stats/today`); 
      return await res.json(); 
    }, 
    enabled: !!(params?.id || user?.clinicId), 
  });

  // Fetch doctors for this clinic
  const { 
    data: doctors = [], 
    isLoading: isDoctorsLoading, 
    isError: isDoctorsError 
  } = useQuery<Doctor[]>({ 
    queryKey: ['clinic-doctors', params?.id || user?.clinicId], 
    queryFn: async () => { 
      const clinicId = params?.id || user?.clinicId; 
      if (!clinicId) return []; 
      const res = await apiRequest('GET', `/api/clinics/${clinicId}/doctors`); 
      return await res.json(); 
    }, 
    enabled: !!(params?.id || user?.clinicId), 
    refetchOnMount: 'always',  // Always refetch when component mounts
    staleTime: 0,              // Consider data stale immediately
  });

  // Fetch attenders for this clinic
  const { 
    data: attenders = [], 
    isLoading: isAttendersLoading, 
    isError: isAttendersError 
  } = useQuery<Attender[]>({ 
    queryKey: ['clinic-attenders', params?.id || user?.clinicId], 
    queryFn: async () => { 
      const clinicId = params?.id || user?.clinicId; 
      if (!clinicId) return []; 
      const res = await apiRequest('GET', `/api/attenders?clinicId=${clinicId}`); 
      return await res.json(); 
    }, 
    enabled: !!(params?.id || user?.clinicId), 
  });

  // Fetch appointments for today
  const { 
    data: appointments = [], 
    isLoading: isAppointmentsLoading, 
    isError: isAppointmentsError 
  } = useQuery<Appointment[]>({ 
    queryKey: ['clinic-appointments', params?.id || user?.clinicId], 
    queryFn: async () => { 
      const clinicId = params?.id || user?.clinicId; 
      if (!clinicId) return []; 
      const res = await apiRequest('GET', `/api/clinics/${clinicId}/appointments/today`); 
      return await res.json(); 
    }, 
    enabled: !!(params?.id || user?.clinicId), 
    refetchOnMount: 'always',  // Always refetch when component mounts
    staleTime: 0,              // Consider data stale immediately
  });

  // Loading state
  if (isClinicLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">Loading clinic information...</span>
      </div>
    );
  }

  // Critical error - only if clinic data fails to load
  if (isClinicError) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-bold text-red-600">Error loading clinic information</h2>
          <p className="mt-2">There was a problem fetching the data. Please try again later.</p>
          <Button className="mt-4" onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </div>
    );
  }
  
  // No need for redirects as this component will only be rendered for clinic admins
  // from the home page

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Clinic Admin Dashboard</h1>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="staff">Staff</TabsTrigger>
          <TabsTrigger value="appointments">Appointments</TabsTrigger>
        </TabsList>

        {/* Clinic Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {isStatsError && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-red-600">
                  <AlertCircle className="h-5 w-5" />
                  <p>Unable to load today's statistics. Some data may be missing.</p>
                  <Button variant="ghost" size="sm" onClick={() => window.location.reload()} className="ml-auto">Retry</Button>
                </div>
              </CardContent>
            </Card>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Clinic Details Card */}
            <Card className="md:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    {clinicData.name}
                  </CardTitle>
                  <CardDescription>Clinic Details</CardDescription>
                </div>
                <Button variant="outline" size="sm" className="flex items-center gap-1">
                  <Edit className="h-4 w-4" /> Edit
                </Button>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span>{clinicData.address}, {clinicData.city}, {clinicData.state} {clinicData.zipCode}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span>{clinicData.phone}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span>{clinicData.email}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span>{clinicData.openingHours}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Today's Stats Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Today's Stats
                </CardTitle>
                <CardDescription>
                  {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Scheduled</span>
                    <Badge variant="outline" className="bg-yellow-50 text-yellow-600">{todayStats.scheduled}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Completed</span>
                    <Badge variant="outline" className="bg-green-50 text-green-600">{todayStats.completed}</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Cancelled</span>
                    <Badge variant="outline" className="bg-red-50 text-red-600">{todayStats.cancelled}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Staff Management Tab */}
        <TabsContent value="staff" className="space-y-6">
          {isDoctorsError && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-red-600">
                  <AlertCircle className="h-5 w-5" />
                  <p>Unable to load doctors information. Please try again later.</p>
                  <Button variant="ghost" size="sm" onClick={() => window.location.reload()} className="ml-auto">Retry</Button>
                </div>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="flex items-center gap-2">
                  <UserCheck className="h-5 w-5" />
                  Doctors
                </CardTitle>
                <Button size="sm">Add Doctor</Button>
              </div>
              <CardDescription>Doctors associated with this clinic</CardDescription>
            </CardHeader>
            <CardContent>
              {isDoctorsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : (
                <div className="space-y-4">
                  {doctors.map((doctor) => (
                    <div key={doctor.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarImage src={doctor.imageUrl || undefined} />
                          <AvatarFallback>{doctor.name.substring(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{doctor.name}</p>
                          <p className="text-sm text-muted-foreground">{doctor.specialty}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-center">
                          <p className="text-sm text-muted-foreground">Appointments</p>
                          <p className="font-medium">{doctor.appointmentsToday || 0}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-sm text-muted-foreground">Completed</p>
                          <p className="font-medium">{doctor.completedToday || 0}</p>
                        </div>
                        {doctor.isPresent ? (
                          <Badge variant="outline" className="bg-green-50 text-green-600">Present</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-red-50 text-red-600">Absent</Badge>
                        )}
                        <Button variant="outline" size="sm">View</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {isAttendersError && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-red-600">
                  <AlertCircle className="h-5 w-5" />
                  <p>Unable to load attenders information. Please try again later.</p>
                  <Button variant="ghost" size="sm" onClick={() => window.location.reload()} className="ml-auto">Retry</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Attenders Section */}
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Attenders
                </CardTitle>
                <Button size="sm">Add Attender</Button>
              </div>
              <CardDescription>Attenders working at this clinic</CardDescription>
            </CardHeader>
            <CardContent>
              {isAttendersLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : (
                <div className="space-y-4">
                  {attenders.map((attender) => (
                    <div key={attender.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarImage src={attender.imageUrl || undefined} />
                          <AvatarFallback>{attender.name.substring(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{attender.name}</p>
                          <p className="text-sm text-muted-foreground">
                            Supporting {attender.assignedDoctors?.length || 0} doctor{(attender.assignedDoctors?.length || 0) !== 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        {attender.isOnDuty === true ? (
                          <Badge variant="outline" className="bg-green-50 text-green-600">On Duty</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-gray-50 text-gray-600">Off Duty</Badge>
                        )}
                        <Button variant="outline" size="sm">Manage</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Appointments Tab */}
        <TabsContent value="appointments" className="space-y-6">
          {isAppointmentsError && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-red-600">
                  <AlertCircle className="h-5 w-5" />
                  <p>Unable to load appointment information. Please try again later.</p>
                  <Button variant="ghost" size="sm" onClick={() => window.location.reload()} className="ml-auto">Retry</Button>
                </div>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Today's Appointments
                </CardTitle>
                <Button size="sm">Add Walk-in</Button>
              </div>
              <CardDescription>Manage today's appointments and walk-ins</CardDescription>
            </CardHeader>
            <CardContent>
              {isAppointmentsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : (
                <div className="space-y-4">
                  {appointments.map((appointment) => (
                    <div key={appointment.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarFallback>{appointment.patientName.substring(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{appointment.patientName}</p>
                            {appointment.isWalkIn && (
                              <Badge variant="outline" className="text-purple-600 bg-purple-50">Walk-in</Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Token #{appointment.tokenNumber} • {appointment.time} • {appointment.doctorName}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {appointment.status === 'completed' && (
                          <Badge variant="outline" className="flex items-center gap-1 bg-green-50 text-green-600">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Completed
                          </Badge>
                        )}
                        {appointment.status === 'in-progress' && (
                          <Badge variant="outline" className="flex items-center gap-1 bg-blue-50 text-blue-600">
                            <Clock className="h-3.5 w-3.5" />
                            In Progress
                          </Badge>
                        )}
                        {appointment.status === 'scheduled' && (
                          <Badge variant="outline" className="flex items-center gap-1 bg-yellow-50 text-yellow-600">
                            <AlertCircle className="h-3.5 w-3.5" />
                            Scheduled
                          </Badge>
                        )}
                        {appointment.status === 'cancel' && (
                          <Badge variant="outline" className="flex items-center gap-1 bg-red-50 text-red-600">
                            <XCircle className="h-3.5 w-3.5" />
                            Cancelled
                          </Badge>
                        )}
                        <Button variant="outline" size="sm">Manage</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
