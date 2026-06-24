// Ended-schedule token resolution workflow.
// Settles the leftover tokens of a schedule whose end time has passed:
//   seen -> completed (no refund) | no_show -> no_show (no refund) | refund -> cancel + wallet refund.
// Kept in a focused service (out of routes.ts and storage.ts) per the project's
// validate -> service -> return guideline.
import { db } from '../db';
import { appointments } from '@shared/schema';
import { eq, and, inArray } from 'drizzle-orm';
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
//
// The write is an ATOMIC conditional update: it only changes the row while it is still
// settleable AND belongs to this schedule. Under concurrent resolver requests the loser writes
// 0 rows (returns false) — so a terminal status is never overwritten and the summary is never
// double-counted. Returns whether this call actually performed the write.
async function settleToken(
  appointmentId: number,
  scheduleId: number,
  status: 'completed' | 'no_show' | 'cancel',
  statusNotes: string,
  existingStartTime: Date | null
): Promise<boolean> {
  const updateData: Partial<typeof appointments.$inferInsert> = { status, statusNotes };
  if (status === 'completed') {
    const now = new Date();
    updateData.actualEndTime = now;
    if (!existingStartTime) {
      // Estimate a start time so duration-based reports stay sane — but never overwrite a real one.
      updateData.actualStartTime = new Date(now.getTime() - 15 * 60 * 1000);
    }
  }
  const written = await db
    .update(appointments)
    .set(updateData)
    .where(and(
      eq(appointments.id, appointmentId),
      eq(appointments.scheduleId, scheduleId),
      inArray(appointments.status, SETTLEABLE_STATUSES)
    ))
    .returning({ id: appointments.id });
  return written.length > 0;
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
      if (await settleToken(appointmentId, scheduleId, 'completed', 'Resolved after schedule end — patient was consulted', startTime)) {
        summary.completed++;
      } else {
        summary.skipped++; // a concurrent request already settled it
      }
    } else if (outcome === 'no_show') {
      if (await settleToken(appointmentId, scheduleId, 'no_show', 'Resolved after schedule end — patient did not attend', startTime)) {
        summary.noShow++;
      } else {
        summary.skipped++;
      }
    } else if (outcome === 'refund') {
      // Refund FIRST so a failure leaves the token still settleable for a safe retry — never a
      // cancelled-but-unrefunded token. The refund is idempotent (hasBeenRefunded guard), so under
      // concurrency exactly one call moves money; count refunded on that, not on the status write.
      const rr = await walletService.processSingleAppointmentRefund(
        appointmentId,
        'Doctor unavailable — schedule ended',
        processedByUserId
      );
      await settleToken(appointmentId, scheduleId, 'cancel', 'Doctor unavailable — schedule ended', startTime);
      if (rr.refunded) {
        summary.refunded++;
        summary.totalRefund += rr.refundAmount;
      }
    }
  }

  // Finalize the schedule ONLY when no settleable tokens remain. If this request did not cover
  // every leftover token, leave the schedule open — otherwise completeSchedule would silently
  // cancel still-undecided tokens (no per-token decision, no refund), and the banner must persist.
  const remaining = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(and(
      eq(appointments.scheduleId, scheduleId),
      inArray(appointments.status, SETTLEABLE_STATUSES)
    ));

  if (remaining.length === 0) {
    try {
      await storage.completeSchedule(scheduleId);
    } catch (e) {
      console.error('Error marking schedule completed after token resolution:', e);
    }
  }

  return summary;
}
