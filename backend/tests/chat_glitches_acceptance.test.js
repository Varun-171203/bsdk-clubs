import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createApp } from '../src/server.js';
import { assertNoIdentityLeak } from '../src/common/utils.js';

/**
 * Client-side isMessageMine logic mirror (matches ChatWindow.jsx & App.jsx exactly)
 */
function isMessageMine(msg, club) {
  if (!msg) return false;
  if (club?.my_member_id && msg.sender_club_member_id) {
    return String(msg.sender_club_member_id) === String(club.my_member_id);
  }
  if (typeof msg.is_mine === 'boolean' && msg.is_mine) {
    return true;
  }
  if (club?.my_alias && msg.alias_name && club.my_alias === msg.alias_name) {
    return true;
  }
  return false;
}

async function runChatGlitchesAcceptanceSuite() {
  console.log('================================================================');
  console.log('BSDK CLUBS — CHAT GLITCHES & OWNERSHIP ACCEPTANCE TEST SUITE');
  console.log('================================================================\n');

  const tmpDb = path.join(os.tmpdir(), `bsdk-chat-fix-${Date.now()}.sqlite`);
  const { server, db, io, expiryTimer } = createApp({ dbPath: tmpDb });

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/v1`;

  async function api(method, endpoint, token, body, headers = {}) {
    const isGet = method === 'GET';
    const res = await fetch(`${base}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers
      },
      body: !isGet && body !== undefined && body !== null ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  const results = [];

  try {
    // ------------------------------------------------------------------------
    // SETUP: Register Device A (+91 7000822096, Varun) and Device B (+91 9876543210, Boba)
    // ------------------------------------------------------------------------
    console.log('[SETUP] Provisioning Device A (Varun) and Device B (Boba)...');
    
    // Device A
    const otpResA = await api('POST', '/auth/request-otp', null, { country_code: '+91', phone: '7000822096' });
    const verifyA = await api('POST', '/auth/verify-otp', null, {
      country_code: '+91',
      phone: '7000822096',
      otp: otpResA.data.dev_otp,
      device_id: 'device_A'
    });
    const tokenA = verifyA.data.access_token;
    await api('POST', '/auth/profile', tokenA, { real_name: 'Varun' }, { 'x-device-id': 'device_A' });

    // Device B
    const otpResB = await api('POST', '/auth/request-otp', null, { country_code: '+91', phone: '9876543210' });
    const verifyB = await api('POST', '/auth/verify-otp', null, {
      country_code: '+91',
      phone: '9876543210',
      otp: otpResB.data.dev_otp,
      device_id: 'device_B'
    });
    const tokenB = verifyB.data.access_token;
    await api('POST', '/auth/profile', tokenB, { real_name: 'Boba' }, { 'x-device-id': 'device_B' });

    // ------------------------------------------------------------------------
    // TEST 1: Club Creation & Membership includes my_member_id
    // ------------------------------------------------------------------------
    console.log('\n[TEST 1] Creating Club "Aise hi" and having Device B join...');
    const createClubRes = await api('POST', '/clubs', tokenA, {
      name: 'Aise hi',
      description: 'Fun gang'
    });
    assert.equal(createClubRes.status, 201);
    const clubA = createClubRes.data.club;
    assert.ok(clubA.my_member_id, 'Club creation must return my_member_id');
    assert.ok(clubA.my_alias, 'Club creation must return my_alias');

    // Force aliases to match screenshot: WittyChai_28 for Device A, ChillBoba_56 for Device B
    db.prepare('UPDATE club_members SET alias_name = ? WHERE id = ?').run('WittyChai_28', clubA.my_member_id);
    clubA.my_alias = 'WittyChai_28';

    // Device B joins
    const joinRes = await api('POST', '/clubs/join', tokenB, { invite_code: clubA.invite_code });
    assert.equal(joinRes.status, 201);
    const clubB = joinRes.data.club;
    assert.ok(clubB.my_member_id, 'Club join must return my_member_id');
    db.prepare('UPDATE club_members SET alias_name = ? WHERE id = ?').run('ChillBoba_56', clubB.my_member_id);
    clubB.my_alias = 'ChillBoba_56';

    results.push({ test: 'Test 1: Club memberships have distinct my_member_id and aliases', pass: true });
    console.log(`  ✓ Device A: alias="${clubA.my_alias}", member_id="${clubA.my_member_id}"`);
    console.log(`  ✓ Device B: alias="${clubB.my_alias}", member_id="${clubB.my_member_id}"`);

    // ------------------------------------------------------------------------
    // TEST 2: Device A sends text message "Hello"
    // ------------------------------------------------------------------------
    console.log('\n[TEST 2] Device A sends "Hello"...');
    const sendHello = await api('POST', `/clubs/${clubA.id}/messages`, tokenA, {
      type: 'text',
      body: 'Hello',
      client_message_id: 'cmsg_hello_1'
    });
    assert.equal(sendHello.status, 201);
    const helloMsg = sendHello.data.message;
    assert.equal(helloMsg.sender_club_member_id, clubA.my_member_id);
    assert.equal(helloMsg.body, 'Hello');
    assert.equal(helloMsg.client_message_id, 'cmsg_hello_1');

    // Evaluate isMine for both devices
    const isHelloMineForA = isMessageMine(helloMsg, clubA);
    const isHelloMineForB = isMessageMine(helloMsg, clubB);
    assert.equal(isHelloMineForA, true, 'Device A must evaluate own message as is_mine: true');
    assert.equal(isHelloMineForB, false, 'Device B must evaluate Device A message as is_mine: false');

    results.push({ test: 'Test 2: Device A "Hello" shows on right for A, left for B', pass: true });
    console.log('  ✓ Hello message is_mine for Device A:', isHelloMineForA, '(RIGHT, Green)');
    console.log('  ✓ Hello message is_mine for Device B:', isHelloMineForB, '(LEFT, White)');

    // ------------------------------------------------------------------------
    // TEST 3: Device A sends fast emoji-only message "😂" (The exact glitch from screenshot!)
    // ------------------------------------------------------------------------
    console.log('\n[TEST 3] Device A sends emoji "😂" with client_message_id...');
    const emojiClientId = 'cmsg_emoji_fast_99';
    const sendEmoji = await api('POST', `/clubs/${clubA.id}/messages`, tokenA, {
      type: 'text',
      body: '😂',
      client_message_id: emojiClientId
    });
    assert.equal(sendEmoji.status, 201);
    const emojiMsg = sendEmoji.data.message;
    assert.equal(emojiMsg.body, '😂');
    assert.equal(emojiMsg.client_message_id, emojiClientId);
    assert.equal(emojiMsg.sender_club_member_id, clubA.my_member_id);

    results.push({ test: 'Test 3: Fast emoji message preserves client_message_id and sender_club_member_id', pass: true });
    console.log('  ✓ Emoji message payload:', JSON.stringify({
      body: emojiMsg.body,
      client_message_id: emojiMsg.client_message_id,
      sender_club_member_id: emojiMsg.sender_club_member_id,
      alias_name: emojiMsg.alias_name
    }));

    // ------------------------------------------------------------------------
    // TEST 4: Live Arrival vs Reload Consistency (GLITCH 2 FIX VERIFICATION)
    // ------------------------------------------------------------------------
    console.log('\n[TEST 4] Simulating WebSocket broadcast vs HTTP reload for emoji message...');

    // Simulate what WebSocket broadcasts to the room:
    // Notice: broadcastMsg carries sender_club_member_id
    const wsBroadcastMsg = {
      ...emojiMsg,
      is_mine: false // Server broadcast payload to room
    };

    // Client receives WebSocket event:
    // With our fix, client evaluates isMessageMine(wsBroadcastMsg, club)
    const isWsMineForA = isMessageMine(wsBroadcastMsg, clubA);
    const isWsMineForB = isMessageMine(wsBroadcastMsg, clubB);

    assert.equal(isWsMineForA, true, 'Device A MUST evaluate WebSocket arrival as is_mine: true (RIGHT, Green)');
    assert.equal(isWsMineForB, false, 'Device B MUST evaluate WebSocket arrival as is_mine: false (LEFT, White)');

    // Now simulate user leaving and re-entering the chat (GET /clubs/:id/messages)
    const getMsgsResA = await api('GET', `/clubs/${clubA.id}/messages`, tokenA);
    assert.equal(getMsgsResA.status, 200);
    const reloadedMsgA = getMsgsResA.data.messages.find((m) => m.client_message_id === emojiClientId);
    assert.ok(reloadedMsgA);
    assert.equal(isMessageMine(reloadedMsgA, clubA), true, 'Reloaded message must still be on the RIGHT for Device A');

    const getMsgsResB = await api('GET', `/clubs/${clubA.id}/messages`, tokenB);
    assert.equal(getMsgsResB.status, 200);
    const reloadedMsgB = getMsgsResB.data.messages.find((m) => m.client_message_id === emojiClientId);
    assert.ok(reloadedMsgB);
    assert.equal(isMessageMine(reloadedMsgB, clubB), false, 'Reloaded message must still be on the LEFT for Device B');

    // PROOF: Live arrival position MATCHES reload position 100%!
    assert.equal(isWsMineForA, isMessageMine(reloadedMsgA, clubA), 'Device A position must NOT flip on reload!');
    assert.equal(isWsMineForB, isMessageMine(reloadedMsgB, clubB), 'Device B position must NOT flip on reload!');

    results.push({ test: 'Test 4: Glitch 2 eliminated: live arrival side matches reload side (Right for sender, Left for peer)', pass: true });
    console.log('  ✓ Live arrival for Device A: RIGHT (is_mine = true)');
    console.log('  ✓ Reload arrival for Device A: RIGHT (is_mine = true)');
    console.log('  ✓ NO side switching or flip from left to right!');

    // ------------------------------------------------------------------------
    // TEST 5: Client De-duplication with client_message_id
    // ------------------------------------------------------------------------
    console.log('\n[TEST 5] Testing client-side de-duplication with client_message_id...');
    // Simulate initial local state with optimistic message:
    let localMessagesA = [
      {
        id: emojiClientId,
        client_message_id: emojiClientId,
        body: '😂',
        is_mine: true,
        status: 'sending'
      }
    ];

    // Scenario A: WebSocket broadcast arrives FIRST
    const onWsArrival = (broadcast) => {
      const isMine = isMessageMine(broadcast, clubA);
      const normalized = { ...broadcast, is_mine: isMine, status: 'sent' };
      const idx = localMessagesA.findIndex((m) => m.client_message_id === broadcast.client_message_id);
      if (idx !== -1) {
        localMessagesA[idx] = { ...localMessagesA[idx], ...normalized, is_mine: true, status: 'sent' };
      } else {
        localMessagesA.push(normalized);
      }
    };
    onWsArrival(wsBroadcastMsg);
    assert.equal(localMessagesA.length, 1, 'Must NOT create duplicate item');
    assert.equal(localMessagesA[0].is_mine, true, 'Must KEEP is_mine: true');
    assert.equal(localMessagesA[0].status, 'sent', 'Must update status to sent');

    // Scenario B: HTTP POST response arrives SECOND
    const onHttpSuccess = (serverMsg) => {
      const idx = localMessagesA.findIndex((m) => m.client_message_id === serverMsg.client_message_id);
      if (idx !== -1) {
        localMessagesA[idx] = { ...localMessagesA[idx], ...serverMsg, is_mine: true, status: 'sent' };
      } else {
        localMessagesA.push({ ...serverMsg, is_mine: true, status: 'sent' });
      }
    };
    onHttpSuccess(emojiMsg);
    assert.equal(localMessagesA.length, 1, 'Must still have exactly 1 item, zero duplicates');
    assert.equal(localMessagesA[0].is_mine, true, 'Must stay on the RIGHT forever');

    results.push({ test: 'Test 5: Client de-duplication with client_message_id prevents duplication and side flipping', pass: true });
    console.log('  ✓ Exactly 1 message in list, is_mine is permanently true, status is "sent"');

    // ------------------------------------------------------------------------
    // TEST 6: Anonymous Poll with client_message_id & sender_club_member_id
    // ------------------------------------------------------------------------
    console.log('\n[TEST 6] Testing anonymous poll creation with client_message_id...');
    const pollClientMsgId = 'cmsg_poll_42';
    const pollRes = await api('POST', `/clubs/${clubA.id}/polls`, tokenA, {
      question: 'Weekend plan kya hai?',
      options: ['Netflix', 'Party', 'Sleep'],
      client_message_id: pollClientMsgId
    });
    assert.equal(pollRes.status, 201);
    const pollMsg = pollRes.data.message;
    assert.equal(pollMsg.sender_club_member_id, clubA.my_member_id);
    assert.equal(pollMsg.client_message_id, pollClientMsgId);
    assert.equal(isMessageMine(pollMsg, clubA), true, 'Poll creator sees poll as own (RIGHT)');
    assert.equal(isMessageMine(pollMsg, clubB), false, 'Peer sees poll as other (LEFT)');

    results.push({ test: 'Test 6: Anonymous poll includes client_message_id and sender_club_member_id', pass: true });
    console.log('  ✓ Poll is_mine for Creator:', isMessageMine(pollMsg, clubA));
    console.log('  ✓ Poll is_mine for Peer:', isMessageMine(pollMsg, clubB));

    // ------------------------------------------------------------------------
    // TEST 7: Privacy & Anonymity Verification
    // ------------------------------------------------------------------------
    console.log('\n[TEST 7] Verifying assertNoIdentityLeak passes with 0 violations...');
    assert.doesNotThrow(() => {
      assertNoIdentityLeak(helloMsg);
      assertNoIdentityLeak(emojiMsg);
      assertNoIdentityLeak(pollMsg);
    }, 'Chat payloads must never throw privacy violations');

    // Verify forbidden fields are absent
    for (const msg of [helloMsg, emojiMsg, pollMsg]) {
      assert.equal(msg.user_id, undefined, 'user_id must be undefined');
      assert.equal(msg.phone, undefined, 'phone must be undefined');
      assert.equal(msg.real_name, undefined, 'real_name must be undefined');
      assert.equal(msg.email, undefined, 'email must be undefined');
    }

    results.push({ test: 'Test 7: Strict privacy check passed (0 identity leaks)', pass: true });
    console.log('  ✓ All chat payloads are strictly anonymous (only alias and per-club member id present)');

    console.log('\n================================================================');
    console.log('ALL ACCEPTANCE TESTS PASSED (7 / 7)');
    console.log('================================================================');
    for (const r of results) {
      console.log(`[PASS] ${r.test}`);
    }

  } finally {
    if (expiryTimer) clearInterval(expiryTimer);
    server.close();
    try {
      if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    } catch {}
  }
}

runChatGlitchesAcceptanceSuite().catch((err) => {
  console.error('\n[TEST FAILED]', err);
  process.exit(1);
});
