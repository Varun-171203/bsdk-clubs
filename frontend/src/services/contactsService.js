import { apiRequest } from '../api.js';

// Local storage keys
export const STORAGE_PERMISSION_KEY = 'bsdk_contacts_permission_state';
export const STORAGE_CACHED_CONTACTS_KEY = 'bsdk_cached_contacts_v1';
export const STORAGE_LAST_SYNC_KEY = 'bsdk_last_contacts_sync_time';
export const STORAGE_INVITED_HASHES_KEY = 'bsdk_cached_invited_hashes';
export const STORAGE_JOINED_EVENTS_KEY = 'bsdk_joined_contacts_events';

// 24 hours in milliseconds for daily background re-check
export const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Normalizes any phone number into strict E.164 international format.
 * Defaults to +91 (India) if no country prefix is present.
 * Cleans spaces, dashes, parentheses, dots, leading zeroes.
 *
 * @param {string|number} phone
 * @param {string} defaultCountryCode
 * @returns {string} E.164 normalized string or '' if invalid
 */
export function normalizePhoneE164(phone, defaultCountryCode = '+91') {
  if (phone === null || phone === undefined) return '';
  let str = String(phone).trim();
  if (!str) return '';

  // Clean all noise (whitespace, dashes, parentheses, dots)
  str = str.replace(/[\s\-\(\)\.]/g, '');

  // Handle international '00' dialing prefix (e.g. 0091 or 001)
  if (str.startsWith('00')) {
    str = '+' + str.slice(2);
  }

  const defaultCC = defaultCountryCode.startsWith('+') ? defaultCountryCode : `+${defaultCountryCode}`;

  // If already starts with '+', keep '+' and all digits
  if (str.startsWith('+')) {
    const digits = str.slice(1).replace(/\D/g, '');
    if (digits.length < 5 || digits.length > 15) return '';
    return `+${digits}`;
  }

  // Pure digits without prefix
  const digits = str.replace(/\D/g, '');
  if (!digits) return '';

  // Case: India with leading 0 (e.g. 09876543210 -> 11 digits)
  if (defaultCC === '+91' && digits.startsWith('0') && digits.length === 11) {
    return `+91${digits.slice(1)}`;
  }

  // Case: India with 91 already entered without leading + (919876543210 -> 12 digits)
  if (defaultCC === '+91' && digits.startsWith('91') && digits.length === 12) {
    return `+${digits}`;
  }

  // Standard 10-digit national number (e.g. 9876543210 in India)
  if (digits.length === 10) {
    return `${defaultCC}${digits}`;
  }

  // If digits start with the country code digits (e.g. '1' for US or '44' for UK)
  const ccDigits = defaultCC.slice(1);
  if (digits.startsWith(ccDigits) && digits.length > ccDigits.length + 5 && digits.length <= 15) {
    return `+${digits}`;
  }

  // General 7-12 digit mobile number fallback
  if (digits.length >= 7 && digits.length <= 12) {
    return `${defaultCC}${digits}`;
  }

  return '';
}

/**
 * Formats an E.164 phone number into a readable WhatsApp-style representation.
 * e.g. +919876543210 -> +91 98765 43210
 */
export function formatPhoneDisplay(phone) {
  if (!phone) return '';
  const str = String(phone).trim();
  if (str.startsWith('+91') && str.length === 13) {
    return `+91 ${str.slice(3, 8)} ${str.slice(8)}`;
  }
  if (str.startsWith('+1') && str.length === 12) {
    return `+1 (${str.slice(2, 5)}) ${str.slice(5, 8)}-${str.slice(8)}`;
  }
  if (str.startsWith('+44') && str.length >= 12) {
    return `+44 ${str.slice(3, 7)} ${str.slice(7)}`;
  }
  return str;
}

/**
 * Computes SHA-256 hash of a normalized phone number.
 * PRIVACY: Plain phone numbers are NEVER sent to the backend.
 * Works universally in modern browsers (Web Crypto API) and Node.js (globalThis.crypto.subtle).
 *
 * @param {string} phoneE164
 * @returns {Promise<string>} 64-character lowercase hex string
 */
