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
