import React, { useState, useEffect } from 'react';
import { Plus, Camera, Type, Eye, Send, X, ChevronLeft, ChevronRight, VolumeX } from 'lucide-react';
import { apiRequest, formatTime, resolveMediaUrl } from '../api.js';
import { CameraSnapModal } from './Modals.jsx';

const STATUS_BG_COLORS = ['#075E54', '#128C7E', '#7C3AED', '#BE185D', '#0284C7', '#D97706', '#1F2C34'];

export function UpdatesPane({ clubs, statusGroups, onRefreshStatuses, onReplyToStatus, onToast }) {
  const [showCreateText, setShowCreateText] = useState(false);
  const [showCreateCam, setShowCreateCam] = useState(false);
  const [targetClubId, setTargetClubId] = useState(clubs[0]?.id || '');
  const [statusText, setStatusText] = useState('');
  const [statusBg, setStatusBg] = useState(STATUS_BG_COLORS[0]);
  const [posting, setPosting] = useState(false);

  // Fullscreen Status Viewer state
  const [viewerGroup, setViewerGroup] = useState(null);
  const [viewerIdx, setViewerIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [replyText, setReplyText] = useState('');

  useEffect(() => {
    if (!targetClubId && clubs[0]?.id) {
      setTargetClubId(clubs[0].id);
    }
  }, [clubs, targetClubId]);

  const activeGroups = statusGroups.filter((g) => !g.is_muted);
  const mutedGroups = statusGroups.filter((g) => g.is_muted && g.statuses.length > 0);
  const myStatusesCount = statusGroups.reduce((acc, g) => acc + g.statuses.filter((s) => s.is_mine).length, 0);

  // Auto-advance status viewer progress bar
  useEffect(() => {
    if (!viewerGroup) return;
    const currentStatus = viewerGroup.statuses[viewerIdx];
    if (!currentStatus) return;

    // Record anonymous view
    apiRequest(`/statuses/${currentStatus.id}/view`, { method: 'POST' }).catch(() => {});

    setProgress(0);
    const interval = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          if (viewerIdx < viewerGroup.statuses.length - 1) {
            setViewerIdx((i) => i + 1);
          } else {
            setViewerGroup(null);
            onRefreshStatuses();
          }
          return 0;
        }
        return p + 2;
      });
    }, 120);

    return () => clearInterval(interval);
  }, [viewerGroup, viewerIdx]);

  async function handlePostTextStatus(e) {
    e.preventDefault();
    if (!targetClubId || !statusText.trim()) return;
    setPosting(true);
    try {
      await apiRequest(`/clubs/${targetClubId}/statuses`, {
        method: 'POST',
        body: { type: 'text', caption: statusText.trim(), bg_color: statusBg }
      });
      setStatusText('');
      setShowCreateText(false);
      onRefreshStatuses();
      onToast('Anonymous status 24 ghante ke liye lag gaya!');
    } catch (err) {
      onToast(err.message);
    } finally {
      setPosting(false);
    }
  }

  async function handleSendStatusReply(e) {
    e.preventDefault();
    if (!viewerGroup || !replyText.trim()) return;
    const status = viewerGroup.statuses[viewerIdx];
    const cleanReply = replyText.trim();
    setReplyText('');
    await onReplyToStatus(viewerGroup.club_id, `[Status Reply to ${status.alias_name}]: ${cleanReply}`);
    onToast(`Reply bhej diya gaya as ${viewerGroup.my_alias}!`);
    setViewerGroup(null);
  }

  const currentStatus = viewerGroup?.statuses?.[viewerIdx];

  return (
    <div className="sidebar-body" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* My Status Section (Section 3.5.5) */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="status-ring" style={{ background: myStatusesCount > 0 ? '#25D366' : 'var(--border-strong)' }}>
            <div className="status-ring-inner" style={{ background: '#128C7E' }}>
              <Plus size={22} />
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>My Anonymous Status</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
              {myStatusesCount > 0 ? `${myStatusesCount} active status (24h expiry)` : 'Club-wise status lagao — kisi ko nahi pata kisne lagaya'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className="btn-primary"
            style={{ flex: 1, padding: '8px 12px', fontSize: 13 }}
            disabled={clubs.length === 0}
            onClick={() => setShowCreateText(true)}
          >
            <Type size={15} /> Text Status
          </button>
          <button
            type="button"
            className="btn-secondary"
            style={{ flex: 1, padding: '8px 12px', fontSize: 13 }}
            disabled={clubs.length === 0}
            onClick={() => setShowCreateCam(true)}
          >
            <Camera size={15} /> Camera Snap
          </button>
        </div>
      </div>

      {/* Club-Wise Statuses */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8, paddingLeft: 4 }}>
          CLUB UPDATES (24H AUTO-EXPIRE)
        </div>

        {activeGroups.every((g) => g.statuses.length === 0) ? (
          <div className="empty-state-center">
            <div>Abhi kisi club mein status nahi laga hai. Pehla status tum lagao!</div>
          </div>
        ) : (
          activeGroups.map((group) => {
            if (group.statuses.length === 0) return null;
            return (
              <div
                key={group.club_id}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  padding: 12,
                  marginBottom: 10
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <img src={group.club_photo} alt={group.club_name} className="avatar-circle avatar-sm" style={{ width: 26, height: 26 }} />
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{group.club_name}</span>
                  </div>
                  <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                    {group.statuses.length} update{group.statuses.length === 1 ? '' : 's'}
                  </span>
                </div>

                {/* Horizontal Alias Circles (WhatsApp-style rings) */}
                <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 4 }}>
                  {group.statuses.map((st, idx) => (
                    <button
                      key={st.id}
                      type="button"
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, width: 68, flexShrink: 0 }}
                      onClick={() => { setViewerGroup(group); setViewerIdx(idx); }}
                    >
                      <div className={`status-ring ${st.viewed_by_me || st.is_mine ? 'seen' : ''}`}>
                        <div className="status-ring-inner" style={{ background: st.alias_color }}>
                          {st.type === 'image' && st.media_url ? (
                            <img src={resolveMediaUrl(st.media_url)} alt="Status" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            st.alias_name.slice(0, 2).toUpperCase()
                          )}
                        </div>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 600, maxWidth: 68, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {st.is_mine ? 'You' : st.alias_name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Muted Clubs Separate Section (Section 3.5.5) */}
      {mutedGroups.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <VolumeX size={13} /> MUTED CLUBS
          </div>
          {mutedGroups.map((group) => (
            <button
              key={group.club_id}
              type="button"
              className="chat-row"
              style={{ width: '100%', borderRadius: 12, opacity: 0.75 }}
              onClick={() => { setViewerGroup(group); setViewerIdx(0); }}
            >
              <img src={group.club_photo} alt={group.club_name} className="avatar-circle avatar-sm" />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{group.club_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{group.statuses.length} muted status updates</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Create Text Status Modal */}
      {showCreateText && (
        <div className="modal-backdrop" onClick={() => setShowCreateText(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ fontWeight: 700, fontSize: 17 }}>Post Group-Wise Status</div>
              <button className="icon-btn dark-hover" onClick={() => setShowCreateText(false)}><X size={19} /></button>
            </div>
            <form onSubmit={handlePostTextStatus}>
              <div className="field-group">
                <label className="field-label">Select Club (sirf is club ko dikhega)</label>
                <select className="text-input" value={targetClubId} onChange={(e) => setTargetClubId(e.target.value)}>
                  {clubs.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} (as {c.my_alias})</option>
                  ))}
                </select>
              </div>
              <div style={{ borderRadius: 14, background: statusBg, padding: 20, marginBottom: 12 }}>
                <textarea
                  rows={4}
                  placeholder="Kuch anonymous confession ya update likho..."
                  value={statusText}
                  onChange={(e) => setStatusText(e.target.value)}
                  required
                  style={{
                    width: '100%', background: 'transparent', border: 'none', outline: 'none',
                    color: '#fff', fontSize: 18, fontWeight: 700, textAlign: 'center', resize: 'none'
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 16 }}>
                {STATUS_BG_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setStatusBg(c)}
                    style={{
                      width: 28, height: 28, borderRadius: '50%', background: c,
                      border: statusBg === c ? '3px solid var(--text-primary)' : '2px solid transparent'
                    }}
                  />
                ))}
              </div>
              <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={posting}>
                {posting ? 'Posting...' : 'Post Status (24h)'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Create Camera Status Modal */}
      {showCreateCam && (
        <CameraSnapModal
          title="Post Anonymous Camera Status"
          onClose={() => setShowCreateCam(false)}
          onCapture={async ({ media_url, caption }) => {
            const clubId = targetClubId || clubs[0]?.id;
            if (!clubId) return;
            await apiRequest(`/clubs/${clubId}/statuses`, {
              method: 'POST',
              body: { type: 'image', media_url, caption }
            });
            onRefreshStatuses();
            onToast('Camera status 24h ke liye lag gaya!');
          }}
        />
      )}

      {/* Fullscreen Status Viewer (Section 3.5.5) */}
      {viewerGroup && currentStatus && (
        <div className="status-viewer-backdrop">
          <div className="status-viewer-card" style={{ background: currentStatus.bg_color || '#075E54' }}>
            {/* Progress Bars */}
            <div className="status-progress-row">
              {viewerGroup.statuses.map((st, idx) => (
                <div key={st.id} className="status-progress-track">
                  <div
                    className="status-progress-fill"
                    style={{ width: idx < viewerIdx ? '100%' : idx === viewerIdx ? `${progress}%` : '0%' }}
                  />
                </div>
              ))}
            </div>

            {/* Alias Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 36, height: 36, borderRadius: '50%', background: currentStatus.alias_color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13
                  }}
                >
                  {currentStatus.alias_name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>
                    {currentStatus.alias_name} {currentStatus.is_mine ? '(You)' : ''}
                  </div>
                  <div style={{ fontSize: 11.5, opacity: 0.85 }}>
                    {viewerGroup.club_name} • {formatTime(currentStatus.created_at)}
                  </div>
                </div>
              </div>
              <button type="button" className="icon-btn" onClick={() => { setViewerGroup(null); onRefreshStatuses(); }}>
                <X size={21} color="#fff" />
              </button>
            </div>

            {/* Status Content */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, position: 'relative' }}>
              {viewerIdx > 0 && (
                <button
                  type="button"
                  style={{ position: 'absolute', left: 10, padding: 8, background: 'rgba(0,0,0,0.3)', borderRadius: '50%', color: '#fff' }}
                  onClick={() => setViewerIdx((i) => i - 1)}
                >
                  <ChevronLeft size={22} />
                </button>
              )}
              {viewerIdx < viewerGroup.statuses.length - 1 && (
                <button
                  type="button"
                  style={{ position: 'absolute', right: 10, padding: 8, background: 'rgba(0,0,0,0.3)', borderRadius: '50%', color: '#fff' }}
                  onClick={() => setViewerIdx((i) => i + 1)}
                >
                  <ChevronRight size={22} />
                </button>
              )}

              {currentStatus.type === 'image' && currentStatus.media_url ? (
                <>
                  <img
                    src={resolveMediaUrl(currentStatus.media_url)}
                    alt="Status snap"
                    style={{ maxWidth: '100%', maxHeight: '62vh', borderRadius: 12, objectFit: 'contain' }}
                  />
                  {currentStatus.caption && (
                    <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.45)', padding: '8px 14px', borderRadius: 10, fontSize: 15 }}>
                      {currentStatus.caption}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 24, fontWeight: 700, textAlign: 'center', lineHeight: 1.4 }}>
                  {currentStatus.caption}
                </div>
              )}
            </div>

            {/* Footer: View count for poster ONLY, OR Reply as alias box */}
            <div style={{ padding: '12px 14px', background: 'rgba(0,0,0,0.35)' }}>
              {currentStatus.is_mine ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 13.5, fontWeight: 600 }}>
                  <Eye size={17} /> {currentStatus.view_count || 0} anonymous view{currentStatus.view_count === 1 ? '' : 's'} (viewer names hidden)
                </div>
              ) : (
                <form onSubmit={handleSendStatusReply} style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="composer-input"
                    style={{ background: 'rgba(255,255,255,0.18)', color: '#fff', borderColor: 'rgba(255,255,255,0.28)' }}
                    placeholder={`Reply as ${viewerGroup.my_alias}...`}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                  />
                  <button type="submit" className="send-circle">
                    <Send size={17} />
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
