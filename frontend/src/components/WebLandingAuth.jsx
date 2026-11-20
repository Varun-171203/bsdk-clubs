import React, { useState } from 'react';
import { ShieldCheck, Users, MessageSquare, Sparkles, Lock, ArrowRight, KeyRound, Server, Check } from 'lucide-react';
import { BrandLogo } from './BrandLogo.jsx';
import { apiRequest, getServerBaseUrl, setServerBaseUrl, isNativeApp } from '../api.js';

const SLIDES = [
  {
    key: 'familiar',
    title: 'Familiar Chat',
    icon: MessageSquare,
    heading: 'WhatsApp jaisa familiar UI — bina seekhe start karo',
    desc: 'Chat list, green/white bubbles, reply-quote, reactions, polls, group-wise Status aur familiar Settings structure. Zero learning curve.'
  },
  {
    key: 'alias',
    title: 'Anonymous Alias',
    icon: Sparkles,
    heading: 'Har club mein ek alag, weird aur fun display name',
    desc: 'Chat ke andar sirf tumhara temporary alias dikhta hai (jaise SilentFox_42 ya GhostByte_07). Kabhi bhi badlo, har group mein alag naam!'
  },
  {
    key: 'trusted',
    title: 'Trusted Groups',
    icon: ShieldCheck,
    heading: 'Strangers nahi — Group Info mein sab real dost visible',
    desc: 'Group Info mein real naam + photo dikhta hai taaki trust rahe. Chat mein kaun kya bol raha hai — ye kisi ko nahi pata. Your Gang. Your Bang.'
  }
];

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

