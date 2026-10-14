export interface GroupScheduleConfig {
  timezone?: string | null;
  nextDayRolloverHour?: number | null;
  groupReportTime?: string | null;
  workDays?: string | null;
}

const WEEKDAY_MAP: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
  weekdayIso: number;
}

export const getLocalDateParts = (date: Date = new Date(), timezone: string = 'Asia/Bishkek'): LocalDateParts => {
  let validTz = timezone || 'Asia/Bishkek';
  try {
    Intl.DateTimeFormat(undefined, { timeZone: validTz });
  } catch {
    validTz = 'Asia/Bishkek';
  }

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: validTz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  });

  const parts = formatter.formatToParts(date);
  const timeObj: any = {};
  for (const part of parts) {
    if (part.type === 'weekday') {
      timeObj.weekday = part.value;
    } else if (part.type !== 'literal') {
      timeObj[part.type] = parseInt(part.value, 10);
    }
  }
  if (timeObj.hour === 24) timeObj.hour = 0;
  timeObj.weekdayIso = WEEKDAY_MAP[timeObj.weekday] || 1;
  return timeObj as LocalDateParts;
};

export const parseWorkDays = (workDays?: string | null): number[] => {
  if (!workDays) return [1, 2, 3, 4, 5];
  const parsed = workDays
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => n >= 1 && n <= 7);
  return parsed.length > 0 ? parsed : [1, 2, 3, 4, 5];
};

export const getReportingDateInfo = (config?: GroupScheduleConfig, now: Date = new Date()): { reportDate: string; isoDate: string } => {
  const tz = config?.timezone || 'Asia/Bishkek';
  const rolloverHour = config?.nextDayRolloverHour ?? 16;
  const workDays = parseWorkDays(config?.workDays);

  const targetDate = new Date(now.getTime());
  let parts = getLocalDateParts(targetDate, tz);

  // If after rollover hour (e.g. 16:00 local time), it is considered the next reporting day
  if (parts.hour >= rolloverHour) {
    targetDate.setUTCDate(targetDate.getUTCDate() + 1);
    parts = getLocalDateParts(targetDate, tz);
  }

  // Shift forward while target day falls on a non-workday (e.g. Saturday or Sunday)
  let safety = 0;
  while (!workDays.includes(parts.weekdayIso) && safety < 8) {
    targetDate.setUTCDate(targetDate.getUTCDate() + 1);
    parts = getLocalDateParts(targetDate, tz);
    safety++;
  }

  const reportDate = `${parts.day}.${parts.month}.${parts.year}`;
  const isoDate = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  return { reportDate, isoDate };
};

export const isGroupReportTimePassed = (config?: GroupScheduleConfig, now: Date = new Date()): boolean => {
  const tz = config?.timezone || 'Asia/Bishkek';
  const rolloverHour = config?.nextDayRolloverHour ?? 16;
  const workDays = parseWorkDays(config?.workDays);
  const reportTimeStr = config?.groupReportTime || '09:15';

  const parts = getLocalDateParts(now, tz);

  // On non-workdays (weekends) or after rolloverHour (e.g. 16:00) on workdays,
  // it is already the reporting period for the next work day, so the morning deadline hasn't passed yet.
  if (!workDays.includes(parts.weekdayIso) || parts.hour >= rolloverHour) {
    return false;
  }

  const [rHourStr, rMinStr] = reportTimeStr.split(':');
  const reportHour = parseInt(rHourStr || '9', 10);
  const reportMinute = parseInt(rMinStr || '15', 10);

  const currentTimeInMinutes = parts.hour * 60 + parts.minute;
  const reportTimeInMinutes = reportHour * 60 + reportMinute;

  return currentTimeInMinutes > reportTimeInMinutes;
};

export const reportDateToIso = (reportDate: string): string => {
  const parts = reportDate.split('.');
  if (parts.length !== 3) return reportDate;
  const [day, month, year] = parts;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};

export const isoToReportDate = (isoDate: string): string => {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const [year, month, day] = parts;
  return `${parseInt(day, 10)}.${parseInt(month, 10)}.${year}`;
};

export const getIsoDateDaysAgo = (days: number, timezone: string = 'Asia/Bishkek'): string => {
  const target = new Date();
  target.setUTCDate(target.getUTCDate() - days);
  const parts = getLocalDateParts(target, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
};
