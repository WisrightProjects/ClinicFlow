import { relations, sql } from "drizzle-orm";
import { boolean, decimal, index, integer, pgTable, serial, text, timestamp, varchar, date } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

export const clinics = pgTable("clinics", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  address: varchar("address", { length: 255 }),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 100 }),
  zipCode: varchar("zip_code", { length: 20 }),
  openingHours: text("opening_hours"),
  description: text("description"),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 255 }),
  latitude: decimal("latitude", { precision: 10, scale: 8 }),
  longitude: decimal("longitude", { precision: 11, scale: 8 }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  username: varchar("username", { length: 255 }).notNull().unique(),
  password: varchar("password", { length: 255 }).notNull(),
  role: varchar("role", { length: 50 }).notNull(),
  phone: varchar("phone", { length: 20 }).notNull(),
  email: varchar("email", { length: 255 }).unique(),
  specialty: varchar("specialty", { length: 255 }),
  bio: text("bio"),
  imageUrl: text("image_url"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  latitude: varchar("latitude", { length: 50 }),
  longitude: varchar("longitude", { length: 50 }),
  clinicId: integer("clinic_id").references(() => clinics.id),
  lastOtpSentAt: timestamp("last_otp_sent_at"),
  phoneVerified: boolean("phone_verified").default(false),
  mustChangePassword: boolean("must_change_password").default(false),
  mpin: varchar("mpin", { length: 255 }),
  mpinAttempts: integer("mpin_attempts").default(0),
  mpinLockedUntil: timestamp("mpin_locked_until"),
  lastMpinChange: timestamp("last_mpin_change"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const loginAttempts = pgTable("login_attempts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  loginType: varchar("login_type", { length: 20 }),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  success: boolean("success").notNull(),
  attemptedAt: timestamp("attempted_at").default(sql`CURRENT_TIMESTAMP`),
  failureReason: varchar("failure_reason", { length: 255 }),
});

export const doctorDetails = pgTable("doctor_details", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull().references(() => users.id),
  consultationFee: decimal("consultation_fee", { precision: 10, scale: 2 }).notNull(),
  consultationDuration: integer("consultation_duration").notNull(), // in minutes
  qualifications: text("qualifications"),
  experience: integer("experience"), // in years
  registrationNumber: varchar("registration_number", { length: 100 }),
  isEnabled: boolean("is_enabled").default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export const doctorDailyPresence = pgTable("doctor_daily_presence", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").references(() => users.id).notNull(),
  clinicId: integer("clinic_id").references(() => clinics.id).notNull(),
  scheduleId: integer("schedule_id").references(() => doctorSchedules.id),
  date: timestamp("date").notNull(),
  hasArrived: boolean("has_arrived").default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export const attenderDoctors = pgTable("attender_doctors", {
  id: serial("id").primaryKey(),
  attenderId: integer("attender_id").notNull().references(() => users.id),
  doctorId: integer("doctor_id").notNull().references(() => users.id),
  clinicId: integer("clinic_id").references(() => clinics.id),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Define appointment status values
export const appointmentStatuses = [
  "token_started", // Default status when appointment is booked (doctor not arrived)
  "in_progress",   // Doctor has arrived and appointment is actively being processed
  "hold",          // Patient not arrived at right time
  "pause",         // Temporarily paused appointment (was in progress)
  "cancel",        // Appointment cancelled
  "no_show",       // Patient didn't show up (not eligible for refund)
  "completed",     // Appointment completed
  "expired"        // Walk-in reservation expired without confirmation — placeholder to fill queue gap
] as const;

export type AppointmentStatus = typeof appointmentStatuses[number];

export const doctorClinics = pgTable("doctor_clinics", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull().references(() => users.id),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id),
});

export const appointments = pgTable("appointments", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").references(() => users.id),
  doctorId: integer("doctor_id").references(() => users.id),
  clinicId: integer("clinic_id").references(() => clinics.id),
  scheduleId: integer("schedule_id").references(() => doctorSchedules.id),
  date: timestamp("date").notNull(),
  tokenNumber: integer("token_number").notNull(),
  status: varchar("status", { length: 50 }).default("token_started"),
  statusNotes: text("status_notes"), // For recording reasons for status changes
  // Guest patient fields for walk-in and on-behalf appointments
  guestName: varchar("guest_name", { length: 255 }),
  guestPhone: varchar("guest_phone", { length: 20 }),
  isWalkIn: boolean("is_walk_in").default(false),
  isOnBehalf: boolean("is_on_behalf").default(false),
  // ETA tracking fields
  estimatedStartTime: timestamp("estimated_start_time"),
  actualStartTime: timestamp("actual_start_time"),
  actualEndTime: timestamp("actual_end_time"),
  // Wallet and Payment fields
  consultationFee: decimal("consultation_fee", { precision: 10, scale: 2 }).default("0.00"),
  isPaid: boolean("is_paid").default(false),
  paymentMethod: varchar("payment_method", { length: 50 }).default("wallet"), // wallet, cash, card, etc.
  walletTransactionId: integer("wallet_transaction_id").references(() => walletTransactions.id),
  isRefundEligible: boolean("is_refund_eligible").default(true),
  hasBeenRefunded: boolean("has_been_refunded").default(false),
  refundAmount: decimal("refund_amount", { precision: 10, scale: 2 }).default("0.00"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const doctorSchedules = pgTable("doctor_schedules", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull().references(() => users.id),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id),
  date: date("date").notNull(),
  startTime: varchar("start_time", { length: 5 }).notNull(), 
  endTime: varchar("end_time", { length: 5 }).notNull(),   
  maxTokens: integer("max_tokens").default(20),
  isPaused: boolean("is_paused").default(false),
  pauseReason: text("pause_reason"),
  pausedAt: timestamp("paused_at"),
  resumedAt: timestamp("resumed_at"),
  isActive: boolean("is_active").default(true),
  isVisible: boolean("is_visible").default(false), // Controls visibility to patients
  status: varchar("status", { length: 20 }).default("active"),
  cancelReason: text("cancel_reason"),
  cancelledAt: timestamp("cancelled_at"),
  // Schedule-level status fields
  scheduleStatus: varchar("schedule_status", { length: 20 }).default("active"), // active, completed
  bookingStatus: varchar("booking_status", { length: 20 }).default("open"), // open, closed
  completedAt: timestamp("completed_at"),
  bookingClosedAt: timestamp("booking_closed_at"),
  // ETA calculation fields
  averageConsultationTime: integer("average_consultation_time").default(15), // admin-configured, never overwritten by system
  learnedConsultationTime: integer("learned_consultation_time"), // system-computed from actual consultations (≥3 samples)
  actualArrivalTime: timestamp("actual_arrival_time"), // when doctor actually arrives
  createdBy: integer("created_by").references(() => users.id), // Track who created the schedule
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export const patientFavorites = pgTable("patient_favorites", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => users.id),
  doctorId: integer("doctor_id").notNull().references(() => users.id),
  scheduleId: integer("schedule_id").notNull().references(() => doctorSchedules.id),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  appointmentId: integer("appointment_id").references(() => appointments.id),
  title: varchar("title", { length: 100 }).notNull(),
  message: text("message").notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const deviceTokens = pgTable("device_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  platform: varchar("platform", { length: 20 }).notNull().default("android"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
}, (t) => [index("device_tokens_user_id_idx").on(t.userId)]);

export const otpVerifications = pgTable("otp_verifications", {
  id: serial("id").primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull(),
  otpCode: varchar("otp_code", { length: 6 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  verified: boolean("verified").default(false),
  verificationAttempts: integer("verification_attempts").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
});

// Admin configurations for system-wide settings
export const adminConfigurations = pgTable("admin_configurations", {
  id: serial("id").primaryKey(),
  configKey: varchar("config_key", { length: 100 }).notNull().unique(),
  configValue: text("config_value").notNull(),
  configType: varchar("config_type", { length: 20 }).notNull().default("string"), // string, number, boolean, json
  description: text("description"),
  category: varchar("category", { length: 50 }).notNull().default("general"), // general, nearby, ui, etc.
  isEditable: boolean("is_editable").default(true),
  createdBy: integer("created_by").references(() => users.id),
  updatedBy: integer("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

// Patient Wallet System
export const patientWallets = pgTable("patient_wallets", {
  id: serial("id").primaryKey(),
  patientId: integer("patient_id").notNull().references(() => users.id),
  balance: decimal("balance", { precision: 10, scale: 2 }).notNull().default("0.00"),
  totalEarned: decimal("total_earned", { precision: 10, scale: 2 }).notNull().default("0.00"), // Total refunds received
  totalSpent: decimal("total_spent", { precision: 10, scale: 2 }).notNull().default("0.00"), // Total spent on appointments
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

// Wallet Transaction Types
export const walletTransactionTypes = [
  "appointment_payment",    // Money deducted for booking appointment
  "refund_schedule_cancel", // Refund due to schedule cancellation
  "refund_doctor_absent",   // Refund due to doctor not arriving
  "partial_refund",         // Partial refund when doctor leaves mid-session
  "admin_credit",           // Manual credit by admin
  "admin_debit",            // Manual debit by admin
  "wallet_topup",           // Patient adds money to wallet
  "withdrawal"              // Patient withdraws money from wallet
] as const;

export type WalletTransactionType = typeof walletTransactionTypes[number];

export const walletTransactions = pgTable("wallet_transactions", {
  id: serial("id").primaryKey(),
  walletId: integer("wallet_id").notNull().references(() => patientWallets.id),
  patientId: integer("patient_id").notNull().references(() => users.id),
  appointmentId: integer("appointment_id").references(() => appointments.id),
  scheduleId: integer("schedule_id").references(() => doctorSchedules.id),
  transactionType: varchar("transaction_type", { length: 50 }).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  previousBalance: decimal("previous_balance", { precision: 10, scale: 2 }).notNull(),
  newBalance: decimal("new_balance", { precision: 10, scale: 2 }).notNull(),
  description: text("description").notNull(),
  referenceId: varchar("reference_id", { length: 100 }), // For external payment references
  processedBy: integer("processed_by").references(() => users.id), // Admin/system who processed
  status: varchar("status", { length: 20 }).default("completed"), // completed, pending, failed
  metadata: text("metadata"), // JSON field for additional data
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Payment attempts — one row per booking payment, whatever the method.
// `gateway` is what separates a real payment from a simulated one: rows with
// gateway = 'dummy' took no money and must never be refunded to the wallet.
export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  appointmentId: integer("appointment_id").references(() => appointments.id),
  patientId: integer("patient_id").notNull().references(() => users.id),
  scheduleId: integer("schedule_id").references(() => doctorSchedules.id),
  method: varchar("method", { length: 20 }).notNull(),          // wallet | online
  gateway: varchar("gateway", { length: 30 }).notNull(),        // wallet | dummy | razorpay
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  platformFee: decimal("platform_fee", { precision: 10, scale: 2 }).notNull(),
  gstAmount: decimal("gst_amount", { precision: 10, scale: 2 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("created"), // created | success | failed
  // Populated by a real gateway in Phase 2; unique so a replayed webhook cannot
  // be processed twice. Null for wallet and dummy payments.
  gatewayPaymentId: varchar("gateway_payment_id", { length: 100 }).unique(),
  walletTransactionId: integer("wallet_transaction_id").references(() => walletTransactions.id),
  metadata: text("metadata"), // JSON
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  patientIdx: index("payments_patient_idx").on(table.patientId),
  appointmentIdx: index("payments_appointment_idx").on(table.appointmentId),
}));

// Refund Tracking for Appointments
export const appointmentRefunds = pgTable("appointment_refunds", {
  id: serial("id").primaryKey(),
  appointmentId: integer("appointment_id").notNull().references(() => appointments.id),
  patientId: integer("patient_id").notNull().references(() => users.id),
  scheduleId: integer("schedule_id").notNull().references(() => doctorSchedules.id),
  doctorId: integer("doctor_id").notNull().references(() => users.id),
  clinicId: integer("clinic_id").notNull().references(() => clinics.id),
  originalAmount: decimal("original_amount", { precision: 10, scale: 2 }).notNull(),
  refundAmount: decimal("refund_amount", { precision: 10, scale: 2 }).notNull(),
  refundReason: varchar("refund_reason", { length: 100 }).notNull(),
  refundType: varchar("refund_type", { length: 50 }).notNull(), // full, partial, none
  walletTransactionId: integer("wallet_transaction_id").references(() => walletTransactions.id),
  processedBy: integer("processed_by").notNull().references(() => users.id),
  processedAt: timestamp("processed_at").default(sql`CURRENT_TIMESTAMP`),
  notes: text("notes"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const tokenReservations = pgTable("token_reservations", {
  id: serial("id").primaryKey(),
  scheduleId: integer("schedule_id").notNull().references(() => doctorSchedules.id),
  tokenNumber: integer("token_number").notNull(),
  reservedByUserId: integer("reserved_by_user_id").notNull().references(() => users.id),
  status: varchar("status", { length: 20 }).default("pending"), // pending | confirmed | cancelled | expired
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// Define relations
export const usersRelations = relations(users, ({ one, many }) => ({
  clinic: one(clinics, {
    fields: [users.clinicId],
    references: [clinics.id],
  }),
  managedDoctors: many(attenderDoctors, { relationName: "attender" }),
  attenders: many(attenderDoctors, { relationName: "doctor" }),
  doctorDetails: one(doctorDetails, {
    fields: [users.id],
    references: [doctorDetails.doctorId],
  }),
  appointments: many(appointments),
  schedules: many(doctorSchedules),
  clinics: many(doctorClinics),
  patientFavorites: many(patientFavorites, { relationName: "patient" }),
  notifications: many(notifications),
  doctorFavorites: many(patientFavorites, { relationName: "doctor" }),
}));

export const clinicsRelations = relations(clinics, ({ many }) => ({
  users: many(users),
  appointments: many(appointments),
  doctors: many(users),
  attenders: many(users),
  schedules: many(doctorSchedules),
}));

export const appointmentsRelations = relations(appointments, ({ one }) => ({
  patient: one(users, {
    fields: [appointments.patientId],
    references: [users.id],
  }),
  doctor: one(users, {
    fields: [appointments.doctorId],
    references: [users.id],
  }),
  clinic: one(clinics, {
    fields: [appointments.clinicId],
    references: [clinics.id],
  }),
  schedule: one(doctorSchedules, {
    fields: [appointments.scheduleId],
    references: [doctorSchedules.id],
  }),
}));

export const attenderDoctorsRelations = relations(attenderDoctors, ({ one }) => ({
  attender: one(users, {
    fields: [attenderDoctors.attenderId],
    references: [users.id],
    relationName: "attender",
  }),
  doctor: one(users, {
    fields: [attenderDoctors.doctorId],
    references: [users.id],
    relationName: "doctor",
  }),
  clinic: one(clinics, {
    fields: [attenderDoctors.clinicId],
    references: [clinics.id],
  }),
}));

export const doctorDetailsRelations = relations(doctorDetails, ({ one }) => ({
  doctor: one(users, {
    fields: [doctorDetails.doctorId],
    references: [users.id],
  }),
}));

export const doctorClinicsRelations = relations(doctorClinics, ({ one }) => ({
  doctor: one(users, {
    fields: [doctorClinics.doctorId],
    references: [users.id],
  }),
  clinic: one(clinics, {
    fields: [doctorClinics.clinicId],
    references: [clinics.id],
  }),
}));

export const doctorDailyPresenceRelations = relations(doctorDailyPresence, ({ one }) => ({
  doctor: one(users, {
    fields: [doctorDailyPresence.doctorId],
    references: [users.id],
  }),
  clinic: one(clinics, {
    fields: [doctorDailyPresence.clinicId],
    references: [clinics.id],
  }),
  schedule: one(doctorSchedules, {
    fields: [doctorDailyPresence.scheduleId],
    references: [doctorSchedules.id],
  }),
}));

export const doctorSchedulesRelations = relations(doctorSchedules, ({ one, many }) => ({
  doctor: one(users, {
    fields: [doctorSchedules.doctorId],
    references: [users.id],
    relationName: "doctor",
  }),
  clinic: one(clinics, {
    fields: [doctorSchedules.clinicId],
    references: [clinics.id],
  }),
  createdByUser: one(users, {
    fields: [doctorSchedules.createdBy],
    references: [users.id],
    relationName: "creator",
  }),
  favorites: many(patientFavorites),
}));

export const patientFavoritesRelations = relations(patientFavorites, ({ one }) => ({
  patient: one(users, {
    fields: [patientFavorites.patientId],
    references: [users.id],
    relationName: "patient",
  }),
  doctor: one(users, {
    fields: [patientFavorites.doctorId],
    references: [users.id],
    relationName: "doctor",
  }),
  schedule: one(doctorSchedules, {
    fields: [patientFavorites.scheduleId],
    references: [doctorSchedules.id],
  }),
  clinic: one(clinics, {
    fields: [patientFavorites.clinicId],
    references: [clinics.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
  appointment: one(appointments, {
    fields: [notifications.appointmentId],
    references: [appointments.id],
  }),
}));

// Wallet Relations
export const patientWalletsRelations = relations(patientWallets, ({ one, many }) => ({
  patient: one(users, {
    fields: [patientWallets.patientId],
    references: [users.id],
  }),
  transactions: many(walletTransactions),
}));

export const walletTransactionsRelations = relations(walletTransactions, ({ one }) => ({
  wallet: one(patientWallets, {
    fields: [walletTransactions.walletId],
    references: [patientWallets.id],
  }),
  patient: one(users, {
    fields: [walletTransactions.patientId],
    references: [users.id],
  }),
  appointment: one(appointments, {
    fields: [walletTransactions.appointmentId],
    references: [appointments.id],
  }),
  schedule: one(doctorSchedules, {
    fields: [walletTransactions.scheduleId],
    references: [doctorSchedules.id],
  }),
  processedByUser: one(users, {
    fields: [walletTransactions.processedBy],
    references: [users.id],
  }),
}));

export const appointmentRefundsRelations = relations(appointmentRefunds, ({ one }) => ({
  appointment: one(appointments, {
    fields: [appointmentRefunds.appointmentId],
    references: [appointments.id],
  }),
  patient: one(users, {
    fields: [appointmentRefunds.patientId],
    references: [users.id],
  }),
  schedule: one(doctorSchedules, {
    fields: [appointmentRefunds.scheduleId],
    references: [doctorSchedules.id],
  }),
  doctor: one(users, {
    fields: [appointmentRefunds.doctorId],
    references: [users.id],
  }),
  clinic: one(clinics, {
    fields: [appointmentRefunds.clinicId],
    references: [clinics.id],
  }),
  walletTransaction: one(walletTransactions, {
    fields: [appointmentRefunds.walletTransactionId],
    references: [walletTransactions.id],
  }),
  processedByUser: one(users, {
    fields: [appointmentRefunds.processedBy],
    references: [users.id],
  }),
}));

export const insertUserSchema = createInsertSchema(users);
export const insertClinicSchema = createInsertSchema(clinics);
export const insertAppointmentSchema = createInsertSchema(appointments);
export const insertDoctorAvailabilitySchema = createInsertSchema(doctorDailyPresence);
export const insertAttenderDoctorSchema = createInsertSchema(attenderDoctors);
export const insertDoctorDetailSchema = createInsertSchema(doctorDetails);
export const insertDoctorScheduleSchema = createInsertSchema(doctorSchedules, {
  date: z.date(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  maxTokens: z.number().min(1).default(20),
  isActive: z.boolean().default(true),
  isVisible: z.boolean().default(false),
  scheduleStatus: z.enum(['active', 'completed']).default('active'),
  bookingStatus: z.enum(['open', 'closed']).default('open'),
});

export const insertPatientFavoriteSchema = createInsertSchema(patientFavorites);
export const insertNotificationSchema = createInsertSchema(notifications);
export const insertOtpVerificationSchema = createInsertSchema(otpVerifications);
export const insertAdminConfigurationSchema = createInsertSchema(adminConfigurations);

// Wallet Schema Validations
export const insertPatientWalletSchema = createInsertSchema(patientWallets);
export const insertWalletTransactionSchema = createInsertSchema(walletTransactions, {
  amount: z.number().positive(),
  transactionType: z.enum(walletTransactionTypes),
});
export const insertAppointmentRefundSchema = createInsertSchema(appointmentRefunds, {
  originalAmount: z.number().positive(),
  refundAmount: z.number().min(0),
  refundType: z.enum(['full', 'partial', 'none']),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Clinic = typeof clinics.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type AttenderDoctor = typeof attenderDoctors.$inferSelect;
export type DoctorAvailability = typeof doctorDailyPresence.$inferSelect;
export type DoctorDetail = typeof doctorDetails.$inferSelect;
export type DoctorSchedule = typeof doctorSchedules.$inferSelect;
export type InsertDoctorSchedule = z.infer<typeof insertDoctorScheduleSchema>;
export type PatientFavorite = typeof patientFavorites.$inferSelect;
export type InsertPatientFavorite = z.infer<typeof insertPatientFavoriteSchema>;
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type OtpVerification = typeof otpVerifications.$inferSelect;
export type InsertOtpVerification = z.infer<typeof insertOtpVerificationSchema>;
export type AdminConfiguration = typeof adminConfigurations.$inferSelect;
export type InsertAdminConfiguration = z.infer<typeof insertAdminConfigurationSchema>;

// Wallet Types
export type PatientWallet = typeof patientWallets.$inferSelect;
export type InsertPatientWallet = z.infer<typeof insertPatientWalletSchema>;
export type WalletTransaction = typeof walletTransactions.$inferSelect;
export type InsertWalletTransaction = z.infer<typeof insertWalletTransactionSchema>;
export type AppointmentRefund = typeof appointmentRefunds.$inferSelect;
export type InsertAppointmentRefund = z.infer<typeof insertAppointmentRefundSchema>;

export type TokenReservation = typeof tokenReservations.$inferSelect;
export type InsertTokenReservation = typeof tokenReservations.$inferInsert;

// Payment Types
export type Payment = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;

export const specialties = [
  "Cardiologist",
  "Dermatologist",
  "Endocrinologist",
  "Gastroenterologist",
  "Neurologist",
  "Obstetrician",
  "Ophthalmologist",
  "Orthopedic Surgeon",
  "Pediatrician",
  "Psychiatrist",
  "Urologist",
  "General Practitioner",
  "Dentist",
  "ENT Specialist",
  "Pulmonologist",
  "Rheumatologist",
  "Oncologist",
  "Nephrologist",
  "Gynecologist",
  "Allergist",
] as const;