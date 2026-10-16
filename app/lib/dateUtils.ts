/**
 * Utilities for consistent Indian Standard Time (IST, UTC+05:30) date/time parsing and formatting.
 */

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

/**
 * Parses a date/time string from the LIS or external source and converts it
 * to a JavaScript Date representing the exact moment in IST (UTC+05:30).
 */
export function parseISTDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const str = dateStr.trim();
  if (!str || str === '--' || str === '-') return null;

  // 1. If it already has an explicit timezone offset (+05:30 or Z), parse directly
  if (/([+-]\d{2}:?\d{2}|Z)$/i.test(str)) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  // 2. DD-MMM-YYYY or DD/MMM/YYYY or DD MMM YYYY (e.g. "16-Oct-2026 08:40:13" or "16-Oct-2026 8:40 AM")
  let match = str.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[-/ ](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\s*(AM|PM))?)?/i);
  if (match) {
    let [_, day, mon, year, hour, min, sec, ampm] = match;
    const month = MONTHS[mon.toLowerCase()];
    if (month) {
      let h = hour ? parseInt(hour, 10) : 0;
      const m = min ? parseInt(min, 10) : 0;
      const s = sec ? parseInt(sec, 10) : 0;
      if (ampm) {
        if (ampm.toUpperCase() === 'PM' && h < 12) h += 12;
        if (ampm.toUpperCase() === 'AM' && h === 12) h = 0;
      }
      const iso = `${year}-${month}-${day.padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}+05:30`;
      const d = new Date(iso);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // 3. DD/MM/YYYY or DD-MM-YYYY (e.g. "16/10/2026 08:40:13")
  match = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\s*(AM|PM))?)?/i);
  if (match) {
    let [_, day, month, year, hour, min, sec, ampm] = match;
    let h = hour ? parseInt(hour, 10) : 0;
    const m = min ? parseInt(min, 10) : 0;
    const s = sec ? parseInt(sec, 10) : 0;
    if (ampm) {
      if (ampm.toUpperCase() === 'PM' && h < 12) h += 12;
      if (ampm.toUpperCase() === 'AM' && h === 12) h = 0;
    }
    const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}+05:30`;
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d;
  }

  // 4. YYYY-MM-DD or YYYY/MM/DD (e.g. "2026-10-16 08:40:13")
  match = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\s*(AM|PM))?)?/i);
  if (match) {
    let [_, year, month, day, hour, min, sec, ampm] = match;
    let h = hour ? parseInt(hour, 10) : 0;
    const m = min ? parseInt(min, 10) : 0;
    const s = sec ? parseInt(sec, 10) : 0;
    if (ampm) {
      if (ampm.toUpperCase() === 'PM' && h < 12) h += 12;
      if (ampm.toUpperCase() === 'AM' && h === 12) h = 0;
    }
    const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}+05:30`;
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d;
  }

  // Fallback: try appending +05:30 offset
  const dWithOffset = new Date(str + ' +05:30');
  if (!isNaN(dWithOffset.getTime())) return dWithOffset;

  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Formats a Date or date string to Indian Standard Time (12-hour hh:mm am/pm).
 */
export function formatTimeIST(date: Date | string | null | undefined): string {
  if (!date) return '--';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata'
  });
}

/**
 * Formats a Date or date string to Indian Standard Date (DD MMM YYYY, e.g. 16 Oct 2026).
 */
export function formatDateIST(date: Date | string | null | undefined): string {
  if (!date) return '--';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata'
  });
}

/**
 * Returns the start (00:00:00.000) and end (23:59:59.999) Date objects in IST
 * for a given YYYY-MM-DD date string.
 */
export function getISTStartAndEndOfDay(dateStr: string): { startOfDay: Date; endOfDay: Date } {
  const [year, month, day] = dateStr.split('-').map(Number);
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  const startOfDay = new Date(`${y}-${m}-${d}T00:00:00.000+05:30`);
  const endOfDay = new Date(`${y}-${m}-${d}T23:59:59.999+05:30`);
  return { startOfDay, endOfDay };
}

/**
 * Returns today's date formatted as YYYY-MM-DD in Asia/Kolkata timezone.
 */
export function getTodayDateIST(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}
