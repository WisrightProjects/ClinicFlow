import { useState, useEffect } from "react";
import { ClinicCard } from "@/components/clinic-card";
import { Input } from "@/components/ui/input";
import { Search, MapPin, Calendar, User, Stethoscope, ChevronDown, ChevronRight, Clock, Phone, Building2, Navigation, Loader2, Settings } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocation } from "wouter";
import React from "react";
import PatientFooter from "@/components/PatientFooter";
import { useNearbyClinics } from "@/hooks/use-nearby-clinics";
import { useGeolocation } from "@/hooks/use-geolocation";
import { useAppConfig } from "@/hooks/use-app-config";

export default function PatientDashboard() {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchType, setSearchType] = useState("all");
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [, setLocation] = useLocation();
  const [lastFetchedLocation, setLastFetchedLocation] = useState<{lat: number, lng: number} | null>(null);
  
  // Fetch admin configuration for nearby feature
  const { 
    nearbyEnabled: configNearbyEnabled, 
    nearbyRadius: configRadius,
    nearbyMaxRadius: configMaxRadius,
    nearbyFallbackEnabled: configFallback,
    isLoading: isLoadingConfig 
  } = useAppConfig();
  
  // Use admin config for nearby enabled state (user can still override with toggle)
  const [nearbyEnabled, setNearbyEnabled] = useState(false);
  
  // Initialize nearbyEnabled from config once loaded
  useEffect(() => {
    if (!isLoadingConfig && configNearbyEnabled) {
      setNearbyEnabled(true);
    }
  }, [isLoadingConfig, configNearbyEnabled]);

  // Geolocation hook - auto-request if nearby is enabled by config
  const {
    status: locationStatus,
    coordinates,
    requestLocation,
    error: locationError
  } = useGeolocation({ 
    autoRequest: Boolean(configNearbyEnabled && !isLoadingConfig),
    minAccuracy: 1000,
    maxAttempts: 2
  });

  // Nearby clinics hook - use configurable radius from admin settings
  const {
    clinics: nearbyClinics,
    loading: nearbyLoading,
    error: nearbyError,
    fetchClinics,
    count: nearbyCount
  } = useNearbyClinics({ 
    radius: configRadius // Use radius from admin config
  });

  // Fetch default data (all clinics) when page loads or as fallback
  const shouldFetchAllClinics = Boolean(
    !nearbyEnabled || 
    (nearbyEnabled && configFallback && (locationStatus === 'denied' || !!locationError))
  );
  
  const { data: defaultClinics = [], isLoading: isLoadingDefault } = useQuery({
    queryKey: ["clinics"],
    queryFn: async () => {
      const response = await fetch("/api/clinics");
      if (!response.ok) throw new Error('Failed to fetch clinics');
      return response.json();
    },
    enabled: shouldFetchAllClinics
  });

  // Fetch search results based on search term and type (works independently from nearby)
  const { data: searchResults = [], isLoading: isLoadingSearch, error } = useQuery({
    queryKey: ["search", searchTerm, searchType, coordinates?.latitude, coordinates?.longitude],
    queryFn: async () => {
      if (!searchTerm.trim()) return [];
      
      const params = new URLSearchParams({
        q: searchTerm,
        type: searchType
      });
      
      // Add user location if available for distance-based sorting
      if (coordinates) {
        params.append('lat', coordinates.latitude.toString());
        params.append('lng', coordinates.longitude.toString());
      }
      
      const response = await fetch(`/api/search?${params}`);
      if (!response.ok) {
        throw new Error('Search failed');
      }
      return response.json();
    },
    enabled: !!searchTerm.trim(), // Always enabled when there's a search term
  });

  // Fetch doctors for each nearby clinic to enable doctor/specialty search
  const { data: nearbyDoctorsData = [] } = useQuery({
    queryKey: ["nearby-doctors", nearbyClinics.map(c => c.id).join(',')],
    queryFn: async () => {
      if (nearbyClinics.length === 0) return [];
      
      // Fetch doctors for all nearby clinics
      const promises = nearbyClinics.map(async (clinic) => {
        try {
          const response = await fetch(`/api/clinics/${clinic.id}/doctors`);
          if (!response.ok) return { clinicId: clinic.id, doctors: [] };
          const doctors = await response.json();
          return { clinicId: clinic.id, doctors };
        } catch (error) {
          console.error(`Failed to fetch doctors for clinic ${clinic.id}:`, error);
          return { clinicId: clinic.id, doctors: [] };
        }
      });
      
      return Promise.all(promises);
    },
    enabled: nearbyEnabled && nearbyClinics.length > 0,
  });

  // Determine if we should show search results or nearby clinics
  const hasSearchQuery = !!searchTerm.trim();
  
  // When searching with nearby enabled, combine nearby + database results
  const combinedSearchResults = React.useMemo(() => {
    if (!hasSearchQuery) return [];
    
    // If nearby is enabled and we have location, filter nearby clinics by search
    if (nearbyEnabled && coordinates && nearbyClinics.length > 0) {
      const searchLower = searchTerm.toLowerCase();
      
      // Prioritize doctor/specialty searches - show DB results first
      const hasDoctorOrSpecialtyResults = (searchResults || []).some((r: any) => 
        r.type === 'doctor' || r.type === 'specialty'
      );
      
      // If searching for doctors/specialties, show DB results first
      if (hasDoctorOrSpecialtyResults) {
        return searchResults || [];
      }
      
      // Filter nearby clinics that match search
      const matchingNearbyClinics = nearbyClinics.filter((clinic) => {
        if (clinic.name.toLowerCase().includes(searchLower)) return true;
        if (clinic.city.toLowerCase().includes(searchLower)) return true;
        if (clinic.address.toLowerCase().includes(searchLower)) return true;
        
        // Check doctors in nearby clinics
        const clinicDoctors = nearbyDoctorsData.find(d => d.clinicId === clinic.id);
        if (clinicDoctors?.doctors) {
          return clinicDoctors.doctors.some((doctor: any) => {
            return doctor.name?.toLowerCase().includes(searchLower) ||
                   doctor.specialty?.toLowerCase().includes(searchLower);
          });
        }
        return false;
      }).map(clinic => ({
        ...clinic,
        isNearby: true,
        type: 'nearby-clinic'
      }));
      
      // Get clinic IDs that are already in nearby results
      const nearbyClinicIds = new Set(matchingNearbyClinics.map(c => c.id));
      
      // Add database search results that are NOT in nearby results
      const additionalResults = (searchResults || []).filter((result: any) => {
        // For clinic/hospital results, check if not already in nearby
        if ((result.type === 'hospital' || result.type === 'city') && result.clinicId) {
          return !nearbyClinicIds.has(result.clinicId);
        }
        // For specialty results, check if clinic is not in nearby
        if (result.type === 'specialty' && result.clinicId) {
          return !nearbyClinicIds.has(result.clinicId);
        }
        // For doctor results, check if their clinic is not in nearby
        if (result.type === 'doctor' && result.clinicId) {
          return !nearbyClinicIds.has(result.clinicId);
        }
        // Include other result types that don't have clinicId
        return true;
      });
      
      // Return nearby results first, then additional DB results
      return [
        ...matchingNearbyClinics,
        ...additionalResults
      ];
    }
    
    // If nearby is disabled or no location, just return database search results
    return searchResults || [];
  }, [hasSearchQuery, searchTerm, nearbyEnabled, coordinates, nearbyClinics, nearbyDoctorsData, searchResults]);

  // Handle nearby toggle
  const handleNearbyToggle = (checked: boolean) => {
    setNearbyEnabled(checked);
    
    if (checked) {
      // Don't clear search - allow filtering nearby results
      // Request location if not already available
      if (!coordinates) {
        requestLocation();
      } else if (coordinates) {
        // If we already have coordinates, fetch nearby clinics
        const hasLocationChanged = !lastFetchedLocation || 
          Math.abs(coordinates.latitude - lastFetchedLocation.lat) > 0.001 ||
          Math.abs(coordinates.longitude - lastFetchedLocation.lng) > 0.001;
        
        if (hasLocationChanged) {
          fetchClinics(coordinates.latitude, coordinates.longitude, configRadius);
          setLastFetchedLocation({ lat: coordinates.latitude, lng: coordinates.longitude });
        }
      }
    }
  };

  // Fetch nearby clinics when location is detected and nearby is enabled
  useEffect(() => {
    if (nearbyEnabled && coordinates && locationStatus === 'granted') {
      const hasLocationChanged = !lastFetchedLocation || 
        Math.abs(coordinates.latitude - lastFetchedLocation.lat) > 0.001 ||
        Math.abs(coordinates.longitude - lastFetchedLocation.lng) > 0.001;
      
      if (hasLocationChanged) {
        console.log('🗺️ Fetching nearby clinics for location:', coordinates);
        fetchClinics(coordinates.latitude, coordinates.longitude, configRadius);
        setLastFetchedLocation({ lat: coordinates.latitude, lng: coordinates.longitude });
      }
    }
  }, [coordinates, locationStatus, nearbyEnabled, configRadius]);

  const toggleExpanded = (id: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedItems(newExpanded);
  };

  const getSearchPlaceholder = () => {
    if (nearbyEnabled) {
      return "Search nearby clinics, doctors, or specialties...";
    }
    
    switch (searchType) {
      case "city":
        return "Enter your city (e.g., Chennai, Mumbai, Delhi)...";
      case "hospital":
        return "Search hospital or clinic name...";
      case "doctor":
        return "Find doctors by name...";
      case "specialty":
        return "Search by medical specialty (e.g., Cardiology, Dermatology)...";
      default:
        return "Search doctors, hospitals, specialties, or locations...";
    }
  };

  const handleBookAppointment = (doctorId: number, scheduleId: number, clinicId: number) => {
    setLocation(`/book/${doctorId}?scheduleId=${scheduleId}&clinicId=${clinicId}`);
  };

  const ScheduleCard = ({ schedule, doctorId, doctorName }: {
    schedule: any;
    doctorId: number;
    doctorName: string;
  }) => {
    // Booking only opens once the attender flips "Start Booking" (isActive).
    // A schedule can be visible (isVisible) yet not bookable; show it but block
    // booking, exactly like the View Doctors page.
    const bookingNotStarted = schedule.isActive === false;

    // Block booking once today's schedule end time has passed. The Search card was
    // meant to match the View Doctors page (patient-clinic-details.tsx) but only
    // copied the "booking not started" check, so an ended schedule still showed an
    // enabled "Book Token" button here while View Doctors correctly disabled it.
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

    const isBookable =
      !bookingNotStarted &&
      !isEndTimePassed &&
      schedule.bookingStatus === 'open' &&
      schedule.availableSlots !== 0;

    return (
    <div className="p-3 bg-gray-50 rounded text-sm">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="h-4 w-4 text-gray-600" />
            <span className="font-medium">{schedule.startTime} - {schedule.endTime}</span>
            <Badge
              size="sm"
              variant={bookingNotStarted ? 'destructive' : isEndTimePassed ? 'secondary' : schedule.bookingStatus === 'open' ? 'default' : 'secondary'}
            >
              {bookingNotStarted ? 'Booking Not Started' : isEndTimePassed ? 'Ended' : schedule.bookingStatus}
            </Badge>
          </div>
          
          {schedule.clinicName && (
            <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
              <Building2 className="h-3 w-3" />
              <span>{schedule.clinicName}</span>
            </div>
          )}
          
          <div className="flex items-center gap-4 text-xs text-gray-600">
            <span>Max: {schedule.maxTokens || 'Unlimited'}</span>
            {schedule.availableSlots !== null && (
              <span>Available: {schedule.availableSlots}</span>
            )}
            <span>Time: {schedule.averageConsultationTime || 15} min</span>
          </div>
        </div>
        
        <Button
          size="sm"
          className="ml-3"
          onClick={() => handleBookAppointment(doctorId, schedule.id, schedule.clinicId)}
          disabled={!isBookable}
        >
          Book Token
        </Button>
      </div>
    </div>
    );
  };

  const ClinicDoctorsView = ({ clinicId }: { clinicId: number }) => {
    const { data: doctors = [], isLoading } = useQuery({
      queryKey: ["clinic-doctors", clinicId],
      queryFn: async () => {
        const response = await fetch(`/api/clinics/${clinicId}/doctors-with-schedules`);
        if (!response.ok) throw new Error('Failed to fetch doctors');
        return response.json();
      }
    });

    if (isLoading) {
      return <p className="text-gray-500 text-sm">Loading doctors...</p>;
    }

    if (doctors.length === 0) {
      return (
        <div className="text-center py-8">
          <User className="h-12 w-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-500 font-medium mb-2">No Doctors Available</p>
          <p className="text-sm text-gray-400">This hospital currently has no doctors with available schedules</p>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {doctors.map((doctor: any) => (
          <Card key={doctor.id} className="border-l-4 border-l-blue-500 cursor-pointer hover:bg-gray-50"
            onClick={() => toggleExpanded(`clinic-doctor-${doctor.id}`)}>
            <CardContent className="p-3">
              <div className="flex items-center gap-3">
                <User className="h-8 w-8 text-blue-600" />
                <div className="flex-1">
                  <p className="font-medium">{doctor.name}</p>
                  <p className="text-sm text-gray-600">{doctor.specialty}</p>
                </div>
              </div>
              {expandedItems.has(`clinic-doctor-${doctor.id}`) && doctor.schedules?.length > 0 && (
                <div className="mt-3 space-y-2">
                  {doctor.schedules.map((schedule: any) => (
                    <ScheduleCard 
                      key={schedule.id} 
                      schedule={schedule} 
                      doctorId={doctor.id} 
                      doctorName={doctor.name}
                    />
                  ))}
                </div>
              )}
              {expandedItems.has(`clinic-doctor-${doctor.id}`) && (!doctor.schedules || doctor.schedules.length === 0) && (
                <div className="mt-3 text-center py-4 text-gray-500">
                  <Calendar className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm font-medium">No Schedules Today</p>
                  <p className="text-xs text-gray-400">This doctor has no available schedules for today</p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    );
  };

  // Render combined search results (nearby + database)
  const renderCombinedSearchResults = () => {
    if (!combinedSearchResults?.length) return null;

    return combinedSearchResults.map((result: any) => {
      // Handle nearby clinic results (with distance)
      if (result.type === 'nearby-clinic') {
        const isExpanded = expandedItems.has(`nearby-clinic-${result.id}`);
        const clinicDoctors = nearbyDoctorsData.find(d => d.clinicId === result.id);
        
        return (
          <Card key={`nearby-${result.id}`} className="mb-4 border-l-4 border-l-green-500">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1">
                  <Building2 className="h-6 w-6 text-green-600" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <CardTitle className="text-lg">{result.name}</CardTitle>
                      <Badge className="bg-green-600 text-white text-xs">
                        ~{result.distance.toFixed(1)} km (aerial)
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">{result.address}, {result.city}</p>
                    {clinicDoctors?.doctors && clinicDoctors.doctors.length > 0 && (
                      <Badge variant="secondary" className="mt-1 text-xs">
                        {clinicDoctors.doctors.length} doctor{clinicDoctors.doctors.length !== 1 ? 's' : ''}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {result.latitude && result.longitude && (
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${result.latitude},${result.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Navigation className="mr-1 h-3 w-3" />
                        Directions
                      </a>
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleExpanded(`nearby-clinic-${result.id}`)}
                  >
                    {isExpanded ? <ChevronDown /> : <ChevronRight />}
                  </Button>
                </div>
              </div>
            </CardHeader>
            {isExpanded && (
              <CardContent className="pt-0">
                <ClinicDoctorsView clinicId={result.id} />
              </CardContent>
            )}
          </Card>
        );
      }
      
      // Handle regular database search results (existing logic)
      const isExpanded = expandedItems.has(result.id);
      
      if (result.type === 'city') {
        return (
          <Card key={result.id} className="mb-4">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-blue-600" />
                  <CardTitle className="text-lg">{result.city}</CardTitle>
                  <Badge variant="secondary">{result.hospitalCount} hospitals</Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleExpanded(result.id)}
                >
                  {isExpanded ? <ChevronDown /> : <ChevronRight />}
                </Button>
              </div>
            </CardHeader>
            {isExpanded && (
              <CardContent className="pt-0">
                <ClinicDoctorsView clinicId={result.clinicId} />
              </CardContent>
            )}
          </Card>
        );
      }

      if (result.type === 'hospital' || result.type === 'specialty') {
        return (
          <Card key={result.id} className="mb-4">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  {result.type === 'specialty' ? (
                    <Stethoscope className="h-5 w-5 text-purple-600" />
                  ) : (
                    <Building2 className="h-5 w-5 text-green-600" />
                  )}
                  <CardTitle className="text-lg">{result.name}</CardTitle>
                  {result.distance !== null && result.distance !== undefined && (
                    <Badge className="bg-green-600 text-white text-xs">
                      ~{result.distance.toFixed(1)} km (aerial)
                    </Badge>
                  )}
                  {result.type === 'specialty' && (
                    <Badge variant="secondary">{result.specialty} specialists</Badge>
                  )}
                  {result.doctors && (
                    <Badge variant="secondary">{result.doctors.length} doctors</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {result.latitude && result.longitude && (
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${result.latitude},${result.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Navigation className="mr-1 h-3 w-3" />
                        Directions
                      </a>
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleExpanded(result.id)}
                  >
                    {isExpanded ? <ChevronDown /> : <ChevronRight />}
                  </Button>
                </div>
              </div>
            </CardHeader>
            {isExpanded && result.doctors && (
              <CardContent className="pt-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {result.doctors.map((doctor: any) => (
                    <Card key={doctor.id} className="border-l-4 border-l-blue-500 cursor-pointer hover:bg-gray-50"
                      onClick={() => toggleExpanded(`doctor-${doctor.id}`)}>
                      <CardContent className="p-3">
                        <div className="flex items-center gap-3">
                          <User className="h-8 w-8 text-blue-600" />
                          <div className="flex-1">
                            <p className="font-medium">{doctor.name}</p>
                            <p className="text-sm text-gray-600">{doctor.specialty}</p>
                          </div>
                        </div>
                        {expandedItems.has(`doctor-${doctor.id}`) && doctor.schedules?.length > 0 && (
                          <div className="mt-3 space-y-2">
                            {doctor.schedules.map((schedule: any) => (
                              <ScheduleCard 
                                key={schedule.id} 
                                schedule={schedule} 
                                doctorId={doctor.id} 
                                doctorName={doctor.name}
                              />
                            ))}
                          </div>
                        )}
                        {expandedItems.has(`doctor-${doctor.id}`) && (!doctor.schedules || doctor.schedules.length === 0) && (
                          <div className="mt-3 text-center py-4 text-gray-500">
                            <Calendar className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                            <p className="text-sm font-medium">No Schedules Today</p>
                            <p className="text-xs text-gray-400">This doctor has no available schedules for today</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        );
      }

      if (result.type === 'doctor') {
        return (
          <Card key={result.id} className="mb-4 cursor-pointer hover:bg-gray-50"
            onClick={() => toggleExpanded(result.id)}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <User className="h-10 w-10 text-blue-600" />
                  <div>
                    <CardTitle className="text-lg">{result.name}</CardTitle>
                    <p className="text-sm text-gray-600">{result.specialty}</p>
                    {result.hospitalName && (
                      <p className="text-sm text-gray-500">at {result.hospitalName}</p>
                    )}
                  </div>
                </div>
                <Button variant="ghost" size="sm">
                  {isExpanded ? <ChevronDown /> : <ChevronRight />}
                  Schedules
                </Button>
              </div>
            </CardHeader>
            {isExpanded && result.schedules?.length > 0 && (
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {result.schedules.map((schedule: any) => (
                    <ScheduleCard 
                      key={schedule.id} 
                      schedule={schedule} 
                      doctorId={result.doctorId} 
                      doctorName={result.name}
                    />
                  ))}
                </div>
              </CardContent>
            )}
            {isExpanded && (!result.schedules || result.schedules.length === 0) && (
              <CardContent className="pt-0">
                <div className="text-center py-8 text-gray-500">
                  <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                  <p className="font-medium mb-2">No Schedules Today</p>
                  <p className="text-sm text-gray-400">This doctor has no available schedules for today</p>
                </div>
              </CardContent>
            )}
          </Card>
        );
      }

      return null;
    });
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Main Content */}
      <div className="flex-1">
        <div className="container mx-auto py-8 px-4">
          <h1 className="text-2xl sm:text-3xl font-bold mb-6">Find Healthcare Near You</h1>
      
      {/* Enhanced Search Section */}
      <div className="flex flex-col gap-4 mb-8">
        {/* Search and Filters Row */}
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder={getSearchPlaceholder()}
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <Select value={searchType} onValueChange={setSearchType}>
            <SelectTrigger className="w-full md:w-48">
              <SelectValue placeholder="Search type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="city">By City</SelectItem>
              <SelectItem value="hospital">By Hospital</SelectItem>
              <SelectItem value="doctor">By Doctor</SelectItem>
              <SelectItem value="specialty">By Specialty</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Auto-Nearby Info Banner - Commented out as admin controls this feature */}
        {/* {configNearbyEnabled && !isLoadingConfig && (
          <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg text-sm">
            <Settings className="h-4 w-4 text-green-600" />
            <p className="text-green-800">
              <strong>Auto-Nearby Mode:</strong> Nearby clinics feature is enabled by default to help you find healthcare near you.
            </p>
          </div>
        )} */}

        {/* Nearby Toggle - Commented out as admin controls this feature */}
        {/* <div className="flex items-center justify-between p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center gap-3">
            <Navigation className="h-5 w-5 text-blue-600" />
            <div>
              <Label htmlFor="nearby-toggle" className="text-base font-medium cursor-pointer">
                Show Nearby Clinics Only
              </Label>
              <p className="text-sm text-muted-foreground">
                Find clinics within {configRadius} km of your location
              </p>
            </div>
          </div>
          <Switch 
            id="nearby-toggle"
            checked={nearbyEnabled}
            onCheckedChange={handleNearbyToggle}
          />
        </div> */}

        {/* Location Status */}
        {nearbyEnabled && (
          <div className="space-y-2">
            {locationStatus === 'requesting' && (
              <div className="flex items-center gap-2 text-sm text-yellow-600 bg-yellow-50 p-3 rounded-md">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Getting your location...</span>
              </div>
            )}
            
            {locationStatus === 'denied' && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-md">
                <MapPin className="h-4 w-4" />
                <span>Location access denied. Please enable location permissions to use this feature.</span>
              </div>
            )}
            
            {locationStatus === 'error' && locationError && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-md">
                <MapPin className="h-4 w-4" />
                <span>{locationError}</span>
              </div>
            )}
            
            {locationStatus === 'granted' && coordinates && (
              <div className="flex items-center justify-between text-sm text-green-600 bg-green-50 p-3 rounded-md">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  <span>
                    Location detected • Found {nearbyCount} clinic{nearbyCount !== 1 ? 's' : ''} within {configRadius} km
                  </span>
                </div>
                {coordinates.accuracy && (
                  <Badge variant="secondary" className="text-xs">
                    ±{Math.round(coordinates.accuracy)}m accuracy
                  </Badge>
                )}
              </div>
            )}
            
            {nearbyLoading && (
              <div className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 p-3 rounded-md">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Searching for nearby clinics...</span>
              </div>
            )}
            
            {nearbyError && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-md">
                <MapPin className="h-4 w-4" />
                <span>{nearbyError}</span>
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Search Results or Default Content */}
      {isLoadingSearch && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">Searching...</p>
        </div>
      )}
      
      {error && (
        <div className="text-center py-12">
          <p className="text-red-500">Search failed. Please try again.</p>
        </div>
      )}
      
      {/* Show search results when user is searching, regardless of nearby mode */}
      {hasSearchQuery ? (
        // Search results view
        <>
          {isLoadingSearch && (
            <div className="text-center py-12">
              <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-blue-600" />
              <p className="text-muted-foreground">Searching...</p>
            </div>
          )}
          
          {!isLoadingSearch && combinedSearchResults?.length > 0 && (
            <>
              {nearbyEnabled && coordinates && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-blue-800">
                    <strong>Smart Search:</strong> Showing nearby matches first, followed by all other results from database
                  </p>
                </div>
              )}
              <div className="space-y-4">
                {renderCombinedSearchResults()}
              </div>
            </>
          )}
          
          {!isLoadingSearch && combinedSearchResults?.length === 0 && (
            <div className="text-center py-12">
              <Building2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground mb-2">No results found for "{searchTerm}"</p>
              <p className="text-sm text-gray-500">Try a different search term or check spelling</p>
            </div>
          )}
        </>
      ) : nearbyEnabled ? (
        // Nearby clinics view (when not searching)
        <>
          {nearbyLoading || locationStatus === 'requesting' ? (
            <div className="text-center py-12">
              <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-blue-600" />
              <p className="text-muted-foreground">
                {locationStatus === 'requesting' ? 'Getting your location...' : 'Loading nearby clinics...'}
              </p>
            </div>
          ) : locationStatus === 'denied' || locationStatus === 'error' ? (
            configFallback ? (
              // Show all clinics as fallback
              <>
                <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="flex items-center gap-3">
                    <MapPin className="h-5 w-5 text-yellow-600" />
                    <div>
                      <p className="text-sm font-medium text-yellow-800">Location unavailable</p>
                      <p className="text-xs text-yellow-700 mt-1">
                        Showing all available clinics instead. Enable location access for nearby results.
                      </p>
                    </div>
                    <Button onClick={requestLocation} variant="outline" size="sm" className="ml-auto">
                      <Navigation className="mr-2 h-4 w-4" />
                      Try Again
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(defaultClinics || []).map((clinic: any) => (
                    <ClinicCard key={clinic.id} clinic={clinic} />
                  ))}
                </div>
              </>
            ) : (
              <div className="text-center py-12">
                <MapPin className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground mb-4">
                  Unable to access your location
                </p>
                <Button onClick={requestLocation} variant="outline">
                  <Navigation className="mr-2 h-4 w-4" />
                  Try Again
                </Button>
              </div>
            )
          ) : nearbyClinics.length === 0 ? (
            <div className="text-center py-12">
              <Building2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              {configFallback ? (
                <>
                  <p className="text-muted-foreground">No clinics found within {configRadius} km of your location.</p>
                  <p className="text-sm text-muted-foreground mt-2">Showing all available clinics instead.</p>
                </>
              ) : (
                <>
                  <p className="text-muted-foreground">No clinics found within {configRadius} km of your location.</p>
                  <p className="text-sm text-muted-foreground mt-2">Try disabling the nearby filter to see all clinics.</p>
                </>
              )}
            </div>
          ) : (
            // Card grid view when no search term
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {nearbyClinics.map((clinic) => (
                <div key={clinic.id} className="relative">
                  <ClinicCard clinic={{
                    id: clinic.id.toString(),
                    name: clinic.name,
                    address: [clinic.address, clinic.city].filter(Boolean).join(', ') || null,
                    imageUrl: clinic.imageUrl || undefined,
                    specialties: [],
                    latitude: clinic.latitude,
                    longitude: clinic.longitude,
                  }} />
                  <Badge 
                    className="absolute top-2 right-2 bg-green-600 text-white"
                  >
                    ~{clinic.distance.toFixed(1)} km (aerial)
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        // Default content - show all clinics when nearby is disabled and not searching
        <>
          {isLoadingDefault ? (
            <div className="text-center py-12">
              <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-blue-600" />
              <p className="text-muted-foreground">Loading clinics...</p>
            </div>
          ) : defaultClinics.length === 0 ? (
            <div className="text-center py-12">
              <Building2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">No clinics found.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {defaultClinics.map((clinic) => (
                <ClinicCard key={clinic.id} clinic={clinic} />
              ))}
            </div>
          )}
        </>
      )}
        </div>
      </div>
      
      {/* Footer */}
      <PatientFooter />
    </div>
  );
}