import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import {
  MessageCircle, Users, Disc, Phone, MoreVertical, Settings, Plus, Camera, Sparkles
} from 'lucide-react';
import {
  apiRequest, getStoredAuth, setStoredAuth, getServerBaseUrl,
  initAuthSession, getCachedClubs, setCachedClubs, getCachedMessages,
  setCachedMessages, silentRefreshSession
} from './api.js';
import { App as CapApp } from '@capacitor/app';
import { BrandLogo } from './components/BrandLogo.jsx';
import { WhatsAppAuthFlow } from './components/WhatsAppAuthFlow.jsx';
import { ChatListPane } from './components/ChatListPane.jsx';
import { ChatWindow, isMessageMine } from './components/ChatWindow.jsx';
import { GroupInfoDrawer } from './components/GroupInfoDrawer.jsx';
import { ClubsPane } from './components/ClubsPane.jsx';
import { UpdatesPane } from './components/UpdatesPane.jsx';
import { CallsPane } from './components/CallsPane.jsx';
import { CallScreen } from './components/CallScreen.jsx';
import { SettingsPane } from './components/SettingsPane.jsx';
import { CreateClubModal, AliasModal, ReportModal, CameraSnapModal } from './components/Modals.jsx';
import { NewChatModal } from './components/NewChatModal.jsx';
import { JoinViaCodeModal } from './components/JoinViaCodeModal.jsx';
import { ClubJoinModal } from './components/ClubJoinModal.jsx';
import {
  parseInviteUri,
  savePendingInvite,
  getPendingInvite,
  applyPendingInvite
} from './services/inviteService.js';

const DEFAULT_SETTINGS = {
  account: { security_notifications: true, two_step_pin_enabled: false },
  privacy: {
    last_seen: 'My Clubs',
    profile_photo: 'My Clubs',
    about: 'My Clubs',
    status_visibility: 'My Clubs',
    read_receipts: true,
    disappearing_default: 604800,
    screenshot_block: false
  },
  chats: { theme: 'light', wallpaper: 'classic', font_size: 'medium', enter_is_send: true, media_visibility: true },
  notifications: {
    message_notifications: true,
    group_notifications: true,
    notification_tone: 'Default (Chime)',
    vibrate: true,
    popup: true,
    show_preview: true,
    reaction_notifications: true
  },
  storage: { auto_download_wifi: true, auto_download_mobile: false },
  language: 'English'
};

