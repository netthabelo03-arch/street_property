// The renter check: what it shows and the rules for sharing it.
// supabase/008_renter_check.sql enforces the same rules.

export const LEASE_CHOICES = [6, 12, 24, 36];
export const HOUSEHOLD_MAX = 120;

/** "3.1× take-home pay covers the rent", and how strong that is. */
export function coverLine(ratio) {
  if (ratio === null || ratio === undefined) return null;
  const value = Number(ratio);
  const strength = value >= 3 ? 'strong' : value >= 2.5 ? 'fair' : 'low';
  return { text: `${value.toFixed(1)}×`, words: 'take-home pay covers the rent', strength };
}

/**
 * The renter's own view of each part of the check.
 * @returns {{ id: string, state: string, chip: string, label: string, note: string | null }[]}
 */
export function renterStates(r) {
  const from = (status, note) => {
    if (status === 'approved') return { state: 'done', chip: 'chip--good', label: 'Checked', note: null };
    if (status === 'expired') return { state: 'expired', chip: 'chip--bad', label: 'Out of date', note: 'Older than 3 months. Send your latest payslip or statements.' };
    if (status === 'pending') return { state: 'waiting', chip: 'chip--waiting', label: 'Being checked', note: null };
    if (status === 'rejected') return { state: 'rejected', chip: 'chip--bad', label: 'Not accepted', note: note ?? null };
    return { state: 'needed', chip: 'chip--waiting', label: 'Needed', note: null };
  };
  return [
    { id: 'identity', ...from(r?.identity_status, r?.identity_note) },
    { id: 'income', ...from(r?.income_status, r?.income_note) },
  ];
}

/** The same checks the database makes before sharing. */
export function checkShare({ moveIn, leaseMonths, household }, today) {
  const errors = {};
  if (moveIn) {
    const start = new Date(`${today}T00:00:00Z`);
    const chosen = new Date(`${moveIn}T00:00:00Z`);
    const days = (chosen - start) / 86400000;
    if (Number.isNaN(days) || days < 0 || days > 365) errors.moveIn = 'Choose a move-in date in the next 12 months.';
  }
  if (leaseMonths !== null && leaseMonths !== undefined && !LEASE_CHOICES.includes(Number(leaseMonths))) errors.leaseMonths = 'Choose 6, 12, 24 or 36 months.';
  if (String(household ?? '').trim().length > HOUSEHOLD_MAX) errors.household = `Keep this under ${HOUSEHOLD_MAX} characters.`;
  return errors;
}

/** "Moving in with 1 child · no pets" style line from what the renter wrote. */
export function householdLine(check) {
  const who = check.household ? check.household : 'Household not given';
  const pets = check.has_pets === true ? 'has pets' : check.has_pets === false ? 'no pets' : null;
  return [who, pets].filter(Boolean).join(' · ');
}

/** "Wants to move in 1 December, for 12 months" */
export function moveInLine(check) {
  const parts = [];
  if (check.move_in) {
    const date = new Date(`${check.move_in}T12:00:00Z`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', timeZone: 'Africa/Johannesburg' });
    parts.push(`Wants to move in ${date.replace(/^0/, '')}`);
  }
  if (check.lease_months) parts.push(`${parts.length ? 'for' : 'For'} ${check.lease_months} months`);
  return parts.length ? parts.join(', ') : 'Move-in date not given';
}
