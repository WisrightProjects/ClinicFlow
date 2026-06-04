// Self-service Forgot MPIN wizard: Mobile -> OTP -> New MPIN -> Confirm MPIN
import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Phone, Lock, AlertCircle, ChevronRight, ChevronLeft, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { MpinKeypad } from "@/components/mpin-keypad";
import { OtpInput } from "@/components/otp-input";

const TOTAL_STEPS = 4;

const forgotMpinSchema = z
  .object({
    mobileNumber: z
      .string()
      .length(10, "Mobile number must be 10 digits")
      .regex(/^\d{10}$/, "Mobile number must contain only digits"),
    otp: z.string().length(6, "OTP must be 6 digits").regex(/^\d{6}$/, "OTP must contain only digits"),
    newMpin: z.string().length(4, "MPIN must be 4 digits").regex(/^\d{4}$/, "MPIN must contain only digits"),
    confirmMpin: z.string().length(4, "MPIN must be 4 digits").regex(/^\d{4}$/, "MPIN must contain only digits"),
  })
  .refine((data) => data.newMpin === data.confirmMpin, {
    message: "MPINs don't match",
    path: ["confirmMpin"],
  });

type ForgotMpinData = z.infer<typeof forgotMpinSchema>;

// Parse a fetch Response into { ok, status, body } without throwing
async function callApi(url: string, payload: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "include",
  });
  let body: any = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  return { ok: res.ok, status: res.status, body };
}

