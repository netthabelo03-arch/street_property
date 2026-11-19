// The renter check: sending income documents, sharing the result in a
// conversation, the owner's answer, and the admin's decision.

import { getClient } from '../auth/client.js';

function check({ data, error }) {
  if (error) throw error;
  return data;
}

export async function myRenterCheck() {
  const client = await getClient();
  const rows = check(await client.rpc('my_renter_check'));
  return rows[0] ?? null;
}

export async function submitIncome(paths) {
  const client = await getClient();
  check(await client.rpc('submit_income', { p_paths: paths }));
}

export async function shareRenterCheck(enquiryId, { moveIn, leaseMonths, household, pets }) {
  const client = await getClient();
  check(await client.rpc('share_renter_check', {
    p_enquiry: enquiryId,
    p_move_in: moveIn || null,
    p_lease_months: leaseMonths ? Number(leaseMonths) : null,
    p_household: household ?? null,
    p_pets: pets ?? null,
  }));
}

export async function stopSharing(enquiryId) {
  const client = await getClient();
  check(await client.rpc('stop_sharing', { p_enquiry: enquiryId }));
}

/** What the owner sees (null until the renter shares). */
export async function renterCheckFor(enquiryId) {
  const client = await getClient();
  const rows = check(await client.rpc('renter_check_for', { p_enquiry: enquiryId }));
  return rows[0] ?? null;
}

export async function decideRenter(enquiryId, accept) {
  const client = await getClient();
  return check(await client.rpc('decide_renter', { p_enquiry: enquiryId, p_accept: accept }));
}

/** For admins: decide an income check, then delete its documents. */
export async function decideIncome(userId, approve, monthly, note) {
  const client = await getClient();
  const files = (check(await client.rpc('decide_income', {
    p_user: userId,
    p_approve: approve,
    p_monthly: approve ? monthly : null,
    p_note: note ?? null,
  })) ?? []).filter(Boolean);
  if (files.length) {
    const { error } = await client.storage.from('verification-docs').remove(files);
    if (error) throw Object.assign(new Error(`The decision was saved, but the documents could not be deleted. Delete them by hand in Supabase: Storage, verification-docs, folder ${files[0].split('/')[0]}.`), { code: 'docs_not_deleted' });
  }
}
