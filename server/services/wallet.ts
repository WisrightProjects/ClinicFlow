import { db } from '../db';
import { 
  patientWallets, 
  walletTransactions, 
  appointmentRefunds,
  appointments,
  doctorSchedules,
  users,
  type PatientWallet,
  type WalletTransaction,
  type InsertWalletTransaction,
  type InsertAppointmentRefund,
  type WalletTransactionType
} from '@shared/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
import { notificationService } from './notification';
import { paymentService } from './payment';

export class WalletService {
  
  /**
   * Create a wallet for a new patient
   */
  async createWallet(patientId: number, initialBalance: number = 0): Promise<PatientWallet> {
    try {
      const [wallet] = await db.insert(patientWallets)
        .values({
          patientId,
          balance: initialBalance.toFixed(2),
          totalEarned: initialBalance.toFixed(2),
          totalSpent: "0.00"
        })
        .returning();
      
      console.log(`Created wallet for patient ${patientId} with balance ₹${initialBalance}`);
      return wallet;
    } catch (error) {
      console.error('Error creating wallet:', error);
      throw new Error('Failed to create wallet');
    }
  }

  /**
   * Get or create wallet for a patient
   */
  async getOrCreateWallet(patientId: number): Promise<PatientWallet> {
    // Try to find existing wallet
    const [existingWallet] = await db
      .select()
      .from(patientWallets)
      .where(eq(patientWallets.patientId, patientId))
      .limit(1);
    
    if (existingWallet) {
      return existingWallet;
    }

    // New wallets start empty. This used to seed ₹1000 of test credit, which would
    // have become real spendable money once payments went live. Existing balances are
    // left untouched — this only changes wallets created from now on.
    return this.createWallet(patientId, 0);
  }

  /**
   * Get wallet balance for a patient
   */
  async getWalletBalance(patientId: number): Promise<number> {
    const wallet = await this.getOrCreateWallet(patientId);
    return parseFloat(wallet.balance);
  }

  /**
   * Process a wallet transaction
   */
  async processTransaction(transactionData: {
    patientId: number;
    amount: number;
    transactionType: WalletTransactionType;
    description: string;
    appointmentId?: number;
    scheduleId?: number;
    processedBy?: number;
    referenceId?: string;
    metadata?: any;
  }): Promise<WalletTransaction> {
    const { 
      patientId, 
      amount, 
      transactionType, 
      description, 
      appointmentId,
      scheduleId,
      processedBy,
      referenceId,
      metadata 
    } = transactionData;
    
    try {
      // Get or create wallet (outside tx — just to obtain wallet.id)
      const wallet = await this.getOrCreateWallet(patientId);

      // Determine credit vs debit (pure logic, no DB)
      const isCredit = [
        'refund_schedule_cancel',
        'refund_doctor_absent',
        'partial_refund',
        'admin_credit',
        'wallet_topup'
      ].includes(transactionType);

      // All balance work happens INSIDE the transaction with a row-level lock
      return await db.transaction(async (tx) => {
        // Lock the wallet row to prevent concurrent balance modifications
        const [lockedWallet] = await tx.select()
          .from(patientWallets)
          .where(eq(patientWallets.id, wallet.id))
          .for('update');

        const currentBalance = parseFloat(lockedWallet.balance);
        let totalEarned = parseFloat(lockedWallet.totalEarned);
        let totalSpent = parseFloat(lockedWallet.totalSpent);
        let newBalance: number;

        if (isCredit) {
          newBalance = currentBalance + amount;
          if (transactionType.includes('refund')) {
            totalEarned += amount;
          }
        } else {
          if (currentBalance < amount) {
            throw new Error('Insufficient wallet balance');
          }
          newBalance = currentBalance - amount;
          if (transactionType === 'appointment_payment') {
            totalSpent += amount;
          }
        }

        const [transaction] = await tx.insert(walletTransactions)
          .values({
            walletId: wallet.id,
            patientId,
            appointmentId: appointmentId || null,
            scheduleId: scheduleId || null,
            transactionType,
            amount: amount.toFixed(2),
            previousBalance: currentBalance.toFixed(2),
            newBalance: newBalance.toFixed(2),
            description,
            referenceId: referenceId || null,
            processedBy: processedBy || null,
            status: 'completed',
            metadata: metadata ? JSON.stringify(metadata) : null
          })
          .returning();

        await tx.update(patientWallets)
          .set({
            balance: newBalance.toFixed(2),
            totalEarned: totalEarned.toFixed(2),
            totalSpent: totalSpent.toFixed(2),
            updatedAt: new Date()
          })
          .where(eq(patientWallets.id, wallet.id));

        console.log(`Processed ${transactionType} transaction: ₹${amount} for patient ${patientId}. New balance: ₹${newBalance}`);

        return transaction;
      });

    } catch (error) {
      console.error('Error processing wallet transaction:', error);
      throw error;
    }
  }

