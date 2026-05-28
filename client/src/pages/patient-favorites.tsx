import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Star, Calendar, Clock, MapPin, Trash2, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { NavHeader } from "@/components/nav-header";
import { NavigationButtons } from "@/components/navigation-buttons";

export default function PatientFavorites() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [_, navigate] = useLocation();

  // Fetch patient's favorite schedules
  const { data: favorites = [], isLoading, error } = useQuery({
    queryKey: ["favorites", "schedules"],
    queryFn: async () => {
      const response = await fetch('/api/favorites/schedules');
      if (!response.ok) {
        throw new Error('Failed to fetch favorites');
      }
      return response.json();
    },
    enabled: !!user && user.role === 'patient',
  });

  // Remove favorite mutation
  const removeFavoriteMutation = useMutation({
    mutationFn: async (scheduleId: number) => {
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["favorites", "schedules"] });
      toast({
        title: "Success",
        description: "Removed from favorites successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to remove from favorites. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleRemoveFavorite = (scheduleId: number) => {
    removeFavoriteMutation.mutate(scheduleId);
  };

  const handleBookAppointment = (doctorId: number, clinicId: number) => {
    navigate(`/patient/clinics/${clinicId}`);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  const formatTime = (timeString: string) => {
    const [hours, minutes] = timeString.split(':');
    const hour24 = parseInt(hours);
    const hour12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;
    const ampm = hour24 >= 12 ? 'PM' : 'AM';
    return `${hour12}:${minutes} ${ampm}`;
  };

  if (!user || user.role !== 'patient') {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavHeader />
        <main className="container mx-auto py-8 px-4">
          <div className="text-center py-12">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">Access Denied</h1>
            <p className="text-gray-600">You must be logged in as a patient to view favorites.</p>
          </div>
        </main>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavHeader />
        <main className="container mx-auto py-8 px-4">
          <div className="text-center py-12">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground">Loading your favorites...</p>
          </div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavHeader />
        <main className="container mx-auto py-8 px-4">
          <div className="text-center py-12">
            <p className="text-red-500">Error loading favorites. Please try again later.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavHeader />
      <main className="container mx-auto py-8 px-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <div className="flex-1">
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            <Star className="h-7 w-7 text-yellow-400 fill-yellow-400" />
            My Favorite Schedules
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage your favorite doctor schedules. You'll get notified when they become available for booking.
          </p>
        </div>
        <NavigationButtons />
      </div>

      {favorites.length === 0 ? (
        <div className="text-center py-12">
          <Star className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-medium text-gray-900 mb-2">No favorites yet</h3>
          <p className="text-gray-600 mb-4">
            Start adding doctors to your favorites to get notified when their schedules become available.
          </p>
          <Button onClick={() => navigate('/')}>
            Browse Doctors
          </Button>
        </div>
      ) : (
        <div className="grid gap-6">
          {favorites.map((favorite: any) => (
            <Card key={favorite.id} className="overflow-hidden">
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={favorite.doctor.imageUrl} alt={favorite.doctor.name} />
                      <AvatarFallback>
                        {favorite.doctor.name.split(" ").map((n: string) => n[0]).join("")}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <CardTitle className="text-lg">{favorite.doctor.name}</CardTitle>
                      <p className="text-sm text-muted-foreground">{favorite.doctor.specialty}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveFavorite(favorite.scheduleId)}
                    disabled={removeFavoriteMutation.isPending}
                    className="text-red-500 hover:text-red-700"
                  >
                    {removeFavoriteMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </CardHeader>
              
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span>{formatDate(favorite.schedule.date)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span>
                      {formatTime(favorite.schedule.startTime)} - {formatTime(favorite.schedule.endTime)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span>{favorite.clinic.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={favorite.schedule.isActive ? "default" : "secondary"}>
                      {favorite.schedule.isActive ? "Active" : "Inactive"}
                    </Badge>
                    {favorite.schedule.maxTokens && (
                      <Badge variant="outline">
                        Max {favorite.schedule.maxTokens} slots
                      </Badge>
                    )}
                  </div>
                </div>
                
                <div className="flex justify-end">
                  <Button 
                    onClick={() => handleBookAppointment(favorite.doctorId, favorite.clinicId)}
                    disabled={!favorite.schedule.isActive}
                  >
                    {favorite.schedule.isActive ? 'Book Appointment' : 'Schedule Not Available'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      </main>
    </div>
  );
}