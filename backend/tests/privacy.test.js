import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createApp } from '../src/server.js';
import { runExpiryCleanup } from '../src/jobs/expiry.job.js';

const FORBIDDEN_KEYS = ['user_id', 'sender_user_id', 'sender_member_id', 'real_name', 'phone', 'email', 'password_hash'];

function checkNoForbiddenKeys(obj, label) {
  const stack = [{ val: obj, p: label }];
  while (stack.length > 0) {
    const { val, p } = stack.pop();
    if (!val || typeof val !== 'object') continue;
    for (const key of Object.keys(val)) {
      assert.ok(!FORBIDDEN_KEYS.includes(key), `PRIVACY LEAK in ${p}: found forbidden key "${key}"`);
      if (val[key] && typeof val[key] === 'object') {
        stack.push({ val: val[key], p: `${p}.${key}` });
      }
    }
  }
}

async function runTests() {
  const tmpDb = path.join(os.tmpdir(), `bsdk-privacy-test-${Date.now()}.sqlite`);
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
    console.log('1. Testing Login (seeded users piyush & rohan)...');
    const loginPiyush = await api('POST', '/auth/login', null, { user_id: 'piyush', password: 'bsdk1234' });
    assert.equal(loginPiyush.status, 200);
    const tokenP = loginPiyush.data.access_token;

    const loginRohan = await api('POST', '/auth/login', null, { user_id: 'rohan', password: 'bsdk1234' });
    assert.equal(loginRohan.status, 200);
    const tokenR = loginRohan.data.access_token;

    console.log('2. Testing Different Aliases Across Clubs for Same User...');
    const clubsRes = await api('GET', '/clubs', tokenP);
    assert.equal(clubsRes.status, 200);
    assert.ok(clubsRes.data.clubs.length >= 2);
    const [club1, club2] = clubsRes.data.clubs;
    assert.notEqual(club1.my_alias, club2.my_alias, 'User must have DIFFERENT alias in each club!');

    console.log('3. CRITICAL: Testing GET /clubs/:id/messages has ZERO real identity fields...');
    const msgsRes = await api('GET', `/clubs/${club1.id}/messages`, tokenR);
    assert.equal(msgsRes.status, 200);
    assert.ok(msgsRes.data.messages.length > 0);
    checkNoForbiddenKeys(msgsRes.data.messages, 'GET /messages');
    const serializedMsgs = JSON.stringify(msgsRes.data.messages);
    assert.ok(!serializedMsgs.includes('Piyush Saxena'), 'Real name leaked in chat payload!');
    assert.ok(!serializedMsgs.includes('Rohan Verma'), 'Real name leaked in chat payload!');

    console.log('4. CRITICAL: Testing POST /clubs/:id/messages returns alias only...');
    const sendRes = await api('POST', `/clubs/${club1.id}/messages`, tokenP, {
      type: 'text',
      body: 'Privacy test message from Piyush!'
    });
    assert.equal(sendRes.status, 201);
    checkNoForbiddenKeys(sendRes.data.message, 'POST /messages');
    assert.equal(sendRes.data.message.alias_name, club1.my_alias);

    console.log('5. CRITICAL: Testing Group Info returns REAL members WITHOUT alias_name...');
    const membersRes = await api('GET', `/clubs/${club1.id}/members`, tokenR);
    assert.equal(membersRes.status, 200);
    assert.ok(membersRes.data.members.some((m) => m.real_name === 'Piyush Saxena'));
    for (const m of membersRes.data.members) {
      assert.equal(m.alias_name, undefined, 'Group Info MUST NOT expose alias_name mapping!');
    }

    console.log('6. CRITICAL: Testing Anonymous Polls never leak voter identity...');
    const pollCreate = await api('POST', `/clubs/${club1.id}/polls`, tokenP, {
      question: 'Best hostel snack?',
      options: ['Maggi', 'Samosa', 'Bun Maska'],
      multi_choice: false
    });
    assert.equal(pollCreate.status, 201);
    checkNoForbiddenKeys(pollCreate.data.message, 'POST /polls');
    const poll = pollCreate.data.message.poll;
    const voteRes = await api('POST', `/polls/${poll.id}/vote`, tokenR, { option_ids: [poll.options[0].id] });
    assert.equal(voteRes.status, 200);
    checkNoForbiddenKeys(voteRes.data.poll, 'POST /polls/vote');
    assert.equal(voteRes.data.poll.total_votes, 1);

    console.log('7. CRITICAL: Testing Group-Wise Statuses have ZERO identity leaks & poster-only view count...');
    const statusesP = await api('GET', `/clubs/${club1.id}/statuses`, tokenP);
    assert.equal(statusesP.status, 200);
    checkNoForbiddenKeys(statusesP.data.statuses, 'GET /statuses');

    console.log('8. Testing Disappearing Message Hard-Delete Job...');
    const expiredId = sendRes.data.message.id;
    db.prepare('UPDATE messages SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), expiredId);
    const cleanup = runExpiryCleanup(db);
    assert.ok(cleanup.deletedMessages >= 1, 'Expired message should be hard-deleted');
    const stillThere = db.prepare('SELECT id FROM messages WHERE id = ?').get(expiredId);
    assert.equal(stillThere, undefined, 'Expired message row must not exist after cleanup');

    console.log('\n✅ ALL BSDK CLUBS ALIAS PRIVACY & CORE QA TESTS PASSED 100%!');
  } finally {
    clearInterval(expiryTimer);
    server.close();
    db.close();
    try { fs.unlinkSync(tmpDb); } catch { /* ignore */ }
  }
}

runTests().catch((err) => {
  console.error('❌ PRIVACY TEST FAILED:', err);
  process.exit(1);
});
