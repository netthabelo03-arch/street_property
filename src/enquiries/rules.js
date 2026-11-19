// Rules for conversations and viewings, shared by the screens and the tests.
// supabase/005_enquiries.sql enforces the same limits.

import { listingTitle, formatRands } from '../listings/rules.js';

export const MESSAGE_MAX = 1000;
export const VIEWING_HOURS = { from: '07:00', to: '19:00' };
export const VIEWING_DAYS_AHEAD = 60;
const ZONE = 'Africa/Johannesburg';

/**
 * A South African mobile number in the form the database keeps: +27821234567.
 * Accepts "082 123 4567", "+27 82 123 4567", "27821234567".
 * @returns {string | null} null when it is not a valid number
 */
export function normalizePhone(text) {
  const digits = String(text ?? '').replace(/[\s()-]/g, '');
  let rest = null;
  if (/^\+27\d{9}$/.test(digits)) rest = digits.slice(3);
  else if (/^27\d{9}$/.test(digits)) rest = digits.slice(2);
  else if (/^0\d{9}$/.test(digits)) rest = digits.slice(1);
  if (!rest || rest.startsWith('0')) return null;
  return `+27${rest}`;
}

/** "+27821234567" → "082 123 4567" */
export function showPhone(phone) {
  const rest = String(phone ?? '').replace(/^\+27/, '');
  return rest.length === 9 ? `0${rest.slice(0, 2)} ${rest.slice(2, 5)} ${rest.slice(5)}` : String(phone ?? '');
}

/** A link that opens WhatsApp with a first message ready. */
export function whatsappLink(phone, text) {
  const number = String(phone ?? '').replace(/^\+/, '');
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/** South Africa has one time zone and no daylight saving: always +02:00. */
export function toStartsAt(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !/^\d{2}:\d{2}$/.test(String(time))) return null;
  const at = new Date(`${date}T${time}:00+02:00`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** The same checks the database makes, so people see them before sending. */
export function checkViewingTime(date, time, now = new Date()) {
  const startsAt = toStartsAt(date, time);
  if (!startsAt) return { startsAt: null, error: 'Choose a date and a time.' };
  if (time < VIEWING_HOURS.from || time > VIEWING_HOURS.to) return { startsAt, error: `Viewings are between ${VIEWING_HOURS.from} and ${VIEWING_HOURS.to}.` };
  const ms = new Date(startsAt).getTime() - now.getTime();
  if (ms < 60 * 60 * 1000) return { startsAt, error: 'Choose a time at least an hour from now.' };
  if (ms > VIEWING_DAYS_AHEAD * 24 * 60 * 60 * 1000) return { startsAt, error: `Choose a time in the next ${VIEWING_DAYS_AHEAD} days.` };
  return { startsAt, error: null };
}

/** Today's date in South Africa, "2026-11-19", for the date picker's minimum. */
export function todayInSouthAfrica(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** For the date tile: { month: 'NOV', day: '22', when: 'Saturday · 10:00' } */
export function viewingParts(iso) {
  const at = new Date(iso);
  const part = (options) => new Intl.DateTimeFormat('en-ZA', { timeZone: ZONE, ...options }).format(at);
  return {
    month: part({ month: 'short' }).toUpperCase().replace('.', ''),
    day: String(Number(part({ day: 'numeric' }))),
    when: `${part({ weekday: 'long' })} · ${part({ hour: '2-digit', minute: '2-digit', hour12: false })}`,
  };
}

/**
 * What a viewing's state means to the person looking.
 * @returns {{ text: string, chip: string } | null}
 */
export function viewingStatus(item) {
  const other = item.other_name || (item.my_side === 'renter' ? 'the owner' : 'the renter');
  switch (item.viewing_status) {
    case 'proposed':
      return item.viewing_mine
        ? { text: `Waiting for ${other}`, chip: 'chip--waiting' }
        : { text: `${other} suggested this time`, chip: 'chip--waiting' };
    case 'confirmed': return { text: 'Confirmed', chip: 'chip--good' };
    case 'declined': return { text: 'Time did not work', chip: 'chip--bad' };
    case 'cancelled': return { text: 'Cancelled', chip: 'chip--bad' };
    default: return null;
  }
}

/** Viewings worth showing on the Viewings tab: waiting or confirmed, not long past. */
export function upcomingViewings(items, now = new Date()) {
  return items
    .filter((item) => ['proposed', 'confirmed'].includes(item.viewing_status) && new Date(item.viewing_at).getTime() > now.getTime() - 2 * 60 * 60 * 1000)
    .sort((a, b) => a.viewing_at.localeCompare(b.viewing_at));
}

/** "09:14" today, "Yesterday", "Mon" this week, "12 Nov" before that. */
export function shortTime(iso, now = new Date()) {
  const at = new Date(iso);
  const day = (date) => todayInSouthAfrica(date);
  if (day(at) === day(now)) return new Intl.DateTimeFormat('en-ZA', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (day(at) === day(yesterday)) return 'Yesterday';
  if (now.getTime() - at.getTime() < 6 * 24 * 60 * 60 * 1000) return new Intl.DateTimeFormat('en-ZA', { timeZone: ZONE, weekday: 'short' }).format(at);
  const part = (options) => new Intl.DateTimeFormat('en-ZA', { timeZone: ZONE, ...options }).format(at);
  return `${Number(part({ day: 'numeric' }))} ${part({ month: 'short' }).replace('.', '')}`;
}

export function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map((part) => part[0].toUpperCase()).join('');
}

/** The listing's title from a conversation row. */
export function enquiryTitle(item) {
  return listingTitle({ kind: item.listing_kind, bedrooms: item.listing_bedrooms, area: item.listing_area });
}

export function enquiryPrice(item) {
  return item.listing_mode === 'rent' ? `${formatRands(item.listing_price)} a month` : formatRands(item.listing_price);
}

/**
 * Messages that ask for money or bank details before a viewing are a common
 * scam. The app shows a warning under them; it does not block them.
 */
export function looksRisky(body) {
  const text = String(body ?? '');
  return /\b(deposit|eft|e-?wallet|cash ?send|bank|account (number|no)|transfer|pay (now|first|before)|send money|proof of payment)\b/i.test(text)
    || /\b\d{8,}\b/.test(text.replace(/\s/g, ''));
}

/** The first message suggested on a listing. */
export function firstMessage(mode) {
  return mode === 'rent'
    ? 'Hi, is this place still available? I would like to come and view it.'
    : 'Hi, is this home still for sale? I would like to come and view it.';
}
