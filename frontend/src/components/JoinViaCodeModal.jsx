import React, { useState, useEffect } from 'react';
import {
  X, KeyRound, Users, UserPlus, Sparkles, Clock, ShieldAlert,
  Check, ArrowRight, ClipboardPaste, Loader2, AlertCircle
} from 'lucide-react';
import {
  formatInviteCodeInput,
  isValidInviteCode,
  isCodeRevoked,
  resolveInviteCode
} from '../services/inviteService.js';
import { apiRequest } from '../api.js';

export function JoinViaCodeModal({
  initialCode = '',
  onClose,
  onJoinedClub,
  onConnectedGang,
  onToast
}) {
  const [code, setCode] = useState(() => formatInviteCodeInput(initialCode));
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [joining, setJoining] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialCode) {
      const clean = formatInviteCodeInput(initialCode);
      setCode(clean);
      if (clean.length >= 5) {
        handlePreviewCode(clean);
      }
    }
  }, [initialCode]);

  async function handlePaste() {
    try {
      const text = await navigator.clipboard?.readText();
      if (text) {
        const clean = formatInviteCodeInput(text);
        setCode(clean);
        if (clean.length >= 5) {
          handlePreviewCode(clean);
        }
      }
    } catch {
      onToast?.('Clipboard permission not granted.');
    }
  }

  async function handlePreviewCode(codeToPreview) {
    const targetCode = formatInviteCodeInput(codeToPreview || code);
    if (!targetCode || targetCode.length < 5) {
      setError('Please enter a valid code (at least 5-8 characters).');
      return;
    }

    if (isCodeRevoked(targetCode)) {
      setError('This code has been revoked or reset by the owner.');
      setPreviewData(null);
      return;
    }

    setError('');
    setLoadingPreview(true);
    setPreviewData(null);

    try {
      const resolved = await resolveInviteCode(targetCode, apiRequest);
      setPreviewData(resolved);
    } catch (err) {
      setError(err.message || 'Invalid or expired invite code.');
      setPreviewData(null);
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleJoin() {
    if (!code) return;
    setJoining(true);
    setError('');

    try {
      // 1. If resolved as Club or bare code, call /clubs/join
      if (!previewData || previewData.type === 'club' || previewData.club) {
        const data = await apiRequest('/clubs/join', {
          method: 'POST',
          body: { invite_code: code }
        });
        onToast?.(`Joined club "${data.club.name}"!`);
        if (onJoinedClub) onJoinedClub(data.club);
        onClose();
        return;
      }

      // 2. If resolved as personal user invite
      if (previewData.type === 'user' || previewData.inviter) {
        onToast?.(`Connected with ${previewData.inviter?.real_name || 'Gang Member'}!`);
        if (onConnectedGang) onConnectedGang(previewData.inviter);
        onClose();
        return;
      }

      // Fallback
      const res = await apiRequest('/clubs/join', {
        method: 'POST',
        body: { invite_code: code }
      });
      onToast?.(`Joined club "${res.club.name}"!`);
      if (onJoinedClub) onJoinedClub(res.club);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to join with this code.');
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 1200 }}>
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 440,
          padding: 0,
          overflow: 'hidden',
          borderRadius: 16,
          boxShadow: '0 20px 40px rgba(0,0,0,0.32)'
        }}
      >
        {/* Header */}
        <div
          style={{
            background: '#075E54',
            color: '#ffffff',
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <KeyRound size={20} />
            <div style={{ fontSize: 17, fontWeight: 800 }}>Join via Code</div>
          </div>
          <button
            type="button"
            className="icon-btn"
            style={{ color: '#fff', background: 'rgba(255,255,255,0.15)', borderRadius: '50%' }}
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '20px 22px', maxHeight: '78vh', overflowY: 'auto' }}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.5 }}>
            Enter the 6-8 character gang or club code shared by your friend (e.g. <strong>GANG-4F8K</strong> or <strong>HOSTEL42</strong>).
          </p>

          {/* Large Code Input */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="text"
                className="text-input"
                placeholder="GANG-XXXX"
                value={code}
                maxLength={16}
                autoFocus
                onChange={(e) => {
                  const val = formatInviteCodeInput(e.target.value);
                  setCode(val);
                  setPreviewData(null);
                  setError('');
                  if (val.length >= 6) {
                    handlePreviewCode(val);
                  }
                }}
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  letterSpacing: '0.15em',
                  textAlign: 'center',
                  textTransform: 'uppercase',
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: '2px solid #128C7E',
                  background: 'var(--surface-active, #f8fafc)'
                }}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={handlePaste}
                title="Paste from clipboard"
                style={{ padding: '12px 14px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <ClipboardPaste size={18} /> Paste
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', marginTop: 6, padding: '0 4px' }}>
              <span>Auto-uppercase active</span>
              <span>{code.length} chars</span>
            </div>
          </div>

          {/* Loading Spinner */}
          {loadingPreview && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '16px 0', color: '#128C7E', fontSize: 13, fontWeight: 600 }}>
              <Loader2 size={18} className="animate-spin" /> Resolving invite code...
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div
              style={{
                background: 'rgba(220, 38, 38, 0.08)',
                border: '1px solid #f87171',
                borderRadius: 12,
                padding: '10px 14px',
                fontSize: 12.5,
                color: '#dc2626',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 16
              }}
            >
              <AlertCircle size={18} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {/* Club Preview Card */}
          {previewData && (previewData.type === 'club' || previewData.club) && (
            <div
              style={{
                background: 'var(--surface-active, #f8fafc)',
                border: '1px solid var(--border, #cbd5e1)',
                borderRadius: 14,
                padding: 16,
                marginBottom: 16
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <img
                  src={previewData.club?.photo_url || `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(previewData.club?.name || 'Club')}&backgroundColor=075e54`}
                  alt={previewData.club?.name || 'Club'}
                  style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', border: '2px solid #128C7E' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-primary)' }}>
                    {previewData.club?.name}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {previewData.club?.description || 'Private anonymous gang club'}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <span style={{ fontSize: 11.5, background: 'rgba(18,140,126,0.12)', color: '#075E54', padding: '3px 8px', borderRadius: 8, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Users size={12} /> {previewData.club?.member_count || 1} members
                </span>
                <span style={{ fontSize: 11.5, background: 'rgba(0,0,0,0.06)', color: 'var(--text-secondary)', padding: '3px 8px', borderRadius: 8, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={12} /> 7-day disappearing messages
                </span>
              </div>

              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                💡 <strong>Privacy First:</strong> Once joined, you'll be assigned a unique per-group alias. Nobody knows who you are in the chat!
              </div>
            </div>
          )}

          {/* User Preview Card */}
          {previewData && (previewData.type === 'user' || previewData.inviter) && (
            <div
              style={{
                background: 'var(--surface-active, #f8fafc)',
                border: '1px solid var(--border, #cbd5e1)',
                borderRadius: 14,
                padding: 16,
                marginBottom: 16
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <img
                  src={previewData.inviter?.profile_photo_url || `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(previewData.inviter?.real_name || 'Friend')}&backgroundColor=075e54`}
                  alt={previewData.inviter?.real_name || 'Inviter'}
                  style={{ width: 50, height: 50, borderRadius: '50%', objectFit: 'cover', border: '2px solid #128C7E' }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-primary)' }}>
                    {previewData.inviter?.real_name || 'Gang Friend'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    @{previewData.inviter?.user_id || 'bsdk_user'}
                  </div>
                </div>
              </div>

              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                {previewData.inviter?.about || 'Hey there! I am on BSDK Clubs'}
              </p>
            </div>
          )}

          {/* Action Button */}
          <button
            type="button"
            className="btn-primary"
            disabled={!code || code.length < 5 || loadingPreview || joining}
            onClick={() => {
              if (previewData) {
                handleJoin();
              } else {
                handlePreviewCode(code);
              }
            }}
            style={{
              width: '100%',
              padding: '12px 16px',
              fontSize: 15,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              borderRadius: 12
            }}
          >
            {joining ? (
              <>
                <Loader2 size={18} className="animate-spin" /> Joining...
              </>
            ) : previewData ? (
              <>
                Confirm & Join Now <ArrowRight size={18} />
              </>
            ) : (
              <>
                Preview Code <ArrowRight size={18} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
export default JoinViaCodeModal;
