// The roles a person can pick. To add one later, add an entry here: the
// profile screen, the sign-up check and the database script read the same ids.

export const ROLES = [
  {
    id: 'renter',
    name: 'Renter or buyer',
    short: 'Renter',
    about: 'Find a place to rent or buy',
  },
  {
    id: 'owner',
    name: 'Owner',
    short: 'Owner',
    about: 'List your place and find good renters',
  },
  {
    id: 'agent',
    name: 'Agent',
    short: 'Agent',
    about: 'List places for owners (Fidelity Fund Certificate needed)',
  },
];

/** @returns {object | undefined} the role with this id, if there is one */
export function findRole(id) {
  return ROLES.find((role) => role.id === id);
}

/** @returns {boolean} whether this id names a real role */
export function isRole(id) {
  return findRole(id) !== undefined;
}

/** Owners and agents list places; renters look for them. */
export function canList(role) {
  return role === 'owner' || role === 'agent';
}
