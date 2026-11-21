import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/server.js';
import { signAccessToken } from '../src/common/auth.js';

test('BSDK Clubs Secure Calling Acceptance Test Suite', async (t) => {
  const testDbDir = path.resolve(process.cwd(), 'data', 'test-calls');
  if (!fs.existsSync(testDbDir)) fs.mkdirSync(testDbDir, { recursive: true });
  const testDbPath = path.join(testDbDir, `calls-${Date.now()}.sqlite`);

  const { app, server, db, expiryTimer } = createApp({ dbPath: testDbPath });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;

  // Create 3 Test Users
  // User 1 (Caller)
  const user1Id = 'u_caller_1';
  db.prepare(`
    INSERT INTO users (id, user_id, phone, phone_e164, real_name, is_registered, created_at)
    VALUES (?, ?, '+919000000001', '+919000000001', 'Alice', 1, datetime('now'))
  `).run(user1Id, user1Id);
  const user1 = { id: user1Id, user_id: user1Id, phone: '+919000000001' };
  const token1 = signAccessToken(user1);

  // User 2 (Callee)
  const user2Id = 'u_callee_2';
  db.prepare(`
    INSERT INTO users (id, user_id, phone, phone_e164, real_name, is_registered, created_at)
    VALUES (?, ?, '+919000000002', '+919000000002', 'Bob', 1, datetime('now'))
  `).run(user2Id, user2Id);
  const user2 = { id: user2Id, user_id: user2Id, phone: '+919000000002' };
  const token2 = signAccessToken(user2);

  // User 3 (Outsider)
  const user3Id = 'u_outsider_3';
  db.prepare(`
    INSERT INTO users (id, user_id, phone, phone_e164, real_name, is_registered, created_at)
    VALUES (?, ?, '+919000000003', '+919000000003', 'Charlie', 1, datetime('now'))
  `).run(user3Id, user3Id);
  const user3 = { id: user3Id, user_id: user3Id, phone: '+919000000003' };
  const token3 = signAccessToken(user3);

  // Create a test Club with Alice and Bob as members
  const testClubId = 'club_calling_test_1';
  db.prepare(`
    INSERT INTO clubs (id, name, created_by, invite_code, created_at)
    VALUES (?, 'Secret Gang', ?, 'GANG999', datetime('now'))
  `).run(testClubId, user1Id);

  db.prepare(`
    INSERT INTO club_members (id, club_id, user_id, role, alias_name, alias_color, joined_at)
    VALUES ('m_alice', ?, ?, 'admin', 'WittyChai_1', '#128C7E', datetime('now'))
  `).run(testClubId, user1Id);

  db.prepare(`
    INSERT INTO club_members (id, club_id, user_id, role, alias_name, alias_color, joined_at)
    VALUES ('m_bob', ?, ?, 'member', 'ChillBoba_2', '#25D366', datetime('now'))
  `).run(testClubId, user2Id);

  t.after(() => {
    clearInterval(expiryTimer);
    server.close();
    try {
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
      if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
      if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);
    } catch {}
  });

  await t.test('1. /calls/token without login returns 401 Unauthorized', async () => {
    const res = await fetch(`${baseUrl}/calls/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callee_id: user2Id, call_type: 'voice' })
    });
    assert.equal(res.status, 401);
  });

  await t.test('2. /calls/token generates valid token with 10-minute expiry', async () => {
    const res = await fetch(`${baseUrl}/calls/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token1}`
      },
      body: JSON.stringify({ callee_id: user2Id, call_type: 'video' })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.token);
    assert.ok(data.room_id);
    assert.equal(data.call_type, 'video');
    assert.equal(data.expires_in, 600); // 10 minutes strictly
  });

  await t.test('3. Callee blocked caller: calling returns 403 BLOCKED', async () => {
    // Bob blocks Alice
    db.prepare(`
      INSERT INTO blocks (id, blocker_user_id, blocked_user_id, created_at)
      VALUES ('block_1', ?, ?, datetime('now'))
    `).run(user2Id, user1Id);

    const res = await fetch(`${baseUrl}/calls/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token1}`
      },
      body: JSON.stringify({ callee_id: user2Id, call_type: 'voice' })
    });
    assert.equal(res.status, 403);
    const err = await res.json();
    assert.equal(err.error?.code, 'BLOCKED');

    // Remove block for subsequent tests
    db.prepare('DELETE FROM blocks WHERE id = ?').run('block_1');
  });

  await t.test('4. Club call: Voice ONLY (video rejected with 400)', async () => {
    const res = await fetch(`${baseUrl}/calls/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token1}`
      },
      body: JSON.stringify({ club_id: testClubId, call_type: 'video' })
    });
    assert.equal(res.status, 400);
    const err = await res.json();
    assert.equal(err.error?.code, 'VOICE_ONLY_FOR_CLUBS');
  });

  await t.test('5. Club call: Non-member cannot join club call (403)', async () => {
    const res = await fetch(`${baseUrl}/calls/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token3}`
      },
      body: JSON.stringify({ club_id: testClubId, call_type: 'voice' })
    });
    assert.equal(res.status, 403);
    const err = await res.json();
    assert.equal(err.error?.code, 'NOT_CLUB_MEMBER');
  });

  await t.test('6. Room isolation: token for Room A cannot join Room B', async () => {
    const tokenRes = await fetch(`${baseUrl}/calls/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token1}`
      },
      body: JSON.stringify({ callee_id: user2Id, call_type: 'voice' })
    });
    const { token, room_id } = await tokenRes.json();

    // Verify against DIFFERENT room
    const verifyRes = await fetch(`${baseUrl}/calls/verify-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, room_id: 'different-room-uuid', user_id: user1Id })
    });
    assert.equal(verifyRes.status, 403);
    const err = await verifyRes.json();
    assert.equal(err.error?.code, 'ROOM_MISMATCH');
  });

  await t.test('7. User isolation: token for User A cannot be used by User B', async () => {
    const tokenRes = await fetch(`${baseUrl}/calls/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token1}`
      },
      body: JSON.stringify({ callee_id: user2Id, call_type: 'voice' })
    });
    const { token, room_id } = await tokenRes.json();

    const verifyRes = await fetch(`${baseUrl}/calls/verify-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, room_id, user_id: user2Id })
    });
    assert.equal(verifyRes.status, 403);
    const err = await verifyRes.json();
    assert.equal(err.error?.code, 'USER_MISMATCH');
  });

  await t.test('8. 11-minute-old token is rejected (TOKEN_EXPIRED)', async () => {
    const apiSecret = process.env.CALL_API_SECRET || 'CALL_SECRET_PLACEHOLDER_DEV';
    // Create token expired 1 minute ago (11 minutes since generation)
    const expiredToken = jwt.sign(
      {
        sub: user1Id,
        room: 'expired-room',
        exp: Math.floor(Date.now() / 1000) - 60
      },
      apiSecret
    );

    const verifyRes = await fetch(`${baseUrl}/calls/verify-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: expiredToken, room_id: 'expired-room', user_id: user1Id })
    });
    assert.equal(verifyRes.status, 401);
    const err = await verifyRes.json();
    assert.equal(err.error?.code, 'TOKEN_EXPIRED');
  });

  await t.test('9. POST /calls/end saves metadata ONLY and creates chat system message', async () => {
    const roomId = 'room_finish_test';
    const endRes = await fetch(`${baseUrl}/calls/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token1}`
      },
      body: JSON.stringify({
        room_id: roomId,
        caller_id: user1Id,
        callee_id: user2Id,
        call_type: 'voice',
        status: 'completed',
        duration_seconds: 134 // 2m 14s
      })
    });
    assert.equal(endRes.status, 200);
    const endData = await endRes.json();
    assert.equal(endData.success, true);
    assert.equal(endData.system_message, 'Voice call ended • 2m 14s');

    // Verify DB call_logs has metadata ONLY (no tokens, no media)
    const log = db.prepare('SELECT * FROM call_logs WHERE room_id = ?').get(roomId);
    assert.ok(log);
    assert.equal(log.caller_id, user1Id);
    assert.equal(log.callee_id, user2Id);
    assert.equal(log.call_type, 'voice');
    assert.equal(log.duration_seconds, 134);
    assert.equal(log.status, 'completed');

    // Verify system message in e2ee_messages
    const sysMsg = db.prepare('SELECT * FROM e2ee_messages WHERE ciphertext LIKE ?').get('%Voice call ended • 2m 14s%');
    assert.ok(sysMsg);
    assert.equal(sysMsg.type, 'call_event');
  });

  await t.test('10. GET /calls/history returns formatted call history with duration label', async () => {
    const histRes = await fetch(`${baseUrl}/calls/history`, {
      headers: { Authorization: `Bearer ${token1}` }
    });
    assert.equal(histRes.status, 200);
    const histData = await histRes.json();
    assert.ok(Array.isArray(histData.calls));
    assert.ok(histData.calls.length >= 1);
    const callItem = histData.calls[0];
    assert.equal(callItem.duration_label, '2m 14s');
    assert.equal(callItem.direction, 'outgoing');
    assert.equal(callItem.peer.name, 'Bob');
  });

  await t.test('11. Rate limiter: 10 calls in 10 minutes max, 11th returns 429 RATE_LIMITED', async () => {
    // User 2 makes rapid requests
    let lastStatus = 200;
    for (let i = 0; i < 11; i++) {
      const res = await fetch(`${baseUrl}/calls/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token2}`
        },
        body: JSON.stringify({ callee_id: user1Id, call_type: 'voice' })
      });
      lastStatus = res.status;
      if (res.status === 429) {
        const err = await res.json();
        assert.equal(err.error?.code, 'RATE_LIMITED');
        break;
      }
    }
    assert.equal(lastStatus, 429);
  });
});
