import React, { useState } from 'react';
import {
  X, Phone, Search, UserCheck, UserPlus, Share2, Copy, Check, MessageSquare, ExternalLink, ShieldCheck
} from 'lucide-react';
import {
  normalizePhoneE164,
  formatPhoneDisplay,
  hashPhoneNumber,
  lookupHashes,
  startDirectChatWithContact,
  generateInviteLink
} from '../services/contactsService.js';

const POPULAR_COUNTRIES = [
  { code: '+91', name: 'India', flag: '🇮🇳' },
  { code: '+1', name: 'United States', flag: '🇺🇸' },
  { code: '+44', name: 'United Kingdom', flag: '🇬🇧' },
  { code: '+971', name: 'United Arab Emirates', flag: '🇦🇪' },
  { code: '+61', name: 'Australia', flag: '🇦🇺' },
  { code: '+65', name: 'Singapore', flag: '🇸🇬' },
  { code: '+49', name: 'Germany', flag: '🇩🇪' },
  { code: '+33', name: 'France', flag: '🇫🇷' },
  { code: '+81', name: 'Japan', flag: '🇯🇵' },
  { code: '+966', name: 'Saudi Arabia', flag: '🇸🇦' },
  { code: '+92', name: 'Pakistan', flag: '🇵🇰' },
  { code: '+880', name: 'Bangladesh', flag: '🇧🇩' },
  { code: '+977', name: 'Nepal', flag: '🇳🇵' }
];

/**
 * WhatsApp-style Manual Phone Number entry and lookup modal.
 * Hashes phone with SHA-256 for privacy before querying the server.
 * If user is registered -> displays profile card with "Start Chat" button.
 * If user is not registered -> displays Invite screen with WhatsApp/SMS options.
 */
