// Demo only: stands in for src/auth/api.js. No real accounts: you play one of
// three people (owner, admin, renter) and switch with the demo bar.

import { db, PEOPLE, me } from './state.js';

let listener = () => {};
let signedOut = false;

function sessionFor(person) {
  return person ? { user: { id: person.id, email: person.email } } : null;
}

export async function currentSession() {
  return signedOut ? null : sessionFor(me());
}

export async function onAuthChange(callback) {
  listener = callback;
}

/** Called by the demo bar: become another person. */
export function becomePerson(persona) {
  db.persona = persona;
  signedOut = false;
  listener('SIGNED_IN', sessionFor(me()));
}

export async function signUp() {
  becomePerson('renter');
  return { needsEmailConfirmation: false };
}

export async function signIn() {
  becomePerson(db.persona || 'owner');
}

export async function signOut() {
  signedOut = true;
  listener('SIGNED_OUT', null);
}

export async function requestPasswordReset() {}
export async function setNewPassword() {}

export async function getProfile(userId) {
  const person = Object.values(PEOPLE).find((item) => item.id === userId);
  return person ? { id: person.id, full_name: person.full_name, role: person.role } : null;
}

export async function updateProfile(userId, { fullName, role }) {
  const person = Object.values(PEOPLE).find((item) => item.id === userId);
  person.full_name = String(fullName).trim();
  person.role = role;
  return { id: person.id, full_name: person.full_name, role: person.role };
}

export async function isAdmin() {
  return me()?.admin === true;
}

export function isSignedOut() {
  return signedOut;
}
