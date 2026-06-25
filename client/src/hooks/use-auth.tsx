import { createContext, ReactNode, useContext, useState, useEffect, useRef } from "react";
import {
  useQuery,
  useMutation,
  UseMutationResult,
} from "@tanstack/react-query";
import { insertUserSchema, User as SelectUser, InsertUser } from "@shared/schema";
import { getQueryFn, apiRequest, queryClient } from "../lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { registerFcmToken } from "@/lib/firebase";

type AuthContextType = {
  user: SelectUser | null;
  isLoading: boolean;
  error: Error | null;
  mustChangePassword: boolean;
  clearPasswordReset: () => void;
  loginMutation: UseMutationResult<SelectUser, Error, LoginData>;
  logoutMutation: UseMutationResult<void, Error, void>;
  registerMutation: UseMutationResult<SelectUser, Error, InsertUser>;
};

type LoginData = Pick<InsertUser, "username" | "password">;

export const AuthContext = createContext<AuthContextType | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [mustChangePassword, setMustChangePassword] = useState(false);
  
  const {
    data: user,
    error,
    isLoading,
  } = useQuery<SelectUser | undefined, Error>({
    queryKey: ["/api/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  // Register the native FCM push token once an authenticated user is present.
  // Done here (not in each login screen) so it covers every auth path — staff
  // password, patient MPIN (which full-reloads to /home), and patient OTP — and
  // re-registers on each app launch to keep the token fresh. No-op on web.
  const fcmRegistered = useRef(false);
  useEffect(() => {
    if (user && !fcmRegistered.current) {
      fcmRegistered.current = true;
      registerFcmToken();
    }
  }, [user]);

  const clearPasswordReset = () => {
    setMustChangePassword(false);
  };

  const loginMutation = useMutation({
    mutationFn: async (credentials: LoginData) => {
      const res = await apiRequest("POST", "/api/login", credentials);
      return await res.json();
    },
    onSuccess: (data: any) => {
      if (data.mustChangePassword) {
        setMustChangePassword(true);
        // Set user data but don't show success toast yet
        queryClient.setQueryData(["/api/user"], data.user);
      } else {
        setMustChangePassword(false);
        // Clear all queries first to remove any stale data
        queryClient.clear();
        // Then set the new user data
        queryClient.setQueryData(["/api/user"], data.user || data);
        toast({
          title: "Login successful",
          description: `Welcome back, ${(data.user || data).name}!`,
        });
        // FCM token registration is handled centrally by the auth effect above,
        // so it also covers patient MPIN/OTP logins — no per-path call needed.
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Login failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (credentials: InsertUser) => {
      const res = await apiRequest("POST", "/api/register", credentials);
      return await res.json();
    },
    onSuccess: (user: SelectUser) => {
      // Clear all queries first to ensure clean state
      queryClient.clear();
      // Then set the new user data
      queryClient.setQueryData(["/api/user"], user);
      toast({
        title: "Registration successful",
        description: `Welcome, ${user.name}!`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Registration failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/logout");
    },
    onSuccess: () => {
      // Clear all cached queries on logout
      queryClient.clear();
      // Then reset the user state
      queryClient.setQueryData(["/api/user"], null);
      toast({
        title: "Logged out",
        description: "You have been successfully logged out.",
      });
      // Redirect to portal selection page
      setTimeout(() => {
        window.location.href = "/";
      }, 500);
    },
    onError: (error: Error) => {
      toast({
        title: "Logout failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        isLoading,
        error,
        mustChangePassword,
        clearPasswordReset,
        loginMutation,
        logoutMutation,
        registerMutation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}