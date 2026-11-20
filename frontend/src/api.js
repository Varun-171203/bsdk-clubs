import { Capacitor } from '@capacitor/core';

// Production Render backend URL for Android APK & remote clients
const DEFAULT_NATIVE_SERVER = import.meta.env.VITE_SERVER_URL || 'https://bsdk-clubs.onrender.com';

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
    return saved.trim().replace(/\/+$/, '');
  }
  if (isNativeApp()) {
    return DEFAULT_NATIVE_SERVER.replace(/\/+$/, '');
  }
  return ''; // Same-origin on desktop/web browser
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

export function getStoredAuth() {
  try {
    const raw = localStorage.getItem('bsdk_auth');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredAuth(auth) {
  if (!auth) {
    localStorage.removeItem('bsdk_auth');
  } else {
    localStorage.setItem('bsdk_auth', JSON.stringify(auth));
  }
}

async function refreshAccessToken() {
  const auth = getStoredAuth();
  if (!auth?.refresh_token) return null;
  const res = await fetch(`${getApiBase()}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: auth.refresh_token })
  });
  if (!res.ok) return null;
  const data = await res.json();
  const next = { ...auth, access_token: data.access_token, refresh_token: data.refresh_token };
  setStoredAuth(next);
  return next.access_token;
}

export async function apiRequest(path, { method = 'GET', body, authRequired = true } = {}) {
  const auth = getStoredAuth();
  const headers = { 'Content-Type': 'application/json' };
  if (authRequired && auth?.access_token) {
    headers.Authorization = `Bearer ${auth.access_token}`;
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
      `Backend server se connect nahi ho paya (${getServerBaseUrl() || window.location.origin}). Check karo server chal raha hai aur URL sahi hai.`
    );
  }

  // Auto-refresh token once on 401
  if (res.status === 401 && authRequired && auth?.refresh_token) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers.Authorization = `Bearer ${newToken}`;
      res = await fetch(endpoint, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    }
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || 'Kuch gadbad ho gayi, dobara try karo.';
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
