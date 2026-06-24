import express, { Express } from 'express';
import { createServer, Server } from 'http';
import cors from 'cors';
import { storage, getTokens } from './storage';
import { createSessionMiddleware, setupAuth } from './auth';
import { insertAppointmentSchema, insertAttenderDoctorSchema, insertClinicSchema, insertUserSchema, type AttenderDoctor, type User } from "../shared/schema";
import { insertDoctorDetailSchema, appointments, doctorSchedules, deviceTokens } from "../shared/schema";
import { z } from "zod";
import { notificationService } from './services/notification';
import { ETAService } from './services/eta';
import { walletService } from './services/wallet';
import { db } from './db';
import { eq, and, sql, isNull, not, gte } from 'drizzle-orm';
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}


// Simple in-memory notification store as fallback
const memoryNotifications: any[] = [];

// Helper function to add notification to memory store
function addMemoryNotification(userId: number, title: string, message: string, type: string = 'schedule_activated') {
  const notification = {
    id: Date.now() + Math.random(), // Simple unique ID
    user_id: userId,
    appointment_id: 0,
    title,
    message,
    type,
    is_read: false,
    created_at: new Date().toISOString()
  };
  memoryNotifications.push(notification);
  
  // Keep only last 50 notifications per user to avoid memory issues
  const userNotifications = memoryNotifications.filter(n => n.user_id === userId);
  if (userNotifications.length > 50) {
    const toRemove = userNotifications.slice(0, userNotifications.length - 50);
    toRemove.forEach(n => {
      const index = memoryNotifications.findIndex(mn => mn.id === n.id);
      if (index > -1) memoryNotifications.splice(index, 1);
    });
  }
  
  console.log(`Added memory notification for user ${userId}: ${title}`);
  return notification;
}

