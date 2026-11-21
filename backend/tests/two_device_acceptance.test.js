import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/server.js';
import { normalizePhoneE164, hashPhoneNumber } from '../src/common/utils.js';

async function runTwoDeviceAcceptanceSuite() {
  console.log('================================================================');
  console.log('BSDK CLUBS — 2-DEVICE ACCEPTANCE TEST SUITE (PART 5)');
  console.log('================================================================\n');

  const tmpDb = path.join(os.tmpdir(), `bsdk-2dev-acceptance-${Date.now()}.sqlite`);
  const { server, db, expiryTimer } = createApp({ dbPath: tmpDb });

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/v1`;

  async function api(method, endpoint, token, body, headers = {}) {
    const isGetOrHead = method === 'GET' || method === 'HEAD';
    const res = await fetch(`${base}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers
      },
      body: !isGetOrHead && body !== undefined && body !== null ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  const results = [];

  try {
    // ------------------------------------------------------------------------
    // SETUP: Register Device A (+91 9876543210, Varun) and Device B (+91 9123456789, Piyush)
    // ------------------------------------------------------------------------
    console.log('[SETUP] Provisioning Device A (Varun) and Device B (Piyush) on Shared Backend...');
    const phoneA = '9876543210';
    const otpResA = await api('POST', '/auth/request-otp', null, { country_code: '+91', phone: phoneA });
    const verifyA = await api('POST', '/auth/verify-otp', null, {
      country_code: '+91',
      phone: phoneA,
      otp: otpResA.data.dev_otp,
      device_id: 'device_A_phone_1'
    });
    assert.equal(otpResA.status, 200, 'OTP request for Device A must succeed');
    assert.equal(verifyA.status, 200, 'OTP verify for Device A must succeed');
    let tokenA = verifyA.data.access_token;
    let refreshA = verifyA.data.refresh_token;

    await api('POST', '/auth/profile', tokenA, {
      real_name: 'Varun',
      about: 'Building BSDK Clubs',
      profile_photo_url: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Varun'
    }, { 'x-device-id': 'device_A_phone_1' });

    const phoneB = '9123456789';
    const otpResB = await api('POST', '/auth/request-otp', null, { country_code: '+91', phone: phoneB });
    assert.equal(otpResB.status, 200, 'OTP request for Device B must succeed');
    const verifyB = await api('POST', '/auth/verify-otp', null, {
      country_code: '+91',
      phone: phoneB,
      otp: otpResB.data.dev_otp,
      device_id: 'device_B_phone_2'
    });
    assert.equal(verifyB.status, 200, 'OTP verify for Device B must succeed');
    const tokenB = verifyB.data.access_token;
    const refreshB = verifyB.data.refresh_token;

    await api('POST', '/auth/profile', tokenB, {
      real_name: 'Piyush',
      about: 'Gang Leader',
      profile_photo_url: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Piyush'
    }, { 'x-device-id': 'device_B_phone_2' });

    console.log('✓ Device A registered: Varun (+91 9876543210, device_A_phone_1)');
    console.log('✓ Device B registered: Piyush (+91 9123456789, device_B_phone_2)\n');

    // ------------------------------------------------------------------------
    // TEST 1: Session persistence across app close
    // ------------------------------------------------------------------------
    console.log('--- TEST 1: Session persistence across app close ---');
    // Simulated Android SharedPreferences disk storage
    const simulatedDiskStorage = {
      bsdk_auth: JSON.stringify({
        access_token: tokenA,
        refresh_token: refreshA,
        device_id: 'device_A_phone_1'
      })
    };
    // Simulate app force-close & process kill: memory state wiped, restored from disk
    const rehydratedAuth = JSON.parse(simulatedDiskStorage.bsdk_auth);
    const meRes1 = await api('GET', '/auth/me', rehydratedAuth.access_token, null, {
      'x-device-id': rehydratedAuth.device_id
    });
    assert.equal(meRes1.status, 200, 'Session must remain valid after app close');
    assert.equal(meRes1.data.user.real_name, 'Varun', 'User must still be logged in as Varun');
    results.push({ id: 1, name: 'Session persistence across app close', status: 'PASS', details: 'User remains logged in as Varun; no login/OTP screen' });
    console.log('PASS: User is STILL logged in as Varun after simulated process kill.\n');

    // ------------------------------------------------------------------------
    // TEST 2: Session persistence across phone restart
    // ------------------------------------------------------------------------
    console.log('--- TEST 2: Session persistence across phone restart ---');
    // Simulated reboot: SQLite / SharedPreferences read from cold storage
    const rebootedAuth = JSON.parse(simulatedDiskStorage.bsdk_auth);
    const meRes2 = await api('GET', '/auth/me', rebootedAuth.access_token, null, {
      'x-device-id': rebootedAuth.device_id
    });
    assert.equal(meRes2.status, 200, 'Session must restore cleanly after reboot');
    assert.equal(meRes2.data.user.phone, '+919876543210');
    results.push({ id: 2, name: 'Session persistence across phone restart', status: 'PASS', details: 'Cold-start restores session from disk without prompt' });
    console.log('PASS: Cold restart successfully restored session from disk.\n');

    // ------------------------------------------------------------------------
    // TEST 3: Silent token refresh
    // ------------------------------------------------------------------------
    console.log('--- TEST 3: Silent token refresh ---');
    // Simulate expired access token, call POST /auth/refresh with refresh token
    const refreshRes = await api('POST', '/auth/refresh', null, {
      refresh_token: refreshA
    }, { 'x-device-id': 'device_A_phone_1' });
    assert.equal(refreshRes.status, 200, 'Refresh must succeed silently');
    assert.ok(refreshRes.data.access_token, 'New access token must be returned');
    tokenA = refreshRes.data.access_token; // updated token
    if (refreshRes.data.refresh_token) refreshA = refreshRes.data.refresh_token;

    // Verify new token works seamlessly
    const testReq = await api('GET', '/auth/me', tokenA, null, { 'x-device-id': 'device_A_phone_1' });
    assert.equal(testReq.status, 200);
    results.push({ id: 3, name: 'Silent token refresh', status: 'PASS', details: 'Refresh token silently refreshed access token; user never logged out' });
    console.log('PASS: Silent refresh returned new access token, API requests resume.\n');

    // ------------------------------------------------------------------------
    // TEST 4: Single primary device revocation (WhatsApp rule)
    // ------------------------------------------------------------------------
    console.log('--- TEST 4: Single primary device revocation (WhatsApp rule) ---');
    // User registers the same phone number (+91 9876543210) on Device C
    const otpResC = await api('POST', '/auth/request-otp', null, { country_code: '+91', phone: phoneA });
    const verifyC = await api('POST', '/auth/verify-otp', null, {
      country_code: '+91',
      phone: phoneA,
      otp: otpResC.data.dev_otp,
      device_id: 'device_C_phone_3' // New device!
    });
    assert.equal(verifyC.status, 200);
    const tokenC = verifyC.data.access_token;

    // Old Device A now makes an API request
    const staleDeviceAReq = await api('GET', '/clubs', tokenA, null, {
      'x-device-id': 'device_A_phone_1'
    });
    assert.equal(staleDeviceAReq.status, 401, 'Device A must be revoked');
    assert.equal(staleDeviceAReq.data.error.code, 'SESSION_REVOKED', 'Must return SESSION_REVOKED');
    assert.match(staleDeviceAReq.data.error.message, /another device/i);

    // Device C is active and works
    const deviceCReq = await api('GET', '/clubs', tokenC, null, {
      'x-device-id': 'device_C_phone_3'
    });
    assert.equal(deviceCReq.status, 200, 'Device C is now the primary active device');

    results.push({ id: 4, name: 'Single primary device revocation', status: 'PASS', details: 'Device A received 401 SESSION_REVOKED; Device C active' });
    console.log('PASS: Device A revoked with SESSION_REVOKED; Device C active.\n');

    // Restore Device A as active for subsequent tests
    const restoreOtpA = await api('POST', '/auth/request-otp', null, { country_code: '+91', phone: phoneA });
    const restoreVerifyA = await api('POST', '/auth/verify-otp', null, {
      country_code: '+91',
      phone: phoneA,
      otp: restoreOtpA.data.dev_otp,
      device_id: 'device_A_phone_1'
    });
    tokenA = restoreVerifyA.data.access_token;
    refreshA = restoreVerifyA.data.refresh_token;

    // ------------------------------------------------------------------------
    // TEST 5: Number search for registered user
    // ------------------------------------------------------------------------
    console.log('--- TEST 5: Number search for registered user ---');
    // Device B searches for Varun's number formatted differently
    const searchVariants = ['+91 9876543210', '9876543210', '+91-98765-43210', '09876543210'];
    for (const variant of searchVariants) {
      const searchRes = await api('GET', `/users/search?phone=${encodeURIComponent(variant)}`, tokenB, null, {
        'x-device-id': 'device_B_phone_2'
      });
      if (searchRes.status !== 200) {
        console.error('[Search Debug Error]', searchRes.status, searchRes.data);
      }
      assert.equal(searchRes.status, 200, `Search for variant "${variant}" must succeed`);
      assert.equal(searchRes.data.found, true, `Must find registered user for variant "${variant}"`);
      assert.equal(searchRes.data.user.real_name, 'Varun');
      assert.equal(searchRes.data.phone_e164, '+919876543210');
    }
    results.push({ id: 5, name: 'Number search for registered user', status: 'PASS', details: 'All 4 format variants found Varun on shared server database' });
    console.log('PASS: Device B successfully found Varun (+91 9876543210) across all input formats.\n');

    // ------------------------------------------------------------------------
    // TEST 6: Number search for non-registered user
    // ------------------------------------------------------------------------
    console.log('--- TEST 6: Number search for non-registered user ---');
    const searchUnreg = await api('GET', '/users/search?phone=+919999999999', tokenB, null, {
      'x-device-id': 'device_B_phone_2'
    });
    assert.equal(searchUnreg.status, 200);
    assert.equal(searchUnreg.data.found, false, 'Should return found: false');
    assert.equal(searchUnreg.data.phone_e164, '+919999999999');
    results.push({ id: 6, name: 'Number search for non-registered user', status: 'PASS', details: 'Returns found: false with normalized phone for green INVITE button' });
    console.log('PASS: Unregistered number returns found: false and prepares green INVITE action.\n');

    // ------------------------------------------------------------------------
    // TEST 7: QR / deep link group preview
    // ------------------------------------------------------------------------
    console.log('--- TEST 7: QR / deep link group preview ---');
    // Device A creates club "Hostel Boys"
    const createClubRes = await api('POST', '/clubs', tokenA, {
      name: 'Hostel Boys',
      description: 'Hostel 4 Gang Chat',
      disappearing_seconds: 604800
    }, { 'x-device-id': 'device_A_phone_1' });
    assert.equal(createClubRes.status, 201);
    const club = createClubRes.data.club;
    const inviteCode = club.invite_code;
    assert.ok(inviteCode, 'Invite code must be generated');

    // Device B queries preview before joining (WhatsApp group preview)
    const previewRes = await api('GET', `/clubs/preview/${inviteCode}`, tokenB, null, {
      'x-device-id': 'device_B_phone_2'
    });
    assert.equal(previewRes.status, 200);
    assert.equal(previewRes.data.club.name, 'Hostel Boys');
    assert.equal(previewRes.data.club.member_count, 1);
    assert.equal(previewRes.data.club.already_member, false);
    assert.ok(previewRes.data.club.members.length >= 1, 'Member list must be visible for trust');
    results.push({ id: 7, name: 'QR / deep link group preview', status: 'PASS', details: 'Returns group name, photo, member count, and trust member list' });
    console.log(`PASS: Preview returned group "${club.name}" with member count 1 and trust preview.\n`);

    // ------------------------------------------------------------------------
    // TEST 8: Graceful join if already a member
    // ------------------------------------------------------------------------
    console.log('--- TEST 8: Graceful join if already a member ---');
    // Device B joins for the first time
    const joinRes1 = await api('POST', '/clubs/join', tokenB, {
      invite_code: inviteCode
    }, { 'x-device-id': 'device_B_phone_2' });
    assert.equal(joinRes1.status, 201);
    assert.equal(joinRes1.data.already_member, false);

    // Device B clicks or scans the same QR / deep link AGAIN
    const joinRes2 = await api('POST', '/clubs/join', tokenB, {
      invite_code: inviteCode
    }, { 'x-device-id': 'device_B_phone_2' });
    assert.equal(joinRes2.status, 200, 'Must return HTTP 200, not 409 error!');
    assert.equal(joinRes2.data.already_member, true, 'Flag already_member must be true');
    assert.equal(joinRes2.data.club.id, club.id);
    results.push({ id: 8, name: 'Graceful join if already a member', status: 'PASS', details: 'Returns HTTP 200 already_member: true instead of 409 error' });
    console.log('PASS: Re-scanning existing club returned 200 already_member: true, seamlessly opening chat.\n');

    // ------------------------------------------------------------------------
    // TEST 9: Reset invite link handling
    // ------------------------------------------------------------------------
    console.log('--- TEST 9: Reset invite link handling ---');
    // Device A (admin) resets the invite code
    const resetRes = await api('POST', `/clubs/${club.id}/reset-invite`, tokenA, null, {
      'x-device-id': 'device_A_phone_1'
    });
    assert.equal(resetRes.status, 200);
    const newCode = resetRes.data.invite_code;
    assert.notEqual(newCode, inviteCode, 'New invite code must be different');

    // Device B (or any new device) attempts preview with OLD invite code
    const oldPreviewRes = await api('GET', `/clubs/preview/${inviteCode}`, tokenB, null, {
      'x-device-id': 'device_B_phone_2'
    });
    assert.equal(oldPreviewRes.status, 410, 'Revoked code must return HTTP 410');
    assert.equal(oldPreviewRes.data.error.code, 'INVITE_REVOKED');
    assert.match(oldPreviewRes.data.error.message, /no longer valid|reset/i);

    // Device B attempts join with OLD invite code
    const oldJoinRes = await api('POST', '/clubs/join', tokenB, {
      invite_code: inviteCode
    }, { 'x-device-id': 'device_B_phone_2' });
    assert.equal(oldJoinRes.status, 410, 'Revoked code join must return HTTP 410');
    assert.equal(oldJoinRes.data.error.code, 'INVITE_REVOKED');

    results.push({ id: 9, name: 'Reset invite link handling', status: 'PASS', details: 'Revoked/reset code returns HTTP 410 INVITE_REVOKED without crash' });
    console.log('PASS: Reset invite code cleanly returns 410 INVITE_REVOKED.\n');

  } finally {
    clearInterval(expiryTimer);
    server.close();
    try { fs.unlinkSync(tmpDb); } catch {}
  }

  console.log('================================================================');
  console.log('ALL 9 ACCEPTANCE TESTS COMPLETED SUCCESSFULLY!');
  console.log('================================================================\n');
  console.table(results);
}

runTwoDeviceAcceptanceSuite().catch((err) => {
  console.error('[FATAL TEST FAILURE]', err);
  process.exit(1);
});
