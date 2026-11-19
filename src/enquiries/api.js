// Conversations, messages and viewings. Only the two people in a conversation
// can read it; everything is written through database functions.

import { getClient } from '../auth/client.js';

function check({ data, error }) {
  if (error) throw error;
  return data;
}

/** Ask about a listing (or add to the conversation already started). Returns its id. */
export async function startEnquiry(listingId, body) {
  const client = await getClient();
  return check(await client.rpc('start_enquiry', { p_listing: listingId, p_body: body }));
}

/** The caller's conversation about this listing, if they started one. */
export async function myEnquiryFor(listingId, userId) {
  const client = await getClient();
  const row = check(await client.from('enquiries').select('id').eq('listing_id', listingId).eq('renter_id', userId).maybeSingle());
  return row?.id ?? null;
}

/** All the caller's conversations, newest first. */
export async function listEnquiries() {
  const client = await getClient();
  return check(await client.rpc('enquiry_list', { p_enquiry: null }));
}

/** One conversation, with the full address and WhatsApp number when allowed. */
export async function getEnquiry(id) {
  const client = await getClient();
  const rows = check(await client.rpc('enquiry_list', { p_enquiry: id }));
  return rows[0] ?? null;
}

export async function listMessages(enquiryId) {
  const client = await getClient();
  return check(await client.from('messages').select('id, sender_id, kind, body, created_at').eq('enquiry_id', enquiryId).order('created_at'));
}

export async function sendMessage(enquiryId, body) {
  const client = await getClient();
  return check(await client.rpc('send_message', { p_enquiry: enquiryId, p_body: body }));
}

export async function markRead(enquiryId) {
  const client = await getClient();
  check(await client.rpc('mark_read', { p_enquiry: enquiryId }));
}

export async function proposeViewing(enquiryId, startsAt) {
  const client = await getClient();
  return check(await client.rpc('propose_viewing', { p_enquiry: enquiryId, p_starts_at: startsAt }));
}

export async function respondViewing(viewingId, accept) {
  const client = await getClient();
  return check(await client.rpc('respond_viewing', { p_viewing: viewingId, p_accept: accept }));
}

export async function cancelViewing(viewingId) {
  const client = await getClient();
  check(await client.rpc('cancel_viewing', { p_viewing: viewingId }));
}

export async function reportEnquiry(enquiryId, reason) {
  const client = await getClient();
  check(await client.rpc('report_enquiry', { p_enquiry: enquiryId, p_reason: reason }));
}

/** Unread messages across all conversations (0 when it cannot be loaded). */
export async function unreadTotal() {
  try {
    const client = await getClient();
    return check(await client.rpc('unread_total')) ?? 0;
  } catch {
    return 0;
  }
}
