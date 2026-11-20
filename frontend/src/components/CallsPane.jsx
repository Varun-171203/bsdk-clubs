import React from 'react';
import { PhoneOff, MessageCircle } from 'lucide-react';

// Section 3.5.7 Calls Screen (MVP):
// Honest empty state only — NO dialer, NO fake call list.
export function CallsPane({ onGoToChats }) {
  return (
    <div className="empty-state-center">
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          background: 'rgba(18, 140, 126, 0.14)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#128C7E'
        }}
      >
        <PhoneOff size={32} />
      </div>
      <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--text-primary)' }}>
        Calls jald aa rahe hain.
      </div>
      <p style={{ fontSize: 14, maxWidth: 280, lineHeight: 1.5 }}>
        Abhi ke liye Clubs mein bakcodi karo. Voice & Video calls future WebRTC update mein aayenge.
      </p>
      <button type="button" className="btn-primary" onClick={onGoToChats}>
        <MessageCircle size={17} /> Back to Clubs
      </button>
    </div>
  );
}
