/**
 * USA scheduling helper — all publish slots are defined in US Eastern Time
 * (America/New_York) so the channel targets the USA audience regardless of
 * the server's local timezone.
 *
 * Best times for USA YouTube Shorts audience (2 shorts daily):
 *   - Slot 1: 13:00 ET (1:00 PM ET / 10:00 AM PT / 12:00 PM CT) - Nationwide lunch/afternoon peak
 *   - Slot 2: 19:00 ET (7:00 PM ET / 4:00 PM PT / 6:00 PM CT)   - Prime evening entertainment peak
 * Separation: 6 hours apart, allowing YouTube algorithm to distribute each short without feed collision.
 */
const ET = 'America/New_York';

function etParts(date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ET, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const { type, value } of dtf.formatToParts(date)) p[type] = value;
  return {
    y: +p.year, mo: +p.month, d: +p.day,
    h: +p.hour % 24, mi: +p.minute, s: +p.second,
  };
}

/** Wall-clock time in ET for an instant, as {h, m} */
function etHM(date) { const p = etParts(date); return { h: p.h, m: p.mi }; }

/**
 * Convert an ET wall time (y, mo, d, h, mi) to a UTC Date, DST-safe:
 * guess the offset, then verify by formatting back and adjust if off.
 */
function etWallToUTC(y, mo, d, h, mi) {
  const tryOffset = (offHours) => {
    const utc = new Date(Date.UTC(y, mo - 1, d, h - offHours, mi, 0));
    const back = etParts(utc);
    return (back.y === y && back.mo === mo && back.d === d && back.h === h && back.mi === mi)
      ? utc : null;
  };
  return tryOffset(-4) || tryOffset(-5) || tryOffset(-6) || tryOffset(-3);
}

/**
 * Next occurrence of an "HH:MM" ET slot that is at least `minAheadMs` in the
 * future. Returns a Date (UTC instant).
 */
function nextETSlot(hhmm, minAheadMs = 2 * 60 * 1000) {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const now = Date.now();
  const nowET = etParts(new Date(now));
  for (let addDay = 0; addDay < 3; addDay++) {
    const t = new Date(Date.UTC(nowET.y, nowET.mo - 1, nowET.d + addDay, 12));
    const p = etParts(t);
    const candidate = etWallToUTC(p.y, p.mo, p.d, h, m);
    if (candidate && candidate.getTime() > now + minAheadMs) return candidate;
  }
  return null;
}

/**
 * Find the next UNFILLED/OPEN publish slot.
 * Checks candidate slots sequentially (today, tomorrow, day 3...) and skips
 * any slot that already has a scheduled short within ±15 minutes.
 */
function nextOpenSlot(slots, occupiedDates = [], minAheadMs = 15 * 60 * 1000) {
  const valid = (slots || []).filter(s => /^\d{1,2}:\d{2}$/.test(String(s)))
    .sort((a, b) => {
      const [ha, ma] = a.split(':').map(Number);
      const [hb, mb] = b.split(':').map(Number);
      return (ha * 60 + ma) - (hb * 60 + mb);
    });
  if (!valid.length) valid.push('13:00', '19:00');

  const occupiedMillis = (occupiedDates || [])
    .map(d => (d instanceof Date ? d.getTime() : new Date(d).getTime()))
    .filter(t => !Number.isNaN(t));

  const now = Date.now();
  const nowET = etParts(new Date(now));

  // Search forward up to 30 days
  for (let addDay = 0; addDay < 30; addDay++) {
    const anchor = etParts(new Date(Date.UTC(nowET.y, nowET.mo - 1, nowET.d + addDay, 12)));
    for (const s of valid) {
      const [h, m] = s.split(':').map(Number);
      const candidate = etWallToUTC(anchor.y, anchor.mo, anchor.d, h, m);
      if (!candidate) continue;
      const cTime = candidate.getTime();
      if (cTime <= now + minAheadMs) continue; // too soon or in the past

      // Check if this slot time is occupied by an existing scheduled short (within 15 mins)
      const isOccupied = occupiedMillis.some(occTime => Math.abs(occTime - cTime) < 15 * 60 * 1000);
      if (!isOccupied) {
        return candidate;
      }
    }
  }

  // Fallback: earliest next slot after the latest occupied date
  const latestOcc = occupiedMillis.length ? Math.max(...occupiedMillis) : now;
  return new Date(latestOcc + 6 * 3600 * 1000);
}

