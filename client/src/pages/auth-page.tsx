// /auth login screen: patient mobile+MPIN is primary, staff username+password is secondary
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Phone, Lock, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { z } from "zod";

// Staff/admin credentials
const staffLoginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});
type StaffLoginData = z.infer<typeof staffLoginSchema>;

// Patient credentials: 10-digit mobile + 4-digit MPIN
const patientLoginSchema = z.object({
  mobileNumber: z.string()
    .min(10, "Mobile number must be 10 digits")
    .max(10, "Mobile number must be 10 digits")
    .regex(/^\d{10}$/, "Mobile number must contain only digits"),
  mpin: z.string()
    .length(4, "MPIN must be 4 digits")
    .regex(/^\d{4}$/, "MPIN must contain only digits"),
});
type PatientLoginData = z.infer<typeof patientLoginSchema>;

export default function AuthPage() {
  const [_location, navigate] = useLocation();
  const { user } = useAuth();
  // Patient login is shown first; staff/admin is one click away
  const [mode, setMode] = useState<"patient" | "staff">("patient");

  if (user) {
    navigate("/");
    return null;
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="flex items-center justify-center p-8">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Welcome to Clinik</CardTitle>
          </CardHeader>
          <CardContent>
            {mode === "patient" ? (
              <PatientLoginForm onStaff={() => setMode("staff")} />
            ) : (
              <StaffLoginForm onPatient={() => setMode("patient")} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="hidden lg:block bg-[url('https://images.unsplash.com/photo-1600948836101-f9ffda59d250')] bg-cover bg-center">
        <div className="h-full w-full bg-primary/50 flex items-center justify-center p-8">
          <div className="max-w-md text-white">
            <h1 className="text-4xl font-bold mb-4">Your Health, Our Priority</h1>
            <p className="text-lg">Book appointments with top doctors, track your visits, and manage your healthcare journey all in one place.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function PatientLoginForm({ onStaff }: { onStaff: () => void }) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [showMpin, setShowMpin] = useState(false);

  const form = useForm<PatientLoginData>({
    resolver: zodResolver(patientLoginSchema),
    defaultValues: {
      mobileNumber: "",
      mpin: "",
    },
  });

  const handleSubmit = async (data: PatientLoginData) => {
    setIsLoading(true);
    try {
      const response = await apiRequest("POST", "/api/auth/patient/login", data);
      const result = await response.json();

      if (!response.ok) {
        if (response.status === 423) {
          toast({ title: "Account Locked", description: result.message, variant: "destructive" });
        } else if (response.status === 429) {
          toast({ title: "Too Many Attempts", description: result.message, variant: "destructive" });
        } else {
          toast({ title: "Login Failed", description: result.message || "Invalid credentials", variant: "destructive" });
        }
        return;
      }

      toast({ title: "Login Successful", description: "Welcome back!" });
      // Force page reload to ensure auth state is updated from server session
      setTimeout(() => {
        window.location.href = "/home";
      }, 500);
    } catch (error) {
      toast({ title: "Error", description: "Something went wrong. Please try again.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleMpinInput = (digit: string) => {
    const currentMpin = form.getValues("mpin");
    if (currentMpin.length < 4) {
      form.setValue("mpin", currentMpin + digit);
    }
  };

  const handleMpinClear = () => form.setValue("mpin", "");

  const handleMpinBackspace = () => {
    const currentMpin = form.getValues("mpin");
    form.setValue("mpin", currentMpin.slice(0, -1));
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 mt-4">
        <FormField
          control={form.control}
          name="mobileNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Mobile Number</FormLabel>
              <FormControl>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <Input
                    {...field}
                    type="tel"
                    placeholder="10 digit mobile number"
                    className="pl-10"
                    maxLength={10}
                    inputMode="numeric"
                    pattern="[0-9]*"
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="mpin"
          render={({ field }) => (
            <FormItem>
              <FormLabel>MPIN</FormLabel>
              <FormControl>
                <div className="space-y-3">
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <Input
                      {...field}
                      type={showMpin ? "text" : "password"}
                      placeholder="4-digit MPIN"
                      className="pl-10 text-center text-xl tracking-widest placeholder:text-sm"
                      maxLength={4}
                      readOnly
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-2 top-1/2 transform -translate-y-1/2"
                      onClick={() => setShowMpin(!showMpin)}
                    >
                      {showMpin ? "Hide" : "Show"}
                    </Button>
                  </div>

                  {/* Compact number pad for MPIN input */}
                  <div className="grid grid-cols-3 gap-1">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
                      <Button
                        key={digit}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-sm"
                        onClick={() => handleMpinInput(digit.toString())}
                        disabled={field.value.length >= 4}
                      >
                        {digit}
                      </Button>
                    ))}
                    <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={handleMpinClear}>
                      Clear
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-sm"
                      onClick={() => handleMpinInput("0")}
                      disabled={field.value.length >= 4}
                    >
                      0
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={handleMpinBackspace}>
                      ←
                    </Button>
                  </div>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="text-right">
          <Link href="/patient-forgot-mpin">
            <Button variant="link" className="p-0 h-auto text-sm">
              Forgot MPIN?
            </Button>
          </Link>
        </div>

        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? "Logging in..." : "Login"}
        </Button>

        <div className="text-center text-sm">
          <span className="text-gray-600">Don't have an account? </span>
          <Link href="/patient-register">
            <Button variant="link" className="p-0 h-auto font-semibold">
              Register here
            </Button>
          </Link>
        </div>

        {/* Staff/admin entry point */}
        <div className="relative my-2">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">or</span>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full border-primary text-primary hover:bg-primary/10"
          onClick={onStaff}
        >
          Staff / Admin Login
        </Button>
      </form>
    </Form>
  );
}

function StaffLoginForm({ onPatient }: { onPatient: () => void }) {
  const { loginMutation } = useAuth();
  const form = useForm<StaffLoginData>({
    resolver: zodResolver(staffLoginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((data) => loginMutation.mutate(data))} className="space-y-4 mt-4">
        <Button type="button" variant="ghost" size="sm" className="mb-2 -ml-2" onClick={onPatient}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Patient Login
        </Button>
        <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input type="password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={loginMutation.isPending}>
          {loginMutation.isPending ? "Logging in..." : "Staff Login"}
        </Button>
      </form>
    </Form>
  );
}
