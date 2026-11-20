import React from 'react';
import { Users, ShieldCheck, CheckCircle2, Lock } from 'lucide-react';

/**
 * WhatsApp-exact Contacts Permission explanation dialog.
 * Displayed before requesting device contacts or when contacts access needs user explanation.
 *
 * @param {Object} props
 * @param {boolean} props.isOpen
 * @param {() => void} props.onAllow
 * @param {() => void} props.onNotNow
 */
export function ContactsPermissionModal({ isOpen, onAllow, onNotNow }) {
  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      style={{
        zIndex: 150,
        backgroundColor: 'rgba(11, 20, 26, 0.72)',
        backdropFilter: 'blur(3px)'
      }}
    >
      <div
        className="modal-card"
        style={{
          maxWidth: '380px',
          width: '92%',
          padding: '24px 20px',
          borderRadius: '24px',
          textAlign: 'center',
          animation: 'fadeInUp 0.22s ease-out'
        }}
      >
        {/* WhatsApp-style Circular Illustrated Icon Badge */}
        <div
          style={{
            width: '68px',
            height: '68px',
            borderRadius: '50%',
            backgroundColor: 'rgba(18, 140, 126, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 18px',
            color: '#128C7E'
          }}
        >
          <Users size={34} strokeWidth={2.2} />
        </div>

        {/* Dialog Title */}
        <h3
          style={{
            fontSize: '19px',
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginBottom: '12px',
            lineHeight: 1.3
          }}
        >
          Find your friends
        </h3>

        {/* WhatsApp-Exact Explanation Body */}
        <p
          style={{
            fontSize: '14.5px',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
            marginBottom: '18px'
          }}
        >
          To help you connect with friends, allow BSDK Clubs access to your contacts.
        </p>

        {/* Privacy Assurance Box */}
        <div
          style={{
            backgroundColor: 'var(--bg-panel-alt, rgba(0,0,0,0.04))',
            borderRadius: '12px',
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            textAlign: 'left',
            marginBottom: '24px',
            border: '1px solid var(--border)'
          }}
        >
          <Lock size={18} color="#128C7E" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Your privacy is protected:</span> Numbers are hashed using <strong style={{ color: '#128C7E' }}>SHA-256</strong> on your device before checking. Your address book is <span style={{ textDecoration: 'underline' }}>never</span> uploaded in plain text.
          </div>
        </div>

        {/* Action Buttons: NOT NOW / CONTINUE (WhatsApp Android style) */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onNotNow}
            style={{
              flex: 1,
              padding: '11px 16px',
              borderRadius: '22px',
              border: '1px solid var(--border-strong)',
              background: 'transparent',
              color: 'var(--text-primary)',
              fontWeight: 600,
              fontSize: '14px',
              cursor: 'pointer'
            }}
          >
            NOT NOW
          </button>
          <button
            type="button"
            onClick={onAllow}
            style={{
              flex: 1,
              padding: '11px 16px',
              borderRadius: '22px',
              border: 'none',
              backgroundColor: '#128C7E',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '14px',
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(18, 140, 126, 0.35)'
            }}
          >
            CONTINUE
          </button>
        </div>
      </div>
    </div>
  );
}
