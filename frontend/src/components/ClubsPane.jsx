import React, { useState } from 'react';
import { Plus, Link2, Edit3, Users, ArrowRight } from 'lucide-react';
import { apiRequest } from '../api.js';
import { JoinPreviewModal } from './Modals.jsx';

export function ClubsPane({
  clubs,
  onSelectClub,
  onOpenCreateClub,
  onOpenAliasForClub,
  onClubJoined,
  onToast
}) {
  const [inviteInput, setInviteInput] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewCode, setPreviewCode] = useState('');

  async function handleCheckInvite(e) {
    e.preventDefault();
    const cleaned = inviteInput.trim().replace(/^.*join\//i, '').toUpperCase();
    if (!cleaned) return;
    setLoadingPreview(true);
    try {
      const data = await apiRequest(`/clubs/preview/${encodeURIComponent(cleaned)}`);
      setPreviewCode(cleaned);
      setPreviewData(data.club);
    } catch (err) {
      onToast(err.message);
    } finally {
      setLoadingPreview(false);
    }
  }

  return (
    <div className="sidebar-body" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Create & Join Actions */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button type="button" className="btn-primary" style={{ width: '100%' }} onClick={onOpenCreateClub}>
          <Plus size={18} /> Create New Club
        </button>

        <form onSubmit={handleCheckInvite} style={{ display: 'flex', gap: 8 }}>
          <div className="search-box" style={{ flex: 1 }}>
            <Link2 size={15} />
            <input
              placeholder="Invite code (e.g. EXAM99)"
              value={inviteInput}
              onChange={(e) => setInviteInput(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-secondary" disabled={loadingPreview}>
            {loadingPreview ? '...' : 'Preview'}
          </button>
        </form>
        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
          Join karne se pehle tumhe club ke real members dikhenge — pasand aaye to accept karo!
        </div>
      </div>

      {/* My Clubs List showing per-club alias */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8, paddingLeft: 4 }}>
          MY CLUBS ({clubs.length})
        </div>

        {clubs.length === 0 ? (
          <div className="empty-state-center">
            <Users size={38} color="#128C7E" />
            <div>Abhi kisi club mein nahi ho.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {clubs.map((club) => (
              <div
                key={club.id}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  boxShadow: 'var(--shadow-sm)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => onSelectClub(club.id)}>
                  <img src={club.photo_url} alt={club.name} className="avatar-circle" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{club.name}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                      {club.member_count} members • Invite: <strong>{club.invite_code}</strong>
                    </div>
                  </div>
                  <ArrowRight size={17} color="var(--text-secondary)" />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', borderRadius: 9, background: 'var(--bg-panel-alt)' }}>
                  <div style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="alias-dot" style={{ background: club.my_alias_color }} />
                    <span>
                      You are <strong style={{ color: club.my_alias_color }}>{club.my_alias}</strong> here
                    </span>
                  </div>
                  <button
                    type="button"
                    style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand-green)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    onClick={() => onOpenAliasForClub(club)}
                  >
                    <Edit3 size={13} /> Change
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {previewData && (
        <JoinPreviewModal
          inviteCode={previewCode}
          previewData={previewData}
          onClose={() => { setPreviewData(null); setPreviewCode(''); }}
          onJoined={(club) => {
            setInviteInput('');
            onClubJoined(club);
          }}
        />
      )}
    </div>
  );
}
