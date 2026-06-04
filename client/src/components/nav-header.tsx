import { useAuth } from "@/hooks/use-auth";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, User, Calendar, UserPlus, Clock, Star } from "lucide-react";
import { NotificationPopover } from "./notifications/notification-popover";
import { CompactNavigationButtons } from "./navigation-buttons";
import { CompactWallet } from "./wallet/compact-wallet";
import React from "react";

export function NavHeader() {
  const { user, logoutMutation } = useAuth();
  const [location] = useLocation();

  // For attenders, don't show the navigation if they're on their dashboard
  const isAttenderDashboard = user?.role === "attender" && location === "/attender-dashboard";
  
  // Check if user is a clinic admin
  const isClinicAdmin = user?.role === "clinic_admin";
  
  // Check if user is a super admin
  const isSuperAdmin = user?.role === "super_admin";
  
  // Check if user can manage doctors (hospital_admin) attender dont have rights to manage doctor only admin will do
  const canManageDoctors = user?.role === "hospital_admin";
  
  // Check if user can access schedules (hospital_admin, attender, or doctor)
  const canAccessSchedules = user?.role === "hospital_admin" || user?.role === "attender" || user?.role === "doctor";

  // Check if user can receive notifications (patients and doctors)
  const canReceiveNotifications = user?.role === "patient" || user?.role === "doctor";

  return (
    <header className="border-b">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link href={user?.role === "attender" ? "/" : isClinicAdmin ? "/clinic-admin-dashboard" : "/"}>
          <a>
            <img src="/logo.svg" alt="Clinik" className="h-9 w-auto" />
          </a>
        </Link>

        <div className="flex items-center gap-4">
          {user ? (
            <>
              {!isAttenderDashboard && user.role !== "attender" && !isClinicAdmin && !isSuperAdmin && (
                <Button variant="ghost" asChild className="hidden md:flex">
                  <Link href="/appointments">
                    <Calendar className="mr-2 h-4 w-4" />
                    My Appointments
                  </Link>
                </Button>
              )}
              {/* {isClinicAdmin && (
                <Button variant="ghost" asChild className="hidden md:flex">
                  <Link href="/clinic-admin-dashboard">
                    <Calendar className="mr-2 h-4 w-4" />
                    Admin Dashboard
                  </Link>
                </Button>
              )} */}
              {canManageDoctors && (
                <Button variant="ghost" asChild className="hidden md:flex">
                  <Link href="/doctor-management">
                    <UserPlus className="mr-2 h-4 w-4" />
                    Manage Doctors
                  </Link>
                </Button>
              )}
              {/* {canAccessSchedules && (
                <Button variant="ghost" asChild className="hidden md:flex">
                  <Link href="/schedules">
                    <Clock className="mr-2 h-4 w-4" />
                    Schedules
                  </Link>
                </Button>
              )}
               */}
              {/* Show favorites and wallet for patients */}
              {user?.role === "patient" && (
                <>
                  <Button variant="ghost" asChild className="hidden md:flex">
                    <Link href="/patient/favorites">
                      <Star className="mr-2 h-4 w-4" />
                      Favorites
                    </Link>
                  </Button>
                  <CompactWallet />
                </>
              )}
              
              {/* Show notification bell for patients and doctors */}
              {canReceiveNotifications && <NotificationPopover />}
              
              {/* Compact Navigation Buttons */}
              <CompactNavigationButtons className="hidden md:flex" />
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={user.imageUrl || undefined} alt={user.name} />
                      <AvatarFallback>
                        {user.name.split(" ").map(n => n[0]).join("")}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link href="/profile" className="gap-2">
                      <User size={16} />
                      <span>My Profile</span>
                    </Link>
                  </DropdownMenuItem>
                  {!isAttenderDashboard && !isClinicAdmin && !isSuperAdmin && (
                    <DropdownMenuItem asChild>
                      {user.role === "attender" ? (
                        <Link href="/attender-dashboard" className="gap-2">
                          <Calendar size={16} />
                          <span>Doctor Dashboard</span>
                        </Link>
                      ) : (
                        <Link href="/appointments" className="gap-2">
                          <Calendar size={16} />
                          <span>My Appointments</span>
                        </Link>
                      )}
                    </DropdownMenuItem>
                  )}
                  {/* {isClinicAdmin && (
                    <DropdownMenuItem asChild>
                      <Link href="/clinic-admin-dashboard" className="gap-2">
                        <Calendar size={16} />
                        <span>Admin Dashboard</span>
                      </Link>
                    </DropdownMenuItem>
                  )} */}
                  {canManageDoctors && (
                    <DropdownMenuItem asChild>
                      <Link href="/doctor-management" className="gap-2">
                        <UserPlus size={16} />
                        <span>Manage Doctors</span>
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {canAccessSchedules && (
                    <DropdownMenuItem asChild>
                      <Link href="/schedules" className="gap-2">
                        <Clock size={16} />
                        <span>Schedules</span>
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {user?.role === "patient" && (
                    <DropdownMenuItem asChild>
                      <Link href="/patient/favorites" className="gap-2">
                        <Star size={16} />
                        <span>Favorites</span>
                      </Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="gap-2 text-red-600"
                    onClick={() => logoutMutation.mutate()}
                  >
                    <LogOut size={16} />
                    <span>Logout</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="outline" className="border-primary text-primary hover:bg-primary/10" asChild>
                <Link href="/patient-register">Patient Register</Link>
              </Button>
              <Button asChild>
                <Link href="/auth">Login</Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}