export function WebLandingAuth({ onAuthenticated }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'forgot'
  const [slideIdx, setSlideIdx] = useState(0);
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [realName, setRealName] = useState('');
  const [contact, setContact] = useState('');
  const [avatar, setAvatar] = useState(AVATAR_PRESETS[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [showServerBox, setShowServerBox] = useState(() => isNativeApp());
  const [serverUrl, setServerUrl] = useState(() => getServerBaseUrl() || 'http://10.103.158.228:4000');
  const [serverSaved, setServerSaved] = useState(false);

  const activeSlide = SLIDES[slideIdx];
  const SlideIcon = activeSlide.icon;

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
          body: { user_id: userId, password }
        });
        onAuthenticated(data);
      } else if (mode === 'register') {
        const isEmail = contact.includes('@');
        const data = await apiRequest('/auth/register', {
          method: 'POST',
          authRequired: false,
          body: {
            user_id: userId,
            password,
            name: realName,
            email: isEmail ? contact : undefined,
            phone: !isEmail && contact ? contact : undefined,
            profile_photo_url: avatar
          }
        });
        onAuthenticated(data);
      } else {
        const data = await apiRequest('/auth/forgot-password', {
          method: 'POST',
          authRequired: false,
          body: { identifier: userId }
        });
        setInfoMsg(data.message);
      }
    } catch (err) {
      setError(err.message);
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
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <header className="auth-top-ribbon">
        <div className="brand-lockup">
          <BrandLogo size={38} />
          <div>
            <div>BSDK <span style={{ color: '#25D366' }}>Clubs</span></div>
            <div style={{ fontSize: 11, fontWeight: 500, opacity: 0.8 }}>Real dost. Anonymous bakcodi.</div>
          </div>
        </div>
        <div className="auth-badge-row">
          <span className="pill-badge">WhatsApp-Style Look</span>
          <span className="pill-badge">Chats • Clubs • Updates</span>
          <span className="pill-badge">7-Day Disappearing</span>
        </div>
      </header>

      <main className="auth-grid">
        {/* Left Hero & Interactive Preview */}
        <section className="auth-hero">
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', color: '#A7F3D0', marginBottom: 8 }}>
              ANONYMOUS GROUPS • FAMILIAR CHAT
            </div>
            <h1>
              Your Gang.<br />
              <span>Your Bang.</span>
            </h1>
            <p className="auth-hero-sub" style={{ marginTop: 12 }}>
              WhatsApp like hood app — <strong>Their phone is their host.</strong> Group Info mein real dost dikhte hain,
              lekin chat ke andar kaun kya bhej raha hai, ye kisi ko nahi pata.
            </p>
          </div>

          {/* Live Demo Chat Card */}
          <div className="auth-demo-chat">
            <div className="auth-demo-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
                <Users size={16} color="#25D366" />
                Hostel Bakcodi • 5 members — aliases on
              </div>
              <span style={{ fontSize: 11, color: '#8696A0' }}>Disappears in 7d</span>
            </div>
            <div className="auth-demo-body">
              <div className="demo-bubble other">
                <div className="demo-bubble-alias" style={{ color: '#34D399' }}>SilentFox_42</div>
                <div>aaj ka plan confirm?</div>
                <div className="demo-bubble-time">9:41 PM</div>
              </div>
              <div className="demo-bubble own">
                <div className="demo-bubble-alias" style={{ color: '#A7F3D0' }}>GhostByte_07 (You)</div>
                <div>haan, 10 baje milte hain</div>
                <div className="demo-bubble-time">9:42 PM ✓✓</div>
              </div>
              <div className="demo-bubble other">
                <div className="demo-bubble-alias" style={{ color: '#F472B6' }}>PixelPanda_19</div>
                <div>poll daal diya hai, vote karo</div>
                <div className="demo-bubble-time">9:43 PM</div>
              </div>
              <div style={{ fontSize: 11.5, color: '#8696A0', textAlign: 'center', paddingTop: 4 }}>
                Real naam chat mein hidden — sirf group alias dikhta hai.
              </div>
            </div>
          </div>

          {/* 3-Slide Interactive Onboarding Walkthrough */}
          <div className="onboarding-slides">
            <div className="slide-tabs">
              {SLIDES.map((s, idx) => (
                <button
                  key={s.key}
                  type="button"
                  className={`slide-tab ${idx === slideIdx ? 'active' : ''}`}
                  onClick={() => setSlideIdx(idx)}
                >
                  {idx + 1}. {s.title}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ background: 'rgba(37,211,102,0.2)', padding: 10, borderRadius: 12, color: '#25D366' }}>
                <SlideIcon size={22} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{activeSlide.heading}</div>
                <div style={{ fontSize: 13.5, color: '#D7F5EA', lineHeight: 1.45 }}>{activeSlide.desc}</div>
              </div>
            </div>
          </div>
        </section>

        {/* Right Auth Card */}
        <section className="auth-card">
          {mode !== 'forgot' ? (
            <div className="auth-tabs">
              <button
                type="button"
                className={`auth-tab-btn ${mode === 'login' ? 'active' : ''}`}
                onClick={() => { setMode('login'); setError(''); setInfoMsg(''); }}
              >
                Login
              </button>
              <button
                type="button"
                className={`auth-tab-btn ${mode === 'register' ? 'active' : ''}`}
                onClick={() => { setMode('register'); setError(''); setInfoMsg(''); }}
              >
                New Account
              </button>
            </div>
          ) : (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 18, color: '#075E54' }}>
                <KeyRound size={20} /> Password Recovery
              </div>
              <p style={{ fontSize: 13, color: '#667781', marginTop: 4 }}>
                Registered phone/email ya User ID daalo, recovery link bhej denge.
              </p>
            </div>
          )}

          {error && <div className="error-banner">{error}</div>}
          {infoMsg && <div className="trust-note" style={{ marginBottom: 12 }}>{infoMsg}</div>}

          <form onSubmit={handleSubmit}>
            <div className="field-group">
              <label className="field-label">
                {mode === 'forgot' ? 'User ID, Phone ya Email' : 'User ID (unique)'}
              </label>
              <input
                className="text-input"
                type="text"
                placeholder={mode === 'forgot' ? 'e.g. piyush or piyush@bsdkclubs.app' : 'e.g. piyush_07'}
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                required
              />
            </div>

            {mode !== 'forgot' && (
              <div className="field-group">
                <label className="field-label">Password {mode === 'register' && '(min 8 chars)'}</label>
                <input
                  className="text-input"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            )}

            {mode === 'register' && (
              <>
                <div className="field-group">
                  <label className="field-label">Real Name (Profile Setup)</label>
                  <input
                    className="text-input"
                    type="text"
                    placeholder="e.g. Rahul Sharma"
                    value={realName}
                    onChange={(e) => setRealName(e.target.value)}
                    required
                  />
                </div>
                <div className="trust-note" style={{ marginBottom: 14 }}>
                  <strong>Privacy Note:</strong> Ye real naam sirf <strong>Group Info</strong> mein dikhega taaki doston ko trust rahe — chat mein kabhi nahi!
                </div>
                <div className="field-group">
                  <label className="field-label">Recovery Phone / Email (optional)</label>
                  <input
                    className="text-input"
                    type="text"
                    placeholder="Password recovery ke liye"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                  />
                </div>
                <div className="field-group">
                  <label className="field-label">Choose Profile Avatar (Group Info ke liye)</label>
                  <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                    {AVATAR_PRESETS.map((url) => (
                      <button
                        key={url}
                        type="button"
                        onClick={() => setAvatar(url)}
                        style={{
                          padding: 2,
                          borderRadius: '50%',
                          border: avatar === url ? '2.5px solid #128C7E' : '2.5px solid transparent'
                        }}
                      >
                        <img src={url} alt="Avatar option" className="avatar-circle avatar-sm" />
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            <button className="btn-primary" type="submit" disabled={loading} style={{ width: '100%', marginTop: 4 }}>
              {loading ? 'Please wait...' : mode === 'login' ? 'Login to BSDK Clubs' : mode === 'register' ? 'Create Account & Join' : 'Send Recovery Link'}
              {!loading && <ArrowRight size={17} />}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: 12 }}>
            {mode === 'login' && (
              <button
                type="button"
                style={{ fontSize: 13, color: '#128C7E', fontWeight: 600 }}
                onClick={() => { setMode('forgot'); setError(''); setInfoMsg(''); }}
              >
                Password bhool gaye? Recover karo
              </button>
            )}
            {mode === 'forgot' && (
              <button
                type="button"
                style={{ fontSize: 13, color: '#128C7E', fontWeight: 600 }}
                onClick={() => { setMode('login'); setError(''); setInfoMsg(''); }}
              >
                ← Back to Login
              </button>
            )}
          </div>

          {/* Instant Demo Gang Switcher */}
          <div className="demo-switcher">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: '#111B21' }}>
              <Lock size={14} color="#128C7E" />
              Instant Demo Gang Login (password: <code>bsdk1234</code>)
            </div>
            <p style={{ fontSize: 11.5, color: '#667781', marginTop: 3 }}>
              2 alag tabs mein alag dost login karke live anonymous chat test karo!
            </p>
            <div className="demo-chip-list">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.user_id}
                  type="button"
                  className="demo-chip"
                  disabled={loading}
                  onClick={() => handleDemoLogin(acc.user_id)}
                >
                  {acc.label}
                </button>
              ))}
            </div>
          </div>

          {/* Backend Server URL config */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #E9EDEF' }}>
            <button
              type="button"
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#667781' }}
              onClick={() => setShowServerBox((v) => !v)}
            >
              <Server size={14} color="#128C7E" />
              Backend Server URL {isNativeApp() ? '(Android APK)' : '(Optional)'}
            </button>

            {showServerBox && (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    className="text-input"
                    style={{ padding: '8px 10px', fontSize: 12.5 }}
                    placeholder="http://10.103.158.228:4000 or https://..."
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ padding: '8px 14px', fontSize: 12.5 }}
                    onClick={() => {
                      setServerBaseUrl(serverUrl);
                      setServerSaved(true);
                      setTimeout(() => setServerSaved(false), 1800);
                    }}
                  >
                    {serverSaved ? <Check size={14} /> : 'Save'}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: '#667781', marginTop: 4 }}>
                  Phone APK ke liye apne PC ka IP (<code>http://10.103.158.228:4000</code>) ya deployed backend URL daalo. Emulator ke liye: <code>http://10.0.2.2:4000</code>.
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
