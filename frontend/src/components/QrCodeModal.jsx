import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  X, QrCode, Scan, Share2, Copy, Check, RotateCcw, Camera, Upload,
  ShieldAlert, UserCheck, Users, Sparkles, AlertTriangle, ArrowRight
} from 'lucide-react';
import {
  generateQrPayload,
  parseQrPayload,
  getUserInviteCode,
  resetUserInviteCode,
  isCodeRevoked,
  shareInviteLink,
  copyInviteLink,
  generateInviteLink,
  resolveInviteCode
} from '../services/inviteService.js';
import { apiRequest } from '../api.js';

export function QrCodeModal({
  user = {},
  onClose,
  onToast,
  onResolvedCode
}) {
  const [activeTab, setActiveTab] = useState('my_code'); // 'my_code' | 'scan_code'
  const [personalCode, setPersonalCode] = useState(() => user.invite_code || getUserInviteCode());
  const [copied, setCopied] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Scanner state
  const [manualInput, setManualInput] = useState('');
  const [scannedResult, setScannedResult] = useState(null);
  const [scanError, setScanError] = useState('');
  const [resolving, setResolving] = useState(false);
  const fileInputRef = useRef(null);

  const qrPayload = generateQrPayload(personalCode, 'user', user.user_id || user.id);

  async function handleShare() {
    const res = await shareInviteLink({
      inviteCode: personalCode,
      title: `${user.real_name || 'My'} BSDK Clubs QR Code`,
      text: `Join my gang on BSDK Clubs using my invite code ${personalCode}!`
    });
    if (res.shared) {
      onToast?.('QR code link shared!');
    } else if (res.copied) {
      setCopied(true);
      onToast?.('Invite link copied!');
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleCopy() {
    navigator.clipboard?.writeText(personalCode);
    setCopied(true);
    onToast?.(`Personal code ${personalCode} copied!`);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleResetQr() {
    setResetting(true);
    try {
      // 1. Local revocation and new code generation
      const newCode = resetUserInviteCode(personalCode);
      setPersonalCode(newCode);

      // 2. Sync with backend if API is available
      try {
        await apiRequest('/invites/reset-user-code', {
          method: 'POST',
          body: { old_code: personalCode, new_code: newCode }
        });
      } catch {
        // Backend optional sync fallback
      }

      setResetConfirm(false);
      onToast?.('QR Code has been reset! Previous code revoked.');
    } finally {
      setResetting(false);
    }
  }

  // Handle scanned payload
  async function handleProcessPayload(rawText) {
    if (!rawText || !rawText.trim()) return;
    setScanError('');
    setScannedResult(null);
    setResolving(true);

    try {
      const parsed = parseQrPayload(rawText.trim());
      if (!parsed.valid) {
        if (parsed.revoked) {
          setScanError('⚠️ This QR code has been revoked or reset by the owner.');
        } else {
          setScanError(parsed.message || 'Invalid or unrecognized BSDK Clubs QR code.');
        }
        return;
      }

      // Resolve the code via API or service
      let previewInfo = null;
      try {
        previewInfo = await resolveInviteCode(parsed.code, apiRequest);
      } catch (err) {
        // Fallback preview
        previewInfo = { type: parsed.type, code: parsed.code, fallback: true };
      }

      setScannedResult({
        ...parsed,
        preview: previewInfo
      });
    } catch (err) {
      setScanError(err.message || 'Failed to process QR code.');
    } finally {
      setResolving(false);
    }
  }

  function handleAcceptScanned() {
    if (!scannedResult) return;
    if (onResolvedCode) {
      onResolvedCode(scannedResult);
    }
    onClose();
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
        {/* WhatsApp-Style Header */}
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
            <QrCode size={22} />
            <div style={{ fontSize: 18, fontWeight: 800 }}>
              QR Code
            </div>
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

        {/* WhatsApp-Style Tab Bar */}
        <div
          style={{
            display: 'flex',
            background: '#075E54',
            borderBottom: '1px solid rgba(255,255,255,0.15)'
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('my_code')}
            style={{
              flex: 1,
              padding: '12px 16px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'my_code' ? '3px solid #25D366' : '3px solid transparent',
              color: activeTab === 'my_code' ? '#ffffff' : 'rgba(255,255,255,0.65)',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              transition: 'all 0.15s ease'
            }}
          >
            <QrCode size={16} /> My Code
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('scan_code')}
            style={{
              flex: 1,
              padding: '12px 16px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'scan_code' ? '3px solid #25D366' : '3px solid transparent',
              color: activeTab === 'scan_code' ? '#ffffff' : 'rgba(255,255,255,0.65)',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              transition: 'all 0.15s ease'
            }}
          >
            <Scan size={16} /> Scan Code
          </button>
        </div>

        {/* ================= TAB 1: MY CODE ================= */}
        {activeTab === 'my_code' && (
          <div style={{ padding: '20px 22px', textAlign: 'center', maxHeight: '76vh', overflowY: 'auto' }}>
            {/* User Profile Card */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 14 }}>
              <img
                src={user.profile_photo_url || `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(user.real_name || 'Gang')}&backgroundColor=075e54`}
                alt={user.real_name || 'User'}
                style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', border: '2px solid #128C7E' }}
              />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-primary)' }}>
                  {user.real_name || 'My Gang Profile'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  BSDK Clubs Contact
                </div>
              </div>
            </div>

            {/* QR Code Card */}
            <div
              style={{
                display: 'inline-block',
                padding: 16,
                background: '#ffffff',
                borderRadius: 18,
                border: '1px solid var(--border, #cbd5e1)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
                marginBottom: 12,
                position: 'relative'
              }}
            >
              <QRCodeSVG
                value={qrPayload}
                size={190}
                fgColor="#075E54"
                level="M"
                includeMargin={false}
              />
              <div
                style={{
                  marginTop: 8,
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: '0.12em',
                  color: '#128C7E'
                }}
              >
                BSDK CLUBS GANG QR
              </div>
            </div>

            {/* Personal Code Chip */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
                YOUR PERSONAL INVITE CODE
              </div>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'var(--surface-active, #f1f5f9)',
                  padding: '6px 14px',
                  borderRadius: 20,
                  border: '1px dashed #128C7E'
                }}
              >
                <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: '0.12em', color: '#075E54' }}>
                  {personalCode}
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="icon-btn"
                  title="Copy Code"
                  style={{ padding: 4 }}
                >
                  {copied ? <Check size={14} color="#059669" /> : <Copy size={14} />}
                </button>
              </div>
            </div>

            {/* Explanatory note */}
            <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 auto 16px', maxWidth: 360 }}>
              Your QR code is private. If you share it with someone, they can scan it with their BSDK Clubs camera to join your gang.
            </p>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <button
                type="button"
                className="btn-primary"
                onClick={handleShare}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <Share2 size={16} /> Share Code
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleCopy}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                {copied ? <Check size={16} color="#059669" /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy Link'}
              </button>
            </div>

            {/* Reset QR Code Option */}
            {!resetConfirm ? (
              <button
                type="button"
                onClick={() => setResetConfirm(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#DC2626',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px'
                }}
              >
                <RotateCcw size={14} /> Reset QR Code
              </button>
            ) : (
              <div
                style={{
                  background: 'rgba(220, 38, 38, 0.08)',
                  border: '1px solid #f87171',
                  borderRadius: 12,
                  padding: 12,
                  textAlign: 'left'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, color: '#dc2626', marginBottom: 4 }}>
                  <AlertTriangle size={16} /> Reset & Revoke QR Code?
                </div>
                <p style={{ margin: 0, fontSize: 11.5, color: '#7f1d1d', lineHeight: 1.4, marginBottom: 10 }}>
                  Your previous QR code and link will be immediately revoked. Anyone who has the old code won't be able to join.
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setResetConfirm(false)}
                    style={{ flex: 1, padding: '6px 10px', fontSize: 12 }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={handleResetQr}
                    disabled={resetting}
                    style={{ flex: 1, padding: '6px 10px', fontSize: 12 }}
                  >
                    {resetting ? 'Resetting...' : 'Yes, Reset Now'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 2: SCAN CODE ================= */}
        {activeTab === 'scan_code' && (
          <div style={{ padding: '20px 22px', textAlign: 'center', maxHeight: '76vh', overflowY: 'auto' }}>
            {/* Viewfinder UI */}
            <div
              style={{
                width: 240,
                height: 240,
                margin: '0 auto 16px',
                borderRadius: 20,
                background: '#111b21',
                border: '2px solid #25D366',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                boxShadow: '0 8px 24px rgba(0,0,0,0.2)'
              }}
            >
              {/* Animated Scanning Beam */}
              <div
                style={{
                  position: 'absolute',
                  top: '10%',
                  left: 10,
                  right: 10,
                  height: 2,
                  background: 'linear-gradient(90deg, transparent, #25D366, transparent)',
                  boxShadow: '0 0 8px #25D366',
                  animation: 'scannerLaser 2s infinite ease-in-out'
                }}
              />
              <Camera size={44} color="rgba(255,255,255,0.4)" style={{ marginBottom: 10 }} />
              <div style={{ color: '#ffffff', fontSize: 12, fontWeight: 600, padding: '0 16px', opacity: 0.9 }}>
                Point camera at a BSDK QR code
              </div>
            </div>

            {/* Upload image / manual paste */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 16 }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    onToast?.(`Image "${file.name}" selected. Simulating QR read...`);
                    // Simulate QR read from image
                    handleProcessPayload(personalCode);
                  }
                }}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => fileInputRef.current?.click()}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}
              >
                <Upload size={14} /> Upload QR Image
              </button>
            </div>

            {/* Manual QR / Deep Link Input */}
            <div style={{ textAlign: 'left', marginBottom: 14 }}>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                OR PASTE QR PAYLOAD / DEEP LINK
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  className="text-input"
                  placeholder="e.g. bsdk:invite:GANG-4F8K"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  style={{ flex: 1, fontSize: 13 }}
                />
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => handleProcessPayload(manualInput)}
                  disabled={!manualInput.trim() || resolving}
                  style={{ padding: '8px 14px', fontSize: 12.5 }}
                >
                  {resolving ? 'Scanning...' : 'Scan'}
                </button>
              </div>
            </div>

            {/* Error Banner */}
            {scanError && (
              <div
                style={{
                  background: 'rgba(220, 38, 38, 0.1)',
                  border: '1px solid #ef4444',
                  borderRadius: 10,
                  padding: 10,
                  fontSize: 12.5,
                  color: '#dc2626',
                  textAlign: 'left',
                  marginBottom: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }}
              >
                <ShieldAlert size={18} style={{ flexShrink: 0 }} />
                <span>{scanError}</span>
              </div>
            )}

            {/* Scanned Result Preview */}
            {scannedResult && (
              <div
                style={{
                  background: '#f0fdf4',
                  border: '1px solid #86efac',
                  borderRadius: 12,
                  padding: 14,
                  textAlign: 'left',
                  marginBottom: 12
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13.5, color: '#166534', marginBottom: 6 }}>
                  <UserCheck size={18} /> Valid BSDK Code Detected!
                </div>
                <div style={{ fontSize: 13, color: '#14532d', marginBottom: 10 }}>
                  Code: <strong>{scannedResult.code}</strong> {scannedResult.type && `(${scannedResult.type})`}
                </div>
                {scannedResult.preview?.club && (
                  <div style={{ fontSize: 12.5, color: '#166534', marginBottom: 10 }}>
                    Club: <strong>{scannedResult.preview.club.name}</strong> • {scannedResult.preview.club.member_count} members
                  </div>
                )}
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleAcceptScanned}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  Proceed / Join Now <ArrowRight size={15} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
export default QrCodeModal;
