import {
  doctorDailyPresence,
  appointments,
  doctorSchedules,
  clinics,
  users,
  attenderDoctors,
  doctorDetails,
  doctorClinics,
  patientFavorites,
  notifications,
  otpVerifications,
  loginAttempts,
  adminConfigurations,
  patientWallets,
  walletTransactions,
  appointmentRefunds,
  tokenReservations,
  deviceTokens,
  type User,
  type AttenderDoctor,
  type InsertUser,
  type Appointment,
  type Clinic,
  type DoctorDetail,
  type DoctorSchedule,
  type InsertDoctorSchedule,
  type PatientFavorite,
  type InsertPatientFavorite,
  type OtpVerification,
  type InsertOtpVerification,
  type AdminConfiguration,
  type InsertAdminConfiguration,
  type PatientWallet,
  type WalletTransaction,
  type AppointmentRefund,
  type TokenReservation
} from "@shared/schema";
import { eq, or, and, sql, inArray, lte, gte, count, not, gt, lt, getTableColumns, isNotNull, ne, max } from "drizzle-orm";
import { db } from "./db";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { Pool } from '@neondatabase/serverless';
import { pool } from "./db";
import { number } from "zod";

const pgSession = connectPg(session);

const sessionStore = new pgSession({
  pool: pool as any,
  tableName: 'session',
  createTableIfMissing: true
});

export interface IStorage {
  // Attender Dashboard methods
  getAttenderClinicOverview(attenderId: number): Promise<{
    clinic: {
      id: number;
      name: string;
      address: string;
      phone: string;
      openingHours: string;
    };
    todayStats: {
      totalDoctors: number;
      activeDoctors: number;
      totalAppointments: number;
    };
  }>;
  getAttenderDoctorsSummary(attenderId: number): Promise<{
    doctors: Array<{
      id: number;
      name: string;
      specialty: string;
      isPresent: boolean;
      todayAppointments: number;
    }>;
    totalAssigned: number;
  }>;
  getAttenderSchedulesToday(attenderId: number): Promise<{
    schedules: Array<{
      id: number;
      doctorName: string;
      timeSlot: string;
      appointmentCount: number;
      status: 'token_started' | 'in_progress' | 'paused' | 'completed' | 'cancelled' | 'inactive_hidden' | 'inactive_visible' | 'schedule_completed' | 'booking_closed';
    }>;
    summary: {
      totalSchedules: number;
      activeSchedules: number;
      totalAppointments: number;
    };
  }>;

