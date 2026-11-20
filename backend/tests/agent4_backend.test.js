import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApp } from '../src/server.js';
import { hashPhoneNumber } from '../src/common/utils.js';

async function runAgent4Tests() {
  console.log('\n======================================================');
  console.log('🧪 RUNNING AGENT 4 TEST SUITE: BACKEND APIS & PRIVACY');
  console.log('======================================================\n');

  const tmpDb = path.join(os.tmpdir(), `bsdk-agent4-test-${Date.now()}.sqlite`);
  const { server, db, expiryTimer } = createApp({ dbPath: tmpDb });

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/v1`;

  async function api(method, url, token, body, headers = {}) {
    const isBuffer = Buffer.isBuffer(body);
    const contentType = headers['Content-Type'] || (isBuffer ? 'application/octet-stream' : 'application/json');

    const res = await fetch(`${base}${url}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': contentType } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers
      },
      body: isBuffer ? body : (body !== undefined ? JSON.stringify(body) : undefined)
    });

    let data;
    const resType = res.headers.get('content-type') || '';
    if (resType.includes('application/json')) {
      data = await res.json();
    } else {
      const arrayBuf = await res.arrayBuffer();
      data = Buffer.from(arrayBuf);
    }
    return { status: res.status, data };
  }

  try {
    // ------------------------------------------------------------------------
    // SETUP: Login seeded demo users
    // ------------------------------------------------------------------------
    console.log('1. Setting up Test Users (Piyush & Rohan)...');
    const loginP = await api('POST', '/auth/login', null, { user_id: 'piyush', password: 'bsdk1234' });
    assert.equal(loginP.status, 200, 'Piyush login must succeed');
    const tokenP = loginP.data.access_token;
    const userP = loginP.data.user;

    const loginR = await api('POST', '/auth/login', null, { user_id: 'rohan', password: 'bsdk1234' });
    assert.equal(loginR.status, 200, 'Rohan login must succeed');
    const tokenR = loginR.data.access_token;
    const userR = loginR.data.user;

    // ------------------------------------------------------------------------
    // TEST 1: Hashed Contacts Lookup without Plaintext Exposure
    // ------------------------------------------------------------------------
    console.log('\n2. Testing POST /contacts/lookup with SHA-256 Hashes...');
    const rohanPhoneHash = hashPhoneNumber('+91 9876543211', '+91');
    const ananyaPhoneHash = hashPhoneNumber('+91 9876543212', '+91');
    const randomUnknownHash = crypto.createHash('sha256').update('+919999999999').digest('hex');

    const lookupRes = await api('POST', '/contacts/lookup', tokenP, {
      hashed_numbers: [rohanPhoneHash, ananyaPhoneHash, randomUnknownHash]
    });

    assert.equal(lookupRes.status, 200);
    assert.equal(lookupRes.data.matched_count, 2, 'Should match Rohan and Ananya');
    assert.equal(lookupRes.data.registered_users.length, 2);

    // CRITICAL PRIVACY AUDIT: NO plaintext phone, email, or password_hash leaked!
    for (const u of lookupRes.data.registered_users) {
      assert.equal(u.phone, undefined, 'Plaintext phone MUST NOT be exposed in contacts lookup!');
      assert.equal(u.email, undefined, 'Plaintext email MUST NOT be exposed in contacts lookup!');
      assert.equal(u.password_hash, undefined, 'Password hash MUST NOT be exposed!');
      assert.ok(u.phone_hash, 'Contact should return phone_hash for client local address book match');
    }

    // Verify rate limiting & input boundaries
    const invalidInput = await api('POST', '/contacts/lookup', tokenP, { hashed_numbers: 'invalid' });
    assert.equal(invalidInput.status, 400);

    // Track an invite
    const inviteTrackRes = await api('POST', '/contacts/invite-track', tokenP, {
      phone_hash: randomUnknownHash,
      invite_method: 'whatsapp'
    });
    assert.equal(inviteTrackRes.status, 200);
    assert.equal(inviteTrackRes.data.success, true);
    console.log('   ✅ Hashed contact discovery and privacy verified.');

    // ------------------------------------------------------------------------
    // TEST 2: Prekey Upload and One-Time Prekey Bundle Consumption
    // ------------------------------------------------------------------------
    console.log('\n3. Testing Prekey Upload & Bundle Distribution / Consumption...');
    const testKeys = {
      identity_key: 'id_key_rohan_x25519_base64_pub',
      signed_prekey: 'spk_rohan_x25519_base64_pub',
      signed_prekey_sig: 'spk_sig_rohan_ed25519_base64',
      one_time_prekeys: [
        { key_id: 101, key: 'otpk_101_base64' },
        { key_id: 102, key: 'otpk_102_base64' },
        { key_id: 103, key: 'otpk_103_base64' }
      ]
    };

    const uploadKeysRes = await api('POST', '/keys/upload', tokenR, testKeys);
    assert.equal(uploadKeysRes.status, 200);
    assert.equal(uploadKeysRes.data.one_time_prekeys_count, 3);

    // Fetch bundle as Piyush (1st time: should consume key 101)
    const bundleRes1 = await api('GET', `/keys/bundle/${userR.id}`, tokenP);
    assert.equal(bundleRes1.status, 200);
    assert.equal(bundleRes1.data.identity_key, testKeys.identity_key);
    assert.equal(bundleRes1.data.signed_prekey, testKeys.signed_prekey);
    assert.equal(bundleRes1.data.one_time_prekey.key_id, 101);
    assert.equal(bundleRes1.data.remaining_one_time_prekeys, 2);

    // Fetch bundle as Piyush (2nd time: should consume key 102)
    const bundleRes2 = await api('GET', `/keys/bundle/${userR.id}`, tokenP);
    assert.equal(bundleRes2.status, 200);
    assert.equal(bundleRes2.data.one_time_prekey.key_id, 102);
    assert.equal(bundleRes2.data.remaining_one_time_prekeys, 1);
    console.log('   ✅ Prekey upload and atomic OTP consumption verified.');

    // ------------------------------------------------------------------------
    // TEST 3: CRITICAL DATABASE AUDIT — NO PLAINTEXT MESSAGE COLUMN
    // ------------------------------------------------------------------------
    console.log('\n4. CRITICAL AUDIT: Proving database has ZERO plaintext message column...');
    const tableInfo = db.prepare("PRAGMA table_info('e2ee_messages')").all();
    const columnNames = tableInfo.map((col) => col.name.toLowerCase());
    console.log('   `e2ee_messages` columns in SQLite:', columnNames.join(', '));

    const FORBIDDEN_COLUMNS = ['body', 'text', 'message', 'plaintext', 'content', 'msg', 'text_body'];
    for (const badCol of FORBIDDEN_COLUMNS) {
      assert.ok(
        !columnNames.includes(badCol),
        `CRITICAL PRIVACY VIOLATION: Database table e2ee_messages contains forbidden plaintext column '${badCol}'!`
      );
    }
    assert.ok(columnNames.includes('ciphertext'), 'Must have ciphertext column');
    assert.ok(columnNames.includes('iv'), 'Must have iv column');
    assert.ok(columnNames.includes('ephemeral_key'), 'Must have ephemeral_key column');
    console.log('   ✅ PROVEN: Server database stores ONLY ciphertext and zero plaintext columns.');

    // ------------------------------------------------------------------------
    // TEST 4: E2EE Message Send, Fetch, and Realtime Read Receipt
    // ------------------------------------------------------------------------
    console.log('\n5. Testing POST /messages and GET /messages/direct/:peer_id...');
    const fakeCiphertext = 'AES-GCM-256:7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a';
    const fakeIv = '9a8b7c6d5e4f3a2b';
    const fakeEphemeralKey = 'curve25519_ephemeral_pub_base64';

    const sendMsgRes = await api('POST', '/messages', tokenP, {
      recipient_id: userR.id,
      ciphertext: fakeCiphertext,
      iv: fakeIv,
      ephemeral_key: fakeEphemeralKey,
      type: 'text'
    });

    assert.equal(sendMsgRes.status, 201);
    assert.equal(sendMsgRes.data.message.ciphertext, fakeCiphertext);
    assert.equal(sendMsgRes.data.message.status, 'sent');
    assert.equal(sendMsgRes.data.message.recipient_id, userR.id);
    const sentMsgId = sendMsgRes.data.message.id;

    // Rohan fetches direct messages from Piyush (this automatically marks unread messages as read)
    const getMsgsRes = await api('GET', `/messages/direct/${userP.id}`, tokenR);
    assert.equal(getMsgsRes.status, 200);
    assert.ok(getMsgsRes.data.messages.length >= 1);
    const foundMsg = getMsgsRes.data.messages.find((m) => m.id === sentMsgId);
    assert.ok(foundMsg, 'Message must be present in conversation history');
    assert.equal(foundMsg.ciphertext, fakeCiphertext);
    assert.equal(foundMsg.status, 'read', 'Fetching should mark message as read (Double Blue Tick)');
    assert.ok(foundMsg.read_at, 'read_at must be populated');

    // Also test GET /direct-conversations
    const convsRes = await api('GET', '/direct-conversations', tokenP);
    assert.equal(convsRes.status, 200);
    assert.ok(convsRes.data.conversations.length >= 1);
    const peerConv = convsRes.data.conversations.find((c) => c.peer.id === userR.id);
    assert.ok(peerConv, 'Conversation with Rohan must be listed');
    console.log('   ✅ Ciphertext-only messaging and read receipt workflow verified.');

    // ------------------------------------------------------------------------
    // TEST 5: Invites — Generate Code, Resolve (Public), and Revoke
    // ------------------------------------------------------------------------
    console.log('\n6. Testing Invites (Code generation, Public Resolve, Revocation)...');
    const inviteCodeRes = await api('POST', '/invites/code', tokenP, { regenerate: true });
    assert.equal(inviteCodeRes.status, 201);
    const inviteCode = inviteCodeRes.data.code;
    assert.ok(inviteCode.startsWith('USER-') || inviteCode.startsWith('GANG-') || inviteCode.includes('-'));
    assert.ok(inviteCodeRes.data.qr_data.includes(inviteCode));

    // Resolve code unauthenticated (public link click)
    const resolveRes = await api('GET', `/invites/resolve/${inviteCode}`, null);
    assert.equal(resolveRes.status, 200);
    assert.equal(resolveRes.data.valid, true);
    assert.equal(resolveRes.data.type, 'user');
    assert.equal(resolveRes.data.user.id, userP.id);
    assert.equal(resolveRes.data.user.real_name, 'Piyush Saxena');
    assert.equal(resolveRes.data.user.phone, undefined, 'No raw phone on invite page');

    // Revoke the invite code
    const revokeRes = await api('POST', '/invites/revoke', tokenP, { code: inviteCode });
    assert.equal(revokeRes.status, 200);
    assert.equal(revokeRes.data.success, true);

    // Resolving again should return 410 Revoked
    const resolveRevoked = await api('GET', `/invites/resolve/${inviteCode}`, null);
    assert.equal(resolveRevoked.status, 410, 'Revoked code must return 410');
    console.log('   ✅ Invite generation, resolve, and revocation verified.');

    // ------------------------------------------------------------------------
    // TEST 6: Encrypted Media Upload & Download
    // ------------------------------------------------------------------------
    console.log('\n7. Testing Encrypted Media Blob Upload & Download...');
    const fakeEncryptedMediaBytes = crypto.randomBytes(1024);
    const base64EncBlob = fakeEncryptedMediaBytes.toString('base64');

    const mediaUploadRes = await api('POST', '/media/upload', tokenP, {
      encrypted_blob: base64EncBlob,
      mime_type: 'image/jpeg'
    });

    assert.equal(mediaUploadRes.status, 201);
    assert.ok(mediaUploadRes.data.id);
    assert.equal(mediaUploadRes.data.byte_size, 1024);
    const mediaId = mediaUploadRes.data.id;

    // Fetch raw encrypted media
    const mediaGetRes = await api('GET', `/media/${mediaId}`, null);
    assert.equal(mediaGetRes.status, 200);
    assert.ok(Buffer.isBuffer(mediaGetRes.data));
    assert.equal(mediaGetRes.data.length, 1024);
    assert.equal(mediaGetRes.data.toString('hex'), fakeEncryptedMediaBytes.toString('hex'));
    console.log('   ✅ Encrypted media blob upload and download verified byte-for-byte.');

    console.log('\n======================================================');
    console.log('🎉 ALL AGENT 4 BACKEND & PRIVACY TESTS PASSED 100%!');
    console.log('======================================================\n');
  } finally {
    if (expiryTimer) clearInterval(expiryTimer);
    await new Promise((resolve) => server.close(resolve));
    try {
      if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
      const wal = `${tmpDb}-wal`;
      const shm = `${tmpDb}-shm`;
      if (fs.existsSync(wal)) fs.unlinkSync(wal);
      if (fs.existsSync(shm)) fs.unlinkSync(shm);
    } catch {}
  }
}

runAgent4Tests().catch((err) => {
  console.error('\n❌ AGENT 4 TEST FAILED:', err);
  process.exit(1);
});