export async function hashPhoneNumber(phoneE164) {
  if (!phoneE164) return '';
  const clean = String(phoneE164).trim().toLowerCase();

  const cryptoObj = (typeof window !== 'undefined' && window.crypto) ||
                    (typeof globalThis !== 'undefined' && globalThis.crypto);

  if (cryptoObj && cryptoObj.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(clean);
    const hashBuffer = await cryptoObj.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback for Node.js environments without crypto.subtle
  try {
    const cryptoModule = 'node:crypto';
    const nodeCrypto = await import(/* @vite-ignore */ cryptoModule);
    return nodeCrypto.createHash('sha256').update(clean).digest('hex');
  } catch (err) {
    throw new Error(`Unable to compute SHA-256 hash: ${err.message}`);
  }
}

/**
 * Synchronous hash helper for testing environments or synchronous contexts.
 */
export function hashPhoneNumberSync(phoneE164) {
  if (!phoneE164) return '';
  const clean = String(phoneE164).trim().toLowerCase();
  try {
    // eslint-disable-next-line global-require
    const nodeCrypto = require('node:crypto');
    return nodeCrypto.createHash('sha256').update(clean).digest('hex');
  } catch {
    // If running in browser or bundler where require is not available, throw async hint
    throw new Error('hashPhoneNumberSync is only available in Node.js test environment; use async hashPhoneNumber.');
  }
}

// Safe storage wrapper for browser localStorage + Node.js memory fallback
const memoryStore = new Map();
export const safeStorage = {
  getItem(key) {
    try {
      if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
    } catch {}
    return memoryStore.get(key) || null;
  },
  setItem(key, value) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, String(value));
        return;
      }
    } catch {}
    memoryStore.set(key, String(value));
  },
  removeItem(key) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
        return;
      }
    } catch {}
    memoryStore.delete(key);
  },
  clear() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.clear();
      }
    } catch {}
    memoryStore.clear();
  }
};

/**
 * Contacts permission management.
 */
export function getContactsPermissionStatus() {
  return safeStorage.getItem(STORAGE_PERMISSION_KEY) || 'prompt';
}

export function setContactsPermissionStatus(status) {
  safeStorage.setItem(STORAGE_PERMISSION_KEY, status);
}

export function hasContactsPermission() {
  return getContactsPermissionStatus() === 'granted';
}

/**
 * Expands a contact's phone numbers so that each number gets its OWN distinct status row.
 * Strict number-based matching: if multiple contacts have the same number,
 * each contact entry is preserved under its own name without erroneously merging!
 *
 * @param {Array<Object>} rawContacts
 * @param {string} defaultCountryCode
 * @returns {Promise<Array<Object>>} Expanded contact number items
 */
export async function expandContactNumbers(rawContacts, defaultCountryCode = '+91') {
  if (!Array.isArray(rawContacts)) return [];

  const items = [];

  for (let idx = 0; idx < rawContacts.length; idx++) {
    const contact = rawContacts[idx];
    const contactId = contact.id || `c_${idx}`;
    const contactName = String(contact.name || contact.displayName || contact.real_name || 'Unnamed Contact').trim();
    const avatarUrl = contact.photo_url || contact.avatar || null;

    // Extract list of numbers (could be string, array of strings, or array of { number, label })
    let phoneEntries = [];
    if (Array.isArray(contact.numbers)) {
      phoneEntries = contact.numbers;
    } else if (Array.isArray(contact.phones)) {
      phoneEntries = contact.phones;
    } else if (contact.phone) {
      phoneEntries = [contact.phone];
    } else if (contact.number) {
      phoneEntries = [contact.number];
    }

    for (let pIdx = 0; pIdx < phoneEntries.length; pIdx++) {
      const entry = phoneEntries[pIdx];
      const rawNumber = typeof entry === 'string' ? entry : (entry?.number || entry?.value || '');
      const label = typeof entry === 'object' && entry?.label ? entry.label : (phoneEntries.length > 1 ? `Phone ${pIdx + 1}` : 'Mobile');

      const norm = normalizePhoneE164(rawNumber, defaultCountryCode);
      if (!norm) continue; // Skip invalid numbers

      const hash = await hashPhoneNumber(norm);

      items.push({
        contactId,
        contactName,
        label,
        rawPhone: rawNumber,
        normalizedPhone: norm,
        phoneHash: hash,
        avatarUrl
      });
    }
  }

  return items;
}

