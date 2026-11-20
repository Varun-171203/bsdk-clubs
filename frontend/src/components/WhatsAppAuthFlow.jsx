import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, Camera, Check, ChevronDown, Clock, Edit2, Globe, Key,
  Lock, Phone, RefreshCw, Search, Shield, ShieldAlert, ShieldCheck,
  Smile, User, X
} from 'lucide-react';
import { BrandLogo } from './BrandLogo.jsx';
import { apiRequest, setStoredAuth, isNativeApp, getServerBaseUrl, setServerBaseUrl } from '../api.js';

// Popular country codes list for WhatsApp-style country picker
const COUNTRY_CODES = [
  { name: 'India', code: '+91', flag: '🇮🇳', len: 10 },
  { name: 'United States', code: '+1', flag: '🇺🇸', len: 10 },
  { name: 'United Kingdom', code: '+44', flag: '🇬🇧', len: 10 },
  { name: 'Canada', code: '+1', flag: '🇨🇦', len: 10 },
  { name: 'United Arab Emirates', code: '+971', flag: '🇦🇪', len: 9 },
  { name: 'Australia', code: '+61', flag: '🇦🇺', len: 9 },
  { name: 'Germany', code: '+49', flag: '🇩🇪', len: 10 },
  { name: 'Singapore', code: '+65', flag: '🇸🇬', len: 8 },
  { name: 'Saudi Arabia', code: '+966', flag: '🇸🇦', len: 9 },
  { name: 'Nepal', code: '+977', flag: '🇳🇵', len: 10 },
  { name: 'Bangladesh', code: '+880', flag: '🇧🇩', len: 10 }
];

const PRESET_AVATARS = [
  'https://api.dicebear.com/9.x/avataaars/svg?seed=Piyush&backgroundColor=b6e3f4',
  'https://api.dicebear.com/9.x/avataaars/svg?seed=Rohan&backgroundColor=c0aede',
  'https://api.dicebear.com/9.x/avataaars/svg?seed=Ananya&backgroundColor=ffd5dc',
  'https://api.dicebear.com/9.x/avataaars/svg?seed=Kabir&backgroundColor=d1d4f9',
  'https://api.dicebear.com/9.x/avataaars/svg?seed=Meera&backgroundColor=ffdfbf'
];