export async function registerRoutes(app: Express): Promise<Server> {
  setupAuth(app);

  app.get("/api/doctors", async (req, res) => {
    const { lat, lng, radius, specialty } = req.query;

    try {
      let doctors;
      if (lat && lng) {
        doctors = await storage.getDoctorsNearLocation(
          parseFloat(lat as string),
          parseFloat(lng as string),
          radius ? parseFloat(radius as string) : undefined
        );
      } else if (specialty) {
        doctors = await storage.getDoctorsBySpecialty(specialty as string);
      } else {
        doctors = await storage.getDoctors();
      }
      res.json(doctors);
    } catch (error) {
      console.error('Error fetching doctors:', error);
      res.status(500).json({ message: 'Failed to fetch doctors' });
    }
  });

  // Distinct specialties of existing doctors (for the search filter dropdown)
  app.get("/api/specialties", async (_req, res) => {
    try {
      const specialties = await storage.getDoctorSpecialties();
      res.json(specialties);
    } catch (error) {
      console.error('Error fetching specialties:', error);
      res.status(500).json({ message: 'Failed to fetch specialties' });
    }
  });

  // Get nearby clinics within specified radius (0-10km)
  app.get("/api/clinics/nearby", async (req, res) => {
    const { lat, lng, radius } = req.query;

    try {
      if (!lat || !lng) {
        return res.status(400).json({ 
          success: false,
          message: 'Latitude and longitude are required',
          example: '/api/clinics/nearby?lat=13.1194&lng=80.1625&radius=10'
        });
      }

      const latitude = parseFloat(lat as string);
      const longitude = parseFloat(lng as string);
      const radiusInKm = radius ? parseFloat(radius as string) : 10;

      // Enhanced validation
      if (isNaN(latitude) || isNaN(longitude) || isNaN(radiusInKm)) {
        console.error('Parsing error - lat:', lat, 'lng:', lng, 'radius:', radius);
        return res.status(400).json({ 
          success: false,
          message: 'Invalid latitude, longitude, or radius values',
          received: { lat, lng, radius },
          parsed: { latitude, longitude, radiusInKm }
        });
      }

      // Validate reasonable ranges
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || radiusInKm < 0 || radiusInKm > 100) {
        return res.status(400).json({ 
          success: false,
          message: 'Values out of valid range',
          constraints: 'Latitude: -90 to 90, Longitude: -180 to 180, Radius: 0 to 100km'
        });
      }

      console.log(`🔍 Searching for clinics near ${latitude}, ${longitude} within ${radiusInKm}km`);
      const clinics = await storage.getClinicsNearLocation(latitude, longitude, radiusInKm);
      
      res.json({
        success: true,
        count: clinics.length,
        location: { latitude, longitude, radius: radiusInKm },
        clinics
      });
    } catch (error) {
      console.error('Error fetching nearby clinics:', error);
      res.status(500).json({ 
        success: false,
        message: 'Failed to fetch nearby clinics',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Seed default system configurations (runs once on startup)
  (async () => {
    try {
      await storage.upsertConfiguration({
        configKey: 'token_reservation_timeout_seconds',
        configValue: '300',
        configType: 'number',
        description: 'How long (in seconds) a walk-in token reservation is held before it expires',
        category: 'booking',
        isEditable: true,
      });
    } catch (err) {
      console.error('Failed to seed default configurations:', err);
    }
  })();

  // Get public configurations (no authentication required)
  app.get("/api/configurations/public", async (req, res) => {
    try {
      const { category } = req.query;
      
      let configs;
      if (category) {
        configs = await storage.getConfigurationsByCategory(category as string);
      } else {
        configs = await storage.getAllConfigurations();
      }

      // Transform to simple key-value format for clients
      const configMap: Record<string, any> = {};
      configs.forEach(config => {
        let value: any = config.configValue;
        
        // Parse values based on type
        if (config.configType === 'boolean') {
          value = config.configValue === 'true';
        } else if (config.configType === 'number') {
          value = parseFloat(config.configValue);
        } else if (config.configType === 'json') {
          try {
            value = JSON.parse(config.configValue);
          } catch (e) {
            value = config.configValue;
          }
        }
        
        configMap[config.configKey] = value;
      });

      res.json({
        success: true,
        configurations: configMap
      });
    } catch (error) {
      console.error('Error fetching public configurations:', error);
      res.status(500).json({ 
        success: false,
        message: 'Failed to fetch configurations'
      });
    }
  });

  // Get all admin configurations (super admin only)
  app.get("/api/admin/configurations", async (req, res) => {
    if (!req.user || req.user.role !== 'super_admin') {
      return res.status(403).json({ message: 'Access denied. Super admin only.' });
    }

    try {
      const { category } = req.query;
      
      let configs;
      if (category) {
        configs = await storage.getConfigurationsByCategory(category as string);
      } else {
        configs = await storage.getAllConfigurations();
      }

      res.json({
        success: true,
        configurations: configs
      });
    } catch (error) {
      console.error('Error fetching admin configurations:', error);
      res.status(500).json({ 
        success: false,
        message: 'Failed to fetch configurations'
      });
    }
  });

  // Update configuration (super admin only)
  app.put("/api/admin/configurations/:key", async (req, res) => {
    if (!req.user || req.user.role !== 'super_admin') {
      return res.status(403).json({ message: 'Access denied. Super admin only.' });
    }

    try {
      const { key } = req.params;
      const { value } = req.body;

      if (value === undefined || value === null) {
        return res.status(400).json({ 
          success: false,
          message: 'Value is required'
        });
      }

      // Convert value to string for storage
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);

      const updated = await storage.updateConfiguration(key, stringValue, req.user.id);

      res.json({
        success: true,
        configuration: updated
      });
    } catch (error) {
      console.error('Error updating configuration:', error);
      res.status(500).json({ 
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update configuration'
      });
    }
  });

  // Bulk update configurations (super admin only)
  app.put("/api/admin/configurations", async (req, res) => {
    if (!req.user || req.user.role !== 'super_admin') {
      return res.status(403).json({ message: 'Access denied. Super admin only.' });
    }

    try {
      const { configurations } = req.body;

      if (!configurations || typeof configurations !== 'object') {
        return res.status(400).json({ 
          success: false,
          message: 'Configurations object is required'
        });
      }

      const results = [];
      for (const [key, value] of Object.entries(configurations)) {
        const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
        const updated = await storage.updateConfiguration(key, stringValue, req.user.id);
        results.push(updated);
      }

      res.json({
        success: true,
        updated: results.length,
        configurations: results
      });
    } catch (error) {
      console.error('Error bulk updating configurations:', error);
      res.status(500).json({ 
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update configurations'
      });
    }
  });

  app.get("/api/doctors/:id", async (req, res) => {
    try {
      const doctorId = parseInt(req.params.id);
      if (isNaN(doctorId)) {
        return res.status(400).json({ message: 'Invalid doctor id' });
      }
      const doctor = await storage.getDoctorWithClinic(doctorId);
      if (!doctor || doctor.role !== 'doctor') {
        return res.status(404).json({ message: 'Doctor not found' });
      }
      res.json(doctor);
    } catch (error) {
      console.error('Error fetching doctor:', error);
      res.status(500).json({ message: 'Failed to fetch doctor' });
    }
  });
  
  app.get("/api/doctors/:id/clinics", async (req, res) => {
    try {
      const doctorId = parseInt(req.params.id);
      const clinics = await storage.getDoctorClinics(doctorId);
      res.json(clinics);
    } catch (error) {
      console.error('Error fetching doctor clinics:', error);
      res.status(500).json({ message: 'Failed to fetch doctor clinics' });
    }
  });
  
  app.get("/api/clinics/:id/doctors", async (req, res) => {
    try {
      const clinicId = parseInt(req.params.id);
      const doctors = await storage.getDoctorsByClinic(clinicId);
      res.json(doctors);
    } catch (error) {
      console.error('Error fetching clinic doctors:', error);
      res.status(500).json({ message: 'Failed to fetch clinic doctors' });
    }
  });

  // Enhanced search endpoints for patients
  app.get("/api/search", async (req, res) => {
    try {
      const { q: query, type = 'all', lat, lng } = req.query;
      
      if (!query || typeof query !== 'string') {
        return res.status(400).json({ message: 'Search query is required' });
      }

      const validTypes = ['all', 'city', 'hospital', 'doctor', 'specialty'];
      if (!validTypes.includes(type as string)) {
        return res.status(400).json({ message: 'Invalid search type' });
      }

      // Parse user location if provided
      const userLat = lat ? parseFloat(lat as string) : undefined;
      const userLng = lng ? parseFloat(lng as string) : undefined;

      const results = await storage.performSearch(query, type as string, userLat, userLng);
      res.json(results);
    } catch (error) {
      console.error('Error performing search:', error);
      res.status(500).json({ message: 'Search failed' });
    }
  });

  // Get doctors by clinic with schedules  
  app.get("/api/clinics/:id/doctors-with-schedules", async (req, res) => {
    try {
      const clinicId = parseInt(req.params.id);
      const doctors = await storage.getDoctorsWithSchedulesByClinic(clinicId);
      res.json(doctors);
    } catch (error) {
      console.error('Error fetching clinic doctors with schedules:', error);
      res.status(500).json({ message: 'Failed to fetch doctors with schedules' });
    }
  });

  // Get doctor schedules for today
  app.get("/api/doctors/:id/schedules/today", async (req, res) => {
    try {
      const doctorId = parseInt(req.params.id);
      const { clinicId } = req.query;
      
      const schedules = await storage.getDoctorTodaySchedules(
        doctorId, 
        clinicId ? parseInt(clinicId as string) : undefined
      );
      res.json(schedules);
    } catch (error) {
      console.error('Error fetching doctor schedules:', error);
      res.status(500).json({ message: 'Failed to fetch doctor schedules' });
    }
  });

  app.post("/api/doctors", async (req, res) => {
    if (!req.user || (req.user.role !== "super_admin" && req.user.role !== "clinic_admin")) {
      return res.sendStatus(403);
    }
    try {
      const { clinicIds, ...doctorData } = req.body;
      
      // Add default phone if not provided
      const doctorDataWithDefaults = {
        ...doctorData,
        phone: doctorData.phone || '0000000000', // Default phone number if not provided
        role: "doctor"
      };
      
      const userData = insertUserSchema.parse(doctorDataWithDefaults);
      
      const doctor = await storage.createUser(userData);
      
      // Add doctor to clinics if provided
      if (clinicIds && Array.isArray(clinicIds) && clinicIds.length > 0) {
        await storage.updateDoctorClinics(doctor.id, clinicIds);
      }
      
      res.status(201).json(doctor);
    } catch (error) {
      console.error('Error creating doctor:', error);
      res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid doctor data' });
    }
  });

  app.put("/api/doctors/:id", async (req, res) => {
    if (!req.user || (req.user.role !== "super_admin" && req.user.role !== "clinic_admin")) return res.sendStatus(403);
    try {
      const doctorId = parseInt(req.params.id);
      const doctor = await storage.getUser(doctorId);
      
      if (!doctor || doctor.role !== 'doctor') {
        return res.status(404).json({ message: 'Doctor not found' });
      }
      
      const { clinicIds, ...updateData } = req.body;
      
      const updatedDoctor = await storage.updateUser(doctorId, updateData);
      
      // Update doctor clinics if provided
      if (clinicIds && Array.isArray(clinicIds)) {
        await storage.updateDoctorClinics(doctorId, clinicIds);
      }
      
      res.json(updatedDoctor);
    } catch (error) {
      console.error('Error updating doctor:', error);
      res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid doctor data' });
    }
  });

  app.delete("/api/doctors/:id", async (req, res) => {
    if (!req.user || (req.user.role !== "super_admin" && req.user.role !== "clinic_admin")) return res.sendStatus(403);
    try {
      const doctorId = parseInt(req.params.id);
      const doctor = await storage.getUser(doctorId);
      
      if (!doctor || doctor.role !== 'doctor') {
        return res.status(404).json({ message: 'Doctor not found' });
      }
      
      await storage.deleteUser(doctorId);
      res.status(200).json({ message: 'Doctor deleted successfully' });
    } catch (error) {
      console.error('Error deleting doctor:', error);
      res.status(500).json({ message: 'Failed to delete doctor' });
    }
  });

  app.get("/api/appointments", async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    try {
      // Route to specific endpoints based on user role
      if (req.user.role === "patient") {
        const appointments = await storage.getPatientAppointments(req.user.id);
        return res.json(appointments);
      } else if (req.user.role === "doctor") {
        const appointments = await storage.getAppointments(req.user.id);
        return res.json(appointments);
      } else if (req.user.role === "attender") {
        const doctorsWithAppointments = await storage.getAttenderDoctorsAppointments(req.user.id);
        return res.json(doctorsWithAppointments);
      }

      res.status(403).json({ message: 'Invalid role for appointments access' });
    } catch (error) {
      console.error('Error fetching appointments:', error);
      res.status(500).json({ message: 'Failed to fetch appointments' });
    }
  });

  // Get ETA for a specific appointment
  app.get("/api/appointments/:id/eta", async (req, res) => {
    try {
      const appointmentId = parseInt(req.params.id);
      const eta = await ETAService.getAppointmentETA(appointmentId);
      
      if (!eta) {
        return res.status(404).json({ message: 'Appointment not found' });
      }
      
      res.json(eta);
    } catch (error) {
      console.error('Error fetching appointment ETA:', error);
      res.status(500).json({ message: 'Failed to fetch appointment ETA' });
    }
  });

  // Force recalculate ETAs for a schedule (debugging/admin endpoint)
  app.post("/api/schedules/:id/recalculate-eta", async (req, res) => {
    try {
      const scheduleId = parseInt(req.params.id);
      await ETAService.recalculateAllETAs(scheduleId);
      res.json({ message: 'ETAs recalculated successfully' });
    } catch (error) {
      console.error('Error recalculating ETAs:', error);
      res.status(500).json({ message: 'Failed to recalculate ETAs' });
    }
  });

  // Force update ETAs based on current state (debugging)
  app.post("/api/schedules/:id/force-update-eta", async (req, res) => {
    try {
      const scheduleId = parseInt(req.params.id);
      await ETAService.forceUpdateETAs(scheduleId);
      res.json({ message: 'ETAs force updated successfully' });
    } catch (error) {
      console.error('Error force updating ETAs:', error);
      res.status(500).json({ message: 'Failed to force update ETAs' });
    }
  });

  app.post("/api/appointments", async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    try {
      const doctor = await storage.getUser(Number(req.body.doctorId));
      if (!doctor || doctor.role !== 'doctor') {
        return res.status(400).json({ message: 'Invalid doctor' });
      }

      // Get the appointment date
      const appointmentDate = new Date(req.body.date);
      const clinicId = req.body.clinicId;
      
      // Validate that the clinic exists and the doctor is associated with it
      if (!clinicId) {
        return res.status(400).json({ message: 'Clinic ID is required' });
      }
      
      const clinic = await storage.getClinic(clinicId);
      if (!clinic) {
        return res.status(400).json({ message: 'Invalid clinic' });
      }
      
      // Check if doctor is associated with this clinic (either through clinicId or doctor_clinics table)
      const doctorClinics = await storage.getDoctorClinics(Number(req.body.doctorId));
      const isAssociatedWithClinic = doctor.clinicId === clinicId || 
        doctorClinics.some(dc => dc.id === clinicId);
      
      if (!isAssociatedWithClinic) {
        return res.status(400).json({ message: 'Doctor is not associated with this clinic' });
      }

      // Get the specific schedule for this appointment
      const schedule = await storage.getSpecificSchedule(
        Number(req.body.doctorId),
        clinicId,
        Number(req.body.scheduleId),
        appointmentDate
      );

      if (!schedule) {
        return res.status(400).json({ message: 'Invalid or inactive schedule for this appointment' });
      }

      // Check if schedule is completed or booking is closed
      if (schedule.scheduleStatus === 'completed') {
        return res.status(400).json({
          message: 'Cannot book appointment: Schedule has been completed. The doctor has finished for this session.'
        });
      }

      if (schedule.bookingStatus === 'closed') {
        return res.status(400).json({
          message: 'Cannot book appointment: Booking is currently closed for this schedule.'
        });
      }

      // Check if current time has passed the schedule end time (for today's schedules)
      const now = new Date();
      const scheduleDate = new Date(schedule.date);
      const isToday = now.toDateString() === scheduleDate.toDateString();
      if (isToday && schedule.endTime) {
        const [endHour, endMin] = schedule.endTime.split(':').map(Number);
        const endTimeToday = new Date();
        endTimeToday.setHours(endHour, endMin, 0, 0);
        if (now > endTimeToday) {
          return res.status(400).json({
            message: `Cannot book appointment: This schedule has already ended at ${schedule.endTime}.`
          });
        }
      }

      // Get current token count for this date (includes pending walk-in reservations)
      const appointments = await storage.getAppointmentCountForDoctor(
        Number(req.body.doctorId),
        clinicId,
        schedule.id
      );

      // Check if token limit has been reached
      if (schedule.maxTokens !== null && schedule.maxTokens !== undefined && appointments >= schedule.maxTokens) {
        return res.status(400).json({
          message: `Maximum number of tokens (${schedule.maxTokens}) has been reached for this schedule`
        });
      }

      // Calculate platform fee + GST
      const platformFee = 20.00; // ₹20 platform fee
      const gstRate = 0.05; // 5% GST
      const gstAmount = platformFee * gstRate; // ₹1
      const totalAmount = platformFee + gstAmount; // ₹21 total

      // Check if patient has sufficient wallet balance
      const patientWallet = await storage.getPatientWallet(req.user.id);
      if (!patientWallet || parseFloat(patientWallet.balance) < totalAmount) {
        return res.status(400).json({ 
          message: `Insufficient wallet balance. Required: ₹${totalAmount}, Available: ₹${patientWallet?.balance || 0}` 
        });
      }

      // Validate on-behalf fields when booking for someone else
      if (req.body.isOnBehalf) {
        if (!req.body.guestName?.trim()) {
          return res.status(400).json({ message: 'Patient name is required when booking for someone else' });
        }
        if (!/^\d{10}$/.test(req.body.guestPhone?.trim() || '')) {
          return res.status(400).json({ message: 'A valid 10-digit phone number is required when booking for someone else' });
        }
      }

      const appointmentData = {
        ...req.body,
        patientId: req.user.id,
        clinicId,
        date: appointmentDate,
        tokenNumber: req.body.tokenNumber, // This can be undefined and will be generated in storage
        scheduleId: schedule.id,
        consultationFee: totalAmount, // Store total amount as consultation fee
        isPaid: true,
        paymentMethod: 'wallet',
        isRefundEligible: true,
        isOnBehalf: req.body.isOnBehalf || false,
        guestName: req.body.isOnBehalf ? req.body.guestName?.trim() : null,
        guestPhone: req.body.isOnBehalf ? req.body.guestPhone?.trim() : null,
      };

      // Create appointment and process wallet payment
      const appointment = await storage.createAppointmentWithWalletPayment(
        appointmentData, 
        platformFee, 
        gstAmount, 
        totalAmount
      );
      
      // Calculate initial ETA for the appointment
      try {
        const eta = await ETAService.calculateInitialETA(
          schedule.id,
          appointment.tokenNumber,
          appointmentDate
        );
        
        // Update appointment with ETA
        await storage.updateAppointmentETA(appointment.id, eta);
        appointment.estimatedStartTime = eta;
      } catch (etaError) {
        console.error('Error calculating initial ETA:', etaError);
      }
      
      res.status(201).json({ ...appointment, etaStage: 1 });
    } catch (error) {
      console.error('Error creating appointment:', error);
      res.status(500).json({ message: 'Failed to create appointment' });
    }
  });


  // Patient self-cancellation with automatic refund
  app.patch("/api/appointments/:id/cancel-patient", async (req, res) => {
    if (!req.user || req.user.role !== 'patient') return res.sendStatus(403);
    try {
      const appointmentId = parseInt(req.params.id);
      const { reason } = req.body;

      if (!reason?.trim()) {
        return res.status(400).json({ message: 'Cancellation reason is required' });
      }

      const appointment = await storage.getAppointment(appointmentId);
      if (!appointment) return res.status(404).json({ message: 'Appointment not found' });

      // Ensure this appointment belongs to the requesting patient
      if (appointment.patientId !== req.user.id) return res.sendStatus(403);

      // Only allow cancellation of token_started appointments
      if (appointment.status !== 'token_started') {
        return res.status(400).json({ message: `Cannot cancel appointment with status: ${appointment.status}` });
      }

      // Block cancellation once the doctor has arrived at the clinic
      const arrivalStatus = await storage.getDoctorArrivalStatus(
        appointment.doctorId,
        appointment.clinicId,
        new Date()
      );
      if (arrivalStatus?.hasArrived) {
        return res.status(400).json({ message: 'Cancellation is not allowed after the doctor has arrived at the clinic.' });
      }

      await storage.updateAppointmentStatus(appointmentId, 'cancel', reason.trim());

      // Process refund if eligible
      const refundResult = await walletService.processSingleAppointmentRefund(
        appointmentId,
        reason.trim(),
        req.user.id
      );

      // Notify patient
      try {
        await notificationService.generateStatusNotification(
          { ...appointment, status: 'cancel' },
          'cancel',
          reason.trim()
        );
      } catch (e) {
        console.error('Error sending cancellation notification:', e);
      }

      res.json({
        message: 'Appointment cancelled successfully',
        refunded: refundResult.refunded,
        refundAmount: refundResult.refundAmount,
      });
    } catch (error) {
      console.error('Error cancelling appointment:', error);
      res.status(500).json({ message: 'Failed to cancel appointment' });
    }
  });

  app.patch("/api/appointments/:id/status", async (req, res) => {
    if (!req.user || !['attender', 'clinic_admin'].includes(req.user.role)) return res.sendStatus(403);
    try {
      const appointmentId = parseInt(req.params.id);
      const { status, statusNotes } = req.body;

      const allowedStatuses = ["token_started", "in_progress", "hold", "pause", "cancel", "no_show", "completed"];
      
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ 
          error: `Invalid status. Must be one of: ${allowedStatuses.join(", ")}` 
        });
      }

      // Get current appointment status for validation
      const currentAppointment = await storage.getAppointment(appointmentId);
      if (!currentAppointment) {
        return res.status(404).json({ error: "Appointment not found" });
      }

      // Validate status transitions
      const currentStatus = currentAppointment.status;
      const validTransitions: Record<string, string[]> = {
        "token_started": ["in_progress", "hold", "cancel", "no_show"], // Doctor not arrived yet
        "scheduled": ["in_progress", "hold", "cancel", "no_show"], // Alternative initial status
        "in_progress": ["completed", "cancel"], // Appointment is happening
        "hold": ["in_progress", "cancel", "no_show"], // Patient not arrived, can start or cancel
        "cancel": [], // Terminal state
        "no_show": [], // Terminal state
        "completed": [], // Terminal state
        "expired": [] // Terminal state — walk-in reservation expired
      };

      if (!validTransitions[currentStatus]?.includes(status)) {
        console.log(`❌ Invalid transition: ${currentStatus} → ${status}`);
        console.log(`Valid transitions for ${currentStatus}:`, validTransitions[currentStatus]);
        return res.status(400).json({ 
          error: `Invalid status transition from ${currentStatus} to ${status}` 
        });
      }

      console.log(`✅ Valid transition: ${currentStatus} → ${status}`);

      // Block consultation-flow actions before the doctor has arrived at the clinic.
      // Start (in_progress), Hold and No Show are all premature until arrival.
      // Completion is implicitly gated too, since "completed" is only reachable from "in_progress".
      const preArrivalBlockedStatuses = ["in_progress", "hold", "no_show"];
      if (preArrivalBlockedStatuses.includes(status)) {
        const arrivalStatus = await storage.getDoctorArrivalStatus(
          currentAppointment.doctorId,
          currentAppointment.clinicId,
          new Date()
        );
        if (!arrivalStatus?.hasArrived) {
          console.log(`⛔ Blocked '${status}' for appointment ${appointmentId}: doctor not arrived`);
          return res.status(400).json({
            message: "Cannot perform this action before the doctor has been marked as arrived at the clinic.",
          });
        }
      }

      // Use transaction for status update and ETA calculations
      let updatedAppointment: any;
      
      try {
        // Update the appointment status
        updatedAppointment = await storage.updateAppointmentStatus(
          appointmentId, 
          status as any, 
          statusNotes
        );
        
        // Handle ETA updates based on status - within the same transaction context
        console.log(`📋 Status Update: Appointment ${appointmentId} → ${status}, scheduleId: ${updatedAppointment.scheduleId}`);
        
        if (status === "in_progress") {
          console.log(`▶️ Starting appointment ${appointmentId}`);
          await ETAService.updateETAOnAppointmentStart(appointmentId);
        } else if (status === "completed") {
          console.log(`✅ Completing appointment ${appointmentId}, scheduleId: ${updatedAppointment.scheduleId}`);
          if (updatedAppointment.scheduleId) {
            await ETAService.updateETAOnAppointmentComplete(
              updatedAppointment.scheduleId,
              appointmentId
            );
            console.log(`✅ ETA update triggered for schedule ${updatedAppointment.scheduleId}`);
          } else {
            console.log(`❌ No scheduleId found for appointment ${appointmentId}`);
          }
        } else if (status === "cancel") {
          // Auto-process refund if appointment is eligible
          const refundResult = await walletService.processSingleAppointmentRefund(
            appointmentId,
            statusNotes || 'Cancelled by attender',
            req.user!.id
          );
          if (refundResult.refunded) {
            console.log(`💰 Refund of ₹${refundResult.refundAmount} processed for appointment ${appointmentId}`);
          } else {
            console.log(`ℹ️ No refund processed for appointment ${appointmentId} (not eligible or already refunded)`);
          }
        }
      } catch (error) {
        console.error('❌ Error in status/ETA update transaction:', error);
        throw error; // This will cause the entire operation to fail
      }
      
      // Generate notification for the status change - wrapped in try/catch
      try {
        if (updatedAppointment.patientId) { // Only notify registered patients
          await notificationService.generateStatusNotification(updatedAppointment, status, statusNotes);
        }
        
        // If the appointment status is "in_progress", notify the next patients
        if (status === "in_progress") {
          await notificationService.notifyNextPatients(updatedAppointment);
        }
      } catch (notificationError) {
        // Log the error but don't fail the request
        console.error('Error sending notifications:', notificationError);
      }
      
      res.json(updatedAppointment);
    } catch (error) {
      console.error('Error updating appointment status:', error);
      
      // Provide specific error messages based on error type
      if (error instanceof Error) {
        if (error.message.includes('Invalid status transition')) {
          res.status(400).json({ message: error.message });
        } else if (error.message.includes('not found')) {
          res.status(404).json({ message: error.message });
        } else {
          res.status(500).json({ 
            message: 'Failed to update appointment status', 
            details: error.message 
          });
        }
      } else {
        res.status(500).json({ message: 'Failed to update appointment status' });
      }
    }
  });

  // Doctor specific routes
  app.get("/api/doctor/appointments", async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    if (req.user.role !== "doctor") return res.sendStatus(403);

    try {
      const appointments = await storage.getAppointments(req.user.id);
      res.json(appointments);
    } catch (error) {
      console.error('Error fetching doctor appointments:', error);
      res.status(500).json({ message: 'Failed to fetch appointments' });
    }
  });

  // Get appointments for a specific doctor by date (for token calculation)
  app.get("/api/doctors/:id/appointments", async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    
    try {
      const doctorId = parseInt(req.params.id);
      const { date, clinicId } = req.query;
      
      // Get appointments for this doctor on the specified date
      const appointments = await storage.getDoctorAppointmentsByDate(
        doctorId,
        date ? new Date(date as string) : new Date(),
        clinicId ? parseInt(clinicId as string) : undefined
      );
      
      res.json(appointments);
    } catch (error) {
      console.error('Error fetching doctor appointments by date:', error);
      res.status(500).json({ message: 'Failed to fetch appointments' });
    }
  });

  app.patch("/api/doctors/:id/availability", async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    if (req.user.role !== "doctor" && !['attender', 'clinic_admin'].includes(req.user.role)) return res.sendStatus(403);
    if (req.user.role === "doctor" && req.user.id !== parseInt(req.params.id)) return res.sendStatus(403);

    try {
      const doctorId = parseInt(req.params.id);
      const { isAvailable, date } = req.body;

      const availability = await storage.updateDoctorAvailability(
        doctorId,
        new Date(date),
        isAvailable
      );
      res.json(availability);
    } catch (error) {
      console.error('Error updating doctor availability:', error);
      res.status(500).json({ message: 'Failed to update doctor availability' });
    }
  });

  app.get("/api/doctors/availability", async (req, res) => {
    try {
      const doctorIds = (req.query.doctorIds as string || "").split(",").map(Number);
      const date = new Date();

      const availabilities = await Promise.all(
        doctorIds.map(doctorId => storage.getDoctorAvailability(doctorId, date))
      );

      res.json(availabilities.filter(Boolean));
    } catch (error) {
      console.error('Error fetching doctor availabilities:', error);
      res.status(500).json({ message: 'Failed to fetch doctor availabilities' });
    }
  });


  // Patient appointments route
  app.get("/api/patient/appointments", async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    if (req.user.role !== "patient") return res.sendStatus(403);

    try {
      const doctorId = req.query.doctorId ? Number(req.query.doctorId) : undefined;
      const appointments = await storage.getPatientAppointments(req.user.id, doctorId);
      res.json(appointments);
    } catch (error) {
      console.error('Error fetching patient appointments:', error);
      res.status(500).json({ message: 'Failed to fetch appointments' });
    }
  });

  // Attender appointments route - Single endpoint for attender appointments
  app.get("/api/attender/:id/doctors/appointments", async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    
    // Allow both attenders and clinic admins
    if (req.user.role !== "attender" && req.user.role !== "clinic_admin") {
      return res.sendStatus(403);
    }

    try {
      const userId = parseInt(req.params.id);
      
      // For clinic admins, we need to get their clinic's data differently
      if (req.user.role === "clinic_admin") {
        // Use clinic admin's clinic ID to get all doctors in the clinic
        if (!req.user.clinicId) {
          return res.status(400).json({ message: 'Clinic admin not assigned to a clinic' });
        }
        const doctorsWithAppointments = await storage.getClinicDoctorsAppointments(req.user.clinicId);
        return res.json(doctorsWithAppointments);
      } else {
        // Original attender logic
        const doctorsWithAppointments = await storage.getAttenderDoctorsAppointments(userId);
        return res.json(doctorsWithAppointments);
      }
    } catch (error) {
      console.error('Error fetching doctor appointments:', error);
      res.status(500).json({ message: 'Failed to fetch appointments' });
    }
  });

  app.get("/api/doctors/:id/availability", async (req, res) => {
    try {
      const doctorId = parseInt(req.params.id);
      const date = req.query.date ? new Date(req.query.date as string) : new Date();

      // Round date to start of day for consistency
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);

      const availability = await storage.getDoctorAvailability(doctorId, startOfDay);

      // If no availability record exists, return a default structure
      if (!availability) {
        return res.json({
          doctorId,
          date: startOfDay.toISOString(),
          isAvailable: true, // Default to true since we're not using this for slot management
          currentToken: 0
        });
      }

      res.json(availability);
    } catch (error) {
      console.error('Error fetching doctor availability:', error);
      res.status(500).json({ message: 'Failed to fetch doctor availability' });
    }
  });

  // Attender routes
  app.get("/api/attenders", async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    try {
      let attenders;
      if (req.query.clinicId) {
        attenders = await storage.getAttendersByClinic(parseInt(req.query.clinicId as string));
      } else {
        attenders = await storage.getAttendersByRole();
      }
      res.json(attenders);
    } catch (error) {
      console.error('Error fetching attenders:', error);
      res.status(500).json({ message: 'Failed to fetch attenders' });
    }
  });

  app.get("/api/attenders/:id", async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    try {
      const attender = await storage.getUser(parseInt(req.params.id));
      if (!attender || attender.role !== 'attender') {
        return res.status(404).json({ message: 'Attender not found' });
      }
      res.json(attender);
    } catch (error) {
      console.error('Error fetching attender:', error);
      res.status(500).json({ message: 'Failed to fetch attender' });
    }
  });

  app.post("/api/attenders", async (req, res) => {
    if (!req.user || (req.user.role !== "super_admin" && req.user.role !== "doctor" && req.user.role !== "clinic_admin")) {
      return res.sendStatus(403);
    }
    try {
      const userData = insertUserSchema.parse({
        ...req.body,
        role: "attender"
      });
      
      const attender = await storage.createUser(userData);
      res.status(201).json(attender);
    } catch (error) {
      console.error('Error creating attender:', error);
      res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid attender data' });
    }
  });

  app.put("/api/attenders/:id", async (req, res) => {
    if (!req.user || (req.user.role !== "super_admin" && req.user.role !== "doctor" && req.user.role !== "clinic_admin")) {
      return res.sendStatus(403);
    }
    try {
      const attenderId = parseInt(req.params.id);
      const attender = await storage.getUser(attenderId);
      
      if (!attender || attender.role !== 'attender') {
        return res.status(404).json({ message: 'Attender not found' });
      }
      
      const updatedAttender = await storage.updateUser(attenderId, req.body);
      res.json(updatedAttender);
    } catch (error) {
      console.error('Error updating attender:', error);
      res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid attender data' });
    }
  });

  app.delete("/api/attenders/:id", async (req, res) => {
    if (!req.user || (req.user.role !== "super_admin" && req.user.role !== "doctor" && req.user.role !== "clinic_admin")) {
      return res.sendStatus(403);
    }
    try {
      const attenderId = parseInt(req.params.id);
      const attender = await storage.getUser(attenderId);
      
      if (!attender || attender.role !== 'attender') {
        return res.status(404).json({ message: 'Attender not found' });
      }
      
      await storage.deleteUser(attenderId);
      res.status(200).json({ message: 'Attender deleted successfully' });
    } catch (error) {
      console.error('Error deleting attender:', error);
      res.status(500).json({ message: 'Failed to delete attender' });
    }
  });

  // Clinic routes
  app.get("/api/clinics", async (req, res) => {
    try {
      const clinics = await storage.getClinics();
      res.json(clinics);
    } catch (error) {
      console.error('Error fetching clinics:', error);
      res.status(500).json({ message: 'Failed to fetch clinics' });
    }
  });

  app.get("/api/clinics/:id", async (req, res) => {
    try {
      const clinicId = parseInt(req.params.id);
      const clinic = await storage.getClinic(clinicId);

      if (!clinic) {
        return res.status(404).json({ message: 'Clinic not found' });
      }

      // Include admin user data for super_admin (excluding password)
      if (req.user?.role === 'super_admin') {
        const admin = await storage.getClinicAdminByClinicId(clinicId);
        return res.json({ ...clinic, admin: admin || null });
      }

      res.json(clinic);
    } catch (error) {
      console.error('Error fetching clinic:', error);
      res.status(500).json({ message: 'Failed to fetch clinic' });
    }
  });

  app.post("/api/clinics", async (req, res) => {
    if (!req.user || req.user.role !== "super_admin") return res.sendStatus(403);
    try {
      const clinicData = insertClinicSchema.parse(req.body);
      const clinic = await storage.createClinic(clinicData);
      res.status(201).json(clinic);
    } catch (error) {
      console.error('Error creating clinic:', error);
      res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid clinic data' });
    }
  });

  app.put("/api/clinics/:id", async (req, res) => {
    if (!req.user || req.user.role !== "super_admin") return res.sendStatus(403);
    try {
      const clinicId = parseInt(req.params.id);
      const clinic = await storage.getClinic(clinicId);

      if (!clinic) {
        return res.status(404).json({ message: 'Clinic not found' });
      }

      const updatedClinic = await storage.updateClinic(clinicId, req.body);

      // Update admin user fields if provided
      const { adminName, adminPhone, adminEmail, adminUsername, adminPassword } = req.body;
      if (adminName || adminPhone || adminEmail || adminUsername || adminPassword) {
        const admin = await storage.getClinicAdminByClinicId(clinicId);
        if (admin) {
          const adminUpdates: Record<string, any> = {};
          if (adminName) adminUpdates.name = adminName;
          if (adminPhone) adminUpdates.phone = adminPhone;
          if (adminEmail) adminUpdates.email = adminEmail;
          if (adminUsername) adminUpdates.username = adminUsername;
          if (adminPassword) {
            const { scrypt, randomBytes } = await import('crypto');
            const { promisify } = await import('util');
            const scryptAsync = promisify(scrypt);
            const salt = randomBytes(16).toString('hex');
            const buf = (await scryptAsync(adminPassword, salt, 64)) as Buffer;
            adminUpdates.password = `${buf.toString('hex')}.${salt}`;
          }
          await storage.updateUser(admin.id, adminUpdates);
        }
      }

      const updatedAdmin = await storage.getClinicAdminByClinicId(clinicId);
      res.json({ ...updatedClinic, admin: updatedAdmin || null });
    } catch (error) {
      console.error('Error updating clinic:', error);
      res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid clinic data' });
    }
  });

  app.delete("/api/clinics/:id", async (req, res) => {
    if (!req.user || req.user.role !== "super_admin") return res.sendStatus(403);
    try {
      const clinicId = parseInt(req.params.id);
      const clinic = await storage.getClinic(clinicId);
      
      if (!clinic) {
        return res.status(404).json({ message: 'Clinic not found' });
      }
      
      await storage.deleteClinic(clinicId);
      res.status(200).json({ message: 'Clinic deleted successfully' });
    } catch (error) {
      console.error('Error deleting clinic:', error);
      res.status(500).json({ message: 'Failed to delete clinic' });
    }
  });

  // Create clinic with admin user
  app.post("/api/clinics/with-admin", async (req, res) => {
    if (!req.user || req.user.role !== "super_admin") return res.sendStatus(403);
    try {
      // Validate the combined data
      const {
        name, address, city, state, zipCode, phone, email, openingHours, description, imageUrl,
        latitude, longitude,
        adminUsername, adminPassword, adminName, adminPhone, adminEmail
      } = req.body;

      // Validate required fields
      if (!name || !address || !city || !state || !zipCode || !phone || !email || !openingHours) {
        return res.status(400).json({ message: 'Missing required clinic fields' });
      }
      
      if (!adminUsername || !adminPassword || !adminName || !adminPhone || !adminEmail) {
        return res.status(400).json({ message: 'Missing required admin fields' });
      }

      // Create clinic first
      const clinicData = {
        name, address, city, state, zipCode, phone, email, openingHours, description, imageUrl,
        latitude: latitude || null,
        longitude: longitude || null
      };
      
      const clinic = await storage.createClinic(clinicData);

      // Hash the admin password before creating the user
      const hashedPassword = await hashPassword(adminPassword);

      // Create admin user for this clinic
      const adminData = {
        username: adminUsername,
        password: hashedPassword,
        name: adminName,
        phone: adminPhone,
        email: adminEmail,
        role: "clinic_admin" as const,
        clinicId: clinic.id,
        mustChangePassword: true
      };

      const admin = await storage.createUser(adminData);

      res.status(201).json({ 
        clinic, 
        admin: { 
          id: admin.id, 
          username: admin.username, 
          name: admin.name, 
          email: admin.email, 
          phone: admin.phone 
        }
      });
    } catch (error) {
      console.error('Error creating clinic with admin:', error);
      res.status(400).json({ message: error instanceof Error ? error.message : 'Failed to create clinic and admin' });
    }
  });

  // Clinic Admin management routes
  app.get("/api/clinic-admins", async (req, res) => {
    if (!req.user || req.user.role !== "super_admin") return res.sendStatus(403);
    try {
      const clinicAdmins = await storage.getClinicAdmins();
      res.json(clinicAdmins);
    } catch (error) {
      console.error('Error fetching clinic admins:', error);
      res.status(500).json({ message: 'Failed to fetch clinic admins' });
    }
  });

  app.post("/api/clinic-admins", async (req, res) => {
    if (!req.user || req.user.role !== "super_admin") return res.sendStatus(403);
    try {
      const { clinicId, password, ...userData } = req.body;
      
      // Validate clinic exists
      const clinic = await storage.getClinic(clinicId);
      if (!clinic) {
        return res.status(400).json({ message: 'Invalid clinic' });
      }
      
      // Check if username already exists
      const existingUser = await storage.getUserByUsername(userData.username);
      if (existingUser) {
        return res.status(400).json({ message: 'Username already exists' });
      }
      
      // Hash the password
      const hashedPassword = await hashPassword(password);
      
      // Add default values and set role
      const clinicAdminData = {
        ...userData,
        password: hashedPassword,
        role: "clinic_admin",
        clinicId: clinicId,
        email: userData.email || `${userData.username}@clinicflow.com`
      };
      
      const adminData = insertUserSchema.parse(clinicAdminData);
      const clinicAdmin = await storage.createUser(adminData);
      
      // Fetch the admin with clinic info
      const adminWithClinic = await storage.getUserWithClinic(clinicAdmin.id);
      res.status(201).json(adminWithClinic);
    } catch (error) {
      console.error('Error creating clinic admin:', error);
      res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid clinic admin data' });
    }
  });

  app.put("/api/clinic-admins/:id", async (req, res) => {
    if (!req.user || req.user.role !== "super_admin") return res.sendStatus(403);
    try {
      const adminId = parseInt(req.params.id);
      const admin = await storage.getUser(adminId);
      
      if (!admin || admin.role !== 'clinic_admin') {
        return res.status(404).json({ message: 'Clinic admin not found' });
      }
      
      const { clinicId, ...updateData } = req.body;
      
      // If clinic is being changed, validate it exists
      if (clinicId !== undefined) {
        const clinic = await storage.getClinic(clinicId);
        if (!clinic) {
          return res.status(400).json({ message: 'Invalid clinic' });
        }
      }
      
      const updatedData = {
        ...updateData,
        clinicId: clinicId !== undefined ? clinicId : admin.clinicId
      };
      
      const updatedAdmin = await storage.updateUser(adminId, updatedData);
      const adminWithClinic = await storage.getUserWithClinic(updatedAdmin.id);
      res.json(adminWithClinic);
    } catch (error) {
      console.error('Error updating clinic admin:', error);
      res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid update data' });
    }
  });

  app.delete("/api/clinic-admins/:id", async (req, res) => {
    if (!req.user || req.user.role !== "super_admin") return res.sendStatus(403);
    try {
      const adminId = parseInt(req.params.id);
      const admin = await storage.getUser(adminId);
      
      if (!admin || admin.role !== 'clinic_admin') {
        return res.status(404).json({ message: 'Clinic admin not found' });
      }
      
      await storage.deleteUser(adminId);
      res.status(200).json({ message: 'Clinic admin deleted successfully' });
    } catch (error) {
      console.error('Error deleting clinic admin:', error);
      res.status(500).json({ message: 'Failed to delete clinic admin' });
    }
  });

  // Super Admin Dashboard Metrics endpoint
  app.get("/api/super-admin/dashboard-metrics", async (req, res) => {
    if (!req.user || req.user.role !== "super_admin") return res.sendStatus(403);
    try {
      const metrics = await storage.getSuperAdminDashboardMetrics();
      res.json(metrics);
    } catch (error) {
      console.error('Error fetching super admin dashboard metrics:', error);
      res.status(500).json({ message: 'Failed to fetch dashboard metrics' });
    }
  });

  // Token progress endpoint for patients to check their position in queue
  app.get("/api/doctors/:id/token-progress", async (req, res) => {
    try {
      const doctorId = parseInt(req.params.id);
      const { clinicId } = req.query;
      
      if (!clinicId) {
        return res.status(400).json({ message: 'clinicId is required' });
      }
      
      const progress = await storage.getCurrentTokenProgress(
        doctorId, 
        parseInt(clinicId as string), 
        new Date()
      );
      
      // Get the current date
      const today = new Date();
      const startOfDay = new Date(today);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(today);
      endOfDay.setHours(23, 59, 59, 999);
      
      // Count walk-in patients ahead for registered patients
      let walkInPatients = 0;
      
      if (req.user && req.user.role === "patient") {
        // Get the patient's appointment
        const patientAppointments = await storage.getPatientAppointments(req.user.id);
        const todayAppointment = patientAppointments.find(apt => 
          apt.doctorId === doctorId && 
          apt.clinicId === parseInt(clinicId as string) &&
          new Date(apt.date) >= startOfDay &&
          new Date(apt.date) <= endOfDay
        );
        
        if (todayAppointment) {
          // Count walk-in patients with token numbers between current token and patient's token
          walkInPatients = await storage.countWalkInPatientsAhead(
            doctorId,
            parseInt(clinicId as string),
            progress.currentToken,
            todayAppointment.tokenNumber
          );
        }
      }
      
      // Add walk-in count to the response
      res.json({
        ...progress,
        walkInPatients
      });
    } catch (error) {
      console.error('Error fetching token progress:', error);
      res.status(500).json({ message: 'Failed to fetch token progress' });
    }
  });

  // Update token progress (Attender only)
  app.patch("/api/doctors/:id/token-progress", async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    if (!['attender', 'clinic_admin'].includes(req.user.role)) return res.sendStatus(403);

    try {
      const doctorId = parseInt(req.params.id);
      const { currentToken, clinicId, date } = req.body;

      // Validate that this attender can manage this doctor
      const attenderDoctors = await storage.getAttenderDoctors(req.user.id);
      const canManageDoctor = attenderDoctors.some((ad: AttenderDoctor & { doctor: User }) => ad.doctor.id === doctorId);
      
      if (!canManageDoctor) {
        return res.status(403).json({ message: 'Not authorized to manage this doctor' });
      }

      // This endpoint is deprecated - token progress is now calculated from appointments
      res.status(410).json({ 
        message: 'This endpoint is deprecated. Token progress is now calculated from appointments.',
        info: 'Use the GET /api/doctors/:id/token-progress endpoint to get the current token progress.'
      });
    } catch (error) {
      console.error('Error updating token progress:', error);
      res.status(500).json({ message: 'Failed to update token progress' });
    }
  });

  // Doctor management routes
  app.post("/api/doctors", async (req, res) => {
    try {
      // Check if user is authorized (must be hospital_admin, attender, or clinic_admin)
      if (!req.user || (req.user.role !== "hospital_admin" && req.user.role !== "attender" && req.user.role !== "clinic_admin")) {
        return res.status(403).json({ message: "Unauthorized" });
      }

      // Validate request body
      const doctorSchema = z.object({
        user: z.object({
          name: z.string(),
          username: z.string(),
          password: z.string(),
          specialty: z.string(),
          bio: z.string().optional(),
          imageUrl: z.string().optional(),
          address: z.string().optional(),
          city: z.string().optional(),
          state: z.string().optional(),
          zipCode: z.string().optional(),
          latitude: z.string().optional(),
          longitude: z.string().optional(),
          clinicId: z.number(),
        }),
        details: z.object({
          consultationFee: z.number().or(z.string().transform(val => parseFloat(val))),
          consultationDuration: z.number().or(z.string().transform(val => parseInt(val))),
          qualifications: z.string().optional(),
          experience: z.number().optional().or(z.string().transform(val => parseInt(val))),
          registrationNumber: z.string().optional(),
          isEnabled: z.boolean().optional(),
        }),
      });

      const validatedData = doctorSchema.parse(req.body);

      // Create the doctor with role explicitly set
      const doctor = await storage.createDoctor(
        {
          name: validatedData.user.name,
          username: validatedData.user.username,
          password: validatedData.user.password,
          specialty: validatedData.user.specialty,
          bio: validatedData.user.bio,
          imageUrl: validatedData.user.imageUrl,
          address: validatedData.user.address,
          city: validatedData.user.city,
          state: validatedData.user.state,
          zipCode: validatedData.user.zipCode,
          latitude: validatedData.user.latitude,
          longitude: validatedData.user.longitude,
          clinicId: validatedData.user.clinicId,
        },
        validatedData.details
      );

      res.status(201).json(doctor);
    } catch (error) {
      console.error("Error creating doctor:", error);
      res.status(500).json({ message: "Failed to create doctor" });
    }
  });

  // Get doctor details
  app.get("/api/doctors/:id/details", async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    try {
      const doctorId = parseInt(req.params.id);
      const details = await storage.getDoctorDetails(doctorId);
      
      if (!details) {
        return res.status(404).json({ message: "Doctor details not found" });
      }
      
      res.json(details);
    } catch (error) {
      console.error("Error fetching doctor details:", error);
      res.status(500).json({ message: "Failed to fetch doctor details" });
    }
  });

  // Update doctor details
  app.patch("/api/doctors/:id/details", async (req, res) => {
    try {
      // Check if user is authorized (must be hospital_admin, attender, or clinic_admin)
      if (!req.user || (req.user.role !== "hospital_admin" && req.user.role !== "attender" && req.user.role !== "clinic_admin")) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      const doctorId = parseInt(req.params.id);
      
      // Validate request body
      const updateSchema = z.object({
        consultationFee: z.number().or(z.string().transform(val => parseFloat(val))).optional(),
        consultationDuration: z.number().optional(),
        qualifications: z.string().optional(),
        experience: z.number().optional(),
        registrationNumber: z.string().optional(),
      });
      
      const validatedData = updateSchema.parse(req.body);
      
      // Update doctor details
      const updatedDetails = await storage.updateDoctorDetails(doctorId, validatedData);
      
      res.json(updatedDetails);
    } catch (error) {
      console.error("Error updating doctor details:", error);
      res.status(500).json({ message: "Failed to update doctor details" });
    }
  });

  // Clinic admin: configure avg consultation time per doctor
  app.patch("/api/clinics/:clinicId/doctors/:doctorId/consultation-time", async (req, res) => {
    if (!req.user || req.user.role !== "clinic_admin") return res.sendStatus(403);
    try {
      const clinicId = parseInt(req.params.clinicId);
      const doctorId = parseInt(req.params.doctorId);
      const { consultationMinutes } = z.object({
        consultationMinutes: z.number().int().min(1).max(120),
      }).parse(req.body);

      await storage.updateDoctorDetails(doctorId, { consultationDuration: consultationMinutes });

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      await db
        .update(doctorSchedules)
        .set({ averageConsultationTime: consultationMinutes })
        .where(
          and(
            eq(doctorSchedules.doctorId, doctorId),
            eq(doctorSchedules.clinicId, clinicId),
            eq(doctorSchedules.isActive, true),
            gte(doctorSchedules.date, today)
          )
        );

      res.json({ success: true, consultationMinutes });
    } catch (error) {
      console.error("Error updating consultation time:", error);
      res.status(400).json({ message: error instanceof Error ? error.message : "Failed to update" });
    }
  });

  // Toggle doctor status (enable/disable)
  app.patch("/api/doctors/:id/status", async (req, res) => {
    try {
      // Check if user is authorized (must be hospital_admin, attender, or clinic_admin)
      if (!req.user || (req.user.role !== "hospital_admin" && req.user.role !== "attender" && req.user.role !== "clinic_admin")) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      const doctorId = parseInt(req.params.id);
      
      // Validate request body
      const statusSchema = z.object({
        isEnabled: z.boolean(),
      });
      
      const { isEnabled } = statusSchema.parse(req.body);
      
      // Toggle doctor status
      const updatedDetails = await storage.toggleDoctorStatus(doctorId, isEnabled);
      
      res.json(updatedDetails);
    } catch (error) {
      console.error("Error toggling doctor status:", error);
      res.status(500).json({ message: "Failed to toggle doctor status" });
    }
  });

  // Get all clinics
  app.get("/api/clinics", async (req, res) => {
    try {
      const clinics = await storage.getClinics();
      res.json(clinics);
    } catch (error) {
      console.error('Error fetching clinics:', error);
      res.status(500).json({ message: 'Failed to fetch clinics' });
    }
  });

  app.get("/api/clinics/:id", async (req, res) => {
    try {
      const clinicId = parseInt(req.params.id);
      if (isNaN(clinicId)) {
        return res.status(400).json({ message: 'Invalid clinic ID' });
      }
      const clinic = await storage.getClinic(clinicId);
      if (!clinic) {
        return res.status(404).json({ message: 'Clinic not found' });
      }
      res.json(clinic);
    } catch (error) {
      console.error('Error fetching clinic:', error);
      res.status(500).json({ message: 'Failed to fetch clinic' });
    }
  });

  // Doctor schedule routes
  app.get("/api/doctors/:id/schedules", async (req, res) => {
    try {
      const doctorId = parseInt(req.params.id);
      if (isNaN(doctorId)) {
        return res.status(400).json({ message: 'Invalid doctor ID' });
      }

      // Get the doctor's schedules
      const date = req.query.date ? new Date(req.query.date as string) : undefined;
      // For patients, only show visible schedules
      const isPatient = req.user?.role === 'patient' || !req.user;
      const schedules = await storage.getDoctorSchedules(doctorId, date, isPatient);
      
      // Filter by clinic ID if provided
      let filteredSchedules = [...schedules];
      if (req.query.clinicId !== undefined) {
        const clinicId = parseInt(req.query.clinicId as string);
        if (!isNaN(clinicId)) {
          filteredSchedules = filteredSchedules.filter(s => s.clinicId === clinicId);
        }
      }

      // Add favorite status for authenticated patients
      let schedulesWithFavorites = filteredSchedules;
      if (req.user && req.user.role === 'patient') {
        schedulesWithFavorites = await Promise.all(
          filteredSchedules.map(async (schedule) => {
            const isFavorite = await storage.checkIsFavorite(req.user!.id, schedule.id);
            return {
              ...schedule,
              isFavorite
            };
          })
        );
      } else {
        // For non-authenticated users or non-patients, add isFavorite: false
        schedulesWithFavorites = filteredSchedules.map(schedule => ({
          ...schedule,
          isFavorite: false
        }));
      }
      
      res.json(schedulesWithFavorites);
    } catch (error) {
      console.error('Error fetching doctor schedules:', error);
      res.status(500).json({ message: 'Failed to fetch doctor schedules' });
    }
  });

  // Schedule pause routes
  app.patch("/api/schedules/:id/pause", async (req, res) => {
    if (!req.user || !['hospital_admin', 'attender', 'doctor', 'clinic_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }
    try {
      const scheduleId = parseInt(req.params.id);
      const { isPaused, pauseReason, date } = req.body;

      if (isNaN(scheduleId)) {
        return res.status(400).json({ error: "Invalid request body" });
      }

      const [sched] = await db.select({ scheduleStatus: doctorSchedules.scheduleStatus }).from(doctorSchedules).where(eq(doctorSchedules.id, scheduleId)).limit(1);
      if (!sched || sched.scheduleStatus === 'completed') {
        return res.status(400).json({ error: "Cannot modify a completed schedule" });
      }

      await storage.pauseSchedule(scheduleId, pauseReason, new Date(date));

      // Get all appointments for this schedule that are scheduled or in progress
      const appointments = await storage.getAppointmentsBySchedule(scheduleId);
      const affectedAppointments = appointments.filter(apt =>
        ["token_started", "in_progress"].includes(apt.status || "")
      );

      // Update all affected appointments to paused status
      for (const appointment of affectedAppointments) {
        // Update the appointment status to "pause"
        await storage.updateAppointmentStatus(appointment.id, "pause", pauseReason || "Schedule paused");
        
        if (appointment.patientId) {
          await notificationService.createNotification({
            userId: appointment.patientId,
            appointmentId: appointment.id,
            title: "Schedule Paused",
            message: `Your appointment has been temporarily paused. Reason: ${pauseReason}`,
            type: "schedule_paused"
          });
        }
      }

      res.json({ message: "Schedule paused successfully" });
    } catch (error) {
      console.error("Error pausing schedule:", error);
      res.status(500).json({ error: "Failed to pause schedule" });
    }
  });

  app.patch("/api/schedules/:id/resume", async (req, res) => {
    if (!req.user || !['hospital_admin', 'attender', 'doctor', 'clinic_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }
    try {
      const scheduleId = parseInt(req.params.id);
      const [sched] = await db.select({ scheduleStatus: doctorSchedules.scheduleStatus }).from(doctorSchedules).where(eq(doctorSchedules.id, scheduleId)).limit(1);
      if (!sched || sched.scheduleStatus === 'completed') {
        return res.status(400).json({ error: "Cannot modify a completed schedule" });
      }
      await storage.resumeSchedule(scheduleId);

      // Get all appointments for this schedule that are in paused status
      const appointments = await storage.getAppointmentsBySchedule(scheduleId);
      const affectedAppointments = appointments.filter(apt => 
        apt.status === "pause"
      );

      // Update all paused appointments back to scheduled status
      for (const appointment of affectedAppointments) {
        // Update the appointment status back to "token_started"
        await storage.updateAppointmentStatus(appointment.id, "token_started", "Schedule resumed");
        
        if (appointment.patientId) {
          await notificationService.createNotification({
            userId: appointment.patientId,
            appointmentId: appointment.id,
            title: "Schedule Resumed",
            message: "The doctor's schedule has resumed. Your appointment will proceed as planned.",
            type: "schedule_resumed"
          });
        }
      }

      res.json({ message: "Schedule resumed successfully" });
    } catch (error) {
      console.error("Error resuming schedule:", error);
      res.status(500).json({ error: "Failed to resume schedule" });
    }
  });

  // Schedule completion endpoint
  app.patch("/api/schedules/:id/complete", async (req, res) => {
    if (!req.user || !['hospital_admin', 'attender', 'clinic_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }
    try {
      const scheduleId = parseInt(req.params.id);
      if (isNaN(scheduleId)) {
        return res.status(400).json({ error: "Invalid schedule ID" });
      }

      // Capture waiting patients BEFORE any status changes
      const allAppointments = await storage.getAppointmentsBySchedule(scheduleId);
      const waitingAppointments = allAppointments.filter(apt =>
        !['completed', 'no_show', 'cancel'].includes(apt.status || '')
      );

      // Refund paid patients first, then cancel remaining + mark complete
      try {
        const refundResult = await walletService.processScheduleCancellationRefunds(
          scheduleId,
          'Schedule completed by clinic admin',
          req.user.id
        );
        if (refundResult.refundedAppointments > 0) {
          console.log(`Refunded ${refundResult.refundedAppointments} appointments (₹${refundResult.totalRefundAmount}) on schedule completion`);
        }
      } catch (refundError) {
        console.error('Refund processing failed during schedule completion:', refundError);
      }

      await storage.completeSchedule(scheduleId);

      // Notify all patients who were still waiting
      for (const appointment of waitingAppointments) {
        if (appointment.patientId) {
          await notificationService.createNotification({
            userId: appointment.patientId,
            appointmentId: appointment.id,
            title: "Schedule Completed",
            message: "The doctor's schedule has been completed. Please contact the clinic for any rescheduling needs.",
            type: "schedule_completed"
          });
        }
      }

      res.json({ message: "Schedule marked as completed successfully" });
    } catch (error) {
      console.error("Error completing schedule:", error);
      res.status(500).json({ error: "Failed to complete schedule" });
    }
  });

  // Booking control endpoints
  app.patch("/api/schedules/:id/booking-close", async (req, res) => {
    if (!req.user || !['hospital_admin', 'attender', 'clinic_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }
    try {
      const scheduleId = parseInt(req.params.id);
      if (isNaN(scheduleId)) {
        return res.status(400).json({ error: "Invalid schedule ID" });
      }

      const [sched] = await db.select({ scheduleStatus: doctorSchedules.scheduleStatus }).from(doctorSchedules).where(eq(doctorSchedules.id, scheduleId)).limit(1);
      if (!sched || sched.scheduleStatus === 'completed') {
        return res.status(400).json({ error: "Cannot modify a completed schedule" });
      }

      await storage.closeScheduleBooking(scheduleId);
      res.json({ message: "Booking closed for schedule successfully" });
    } catch (error) {
      console.error("Error closing booking for schedule:", error);
      res.status(500).json({ error: "Failed to close booking for schedule" });
    }
  });

  app.patch("/api/schedules/:id/booking-open", async (req, res) => {
    if (!req.user || !['hospital_admin', 'attender', 'clinic_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }
    try {
      const scheduleId = parseInt(req.params.id);
      if (isNaN(scheduleId)) {
        return res.status(400).json({ error: "Invalid schedule ID" });
      }

      const [sched] = await db.select({ scheduleStatus: doctorSchedules.scheduleStatus }).from(doctorSchedules).where(eq(doctorSchedules.id, scheduleId)).limit(1);
      if (!sched || sched.scheduleStatus === 'completed') {
        return res.status(400).json({ error: "Cannot modify a completed schedule" });
      }

      await storage.openScheduleBooking(scheduleId);
      res.json({ message: "Booking opened for schedule successfully" });
    } catch (error) {
      console.error("Error opening booking for schedule:", error);
      res.status(500).json({ error: "Failed to open booking for schedule" });
    }
  });

  app.post("/api/doctors/:id/schedules", async (req, res) => {
    if (!req.user || !['hospital_admin', 'attender', 'clinic_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }

    try {
      const doctorId = parseInt(req.params.id);
      if (isNaN(doctorId)) {
        return res.status(400).json({ message: 'Invalid doctor ID' });
      }

      // Validate the schedule data
      const scheduleSchema = z.object({
        clinicId: z.number(),
        date: z.string().transform(str => new Date(str)), // Accept ISO date string
        startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
        endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
        isActive: z.boolean().optional().default(true),
        isVisible: z.boolean().optional().default(false),
        maxTokens: z.number().min(1).default(20),
      });

      const validData = scheduleSchema.parse(req.body);

      // Check if the doctor exists
      const doctor = await storage.getUser(doctorId);
      if (!doctor || doctor.role !== 'doctor') {
        return res.status(404).json({ message: 'Doctor not found' });
      }

      // Check for overlapping schedules on the same date
      const existingSchedules = await storage.getDoctorSchedules(doctorId);
      const overlappingSchedule = existingSchedules.find(schedule => {
        const scheduleDate = new Date(schedule.date);
        const newDate = new Date(validData.date);
        
        // Check if dates match
        if (scheduleDate.toDateString() !== newDate.toDateString()) {
          return false;
        }

        // Convert times to minutes for easier comparison
        const getMinutes = (time: string) => {
          const [hours, minutes] = time.split(':').map(Number);
          return hours * 60 + minutes;
        };

        const existingStart = getMinutes(schedule.startTime);
        const existingEnd = getMinutes(schedule.endTime);
        const newStart = getMinutes(validData.startTime);
        const newEnd = getMinutes(validData.endTime);

        // Check for overlap
        return (
          (newStart >= existingStart && newStart < existingEnd) || // New start time falls within existing schedule
          (newEnd > existingStart && newEnd <= existingEnd) || // New end time falls within existing schedule
          (newStart <= existingStart && newEnd >= existingEnd) // New schedule completely encompasses existing schedule
        );
      });

      if (overlappingSchedule) {
        return res.status(400).json({ 
          message: 'Schedule overlaps with an existing schedule for this date' 
        });
      }

      // Create the schedule with proper creator tracking
      const schedule = await storage.createDoctorSchedule({
        doctorId,
        ...validData,
        createdBy: req.user.id, // Now properly tracking who created the schedule
      });

      // If schedule is created as active, notify patients who might have favorited this doctor
      if (validData.isActive !== false) { // Default is true, so trigger unless explicitly false
        console.log(`New active schedule ${schedule.id} created, triggering notifications`);
        try {
          await notificationService.notifyScheduleActivated(schedule.id);
        } catch (notificationError) {
          console.error('Error sending schedule activation notifications:', notificationError);
          // Don't fail the request if notification fails
        }
      }

      res.status(201).json(schedule);
    } catch (error) {
      console.error('Error creating doctor schedule:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid schedule data', errors: error.errors });
      }
      res.status(500).json({ message: 'Failed to create doctor schedule' });
    }
  });

  app.patch("/api/doctors/schedules/:id", async (req, res) => {
    if (!req.user || !['hospital_admin', 'attender', 'clinic_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }

    try {
      const scheduleId = parseInt(req.params.id);
      if (isNaN(scheduleId)) {
        return res.status(400).json({ message: 'Invalid schedule ID' });
      }

      // Validate the update data
      const updateSchema = z.object({
        date: z.string().transform(str => {
          const date = new Date(str);
          // Convert to date-only string for PostgreSQL date type
          return date.toISOString().split('T')[0];
        }).optional(),
        startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
        endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
        isActive: z.boolean().optional(),
        isVisible: z.boolean().optional(),
        maxTokens: z.number().min(1).optional(),
      });

      const validData = updateSchema.parse(req.body);

      // Get the current schedule state before update to check if it's being activated
      const currentSchedule = await storage.getDoctorSchedule(scheduleId);
      if (!currentSchedule) {
        return res.status(404).json({ message: 'Schedule not found' });
      }

      // Clear cancelReason when re-activating a cancelled schedule
      const updateData: any = { ...validData };
      if (validData.isActive === true && currentSchedule.cancelReason) {
        updateData.cancelReason = null;
      }

      // Update the schedule
      const schedule = await storage.updateDoctorSchedule(scheduleId, updateData);
      if (!schedule) {
        return res.status(404).json({ message: 'Schedule not found' });
      }

      // Check if schedule was just activated (was inactive, now active)
      if (validData.isActive === true && !currentSchedule.isActive) {
        console.log(`Schedule ${scheduleId} was activated, triggering notifications`);
        try {
          await notificationService.notifyScheduleActivated(scheduleId);
        } catch (notificationError) {
          console.error('Error sending database notifications, using fallback:', notificationError);
          
          // Fallback: Create in-memory notifications for patients who favorited this schedule
          try {
            const patientFavorites = await storage.getPatientsFavoritingSchedule(scheduleId);
            const scheduleDetails = await storage.getDoctorSchedule(scheduleId);
            
            if (scheduleDetails && patientFavorites.length > 0) {
              const doctorInfo = await storage.getUserById(scheduleDetails.doctorId);
              const clinicInfo = await storage.getClinicById(scheduleDetails.clinicId);
              
              patientFavorites.forEach(patientId => {
                addMemoryNotification(
                  patientId,
                  '🌟 Favorited Schedule is Now Active!',
                  `Booking is now open for Dr. ${doctorInfo?.name || 'Unknown'} at ${clinicInfo?.name || 'Unknown Clinic'}. Book your appointment now!`,
                  'schedule_activated'
                );
              });
              
              console.log(`Created ${patientFavorites.length} memory notifications for schedule activation`);
            }
          } catch (fallbackError) {
            console.error('Error creating fallback notifications:', fallbackError);
          }
        }
      }

      res.json(schedule);
    } catch (error) {
      console.error('Error updating doctor schedule:', error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid update data', errors: error.errors });
      }
      res.status(500).json({ message: 'Failed to update doctor schedule' });
    }
  });

  app.delete("/api/doctors/schedules/:id", async (req, res) => {
    if (!req.user || !['hospital_admin', 'attender', 'clinic_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }

    try {
      const scheduleId = parseInt(req.params.id);
      if (isNaN(scheduleId)) {
        return res.status(400).json({ message: 'Invalid schedule ID' });
      }

      // Process refunds BEFORE deleting — once deleted, scheduleId is nulled on appointments
      try {
        const refundResult = await walletService.processScheduleCancellationRefunds(
          scheduleId,
          'Schedule was deleted by clinic admin',
          req.user.id
        );
        if (refundResult.refundedAppointments > 0) {
          console.log(`Refunded ${refundResult.refundedAppointments} appointments (₹${refundResult.totalRefundAmount}) for deleted schedule ${scheduleId}`);
        }
      } catch (refundError) {
        console.error('Refund processing failed during schedule deletion:', refundError);
        // Continue with deletion even if refunds fail
      }

      const result = await storage.deleteDoctorSchedule(scheduleId);

      // Send notifications to patients about cancelled appointments
      if (result.cancelledAppointments.length > 0) {
        console.log(`Sending notifications for ${result.cancelledAppointments.length} cancelled appointments`);
        
        for (const appointment of result.cancelledAppointments) {
          if (appointment.patientId) {
            try {
              await notificationService.generateStatusNotification(
                appointment, 
                'cancel', 
                'Schedule was deleted by clinic admin'
              );
            } catch (notificationError) {
              console.error('Error sending notification for cancelled appointment:', notificationError);
              // Continue even if notification fails
            }
          }
        }
      }
      
      res.status(200).json({ 
        message: 'Schedule deleted successfully',
        cancelledAppointments: result.cancelledAppointments.length
      });
    } catch (error) {
      console.error('Error deleting doctor schedule:', error);
      res.status(500).json({ message: 'Failed to delete doctor schedule' });
    }
  });

  // Get available doctors by clinic and time
  app.get("/api/clinics/:clinicId/available-doctors", async (req, res) => {
    try {
      const clinicId = parseInt(req.params.clinicId);
      const { date, time } = req.query;
      
      if (isNaN(clinicId)) {
        return res.status(400).json({ message: 'Invalid clinic ID' });
      }
      
      if (!date || typeof date !== 'string' || !time || typeof time !== 'string') {
        return res.status(400).json({ message: 'Date and time parameters are required' });
      }
      
      const scheduleDate = new Date(date);
      if (isNaN(scheduleDate.getTime())) {
        return res.status(400).json({ message: 'Invalid date format' });
      }
      
      if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) {
        return res.status(400).json({ message: 'Time must be in format HH:MM in 24-hour format' });
      }
      
      const doctors = await storage.getAvailableDoctors(clinicId, scheduleDate, time);
      res.json(doctors);
    } catch (error) {
      console.error('Error fetching available doctors:', error);
      res.status(500).json({ message: 'Failed to fetch available doctors' });
    }
  });

  // Get schedules by clinic
  app.get("/api/clinics/:clinicId/schedules", async (req, res) => {
    try {
      const clinicId = parseInt(req.params.clinicId);
      if (isNaN(clinicId)) {
        return res.status(400).json({ message: 'Invalid clinic ID' });
      }

      const schedules = await storage.getDoctorSchedulesByClinic(clinicId);
      res.json(schedules);
    } catch (error) {
      console.error('Error fetching clinic schedules:', error);
      res.status(500).json({ message: 'Failed to fetch clinic schedules' });
    }
  });

  // Get available time slots for a doctor on a specific date
  app.get("/api/doctors/:id/available-slots", async (req, res) => {
    try {
      const doctorId = parseInt(req.params.id);
      console.log('Fetching available slots for doctor:', doctorId);
      
      if (isNaN(doctorId)) {
        console.log('Invalid doctor ID:', req.params.id);
        return res.status(400).json({ message: 'Invalid doctor ID' });
      }

      // Get date from query parameter or use current date
      const dateParam = req.query.date as string;
      const date = dateParam ? new Date(dateParam) : new Date();
      console.log('Using date:', date);
      
      // Validate the date
      if (isNaN(date.getTime())) {
        console.log('Invalid date format:', dateParam);
        return res.status(400).json({ message: 'Invalid date format' });
      }

      // First check if doctor exists
      const doctor = await storage.getUser(doctorId);
      if (!doctor) {
        console.log('Doctor not found:', doctorId);
        return res.status(404).json({ message: 'Doctor not found' });
      }
      if (doctor.role !== 'doctor') {
        console.log('User is not a doctor:', doctor.role);
        return res.status(400).json({ message: 'User is not a doctor' });
      }

      console.log('Fetching available time slots for doctor:', doctorId, 'on date:', date);
      const result = await storage.getDoctorAvailableTimeSlots(doctorId, date);
      console.log('Available slots result:', JSON.stringify(result, null, 2));
      res.json(result);
    } catch (error) {
      console.error('Error fetching available time slots:', error);
      res.status(500).json({ message: 'Failed to fetch available time slots' });
    }
  });

  // Add a new endpoint for doctor arrival status
  app.patch("/api/doctors/:id/arrival", async (req, res) => {
    if (!req.user || !['attender', 'clinic_admin'].includes(req.user.role)) return res.sendStatus(403);
    
    try {
      const doctorId = parseInt(req.params.id);
      const { hasArrived, clinicId, scheduleId, date } = req.body;
      
      console.log('Doctor arrival update request:', { doctorId, hasArrived, clinicId, scheduleId, date });
      
      if (hasArrived === undefined || !clinicId || !date) {
        return res.status(400).json({ 
          message: 'Missing required fields: hasArrived, clinicId, and date are required' 
        });
      }
      
      const parsedScheduleId = scheduleId ? parseInt(scheduleId) : null;
      const dateObj = new Date(date);
      
      console.log('📝 CALLING updateDoctorArrivalStatus...');
      const presenceRecord = await storage.updateDoctorArrivalStatus(
        doctorId,
        parseInt(clinicId),
        parsedScheduleId,
        dateObj,
        hasArrived
      );
      console.log('✅ PRESENCE RECORD UPDATED:', presenceRecord);
      
      // Update ETAs if doctor has arrived
      if (hasArrived && parsedScheduleId) {
        console.log('Doctor has arrived, updating ETAs for all appointments');
        try {
          await ETAService.updateETAOnDoctorArrival(
            parsedScheduleId,
            new Date() // Use actual current time when doctor arrives, not the date param
          );
          console.log(`Successfully updated ETAs for schedule ${parsedScheduleId}`);
        } catch (etaError) {
          console.error('Error updating ETAs on doctor arrival:', etaError);
        }
      }
      
      // Send notifications to patients if the doctor has arrived
      if (hasArrived) {
        console.log('Doctor has arrived, sending notifications to patients');
        try {
          // Send doctor arrival notifications — attender must start each token individually
          await notificationService.notifyDoctorArrival(
            doctorId,
            parseInt(clinicId),
            dateObj,
            parsedScheduleId
          );
          console.log(`Successfully sent arrival notifications for doctor ${doctorId}`);
        } catch (notificationError) {
          console.error('Error sending doctor arrival notifications:', notificationError);
          // Continue execution - don't fail the API call if notifications fail
        }
      } else {
        console.log('Doctor marked as not arrived, skipping notifications');
      }
      
      res.json(presenceRecord);
    } catch (error) {
      console.error('❌ ERROR updating doctor arrival status:', error);
      res.status(500).json({ message: 'Failed to update doctor arrival status' });
    }
  });
  
  // Add an endpoint to reset all doctor presence for today (for debugging)
  app.post("/api/debug/reset-doctor-presence", async (req, res) => {
    if (!req.user || !['hospital_admin', 'attender', 'clinic_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Reset all doctor presence for today
      await db
        .update(doctorDailyPresence)
        .set({ hasArrived: false })
        .where(eq(doctorDailyPresence.date, today));

      res.json({ 
        message: 'All doctor presence reset to false for today',
        date: today.toISOString().split('T')[0]
      });
    } catch (error) {
      console.error('Error resetting doctor presence:', error);
      res.status(500).json({ message: 'Failed to reset doctor presence' });
    }
  });

  // Get moving average consultation time for a doctor on a specific date
  app.get("/api/doctors/:id/moving-average", async (req, res) => {
    try {
      const doctorId = parseInt(req.params.id);
      const { clinicId, date, scheduleId } = req.query;

      if (!clinicId || !date) {
        return res.status(400).json({ error: "clinicId and date are required" });
      }

      const dateObj = new Date(date as string);
      const sid = scheduleId ? parseInt(scheduleId as string) : undefined;

      // Get completed appointments for this doctor/clinic/date with actual times
      const completedAppts = await db
        .select({
          actualStartTime: appointments.actualStartTime,
          actualEndTime: appointments.actualEndTime,
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.doctorId, doctorId),
            eq(appointments.clinicId, parseInt(clinicId as string)),
            sid ? eq(appointments.scheduleId, sid) : sql`1=1`,
            sql`DATE(${appointments.date}) = DATE(${dateObj.toISOString()})`,
            eq(appointments.status, "completed"),
            not(isNull(appointments.actualStartTime)),
            not(isNull(appointments.actualEndTime))
          )
        );

      let movingAverage = 15; // default
      if (completedAppts.length > 0) {
        const { differenceInMinutes } = await import("date-fns");
        let total = 0;
        let valid = 0;
        for (const a of completedAppts) {
          const dur = differenceInMinutes(new Date(a.actualEndTime!), new Date(a.actualStartTime!));
          if (dur >= 1 && dur <= 120) { total += dur; valid++; }
        }
        if (valid > 0) movingAverage = Math.round(total / valid);
      }

      res.json({ movingAverage, basedOn: completedAppts.length });
    } catch (error) {
      console.error("Error getting moving average:", error);
      res.status(500).json({ error: "Failed to get moving average" });
    }
  });

  // Add an endpoint to get doctor arrival status
  app.get("/api/doctors/:id/arrival", async (req, res) => {
    try {
      const doctorId = parseInt(req.params.id);
      const { clinicId, date } = req.query;
      
      if (!clinicId || !date) {
        return res.status(400).json({ 
          message: 'Missing required query parameters: clinicId and date' 
        });
      }
      
      const clinicIdNumber = parseInt(clinicId as string);
      if (isNaN(clinicIdNumber)) {
        return res.status(400).json({ 
          message: 'Invalid clinicId parameter - must be a valid number' 
        });
      }
      
      const presenceRecord = await storage.getDoctorArrivalStatus(
        doctorId,
        clinicIdNumber,
        new Date(date as string)
      );
      
      if (!presenceRecord) {
        return res.json({
          doctorId,
          clinicId: clinicIdNumber,
          date: new Date(date as string).toISOString(),
          hasArrived: false,
          scheduleId: null
        });
      }
      
      res.json(presenceRecord);
    } catch (error) {
      console.error('Error fetching doctor arrival status:', error);
      res.status(500).json({ message: 'Failed to fetch doctor arrival status' });
    }
  });

  // Reserve next token number instantly for walk-in (step 1 of 2-step flow)
  app.post("/api/schedules/:scheduleId/reserve-token", async (req, res) => {
    if (!req.user || !['attender', 'clinic_admin'].includes(req.user.role)) return res.sendStatus(403);
    try {
      const scheduleId = parseInt(req.params.scheduleId);
      const [sched] = await db.select({ scheduleStatus: doctorSchedules.scheduleStatus }).from(doctorSchedules).where(eq(doctorSchedules.id, scheduleId)).limit(1);
      if (!sched || sched.scheduleStatus === 'completed') {
        return res.status(400).json({ error: "Cannot add walk-in to a completed schedule" });
      }
      const reservation = await storage.reserveNextToken(scheduleId, req.user.id);
      res.status(201).json(reservation);
    } catch (error) {
      console.error('Error reserving token:', error);
      res.status(500).json({ message: error instanceof Error ? error.message : 'Failed to reserve token' });
    }
  });

  // Confirm walk-in with reserved token (step 2 of 2-step flow)
  app.post("/api/schedules/:scheduleId/confirm-walkin", async (req, res) => {
    if (!req.user || !['attender', 'clinic_admin'].includes(req.user.role)) return res.sendStatus(403);
    try {
      const scheduleId = parseInt(req.params.scheduleId);
      const { reservationId, guestName, guestPhone } = req.body;
      if (!reservationId || !guestName) {
        return res.status(400).json({ message: 'reservationId and guestName are required' });
      }
      const appointment = await storage.confirmTokenReservation(Number(reservationId), guestName, guestPhone);
      res.status(201).json(appointment);
    } catch (error) {
      console.error('Error confirming walk-in:', error);
      res.status(400).json({ message: error instanceof Error ? error.message : 'Failed to confirm walk-in' });
    }
  });

  // Cancel a token reservation
  app.delete("/api/schedules/:scheduleId/reservation/:reservationId", async (req, res) => {
    if (!req.user || !['attender', 'clinic_admin'].includes(req.user.role)) return res.sendStatus(403);
    try {
      await storage.cancelTokenReservation(parseInt(req.params.reservationId), req.user.id);
      res.json({ message: 'Reservation cancelled' });
    } catch (error) {
      res.status(500).json({ message: 'Failed to cancel reservation' });
    }
  });

  // Add a new endpoint for attenders to create walk-in appointments
  app.post("/api/attender/walk-in-appointments", async (req, res) => {
    if (!req.user || !['attender', 'clinic_admin'].includes(req.user.role)) return res.sendStatus(403);
    
    try {
      const { doctorId, clinicId, scheduleId, date, guestName, guestPhone } = req.body;
      
      // Validate required fields
      if (!doctorId || !clinicId || !date || !guestName) {
        return res.status(400).json({ 
          message: 'Missing required fields: doctorId, clinicId, date, and guestName are required' 
        });
      }
      
      // Validate the doctor exists and user is authorized to manage them
      let canManageDoctor = false;
      
      if (req.user.role === 'attender') {
        // For attenders: check if they manage this doctor via attender_doctors table
        const managedDoctors = await storage.getAttenderDoctors(req.user.id);
        canManageDoctor = managedDoctors.some(md => md.doctorId === Number(doctorId));
      } else if (req.user.role === 'clinic_admin') {
        // For clinic admins: check if the doctor belongs to their clinic
        // First verify the clinic admin has a clinic assigned
        if (!req.user.clinicId) {
          return res.status(400).json({ message: 'Clinic admin not assigned to a clinic' });
        }
        
        // Check if the doctor belongs to the admin's clinic via doctor_clinics table
        const doctorClinics = await storage.getDoctorClinics(Number(doctorId));
        canManageDoctor = doctorClinics.some(clinic => clinic.id === req.user.clinicId);
      }
      
      if (!canManageDoctor) {
        return res.status(403).json({ 
          message: req.user.role === 'clinic_admin' 
            ? 'You can only manage doctors in your clinic' 
            : 'You are not authorized to manage this doctor' 
        });
      }
      
      // Create appointment date object
      const appointmentDate = new Date(date);
      
      // Create the walk-in appointment
      const appointmentData = {
        doctorId: Number(doctorId),
        clinicId: Number(clinicId),
        scheduleId: scheduleId ? Number(scheduleId) : undefined,
        date: appointmentDate,
        guestName,
        guestPhone,
        isWalkIn: true,
        status: "token_started"
      };

      const appointment = await storage.createWalkInAppointment(appointmentData);
      res.status(201).json(appointment);
    } catch (error) {
      console.error('Error creating walk-in appointment:', error);
      res.status(400).json({ 
        message: error instanceof Error ? error.message : 'Invalid appointment data' 
      });
    }
  });

  // Patient Favorites Endpoints

  // Add schedule to favorites
  app.post("/api/favorites/schedules", async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    if (req.user.role !== "patient") return res.sendStatus(403);

    try {
      const { scheduleId, doctorId, clinicId } = req.body;
      
      if (!scheduleId || !doctorId || !clinicId) {
        return res.status(400).json({ message: 'scheduleId, doctorId, and clinicId are required' });
      }

      const favorite = await storage.addFavoriteSchedule(
        req.user.id,
        parseInt(scheduleId),
        parseInt(doctorId),
        parseInt(clinicId)
      );

      res.status(201).json(favorite);
    } catch (error) {
      console.error('Error adding favorite schedule:', error);
      if (error instanceof Error && error.message === 'Schedule is already in favorites') {
        return res.status(409).json({ message: error.message });
      }
      res.status(500).json({ message: 'Failed to add favorite schedule' });
    }
  });

  // Remove schedule from favorites
  app.delete("/api/favorites/schedules/:scheduleId", async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    if (req.user.role !== "patient") return res.sendStatus(403);

    try {
      const scheduleId = parseInt(req.params.scheduleId);
      
      await storage.removeFavoriteSchedule(req.user.id, scheduleId);
      
      res.status(204).send();
    } catch (error) {
      console.error('Error removing favorite schedule:', error);
      res.status(500).json({ message: 'Failed to remove favorite schedule' });
    }
  });

  // Get patient's favorite schedules
  app.get("/api/favorites/schedules", async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    if (req.user.role !== "patient") return res.sendStatus(403);

    try {
      const favorites = await storage.getPatientFavorites(req.user.id);
      res.json(favorites);
    } catch (error) {
      console.error('Error getting favorite schedules:', error);
      res.status(500).json({ message: 'Failed to get favorite schedules' });
    }
  });

  // Check if schedule is favorited by patient
  app.get("/api/favorites/schedules/:scheduleId/check", async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    if (req.user.role !== "patient") return res.sendStatus(403);

    try {
      const scheduleId = parseInt(req.params.scheduleId);
      const isFavorite = await storage.checkIsFavorite(req.user.id, scheduleId);
      res.json({ isFavorite });
    } catch (error) {
      console.error('Error checking favorite status:', error);
      res.status(500).json({ message: 'Failed to check favorite status' });
    }
  });

  // Notification Endpoints

  // Get unread notifications for the authenticated user
  app.post('/api/notifications/register-token', async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    const { token, platform } = req.body;
    const allowedPlatforms = ['android', 'ios', 'web'];
    if (!token || typeof token !== 'string' || token.trim() === '') {
      return res.status(400).json({ message: 'token must be a non-empty string' });
    }
    if (platform && !allowedPlatforms.includes(platform)) {
      return res.status(400).json({ message: `platform must be one of: ${allowedPlatforms.join(', ')}` });
    }
    try {
      await db.insert(deviceTokens)
        .values({ userId: req.user.id, token: token.trim(), platform: platform || 'android' })
        .onConflictDoUpdate({
          target: deviceTokens.token,
          set: { userId: req.user.id, createdAt: new Date() },
        });
      res.json({ success: true });
    } catch (error) {
      console.error('Error registering device token:', error);
      res.status(500).json({ message: 'Failed to register device token' });
    }
  });

  app.get('/api/notifications', async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    try {
      const notifications = await notificationService.getUnreadNotifications(req.user.id);
      res.json(notifications);
    } catch (error) {
      console.log('Database notification error, using fallback:', error);
      // Fallback: use in-memory notifications
      if (error instanceof Error && error.message.includes('does not exist')) {
        const userNotifications = memoryNotifications
          .filter(n => n.user_id === req.user!.id && !n.is_read)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        res.json(userNotifications);
      } else {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: errorMessage });
      }
    }
  });

  // Get all notifications for the authenticated user
  app.get('/api/notifications/all', async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
      
      const notifications = await notificationService.getAllNotifications(req.user.id, limit, offset);
      res.json(notifications);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  });

  // Mark a notification as read
  app.patch('/api/notifications/:id/read', async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    try {
      const notification = await notificationService.markAsRead(parseInt(req.params.id));
      res.json(notification);
    } catch (error) {
      console.log('Database mark as read error, using fallback:', error);
      // Fallback: mark memory notification as read
      if (error instanceof Error && error.message.includes('does not exist')) {
        const notificationId = parseFloat(req.params.id);
        const memoryNotification = memoryNotifications.find(n => n.id === notificationId && n.user_id === req.user!.id);
        if (memoryNotification) {
          memoryNotification.is_read = true;
          res.json(memoryNotification);
        } else {
          res.status(404).json({ error: 'Notification not found' });
        }
      } else {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: errorMessage });
      }
    }
  });

  // Mark all notifications as read
  app.post('/api/notifications/read-all', async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    try {
      const result = await notificationService.markAllAsRead(req.user.id);
      res.json(result);
    } catch (error) {
      console.log('Database mark all as read error, using fallback:', error);
      // Fallback: mark all memory notifications as read for this user
      if (error instanceof Error && error.message.includes('does not exist')) {
        memoryNotifications
          .filter(n => n.user_id === req.user!.id && !n.is_read)
          .forEach(n => n.is_read = true);
        res.json({ success: true });
      } else {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: errorMessage });
      }
    }
  });

  // Delete a notification
  app.delete('/api/notifications/:id', async (req, res) => {
    if (!req.user) return res.sendStatus(401);
    try {
      const result = await notificationService.deleteNotification(parseInt(req.params.id));
      res.json(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  });

  // Attender Dashboard Endpoints
  app.get('/api/attender/:id/clinic-overview', async (req, res) => {
    if (!req.user || !['attender', 'clinic_admin'].includes(req.user.role)) return res.sendStatus(403);
    try {
      const attenderId = parseInt(req.params.id);
      if (req.user.role === 'attender' && req.user.id !== attenderId) return res.sendStatus(403);

      const overview = await storage.getAttenderClinicOverview(attenderId);
      res.json(overview);
    } catch (error) {
      console.error('Error fetching clinic overview:', error);
      res.status(500).json({ message: 'Failed to fetch clinic overview' });
    }
  });

  app.get('/api/attender/:id/doctors-summary', async (req, res) => {
    console.log('Doctors summary request:', { user: req.user, params: req.params });
    if (!req.user || !['attender', 'clinic_admin'].includes(req.user.role)) {
      console.log('Auth failed:', { user: req.user?.role });
      return res.sendStatus(403);
    }
    try {
      const attenderId = parseInt(req.params.id);
      if (req.user.id !== attenderId) {
        console.log('ID mismatch:', { userId: req.user.id, attenderId });
        return res.sendStatus(403);
      }

      const summary = await storage.getAttenderDoctorsSummary(attenderId);
      res.json(summary);
    } catch (error) {
      console.error('Error fetching doctors summary:', error);
      res.status(500).json({ message: 'Failed to fetch doctors summary' });
    }
  });

  app.get('/api/attender/schedules-today', async (req, res) => {
    console.log('Schedules request:', { user: req.user });
  
    // Allow both attenders and clinic admins
    if (!req.user || (req.user.role !== 'attender' && req.user.role !== 'clinic_admin')) {
      console.log('Auth failed:', { user: req.user?.role });
      return res.sendStatus(403);
    }
  
    try {
      let schedules;
      
      if (req.user.role === 'clinic_admin') {
        // For clinic admins, use their clinic ID directly
        if (!req.user.clinicId) {
          return res.status(400).json({ message: 'Clinic admin not assigned to a clinic' });
        }
        schedules = await storage.getClinicSchedulesToday(req.user.clinicId);
      } else {
        // Original attender logic
        const attenderId = req.user.id;
        schedules = await storage.getAttenderSchedulesToday(attenderId);
      }
      
      res.json(schedules);
    } catch (error) {
      console.error('Error fetching schedules:', error);
      res.status(500).json({ message: 'Failed to fetch schedules' });
    }
  });
  
   app.get("/api/clinics/:clinicId/doctors", async (req, res) => {
      try {
        const clinicId = parseInt(req.params.clinicId);
        const doctors = await storage.getDoctorsByClinic(clinicId);
        res.json(doctors);
      } catch (error) {
        console.error('Error fetching clinic doctors:', error);
        res.status(500).json({ message: 'Failed to fetch doctors' });
      }
    });

    app.get("/api/attender-doctor/:attenderId", async (req, res) => {
      try {
        const attenderId = parseInt(req.params.attenderId);
        const doctors = await storage.getAttenderDoctors(attenderId);
        res.json(doctors);
      } catch (error) {
        console.error('Error fetching clinic doctors:', error);
        res.status(500).json({ message: 'Failed to fetch doctors' });
      }
    });

    // Assign doctor to attender
    app.post("/api/attender-doctors", async (req, res) => {
      try {
        const { attenderId, doctorId, clinicId } = req.body;

        if (!attenderId || !doctorId || !clinicId) {
          return res.status(400).json({ message: 'Missing required fields' });
        }

        const relationship = await storage.addDoctorToAttender(
          parseInt(attenderId),
          parseInt(doctorId),
          parseInt(clinicId)
        );

        res.status(201).json(relationship);
      } catch (error) {
        console.error('Error assigning doctor to attender:', error);
        res.status(500).json({ message: 'Failed to assign doctor to attender' });
      }
    });

    // Cancel a schedule and notify affected patients
    app.patch("/api/schedules/:id/cancel", async (req, res) => {
      if (!req.user || !['attender', 'clinic_admin'].includes(req.user.role)) {
        return res.sendStatus(403);
      }

      try {
        const scheduleId = parseInt(req.params.id);
        const { cancelReason } = req.body;

        // FIRST: Get all pending appointments BEFORE cancelling them
        const appointments = await storage.getAppointmentsBySchedule(scheduleId);
        console.log(`Found ${appointments.length} appointments for schedule ${scheduleId}`);
        
        // SECOND: Update the schedule status
        const updatedSchedule = await storage.updateSchedule(scheduleId, {
          isActive: false,
          cancelReason: cancelReason || 'Schedule cancelled by attender'
        });

        // THIRD: Cancel each appointment (but preserve completed and no_show statuses)
        for (const appointment of appointments) {
          if (appointment.status !== 'completed' && appointment.status !== 'cancel' && appointment.status !== 'no_show') {
            // Update appointment status to cancelled
            await storage.updateAppointmentStatus(
              appointment.id, 
              'cancel', 
              'Schedule cancelled by clinic'
            );
          }
        }

        // FOURTH: Send notifications to all affected patients (using the original appointments list)
        await notificationService.notifyScheduleCancelled(scheduleId, cancelReason);

        res.json(updatedSchedule);
      } catch (error) {
        console.error('Error canceling schedule:', error);
        res.status(500).json({ message: 'Failed to cancel schedule' });
      }
    });

    // Super Admin: Search patient by phone number
    app.get("/api/patients/search", async (req, res) => {
      if (!req.user || req.user.role !== 'super_admin') return res.sendStatus(403);
      
      try {
        const { phone } = req.query;
        
        if (!phone) {
          return res.status(400).json({ error: 'Phone number is required' });
        }
        
        console.log(`Super admin searching for patient with phone: ${phone}`);
        
        // Search for patient by phone number
        const patientResult = await db.execute(sql`
          SELECT id, name, username, phone, email, phone_verified, created_at
          FROM users 
          WHERE role = 'patient' AND phone = ${phone as string}
          LIMIT 1
        `);
        
        if (patientResult.rows.length === 0) {
          return res.json({ patient: null, appointments: [] });
        }
        
        const patient = patientResult.rows[0];
        console.log(`Found patient: ${patient.name} (ID: ${patient.id})`);
        
        // Get appointment history for this patient
        const appointmentsResult = await db.execute(sql`
          SELECT 
            a.id,
            a.date,
            a.token_number,
            a.status,
            a.status_notes,
            a.created_at,
            d.name as doctor_name,
            c.name as clinic_name
          FROM appointments a
          LEFT JOIN users d ON a.doctor_id = d.id
          LEFT JOIN clinics c ON a.clinic_id = c.id
          WHERE a.patient_id = ${patient.id}
          ORDER BY a.date DESC, a.created_at DESC
          LIMIT 50
        `);
        
        const appointments = appointmentsResult.rows.map(apt => ({
          id: apt.id,
          date: apt.date,
          tokenNumber: apt.token_number,
          status: apt.status,
          statusNotes: apt.status_notes,
          doctorName: apt.doctor_name,
          clinicName: apt.clinic_name,
          createdAt: apt.created_at
        }));
        
        console.log(`Found ${appointments.length} appointments for patient`);
        
        res.json({
          patient: {
            id: patient.id,
            name: patient.name,
            username: patient.username,
            phone: patient.phone,
            email: patient.email,
            phoneVerified: patient.phone_verified,
            createdAt: patient.created_at
          },
          appointments
        });
        
      } catch (error) {
        console.error('Error searching patient:', error);
        res.status(500).json({ error: 'Failed to search patient' });
      }
    });

    // Remove a doctor assignment
    app.delete("/api/attender-doctors", async (req, res) => {
      try {
        const { attenderId, doctorId } = req.body;

        if (!attenderId || !doctorId) {
          return res.status(400).json({ message: 'Missing required fields' });
        }

        await storage.removeDoctorFromAttender(
          parseInt(attenderId),
          parseInt(doctorId)
        );

        res.status(200).json({ message: 'Doctor removed from attender successfully' });
      } catch (error) {
        console.error('Error removing doctor from attender:', error);
        res.status(500).json({ message: 'Failed to remove doctor from attender' });
      }
    });

    // Get users by role and clinicId
    app.get("/api/users", async (req, res) => {
      try {
        const { role, clinicId } = req.query;

        if (!role) {
          return res.status(400).json({ message: 'Role parameter is required' });
        }

        // If clinicId is provided, filter by clinic
        if (clinicId) {
          const users = await storage.getAttendersByClinic(parseInt(clinicId as string));
          // Filter by role if specified
          const filteredUsers = role ? users.filter(user => user.role === role) : users;
          return res.json(filteredUsers);
        }

        // If role is attender, use the specific method
        if (role === 'attender') {
          const attenders = await storage.getAttendersByRole();
          return res.json(attenders);
        }

        // Otherwise get all users and filter by role
        const allUsers = await storage.getDoctors(); // This actually gets all users despite the name
        const filteredUsers = allUsers.filter(user => user.role === role);
        res.json(filteredUsers);
      } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ message: 'Failed to fetch users' });
      }
    });

    // Delete user by ID
    app.delete("/api/users/:id", async (req, res) => {
      try {
        // Check if user is authorized (must be clinic_admin or super_admin)
        if (!req.user || (req.user.role !== "clinic_admin" && req.user.role !== "super_admin")) {
          return res.status(403).json({ message: "Unauthorized" });
        }

        const userId = parseInt(req.params.id);
        await storage.deleteUser(userId);
        res.status(200).json({ message: 'User deleted successfully' });
      } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ message: 'Failed to delete user' });
      }
    });

    // Update user by ID
    app.put("/api/users/:id", async (req, res) => {
      try {
        // Check if user is authorized (must be clinic_admin or super_admin)
        if (!req.user || (req.user.role !== "clinic_admin" && req.user.role !== "super_admin")) {
          return res.status(403).json({ message: "Unauthorized" });
        }

        const userId = parseInt(req.params.id);
        const userData = req.body;

        // Don't allow changing role through this endpoint
        delete userData.role;

        const updatedUser = await storage.updateUser(userId, userData);
        res.json(updatedUser);
      } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ message: 'Failed to update user' });
      }
    });

  // Update doctor (complete record) Endpoints
  app.patch('/api/doctors/:id', async (req, res) => {
    if (!req.user || !['attender', 'clinic_admin'].includes(req.user.role)) return res.sendStatus(403);
    try {
      const doctorId = parseInt(req.params.id);

      // Validate request body
      const updateDoctorSchema = z.object({
        user: z.object({
          name: z.string(),
          specialty: z.string(),
          bio: z.string().optional(),
          imageUrl: z.string().optional(),
          address: z.string().optional(),
          city: z.string().optional(),
          state: z.string().optional(),
          zipCode: z.string().optional(),
          latitude: z.string().optional(),
          longitude: z.string().optional(),
          clinicId: z.number(),
        }),
        details: z.object({
          consultationFee: z.number().or(z.string().transform(val => parseFloat(val))),
          consultationDuration: z.number().or(z.string().transform(val => parseInt(val))),
          qualifications: z.string().optional(),
          experience: z.number().optional().or(z.string().transform(val => parseInt(val))),
          registrationNumber: z.string().optional(),
          isEnabled: z.boolean().optional(),
        }),
      });

      const validatedData = updateDoctorSchema.parse(req.body);

      // Update the doctor
      const doctor = await storage.updateDoctor(
        doctorId,
        validatedData.user,
        validatedData.details
      );

      res.json(doctor);
    } catch (error) {
      console.error("Error updating doctor:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update doctor" });
    }
  });

  // Debug route to get current user info
  app.get("/api/debug/user-info", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    res.json({
      id: req.user.id,
      name: req.user.name,
      role: req.user.role,
      email: req.user.email
    });
  });

  // Debug route to test schedule cancellation notifications
  app.post("/api/debug/test-cancel-notification/:scheduleId", async (req, res) => {
    try {
      const scheduleId = parseInt(req.params.scheduleId);
      const { cancelReason } = req.body;
      console.log(`DEBUG: Testing schedule cancellation notification for schedule ${scheduleId}`);
      console.log(`DEBUG: Cancel reason: ${cancelReason}`);

      // Check if schedule exists first
      console.log('DEBUG: Checking if schedule exists...');
      const schedule = await storage.getDoctorSchedule(scheduleId);
      console.log('DEBUG: Schedule found:', schedule);

      if (!schedule) {
        return res.status(404).json({ error: 'Schedule not found' });
      }

      console.log('DEBUG: Calling notifyScheduleCancelled...');
      await notificationService.notifyScheduleCancelled(scheduleId, cancelReason);
      console.log('DEBUG: notifyScheduleCancelled completed');

      res.json({ success: true, message: "Schedule cancellation notification test completed" });
    } catch (error) {
      console.error("DEBUG: Schedule cancellation notification test failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Debug route to create a direct notification for current user
  app.post("/api/debug/create-notification", async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    
    try {
      const { title, message, type } = req.body;
      
      const notification = await notificationService.createNotification({
        userId: req.user.id,
        appointmentId: null,
        title: title || "Test Notification",
        message: message || "This is a test notification to verify the system is working",
        type: type || "test"
      });

      res.json({ success: true, notification });
    } catch (error) {
      console.error("DEBUG: Failed to create test notification:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Reset attender password by clinic admin
  app.patch("/api/admin/reset-attender-password", async (req, res) => {
    if (!req.user || req.user.role !== 'clinic_admin') {
      return res.status(403).json({ message: 'Only clinic admins can reset passwords' });
    }

    try {
      const { attenderId, newPassword } = req.body;

      // Validate password requirements
      const passwordRegex = /^(?=.*[0-9])(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
      if (!passwordRegex.test(newPassword)) {
        return res.status(400).json({ 
          message: 'Password must be at least 8 characters with 1 number and 1 special character' 
        });
      }

      // Check if password already exists for any user
      const existingUser = await storage.checkPasswordExists(newPassword);
      if (existingUser) {
        return res.status(400).json({ 
          message: 'This password is already in use. Please choose a different password.' 
        });
      }

      // Reset the password
      await storage.resetAttenderPassword(attenderId, newPassword);

      res.json({ message: 'Password reset successfully' });
    } catch (error) {
      console.error('Error resetting password:', error);
      res.status(500).json({ message: 'Failed to reset password' });
    }
  });

  // Debug route to test notifications
  app.post("/api/debug/test-notification/:scheduleId", async (req, res) => {
    try {
      const scheduleId = parseInt(req.params.scheduleId);
      console.log(`DEBUG: Testing notification for schedule ${scheduleId}`);
      
      await notificationService.notifyScheduleActivated(scheduleId);
      
      res.json({ success: true, message: "Notification test completed" });
    } catch (error) {
      console.error("DEBUG: Notification test failed:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get today's appointment stats for a clinic
  app.get("/api/clinics/:clinicId/stats/today", async (req, res) => {
    try {
      const clinicId = parseInt(req.params.clinicId);
      if (isNaN(clinicId)) {
        return res.status(400).json({ message: 'Invalid clinic ID' });
      }

      const stats = await storage.getClinicAppointmentStatsToday(clinicId);
      res.json(stats);
    } catch (error) {
      console.error('Error fetching clinic appointment stats:', error);
      res.status(500).json({ message: 'Failed to fetch appointment stats' });
    }
  });

  // Get today's schedule stats for a clinic
  app.get("/api/clinics/:clinicId/stats/schedules/today", async (req, res) => {
    try {
      const clinicId = parseInt(req.params.clinicId);
      if (isNaN(clinicId)) {
        return res.status(400).json({ message: 'Invalid clinic ID' });
      }

      const stats = await storage.getClinicScheduleStatsToday(clinicId);
      res.json(stats);
    } catch (error) {
      console.error('Error fetching clinic schedule stats:', error);
      res.status(500).json({ message: 'Failed to fetch schedule stats' });
    }
  });

  // Export Report Routes

  // Get doctors managed by current attender for export dropdown
  app.get("/api/export/doctors", async (req, res) => {
    if (!req.user || !['attender', 'clinic_admin'].includes(req.user.role)) {
      return res.sendStatus(403);
    }

    try {
      let doctors;
      
      if (req.user.role === 'clinic_admin') {
        // For clinic admins, get all doctors in their clinic
        if (!req.user.clinicId) {
          return res.status(400).json({ message: 'Clinic admin not assigned to a clinic' });
        }
        doctors = await storage.getDoctorsByClinic(req.user.clinicId);
      } else {
        // For attenders, get doctors they manage
        doctors = await storage.getDoctorsByAttender(req.user.id);
      }
      
      res.json(doctors);
    } catch (error) {
      console.error("Error fetching doctors:", error);
      res.status(500).json({ message: "Failed to fetch doctors" });
    }
  });

  // Export appointments for a doctor within date range
  app.get("/api/export/appointments", async (req, res) => {
    if (!req.user || !['attender', 'clinic_admin'].includes(req.user.role)) {
      return res.sendStatus(403);
    }

    try {
      const { doctorId, startDate, endDate } = req.query;

      if (!doctorId || !startDate || !endDate) {
        return res.status(400).json({ 
          message: "doctorId, startDate, and endDate are required" 
        });
      }

      const doctor = await storage.getUser(Number(doctorId));
      if (!doctor || doctor.role !== "doctor") {
        return res.status(400).json({ message: "Invalid doctor" });
      }

      // Validate date range (max 6 months)
      const start = new Date(startDate as string);
      const end = new Date(endDate as string);
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      if (start < sixMonthsAgo) {
        return res.status(400).json({ 
          message: "Date range cannot exceed 6 months from current date" 
        });
      }

      if (start > end) {
        return res.status(400).json({ 
          message: "Start date must be before end date" 
        });
      }

      // Check authorization - ensure user can access this doctor's data
      if (req.user.role === 'attender') {
        const managedDoctors = await storage.getDoctorsByAttender(req.user.id);
        const canAccess = managedDoctors.some(d => d.id === Number(doctorId));
        if (!canAccess) {
          return res.status(403).json({ message: "Not authorized to access this doctor's data" });
        }
      } else if (req.user.role === 'clinic_admin') {
        // For clinic admins, verify the doctor belongs to their clinic
        if (!req.user.clinicId) {
          return res.status(400).json({ message: 'Clinic admin not assigned to a clinic' });
        }
        const clinicDoctors = await storage.getDoctorsByClinic(req.user.clinicId);
        const canAccess = clinicDoctors.some(d => d.id === Number(doctorId));
        if (!canAccess) {
          return res.status(403).json({ message: "Not authorized to access this doctor's data" });
        }
      }

      const appointments = await storage.getAppointmentsForExport(
        Number(doctorId),
        start,
        end
      );

      res.json(appointments);
    } catch (error) {
      console.error("Export error:", error);
      res.status(500).json({ message: "Failed to fetch appointment data" });
    }
  });

  // Export appointments for a specific schedule
  app.get("/api/export/appointments/schedule", async (req, res) => {
    if (!req.user || !['attender', 'clinic_admin'].includes(req.user.role)) {
      return res.sendStatus(403);
    }

    try {
      const { doctorId, scheduleId } = req.query;

      if (!doctorId || !scheduleId) {
        return res.status(400).json({ 
          message: "doctorId and scheduleId are required" 
        });
      }

      const doctor = await storage.getUser(Number(doctorId));
      if (!doctor || doctor.role !== "doctor") {
        return res.status(400).json({ message: "Invalid doctor" });
      }

      // Check authorization - ensure user can access this doctor's data
      if (req.user.role === 'attender') {
        const managedDoctors = await storage.getDoctorsByAttender(req.user.id);
        const canAccess = managedDoctors.some(d => d.id === Number(doctorId));
        if (!canAccess) {
          return res.status(403).json({ message: "Not authorized to access this doctor's data" });
        }
      } else if (req.user.role === 'clinic_admin') {
        // For clinic admins, verify the doctor belongs to their clinic
        if (!req.user.clinicId) {
          return res.status(400).json({ message: 'Clinic admin not assigned to a clinic' });
        }
        const clinicDoctors = await storage.getDoctorsByClinic(req.user.clinicId);
        const canAccess = clinicDoctors.some(d => d.id === Number(doctorId));
        if (!canAccess) {
          return res.status(403).json({ message: "Not authorized to access this doctor's data" });
        }
      }

      const appointments = await storage.getAppointmentsForScheduleExport(
        Number(doctorId),
        Number(scheduleId)
      );

      res.json(appointments);
    } catch (error) {
      console.error("Schedule export error:", error);
      res.status(500).json({ message: "Failed to fetch schedule appointment data" });
    }
  });

  // Super Admin Export Reports Route
  app.get("/api/super-admin/export-reports/:clinicId", async (req, res) => {
    if (!req.user || req.user.role !== 'super_admin') {
      return res.sendStatus(403);
    }

    try {
      const { clinicId } = req.params;
      const { startDate, endDate } = req.query;

      if (!clinicId || !startDate || !endDate) {
        return res.status(400).json({ 
          message: "clinicId, startDate, and endDate are required" 
        });
      }

      // Validate date range (max 6 months)
      const start = new Date(startDate as string);
      const end = new Date(endDate as string);
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      if (start < sixMonthsAgo) {
        return res.status(400).json({ 
          message: "Date range cannot exceed 6 months from current date" 
        });
      }

      if (start > end) {
        return res.status(400).json({ 
          message: "Start date must be before end date" 
        });
      }

      // Get clinic details
      const clinic = await storage.getClinic(Number(clinicId));
      if (!clinic) {
        return res.status(404).json({ message: "Clinic not found" });
      }

      // Set end to end of day so all appointments on the end date are included
      end.setUTCHours(23, 59, 59, 999);

      // Get export data for the clinic
      const exportData = await storage.getSuperAdminExportData(
        Number(clinicId),
        start,
        end
      );

      res.json(exportData);
    } catch (error) {
      console.error("Super admin export error:", error);
      res.status(500).json({ message: "Failed to fetch export data" });
    }
  });

  // Super Admin Cancelled Schedules Route (Step 1: Get schedules to choose from)
  app.get("/api/super-admin/cancelled-schedules/:clinicId", async (req, res) => {
    if (!req.user || req.user.role !== 'super_admin') {
      return res.sendStatus(403);
    }

    try {
      const { clinicId } = req.params;
      const { dateFilter } = req.query;

      if (!clinicId || !dateFilter) {
        return res.status(400).json({ 
          message: "clinicId and dateFilter are required" 
        });
      }

      // Get clinic details
      const clinic = await storage.getClinic(Number(clinicId));
      if (!clinic) {
        return res.status(404).json({ message: "Clinic not found" });
      }

      // Get cancelled schedules list for selection
      const cancelledSchedules = await storage.getCancelledSchedulesForSelection(
        Number(clinicId),
        dateFilter as string
      );

      res.json(cancelledSchedules);
    } catch (error) {
      console.error("Super admin cancelled schedules error:", error);
      res.status(500).json({ message: "Failed to fetch cancelled schedules" });
    }
  });

  // Super Admin Cancelled Schedule Appointments Route (Step 2: Get appointments for selected schedule)
  app.get("/api/super-admin/cancelled-schedule-appointments/:scheduleId", async (req, res) => {
    if (!req.user || req.user.role !== 'super_admin') {
      return res.sendStatus(403);
    }

    try {
      const { scheduleId } = req.params;

      if (!scheduleId) {
        return res.status(400).json({ 
          message: "scheduleId is required" 
        });
      }

      // Get appointments for the specific cancelled schedule
      const cancelledAppointments = await storage.getAppointmentsForCancelledSchedule(
        Number(scheduleId)
      );

      res.json(cancelledAppointments);
    } catch (error) {
      console.error("Super admin cancelled schedule appointments error:", error);
      res.status(500).json({ message: "Failed to fetch cancelled schedule appointments" });
    }
  });

  // Fix token numbers route - for admin use
  app.post("/api/admin/fix-token-numbers", async (req, res) => {
    // Only allow super admin to run this fix
    if (!req.user || req.user.role !== 'super_admin') {
      return res.sendStatus(403);
    }

    try {
      await storage.fixTokenNumbers();
      res.json({ message: "Token numbers have been fixed successfully!" });
    } catch (error) {
      console.error("Error fixing token numbers:", error);
      res.status(500).json({ message: "Failed to fix token numbers" });
    }
  });

  // ================ POLICY MANAGEMENT API ENDPOINTS ================

  // Get policy content by key (public access for rendering policy pages)
  app.get("/api/policies/:key", async (req, res) => {
    try {
      const { key } = req.params;
      
      let config = await storage.getConfiguration(key);
      
      // Auto-create sane defaults for missing public pages so prod never 404s
      if (!config) {
        let defaultCategory: 'policy' | 'help' | undefined;
        let defaultContent: string | undefined;
        let defaultDescription = 'Auto-created default content';

        switch (key) {
          case 'policy_contactUs':
            defaultCategory = 'policy';
            defaultContent = `<h1>Contact Us</h1>
<p>Email: <a href=\"mailto:support@clinicflow.com\">support@clinicflow.com</a></p>
<p>Phone: +91-XXXX-XXXXXX</p>`;
            defaultDescription = 'Contact Us page content';
            break;
          case 'policy_about_us':
            defaultCategory = 'policy';
            defaultContent = `<h1>About Us</h1><p>ClinicFlow helps patients book tokens and track queues in real time.</p>`;
            defaultDescription = 'About Us page content';
            break;
          case 'policy_terms_conditions':
            defaultCategory = 'policy';
            defaultContent = `<h1>Terms & Conditions</h1><p>Standard terms placeholder.</p>`;
            defaultDescription = 'Terms & Conditions content';
            break;
          case 'policy_privacy':
            defaultCategory = 'policy';
            defaultContent = `<h1>Privacy Policy</h1><p>Standard privacy placeholder.</p>`;
            defaultDescription = 'Privacy policy content';
            break;
          case 'help_faqs':
            defaultCategory = 'help';
            defaultContent = `<h1>FAQs</h1><p>Common questions will appear here.</p>`;
            defaultDescription = 'FAQs content';
            break;
          default:
            // Unknown key, keep 404 behavior
            break;
        }

        if (defaultCategory && defaultContent) {
          try {
            const created = await storage.createConfiguration({
              configKey: key,
              configValue: defaultContent,
              configType: 'string',
              description: defaultDescription,
              category: defaultCategory,
              isEditable: true,
            } as any);
            config = created as any;
          } catch (e) {
            console.warn(`Failed to auto-create missing policy ${key}:`, e);
          }
        }
      }

      if (!config) {
        return res.status(404).json({ message: 'Policy not found' });
      }

      res.json({ 
        key: config.configKey, 
        content: config.configValue,
        updatedAt: config.updatedAt
      });
    } catch (error) {
      console.error("Error fetching policy:", error);
      res.status(500).json({ message: "Failed to fetch policy" });
    }
  });

  // Get all editable policies (super admin only)
  app.get("/api/admin/policies", async (req, res) => {
    if (!req.user || req.user.role !== 'super_admin') {
      return res.sendStatus(403);
    }

    try {
      let policyConfigs = await storage.getConfigurationsByCategory('policy');
      const helpConfigs = await storage.getConfigurationsByCategory('help');

      // Ensure Contact Us policy exists (some deployments may predate this entry)
      const hasContactUs = policyConfigs.some(p => p.configKey === 'policy_contactUs');
      if (!hasContactUs) {
        try {
          const created = await storage.createConfiguration({
            configKey: 'policy_contactUs',
            configValue: '<h1>Contact Us</h1><p>Email: support@clinicflow.com</p>',
            configType: 'string',
            description: 'Contact Us page content',
            category: 'policy',
            isEditable: true,
          } as any);
          // refresh policies list to include the newly created one
          policyConfigs = await storage.getConfigurationsByCategory('policy');
        } catch (e) {
          console.warn('Could not auto-create policy_contactUs:', e);
        }
      }
      
      const allPolicies = [...policyConfigs, ...helpConfigs].filter(c => c.isEditable);
      
      res.json(allPolicies.map(p => ({
        key: p.configKey,
        content: p.configValue,
        description: p.description,
        category: p.category,
        updatedAt: p.updatedAt
      })));
    } catch (error) {
      console.error("Error fetching policies:", error);
      res.status(500).json({ message: "Failed to fetch policies" });
    }
  });

  // Update or create policy content (super admin only)
  app.put("/api/admin/policies/:key", async (req, res) => {
    if (!req.user || req.user.role !== 'super_admin') {
      return res.sendStatus(403);
    }

    try {
      const { key } = req.params;
      const { content } = req.body;

      if (!content) {
        return res.status(400).json({ message: "Content is required" });
      }

      // Try to fetch existing configuration
      const existing = await storage.getConfiguration(key);
      if (!existing) {
        // Create on the fly if missing so new pages (like Contact Us) can be added from the portal
        const category = key.startsWith('help_') ? 'help' : 'policy';
        const created = await storage.createConfiguration({
          configKey: key,
          configValue: content,
          configType: 'string',
          description: 'Custom page content',
          category,
          isEditable: true,
          createdBy: req.user.id,
        } as any);
        return res.json({
          message: "Policy created successfully",
          key: created.configKey,
          updatedAt: created.updatedAt,
        });
      }

      const updated = await storage.updateConfiguration(key, content, req.user.id);
      
      res.json({ 
        message: "Policy updated successfully",
        key: updated.configKey,
        updatedAt: updated.updatedAt
      });
    } catch (error) {
      console.error("Error updating policy:", error);
      res.status(500).json({ message: "Failed to update policy" });
    }
  });

  // ================ WALLET API ENDPOINTS ================

  // Get patient wallet balance
  app.get("/api/wallet/balance", async (req, res) => {
    if (!req.user || req.user.role !== 'patient') {
      return res.status(403).json({ message: 'Only patients can access wallet' });
    }

    try {
      const balance = await walletService.getWalletBalance(req.user.id);
      res.json({ balance });
    } catch (error) {
      console.error('Error fetching wallet balance:', error);
      res.status(500).json({ message: 'Failed to fetch wallet balance' });
    }
  });

  // Get patient wallet summary with transactions and stats
  app.get("/api/wallet/summary", async (req, res) => {
    if (!req.user || req.user.role !== 'patient') {
      return res.status(403).json({ message: 'Only patients can access wallet' });
    }

    try {
      const summary = await walletService.getWalletSummary(req.user.id);
      res.json(summary);
    } catch (error) {
      console.error('Error fetching wallet summary:', error);
      res.status(500).json({ message: 'Failed to fetch wallet summary' });
    }
  });

  // Get wallet transaction history
  app.get("/api/wallet/transactions", async (req, res) => {
    if (!req.user || req.user.role !== 'patient') {
      return res.status(403).json({ message: 'Only patients can access wallet' });
    }

    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      
      const transactions = await walletService.getWalletTransactions(req.user.id, limit, offset);
      res.json(transactions);
    } catch (error) {
      console.error('Error fetching wallet transactions:', error);
      res.status(500).json({ message: 'Failed to fetch wallet transactions' });
    }
  });

  // Admin endpoint: Credit/Debit patient wallet
  app.post("/api/admin/wallet/transaction", async (req, res) => {
    if (!req.user || !['super_admin', 'clinic_admin', 'hospital_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Admin access required' });
    }

    try {
      const { patientId, amount, isCredit, reason } = req.body;
      
      if (!patientId || !amount || !reason) {
        return res.status(400).json({ message: 'Patient ID, amount, and reason are required' });
      }

      if (amount <= 0) {
        return res.status(400).json({ message: 'Amount must be positive' });
      }

      const transaction = await walletService.adminWalletTransaction(
        patientId,
        amount,
        isCredit,
        reason,
        req.user.id
      );

      // Send notification to patient
      await notificationService.createNotification({
        userId: patientId,
        appointmentId: null,
        title: isCredit ? "Wallet Credited" : "Wallet Debited",
        message: `₹${amount} has been ${isCredit ? 'added to' : 'deducted from'} your wallet. Reason: ${reason}`,
        type: isCredit ? "wallet_credit" : "wallet_debit"
      });

      res.json(transaction);
    } catch (error) {
      console.error('Error processing admin wallet transaction:', error);
      res.status(500).json({ message: error instanceof Error ? error.message : 'Failed to process transaction' });
    }
  });

  // Process schedule cancellation refunds (Attender/Admin)
  app.post("/api/schedules/:scheduleId/cancel-with-refunds", async (req, res) => {
    if (!req.user || !['attender', 'clinic_admin', 'hospital_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Attender or admin access required' });
    }

    try {
      const scheduleId = parseInt(req.params.scheduleId);
      const { cancelReason } = req.body;

      if (!cancelReason) {
        return res.status(400).json({ message: 'Cancel reason is required' });
      }

      // First, cancel the schedule
      await storage.updateSchedule(scheduleId, { 
        isActive: false, 
        cancelReason,
        status: 'cancelled'
      });

      // Process all refunds for this schedule
      const refundResult = await walletService.processScheduleCancellationRefunds(
        scheduleId,
        cancelReason,
        req.user.id
      );

      // Send schedule cancellation notifications
      try {
        await notificationService.notifyScheduleCancelled(scheduleId, cancelReason);
      } catch (notifError) {
        console.error('Error sending schedule cancellation notifications:', notifError);
      }

      res.json({
        message: 'Schedule cancelled and refunds processed successfully',
        refundedAppointments: refundResult.refundedAppointments,
        totalRefundAmount: refundResult.totalRefundAmount,
        details: refundResult.refundDetails
      });
    } catch (error) {
      console.error('Error cancelling schedule with refunds:', error);
      res.status(500).json({ message: error instanceof Error ? error.message : 'Failed to cancel schedule with refunds' });
    }
  });

  // Process partial refunds when doctor leaves mid-session
  app.post("/api/schedules/:scheduleId/partial-refunds", async (req, res) => {
    if (!req.user || !['attender', 'clinic_admin', 'hospital_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Attender or admin access required' });
    }

    try {
      const scheduleId = parseInt(req.params.scheduleId);
      const { completedAppointmentIds, cancelReason } = req.body;

      if (!cancelReason || !Array.isArray(completedAppointmentIds)) {
        return res.status(400).json({ message: 'Cancel reason and completed appointment IDs are required' });
      }

      // Process partial refunds
      const refundResult = await walletService.processPartialRefund(
        scheduleId,
        completedAppointmentIds,
        cancelReason,
        req.user.id
      );

      res.json({
        message: 'Partial refunds processed successfully',
        refundedAppointments: refundResult.refundedAppointments,
        totalRefundAmount: refundResult.totalRefundAmount,
        details: refundResult.refundDetails
      });
    } catch (error) {
      console.error('Error processing partial refunds:', error);
      res.status(500).json({ message: error instanceof Error ? error.message : 'Failed to process partial refunds' });
    }
  });

  // Mark patient as no-show (no refund)
  app.post("/api/appointments/:appointmentId/no-show", async (req, res) => {
    if (!req.user || !['attender', 'clinic_admin', 'hospital_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Attender or admin access required' });
    }

    try {
      const appointmentId = parseInt(req.params.appointmentId);
      const { notes } = req.body;

      await walletService.markPatientNoShow(appointmentId, req.user.id, notes);

      res.json({ message: 'Patient marked as no-show successfully' });
    } catch (error) {
      console.error('Error marking patient as no-show:', error);
      res.status(500).json({ message: 'Failed to mark patient as no-show' });
    }
  });

  // Mark appointment as refunded (for duplicate refund prevention)
  app.patch("/api/appointments/:appointmentId/mark-refunded", async (req, res) => {
    if (!req.user || !['super_admin', 'clinic_admin', 'hospital_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Admin access required' });
    }

    try {
      const appointmentId = parseInt(req.params.appointmentId);
      const { refundAmount } = req.body;

      await storage.markAppointmentAsRefunded(appointmentId, refundAmount || 0);

      res.json({ message: 'Appointment marked as refunded successfully' });
    } catch (error) {
      console.error('Error marking appointment as refunded:', error);
      res.status(500).json({ message: 'Failed to mark appointment as refunded' });
    }
  });

  // Get wallet statistics for admin dashboard
  app.get("/api/admin/wallet/stats", async (req, res) => {
    if (!req.user || !['super_admin', 'clinic_admin', 'hospital_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Admin access required' });
    }

    try {
      // Get wallet statistics from database
      const stats = await db.execute(sql`
        SELECT 
          COUNT(pw.id) as total_wallets,
          SUM(pw.balance::numeric) as total_balance,
          SUM(pw.total_earned::numeric) as total_refunds_given,
          SUM(pw.total_spent::numeric) as total_revenue,
          COUNT(wt.id) as total_transactions
        FROM patient_wallets pw
        LEFT JOIN wallet_transactions wt ON pw.id = wt.wallet_id
        WHERE pw.is_active = true
      `);

      const recentTransactions = await db.execute(sql`
        SELECT 
          wt.*,
          u.name as patient_name
        FROM wallet_transactions wt
        JOIN users u ON wt.patient_id = u.id
        ORDER BY wt.created_at DESC
        LIMIT 20
      `);

      res.json({
        stats: stats.rows[0] || {},
        recentTransactions: recentTransactions.rows
      });
    } catch (error) {
      console.error('Error fetching wallet stats:', error);
      res.status(500).json({ message: 'Failed to fetch wallet statistics' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
