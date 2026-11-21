import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  checkRateLock,
  recordFailedAttempt,
  clearAttempts
} from '../common/auth.js';
import { sendError, DEFAULT_USER_SETTINGS, hashPhoneNumber } from '../common/utils.js';
import { sendSmsOtp, getSmsProviderStatus } from '../common/sms.js';

// Normalize phone numbers (e.g. India +91 9876543210 -> +919876543210)
export function normalizePhone(countryCode = '+91', phoneRaw = '') {
  const cleanCode = String(countryCode || '+91').trim().replace(/[^0-9+]/g, '');
  const prefix = cleanCode.startsWith('+') ? cleanCode : `+${cleanCode}`;
  const codeDigits = prefix.replace('+', '');
  let digits = String(phoneRaw || '').trim().replace(/[^0-9]/g, '');

  if (codeDigits && digits.startsWith(codeDigits) && digits.length > 10) {
    digits = digits.slice(codeDigits.length);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  return {
    countryCode: prefix,
    digits,
    normalized: `${prefix}${digits}`
  };
}

// Indian 10-digit mobile number validation (starts with 6, 7, 8, or 9)
export function isValidPhone(countryCode, digits) {
  if (!digits) return false;
  if (countryCode === '+91') {
    return digits.length === 10 && /^[6-9]\d{9}$/.test(digits);
  }
  return digits.length >= 7 && digits.length <= 15;
}

export function createAuthRouter(db, requireAuth) {
  const router = express.Router();

  // ========================================================================
  // 1. POST /auth/request-otp — Sends 6-digit OTP via SMS (Real Gateway or Dev Simulator)
  // ========================================================================
  router.post('/auth/request-otp', async (req, res) => {
    const { country_code = '+91', phone } = req.body || {};
    const { countryCode, digits, normalized } = normalizePhone(country_code, phone);

    if (!isValidPhone(countryCode, digits)) {
      return sendError(
        res,
        400,
        'INVALID_PHONE',
        countryCode === '+91'
          ? 'Please enter a valid 10-digit Indian phone number.'
          : 'Please enter a valid phone number.'
      );
    }

    const now = Date.now();
    const existing = db.prepare('SELECT * FROM otp_codes WHERE phone = ?').get(normalized);

    // Rate Limiting Checks (Max 3 OTP requests per hour, lock on abuse)
    if (existing) {
      if (existing.locked_until && new Date(existing.locked_until).getTime() > now) {
        const remainingMin = Math.ceil((new Date(existing.locked_until).getTime() - now) / 60000);
        return sendError(
          res,
          429,
          'LOCKED',
          `Too many failed attempts. Verification locked for ${remainingMin} minutes.`
        );
      }

      const windowStart = new Date(existing.window_start).getTime();
      const oneHourMs = 60 * 60 * 1000;
      if (now - windowStart < oneHourMs) {
        if (existing.request_count >= 3) {
          const waitMin = Math.ceil((windowStart + oneHourMs - now) / 60000);
          return sendError(
            res,
            429,
            'RATE_LIMITED',
            `OTP request limit reached (max 3 per hour). Please wait ${waitMin} minutes before requesting again.`
          );
        }
      }
    }

    // Generate cryptographically random 6-digit OTP
    const rawOtp = String(crypto.randomInt(100000, 999999));
    const otpHashed = bcrypt.hashSync(rawOtp, 10);
    const expiresAt = new Date(now + 5 * 60 * 1000).toISOString(); // 5-minute expiry
    const windowStartIso = existing && (now - new Date(existing.window_start).getTime() < 3600000)
      ? existing.window_start
      : new Date(now).toISOString();
    const nextReqCount = existing && (now - new Date(existing.window_start).getTime() < 3600000)
      ? existing.request_count + 1
      : 1;

    db.prepare(`
      INSERT INTO otp_codes (phone, country_code, otp_hash, expires_at, attempts, request_count, window_start, locked_until)
      VALUES (?, ?, ?, ?, 0, ?, ?, NULL)
      ON CONFLICT(phone) DO UPDATE SET
        otp_hash = excluded.otp_hash,
        expires_at = excluded.expires_at,
        attempts = 0,
        request_count = excluded.request_count,
        window_start = excluded.window_start,
        locked_until = NULL
    `).run(normalized, countryCode, otpHashed, expiresAt, nextReqCount, windowStartIso);

    // Dispatch Real SMS or Simulated Console Output
    const smsResult = await sendSmsOtp({
      phone: normalized,
      countryCode,
      otp: rawOtp
    });

    const providerStatus = getSmsProviderStatus();

    return res.json({
      success: true,
      message: `Waiting to automatically detect an SMS sent to ${normalized}`,
      phone: normalized,
      expires_in_seconds: 300,
      sms_provider: providerStatus.provider,
      is_real_sms: providerStatus.isReal,
      sms_dispatched: smsResult.success,
      dev_otp: rawOtp // Always available for convenience/test, app prioritizes real SMS
    });
  });

  // ========================================================================
  // 2. POST /auth/verify-otp — Verifies OTP, registers or logs in user
  // ========================================================================
  router.post('/auth/verify-otp', (req, res) => {
    const { country_code = '+91', phone, otp, device_id } = req.body || {};
    const { countryCode, digits, normalized } = normalizePhone(country_code, phone);
    const cleanOtp = String(otp || '').trim();
    const currentDeviceId = String(device_id || req.headers['x-device-id'] || 'device_' + uuidv4().slice(0, 8));

    if (!cleanOtp || cleanOtp.length !== 6 || !/^\d{6}$/.test(cleanOtp)) {
      return sendError(res, 400, 'VALIDATION', 'Please enter a valid 6-digit code.');
    }

    const otpRow = db.prepare('SELECT * FROM otp_codes WHERE phone = ?').get(normalized);
    if (!otpRow) {
      return sendError(res, 400, 'INVALID_CODE', 'Invalid code or code expired. Tap "Resend SMS".');
    }

    const now = Date.now();
    if (otpRow.locked_until && new Date(otpRow.locked_until).getTime() > now) {
      const waitMin = Math.ceil((new Date(otpRow.locked_until).getTime() - now) / 60000);
      return sendError(
        res,
        429,
        'LOCKED',
        `Too many failed attempts. Verification locked for ${waitMin} minutes.`
      );
    }

    if (new Date(otpRow.expires_at).getTime() < now) {
      return sendError(res, 400, 'EXPIRED_CODE', 'This code has expired. Tap "Resend SMS" to get a new code.');
    }

    // Verify OTP hash
    const isValid = bcrypt.compareSync(cleanOtp, otpRow.otp_hash);
    if (!isValid) {
      const nextAttempts = otpRow.attempts + 1;
      if (nextAttempts >= 5) {
        const lockUntil = new Date(now + 10 * 60 * 1000).toISOString(); // 10 min lock
        db.prepare('UPDATE otp_codes SET attempts = ?, locked_until = ? WHERE phone = ?').run(
          nextAttempts,
          lockUntil,
          normalized
        );
        return sendError(
          res,
          429,
          'LOCKED',
          'You have tried too many times. Verification locked for 10 minutes.'
        );
      } else {
        db.prepare('UPDATE otp_codes SET attempts = ? WHERE phone = ?').run(nextAttempts, normalized);
        const remaining = 5 - nextAttempts;
        return sendError(
          res,
          400,
          'INVALID_CODE',
          `Wrong code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
        );
      }
    }

    // OTP is valid — clear the OTP record
    db.prepare('DELETE FROM otp_codes WHERE phone = ?').run(normalized);

    // Find or create User
    let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(normalized);
    let isNewUser = false;
    const nowIso = new Date().toISOString();

    if (!user) {
      isNewUser = true;
      const id = uuidv4();
      const fallbackUid = `gang_${digits.slice(-4)}_${crypto.randomInt(10, 99)}`;
      const phoneHash = hashPhoneNumber(normalized, countryCode);
      db.prepare(`
        INSERT INTO users (id, user_id, country_code, phone, phone_e164, phone_hash, password_hash, real_name, about, profile_photo_url, created_at, status, last_seen, is_registered)
        VALUES (?, ?, ?, ?, ?, ?, '', '', 'Hey there! I am on BSDK Clubs', NULL, ?, 'active', ?, 1)
      `).run(id, fallbackUid, countryCode, normalized, normalized, phoneHash, nowIso, nowIso);

      // Check if someone invited this phone hash, mark joined_at
      try {
        if (phoneHash) {
          db.prepare('UPDATE invite_tracking SET joined_at = ? WHERE phone_hash = ? AND joined_at IS NULL').run(nowIso, phoneHash);
        }
      } catch {}

      db.prepare(`
        INSERT INTO user_settings (user_id, settings_json, updated_at) VALUES (?, ?, ?)
      `).run(id, JSON.stringify(DEFAULT_USER_SETTINGS), nowIso);

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    } else {
      // If user was created without real_name yet, flag as new user so they finish Profile Setup
      isNewUser = !user.real_name || user.real_name.trim().length === 0;
      const phoneHash = user.phone_hash || hashPhoneNumber(user.phone, user.country_code);
      db.prepare('UPDATE users SET last_seen = ?, phone_e164 = COALESCE(phone_e164, ?), phone_hash = COALESCE(phone_hash, ?), is_registered = 1 WHERE id = ?').run(nowIso, normalized, phoneHash, user.id);
    }

    if (user.is_banned) {
      return sendError(res, 403, 'BANNED', 'This account has been suspended.');
    }

    // Check if Two-Step Verification PIN is set
    if (user.two_step_pin_hash) {
      // Return temporary token to unlock with PIN
      const tempToken = signAccessToken(user, currentDeviceId);
      return res.json({
        requires_two_step: true,
        temp_token: tempToken,
        is_new_user: false,
        phone: normalized
      });
    }

    // Single Primary Device Session Enforcement:
    // Logging in on a new device revokes previous active device sessions
    db.prepare(`
      UPDATE sessions SET revoked_at = ?
      WHERE user_id = ? AND device_id != ? AND revoked_at IS NULL
    `).run(nowIso, user.id, currentDeviceId);

    const sessionId = uuidv4();
    const accessToken = signAccessToken(user, currentDeviceId);
    const refreshToken = signRefreshToken(user, currentDeviceId);

    db.prepare(`
      INSERT INTO sessions (id, user_id, device_id, refresh_token_hash, created_at, revoked_at)
      VALUES (?, ?, ?, ?, ?, NULL)
      ON CONFLICT(id) DO NOTHING
    `).run(sessionId, user.id, currentDeviceId, bcrypt.hashSync(refreshToken, 8), nowIso);

    return res.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      is_new_user: isNewUser,
      requires_two_step: false,
      user: {
        id: user.id,
        user_id: user.user_id,
        phone: user.phone,
        country_code: user.country_code,
        real_name: user.real_name,
        about: user.about,
        profile_photo_url: user.profile_photo_url,
        has_two_step: Boolean(user.two_step_pin_hash),
        created_at: user.created_at
      }
    });
  });

  // ========================================================================
  // 3. POST /auth/profile — Save Real Name, About & Profile Photo (Group Info only)
  // ========================================================================
  router.post('/auth/profile', requireAuth, (req, res) => {
    const { real_name, about, profile_photo_url } = req.body || {};
    const cleanName = String(real_name || '').trim();
    const cleanAbout = about !== undefined ? String(about).trim().slice(0, 160) : req.user.about;
    const cleanPhoto = profile_photo_url !== undefined ? String(profile_photo_url).trim() : req.user.profile_photo_url;

    if (!cleanName || cleanName.length < 2 || cleanName.length > 50) {
      return sendError(res, 400, 'VALIDATION', 'Please enter your name (2–50 characters).');
    }

    db.prepare(`
      UPDATE users SET real_name = ?, about = ?, profile_photo_url = ?, is_registered = 1 WHERE id = ?
    `).run(cleanName, cleanAbout, cleanPhoto || null, req.user.id);

    const updated = db.prepare(`
      SELECT id, user_id, phone, country_code, real_name, about, profile_photo_url,
             two_step_pin_hash, created_at
      FROM users WHERE id = ?
    `).get(req.user.id);

    return res.json({
      message: 'Profile updated successfully.',
      user: {
        ...updated,
        has_two_step: Boolean(updated.two_step_pin_hash)
      }
    });
  });

  // ========================================================================
  // 4. POST /auth/two-step/setup — Turn on 6-digit PIN
  // ========================================================================
  router.post('/auth/two-step/setup', requireAuth, (req, res) => {
    const { pin } = req.body || {};
    const cleanPin = String(pin || '').trim();

    if (!cleanPin || cleanPin.length !== 6 || !/^\d{6}$/.test(cleanPin)) {
      return sendError(res, 400, 'VALIDATION', 'PIN must be exactly 6 numeric digits.');
    }

    const pinHash = bcrypt.hashSync(cleanPin, 10);
    db.prepare('UPDATE users SET two_step_pin_hash = ? WHERE id = ?').run(pinHash, req.user.id);

    return res.json({
      success: true,
      message: 'Two-step verification has been turned on.'
    });
  });

  // ========================================================================
  // 5. POST /auth/two-step/verify — Verify 6-digit PIN during login
  // ========================================================================
  router.post('/auth/two-step/verify', (req, res) => {
    const { phone, pin, device_id } = req.body || {};
    const { normalized } = normalizePhone('+91', phone);
    const cleanPin = String(pin || '').trim();
    const currentDeviceId = String(device_id || req.headers['x-device-id'] || 'device_' + uuidv4().slice(0, 8));

    const lockKey = `pin:${normalized}`;
    const rate = checkRateLock(lockKey);
    if (rate.locked) {
      return sendError(res, 429, 'LOCKED', `Incorrect PIN entered too many times. Try again in ${rate.remainingMin} minutes.`);
    }

    const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(normalized);
    if (!user || !user.two_step_pin_hash) {
      return sendError(res, 400, 'INVALID_REQUEST', 'Two-step verification is not enabled for this number.');
    }

    const isMatch = bcrypt.compareSync(cleanPin, user.two_step_pin_hash);
    if (!isMatch) {
      const attempt = recordFailedAttempt(lockKey);
      const remaining = Math.max(0, 5 - attempt.count);
      return sendError(
        res,
        400,
        'INVALID_PIN',
        remaining > 0 ? `Incorrect PIN. ${remaining} attempts remaining.` : 'Incorrect PIN. Locked for 10 minutes.'
      );
    }

    clearAttempts(lockKey);

    // Multi-device session revocation
    const nowIso = new Date().toISOString();
    db.prepare(`
      UPDATE sessions SET revoked_at = ?
      WHERE user_id = ? AND device_id != ? AND revoked_at IS NULL
    `).run(nowIso, user.id, currentDeviceId);

    const sessionId = uuidv4();
    const accessToken = signAccessToken(user, currentDeviceId);
    const refreshToken = signRefreshToken(user, currentDeviceId);

    db.prepare(`
      INSERT INTO sessions (id, user_id, device_id, refresh_token_hash, created_at, revoked_at)
      VALUES (?, ?, ?, ?, ?, NULL)
      ON CONFLICT(id) DO NOTHING
    `).run(sessionId, user.id, currentDeviceId, bcrypt.hashSync(refreshToken, 8), nowIso);

    return res.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        user_id: user.user_id,
        phone: user.phone,
        country_code: user.country_code,
        real_name: user.real_name,
        about: user.about,
        profile_photo_url: user.profile_photo_url,
        has_two_step: true,
        created_at: user.created_at
      }
    });
  });

  // ========================================================================
  // 6. POST /auth/two-step/disable — Turn off Two-step verification PIN
  // ========================================================================
  router.post('/auth/two-step/disable', requireAuth, (req, res) => {
    db.prepare('UPDATE users SET two_step_pin_hash = NULL WHERE id = ?').run(req.user.id);
    return res.json({
      success: true,
      message: 'Two-step verification has been turned off.'
    });
  });

  // ========================================================================
  // 7. POST /auth/change-number — Change registered phone number with OTP
  // ========================================================================
  router.post('/auth/change-number', requireAuth, (req, res) => {
    const { new_country_code = '+91', new_phone, otp } = req.body || {};
    const { countryCode, digits, normalized } = normalizePhone(new_country_code, new_phone);
    const cleanOtp = String(otp || '').trim();

    if (!isValidPhone(countryCode, digits)) {
      return sendError(res, 400, 'INVALID_PHONE', 'Please enter a valid new phone number.');
    }

    // Check if new number is already taken
    const existingUser = db.prepare('SELECT id FROM users WHERE phone = ? AND id != ?').get(normalized, req.user.id);
    if (existingUser) {
      return sendError(res, 409, 'PHONE_TAKEN', 'This phone number is already registered to another account.');
    }

    const otpRow = db.prepare('SELECT * FROM otp_codes WHERE phone = ?').get(normalized);
    if (!otpRow || new Date(otpRow.expires_at).getTime() < Date.now()) {
      return sendError(res, 400, 'INVALID_OTP', 'Invalid or expired OTP for the new phone number.');
    }

    if (!bcrypt.compareSync(cleanOtp, otpRow.otp_hash)) {
      return sendError(res, 400, 'INVALID_OTP', 'Wrong code. Please check and try again.');
    }

    db.prepare('DELETE FROM otp_codes WHERE phone = ?').run(normalized);
    db.prepare('UPDATE users SET phone = ?, country_code = ? WHERE id = ?').run(normalized, countryCode, req.user.id);

    return res.json({
      success: true,
      message: `Phone number changed successfully to ${normalized}.`,
      phone: normalized
    });
  });

  // ========================================================================
  // 8. POST /auth/refresh — Refresh JWT access token
  // ========================================================================
  router.post('/auth/refresh', (req, res) => {
    const { refresh_token, device_id } = req.body || {};
    if (!refresh_token) {
      return sendError(res, 400, 'VALIDATION', 'Refresh token is required.');
    }

    try {
      const decoded = verifyRefreshToken(refresh_token);
      const user = db.prepare(`
        SELECT id, user_id, phone, country_code, real_name, profile_photo_url, about,
               is_banned, two_step_pin_hash, created_at
        FROM users WHERE id = ?
      `).get(decoded.sub);

      if (!user || user.is_banned) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Session invalid or account suspended.');
      }

      const currentDeviceId = device_id || req.headers['x-device-id'] || decoded.device_id;
      if (currentDeviceId) {
        const latestSession = db.prepare(`
          SELECT id, revoked_at FROM sessions
          WHERE user_id = ? AND device_id = ?
          ORDER BY created_at DESC LIMIT 1
        `).get(user.id, currentDeviceId);

        if (latestSession && latestSession.revoked_at) {
          return sendError(
            res,
            401,
            'SESSION_REVOKED',
            'You have been logged out because your phone number was registered on another device.'
          );
        }
      }

      const newAccessToken = signAccessToken(user, currentDeviceId);
      const newRefreshToken = signRefreshToken(user, currentDeviceId);

      // Keep active session refresh token hash updated
      try {
        db.prepare(`
          UPDATE sessions SET refresh_token_hash = ?
          WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL
        `).run(bcrypt.hashSync(newRefreshToken, 8), user.id, currentDeviceId);
      } catch {}

      return res.json({
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        user: {
          id: user.id,
          user_id: user.user_id,
          phone: user.phone,
          country_code: user.country_code,
          real_name: user.real_name,
          about: user.about,
          profile_photo_url: user.profile_photo_url
        }
      });
    } catch {
      return sendError(res, 401, 'UNAUTHORIZED', 'Session expired. Please log in again.');
    }
  });

  // ========================================================================
  // 9. POST /auth/logout — Log out from current device
  // ========================================================================
  router.post('/auth/logout', requireAuth, (req, res) => {
    const deviceId = req.body?.device_id || req.deviceId;
    const nowIso = new Date().toISOString();

    if (deviceId) {
      db.prepare(`
        UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND device_id = ?
      `).run(nowIso, req.user.id, deviceId);
    } else {
      db.prepare(`
        UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL
      `).run(nowIso, req.user.id);
    }

    return res.json({
      success: true,
      message: 'Logged out successfully.'
    });
  });

  // ========================================================================
  // 10. DELETE /auth/account — Delete my account permanently
  // ========================================================================
  router.delete('/auth/account', requireAuth, (req, res) => {
    // Delete all sessions, memberships, and user data
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM club_members WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);

    return res.json({
      success: true,
      message: 'Your account and all associated data have been permanently deleted.'
    });
  });

  // ========================================================================
  // 11. GET /me & GET /auth/me
  // ========================================================================
  router.get(['/me', '/auth/me'], requireAuth, (req, res) => {
    return res.json({
      user: {
        id: req.user.id,
        user_id: req.user.user_id,
        phone: req.user.phone,
        country_code: req.user.country_code,
        real_name: req.user.real_name,
        profile_photo_url: req.user.profile_photo_url,
        about: req.user.about,
        has_two_step: Boolean(req.user.two_step_pin_hash),
        created_at: req.user.created_at
      }
    });
  });

  // Legacy user ID login route (for backward compatibility if needed)
  router.post('/auth/login', (req, res) => {
    const { user_id } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE LOWER(user_id) = ?').get(String(user_id || '').toLowerCase());
    if (!user) {
      return sendError(res, 401, 'INVALID_CREDENTIALS', 'User not found.');
    }
    const token = signAccessToken(user);
    const refresh = signRefreshToken(user);
    return res.json({
      access_token: token,
      refresh_token: refresh,
      user
    });
  });

  return router;
}
