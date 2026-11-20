import React, { useState, useEffect } from 'react';
import {
  X, Copy, QrCode, RefreshCw, Clock, BellOff, Image as ImageIcon,
  Flag, LogOut, Shield, MoreVertical, Edit3, Check, UserX, VolumeX, Ban
} from 'lucide-react';
import { apiRequest, formatDisappearingLabel } from '../api.js';
import { QrModal, MediaGalleryModal } from './Modals.jsx';

export function GroupInfoDrawer({
  club,
  messages,
  onClose,
  onClubUpdated,
  onUpdateClubPref,
  onLeaveClub,
  onOpenReport,
  onOpenAliasModal,
  onToast
}) {
  const [members, setMembers] = useState([]);
  const [anonymityNote, setAnonymityNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [showQr, setShowQr] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [editingInfo, setEditingInfo] = useState(false);
  const [editName, setEditName] = useState(club.name);
  const [editDesc, setEditDesc] = useState(club.description || '');
  const [memberMenuId, setMemberMenuId] = useState(null);

  const isAdmin = club.my_role === 'admin';

  async function loadMembers() {
    setLoading(true);
    try {
      const data = await apiRequest(`/clubs/${club.id}/members`);
      setMembers(data.members || []);
      setAnonymityNote(data.anonymity_note || '');
    } catch (err) {
      onToast(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setEditName(club.name);
    setEditDesc(club.description || '');
    loadMembers();
  }, [club.id]);

  async function handleSaveClubInfo(e) {
    e.preventDefault();
    try {
      const data = await apiRequest(`/clubs/${club.id}`, {
        method: 'PATCH',
        body: { name: editName, description: editDesc }
      });
      onClubUpdated(data.club);
      setEditingInfo(false);
      onToast('Club info updated!');
    } catch (err) {
      onToast(err.message);
    }
  }

  async function handleChangeDisappearing(seconds) {
    if (!isAdmin) {
      onToast('Sirf Club Admin disappearing timer change kar sakta hai.');
      return;
    }
    try {
      const data = await apiRequest(`/clubs/${club.id}`, {
        method: 'PATCH',
        body: { disappearing_seconds: Number(seconds) }
      });
      onClubUpdated(data.club);
      onToast(`Disappearing messages set to: ${formatDisappearingLabel(Number(seconds))}`);
    } catch (err) {
      onToast(err.message);
    }
  }

  async function handleResetInvite() {
    try {
      const data = await apiRequest(`/clubs/${club.id}/reset-invite`, { method: 'POST' });
      onClubUpdated({ ...club, invite_code: data.invite_code });
      onToast(`Naya invite code generate ho gaya: ${data.invite_code}`);
    } catch (err) {
      onToast(err.message);
    }
  }

  async function handleMemberAction(member, action) {
    setMemberMenuId(null);
    try {
      if (action === 'toggle-admin') {
        const nextRole = member.role === 'admin' ? 'member' : 'admin';
        await apiRequest(`/clubs/${club.id}/members/${member.user_id}`, {
          method: 'PATCH',
          body: { role: nextRole }
        });
        onToast(`${member.real_name} ab ${nextRole} hai.`);
        loadMembers();
      } else if (action === 'mute-24h') {
        await apiRequest(`/clubs/${club.id}/members/${member.user_id}`, {
          method: 'PATCH',
          body: { mute_minutes: 1440 }
        });
        onToast(`${member.real_name} 24 hours ke liye mute ho gaya.`);
        loadMembers();
      } else if (action === 'unmute') {
        await apiRequest(`/clubs/${club.id}/members/${member.user_id}`, {
          method: 'PATCH',
          body: { mute_minutes: 0 }
        });
        onToast(`${member.real_name} unmute ho gaya.`);
        loadMembers();
      } else if (action === 'remove') {
        if (!window.confirm(`${member.real_name} ko ${club.name} se remove karein?`)) return;
        await apiRequest(`/clubs/${club.id}/members/${member.user_id}`, { method: 'DELETE' });
        onToast(`${member.real_name} club se remove ho gaya.`);
        loadMembers();
        onClubUpdated({ ...club, member_count: Math.max(1, club.member_count - 1) });
      } else if (action === 'block') {
        await apiRequest('/blocks', { method: 'POST', body: { blocked_user_id: member.user_id } });
        onToast(`${member.real_name} block ho gaya. Unka content ab hide rahega.`);
      } else if (action === 'report') {
        onOpenReport({
          club_id: club.id,
          reported_user_id: member.user_id,
          label: member.real_name
        });
      }
    } catch (err) {
      onToast(err.message);
    }
  }

  return (
    <aside className="drawer-pane" onClick={() => setMemberMenuId(null)}>
      <header className="app-header">
        <div className="header-left">
          <button type="button" className="icon-btn" onClick={onClose} title="Close">
            <X size={20} />
          </button>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Group Info</span>
        </div>
        {isAdmin && !editingInfo && (
          <button type="button" className="icon-btn" onClick={() => setEditingInfo(true)} title="Edit Club Info">
            <Edit3 size={18} />
          </button>
        )}
      </header>

      <div className="drawer-scroll">
        {/* Top Club Profile */}
        <div className="drawer-section" style={{ textAlign: 'center' }}>
          <img src={club.photo_url} alt={club.name} className="avatar-circle avatar-xl" style={{ margin: '0 auto 12px' }} />

          {editingInfo ? (
            <form onSubmit={handleSaveClubInfo} style={{ textAlign: 'left' }}>
              <div className="field-group">
                <label className="field-label">Club Name</label>
                <input className="text-input" value={editName} onChange={(e) => setEditName(e.target.value)} required />
              </div>
              <div className="field-group">
                <label className="field-label">Description</label>
                <textarea className="text-input" rows={2} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" style={{ flex: 1 }} onClick={() => setEditingInfo(false)}>Cancel</button>
                <button type="submit" className="btn-primary" style={{ flex: 1 }}><Check size={15} /> Save</button>
              </div>
            </form>
          ) : (
            <>
              <div style={{ fontWeight: 800, fontSize: 20 }}>{club.name}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3 }}>
                Club • {members.length || club.member_count} members • Created {new Date(club.created_at).toLocaleDateString()}
              </div>
              {club.description && (
                <p style={{ fontSize: 13.5, marginTop: 10, color: 'var(--text-primary)', lineHeight: 1.45 }}>
                  {club.description}
                </p>
              )}
            </>
          )}

          {/* My Alias Strip */}
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 10, background: 'var(--bg-panel-alt)' }}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Your anonymous alias here</div>
              <div style={{ fontWeight: 700, color: club.my_alias_color }}>{club.my_alias}</div>
            </div>
            <button type="button" className="btn-secondary" onClick={onOpenAliasModal}>
              <Edit3 size={14} /> Change
            </button>
          </div>
        </div>

        {/* Anonymity Trust Note Strip (Section 3.5.3) */}
        <div className="drawer-section">
          <div className="trust-note">
            <strong>Trust + Anonymity Rule:</strong> {anonymityNote || 'Chat mein sab anonymous hain. Kaun sa message kisne bheja, ye members ko nahi dikhta.'}
          </div>
        </div>

        {/* Invite & Club Settings Actions */}
        <div className="drawer-section" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>INVITE & CONTROLS</div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 10, background: 'var(--bg-panel-alt)' }}>
            <div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Invite Code</div>
              <div style={{ fontWeight: 800, letterSpacing: '0.1em', color: 'var(--brand-green)' }}>{club.invite_code}</div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                className="icon-btn dark-hover"
                title="Copy Invite Code"
                onClick={() => { navigator.clipboard?.writeText(club.invite_code); onToast('Invite code copied!'); }}
              >
                <Copy size={17} />
              </button>
              <button type="button" className="icon-btn dark-hover" title="Show QR Code" onClick={() => setShowQr(true)}>
                <QrCode size={17} />
              </button>
              {isAdmin && (
                <button type="button" className="icon-btn dark-hover" title="Reset Invite Link (Admin)" onClick={handleResetInvite}>
                  <RefreshCw size={17} />
                </button>
              )}
            </div>
          </div>

          <button
            type="button"
            className="popover-item"
            style={{ justifyContent: 'space-between' }}
            onClick={() => onUpdateClubPref(club.id, { is_muted: !club.is_muted })}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <BellOff size={17} color="#128C7E" /> Mute Notifications
            </span>
            <span className={`toggle-switch ${club.is_muted ? 'on' : ''}`}>
              <span className="toggle-knob" />
            </span>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}>
              <Clock size={17} color="#128C7E" /> Disappearing Messages
            </span>
            <select
              className="text-input"
              style={{ width: 'auto', padding: '5px 10px', fontSize: 13 }}
              value={club.disappearing_seconds}
              disabled={!isAdmin}
              onChange={(e) => handleChangeDisappearing(e.target.value)}
            >
              <option value={604800}>7 days</option>
              <option value={86400}>24 hours</option>
              <option value={0}>Off</option>
            </select>
          </div>

          <button type="button" className="popover-item" onClick={() => setShowGallery(true)}>
            <ImageIcon size={17} color="#128C7E" /> Media Gallery (Live Snaps)
          </button>
        </div>

        {/* REAL MEMBERS LIST (The Core Trust Feature!) */}
        <div className="drawer-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
              REAL MEMBERS ({members.length})
            </span>
            <span style={{ fontSize: 11, color: 'var(--brand-green)', fontWeight: 600 }}>Aliases hidden here</span>
          </div>

          {loading ? (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', padding: 8 }}>Loading members...</div>
          ) : (
            members.map((m) => {
              const memberMuted = m.muted_until && new Date(m.muted_until).getTime() > Date.now();
              return (
                <div key={m.user_id} className="member-row" style={{ position: 'relative' }}>
                  <img src={m.profile_photo_url} alt={m.real_name} className="avatar-circle avatar-sm" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {m.real_name} {m.is_me ? '(You)' : ''}
                      </span>
                      {m.role === 'admin' && <span className="admin-badge">Admin</span>}
                      {memberMuted && <span style={{ fontSize: 10.5, color: '#DC2626', fontWeight: 700 }}>Muted</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      @{m.handle} • {m.about || 'Hey there! I am on BSDK Clubs'}
                    </div>
                  </div>

                  {!m.is_me && (
                    <button
                      type="button"
                      className="icon-btn dark-hover"
                      style={{ width: 30, height: 30 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMemberMenuId(memberMenuId === m.user_id ? null : m.user_id);
                      }}
                    >
                      <MoreVertical size={15} />
                    </button>
                  )}

                  {memberMenuId === m.user_id && (
                    <div className="popover-menu" style={{ right: 8, top: 44 }} onClick={(e) => e.stopPropagation()}>
                      {isAdmin && (
                        <>
                          <button type="button" className="popover-item" onClick={() => handleMemberAction(m, 'toggle-admin')}>
                            <Shield size={15} /> {m.role === 'admin' ? 'Remove Admin' : 'Make Admin'}
                          </button>
                          <button type="button" className="popover-item" onClick={() => handleMemberAction(m, memberMuted ? 'unmute' : 'mute-24h')}>
                            <VolumeX size={15} /> {memberMuted ? 'Unmute Member' : 'Mute 24h'}
                          </button>
                          <button type="button" className="popover-item danger" onClick={() => handleMemberAction(m, 'remove')}>
                            <UserX size={15} /> Remove Member
                          </button>
                        </>
                      )}
                      <button type="button" className="popover-item danger" onClick={() => handleMemberAction(m, 'block')}>
                        <Ban size={15} /> Block User
                      </button>
                      <button type="button" className="popover-item danger" onClick={() => handleMemberAction(m, 'report')}>
                        <Flag size={15} /> Report User
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Danger Zone */}
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            type="button"
            className="popover-item danger"
            onClick={() => onOpenReport({ club_id: club.id, label: `club "${club.name}"` })}
          >
            <Flag size={17} /> Report Club
          </button>
          <button type="button" className="popover-item danger" onClick={() => onLeaveClub(club)}>
            <LogOut size={17} /> Leave Club
          </button>
        </div>
      </div>

      {showQr && (
        <QrModal
          title={`Invite to ${club.name}`}
          subtitle="Doston ko ye QR scan karwao ya invite code share karo (Group Info mein sab real dost dikhenge)."
          value={`bsdkclubs://join/${club.invite_code}`}
          codeLabel={club.invite_code}
          onClose={() => setShowQr(false)}
        />
      )}

      {showGallery && (
        <MediaGalleryModal
          clubName={club.name}
          messages={messages}
          onClose={() => setShowGallery(false)}
        />
      )}
    </aside>
  );
}
