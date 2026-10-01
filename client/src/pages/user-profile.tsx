// User profile page — view and edit personal details for all roles
import React, { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { NavHeader } from "@/components/nav-header";
import PatientFooter from "@/components/PatientFooter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, User, Phone, Mail, MapPin, Stethoscope, Save, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useForm } from "react-hook-form";

interface ProfileFormValues {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  specialty: string;
  bio: string;
}

export default function UserProfile() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const isDoctor = user?.role === "doctor";
  const isAttender = user?.role === "attender";
  const showProfessional = isDoctor || isAttender;
  // Play's deletion requirement covers end-user accounts; staff removal would
  // orphan schedules and appointments, so this is offered to patients only.
  const isPatient = user?.role === "patient";

  const { register, handleSubmit, reset, formState: { isDirty } } = useForm<ProfileFormValues>({
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      address: "",
      city: "",
      state: "",
      zipCode: "",
      specialty: "",
      bio: "",
    },
  });

  useEffect(() => {
    if (user) {
      reset({
        name: user.name || "",
        email: user.email || "",
        phone: user.phone || "",
        address: user.address || "",
        city: user.city || "",
        state: user.state || "",
        zipCode: user.zipCode || "",
        specialty: user.specialty || "",
        bio: user.bio || "",
      });
    }
  }, [user, reset]);

  const updateMutation = useMutation({
    mutationFn: async (data: ProfileFormValues) => {
      const res = await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to update profile");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({ title: "Profile updated successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const onSubmit = (data: ProfileFormValues) => {
    updateMutation.mutate(data);
  };

  const initials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase()
    : "?";

  const roleLabel: Record<string, string> = {
    patient: "Patient",
    doctor: "Doctor",
    attender: "Attender",
    hospital_admin: "Hospital Admin",
    clinic_admin: "Clinic Admin",
    super_admin: "Super Admin",
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <NavHeader />

      <div className="flex-1">
        <div className="container mx-auto py-8 px-4 max-w-2xl">
          {/* Header */}
          <div className="flex items-center gap-4 mb-6">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/")} className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <h1 className="text-2xl font-bold">My Profile</h1>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Avatar + role card */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-5">
                  <Avatar className="h-20 w-20 text-xl">
                    <AvatarImage src={user?.imageUrl || undefined} alt={user?.name} />
                    <AvatarFallback className="bg-primary text-primary-foreground text-xl">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-xl font-semibold">{user?.name}</p>
                    <p className="text-sm text-muted-foreground">@{user?.username}</p>
                    <Badge variant="secondary" className="mt-1">
                      {roleLabel[user?.role || ""] || user?.role}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Personal Information */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <User className="h-4 w-4" />
                  Personal Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <Input id="name" {...register("name")} placeholder="Your full name" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="flex items-center gap-1">
                      <Mail className="h-3 w-3" /> Email
                    </Label>
                    <Input id="email" type="email" {...register("email")} placeholder="email@example.com" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone" className="flex items-center gap-1">
                      <Phone className="h-3 w-3" /> Phone
                    </Label>
                    <Input id="phone" {...register("phone")} placeholder="+91 XXXXX XXXXX" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Address */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MapPin className="h-4 w-4" />
                  Address
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="address">Street Address</Label>
                  <Input id="address" {...register("address")} placeholder="123 Main Street" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div className="space-y-2 col-span-2 sm:col-span-1">
                    <Label htmlFor="city">City</Label>
                    <Input id="city" {...register("city")} placeholder="Chennai" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="state">State</Label>
                    <Input id="state" {...register("state")} placeholder="Tamil Nadu" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="zipCode">PIN Code</Label>
                    <Input id="zipCode" {...register("zipCode")} placeholder="600001" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Professional Info — doctors and attenders only */}
            {showProfessional && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Stethoscope className="h-4 w-4" />
                    Professional Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="specialty">Specialty</Label>
                    <Input id="specialty" {...register("specialty")} placeholder="e.g. General Medicine" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bio">Bio</Label>
                    <Textarea
                      id="bio"
                      {...register("bio")}
                      placeholder="Brief professional background..."
                      rows={3}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            <Separator />

            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={updateMutation.isPending || !isDirty}
                className="gap-2 min-w-[120px]"
              >
                <Save className="h-4 w-4" />
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>

          {/* Account deletion. Play requires a visible in-app deletion path for
              any app with accounts; requests are handled by support until the
              in-product flow is built. */}
          {isPatient && (
          <>
          <Separator className="my-6" />

          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive text-base">
                <Trash2 className="h-4 w-4" />
                Delete Account
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Request deletion of your account and personal details.
                Appointment and payment records are retained as required by
                Indian tax law.
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="destructive" className="gap-2">
                    <Trash2 className="h-4 w-4" />
                    Delete Account
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Account deletion</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-3 text-sm">
                        <p>
                          This account cannot be deleted from within the app yet.
                        </p>
                        <p>
                          To request deletion, email{" "}
                          <a
                            href="mailto:support@clinik.co.in?subject=Account%20deletion%20request"
                            className="font-medium text-primary underline"
                          >
                            support@clinik.co.in
                          </a>{" "}
                          from your registered email address, or include your
                          registered mobile number. We will verify and process the
                          request within 30 days.
                        </p>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogAction>Close</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
          </>
          )}
        </div>
      </div>

      <PatientFooter />
    </div>
  );
}
