import crypto from 'node:crypto';

// Family-friendly alias wordlist (Section 2.4 & Section 10)
const ADJECTIVES = [
  'Silent', 'Ghost', 'Pixel', 'Turbo', 'Cosmic',
  'Neon', 'Chill', 'Ninja', 'Swift', 'Cozy',
  'Misty', 'Hyper', 'Velvet', 'Lunar', 'Solar',
  'Funky', 'Sneaky', 'Breezy', 'Crispy', 'Quirky',
  'Zesty', 'Glitch', 'Retro', 'Witty', 'Frosty'
];

const NOUNS = [
  'Fox', 'Byte', 'Panda', 'Tiger', 'Hawk',
  'Wolf', 'Otter', 'Spark', 'Moose', 'Falcon',
  'Koala', 'Viper', 'Comet', 'Mango', 'Chai',
  'Samosa', 'Boba', 'Ninja', 'Gecko', 'Puffin',
  'Badger', 'Dolphin', 'Phoenix', 'Raccoon', 'Orbit'
];

// Vibrant, readable alias colours (including accent/pink #F472B6 and WhatsApp-friendly tones)
export const ALIAS_COLORS = [
  '#128C7E',
  '#F472B6',
  '#E11D48',
  '#D97706',
  '#7C3AED',
  '#0284C7',
  '#059669',
  '#EA580C',
  '#4F46E5',
  '#BE185D',
  '#0D9488',
  '#9333EA'
];

// Basic offensive word filter for custom display names (Section 1.4 & Section 10)
const BLOCKED_WORDS = [
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dick', 'pussy',
  'slut', 'whore', 'rape', 'nazi', 'terrorist', 'kill', 'suicide',
  'madarchod', 'behenchod', 'bhosdike', 'chutiya', 'gandu', 'harami', 'randi', 'kamina'
];

export function isAliasClean(alias) {
  if (!alias || typeof alias !== 'string') return false;
  const trimmed = alias.trim();
  if (trimmed.length < 3 || trimmed.length > 28) return false;
  if (!/^[a-zA-Z0-9_\-. ]+$/.test(trimmed)) return false;
  const lower = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '');
  return !BLOCKED_WORDS.some((w) => lower.includes(w));
}

export function generateUniqueAlias(existingAliasesSet) {
  const existingLower = new Set(Array.from(existingAliasesSet).map((a) => a.toLowerCase()));
  for (let i = 0; i < 200; i++) {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const num = String(Math.floor(10 + Math.random() * 90));
    const candidate = `${adj}${noun}_${num}`;
    if (!existingLower.has(candidate.toLowerCase())) {
      const color = ALIAS_COLORS[Math.floor(Math.random() * ALIAS_COLORS.length)];
      return { alias_name: candidate, alias_color: color };
    }
  }
  const fallback = `HoodGhost_${crypto.randomInt(1000, 9999)}`;
  return {
    alias_name: fallback,
    alias_color: ALIAS_COLORS[crypto.randomInt(0, ALIAS_COLORS.length)]
  };
}

export function generateInviteCode() {
  return crypto.randomBytes(5).toString('hex').toUpperCase();
}

export function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// Standard API error format (Section 6)
export function sendError(res, status, code, message) {
  return res.status(status).json({
    error: { code, message }
  });
}

// STRICT PRIVACY GUARD:
// Chat & WebSocket payloads MUST NEVER include user_id, phone, email, real_name, or sender_member_id
const FORBIDDEN_CHAT_KEYS = new Set([
  'user_id', 'sender_user_id', 'sender_member_id', 'real_name', 'phone', 'email', 'password_hash'
]);

export function assertNoIdentityLeak(payload) {
  const stack = [payload];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    for (const key of Object.keys(current)) {
      if (FORBIDDEN_CHAT_KEYS.has(key)) {
        throw new Error(`PRIVACY_VIOLATION: Forbidden field "${key}" detected in anonymous payload!`);
      }
      if (current[key] && typeof current[key] === 'object') {
        stack.push(current[key]);
      }
    }
  }
  return payload;
}

export const DEFAULT_USER_SETTINGS = {
  account: {
    security_notifications: true,
    two_step_pin_enabled: false,
    two_step_pin_hint: ''
  },
  privacy: {
    last_seen: 'My Clubs',
    profile_photo: 'My Clubs',
    about: 'My Clubs',
    status_visibility: 'My Clubs',
    read_receipts: true,
    disappearing_default: 604800,
    screenshot_block: false
  },
  chats: {
    theme: 'light', // Light theme default (Section 3.6.2)
    wallpaper: 'classic',
    font_size: 'medium',
    enter_is_send: true,
    media_visibility: true
  },
  notifications: {
    message_notifications: true,
    group_notifications: true,
    notification_tone: 'Default (Chime)',
    vibrate: true,
    popup: true,
    show_preview: true,
    reaction_notifications: true
  },
  storage: {
    auto_download_wifi: true,
    auto_download_mobile: false
  },
  language: 'English'
};

export function mergeSettings(savedJson) {
  let parsed = {};
  try {
    parsed = typeof savedJson === 'string' ? JSON.parse(savedJson) : (savedJson || {});
  } catch {
    parsed = {};
  }
  return {
    account: { ...DEFAULT_USER_SETTINGS.account, ...(parsed.account || {}) },
    privacy: { ...DEFAULT_USER_SETTINGS.privacy, ...(parsed.privacy || {}) },
    chats: { ...DEFAULT_USER_SETTINGS.chats, ...(parsed.chats || {}) },
    notifications: { ...DEFAULT_USER_SETTINGS.notifications, ...(parsed.notifications || {}) },
    storage: { ...DEFAULT_USER_SETTINGS.storage, ...(parsed.storage || {}) },
    language: parsed.language || DEFAULT_USER_SETTINGS.language
  };
}
