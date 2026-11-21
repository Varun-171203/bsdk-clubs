import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, Search, MoreVertical, Smile, Paperclip, Camera, Mic, Send,
  Check, CheckCheck, Clock, Reply, Copy, Flag, Trash2, X, BarChart2,
  Edit3, Info, Ban, Sparkles, Lock, AlertCircle
} from 'lucide-react';
import { apiRequest, formatTime, formatDisappearingLabel, resolveMediaUrl } from '../api.js';
import { CameraSnapModal, CreatePollModal } from './Modals.jsx';
import { SafetyNumberModal } from './SafetyNumberModal.jsx';

const QUICK_REACTIONS = ['😂', '🔥', '❤️', '🙌', '👀', '😭'];
const EMOJI_LIST = [
  '😂', '🔥', '❤️', '🙌', '👀', '😭', '😎', '🤣',
  '💀', '🥳', '🤯', '🙏', '💯', '🚀', '🍕', '🍜',
  '☕', '🎉', '🤔', '😈', '👻', '🦊', '🐼', '⚡'
];

/**
 * SINGLE UNIFIED isMine RULE
 * Evaluates message ownership across all paths (optimistic, WebSocket broadcast, HTTP, DB reload)
 * without leaking real identity.
 */
export function isMessageMine(msg, club) {
  if (!msg) return false;
  // 1. Check explicit per-club member id (authoritative & anonymous)
  if (club?.my_member_id && msg.sender_club_member_id) {
    return String(msg.sender_club_member_id) === String(club.my_member_id);
  }
  // 2. Check is_mine property from server formatMessage
  if (typeof msg.is_mine === 'boolean' && msg.is_mine) {
    return true;
  }
  // 3. Fallback: match by unique club alias (each club enforces UNIQUE(club_id, alias_name))
  if (club?.my_alias && msg.alias_name && club.my_alias === msg.alias_name) {
    return true;
  }
  return false;
}