  // Schedule methods
  updateSchedule(scheduleId: number, data: { isActive?: boolean; isPaused?: boolean; cancelReason?: string }): Promise<DoctorSchedule>;
  pauseSchedule(scheduleId: number, reason: string): Promise<void>;
  resumeSchedule(scheduleId: number): Promise<void>;
  completeSchedule(scheduleId: number): Promise<void>;
  closeScheduleBooking(scheduleId: number): Promise<void>;
  openScheduleBooking(scheduleId: number): Promise<void>;
  getAppointment(appointmentId: number): Promise<Appointment | null>;
  getAppointmentsBySchedule(scheduleId: number): Promise<Appointment[]>;

  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByPhone(phone: string): Promise<User | undefined>;
  getUserWithClinic(id: number): Promise<(User & { clinic?: Clinic }) | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, userData: Partial<InsertUser>): Promise<User>;
  deleteUser(id: number): Promise<void>;
  
  // OTP related methods
  createOtpVerification(data: InsertOtpVerification): Promise<OtpVerification>;
  getValidOtp(phone: string, otpCode: string): Promise<OtpVerification | undefined>;
  markOtpAsVerified(id: number): Promise<void>;
  incrementOtpAttempts(id: number): Promise<void>;
  cleanupExpiredOtps(): Promise<void>;
  canSendOtp(phone: string): Promise<boolean>;
  updateLastOtpSentAt(phone: string): Promise<void>;
  getDoctors(): Promise<User[]>;
  getDoctorsBySpecialty(specialty: string): Promise<User[]>;
  getDoctorSpecialties(): Promise<string[]>;
  getDoctorWithClinic(id: number): Promise<(User & { clinic?: Clinic }) | undefined>;
  getDoctorsNearLocation(lat: number, lng: number, radiusInMiles?: number): Promise<User[]>;
  getClinicsNearLocation(lat: number, lng: number, radiusInKm?: number): Promise<(Clinic & { distance: number })[]>;
  getClinicAdmins(): Promise<(User & { clinic?: Clinic })[]>;
  getClinicAdminByClinicId(clinicId: number): Promise<Omit<User, 'password'> | undefined>;
  getClinics(): Promise<Clinic[]>;
  getClinic(id: number): Promise<Clinic | undefined>;
  createClinic(clinic: typeof clinics.$inferInsert): Promise<Clinic>;
  updateClinic(id: number, clinicData: Partial<typeof clinics.$inferInsert>): Promise<Clinic>;
  deleteClinic(id: number): Promise<void>;
  getAppointments(userId: number): Promise<(Appointment & { doctor: User; patient?: User })[]>;
  getDoctorAppointmentsByDate(doctorId: number, date: Date, clinicId?: number): Promise<Appointment[]>;
  createAppointment(appointment: Omit<Appointment, "id"> & { tokenNumber?: number }): Promise<Appointment>;
  getNextTokenNumber(doctorId: number, clinicId: number, scheduleId: number): Promise<number>;
  sessionStore: session.Store;
  
  // Doctor-Clinic relationships
  getDoctorClinics(doctorId: number): Promise<Clinic[]>;
  addDoctorToClinic(doctorId: number, clinicId: number): Promise<void>;
  updateDoctorClinics(doctorId: number, clinicIds: number[]): Promise<void>;

  getAttenderDoctors(attenderId: number): Promise<(AttenderDoctor & { doctor: User })[]>;
  addDoctorToAttender(attenderId: number, doctorId: number, clinicId: number): Promise<AttenderDoctor>;
  removeDoctorFromAttender(attenderId: number, doctorId: number): Promise<void>;
  getAttendersByClinic(clinicId: number): Promise<User[]>;
  getAttendersByRole(): Promise<User[]>;
  updateAppointmentStatus(
    appointmentId: number, 
    status: "scheduled" | "in_progress" | "hold" | "pause" | "cancel" | "no_show" | "completed" | "expired",
    statusNotes?: string
  ): Promise<Appointment>;
  updateDoctorAvailability(
    doctorId: number,
    date: Date,
    isAvailable: boolean,
    currentToken?: number
  ): Promise<typeof doctorDailyPresence.$inferSelect>;
  getDoctorAvailability(doctorId: number, date: Date): Promise<typeof doctorDailyPresence.$inferSelect | undefined>;
  getPatientAppointments(patientId: number): Promise<(Appointment & { doctor: User })[]>;
  getAttenderDoctorsAppointments(attenderId: number): Promise<(AttenderDoctor & { 
    doctor: User, 
    appointments: (Appointment & { patient?: User })[], 
    schedules: (typeof doctorSchedules.$inferSelect & { 
      appointments: (Appointment & { patient?: User })[]
    })[]
  })[]>;

  // Token Progress method
  getCurrentTokenProgress(doctorId: number, clinicId: number, date: Date, retryCount?: number): Promise<{ currentToken: number; status: 'start' | 'completed' | 'scheduled' | 'hold' | 'pause' | 'cancel' | 'not_started' | 'no_appointments'; appointment?: Appointment }>;

  // Doctor management methods
  createDoctor(user: Omit<InsertUser, "role">, details: { consultationFee: number | string; consultationDuration: number; qualifications?: string; experience?: number; registrationNumber?: string; isEnabled?: boolean; }): Promise<User & { details: DoctorDetail }>;
  getDoctorDetails(doctorId: number): Promise<DoctorDetail | undefined>;
  updateDoctorDetails(doctorId: number, details: Partial<{
    consultationFee: number | string;
    consultationDuration: number;
    qualifications: string;
    experience: number;
    registrationNumber: string;
  }>): Promise<DoctorDetail>;
  toggleDoctorStatus(doctorId: number, isEnabled: boolean): Promise<DoctorDetail>;

  // Doctor schedules methods
  createDoctorSchedule(schedule: InsertDoctorSchedule): Promise<DoctorSchedule>;
  getDoctorSchedule(scheduleId: number): Promise<DoctorSchedule | null>;
  getDoctorSchedules(doctorId: number, date?: Date): Promise<DoctorSchedule[]>;
  getDoctorSchedulesByClinic(clinicId: number): Promise<(DoctorSchedule & { doctor: User })[]>;
  getSpecificSchedule(doctorId: number, clinicId: number, scheduleId: number, date: Date): Promise<DoctorSchedule | null>;
  getDoctorAvailableTimeSlots(doctorId: number, date: Date): Promise<{ 
    schedules: (DoctorSchedule & { clinic: Clinic, currentTokenCount?: number })[], 
    availableSlots: { 
      startTime: string, 
      endTime: string, 
      clinicId: number,
      clinicName: string
    }[] 
  }>;
  updateDoctorSchedule(id: number, schedule: Partial<InsertDoctorSchedule>): Promise<DoctorSchedule>;
  deleteDoctorSchedule(id: number): Promise<{ deletedSchedule: any, cancelledAppointments: any[] }>;
  getAvailableDoctors(clinicId: number, date: Date, time: string): Promise<User[]>;

  getAppointmentCountForDoctor(
    doctorId: number,
    clinicId: number,
    scheduleId: number
  ): Promise<number>;

  // Add these to the IStorage interface
  updateDoctorArrivalStatus(
    doctorId: number,
    clinicId: number,
    scheduleId: number | null,
    date: Date,
    hasArrived: boolean
  ): Promise<typeof doctorDailyPresence.$inferSelect>;
  
  getDoctorArrivalStatus(
    doctorId: number,
    clinicId: number,
    date: Date
  ): Promise<typeof doctorDailyPresence.$inferSelect | undefined>;

  // Add this new method to the interface
  createWalkInAppointment(appointment: {
    doctorId: number;
    clinicId: number;
    scheduleId?: number;
    date: Date;
    guestName: string;
    guestPhone?: string;
    isWalkIn: boolean;
    status?: string;
  }): Promise<Appointment>;

  // Add this new method to count walk-in patients ahead
  countWalkInPatientsAhead(
    doctorId: number,
    clinicId: number,
    currentToken: number,
    patientToken: number
  ): Promise<number>;

  // Token reservation methods for walk-in flow
  reserveNextToken(scheduleId: number, reservedByUserId: number): Promise<TokenReservation>;
  confirmTokenReservation(reservationId: number, guestName: string, guestPhone: string | undefined): Promise<Appointment>;
  cancelTokenReservation(reservationId: number, userId: number): Promise<void>;
  expireStaleReservations(): Promise<void>;
  getActiveReservationsForSchedule(scheduleId: number): Promise<TokenReservation[]>;

  updateDoctor(
    doctorId: number,
    user: Omit<InsertUser, "role" | "password" | "username" | "phone">,
    details: {
      consultationFee: number | string;
      consultationDuration: number;
      qualifications?: string;
      experience?: number;
      registrationNumber?: string;
      isEnabled?: boolean;
    }
  ): Promise<User & { details: DoctorDetail }>;

  // Patient Favorites methods
  addFavoriteSchedule(patientId: number, scheduleId: number, doctorId: number, clinicId: number): Promise<PatientFavorite>;
  removeFavoriteSchedule(patientId: number, scheduleId: number): Promise<void>;
  getPatientFavorites(patientId: number): Promise<(PatientFavorite & { 
    doctor: User; 
    schedule: DoctorSchedule; 
    clinic: Clinic 
  })[]>;
  checkIsFavorite(patientId: number, scheduleId: number): Promise<boolean>;
  getPatientsFavoritingSchedule(scheduleId: number): Promise<number[]>;
  
  // Export Report methods
  getDoctorsByAttender(attenderId: number): Promise<User[]>;
  getAppointmentsForExport(
    doctorId: number,
    startDate: Date,
    endDate: Date
  ): Promise<any[]>;
  getAppointmentsForScheduleExport(
    doctorId: number,
    scheduleId: number
  ): Promise<any[]>;

  // Super Admin Dashboard methods
  getSuperAdminDashboardMetrics(): Promise<{
    totalAppointments: number;
    completedAppointments: number;
    pendingAppointments: number;
    activePatients: number;
    activeDoctors: number;
    todayRevenue: number;
    monthlyRevenue: number;
    totalClinics: number;
  }>;

  // Appointment refund methods
  markAppointmentAsRefunded(appointmentId: number, refundAmount: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  sessionStore: session.Store;

  constructor() {
    this.sessionStore = sessionStore;
  }

  async getAppointment(appointmentId: number): Promise<Appointment | null> {
    const result = await db
      .select()
      .from(appointments)
      .where(eq(appointments.id, appointmentId))
      .limit(1);
    
    return result.length > 0 ? result[0] : null;
  }

  async getAppointmentsBySchedule(scheduleId: number): Promise<Appointment[]> {
    return db
      .select()
      .from(appointments)
      .where(eq(appointments.scheduleId, scheduleId));
  }

  async pauseSchedule(scheduleId: number, reason: string): Promise<void> {
    await db
      .update(doctorSchedules)
      .set({
        isPaused: true,
        pauseReason: reason,
        pausedAt: sql`CURRENT_TIMESTAMP`,
        resumedAt: null
      })
      .where(eq(doctorSchedules.id, scheduleId));
  }

  async resumeSchedule(scheduleId: number): Promise<void> {
    await db
      .update(doctorSchedules)
      .set({
        isPaused: false,
        pauseReason: null,
        cancelReason: null,
        isActive: true,
        resumedAt: sql`CURRENT_TIMESTAMP`
      })
      .where(eq(doctorSchedules.id, scheduleId));
  }

  async completeSchedule(scheduleId: number): Promise<void> {
    await db.transaction(async (tx) => {
      // Cancel any remaining non-terminal appointments (walk-ins, unpaid, etc.)
      // Exclude 'expired' — those are already terminal placeholder records
      await tx.update(appointments)
        .set({ status: 'cancel', statusNotes: 'Schedule completed' })
        .where(and(
          eq(appointments.scheduleId, scheduleId),
          sql`${appointments.status} NOT IN ('completed', 'no_show', 'cancel', 'expired')`
        ));

      await tx.update(doctorSchedules)
        .set({ scheduleStatus: 'completed', completedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(doctorSchedules.id, scheduleId));
    });
  }

  async closeScheduleBooking(scheduleId: number): Promise<void> {
    await db
      .update(doctorSchedules)
      .set({
        bookingStatus: 'closed',
        bookingClosedAt: sql`CURRENT_TIMESTAMP`
      })
      .where(eq(doctorSchedules.id, scheduleId));
  }

  async openScheduleBooking(scheduleId: number): Promise<void> {
    await db
      .update(doctorSchedules)
      .set({
        bookingStatus: 'open',
        bookingClosedAt: null
      })
      .where(eq(doctorSchedules.id, scheduleId));
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByPhone(phone: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.phone, phone));
    return user;
  }

  async getUserWithClinic(id: number): Promise<(User & { clinic?: Clinic }) | undefined> {
    const [result] = await db
      .select({
        id: users.id,
        username: users.username,
        password: users.password,
        name: users.name,
        role: users.role,
        phone: users.phone,
        email: users.email,
        specialty: users.specialty,
        bio: users.bio,
        imageUrl: users.imageUrl,
        address: users.address,
        city: users.city,
        state: users.state,
        zipCode: users.zipCode,
        latitude: users.latitude,
        longitude: users.longitude,
        clinicId: users.clinicId,
        createdAt: users.createdAt,
        clinic: clinics,
      })
      .from(users)
      .leftJoin(clinics, eq(users.clinicId, clinics.id))
      .where(eq(users.id, id));

    if (!result) return undefined;

    const { clinic, ...user } = result;
    return {
      ...user,
      clinic: clinic || undefined,
    };
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUser(id: number, userData: Partial<InsertUser>): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set(userData)
      .where(eq(users.id, id))
      .returning();
    return updatedUser;
  }

  async deleteUser(id: number): Promise<void> {
    // Begin transaction to ensure data consistency
    await db.transaction(async (tx) => {
      // Get user info to determine what to clean up
      const [user] = await tx.select().from(users).where(eq(users.id, id));
      
      if (!user) {
        throw new Error('User not found');
      }
      
      if (user.role === 'doctor') {
        // For doctors, we'll remove all their data since they're being deleted entirely
        // Important: Delete in the correct order to avoid foreign key constraints
        
        // 1. Delete notifications related to this doctor's appointments first
        await tx.delete(notifications).where(
          sql`appointment_id IN (SELECT id FROM appointments WHERE doctor_id = ${id})`
        );
        
        // 2. Delete all appointments for this doctor (both active and completed)
        await tx.delete(appointments).where(eq(appointments.doctorId, id));
        
        // 3. Delete doctor availability records BEFORE schedules (since it references schedules)
        await tx.delete(doctorDailyPresence).where(eq(doctorDailyPresence.doctorId, id));
        
        // 4. Delete doctor schedules AFTER daily presence records
        await tx.delete(doctorSchedules).where(eq(doctorSchedules.doctorId, id));
        
        // 5. Delete patient favorites for this doctor
        await tx.delete(patientFavorites).where(eq(patientFavorites.doctorId, id));
        
        // 6. Delete attender-doctor relationships
        await tx.delete(attenderDoctors).where(eq(attenderDoctors.doctorId, id));
        
        // 7. Delete doctor-clinic associations
        await tx.delete(doctorClinics).where(eq(doctorClinics.doctorId, id));
        
        // 8. Delete doctor details
        await tx.delete(doctorDetails).where(eq(doctorDetails.doctorId, id));
        
      } else if (user.role === 'attender') {
        // For attenders, just clean up their relationships
        // 1. Delete attender-doctor relationships
        await tx.delete(attenderDoctors).where(eq(attenderDoctors.attenderId, id));
        
        // 2. Delete notifications for this attender
        await tx.delete(notifications).where(eq(notifications.userId, id));
      }
      
      // Finally, delete the user
      await tx.delete(users).where(eq(users.id, id));
    });
  }

  async getDoctors(): Promise<User[]> {
    return await db.select().from(users).where(eq(users.role, "doctor"));
  }

  async getDoctorsBySpecialty(specialty: string): Promise<User[]> {
    return await db.select().from(users).where(eq(users.specialty, specialty));
  }

  // Distinct specialties of existing doctors — drives the search filter dropdown
  async getDoctorSpecialties(): Promise<string[]> {
    const rows = await db
      .selectDistinct({ specialty: users.specialty })
      .from(users)
      .where(eq(users.role, "doctor"));
    return rows
      .map((r) => r.specialty)
      .filter((s): s is string => !!s)
      .sort();
  }

  async getClinicAdmins(): Promise<(User & { clinic?: Clinic })[]> {
    const results = await db
      .select({
        id: users.id,
        username: users.username,
        password: users.password,
        name: users.name,
        role: users.role,
        phone: users.phone,
        email: users.email,
        specialty: users.specialty,
        bio: users.bio,
        imageUrl: users.imageUrl,
        address: users.address,
        city: users.city,
        state: users.state,
        zipCode: users.zipCode,
        latitude: users.latitude,
        longitude: users.longitude,
        clinicId: users.clinicId,
        createdAt: users.createdAt,
        clinic: clinics,
      })
      .from(users)
      .leftJoin(clinics, eq(users.clinicId, clinics.id))
      .where(eq(users.role, 'clinic_admin'));

    return results.map(result => {
      const { clinic, ...user } = result;
      return {
        ...user,
        clinic: clinic || undefined,
      };
    });
  }

  async getClinicAdminByClinicId(clinicId: number): Promise<Omit<User, 'password'> | undefined> {
    const [result] = await db
      .select({
        id: users.id,
        username: users.username,
        name: users.name,
        role: users.role,
        phone: users.phone,
        email: users.email,
        specialty: users.specialty,
        bio: users.bio,
        imageUrl: users.imageUrl,
        address: users.address,
        city: users.city,
        state: users.state,
        zipCode: users.zipCode,
        latitude: users.latitude,
        longitude: users.longitude,
        clinicId: users.clinicId,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(and(eq(users.role, 'clinic_admin'), eq(users.clinicId, clinicId)))
      .limit(1);
    return result;
  }

  async getDoctorWithClinic(id: number): Promise<(User & { clinic?: Clinic }) | undefined> {
    const [result] = await db
      .select({
        id: users.id,
        username: users.username,
        password: users.password,
        name: users.name,
        role: users.role,
        specialty: users.specialty,
        bio: users.bio,
        imageUrl: users.imageUrl,
        address: users.address,
        city: users.city,
        state: users.state,
        zipCode: users.zipCode,
        latitude: users.latitude,
        longitude: users.longitude,
        clinicId: users.clinicId,
        clinic: clinics,
      })
      .from(users)
      .leftJoin(clinics, eq(users.clinicId, clinics.id))
      .where(eq(users.id, id));

    if (!result) return undefined;

    const { clinic, ...user } = result;
    return {
      ...user,
      clinic: clinic || undefined,
    };
  }

  async getDoctorsNearLocation(lat: number, lng: number, radiusInMiles: number = 10): Promise<User[]> {
    const haversineDistance = sql`
      69.0 * DEGREES(ACOS(
        COS(RADIANS(${lat})) * 
        COS(RADIANS(CAST(latitude AS FLOAT))) * 
        COS(RADIANS(CAST(longitude AS FLOAT)) - RADIANS(${lng})) + 
        SIN(RADIANS(${lat})) * 
        SIN(RADIANS(CAST(latitude AS FLOAT)))
      ))`;

    return await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.role, "doctor"),
          sql`${haversineDistance} <= ${radiusInMiles}`
        )
      )
      .orderBy(haversineDistance);
  }

  async getClinicsNearLocation(lat: number, lng: number, radiusInKm: number = 10): Promise<(Clinic & { distance: number })[]> {
    try {
      console.log(`Searching for clinics near ${lat}, ${lng} within ${radiusInKm}km`);
      
      // Test with a simpler approach first - just get all clinics
      console.log('Attempting to fetch all clinics...');
      const allClinics = await db.select().from(clinics);
      console.log(`Successfully fetched ${allClinics.length} total clinics`);
      
      // Filter clinics that have valid coordinates and calculate distances
      const clinicsWithDistance: any[] = [];
      
      for (const clinic of allClinics) {
        // Check if clinic has coordinates
        if (!clinic.latitude || !clinic.longitude) {
          console.log(`Skipping clinic ${clinic.name} - no coordinates`);
          continue;
        }
        
        const clinicLat = parseFloat(clinic.latitude.toString());
        const clinicLng = parseFloat(clinic.longitude.toString());
        
        if (isNaN(clinicLat) || isNaN(clinicLng)) {
          console.log(`Skipping clinic ${clinic.name} - invalid coordinates: ${clinic.latitude}, ${clinic.longitude}`);
          continue;
        }
        
        // Calculate distance using Haversine formula
        const R = 6371; // Earth's radius in kilometers
        const dLat = (clinicLat - lat) * Math.PI / 180;
        const dLng = (clinicLng - lng) * Math.PI / 180;
        const a = 
          Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(lat * Math.PI / 180) * Math.cos(clinicLat * Math.PI / 180) *
          Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const distance = R * c;
        
        console.log(`🏥 Clinic "${clinic.name}" at ${clinicLat}, ${clinicLng} is ${distance.toFixed(2)}km away`);
        
        // Include clinics within the 0-10km range (changed from 5-10km)
        if (distance >= 0 && distance <= radiusInKm) {
          console.log(`✅ Including clinic "${clinic.name}" (${distance.toFixed(2)}km)`);
          clinicsWithDistance.push({
            id: clinic.id,
            name: clinic.name,
            address: clinic.address,
            city: clinic.city,
            state: clinic.state,
            zipCode: clinic.zipCode,
            phone: clinic.phone,
            email: clinic.email,
            openingHours: clinic.openingHours,
            description: clinic.description,
            imageUrl: clinic.imageUrl,
            createdAt: clinic.createdAt,
            latitude: clinicLat,
            longitude: clinicLng,
            distance: distance
          });
        } else {
          console.log(`❌ Excluding clinic "${clinic.name}" (${distance.toFixed(2)}km) - outside 0-${radiusInKm}km range`);
        }
      }
      
      // Sort by distance
      clinicsWithDistance.sort((a, b) => a.distance - b.distance);
      
      console.log(`Found ${clinicsWithDistance.length} clinics within 0-${radiusInKm}km range (updated from 5-10km)`);
      
      return clinicsWithDistance;
    } catch (error) {
      console.error('Error in getClinicsNearLocation:', error);
      throw error;
    }
  }

  async getClinics(): Promise<Clinic[]> {
    return await db.select().from(clinics);
  }

  // Comprehensive search functionality for patients
  async searchByCity(cityName: string, userLat?: number, userLng?: number): Promise<any[]> {
    try {
      // Get all clinics in the specified city
      const cityResults = await db
        .select()
        .from(clinics)
        .where(sql`LOWER(${clinics.city}) LIKE LOWER(${'%' + cityName + '%'})`);

      // For each clinic, get doctor count and calculate distance
      const resultsWithDoctors = await Promise.all(
        cityResults.map(async (clinic) => {
          const doctorCount = await db
            .select({ count: count() })
            .from(users)
            .leftJoin(doctorClinics, eq(users.id, doctorClinics.doctorId))
            .where(
              and(
                eq(users.role, "doctor"),
                or(
                  eq(users.clinicId, clinic.id),
                  eq(doctorClinics.clinicId, clinic.id)
                )
              )
            );

          // Calculate distance if user location and clinic coordinates available
          let distance = null;
          if (userLat && userLng && clinic.latitude && clinic.longitude) {
            const lat = parseFloat(clinic.latitude.toString());
            const lng = parseFloat(clinic.longitude.toString());
            
            if (!isNaN(lat) && !isNaN(lng)) {
              // Haversine formula for distance calculation
              const R = 6371; // Earth's radius in kilometers
              const dLat = (lat - userLat) * Math.PI / 180;
              const dLng = (lng - userLng) * Math.PI / 180;
              const a = 
                Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(userLat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
              const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
              distance = R * c;
            }
          }

          return {
            id: `city-${clinic.id}`,
            type: 'city',
            name: clinic.name,
            city: clinic.city,
            address: clinic.address,
            phone: clinic.phone,
            email: clinic.email,
            openingHours: clinic.openingHours,
            hospitalCount: doctorCount[0]?.count || 0,
            clinicId: clinic.id,
            distance
          };
        })
      );

      // Sort by distance if available (nearest first)
      if (userLat && userLng) {
        resultsWithDoctors.sort((a, b) => {
          if (a.distance === null && b.distance === null) return 0;
          if (a.distance === null) return 1;
          if (b.distance === null) return -1;
          return a.distance - b.distance;
        });
      }

      return resultsWithDoctors;
    } catch (error) {
      console.error('Error in searchByCity:', error);
      throw error;
    }
  }

  async searchByHospitalName(hospitalName: string, userLat?: number, userLng?: number): Promise<any[]> {
    try {
      // Find clinics matching the hospital name
      const hospitalResults = await db
        .select()
        .from(clinics)
        .where(sql`LOWER(${clinics.name}) LIKE LOWER(${'%' + hospitalName + '%'})`)
        .orderBy(
          sql`
            CASE 
              WHEN LOWER(${clinics.name}) = LOWER(${hospitalName}) THEN 1
              WHEN LOWER(${clinics.name}) LIKE LOWER(${hospitalName + '%'}) THEN 2
              WHEN LOWER(${clinics.name}) LIKE LOWER(${'%' + hospitalName + '%'}) THEN 3
              ELSE 4
            END,
            ${clinics.name}
          `
        );

      // For each hospital, get all doctors and calculate distance
      const resultsWithDoctors = await Promise.all(
        hospitalResults.map(async (hospital) => {
          const doctors = await this.getDoctorsWithSchedulesByClinic(hospital.id);
          
          // Calculate distance if user location and clinic coordinates available
          let distance = null;
          if (userLat && userLng && hospital.latitude && hospital.longitude) {
            const lat = parseFloat(hospital.latitude.toString());
            const lng = parseFloat(hospital.longitude.toString());
            
            if (!isNaN(lat) && !isNaN(lng)) {
              // Haversine formula for distance calculation
              const R = 6371; // Earth's radius in kilometers
              const dLat = (lat - userLat) * Math.PI / 180;
              const dLng = (lng - userLng) * Math.PI / 180;
              const a = 
                Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(userLat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
              const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
              distance = R * c;
            }
          }
          
          return {
            id: `hospital-${hospital.id}`,
            type: 'hospital',
            name: hospital.name,
            city: hospital.city,
            address: hospital.address,
            phone: hospital.phone,
            email: hospital.email,
            openingHours: hospital.openingHours,
            clinicId: hospital.id,
            distance,
            doctors: doctors || []
          };
        })
      );

      // Sort by distance if available (nearest first)
      if (userLat && userLng) {
        resultsWithDoctors.sort((a, b) => {
          if (a.distance === null && b.distance === null) return 0;
          if (a.distance === null) return 1;
          if (b.distance === null) return -1;
          return a.distance - b.distance;
        });
      }

      return resultsWithDoctors;
    } catch (error) {
      console.error('Error in searchByHospitalName:', error);
      throw error;
    }
  }

  async searchByDoctorName(doctorName: string): Promise<any[]> {
    try {
      // Find doctors matching the name
      const doctorResults = await db
        .select({
          id: users.id,
          name: users.name,
          specialty: users.specialty,
          bio: users.bio,
          imageUrl: users.imageUrl,
          clinicId: users.clinicId,
          clinicName: clinics.name,
          clinicAddress: clinics.address,
          clinicCity: clinics.city,
          clinicPhone: clinics.phone
        })
        .from(users)
        .leftJoin(clinics, eq(users.clinicId, clinics.id))
        .where(
          and(
            eq(users.role, "doctor"),
            sql`LOWER(${users.name}) LIKE LOWER(${'%' + doctorName + '%'})`
          )
        )
        .orderBy(
          sql`
            CASE 
              WHEN LOWER(${users.name}) = LOWER(${doctorName}) THEN 1
              WHEN LOWER(${users.name}) LIKE LOWER(${doctorName + '%'}) THEN 2
              WHEN LOWER(${users.name}) LIKE LOWER(${'%' + doctorName + '%'}) THEN 3
              ELSE 4
            END,
            ${users.name}
          `
        );

      // For each doctor, get today's schedules
      const resultsWithSchedules = await Promise.all(
        doctorResults.map(async (doctor) => {
          const schedules = await this.getDoctorTodaySchedules(doctor.id);
          
          return {
            id: `doctor-${doctor.id}`,
            type: 'doctor',
            name: doctor.name,
            specialty: doctor.specialty,
            bio: doctor.bio,
            imageUrl: doctor.imageUrl,
            doctorId: doctor.id,
            clinicId: doctor.clinicId,
            hospitalName: doctor.clinicName,
            hospitalAddress: doctor.clinicAddress,
            hospitalCity: doctor.clinicCity,
            hospitalPhone: doctor.clinicPhone,
            schedules: schedules || []
          };
        })
      );

      return resultsWithSchedules;
    } catch (error) {
      console.error('Error in searchByDoctorName:', error);
      throw error;
    }
  }

  async searchBySpecialty(specialty: string, userLat?: number, userLng?: number): Promise<any[]> {
    try {
      // Find doctors with matching specialty - include clinic coordinates for distance calculation
      const specialtyResults = await db
        .select({
          id: users.id,
          name: users.name,
          specialty: users.specialty,
          bio: users.bio,
          imageUrl: users.imageUrl,
          directClinicId: users.clinicId,
          doctorClinicId: doctorClinics.clinicId,
          clinicName: clinics.name,
          clinicAddress: clinics.address,
          clinicCity: clinics.city,
          clinicPhone: clinics.phone,
          clinicLatitude: clinics.latitude,
          clinicLongitude: clinics.longitude
        })
        .from(users)
        .leftJoin(doctorClinics, eq(users.id, doctorClinics.doctorId))
        .leftJoin(clinics, or(
          eq(users.clinicId, clinics.id),
          eq(doctorClinics.clinicId, clinics.id)
        ))
        .where(
          and(
            eq(users.role, "doctor"),
            or(
              sql`LOWER(${users.specialty}) = LOWER(${specialty})`,
              sql`LOWER(${users.specialty}) LIKE LOWER(${'%' + specialty + '%'})`
            )
          )
        )
        .orderBy(
          sql`
            CASE 
              WHEN LOWER(${users.specialty}) = LOWER(${specialty}) THEN 1
              WHEN LOWER(${users.specialty}) LIKE LOWER(${specialty + '%'}) THEN 2
              WHEN LOWER(${users.specialty}) LIKE LOWER(${'%' + specialty + '%'}) THEN 3
              ELSE 4
            END,
            ${users.name}
          `
        );

      // Group by clinic to show hospital-based results
      const clinicMap = new Map();
      
      // First, collect unique doctors and get their schedules
      const uniqueDoctors = new Map();
      specialtyResults.forEach(doctor => {
        if (!uniqueDoctors.has(doctor.id)) {
          uniqueDoctors.set(doctor.id, doctor);
        }
      });

      // Get schedules for all unique doctors
      const doctorsWithSchedules = await Promise.all(
        Array.from(uniqueDoctors.values()).map(async (doctor) => {
          const clinicId = doctor.directClinicId || doctor.doctorClinicId;
          const schedules = await this.getDoctorTodaySchedules(doctor.id, clinicId);
          
          return {
            ...doctor,
            schedules: schedules || []
          };
        })
      );

      // Now group by clinic and calculate distance if user location provided
      doctorsWithSchedules.forEach(doctor => {
        const clinicId = doctor.directClinicId || doctor.doctorClinicId;
        if (clinicId && doctor.clinicName) {
          if (!clinicMap.has(clinicId)) {
            // Calculate distance if coordinates available
            let distance = null;
            if (userLat && userLng && doctor.clinicLatitude && doctor.clinicLongitude) {
              const lat = parseFloat(doctor.clinicLatitude.toString());
              const lng = parseFloat(doctor.clinicLongitude.toString());
              
              if (!isNaN(lat) && !isNaN(lng)) {
                // Haversine formula for distance calculation
                const R = 6371; // Earth's radius in kilometers
                const dLat = (lat - userLat) * Math.PI / 180;
                const dLng = (lng - userLng) * Math.PI / 180;
                const a = 
                  Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(userLat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                distance = R * c;
              }
            }
            
            clinicMap.set(clinicId, {
              id: `specialty-clinic-${clinicId}`,
              type: 'specialty',
              name: doctor.clinicName,
              city: doctor.clinicCity,
              address: doctor.clinicAddress,
              phone: doctor.clinicPhone,
              clinicId: clinicId,
              specialty,
              distance,
              doctors: []
            });
          }
          
          // Check if doctor is already added to avoid duplicates
          const existingDoctor = clinicMap.get(clinicId).doctors.find((d: any) => d.id === doctor.id);
          if (!existingDoctor) {
            clinicMap.get(clinicId).doctors.push({
              id: doctor.id,
              name: doctor.name,
              specialty: doctor.specialty,
              bio: doctor.bio,
              imageUrl: doctor.imageUrl,
              schedules: doctor.schedules
            });
          }
        }
      });

      // Sort by distance if available (nearest first)
      const results = Array.from(clinicMap.values());
      if (userLat && userLng) {
        results.sort((a, b) => {
          if (a.distance === null && b.distance === null) return 0;
          if (a.distance === null) return 1;
          if (b.distance === null) return -1;
          return a.distance - b.distance;
        });
      }
      
      return results;
    } catch (error) {
      console.error('Error in searchBySpecialty:', error);
      throw error;
    }
  }

  // Helper method to get doctors with schedules for a clinic
  async getDoctorsWithSchedulesByClinic(clinicId: number): Promise<any[]> {
    try {
      const doctors = await db
        .select({
          id: users.id,
          name: users.name,
          specialty: users.specialty,
          bio: users.bio,
          imageUrl: users.imageUrl
        })
        .from(users)
        .leftJoin(doctorClinics, eq(users.id, doctorClinics.doctorId))
        .where(
          and(
            eq(users.role, "doctor"),
            or(
              eq(users.clinicId, clinicId),
              eq(doctorClinics.clinicId, clinicId)
            )
          )
        );

      // For each doctor, get today's schedules
      const doctorsWithSchedules = await Promise.all(
        doctors.map(async (doctor) => {
          const schedules = await this.getDoctorTodaySchedules(doctor.id, clinicId);
          
          return {
            ...doctor,
            schedules: schedules || []
          };
        })
      );

      return doctorsWithSchedules;
    } catch (error) {
      console.error('Error in getDoctorsWithSchedulesByClinic:', error);
      throw error;
    }
  }

  // Helper method to get today's schedules for a doctor
  async getDoctorTodaySchedules(doctorId: number, clinicId?: number): Promise<any[]> {
    try {
      const today = new Date();
      const startOfDay = new Date(today);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(today);
      endOfDay.setHours(23, 59, 59, 999);

      const whereConditions = [
        eq(doctorSchedules.doctorId, doctorId),
        gte(doctorSchedules.date, startOfDay),
        lte(doctorSchedules.date, endOfDay),
        // Show a today schedule if booking has started (isActive) OR the attender
        // marked it "Show to Patients" (isVisible). Previously this only checked
        // isActive, so visible-but-booking-not-started schedules were hidden from
        // Smart Search even though the View Doctors page showed them.
        or(eq(doctorSchedules.isActive, true), eq(doctorSchedules.isVisible, true))
      ];

      if (clinicId) {
        whereConditions.push(eq(doctorSchedules.clinicId, clinicId));
      }

      const schedules = await db
        .select({
          id: doctorSchedules.id,
          clinicId: doctorSchedules.clinicId,
          date: doctorSchedules.date,
          startTime: doctorSchedules.startTime,
          endTime: doctorSchedules.endTime,
          maxTokens: doctorSchedules.maxTokens,
          scheduleStatus: doctorSchedules.scheduleStatus,
          bookingStatus: doctorSchedules.bookingStatus,
          averageConsultationTime: doctorSchedules.averageConsultationTime,
          clinicName: clinics.name,
          clinicAddress: clinics.address
        })
        .from(doctorSchedules)
        .leftJoin(clinics, eq(doctorSchedules.clinicId, clinics.id))
        .where(and(...whereConditions))
        .orderBy(doctorSchedules.startTime);

      // For each schedule, get current appointment count
      const schedulesWithCounts = await Promise.all(
        schedules.map(async (schedule) => {
          const appointmentCount = await this.getAppointmentCountForDoctor(
            doctorId, 
            schedule.clinicId, 
            schedule.id
          );

          return {
            ...schedule,
            currentAppointments: appointmentCount,
            availableSlots: schedule.maxTokens ? schedule.maxTokens - appointmentCount : null
          };
        })
      );

      return schedulesWithCounts;
    } catch (error) {
      console.error('Error in getDoctorTodaySchedules:', error);
      throw error;
    }
  }

  // Unified search method that handles all search types
  async performSearch(query: string, type: string, userLat?: number, userLng?: number): Promise<any[]> {
    try {
      if (!query || !query.trim()) {
        return [];
      }

      const searchQuery = query.trim();

      switch (type) {
        case 'city':
          return await this.searchByCity(searchQuery, userLat, userLng);
        case 'hospital':
          return await this.searchByHospitalName(searchQuery, userLat, userLng);
        case 'doctor':
          return await this.searchByDoctorName(searchQuery);
        case 'specialty':
          return await this.searchBySpecialty(searchQuery, userLat, userLng);
        case 'all':
        default:
          // Perform all types of search and combine results
          // Prioritize doctors and specialties over clinics for better UX
          const [cityResults, hospitalResults, doctorResults, specialtyResults] = await Promise.all([
            this.searchByCity(searchQuery, userLat, userLng),
            this.searchByHospitalName(searchQuery, userLat, userLng),
            this.searchByDoctorName(searchQuery),
            this.searchBySpecialty(searchQuery, userLat, userLng)
          ]);

          // Deduplicate results based on clinicId to prevent showing same clinic twice
          const seenClinicIds = new Set<number>();
          const deduplicatedResults = [];
          
          // Process in priority order
          for (const result of [...doctorResults, ...specialtyResults, ...hospitalResults, ...cityResults]) {
            // For clinic/hospital/city results, check for duplicates by clinicId
            if (result.clinicId && (result.type === 'hospital' || result.type === 'city' || result.type === 'specialty')) {
              if (!seenClinicIds.has(result.clinicId)) {
                seenClinicIds.add(result.clinicId);
                deduplicatedResults.push(result);
              }
            } else {
              // For doctor results or results without clinicId, add directly
              deduplicatedResults.push(result);
            }
          }

          return deduplicatedResults;
      }
    } catch (error) {
      console.error('Error in performSearch:', error);
      throw error;
    }
  }

  async getClinic(id: number): Promise<Clinic | undefined> {
    const [clinic] = await db.select().from(clinics).where(eq(clinics.id, id));
    return clinic;
  }

  async createClinic(clinicData: typeof clinics.$inferInsert): Promise<Clinic> {
    // Keys must be the Drizzle JS property names (e.g. zipCode, not zip_code) —
    // Drizzle maps them to their snake_case columns. Unknown keys are silently dropped.
    const formattedData = {
      name: clinicData.name,
      address: clinicData.address,
      city: clinicData.city,
      state: clinicData.state,
      zipCode: clinicData.zipCode,
      phone: clinicData.phone,
      email: clinicData.email,
      openingHours: clinicData.openingHours,
      description: clinicData.description,
      latitude: clinicData.latitude,
      longitude: clinicData.longitude,
    };
    
    const [clinic] = await db.insert(clinics).values(formattedData).returning();
    return clinic;
  }

  async updateClinic(id: number, clinicData: Partial<typeof clinics.$inferInsert>): Promise<Clinic> {
    // Keys must be the Drizzle JS property names (e.g. zipCode, not zip_code) —
    // Drizzle maps them to their snake_case columns. Unknown keys are silently dropped.
    const formattedData: Record<string, any> = {};

    if (clinicData.name !== undefined) formattedData.name = clinicData.name;
    if (clinicData.address !== undefined) formattedData.address = clinicData.address;
    if (clinicData.city !== undefined) formattedData.city = clinicData.city;
    if (clinicData.state !== undefined) formattedData.state = clinicData.state;
    if (clinicData.zipCode !== undefined) formattedData.zipCode = clinicData.zipCode;
    if (clinicData.phone !== undefined) formattedData.phone = clinicData.phone;
    if (clinicData.email !== undefined) formattedData.email = clinicData.email;
    if (clinicData.openingHours !== undefined) formattedData.openingHours = clinicData.openingHours;
    if (clinicData.description !== undefined) formattedData.description = clinicData.description;
    if (clinicData.latitude !== undefined) formattedData.latitude = clinicData.latitude;
    if (clinicData.longitude !== undefined) formattedData.longitude = clinicData.longitude;
    
    const [updatedClinic] = await db
      .update(clinics)
      .set(formattedData)
      .where(eq(clinics.id, id))
      .returning();
    return updatedClinic;
  }

  async deleteClinic(id: number): Promise<void> {
    try {
      // Delete in the correct order to avoid foreign key constraint violations
      
      // 1. First, delete all appointments for this clinic
      await db.delete(appointments).where(eq(appointments.clinicId, id));
      
      // 2. Delete all doctor schedules for this clinic
      await db.delete(doctorSchedules).where(eq(doctorSchedules.clinicId, id));
      
      // 3. Delete all doctor-clinic relationships for this clinic
      await db.delete(doctorClinics).where(eq(doctorClinics.clinicId, id));
      
      // 4. Delete all users associated with this clinic (including admins, doctors, etc.)
      await db.delete(users).where(eq(users.clinicId, id));
      
      // 5. Finally, delete the clinic itself
      await db.delete(clinics).where(eq(clinics.id, id));
    } catch (error) {
      console.error('Error deleting clinic:', error);
      throw error;
    }
  }

  async getSuperAdminExportData(clinicId: number, startDate: Date, endDate: Date): Promise<any[]> {
    try {
      console.log(`Fetching export data for clinic ${clinicId} from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]} (excluding cancelled schedules)`);
      
      // Use exact same pattern as getAppointmentsForExport - this works!
      // Excludes cancelled schedules as they need separate refund handling
      const result = await db
        .select({
          id: appointments.id,
          date: appointments.date,
          tokenNumber: appointments.tokenNumber,
          status: appointments.status,
          statusNotes: appointments.statusNotes,
          actualStartTime: appointments.actualStartTime,
          actualEndTime: appointments.actualEndTime,
          isWalkIn: appointments.isWalkIn,
          guestName: appointments.guestName,
          guestPhone: appointments.guestPhone,
          doctorName: users.name,
          patientName: sql<string>`CASE 
            WHEN ${appointments.isWalkIn} = true THEN ${appointments.guestName}
            ELSE patient.name 
          END`,
          hospitalName: clinics.name,
          scheduleDate: sql<string>`schedule.date`,
          scheduleTime: sql<string>`CONCAT(schedule.start_time, ' - ', schedule.end_time)`,
        })
        .from(appointments)
        .leftJoin(users, eq(users.id, appointments.doctorId))
        .leftJoin(clinics, eq(clinics.id, appointments.clinicId))
        .leftJoin(
          sql`${users} as patient`,
          sql`patient.id = ${appointments.patientId}`
        )
        .leftJoin(
          sql`${doctorSchedules} as schedule`,
          sql`schedule.id = ${appointments.scheduleId}`
        )
        .where(
          and(
            eq(appointments.clinicId, clinicId),
            sql`DATE(${appointments.date}) >= DATE(${startDate.toISOString()})`,
            sql`DATE(${appointments.date}) <= DATE(${endDate.toISOString()})`,
            // Exclude still-cancelled schedules (cancel_reason set AND isActive false)
            sql`NOT (schedule.cancel_reason IS NOT NULL AND schedule.is_active = false)`,
            // Exclude all appointments with cancelled/canceled status (any variation)
            sql`${appointments.status} NOT ILIKE '%cancel%'`
          )
        )
        .orderBy(appointments.date, appointments.tokenNumber);

      console.log(`Found ${result.length} appointment records`);

      if (result.length === 0) {
        console.log('No appointment data found for the specified criteria');
        return [];
      }

      // Transform the data to match super admin export format
      const formattedData = result.map((appointment, index) => ({
        serialNumber: index + 1,
        hospitalName: appointment.hospitalName || 'Unknown Hospital',
        doctorName: appointment.doctorName || 'Unknown Doctor',
        scheduleDate: appointment.scheduleDate ? new Date(appointment.scheduleDate).toLocaleDateString() : new Date(appointment.date).toLocaleDateString(),
        scheduleTime: appointment.scheduleTime || 'N/A',
        patientName: appointment.patientName || 'Unknown Patient',
        inTime: appointment.actualStartTime ? 
          new Date(appointment.actualStartTime).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          }) : 'Not checked in',
        outTime: appointment.actualEndTime ? 
          new Date(appointment.actualEndTime).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          }) : 'Not checked out',
        tokenStatus: appointment.status ? appointment.status.charAt(0).toUpperCase() + appointment.status.slice(1) : 'Unknown',
      }));

      console.log('Successfully formatted export data');
      return formattedData;
    } catch (error) {
      console.error('Error fetching super admin export data:', error);
      throw error;
    }
  }

  async getCancelledSchedulesForSelection(clinicId: number, dateFilter: string): Promise<any[]> {
    try {
      console.log(`Fetching cancelled schedules for selection - clinic ${clinicId} with filter ${dateFilter}`);
      
      // Parse date filter
      let startDate: string, endDate: string;
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      
      if (dateFilter === 'today') {
        startDate = endDate = todayStr;
      } else if (dateFilter === 'yesterday') {
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        startDate = endDate = yesterday.toISOString().split('T')[0];
      } else if (dateFilter === 'last7days') {
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(today.getDate() - 7);
        startDate = sevenDaysAgo.toISOString().split('T')[0];
        endDate = todayStr;
      } else {
        throw new Error('Invalid date filter');
      }

      // Query cancelled schedules for selection
      const result = await db
        .select({
          id: doctorSchedules.id,
          doctorName: users.name,
          date: doctorSchedules.date,
          startTime: doctorSchedules.startTime,
          endTime: doctorSchedules.endTime,
          cancelReason: doctorSchedules.cancelReason,
          appointmentCount: sql<number>`COUNT(${appointments.id})`,
        })
        .from(doctorSchedules)
        .leftJoin(users, eq(users.id, doctorSchedules.doctorId))
        .leftJoin(appointments, eq(appointments.scheduleId, doctorSchedules.id))
        .where(
          and(
            eq(doctorSchedules.clinicId, clinicId),
            gte(doctorSchedules.date, startDate),
            lte(doctorSchedules.date, endDate),
            // Only cancelled schedules
            isNotNull(doctorSchedules.cancelReason)
          )
        )
        .groupBy(
          doctorSchedules.id,
          users.name,
          doctorSchedules.date,
          doctorSchedules.startTime,
          doctorSchedules.endTime,
          doctorSchedules.cancelReason
        )
        .orderBy(doctorSchedules.date, doctorSchedules.startTime);

      console.log(`Found ${result.length} cancelled schedules for selection`);

      return result.map(schedule => ({
        id: schedule.id,
        doctorName: schedule.doctorName || 'Unknown Doctor',
        date: schedule.date,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        cancelReason: schedule.cancelReason || 'No reason provided',
        appointmentCount: Number(schedule.appointmentCount) || 0,
      }));
    } catch (error) {
      console.error('Error fetching cancelled schedules for selection:', error);
      throw error;
    }
  }

  async getAppointmentsForCancelledSchedule(scheduleId: number): Promise<any[]> {
    try {
      console.log(`Fetching appointments for cancelled schedule ${scheduleId}`);
      
      // Query appointments for the specific cancelled schedule
      const result = await db
        .select({
          appointmentId: appointments.id,
          patientId: appointments.patientId, // Add patient ID for refunds
          consultationFee: appointments.consultationFee, // Add consultation fee for refunds
          hasBeenRefunded: appointments.hasBeenRefunded, // Add refund status
          refundAmount: appointments.refundAmount, // Add refund amount
          tokenStatus: appointments.status,
          // Patient info - handle both walk-in and registered patients
          patientName: sql<string>`CASE 
            WHEN ${appointments.isWalkIn} = true THEN ${appointments.guestName}
            ELSE patient.name 
          END`,
          mobileNumber: sql<string>`CASE 
            WHEN ${appointments.isWalkIn} = true THEN ${appointments.guestPhone}
            ELSE patient.phone 
          END`,
          hospitalName: clinics.name,
          doctorName: users.name,
          scheduleDate: doctorSchedules.date,
          cancelReason: doctorSchedules.cancelReason,
        })
        .from(appointments)
        .leftJoin(users, eq(users.id, appointments.doctorId))
        .leftJoin(clinics, eq(clinics.id, appointments.clinicId))
        .leftJoin(doctorSchedules, eq(doctorSchedules.id, appointments.scheduleId))
        .leftJoin(
          sql`${users} as patient`,
          sql`patient.id = ${appointments.patientId}`
        )
        .where(
          and(
            eq(appointments.scheduleId, scheduleId),
            // Include all appointments from cancelled schedule
            eq(appointments.isPaid, true)
          )
        )
        .orderBy(appointments.tokenNumber);

      console.log(`Found ${result.length} appointments for cancelled schedule`);

      return result.map((appointment, index) => ({
        id: appointment.appointmentId,
        patientId: appointment.patientId, // Include patient ID for refunds
        consultationFee: appointment.consultationFee, // Include consultation fee for refunds
        hasBeenRefunded: appointment.hasBeenRefunded, // Include refund status
        refundAmount: appointment.refundAmount, // Include refund amount
        serialNumber: index + 1,
        patientName: appointment.patientName || 'Unknown Patient',
        mobileNumber: appointment.mobileNumber || 'Not available',
        hospitalName: appointment.hospitalName || 'Unknown Hospital',
        doctorName: appointment.doctorName || 'Unknown Doctor',
        scheduleDate: appointment.scheduleDate,
        cancelReason: appointment.cancelReason || 'Schedule cancelled',
        tokenStatus: appointment.tokenStatus || 'scheduled',
        // Add eligibility information for frontend logic
        isEligibleForRefund: (
          !appointment.hasBeenRefunded && 
          appointment.tokenStatus !== 'completed' && 
          appointment.tokenStatus !== 'no_show'
        )
      }));
    } catch (error) {
      console.error('Error fetching appointments for cancelled schedule:', error);
      throw error;
    }
  }

  async getAppointments(userId: number): Promise<(Appointment & { doctor: User; patient?: User })[]> {
    try {

      // Get user first to determine the role
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId));

      if (!user) {
        throw new Error('User not found');
      }

      let appointmentsResult;

      if (user.role === "attender") {
        // For attenders, first get their managed doctors
        const managedDoctors = await this.getAttenderDoctors(userId);
        const doctorIds = managedDoctors.map(rel => rel.doctorId);


        // Then get appointments for all managed doctors
        appointmentsResult = await db
          .select()
          .from(appointments)
          .where(inArray(appointments.doctorId, doctorIds));

      } else if (user.role === "doctor") {
        // For doctors, get appointments where they are the doctor
        appointmentsResult = await db
          .select()
          .from(appointments)
          .where(eq(appointments.doctorId, userId));

      } else {
        // For patients, only get their own appointments
        appointmentsResult = await db
          .select()
          .from(appointments)
          .where(eq(appointments.patientId, userId));
      }


      if (!appointmentsResult?.length) {
        console.log('No appointments found for user:', userId);
        return [];
      }

      // Get all unique doctor IDs from the appointments
      const doctorIds = Array.from(new Set(appointmentsResult.map(apt => apt.doctorId)));
      console.log('Doctor IDs to fetch:', doctorIds);

      // Get all doctors in one query
      const doctors = await db
        .select()
        .from(users)
        .where(inArray(users.id, doctorIds));

      console.log('Doctors data:', JSON.stringify(doctors, null, 2));

      const doctorsMap = new Map(doctors.map(d => [d.id, d]));

      // Get patient data if needed (for doctor or attender view)
      let patientsMap = new Map<number, User>();
      if (user.role === "doctor" || user.role === "attender") {
        const patientIds = Array.from(new Set(appointmentsResult.map(apt => apt.patientId)));
        const patients = await db
          .select()
          .from(users)
          .where(inArray(users.id, patientIds));
        patientsMap = new Map(patients.map(p => [p.id, p]));
      }

      // Combine the data
      const fullAppointments = appointmentsResult.map(appointment => ({
        ...appointment,
        doctor: doctorsMap.get(appointment.doctorId)!,
        patient: (user.role === "doctor" || user.role === "attender")
          ? patientsMap.get(appointment.patientId)
          : undefined
      }));

      console.log('Final appointments data:', JSON.stringify(fullAppointments, null, 2));
      return fullAppointments;
    } catch (error) {
      console.error('Error in getAppointments:', error);
      if (error instanceof Error) {
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
      }
      throw error;
    }
  }

  async getDoctorAppointmentsByDate(doctorId: number, date: Date, clinicId?: number): Promise<Appointment[]> {
    try {
      // Convert date to start and end of day for proper comparison
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);

      let whereConditions = [
        eq(appointments.doctorId, doctorId),
        gte(appointments.date, dayStart),
        lte(appointments.date, dayEnd)
      ];

      // Add clinic filter if specified
      if (clinicId) {
        whereConditions.push(eq(appointments.clinicId, clinicId));
      }

      const result = await db
        .select()
        .from(appointments)
        .where(and(...whereConditions))
        .orderBy(appointments.tokenNumber);

      return result;
    } catch (error) {
      console.error('Error in getDoctorAppointmentsByDate:', error);
      throw error;
    }
  }

  async getNextTokenNumber(doctorId: number, clinicId: number, scheduleId: number): Promise<number> {
    console.log(`Getting next token for doctor ${doctorId}, clinic ${clinicId}, schedule ${scheduleId}`);

    // Expire stale reservations first so they don't block online bookings
    await this.expireStaleReservations();

    const [result] = await db
      .select({
        maxToken: sql<number>`COALESCE(MAX(token_number), 0)`,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.doctorId, doctorId),
          eq(appointments.clinicId, clinicId),
          eq(appointments.scheduleId, scheduleId),
          // Only count non-cancelled appointments
          ne(appointments.status, "cancel")
        )
      );

    const maxAppt = result?.maxToken || 0;
    // Account for pending, non-expired reservations so online bookings skip reserved tokens
    const resResult = await db.select({ maxToken: max(tokenReservations.tokenNumber) })
      .from(tokenReservations)
      .where(and(
        eq(tokenReservations.scheduleId, scheduleId),
        eq(tokenReservations.status, "pending"),
        gt(tokenReservations.expiresAt, new Date())
      ));
    const maxRes = resResult[0]?.maxToken || 0;
    const nextToken = Math.max(maxAppt, maxRes) + 1;
    console.log(`Next token number will be: ${nextToken} (maxAppt: ${maxAppt}, maxRes: ${maxRes})`);

    return nextToken;
  }

  async createAppointment(appointment: Omit<Appointment, "id"> & { tokenNumber?: number }): Promise<Appointment> {
    // Use the provided clinicId or get it from the doctor
    let clinicId = appointment.clinicId;
    
    if (!clinicId) {
      // If no clinicId provided, get the doctor's default clinic
      const doctor = await this.getUser(appointment.doctorId);
      if (!doctor || !doctor.clinicId) {
        throw new Error("Invalid doctor or doctor has no default clinic");
      }
      clinicId = doctor.clinicId;
    }
    
    // Get the day of week for the appointment date
    const appointmentDate = new Date(appointment.date);    
    
    // Get the doctor's schedule for this day and clinic
    const [schedule] = await db
      .select()
      .from(doctorSchedules)
      .where(
        and(
          eq(doctorSchedules.doctorId, appointment.doctorId),
          eq(doctorSchedules.clinicId, clinicId),
          eq(doctorSchedules.id, appointment.scheduleId),
          eq(doctorSchedules.isActive, true)
        )
      );
      
    if (!schedule) {
      throw new Error("No active schedule found for this doctor on the selected day");
    }
    
    // Check for duplicate booking - same patient, doctor, and schedule
    const existingAppointment = await db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.patientId, appointment.patientId),
          eq(appointments.doctorId, appointment.doctorId),
          eq(appointments.scheduleId, schedule.id),
          // Only check for non-cancelled appointments
          ne(appointments.status, "cancelled")
        )
      )
      .limit(1);
    
    if (existingAppointment.length > 0) {
      throw new Error("You already have an appointment booked with this doctor for this schedule. Please check your existing appointments.");
    }
    
    // Get current token count — exclude cancelled appointments so cancellations
    // don't eat into the doctor's capacity (only attended patients count)
    const [tokenCount] = await db
      .select({
        count: count(),
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.doctorId, appointment.doctorId),
          eq(appointments.clinicId, clinicId),
          eq(appointments.scheduleId, schedule.id),
          ne(appointments.status, "cancel")
        )
      );

    // Check if token limit has been reached
    if (schedule.maxTokens !== null && tokenCount.count >= schedule.maxTokens) {
      throw new Error(`Maximum number of tokens (${schedule.maxTokens}) has been reached for this schedule`);
    }
    
    // Generate next token and guard against race condition with walk-in reservations.
    // After getNextTokenNumber runs, a pending reservation for that exact token
    // may have just committed — check and skip past it if so.
    let tokenNumber = appointment.tokenNumber ?? await this.getNextTokenNumber(
      appointment.doctorId,
      clinicId,
      schedule.id
    );
    const [reservationConflict] = await db
      .select({ tokenNumber: tokenReservations.tokenNumber })
      .from(tokenReservations)
      .where(and(
        eq(tokenReservations.scheduleId, schedule.id),
        eq(tokenReservations.tokenNumber, tokenNumber),
        eq(tokenReservations.status, "pending"),
        gt(tokenReservations.expiresAt, new Date())
      ));
    if (reservationConflict) {
      // A reservation was created between our getNextTokenNumber call and now — skip past it
      const [maxResult] = await db.select({ maxToken: max(tokenReservations.tokenNumber) })
        .from(tokenReservations)
        .where(and(
          eq(tokenReservations.scheduleId, schedule.id),
          eq(tokenReservations.status, "pending"),
          gt(tokenReservations.expiresAt, new Date())
        ));
      tokenNumber = (maxResult?.maxToken || tokenNumber) + 1;
    }

    const [created] = await db
      .insert(appointments)
      .values({
        ...appointment,
        clinicId,
        tokenNumber,
        status: appointment.status || "token_started"
      })
      .returning();

    return created;
  }

  async createAppointmentWithWalletPayment(
    appointment: Omit<Appointment, "id"> & { tokenNumber?: number },
    platformFee: number,
    gstAmount: number,
    totalAmount: number
  ): Promise<Appointment> {
    // Use transaction to ensure data consistency
    return await db.transaction(async (tx) => {
      // Create the appointment first
      const createdAppointment = await this.createAppointment(appointment);
      
      // Get or create patient wallet
      let [wallet] = await tx
        .select()
        .from(patientWallets)
        .where(eq(patientWallets.patientId, appointment.patientId));
      
      if (!wallet) {
        throw new Error('Patient wallet not found');
      }
      
      const currentBalance = parseFloat(wallet.balance);
      const newBalance = currentBalance - totalAmount;
      const newTotalSpent = parseFloat(wallet.totalSpent) + totalAmount;
      
      // Update wallet balance
      await tx
        .update(patientWallets)
        .set({
          balance: newBalance.toString(),
          totalSpent: newTotalSpent.toString(),
          updatedAt: new Date()
        })
        .where(eq(patientWallets.patientId, appointment.patientId));
      
      // Create wallet transaction record
      const [walletTransaction] = await tx
        .insert(walletTransactions)
        .values({
          walletId: wallet.id,
          patientId: appointment.patientId,
          appointmentId: createdAppointment.id,
          scheduleId: appointment.scheduleId,
          transactionType: 'appointment_payment',
          amount: (-totalAmount).toString(), // Negative for deduction
          previousBalance: currentBalance.toString(),
          newBalance: newBalance.toString(),
          description: `Platform fee (₹${platformFee}) + GST (₹${gstAmount.toFixed(2)}) for appointment booking`,
          status: 'completed',
          metadata: JSON.stringify({
            platformFee,
            gstAmount,
            gstRate: 0.05,
            totalAmount
          })
        })
        .returning();
      
      // Update appointment with wallet transaction reference
      const [finalAppointment] = await tx
        .update(appointments)
        .set({
          walletTransactionId: walletTransaction.id,
          consultationFee: totalAmount.toString()
        })
        .where(eq(appointments.id, createdAppointment.id))
        .returning();
      
      return finalAppointment;
    });
  }

  async getPatientWallet(patientId: number) {
    const [wallet] = await db
      .select()
      .from(patientWallets)
      .where(eq(patientWallets.patientId, patientId));
    
    return wallet;
  }


  // async getAttenderDoctors(attenderId: number): Promise<(AttenderDoctor & { doctor: User })[]> {
  //   try {
  //     console.log('Getting doctors for attender:', attenderId);

  //     // Step 1: Get attender-doctor relationships
  //     const relations = await db
  //       .select()
  //       .from(attenderDoctors)
  //       .where(eq(attenderDoctors.attenderId, attenderId));

  //     console.log('Attender-doctor relations:', JSON.stringify(relations, null, 2));

  //     if (!relations.length) {
  //       console.log(`No doctor relations found for attender: ${attenderId}`);
  //       return [];
  //     }

  //     // Step 2: Get all doctors in one query
  //     const doctorIds = relations.map(r => r.doctorId);
  //     console.log('Doctor IDs to fetch:', doctorIds);

  //     const doctors = await db
  //       .select()
  //       .from(users)
  //       .where(
  //         and(
  //           inArray(users.id, doctorIds),
  //           eq(users.role, "doctor")
  //         )
  //       );

  //     console.log('Doctors data:', JSON.stringify(doctors, null, 2));

  //     const doctorsMap = new Map(doctors.map(d => [d.id, d]));

  //     // Step 3: Combine the data
  //     const fullRelations = relations
  //       .map(relation => {
  //         const doctor = doctorsMap.get(relation.doctorId);
  //         if (!doctor) {
  //           console.error(`Doctor not found for relation: ${relation.id}`);
  //           return null;
  //         }
  //         return {
  //           ...relation,
  //           doctor
  //         };
  //       })
  //       .filter((rel): rel is (AttenderDoctor & { doctor: User }) => rel !== null);

  //     console.log('Final attender-doctor data:', JSON.stringify(fullRelations, null, 2));
  //     return fullRelations;
  //   } catch (error) {
  //     console.error('Error in getAttenderDoctors:', error);
  //     if (error instanceof Error) {
  //       console.error('Error message:', error.message);
  //       console.error('Error stack:', error.stack);
  async getAttenderDoctors(attenderId: number): Promise<(AttenderDoctor & { doctor: User; })[]> {
    try {
      // Get all relations where this user is the attender
      const relations = await db
        .select()
        .from(attenderDoctors)
        .where(eq(attenderDoctors.attenderId, attenderId));

      if (relations.length === 0) {
        return [];
      }

      // Get all doctors from the relations
      const doctors = await db
        .select()
        .from(users)
        .where(
          and(
            inArray(users.id, relations.map(r => r.doctorId)),
            eq(users.role, "doctor")
          )
        );

      // Create a map for quick doctor lookup
      const doctorsMap = new Map(doctors.map(d => [d.id, d]));

      // Combine the relation data with the doctor data
      const fullRelations = relations
        .map(relation => {
          const doctor = doctorsMap.get(relation.doctorId);
          if (!doctor) {
            console.error(`Doctor not found for relation: ${relation.id}`);
            return null;
          }
          return {
            ...relation,
            doctor
          };
        })
        .filter((rel): rel is (AttenderDoctor & { doctor: User }) => rel !== null);

      return fullRelations;
    } catch (error) {
      console.error('Error fetching attender doctors:', error);
      throw error;
    }
  }
  
  async addDoctorToAttender(attenderId: number, doctorId: number, clinicId: number): Promise<AttenderDoctor> {
    try {
      const [relation] = await db
        .insert(attenderDoctors)
        .values({
          attenderId,
          doctorId,
          clinicId
        })
        .returning();

      if (!relation) {
        throw new Error('Failed to create attender-doctor relationship');
      }

      return relation;
    } catch (error) {
      console.error('Error adding doctor to attender:', error);
      throw error;
    }
  }

  async removeDoctorFromAttender(attenderId: number, doctorId: number): Promise<void> {
    await db
      .delete(attenderDoctors)
      .where(
        and(
          eq(attenderDoctors.attenderId, attenderId),
          eq(attenderDoctors.doctorId, doctorId)
        )
      );
  }

  async getAttendersByClinic(clinicId: number): Promise<User[]> {
    try {
      return await db
        .select()
        .from(users)
        .where(and(
          eq(users.role, "attender"),
          eq(users.clinicId, clinicId)
        ));
    } catch (error) {
      console.error('Error fetching attenders by clinic:', error);
      throw error;
    }
  }

  async getAttendersByRole(): Promise<User[]> {
    try {
      return await db
        .select()
        .from(users)
        .where(eq(users.role, "attender"));
    } catch (error) {
      console.error('Error fetching attenders by role:', error);
      throw error;
    }
  }

  async updateAppointmentStatus(
    appointmentId: number, 
    status: "scheduled" | "in_progress" | "hold" | "pause" | "cancel" | "no_show" | "completed", 
    statusNotes?: string
  ): Promise<Appointment> {
    try {
      const updateData: Partial<typeof appointments.$inferInsert> = {
        status
      };

      if (statusNotes !== undefined) {
        updateData.statusNotes = statusNotes;
      }

      // Fetch previous status before update to guard against duplicate notifications
      const [existing] = await db
        .select({ status: appointments.status })
        .from(appointments)
        .where(eq(appointments.id, appointmentId))
        .limit(1);
      const previousStatus = existing?.status;

      // Add timestamp updates based on status
      const now = new Date();
      if (status === "in_progress") {
        updateData.actualStartTime = now;
      } else if (status === "completed") {
        updateData.actualEndTime = now;
        // If no actualStartTime exists, estimate it
        const existingAppointment = await db
          .select({ actualStartTime: appointments.actualStartTime })
          .from(appointments)
          .where(eq(appointments.id, appointmentId))
          .limit(1);
        
        if (existingAppointment.length > 0 && !existingAppointment[0].actualStartTime) {
          // Estimate start time as 15 minutes before end time
          updateData.actualStartTime = new Date(now.getTime() - 15 * 60 * 1000);
        }
      }
      
      const [updated] = await db
        .update(appointments)
        .set(updateData)
        .where(eq(appointments.id, appointmentId))
        .returning();

      if (!updated) {
        throw new Error('Appointment not found');
      }

      // Send push notification to patient on key status changes
      // Guard: only notify if status actually changed (prevents duplicates on retries)
      if (updated.patientId && previousStatus !== status && (status === 'in_progress' || status === 'completed')) {
        const { sendPushToUser } = await import('./firebase-admin');
        if (status === 'in_progress') {
          sendPushToUser(
            updated.patientId,
            'Your turn has started',
            `Token #${updated.tokenNumber} — please proceed to the consultation room.`,
            { route: '/appointments' }
          );
        } else if (status === 'completed') {
          // Notify the next waiting patient (any waiting status)
          const nextPatient = await db
            .select()
            .from(appointments)
            .where(
              and(
                eq(appointments.scheduleId, updated.scheduleId),
                inArray(appointments.status, ['scheduled', 'token_started']),
                gt(appointments.tokenNumber, updated.tokenNumber)
              )
            )
            .orderBy(appointments.tokenNumber)
            .limit(1);

          if (nextPatient.length > 0 && nextPatient[0].patientId) {
            sendPushToUser(
              nextPatient[0].patientId,
              'Your turn is coming up',
              `Token #${nextPatient[0].tokenNumber} — please be ready.`,
              { route: '/appointments' }
            );
          }
        }
      }

      return updated;
    } catch (error) {
      console.error('Error updating appointment status:', error);
      throw error;
    }
  }

  async updateAppointmentETA(
    appointmentId: number,
    estimatedStartTime: Date
  ): Promise<void> {
    try {
      await db
        .update(appointments)
        .set({ estimatedStartTime })
        .where(eq(appointments.id, appointmentId));
    } catch (error) {
      console.error('Error updating appointment ETA:', error);
      throw error;
    }
  }

  async updateDoctorAvailability(
    doctorId: number,
    date: Date,
    isAvailable: boolean,
    currentToken?: number
  ): Promise<typeof doctorDailyPresence.$inferSelect> {
    // Since the purpose of this table has changed, we'll update it to use the new schema
    // We'll repurpose isAvailable to hasArrived since that's what we're tracking now
    try {
      // Round date to start of day for consistency
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      
      // Get a default clinic for this doctor (first one found)
      const [doctorWithClinic] = await db
        .select()
        .from(users)
        .where(eq(users.id, doctorId));
        
      // Use the doctor's clinic or get the first clinic if none assigned
      let clinicId = doctorWithClinic.clinicId;
      
      if (!clinicId) {
        const [firstClinic] = await db.select().from(clinics).limit(1);
        if (firstClinic) {
          clinicId = firstClinic.id;
        } else {
          throw new Error('No clinic found for doctor availability');
        }
      }
      
      // Try to update existing record first
      const [existing] = await db
        .select()
        .from(doctorDailyPresence)
        .where(
          and(
            eq(doctorDailyPresence.doctorId, doctorId),
            eq(doctorDailyPresence.clinicId, clinicId),
            eq(doctorDailyPresence.date, dayStart)
          )
        );
      
      if (existing) {
        const [updated] = await db
          .update(doctorDailyPresence)
          .set({
            hasArrived: isAvailable, // Repurposing isAvailable to hasArrived
          })
          .where(eq(doctorDailyPresence.id, existing.id))
          .returning();
        return updated;
      }
      
      // Create new record if none exists
      const [created] = await db
        .insert(doctorDailyPresence)
        .values({
          doctorId,
          clinicId,
          date: dayStart,
          hasArrived: isAvailable, // Repurposing isAvailable to hasArrived
        })
        .returning();
      
      return created;
    } catch (error) {
      console.error('Error updating doctor availability:', error);
      throw error;
    }
  }

  async getDoctorAvailability(
    doctorId: number,
    date: Date
  ): Promise<typeof doctorDailyPresence.$inferSelect | undefined> {
    try {
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      
      // Get the doctor's clinic
      const [doctorWithClinic] = await db
        .select()
        .from(users)
        .where(eq(users.id, doctorId));
        
      // Use the doctor's clinic or get the first clinic if none assigned
      let clinicId = doctorWithClinic.clinicId;
      
      if (!clinicId) {
        const [firstClinic] = await db.select().from(clinics).limit(1);
        if (firstClinic) {
          clinicId = firstClinic.id;
        } else {
          return undefined; // No clinic to check availability for
        }
      }

      const [availability] = await db
        .select()
        .from(doctorDailyPresence)
        .where(
          and(
            eq(doctorDailyPresence.doctorId, doctorId),
            eq(doctorDailyPresence.clinicId, clinicId),
            eq(doctorDailyPresence.date, dayStart)
          )
        );

      return availability;
    } catch (error) {
      console.error('Error getting doctor availability:', error);
      throw error;
    }
  }

  async getDoctorClinics(doctorId: number): Promise<Clinic[]> {
    try {
      const result = await db
        .select({
          clinic: clinics
        })
        .from(doctorClinics)
        .innerJoin(clinics, eq(doctorClinics.clinicId, clinics.id))
        .where(eq(doctorClinics.doctorId, doctorId));
      
      return result.map(r => r.clinic);
    } catch (error) {
      console.error('Error fetching doctor clinics:', error);
      throw error;
    }
  }
  
  async getDoctorsByClinic(clinicId: number): Promise<User[]> {
    try {
      // Get doctors assigned directly via users.clinic_id
      const directDoctors = await db
        .select()
        .from(users)
        .where(
          and(
            eq(users.role, 'doctor'),
            eq(users.clinicId, clinicId)
          )
        );
      
      // Get doctors assigned via doctor_clinics junction table
      const junctionDoctors = await db
        .select({
          doctor: users
        })
        .from(doctorClinics)
        .innerJoin(users, eq(doctorClinics.doctorId, users.id))
        .where(eq(doctorClinics.clinicId, clinicId));
      
      // Combine both results and remove duplicates by ID
      const allDoctors = [...directDoctors, ...junctionDoctors.map(r => r.doctor)];
      const uniqueDoctors = Array.from(
        new Map(allDoctors.map(doctor => [doctor.id, doctor])).values()
      );
      
      console.log(`Found ${uniqueDoctors.length} doctors for clinic ${clinicId}`);
      return uniqueDoctors;
    } catch (error) {
      console.error('Error fetching clinic doctors:', error);
      throw error;
    }
  }

  async addDoctorToClinic(doctorId: number, clinicId: number): Promise<void> {
    try {
      await db.insert(doctorClinics).values({
        doctorId,
        clinicId,
      });
    } catch (error) {
      console.error('Error adding doctor to clinic:', error);
      throw error;
    }
  }

  async updateDoctorClinics(doctorId: number, clinicIds: number[]): Promise<void> {
    try {
      // Delete existing relationships
      await db.delete(doctorClinics).where(eq(doctorClinics.doctorId, doctorId));
      
      // Add new relationships
      if (clinicIds.length > 0) {
        await db.insert(doctorClinics).values(
          clinicIds.map(clinicId => ({
            doctorId,
            clinicId,
          }))
        );
      }
    } catch (error) {
      console.error('Error updating doctor clinics:', error);
      throw error;
    }
  }

  async getPatientAppointments(patientId: number, doctorId?: number): Promise<(Appointment & { doctor: User })[]> {
    try {
      console.log('Getting appointments for patient:', patientId, 'doctorId:', doctorId);

      // Build the where condition
      const whereConditions = [eq(appointments.patientId, patientId)];
      if (doctorId) {
        whereConditions.push(eq(appointments.doctorId, doctorId));
      }

      // Get patient's appointments
      const appointmentsResult = await db
        .select()
        .from(appointments)
        .where(and(...whereConditions));

      console.log('Patient appointments:', JSON.stringify(appointmentsResult, null, 2));

      if (!appointmentsResult.length) {
        return [];
      }

      // Get all unique doctor IDs
      const doctorIds = Array.from(new Set(appointmentsResult.map(apt => apt.doctorId)));
      const doctors = await db
        .select()
        .from(users)
        .where(inArray(users.id, doctorIds));

      const doctorsMap = new Map(doctors.map(d => [d.id, d]));

      // Combine the data
      return appointmentsResult.map(appointment => ({
        ...appointment,
        doctor: doctorsMap.get(appointment.doctorId)!,
      }));
    } catch (error) {
      console.error('Error in getPatientAppointments:', error);
      throw error;
    }
  }

  async getAttenderDoctorsAppointments(attenderId: number): Promise<(AttenderDoctor & { 
    doctor: User, 
    appointments: (Appointment & { patient?: User })[], 
    schedules: (typeof doctorSchedules.$inferSelect & { 
      appointments: (Appointment & { patient?: User })[]
    })[]
  })[]> {
    try {
      console.log('Getting appointments for attender:', attenderId);

      // First get attender-doctor relationships
      const doctorRelations = await this.getAttenderDoctors(attenderId);
      if (!doctorRelations.length) {
        return [];
      }

      // Get appointments for each doctor
      const doctorsWithAppointments = await Promise.all(
        doctorRelations.map(async (relation) => {
          const { doctor } = relation;
          const todayStr = new Date().toISOString().split('T')[0]; // "2026-04-07"
          const todayStart = new Date(todayStr + 'T00:00:00.000Z');
          const todayEnd = new Date(todayStr + 'T23:59:59.999Z');

          // Get doctor's schedules for today
          const schedules = await db
            .select()
            .from(doctorSchedules)
            .where(
              and(
                eq(doctorSchedules.doctorId, doctor.id),
                eq(doctorSchedules.isActive, true),
                eq(doctorSchedules.date, todayStr)
              )
            )
            .orderBy(doctorSchedules.startTime);

          // Get appointments for this doctor
          const appointmentsForDoctor = await db
            .select()
            .from(appointments)
            .where(
              and(
                eq(appointments.doctorId, doctor.id),
                gte(appointments.date, todayStart),
                lte(appointments.date, todayEnd)
              )
            );

          // Get patient data for these appointments (filter out nulls from walk-ins)
          const patientIds = Array.from(new Set(appointmentsForDoctor.map(apt => apt.patientId).filter((id): id is number => id != null)));
          const patients = patientIds.length > 0 ? await db
            .select()
            .from(users)
            .where(inArray(users.id, patientIds)) : [];

          const patientsMap = new Map(patients.map(p => [p.id, p]));

          // Add patient data to appointments
          const appointmentsWithPatients = appointmentsForDoctor.map(apt => ({
            ...apt,
            patient: patientsMap.get(apt.patientId),
          }));

          // Map schedules with their appointments
          const schedulesWithAppointments = schedules.map(schedule => {
            // Find appointments that belong to this schedule by scheduleId
            const scheduleAppointments = appointmentsWithPatients.filter(apt => {
              // Use scheduleId as primary association
              if (apt.scheduleId === schedule.id) {
                return true;
              }
                         
              return false;
            });
            
            return {
              ...schedule,
              appointments: scheduleAppointments
            };
          });

          return {
            ...relation,
            doctor,
            appointments: appointmentsWithPatients, // Keep all appointments
            schedules: schedulesWithAppointments,
          };
        })
      );

      return doctorsWithAppointments;
    } catch (error) {
      console.error('Error in getAttenderDoctorsAppointments:', error);
      throw error;
    }
  }
  
  // Helper method to parse time strings like "09:00" to minutes since midnight
  private parseTime(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  }

  async getCurrentTokenProgress(
    doctorId: number, 
    clinicId: number, 
    date: Date,
    retryCount = 3
  ): Promise<{ currentToken: number; status: 'in_progress' | 'completed' | 'token_started' | 'hold' | 'pause' | 'cancel' | 'not_started' | 'no_appointments'; appointment?: Appointment }> {
    try {
      console.log('Getting token progress for:', { doctorId, clinicId, date });

      // Round date to start of day for consistency
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);

      // Get all appointments for the doctor at the specific clinic on this date
      // Include both registered patient appointments and walk-ins
      const todayAppointments = await db
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.doctorId, doctorId),
            eq(appointments.clinicId, clinicId),
            sql`${appointments.date}::date = ${dayStart}::date`
          )
        )
        .orderBy(appointments.tokenNumber);

      console.log('Found appointments:', todayAppointments);

      if (!todayAppointments || todayAppointments.length === 0) {
        return {
          currentToken: 0,
          status: 'no_appointments'
        };
      }

      // Check if doctor has arrived today
      const doctorPresence = await this.getDoctorArrivalStatus(doctorId, clinicId, date);
      const doctorHasArrived = doctorPresence?.hasArrived || false;
      
      console.log('Doctor presence status:', { doctorHasArrived, presence: doctorPresence });

      // Find appointment currently in progress
      const inProgressAppointment = todayAppointments.find(apt => apt.status === 'in_progress');
      
      if (inProgressAppointment) {
        console.log('Found in-progress appointment:', inProgressAppointment);
        return {
          currentToken: inProgressAppointment.tokenNumber,
          status: 'in_progress',
          appointment: inProgressAppointment
        };
      }

      // Find appointment in pause state
      const pausedAppointment = todayAppointments.find(apt => apt.status === 'pause');
      
      if (pausedAppointment) {
        console.log('Found paused appointment:', pausedAppointment);
        return {
          currentToken: pausedAppointment.tokenNumber,
          status: 'pause',
          appointment: pausedAppointment
        };
      }

      // Find appointment in hold state
      const heldAppointment = todayAppointments.find(apt => apt.status === 'hold');
      
      if (heldAppointment) {
        console.log('Found held appointment:', heldAppointment);
        return {
          currentToken: heldAppointment.tokenNumber,
          status: 'hold',
          appointment: heldAppointment
        };
      }

      // Find appointment in token_started state
      const tokenStartedAppointment = todayAppointments.find(apt => apt.status === 'token_started');
      
      if (tokenStartedAppointment) {
        console.log('Found token started appointment:', tokenStartedAppointment);
        return {
          currentToken: tokenStartedAppointment.tokenNumber,
          status: 'token_started',
          appointment: tokenStartedAppointment
        };
      }

      // If no appointment is currently active, find the last completed appointment
      const completedAppointments = todayAppointments.filter(apt => apt.status === 'completed');
      const lastCompleted = completedAppointments[completedAppointments.length - 1];

      console.log('Completed appointments:', { count: completedAppointments.length, lastCompleted });

      if (lastCompleted) {
        // Find the next token_started appointment after the last completed one
        const nextAppointment = todayAppointments.find(apt => 
          apt.tokenNumber > lastCompleted.tokenNumber && 
          apt.status === 'token_started'
        );

        if (nextAppointment) {
          return {
            currentToken: nextAppointment.tokenNumber,
            status: 'token_started',
            appointment: nextAppointment
          };
        }

        return {
          currentToken: lastCompleted.tokenNumber,
          status: 'completed',
          appointment: lastCompleted
        };
      }

      // If no completed appointment, find the earliest token_started appointment
      const earliestPending = todayAppointments.find(apt => apt.status === 'token_started');
      
      if (earliestPending) {
        console.log('Found earliest pending appointment:', earliestPending);
        return {
          currentToken: earliestPending.tokenNumber,
          status: 'token_started',
          appointment: earliestPending
        };
      }

      // If no token_started appointments, check if all remaining are unstarted (scheduled/cancel/no_show)
      const lastAppointment = todayAppointments[todayAppointments.length - 1];

      console.log('Last appointment in any state:', lastAppointment);

      // If all appointments are in a non-active state, queue hasn't started yet
      const inactiveStatuses = ['scheduled', 'cancel', 'no_show', 'expired'];
      if (inactiveStatuses.includes(lastAppointment.status)) {
        return {
          currentToken: 0,
          status: 'not_started' as any,
        };
      }

      return {
        currentToken: lastAppointment.tokenNumber,
        status: lastAppointment.status as any,
        appointment: lastAppointment
      };
    } catch (error) {
      console.error('Error in getCurrentTokenProgress:', error);
      if (retryCount > 0) {
        console.log(`Retrying... (${retryCount} attempts left)`);
        // Short delay before retry
        await new Promise(resolve => setTimeout(resolve, 200));
        return this.getCurrentTokenProgress(doctorId, clinicId, date, retryCount - 1);
      }
      return {
        currentToken: 0,
        status: 'no_appointments'
      };
    }
  }

  async createDoctor(
    user: Omit<InsertUser, "role">, 
    details: {
      consultationFee: number | string;
      consultationDuration: number;
      qualifications?: string;
      experience?: number;
      registrationNumber?: string;
      isEnabled?: boolean;
    }
  ): Promise<User & { details: DoctorDetail }> {
    // Ensure the role is set to doctor
    const doctorUser: InsertUser = {
      ...user,
      role: "doctor"
    };

    // Start a transaction
    return await db.transaction(async (tx) => {
      // Create the user first
      const [createdUser] = await tx.insert(users).values(doctorUser).returning();
      
      // Then create the doctor details with the doctorId
      const [createdDetails] = await tx.insert(doctorDetails).values({
        doctorId: createdUser.id,
        consultationFee: typeof details.consultationFee === 'string' 
          ? details.consultationFee 
          : details.consultationFee.toString(),
        consultationDuration: details.consultationDuration,
        qualifications: details.qualifications || null,
        experience: details.experience || null,
        registrationNumber: details.registrationNumber || null,
        isEnabled: details.isEnabled ?? true
      }).returning();
      
      return {
        ...createdUser,
        details: createdDetails
      };
    });
  }

  async getDoctorDetails(doctorId: number): Promise<DoctorDetail | undefined> {
    const [details] = await db
      .select()
      .from(doctorDetails)
      .where(eq(doctorDetails.doctorId, doctorId));
    
    return details;
  }

  async updateDoctorDetails(
    doctorId: number,
    details: Partial<{
      consultationFee: number | string;
      consultationDuration: number;
      qualifications: string;
      experience: number;
      registrationNumber: string;
    }>
  ): Promise<DoctorDetail> {
    const updatedDetails = { ...details };
    if (typeof updatedDetails.consultationFee === 'number') {
      updatedDetails.consultationFee = updatedDetails.consultationFee.toString();
    }

    const existing = await this.getDoctorDetails(doctorId);
    if (!existing) {
      const [inserted] = await db.insert(doctorDetails).values({
        doctorId,
        consultationFee: (updatedDetails.consultationFee as string) ?? "0",
        consultationDuration: updatedDetails.consultationDuration ?? 15,
        qualifications: updatedDetails.qualifications,
        experience: updatedDetails.experience,
        registrationNumber: updatedDetails.registrationNumber,
      }).returning();
      return inserted;
    }

    const [updated] = await db
      .update(doctorDetails)
      .set(updatedDetails)
      .where(eq(doctorDetails.doctorId, doctorId))
      .returning();

    return updated;
  }

  async toggleDoctorStatus(doctorId: number, isEnabled: boolean): Promise<DoctorDetail> {
    const [updatedDetails] = await db
      .update(doctorDetails)
      .set({
        isEnabled,
        updatedAt: new Date()
      })
      .where(eq(doctorDetails.doctorId, doctorId))
      .returning();
    
    if (!updatedDetails) {
      throw new Error(`Doctor details not found for doctor ID: ${doctorId}`);
    }
    
    return updatedDetails;
  }

  // Doctor schedules methods
  async createDoctorSchedule(schedule: InsertDoctorSchedule): Promise<DoctorSchedule> {
    return db.insert(doctorSchedules).values(schedule).returning();
  }

  async getDoctorSchedules(doctorId: number, date?: Date, visibleOnly: boolean = false): Promise<(DoctorSchedule & { createdByUser?: { id: number; name: string } })[]> {
    let conditions = [eq(doctorSchedules.doctorId, doctorId)];

    if (date) {
      // If date is provided, filter schedules for that specific date
      conditions.push(eq(doctorSchedules.date, date));
    } else {
      // By default, only show today and future schedules (not past dates)
      const todayStr = new Date().toISOString().split('T')[0];
      conditions.push(gte(doctorSchedules.date, todayStr));
    }

    if (visibleOnly) {
      // For patient views, only show visible schedules
      conditions.push(eq(doctorSchedules.isVisible, true));
    }

    // Join with users table to get creator information
    const results = await db
      .select({
        schedule: doctorSchedules,
        creator: users,
      })
      .from(doctorSchedules)
      .leftJoin(users, eq(doctorSchedules.createdBy, users.id))
      .where(and(...conditions))
      .orderBy(doctorSchedules.date, doctorSchedules.startTime);

    // Transform the results to handle null creator info
    return results.map(result => ({
      ...result.schedule,
      createdByUser: result.creator
        ? { id: result.creator.id, name: result.creator.name }
        : { id: 0, name: "Legacy Schedule" }, // Default for old schedules without creator
    }));
  }

  async getDoctorSchedule(scheduleId: number): Promise<DoctorSchedule | null> {
    const [schedule] = await db
      .select()
      .from(doctorSchedules)
      .where(eq(doctorSchedules.id, scheduleId));
    
    return schedule || null;
  }

  async getSpecificSchedule(doctorId: number, clinicId: number, scheduleId: number, date: Date): Promise<DoctorSchedule | null> {
    const dateStr = date.toISOString().split('T')[0];
    
    const [schedule] = await db
      .select()
      .from(doctorSchedules)
      .where(
        and(
          eq(doctorSchedules.id, scheduleId),
          eq(doctorSchedules.doctorId, doctorId),
          eq(doctorSchedules.clinicId, clinicId),
          eq(doctorSchedules.date, dateStr),
          eq(doctorSchedules.isActive, true), // Schedule must be active to accept bookings
          eq(doctorSchedules.isVisible, true) // Schedule must be visible to patients
        )
      );

    return schedule || null;
  }

  async getDoctorSchedulesByClinic(clinicId: number): Promise<(DoctorSchedule & { doctor: User })[]> {
    const results = await db
      .select({
        schedule: doctorSchedules,
        doctor: users,
      })
      .from(doctorSchedules)
      .innerJoin(users, eq(doctorSchedules.doctorId, users.id))
      .where(eq(doctorSchedules.clinicId, clinicId))
      .orderBy(doctorSchedules.date, doctorSchedules.startTime);

    return results.map(row => ({
      ...row.schedule,
      doctor: row.doctor,
    }));
  }

  async getDoctorAvailableTimeSlots(doctorId: number, date: Date): Promise<{ 
    schedules: (DoctorSchedule & { clinic: Clinic, currentTokenCount?: number })[], 
    availableSlots: { 
      startTime: string, 
      endTime: string, 
      clinicId: number,
      clinicName: string
    }[] 
  }> {
    // Get all schedules for the doctor on this specific date
    const results = await db
      .select({
        schedule: doctorSchedules,
        clinic: clinics,
      })
      .from(doctorSchedules)
      .innerJoin(clinics, eq(doctorSchedules.clinicId, clinics.id))
      .where(
        and(
          eq(doctorSchedules.doctorId, doctorId),
          sql`DATE(${doctorSchedules.date}) = DATE(${date.toISOString()})`,
          eq(doctorSchedules.isVisible, true), // Only show visible schedules to patients
          // Show schedules unless they are completed (patients should see completed/closed for info)
        )
      )
      .orderBy(doctorSchedules.startTime);
  
    // Transform the results
    const schedules = results.map(row => ({
      ...row.schedule,
      clinic: row.clinic,
    }));
  
    // Get existing appointments for this doctor on this date
    const appointmentsForDate = await db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.doctorId, doctorId),
          sql`DATE(${appointments.date}) = DATE(${date.toISOString()})`,
          // Exclude cancelled and expired placeholder appointments from token count
          sql`${appointments.status} NOT IN ('cancel', 'expired')`
        )
      );
  
    // Create a map of schedule to appointment count (NOT clinic!)
    const scheduleAppointmentCount = new Map<number, number>();
    appointmentsForDate.forEach(appt => {
      if (appt.scheduleId) {
        const count = scheduleAppointmentCount.get(appt.scheduleId) || 0;
        scheduleAppointmentCount.set(appt.scheduleId, count + 1);
      }
    });

    // Also count pending (non-expired) reservations per schedule
    const scheduleIds = schedules.map(s => s.id);
    const pendingReservations = scheduleIds.length > 0
      ? await db.select({ scheduleId: tokenReservations.scheduleId, count: count() })
          .from(tokenReservations)
          .where(and(
            inArray(tokenReservations.scheduleId, scheduleIds),
            eq(tokenReservations.status, "pending"),
            gt(tokenReservations.expiresAt, new Date())
          ))
          .groupBy(tokenReservations.scheduleId)
      : [];

    const pendingReservationCount = new Map<number, number>();
    pendingReservations.forEach(r => {
      pendingReservationCount.set(r.scheduleId, r.count);
    });

    // Add current token count to each schedule (appointments + pending reservations)
    schedules.forEach(schedule => {
      const apptCount = scheduleAppointmentCount.get(schedule.id) || 0;
      const resCount = pendingReservationCount.get(schedule.id) || 0;
      schedule.currentTokenCount = apptCount + resCount;
    });

    // Calculate available slots - exclude completed schedules and closed bookings
    const availableSlots = schedules
      .filter(schedule => 
        (schedule.currentTokenCount || 0) < schedule.maxTokens &&
        schedule.scheduleStatus !== 'completed' &&
        schedule.bookingStatus !== 'closed'
      )
      .map(schedule => ({
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        clinicId: schedule.clinic.id,
        clinicName: schedule.clinic.name
      }));

    return { schedules, availableSlots };
  }

  async updateDoctorSchedule(id: number, schedule: Partial<InsertDoctorSchedule>): Promise<DoctorSchedule> {
    const [updated] = await db
      .update(doctorSchedules)
      .set({ ...schedule, updatedAt: new Date() })
      .where(eq(doctorSchedules.id, id))
      .returning();
    return updated;
  }

  async deleteDoctorSchedule(id: number): Promise<{ deletedSchedule: any, cancelledAppointments: any[] }> {
    // Use a transaction to ensure data consistency
    return await db.transaction(async (tx) => {
      // First, get the schedule info
      const [schedule] = await tx
        .select()
        .from(doctorSchedules)
        .where(eq(doctorSchedules.id, id));

      if (!schedule) {
        throw new Error('Schedule not found');
      }

      // Get all appointments for this schedule BEFORE deleting
      const scheduleAppointments = await tx
        .select()
        .from(appointments)
        .where(eq(appointments.scheduleId, id));

      // Get all doctor presence records for this schedule
      const presenceRecords = await tx
        .select()
        .from(doctorDailyPresence)
        .where(eq(doctorDailyPresence.scheduleId, id));

      console.log(`Found ${scheduleAppointments.length} appointments and ${presenceRecords.length} presence records for schedule ${id}`);

      // Cancel all appointments and remove schedule reference (double protection)
      if (scheduleAppointments.length > 0) {
        await tx
          .update(appointments)
          .set({ 
            status: 'cancel',
            statusNotes: 'Schedule was deleted by clinic admin',
            scheduleId: null // Explicitly set to null as backup
          })
          .where(eq(appointments.scheduleId, id));

        console.log(`Cancelled ${scheduleAppointments.length} appointments and removed schedule references`);
      }

      // Remove schedule reference from doctor presence records (double protection)
      if (presenceRecords.length > 0) {
        await tx
          .update(doctorDailyPresence)
          .set({ 
            scheduleId: null // Explicitly set to null as backup
          })
          .where(eq(doctorDailyPresence.scheduleId, id));

        console.log(`Removed schedule references from ${presenceRecords.length} presence records`);
      }

      // Now delete the schedule - should work since all references are removed
      await tx.delete(doctorSchedules).where(eq(doctorSchedules.id, id));
      
      console.log(`Successfully deleted schedule ${id}`);

      return {
        deletedSchedule: schedule,
        cancelledAppointments: scheduleAppointments
      };
    });
  }

  async getAvailableDoctors(clinicId: number, date: Date, time: string): Promise<User[]> {
    // First get all doctors who have schedules for this date and time
    const availableDoctors = await db
      .select({
        doctorId: doctorSchedules.doctorId,
      })
      .from(doctorSchedules)
      .where(
        and(
          eq(doctorSchedules.clinicId, clinicId),
          eq(doctorSchedules.date, date),
          eq(doctorSchedules.isActive, true),
          lte(doctorSchedules.startTime, time),
          gte(doctorSchedules.endTime, time)
        )
      );

    if (availableDoctors.length === 0) {
      return [];
    }

    // Then get the actual doctor details
    const doctorIds = availableDoctors.map(d => d.doctorId).filter((id): id is number => id !== null);
    
    return db
      .select()
      .from(users)
      .where(
        and(
          inArray(users.id, doctorIds),
          eq(users.role, "doctor")
        )
      );
  }

  async getAppointmentCountForDoctor(
    doctorId: number,
    clinicId: number,
    scheduleId: number
  ): Promise<number> {
    try {
      const [result] = await db
        .select({
          count: count(),
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.doctorId, doctorId),
            eq(appointments.clinicId, clinicId),
            eq(appointments.scheduleId, scheduleId),
            // Only count active appointments (exclude cancelled ones)
            ne(appointments.status, "cancel")
          )
        );

      // Also count pending non-expired reservations so the maxTokens check
      // blocks online bookings while a walk-in token is reserved
      const [resResult] = await db
        .select({ count: count() })
        .from(tokenReservations)
        .where(and(
          eq(tokenReservations.scheduleId, scheduleId),
          eq(tokenReservations.status, "pending"),
          gt(tokenReservations.expiresAt, new Date())
        ));

      return (result?.count || 0) + (resResult?.count || 0);
    } catch (error) {
      console.error('Error counting appointments:', error);
      throw error;
    }
  }

  async updateDoctorArrivalStatus(
    doctorId: number,
    clinicId: number,
    scheduleId: number | null,
    date: Date,
    hasArrived: boolean
  ): Promise<typeof doctorDailyPresence.$inferSelect> {
    try {
      // Round date to start of day for consistency
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      
      // Try to update existing record first
      const [existing] = await db
        .select()
        .from(doctorDailyPresence)
        .where(
          and(
            eq(doctorDailyPresence.doctorId, doctorId),
            eq(doctorDailyPresence.clinicId, clinicId),
            eq(doctorDailyPresence.date, dayStart)
          )
        );
        
      if (existing) {
        // Always update scheduleId when specified, otherwise keep existing
        const scheduleIdToUse = scheduleId !== undefined ? scheduleId : existing.scheduleId;
        
        const [updated] = await db
          .update(doctorDailyPresence)
          .set({ 
            hasArrived,
            scheduleId: scheduleIdToUse,
            updatedAt: new Date() 
          })
          .where(eq(doctorDailyPresence.id, existing.id))
          .returning();
        return updated;
      }
      
      // Create new record if none exists
      const [created] = await db
        .insert(doctorDailyPresence)
        .values({
          doctorId,
          clinicId,
          scheduleId,
          date: dayStart,
          hasArrived,
        })
        .returning();
        
      return created;
    } catch (error) {
      console.error('Error updating doctor arrival status:', error);
      throw error;
    }
  }

  async getDoctorArrivalStatus(
    doctorId: number,
    clinicId: number,
    date: Date
  ): Promise<typeof doctorDailyPresence.$inferSelect | undefined> {
    try {
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);

      console.log(`Getting doctor arrival status for doctor ${doctorId}, clinic ${clinicId}, date ${dayStart.toISOString()}`);

      const [presence] = await db
        .select()
        .from(doctorDailyPresence)
        .where(
          and(
            eq(doctorDailyPresence.doctorId, doctorId),
            eq(doctorDailyPresence.clinicId, clinicId),
            eq(doctorDailyPresence.date, dayStart)
          )
        );

      console.log(`Found presence record:`, presence);
      return presence;
    } catch (error) {
      console.error('Error getting doctor arrival status:', error);
      throw error;
    }
  }

  async createWalkInAppointment(appointment: {
    doctorId: number;
    clinicId: number;
    scheduleId?: number;
    date: Date;
    guestName: string;
    guestPhone?: string;
    isWalkIn: boolean;
    status?: string;
  }): Promise<Appointment> {
    // Get the day of week for the appointment date
    const appointmentDate = new Date(appointment.date);    
    
    // Get the doctor's schedule for this day and clinic if not provided
    let scheduleId = appointment.scheduleId;
    
    if (!scheduleId) {
      const [schedule] = await db
        .select()
        .from(doctorSchedules)
        .where(
          and(
            eq(doctorSchedules.doctorId, appointment.doctorId),
            eq(doctorSchedules.clinicId, appointment.clinicId),
            eq(doctorSchedules.isActive, true)
          )
        );
        
      if (!schedule) {
        throw new Error("No active schedule found for this doctor on the selected day");
      }
      
      scheduleId = schedule.id;
    }
    
    // Get current token count — exclude cancelled appointments so cancellations
    // don't eat into the doctor's capacity (only attended patients count)
    const [tokenCount] = await db
      .select({
        count: count(),
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.doctorId, appointment.doctorId),
          eq(appointments.clinicId, appointment.clinicId),
          eq(appointments.scheduleId, scheduleId),
          ne(appointments.status, "cancel")
        )
      );

    // Get the schedule to check token limit
    const [scheduleData] = await db
      .select()
      .from(doctorSchedules)
      .where(eq(doctorSchedules.id, scheduleId));
      
    if (!scheduleData) {
      throw new Error("Schedule not found");
    }
      
    // Check if token limit has been reached
    if (scheduleData.maxTokens !== null && tokenCount.count >= scheduleData.maxTokens) {
      throw new Error(`Maximum number of tokens (${scheduleData.maxTokens}) has been reached for this schedule`);
    }
    
    // Get the next token number
    const tokenNumber = await this.getNextTokenNumber(
      appointment.doctorId,
      appointment.clinicId,
      scheduleId
    );
    
    // Create the appointment - explicitly set patientId to null for walk-ins
    const [created] = await db
      .insert(appointments)
      .values({
        doctorId: appointment.doctorId,
        clinicId: appointment.clinicId,
        scheduleId,
        patientId: null, // Explicitly set to null for walk-ins
        date: appointment.date,
        tokenNumber,
        guestName: appointment.guestName,
        guestPhone: appointment.guestPhone || null,
        isWalkIn: true,
        status: appointment.status || "token_started"
      })
      .returning();

    return created;
  }

  async countWalkInPatientsAhead(
    doctorId: number,
    clinicId: number,
    currentToken: number,
    patientToken: number
  ): Promise<number> {
    // Get the current date (start and end of day)
    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);
    
    // Find walk-in appointments with token numbers between currentToken and patientToken
    const result = await db
      .select({
        count: count(),
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.doctorId, doctorId),
          eq(appointments.clinicId, clinicId),
          eq(appointments.isWalkIn, true),
          gt(appointments.tokenNumber, currentToken),
          lt(appointments.tokenNumber, patientToken),
          gte(appointments.date, startOfDay),
          lte(appointments.date, endOfDay),
          // Only count active appointments (not cancelled or expired placeholders)
          sql`${appointments.status} NOT IN ('cancel', 'expired')`
        )
      );
    
    return result[0]?.count || 0;
  }

  async updateDoctor(
    doctorId: number,
    user: Omit<InsertUser, "role" | "password" | "username" | "phone">,
    details: {
      consultationFee: number | string;
      consultationDuration: number;
      qualifications?: string;
      experience?: number;
      registrationNumber?: string;
      isEnabled?: boolean;
    }
  ): Promise<User & { details: DoctorDetail }> {
    // Start a transaction
    return await db.transaction(async (tx) => {
      // Update the user first
      const [updatedUser] = await tx
        .update(users)
        .set(user)
        .where(eq(users.id, doctorId))
        .returning();
      
      // Then update the doctor details
      const [updatedDetails] = await tx
        .update(doctorDetails)
        .set({
          consultationFee: typeof details.consultationFee === 'string' 
            ? details.consultationFee 
            : details.consultationFee.toString(),
          consultationDuration: details.consultationDuration,
          qualifications: details.qualifications || null,
          experience: details.experience || null,
          registrationNumber: details.registrationNumber || null,
          isEnabled: details.isEnabled ?? true
        })
        .where(eq(doctorDetails.doctorId, doctorId))
        .returning();
      
      return {
        ...updatedUser,
        details: updatedDetails
      };
    });
  }

  // Patient Favorites methods implementation
  async addFavoriteSchedule(patientId: number, scheduleId: number, doctorId: number, clinicId: number): Promise<PatientFavorite> {
    try {
      const [favorite] = await db
        .insert(patientFavorites)
        .values({
          patientId,
          scheduleId,
          doctorId,
          clinicId,
        })
        .returning();
      
      return favorite;
    } catch (error) {
      // Handle unique constraint violation (patient already favorited this schedule)
      if (error instanceof Error && error.message.includes('unique')) {
        throw new Error('Schedule is already in favorites');
      }
      console.error('Error adding favorite schedule:', error);
      throw error;
    }
  }

  async removeFavoriteSchedule(patientId: number, scheduleId: number): Promise<void> {
    try {
      await db
        .delete(patientFavorites)
        .where(
          and(
            eq(patientFavorites.patientId, patientId),
            eq(patientFavorites.scheduleId, scheduleId)
          )
        );
    } catch (error) {
      console.error('Error removing favorite schedule:', error);
      throw error;
    }
  }

  async getPatientFavorites(patientId: number): Promise<(PatientFavorite & { 
    doctor: User; 
    schedule: DoctorSchedule; 
    clinic: Clinic 
  })[]> {
    try {
      const favorites = await db
        .select({
          id: patientFavorites.id,
          patientId: patientFavorites.patientId,
          doctorId: patientFavorites.doctorId,
          scheduleId: patientFavorites.scheduleId,
          clinicId: patientFavorites.clinicId,
          createdAt: patientFavorites.createdAt,
          doctor: users,
          schedule: doctorSchedules,
          clinic: clinics,
        })
        .from(patientFavorites)
        .innerJoin(users, eq(patientFavorites.doctorId, users.id))
        .innerJoin(doctorSchedules, eq(patientFavorites.scheduleId, doctorSchedules.id))
        .innerJoin(clinics, eq(patientFavorites.clinicId, clinics.id))
        .where(eq(patientFavorites.patientId, patientId))
        .orderBy(patientFavorites.createdAt);

      return favorites;
    } catch (error) {
      console.error('Error getting patient favorites:', error);
      throw error;
    }
  }

  async checkIsFavorite(patientId: number, scheduleId: number): Promise<boolean> {
    try {
      const [result] = await db
        .select({ count: count() })
        .from(patientFavorites)
        .where(
          and(
            eq(patientFavorites.patientId, patientId),
            eq(patientFavorites.scheduleId, scheduleId)
          )
        );

      return result.count > 0;
    } catch (error) {
      console.error('Error checking if favorite:', error);
      throw error;
    }
  }

  async getPatientsFavoritingSchedule(scheduleId: number): Promise<number[]> {
    try {
      const results = await db
        .select({ patientId: patientFavorites.patientId })
        .from(patientFavorites)
        .where(eq(patientFavorites.scheduleId, scheduleId));

      return results.map(result => result.patientId);
    } catch (error) {
      console.error('Error getting patients favoriting schedule:', error);
      throw error;
    }
  }

  async getAttenderClinicOverview(attenderId: number) {
    try {
      // Get the current date (start and end of day)
      const today = new Date();
      const startOfDay = new Date(today);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(today);
      endOfDay.setHours(23, 59, 59, 999);

      // Get the attender's assigned doctors and their clinic
      const [attenderClinic] = await db
        .select({
          clinicId: attenderDoctors.clinicId,
        })
        .from(attenderDoctors)
        .where(eq(attenderDoctors.attenderId, attenderId));

      if (!attenderClinic) {
        console.log('No clinic found for attender:', attenderId);
        return {
          clinic: {
            id: 0,
            name: 'Not Assigned',
            address: '',
            phone: '',
            openingHours: ''
          },
          todayStats: {
            totalDoctors: 0,
            activeDoctors: 0,
            totalAppointments: 0
          }
        };
      }

      const clinicId = attenderClinic.clinicId;

      // Get clinic details
      const clinicResult = await db
        .select({
          id: clinics.id,
          name: clinics.name,
          address: clinics.address,
          phone: clinics.phone,
          openingHours: clinics.openingHours,
        })
        .from(clinics)
        .where(eq(clinics.id, clinicId));

      if (!clinicResult || clinicResult.length === 0) {
        console.log('Clinic not found:', clinicId);
        return {
          clinic: {
            id: 0,
            name: 'Not Found',
            address: '',
            phone: '',
            openingHours: ''
          },
          todayStats: {
            totalDoctors: 0,
            activeDoctors: 0,
            totalAppointments: 0
          }
        };
      }

      const clinic = clinicResult[0];

      // Get total doctors assigned to this attender
      const [{ totalDoctors }] = await db
        .select({
          totalDoctors: count(),
        })
        .from(attenderDoctors)
        .where(eq(attenderDoctors.attenderId, attenderId));

      // Get active doctors count (present today)
      const [{ activeDoctors }] = await db
        .select({
          activeDoctors: count(),
        })
        .from(doctorDailyPresence)
        .where(
          and(
            eq(doctorDailyPresence.clinicId, clinicId),
            gte(doctorDailyPresence.date, startOfDay),
            lte(doctorDailyPresence.date, endOfDay),
            eq(doctorDailyPresence.hasArrived, true)
          )
        );

      // Get total appointments for today
      const [{ totalAppointments }] = await db
        .select({
          totalAppointments: count(),
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.clinicId, clinicId),
            gte(appointments.date, startOfDay),
            lte(appointments.date, endOfDay)
          )
        );

      return {
        clinic,
        todayStats: {
          totalDoctors,
          activeDoctors,
          totalAppointments,
        },
      };
    } catch (error) {
      console.error('Error in getAttenderClinicOverview:', error);
      throw error;
    }
  }

  async getAttenderDoctorsSummary(attenderId: number) {
    try {
      console.log('Getting doctors summary for attender:', attenderId);
      
      // Get the current date (start and end of day)
      const today = new Date();
      const startOfDay = new Date(today);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(today);
      endOfDay.setHours(23, 59, 59, 999);

      // Get all doctors assigned to this attender with their daily presence status
      const doctorsResult = await db
        .select({
          id: users.id,
          name: users.name,
          specialty: users.specialty,
          hasArrived: sql<boolean>`COALESCE(${doctorDailyPresence.hasArrived}, false)`,
        })
        .from(attenderDoctors)
        .innerJoin(users, eq(users.id, attenderDoctors.doctorId))
        .leftJoin(
          doctorDailyPresence,
          and(
            eq(doctorDailyPresence.doctorId, users.id),
            eq(doctorDailyPresence.clinicId, attenderDoctors.clinicId),
            sql`DATE(${doctorDailyPresence.date}) = CURRENT_DATE`
          )
        )
        .where(eq(attenderDoctors.attenderId, attenderId));

      console.log('Doctors result:', doctorsResult);

      // Get appointment counts for each doctor
      const doctorsWithAppointments = await Promise.all(
        doctorsResult.map(async (doctor) => {
          const [result] = await db
            .select({
              todayAppointments: sql<number>`COUNT(appointments.id)::integer`
            })
            .from(appointments)
            .where(
              and(
                eq(appointments.doctorId, doctor.id),
                sql`DATE(appointments.date) = CURRENT_DATE`,
                // Only count active appointments (exclude cancelled ones)
                ne(appointments.status, "cancel")
              )
            );

          return {
            ...doctor,
            todayAppointments: Number(result?.todayAppointments) || 0
          };
        })
      );

      console.log('Doctors with appointments:', doctorsWithAppointments);

      return {
        doctors: doctorsWithAppointments,
        totalAssigned: doctorsWithAppointments.length,
      };
    } catch (error) {
      console.error('Error in getAttenderDoctorsSummary:', error);
      throw error;
    }
  }

  async getAttenderSchedulesToday(attenderId: number) {
    try {
      console.log('Getting schedules for attender:', attenderId);
  
      // Step 1: Get clinic
      const [attenderClinic] = await db
        .select({
          clinicId: attenderDoctors.clinicId,
        })
        .from(attenderDoctors)
        .where(eq(attenderDoctors.attenderId, attenderId));
  
      if (!attenderClinic) {
        console.log('No clinic found for attender:', attenderId);
        return {
          schedules: [],
          summary: { totalSchedules: 0, activeSchedules: 0, totalAppointments: 0 },
        };
      }
  
      console.log('Found attender clinic:', attenderClinic);
  
      // Step 2: Get doctors
      const clinicDoctors = await db
        .select({
          doctorId: doctorClinics.doctorId,
        })
        .from(doctorClinics)
        .where(eq(doctorClinics.clinicId, attenderClinic.clinicId));
  
      if (!clinicDoctors.length) {
        console.log('No doctors found for clinic:', attenderClinic.clinicId);
        return {
          schedules: [],
          summary: { totalSchedules: 0, activeSchedules: 0, totalAppointments: 0 },
        };
      }
  
      const doctorIds = clinicDoctors.map((d) => d.doctorId);
      console.log('Found clinic doctors:', doctorIds);
  
      // ⚠️ PREVENT empty array errors
      if (doctorIds.length === 0) {
        return {
          schedules: [],
          summary: { totalSchedules: 0, activeSchedules: 0, totalAppointments: 0 },
        };
      }
  
      // Step 3: Get today's schedules
      const today = new Date();
      const todayString = today.toISOString().split('T')[0]; // Get YYYY-MM-DD format
      console.log('Looking for schedules on date:', todayString);

      const schedulesResult = await db
  .select({
    id: doctorSchedules.id,
    doctorId: doctorSchedules.doctorId,
    doctorName: users.name,
    startTime: doctorSchedules.startTime,
    endTime: doctorSchedules.endTime,
    maxTokens: doctorSchedules.maxTokens,
    isPaused: doctorSchedules.isPaused,
    isActive: doctorSchedules.isActive,
    isVisible: doctorSchedules.isVisible,
    cancelReason: doctorSchedules.cancelReason,
    scheduleStatus: doctorSchedules.scheduleStatus,
    bookingStatus: doctorSchedules.bookingStatus,
    scheduleDate: doctorSchedules.date
  })
        .from(doctorSchedules)
        .innerJoin(users, eq(users.id, doctorSchedules.doctorId))
        .where(
          and(
            inArray(doctorSchedules.doctorId, doctorIds),
            eq(doctorSchedules.date, todayString)
          )
        );

      console.log('Found schedules:', schedulesResult.map(s => ({
        id: s.id,
        doctor: s.doctorName,
        date: s.scheduleDate,
        time: `${s.startTime}-${s.endTime}`,
        isActive: s.isActive
      })));

      // If no schedules found for today, return empty result
      if (schedulesResult.length === 0) {
        console.log('No schedules found for today, returning empty result');
        return {
          schedules: [],
          summary: {
            totalSchedules: 0,
            activeSchedules: 0,
            totalAppointments: 0,
          },
        };
      }

  
  
      // Step 4: Add appointment counts
      const schedulesWithAppointments = await Promise.all(
        schedulesResult.map(async (schedule) => {
          try {
            const [result] = await db
              .select({
                count: sql<number>`COUNT(appointments.id)::integer`,
              })
              .from(appointments)
              .where(
                and(
                  eq(appointments.scheduleId, schedule.id),
                  sql`DATE(${appointments.date}) = ${todayString}`,
                  // Only count active appointments (exclude cancelled ones)
                  ne(appointments.status, "cancel")
                )
              );
  
            const timeSlot = `${schedule.startTime.slice(0, 5)} - ${schedule.endTime.slice(0, 5)}`;
            
            // Get current time in HH:MM format for proper comparison
            const now = new Date();
            const currentTimeHours = now.getHours().toString().padStart(2, '0');
            const currentTimeMinutes = now.getMinutes().toString().padStart(2, '0');
            const currentTime = `${currentTimeHours}:${currentTimeMinutes}`;
            
            console.log(`Schedule ${schedule.id}: currentTime=${currentTime}, scheduleEndTime=${schedule.endTime}`);
            
            // Check if doctor has arrived for this schedule today
            const doctorPresence = await this.getDoctorArrivalStatus(
              schedule.doctorId,
              attenderClinic.clinicId,
              new Date()
            );
            const doctorHasArrived = doctorPresence?.hasArrived || false;
            
            console.log(`Schedule ${schedule.id} (Dr. ${schedule.doctorName}): 
              - Presence record: ${JSON.stringify(doctorPresence)}
              - Has arrived: ${doctorHasArrived}
              - Date checked: ${new Date().toISOString().split('T')[0]}`);

            console.log(`Schedule ${schedule.id}: doctorHasArrived=${doctorHasArrived}`);

            // Determine schedule status based on doctor presence and schedule state
            let scheduleStatus: 'token_started' | 'in_progress' | 'paused' | 'completed' | 'cancelled' | 'inactive_hidden' | 'inactive_visible' | 'schedule_completed' | 'booking_closed';
            
            // Status hierarchy in order of precedence
            if (schedule.cancelReason) {
              scheduleStatus = 'cancelled';
            } else if (schedule.scheduleStatus === 'completed') {
              scheduleStatus = 'schedule_completed';
            } else if (schedule.bookingStatus === 'closed') {
              scheduleStatus = 'booking_closed';
            } else if (schedule.isPaused) {
              scheduleStatus = 'paused';
            } else if (currentTime > schedule.endTime) {
              scheduleStatus = 'completed';
            } else if (!schedule.isVisible) {
              scheduleStatus = 'inactive_hidden';
            } else if (schedule.isVisible && !schedule.isActive) {
              scheduleStatus = 'inactive_visible';
            } else if (schedule.isVisible && schedule.isActive) {
              scheduleStatus = 'token_started';
            } else {
              scheduleStatus = 'inactive_hidden'; // Default fallback
            }
            
            console.log(`Schedule ${schedule.id}: final status=${scheduleStatus}`);

            return {
              id: schedule.id,
              doctorName: schedule.doctorName,
              timeSlot,
              appointmentCount: Number(result?.count) || 0,
              maxTokens: schedule.maxTokens || 20,
              status: scheduleStatus,
            };
          } catch (error) {
            console.error('Error getting appointments for schedule:', schedule.id, error);
            throw error;
          }
        })
      );
  
  
      // Step 5: Summary stats
      const activeSchedules = schedulesWithAppointments.filter(
        (s) => s.status === 'in_progress' || s.status === 'token_started' || s.status === 'inactive_visible'
      ).length;
  
      const totalAppointments = schedulesWithAppointments.reduce(
        (sum, s) => sum + s.appointmentCount,
        0
      );
  
      return {
        schedules: schedulesWithAppointments,
        summary: {
          totalSchedules: schedulesWithAppointments.length,
          activeSchedules,
          totalAppointments,
        },
      };
    } catch (error) {
      console.error('Error in getAttenderSchedulesToday:', error);
      throw error;
    }
  }


  async updateSchedule(scheduleId: number, data: { isActive?: boolean; isPaused?: boolean; cancelReason?: string }): Promise<DoctorSchedule> {
    try {
      const [updatedSchedule] = await db
        .update(doctorSchedules)
        .set(data)
        .where(eq(doctorSchedules.id, scheduleId))
        .returning();

      if (!updatedSchedule) {
        throw new Error('Schedule not found');
      }

      return updatedSchedule;
    } catch (error) {
      console.error('Error updating schedule:', error);
      throw error;
    }
  }

  // Check if password already exists
  async checkPasswordExists(password: string): Promise<boolean> {
    const { scrypt, randomBytes, timingSafeEqual } = await import('crypto');
    const { promisify } = await import('util');
    const scryptAsync = promisify(scrypt);
    
    // Get all users to check password hashes
    const allUsers = await db.select().from(users);
    
    for (const user of allUsers) {
      try {
        const [hashed, salt] = user.password.split(".");
        if (!hashed || !salt) {
          continue; // Skip invalid password format
        }
        const hashedBuf = Buffer.from(hashed, "hex");
        const suppliedBuf = (await scryptAsync(password, salt, 64)) as Buffer;
        if (timingSafeEqual(hashedBuf, suppliedBuf)) {
          return true;
        }
      } catch (error) {
        console.error("Error checking password:", error);
        continue;
      }
    }
    
    return false;
  }

  // Reset attender password
  async resetAttenderPassword(attenderId: number, newPassword: string): Promise<void> {
    const { scrypt, randomBytes } = await import('crypto');
    const { promisify } = await import('util');
    const scryptAsync = promisify(scrypt);
    
    // Hash password using the same method as auth.ts
    const salt = randomBytes(16).toString("hex");
    const buf = (await scryptAsync(newPassword, salt, 64)) as Buffer;
    const hashedPassword = `${buf.toString("hex")}.${salt}`;
    
    await db
      .update(users)
      .set({ 
        password: hashedPassword,
        updatedAt: sql`CURRENT_TIMESTAMP`
      })
      .where(eq(users.id, attenderId));
  }

  // Clinic Admin - Get all doctors in clinic with their appointments
  async getClinicDoctorsAppointments(clinicId: number): Promise<Array<{
    doctor: User, 
    appointments: (Appointment & { patient?: User })[], 
    schedules: (typeof doctorSchedules.$inferSelect & { 
      appointments: (Appointment & { patient?: User })[]
    })[]
  }>> {
    try {
      console.log('Getting appointments for clinic:', clinicId);

      // Get all doctors in this clinic
      const clinicDoctors = await db
        .select()
        .from(doctorClinics)
        .innerJoin(users, eq(users.id, doctorClinics.doctorId))
        .where(eq(doctorClinics.clinicId, clinicId));

      if (!clinicDoctors.length) {
        return [];
      }

      // Get appointments for each doctor
      const doctorsWithAppointments = await Promise.all(
        clinicDoctors.map(async (relation) => {
          const doctor = relation.users;
          const todayStr = new Date().toISOString().split('T')[0]; // "2026-04-07"
          const todayStart = new Date(todayStr + 'T00:00:00.000Z');
          const todayEnd = new Date(todayStr + 'T23:59:59.999Z');

          // Get doctor's schedules for today
          const schedules = await db
            .select()
            .from(doctorSchedules)
            .where(
              and(
                eq(doctorSchedules.doctorId, doctor.id),
                eq(doctorSchedules.isActive, true),
                eq(doctorSchedules.date, todayStr)
              )
            )
            .orderBy(doctorSchedules.startTime);

          // Get appointments for this doctor
          const appointmentsForDoctor = await db
            .select()
            .from(appointments)
            .where(
              and(
                eq(appointments.doctorId, doctor.id),
                gte(appointments.date, todayStart),
                lte(appointments.date, todayEnd)
              )
            );

          // Get patient data for these appointments
          const patientIds = Array.from(new Set(appointmentsForDoctor.map(apt => apt.patientId)));
          const patients = patientIds.length > 0 ? await db
            .select()
            .from(users)
            .where(inArray(users.id, patientIds)) : [];

          const patientsMap = new Map(patients.map(p => [p.id, p]));

          // Add patient data to appointments
          const appointmentsWithPatients = appointmentsForDoctor.map(apt => ({
            ...apt,
            patient: patientsMap.get(apt.patientId),
          }));

          // Map schedules with their appointments
          const schedulesWithAppointments = schedules.map(schedule => {
            const scheduleAppointments = appointmentsWithPatients.filter(apt => {
              if (apt.scheduleId === schedule.id) {
                return true;
              }
              return false;
            });
            
            return {
              ...schedule,
              appointments: scheduleAppointments
            };
          });

          return {
            doctor,
            appointments: appointmentsWithPatients,
            schedules: schedulesWithAppointments,
          };
        })
      );

      return doctorsWithAppointments;
    } catch (error) {
      console.error('Error in getClinicDoctorsAppointments:', error);
      throw error;
    }
  }

  // Clinic Admin - Get today's schedules for the clinic
  async getClinicSchedulesToday(clinicId: number): Promise<{
    schedules: Array<{
      id: number;
      doctorName: string;
      startTime: string;
      endTime: string;
      specialty: string;
      hasArrived: boolean;
      totalAppointments: number;
      currentToken: number;
    }>;
    summary: {
      totalDoctors: number;
      presentDoctors: number;
      totalAppointments: number;
      completedAppointments: number;
    };
  }> {
    try {
      console.log('Getting schedules for clinic:', clinicId);

      // Get all doctors in this clinic
      const clinicDoctors = await db
        .select({
          doctorId: doctorClinics.doctorId,
        })
        .from(doctorClinics)
        .where(eq(doctorClinics.clinicId, clinicId));

      if (!clinicDoctors.length) {
        return {
          schedules: [],
          summary: { totalDoctors: 0, presentDoctors: 0, totalAppointments: 0, completedAppointments: 0 },
        };
      }

      const doctorIds = clinicDoctors.map((d) => d.doctorId);

      // Get today's schedules
      const today = new Date();
      const todayString = today.toISOString().split('T')[0];

      const schedulesResult = await db
        .select({
          id: doctorSchedules.id,
          doctorId: doctorSchedules.doctorId,
          doctorName: users.name,
          specialty: users.specialty,
          startTime: doctorSchedules.startTime,
          endTime: doctorSchedules.endTime,
          isPaused: doctorSchedules.isPaused,
          isActive: doctorSchedules.isActive,
          scheduleDate: doctorSchedules.date
        })
        .from(doctorSchedules)
        .innerJoin(users, eq(users.id, doctorSchedules.doctorId))
        .where(
          and(
            inArray(doctorSchedules.doctorId, doctorIds),
            eq(doctorSchedules.date, todayString)
          )
        );

      // Get doctor presence data
      const presenceData = await db
        .select()
        .from(doctorDailyPresence)
        .where(
          and(
            inArray(doctorDailyPresence.doctorId, doctorIds),
            eq(doctorDailyPresence.date, today)
          )
        );

      const presenceMap = new Map(presenceData.map(p => [p.doctorId, p.hasArrived]));

      // Get appointment counts
      const appointmentCounts = await db
        .select({
          doctorId: appointments.doctorId,
          count: count(),
          completedCount: sql<number>`COUNT(CASE WHEN ${appointments.status} = 'completed' THEN 1 END)`,
        })
        .from(appointments)
        .where(
          and(
            inArray(appointments.doctorId, doctorIds),
            gte(appointments.date, new Date(today.setHours(0, 0, 0, 0))),
            lte(appointments.date, new Date(today.setHours(23, 59, 59, 999)))
          )
        )
        .groupBy(appointments.doctorId);

      const appointmentCountMap = new Map(
        appointmentCounts.map(ac => [ac.doctorId, { total: ac.count, completed: ac.completedCount }])
      );

      // Format schedules
      const formattedSchedules = schedulesResult.map(schedule => ({
        id: schedule.id,
        doctorName: schedule.doctorName,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        specialty: schedule.specialty || 'General',
        hasArrived: presenceMap.get(schedule.doctorId) || false,
        totalAppointments: appointmentCountMap.get(schedule.doctorId)?.total || 0,
        currentToken: 0, // Would need additional logic to get current token
      }));

      // Calculate summary
      const totalDoctors = schedulesResult.length;
      const presentDoctors = formattedSchedules.filter(s => s.hasArrived).length;
      const totalAppointments = Array.from(appointmentCountMap.values()).reduce((sum, counts) => sum + counts.total, 0);
      const completedAppointments = Array.from(appointmentCountMap.values()).reduce((sum, counts) => sum + counts.completed, 0);

      return {
        schedules: formattedSchedules,
        summary: {
          totalDoctors,
          presentDoctors,
          totalAppointments,
          completedAppointments,
        },
      };
    } catch (error) {
      console.error('Error in getClinicSchedulesToday:', error);
      throw error;
    }
  }

  // Get appointment stats for a clinic for today
  async getClinicAppointmentStatsToday(clinicId: number): Promise<{
    scheduled: number;
    completed: number;
    cancelled: number;
  }> {
    try {
      const today = new Date();
      const startOfDay = new Date(today);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(today);
      endOfDay.setHours(23, 59, 59, 999);

      // Get all appointments for today in this clinic
      const appointmentsToday = await db
        .select({
          status: appointments.status,
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.clinicId, clinicId),
            gte(appointments.date, startOfDay),
            lte(appointments.date, endOfDay)
          )
        );

      // Count by status
      const scheduled = appointmentsToday.filter(apt => 
        apt.status && ['token_started', 'in_progress', 'hold', 'pause'].includes(apt.status)
      ).length;
      
      const completed = appointmentsToday.filter(apt => 
        apt.status === 'completed'
      ).length;
      
      const cancelled = appointmentsToday.filter(apt => 
        apt.status === 'cancel'
      ).length;

      return {
        scheduled,
        completed,
        cancelled
      };
    } catch (error) {
      console.error('Error getting clinic appointment stats:', error);
      throw error;
    }
  }

  // Get schedule stats for a clinic for today  
  async getClinicScheduleStatsToday(clinicId: number): Promise<{
    total: number;
    inProgress: number;
    completed: number;
    cancelled: number;
  }> {
    try {
      const today = new Date();
      const startOfDay = new Date(today);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(today);
      endOfDay.setHours(23, 59, 59, 999);

      // Get all schedules for today in this clinic
      const schedulesToday = await db
        .select({
          id: doctorSchedules.id,
          doctorId: doctorSchedules.doctorId,
          scheduleStatus: doctorSchedules.scheduleStatus,
          cancelReason: doctorSchedules.cancelReason,
          isPaused: doctorSchedules.isPaused,
        })
        .from(doctorSchedules)
        .where(
          and(
            eq(doctorSchedules.clinicId, clinicId),
            eq(doctorSchedules.date, today.toISOString().split('T')[0]) // Compare date only
          )
        );

      // Get doctor presence data for today to determine in-progress schedules
      const doctorPresences = await db
        .select({
          doctorId: doctorDailyPresence.doctorId,
          scheduleId: doctorDailyPresence.scheduleId,
          hasArrived: doctorDailyPresence.hasArrived,
        })
        .from(doctorDailyPresence)
        .where(
          and(
            eq(doctorDailyPresence.clinicId, clinicId),
            gte(doctorDailyPresence.date, startOfDay),
            lte(doctorDailyPresence.date, endOfDay)
          )
        );

      // Create a map of doctor presence by schedule
      const presenceMap = new Map();
      doctorPresences.forEach(presence => {
        if (presence.scheduleId) {
          presenceMap.set(presence.scheduleId, presence.hasArrived);
        }
      });

      // Get appointments that have been started (to determine if schedule is actually in progress)
      const startedAppointments = await db
        .select({
          scheduleId: appointments.scheduleId,
          status: appointments.status,
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.clinicId, clinicId),
            gte(appointments.date, startOfDay),
            lte(appointments.date, endOfDay),
            inArray(appointments.status, ['in_progress', 'token_started', 'hold', 'pause'])
          )
        );

      const schedulesWithStartedAppointments = new Set(
        startedAppointments
          .filter(apt => apt.scheduleId)
          .map(apt => apt.scheduleId)
      );

      // Count schedules by status
      const total = schedulesToday.length;
      
      const completed = schedulesToday.filter(schedule => 
        schedule.scheduleStatus === 'completed'
      ).length;
      
      const cancelled = schedulesToday.filter(schedule => 
        schedule.cancelReason !== null && schedule.cancelReason !== undefined
      ).length;
      
      // In-progress: doctor has arrived AND has started appointments AND schedule not completed AND not cancelled
      const inProgress = schedulesToday.filter(schedule => {
        const doctorArrived = presenceMap.get(schedule.id) === true;
        const hasStartedAppointments = schedulesWithStartedAppointments.has(schedule.id);
        return doctorArrived && 
               hasStartedAppointments &&
               schedule.scheduleStatus !== 'completed' && 
               !schedule.cancelReason;
      }).length;

      return {
        total,
        inProgress,
        completed,
        cancelled
      };
    } catch (error) {
      console.error('Error getting clinic schedule stats:', error);
      throw error;
    }
  }

  // Export Report Methods

  async getDoctorsByAttender(attenderId: number): Promise<User[]> {
    try {
      const result = await db
        .select({
          id: users.id,
          name: users.name,
          username: users.username,
          password: users.password,
          role: users.role,
          phone: users.phone,
          email: users.email,
          specialty: users.specialty,
          bio: users.bio,
          imageUrl: users.imageUrl,
          address: users.address,
          city: users.city,
          state: users.state,
          zipCode: users.zipCode,
          latitude: users.latitude,
          longitude: users.longitude,
          clinicId: users.clinicId,
          createdAt: users.createdAt,
        })
        .from(users)
        .innerJoin(attenderDoctors, eq(attenderDoctors.doctorId, users.id))
        .where(
          and(
            eq(users.role, "doctor"),
            eq(attenderDoctors.attenderId, attenderId)
          )
        );

      return result;
    } catch (error) {
      console.error("Error fetching doctors by attender:", error);
      throw error;
    }
  }

  async getAppointmentsForExport(
    doctorId: number,
    startDate: Date,
    endDate: Date
  ): Promise<any[]> {
    try {
      const result = await db
        .select({
          id: appointments.id,
          date: appointments.date,
          tokenNumber: appointments.tokenNumber,
          status: appointments.status,
          statusNotes: appointments.statusNotes,
          actualStartTime: appointments.actualStartTime,
          actualEndTime: appointments.actualEndTime,
          isWalkIn: appointments.isWalkIn,
          guestName: appointments.guestName,
          guestPhone: appointments.guestPhone,
          doctorName: users.name,
          patientName: sql<string>`CASE 
            WHEN ${appointments.isWalkIn} = true THEN ${appointments.guestName}
            ELSE patient.name 
          END`,
          doctorId: appointments.doctorId,
          patientId: appointments.patientId,
          clinicId: appointments.clinicId,
          scheduleId: appointments.scheduleId,
          // Get schedule time from doctor_schedules table
          scheduleTime: sql<string>`CONCAT(schedule.start_time, ' - ', schedule.end_time)`,
        })
        .from(appointments)
        .leftJoin(users, eq(users.id, appointments.doctorId))
        .leftJoin(
          sql`${users} as patient`,
          sql`patient.id = ${appointments.patientId}`
        )
        .leftJoin(
          sql`${doctorSchedules} as schedule`,
          sql`schedule.id = ${appointments.scheduleId}`
        )
        .where(
          and(
            eq(appointments.doctorId, doctorId),
            gte(appointments.date, startDate),
            lte(appointments.date, endDate)
          )
        )
        .orderBy(appointments.date, appointments.tokenNumber);

      // Transform the data to match expected export format
      return result.map((appointment, index) => ({
        serialNumber: index + 1,
        id: appointment.id,
        date: appointment.date,
        tokenNumber: appointment.tokenNumber,
        status: appointment.status || 'scheduled',
        scheduleTime: appointment.scheduleTime || '-',
        inTime: appointment.actualStartTime ? 
          new Date(appointment.actualStartTime).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          }) : '-',
        outTime: appointment.actualEndTime ? 
          new Date(appointment.actualEndTime).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          }) : '-',
        doctorName: appointment.doctorName || 'Unknown Doctor',
        patientName: appointment.patientName || 'Unknown Patient',
        isWalkIn: appointment.isWalkIn || false,
        statusNotes: appointment.statusNotes
      }));
    } catch (error) {
      console.error("Error fetching appointments for export:", error);
      throw error;
    }
  }

  async getAppointmentsForScheduleExport(
    doctorId: number,
    scheduleId: number
  ): Promise<any[]> {
    try {
      const result = await db
        .select({
          id: appointments.id,
          date: appointments.date,
          tokenNumber: appointments.tokenNumber,
          status: appointments.status,
          statusNotes: appointments.statusNotes,
          actualStartTime: appointments.actualStartTime,
          actualEndTime: appointments.actualEndTime,
          isWalkIn: appointments.isWalkIn,
          guestName: appointments.guestName,
          guestPhone: appointments.guestPhone,
          doctorName: users.name,
          patientName: sql<string>`CASE 
            WHEN ${appointments.isWalkIn} = true THEN ${appointments.guestName}
            ELSE patient.name 
          END`,
          doctorId: appointments.doctorId,
          patientId: appointments.patientId,
          clinicId: appointments.clinicId,
          scheduleId: appointments.scheduleId,
          // Get schedule time from doctor_schedules table
          scheduleTime: sql<string>`CONCAT(schedule.start_time, ' - ', schedule.end_time)`,
          scheduleDate: sql<string>`schedule.date`,
        })
        .from(appointments)
        .leftJoin(users, eq(users.id, appointments.doctorId))
        .leftJoin(
          sql`${users} as patient`,
          sql`patient.id = ${appointments.patientId}`
        )
        .leftJoin(
          sql`${doctorSchedules} as schedule`,
          sql`schedule.id = ${appointments.scheduleId}`
        )
        .where(
          and(
            eq(appointments.doctorId, doctorId),
            eq(appointments.scheduleId, scheduleId)
          )
        )
        .orderBy(appointments.tokenNumber);

      // Transform the data to match expected export format
      return result.map((appointment, index) => ({
        serialNumber: index + 1,
        id: appointment.id,
        date: appointment.scheduleDate || appointment.date,
        tokenNumber: appointment.tokenNumber,
        status: appointment.status || 'scheduled',
        scheduleTime: appointment.scheduleTime || '-',
        inTime: appointment.actualStartTime ? 
          new Date(appointment.actualStartTime).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          }) : '-',
        outTime: appointment.actualEndTime ? 
          new Date(appointment.actualEndTime).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          }) : '-',
        doctorName: appointment.doctorName || 'Unknown Doctor',
        patientName: appointment.patientName || 'Unknown Patient',
        isWalkIn: appointment.isWalkIn || false,
        statusNotes: appointment.statusNotes
      }));
    } catch (error) {
      console.error("Error fetching appointments for schedule export:", error);
      throw error;
    }
  }

  // OTP related methods
  async createOtpVerification(data: InsertOtpVerification): Promise<OtpVerification> {
    const [otp] = await db.insert(otpVerifications).values(data).returning();
    return otp;
  }

  async getValidOtp(phone: string, otpCode: string): Promise<OtpVerification | undefined> {
    const [otp] = await db
      .select()
      .from(otpVerifications)
      .where(
        and(
          eq(otpVerifications.phone, phone),
          eq(otpVerifications.otpCode, otpCode),
          eq(otpVerifications.verified, false),
          sql`${otpVerifications.expiresAt} > NOW()`
        )
      );
    return otp;
  }

  async markOtpAsVerified(id: number): Promise<void> {
    await db
      .update(otpVerifications)
      .set({ verified: true })
      .where(eq(otpVerifications.id, id));
  }

  async incrementOtpAttempts(id: number): Promise<void> {
    await db
      .update(otpVerifications)
      .set({ 
        verificationAttempts: sql`${otpVerifications.verificationAttempts} + 1`
      })
      .where(eq(otpVerifications.id, id));
  }

  async cleanupExpiredOtps(): Promise<void> {
    await db
      .delete(otpVerifications)
      .where(sql`${otpVerifications.expiresAt} < NOW()`);
  }

  async canSendOtp(phone: string): Promise<boolean> {
    // Check if user has sent OTP in last hour
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.phone, phone));

    if (!user) return true; // Allow if user doesn't exist (for registration)

    if (!user.lastOtpSentAt) return true;

    // In development, allow resend every 10 seconds; in production, every 60 seconds
    const waitMs = process.env.NODE_ENV === 'production' ? 60 * 1000 : 10 * 1000;
    const cutoff = new Date(Date.now() - waitMs);
    return user.lastOtpSentAt < cutoff;
  }

  async updateLastOtpSentAt(phone: string): Promise<void> {
    await db
      .update(users)
      .set({ lastOtpSentAt: new Date() })
      .where(eq(users.phone, phone));
  }

  // MPIN Authentication Methods
  async getUserByPhoneForMpin(phone: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.phone, phone), eq(users.role, 'patient')));
    return user;
  }

  async updateMpin(userId: number, hashedMpin: string): Promise<void> {
    await db
      .update(users)
      .set({ 
        mpin: hashedMpin,
        mpinAttempts: 0,
        mpinLockedUntil: null,
        lastMpinChange: new Date()
      })
      .where(eq(users.id, userId));
  }

  async incrementMpinAttempts(userId: number): Promise<void> {
    await db
      .update(users)
      .set({ 
        mpinAttempts: sql`${users.mpinAttempts} + 1`
      })
      .where(eq(users.id, userId));
  }

  async lockMpinAccount(userId: number, minutes: number = 15): Promise<void> {
    const lockedUntil = new Date(Date.now() + minutes * 60 * 1000);
    await db
      .update(users)
      .set({ 
        mpinLockedUntil: lockedUntil
      })
      .where(eq(users.id, userId));
  }

  async resetMpinAttempts(userId: number): Promise<void> {
    await db
      .update(users)
      .set({ 
        mpinAttempts: 0,
        mpinLockedUntil: null
      })
      .where(eq(users.id, userId));
  }

  async isMpinLocked(userId: number): Promise<boolean> {
    const [user] = await db
      .select({ mpinLockedUntil: users.mpinLockedUntil })
      .from(users)
      .where(eq(users.id, userId));
    
    if (!user || !user.mpinLockedUntil) return false;
    return new Date() < new Date(user.mpinLockedUntil);
  }

  // Login Attempt Tracking
  async logLoginAttempt(
    userId: number | null,
    loginType: 'patient' | 'staff' | 'admin',
    ipAddress: string,
    userAgent: string | undefined,
    success: boolean,
    failureReason?: string
  ): Promise<void> {
    await db.insert(loginAttempts).values({
      userId,
      loginType,
      ipAddress,
      userAgent: userAgent || null,
      success,
      failureReason
    });
  }

  async getRecentLoginAttempts(ipAddress: string, minutes: number = 5): Promise<number> {
    const since = new Date(Date.now() - minutes * 60 * 1000);
    const [result] = await db
      .select({ count: count() })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.ipAddress, ipAddress),
          gte(loginAttempts.attemptedAt, since),
          eq(loginAttempts.success, false)
        )
      );
    return result?.count || 0;
  }

  async getUserLoginAttempts(userId: number, minutes: number = 15): Promise<number> {
    const since = new Date(Date.now() - minutes * 60 * 1000);
    const [result] = await db
      .select({ count: count() })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.userId, userId),
          gte(loginAttempts.attemptedAt, since),
          eq(loginAttempts.success, false)
        )
      );
    return result?.count || 0;
  }

  // Fix existing token numbers to be per-schedule instead of per-doctor-per-day
  async fixTokenNumbers(): Promise<void> {
    console.log('🔧 Starting token number fix...');
    
    try {
      // Get all appointments that have scheduleId
      const allAppointments = await db
        .select()
        .from(appointments)
        .where(
          and(
            isNotNull(appointments.scheduleId),
            ne(appointments.status, "cancel") // Don't fix cancelled appointments
          )
        )
        .orderBy(appointments.date, appointments.id); // Order by date, then by creation order

      console.log(`Found ${allAppointments.length} appointments to potentially fix`);

      // Group appointments by schedule
      const appointmentsBySchedule = new Map<number, typeof allAppointments>();
      allAppointments.forEach(apt => {
        if (apt.scheduleId) {
          if (!appointmentsBySchedule.has(apt.scheduleId)) {
            appointmentsBySchedule.set(apt.scheduleId, []);
          }
          appointmentsBySchedule.get(apt.scheduleId)!.push(apt);
        }
      });

      console.log(`Found ${appointmentsBySchedule.size} schedules to fix`);

      // Fix token numbers for each schedule
      for (const [scheduleId, scheduleAppointments] of appointmentsBySchedule) {
        console.log(`Fixing tokens for schedule ${scheduleId} (${scheduleAppointments.length} appointments)`);
        
        // Sort by date, then by current token number to maintain relative order
        scheduleAppointments.sort((a, b) => {
          const dateCompare = new Date(a.date).getTime() - new Date(b.date).getTime();
          if (dateCompare !== 0) return dateCompare;
          return a.tokenNumber - b.tokenNumber;
        });

        // Group by date within the schedule
        const appointmentsByDate = new Map<string, typeof scheduleAppointments>();
        scheduleAppointments.forEach(apt => {
          const dateKey = new Date(apt.date).toISOString().split('T')[0];
          if (!appointmentsByDate.has(dateKey)) {
            appointmentsByDate.set(dateKey, []);
          }
          appointmentsByDate.get(dateKey)!.push(apt);
        });

        // Reassign token numbers starting from 1 for each date
        for (const [dateKey, dateAppointments] of appointmentsByDate) {
          console.log(`  Fixing ${dateAppointments.length} appointments for ${dateKey}`);
          
          for (let i = 0; i < dateAppointments.length; i++) {
            const apt = dateAppointments[i];
            const newTokenNumber = i + 1;
            
            if (apt.tokenNumber !== newTokenNumber) {
              console.log(`    Appointment ${apt.id}: ${apt.tokenNumber} → ${newTokenNumber}`);
              await db
                .update(appointments)
                .set({ tokenNumber: newTokenNumber })
                .where(eq(appointments.id, apt.id));
            }
          }
        }
      }

      console.log('✅ Token number fix completed!');
    } catch (error) {
      console.error('❌ Error fixing token numbers:', error);
      throw error;
    }
  }

  // Super Admin Dashboard methods
  async getSuperAdminDashboardMetrics(): Promise<{
    // Overview Stats
    totalClinics: number;
    totalDoctors: number;
    totalPatients: number;
    totalAppointments: number;
    
    // User counts by role
    totalClinicAdmins: number;
    totalAttenders: number;
    
    // Recent Activity (last 7 days)
    recentAppointments: number;
    completedAppointments: number;
    newRegistrations: number;
    
    // Today's activity
    appointmentsToday: number;
  }> {
    try {
      // Get current date ranges (using UTC to match database timestamps)
      const now = new Date();
      
      // Convert to UTC dates to match database timestamp format
      const today = new Date();
      const startOfToday = new Date(Date.UTC(
        today.getFullYear(), 
        today.getMonth(), 
        today.getDate(), 
        0, 0, 0, 0
      ));
      const endOfToday = new Date(Date.UTC(
        today.getFullYear(), 
        today.getMonth(), 
        today.getDate(), 
        23, 59, 59, 999
      ));

      // Last 7 days range (UTC)
      const last7DaysDate = new Date(today);
      last7DaysDate.setDate(today.getDate() - 7);
      const last7Days = new Date(Date.UTC(
        last7DaysDate.getFullYear(),
        last7DaysDate.getMonth(),
        last7DaysDate.getDate(),
        0, 0, 0, 0
      ));

      // Last 6 months range (UTC)
      const last6MonthsDate = new Date(today);
      last6MonthsDate.setMonth(today.getMonth() - 6);
      const last6Months = new Date(Date.UTC(
        last6MonthsDate.getFullYear(),
        last6MonthsDate.getMonth(),
        last6MonthsDate.getDate(),
        0, 0, 0, 0
      ));


      // === OVERVIEW STATS ===
      // Total clinics count
      const [totalClinicsResult] = await db
        .select({ count: count() })
        .from(clinics);

      // Total doctors count (doctors with role 'doctor')
      const [totalDoctorsResult] = await db
        .select({ count: count() })
        .from(users)
        .where(eq(users.role, 'doctor'));

      // Total patients count (unique users with role 'patient')
      const [totalPatientsResult] = await db
        .select({ count: count() })
        .from(users)
        .where(eq(users.role, 'patient'));

      // Total appointments count (LAST 6 MONTHS)
      const [totalAppointmentsResult] = await db
        .select({ count: count() })
        .from(appointments)
        .where(
          and(
            gte(appointments.createdAt, last6Months),
            lte(appointments.createdAt, endOfToday)
          )
        );

      // === USER COUNTS BY ROLE ===
      // Clinic admins count
      const [totalClinicAdminsResult] = await db
        .select({ count: count() })
        .from(users)
        .where(eq(users.role, 'clinic_admin'));

      // Attenders count
      const [totalAttendersResult] = await db
        .select({ count: count() })
        .from(users)
        .where(eq(users.role, 'attender'));

      // === RECENT ACTIVITY (LAST 7 DAYS) ===
      // Recent appointments (last 7 days)
      const [recentAppointmentsResult] = await db
        .select({ count: count() })
        .from(appointments)
        .where(
          and(
            gte(appointments.createdAt, last7Days),
            lte(appointments.createdAt, endOfToday)
          )
        );

      // Completed appointments (last 7 days)
      const [completedAppointmentsResult] = await db
        .select({ count: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.status, 'completed'),
            gte(appointments.date, last7Days),
            lte(appointments.date, endOfToday)
          )
        );

      // New patient registrations (last 7 days)
      const [newRegistrationsResult] = await db
        .select({ count: count() })
        .from(users)
        .where(
          and(
            eq(users.role, 'patient'),
            gte(users.createdAt, last7Days),
            lte(users.createdAt, endOfToday)
          )
        );

      // === TODAY'S ACTIVITY ===
      // Appointments today (any status)
      const [appointmentsTodayResult] = await db
        .select({ count: count() })
        .from(appointments)
        .where(
          and(
            gte(appointments.date, startOfToday),
            lte(appointments.date, endOfToday)
          )
        );

      return {
        // Overview Stats
        totalClinics: totalClinicsResult?.count || 0,
        totalDoctors: totalDoctorsResult?.count || 0,
        totalPatients: totalPatientsResult?.count || 0,
        totalAppointments: totalAppointmentsResult?.count || 0, // LAST 6 MONTHS
        
        // User counts by role
        totalClinicAdmins: totalClinicAdminsResult?.count || 0,
        totalAttenders: totalAttendersResult?.count || 0,
        
        // Recent Activity (last 7 days)
        recentAppointments: recentAppointmentsResult?.count || 0,
        completedAppointments: completedAppointmentsResult?.count || 0,
        newRegistrations: newRegistrationsResult?.count || 0,
        
        // Today's activity
        appointmentsToday: appointmentsTodayResult?.count || 0,
      };
    } catch (error) {
      console.error('Error fetching super admin dashboard metrics:', error);
      throw error;
    }
  }

  // Admin Configuration methods
  async getConfiguration(key: string): Promise<AdminConfiguration | undefined> {
    try {
      const [config] = await db
        .select()
        .from(adminConfigurations)
        .where(eq(adminConfigurations.configKey, key))
        .limit(1);
      return config;
    } catch (error) {
      console.error(`Error fetching configuration for key ${key}:`, error);
      throw error;
    }
  }

  async getConfigurationsByCategory(category: string): Promise<AdminConfiguration[]> {
    try {
      const configs = await db
        .select()
        .from(adminConfigurations)
        .where(eq(adminConfigurations.category, category));
      return configs;
    } catch (error) {
      console.error(`Error fetching configurations for category ${category}:`, error);
      throw error;
    }
  }

  async getAllConfigurations(): Promise<AdminConfiguration[]> {
    try {
      const configs = await db
        .select()
        .from(adminConfigurations);
      return configs;
    } catch (error) {
      console.error('Error fetching all configurations:', error);
      throw error;
    }
  }

  async updateConfiguration(
    key: string, 
    value: string, 
    updatedBy?: number
  ): Promise<AdminConfiguration> {
    try {
      const [updated] = await db
        .update(adminConfigurations)
        .set({ 
          configValue: value,
          updatedBy: updatedBy,
          updatedAt: new Date()
        })
        .where(eq(adminConfigurations.configKey, key))
        .returning();

      if (!updated) {
        throw new Error(`Configuration with key ${key} not found`);
      }

      return updated;
    } catch (error) {
      console.error(`Error updating configuration ${key}:`, error);
      throw error;
    }
  }

  async createConfiguration(config: InsertAdminConfiguration): Promise<AdminConfiguration> {
    try {
      const [created] = await db
        .insert(adminConfigurations)
        .values(config)
        .returning();
      return created;
    } catch (error) {
      console.error('Error creating configuration:', error);
      throw error;
    }
  }

  async upsertConfiguration(config: InsertAdminConfiguration): Promise<AdminConfiguration> {
    const [result] = await db
      .insert(adminConfigurations)
      .values(config)
      .onConflictDoUpdate({
        target: adminConfigurations.configKey,
        // Update value and type — seed is the authoritative source for configType
        set: {
          configValue: config.configValue,
          configType: config.configType,
          description: config.description,
          category: config.category,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result;
  }

  // Mark appointment as refunded to prevent duplicate refunds
  async markAppointmentAsRefunded(appointmentId: number, refundAmount: number): Promise<void> {
    try {
      console.log(`Marking appointment ${appointmentId} as refunded with amount ${refundAmount}`);

      await db
        .update(appointments)
        .set({
          hasBeenRefunded: true,
          refundAmount: refundAmount,
          refundedAt: sql`CURRENT_TIMESTAMP`
        })
        .where(eq(appointments.id, appointmentId));

      console.log(`Successfully marked appointment ${appointmentId} as refunded`);
    } catch (error) {
      console.error(`Error marking appointment ${appointmentId} as refunded:`, error);
      throw error;
    }
  }

  // --- Token Reservation Methods ---

  async expireStaleReservations(): Promise<void> {
    const stale = await db.select()
      .from(tokenReservations)
      .where(and(
        eq(tokenReservations.status, "pending"),
        lt(tokenReservations.expiresAt, new Date())
      ));

    for (const reservation of stale) {
      // Guard: skip if an appointment already exists for this token (confirmed at boundary)
      const [existing] = await db.select({ id: appointments.id })
        .from(appointments)
        .where(and(
          eq(appointments.scheduleId, reservation.scheduleId),
          eq(appointments.tokenNumber, reservation.tokenNumber),
          ne(appointments.status, "cancel")
        ));

      if (!existing) {
        // Shift all queued appointments after the expired slot up by one token
        await db.update(appointments)
          .set({ tokenNumber: sql`${appointments.tokenNumber} - 1` })
          .where(and(
            eq(appointments.scheduleId, reservation.scheduleId),
            gt(appointments.tokenNumber, reservation.tokenNumber),
            inArray(appointments.status, ['token_started', 'scheduled', 'in_progress', 'hold', 'pause'])
          ));
      }

      await db.update(tokenReservations)
        .set({ status: "expired" })
        .where(eq(tokenReservations.id, reservation.id));
    }
  }

  async reserveNextToken(scheduleId: number, reservedByUserId: number): Promise<TokenReservation> {
    // 1. Expire any old reservations first
    await this.expireStaleReservations();

    // 2. Get max token from appointments (non-cancelled)
    const apptResult = await db.select({ maxToken: max(appointments.tokenNumber) })
      .from(appointments)
      .where(and(eq(appointments.scheduleId, scheduleId), ne(appointments.status, "cancel")));

    // 3. Get max token from active reservations on this schedule
    const resResult = await db.select({ maxToken: max(tokenReservations.tokenNumber) })
      .from(tokenReservations)
      .where(and(eq(tokenReservations.scheduleId, scheduleId), eq(tokenReservations.status, "pending")));

    const maxAppt = apptResult[0]?.maxToken || 0;
    const maxRes = resResult[0]?.maxToken || 0;
    const nextToken = Math.max(maxAppt, maxRes) + 1;

    // 4. Read timeout from config (default 300 seconds)
    const timeoutConfig = await this.getConfiguration('token_reservation_timeout_seconds');
    const timeoutSeconds = timeoutConfig ? parseInt(timeoutConfig.configValue) : 300;
    const expiresAt = new Date(Date.now() + timeoutSeconds * 1000);
    const [reservation] = await db.insert(tokenReservations).values({
      scheduleId,
      tokenNumber: nextToken,
      reservedByUserId,
      status: "pending",
      expiresAt,
    }).returning();

    return reservation;
  }

  async confirmTokenReservation(reservationId: number, guestName: string, guestPhone: string | undefined): Promise<Appointment> {
    // 1. Get the reservation
    const [reservation] = await db.select().from(tokenReservations)
      .where(and(eq(tokenReservations.id, reservationId), eq(tokenReservations.status, "pending")));

    if (!reservation) throw new Error("Reservation not found or already expired");
    if (new Date() > reservation.expiresAt) {
      await db.update(tokenReservations).set({ status: "expired" }).where(eq(tokenReservations.id, reservationId));
      throw new Error("Reservation has expired. Please reserve again.");
    }

    // 2. Get schedule details
    const [schedule] = await db.select().from(doctorSchedules).where(eq(doctorSchedules.id, reservation.scheduleId));
    if (!schedule) throw new Error("Schedule not found");

    // 3. Check if reserved token was stolen by a race condition — reassign if needed
    const [collision] = await db.select().from(appointments)
      .where(and(
        eq(appointments.scheduleId, reservation.scheduleId),
        eq(appointments.tokenNumber, reservation.tokenNumber),
        ne(appointments.status, "cancel")
      ));

    let finalTokenNumber = reservation.tokenNumber;
    if (collision) {
      // Token was taken — recalculate next available
      const [maxResult] = await db.select({ maxToken: sql<number>`COALESCE(MAX(token_number), 0)` })
        .from(appointments)
        .where(and(eq(appointments.scheduleId, reservation.scheduleId), ne(appointments.status, "cancel")));
      finalTokenNumber = (maxResult?.maxToken || 0) + 1;
    }

    // 4. Create the appointment with the final token number
    const [appointment] = await db.insert(appointments).values({
      doctorId: schedule.doctorId,
      clinicId: schedule.clinicId,
      scheduleId: reservation.scheduleId,
      date: new Date(schedule.date + 'T00:00:00.000Z'),
      tokenNumber: finalTokenNumber,
      guestName,
      guestPhone: guestPhone || null,
      isWalkIn: true,
      status: "token_started",
      isPaid: false,
      isRefundEligible: false,
      hasBeenRefunded: false,
    }).returning();

    // 5. Mark reservation as confirmed
    await db.update(tokenReservations).set({ status: "confirmed" }).where(eq(tokenReservations.id, reservationId));

    return appointment;
  }

  async cancelTokenReservation(reservationId: number, userId: number): Promise<void> {
    await db.update(tokenReservations)
      .set({ status: "cancelled" })
      .where(and(eq(tokenReservations.id, reservationId), eq(tokenReservations.reservedByUserId, userId)));
  }

  async getActiveReservationsForSchedule(scheduleId: number): Promise<TokenReservation[]> {
    await this.expireStaleReservations();
    return db.select().from(tokenReservations)
      .where(and(eq(tokenReservations.scheduleId, scheduleId), eq(tokenReservations.status, "pending")));
  }
}

export const storage = new DatabaseStorage();
