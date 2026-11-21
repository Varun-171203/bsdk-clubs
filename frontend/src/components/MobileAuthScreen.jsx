import React, { useState } from 'react';
import {
  Lock, User, Eye, EyeOff, Server, ArrowRight, KeyRound, Check,
  Wifi, AlertCircle, X, ChevronDown, Sparkles, Shield
} from 'lucide-react';
import { BrandLogo } from './BrandLogo.jsx';
import { apiRequest, getServerBaseUrl, setServerBaseUrl, isNativeApp } from '../api.js';

const DEMO_ACCOUNTS = [
  { user_id: 'piyush', label: 'Piyush (Admin)' },
  { user_id: 'rohan', label: 'Rohan' },
  { user_id: 'ananya', label: 'Ananya' },
  { user_id: 'kabir', label: 'Kabir' },
  { user_id: 'meera', label: 'Meera' }
];

const AVATAR_PRESETS = [
  'https://api.dicebear.com/9.x/avataaars/svg?seed=Gang1&backgroundColor=b6e3f4',
  'https://api.dicebear.com/9.x/avataaars/svg?seed=Gang2&backgroundColor=c0aede',
  'https://api.dicebear.com/9.x/avataaars/svg?seed=Gang3&backgroundColor=ffd5dc',
  'https://api.dicebear.com/9.x/avataaars/svg?seed=Gang4&backgroundColor=ffdfbf',
  'https://api.dicebear.com/9.x/avataaars/svg?seed=Gang5&backgroundColor=d1d4f9'
];

