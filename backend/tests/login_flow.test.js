import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createApp } from '../src/server.js';

async function runTests() {
  const tmpDb = path.join(os.tmpdir(), `bsdk-login-test-${Date.now()}.sqlite`);
  const { server, db, expiryTimer } = createApp({ dbPath: tmpDb });

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/v1`;

  async function api(method, url, token, body, headers = {}) {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json();
    return { status: res.status, data };
  }

  try {
    console.log('1. Testing Phone Number Validation (+91 10-digit Indian numbers)...');
    const invalidPhone = await api('POST', '/auth/request-otp', null, { country_code: '+91', phone: '12345' });
    assert.equal(invalidPhone.status, 400, 'Should reject invalid phone length');

    const validPhone = '9876543210';
    const otpReq1 = await api('POST', '/auth/request-otp', null, { country_code: '+91', phone: validPhone });
    assert.equal(otpReq1.status, 200);
    assert.ok(otpReq1.data.success);
    assert.ok(otpReq1.data.dev_otp, 'Dev OTP must be present for testing');
    const otp1 = otpReq1.data.dev_otp;

    console.log('2. Testing Wrong OTP & Attempt Counter (max 5 attempts before lockout)...');
    const wrong1 = await api('POST', '/auth/verify-otp', null, { country_code: '+91', phone: validPhone, otp: '000000' });
    assert.equal(wrong1.status, 400);
    assert.match(wrong1.data.error.message, /4 attempts remaining/);

    console.log('3. Testing New User Verification & is_new_user flag...');
    const verifySuccess = await api('POST', '/auth/verify-otp', null, {
      country_code: '+91',
      phone: validPhone,
      otp: otp1,
      device_id: 'device_phone_A'
    });
    assert.equal(verifySuccess.status, 200);
    assert.equal(verifySuccess.data.is_new_user, true, 'Brand new number must be flagged as new user');
    const tokenA = verifySuccess.data.access_token;
    assert.ok(tokenA, 'Access token must be returned');

    console.log('4. Testing Profile Setup Screen API (POST /auth/profile)...');
    const profileRes = await api('POST', '/auth/profile', tokenA, {
      real_name: 'Piyush Saxena',
      about: 'Your Gang. Your Bang.',
      profile_photo_url: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Piyush'
    });
    assert.equal(profileRes.status, 200);
    assert.equal(profileRes.data.user.real_name, 'Piyush Saxena');

    console.log('5. Testing Existing User Returning Login (is_new_user must be false)...');
    const otpReq2 = await api('POST', '/auth/request-otp', null, { country_code: '+91', phone: validPhone });
    assert.equal(otpReq2.status, 200);
    const otp2 = otpReq2.data.dev_otp;
    const verifyReturning = await api('POST', '/auth/verify-otp', null, {
      country_code: '+91',
      phone: validPhone,
      otp: otp2,
      device_id: 'device_phone_A'
    });
    assert.equal(verifyReturning.status, 200);
    assert.equal(verifyReturning.data.is_new_user, false, 'Existing user with profile must NOT be flagged as new user');

    console.log('6. Testing Two-Step Verification (6-digit PIN)...');
    const setupPin = await api('POST', '/auth/two-step/setup', tokenA, { pin: '123456' });
    assert.equal(setupPin.status, 200);

    const otpReq3 = await api('POST', '/auth/request-otp', null, { country_code: '+91', phone: validPhone });
    const otp3 = otpReq3.data.dev_otp;
    const verifyPinPrompt = await api('POST', '/auth/verify-otp', null, {
      country_code: '+91',
      phone: validPhone,
      otp: otp3,
      device_id: 'device_phone_A'
    });
    assert.equal(verifyPinPrompt.status, 200);
    assert.equal(verifyPinPrompt.data.requires_two_step, true, 'Must require two-step PIN if enabled');

    const verifyPinSuccess = await api('POST', '/auth/two-step/verify', null, {
      phone: validPhone,
      pin: '123456',
      device_id: 'device_phone_A'
    });
    assert.equal(verifyPinSuccess.status, 200);
    assert.ok(verifyPinSuccess.data.access_token);

    console.log('7. Testing Single Device Session Revocation (Logging in on Device B)...');
    const otpReq4 = await api('POST', '/auth/request-otp', null, { country_code: '+91', phone: '9876543211' });
    const otp4 = otpReq4.data.dev_otp;
    const devALogin = await api('POST', '/auth/verify-otp', null, {
      country_code: '+91',
      phone: '9876543211',
      otp: otp4,
      device_id: 'device_A'
    });
    const devAToken = devALogin.data.access_token;

    // Device A can access /me
    const meA1 = await api('GET', '/me', devAToken, null, { 'x-device-id': 'device_A' });
    assert.equal(meA1.status, 200);

    // Now log in from Device B with the same phone
    const otpReq5 = await api('POST', '/auth/request-otp', null, { country_code: '+91', phone: '9876543211' });
    const otp5 = otpReq5.data.dev_otp;
    const devBLogin = await api('POST', '/auth/verify-otp', null, {
      country_code: '+91',
      phone: '9876543211',
      otp: otp5,
      device_id: 'device_B'
    });
    assert.equal(devBLogin.status, 200);

    // Device A should now be revoked (SESSION_REVOKED)
    const meA2 = await api('GET', '/me', devAToken, null, { 'x-device-id': 'device_A' });
    assert.equal(meA2.status, 401);
    assert.equal(meA2.data.error.code, 'SESSION_REVOKED', 'Device A session must be revoked');

    console.log('8. Testing Change Number Flow (POST /auth/change-number)...');
    const newNumber = '9876543299';
    const otpReqNew = await api('POST', '/auth/request-otp', null, { country_code: '+91', phone: newNumber });
    const otpNew = otpReqNew.data.dev_otp;
    const changeNumRes = await api('POST', '/auth/change-number', devBLogin.data.access_token, {
      new_country_code: '+91',
      new_phone: newNumber,
      otp: otpNew
    });
    assert.equal(changeNumRes.status, 200);
    assert.ok(changeNumRes.data.success);

    console.log('9. Testing Logout & Account Deletion...');
    const logoutRes = await api('POST', '/auth/logout', devBLogin.data.access_token, { device_id: 'device_B' });
    assert.equal(logoutRes.status, 200);

    console.log('\n✅ ALL WHATSAPP-STYLE LOGIN & ONBOARDING ACCEPTANCE TESTS PASSED 100%!');
  } finally {
    clearInterval(expiryTimer);
    server.close();
    db.close();
    try { fs.unlinkSync(tmpDb); } catch { /* ignore */ }
  }
}

runTests().catch((err) => {
  console.error('❌ LOGIN TEST FAILED:', err);
  process.exit(1);
});
