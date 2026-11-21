import React, { useState, useEffect } from 'react';
import { Users, X, Clock, ShieldAlert, Check, Loader2, ArrowRight } from 'lucide-react';
import { apiRequest, resolveMediaUrl, formatDisappearingLabel } from '../api.js';

export function ClubJoinModal({ inviteCode, onClose, onJoined }) {
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [club, setClub] = useState(null);
  const [error, setError] = useState('');
  const [isRevoked, setIsRevoked] = useState(false);

  const cleanCode = String(inviteCode || '')
    .replace(/^.*\/club\/join\//i, '')
    .replace(/^bsdk:invite:/i, '')
    .trim()
    .toUpperCase();

  useEffect(() => {
    let mounted = true;
    if (!cleanCode) {
      setError('Invalid invite link.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    setIsRevoked(false);

    apiRequest(`/clubs/preview/${encodeURIComponent(cleanCode)}`, { authRequired: false })
      .then((data) => {
        if (!mounted) return;
        if (data?.club) {
          setClub(data.club);
        } else {
          setError('Could not load group info.');
        }
      })
      .catch((err) => {
        if (!mounted) return;
        if (err.status === 410 || err.code === 'INVITE_REVOKED') {
          setIsRevoked(true);
          setError("You can't join this club because this invite link has been reset or has expired.");
        } else {
          setError(err.message || 'Invalid or expired invite link.');
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [cleanCode]);

  async function handleJoinOrOpen() {
    if (!club) return;
    if (club.already_member) {
      onJoined?.(club);
      onClose();
      return;
    }

    setJoining(true);
    setError('');
    try {
      const res = await apiRequest('/clubs/join', {
        method: 'POST',
        body: { invite_code: cleanCode }
      });
      if (res?.club) {
        onJoined?.(res.club);
        onClose();
      }
    } catch (err) {
      if (err.status === 410 || err.code === 'INVITE_REVOKED') {
        setIsRevoked(true);
        setError('This invite link was revoked by the group admin.');
      } else {
        setError(err.message || 'Failed to join club.');
      }
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
          maxWidth: 380,
          padding: 0,
          borderRadius: 16,
          overflow: 'hidden',
          background: '#ffffff',
          boxShadow: '0 8px 32px rgba(0,0,0,0.22)'
        }}
      >
        {/* WhatsApp Green Top Header */}
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
            <Users size={20} color="#25D366" />
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '0.02em' }}>
              BSDK Clubs Invite
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#ffffff',
              cursor: 'pointer',
              display: 'flex',
              padding: 4
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '24px 20px' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '36px 0' }}>
              <Loader2 size={36} color="#00a884" className="spin-slow" style={{ margin: '0 auto 12px' }} />
              <p style={{ fontSize: 14, color: '#54656f', margin: 0 }}>Checking invite link...</p>
            </div>
          )}

          {!loading && isRevoked && (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: '#fee2e2',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px'
                }}
              >
                <ShieldAlert size={30} color="#dc2626" />
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 700, color: '#111b21', margin: '0 0 8px' }}>
                Invite Link Reset
              </h3>
              <p style={{ fontSize: 13.5, color: '#54656f', margin: '0 0 20px', lineHeight: 1.5 }}>
                {error}
              </p>
              <button
                onClick={onClose}
                style={{
                  width: '100%',
                  padding: '12px 0',
                  borderRadius: 24,
                  border: 'none',
                  background: '#00a884',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: 14.5,
                  cursor: 'pointer'
                }}
              >
                OK
              </button>
            </div>
          )}

          {!loading && !isRevoked && error && !club && (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: '#fef3c7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px'
                }}
              >
                <ShieldAlert size={30} color="#d97706" />
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 700, color: '#111b21', margin: '0 0 8px' }}>
                Invalid Invite
              </h3>
              <p style={{ fontSize: 13.5, color: '#54656f', margin: '0 0 20px', lineHeight: 1.5 }}>
                {error}
              </p>
              <button
                onClick={onClose}
                style={{
                  width: '100%',
                  padding: '12px 0',
                  borderRadius: 24,
                  border: 'none',
                  background: '#00a884',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: 14.5,
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          )}

          {!loading && club && (
            <div>
              {/* Group Photo & Info */}
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                {club.photo_url ? (
                  <img
                    src={resolveMediaUrl(club.photo_url)}
                    alt={club.name}
                    style={{
                      width: 80,
                      height: 80,
                      borderRadius: '50%',
                      objectFit: 'cover',
                      margin: '0 auto 12px',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 80,
                      height: 80,
                      borderRadius: '50%',
                      background: '#128C7E',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 32,
                      fontWeight: 700,
                      margin: '0 auto 12px'
                    }}
                  >
                    {club.name?.charAt(0)?.toUpperCase() || 'C'}
                  </div>
                )}
                <h2 style={{ fontSize: 19, fontWeight: 700, color: '#111b21', margin: '0 0 4px' }}>
                  {club.name}
                </h2>
                <div style={{ fontSize: 13.5, color: '#54656f' }}>
                  Group · {club.member_count || 1} {club.member_count === 1 ? 'member' : 'members'}
                </div>
              </div>

              {club.description && (
                <div
                  style={{
                    fontSize: 13,
                    color: '#3b4a54',
                    background: '#f0f2f5',
                    padding: '10px 14px',
                    borderRadius: 10,
                    marginBottom: 16,
                    lineHeight: 1.45
                  }}
                >
                  {club.description}
                </div>
              )}

              {/* Disappearing Messages Notice */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12,
                  color: '#54656f',
                  background: '#f8fafc',
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid #e2e8f0',
                  marginBottom: 18
                }}
              >
                <Clock size={15} color="#00a884" />
                <span>
                  Disappearing messages:{' '}
                  <strong>{formatDisappearingLabel(club.disappearing_seconds)}</strong>
                </span>
              </div>

              {/* Member Preview Avatars */}
              {club.members && club.members.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, color: '#8696a0', fontWeight: 600, marginBottom: 8 }}>
                    MEMBERS IN THIS GROUP
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {club.members.slice(0, 6).map((m, idx) => (
                      <div
                        key={m.user_id || idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                          background: '#f0f2f5',
                          padding: '3px 8px 3px 4px',
                          borderRadius: 14,
                          fontSize: 12,
                          color: '#111b21'
                        }}
                      >
                        {m.profile_photo_url ? (
                          <img
                            src={resolveMediaUrl(m.profile_photo_url)}
                            alt=""
                            style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover' }}
                          />
                        ) : (
                          <div
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: '50%',
                              background: '#25D366',
                              color: '#fff',
                              fontSize: 10,
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            {m.real_name?.charAt(0) || 'U'}
                          </div>
                        )}
                        <span>{m.real_name || 'Member'}</span>
                      </div>
                    ))}
                    {club.members.length > 6 && (
                      <span style={{ fontSize: 12, color: '#8696a0' }}>
                        +{club.members.length - 6} more
                      </span>
                    )}
                  </div>
                </div>
              )}

              {error && (
                <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 14, textAlign: 'center' }}>
                  {error}
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button
                  type="button"
                  disabled={joining}
                  onClick={handleJoinOrOpen}
                  style={{
                    width: '100%',
                    padding: '13px 0',
                    borderRadius: 24,
                    border: 'none',
                    background: '#00a884',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: 15,
                    cursor: joining ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    boxShadow: '0 2px 6px rgba(0, 168, 132, 0.35)'
                  }}
                >
                  {joining ? (
                    <>
                      <Loader2 size={18} className="spin-slow" />
                      <span>Joining...</span>
                    </>
                  ) : club.already_member ? (
                    <>
                      <Check size={18} />
                      <span>OPEN CLUB</span>
                    </>
                  ) : (
                    <>
                      <ArrowRight size={18} />
                      <span>JOIN CLUB</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    width: '100%',
                    padding: '11px 0',
                    borderRadius: 24,
                    border: '1px solid #d1d7db',
                    background: 'transparent',
                    color: '#54656f',
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