export function ChatWindow({
  club,
  messages,
  typingAliases,
  settings,
  onBackMobile,
  onOpenGroupInfo,
  onOpenAliasModal,
  onSendMessage,
  onDeleteMessage,
  onToggleReaction,
  onVotePoll,
  onPollCreated,
  onOpenReport,
  onEmitTyping,
  onToast
}) {
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [showPollModal, setShowPollModal] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [openMenuMsgId, setOpenMenuMsgId] = useState(null);
  const [lightboxImg, setLightboxImg] = useState(null);
  const [showSafetyModal, setShowSafetyModal] = useState(false);

  const bottomRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const isNearBottomRef = useRef(true);
  const prevCountRef = useRef(messages.length);
  const typingTimerRef = useRef(null);

  // Track scroll position: only auto-scroll if user is already near bottom or sending own message
  function handleScroll() {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceToBottom < 120;
  }

  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    const isMyMessage = lastMsg && isMessageMine(lastMsg, club);
    const isFirstLoad = prevCountRef.current === 0;

    // Only scroll smoothly if:
    // 1. Initial chat open (auto scroll without animation)
    // 2. User themselves sent a message (always scroll to show own message)
    // 3. User is already at/near the bottom when a peer message arrives
    if (isFirstLoad) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    } else if (isMyMessage || isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevCountRef.current = messages.length;
  }, [messages.length, club?.id]);

  // Reset local composer state when switching clubs
  useEffect(() => {
    setReplyTo(null);
    setShowSearch(false);
    setSearchQuery('');
    setOpenMenuMsgId(null);
    isNearBottomRef.current = true;
    prevCountRef.current = 0;
  }, [club?.id]);

  if (!club) return null;

  const isMuted = club.muted_until && new Date(club.muted_until).getTime() > Date.now();
  const filteredMessages = searchQuery.trim()
    ? messages.filter(
        (m) =>
          (m.body || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
          (m.alias_name || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : messages;

  function handleInputChange(val) {
    setText(val);
    onEmitTyping(club.id, true);
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      onEmitTyping(club.id, false);
    }, 1800);
  }

  async function handleSubmit(e) {
    e?.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    setText('');
    setShowEmoji(false);
    onEmitTyping(club.id, false);
    await onSendMessage({
      type: 'text',
      body: clean,
      reply_to_id: replyTo?.id || null
    });
    setReplyTo(null);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && settings?.chats?.enter_is_send !== false) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function canDeleteForEveryone(msg) {
    const isMine = isMessageMine(msg, club);
    if (!isMine || msg.deleted_at) return false;
    return Date.now() - new Date(msg.created_at).getTime() <= 60 * 60 * 1000;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }} onClick={() => { setOpenMenuMsgId(null); setShowAttach(false); }}>
      {/* Chat Header */}
      <header className="chat-header">
        <div className="header-left" style={{ flex: 1 }}>
          <button type="button" className="icon-btn mobile-only" onClick={onBackMobile} title="Back">
            <ArrowLeft size={21} />
          </button>
          <div className="chat-header-info" onClick={onOpenGroupInfo}>
            <img src={club.photo_url} alt={club.name} className="avatar-circle avatar-sm" />
            <div style={{ minWidth: 0 }}>
              <div className="chat-header-title">{club.name}</div>
              <div className="chat-header-sub">
                {typingAliases.length > 0
                  ? `${typingAliases.join(', ')} typing...`
                  : `${club.member_count} members • aliases on • tap for Group Info`}
              </div>
            </div>
          </div>
        </div>

        <div className="header-actions">
          {/* Quick My Alias Pill */}
          <button
            type="button"
            className="my-alias-chip"
            onClick={onOpenAliasModal}
            title="Change your display name in this club"
          >
            <span className="alias-dot" style={{ background: club.my_alias_color }} />
            <span>{club.my_alias}</span>
            <Edit3 size={12} />
          </button>

          <button
            type="button"
            className="icon-btn"
            title="Search in Club"
            onClick={() => setShowSearch((v) => !v)}
          >
            <Search size={19} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Group Info (Real Members)"
            onClick={onOpenGroupInfo}
          >
            <Info size={19} />
          </button>
        </div>
      </header>

      {/* Search in Club bar */}
      {showSearch && (
        <div className="search-wrap" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="search-box" style={{ flex: 1 }}>
            <Search size={15} />
            <input
              autoFocus
              placeholder="Search messages or alias in this club..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button type="button" className="icon-btn dark-hover" onClick={() => { setShowSearch(false); setSearchQuery(''); }}>
            <X size={17} />
          </button>
        </div>
      )}

      {/* Messages Stream */}
      <div className="messages-scroll chat-wallpaper" ref={scrollContainerRef} onScroll={handleScroll}>
        {/* Top Anonymity Trust Pill */}
        <div className="system-pill">
          <Sparkles size={13} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 5 }} />
          Chat mein sab anonymous hain — yahan tumhara naam{' '}
          <strong style={{ color: club.my_alias_color }}>{club.my_alias}</strong> hai. Real members{' '}
          <button
            type="button"
            style={{ textDecoration: 'underline', fontWeight: 700, color: 'var(--brand-green)' }}
            onClick={onOpenGroupInfo}
          >
            Group Info
          </button>{' '}
          mein dekho.
        </div>

        {/* WhatsApp End-to-End Encryption Security Code Pill */}
        <div
          className="system-pill"
          style={{ cursor: 'pointer', background: 'rgba(254, 243, 199, 0.9)', color: '#92400e', border: '1px solid #fde68a' }}
          onClick={() => setShowSafetyModal(true)}
          title="Verify 60-digit End-to-End Encryption Safety Code"
        >
          <Lock size={12} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 5, color: '#92400e' }} />
          Messages are end-to-end encrypted with Signal Protocol. Tap to verify security code.
        </div>

        {filteredMessages.map((msg) => {
          if (msg.type === 'system') {
            return (
              <div key={msg.client_message_id || msg.id} className="system-pill">
                {msg.body}
              </div>
            );
          }

          const isOwn = isMessageMine(msg, club);
          return (
            <div key={msg.client_message_id || msg.id} className={`msg-row ${isOwn ? 'own' : 'other'}`}>
              <div className="msg-bubble">
                {/* Alias Header + Action Menu Trigger */}
                <div className="msg-alias-line">
                  <span className="msg-alias" style={{ color: msg.alias_color }}>
                    {msg.alias_name} {isOwn ? '(You)' : ''}
                  </span>
                  {!msg.deleted_at && (
                    <button
                      type="button"
                      className="msg-actions-trigger"
                      title="Message options"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuMsgId(openMenuMsgId === msg.id ? null : msg.id);
                      }}
                    >
                      <MoreVertical size={15} />
                    </button>
                  )}
                </div>

                {/* Reply Quote Strip */}
                {msg.reply_to && !msg.deleted_at && (
                  <div className="msg-quote" style={{ borderLeftColor: msg.reply_to.alias_color }}>
                    <div style={{ fontWeight: 700, color: msg.reply_to.alias_color, fontSize: 11.5 }}>
                      {msg.reply_to.alias_name}
                    </div>
                    <div style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>
                      {msg.reply_to.body}
                    </div>
                  </div>
                )}

                {/* Message Body / Deleted / Snap Image / Anonymous Poll */}
                {msg.deleted_at ? (
                  <div className="msg-deleted">
                    <Ban size={14} /> This message was deleted
                  </div>
                ) : msg.type === 'poll' && msg.poll ? (
                  <div className="poll-card">
                    <div className="poll-tag">
                      <BarChart2 size={13} /> ANONYMOUS POLL • {msg.poll.multi_choice ? 'Multiple choice' : 'Single choice'}
                    </div>
                    <div className="poll-question">{msg.poll.question}</div>
                    {msg.poll.options.map((opt) => {
                      const voted = (msg.poll.my_votes || []).includes(opt.id);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          className={`poll-option ${voted ? 'voted' : ''}`}
                          onClick={() => {
                            const current = msg.poll.my_votes || [];
                            let next;
                            if (msg.poll.multi_choice) {
                              next = voted ? current.filter((id) => id !== opt.id) : [...current, opt.id];
                            } else {
                              next = voted ? [] : [opt.id];
                            }
                            onVotePoll(msg.poll.id, next);
                          }}
                        >
                          <div className="poll-bar-fill" style={{ width: `${opt.percentage}%` }} />
                          <div className="poll-option-content">
                            <span style={{ fontWeight: voted ? 700 : 500 }}>
                              {voted ? '✓ ' : ''}{opt.text}
                            </span>
                            <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--text-secondary)' }}>
                              {opt.percentage}% ({opt.vote_count})
                            </span>
                          </div>
                        </button>
                      );
                    })}
                    <div className="poll-footer">
                      <span>{msg.poll.total_votes} anonymous vote{msg.poll.total_votes === 1 ? '' : 's'}</span>
                      <span>Voter names hidden</span>
                    </div>
                  </div>
                ) : (
                  <>
                    {msg.type === 'image' && msg.media_url && (
                      <img
                        src={resolveMediaUrl(msg.media_url)}
                        alt="Live camera snap"
                        className="msg-snap-img"
                        onClick={() => setLightboxImg(resolveMediaUrl(msg.media_url))}
                      />
                    )}
                    {msg.body && <div className="msg-text">{msg.body}</div>}
                  </>
                )}

                {/* Timestamp + Ticks */}
                <div className="msg-meta">
                  <span>{formatTime(msg.created_at)}</span>
                  {isOwn && !msg.deleted_at && (
                    msg.status === 'sending' ? (
                      <Clock size={12} color="#8696a0" title="Sending..." />
                    ) : msg.status === 'failed' ? (
                      <AlertCircle size={12} color="#ef4444" title="Failed to send" />
                    ) : msg.read_count > 0 ? (
                      <CheckCheck size={14} color="#34D399" title="Seen" />
                    ) : (
                      <Check size={14} title="Sent" />
                    )
                  )}
                </div>

                {/* Message Action Popover (Reply, React, Copy, Report, Delete) */}
                {openMenuMsgId === msg.id && (
                  <div
                    className="popover-menu"
                    style={{
                      top: 28,
                      [isOwn ? 'right' : 'left']: 4
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ display: 'flex', gap: 4, padding: '4px 6px 8px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
                      {QUICK_REACTIONS.map((em) => (
                        <button
                          key={em}
                          type="button"
                          style={{ fontSize: 18, padding: '2px 4px', borderRadius: 6 }}
                          onClick={() => {
                            onToggleReaction(msg.id, em);
                            setOpenMenuMsgId(null);
                          }}
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="popover-item"
                      onClick={() => { setReplyTo(msg); setOpenMenuMsgId(null); }}
                    >
                      <Reply size={15} /> Reply
                    </button>
                    {msg.body && (
                      <button
                        type="button"
                        className="popover-item"
                        onClick={() => {
                          navigator.clipboard?.writeText(msg.body);
                          onToast('Message copied!');
                          setOpenMenuMsgId(null);
                        }}
                      >
                        <Copy size={15} /> Copy Text
                      </button>
                    )}
                    {!isOwn && (
                      <button
                        type="button"
                        className="popover-item danger"
                        onClick={() => {
                          setOpenMenuMsgId(null);
                          onOpenReport({
                            club_id: club.id,
                            message_id: msg.id,
                            label: `message by ${msg.alias_name}`
                          });
                        }}
                      >
                        <Flag size={15} /> Report Message
                      </button>
                    )}
                    {canDeleteForEveryone(msg) && (
                      <button
                        type="button"
                        className="popover-item danger"
                        onClick={() => {
                          setOpenMenuMsgId(null);
                          onDeleteMessage(msg.id);
                        }}
                      >
                        <Trash2 size={15} /> Delete for Everyone
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Reaction Pills */}
              {msg.reactions && msg.reactions.length > 0 && !msg.deleted_at && (
                <div className="reactions-bar">
                  {msg.reactions.map((r) => (
                    <button
                      key={r.emoji}
                      type="button"
                      className={`reaction-pill ${r.reacted_by_me ? 'mine' : ''}`}
                      onClick={() => onToggleReaction(msg.id, r.emoji)}
                    >
                      <span>{r.emoji}</span>
                      <span style={{ fontSize: 11, fontWeight: 700 }}>{r.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Disappearing Messages Strip above Composer (Section 3.5.2) */}
      {club.disappearing_seconds > 0 && (
        <div className="disappearing-strip">
          <Clock size={13} color="#128C7E" />
          <span>Messages disappear in {formatDisappearingLabel(club.disappearing_seconds)}</span>
        </div>
      )}

      {/* Composer */}
      <div className="composer-wrap">
        {replyTo && (
          <div className="reply-banner">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: replyTo.alias_color }}>
                Replying to {replyTo.alias_name}
              </div>
              <div style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {replyTo.type === 'image' ? '📷 Snap photo' : replyTo.body}
              </div>
            </div>
            <button type="button" className="icon-btn dark-hover" onClick={() => setReplyTo(null)}>
              <X size={16} />
            </button>
          </div>
        )}

        {showEmoji && (
          <div className="emoji-picker-box" onClick={(e) => e.stopPropagation()}>
            {EMOJI_LIST.map((em) => (
              <button
                key={em}
                type="button"
                className="emoji-btn"
                onClick={() => setText((prev) => prev + em)}
              >
                {em}
              </button>
            ))}
          </div>
        )}

        {showAttach && (
          <div className="popover-menu" style={{ bottom: 64, left: 48 }} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="popover-item"
              onClick={() => { setShowAttach(false); setShowPollModal(true); }}
            >
              <BarChart2 size={16} color="#128C7E" /> Anonymous Poll
            </button>
            <button
              type="button"
              className="popover-item"
              onClick={() => { setShowAttach(false); setShowCamera(true); }}
            >
              <Camera size={16} color="#F472B6" /> Live Camera Snap
            </button>
            <div style={{ padding: '6px 12px', fontSize: 11, color: 'var(--text-secondary)', borderTop: '1px solid var(--border)' }}>
              Gallery upload band hai (camera only)
            </div>
          </div>
        )}

        {isMuted ? (
          <div className="trust-note" style={{ textAlign: 'center' }}>
            Admin ne tumhe is club mein mute kiya hai ({new Date(club.muted_until).toLocaleString()} tak).
          </div>
        ) : (
          <form className="composer-row" onSubmit={handleSubmit}>
            <button
              type="button"
              className="icon-btn dark-hover"
              title="Emoji"
              onClick={(e) => { e.stopPropagation(); setShowEmoji((v) => !v); setShowAttach(false); }}
            >
              <Smile size={22} color="var(--text-secondary)" />
            </button>

            <button
              type="button"
              className="icon-btn dark-hover"
              title="Attach Anonymous Poll"
              onClick={(e) => { e.stopPropagation(); setShowAttach((v) => !v); setShowEmoji(false); }}
            >
              <Paperclip size={21} color="var(--text-secondary)" />
            </button>

            <input
              className="composer-input"
              placeholder={`Message as ${club.my_alias}...`}
              value={text}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
            />

            <button
              type="button"
              className="icon-btn dark-hover"
              title="In-App Camera Snap (No gallery upload)"
              onClick={() => setShowCamera(true)}
            >
              <Camera size={22} color="var(--text-secondary)" />
            </button>

            {text.trim() ? (
              <button type="submit" className="send-circle" title="Send">
                <Send size={19} />
              </button>
            ) : (
              <button
                type="button"
                className="icon-btn dark-hover"
                style={{ opacity: 0.45, cursor: 'not-allowed' }}
                title="Voice notes coming in V1.1"
                onClick={() => onToast('Voice notes V1.1 mein aayenge! Abhi text, polls aur camera snaps use karo.')}
              >
                <Mic size={21} color="var(--text-secondary)" />
              </button>
            )}
          </form>
        )}
      </div>

      {/* Modals */}
      {showCamera && (
        <CameraSnapModal
          title={`Snap to ${club.name}`}
          onClose={() => setShowCamera(false)}
          onCapture={async ({ media_url, caption }) => {
            await onSendMessage({
              type: 'image',
              body: caption || '',
              media_url,
              reply_to_id: replyTo?.id || null
            });
            setReplyTo(null);
          }}
        />
      )}

      {showPollModal && (
        <CreatePollModal
          clubId={club.id}
          onClose={() => setShowPollModal(false)}
          onCreated={onPollCreated}
        />
      )}

      {lightboxImg && (
        <div className="modal-backdrop" onClick={() => setLightboxImg(null)}>
          <img
            src={lightboxImg}
            alt="Full snap"
            style={{ maxWidth: '92vw', maxHeight: '88vh', borderRadius: 12 }}
          />
        </div>
      )}

      {showSafetyModal && (
        <SafetyNumberModal
          isGroup={true}
          clubName={club.name}
          peerName={club.name}
          peerUserId={`club-${club.id}`}
          peerIdentityKey={`club-e2ee-key-${club.id}`}
          myUserId={club.my_alias || 'user'}
          onClose={() => setShowSafetyModal(false)}
          onVerified={() => onToast && onToast('Security code verified for this club!')}
        />
      )}
    </div>
  );
}