/**
 * Separates expanded contact items into "registered" (Contacts on BSDK Clubs)
 * and "unregistered" (Invite to BSDK Clubs) using the lookup map.
 *
 * @param {Array<Object>} expandedRows
 * @param {Map<string, Object>|Object} lookupResultMap Hash -> Registered user profile
 * @returns {{ registered: Array<Object>, unregistered: Array<Object> }}
 */
export function classifyContacts(expandedRows, lookupResultMap) {
  const getProfile = (hash) => {
    if (lookupResultMap instanceof Map) return lookupResultMap.get(hash);
    return lookupResultMap ? lookupResultMap[hash] : null;
  };

  const registered = [];
  const unregistered = [];

  for (const row of expandedRows) {
    const profile = getProfile(row.phoneHash);
    if (profile) {
      registered.push({
        ...row,
        isRegistered: true,
        registeredUser: {
          id: profile.id,
          user_id: profile.user_id,
          real_name: profile.real_name || row.contactName,
          profile_photo_url: profile.profile_photo_url,
          about: profile.about || 'Hey there! I am on BSDK Clubs'
        }
      });
    } else {
      unregistered.push({
        ...row,
        isRegistered: false
      });
    }
  }

  // Sort registered alphabetically by address book contact name
  registered.sort((a, b) => a.contactName.localeCompare(b.contactName));
  // Sort unregistered alphabetically by address book contact name
  unregistered.sort((a, b) => a.contactName.localeCompare(b.contactName));

  return { registered, unregistered };
}

/**
 * Performs batch hash lookup via POST /api/v1/contacts/lookup.
 *
 * @param {Array<string>} hashes
 * @param {string} [token]
 * @returns {Promise<Map<string, Object>>} Map of phone_hash -> user profile
 */
export async function lookupHashes(hashes, token) {
  if (!hashes || hashes.length === 0) return new Map();

  const uniqueHashes = Array.from(new Set(hashes.filter(Boolean)));
  if (uniqueHashes.length === 0) return new Map();

  const data = await apiRequest('/contacts/lookup', {
    method: 'POST',
    body: { hashes: uniqueHashes },
    token
  });

  const resultMap = new Map();
  if (Array.isArray(data?.contacts)) {
    for (const c of data.contacts) {
      if (c.phone_hash) {
        resultMap.set(c.phone_hash.toLowerCase(), c);
      }
    }
  }
  return resultMap;
}

/**
 * Detects contacts that were previously in the 'unregistered / invited' list
 * and have now registered on BSDK Clubs.
 *
 * @param {Array<string>|Set<string>} previousInvitedHashes
 * @param {Map<string, Object>} currentLookupMap
 * @param {Array<Object>} expandedRows
 * @returns {Array<Object>} List of newly joined contact notifications
 */
export function detectNewlyJoinedContacts(previousInvitedHashes, currentLookupMap, expandedRows) {
  const invitedSet = new Set(previousInvitedHashes || []);
  if (invitedSet.size === 0) return [];

  const newlyJoined = [];
  const handledHashes = new Set();

  for (const row of expandedRows) {
    const { phoneHash, contactName, normalizedPhone } = row;
    if (invitedSet.has(phoneHash) && currentLookupMap.has(phoneHash) && !handledHashes.has(phoneHash)) {
      handledHashes.add(phoneHash);
      const user = currentLookupMap.get(phoneHash);
      newlyJoined.push({
        id: `${phoneHash}_${contactName}`,
        contactName,
        phone: normalizedPhone,
        phoneHash,
        user,
        joinedAt: new Date().toISOString(),
        message: `${contactName} joined BSDK Clubs`
      });
    }
  }

  return newlyJoined;
}

