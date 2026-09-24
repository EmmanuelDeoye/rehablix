#!/usr/bin/env node
//
// One-time backfill for the Google sign-in race condition fixed in js/auth.js:
// some Google-signed-in accounts have a users/{uid} node in Realtime Database
// that's missing name/email/createdAt/userId (another module's own auth
// listener raced in first and created a sibling child, e.g. .../subscription,
// which made the old `snapshot.exists()` check true before the profile was
// ever written). Firebase Auth itself always has the real email/displayName/
// creation time for every account, so this script uses Auth as the source of
// truth to fill in ONLY the fields that are missing under users/{uid} — it
// never overwrites a field that's already present.
//
// SETUP (run once):
//   1. Firebase Console -> Project Settings -> Service Accounts -> "Generate
//      new private key". Save the downloaded JSON somewhere OUTSIDE this repo
//      (it's a full admin credential — never commit it).
//   2. cd scripts
//      npm install firebase-admin
//
// USAGE:
//   Dry run (default — reports what WOULD change, writes nothing):
//     node backfill-google-user-profiles.js --key /path/to/serviceAccountKey.json --db-url https://<your-project-id>-default-rtdb.firebaseio.com
//
//   Apply for real:
//     node backfill-google-user-profiles.js --key /path/to/serviceAccountKey.json --db-url https://<your-project-id>-default-rtdb.firebaseio.com --apply
//
// Find --db-url in Firebase Console -> Realtime Database -> the URL shown at
// the top of the data viewer.
//
// Safe to re-run: already-complete profiles are skipped, and it only ever
// fills in fields that are absent.

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--key') args.key = argv[++i];
    else if (a === '--db-url') args.dbUrl = argv[++i];
    else if (a === '--concurrency') args.concurrency = parseInt(argv[++i], 10);
  }
  return args;
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

async function listAllAuthUsers(admin) {
  const users = [];
  let pageToken;
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

function inferProvider(authUser) {
  const ids = (authUser.providerData || []).map((p) => p.providerId);
  if (ids.includes('google.com')) return 'google';
  if (ids.includes('password')) return 'email';
  return ids[0] || 'unknown';
}

// Returns the patch of ONLY the fields missing from `existing`, or null if
// nothing is missing. Mirrors the same field set js/auth.js writes on
// first Google sign-in.
function computeMissingFields(authUser, existing) {
  const record = existing || {};
  const patch = {};

  if (!record.email && authUser.email) patch.email = authUser.email;

  if (!record.name) {
    patch.name = authUser.displayName || (authUser.email ? authUser.email.split('@')[0] : 'User');
  }

  if (!record.createdAt) {
    // authUser.metadata.creationTime is an RFC-2822-ish string Firebase Auth
    // always provides ("Mon, 01 Jan 2024 12:00:00 GMT") — normalize to ISO
    // to match the format js/auth.js writes elsewhere.
    const creation = authUser.metadata && authUser.metadata.creationTime;
    patch.createdAt = creation ? new Date(creation).toISOString() : new Date().toISOString();
  }

  if (!record.userId) patch.userId = authUser.uid;

  if (!record.provider) patch.provider = inferProvider(authUser);

  if (!record.photoURL && authUser.photoURL) patch.photoURL = authUser.photoURL;

  // termsAgreed can't be reconstructed after the fact with certainty, but an
  // account that has been signed in and using the app clearly passed the
  // signup form's terms checkbox at the time — mark it true rather than
  // leaving a real user's record permanently flagged as not-agreed.
  if (record.termsAgreed === undefined) {
    patch.termsAgreed = true;
    if (!record.termsAgreedAt) patch.termsAgreedAt = patch.createdAt || record.createdAt || new Date().toISOString();
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.key || !args.dbUrl) {
    console.error('Usage: node backfill-google-user-profiles.js --key <serviceAccountKey.json> --db-url <https://...-default-rtdb.firebaseio.com> [--apply] [--concurrency 10]');
    process.exit(1);
  }

  const keyPath = path.resolve(args.key);
  if (!fs.existsSync(keyPath)) {
    console.error(`Service account key not found at: ${keyPath}`);
    process.exit(1);
  }

  const admin = require('firebase-admin');
  admin.initializeApp({
    credential: admin.credential.cert(require(keyPath)),
    databaseURL: args.dbUrl,
  });

  const db = admin.database();
  const concurrency = args.concurrency || 10;

  console.log(args.apply ? 'Mode: APPLY (writes will be made)' : 'Mode: DRY RUN (no writes — pass --apply to write for real)');
  console.log('Fetching all Firebase Auth users...');
  const authUsers = await listAllAuthUsers(admin);
  console.log(`Found ${authUsers.length} Auth accounts. Checking each against Realtime Database...`);

  let checked = 0, needsFix = 0, fixed = 0, failed = 0;
  const report = [];

  await mapWithConcurrency(authUsers, concurrency, async (authUser) => {
    checked++;
    const uid = authUser.uid;
    const userRef = db.ref(`users/${uid}`);
    let existing;
    try {
      const snap = await userRef.once('value');
      existing = snap.val();
    } catch (err) {
      failed++;
      report.push({ uid, email: authUser.email, status: 'READ_FAILED', error: err.message });
      return;
    }

    const patch = computeMissingFields(authUser, existing);
    if (!patch) return; // already complete, nothing to do

    needsFix++;
    if (args.apply) {
      try {
        await userRef.update(patch);
        fixed++;
        report.push({ uid, email: authUser.email, status: 'FIXED', patch });
      } catch (err) {
        failed++;
        report.push({ uid, email: authUser.email, status: 'WRITE_FAILED', patch, error: err.message });
      }
    } else {
      report.push({ uid, email: authUser.email, status: 'WOULD_FIX', patch });
    }
  });

  console.log('\n--- Backfill report ---');
  for (const row of report) {
    if (row.status === 'WOULD_FIX' || row.status === 'FIXED') {
      console.log(`${row.status}  ${row.uid}  ${row.email || '(no email)'}  fields: ${Object.keys(row.patch).join(', ')}`);
    } else {
      console.log(`${row.status}  ${row.uid}  ${row.email || '(no email)'}  ${row.error || ''}`);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Checked:        ${checked}`);
  console.log(`Needed fixing:  ${needsFix}`);
  if (args.apply) {
    console.log(`Fixed:          ${fixed}`);
    console.log(`Failed:         ${failed}`);
  } else {
    console.log('Nothing written — this was a dry run. Re-run with --apply to write these changes.');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Backfill script crashed:', err);
  process.exit(1);
});