/** Earliest of the next occurrences of all slots (simple clock check). */
function nextSlot(slots, minAheadMs) {
  const times = (slots || []).map(s => nextETSlot(s, minAheadMs)).filter(Boolean);
  if (!times.length) return new Date(Date.now() + 5 * 60 * 1000);
  return new Date(Math.min(...times.map(t => t.getTime())));
}

/** Format an instant as ET wall time, e.g. "Sep 10, 1:00 PM ET". */
function fmtET(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ET, month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(date) + ' ET';
}

/** Format time part only in ET, e.g. "1:00 PM ET". */
function fmtETTime(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ET, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(date) + ' ET';
}

/** Format day label in ET, e.g. "Today (Sep 10)" or "Fri (Sep 11)". */
function fmtETDayLabel(date, isToday = false) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ET, weekday: 'short', month: 'short', day: 'numeric',
  });
  const parts = dtf.format(date);
  return isToday ? `Today (${parts.split(', ')[1] || parts})` : parts;
}

/**
 * Get comprehensive weekly calendar for the dashboard.
 * Covers 7 calendar days starting from today in ET.
 * Includes details of scheduled shorts for each slot.
 */
function getWeeklyCalendar(slots, days = 7, queueEntries = []) {
  const valid = (slots || []).filter(s => /^\d{1,2}:\d{2}$/.test(String(s)))
    .sort((a, b) => {
      const [ha, ma] = a.split(':').map(Number);
      const [hb, mb] = b.split(':').map(Number);
      return (ha * 60 + ma) - (hb * 60 + mb);
    });
  if (!valid.length) valid.push('13:00', '19:00');

  const now = Date.now();
  const nowET = etParts(new Date(now));
  const result = [];

  for (let addDay = 0; addDay < days; addDay++) {
    const anchor = etParts(new Date(Date.UTC(nowET.y, nowET.mo - 1, nowET.d + addDay, 12)));
    const dayDate = etWallToUTC(anchor.y, anchor.mo, anchor.d, 12, 0);
    const dayLabel = fmtETDayLabel(dayDate, addDay === 0);

    const daySlots = [];
    for (const s of valid) {
      const [h, m] = s.split(':').map(Number);
      const at = etWallToUTC(anchor.y, anchor.mo, anchor.d, h, m);
      if (!at) continue;

      const atTime = at.getTime();
      const isPast = atTime < now - 5 * 60 * 1000;

      // Find any queue entry occupying this slot (within 15 minutes)
      const matchingEntry = (queueEntries || []).find(q => {
        if (!q.scheduled_at) return false;
        const qTime = new Date(q.scheduled_at).getTime();
        return Math.abs(qTime - atTime) < 15 * 60 * 1000;
      });

      const filled = !!matchingEntry && ['scheduled', 'scheduled_on_youtube', 'publishing', 'published'].includes(matchingEntry.status);

      daySlots.push({
        slot: s,
        at: at.toISOString(),
        at_et: fmtET(at),
        time_et: fmtETTime(at),
        is_past: isPast,
        filled,
        short: matchingEntry ? {
          id: matchingEntry.id,
          short_id: matchingEntry.short_id,
          title: matchingEntry.short_title || matchingEntry.short_id,
          youtube_id: matchingEntry.youtube_id || null,
          status: matchingEntry.status,
        } : null,
      });
    }

    result.push({
      date: `${anchor.y}-${String(anchor.mo).padStart(2, '0')}-${String(anchor.d).padStart(2, '0')}`,
      label: dayLabel,
      is_today: addDay === 0,
      slots: daySlots,
    });
  }

  return result;
}

/** The next N upcoming slot instants (backward compatibility). */
function upcomingSlots(slots, days = 7) {
  const cal = getWeeklyCalendar(slots, days, []);
  const all = [];
  const now = Date.now();
  for (const day of cal) {
    for (const s of day.slots) {
      if (new Date(s.at).getTime() > now) {
        all.push({ slot: s.slot, at: new Date(s.at) });
      }
    }
  }
  return all;
}

module.exports = {
  ET,
  nextETSlot,
  nextSlot,
  nextOpenSlot,
  fmtET,
  fmtETTime,
  fmtETDayLabel,
  getWeeklyCalendar,
  etParts,
  upcomingSlots,
};
