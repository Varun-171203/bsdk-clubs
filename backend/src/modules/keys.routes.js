import express from 'express';
import { sendError } from '../common/utils.js';

export function createKeysRouter(db, requireAuth) {
  const router = express.Router();

  // ========================================================================
  // POST /keys/upload
  // Upload or rotate client's Signal/E2EE Public Key Bundle
  // Payload: { identity_key, signed_prekey, signed_prekey_sig, one_time_prekeys }
  // ========================================================================
  router.post('/keys/upload', requireAuth, (req, res) => {
    const {
      identity_key,
      signed_prekey,
      signed_prekey_sig,
      one_time_prekeys = []
    } = req.body || {};

    if (!identity_key || !signed_prekey || !signed_prekey_sig) {
      return sendError(
        res,
        400,
        'INVALID_KEY_BUNDLE',
        'identity_key, signed_prekey, and signed_prekey_sig are required.'
      );
    }

    if (!Array.isArray(one_time_prekeys)) {
      return sendError(res, 400, 'INVALID_PREKEYS', 'one_time_prekeys must be an array.');
    }

    const nowIso = new Date().toISOString();
    const oneTimeJson = JSON.stringify(one_time_prekeys);

    // Upsert prekey bundle for current user
    const upsertStmt = db.prepare(`
      INSERT INTO prekeys (user_id, identity_key, signed_prekey, signed_prekey_sig, one_time_prekeys_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        identity_key = excluded.identity_key,
        signed_prekey = excluded.signed_prekey,
        signed_prekey_sig = excluded.signed_prekey_sig,
        one_time_prekeys_json = excluded.one_time_prekeys_json,
        updated_at = excluded.updated_at
    `);

    upsertStmt.run(
      req.user.id,
      String(identity_key),
      String(signed_prekey),
      String(signed_prekey_sig),
      oneTimeJson,
      nowIso
    );

    return res.status(200).json({
      success: true,
      user_id: req.user.id,
      one_time_prekeys_count: one_time_prekeys.length,
      updated_at: nowIso
    });
  });

  // ========================================================================
  // GET /keys/bundle/:user_id
  // Fetch public key bundle for recipient and atomically consume ONE one-time prekey
  // ========================================================================
  router.get('/keys/bundle/:user_id', requireAuth, (req, res) => {
    const targetUserId = req.params.user_id;

    if (!targetUserId) {
      return sendError(res, 400, 'MISSING_USER_ID', 'User ID is required.');
    }

    const prekeyRow = db.prepare(`
      SELECT user_id, identity_key, signed_prekey, signed_prekey_sig, one_time_prekeys_json, updated_at
      FROM prekeys
      WHERE user_id = ?
    `).get(targetUserId);

    if (!prekeyRow) {
      return sendError(
        res,
        404,
        'KEYS_NOT_FOUND',
        'Recipient has not registered encryption prekeys yet.'
      );
    }

    let otps = [];
    try {
      otps = JSON.parse(prekeyRow.one_time_prekeys_json || '[]');
    } catch {
      otps = [];
    }

    // Atomically pop and consume 1 one-time prekey (OTPK)
    let consumedKey = null;
    if (otps.length > 0) {
      consumedKey = otps.shift();
      const nowIso = new Date().toISOString();
      db.prepare(`
        UPDATE prekeys
        SET one_time_prekeys_json = ?, updated_at = ?
        WHERE user_id = ?
      `).run(JSON.stringify(otps), nowIso, targetUserId);
    }

    return res.json({
      user_id: targetUserId,
      identity_key: prekeyRow.identity_key,
      signed_prekey: prekeyRow.signed_prekey,
      signed_prekey_sig: prekeyRow.signed_prekey_sig,
      one_time_prekey: consumedKey,
      remaining_one_time_prekeys: otps.length,
      updated_at: prekeyRow.updated_at
    });
  });

  // ========================================================================
  // GET /keys/status
  // Check the caller's prekey stock level
  // ========================================================================
  router.get('/keys/status', requireAuth, (req, res) => {
    const row = db.prepare(`
      SELECT identity_key, one_time_prekeys_json, updated_at
      FROM prekeys WHERE user_id = ?
    `).get(req.user.id);

    if (!row) {
      return res.json({
        has_bundle: false,
        remaining_one_time_prekeys: 0
      });
    }

    let otps = [];
    try { otps = JSON.parse(row.one_time_prekeys_json || '[]'); } catch {}

    return res.json({
      has_bundle: true,
      remaining_one_time_prekeys: otps.length,
      updated_at: row.updated_at
    });
  });

  return router;
}
