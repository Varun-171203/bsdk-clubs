import React, { useState } from 'react';
import {
  Search, Pin, VolumeX, Archive, MoreVertical, Plus, LogOut, MessageSquarePlus
} from 'lucide-react';
import { formatRelativeDate } from '../api.js';

export function ChatListPane({
  clubs,
  activeClubId,
  onSelectClub,
  onOpenCreateClub,
  onOpenNewChat,
  onUpdateClubPref,
  onLeaveClub
}) {
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [menuClubId, setMenuClubId] = useState(null);

  const archivedCount = clubs.filter((c) => c.is_archived).length;
  const visibleClubs = clubs
    .filter((c) => (showArchived ? c.is_archived : !c.is_archived))
    .filter((c) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        (c.my_alias || '').toLowerCase().includes(q) ||
        (c.last_message?.alias_name || '').toLowerCase().includes(q) ||
        (c.last_message?.body || '').toLowerCase().includes(q)
      );
    });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Search Bar */}
      <div className="search-wrap">
        <div className="search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search chats, clubs or alias..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Archived Strip */}
      {(archivedCount > 0 || showArchived) && (
        <button
          type="button"
          className="chat-row"
          style={{ padding: '10px 16px', background: showArchived ? 'var(--surface-active)' : undefined }}
          onClick={() => setShowArchived((v) => !v)}
        >
          <Archive size={18} color="#128C7E" />
          <div style={{ flex: 1, textAlign: 'left', fontWeight: 600, fontSize: 14 }}>
            {showArchived ? '← Back to Active Chats' : 'Archived Clubs'}
          </div>
          {!showArchived && <span style={{ fontSize: 12.5, fontWeight: 700, color: '#128C7E' }}>{archivedCount}</span>}
        </button>
      )}

      {/* Club Rows */}
      <div className="sidebar-body" onClick={() => setMenuClubId(null)}>
        {visibleClubs.length === 0 ? (
          <div className="empty-state-center">
            <MessageSquarePlus size={44} color="#128C7E" />
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>
              {showArchived ? 'Koi archived club nahi hai' : search ? 'Koi matching club nahi mila' : 'Abhi koi club nahi hai'}
            </div>
            <p style={{ fontSize: 13 }}>
              Apni gang ka private anonymous club banao aur bakcodi start karo!
            </p>
            {!showArchived && !search && (
              <button type="button" className="btn-primary" onClick={onOpenCreateClub}>
                <Plus size={17} /> Pehla Club banao
              </button>
            )}
          </div>
        ) : (
          visibleClubs.map((club) => {
            const isActive = club.id === activeClubId;
            return (
              <div
                key={club.id}
                className={`chat-row ${isActive ? 'active' : ''}`}
                onClick={() => onSelectClub(club.id)}
              >
                <img src={club.photo_url} alt={club.name} className="avatar-circle" />

                <div className="chat-row-main">
                  <div className="chat-row-top">
                    <div className="chat-row-name">{club.name}</div>
                    <div className={`chat-row-time ${club.unread_count > 0 ? 'unread' : ''}`}>
                      {formatRelativeDate(club.last_message?.created_at || club.created_at)}
                    </div>
                  </div>
                  <div className="chat-row-bottom">
                    <div className="chat-row-preview">
                      {club.last_message ? (
                        club.last_message.type === 'system' ? (
                          <em>{club.last_message.body}</em>
                        ) : (
                          <>
                            <span style={{ fontWeight: 600, color: club.last_message.alias_color }}>
                              {club.last_message.alias_name}:
                            </span>{' '}
                            {club.last_message.body}
                          </>
                        )
                      ) : (
                        <span>You are {club.my_alias} here</span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      {club.is_muted && <VolumeX size={14} color="var(--text-secondary)" />}
                      {club.is_pinned && <Pin size={14} color="var(--text-secondary)" />}
                      {club.unread_count > 0 && <span className="unread-pill">{club.unread_count}</span>}
                      <button
                        type="button"
                        className="icon-btn dark-hover"
                        style={{ width: 26, height: 26 }}
                        title="Club options"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuClubId(menuClubId === club.id ? null : club.id);
                        }}
                      >
                        <MoreVertical size={15} color="var(--text-secondary)" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Context Menu (Pin / Mute / Archive / Leave) */}
                {menuClubId === club.id && (
                  <div
                    className="popover-menu"
                    style={{ right: 14, top: 46 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="popover-item"
                      onClick={() => { onUpdateClubPref(club.id, { is_pinned: !club.is_pinned }); setMenuClubId(null); }}
                    >
                      <Pin size={15} /> {club.is_pinned ? 'Unpin Club' : 'Pin Club'}
                    </button>
                    <button
                      type="button"
                      className="popover-item"
                      onClick={() => { onUpdateClubPref(club.id, { is_muted: !club.is_muted }); setMenuClubId(null); }}
                    >
                      <VolumeX size={15} /> {club.is_muted ? 'Unmute Notifications' : 'Mute Notifications'}
                    </button>
                    <button
                      type="button"
                      className="popover-item"
                      onClick={() => { onUpdateClubPref(club.id, { is_archived: !club.is_archived }); setMenuClubId(null); }}
                    >
                      <Archive size={15} /> {club.is_archived ? 'Unarchive' : 'Archive Club'}
                    </button>
                    <button
                      type="button"
                      className="popover-item danger"
                      onClick={() => { setMenuClubId(null); onLeaveClub(club); }}
                    >
                      <LogOut size={15} /> Leave Club
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Green FAB for New Chat / Select Contact */}
      <button
        type="button"
        className="fab"
        title="New Chat / Select Contact"
        onClick={onOpenNewChat || onOpenCreateClub}
      >
        <MessageSquarePlus size={24} />
      </button>
    </div>
  );
}