  /**
   * Process appointment payment
   */
  async processAppointmentPayment(
    patientId: number,
    appointmentId: number,
    consultationFee: number,
    processedBy?: number
  ): Promise<WalletTransaction> {
    return this.processTransaction({
      patientId,
      amount: consultationFee,
      transactionType: 'appointment_payment',
      description: `Payment for appointment #${appointmentId}`,
      appointmentId,
      processedBy,
      metadata: { appointmentId, consultationFee }
    });
  }

  /**
   * Process schedule cancellation refunds for all affected appointments
   */
  async processScheduleCancellationRefunds(
    scheduleId: number,
    cancelReason: string,
    processedByUserId: number
  ): Promise<{
    refundedAppointments: number;
    totalRefundAmount: number;
    refundDetails: any[];
  }> {
    try {
      console.log(`Processing schedule cancellation refunds for schedule ${scheduleId}`);
      
      // Get all eligible appointments for refund from this schedule
      const eligibleAppointments = await db
        .select({
          appointment: appointments,
          doctorName: users.name
        })
        .from(appointments)
        .innerJoin(users, eq(appointments.doctorId, users.id))
        .where(
          and(
            eq(appointments.scheduleId, scheduleId),
            eq(appointments.isRefundEligible, true),
            eq(appointments.hasBeenRefunded, false),
            eq(appointments.isPaid, true),
            // Only refund appointments that haven't been completed
            sql`${appointments.status} NOT IN ('completed', 'no_show', 'expired')`
          )
        );
      
      console.log(`Found ${eligibleAppointments.length} eligible appointments for refund`);
      
      if (eligibleAppointments.length === 0) {
        return {
          refundedAppointments: 0,
          totalRefundAmount: 0,
          refundDetails: []
        };
      }
      
      let totalRefundAmount = 0;
      const refundDetails: any[] = [];
      
      // Process each appointment refund
      for (const { appointment, doctorName } of eligibleAppointments) {
        if (!appointment.patientId) continue; // Skip walk-in appointments

        // Never refund a simulated payment — no money was collected, so crediting the
        // wallet would create real spendable balance out of nothing.
        if (await paymentService.isSimulatedPayment(appointment.id)) {
          console.log(`Skipping refund for appointment ${appointment.id}: simulated payment`);
          continue;
        }

        const consultationFee = parseFloat(appointment.consultationFee);
        
        try {
          // Create wallet transaction for refund
          const walletTransaction = await this.processTransaction({
            patientId: appointment.patientId,
            amount: consultationFee,
            transactionType: 'refund_schedule_cancel',
            description: `Refund for cancelled appointment with Dr. ${doctorName} - ${cancelReason}`,
            appointmentId: appointment.id,
            scheduleId: appointment.scheduleId!,
            processedBy: processedByUserId,
            metadata: {
              originalAppointmentId: appointment.id,
              cancelReason,
              doctorName
            }
          });
          
          // Create refund record
          await db.insert(appointmentRefunds)
            .values({
              appointmentId: appointment.id,
              patientId: appointment.patientId,
              scheduleId: appointment.scheduleId!,
              doctorId: appointment.doctorId!,
              clinicId: appointment.clinicId!,
              originalAmount: consultationFee.toFixed(2),
              refundAmount: consultationFee.toFixed(2),
              refundReason: cancelReason,
              refundType: 'full',
              walletTransactionId: walletTransaction.id,
              processedBy: processedByUserId,
              notes: `Schedule cancelled - full refund processed`
            });
          
          // Update appointment refund status
          await db.update(appointments)
            .set({
              hasBeenRefunded: true,
              refundAmount: consultationFee.toFixed(2),
              status: 'cancel' // Update appointment status to cancelled
            })
            .where(eq(appointments.id, appointment.id));
          
          totalRefundAmount += consultationFee;
          refundDetails.push({
            appointmentId: appointment.id,
            patientId: appointment.patientId,
            refundAmount: consultationFee,
            walletTransactionId: walletTransaction.id
          });
          
          // Send refund notification
          try {
            await notificationService.createNotification({
              userId: appointment.patientId,
              appointmentId: appointment.id,
              title: "Refund Processed",
              message: `₹${consultationFee} has been refunded to your wallet due to schedule cancellation - ${cancelReason}`,
              type: "wallet_refund"
            });
          } catch (notifError) {
            console.error('Error sending refund notification:', notifError);
          }
          
        } catch (error) {
          console.error(`Error processing refund for appointment ${appointment.id}:`, error);
        }
      }
      
      console.log(`Successfully processed ${refundDetails.length} refunds totaling ₹${totalRefundAmount}`);
      
      return {
        refundedAppointments: refundDetails.length,
        totalRefundAmount,
        refundDetails
      };
      
    } catch (error) {
      console.error('Error processing schedule cancellation refunds:', error);
      throw error;
    }
  }

