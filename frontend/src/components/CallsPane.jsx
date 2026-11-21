import React, { useState, useEffect } from 'react';
import {
  Phone, Video, PhoneIncoming, PhoneOutgoing, PhoneMissed,
  PhoneCall, Users, Plus, Clock, AlertCircle, RefreshCw
} from 'lucide-react';
import { apiRequest } from '../api.js';

export function CallsPane({ onGoToChats, onStartCall }) {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function loadCallHistory() {
    try {
      setLoading(true);
      setError(null);
      const res = await apiRequest('/calls/history?limit=50');
      if (res && res.calls) {
        setCalls(res.calls);
      }
    } catch (err) {
      console.warn('[Call History Warning]', err);
      setError('Could not load call history.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCallHistory();
  }, []);

  function formatCallDate(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isToday) return `Today, ${timeStr}`;
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Subheader */}
      <div
        style={{
          padding: '12px 16px',
          fontWeight: 700,
          fontSize: 13,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <span>Recent Calls</span>
        <button
          type="button"
          onClick={loadCallHistory}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {/* Call List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && calls.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-secondary)' }}>
            Loading calls...
          </div>
        ) : calls.length === 0 ? (
          <div className="empty-state-center" style={{ padding: '60px 24px', textAlign: 'center' }}>
            <div
              style={{
                width: 68,
                height: 68,
                borderRadius: '50%',
                background: 'rgba(37, 211, 102, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#25D366',
                marginBottom: 16
              }}
            >
              <PhoneCall size={32} />
            </div>
            <h3 style={{ margin: '0 0 8px 0', fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>
              No recent calls
            </h3>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)', maxWidth: 280, lineHeight: 1.5 }}>
              To start voice or video calling contacts on BSDK Clubs, tap on a chat or start a call.
            </p>
            <button
              type="button"
              className="btn-primary"
              style={{ marginTop: 20 }}
              onClick={onGoToChats}
            >
              Start a Call from Chat
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {calls.map((c) => {
              const isMissed = c.direction === 'missed' || c.status === 'missed';
              const isOutgoing = c.direction === 'outgoing';
              const isVideo = c.call_type === 'video';

              return (
                <div
                  key={c.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '12px 16px',
                    gap: 14,
                    borderBottom: '1px solid var(--border-color)',
                    cursor: 'pointer',
                    transition: 'background 0.15s ease'
                  }}
                  className="chat-list-item"
                >
                  {/* Avatar */}
                  <div style={{ position: 'relative' }}>
                    {c.peer?.photo_url ? (
                      <img
                        src={c.peer.photo_url}
                        alt={c.peer.name}
                        className="avatar-circle avatar-md"
                        style={{ width: 46, height: 46, borderRadius: '50%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div
                        className="avatar-circle avatar-md"
                        style={{
                          width: 46,
                          height: 46,
                          borderRadius: '50%',
                          background: c.is_group ? '#128C7E' : '#075E54',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#FFFFFF',
                          fontWeight: 700,
                          fontSize: 18
                        }}
                      >
                        {c.is_group ? <Users size={20} /> : (c.peer?.name?.charAt(0) || '?').toUpperCase()}
                      </div>
                    )}
                  </div>

                  {/* Call Details */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 15,
                        color: isMissed ? '#EA0038' : 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {c.peer?.name || 'Contact'}
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        marginTop: 3,
                        fontSize: 13,
                        color: 'var(--text-secondary)'
                      }}
                    >
                      {isMissed ? (
                        <PhoneMissed size={14} color="#EA0038" />
                      ) : isOutgoing ? (
                        <PhoneOutgoing size={14} color="#25D366" />
                      ) : (
                        <PhoneIncoming size={14} color="#25D366" />
                      )}

                      <span>{formatCallDate(c.created_at)}</span>

                      {c.duration_seconds > 0 && (
                        <span>• {c.duration_label}</span>
                      )}
                    </div>
                  </div>

                  {/* Redial Action */}
                  <button
                    type="button"
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 10,
                      cursor: 'pointer',
                      color: '#075E54',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    title={`Call back (${isVideo ? 'Video' : 'Voice'})`}
                    onClick={() => {
                      if (onStartCall) {
                        onStartCall(c.peer, isVideo ? 'video' : 'voice', c.is_group);
                      } else {
                        onGoToChats?.();
                      }
                    }}
                  >
                    {isVideo ? <Video size={20} color="#075E54" /> : <Phone size={20} color="#075E54" />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