export function MobileAuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'forgot'
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [realName, setRealName] = useState('');
  const [contact, setContact] = useState('');
  const [avatar, setAvatar] = useState(AVATAR_PRESETS[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

  // Server config modal/drawer
  const [showServerModal, setShowServerModal] = useState(false);
  const [serverUrl, setServerUrl] = useState(() => getServerBaseUrl() || 'http://10.103.158.228:4000');
  const [serverSaved, setServerSaved] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setInfoMsg('');
    setLoading(true);
    try {
      if (mode === 'login') {
        const data = await apiRequest('/auth/login', {
          method: 'POST',
          authRequired: false,
          body: { user_id: userId.trim(), password }
        });
        onAuthenticated(data);
      } else if (mode === 'register') {
        const isEmail = contact.includes('@');
        const data = await apiRequest('/auth/register', {
          method: 'POST',
          authRequired: false,
          body: {
            user_id: userId.trim(),
            password,
            name: realName.trim(),
            email: isEmail ? contact.trim() : undefined,
            phone: !isEmail && contact ? contact.trim() : undefined,
            profile_photo_url: avatar
          }
        });
        onAuthenticated(data);
      } else {
        const data = await apiRequest('/auth/forgot-password', {
          method: 'POST',
          authRequired: false,
          body: { identifier: userId.trim() }
        });
        setInfoMsg(data.message || 'Recovery link sent.');
      }
    } catch (err) {
      setError(err.message || 'Login failed. Check server connection.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDemoLogin(demoUid) {
    setError('');
    setLoading(true);
    try {
      const data = await apiRequest('/auth/login', {
        method: 'POST',
        authRequired: false,
        body: { user_id: demoUid, password: 'bsdk1234' }
      });
      onAuthenticated(data);
    } catch (err) {
      setError(err.message || 'Demo login failed.');
    } finally {
      setLoading(false);
    }
  }

  function handleSaveServer(newUrl) {
    const target = newUrl !== undefined ? newUrl : serverUrl;
    setServerBaseUrl(target);
    setServerUrl(target);
    setServerSaved(true);
    setTimeout(() => {
      setServerSaved(false);
      setShowServerModal(false);
    }, 1200);
  }

  return (
    <div className="mobile-auth-container">
      {/* Top Mobile Bar */}
      <div className="mobile-auth-topbar">
        <div className="mobile-auth-brand">
          <BrandLogo size={36} />
          <div>
            <div className="mobile-brand-title">
              BSDK <span className="green-accent">Clubs</span>
            </div>
            <div className="mobile-brand-sub">Real Friends. Anonymous Fun.</div>
          </div>
        </div>

        {/* Server quick-indicator / settings icon */}
        <button
          type="button"
          className="mobile-server-btn"
          onClick={() => setShowServerModal(true)}
          title="Server Connection Settings"
        >
          <Server size={15} />
          <span className="mobile-server-btn-text">Server</span>
        </button>
      </div>

      {/* Main Mobile Auth Card */}
      <div className="mobile-auth-content">
        <div className="mobile-auth-card">
          {mode !== 'forgot' ? (
            <div className="mobile-segmented-tabs">
              <button
                type="button"
                className={`mobile-tab-btn ${mode === 'login' ? 'active' : ''}`}
                onClick={() => { setMode('login'); setError(''); setInfoMsg(''); }}
              >
                Sign In
              </button>
              <button
                type="button"
                className={`mobile-tab-btn ${mode === 'register' ? 'active' : ''}`}
                onClick={() => { setMode('register'); setError(''); setInfoMsg(''); }}
              >
                Create Account
              </button>
            </div>
          ) : (
            <div className="mobile-forgot-header">
              <div className="mobile-forgot-title">
                <KeyRound size={20} color="#128C7E" />
                <span>Password Recovery</span>
              </div>
              <p className="mobile-forgot-sub">
                User ID, email ya phone number daalo
              </p>
            </div>
          )}

          {error && (
            <div className="mobile-error-banner">
              <AlertCircle size={17} className="flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {infoMsg && (
            <div className="mobile-info-banner">
              <Check size={17} className="flex-shrink-0" />
              <span>{infoMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mobile-auth-form">
            <div className="mobile-field">
              <label className="mobile-label">
                {mode === 'forgot' ? 'User ID, Email ya Phone' : 'User ID'}
              </label>
              <div className="mobile-input-wrapper">
                <User size={18} className="mobile-input-icon" />
                <input
                  className="mobile-input"
                  type="text"
                  placeholder={mode === 'forgot' ? 'e.g. piyush_07' : 'e.g. piyush_07'}
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  required
                />
              </div>
            </div>

            {mode !== 'forgot' && (
              <div className="mobile-field">
                <label className="mobile-label">Password</label>
                <div className="mobile-input-wrapper">
                  <Lock size={18} className="mobile-input-icon" />
                  <input
                    className="mobile-input"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="mobile-pwd-toggle"
                    onClick={() => setShowPassword((prev) => !prev)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            )}

            {mode === 'register' && (
              <>
                <div className="mobile-field">
                  <label className="mobile-label">Real Name (Doston ko dikhane ke liye)</label>
                  <div className="mobile-input-wrapper">
                    <User size={18} className="mobile-input-icon" />
                    <input
                      className="mobile-input"
                      type="text"
                      placeholder="e.g. Rahul Sharma"
                      value={realName}
                      onChange={(e) => setRealName(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="mobile-trust-badge">
                  <Shield size={14} color="#128C7E" />
                  <span>Real name is visible only in <strong>Group Info</strong>. Chat displays your anonymous alias.</span>
                </div>

                <div className="mobile-field">
                  <label className="mobile-label">Recovery Phone / Email (Optional)</label>
                  <div className="mobile-input-wrapper">
                    <input
                      className="mobile-input mobile-input-noicon"
                      type="text"
                      placeholder="Password recovery contact"
                      value={contact}
                      onChange={(e) => setContact(e.target.value)}
                    />
                  </div>
                </div>

                <div className="mobile-field">
                  <label className="mobile-label">Choose Avatar</label>
                  <div className="mobile-avatar-row">
                    {AVATAR_PRESETS.map((url) => (
                      <button
                        key={url}
                        type="button"
                        onClick={() => setAvatar(url)}
                        className={`mobile-avatar-opt ${avatar === url ? 'selected' : ''}`}
                      >
                        <img src={url} alt="Avatar" className="avatar-circle avatar-sm" />
                        {avatar === url && <div className="avatar-check"><Check size={11} /></div>}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            <button
              className="mobile-submit-btn"
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <div className="mobile-loading-spinner" />
              ) : (
                <>
                  <span>
                    {mode === 'login'
                      ? 'Login to BSDK Clubs'
                      : mode === 'register'
                      ? 'Create Account & Join'
                      : 'Send Recovery Link'}
                  </span>
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          {/* Bottom recovery / back links */}
          <div className="mobile-auth-footlinks">
            {mode === 'login' && (
              <button
                type="button"
                className="mobile-link-btn"
                onClick={() => { setMode('forgot'); setError(''); setInfoMsg(''); }}
              >
                Forgot password? Recover account
              </button>
            )}
            {mode === 'forgot' && (
              <button
                type="button"
                className="mobile-link-btn"
                onClick={() => { setMode('login'); setError(''); setInfoMsg(''); }}
              >
                ← Back to Login
              </button>
            )}
          </div>

          {/* Quick Demo Gang Login (Fast Testing) */}
          <div className="mobile-demo-box">
            <div className="mobile-demo-title">
              <Sparkles size={14} color="#25D366" />
              <span>1-Tap Demo Login (Password: <code>bsdk1234</code>)</span>
            </div>
            <div className="mobile-demo-chips">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.user_id}
                  type="button"
                  className="mobile-demo-chip"
                  disabled={loading}
                  onClick={() => handleDemoLogin(acc.user_id)}
                >
                  {acc.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Backend Server Config Modal / Drawer */}
      {showServerModal && (
        <div className="modal-backdrop" onClick={() => setShowServerModal(false)}>
          <div className="mobile-server-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 16 }}>
                <Server size={18} color="#128C7E" />
                Backend Server URL
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setShowServerModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: 13, color: '#667781', marginBottom: 12 }}>
              Configure backend server connection URL for Android APK:
            </p>

            <div className="mobile-field" style={{ marginBottom: 12 }}>
              <input
                className="text-input"
                style={{ padding: '10px 12px', fontSize: 13.5 }}
                placeholder="http://10.103.158.228:4000 or https://..."
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
              />
            </div>

            {/* Presets */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              <button
                type="button"
                className="mobile-preset-btn"
                onClick={() => setServerUrl('http://10.103.158.228:4000')}
              >
                PC LAN (10.103.158.228)
              </button>
              <button
                type="button"
                className="mobile-preset-btn"
                onClick={() => setServerUrl('http://10.0.2.2:4000')}
              >
                Emulator (10.0.2.2)
              </button>
            </div>

            <button
              type="button"
              className="btn-primary"
              style={{ width: '100%', padding: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              onClick={() => handleSaveServer(serverUrl)}
            >
              {serverSaved ? (
                <>
                  <Check size={16} /> Saved!
                </>
              ) : (
                'Save Server URL'
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