  /**
   * Process refund for a single cancelled appointment
   */
  async processSingleAppointmentRefund(
    appointmentId: number,
    cancelReason: string,
    processedByUserId: number
  ): Promise<{ refunded: boolean; refundAmount: number }> {
    const [appt] = await db
      .select({ appointment: appointments, doctorName: users.name })
      .from(appointments)
      .innerJoin(users, eq(appointments.doctorId, users.id))
      .where(eq(appointments.id, appointmentId));

    if (!appt) return { refunded: false, refundAmount: 0 };

    const { appointment, doctorName } = appt;

    // Only refund if eligible, paid, and not already refunded
    if (!appointment.isRefundEligible || !appointment.isPaid || appointment.hasBeenRefunded || !appointment.patientId) {
      return { refunded: false, refundAmount: 0 };
    }

    // A simulated payment collected no money. Crediting the wallet for one would create
    // real, spendable balance out of nothing (book free online -> cancel -> get credit).
    if (await paymentService.isSimulatedPayment(appointment.id)) {
      console.log(`Skipping refund for appointment ${appointment.id}: simulated payment, no funds collected`);
      return { refunded: false, refundAmount: 0 };
    }

    const consultationFee = parseFloat(appointment.consultationFee);

    const walletTransaction = await this.processTransaction({
      patientId: appointment.patientId,
      amount: consultationFee,
      transactionType: 'refund_schedule_cancel',
      description: `Refund for cancelled appointment with Dr. ${doctorName} - ${cancelReason}`,
      appointmentId: appointment.id,
      scheduleId: appointment.scheduleId!,
      processedBy: processedByUserId,
      metadata: { originalAppointmentId: appointment.id, cancelReason, doctorName }
    });

    await db.insert(appointmentRefunds).values({
      appointmentId: appointment.id,
      patientId: appointment.patientId,
      scheduleId: appointment.scheduleId!,
      doctorId: appointment.doctorId!,
      clinicId: appointment.clinicId!,
      originalAmount: consultationFee.toFixed(2),
      refundAmount: consultationFee.toFixed(2),
      refundReason: cancelReason,
      refundType: 'full',
      walletTransactionId: walletTransaction.id,
      processedBy: processedByUserId,
      notes: 'Appointment cancelled by attender - full refund'
    });

    await db.update(appointments)
      .set({ hasBeenRefunded: true, refundAmount: consultationFee.toFixed(2) })
      .where(eq(appointments.id, appointment.id));

    try {
      await notificationService.createNotification({
        userId: appointment.patientId,
        appointmentId: appointment.id,
        title: 'Refund Processed',
        message: `₹${consultationFee} has been refunded to your wallet - ${cancelReason}`,
        type: 'wallet_refund'
      });
    } catch (e) {
      console.error('Error sending refund notification:', e);
    }

    return { refunded: true, refundAmount: consultationFee };
  }