export function WhatsAppAuthFlow({ onAuthenticated }) {
  // Steps: 'splash' | 'welcome' | 'phone' | 'otp' | 'profile' | 'two_step_setup' | 'two_step_unlock'
  const [step, setStep] = useState('splash');
  const [lang, setLang] = useState('en'); // 'en' | 'hi'

  // Phone input state
  const [selectedCountry, setSelectedCountry] = useState(COUNTRY_CODES[0]);
  const [showCountryModal, setShowCountryModal] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // OTP state
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [otpError, setOtpError] = useState('');
  const [resendTimer, setResendTimer] = useState(60);
  const [canResend, setCanResend] = useState(false);
  const [loading, setLoading] = useState(false);
  const [devOtp, setDevOtp] = useState('');
  const otpInputRefs = useRef([]);

  // Session / Pending auth state
  const [pendingAuth, setPendingAuth] = useState(null);

  // Profile setup state
  const [realName, setRealName] = useState('');
  const [about, setAbout] = useState('Hey there! I am on BSDK Clubs');
  const [profilePhoto, setProfilePhoto] = useState(PRESET_AVATARS[0]);
  const fileInputRef = useRef(null);

  // Two-step verification state
  const [twoStepPin, setTwoStepPin] = useState(['', '', '', '', '', '']);
  const [unlockPin, setUnlockPin] = useState(['', '', '', '', '', '']);
  const [pinError, setPinError] = useState('');
  const pinInputRefs = useRef([]);

  // Modals for Terms & Privacy Policy
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);

  // Server address config drawer (for Android APK connection)
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState(() => getServerBaseUrl() || 'https://bsdk-clubs.onrender.com');

  // Device ID for single primary device session enforcement
  const getDeviceId = () => {
    let id = localStorage.getItem('bsdk_device_id');
    if (!id) {
      id = 'dev_' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('bsdk_device_id', id);
    }
    return id;
  };

  // =========================================================================
  // STEP 1: SPLASH SCREEN (Auto-transitions like WhatsApp)
  // =========================================================================
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const stored = localStorage.getItem('bsdk_auth');
        if (stored) {
          const authData = JSON.parse(stored);
          if (authData?.access_token) {
            // Verify current session
            const res = await apiRequest('/me');
            if (res?.user) {
              onAuthenticated(authData);
              return;
            }
          }
        }
      } catch {
        // Token expired / invalid, proceed to Welcome
      }
      setStep('welcome');
    }, 1200);

    return () => clearTimeout(timer);
  }, []);

  // OTP Countdown timer
  useEffect(() => {
    let interval = null;
    if (step === 'otp' && resendTimer > 0) {
      interval = setInterval(() => {
        setResendTimer((prev) => {
          if (prev <= 1) {
            setCanResend(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [step, resendTimer]);

  // =========================================================================
  // HANDLERS: PHONE NUMBER & OTP
  // =========================================================================
  function handlePhoneChange(e) {
    const val = e.target.value.replace(/[^0-9]/g, '');
    if (val.length <= 15) {
      setPhoneNumber(val);
      setPhoneError('');
    }
  }

  function handlePhoneNext() {
    const clean = phoneNumber.trim();
    if (selectedCountry.code === '+91') {
      if (clean.length !== 10 || !/^[6-9]\d{9}$/.test(clean)) {
        setPhoneError('Please enter a valid 10-digit Indian phone number.');
        return;
      }
    } else {
      if (clean.length < 6) {
        setPhoneError('Please enter a valid phone number.');
        return;
      }
    }
    setPhoneError('');
    setShowConfirmModal(true);
  }

  async function handleConfirmSendOtp() {
    setShowConfirmModal(false);
    setLoading(true);
    setOtpError('');
    setOtpDigits(['', '', '', '', '', '']);
    setResendTimer(60);
    setCanResend(false);

    try {
      const data = await apiRequest('/auth/request-otp', {
        method: 'POST',
        authRequired: false,
        body: {
          country_code: selectedCountry.code,
          phone: phoneNumber.trim()
        }
      });
      if (data.dev_otp) {
        setDevOtp(data.dev_otp);
      }
      setStep('otp');
    } catch (err) {
      setPhoneError(err.message || 'Could not send verification code.');
    } finally {
      setLoading(false);
    }
  }

  // Handle 6-Box OTP Input with Auto-focus & Paste
  function handleOtpDigitChange(index, val) {
    const clean = val.replace(/[^0-9]/g, '');
    if (!clean) {
      const next = [...otpDigits];
      next[index] = '';
      setOtpDigits(next);
      return;
    }

    // Handle full paste (e.g. 6 digits pasted at once)
    if (clean.length >= 6) {
      const parts = clean.slice(0, 6).split('');
      setOtpDigits(parts);
      verifyOtpCode(clean.slice(0, 6));
      return;
    }

    const next = [...otpDigits];
    next[index] = clean.slice(-1);
    setOtpDigits(next);

    // Auto-advance to next box
    if (index < 5 && clean) {
      otpInputRefs.current[index + 1]?.focus();
    }

    // If 6th digit entered, auto-verify!
    const fullCode = next.join('');
    if (fullCode.length === 6 && !next.includes('')) {
      verifyOtpCode(fullCode);
    }
  }

  function handleOtpKeyDown(index, e) {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  }

  async function verifyOtpCode(codeToVerify) {
    const code = codeToVerify || otpDigits.join('');
    if (code.length !== 6) return;
    setLoading(true);
    setOtpError('');

    try {
      const data = await apiRequest('/auth/verify-otp', {
        method: 'POST',
        authRequired: false,
        body: {
          country_code: selectedCountry.code,
          phone: phoneNumber.trim(),
          otp: code,
          device_id: getDeviceId()
        }
      });

      // If user has Two-Step PIN enabled, prompt for PIN
      if (data.requires_two_step) {
        setPendingAuth(data);
        setStep('two_step_unlock');
        return;
      }

      setPendingAuth(data);

      if (data.is_new_user) {
        setStep('profile');
      } else {
        // Existing user: persist auth and go straight Home!
        setStoredAuth(data);
        onAuthenticated(data);
      }
    } catch (err) {
      setOtpError(err.message || 'Wrong code. Please check and try again.');
    } finally {
      setLoading(false);
    }
  }

  // Auto-fill Simulated Dev OTP
  function handleAutoFillDevOtp() {
    if (!devOtp) return;
    const parts = devOtp.split('');
    setOtpDigits(parts);
    verifyOtpCode(devOtp);
  }

  // =========================================================================
  // HANDLERS: PROFILE SETUP
  // =========================================================================
  function handleGalleryUpload(e) {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => setProfilePhoto(reader.result);
      reader.readAsDataURL(file);
    }
  }

  async function handleProfileSubmit(e) {
    e.preventDefault();
    const cleanName = realName.trim();
    if (!cleanName || cleanName.length < 2) {
      alert('Please enter your name (at least 2 characters).');
      return;
    }

    setLoading(true);
    try {
      const updated = await apiRequest('/auth/profile', {
        method: 'POST',
        body: {
          real_name: cleanName,
          about: about.trim() || 'Hey there! I am on BSDK Clubs',
          profile_photo_url: profilePhoto
        }
      });

      const fullAuth = {
        ...pendingAuth,
        user: updated.user
      };
      setPendingAuth(fullAuth);

      // Offer Optional Two-Step Verification
      setStep('two_step_setup');
    } catch (err) {
      alert(err.message || 'Could not save profile.');
    } finally {
      setLoading(false);
    }
  }

  // =========================================================================
  // HANDLERS: TWO-STEP PIN SETUP & UNLOCK
  // =========================================================================
  async function handleSetupTwoStep(skip = false) {
    if (skip) {
      setStoredAuth(pendingAuth);
      onAuthenticated(pendingAuth);
      return;
    }

    const pin = twoStepPin.join('');
    if (pin.length !== 6) {
      setPinError('PIN must be 6 digits.');
      return;
    }

    setLoading(true);
    setPinError('');
    try {
      await apiRequest('/auth/two-step/setup', {
        method: 'POST',
        body: { pin }
      });
      setStoredAuth(pendingAuth);
      onAuthenticated(pendingAuth);
    } catch (err) {
      setPinError(err.message || 'Failed to setup PIN.');
    } finally {
      setLoading(false);
    }
  }

  async function handleUnlockPin() {
    const pin = unlockPin.join('');
    if (pin.length !== 6) return;
    setLoading(true);
    setPinError('');

    try {
      const data = await apiRequest('/auth/two-step/verify', {
        method: 'POST',
        authRequired: false,
        body: {
          phone: phoneNumber.trim(),
          pin,
          device_id: getDeviceId()
        }
      });
      setStoredAuth(data);
      onAuthenticated(data);
    } catch (err) {
      setPinError(err.message || 'Incorrect PIN.');
    } finally {
      setLoading(false);
    }
  }

  // Filtered country list
  const filteredCountries = COUNTRY_CODES.filter((c) =>
    c.name.toLowerCase().includes(countrySearch.toLowerCase()) || c.code.includes(countrySearch)
  );

  return (
    <div className="wa-app-container">
      {/* ================================================================= */}
      {/* 1. SPLASH SCREEN                                                  */}
      {/* ================================================================= */}
      {step === 'splash' && (
        <div className="wa-screen wa-splash-screen">
          <div className="wa-splash-center">
            <BrandLogo size={74} />
            <h1 className="wa-splash-title">BSDK Clubs</h1>
          </div>
          <div className="wa-splash-footer">
            <span className="wa-splash-from">from</span>
            <span className="wa-splash-brand">BSDK CLUBS</span>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 2. WELCOME SCREEN                                                 */}
      {/* ================================================================= */}
      {step === 'welcome' && (
        <div className="wa-screen wa-welcome-screen">
          <div className="wa-welcome-top">
            <button
              type="button"
              className="wa-lang-pill"
              onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}
            >
              <Globe size={15} />
              <span>{lang === 'en' ? 'English' : 'हिन्दी'}</span>
              <ChevronDown size={14} />
            </button>
          </div>

          <div className="wa-welcome-center">
            <h1 className="wa-welcome-title">
              {lang === 'en' ? 'Welcome to BSDK Clubs' : 'BSDK Clubs में आपका स्वागत है'}
            </h1>

            <div className="wa-welcome-art">
              <div className="wa-art-circle">
                <BrandLogo size={88} />
              </div>
            </div>

            <p className="wa-welcome-tagline">"Your Gang. Your Bang."</p>

            <p className="wa-terms-text">
              {lang === 'en' ? (
                <>
                  Read our{' '}
                  <button type="button" className="wa-link-btn" onClick={() => setShowPrivacyModal(true)}>
                    Privacy Policy
                  </button>
                  . Tap "Agree and continue" to accept the{' '}
                  <button type="button" className="wa-link-btn" onClick={() => setShowTermsModal(true)}>
                    Terms of Service
                  </button>
                  .
                </>
              ) : (
                <>
                  हमारी{' '}
                  <button type="button" className="wa-link-btn" onClick={() => setShowPrivacyModal(true)}>
                    Privacy Policy
                  </button>{' '}
                  पढ़ें। नियम स्वीकार करने के लिए "AGREE AND CONTINUE" दबाएँ।
                </>
              )}
            </p>
          </div>

          <div className="wa-welcome-bottom">
            <button
              type="button"
              className="wa-btn-primary wa-btn-block"
              onClick={() => setStep('phone')}
            >
              {lang === 'en' ? 'AGREE AND CONTINUE' : 'स्वीकार करें और आगे बढ़ें'}
            </button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 3. PHONE NUMBER SCREEN                                            */}
      {/* ================================================================= */}
      {step === 'phone' && (
        <div className="wa-screen wa-phone-screen">
          <div className="wa-screen-header">
            <h2 className="wa-header-title">Enter your phone number</h2>
            <button
              type="button"
              className="wa-icon-action"
              title="Server connection"
              onClick={() => setShowServerConfig(true)}
            >
              <Globe size={18} />
            </button>
          </div>

          <div className="wa-screen-body">
            <p className="wa-body-subtext">
              BSDK Clubs will need to verify your phone number. Carrier SMS charges may apply.
            </p>

            {/* Country Selector Dropdown */}
            <div className="wa-country-picker-row" onClick={() => setShowCountryModal(true)}>
              <span className="wa-country-name">
                {selectedCountry.flag} {selectedCountry.name}
              </span>
              <ChevronDown size={16} color="#075E54" />
            </div>

            {/* Phone Input Box */}
            <div className="wa-phone-inputs-row">
              <div className="wa-code-box">{selectedCountry.code}</div>
              <input
                type="tel"
                className="wa-phone-input"
                placeholder="Phone number"
                autoFocus
                value={phoneNumber}
                onChange={handlePhoneChange}
                onKeyDown={(e) => e.key === 'Enter' && handlePhoneNext()}
              />
            </div>

            {phoneError && <div className="wa-error-text">{phoneError}</div>}
          </div>

          <div className="wa-screen-footer">
            <button
              type="button"
              className="wa-btn-primary"
              disabled={loading || !phoneNumber}
              onClick={handlePhoneNext}
            >
              {loading ? 'Please wait...' : 'NEXT'}
            </button>
          </div>

          {/* WhatsApp-Exact Number Confirmation Dialog */}
          {showConfirmModal && (
            <div className="wa-modal-backdrop">
              <div className="wa-confirm-dialog">
                <p className="wa-dialog-lead">You entered the phone number:</p>
                <p className="wa-dialog-number">
                  {selectedCountry.code} {phoneNumber}
                </p>
                <p className="wa-dialog-prompt">Is this OK, or would you like to edit the number?</p>
                <div className="wa-dialog-actions">
                  <button
                    type="button"
                    className="wa-dialog-btn"
                    onClick={() => setShowConfirmModal(false)}
                  >
                    EDIT
                  </button>
                  <button
                    type="button"
                    className="wa-dialog-btn wa-dialog-btn-primary"
                    onClick={handleConfirmSendOtp}
                  >
                    OK
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* 4. OTP VERIFICATION SCREEN (6-Box with 60s Resend Timer)         */}
      {/* ================================================================= */}
      {step === 'otp' && (
        <div className="wa-screen wa-otp-screen">
          <div className="wa-screen-header">
            <button type="button" className="wa-back-btn" onClick={() => setStep('phone')}>
              <ArrowLeft size={20} />
            </button>
            <h2 className="wa-header-title">Verifying your number</h2>
          </div>

          <div className="wa-screen-body">
            <p className="wa-body-subtext">
              Waiting to automatically detect an SMS sent to{' '}
              <strong>
                {selectedCountry.code} {phoneNumber}
              </strong>
              .{' '}
              <button type="button" className="wa-link-btn" onClick={() => setStep('phone')}>
                Wrong number?
              </button>
            </p>

            {/* Simulated SMS Auto-Read Chip for Free Dev / Local Testing */}
            {devOtp && (
              <div className="wa-dev-sms-banner" onClick={handleAutoFillDevOtp}>
                <div className="wa-dev-sms-title">
                  <Clock size={14} /> Android SMS Auto-Detected:
                </div>
                <div className="wa-dev-sms-code">
                  Code: <strong>{devOtp}</strong> (Tap to Auto-fill)
                </div>
              </div>
            )}

            {/* 6 Individual OTP Boxes */}
            <div className="wa-otp-boxes-grid">
              {otpDigits.map((digit, idx) => (
                <input
                  key={idx}
                  ref={(el) => (otpInputRefs.current[idx] = el)}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  className={`wa-otp-box ${digit ? 'filled' : ''} ${otpError ? 'error' : ''}`}
                  value={digit}
                  autoFocus={idx === 0}
                  onChange={(e) => handleOtpDigitChange(idx, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                />
              ))}
            </div>

            {otpError && <div className="wa-error-text wa-text-center">{otpError}</div>}

            <p className="wa-otp-hint">Enter 6-digit code</p>

            {/* 60-Second Resend Countdown */}
            <div className="wa-resend-section">
              <button
                type="button"
                className="wa-resend-row"
                disabled={!canResend || loading}
                onClick={handleConfirmSendOtp}
              >
                <RefreshCw size={17} />
                <span>Resend SMS</span>
                {!canResend && <span className="wa-timer-label">in 0:{resendTimer < 10 ? `0${resendTimer}` : resendTimer}</span>}
              </button>

              <button
                type="button"
                className="wa-resend-row"
                disabled={!canResend || loading}
                onClick={() => alert('Call verification simulated: Your verification code is ' + devOtp)}
              >
                <Phone size={17} />
                <span>Call me</span>
                {!canResend && <span className="wa-timer-label">in 0:{resendTimer < 10 ? `0${resendTimer}` : resendTimer}</span>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 5. PROFILE SETUP SCREEN (Real Name + Photo for Group Info only)    */}
      {/* ================================================================= */}
      {step === 'profile' && (
        <div className="wa-screen wa-profile-screen">
          <div className="wa-screen-header">
            <h2 className="wa-header-title">Profile info</h2>
          </div>

          <form className="wa-screen-body" onSubmit={handleProfileSubmit}>
            <p className="wa-body-subtext">Please provide your name and an optional profile photo.</p>

            {/* Photo Avatar Picker (Supports Camera or Gallery) */}
            <div className="wa-avatar-picker-wrap">
              <div
                className="wa-avatar-circle"
                onClick={() => fileInputRef.current?.click()}
                title="Change photo"
              >
                <img src={profilePhoto} alt="Profile" className="wa-avatar-img" />
                <div className="wa-camera-badge">
                  <Camera size={18} color="#FFFFFF" />
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleGalleryUpload}
              />
            </div>

            {/* Preset Avatars Selection */}
            <div className="wa-presets-row">
              {PRESET_AVATARS.map((url, i) => (
                <button
                  key={i}
                  type="button"
                  className={`wa-preset-btn ${profilePhoto === url ? 'active' : ''}`}
                  onClick={() => setProfilePhoto(url)}
                >
                  <img src={url} alt="Preset" />
                </button>
              ))}
            </div>

            {/* Real Name Input with Emoji and Counter */}
            <div className="wa-input-group">
              <div className="wa-name-field-wrap">
                <input
                  type="text"
                  className="wa-name-input"
                  placeholder="Type your name here"
                  maxLength={25}
                  value={realName}
                  autoFocus
                  onChange={(e) => setRealName(e.target.value)}
                  required
                />
                <span className="wa-field-count">{25 - realName.length}</span>
                <Smile size={20} color="#8696A0" />
              </div>
            </div>

            {/* About field */}
            <div className="wa-input-group" style={{ marginTop: 12 }}>
              <label className="wa-field-label">About</label>
              <input
                type="text"
                className="wa-about-input"
                maxLength={60}
                value={about}
                onChange={(e) => setAbout(e.target.value)}
              />
            </div>

            {/* CRITICAL BSDK Clubs Anonymity Trust Notice */}
            <div className="wa-anonymity-notice">
              <ShieldCheck size={20} color="#128C7E" style={{ flexShrink: 0, marginTop: 2 }} />
              <div className="wa-notice-text">
                <strong>Private Identity:</strong> This real name and photo are visible{' '}
                <strong>ONLY in Group Info</strong> so your friends can trust the group. Inside group chats,
                you always chat anonymously under a separate per-group alias!
              </div>
            </div>

            <div className="wa-screen-footer" style={{ marginTop: 'auto' }}>
              <button
                type="submit"
                className="wa-btn-primary"
                disabled={loading || !realName.trim()}
              >
                {loading ? 'Saving...' : 'NEXT'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ================================================================= */}
      {/* 6. TWO-STEP VERIFICATION SETUP SCREEN (Optional)                 */}
      {/* ================================================================= */}
      {step === 'two_step_setup' && (
        <div className="wa-screen wa-two-step-screen">
          <div className="wa-screen-header">
            <h2 className="wa-header-title">Two-step verification</h2>
          </div>

          <div className="wa-screen-body">
            <div className="wa-shield-hero">
              <Shield size={56} color="#128C7E" />
            </div>

            <p className="wa-body-subtext wa-text-center">
              For added security, enable two-step verification, which will require a 6-digit PIN when
              registering your phone number with BSDK Clubs again.
            </p>

            <div className="wa-pin-boxes-grid">
              {twoStepPin.map((digit, idx) => (
                <input
                  key={idx}
                  ref={(el) => (pinInputRefs.current[idx] = el)}
                  type="password"
                  inputMode="numeric"
                  maxLength={1}
                  className="wa-pin-box"
                  value={digit}
                  autoFocus={idx === 0}
                  onChange={(e) => {
                    const clean = e.target.value.replace(/[^0-9]/g, '');
                    const next = [...twoStepPin];
                    next[idx] = clean.slice(-1);
                    setTwoStepPin(next);
                    if (clean && idx < 5) pinInputRefs.current[idx + 1]?.focus();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' && !twoStepPin[idx] && idx > 0) {
                      pinInputRefs.current[idx - 1]?.focus();
                    }
                  }}
                />
              ))}
            </div>

            {pinError && <div className="wa-error-text wa-text-center">{pinError}</div>}
          </div>

          <div className="wa-two-step-actions">
            <button
              type="button"
              className="wa-btn-secondary"
              onClick={() => handleSetupTwoStep(true)}
            >
              SKIP
            </button>
            <button
              type="button"
              className="wa-btn-primary"
              disabled={loading || twoStepPin.join('').length !== 6}
              onClick={() => handleSetupTwoStep(false)}
            >
              {loading ? 'Enabling...' : 'ENABLE'}
            </button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 7. TWO-STEP UNLOCK SCREEN (For returning users with PIN enabled) */}
      {/* ================================================================= */}
      {step === 'two_step_unlock' && (
        <div className="wa-screen wa-two-step-screen">
          <div className="wa-screen-header">
            <h2 className="wa-header-title">Enter your PIN</h2>
          </div>

          <div className="wa-screen-body">
            <div className="wa-shield-hero">
              <Key size={48} color="#128C7E" />
            </div>

            <p className="wa-body-subtext wa-text-center">
              Enter your 6-digit two-step verification PIN for{' '}
              <strong>{selectedCountry.code} {phoneNumber}</strong>.
            </p>

            <div className="wa-pin-boxes-grid">
              {unlockPin.map((digit, idx) => (
                <input
                  key={idx}
                  ref={(el) => (pinInputRefs.current[idx] = el)}
                  type="password"
                  inputMode="numeric"
                  maxLength={1}
                  className="wa-pin-box"
                  value={digit}
                  autoFocus={idx === 0}
                  onChange={(e) => {
                    const clean = e.target.value.replace(/[^0-9]/g, '');
                    const next = [...unlockPin];
                    next[idx] = clean.slice(-1);
                    setUnlockPin(next);
                    if (clean && idx < 5) pinInputRefs.current[idx + 1]?.focus();
                    if (next.join('').length === 6 && !next.includes('')) {
                      handleUnlockPin();
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' && !unlockPin[idx] && idx > 0) {
                      pinInputRefs.current[idx - 1]?.focus();
                    }
                  }}
                />
              ))}
            </div>

            {pinError && <div className="wa-error-text wa-text-center">{pinError}</div>}

            <div style={{ textAlign: 'center', marginTop: 18 }}>
              <button
                type="button"
                className="wa-link-btn"
                onClick={() => {
                  alert('Verification OTP resent to your registered number to reset PIN.');
                  setStep('otp');
                }}
              >
                Forgot PIN?
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* COUNTRY SEARCH MODAL                                              */}
      {/* ================================================================= */}
      {showCountryModal && (
        <div className="wa-modal-backdrop">
          <div className="wa-country-modal">
            <div className="wa-country-modal-header">
              <button
                type="button"
                className="wa-back-btn"
                onClick={() => setShowCountryModal(false)}
              >
                <ArrowLeft size={20} />
              </button>
              <div className="wa-country-search-box">
                <Search size={18} color="#8696A0" />
                <input
                  type="text"
                  placeholder="Search country"
                  autoFocus
                  value={countrySearch}
                  onChange={(e) => setCountrySearch(e.target.value)}
                />
              </div>
            </div>

            <div className="wa-country-list">
              {filteredCountries.map((c) => (
                <div
                  key={c.name}
                  className="wa-country-item"
                  onClick={() => {
                    setSelectedCountry(c);
                    setShowCountryModal(false);
                    setCountrySearch('');
                  }}
                >
                  <span className="wa-country-flag">{c.flag}</span>
                  <span className="wa-country-item-name">{c.name}</span>
                  <span className="wa-country-item-code">{c.code}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* SERVER CONFIG DRAWER (For APK Connection to PC IP)                */}
      {/* ================================================================= */}
      {showServerConfig && (
        <div className="wa-modal-backdrop" onClick={() => setShowServerConfig(false)}>
          <div className="wa-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: '#075E54' }}>
              Backend Server URL
            </h3>
            <p style={{ fontSize: 12.5, color: '#667781', marginBottom: 10 }}>
              Live cloud backend ya local PC server ka URL set karein:
            </p>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="wa-chip-btn active"
                style={{ fontSize: 11.5, padding: '4px 8px' }}
                onClick={() => setServerUrlInput('https://bsdk-clubs.onrender.com')}
              >
                ☁️ Render Cloud (Live)
              </button>
              <button
                type="button"
                className="wa-chip-btn"
                style={{ fontSize: 11.5, padding: '4px 8px' }}
                onClick={() => setServerUrlInput('http://10.236.42.228:4000')}
              >
                🏠 Local PC Wi-Fi
              </button>
            </div>
            <input
              type="text"
              className="wa-phone-input"
              style={{ width: '100%', marginBottom: 14 }}
              value={serverUrlInput}
              onChange={(e) => setServerUrlInput(e.target.value)}
            />
            <div className="wa-dialog-actions">
              <button
                type="button"
                className="wa-dialog-btn"
                onClick={() => setShowServerConfig(false)}
              >
                CANCEL
              </button>
              <button
                type="button"
                className="wa-dialog-btn wa-dialog-btn-primary"
                onClick={() => {
                  setServerBaseUrl(serverUrlInput);
                  setShowServerConfig(false);
                  alert('Server URL saved: ' + serverUrlInput);
                }}
              >
                SAVE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Terms & Privacy Modals */}
      {showPrivacyModal && (
        <div className="wa-modal-backdrop" onClick={() => setShowPrivacyModal(false)}>
          <div className="wa-confirm-dialog wa-legal-dialog" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontWeight: 700, color: '#075E54' }}>Privacy Policy</h3>
              <button type="button" className="wa-icon-action" onClick={() => setShowPrivacyModal(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="wa-legal-content">
              <p><strong>1. Real Identity:</strong> Your phone number and real profile name are used only for trust inside Group Info lists.</p>
              <p><strong>2. Anonymity:</strong> Inside all group chats, you appear under a separate temporary alias that is different in every group.</p>
              <p><strong>3. Disappearing:</strong> Messages automatically delete based on club settings (24 hours or 7 days default).</p>
            </div>
          </div>
        </div>
      )}

      {showTermsModal && (
        <div className="wa-modal-backdrop" onClick={() => setShowTermsModal(false)}>
          <div className="wa-confirm-dialog wa-legal-dialog" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontWeight: 700, color: '#075E54' }}>Terms of Service</h3>
              <button type="button" className="wa-icon-action" onClick={() => setShowTermsModal(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="wa-legal-content">
              <p><strong>1. Eligibility:</strong> You must be at least 18 years old or legal age in your jurisdiction.</p>
              <p><strong>2. Respectful Use:</strong> Anonymity is for fun, not harassment. Spam, hate speech, and illegal content are strictly prohibited.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