export default function App() {
  const [auth, setAuth] = useState(() => getStoredAuth());
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('bsdk_settings');
      return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [activeTab, setActiveTab] = useState('chats'); // 'chats' | 'clubs' | 'updates' | 'calls'
  const [clubs, setClubs] = useState(() => getCachedClubs());
  const [activeClubId, setActiveClubId] = useState(null);
  const [messagesByClub, setMessagesByClub] = useState({});
  const [statusGroups, setStatusGroups] = useState([]);
  const [typingMap, setTypingMap] = useState({}); // { clubId: [aliasName] }

  // Views & Drawers
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);
  const [showCreateClub, setShowCreateClub] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showQuickStatusCam, setShowQuickStatusCam] = useState(false);
  const [aliasModalClub, setAliasModalClub] = useState(null);
  const [reportTarget, setReportTarget] = useState(null);
  const [joinViaCode, setJoinViaCode] = useState(null);
  const [pendingClubInvite, setPendingClubInvite] = useState(null);
  const [toast, setToast] = useState('');
  const [sessionRevoked, setSessionRevoked] = useState(false);
  const [activeCallSession, setActiveCallSession] = useState(null);

  const socketRef = useRef(null);
  const toastTimerRef = useRef(null);
  const clubsRef = useRef(clubs);
  clubsRef.current = clubs;
  const activeClubIdRef = useRef(activeClubId);
  activeClubIdRef.current = activeClubId;

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), 3200);
  }, []);

  // Apply WhatsApp-style Light (default) / Dark theme, Wallpaper & Font Size tokens
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', settings?.chats?.theme || 'light');
    root.setAttribute('data-wallpaper', settings?.chats?.wallpaper || 'classic');
    root.setAttribute('data-font', settings?.chats?.font_size || 'medium');
    localStorage.setItem('bsdk_settings', JSON.stringify(settings));
  }, [settings]);

  // Persistent Session Initialization from Native SharedPreferences on Boot
  useEffect(() => {
    let mounted = true;
    initAuthSession().then((persistedAuth) => {
      if (!mounted) return;
      if (persistedAuth) {
        setAuth(persistedAuth);
        const cached = getCachedClubs();
        if (cached && cached.length > 0) {
          setClubs(cached);
          setActiveClubId((prev) => prev || cached[0]?.id || null);
        }
        silentRefreshSession().then(() => {
          if (mounted) loadClubs();
        }).catch((err) => {
          if (err.code === 'SESSION_REVOKED') {
            setSessionRevoked(true);
            setStoredAuth(null);
            setAuth(null);
          }
        });
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  // Deep Link Listener: Handles WhatsApp-style links, QR scans and Android intents
  useEffect(() => {
    function checkInviteUrl(urlStr) {
      if (!urlStr) return;
      const match = String(urlStr).match(/(?:club\/join\/|invite\/|join\/|bsdk:invite:)([A-Za-z0-9_-]+)/i);
      if (match && match[1]) {
        setPendingClubInvite(match[1].toUpperCase());
      }
    }

    checkInviteUrl(window.location.href);

    let capSub = null;
    try {
      capSub = CapApp.addListener('appUrlOpen', (event) => {
        checkInviteUrl(event.url);
      });
    } catch {}

    const onDeepLink = (e) => {
      const target = e.detail?.url || e.detail?.code;
      if (target) checkInviteUrl(target);
    };
    window.addEventListener('bsdk:deeplink', onDeepLink);

    return () => {
      if (capSub && capSub.remove) capSub.remove();
      window.removeEventListener('bsdk:deeplink', onDeepLink);
    };
  }, []);

  const loadClubs = useCallback(async () => {
    if (!auth?.access_token) return;
    try {
      const data = await apiRequest('/clubs');
      const newClubs = data.clubs || [];
      setClubs(newClubs);
      setCachedClubs(newClubs);
      setActiveClubId((prev) => {
        if (prev && newClubs.some((c) => c.id === prev)) return prev;
        return newClubs[0]?.id || null;
      });
    } catch (err) {
      if (err.code === 'SESSION_REVOKED') {
        setSessionRevoked(true);
        setStoredAuth(null);
        setAuth(null);
        return;
      }
      // Never wipe auth on network lag or 401: stay logged in with cached clubs!
      console.warn('[loadClubs network warning]', err);
    }
  }, [auth?.access_token]);

  const loadStatuses = useCallback(async () => {
    if (!auth?.access_token) return;
    try {
      const data = await apiRequest('/statuses');
      setStatusGroups(data.clubs || []);
    } catch { /* ignore */ }
  }, [auth?.access_token]);

  const loadSettings = useCallback(async () => {
    if (!auth?.access_token) return;
    try {
      const data = await apiRequest('/settings');
      if (data.settings) setSettings(data.settings);
    } catch { /* ignore */ }
  }, [auth?.access_token]);

  const loadMessages = useCallback(async (clubId) => {
    if (!clubId || !auth?.access_token) return;
    // Show cached messages immediately
    const cached = getCachedMessages(clubId);
    if (cached && cached.length > 0) {
      setMessagesByClub((prev) => ({ ...prev, [clubId]: cached }));
    }
    try {
      const data = await apiRequest(`/clubs/${clubId}/messages?limit=80`);
      const msgs = data.messages || [];
      setMessagesByClub((prev) => ({ ...prev, [clubId]: msgs }));
      setCachedMessages(clubId, msgs);
      // Clear local unread count for this club
      setClubs((prev) => prev.map((c) => (c.id === clubId ? { ...c, unread_count: 0 } : c)));
      // Mark latest message read
      const last = msgs.slice(-1)[0];
      if (last && !last.is_mine) {
        apiRequest(`/messages/${last.id}/read`, { method: 'POST' }).catch(() => {});
      }
    } catch (err) {
      console.warn('[loadMessages warning]', err);
    }
  }, [auth?.access_token]);

  // Initial load after login
  useEffect(() => {
    if (!auth?.access_token) return;
    loadClubs();
    loadStatuses();
    loadSettings();
  }, [auth?.access_token, loadClubs, loadStatuses, loadSettings]);

  // Load messages when activeClubId changes
  useEffect(() => {
    if (activeClubId) {
      loadMessages(activeClubId);
    }
  }, [activeClubId, loadMessages]);

  // Setup Realtime Socket.IO Gateway
  useEffect(() => {
    if (!auth?.access_token) return;
    const serverUrl = getServerBaseUrl();
    const socket = io(serverUrl || undefined, {
      path: '/ws',
      auth: { token: auth.access_token }
    });
    socketRef.current = socket;

    socket.on('message.new', ({ club_id, message }) => {
      setMessagesByClub((prev) => {
        const list = prev[club_id] || [];
        const currentClub = clubsRef.current?.find((c) => c.id === club_id);
        const isMine = isMessageMine(message, currentClub);
        const normalizedMsg = { ...message, is_mine: isMine, status: 'sent' };

        // 1. Deduplicate by client_message_id first (sent optimistically)
        if (message.client_message_id) {
          const idx = list.findIndex(
            (m) => m.client_message_id === message.client_message_id || m.id === message.client_message_id
          );
          if (idx !== -1) {
            const updated = [...list];
            updated[idx] = {
              ...list[idx],
              ...normalizedMsg,
              is_mine: true, // Keep sender's own message on the right
              status: 'sent'
            };
            return { ...prev, [club_id]: updated };
          }
        }

        // 2. Deduplicate by server message id
        const idIdx = list.findIndex((m) => m.id === message.id);
        if (idIdx !== -1) {
          const updated = [...list];
          updated[idIdx] = {
            ...list[idIdx],
            ...normalizedMsg,
            is_mine: list[idIdx].is_mine || isMine
          };
          return { ...prev, [club_id]: updated };
        }

        // 3. New message arrival: append cleanly without full list re-render
        return { ...prev, [club_id]: [...list, normalizedMsg] };
      });

      // Update club metadata locally without full HTTP reload & flicker
      setClubs((prev) =>
        prev.map((c) => {
          if (c.id !== club_id) return c;
          const isMine = isMessageMine(message, c);
          const isCurrentActive = activeClubIdRef.current === club_id;
          return {
            ...c,
            last_message: {
              body: message.type === 'poll' ? '📊 Poll' : message.body,
              alias_name: message.alias_name,
              created_at: message.created_at
            },
            unread_count: isCurrentActive || isMine ? 0 : (c.unread_count || 0) + 1
          };
        })
      );
    });

    socket.on('message.deleted', ({ club_id, message_id, deleted_at }) => {
      setMessagesByClub((prev) => ({
        ...prev,
        [club_id]: (prev[club_id] || []).map((m) =>
          m.id === message_id ? { ...m, body: 'This message was deleted', media_url: null, deleted_at } : m
        )
      }));
    });

    socket.on('message.reaction', ({ club_id, message_id, reactions }) => {
      setMessagesByClub((prev) => ({
        ...prev,
        [club_id]: (prev[club_id] || []).map((m) => {
          if (m.id !== message_id) return m;
          const prevMine = new Set((m.reactions || []).filter((r) => r.reacted_by_me).map((r) => r.emoji));
          return {
            ...m,
            reactions: reactions.map((r) => ({ ...r, reacted_by_me: prevMine.has(r.emoji) }))
          };
        })
      }));
    });

    socket.on('poll.updated', ({ club_id, poll }) => {
      setMessagesByClub((prev) => ({
        ...prev,
        [club_id]: (prev[club_id] || []).map((m) =>
          m.poll?.id === poll.id
            ? { ...m, poll: { ...poll, my_votes: m.poll.my_votes || [] } }
            : m
        )
      }));
    });

    socket.on('status.new', () => {
      loadStatuses();
    });

    socket.on('member.joined', () => {
      loadClubs();
    });

    socket.on('member.removed', () => {
      loadClubs();
    });

    socket.on('typing', ({ club_id, alias_name, is_typing }) => {
      setTypingMap((prev) => {
        const current = new Set(prev[club_id] || []);
        if (is_typing) current.add(alias_name);
        else current.delete(alias_name);
        return { ...prev, [club_id]: Array.from(current) };
      });
    });

    socket.on('call:incoming', (incomingData) => {
      const incomingSession = {
        mode: 'incoming',
        callType: incomingData.call_type || 'voice',
        roomId: incomingData.room_id,
        peer: !incomingData.is_group ? {
          id: incomingData.caller_id,
          name: incomingData.caller_name || 'Caller',
          photo_url: incomingData.caller_avatar
        } : null,
        club: incomingData.is_group ? (clubsRef.current?.find((c) => c.id === incomingData.club_id) || { id: incomingData.club_id, name: 'Club Voice Call' }) : null,
        isGroup: Boolean(incomingData.is_group)
      };
      setActiveCallSession(incomingSession);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [auth?.access_token, loadClubs, loadStatuses]);

  // Deep link listener & deferred invite code detection
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const parsed = parseInviteUri(window.location.href);
      if (parsed?.code) {
        if (!auth?.access_token) {
          savePendingInvite(parsed.code);
        } else {
          setJoinViaCode(parsed.code);
        }
      }
    }
  }, [auth?.access_token]);

  async function handleAuthenticated(authData) {
    setStoredAuth(authData);
    setAuth(authData);
    showToast(`Welcome back, ${authData.user.real_name}!`);

    // Deferred invite code application after OTP login
    const pending = getPendingInvite();
    if (pending?.code) {
      try {
        const joinRes = await applyPendingInvite(apiRequest);
        if (joinRes?.success) {
          showToast(`Joined club "${joinRes.club.name}" from invite link!`);
          loadClubs();
        } else {
          setJoinViaCode(pending.code);
        }
      } catch {
        setJoinViaCode(pending.code);
      }
    }
  }

  function handleLogout() {
    setStoredAuth(null);
    setAuth(null);
    setClubs([]);
    setActiveClubId(null);
    setShowSettings(false);
    setShowGroupInfo(false);
  }

  async function handleStartCall(target, callType = 'voice', isGroup = false) {
    if (!auth?.access_token) return;
    try {
      const res = await apiRequest('/calls/token', {
        method: 'POST',
        body: JSON.stringify({
          callee_id: !isGroup ? (target?.id || target?.user_id) : undefined,
          club_id: isGroup ? target?.id : undefined,
          call_type: callType
        })
      });

      if (!res || !res.token) {
        showToast(res?.error?.message || 'Could not initiate call.');
        return;
      }

      const session = {
        mode: 'outgoing',
        callType,
        roomId: res.room_id,
        token: res.token,
        peer: !isGroup ? target : null,
        club: isGroup ? target : null,
        isGroup
      };

      setActiveCallSession(session);

      socketRef.current?.emit('call:initiate', {
        room_id: res.room_id,
        to_user_id: !isGroup ? (target?.id || target?.user_id) : null,
        club_id: isGroup ? target?.id : null,
        call_type: callType,
        caller_name: auth.user.real_name || 'Contact',
        caller_avatar: auth.user.profile_photo_url,
        caller_alias: isGroup ? (target?.my_alias || 'Member') : null,
        caller_alias_color: isGroup ? (target?.my_alias_color || '#128C7E') : null
      });
    } catch (err) {
      console.error('[Start Call Error]', err);
      showToast(err?.message || 'Failed to start call.');
    }
  }

  async function handleUpdateSettings(patch) {
    // Optimistic merge
    setSettings((prev) => ({
      account: { ...prev.account, ...(patch.account || {}) },
      privacy: { ...prev.privacy, ...(patch.privacy || {}) },
      chats: { ...prev.chats, ...(patch.chats || {}) },
      notifications: { ...prev.notifications, ...(patch.notifications || {}) },
      storage: { ...prev.storage, ...(patch.storage || {}) },
      language: patch.language || prev.language
    }));
    try {
      const data = await apiRequest('/settings', { method: 'PATCH', body: patch });
      if (data.settings) setSettings(data.settings);
    } catch (err) {
      showToast(err.message);
    }
  }

  async function handleSendMessage({ type, body, media_url, reply_to_id }) {
    if (!activeClubId) return;
    const currentClub = clubsRef.current?.find((c) => c.id === activeClubId);
    const clientMessageId = `cmsg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const optimisticMsg = {
      id: clientMessageId,
      client_message_id: clientMessageId,
      club_id: activeClubId,
      sender_club_member_id: currentClub?.my_member_id || null,
      alias_name: currentClub?.my_alias || 'You',
      alias_color: currentClub?.my_alias_color || '#128C7E',
      type,
      body,
      media_url,
      reply_to_id: reply_to_id || null,
      reply_to: null,
      reactions: [],
      poll: null,
      created_at: new Date().toISOString(),
      is_mine: true,
      status: 'sending'
    };

    // 1. Instantly append on the right in green (#D9FDD3)
    setMessagesByClub((prev) => {
      const list = prev[activeClubId] || [];
      return { ...prev, [activeClubId]: [...list, optimisticMsg] };
    });

    // 2. Update last message in club list locally without HTTP refetch
    setClubs((prev) =>
      prev.map((c) =>
        c.id === activeClubId
          ? {
              ...c,
              last_message: {
                body,
                alias_name: currentClub?.my_alias || 'You',
                created_at: optimisticMsg.created_at
              }
            }
          : c
      )
    );

    try {
      const data = await apiRequest(`/clubs/${activeClubId}/messages`, {
        method: 'POST',
        body: { type, body, media_url, reply_to_id, client_message_id: clientMessageId }
      });

      // 3. Reconcile optimistic item with server confirmation (keep is_mine: true, never jump to left)
      setMessagesByClub((prev) => {
        const list = prev[activeClubId] || [];
        const idx = list.findIndex(
          (m) => m.client_message_id === clientMessageId || m.id === clientMessageId || m.id === data.message.id
        );
        if (idx !== -1) {
          const updated = [...list];
          updated[idx] = {
            ...list[idx],
            ...data.message,
            is_mine: true,
            status: 'sent'
          };
          return { ...prev, [activeClubId]: updated };
        }
        return {
          ...prev,
          [activeClubId]: [...list, { ...data.message, is_mine: true, status: 'sent' }]
        };
      });
    } catch (err) {
      showToast(err.message || 'Failed to send message');
      setMessagesByClub((prev) => {
        const list = prev[activeClubId] || [];
        return {
          ...prev,
          [activeClubId]: list.map((m) =>
            m.client_message_id === clientMessageId ? { ...m, status: 'failed' } : m
          )
        };
      });
    }
  }

  async function handleDeleteMessage(msgId) {
    try {
      const data = await apiRequest(`/messages/${msgId}`, { method: 'DELETE' });
      setMessagesByClub((prev) => ({
        ...prev,
        [activeClubId]: (prev[activeClubId] || []).map((m) =>
          m.id === msgId ? { ...m, body: 'This message was deleted', media_url: null, deleted_at: data.deleted_at } : m
        )
      }));
      setClubs((prev) =>
        prev.map((c) =>
          c.id === activeClubId && c.last_message
            ? { ...c, last_message: { ...c.last_message, body: 'This message was deleted' } }
            : c
        )
      );
      showToast('Message deleted for everyone.');
    } catch (err) {
      showToast(err.message);
    }
  }

  async function handleToggleReaction(msgId, emoji) {
    try {
      const data = await apiRequest(`/messages/${msgId}/reactions`, {
        method: 'POST',
        body: { emoji }
      });
      setMessagesByClub((prev) => ({
        ...prev,
        [activeClubId]: (prev[activeClubId] || []).map((m) =>
          m.id === msgId ? { ...m, reactions: data.reactions } : m
        )
      }));
    } catch (err) {
      showToast(err.message);
    }
  }

  async function handleVotePoll(pollId, optionIds) {
    try {
      const data = await apiRequest(`/polls/${pollId}/vote`, {
        method: 'POST',
        body: { option_ids: optionIds }
      });
      setMessagesByClub((prev) => ({
        ...prev,
        [activeClubId]: (prev[activeClubId] || []).map((m) =>
          m.poll?.id === pollId ? { ...m, poll: data.poll } : m
        )
      }));
    } catch (err) {
      showToast(err.message);
    }
  }

  async function handleUpdateClubPref(clubId, prefs) {
    try {
      const updated = await apiRequest(`/clubs/${clubId}/prefs`, { method: 'PATCH', body: prefs });
      setClubs((prev) => prev.map((c) => (c.id === clubId ? { ...c, ...updated } : c)));
      showToast('Club preferences updated.');
    } catch (err) {
      showToast(err.message);
    }
  }

  async function handleLeaveClub(club) {
    if (!window.confirm(`Are you sure you want to leave "${club.name}"?`)) return;
    try {
      await apiRequest(`/clubs/${club.id}/leave`, { method: 'POST' });
      setShowGroupInfo(false);
      if (activeClubId === club.id) setActiveClubId(null);
      await loadClubs();
      showToast(`You left ${club.name}.`);
    } catch (err) {
      showToast(err.message);
    }
  }

  if (sessionRevoked) {
    return (
      <div className="wa-app-container">
        <div className="wa-modal-backdrop">
          <div className="wa-confirm-dialog" style={{ textAlign: 'center' }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: '#075E54', marginBottom: 10 }}>
              Logged out
            </h3>
            <p style={{ fontSize: 13.5, color: '#667781', lineHeight: 1.5, marginBottom: 20 }}>
              You have been logged out because your phone number was registered on another device.
            </p>
            <button
              type="button"
              className="wa-btn-primary wa-btn-block"
              onClick={() => {
                setSessionRevoked(false);
                setAuth(null);
              }}
            >
              LOG IN AGAIN
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!auth?.access_token) {
    return <WhatsAppAuthFlow onAuthenticated={handleAuthenticated} />;
  }

  const activeClub = clubs.find((c) => c.id === activeClubId) || null;
  const totalUnread = clubs.reduce((sum, c) => sum + (c.is_archived ? 0 : (c.unread_count || 0)), 0);
  const totalStatuses = statusGroups.reduce((sum, g) => sum + g.statuses.filter((s) => !s.viewed_by_me && !s.is_mine).length, 0);

  // Mobile state: show right pane if a club is selected or settings is open
  const mobileShowRight = Boolean(showSettings || (activeTab === 'chats' && activeClub));

  return (
    <div className="wa-app-container">
      <div className="app-shell" onClick={() => setShowOverflow(false)}>
      {/* ================= LEFT SIDEBAR ================= */}
      <aside className={`sidebar ${mobileShowRight ? 'mobile-hidden' : ''}`}>
        {/* Top App Bar (WhatsApp-Style: Profile Avatar top-left + BSDK Clubs wordmark + Camera + Overflow) */}
        <header className="app-header">
          <div className="header-left">
            <button
              type="button"
              onClick={() => { setShowSettings(true); setShowGroupInfo(false); }}
              title="Open Profile & Settings"
              style={{ borderRadius: '50%', padding: 1 }}
            >
              <img src={auth.user.profile_photo_url} alt={auth.user.real_name} className="avatar-circle avatar-sm" />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <BrandLogo size={26} />
              <span style={{ fontWeight: 800, fontSize: 17.5, letterSpacing: '-0.01em' }}>BSDK Clubs</span>
            </div>
          </div>

          <div className="header-actions" style={{ position: 'relative' }}>
            <button
              type="button"
              className="icon-btn"
              title="Post Quick Camera Status"
              onClick={() => setShowQuickStatusCam(true)}
            >
              <Camera size={19} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Menu"
              onClick={(e) => { e.stopPropagation(); setShowOverflow((v) => !v); }}
            >
              <MoreVertical size={19} />
            </button>

            {showOverflow && (
              <div className="popover-menu" style={{ right: 4, top: 46 }} onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="popover-item"
                  onClick={() => { setShowOverflow(false); setShowCreateClub(true); }}
                >
                  <Plus size={16} /> New Club
                </button>
                <button
                  type="button"
                  className="popover-item"
                  onClick={() => { setShowOverflow(false); setShowSettings(true); setShowGroupInfo(false); }}
                >
                  <Settings size={16} /> Settings
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Active Tab Content */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          {activeTab === 'chats' && (
            <ChatListPane
              clubs={clubs}
              activeClubId={activeClubId}
              onSelectClub={(id) => {
                setActiveClubId(id);
                setShowSettings(false);
                setShowGroupInfo(false);
              }}
              onOpenCreateClub={() => setShowCreateClub(true)}
              onOpenNewChat={() => setShowNewChat(true)}
              onUpdateClubPref={handleUpdateClubPref}
              onLeaveClub={handleLeaveClub}
            />
          )}

          {activeTab === 'clubs' && (
            <ClubsPane
              clubs={clubs}
              onSelectClub={(id) => {
                setActiveClubId(id);
                setActiveTab('chats');
                setShowSettings(false);
              }}
              onOpenCreateClub={() => setShowCreateClub(true)}
              onOpenNewChat={() => setShowNewChat(true)}
              onOpenAliasForClub={(club) => setAliasModalClub(club)}
              onClubJoined={(club) => {
                loadClubs();
                socketRef.current?.emit('subscribe', { club_id: club.id });
                setActiveClubId(club.id);
                setActiveTab('chats');
                showToast(`Joined ${club.name} as ${club.my_alias}!`);
              }}
              onToast={showToast}
            />
          )}

          {activeTab === 'updates' && (
            <UpdatesPane
              clubs={clubs}
              statusGroups={statusGroups}
              onRefreshStatuses={loadStatuses}
              onReplyToStatus={async (clubId, replyBody) => {
                await apiRequest(`/clubs/${clubId}/messages`, {
                  method: 'POST',
                  body: { type: 'text', body: replyBody }
                });
                loadMessages(clubId);
                loadClubs();
              }}
              onToast={showToast}
            />
          )}

          {activeTab === 'calls' && (
            <CallsPane
              onGoToChats={() => setActiveTab('chats')}
              onStartCall={handleStartCall}
            />
          )}
        </div>

        {/* Bottom Navigation Bar (Section 3.4: Chats | Clubs | Updates | Calls) */}
        <nav className="nav-tabs-bar" aria-label="Primary Navigation">
          <button
            type="button"
            className={`nav-tab-btn ${activeTab === 'chats' ? 'active' : ''}`}
            onClick={() => { setActiveTab('chats'); setShowSettings(false); }}
          >
            <span className="nav-pill"><MessageCircle size={20} /></span>
            <span>Chats</span>
            {totalUnread > 0 && <span className="nav-badge">{totalUnread}</span>}
          </button>

          <button
            type="button"
            className={`nav-tab-btn ${activeTab === 'clubs' ? 'active' : ''}`}
            onClick={() => { setActiveTab('clubs'); setShowSettings(false); }}
          >
            <span className="nav-pill"><Users size={20} /></span>
            <span>Clubs</span>
          </button>

          <button
            type="button"
            className={`nav-tab-btn ${activeTab === 'updates' ? 'active' : ''}`}
            onClick={() => { setActiveTab('updates'); setShowSettings(false); loadStatuses(); }}
          >
            <span className="nav-pill"><Disc size={20} /></span>
            <span>Updates</span>
            {totalStatuses > 0 && <span className="nav-badge">{totalStatuses}</span>}
          </button>

          <button
            type="button"
            className={`nav-tab-btn ${activeTab === 'calls' ? 'active' : ''}`}
            onClick={() => { setActiveTab('calls'); setShowSettings(false); }}
          >
            <span className="nav-pill"><Phone size={20} /></span>
            <span>Calls</span>
          </button>
        </nav>
      </aside>

      {/* ================= RIGHT MAIN PANE ================= */}
      <main className={`main-pane ${!mobileShowRight ? 'mobile-hidden' : ''}`}>
        {showSettings ? (
          <SettingsPane
            user={auth.user}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onUpdateProfile={(updatedUser) => {
              const nextAuth = { ...auth, user: updatedUser };
              setStoredAuth(nextAuth);
              setAuth(nextAuth);
            }}
            onLogout={handleLogout}
            onClose={() => setShowSettings(false)}
            onToast={showToast}
          />
        ) : activeClub ? (
          <ChatWindow
            club={activeClub}
            messages={messagesByClub[activeClub.id] || []}
            typingAliases={typingMap[activeClub.id] || []}
            settings={settings}
            onBackMobile={() => setActiveClubId(null)}
            onOpenGroupInfo={() => setShowGroupInfo((v) => !v)}
            onOpenAliasModal={() => setAliasModalClub(activeClub)}
            onSendMessage={handleSendMessage}
            onDeleteMessage={handleDeleteMessage}
            onToggleReaction={handleToggleReaction}
            onVotePoll={handleVotePoll}
            onPollCreated={(pollMsg) => {
              setMessagesByClub((prev) => ({
                ...prev,
                [activeClub.id]: [...(prev[activeClub.id] || []), { ...pollMsg, is_mine: true, status: 'sent' }]
              }));
              setClubs((prev) =>
                prev.map((c) =>
                  c.id === activeClub.id
                    ? {
                        ...c,
                        last_message: {
                          body: '📊 Poll',
                          alias_name: activeClub.my_alias || 'You',
                          created_at: pollMsg.created_at
                        }
                      }
                    : c
                )
              );
              showToast('Anonymous poll posted!');
            }}
            onOpenReport={(target) => setReportTarget(target)}
            onEmitTyping={(clubId, isTyping) => {
              socketRef.current?.emit('typing', { club_id: clubId, is_typing: isTyping });
            }}
            onStartCall={handleStartCall}
            onToast={showToast}
          />
        ) : (
          <div className="empty-state-center chat-wallpaper">
            <BrandLogo size={68} />
            <h2 style={{ color: 'var(--text-primary)', fontWeight: 800 }}>BSDK Clubs</h2>
            <p style={{ maxWidth: 420, fontSize: 14.5, lineHeight: 1.55 }}>
              <strong>Your Gang. Your Bang.</strong> Select a club from the left to chat anonymously with your real friends — or create a new private club in 30 seconds.
            </p>
            <div className="trust-note" style={{ maxWidth: 420 }}>
              <Sparkles size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />
              Real members are visible in Group Info; inside chat each member appears only with a per-group alias.
            </div>
            <button type="button" className="btn-primary" onClick={() => setShowCreateClub(true)}>
              <Plus size={17} /> Create New Club
            </button>
          </div>
        )}
      </main>

      {/* ================= GROUP INFO DRAWER ================= */}
      {showGroupInfo && activeClub && !showSettings && (
        <GroupInfoDrawer
          club={activeClub}
          messages={messagesByClub[activeClub.id] || []}
          onClose={() => setShowGroupInfo(false)}
          onClubUpdated={(updatedClub) => {
            setClubs((prev) => prev.map((c) => (c.id === updatedClub.id ? { ...c, ...updatedClub } : c)));
          }}
          onUpdateClubPref={handleUpdateClubPref}
          onLeaveClub={handleLeaveClub}
          onOpenReport={(target) => setReportTarget(target)}
          onOpenAliasModal={() => setAliasModalClub(activeClub)}
          onToast={showToast}
        />
      )}

      {/* ================= GLOBAL MODALS ================= */}
      {showCreateClub && (
        <CreateClubModal
          onClose={() => setShowCreateClub(false)}
          onCreated={(newClub) => {
            loadClubs();
            socketRef.current?.emit('subscribe', { club_id: newClub.id });
            setActiveClubId(newClub.id);
            setActiveTab('chats');
            setShowSettings(false);
          }}
        />
      )}

      {aliasModalClub && (
        <AliasModal
          club={aliasModalClub}
          onClose={() => setAliasModalClub(null)}
          onUpdated={({ alias_name, alias_color }) => {
            setClubs((prev) =>
              prev.map((c) => (c.id === aliasModalClub.id ? { ...c, my_alias: alias_name, my_alias_color: alias_color } : c))
            );
            loadMessages(aliasModalClub.id);
            showToast(`Display alias updated to ${alias_name}!`);
          }}
        />
      )}

      {reportTarget && (
        <ReportModal
          target={reportTarget}
          onClose={() => setReportTarget(null)}
          onSubmitted={(msg) => showToast(msg)}
        />
      )}

      {showQuickStatusCam && (
        <CameraSnapModal
          title="Post Anonymous Camera Status"
          onClose={() => setShowQuickStatusCam(false)}
          onCapture={async ({ media_url, caption }) => {
            const targetId = activeClubId || clubs[0]?.id;
            if (!targetId) return showToast('Please create or join a club first.');
            await apiRequest(`/clubs/${targetId}/statuses`, {
              method: 'POST',
              body: { type: 'image', media_url, caption }
            });
            loadStatuses();
            setActiveTab('updates');
            showToast('Anonymous camera status posted (24h)!');
          }}
        />
      )}

      {showNewChat && (
        <NewChatModal
          isOpen={showNewChat}
          onClose={() => setShowNewChat(false)}
          onOpenCreateClub={() => setShowCreateClub(true)}
          onOpenDirectChat={(club) => {
            loadClubs();
            setActiveClubId(club.id);
            setActiveTab('chats');
          }}
          token={auth?.access_token}
        />
      )}

      {joinViaCode && (
        <JoinViaCodeModal
          initialCode={joinViaCode}
          onClose={() => setJoinViaCode(null)}
          onJoinedClub={(club) => {
            loadClubs();
            setActiveClubId(club.id);
            setActiveTab('chats');
          }}
          onToast={showToast}
        />
      )}

      {pendingClubInvite && (
        <ClubJoinModal
          inviteCode={pendingClubInvite}
          onClose={() => setPendingClubInvite(null)}
          onJoined={(joinedClub) => {
            loadClubs();
            setActiveClubId(joinedClub.id);
            setActiveTab('chats');
            showToast(`Joined ${joinedClub.name}!`);
          }}
        />
      )}

      {/* ================= SECURE WHATSAPP-STYLE CALLING SCREEN ================= */}
      {activeCallSession && (
        <CallScreen
          callSession={activeCallSession}
          currentUser={auth?.user}
          socket={socketRef.current}
          onEndCall={({ duration, status }) => {
            setActiveCallSession(null);
            if (activeClubId) loadMessages(activeClubId);
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
    </div>
  );
}