/**
 * Full Sync routine:
 * - Checks 24h background expiry or force refresh.
 * - Expands numbers, hashes them, performs batch lookup.
 * - Compares with previous cache to detect newly joined contacts.
 * - Emits custom event `bsdk:contact_joined` on window if new friends joined.
 * - Saves results to localStorage.
 */
export async function syncContacts({ force = false, rawContacts = null, token } = {}) {
  const now = Date.now();
  const lastSyncStr = safeStorage.getItem(STORAGE_LAST_SYNC_KEY);
  const lastSync = lastSyncStr ? parseInt(lastSyncStr, 10) : 0;

  // Read previous invited hashes from cache to detect joins
  let prevInvitedHashes = [];
  try {
    const rawInvited = safeStorage.getItem(STORAGE_INVITED_HASHES_KEY);
    if (rawInvited) prevInvitedHashes = JSON.parse(rawInvited);
  } catch {}

  // If not forced and synced within 24h, return cached data
  if (!force && lastSync && now - lastSync < SYNC_INTERVAL_MS) {
    try {
      const cached = safeStorage.getItem(STORAGE_CACHED_CONTACTS_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        return {
          ...parsed,
          fromCache: true,
          lastSync
        };
      }
    } catch {}
  }

  // Obtain raw contacts: from argument or fallback mock address book
  const contactsList = (rawContacts && rawContacts.length > 0)
    ? rawContacts
    : getMockAddressBook();

  // 1. Expand each contact's numbers into individual rows
  const expanded = await expandContactNumbers(contactsList);
  const allHashes = expanded.map((r) => r.phoneHash);

  // 2. Perform privacy-preserving hashed lookup
  const lookupMap = await lookupHashes(allHashes, token);

  // 3. Classify into registered and unregistered
  const { registered, unregistered } = classifyContacts(expanded, lookupMap);

  // 4. Check for contacts who joined since last check
  const newlyJoined = detectNewlyJoinedContacts(prevInvitedHashes, lookupMap, expanded);

  // Store newly joined notifications
  if (newlyJoined.length > 0) {
    let existingEvents = [];
    try {
      const storedEvents = safeStorage.getItem(STORAGE_JOINED_EVENTS_KEY);
      if (storedEvents) existingEvents = JSON.parse(storedEvents);
    } catch {}
    const updatedEvents = [...newlyJoined, ...existingEvents].slice(0, 50);
    safeStorage.setItem(STORAGE_JOINED_EVENTS_KEY, JSON.stringify(updatedEvents));

    // Dispatch custom browser event
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      newlyJoined.forEach((evt) => {
        window.dispatchEvent(new CustomEvent('bsdk:contact_joined', { detail: evt }));
      });
    }
  }

  // 5. Update localStorage caches
  const currentInvitedHashes = unregistered.map((u) => u.phoneHash);
  try {
    safeStorage.setItem(STORAGE_INVITED_HASHES_KEY, JSON.stringify(Array.from(new Set(currentInvitedHashes))));
    safeStorage.setItem(STORAGE_LAST_SYNC_KEY, String(now));
    safeStorage.setItem(
      STORAGE_CACHED_CONTACTS_KEY,
      JSON.stringify({ registered, unregistered, newlyJoined })
    );
  } catch {}

  return {
    registered,
    unregistered,
    newlyJoined,
    lastSync: now,
    fromCache: false
  };
}

/**
 * Get stored unacknowledged joined notifications.
 */
