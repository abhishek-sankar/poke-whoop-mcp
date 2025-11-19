import { WhoopApiClient } from './client.js';
import { Cycle, Sleep } from './types.js';

export interface TodayMetrics {
  sleep_hours: number | null;
  sleep_score: number | null;
  light_sleep_hours: number | null;
  deep_sleep_hours: number | null;
  rem_sleep_hours: number | null;

  strain: number | null;
  calories: number | null;
  cycle_id: number | null;
  sleep_id: string | null;
}

interface TimedRecord {
  start: string;
  end?: string;
  timezone_offset?: string;
}

const MILLISECONDS_PER_HOUR = 3_600_000;
const KILOJOULE_TO_KILOCALORIE = 0.239005736;

function parseOffsetMinutes(offset?: string): number | null {
  if (!offset) {
    return null;
  }

  const match = offset.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, sign, hoursStr, minutesStr] = match;
  const hours = Number.parseInt(hoursStr, 10);
  const minutes = Number.parseInt(minutesStr, 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  const totalMinutes = hours * 60 + minutes;
  return sign === '-' ? -totalMinutes : totalMinutes;
}

function isSameLocalDate(value: TimedRecord, reference: Date): boolean {
  const offsetMinutes = parseOffsetMinutes(value.timezone_offset);
  if (offsetMinutes === null) {
    return false;
  }

  const targetDate = value.end ?? value.start;
  const local = new Date(new Date(targetDate).getTime() + offsetMinutes * 60_000);
  const nowLocal = new Date(reference.getTime() + offsetMinutes * 60_000);

  return (
    local.getUTCFullYear() === nowLocal.getUTCFullYear() &&
    local.getUTCMonth() === nowLocal.getUTCMonth() &&
    local.getUTCDate() === nowLocal.getUTCDate()
  );
}

function hoursFromMilliseconds(value?: number | null): number | null {
  if (typeof value !== 'number') {
    return null;
  }

  return Number((value / MILLISECONDS_PER_HOUR).toFixed(2));
}

function durationHours(record: Sleep | undefined): number | null {
  if (!record) {
    return null;
  }

  const start = new Date(record.start).getTime();
  const end = new Date(record.end).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return null;
  }

  return Number(((end - start) / MILLISECONDS_PER_HOUR).toFixed(2));
}

function pickRecordForToday<T extends TimedRecord>(records: T[], reference: Date): T | undefined {
  return records.find((record) => isSameLocalDate(record, reference)) ?? records[0];
}

export async function getTodayMetrics(whoopClient: WhoopApiClient, key = 'default'): Promise<TodayMetrics> {
  const [sleepResponse, cycleResponse] = await Promise.all([
    whoopClient.listSleep({ limit: 10 }, key),
    whoopClient.listCycles({ limit: 10 }, key),
  ]);

  const now = new Date();
  const sleepRecord = pickRecordForToday<Sleep>(sleepResponse.records, now);
  const cycleRecord = pickRecordForToday<Cycle>(cycleResponse.records, now);

  const stageSummary = sleepRecord?.score?.stage_summary;
  const cycleScore = cycleRecord?.score;

  const calories = typeof cycleScore?.kilojoule === 'number'
    ? Number((cycleScore.kilojoule * KILOJOULE_TO_KILOCALORIE).toFixed(2))
    : null;

  return {
    sleep_hours: durationHours(sleepRecord),
    sleep_score: sleepRecord?.score?.sleep_performance_percentage ?? null,
    light_sleep_hours: hoursFromMilliseconds(stageSummary?.total_light_sleep_time_milli),
    deep_sleep_hours: hoursFromMilliseconds(stageSummary?.total_slow_wave_sleep_time_milli),
    rem_sleep_hours: hoursFromMilliseconds(stageSummary?.total_rem_sleep_time_milli),

    strain: cycleScore?.strain ?? null,
    calories,
    cycle_id: cycleRecord?.id ?? null,
    sleep_id: sleepRecord?.id ?? null,
  };
}

