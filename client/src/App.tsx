import React from 'react';
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "./hooks/use-auth";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth-page";
import HomePage from "@/pages/home-page";
import DoctorPage from "@/pages/doctor-page";
import PatientBookingPage from "@/pages/patient-booking-page";
import DoctorBookingPage from "@/pages/doctor-booking-page";
import BookingHistoryPage from "@/pages/booking-history";
import AttenderDashboard from "@/pages/attender-dashboard";
import { useAuth } from "./hooks/use-auth";
import SuperAdminDashboard from "@/pages/super-admin-dashboard";
import DoctorCreation from "@/pages/doctor-creation";
import ClinicCreation from "@/pages/clinic-creation";
import ClinicAdminCreation from "@/pages/clinic-admin-creation";
import ClinicView from "@/pages/clinic-view";
import DoctorManagementPage from "./pages/doctor-management";
import { ProtectedRoute } from "./components/ProtectedRoute";
import DoctorSchedulesPage from "./pages/doctor-schedules";
import ClinicAdminDashboard from "@/pages/clinic-admin-dashboard";
import PatientDashboard from "@/pages/patient-dashboard";
import PatientClinicDetails from "@/pages/patient-clinic-details";
import PatientFavorites from "@/pages/patient-favorites";
import PatientWallet from "@/pages/patient-wallet";
import { ForcePasswordReset } from "@/components/ForcePasswordReset";
// New auth portal imports
import PortalSelection from "@/pages/auth/portal-selection";
import PatientLogin from "@/pages/auth/patient-login";
import PatientRegister from "@/pages/auth/patient-register";
import PatientForgotMpin from "@/pages/auth/patient-forgot-mpin";
import StaffLogin from "@/pages/auth/staff-login";
import AdminLogin from "@/pages/auth/admin-login";
// Policy and help pages
import PrivacyPolicy from "@/pages/policies/PrivacyPolicy";
import TermsConditions from "@/pages/policies/TermsConditions";
import CancellationRefund from "@/pages/policies/CancellationRefund";
import AboutUs from "@/pages/policies/AboutUs";
import AdditionalPolicies from "@/pages/policies/AdditionalPolicies";
import FAQs from "@/pages/help/FAQs";
import ContactUs from "@/pages/help/ContactUs";
import MapPage from "@/pages/map-page";
import LandingPage from "@/pages/landing-page";
import UserProfile from "@/pages/user-profile";

// Wrap DoctorManagementPage with ProtectedRoute
const ProtectedDoctorManagement = () => (
  <ProtectedRoute allowedRoles={["hospital_admin", "attender"]}>
    <DoctorManagementPage />
  </ProtectedRoute>
);

const ProtectedDoctorSchedules = () => (
  <ProtectedRoute allowedRoles={["hospital_admin", "attender", "doctor", "clinic_admin"]}>
    <DoctorSchedulesPage />
  </ProtectedRoute>
);

const ProtectedAttenderDashboard = () => (
  <ProtectedRoute allowedRoles={["attender", "clinic_admin"]}>
    <AttenderDashboard />
  </ProtectedRoute>
);

const ProtectedClinicAdminDashboard = () => (
  <ProtectedRoute allowedRoles={["clinic_admin", "hospital_admin", "clinicadmin"]}>
    <ClinicAdminDashboard />
  </ProtectedRoute>
);

function Router() {
  const { user, mustChangePassword, clearPasswordReset } = useAuth();
  const [, navigate] = useLocation();

  // Debug user role
  if (user) {
    console.log('Current user role:', user.role);
    console.log('User details:', user);
  }

  // Show password reset screen if required
  if (mustChangePassword) {
    return <ForcePasswordReset onSuccess={clearPasswordReset} />;
  }
  
  // Determine the appropriate landing page based on authentication status
  const getLandingPage = () => {
    if (user) {
      return <Redirect to="/home" />;
    }
    return <LandingPage />;
  };

  return (
    <Switch>
      {/* Landing page at root */}
      <Route path="/" component={getLandingPage} />
      <Route path="/patient-login" component={PatientLogin} />
      <Route path="/patient-register" component={PatientRegister} />
      <Route path="/patient-forgot-mpin" component={PatientForgotMpin} />
      <Route path="/staff-login" component={StaffLogin} />
      <Route path="/admin-login" component={AdminLogin} />
      
      {/* Legacy auth route - redirect to admin login */}
      <Route path="/login">
        {() => <Redirect to="/admin-login" />}
      </Route>
      
      {/* Keep existing auth page for backward compatibility */}
      <Route path="/auth" component={AuthPage} />
      
      {/* Home page for authenticated users */}
      <Route path="/home" component={HomePage} />
      
      {/* Existing application routes */}
      <Route path="/doctors/:id" component={DoctorPage} />
      <Route path="/book/:doctorId" component={PatientBookingPage} />
      <Route path="/doctor/bookings" component={DoctorBookingPage} />
      <Route path="/appointments" component={BookingHistoryPage} />
      <Route path="/attender-dashboard" component={ProtectedAttenderDashboard} />
      {/* <Route path="/super-admin-dashboard" component={SuperAdminDashboard} /> */}
      <Route path="/doctor-creation" component={DoctorCreation} />
      <Route path="/clinic-creation" component={ClinicCreation} />
      <Route path="/clinic-admin-creation" component={ClinicAdminCreation} />
      <Route path="/clinic/:id" component={ClinicView} />
      <Route path="/doctor-management" component={ProtectedDoctorManagement} />
      <Route path="/schedules" component={ProtectedDoctorSchedules} />
      {/* <Route path="/clinic-admin-dashboard" component={ProtectedClinicAdminDashboard} /> */}
      <Route path="/patient/dashboard" component={PatientDashboard} />
      <Route path="/patient/clinics/:id" component={PatientClinicDetails} />
      <Route path="/patient/favorites" component={PatientFavorites} />
      <Route path="/map" component={MapPage} />
      <Route path="/patient/wallet" component={PatientWallet} />
      <Route path="/profile" component={UserProfile} />
      
      {/* Policy and Help Pages */}
      <Route path="/policies/privacy-policy" component={PrivacyPolicy} />
      <Route path="/policies/terms-conditions" component={TermsConditions} />
      <Route path="/policies/cancellation-refund" component={CancellationRefund} />
      <Route path="/policies/about-us" component={AboutUs} />
      <Route path="/policies/additional-policies" component={AdditionalPolicies} />
      <Route path="/help/faqs" component={FAQs} />
      <Route path="/contact-us" component={ContactUs} />
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;