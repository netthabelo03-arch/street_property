import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ownershipNeeds, checkDocFile, docExtension, checkStates, doneCount, badgeLine, DOC_MAX_BYTES } from '../src/verify/rules.js';
import { toSearchArgs, defaultFilters, MUST_HAVES } from '../src/explore/filters.js';
import { parseRoute, hashFor, resolveRoute, tabFor, PROTECTED_SCREENS } from '../src/router.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const ID = '3f2b8c1e-9a4d-4e7b-8c2a-1b2c3d4e5f60';

test('S6: the checks screens need an account', () => {
  assert.deepEqual(parseRoute(`#/list/${ID}/verify`), { screen: 'list-verify', id: ID });
  assert.deepEqual(parseRoute(`#/review/check/identity/${ID}`), { screen: 'review-check', kind: 'identity', id: ID });
  assert.deepEqual(parseRoute(`#/review/check/ownership/${ID}`), { screen: 'review-check', kind: 'ownership', id: ID });
  assert.deepEqual(parseRoute(`#/review/check/other/${ID}`), { screen: 'explore' });
  assert.equal(hashFor({ screen: 'review-check', kind: 'identity', id: ID }), `#/review/check/identity/${ID}`);
  for (const screen of ['list-verify', 'review-check']) {
    assert.ok(PROTECTED_SCREENS.includes(screen));
    assert.equal(resolveRoute({ screen, id: ID }, false).screen, 'signin');
    assert.equal(tabFor(screen), 'profile');
  }
});

test('S6: owners send one proof; agents send their FFC and the mandate', () => {
  assert.equal(ownershipNeeds('owner').min, 1);
  assert.equal(ownershipNeeds('agent').min, 2);
  assert.match(ownershipNeeds('agent').slots[0].label, /Fidelity Fund Certificate/);
  assert.match(ownershipNeeds('owner').slots[0].label, /title deed or municipal rates/i);
  const sql = read('../supabase/007_verified.sql');
  assert.match(sql, /needed := case when place\.lister = 'agent' then 2 else 1 end;/, 'the database asks for the same');
});

test('S6: photos and PDFs only; big PDFs are refused', () => {
  assert.equal(checkDocFile({ type: 'image/jpeg', size: 20e6 }), null, 'photos are shrunk before upload');
  assert.equal(checkDocFile({ type: 'application/pdf', size: 1e6 }), null);
  assert.match(checkDocFile({ type: 'application/pdf', size: DOC_MAX_BYTES + 1 }), /over 8 MB/);
  assert.match(checkDocFile({ type: 'application/zip', size: 100 }), /photo or a PDF/);
  assert.match(checkDocFile(null), /Choose a file/);
  assert.equal(docExtension('application/pdf'), 'pdf');
  assert.equal(docExtension('image/jpeg'), 'jpg');
});

test('S6: what each check shows the owner', () => {
  const none = checkStates(null);
  assert.deepEqual(none.map((c) => c.state), ['needed', 'needed', 'needed']);
  const mixed = checkStates({ identity_status: 'approved', ownership_status: 'rejected', ownership_note: 'Rates account is from 2019.', on_site: true });
  assert.deepEqual(mixed.map((c) => c.state), ['done', 'rejected', 'done']);
  assert.equal(mixed[1].note, 'Rates account is from 2019.');
  assert.equal(checkStates({ identity_status: 'pending' })[0].label, 'Being checked');
  assert.equal(doneCount({ identity_status: 'approved', ownership_status: 'pending', on_site: true }), 2);
  assert.equal(badgeLine({ identity_status: 'approved', on_site: true }), '2 of 3 checks done');
  assert.equal(badgeLine({ verified_at: '2026-11-19T10:00:00Z' }), 'Earned. It shows on your listing now.');
});

test('S6: renters can ask for Street Verified places only', () => {
  assert.ok(MUST_HAVES.some((item) => item.id === 'verified'));
  assert.equal(toSearchArgs(defaultFilters()).p_verified, false);
  assert.equal(toSearchArgs({ ...defaultFilters(), musts: ['verified'] }).p_verified, true);
  assert.match(read('../supabase/007_verified.sql'), /not coalesce\(p_verified, false\) or l\.verified_at is not null/);
});

test('S6: documents are private, and only the result is kept', () => {
  const sql = read('../supabase/007_verified.sql');
  assert.match(sql, /\('verification-docs', 'verification-docs', false,/);
  assert.match(sql, /bucket_id = 'verification-docs' and \(select public\.is_admin\(\)\)\)/, 'only admins open the files');
  assert.match(sql, /grant select \(user_id, status, note, submitted_at, decided_at\) on public\.identity_checks/, 'not even the owner reads the paths');
  assert.match(sql, /id_path = null, selfie_path = null/, 'paths cleared on decision');
  assert.match(sql, /doc_paths = '\{\}'/);
  assert.doesNotMatch(sql, /grant select \(verified_at\)[^;]*authenticated[^;]*;[\s\S]*grant (insert|update)[^;]*verified_at/, 'the badge cannot be set by the app');
  const api = read('../src/verify/api.js');
  assert.match(api, /storage\.from\(BUCKET\)\.remove\(paths\)/, 'the app deletes the files after deciding');
  assert.match(read('../src/screens/legal.js'), /deleted as soon as the check is decided/);
});

test('S6: a new address loses the badge', () => {
  const sql = read('../supabase/007_verified.sql');
  assert.match(sql, /before update of street, area, city on public\.listings/);
  assert.match(sql, /new\.verified_at := null;/);
});
