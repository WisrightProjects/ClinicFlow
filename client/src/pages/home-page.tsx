import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { User } from "@shared/schema";
import { NavHeader } from "@/components/nav-header";
import { SearchFilters } from "@/components/search-filters";
import { DoctorCard } from "@/components/doctor-card";
import { Skeleton } from "@/components/ui/skeleton";
import SuperAdminDashboard from "./super-admin-dashboard";
import React from "react";
import ClinicAdminDashboard from "./clinic-admin-dashboard";
import SimpleAttenderDashboard from "./simple-attender-dashboard";
import { useAuth } from "../hooks/use-auth";
import PatientDashboard from "./patient-dashboard";

export default function HomePage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [specialty, setSpecialty] = useState("");
  const { user, isLoading: isAuthLoading } = useAuth();

  const { data: doctors, isLoading } = useQuery<User[]>({
    // Specialty is a query param on /api/doctors — "all" (or empty) means no filter
    queryKey: [
      specialty && specialty !== "all"
        ? `/api/doctors?specialty=${encodeURIComponent(specialty)}`
        : "/api/doctors",
    ],
  });

  const filteredDoctors = doctors?.filter(doctor =>
    doctor.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Show search filters only for non-logged-in users, not for patients
  const shouldShowSearchFilters = !user;

  return (
    <div className="min-h-screen bg-gray-50">
      <NavHeader />
      
      {/* Show search filters only for patients or when no user is logged in */}
      {shouldShowSearchFilters && (
        <SearchFilters
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          specialty={specialty}
          onSpecialtyChange={setSpecialty}
        />
      )}
      
      {!user ? (
        // No user logged in - show the doctor list for everyone
        <main className="container mx-auto px-4 py-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {isLoading ? (
              Array(6).fill(0).map((_, i) => (
                <Skeleton key={i} className="h-[400px]" />
              ))
            ) : filteredDoctors?.length === 0 ? (
              <div className="col-span-full text-center py-12">
                <p className="text-lg text-muted-foreground">No doctors found</p>
              </div>
            ) : (
              filteredDoctors?.map((doctor) => (
                <DoctorCard key={doctor.id} doctor={doctor} />
              ))
            )}
          </div>
        </main>
      ) : (
        // User is logged in - show appropriate dashboard based on role
        <>
          {user.role === "super_admin" && <SuperAdminDashboard />}
          {(user.role === "clinic_admin" || user.role === "clinicadmin" || user.role === "hospital_admin") && <ClinicAdminDashboard />}
          {/* {user.role === "attender" && <AttenderDashboard />}
          {user.role === "doctor" && <DoctorDashboard />} */}
          {user.role === "patient" && <PatientDashboard />}
          {user.role === "attender" && <SimpleAttenderDashboard />}
           {/*{(user.role === "doctor" || user.role === "patient") && (
            <main className="container mx-auto px-4 py-8">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {isLoading ? (
                  Array(6).fill(0).map((_, i) => (
                    <Skeleton key={i} className="h-[400px]" />
                  ))
                ) : filteredDoctors?.length === 0 ? (
                  <div className="col-span-full text-center py-12">
                    <p className="text-lg text-muted-foreground">No doctors found</p>
                  </div>
                ) : (
                  filteredDoctors?.map((doctor) => (
                    <DoctorCard key={doctor.id} doctor={doctor} />
                  ))
                )}
              </div>
            </main>
          )} */}
        </>
      )}
    </div>
  );
}
