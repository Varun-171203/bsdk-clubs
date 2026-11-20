/**
 * BSDK Clubs - Invite Service (WhatsApp-Style Android Messenger)
 * Handles:
 * 1. WhatsApp Intent & Web URLs (wa.me) with pre-filled viral gang copy
 * 2. Native SIM SMS intent (sms: URI - zero server cost)
 * 3. Deep link generation and resolution (bsdkclubs://invite/<code> and https://bsdkclubs.app/invite/<code>)
 * 4. Deferred invite code application after OTP login
 * 5. Short 6-8 char invite code generation (e.g. GANG-4F8K)
 * 6. QR Code payload generation (bsdk:invite:<code> and bsdk:user:<userId>:<code>)
 * 7. QR/Invite Code revocation & reset logic
 * 8. Invite tracking & 3-day reminder rule enforcement
 */

export const DEFAULT_INVITE_DOMAIN = 'https://bsdkclubs.app';
export const DEEP_LINK_SCHEME = 'bsdkclubs';
export const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000; // 259,200,000 ms

/**
 * Standard viral invitation copy
 */
export const DEFAULT_INVITE_MESSAGE = (inviteCode) =>
  `Hey! I'm on BSDK Clubs — Your Gang. Your Bang. Join my gang here, messages disappear in 7 days and nobody knows who sent what in the group 😄 Download: https://bsdkclubs.app/invite/${inviteCode}`;

// In-memory fallback for environments without localStorage (Node.js test runner)
const memoryStore = {};

export function storageGet(key) {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch {}
  return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
}

export function storageSet(key, value) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      return;
    }
  } catch {}
  memoryStore[key] = String(value);
}

export function storageRemove(key) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
      return;
    }
  } catch {}
  delete memoryStore[key];
}

export function clearInviteStorageForTesting() {
  for (const k of Object.keys(memoryStore)) {
    delete memoryStore[k];
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('bsdk_invites_tracker');
      localStorage.removeItem('bsdk_revoked_codes');
      localStorage.removeItem('bsdk_pending_invite');
      localStorage.removeItem('bsdk_my_personal_invite_code');
    }
  } catch {}
}

/**
 * Strip non-digit characters from phone number
 */
export function cleanPhoneNumber(phone) {
  if (!phone) return '';
  return String(phone).trim().replace(/\D/g, '');
}

/**
 * Formats Indian/international phone number for WhatsApp wa.me
 * If 10 digits without country code, prepends standard '91' (India)
 */
export function formatPhoneForWhatsApp(phone, defaultCountry = '91') {
  const digits = cleanPhoneNumber(phone);
  if (!digits) return '';
  if (digits.length === 10) {
    return `${defaultCountry}${digits}`;
  }
  return digits;
}

/**
 * Generates invitation text
 */
export function generateInviteText(inviteCode, customText) {
  const code = String(inviteCode || '').trim();
  if (customText && typeof customText === 'string') {
    return customText.replace('{code}', code).replace('{url}', generateInviteLink(code));
  }
  return DEFAULT_INVITE_MESSAGE(code);
}

/**
 * Generates invite link: https://bsdkclubs.app/invite/<INVITE_CODE>
 */
export function generateInviteLink(inviteCode, baseUrl = DEFAULT_INVITE_DOMAIN) {
  const cleanBase = String(baseUrl || DEFAULT_INVITE_DOMAIN).trim().replace(/\/+$/, '');
  const cleanCode = String(inviteCode || '').trim();
  return `${cleanBase}/invite/${encodeURIComponent(cleanCode)}`;
}

/**
 * 1. INVITE VIA WHATSAPP
 * Generates https://wa.me/${phoneClean}?text=${encodeURIComponent(text)}
 */
export function generateWhatsAppUrl({ phone, inviteCode, text }) {
  const code = inviteCode || '';
  const message = text || generateInviteText(code);
  const targetPhone = formatPhoneForWhatsApp(phone);
  const encodedText = encodeURIComponent(message);

  if (targetPhone) {
    return `https://wa.me/${targetPhone}?text=${encodedText}`;
  }
  return `https://wa.me/?text=${encodedText}`;
}

/**
 * Generates native WhatsApp intent: whatsapp://send?phone=...&text=...
 */