  /**
   * Process partial refund when doctor leaves mid-session
   */
  async processPartialRefund(
    scheduleId: number,
    completedAppointmentIds: number[],
    cancelReason: string,
    processedByUserId: number
  ): Promise<{
    refundedAppointments: number;
    totalRefundAmount: number;
    refundDetails: any[];
  }> {
    try {
      console.log(`Processing partial refunds for schedule ${scheduleId}, completed appointments: ${completedAppointmentIds}`);
      
      // Get all appointments that should be refunded (not completed)
      const eligibleAppointments = await db
        .select({
          appointment: appointments,
          doctorName: users.name
        })
        .from(appointments)
        .innerJoin(users, eq(appointments.doctorId, users.id))
        .where(
          and(
            eq(appointments.scheduleId, scheduleId),
            eq(appointments.isRefundEligible, true),
            eq(appointments.hasBeenRefunded, false),
            eq(appointments.isPaid, true),
            // Refund all waiting patients (token_started, hold, pause, scheduled)
            sql`${appointments.status} NOT IN ('completed', 'no_show', 'cancel', 'expired')`
          )
        );
      
      console.log(`Found ${eligibleAppointments.length} eligible appointments for partial refund`);
      
      if (eligibleAppointments.length === 0) {
        return {
          refundedAppointments: 0,
          totalRefundAmount: 0,
          refundDetails: []
        };
      }
      
      let totalRefundAmount = 0;
      const refundDetails: any[] = [];
      
      // Process each appointment refund
      for (const { appointment, doctorName } of eligibleAppointments) {
        if (!appointment.patientId) continue; // Skip walk-in appointments

        // Never refund a simulated payment — no money was collected, so crediting the
        // wallet would create real spendable balance out of nothing.
        if (await paymentService.isSimulatedPayment(appointment.id)) {
          console.log(`Skipping refund for appointment ${appointment.id}: simulated payment`);
          continue;
        }

        const consultationFee = parseFloat(appointment.consultationFee);
        
        try {
          // Create wallet transaction for refund
          const walletTransaction = await this.processTransaction({
            patientId: appointment.patientId,
            amount: consultationFee,
            transactionType: 'partial_refund',
            description: `Refund for uncompleted appointment with Dr. ${doctorName} - ${cancelReason}`,
            appointmentId: appointment.id,
            scheduleId: appointment.scheduleId!,
            processedBy: processedByUserId,
            metadata: {
              originalAppointmentId: appointment.id,
              cancelReason,
              doctorName,
              refundType: 'partial_session'
            }
          });
          
          // Create refund record
          await db.insert(appointmentRefunds)
            .values({
              appointmentId: appointment.id,
              patientId: appointment.patientId,
              scheduleId: appointment.scheduleId!,
              doctorId: appointment.doctorId!,
              clinicId: appointment.clinicId!,
              originalAmount: consultationFee.toFixed(2),
              refundAmount: consultationFee.toFixed(2),
              refundReason: cancelReason,
              refundType: 'partial',
              walletTransactionId: walletTransaction.id,
              processedBy: processedByUserId,
              notes: `Doctor left mid-session - full refund for uncompleted appointment`
            });
          
          // Update appointment refund status
          await db.update(appointments)
            .set({
              hasBeenRefunded: true,
              refundAmount: consultationFee.toFixed(2),
              status: 'cancel'
            })
            .where(eq(appointments.id, appointment.id));
          
          totalRefundAmount += consultationFee;
          refundDetails.push({
            appointmentId: appointment.id,
            patientId: appointment.patientId,
            refundAmount: consultationFee,
            walletTransactionId: walletTransaction.id
          });
          
          // Send refund notification
          try {
            await notificationService.createNotification({
              userId: appointment.patientId,
              appointmentId: appointment.id,
              title: "Refund Processed",
              message: `₹${consultationFee} has been refunded to your wallet - ${cancelReason}`,
              type: "wallet_refund"
            });
          } catch (notifError) {
            console.error('Error sending refund notification:', notifError);
          }
          
        } catch (error) {
          console.error(`Error processing partial refund for appointment ${appointment.id}:`, error);
        }
      }
      
      console.log(`Successfully processed ${refundDetails.length} partial refunds totaling ₹${totalRefundAmount}`);
      
      return {
        refundedAppointments: refundDetails.length,
        totalRefundAmount,
        refundDetails
      };
      
    } catch (error) {
      console.error('Error processing partial refunds:', error);
      throw error;
    }
  }

