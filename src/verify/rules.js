// Street Verified: the three checks, what each one needs, and what its state
// means. supabase/007_verified.sql enforces the same rules.

export const DOC_MAX_BYTES = 8 * 1024 * 1024;
export const DOC_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/** What proof of ownership each kind of lister sends. */
export function ownershipNeeds(lister) {
  return lister === 'agent'
    ? {
      min: 2,
      slots: [
        { id: 'ffc', label: 'Your Fidelity Fund Certificate (FFC)' },
        { id: 'mandate', label: 'The owner’s signed mandate for this place' },
      ],
    }
    : {
      min: 1,
      slots: [{ id: 'proof', label: 'Title deed or municipal rates account for this address, in your name' }],
    };
}

/** null when the file can be sent, otherwise what is wrong with it. */
export function checkDocFile(file) {
  if (!file) return 'Choose a file.';
  const type = String(file.type || '');
  if (!DOC_TYPES.includes(type) && !type.startsWith('image/')) return 'Send a photo or a PDF.';
  if (type === 'application/pdf' && file.size > DOC_MAX_BYTES) return 'That PDF is over 8 MB. Send a photo of it instead.';
  return null;
}

/** File ending for an upload. */
export function docExtension(type) {
  return { 'application/pdf': 'pdf', 'image/png': 'png', 'image/webp': 'webp' }[type] ?? 'jpg';
}

/**
 * Each check's state for the owner's screen.
 * @returns {{ id: string, state: 'done' | 'waiting' | 'needed' | 'rejected', chip: string, label: string, note: string | null }[]}
 */
export function checkStates(v) {
  const from = (status, note, doneLabel) => {
    if (status === 'approved') return { state: 'done', chip: 'chip--good', label: doneLabel, note: null };
    if (status === 'pending') return { state: 'waiting', chip: 'chip--waiting', label: 'Being checked', note: null };
    if (status === 'rejected') return { state: 'rejected', chip: 'chip--bad', label: 'Not accepted', note: note ?? null };
    return { state: 'needed', chip: 'chip--waiting', label: 'Needed', note: null };
  };
  return [
    { id: 'identity', ...from(v?.identity_status, v?.identity_note, 'Done') },
    { id: 'ownership', ...from(v?.ownership_status, v?.ownership_note, 'Done') },
    { id: 'on_site', ...(v?.on_site
      ? { state: 'done', chip: 'chip--good', label: 'Done', note: null }
      : { state: 'needed', chip: 'chip--waiting', label: 'Needed', note: null }) },
  ];
}

export function doneCount(v) {
  return checkStates(v).filter((check) => check.state === 'done').length;
}

/** The line under the badge preview. */
export function badgeLine(v) {
  if (v?.verified_at) return 'Earned. It shows on your listing now.';
  const done = doneCount(v);
  return `${done} of 3 checks done`;
}
