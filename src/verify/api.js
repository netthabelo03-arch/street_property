// Street Verified: sending documents (owners and agents) and deciding checks
// (admins). Documents go to a private bucket only admins can open, and are
// deleted as soon as the check is decided.

import { getClient } from '../auth/client.js';
import { shrinkPhoto } from '../media/photos.js';
import { docExtension } from './rules.js';

const BUCKET = 'verification-docs';
/** Documents keep enough detail to read the small print on a deed or rates account. */
export const DOC_PHOTO = { max: 2600, maxBytes: 6 * 1024 * 1024 };

function check({ data, error }) {
  if (error) throw error;
  return data;
}

/** Where the listing's three checks stand (for its owner). */
export async function myVerification(listingId) {
  const client = await getClient();
  const rows = check(await client.rpc('my_verification', { p_listing: listingId }));
  return rows[0] ?? null;
}

/**
 * Upload one document into the person's own folder. Photos are made smaller
 * first; PDFs go as they are. Returns the stored path.
 */
export async function uploadDoc(userId, folder, file) {
  const client = await getClient();
  let body = file;
  let type = file.type;
  if (file.type !== 'application/pdf') {
    body = await shrinkPhoto(file, DOC_PHOTO);
    type = 'image/jpeg';
  }
  const path = `${userId}/${folder}/${crypto.randomUUID()}.${docExtension(type)}`;
  check(await client.storage.from(BUCKET).upload(path, body, { contentType: type, upsert: false }));
  return path;
}

/** Remove the person's own uploads (after a failed send). */
export async function removeDocs(paths) {
  if (!paths.length) return;
  const client = await getClient();
  await client.storage.from(BUCKET).remove(paths);
}

export async function submitIdentity(idPath, selfiePath) {
  const client = await getClient();
  check(await client.rpc('submit_identity', { p_id_path: idPath, p_selfie_path: selfiePath }));
}

export async function submitOwnership(listingId, paths) {
  const client = await getClient();
  check(await client.rpc('submit_ownership', { p_listing: listingId, p_paths: paths }));
}

/** For admins: checks waiting for a decision, oldest first. */
export async function verificationQueue() {
  const client = await getClient();
  return check(await client.rpc('verification_queue'));
}

/** For admins: short-lived links to open the documents. */
export async function docLinks(paths) {
  const wanted = paths.filter(Boolean);
  if (!wanted.length) return [];
  const client = await getClient();
  const data = check(await client.storage.from(BUCKET).createSignedUrls(wanted, 15 * 60));
  return wanted.map((path) => ({ path, url: data.find((item) => item.path === path)?.signedUrl ?? null, pdf: path.endsWith('.pdf') }));
}

/** For admins: approve or turn down a check, then delete its documents. */
export async function decideCheck(kind, subjectId, approve, note) {
  const client = await getClient();
  const files = check(await client.rpc('decide_check', { p_kind: kind, p_subject: subjectId, p_approve: approve, p_note: note ?? null })) ?? [];
  const paths = files.filter(Boolean);
  if (paths.length) {
    const { error } = await client.storage.from(BUCKET).remove(paths);
    if (error) throw Object.assign(new Error(`The decision was saved, but the documents could not be deleted. Delete them by hand in Supabase: Storage, verification-docs, folder ${paths[0].split('/')[0]}.`), { code: 'docs_not_deleted' });
  }
}