export function ManualNumberModal({ isOpen, onClose, onOpenChatWithUser, token }) {
  const [countryCode, setCountryCode] = useState('+91');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResult, setSearchResult] = useState(null); // { isRegistered, user, normalizedPhone }
  const [errorMessage, setErrorMessage] = useState('');
  const [copiedInvite, setCopiedInvite] = useState(false);

  if (!isOpen) return null;

  const handleLookup = async (e) => {
    if (e) e.preventDefault();
    setErrorMessage('');
    setSearchResult(null);

    const norm = normalizePhoneE164(phoneNumber, countryCode);
    if (!norm) {
      setErrorMessage('Please enter a valid phone number.');
      return;
    }

    setIsSearching(true);
    try {
      // Privacy-preserving hash
      const hash = await hashPhoneNumber(norm);
      const resultMap = await lookupHashes([hash], token);

      if (resultMap.has(hash)) {
        const user = resultMap.get(hash);
        setSearchResult({
          isRegistered: true,
          normalizedPhone: norm,
          user
        });
      } else {
        setSearchResult({
          isRegistered: false,
          normalizedPhone: norm
        });
      }
    } catch (err) {
      setErrorMessage(err.message || 'Lookup failed. Please check network.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleStartChat = async (user) => {
    try {
      setIsSearching(true);
      const res = await startDirectChatWithContact(user.id, token);
      if (res?.club && onOpenChatWithUser) {
        onOpenChatWithUser(res.club);
        onClose();
      }
    } catch (err) {
      setErrorMessage(err.message || 'Could not start conversation.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleCopyInvite = (normPhone) => {
    const invite = generateInviteLink();
    navigator.clipboard?.writeText?.(invite.copyText);
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 2400);
  };

  return (
    <div className="modal-backdrop" style={{ zIndex: 120 }}>
      <div
        className="modal-card"
        style={{
          maxWidth: '430px',
          width: '95%',
          padding: '20px',
          borderRadius: '20px'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '50%',
                backgroundColor: 'rgba(18, 140, 126, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#128C7E'
              }}
            >
              <Phone size={19} />
            </div>
            <div>
              <h3 style={{ fontSize: '17px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                Message a number
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                Lookup any number privately via SHA-256
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              padding: '4px'
            }}
          >
            <X size={22} />
          </button>
        </div>

        {/* Input Form */}
        <form onSubmit={handleLookup} style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
            Phone Number
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            {/* Country Picker Dropdown */}
            <select
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              style={{
                padding: '11px 10px',
                borderRadius: '10px',
                border: '1px solid var(--border-strong)',
                background: 'var(--surface)',
                color: 'var(--text-primary)',
                fontSize: '14px',
                fontWeight: 600,
                outline: 'none',
                maxWidth: '125px'
              }}
            >
              {POPULAR_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.code}
                </option>
              ))}
            </select>

            {/* Number Input */}
            <input
              type="tel"
              placeholder="e.g. 98765 43210"
              value={phoneNumber}
              onChange={(e) => {
                setPhoneNumber(e.target.value);
                setSearchResult(null);
                setErrorMessage('');
              }}
              autoFocus
              style={{
                flex: 1,
                padding: '11px 14px',
                borderRadius: '10px',
                border: '1px solid var(--border-strong)',
                background: 'var(--surface)',
                color: 'var(--text-primary)',
                fontSize: '15px',
                outline: 'none'
              }}
            />
          </div>

          {errorMessage && (
            <div style={{ marginTop: '8px', fontSize: '13px', color: '#dc2626', fontWeight: 500 }}>
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={!phoneNumber.trim() || isSearching}
            style={{
              width: '100%',
              marginTop: '14px',
              padding: '12px',
              borderRadius: '12px',
              border: 'none',
              backgroundColor: !phoneNumber.trim() || isSearching ? 'var(--border-strong)' : '#128C7E',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '14.5px',
              cursor: !phoneNumber.trim() || isSearching ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
          >
            {isSearching ? (
              <span>Searching securely...</span>
            ) : (
              <>
                <Search size={17} /> Search on BSDK Clubs
              </>
            )}
          </button>
        </form>

        {/* Result Area */}
        {searchResult && (
          <div
            style={{
              borderTop: '1px solid var(--border)',
              paddingTop: '16px',
              animation: 'fadeIn 0.2s ease'
            }}
          >
            {searchResult.isRegistered ? (
              /* Registered User Found Card */
              <div
                style={{
                  backgroundColor: 'var(--bg-panel-alt, rgba(18, 140, 126, 0.05))',
                  borderRadius: '14px',
                  padding: '14px',
                  border: '1px solid rgba(18, 140, 126, 0.2)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                  <img
                    src={searchResult.user.profile_photo_url}
                    alt={searchResult.user.real_name}
                    style={{
                      width: '50px',
                      height: '50px',
                      borderRadius: '50%',
                      objectFit: 'cover',
                      border: '2px solid #128C7E'
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontWeight: 700, fontSize: '16px', color: 'var(--text-primary)' }}>
                        {searchResult.user.real_name}
                      </span>
                      <UserCheck size={16} color="#128C7E" />
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                      {formatPhoneDisplay(searchResult.normalizedPhone)}
                    </div>
                    {searchResult.user.about && (
                      <div
                        style={{
                          fontSize: '12px',
                          color: 'var(--text-secondary)',
                          marginTop: '2px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        "{searchResult.user.about}"
                      </div>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleStartChat(searchResult.user)}
                  disabled={isSearching}
                  style={{
                    width: '100%',
                    padding: '11px',
                    borderRadius: '10px',
                    border: 'none',
                    backgroundColor: '#128C7E',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '14px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                  }}
                >
                  <MessageSquare size={17} /> Chat with {searchResult.user.real_name.split(' ')[0]}
                </button>
              </div>
            ) : (
              /* Unregistered User / Invite Card */
              <div
                style={{
                  backgroundColor: 'var(--bg-panel-alt, rgba(0,0,0,0.03))',
                  borderRadius: '14px',
                  padding: '16px',
                  textAlign: 'center',
                  border: '1px solid var(--border)'
                }}
              >
                <div
                  style={{
                    width: '46px',
                    height: '46px',
                    borderRadius: '50%',
                    backgroundColor: 'rgba(0, 0, 0, 0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 10px',
                    color: 'var(--text-secondary)'
                  }}
                >
                  <UserPlus size={22} />
                </div>
                <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)', marginBottom: '4px' }}>
                  Not on BSDK Clubs yet
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
                  {formatPhoneDisplay(searchResult.normalizedPhone)} hasn't signed up yet. Invite them to start chatting!
                </div>

                <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                  <a
                    href={generateInviteLink().smsUrl}
                    style={{
                      flex: 1,
                      padding: '9px 12px',
                      borderRadius: '10px',
                      backgroundColor: '#128C7E',
                      color: '#ffffff',
                      textDecoration: 'none',
                      fontWeight: 700,
                      fontSize: '13px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px'
                    }}
                  >
                    <Share2 size={15} /> Invite via SMS
                  </a>
                  <button
                    type="button"
                    onClick={() => handleCopyInvite(searchResult.normalizedPhone)}
                    style={{
                      padding: '9px 14px',
                      borderRadius: '10px',
                      border: '1px solid var(--border-strong)',
                      backgroundColor: 'var(--surface)',
                      color: 'var(--text-primary)',
                      fontWeight: 600,
                      fontSize: '13px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    {copiedInvite ? <Check size={15} color="#128C7E" /> : <Copy size={15} />}
                    {copiedInvite ? 'Copied!' : 'Copy Link'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Privacy Note */}
        <div
          style={{
            marginTop: '16px',
            fontSize: '11.5px',
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px'
          }}
        >
          <ShieldCheck size={14} color="#128C7E" /> Hashed using SHA-256 before searching.
        </div>
      </div>
    </div>
  );
}