export default function PatientForgotMpin() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [showMpin, setShowMpin] = useState(false);
  const [notRegistered, setNotRegistered] = useState(false);
  const [otpDigits, setOtpDigits] = useState(["", "", "", "", "", ""]);
  const [countdown, setCountdown] = useState(0);
  const [otpError, setOtpError] = useState("");

  const form = useForm<ForgotMpinData>({
    resolver: zodResolver(forgotMpinSchema),
    defaultValues: { mobileNumber: "", otp: "", newMpin: "", confirmMpin: "" },
  });

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const setOtpValue = (digits: string[]) => {
    setOtpDigits(digits);
    form.setValue("otp", digits.join(""));
    setOtpError("");
  };

  // --- Step 1: request OTP for the registered mobile ---
  const handleRequestOtp = async () => {
    if (!(await form.trigger("mobileNumber"))) return;

    setIsLoading(true);
    setNotRegistered(false);
    try {
      const { ok, status, body } = await callApi("/api/auth/patient/forgot-mpin/request-otp", {
        phone: form.getValues("mobileNumber"),
      });

      if (!ok) {
        if (status === 404 && (body.code === "NOT_REGISTERED" || /not registered/i.test(body.message || ""))) {
          setNotRegistered(true);
          return;
        }
        toast({ title: "Could not send OTP", description: body.message || "Please try again", variant: "destructive" });
        return;
      }

      toast({ title: "OTP Sent!", description: "Check your phone for the verification code" });
      setOtpValue(["", "", "", "", "", ""]);
      setCurrentStep(2);
      setCountdown(60);
    } catch {
      toast({ title: "Error", description: "Something went wrong. Please try again.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  // --- Step 2: resend OTP ---
  const handleResendOtp = async () => {
    setIsLoading(true);
    try {
      const { ok, status, body } = await callApi("/api/auth/patient/forgot-mpin/request-otp", {
        phone: form.getValues("mobileNumber"),
      });
      if (!ok) {
        if (status === 429) setCountdown(60);
        toast({ title: "Could not resend OTP", description: body.message || "Please try again", variant: "destructive" });
        return;
      }
      toast({ title: "OTP Resent!", description: "Check your phone for the new verification code" });
      setOtpValue(["", "", "", "", "", ""]);
      setCountdown(60);
    } catch {
      toast({ title: "Error", description: "Something went wrong. Please try again.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  // --- Step 2: verify OTP, binding the phone to the session ---
  const handleVerifyOtp = async () => {
    if (!(await form.trigger("otp"))) {
      setOtpError("OTP must be 6 digits");
      return;
    }

    setIsLoading(true);
    setOtpError("");
    try {
      const { ok, status, body } = await callApi("/api/auth/patient/forgot-mpin/verify-otp", {
        phone: form.getValues("mobileNumber"),
        otp: form.getValues("otp"),
      });

      if (!ok) {
        if (status === 401) {
          setOtpError("Invalid or expired OTP");
        } else if (status === 429) {
          setOtpError(body.message || "Too many attempts. Please request a new OTP");
        } else {
          setOtpError(body.message || "Failed to verify OTP");
        }
        return;
      }

      toast({ title: "Verified!", description: "Your mobile number has been verified" });
      setCurrentStep(3);
    } catch {
      toast({ title: "Error", description: "Something went wrong. Please try again.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  // --- Step 4: reset the MPIN ---
  const handleReset = async () => {
    if (!(await form.trigger("confirmMpin"))) return;

    setIsLoading(true);
    try {
      const { ok, status, body } = await callApi("/api/auth/patient/forgot-mpin/reset", {
        mobileNumber: form.getValues("mobileNumber"),
        newMpin: form.getValues("newMpin"),
      });

      if (!ok) {
        if (status === 403) {
          toast({
            title: "Verification expired",
            description: "Verification expired — please verify your number again",
            variant: "destructive",
          });
          setOtpValue(["", "", "", "", "", ""]);
          form.setValue("newMpin", "");
          form.setValue("confirmMpin", "");
          setCountdown(0);
          setCurrentStep(1);
          return;
        }
        toast({ title: "Reset Failed", description: body.message || "Failed to reset MPIN", variant: "destructive" });
        return;
      }

      toast({
        title: "MPIN Reset Successful!",
        description: "You can now login with your new MPIN. Redirecting to login...",
      });
      setTimeout(() => navigate("/patient-login"), 2000);
    } catch {
      toast({ title: "Error", description: "Something went wrong. Please try again.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  // MPIN keypad handlers
  const handleMpinInput = (field: "newMpin" | "confirmMpin", digit: string) => {
    const currentValue = form.getValues(field);
    if (currentValue.length < 4) form.setValue(field, currentValue + digit);
  };
  const handleMpinClear = (field: "newMpin" | "confirmMpin") => form.setValue(field, "");
  const handleMpinBackspace = (field: "newMpin" | "confirmMpin") =>
    form.setValue(field, form.getValues(field).slice(0, -1));

  const stepTitles: Record<number, { title: string; description: string }> = {
    1: { title: "Forgot MPIN", description: "Enter your registered mobile number to receive an OTP" },
    2: { title: "Verify OTP", description: "Enter the 6-digit code sent to your mobile" },
    3: { title: "New MPIN", description: "Choose a new 4-digit PIN you'll remember" },
    4: { title: "Confirm MPIN", description: "Re-enter your new MPIN to confirm" },
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Link href="/patient-login">
            <Button variant="ghost" size="sm" className="mb-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Login
            </Button>
          </Link>

          <Progress value={(currentStep / TOTAL_STEPS) * 100} className="mb-4" />

          <div className="flex items-center justify-center mb-4">
            <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center">
              {currentStep === 1 && <Phone className="w-8 h-8 text-white" />}
              {currentStep >= 2 && <Lock className="w-8 h-8 text-white" />}
            </div>
          </div>
          <CardTitle className="text-2xl text-center">{stepTitles[currentStep].title}</CardTitle>
          <CardDescription className="text-center">{stepTitles[currentStep].description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
              {/* Step 1: Mobile number */}
              {currentStep === 1 && (
                <>
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
                              autoFocus
                              onChange={(e) => {
                                field.onChange(e.target.value.replace(/\D/g, "").slice(0, 10));
                                setNotRegistered(false);
                              }}
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {notRegistered && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription className="space-y-2">
                        <p>This mobile number is not registered. Please register first.</p>
                        <Button type="button" size="sm" variant="outline" onClick={() => navigate("/patient-register")}>
                          Go to Register
                        </Button>
                      </AlertDescription>
                    </Alert>
                  )}

                  <Button type="button" className="w-full" onClick={handleRequestOtp} disabled={isLoading}>
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Sending OTP...
                      </>
                    ) : (
                      <>
                        Send OTP
                        <ChevronRight className="w-4 h-4 ml-2" />
                      </>
                    )}
                  </Button>
                </>
              )}

              {/* Step 2: OTP entry */}
              {currentStep === 2 && (
                <>
                  <FormItem>
                    <FormLabel>Verification Code</FormLabel>
                    <FormControl>
                      <OtpInput digits={otpDigits} onChange={setOtpValue} />
                    </FormControl>
                    {otpError && <p className="text-sm font-medium text-destructive mt-2">{otpError}</p>}
                  </FormItem>

                  {countdown > 0 && (
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>You can resend OTP in {countdown} seconds</AlertDescription>
                    </Alert>
                  )}

                  <Button
                    type="button"
                    className="w-full"
                    onClick={handleVerifyOtp}
                    disabled={isLoading || form.watch("otp").length !== 6}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      "Verify OTP"
                    )}
                  </Button>

                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={handleResendOtp}
                      disabled={countdown > 0 || isLoading}
                    >
                      {countdown > 0 ? `Resend OTP in ${countdown}s` : "Resend OTP"}
                    </Button>
                    <Button
                      type="button"
                      variant="link"
                      onClick={() => {
                        setOtpValue(["", "", "", "", "", ""]);
                        setCountdown(0);
                        setCurrentStep(1);
                      }}
                    >
                      Change mobile number
                    </Button>
                  </div>
                </>
              )}

              {/* Step 3: New MPIN */}
              {currentStep === 3 && (
                <>
                  <FormItem>
                    <FormLabel>Mobile Number</FormLabel>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500" />
                      <Input value={form.getValues("mobileNumber")} readOnly disabled className="pl-10 bg-muted" />
                    </div>
                    <FormDescription>Verified</FormDescription>
                  </FormItem>

                  <FormField
                    control={form.control}
                    name="newMpin"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>New 4-Digit MPIN</FormLabel>
                        <FormControl>
                          <MpinKeypad
                            value={field.value}
                            placeholder="Enter 4 digits"
                            showToggle
                            reveal={showMpin}
                            onToggleReveal={() => setShowMpin(!showMpin)}
                            onDigit={(d) => handleMpinInput("newMpin", d)}
                            onClear={() => handleMpinClear("newMpin")}
                            onBackspace={() => handleMpinBackspace("newMpin")}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="button"
                    className="w-full"
                    onClick={async () => {
                      if (await form.trigger("newMpin")) setCurrentStep(4);
                    }}
                    disabled={form.watch("newMpin").length !== 4}
                  >
                    Next
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </Button>
                </>
              )}

              {/* Step 4: Confirm new MPIN */}
              {currentStep === 4 && (
                <>
                  <FormField
                    control={form.control}
                    name="confirmMpin"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Confirm Your New MPIN</FormLabel>
                        <FormControl>
                          <MpinKeypad
                            value={field.value}
                            placeholder="Re-enter 4 digits"
                            onDigit={(d) => handleMpinInput("confirmMpin", d)}
                            onClear={() => handleMpinClear("confirmMpin")}
                            onBackspace={() => handleMpinBackspace("confirmMpin")}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>Remember your new MPIN! You'll need it to login.</AlertDescription>
                  </Alert>

                  <div className="flex gap-2">
                    <Button type="button" variant="outline" className="flex-1" onClick={() => setCurrentStep(3)}>
                      <ChevronLeft className="w-4 h-4 mr-2" />
                      Back
                    </Button>
                    <Button
                      type="button"
                      className="flex-1"
                      onClick={handleReset}
                      disabled={isLoading || form.watch("confirmMpin").length !== 4}
                    >
                      {isLoading ? "Resetting..." : "Reset MPIN"}
                    </Button>
                  </div>
                </>
              )}
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