export function generateWhatsAppIntentUrl({ phone, inviteCode, text }) {
  const code = inviteCode || '';
  const message = text || generateInviteText(code);
  const targetPhone = formatPhoneForWhatsApp(phone);
  const encodedText = encodeURIComponent(message);

  if (targetPhone) {
    return `whatsapp://send?phone=${targetPhone}&text=${encodedText}`;
  }
  return `whatsapp://send?text=${encodedText}`;
}

/**
 * Opens WhatsApp with pre-filled message, tracks the invite, and falls back gracefully
 */
export function openWhatsAppInvite({ phone, inviteCode, text, onTrack }) {
  const webUrl = generateWhatsAppUrl({ phone, inviteCode, text });
  const intentUrl = generateWhatsAppIntentUrl({ phone, inviteCode, text });

  // Track the invite
  const record = trackInvite({ phone, inviteCode, method: 'whatsapp' });
  if (typeof onTrack === 'function') onTrack(record);

  if (typeof window !== 'undefined') {
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator?.userAgent || '');
    if (isMobile) {
      // In mobile environment, trigger native intent with web fallback
      try {
        window.location.href = intentUrl;
        setTimeout(() => {
          window.open(webUrl, '_blank');
        }, 1200);
      } catch {
        window.open(webUrl, '_blank');
      }
    } else {
      window.open(webUrl, '_blank', 'noopener,noreferrer');
    }
  }

  return { webUrl, intentUrl };
}

/**
 * 2. INVITE VIA SMS
 * Generates native SMS intent (sms:${phoneClean}?body=${encodeURIComponent(text)})
 * Uses user's SIM/phone, zero server cost.
 */
export function generateSmsUrl({ phone, inviteCode, text }) {
  const code = inviteCode || '';
  const message = text || generateInviteText(code);
  const phoneClean = cleanPhoneNumber(phone);
  const encodedText = encodeURIComponent(message);

  // Platform specific separator: iOS WebKit sometimes prefers '&' over '?'
  let separator = '?';
  if (typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator?.userAgent || '')) {
    separator = '&';
  }

  if (phoneClean) {
    return `sms:${phoneClean}${separator}body=${encodedText}`;
  }
  return `sms:${separator}body=${encodedText}`;
}

/**
 * Opens native SMS app with zero server cost, tracks invite
 */
export function openSmsInvite({ phone, inviteCode, text, onTrack }) {
  const smsUrl = generateSmsUrl({ phone, inviteCode, text });

  const record = trackInvite({ phone, inviteCode, method: 'sms' });
  if (typeof onTrack === 'function') onTrack(record);

  if (typeof window !== 'undefined') {
    window.location.href = smsUrl;
  }

  return { smsUrl };
}

/**
 * Copy to clipboard helper
 */
export async function copyToClipboard(text) {
  if (!text) return false;
  if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback
    }
  }
  if (typeof document !== 'undefined') {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return Boolean(ok);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * 3. INVITE LINK: Copy & Web Share API
 */
export async function copyInviteLink(inviteCode, baseUrl) {
  const link = generateInviteLink(inviteCode, baseUrl);
  const ok = await copyToClipboard(link);
  return { ok, link };
}

export async function shareInviteLink({ inviteCode, title, text, baseUrl }) {
  const link = generateInviteLink(inviteCode, baseUrl);
  const shareTitle = title || 'Join my Gang on BSDK Clubs';
  const shareText = text || generateInviteText(inviteCode);

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: shareTitle,
        text: shareText,
        url: link
      });
      trackInvite({ phone: 'share', inviteCode, method: 'native_share' });
      return { shared: true, method: 'native_share', link };
    } catch (err) {
      if (err.name === 'AbortError') {
        return { shared: false, cancelled: true, link };
      }
    }
  }

  // Fallback to clipboard
  const copied = await copyToClipboard(link);
  trackInvite({ phone: 'copy', inviteCode, method: 'copy_link' });
  return { shared: false, copied, fallback: true, link };
}

/**
 * 4. SHORT INVITE CODE GENERATION (6-8 char code, e.g. GANG-4F8K)
 */
