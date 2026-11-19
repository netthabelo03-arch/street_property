// Turns an error from saving a listing into a sentence a person can act on.

import { friendlyAuthError } from '../auth/errors.js';

const BY_HINT = {
  not_a_lister: 'Only owners and agents can list a place. Change "I use Street Property as" on your profile first.',
  listing_not_found: 'This listing was not found. It may have been deleted.',
  listing_locked: 'This listing is being checked or is live, so it cannot be changed right now.',
  too_many_photos: 'A listing can have up to 12 photos. Remove one first.',
  bad_clip_path: 'The clip could not be saved. Film it again.',
  location_needed: 'Your location is needed for every clip, to show it was filmed at the place. Allow location and try again.',
  clip_length: 'Each clip must be 1 to 30 seconds long.',
  tour_too_long: 'The whole tour must be 2 minutes or less. Film a shorter clip, or film another room again shorter.',
  need_photos: 'Add at least 5 photos before sending.',
  need_tour: 'Film the outside and at least 3 rooms before sending.',
  not_admin: 'Only admins can review listings.',
  not_in_review: 'This listing is no longer waiting for review. Someone may have checked it already.',
  note_needed: 'Say what the owner needs to change.',
  note_too_long: 'Keep the note under 500 characters.',
  // Conversations and viewings (Sprint 4)
  not_signed_in: 'Log in first.',
  listing_not_live: 'This place is no longer listed.',
  own_listing: 'This is your own listing.',
  too_many_enquiries: 'You have asked about many places today. Try again tomorrow.',
  message_empty: 'Write a message first.',
  message_too_long: 'Keep messages under 1000 characters.',
  too_many_messages: 'You are sending messages very fast. Wait a few minutes.',
  enquiry_not_found: 'This conversation was not found.',
  viewing_time: 'Choose a time from an hour from now up to 60 days ahead.',
  viewing_hours: 'Viewings are between 07:00 and 19:00.',
  viewing_not_found: 'This viewing was not found.',
  viewing_not_waiting: 'This viewing has changed. Pull down or reopen the conversation to see the latest.',
  own_proposal: 'The other person needs to answer your suggested time.',
  report_reason: 'Say in a few words what went wrong.',
  too_many_saved: 'You can save up to 200 places. Remove some first.',
  // Street Verified (Sprint 6)
  need_id_photos: 'Add a photo of your ID or passport and a selfie.',
  check_exists: 'This is already being checked or approved.',
  need_owner_docs: 'Add your title deed or rates account.',
  need_agent_docs: 'Add your Fidelity Fund Certificate and the owner\u2019s mandate.',
  bad_doc_path: 'The document could not be saved. Try again.',
  check_not_waiting: 'This check was already decided.',
  check_not_found: 'This check was not found.',
  // Renter check (Sprint 7)
  need_income_docs: 'Add your latest payslip or 3 months of bank statements.',
  not_the_renter: 'Only the renter can do this.',
  not_the_owner: 'Only the owner can do this.',
  already_decided: 'The owner has already answered.',
  move_in_date: 'Choose a move-in date in the next 12 months.',
  lease_months: 'Choose 6, 12, 24 or 36 months.',
  household_too_long: 'Keep this under 120 characters.',
  not_shared: 'The renter has not shared their check.',
  income_amount: 'Enter the monthly take-home pay.',
  outcome_needed: 'Write down what you did about this report.',
  report_closed: 'This report is already closed.',
  // The deal (Sprint 8)
  viewing_not_confirmed: 'Only a confirmed viewing can be marked.',
  not_viewing_time: 'Tap this at the viewing: from 30 minutes before it starts.',
  not_at_address: 'You need to be at the address. Switch on location and try again from the place.',
  deal_not_found: 'This deal was not found.',
  deal_cancelled: 'This deal was called off.',
  deal_done: 'The renter has already moved in.',
  lease_sent: 'The lease was already sent.',
  lease_rent: 'Enter the monthly rent.',
  lease_deposit: 'Check the deposit amount.',
  lease_start: 'Choose a start date in the next 12 months.',
  lease_special: 'Keep special terms under 1000 characters.',
  lease_not_signing: 'The lease is not waiting for signatures.',
  lease_changed: 'The lease changed. Read it again before signing.',
  signature_name: 'Type your full name: first name and surname.',
  check_not_open: 'The move-in check starts once you have both signed the lease.',
  check_signed: 'The move-in check is already signed by both.',
  bad_room: 'That room is not part of this check.',
  too_many_room_photos: 'Up to 12 photos a room.',
  note_too_long: 'Keep the note under 500 characters.',
  rooms_missing: 'Add at least one photo of every room first.',
  check_first: 'Sign the move-in check together first.',
  // Street Safe payments (Sprint 9)
  street_safe_down: 'Street Safe payments are not answering right now. Try again in a few minutes.',
  pay_after_lease: 'Pay once you have both signed the lease.',
  already_paid: 'This has already been paid.',
  owner_not_ready: 'The owner has not set up Street Safe payouts yet.',
  name_needed: 'Add your full name (first name and surname) in your Profile first.',
  phone_needed: 'Add your cellphone number in your Profile first.',
  bank_needed: 'Choose your bank.',
  account_type_needed: 'Choose the account type.',
  account_number: 'Check the account number: digits only.',
  id_number: 'Enter your 13-digit South African ID number.',
  sign_in: 'Log in again, then try once more.',
};

// Problems from the phone itself (photos, camera, location).
const BY_CODE = {
  not_a_photo: 'That file is not a photo this phone can open. Choose a JPEG or PNG photo.',
  photo_too_big: 'That photo is too large even after shrinking. Choose another one.',
  location_denied: 'Location is blocked for this site. Allow location in your browser settings, then try again. It shows the tour was filmed at the place.',
  location_unavailable: 'Your location could not be found. Go outside or near a window, switch on location, and try again.',
  camera_denied: 'The camera is blocked for this site. Allow the camera in your browser settings, then try again.',
  camera_unavailable: 'No camera could be opened. Close other apps using the camera and try again.',
  nothing_recorded: 'Nothing was recorded. Try again and film for at least 2 seconds.',
  recording_failed: 'The recording stopped unexpectedly. Try again.',
  clip_too_big: 'That clip is too large to upload. Film it again a little shorter.',
};

/** Camera errors from the browser carry a name, not a code. */
export function cameraProblem(error) {
  const name = error?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return { code: 'camera_denied' };
  return { code: 'camera_unavailable' };
}

export function friendlyListingError(error) {
  const hint = error && typeof error === 'object' ? error.hint : null;
  if (typeof hint === 'string' && Object.hasOwn(BY_HINT, hint)) return BY_HINT[hint];
  const code = error && typeof error === 'object' ? error.code : null;
  if (typeof code === 'string' && Object.hasOwn(BY_CODE, code)) return BY_CODE[code];
  // Too many photos is enforced by a plain trigger too.
  if (error && /up to 12 photos/.test(String(error.message))) return BY_HINT.too_many_photos;
  return friendlyAuthError(error);
}
