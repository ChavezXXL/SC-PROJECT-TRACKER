// ═════════════════════════════════════════════════════════════════════
// Bath-spec evaluator — pure function that takes a reading + tank spec
// and returns any alerts that should be created. Used by the chemistry
// log form (client-side validation) and could run server-side later.
// ═════════════════════════════════════════════════════════════════════

import type { BathAlert, ChemistryReading, Tank } from './types';

type PendingAlert = Omit<BathAlert, 'id' | 'createdAt'>;

/**
 * Evaluate a single chemistry reading against a tank's spec.
 * Returns the alerts that *would* fire (caller persists them).
 */
export function evaluateReading(
  tank: Tank,
  reading: ChemistryReading,
  readingId: string
): PendingAlert[] {
  const alerts: PendingAlert[] = [];
  const spec = tank.spec || {};

  // pH window
  if (reading.ph !== undefined) {
    if (spec.phMin !== undefined && reading.ph < spec.phMin) {
      alerts.push({
        tankId: tank.id,
        readingId,
        parameter: 'ph',
        severity: reading.ph < spec.phMin - 0.5 ? 'critical' : 'warn',
        message: `pH ${reading.ph} below minimum ${spec.phMin}`,
      });
    } else if (spec.phMax !== undefined && reading.ph > spec.phMax) {
      alerts.push({
        tankId: tank.id,
        readingId,
        parameter: 'ph',
        severity: reading.ph > spec.phMax + 0.5 ? 'critical' : 'warn',
        message: `pH ${reading.ph} above maximum ${spec.phMax}`,
      });
    }
  }

  // Temperature window (°F — we standardize on °F for SC's market)
  if (reading.tempF !== undefined) {
    if (spec.tempMinF !== undefined && reading.tempF < spec.tempMinF) {
      alerts.push({
        tankId: tank.id,
        readingId,
        parameter: 'temp',
        severity: 'warn',
        message: `Temperature ${reading.tempF}°F below minimum ${spec.tempMinF}°F`,
      });
    } else if (spec.tempMaxF !== undefined && reading.tempF > spec.tempMaxF) {
      alerts.push({
        tankId: tank.id,
        readingId,
        parameter: 'temp',
        severity: reading.tempF > spec.tempMaxF + 10 ? 'critical' : 'warn',
        message: `Temperature ${reading.tempF}°F above maximum ${spec.tempMaxF}°F`,
      });
    }
  }

  // Metal concentration
  if (reading.metalConcentration !== undefined) {
    if (spec.metalMin !== undefined && reading.metalConcentration < spec.metalMin) {
      alerts.push({
        tankId: tank.id,
        readingId,
        parameter: 'metal',
        severity: 'warn',
        message: `Metal conc ${reading.metalConcentration} below minimum ${spec.metalMin}`,
      });
    } else if (spec.metalMax !== undefined && reading.metalConcentration > spec.metalMax) {
      alerts.push({
        tankId: tank.id,
        readingId,
        parameter: 'metal',
        severity: 'warn',
        message: `Metal conc ${reading.metalConcentration} above maximum ${spec.metalMax}`,
      });
    }
  }

  return alerts;
}

/**
 * Returns true if a tank is overdue for its next chemistry reading.
 * Used by the dashboard to highlight rows that need attention.
 */
export function isReadingOverdue(tank: Tank, now: number = Date.now()): boolean {
  if (!tank.readingIntervalHours) return false;
  if (!tank.lastReadingAt) return true; // never read → overdue
  const hoursSince = (now - tank.lastReadingAt) / 3_600_000;
  return hoursSince >= tank.readingIntervalHours;
}

/**
 * Hours until a tank's next reading is due (negative = overdue).
 */
export function hoursUntilNextReading(tank: Tank, now: number = Date.now()): number | null {
  if (!tank.readingIntervalHours || !tank.lastReadingAt) return null;
  const hoursSince = (now - tank.lastReadingAt) / 3_600_000;
  return tank.readingIntervalHours - hoursSince;
}
