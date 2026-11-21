import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

// Production Render backend URL for Android APK & remote clients
export const PRODUCTION_RENDER_SERVER = 'https://bsdk-clubs.onrender.com';
const DEFAULT_NATIVE_SERVER =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SERVER_URL) ||
  (typeof process !== 'undefined' && process.env?.VITE_SERVER_URL) ||
  PRODUCTION_RENDER_SERVER;

export function isNativeApp() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function getServerBaseUrl() {
  const saved = localStorage.getItem('bsdk_server_url');
  if (saved && saved.trim()) {
    const clean = saved.trim().replace(/\/+$/, '');
    // Automatically purge old stale local emulator or LAN IP addresses
    if (
      !clean.includes('10.0.2.2') &&
      !clean.includes('localhost') &&
      !clean.includes('10.103.') &&
      !clean.includes('10.236.')
    ) {
      return clean;
    }
    localStorage.removeItem('bsdk_server_url');
  }
  return DEFAULT_NATIVE_SERVER.replace(/\/+$/, '');
}

export function setServerBaseUrl(url) {
  const cleaned = String(url || '').trim().replace(/\/+$/, '');
  if (!cleaned) {
    localStorage.removeItem('bsdk_server_url');
  } else {
    localStorage.setItem('bsdk_server_url', cleaned);
  }
}

export function resolveMediaUrl(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url;
  const base = getServerBaseUrl();
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

export function getApiBase() {
  return `${getServerBaseUrl()}/api/v1`;
}

// ============================================================================
// PERSISTENT STORAGE VIA CAPACITOR PREFERENCES + LOCALSTORAGE DUAL-LAYER
// ============================================================================
let memoryAuth = null;
try {
  const raw = localStorage.getItem('bsdk_auth');
  if (raw) memoryAuth = JSON.parse(raw);
} catch {}

let memoryDeviceId = null;
try {
  memoryDeviceId = localStorage.getItem('bsdk_device_id');
} catch {}

export function getDeviceId() {
  if (memoryDeviceId) return memoryDeviceId;
  try {
    const stored = localStorage.getItem('bsdk_device_id');
    if (stored) {
      memoryDeviceId = stored;
      return stored;
    }
  } catch {}
  const newId = 'dev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  memoryDeviceId = newId;
  try {
    localStorage.setItem('bsdk_device_id', newId);
    Preferences.set({ key: 'bsdk_device_id', value: newId }).catch(() => {});
  } catch {}
  return newId;
}

export function getStoredAuth() {
  if (memoryAuth) return memoryAuth;
  try {
    const raw = localStorage.getItem('bsdk_auth');
    if (raw) {
      memoryAuth = JSON.parse(raw);
      return memoryAuth;
    }
  } catch {}
  return null;
}

export function setStoredAuth(auth) {
  memoryAuth = auth;
  try {
    if (!auth) {
      localStorage.removeItem('bsdk_auth');
      Preferences.remove({ key: 'bsdk_auth' }).catch(() => {});
    } else {
      const val = JSON.stringify(auth);
      localStorage.setItem('bsdk_auth', val);
      Preferences.set({ key: 'bsdk_auth', value: val }).catch(() => {});
    }
  } catch (err) {
    console.warn('[setStoredAuth error]', err);
  }
}

// Initialise auth session on app startup (hydrating from native SharedPreferences)
export async function initAuthSession() {
  try {
    // 1. Sync device id
    const devPref = await Preferences.get({ key: 'bsdk_device_id' });
    if (devPref.value) {
      memoryDeviceId = devPref.value;
      localStorage.setItem('bsdk_device_id', devPref.value);
    } else {
      const id = getDeviceId();
      await Preferences.set({ key: 'bsdk_device_id', value: id });
    }

    // 2. Sync auth from native SharedPreferences
    const authPref = await Preferences.get({ key: 'bsdk_auth' });
    if (authPref.value) {
      const parsed = JSON.parse(authPref.value);
      if (parsed?.access_token || parsed?.refresh_token) {
        memoryAuth = parsed;
        localStorage.setItem('bsdk_auth', authPref.value);
        return memoryAuth;
      }
    }
  } catch (err) {
    console.warn('[initAuthSession error]', err);
  }
  return getStoredAuth();
}

// Disk-cached clubs for instantaneous launch
export function getCachedClubs() {
  try {
    const raw = localStorage.getItem('bsdk_cached_clubs');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function setCachedClubs(clubs) {
  try {
    const val = JSON.stringify(clubs || []);
    localStorage.setItem('bsdk_cached_clubs', val);
    Preferences.set({ key: 'bsdk_cached_clubs', value: val }).catch(() => {});
  } catch {}
}

// Disk-cached messages per club for instantaneous launch
export function getCachedMessages(clubId) {
  if (!clubId) return [];
  try {
    const raw = localStorage.getItem(`bsdk_msgs_${clubId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function setCachedMessages(clubId, messages) {
  if (!clubId) return;
  try {
    const val = JSON.stringify(messages || []);
    localStorage.setItem(`bsdk_msgs_${clubId}`, val);
  } catch {}
}

// Silent background token refresh
export async function silentRefreshSession() {
  const auth = getStoredAuth();
  if (!auth?.refresh_token) return null;

  try {
    const res = await fetch(`${getApiBase()}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-id': getDeviceId()
      },
      body: JSON.stringify({ refresh_token: auth.refresh_token })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (errData?.error?.code === 'SESSION_REVOKED') {
        const err = new Error(errData.error.message || 'Session revoked');
        err.code = 'SESSION_REVOKED';
        throw err;
      }
      return null;
    }

    const data = await res.json();
    const nextAuth = {
      ...auth,
      access_token: data.access_token,
      refresh_token: data.refresh_token || auth.refresh_token,
      user: data.user || auth.user
    };
    setStoredAuth(nextAuth);
    return nextAuth.access_token;
  } catch (err) {
    if (err.code === 'SESSION_REVOKED') throw err;
    return null;
  }
}

// Central API Request helper with single primary device header and auto-refresh
export async function apiRequest(path, { method = 'GET', body, authRequired = true, token } = {}) {
  const auth = getStoredAuth();
  const headers = {
    'Content-Type': 'application/json',
    'x-device-id': getDeviceId()
  };
  const effectiveToken = token || (authRequired ? auth?.access_token : null);
  if (effectiveToken) {
    headers.Authorization = `Bearer ${effectiveToken}`;
  }

  const endpoint = `${getApiBase()}${path}`;
  let res;
  try {
    res = await fetch(endpoint, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new Error(
      `Could not connect to backend server (${getServerBaseUrl() || window.location.origin}). Please check your internet connection or server status.`
    );
  }

  // Auto-refresh token once on 401 if refresh_token available
  if (res.status === 401 && authRequired && auth?.refresh_token) {
    try {
      const newToken = await silentRefreshSession();
      if (newToken) {
        headers.Authorization = `Bearer ${newToken}`;
        res = await fetch(endpoint, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined
        });
      }
    } catch (refreshErr) {
      if (refreshErr.code === 'SESSION_REVOKED') {
        throw refreshErr;
      }
    }
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || 'Something went wrong, please try again.';
    const err = new Error(msg);
    err.code = data?.error?.code || 'ERROR';
    err.status = res.status;
    throw err;
  }
  return data;
}

export function formatTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatRelativeDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const now = new Date();
  const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return formatTime(isoString);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function formatDisappearingLabel(seconds) {
  if (!seconds || seconds === 0) return 'Off';
  if (seconds === 86400) return '24 hours';
  if (seconds === 604800) return '7 days';
  return `${Math.round(seconds / 3600)} hours`;
}
