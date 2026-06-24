// Ended-schedule token resolution workflow.
// Settles the leftover tokens of a schedule whose end time has passed:
//   seen -> completed (no refund) | no_show -> no_show (no refund) | refund -> cancel + wallet refund.
// Kept in a focused service (out of routes.ts and storage.ts) per the project's
// validate -> service -> return guideline.
import { db } from '../db';
import { appointments } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { storage } from '../storage';
import { walletService } from './wallet';

export type ResolutionOutcome = 'seen' | 'no_show' | 'refund';

export interface ResolutionInput {
  appointmentId: number;
  outcome: ResolutionOutcome | string;
}

export interface ResolutionSummary {
  completed: number;
  noShow: number;
  refunded: number;
  totalRefund: number;
  skipped: number;
}

interface OwnableUser {
  id: number;
  role: string;
  clinicId?: number | null;
}

interface ScheduleLike {
  doctorId?: number | null;
  clinicId?: number | null;
  date?: string | null;
  endTime?: string | null;
}

const SETTLEABLE_STATUSES = ['token_started', 'hold', 'scheduled'];

// Combine the schedule's date (YYYY-MM-DD) + endTime (HH:MM[:SS]) in server-local time
// and report whether it is now in the past. Server-side guard — never trust a client "ended" flag.
export function isScheduleEnded(schedule: ScheduleLike): boolean {
  if (!schedule?.date || !schedule?.endTime) return false;
  const [y, mo, d] = String(schedule.date).split('-').map(Number);
  const [h, mi] = String(schedule.endTime).split(':').map(Number);
  if (!y || !mo || !d) return false;
  const end = new Date(y, mo - 1, d, h || 0, mi || 0, 0, 0);
  return new Date() > end;
}

// Per-schedule ownership: a user may only resolve a schedule they actually manage.
//   super_admin -> any | clinic_admin -> own clinic | attender -> a doctor they manage.
export async function userCanResolveSchedule(user: OwnableUser, schedule: ScheduleLike): Promise<boolean> {
  if (user.role === 'super_admin') return true;
  if (user.role === 'clinic_admin') {
    return !!user.clinicId && schedule.clinicId === user.clinicId;
  }
  if (user.role === 'attender') {
    const managed = await storage.getAttenderDoctors(user.id);
    return managed.some((m) => m.doctorId === schedule.doctorId);
  }
  return false;
}

// Settle one token to a terminal status WITHOUT firing queue/"your turn" notifications
// (the schedule is already over). For 'completed', backfill timings only when missing so an
// earlier real in_progress start time is preserved.
async function settleToken(
  appointmentId: number,
  status: 'completed' | 'no_show' | 'cancel',
  statusNotes: string,
  existingStartTime: Date | null
): Promise<void> {
  const updateData: Partial<typeof appointments.$inferInsert> = { status, statusNotes };
  if (status === 'completed') {
    const now = new Date();
    updateData.actualEndTime = now;
    if (!existingStartTime) {
      // Estimate a start time so duration-based reports stay sane — but never overwrite a real one.
      updateData.actualStartTime = new Date(now.getTime() - 15 * 60 * 1000);
    }
  }
  await db.update(appointments).set(updateData).where(eq(appointments.id, appointmentId));
}

export async function resolveEndedScheduleTokens(
  scheduleId: number,
  resolutions: ResolutionInput[],
  processedByUserId: number
): Promise<ResolutionSummary> {
  const summary: ResolutionSummary = { completed: 0, noShow: 0, refunded: 0, totalRefund: 0, skipped: 0 };

  for (const r of resolutions) {
    const appointmentId = Number(r?.appointmentId);
    const outcome = r?.outcome as ResolutionOutcome;
    if (!appointmentId || !['seen', 'no_show', 'refund'].includes(outcome)) {
      summary.skipped++;
      continue;
    }

    const appt = await storage.getAppointment(appointmentId);
    // Skip anything not part of this schedule or already terminal — prevents double refunds.
    if (!appt || appt.scheduleId !== scheduleId || !SETTLEABLE_STATUSES.includes(appt.status || '')) {
      summary.skipped++;
      continue;
    }

    const startTime = appt.actualStartTime ?? null;

    if (outcome === 'seen') {
      await settleToken(appointmentId, 'completed', 'Resolved after schedule end — patient was consulted', startTime);
      summary.completed++;
    } else if (outcome === 'no_show') {
      await settleToken(appointmentId, 'no_show', 'Resolved after schedule end — patient did not attend', startTime);
      summary.noShow++;
    } else if (outcome === 'refund') {
      // Refund FIRST so a failure leaves the token still settleable (token_started) for a safe
      // retry — never a cancelled-but-unrefunded token. Only mark cancelled once refund returns.
      const rr = await walletService.processSingleAppointmentRefund(
        appointmentId,
        'Doctor unavailable — schedule ended',
        processedByUserId
      );
      await settleToken(appointmentId, 'cancel', 'Doctor unavailable — schedule ended', startTime);
      if (rr.refunded) {
        summary.refunded++;
        summary.totalRefund += rr.refundAmount;
      }
    }
  }

  // Mark the schedule completed so it clears from the "needs resolution" banner.
  // Every settleable token is now terminal, so completeSchedule's "cancel remaining" is a no-op.
  try {
    await storage.completeSchedule(scheduleId);
  } catch (e) {
    console.error('Error marking schedule completed after token resolution:', e);
  }

  return summary;
}