export function generateShortInviteCode(prefix = 'GANG') {
  // 32 unambiguous characters (excludes 0, O, 1, I)
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let rand = '';

  if (typeof crypto !== 'undefined') {
    if (typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(4);
      crypto.getRandomValues(bytes);
      for (let i = 0; i < 4; i++) {
        rand += chars.charAt(bytes[i] % chars.length);
      }
    } else if (typeof crypto.randomInt === 'function') {
      for (let i = 0; i < 4; i++) {
        rand += chars.charAt(crypto.randomInt(0, chars.length));
      }
    }
  }

  if (!rand || rand.length < 4) {
    for (let i = 0; i < 4; i++) {
      rand += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  }

  return prefix ? `${prefix}-${rand}` : rand;
}

export function isValidInviteCode(code) {
  if (!code || typeof code !== 'string') return false;
  const clean = code.trim().toUpperCase();
  // Validates codes like GANG-4F8K, CLUB-9X2M, HOSTEL42, EXAM99 (5 to 16 chars)
  return /^[A-Z0-9]{2,8}(-[A-Z0-9]{3,8})?$/i.test(clean) && clean.length >= 5 && clean.length <= 16;
}

export function formatInviteCodeInput(input) {
  if (!input) return '';
  return String(input).toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16);
}

/**
 * 5. DEEP LINKING & URI PARSER
 * Handles:
 * - bsdkclubs://invite/<code>
 * - bsdkclubs://join/<code>
 * - bsdkclubs://user/<userId>/<code>
 * - https://bsdkclubs.app/invite/<code>
 * - bsdk:invite:<code>
 * - bsdk:user:<userId>:<code>
 */
export function parseInviteUri(uriString) {
  if (!uriString || typeof uriString !== 'string') return null;
  const str = uriString.trim();

  // QR Payload 1: bsdk:invite:<code>
  const qrInvite = str.match(/^bsdk:invite:([A-Za-z0-9_-]+)$/i);
  if (qrInvite) {
    return { type: 'invite', code: qrInvite[1].toUpperCase(), raw: str };
  }

  // QR Payload 2: bsdk:user:<userId>:<code>
  const qrUser = str.match(/^bsdk:user:([^:]+):([A-Za-z0-9_-]+)$/i);
  if (qrUser) {
    return {
      type: 'user',
      userId: qrUser[1],
      code: qrUser[2].toUpperCase(),
      raw: str
    };
  }

  // Deep Link 1: bsdkclubs://invite/<code> or bsdkclubs://join/<code>
  const schemeInvite = str.match(/^bsdkclubs:\/\/(?:invite|join)\/([A-Za-z0-9_-]+)/i);
  if (schemeInvite) {
    return { type: 'invite', code: schemeInvite[1].toUpperCase(), raw: str };
  }

  // Deep Link 2: bsdkclubs://user/<userId>/<code> or bsdkclubs://user/<userId>
  const schemeUser = str.match(/^bsdkclubs:\/\/user\/([^\/]+)(?:\/([A-Za-z0-9_-]+))?/i);
  if (schemeUser) {
    return {
      type: 'user',
      userId: schemeUser[1],
      code: (schemeUser[2] || '').toUpperCase(),
      raw: str
    };
  }

  // HTTP(S) URL: https://bsdkclubs.app/invite/<code> or https://.../join/<code>
  const httpInvite = str.match(/^https?:\/\/[^\/]+\/(?:invite|join)\/([A-Za-z0-9_-]+)/i);
  if (httpInvite) {
    return { type: 'invite', code: httpInvite[1].toUpperCase(), raw: str };
  }

  // Raw short code (e.g. GANG-4F8K, HOSTEL42)
  if (isValidInviteCode(str)) {
    return { type: 'code', code: str.toUpperCase(), raw: str };
  }

  return null;
}

/**
 * Deferred Invite Code Application after OTP Login
 */
const PENDING_INVITE_KEY = 'bsdk_pending_invite';

export function savePendingInvite(code, metadata = {}) {
  if (!code) return;
  const payload = {
    code: String(code).trim().toUpperCase(),
    savedAt: new Date().toISOString(),
    metadata
  };
  storageSet(PENDING_INVITE_KEY, JSON.stringify(payload));
}