  /**
   * Mark patient as no-show (no refund)
   */
  async markPatientNoShow(appointmentId: number, processedByUserId: number, notes?: string): Promise<void> {
    try {
      await db.update(appointments)
        .set({
          status: 'no_show',
          isRefundEligible: false,
          statusNotes: notes || 'Patient did not show up for appointment'
        })
        .where(eq(appointments.id, appointmentId));
      
      console.log(`Marked appointment ${appointmentId} as no-show - no refund`);
    } catch (error) {
      console.error('Error marking patient as no-show:', error);
      throw error;
    }
  }

  /**
   * Get wallet transaction history for a patient
   */
  async getWalletTransactions(
    patientId: number, 
    limit: number = 50, 
    offset: number = 0
  ): Promise<WalletTransaction[]> {
    try {
      const transactions = await db
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.patientId, patientId))
        .orderBy(desc(walletTransactions.createdAt))
        .limit(limit)
        .offset(offset);
      
      return transactions;
    } catch (error) {
      console.error('Error fetching wallet transactions:', error);
      throw error;
    }
  }

  /**
   * Get wallet summary for a patient
   */
  async getWalletSummary(patientId: number): Promise<{
    wallet: PatientWallet;
    recentTransactions: WalletTransaction[];
    stats: {
      totalTransactions: number;
      totalRefunds: number;
      totalSpent: number;
    };
  }> {
    try {
      const wallet = await this.getOrCreateWallet(patientId);
      const recentTransactions = await this.getWalletTransactions(patientId, 10);
      
      // Get transaction stats
      const [stats] = await db
        .select({
          totalTransactions: sql<number>`COUNT(*)`,
          totalRefunds: sql<number>`SUM(CASE WHEN transaction_type LIKE 'refund%' THEN amount ELSE 0 END)`,
          totalSpent: sql<number>`SUM(CASE WHEN transaction_type = 'appointment_payment' THEN amount ELSE 0 END)`
        })
        .from(walletTransactions)
        .where(eq(walletTransactions.patientId, patientId));
      
      return {
        wallet,
        recentTransactions,
        stats: {
          totalTransactions: stats?.totalTransactions || 0,
          totalRefunds: parseFloat(stats?.totalRefunds?.toString() || '0'),
          totalSpent: parseFloat(stats?.totalSpent?.toString() || '0')
        }
      };
    } catch (error) {
      console.error('Error fetching wallet summary:', error);
      throw error;
    }
  }

  /**
   * Admin function to credit/debit patient wallet
   */
  async adminWalletTransaction(
    patientId: number,
    amount: number,
    isCredit: boolean,
    reason: string,
    adminId: number
  ): Promise<WalletTransaction> {
    return this.processTransaction({
      patientId,
      amount,
      transactionType: isCredit ? 'admin_credit' : 'admin_debit',
      description: `Admin ${isCredit ? 'credit' : 'debit'}: ${reason}`,
      processedBy: adminId,
      metadata: {
        adminAction: true,
        reason,
        adminId
      }
    });
  }
}

export const walletService = new WalletService();