export function getNewlyJoinedNotifications() {
  try {
    const raw = safeStorage.getItem(STORAGE_JOINED_EVENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Dismiss a joined notification.
 */
export function dismissJoinedNotification(id) {
  try {
    const list = getNewlyJoinedNotifications().filter((n) => n.id !== id);
    safeStorage.setItem(STORAGE_JOINED_EVENTS_KEY, JSON.stringify(list));
  } catch {}
}

/**
 * Opens or creates a direct 1-on-1 chat with a contact.
 */
export async function startDirectChatWithContact(contactUserId, token) {
  return apiRequest('/contacts/start-chat', {
    method: 'POST',
    body: { contact_user_id: contactUserId },
    token
  });
}

/**
 * Generates WhatsApp-style invite message and link for unregistered contacts.
 */
export function generateInviteLink(contactName = '') {
  const greeting = contactName ? `Hey ${contactName}! ` : 'Hey! ';
  const text = encodeURIComponent(
    `${greeting}Join me on BSDK Clubs - the WhatsApp-style anonymous messenger for your gang! Download here: https://bsdkclubs.app/join`
  );
  return {
    shareUrl: 'https://bsdkclubs.app/join',
    smsUrl: `sms:?body=${text}`,
    whatsappUrl: `https://wa.me/?text=${text}`,
    copyText: `${greeting}Join me on BSDK Clubs: https://bsdkclubs.app/join`
  };
}

/**
 * Rich realistic mock address book for development, Android emulator,
 * or web browsers without native contacts permission.
 * Includes:
 * - Registered demo users (matching backend seeds)
 * - Multi-number contacts (each number with separate label)
 * - Same person under different names (Papa vs Dad)
 * - International numbers (USA, UK)
 * - Unregistered numbers for invitation
 */
export function getMockAddressBook() {
  return [
    {
      id: 'mock_1',
      name: 'Piyush Saxena',
      photo_url: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Piyush&backgroundColor=c0aede',
      numbers: [{ number: '+91 98765 43210', label: 'Mobile' }]
    },
    {
      id: 'mock_2',
      name: 'Rohan Verma',
      photo_url: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Rohan&backgroundColor=b6e3f4',
      numbers: [{ number: '+91 98765 43211', label: 'Mobile' }]
    },
    {
      id: 'mock_3',
      name: 'Ananya Sharma',
      photo_url: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Ananya&backgroundColor=ffd5dc',
      numbers: [{ number: '+91 98765 43212', label: 'Mobile' }]
    },
    {
      id: 'mock_4',
      name: 'Kabir Malhotra',
      photo_url: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Kabir&backgroundColor=d1d4f9',
      numbers: [{ number: '+91 98765 43213', label: 'Mobile' }]
    },
    {
      id: 'mock_5',
      name: 'Meera Nair',
      photo_url: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Meera&backgroundColor=ffdfbf',
      numbers: [{ number: '+91 98765 43214', label: 'Mobile' }]
    },
    // Multi-number contact (one registered, one unregistered)
    {
      id: 'mock_multi',
      name: 'Rohit Sharma (Work & Home)',
      numbers: [
        { number: '+91 98765 43210', label: 'Work (BSDK)' },
        { number: '+91 98765 43299', label: 'Personal (Invite)' }
      ]
    },
    // Same number under different names (testing strict isolation without merging)
    {
      id: 'mock_dad1',
      name: 'Papa',
      numbers: [{ number: '+91 98765 43211', label: 'Mobile' }]
    },
    {
      id: 'mock_dad2',
      name: 'Dad',
      numbers: [{ number: '+91 98765 43211', label: 'Home' }]
    },
    // Unregistered contacts
    {
      id: 'mock_unreg_1',
      name: 'Aarav Patel',
      numbers: [{ number: '+91 98111 22233', label: 'Mobile' }]
    },
    {
      id: 'mock_unreg_2',
      name: 'Sneha Kulkarni',
      numbers: [{ number: '+91 98222 33344', label: 'Mobile' }]
    },
    {
      id: 'mock_unreg_3',
      name: 'Vikram Rajput',
      numbers: [{ number: '+91 98333 44455', label: 'Mobile' }]
    },
    {
      id: 'mock_unreg_4',
      name: 'Pooja Hegde',
      numbers: [{ number: '+91 98444 55566', label: 'Mobile' }]
    },
    {
      id: 'mock_unreg_us',
      name: 'John Miller (USA)',
      numbers: [{ number: '+1 (415) 555-2671', label: 'Mobile' }]
    },
    {
      id: 'mock_unreg_uk',
      name: 'Sarah Jenkins (UK)',
      numbers: [{ number: '+44 7911 123456', label: 'Mobile' }]
    }
  ];
}
