import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createApp } from '../src/server.js';
import {
  generateWhatsAppUrl,
  generateWhatsAppIntentUrl,
  generateSmsUrl,
  generateInviteText,
  generateInviteLink,
  cleanPhoneNumber,
  formatPhoneForWhatsApp,
  parseInviteUri,
  generateShortInviteCode,
  isValidInviteCode,
  formatInviteCodeInput,
  generateQrPayload,
  parseQrPayload,
  revokeInviteCode,
  isCodeRevoked,
  resetUserInviteCode,
  trackInvite,
  markInviteJoined,
  getInviteRecord,
  canRemindInvite,
  getRemindCountdown,
  recordReminder,
  savePendingInvite,
  getPendingInvite,
  clearPendingInvite,
  clearInviteStorageForTesting,
  DEFAULT_INVITE_MESSAGE,
  THREE_DAYS_MS
} from '../../frontend/src/services/inviteService.js';

async function runTests() {
  console.log('--- Starting Agent 3: BSDK Clubs Invite System Tests ---');
  clearInviteStorageForTesting();

  // =========================================================================
  // TEST 1: WhatsApp URI & SMS URI Formatting and Message Text
  // =========================================================================
  console.log('\n1. Testing WhatsApp URI & SMS URI formatting and message text...');

  const samplePhone = '98765 43210';
  const samplePhoneWithCountry = '+91 98765 43210';
  const sampleCode = 'GANG-4F8K';

  const cleanPhone = cleanPhoneNumber(samplePhone);
  assert.equal(cleanPhone, '9876543210', 'Phone number must be stripped of non-digits');

  const waFormattedPhone = formatPhoneForWhatsApp(samplePhone);
  assert.equal(waFormattedPhone, '919876543210', '10-digit Indian number must have 91 prefix for WhatsApp');

  const waFormattedWithCountry = formatPhoneForWhatsApp(samplePhoneWithCountry);
  assert.equal(waFormattedWithCountry, '919876543210', '+91 prefixed number must normalize to 919876543210');

  const expectedText = DEFAULT_INVITE_MESSAGE(sampleCode);
  assert.ok(
    expectedText.includes("Hey! I'm on BSDK Clubs — Your Gang. Your Bang."),
    'Invitation text must have exact tagline'
  );
  assert.ok(
    expectedText.includes('messages disappear in 7 days'),
    'Invitation text must mention 7-day disappearing messages'
  );
  assert.ok(
    expectedText.includes(`https://bsdkclubs.app/invite/${sampleCode}`),
    'Invitation text must include correct download link'
  );

  // Test WhatsApp Web URL
  const waUrl = generateWhatsAppUrl({ phone: samplePhone, inviteCode: sampleCode });
  assert.ok(waUrl.startsWith('https://wa.me/919876543210?text='), 'WhatsApp URL must follow wa.me format');
  assert.ok(waUrl.includes(encodeURIComponent(sampleCode)), 'WhatsApp URL must contain encoded invite code');

  // Test WhatsApp Intent URL
  const waIntent = generateWhatsAppIntentUrl({ phone: samplePhone, inviteCode: sampleCode });
  assert.ok(
    waIntent.startsWith('whatsapp://send?phone=919876543210&text='),
    'WhatsApp Intent must follow whatsapp://send format'
  );

  // Test Native SIM SMS Intent URL (Zero server cost)
  const smsUrl = generateSmsUrl({ phone: samplePhone, inviteCode: sampleCode });
  assert.ok(
    smsUrl.startsWith('sms:9876543210?body=') || smsUrl.startsWith('sms:9876543210&body='),
    'SMS URL must follow native sms:phone?body= intent format'
  );
  assert.ok(smsUrl.includes(encodeURIComponent(sampleCode)), 'SMS body must include invite code');
  console.log('   ✓ WhatsApp & Native SMS URIs and pre-filled copy verified.');

  // =========================================================================
  // TEST 2: Link Generation, Deep-Link Parsing & Deferred Application
  // =========================================================================
  console.log('\n2. Testing link generation, deep-link parsing & deferred application...');

  const link = generateInviteLink(sampleCode);
  assert.equal(link, `https://bsdkclubs.app/invite/${sampleCode}`);

  // Test deep-link scheme: bsdkclubs://invite/<code>
  const parsedScheme = parseInviteUri(`bsdkclubs://invite/${sampleCode}`);
  assert.equal(parsedScheme?.type, 'invite');
  assert.equal(parsedScheme?.code, sampleCode);

  // Test deep-link scheme: bsdkclubs://join/<code>
  const parsedJoin = parseInviteUri('bsdkclubs://join/HOSTEL42');
  assert.equal(parsedJoin?.type, 'invite');
  assert.equal(parsedJoin?.code, 'HOSTEL42');

  // Test web link: https://bsdkclubs.app/invite/<code>
  const parsedWeb = parseInviteUri(`https://bsdkclubs.app/invite/${sampleCode}`);
  assert.equal(parsedWeb?.type, 'invite');
  assert.equal(parsedWeb?.code, sampleCode);

  // Test user deep link: bsdkclubs://user/<userId>/<code>
  const parsedUserLink = parseInviteUri(`bsdkclubs://user/piyush/${sampleCode}`);
  assert.equal(parsedUserLink?.type, 'user');
  assert.equal(parsedUserLink?.userId, 'piyush');
  assert.equal(parsedUserLink?.code, sampleCode);

  // Test raw code parsing
  const parsedRawCode = parseInviteUri('GANG-9X2M');
  assert.equal(parsedRawCode?.type, 'code');
  assert.equal(parsedRawCode?.code, 'GANG-9X2M');

  // Test Deferred Invite Code storage (saved before OTP login, applied after)
  savePendingInvite(sampleCode, { source: 'deep_link' });
  const pending = getPendingInvite();
  assert.ok(pending, 'Pending invite must be saved');
  assert.equal(pending.code, sampleCode);
  clearPendingInvite();
  assert.equal(getPendingInvite(), null, 'Pending invite must be cleared after application');
  console.log('   ✓ Deep-links and deferred invite application verified.');

  // =========================================================================
  // TEST 3: Short Code Generation & Validation
  // =========================================================================
  console.log('\n3. Testing short 6-8 character code generation & validation...');

  const shortCode = generateShortInviteCode('GANG');
  assert.ok(/^GANG-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(shortCode), 'Code should match GANG-XXXX format');
  assert.equal(isValidInviteCode(shortCode), true, 'Generated short code must be valid');
  assert.equal(isValidInviteCode('HOSTEL42'), true, 'Existing club codes must be valid');
  assert.equal(isValidInviteCode('??invalid!!'), false, 'Corrupted code must be rejected');

  const formattedInput = formatInviteCodeInput('gang-4f8k ');
  assert.equal(formattedInput, 'GANG-4F8K', 'Input must be auto-uppercased and trimmed');
  console.log('   ✓ Short code generation & formatting verified.');

  // =========================================================================
  // TEST 4: QR Code Payload Generation, Parsing, Revocation & Reset Logic
  // =========================================================================
  console.log('\n4. Testing QR payload generation, parsing, revocation & reset...');

  const qrInvitePayload = generateQrPayload('CLUB-99', 'invite');
  assert.equal(qrInvitePayload, 'bsdk:invite:CLUB-99');

  const qrUserPayload = generateQrPayload(sampleCode, 'user', 'user_abc123');
  assert.equal(qrUserPayload, `bsdk:user:user_abc123:${sampleCode}`);

  // Test parsing valid QR payloads
  const parseInviteResult = parseQrPayload(qrInvitePayload);
  assert.equal(parseInviteResult.valid, true);
  assert.equal(parseInviteResult.type, 'invite');
  assert.equal(parseInviteResult.code, 'CLUB-99');

  const parseUserResult = parseQrPayload(qrUserPayload);
  assert.equal(parseUserResult.valid, true);
  assert.equal(parseUserResult.type, 'user');
  assert.equal(parseUserResult.userId, 'user_abc123');
  assert.equal(parseUserResult.code, sampleCode);

  // Test Revocation logic
  const oldCode = 'GANG-OLD1';
  assert.equal(isCodeRevoked(oldCode), false, 'Code should not be revoked initially');
  revokeInviteCode(oldCode, 'Manual user test revocation');
  assert.equal(isCodeRevoked(oldCode), true, 'Code must now be identified as revoked');

  // Parsing a revoked QR payload must return valid: false and CODE_REVOKED
  const revokedPayload = `bsdk:invite:${oldCode}`;
  const parseRevokedResult = parseQrPayload(revokedPayload);
  assert.equal(parseRevokedResult.valid, false, 'Revoked QR code must fail validation');
  assert.equal(parseRevokedResult.revoked, true, 'Revoked flag must be true');
  assert.equal(parseRevokedResult.error, 'CODE_REVOKED');

  // Test Reset QR code flow (revokes old code, generates fresh one)
  const freshCode = resetUserInviteCode(oldCode, 'GANG');
  assert.notEqual(freshCode, oldCode, 'Fresh code must be different from old code');
  assert.equal(isCodeRevoked(oldCode), true, 'Old code remains revoked');
  assert.equal(isCodeRevoked(freshCode), false, 'New code must not be revoked');
  console.log('   ✓ QR payload formatting, parsing, and revocation/reset verified.');

  // =========================================================================
  // TEST 5: Invite Tracking & 3-Day Reminder Rule
  // =========================================================================
  console.log('\n5. Testing invite tracking & 3-day reminder rule...');

  const trackPhone = '9876511223';
  clearInviteStorageForTesting();

  // Initial state: not invited yet
  assert.equal(getInviteRecord(trackPhone), null);
  assert.equal(canRemindInvite(trackPhone), false, 'Cannot remind uninvited number');

  // Track an invite sent right now
  const record1 = trackInvite({ phone: trackPhone, inviteCode: sampleCode, method: 'whatsapp' });
  assert.equal(record1.phone, trackPhone);
  assert.equal(record1.status, 'invited');
  assert.equal(record1.method, 'whatsapp');

  // Immediate reminder check: 0 days elapsed -> Cooldown active
  assert.equal(canRemindInvite(trackPhone), false, 'Immediate reminder must be blocked (< 3 days)');
  const countdownNow = getRemindCountdown(trackPhone);
  assert.equal(countdownNow.canRemind, false);
  assert.equal(countdownNow.status, 'waiting');
  assert.ok(countdownNow.label.includes('Remind in'), 'Should show cooldown label');

  // Simulate 1 day elapsed: 24h passed -> still < 3 days
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  record1.invitedAt = oneDayAgo;
  record1.lastReminderAt = oneDayAgo;
  // Directly test record object with canRemindInvite
  assert.equal(canRemindInvite(record1), false, 'Reminder after 1 day must still be blocked');

  // Simulate 3.5 days elapsed: > 3 days -> Eligible for reminder!
  const fourDaysAgo = new Date(Date.now() - 3.5 * 24 * 60 * 60 * 1000).toISOString();
  record1.invitedAt = fourDaysAgo;
  record1.lastReminderAt = fourDaysAgo;
  assert.equal(canRemindInvite(record1), true, 'Reminder after 3+ days must be permitted!');
  const countdownEligible = getRemindCountdown(record1);
  assert.equal(countdownEligible.canRemind, true);
  assert.equal(countdownEligible.status, 'eligible');
  assert.equal(countdownEligible.label, 'Remind now');

  // Once contact joins, they must NEVER be reminded again
  const joinedRecord = markInviteJoined({ phone: trackPhone });
  assert.equal(joinedRecord.status, 'joined');
  assert.equal(canRemindInvite(joinedRecord), false, 'Joined user must NEVER be reminded');
  const countdownJoined = getRemindCountdown(joinedRecord);
  assert.equal(countdownJoined.status, 'joined');
  assert.ok(countdownJoined.label.includes('Joined BSDK Clubs'), 'Should show joined status');
  console.log('   ✓ 3-day reminder rule and invite lifecycle tracking verified.');

  // =========================================================================
  // TEST 6: Backend REST API Endpoints Integration
  // =========================================================================
  console.log('\n6. Testing backend REST API endpoints integration...');

  const tmpDb = path.join(os.tmpdir(), `bsdk-invites-test-${Date.now()}.sqlite`);
  const { server, db } = createApp({ dbPath: tmpDb });

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
    // 6a. Login seeded user
    const loginRes = await api('POST', '/auth/login', null, { user_id: 'piyush', password: 'bsdk1234' });
    assert.equal(loginRes.status, 200);
    const token = loginRes.data.access_token;

    // 6b. Resolve seeded club invite code (HOSTEL42)
    const resolveClub = await api('GET', '/invites/resolve/HOSTEL42', null);
    assert.equal(resolveClub.status, 200, 'Direct club invite code must resolve');
    assert.equal(resolveClub.data.type, 'club');
    assert.equal(resolveClub.data.club.name, 'Hostel Bakcodi');

    // 6c. Generate personal gang invite code via API
    const codeGenRes = await api('POST', '/invites/code', token, { regenerate: true });
    assert.equal(codeGenRes.status, 201);
    const myCode = codeGenRes.data.code;
    assert.ok(myCode.startsWith('GANG-'), 'API should issue GANG-XXXX personal code');
    assert.ok(codeGenRes.data.qr_data.startsWith('bsdk:user:'), 'QR data must match bsdk:user format');

    // 6d. Resolve generated personal code
    const resolveUser = await api('GET', `/invites/preview/${myCode}`, null);
    assert.equal(resolveUser.status, 200);
    assert.equal(resolveUser.data.type, 'user');
    assert.equal(resolveUser.data.user.user_id, 'piyush');

    // 6e. Reset personal QR code via API (immediately revokes old code)
    const resetRes = await api('POST', '/invites/reset-user-code', token, {});
    assert.equal(resetRes.status, 200);
    assert.notEqual(resetRes.data.code, myCode, 'Reset code must be new');

    // 6f. Old code must now return 410 INVITE_REVOKED
    const resolveOld = await api('GET', `/invites/resolve/${myCode}`, null);
    assert.equal(resolveOld.status, 410, 'Revoked code must return 410 INVITE_REVOKED');

    // 6g. Test backend invite tracking endpoint
    const trackApiRes = await api('POST', '/invites/track', token, {
      phone: '9876543210',
      invite_method: 'whatsapp'
    });
    assert.equal(trackApiRes.status, 201);
    assert.equal(trackApiRes.data.status, 'invited');

    // 6h. Immediate remind attempt on backend (blocked by 3-day cooldown)
    const remindApiBlocked = await api('POST', '/invites/remind', token, {
      phone: '9876543210',
      invite_method: 'whatsapp'
    });
    assert.equal(remindApiBlocked.status, 429, 'Backend must block reminder before 3 days');
    assert.match(remindApiBlocked.data.error.message, /3-day reminder cooldown active/);

    console.log('   ✓ Backend REST endpoints (/invites/code, /invites/resolve, /invites/reset-user-code, /invites/track, /invites/remind) verified.');
  } finally {
    server.close();
    try { fs.unlinkSync(tmpDb); } catch {}
  }

  console.log('\n=============================================================');
  console.log('🎉 ALL AGENT 3 INVITE SYSTEM TESTS PASSED SUCCESSFULLY! 🎉');
  console.log('=============================================================\n');
}

runTests().catch((err) => {
  console.error('\n❌ Test Failure:', err);
  process.exit(1);
});
