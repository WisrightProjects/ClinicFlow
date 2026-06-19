import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User as SelectUser, insertUserSchema } from "@shared/schema";
import { smsService } from "./services/sms";

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

declare module "express-session" {
  interface SessionData {
    registrationPhone?: string;        // OTP-verified phone for pending registration
    registrationVerifiedAt?: number;   // epoch ms, valid for 15 minutes
    resetMpinPhone?: string;           // OTP-verified phone for pending MPIN reset
    resetMpinVerifiedAt?: number;      // epoch ms, valid for 15 minutes
  }
}

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function hashMpin(mpin: string) {
  // Use same hashing as passwords for consistency
  return hashPassword(mpin);
}

async function compareMpin(supplied: string, stored: string) {
  // Use same comparison as passwords
  return comparePasswords(supplied, stored);
}

async function comparePasswords(supplied: string, stored: string) {
  try {
    const [hashed, salt] = stored.split(".");
    if (!hashed || !salt) {
      console.error("Invalid password format in database");
      return false;
    }
    const hashedBuf = Buffer.from(hashed, "hex");
    const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
    return timingSafeEqual(hashedBuf, suppliedBuf);
  } catch (error) {
    console.error("Error comparing passwords:", error);
    return false;
  }
}

export function setupAuth(app: Express) {
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    store: storage.sessionStore,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  };

  app.set("trust proxy", 1);
  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await storage.getUserByUsername(username);
        if (!user || !(await comparePasswords(password, user.password))) {
          return done(null, false);
        }
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }),
  );

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      if (!user) {
        return done(new Error('User not found'), null);
      }
      done(null, user);
    } catch (err) {
      done(err);
    }
  });

  app.post("/api/register", async (req, res, next) => {
    try {
      const data = { ...req.body };
      if (data.email === "") data.email = null;
      const parsed = insertUserSchema.parse(data);

      const existingUser = await storage.getUserByUsername(parsed.username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }

      const hashedPassword = await hashPassword(parsed.password);
      const user = await storage.createUser({
        ...parsed,
        password: hashedPassword,
      });

      // If this is an attender being created by a clinic admin, don't auto-login
      if (req.user && req.user.role === "clinic_admin" && parsed.role === "attender") {
        return res.status(201).json(user);
      }
      
      // Otherwise, log the user in (normal registration flow)
      req.login(user, (err) => {
        if (err) return next(err);
        res.status(201).json(user);
      });
    } catch (err) {
      console.error("Registration error:", err);
      res.status(400).json({ message: err instanceof Error ? err.message : "Invalid request" });
    }
  });

  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", (err, user) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ message: "Invalid credentials" });

      // Patients must use the mobile + MPIN flow, not the staff/admin form.
      if (user.role === "patient") {
        return res.status(403).json({ message: "Patients must use Patient Login (mobile number + MPIN)." });
      }

      req.login(user, (err) => {
        if (err) return next(err);
        res.json({
          user,
          mustChangePassword: user.mustChangePassword || false
        });
      });
    })(req, res, next);
  });

  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  });

  // Force password reset endpoint for clinic admins
  app.post("/api/force-reset-password", async (req, res) => {
    if (!req.user) return res.sendStatus(401);

    try {
      const { currentPassword, newPassword } = req.body;
      
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Current password and new password are required" });
      }

      // Verify current password
      const user = await storage.getUserByUsername(req.user.username);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check current password
      const isCurrentPasswordValid = await comparePasswords(currentPassword, user.password);
      if (!isCurrentPasswordValid) {
        return res.status(400).json({ message: "Current password is incorrect" });
      }

      // Hash new password
      const newHashedPassword = await hashPassword(newPassword);
      
      // Update password and clear the mustChangePassword flag
      await storage.updateUser(user.id, {
        password: newHashedPassword,
        mustChangePassword: false
      });

      res.json({ message: "Password updated successfully" });
    } catch (error) {
      console.error("Error resetting password:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    res.json(req.user);
  });

  app.patch("/api/user", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const allowed = ["name", "email", "phone", "address", "city", "state", "zipCode", "imageUrl", "bio", "specialty"];
      const updates: Record<string, string> = {};
      for (const field of allowed) {
        if (req.body[field] !== undefined) updates[field] = req.body[field];
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }
      const updatedUser = await storage.updateUser(req.user.id, updates);
      const { password: _pw, ...safeUser } = updatedUser;
      res.json(safeUser);
    } catch (error) {
      console.error("Error updating profile:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // Check if a phone number is registered (used by Firebase flow before sending OTP)
  app.post("/api/auth/check-phone", async (req, res) => {
    try {
      let { phone } = req.body;
      if (!phone) return res.status(400).json({ message: "Phone number is required" });
      phone = phone.replace(/\D/g, '');
      if (phone.length > 10) phone = phone.slice(-10);
      const user = await storage.getUserByPhone(phone);
      if (!user) return res.status(404).json({ message: "No account found with this phone number" });
      return res.status(200).json({ exists: true });
    } catch (error) {
      return res.status(500).json({ message: "Failed to check phone" });
    }
  });

  // OTP Authentication endpoints
  app.post("/api/auth/request-otp", async (req, res) => {
    try {
      let { phone } = req.body;

      if (!phone) {
        return res.status(400).json({ message: "Phone number is required" });
      }

      // Normalize phone: strip country code prefix (+1, +91, etc.) and non-digits
      phone = phone.replace(/\D/g, ''); // remove all non-digits
      if (phone.length > 10) {
        phone = phone.slice(-10); // keep last 10 digits
      }

      // Check if user exists
      const user = await storage.getUserByPhone(phone);
      if (!user) {
        return res.status(404).json({ message: "No account found with this phone number" });
      }

      // Check rate limiting
      const canSend = await storage.canSendOtp(phone);
      if (!canSend) {
        return res.status(429).json({ message: process.env.NODE_ENV === 'production' ? "Please wait 1 minute before requesting another OTP" : "Please wait 10 seconds before requesting another OTP" });
      }

      // Cleanup expired OTPs
      await storage.cleanupExpiredOtps();

      // Generate OTP
      const otp = smsService.generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Store OTP in database
      await storage.createOtpVerification({
        phone,
        otpCode: otp,
        expiresAt,
        verified: false,
        verificationAttempts: 0
      });

      // Update last OTP sent time
      await storage.updateLastOtpSentAt(phone);

      // Send OTP via SMS — MDT expects plain 10-digit number (no country code prefix)
      await smsService.sendOTP(phone, otp);

      res.json({ message: "OTP sent successfully" });
    } catch (error) {
      console.error("Error sending OTP:", error);
      res.status(500).json({ message: "Failed to send OTP" });
    }
  });

  app.post("/api/auth/verify-otp", async (req, res, next) => {
    try {
      let { phone, otp } = req.body;

      if (!phone || !otp) {
        return res.status(400).json({ message: "Phone number and OTP are required" });
      }

      // Normalize phone
      phone = phone.replace(/\D/g, '');
      if (phone.length > 10) phone = phone.slice(-10);

      // Get valid OTP from database
      const otpRecord = await storage.getValidOtp(phone, otp);
      
      if (!otpRecord) {
        return res.status(401).json({ message: "Invalid or expired OTP" });
      }

      // Check if too many attempts
      if (otpRecord.verificationAttempts >= 5) {
        return res.status(429).json({ message: "Too many attempts. Please request a new OTP" });
      }

      // Increment attempts
      await storage.incrementOtpAttempts(otpRecord.id);

      // Get user
      const user = await storage.getUserByPhone(phone);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Mark OTP as verified
      await storage.markOtpAsVerified(otpRecord.id);

      // Update phone verification status
      await storage.updateUser(user.id, { phoneVerified: true });

      // Login the user
      req.login(user, (err) => {
        if (err) return next(err);
        res.json(user);
      });
    } catch (error) {
      console.error("Error verifying OTP:", error);
      res.status(500).json({ message: "Failed to verify OTP" });
    }
  });

  // OTP Registration endpoints
  app.post("/api/register/request-otp", async (req, res) => {
    try {
      let { phone } = req.body;

      if (!phone) {
        return res.status(400).json({ message: "Phone number is required" });
      }

      // Normalize phone
      phone = phone.replace(/\D/g, '');
      if (phone.length > 10) phone = phone.slice(-10);

      // Check if user already exists
      const existingUser = await storage.getUserByPhone(phone);
      if (existingUser) {
        return res.status(400).json({
          message: "This mobile number is already registered. Please login using your MPIN.",
          code: "ALREADY_REGISTERED",
        });
      }

      // Check rate limiting
      const canSend = await storage.canSendOtp(phone);
      if (!canSend) {
        return res.status(429).json({ message: process.env.NODE_ENV === 'production' ? "Please wait 1 minute before requesting another OTP" : "Please wait 10 seconds before requesting another OTP" });
      }

      // Cleanup expired OTPs
      await storage.cleanupExpiredOtps();

      // Generate OTP
      const otp = smsService.generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Store OTP in database
      await storage.createOtpVerification({
        phone,
        otpCode: otp,
        expiresAt,
        verified: false,
        verificationAttempts: 0
      });

      // Send OTP via SMS — MDT expects plain 10-digit number (no country code prefix)
      await smsService.sendOTP(phone, otp);

      res.json({ message: "OTP sent successfully" });
    } catch (error) {
      console.error("Error sending registration OTP:", error);
      res.status(500).json({ message: "Failed to send OTP" });
    }
  });

  // Verify registration OTP only — binds the verified phone to the session (AUTH-002)
  app.post("/api/register/verify-phone", async (req, res) => {
    try {
      let { phone, otp } = req.body;
      if (!phone || !otp) {
        return res.status(400).json({ message: "Phone number and OTP are required" });
      }
      phone = phone.replace(/\D/g, "");
      if (phone.length > 10) phone = phone.slice(-10);

      const otpRecord = await storage.getValidOtp(phone, otp);
      if (!otpRecord) {
        return res.status(401).json({ message: "Invalid or expired OTP" });
      }
      if ((otpRecord.verificationAttempts ?? 0) >= 5) {
        return res.status(429).json({ message: "Too many attempts. Please request a new OTP" });
      }
      await storage.incrementOtpAttempts(otpRecord.id);
      await storage.markOtpAsVerified(otpRecord.id);

      req.session.registrationPhone = phone;
      req.session.registrationVerifiedAt = Date.now();

      // Persist the session before responding so the register step can rely on it
      req.session.save((err) => {
        if (err) {
          console.error("Failed to persist registration session:", err);
          return res.status(500).json({ message: "Failed to verify OTP" });
        }
        res.json({ verified: true, phone });
      });
    } catch (error) {
      console.error("Registration phone verification error:", error);
      res.status(500).json({ message: "Failed to verify OTP" });
    }
  });

  app.post("/api/register/verify-otp", async (req, res, next) => {
    try {
      const { phone, otp, name, username, password } = req.body;

      if (!phone || !otp || !name) {
        return res.status(400).json({ message: "Phone, OTP, and name are required" });
      }

      // Get valid OTP from database
      const otpRecord = await storage.getValidOtp(phone, otp);
      
      if (!otpRecord) {
        return res.status(401).json({ message: "Invalid or expired OTP" });
      }

      // Check if too many attempts
      if (otpRecord.verificationAttempts >= 5) {
        return res.status(429).json({ message: "Too many attempts. Please request a new OTP" });
      }

      // Mark OTP as verified
      await storage.markOtpAsVerified(otpRecord.id);

      // Generate username if not provided
      const finalUsername = username || `patient${phone.slice(-6)}`;
      
      // Generate random password if not provided
      const finalPassword = password || randomBytes(8).toString('hex');
      const hashedPassword = await hashPassword(finalPassword);

      // Create user
      const user = await storage.createUser({
        username: finalUsername,
        password: hashedPassword,
        name,
        phone,
        phoneVerified: true,
        role: "patient"
      });

      // Login the user
      req.login(user, (err) => {
        if (err) return next(err);
        
        // Include generated credentials in response if they were auto-generated
        const response: any = { ...user };
        if (!username) response.generatedUsername = finalUsername;
        if (!password) response.generatedPassword = finalPassword;
        
        res.status(201).json(response);
      });
    } catch (error) {
      console.error("Registration OTP verification error:", error);
      res.status(500).json({ message: "Failed to complete registration" });
    }
  });

  // Firebase Auth verification endpoint
  app.post("/api/auth/firebase-verify", async (req, res, next) => {
    try {
      const { idToken, phone } = req.body;

      if (!idToken || !phone) {
        return res.status(400).json({ message: "ID token and phone are required" });
      }

      // For now, we'll trust the Firebase token and just check/create user
      // In production, you should verify the Firebase ID token using firebase-admin SDK
      
      // Check if user exists
      let user = await storage.getUserByPhone(phone);
      
      if (!user) {
        // Create new user with Firebase auth
        const username = `firebase${phone.slice(-6)}`;
        const randomPassword = randomBytes(16).toString('hex');
        const hashedPassword = await hashPassword(randomPassword);
        
        user = await storage.createUser({
          username,
          password: hashedPassword,
          name: `User ${phone.slice(-4)}`,
          phone,
          phoneVerified: true,
          role: "patient"
        });
      } else {
        // Update phone verification status
        await storage.updateUser(user.id, { phoneVerified: true });
      }

      // Login the user
      req.login(user, (err) => {
        if (err) return next(err);
        res.json(user);
      });
    } catch (error) {
      console.error("Firebase verification error:", error);
      res.status(500).json({ message: "Failed to verify Firebase authentication" });
    }
  });

  // ========== SEPARATED AUTHENTICATION ENDPOINTS ==========
  
  // Helper function to get client IP
  function getClientIp(req: any): string {
    return req.ip || req.connection.remoteAddress || '0.0.0.0';
  }

  // Patient Portal - Mobile + MPIN Authentication
  app.post("/api/auth/patient/login", async (req, res) => {
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'];

    try {
      const { mobileNumber, mpin } = req.body;

      // Validate input
      if (!mobileNumber || !mpin) {
        await storage.logLoginAttempt(null, 'patient', ipAddress, userAgent, false, 'Missing credentials');
        return res.status(400).json({ message: "Mobile number and MPIN are required" });
      }

      // Validate MPIN format (4 digits)
      if (!/^\d{4}$/.test(mpin)) {
        await storage.logLoginAttempt(null, 'patient', ipAddress, userAgent, false, 'Invalid MPIN format');
        return res.status(400).json({ message: "MPIN must be 4 digits" });
      }

      // Check rate limiting by IP
      const recentAttempts = await storage.getRecentLoginAttempts(ipAddress, 5);
      if (recentAttempts >= 5) {
        await storage.logLoginAttempt(null, 'patient', ipAddress, userAgent, false, 'Rate limited');
        return res.status(429).json({ message: "Too many login attempts. Please try again later." });
      }

      // Find user by phone
      const user = await storage.getUserByPhoneForMpin(mobileNumber);
      if (!user) {
        await storage.logLoginAttempt(null, 'patient', ipAddress, userAgent, false, 'User not found');
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Check if account is locked
      const isLocked = await storage.isMpinLocked(user.id);
      if (isLocked) {
        await storage.logLoginAttempt(user.id, 'patient', ipAddress, userAgent, false, 'Account locked');
        return res.status(423).json({ message: "Account is temporarily locked. Please try again later." });
      }

      // Check MPIN
      if (!user.mpin) {
        await storage.logLoginAttempt(user.id, 'patient', ipAddress, userAgent, false, 'MPIN not set');
        return res.status(401).json({ message: "MPIN not configured. Please contact clinic admin." });
      }

      const validMpin = await compareMpin(mpin, user.mpin);
      if (!validMpin) {
        await storage.incrementMpinAttempts(user.id);
        
        // Check if we need to lock the account
        if (user.mpinAttempts && user.mpinAttempts >= 2) { // Will be 3 after increment
          await storage.lockMpinAccount(user.id, 15);
          await storage.logLoginAttempt(user.id, 'patient', ipAddress, userAgent, false, 'Invalid MPIN - account locked');
          return res.status(423).json({ message: "Too many failed attempts. Account locked for 15 minutes." });
        }
        
        await storage.logLoginAttempt(user.id, 'patient', ipAddress, userAgent, false, 'Invalid MPIN');
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Successful login - reset attempts
      await storage.resetMpinAttempts(user.id);
      await storage.logLoginAttempt(user.id, 'patient', ipAddress, userAgent, true, null);

      // Set session with 30-minute timeout for patients
      req.session.cookie.maxAge = 30 * 60 * 1000; // 30 minutes
      
      req.login(user, (err) => {
        if (err) {
          console.error("Session creation error:", err);
          return res.status(500).json({ message: "Failed to create session" });
        }
        res.json({ success: true, user });
      });
    } catch (error) {
      console.error("Patient login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  // Staff Portal - Username + Password Authentication
  app.post("/api/auth/staff/login", async (req, res) => {
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'];

    try {
      const { username, password } = req.body;

      // Validate input
      if (!username || !password) {
        await storage.logLoginAttempt(null, 'staff', ipAddress, userAgent, false, 'Missing credentials');
        return res.status(400).json({ message: "Username and password are required" });
      }

      // Check rate limiting
      const recentAttempts = await storage.getRecentLoginAttempts(ipAddress, 5);
      if (recentAttempts >= 10) {
        await storage.logLoginAttempt(null, 'staff', ipAddress, userAgent, false, 'Rate limited');
        return res.status(429).json({ message: "Too many login attempts. Please try again later." });
      }

      // Find user
      const user = await storage.getUserByUsername(username);
      if (!user || user.role !== 'attender') {
        await storage.logLoginAttempt(null, 'staff', ipAddress, userAgent, false, 'Invalid user or role');
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Check password
      const validPassword = await comparePasswords(password, user.password);
      if (!validPassword) {
        await storage.logLoginAttempt(user.id, 'staff', ipAddress, userAgent, false, 'Invalid password');
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Successful login
      await storage.logLoginAttempt(user.id, 'staff', ipAddress, userAgent, true, null);

      // Set session with 2-hour timeout for staff
      req.session.cookie.maxAge = 2 * 60 * 60 * 1000; // 2 hours
      
      req.login(user, (err) => {
        if (err) {
          console.error("Session creation error:", err);
          return res.status(500).json({ message: "Failed to create session" });
        }
        res.json({ success: true, user });
      });
    } catch (error) {
      console.error("Staff login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  // Admin Portal - Username + Password Authentication (enhanced existing)
  app.post("/api/auth/admin/login", async (req, res) => {
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'];

    try {
      const { username, password } = req.body;

      // Validate input
      if (!username || !password) {
        await storage.logLoginAttempt(null, 'admin', ipAddress, userAgent, false, 'Missing credentials');
        return res.status(400).json({ message: "Username and password are required" });
      }

      // Check rate limiting
      const recentAttempts = await storage.getRecentLoginAttempts(ipAddress, 5);
      if (recentAttempts >= 10) {
        await storage.logLoginAttempt(null, 'admin', ipAddress, userAgent, false, 'Rate limited');
        return res.status(429).json({ message: "Too many login attempts. Please try again later." });
      }

      // Find user
      const user = await storage.getUserByUsername(username);
      if (!user || !['super_admin', 'clinic_admin', 'hospital_admin'].includes(user.role)) {
        await storage.logLoginAttempt(null, 'admin', ipAddress, userAgent, false, 'Invalid user or role');
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Check password
      const validPassword = await comparePasswords(password, user.password);
      if (!validPassword) {
        await storage.logLoginAttempt(user.id, 'admin', ipAddress, userAgent, false, 'Invalid password');
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Successful login
      await storage.logLoginAttempt(user.id, 'admin', ipAddress, userAgent, true, null);

      // Set session with 4-hour timeout for admins
      req.session.cookie.maxAge = 4 * 60 * 60 * 1000; // 4 hours
      
      req.login(user, (err) => {
        if (err) {
          console.error("Session creation error:", err);
          return res.status(500).json({ message: "Failed to create session" });
        }
        res.json({ 
          success: true, 
          user,
          mustChangePassword: user.mustChangePassword || false
        });
      });
    } catch (error) {
      console.error("Admin login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  // Patient Self-Registration with MPIN
  app.post("/api/auth/patient/register", async (req, res) => {
    try {
      const { name, mobileNumber, mpin } = req.body;

      // Validate input
      if (!name || !mobileNumber || !mpin) {
        return res.status(400).json({ message: "Name, mobile number, and MPIN are required" });
      }

      // Validate mobile number format
      if (!/^\d{10}$/.test(mobileNumber)) {
        return res.status(400).json({ message: "Mobile number must be 10 digits" });
      }

      // Validate MPIN format
      if (!/^\d{4}$/.test(mpin)) {
        return res.status(400).json({ message: "MPIN must be exactly 4 digits" });
      }

      // AUTH-002: phone must have been OTP-verified in this session within 15 minutes
      const verifiedPhone = req.session.registrationPhone;
      const verifiedAt = req.session.registrationVerifiedAt ?? 0;
      const VERIFICATION_WINDOW_MS = 15 * 60 * 1000;
      if (verifiedPhone !== mobileNumber || Date.now() - verifiedAt > VERIFICATION_WINDOW_MS) {
        return res.status(403).json({
          message: "Mobile number not verified. Please complete OTP verification first.",
        });
      }

      // Check if mobile number already exists
      const existingUser = await storage.getUserByPhone(mobileNumber);
      if (existingUser) {
        return res.status(400).json({
          message: "This mobile number is already registered. Please login using your MPIN.",
          code: "ALREADY_REGISTERED",
        });
      }

      // Auto-generate a username (collision-safe) — patients never see it
      let username = `patient${mobileNumber.slice(-6)}`;
      if (await storage.getUserByUsername(username)) {
        username = `patient${mobileNumber.slice(-6)}${randomBytes(2).toString("hex")}`;
      }

      // Hash MPIN (using same function as password)
      const hashedMpin = await hashMpin(mpin);
      
      // Also create a dummy password (required by schema)
      const dummyPassword = await hashPassword(randomBytes(16).toString('hex'));

      // Create user with patient role
      const user = await storage.createUser({
        name,
        username,
        password: dummyPassword, // Required but not used for patient login
        role: 'patient',
        phone: mobileNumber,
        email: null,
        specialty: null,
        bio: null,
        imageUrl: null,
        phoneVerified: true, // Self-registered users are considered verified
      });

      // Set MPIN for the user
      await storage.updateMpin(user.id, hashedMpin);

      // AUTH-002: clear the verification so it cannot be reused
      delete req.session.registrationPhone;
      delete req.session.registrationVerifiedAt;

      res.status(201).json({
        message: "Registration successful! You can now login with your mobile number and MPIN.",
        userId: user.id
      });
    } catch (error) {
      console.error("Patient registration error:", error);
      res.status(500).json({ message: "Failed to create account. Please try again." });
    }
  });

  // MPIN Management Endpoints
  app.post("/api/auth/patient/set-mpin", async (req, res) => {
    if (!req.user || !['clinic_admin', 'super_admin', 'hospital_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: "Only admins can set MPIN" });
    }

    try {
      const { patientId, newMpin, adminPassword } = req.body;

      // Validate input
      if (!patientId || !newMpin || !adminPassword) {
        return res.status(400).json({ message: "Patient ID, new MPIN, and admin password are required" });
      }

      // Validate MPIN format
      if (!/^\d{4}$/.test(newMpin)) {
        return res.status(400).json({ message: "MPIN must be exactly 4 digits" });
      }

      // Verify admin password
      const admin = await storage.getUserByUsername(req.user.username);
      if (!admin || !(await comparePasswords(adminPassword, admin.password))) {
        return res.status(401).json({ message: "Invalid admin password" });
      }

      // Get patient
      const patient = await storage.getUser(patientId);
      if (!patient || patient.role !== 'patient') {
        return res.status(404).json({ message: "Patient not found" });
      }

      // Hash and update MPIN
      const hashedMpin = await hashMpin(newMpin);
      await storage.updateMpin(patientId, hashedMpin);

      res.json({ message: "MPIN set successfully" });
    } catch (error) {
      console.error("Set MPIN error:", error);
      res.status(500).json({ message: "Failed to set MPIN" });
    }
  });

  app.post("/api/auth/patient/reset-mpin", async (req, res) => {
    if (!req.user || !['clinic_admin', 'super_admin', 'hospital_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: "Only admins can reset MPIN" });
    }

    try {
      const { mobileNumber, adminPassword, newMpin } = req.body;

      // Validate input
      if (!mobileNumber || !newMpin || !adminPassword) {
        return res.status(400).json({ message: "Mobile number, new MPIN, and admin password are required" });
      }

      // Validate MPIN format
      if (!/^\d{4}$/.test(newMpin)) {
        return res.status(400).json({ message: "MPIN must be exactly 4 digits" });
      }

      // Verify admin password
      const admin = await storage.getUserByUsername(req.user.username);
      if (!admin || !(await comparePasswords(adminPassword, admin.password))) {
        return res.status(401).json({ message: "Invalid admin password" });
      }

      // Get patient by phone
      const patient = await storage.getUserByPhoneForMpin(mobileNumber);
      if (!patient) {
        return res.status(404).json({ message: "Patient not found with this mobile number" });
      }

      // Hash and update MPIN
      const hashedMpin = await hashMpin(newMpin);
      await storage.updateMpin(patient.id, hashedMpin);

      res.json({ message: "MPIN reset successfully", patientName: patient.name });
    } catch (error) {
      console.error("Reset MPIN error:", error);
      res.status(500).json({ message: "Failed to reset MPIN" });
    }
  });

  app.post("/api/auth/patient/change-mpin", async (req, res) => {
    if (!req.user || req.user.role !== 'patient') {
      return res.status(403).json({ message: "Only patients can change their own MPIN" });
    }

    try {
      const { currentMpin, newMpin } = req.body;

      // Validate input
      if (!currentMpin || !newMpin) {
        return res.status(400).json({ message: "Current MPIN and new MPIN are required" });
      }

      // Validate MPIN format
      if (!/^\d{4}$/.test(newMpin)) {
        return res.status(400).json({ message: "MPIN must be exactly 4 digits" });
      }

      // Get user
      const user = await storage.getUser(req.user.id);
      if (!user || !user.mpin) {
        return res.status(400).json({ message: "MPIN not configured" });
      }

      // Verify current MPIN
      const validMpin = await compareMpin(currentMpin, user.mpin);
      if (!validMpin) {
        return res.status(401).json({ message: "Current MPIN is incorrect" });
      }

      // Hash and update MPIN
      const hashedMpin = await hashMpin(newMpin);
      await storage.updateMpin(req.user.id, hashedMpin);

      res.json({ message: "MPIN changed successfully" });
    } catch (error) {
      console.error("Change MPIN error:", error);
      res.status(500).json({ message: "Failed to change MPIN" });
    }
  });

  // ========== SELF-SERVICE FORGOT MPIN (OTP-verified) ==========

  // Step 1: send an OTP to a registered patient's mobile
  app.post("/api/auth/patient/forgot-mpin/request-otp", async (req, res) => {
    try {
      let { phone } = req.body;
      if (!phone) {
        return res.status(400).json({ message: "Phone number is required" });
      }
      phone = phone.replace(/\D/g, "");
      if (phone.length > 10) phone = phone.slice(-10);

      // Unlike registration, the number MUST belong to an existing patient
      const user = await storage.getUserByPhoneForMpin(phone);
      if (!user) {
        return res.status(404).json({
          message: "This mobile number is not registered. Please register first.",
          code: "NOT_REGISTERED",
        });
      }

      const canSend = await storage.canSendOtp(phone);
      if (!canSend) {
        return res.status(429).json({ message: process.env.NODE_ENV === 'production' ? "Please wait 1 minute before requesting another OTP" : "Please wait 10 seconds before requesting another OTP" });
      }

      await storage.cleanupExpiredOtps();

      const otp = smsService.generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      await storage.createOtpVerification({
        phone,
        otpCode: otp,
        expiresAt,
        verified: false,
        verificationAttempts: 0
      });
      await storage.updateLastOtpSentAt(phone);
      await smsService.sendOTP(phone, otp);

      res.json({ message: "OTP sent successfully" });
    } catch (error) {
      console.error("Forgot MPIN OTP request error:", error);
      res.status(500).json({ message: "Failed to send OTP" });
    }
  });

  // Step 2: verify the OTP and bind the phone to the session for the reset step
  app.post("/api/auth/patient/forgot-mpin/verify-otp", async (req, res) => {
    try {
      let { phone, otp } = req.body;
      if (!phone || !otp) {
        return res.status(400).json({ message: "Phone number and OTP are required" });
      }
      phone = phone.replace(/\D/g, "");
      if (phone.length > 10) phone = phone.slice(-10);

      const otpRecord = await storage.getValidOtp(phone, otp);
      if (!otpRecord) {
        return res.status(401).json({ message: "Invalid or expired OTP" });
      }
      if ((otpRecord.verificationAttempts ?? 0) >= 5) {
        return res.status(429).json({ message: "Too many attempts. Please request a new OTP" });
      }
      await storage.incrementOtpAttempts(otpRecord.id);
      await storage.markOtpAsVerified(otpRecord.id);

      req.session.resetMpinPhone = phone;
      req.session.resetMpinVerifiedAt = Date.now();

      // Persist the session before responding so the reset step can rely on it
      req.session.save((err) => {
        if (err) {
          console.error("Failed to persist MPIN reset session:", err);
          return res.status(500).json({ message: "Failed to verify OTP" });
        }
        res.json({ verified: true, phone });
      });
    } catch (error) {
      console.error("Forgot MPIN OTP verification error:", error);
      res.status(500).json({ message: "Failed to verify OTP" });
    }
  });

  // Step 3: set the new MPIN — only for the session-verified phone, within 15 minutes
  app.post("/api/auth/patient/forgot-mpin/reset", async (req, res) => {
    try {
      const { mobileNumber, newMpin } = req.body;
      if (!mobileNumber || !newMpin) {
        return res.status(400).json({ message: "Mobile number and new MPIN are required" });
      }
      if (!/^\d{10}$/.test(mobileNumber)) {
        return res.status(400).json({ message: "Mobile number must be 10 digits" });
      }
      if (!/^\d{4}$/.test(newMpin)) {
        return res.status(400).json({ message: "MPIN must be exactly 4 digits" });
      }

      // Phone must have been OTP-verified in this session within 15 minutes
      const verifiedPhone = req.session.resetMpinPhone;
      const verifiedAt = req.session.resetMpinVerifiedAt ?? 0;
      const VERIFICATION_WINDOW_MS = 15 * 60 * 1000;
      if (verifiedPhone !== mobileNumber || Date.now() - verifiedAt > VERIFICATION_WINDOW_MS) {
        return res.status(403).json({
          message: "Mobile number not verified. Please complete OTP verification first.",
        });
      }

      const user = await storage.getUserByPhoneForMpin(mobileNumber);
      if (!user) {
        return res.status(404).json({
          message: "This mobile number is not registered. Please register first.",
          code: "NOT_REGISTERED",
        });
      }

      // updateMpin also resets attempt counters and clears any lockout
      const hashedMpin = await hashMpin(newMpin);
      await storage.updateMpin(user.id, hashedMpin);

      // One reset per verification
      delete req.session.resetMpinPhone;
      delete req.session.resetMpinVerifiedAt;

      res.json({ message: "MPIN reset successfully. You can now login with your new MPIN." });
    } catch (error) {
      console.error("Forgot MPIN reset error:", error);
      res.status(500).json({ message: "Failed to reset MPIN" });
    }
  });
}