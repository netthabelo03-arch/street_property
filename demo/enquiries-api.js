// Demo only: conversations are not part of the demo. The Enquiries tab shows
// empty, and sending explains that this needs the real app.

function notInDemo() {
  return Promise.reject({ code: 'P0001', hint: 'not_signed_in', message: 'Messages are not part of the demo' });
}

export function startEnquiry() { return notInDemo(); }
export function sendMessage() { return notInDemo(); }
export async function markRead() {}
export function proposeViewing() { return notInDemo(); }
export function respondViewing() { return notInDemo(); }
export function cancelViewing() { return notInDemo(); }
export function reportEnquiry() { return notInDemo(); }
export async function myEnquiryFor() { return null; }
export async function listEnquiries() { return []; }
export async function getEnquiry() { return null; }
export async function listMessages() { return []; }
export async function unreadTotal() { return 0; }
