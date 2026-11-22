import jwt from 'jsonwebtoken';
import { sendError } from './utils.js';

const JWT_SECRET = process.env.JWT_SECRET || 'bsdk_clubs_dev_jwt_secret_change_in_prod';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'bsdk_clubs_dev_refresh_secret_change_in_prod';

// Access token (1 year in mobile app), Refresh token (1 year)
export function signAccessToken(user, deviceId = 'primary') {
  return jwt.sign(
    { sub: user.id, phone: user.phone, uid: user.user_id, device_id: deviceId },
    JWT_SECRET,
    { expiresIn: '365d' }
  );
}

export function signRefreshToken(user, deviceId = 'primary') {
  return jwt.sign(
    { sub: user.id, phone: user.phone, uid: user.user_id, device_id: deviceId, type: 'refresh' },
    JWT_REFRESH_SECRET,
    { expiresIn: '365d' }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, JWT_REFRESH_SECRET);
}

// In-memory brute force limiter for OTP / PIN attempts
const attemptLimiter = new Map();
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 10 * 60 * 1000; // 10 minutes (per WhatsApp spec)

export function checkRateLock(key) {
  const entry = attemptLimiter.get(key);
  if (!entry) return { locked: false, attempts: 0 };
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
    const remainingSec = Math.ceil((entry.lockedUntil - Date.now()) / 1000);
    const remainingMin = Math.ceil(remainingSec / 60);
    return { locked: true, remainingSec, remainingMin, attempts: entry.count };
  }
  if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
    attemptLimiter.delete(key);
  }
  return { locked: false, attempts: entry?.count || 0 };
}

export function recordFailedAttempt(key) {
  const entry = attemptLimiter.get(key) || { count: 0, lockedUntil: null };
  entry.count += 1;
  if (entry.count >= MAX_FAILED_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCK_DURATION_MS;
  }
  attemptLimiter.set(key, entry);
  return entry;
}

export function clearAttempts(key) {
  attemptLimiter.delete(key);
}

// Authentication middleware with single-device revocation check
export function createAuthMiddleware(db) {
  return function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Login required. Please sign in with your phone number.');
    }

    try {
      const decoded = verifyAccessToken(token);
      const user = db.prepare(`
        SELECT id, user_id, phone, country_code, real_name, profile_photo_url, about,
               two_step_pin_hash, is_banned, status, created_at, last_seen
        FROM users WHERE id = ?
      `).get(decoded.sub);

      if (!user) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Account not found. Please log in again.');
      }
      if (user.is_banned) {
        return sendError(res, 403, 'BANNED', 'Your account has been suspended.');
      }

      // Check single primary device session revocation (WhatsApp rule)
      const currentDeviceId = req.headers['x-device-id'] || decoded.device_id;
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

      req.user = user;
      req.deviceId = currentDeviceId;
      next();
    } catch {
      return sendError(res, 401, 'UNAUTHORIZED', 'Session expired. Please log in again.');
    }
  };
}

// Optional auth middleware (attaches user if valid token present, otherwise null)
export function createOptionalAuthMiddleware(db) {
  return function optionalAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) {
      req.user = null;
      return next();
    }
    try {
      const decoded = verifyAccessToken(token);
      const user = db.prepare(`
        SELECT id, user_id, phone, country_code, real_name, profile_photo_url, about,
               two_step_pin_hash, is_banned, status, created_at, last_seen
        FROM users WHERE id = ?
      `).get(decoded.sub);
      req.user = user && !user.is_banned ? user : null;
      req.deviceId = req.headers['x-device-id'] || decoded.device_id;
    } catch {
      req.user = null;
    }
    next();
  };
}