export function getPendingInvite() {
  const raw = storageGet(PENDING_INVITE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearPendingInvite() {
  storageRemove(PENDING_INVITE_KEY);
}

export async function applyPendingInvite(apiRequest) {
  const pending = getPendingInvite();
  if (!pending?.code) return null;

  try {
    const res = await apiRequest('/clubs/join', {
      method: 'POST',
      body: { invite_code: pending.code }
    });
    clearPendingInvite();
    return { success: true, club: res.club, appliedCode: pending.code };
  } catch (err) {
    clearPendingInvite();
    return { success: false, error: err.message, appliedCode: pending.code };
  }
}

/**
 * 6. QR CODE PAYLOAD GENERATION & PARSING
 * Specs:
 * - bsdk:invite:${code}
 * - bsdk:user:${userId}:${code}
 */
export function generateQrPayload(code, type = 'invite', userId = null) {
  const cleanCode = String(code || '').trim().toUpperCase();
  if (type === 'user' && userId) {
    return `bsdk:user:${userId}:${cleanCode}`;
  }
  return `bsdk:invite:${cleanCode}`;
}

const REVOKED_CODES_KEY = 'bsdk_revoked_codes';

export function getRevokedCodes() {
  const raw = storageGet(REVOKED_CODES_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function revokeInviteCode(code, reason = 'Code reset by owner') {
  if (!code) return false;
  const upper = String(code).trim().toUpperCase();
  const list = getRevokedCodes();
  if (!list.some((item) => item.code === upper)) {
    list.push({
      code: upper,
      revokedAt: new Date().toISOString(),
      reason
    });
    storageSet(REVOKED_CODES_KEY, JSON.stringify(list));
  }
  return true;
}

export function isCodeRevoked(code) {
  if (!code) return false;
  const upper = String(code).trim().toUpperCase();
  const list = getRevokedCodes();
  return list.some((item) => item.code === upper);
}

export function resetUserInviteCode(oldCode, prefix = 'GANG') {
  if (oldCode) {
    revokeInviteCode(oldCode, 'Reset by user');
  }
  const newCode = generateShortInviteCode(prefix);
  storageSet('bsdk_my_personal_invite_code', newCode);
  return newCode;
}

export function getUserInviteCode(defaultPrefix = 'GANG') {
  let saved = storageGet('bsdk_my_personal_invite_code');
  if (!saved || isCodeRevoked(saved)) {
    saved = generateShortInviteCode(defaultPrefix);
    storageSet('bsdk_my_personal_invite_code', saved);
  }
  return saved;
}

export function parseQrPayload(raw) {
  if (!raw || typeof raw !== 'string') {
    return { valid: false, error: 'INVALID_PAYLOAD', message: 'Empty or invalid QR code.' };
  }

  const parsed = parseInviteUri(raw);
  if (!parsed || !parsed.code) {
    return { valid: false, error: 'UNRECOGNIZED_FORMAT', message: 'Not a recognized BSDK Clubs QR code.' };
  }

  if (isCodeRevoked(parsed.code)) {
    return {
      valid: false,
      revoked: true,
      error: 'CODE_REVOKED',
      code: parsed.code,
      message: 'This invite/QR code has been reset or revoked by the owner.'
    };
  }

  return {
    valid: true,
    revoked: false,
    ...parsed
  };
}

/**
 * 7. INVITE TRACKING & 3-DAY REMINDER RULE
 * Specs:
 * - Track: Invited (timestamp, method) vs Joined
 * - "Invite again" (remind) after 3 days rule
 */
const INVITES_TRACKER_KEY = 'bsdk_invites_tracker';

export function getAllInviteRecords() {
  const raw = storageGet(INVITES_TRACKER_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function getInviteRecord(phone) {
  const clean = cleanPhoneNumber(phone);
  if (!clean) return null;
  const all = getAllInviteRecords();
  return all[clean] || null;
}

export function trackInvite({ phone, inviteCode, method = 'whatsapp', contactName = '' }) {
  const clean = cleanPhoneNumber(phone);
  if (!clean) return null;
  const all = getAllInviteRecords();
  const now = new Date().toISOString();

  const existing = all[clean];
  const record = {
    phone: clean,
    inviteCode: (inviteCode || existing?.inviteCode || '').toUpperCase(),
    method,
    contactName: contactName || existing?.contactName || '',
    invitedAt: existing?.invitedAt || now,
    lastReminderAt: now,
    reminderCount: existing ? (existing.reminderCount || 0) + 1 : 0,
    status: existing?.status === 'joined' ? 'joined' : 'invited'
  };

  all[clean] = record;
  storageSet(INVITES_TRACKER_KEY, JSON.stringify(all));
  return record;
}

export function markInviteJoined({ phone, inviteCode }) {
  const clean = cleanPhoneNumber(phone);
  const all = getAllInviteRecords();
  const now = new Date().toISOString();

  if (clean && all[clean]) {
    all[clean].status = 'joined';
    all[clean].joinedAt = now;
    storageSet(INVITES_TRACKER_KEY, JSON.stringify(all));
    return all[clean];
  }

  if (inviteCode) {
    const upper = String(inviteCode).toUpperCase();
    for (const key of Object.keys(all)) {
      if (all[key].inviteCode === upper) {
        all[key].status = 'joined';
        all[key].joinedAt = now;
        storageSet(INVITES_TRACKER_KEY, JSON.stringify(all));
        return all[key];
      }
    }
  }

  return null;
}

/**
 * Checks if 3 days have elapsed since initial invite or last reminder
 */
export function canRemindInvite(phoneOrRecord) {
  const record = typeof phoneOrRecord === 'object' && phoneOrRecord !== null
    ? phoneOrRecord
    : getInviteRecord(phoneOrRecord);

  if (!record) return false;
  if (record.status === 'joined') return false;
  if (!record.invitedAt) return false;

  const lastTime = new Date(record.lastReminderAt || record.invitedAt).getTime();
  const elapsed = Date.now() - lastTime;
  return elapsed >= THREE_DAYS_MS;
}

/**
 * Detailed reminder countdown status
 */
export function getRemindCountdown(phoneOrRecord) {
  const record = typeof phoneOrRecord === 'object' && phoneOrRecord !== null
    ? phoneOrRecord
    : getInviteRecord(phoneOrRecord);

  if (!record) {
    return { canRemind: false, status: 'none', label: 'Not invited yet' };
  }
  if (record.status === 'joined') {
    return { canRemind: false, status: 'joined', label: 'Joined BSDK Clubs 🎉' };
  }

  const lastTime = new Date(record.lastReminderAt || record.invitedAt).getTime();
  const elapsed = Date.now() - lastTime;
  const remainingMs = THREE_DAYS_MS - elapsed;

  if (remainingMs <= 0) {
    return {
      canRemind: true,
      status: 'eligible',
      remainingMs: 0,
      daysRemaining: 0,
      hoursRemaining: 0,
      label: 'Remind now'
    };
  }

  const hoursRemaining = Math.max(1, Math.ceil(remainingMs / (60 * 60 * 1000)));
  const daysRemaining = Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));

  const label = daysRemaining > 1 ? `Remind in ${daysRemaining} days` : `Remind in ${hoursRemaining}h`;

  return {
    canRemind: false,
    status: 'waiting',
    remainingMs,
    daysRemaining,
    hoursRemaining,
    label
  };
}

export function recordReminder(phone, method = 'whatsapp') {
  return trackInvite({ phone, method });
}

/**
 * Resolves personal or club code -> previews inviter or club
 */
export async function resolveInviteCode(code, apiRequest) {
  if (!code) throw new Error('Invite code daalo.');
  const upper = String(code).trim().toUpperCase();

  if (isCodeRevoked(upper)) {
    throw new Error('Ye invite code reset ya revoke ho chuka hai.');
  }

  if (typeof apiRequest === 'function') {
    // 1. Try resolving club first
    try {
      const data = await apiRequest(`/clubs/preview/${encodeURIComponent(upper)}`);
      if (data?.club) {
        return { type: 'club', club: data.club };
      }
    } catch {
      // 2. Try generic invites preview endpoint
      try {
        const invData = await apiRequest(`/invites/preview/${encodeURIComponent(upper)}`);
        if (invData) return invData;
      } catch (err2) {
        throw new Error(err2.message || 'Ye invite code invalid ya expire ho chuka hai.');
      }
    }
  }

  return { type: 'code', code: upper };
}
