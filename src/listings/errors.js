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
