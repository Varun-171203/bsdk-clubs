import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createApp } from '../src/server.js';
import {
  normalizePhoneE164,
  formatPhoneDisplay,
  hashPhoneNumber,
  expandContactNumbers,
  classifyContacts,
  detectNewlyJoinedContacts,
  generateInviteLink,
  safeStorage,
  STORAGE_INVITED_HASHES_KEY
} from '../../frontend/src/services/contactsService.js';

const FORBIDDEN_PRIVACY_KEYS = ['password_hash', 'email'];

function checkNoForbiddenKeys(obj, label) {
  const stack = [{ val: obj, p: label }];
  while (stack.length > 0) {
    const { val, p } = stack.pop();
    if (!val || typeof val !== 'object') continue;
    for (const key of Object.keys(val)) {
      assert.ok(!FORBIDDEN_PRIVACY_KEYS.includes(key), `PRIVACY LEAK in ${p}: forbidden key "${key}"`);
      if (val[key] && typeof val[key] === 'object') {
        stack.push({ val: val[key], p: `${p}.${key}` });
      }
    }
  }
}

async function runTests() {
  console.log('--- Starting Agent 1 (Contacts & Discovery) Test Suite ---\n');

  // =========================================================================
  // 1. Phone Normalization (E.164) Tests
  // =========================================================================
  console.log('1. Testing E.164 Phone Normalization (+91 India default & International)...');

  // India numbers
  assert.equal(normalizePhoneE164('9876543210'), '+919876543210', '10-digit should prepend +91');
  assert.equal(normalizePhoneE164('09876543210'), '+919876543210', 'Leading 0 should be stripped for India');
  assert.equal(normalizePhoneE164('919876543210'), '+919876543210', '12-digit without + should prepend +');
  assert.equal(normalizePhoneE164('+91 98765 43210'), '+919876543210', 'Spaces should be stripped');
  assert.equal(normalizePhoneE164('+91-98765-43210'), '+919876543210', 'Hyphens should be stripped');
  assert.equal(normalizePhoneE164('(0) 98765-43210'), '+919876543210', 'Parentheses & dashes should be stripped');
  assert.equal(normalizePhoneE164('00919876543210'), '+919876543210', '00 prefix should be converted to +');

  // International numbers
  assert.equal(normalizePhoneE164('+1 (415) 555-2671'), '+14155552671', 'US numbers should normalize to +14155552671');
  assert.equal(normalizePhoneE164('+44 7911 123456'), '+447911123456', 'UK numbers should normalize to +447911123456');
  assert.equal(normalizePhoneE164('+971 50 123 4567'), '+971501234567', 'UAE numbers should normalize to +971501234567');
  assert.equal(normalizePhoneE164('0014155552671'), '+14155552671', '001 should become +1');

  // Invalid numbers
  assert.equal(normalizePhoneE164(''), '', 'Empty string returns empty');
  assert.equal(normalizePhoneE164('1234'), '', 'Too short numbers return empty');
  assert.equal(normalizePhoneE164('invalid-phone'), '', 'Non-numeric returns empty');
  assert.equal(normalizePhoneE164(null), '', 'Null returns empty');

  // Display formatting
  assert.equal(formatPhoneDisplay('+919876543210'), '+91 98765 43210');
  console.log('   ✅ Normalization tests passed perfectly.');

  // =========================================================================
  // 2. SHA-256 Privacy Hashing Tests
  // =========================================================================
  console.log('\n2. Testing SHA-256 Privacy Hashing (Never upload raw phone numbers)...');

  const rawPhone = '+919876543210';
  const expectedHash = crypto.createHash('sha256').update(rawPhone).digest('hex');
  const actualHash = await hashPhoneNumber(rawPhone);

  assert.equal(actualHash, expectedHash, 'Client hash must match standard crypto SHA-256 hex');
  assert.equal(actualHash.length, 64, 'SHA-256 hex must be exactly 64 characters');
  assert.match(actualHash, /^[a-f0-9]{64}$/, 'Hash must contain only lowercase hex characters');
  assert.ok(!actualHash.includes('9876543210'), 'Hash must NEVER contain plaintext phone number');

  // Test trimming & lowercasing consistency
  const hashWithSpaces = await hashPhoneNumber(' +919876543210  ');
  assert.equal(hashWithSpaces, actualHash, 'Whitespace must not alter resulting hash');
  console.log('   ✅ SHA-256 privacy hashing passed.');

  // =========================================================================
  // 3. Backend API Test Setup
  // =========================================================================
  console.log('\n3. Starting Backend API Test Server...');
  const tmpDb = path.join(os.tmpdir(), `bsdk-contacts-test-${Date.now()}.sqlite`);
  const { server, db, expiryTimer } = createApp({ dbPath: tmpDb });

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/v1`;

  async function api(method, url, token, body) {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json();
    return { status: res.status, data };
  }

  try {
    // Login as seeded demo user (piyush)
    const loginRes = await api('POST', '/auth/login', null, { user_id: 'piyush', password: 'bsdk1234' });
    assert.equal(loginRes.status, 200, 'Login failed');
    const token = loginRes.data.access_token;
    assert.ok(token, 'Access token missing');

    // =========================================================================
    // 4. POST /api/v1/contacts/lookup Endpoint Validation
    // =========================================================================
    console.log('\n4. Testing POST /api/v1/contacts/lookup (Hashed Contact Discovery)...');

    // Compute hashes for seeded users:
    // Seeded users in database.js: Piyush (+919876543210), Rohan (+919876543211), Ananya (+919876543212)
    const hashPiyush = await hashPhoneNumber('+919876543210');
    const hashRohan = await hashPhoneNumber('+919876543211');
    const hashAnanya = await hashPhoneNumber('+919876543212');
    const hashUnknown = await hashPhoneNumber('+919811122233'); // Not registered

    const lookupRes = await api('POST', '/contacts/lookup', token, {
      hashes: [hashPiyush, hashRohan, hashAnanya, hashUnknown]
    });

    assert.equal(lookupRes.status, 200, 'Lookup must return 200 OK');
    assert.ok(lookupRes.data.success, 'Lookup must return success: true');
    assert.ok(Array.isArray(lookupRes.data.contacts), 'Contacts must be an array');
    assert.equal(lookupRes.data.contacts.length, 3, 'Must match exactly the 3 registered hashes');

    // PRIVACY VERIFICATION: Inspect returned contact objects
    const returnedHashes = lookupRes.data.contacts.map((c) => c.phone_hash);
    assert.ok(returnedHashes.includes(hashPiyush), 'Piyush hash must be returned');
    assert.ok(returnedHashes.includes(hashRohan), 'Rohan hash must be returned');
    assert.ok(returnedHashes.includes(hashAnanya), 'Ananya hash must be returned');
    assert.ok(!returnedHashes.includes(hashUnknown), 'Unregistered hash must NOT be returned');

    // Ensure raw phone numbers are NEVER present in response
    const jsonString = JSON.stringify(lookupRes.data);
    assert.ok(!jsonString.includes('9876543210'), 'PRIVACY LEAK: Raw phone found in lookup response!');
    assert.ok(!jsonString.includes('+91'), 'PRIVACY LEAK: Country code found in lookup response!');
    checkNoForbiddenKeys(lookupRes.data, 'contacts.lookup');

    for (const c of lookupRes.data.contacts) {
      assert.ok(c.id, 'User ID must be present');
      assert.ok(c.user_id, 'Handle must be present');
      assert.ok(c.real_name, 'Real name must be present');
      assert.ok(c.phone_hash, 'Phone hash must be present');
      assert.equal(c.phone, undefined, 'Plain phone MUST be undefined in response');
      assert.equal(c.email, undefined, 'Plain email MUST be undefined in response');
    }
    console.log('   ✅ POST /api/v1/contacts/lookup validated with ZERO privacy leaks.');

    // =========================================================================
    // 5. Multi-Number Contact Handling Test
    // =========================================================================
    console.log('\n5. Testing Multi-Number Contact Handling...');
    // A single contact "Rohit Sharma" has 2 numbers:
    // Number 1: +91 98765 43211 (Rohan - Registered)
    // Number 2: +91 98765 43299 (Unregistered)
    const rawMultiContact = [
      {
        id: 'c_multi',
        name: 'Rohit Sharma',
        numbers: [
          { number: '+91 98765 43211', label: 'Work (BSDK)' },
          { number: '+91 98765 43299', label: 'Personal (Invite)' }
        ]
      }
    ];

    const expandedMulti = await expandContactNumbers(rawMultiContact);
    assert.equal(expandedMulti.length, 2, 'Contact with 2 numbers must expand into 2 distinct rows');
    assert.equal(expandedMulti[0].contactName, 'Rohit Sharma');
    assert.equal(expandedMulti[0].label, 'Work (BSDK)');
    assert.equal(expandedMulti[1].contactName, 'Rohit Sharma');
    assert.equal(expandedMulti[1].label, 'Personal (Invite)');

    // Build lookup map from API response
    const lookupMap = new Map();
    for (const c of lookupRes.data.contacts) {
      lookupMap.set(c.phone_hash, c);
    }

    const { registered, unregistered } = classifyContacts(expandedMulti, lookupMap);
    assert.equal(registered.length, 1, 'Registered number must go to "Contacts on BSDK Clubs"');
    assert.equal(registered[0].contactName, 'Rohit Sharma');
    assert.equal(registered[0].label, 'Work (BSDK)');
    assert.equal(registered[0].registeredUser.real_name, 'Rohan Verma');

    assert.equal(unregistered.length, 1, 'Unregistered number must go to "Invite to BSDK Clubs"');
    assert.equal(unregistered[0].contactName, 'Rohit Sharma');
    assert.equal(unregistered[0].label, 'Personal (Invite)');
    assert.equal(unregistered[0].normalizedPhone, '+919876543299');
    console.log('   ✅ Multi-number contacts successfully split into individual status rows.');

    // =========================================================================
    // 6. Same Person Under Different Names (Strict Number Matching, No Merging)
    // =========================================================================
    console.log('\n6. Testing Strict Phone Matching (Same number under different names must NOT merge)...');
    // Contact list has "Papa" and "Dad" with the exact same phone number
    const duplicateNumberContacts = [
      { id: 'c_papa', name: 'Papa', numbers: ['+91 98765 43211'] },
      { id: 'c_dad', name: 'Dad', numbers: ['+91 98765 43211'] }
    ];

    const expandedDups = await expandContactNumbers(duplicateNumberContacts);
    assert.equal(expandedDups.length, 2, 'Must create 2 separate items');

    const classifiedDups = classifyContacts(expandedDups, lookupMap);
    assert.equal(classifiedDups.registered.length, 2, 'Both Papa and Dad must be present');
    const names = classifiedDups.registered.map((c) => c.contactName);
    assert.ok(names.includes('Papa'), 'Papa must exist independently');
    assert.ok(names.includes('Dad'), 'Dad must exist independently');
    assert.equal(classifiedDups.registered[0].phoneHash, classifiedDups.registered[1].phoneHash, 'Both point to same phone hash');
    console.log('   ✅ Strict phone matching verified: contacts are never erroneously merged.');

    // =========================================================================
    // 7. Background Joined Detection ("X joined BSDK Clubs")
    // =========================================================================
    console.log('\n7. Testing Background Joined Detection ("X joined BSDK Clubs")...');
    const newFriendPhone = '+919899988877';
    const newFriendHash = await hashPhoneNumber(newFriendPhone);

    // Initial state: newFriendHash was in invited/unregistered cache
    const prevInvited = [newFriendHash];
    const contactRows = [
      {
        contactId: 'c_vikram',
        contactName: 'Vikram Rajput',
        normalizedPhone: newFriendPhone,
        phoneHash: newFriendHash
      }
    ];

    // Case A: Still not registered -> detectNewlyJoinedContacts returns 0
    const emptyMap = new Map();
    const noJoins = detectNewlyJoinedContacts(prevInvited, emptyMap, contactRows);
    assert.equal(noJoins.length, 0, 'No joins if still not in registered map');

    // Case B: Friend registers on BSDK Clubs!
    const updatedLookupMap = new Map([
      [newFriendHash, { id: 'u_vikram', user_id: 'vikram', real_name: 'Vikram Rajput' }]
    ]);

    const joinedList = detectNewlyJoinedContacts(prevInvited, updatedLookupMap, contactRows);
    assert.equal(joinedList.length, 1, 'Must detect 1 newly joined contact');
    assert.equal(joinedList[0].contactName, 'Vikram Rajput');
    assert.equal(joinedList[0].message, 'Vikram Rajput joined BSDK Clubs');
    assert.equal(joinedList[0].phone, newFriendPhone);
    console.log(`   ✅ Detected joined contact: "${joinedList[0].message}"`);

    // =========================================================================
    // 8. Invite Link Generator Validation
    // =========================================================================
    console.log('\n8. Testing WhatsApp-style Invite Link Generator...');
    const invite = generateInviteLink('Sneha');
    assert.ok(invite.smsUrl.includes('sms:'), 'SMS URL must be present');
    assert.ok(invite.copyText.includes('Sneha'), 'Invite message must be personalized with contact name');
    assert.ok(invite.shareUrl.startsWith('https://'), 'Share URL must be valid');
    console.log('   ✅ Invite link generation verified.');

    // =========================================================================
    // 9. Direct 1-on-1 Chat Initiation API (POST /api/v1/contacts/start-chat)
    // =========================================================================
    console.log('\n9. Testing Direct Chat Initiation API (POST /api/v1/contacts/start-chat)...');
    const rohanUser = db.prepare("SELECT id FROM users WHERE user_id = 'rohan'").get();
    assert.ok(rohanUser, 'Rohan user must exist in DB');

    const startChatRes = await api('POST', '/contacts/start-chat', token, {
      contact_user_id: rohanUser.id
    });

    assert.equal(startChatRes.status, 201, 'New direct chat must return 201 Created');
    assert.ok(startChatRes.data.club, 'Club object must be returned');
    assert.equal(startChatRes.data.club.member_count, 2, 'Direct chat club must have 2 members');
    const directClubId = startChatRes.data.club.id;

    // Second call to start-chat with same user must be idempotent and return existing club
    const secondCallRes = await api('POST', '/contacts/start-chat', token, {
      contact_user_id: rohanUser.id
    });
    assert.equal(secondCallRes.status, 200, 'Existing direct chat must return 200 OK');
    assert.equal(secondCallRes.data.club.id, directClubId, 'Must return the same direct club');
    console.log('   ✅ Direct 1-on-1 chat creation and retrieval validated.');

    console.log('\n=======================================================');
    console.log('🎉 ALL AGENT 1 (CONTACTS & DISCOVERY) TESTS PASSED 100%!');
    console.log('=======================================================');
  } finally {
    clearInterval(expiryTimer);
    await new Promise((resolve) => server.close(resolve));
    try {
      if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
      if (fs.existsSync(`${tmpDb}-wal`)) fs.unlinkSync(`${tmpDb}-wal`);
      if (fs.existsSync(`${tmpDb}-shm`)) fs.unlinkSync(`${tmpDb}-shm`);
    } catch {}
  }
}

runTests().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
