import React, { useState, useEffect } from 'react';
import {
  X, MessageSquare, Copy, Check, Share2, Sparkles, Clock, Phone, ExternalLink,
  Send, Smartphone, ShieldCheck, UserCheck, AlertCircle
} from 'lucide-react';
import {
  generateWhatsAppUrl,
  openWhatsAppInvite,
  generateSmsUrl,
  openSmsInvite,
  generateInviteLink,
  copyInviteLink,
  shareInviteLink,
  getUserInviteCode,
  getInviteRecord,
  getRemindCountdown,
  canRemindInvite,
  recordReminder
} from '../services/inviteService.js';

export function InviteScreenModal({
  phone,
  contactName,
  inviteCode: propInviteCode,
  onClose,
  onToast
}) {
  const [inviteCode, setInviteCode] = useState(() => propInviteCode || getUserInviteCode());
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [trackerState, setTrackerState] = useState(() => getInviteRecord(phone));
  const [countdown, setCountdown] = useState(() => getRemindCountdown(phone));

  useEffect(() => {
    if (propInviteCode) {
      setInviteCode(propInviteCode);
    }
  }, [propInviteCode]);

  // Refresh status
  function refreshStatus() {
    setTrackerState(getInviteRecord(phone));
    setCountdown(getRemindCountdown(phone));
  }

  function handleWhatsAppInvite() {
    openWhatsAppInvite({
      phone,
      inviteCode,
      onTrack: () => {
        refreshStatus();
        onToast?.('WhatsApp invite opened!');
      }
    });
  }

  function handleSmsInvite() {
    openSmsInvite({
      phone,
      inviteCode,
      onTrack: () => {
        refreshStatus();
        onToast?.('Native SIM SMS draft opened!');
      }
    });
  }

  async function handleCopyLink() {
    const res = await copyInviteLink(inviteCode);
    if (res.ok) {
      setCopiedLink(true);
      onToast?.('Invite link copied to clipboard!');
      setTimeout(() => setCopiedLink(false), 2200);
    }
  }

  async function handleShareLink() {
    const res = await shareInviteLink({
      inviteCode,
      title: 'Join my Gang on BSDK Clubs',
      text: `Join my private gang on BSDK Clubs! Messages disappear in 7 days 😄`
    });
    if (res.shared) {
      onToast?.('Invite shared successfully!');
    } else if (res.copied) {
      onToast?.('Invite link copied!');
    }
    refreshStatus();
  }

  function handleCopyCode() {
    navigator.clipboard?.writeText(inviteCode);
    setCopiedCode(true);
    onToast?.(`Code ${inviteCode} copied!`);
    setTimeout(() => setCopiedCode(false), 2200);
  }

  function handleSendReminder(method = 'whatsapp') {
    if (method === 'whatsapp') {
      openWhatsAppInvite({
        phone,
        inviteCode,
        text: `Hey! Reminder to join my gang on BSDK Clubs — anonymous gang chat with 7-day disappearing messages 😄 Download: ${generateInviteLink(inviteCode)}`,
        onTrack: () => {
          refreshStatus();
          onToast?.('Reminder sent via WhatsApp!');
        }
      });
    } else {
      openSmsInvite({
        phone,
        inviteCode,
        text: `Hey! Reminder to join my gang on BSDK Clubs 😄 Download: ${generateInviteLink(inviteCode)}`,
        onTrack: () => {
          refreshStatus();
          onToast?.('Reminder sent via SMS!');
        }
      });
    }
  }

  const link = generateInviteLink(inviteCode);
  const isEligibleForReminder = canRemindInvite(trackerState);

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
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.85, fontWeight: 700 }}>
              Invite to BSDK Clubs
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>
              {contactName || phone || 'Friend'}
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

        {/* Modal Body */}
        <div style={{ padding: '16px 20px', maxHeight: '78vh', overflowY: 'auto' }}>
          {/* Contact Details & Reminder Status Pill */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 14px',
              borderRadius: 12,
              background: 'var(--surface-active, #f0f2f5)',
              border: '1px solid var(--border, #e2e8f0)',
              marginBottom: 16
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: '#128C7E',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: 18
              }}
            >
              {(contactName ? contactName.charAt(0) : phone?.slice(-2) || 'G').toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--text-primary)' }}>
                {contactName || 'Unregistered Contact'}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                {phone || 'No phone number'}
              </div>
            </div>

            {/* Status Pill */}
            {countdown.status === 'joined' ? (
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: '#059669',
                  background: 'rgba(5, 150, 105, 0.12)',
                  padding: '4px 8px',
                  borderRadius: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4
                }}
              >
                <UserCheck size={13} /> Joined
              </span>
            ) : countdown.status === 'eligible' ? (
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: '#D97706',
                  background: 'rgba(217, 119, 6, 0.14)',
                  padding: '4px 8px',
                  borderRadius: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4
                }}
              >
                <AlertCircle size={13} /> Remind Now
              </span>
            ) : trackerState ? (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  background: 'rgba(0,0,0,0.06)',
                  padding: '4px 8px',
                  borderRadius: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4
                }}
              >
                <Clock size={12} /> {countdown.label}
              </span>
            ) : null}
          </div>

          {/* Invitation Copy Preview Card */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 12,
              background: '#d9fdd3',
              border: '1px solid #bbf7d0',
              color: '#111b21',
              fontSize: 12.5,
              lineHeight: 1.45,
              marginBottom: 16,
              position: 'relative'
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 11, color: '#075E54', marginBottom: 4 }}>
              PRE-FILLED INVITATION MESSAGE
            </div>
            Hey! I'm on <strong>BSDK Clubs — Your Gang. Your Bang.</strong> Join my gang here, messages disappear in 7 days and nobody knows who sent what in the group 😄
            <div style={{ marginTop: 6, fontSize: 11.5, color: '#006699', wordBreak: 'break-all', fontWeight: 600 }}>
              Download: {link}
            </div>
          </div>

          {/* Option 1: WhatsApp */}
          <button
            type="button"
            onClick={handleWhatsAppInvite}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '12px 14px',
              borderRadius: 12,
              background: '#25D366',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: 14.5,
              marginBottom: 10,
              boxShadow: '0 2px 6px rgba(37,211,102,0.3)',
              transition: 'transform 0.15s ease'
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Send size={18} />
            </div>
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div>Invite via WhatsApp</div>
              <div style={{ fontSize: 11.5, opacity: 0.9, fontWeight: 500 }}>
                1-tap direct chat opening with wa.me intent
              </div>
            </div>
          </button>

          {/* Option 2: SMS */}
          <button
            type="button"
            onClick={handleSmsInvite}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '12px 14px',
              borderRadius: 12,
              background: 'var(--surface-active, #f1f5f9)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border, #cbd5e1)',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: 14.5,
              marginBottom: 10,
              transition: 'background 0.15s ease'
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: '#0284c7',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Smartphone size={18} />
            </div>
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div>Invite via SMS</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontWeight: 500 }}>
                Native phone SIM SMS • Zero server cost
              </div>
            </div>
          </button>

          {/* Option 3: Copy Link & Share */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              marginBottom: 14
            }}
          >
            <button
              type="button"
              onClick={handleCopyLink}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid var(--border, #cbd5e1)',
                background: 'var(--bg-secondary, #f8fafc)',
                color: 'var(--text-primary)',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer'
              }}
            >
              {copiedLink ? <Check size={15} color="#059669" /> : <Copy size={15} />}
              {copiedLink ? 'Copied Link' : 'Copy Invite Link'}
            </button>

            <button
              type="button"
              onClick={handleShareLink}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid #128C7E',
                background: 'rgba(18,140,126,0.08)',
                color: '#128C7E',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer'
              }}
            >
              <Share2 size={15} />
              Share Link...
            </button>
          </div>

          {/* Option 4: Personal Code Chip */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 12,
              background: 'var(--surface-active, #f8fafc)',
              border: '1px dashed var(--border, #cbd5e1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16
            }}
          >
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>
                PERSONAL GANG CODE
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.12em', color: '#128C7E', marginTop: 2 }}>
                {inviteCode}
              </div>
            </div>
            <button
              type="button"
              onClick={handleCopyCode}
              className="btn-secondary"
              style={{ padding: '6px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {copiedCode ? <Check size={14} color="#059669" /> : <Copy size={14} />}
              {copiedCode ? 'Copied' : 'Copy Code'}
            </button>
          </div>

          {/* Reminder Section (3-day rule) */}
          {trackerState && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 12,
                background: isEligibleForReminder ? 'rgba(217, 119, 6, 0.08)' : 'var(--surface-active, #f8fafc)',
                border: `1px solid ${isEligibleForReminder ? '#f59e0b' : 'var(--border, #e2e8f0)'}`,
                marginBottom: 8
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: isEligibleForReminder ? '#b45309' : 'var(--text-secondary)' }}>
                  {isEligibleForReminder ? '🔥 3 Days Passed — Send Reminder' : '⏳ Invite Follow-up Status'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {countdown.label}
                </span>
              </div>

              {isEligibleForReminder ? (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => handleSendReminder('whatsapp')}
                    style={{
                      flex: 1,
                      background: '#25D366',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 8,
                      padding: '8px 10px',
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6
                    }}
                  >
                    <Send size={13} /> Remind (WhatsApp)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendReminder('sms')}
                    style={{
                      flex: 1,
                      background: '#0284c7',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 8,
                      padding: '8px 10px',
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6
                    }}
                  >
                    <Smartphone size={13} /> Remind (SMS)
                  </button>
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  BSDK Clubs prevents spam by enforcing a 3-day cooldown before sending automated gang reminders.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            background: 'var(--bg-secondary, #f8fafc)',
            borderTop: '1px solid var(--border, #e2e8f0)',
            display: 'flex',
            justifyContent: 'flex-end'
          }}
        >
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            style={{ padding: '8px 18px', fontSize: 13 }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
export default InviteScreenModal;
