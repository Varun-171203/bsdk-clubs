import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ArrowLeft, Search, Users, UserPlus, PhoneCall, RefreshCw, Sparkles,
  Share2, Check, MessageSquare, AlertCircle, ShieldCheck, X
} from 'lucide-react';
import {
  syncContacts,
  getContactsPermissionStatus,
  setContactsPermissionStatus,
  hasContactsPermission,
  formatPhoneDisplay,
  generateInviteLink,
  startDirectChatWithContact,
  getNewlyJoinedNotifications,
  dismissJoinedNotification
} from '../services/contactsService.js';
import { ContactsPermissionModal } from './ContactsPermissionModal.jsx';
import { ManualNumberModal } from './ManualNumberModal.jsx';

/**
 * WhatsApp-style "New Chat / Select Contact" screen.
 *
 * Contains:
 * - Search bar
 * - Top Action rows: "New group / club", "New contact", "Manual number entry"
 * - Section 1: "Contacts on BSDK Clubs" (registered users with avatar, name, about, tap to chat)
 * - Section 2: "Invite to BSDK Clubs" (contacts with name, phone, green INVITE button)
 * - Joined Contact notification banner ("X joined BSDK Clubs")
 * - Background pull-to-refresh & daily re-check integration
 */
export function NewChatModal({
  isOpen,
  onClose,
  onOpenCreateClub,
  onOpenDirectChat,
  token
}) {
  const [search, setSearch] = useState('');
  const [isSearchingBarOpen, setIsSearchingBarOpen] = useState(false);
  const [registeredContacts, setRegisteredContacts] = useState([]);
  const [unregisteredContacts, setUnregisteredContacts] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [joinedBanners, setJoinedBanners] = useState([]);
  const [copiedInvitePhone, setCopiedInvitePhone] = useState(null);
  const [toastMessage, setToastMessage] = useState('');

  const showToast = useCallback((msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 2800);
  }, []);

  // Fetch or sync contacts
  const loadContacts = useCallback(async (forceRefresh = false) => {
    if (!isOpen) return;

    // Check permission status
    const perm = getContactsPermissionStatus();
    if (perm === 'prompt') {
      setShowPermissionModal(true);
      return;
    }

    if (forceRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const res = await syncContacts({ force: forceRefresh, token });
      setRegisteredContacts(res.registered || []);
      setUnregisteredContacts(res.unregistered || []);

      // Check for newly joined contacts
      const notifications = getNewlyJoinedNotifications();
      setJoinedBanners(notifications);

      if (forceRefresh) {
        showToast('Contacts refreshed!');
      }
    } catch (err) {
      console.warn('Contacts sync warning:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [isOpen, token, showToast]);

  // Initial load when modal opens
  useEffect(() => {
    if (isOpen) {
      loadContacts(false);
      setJoinedBanners(getNewlyJoinedNotifications());
    }
  }, [isOpen, loadContacts]);

  // Listen for background joined events
  useEffect(() => {
    const handleJoined = (e) => {
      if (e?.detail) {
        setJoinedBanners((prev) => [e.detail, ...prev.filter((p) => p.id !== e.detail.id)]);
      }
    };
    window.addEventListener('bsdk:contact_joined', handleJoined);
    return () => window.removeEventListener('bsdk:contact_joined', handleJoined);
  }, []);

  const handleAllowPermission = async () => {
    setContactsPermissionStatus('granted');
    setShowPermissionModal(false);
    await loadContacts(true);
  };

  const handleNotNowPermission = () => {
    setContactsPermissionStatus('denied');
    setShowPermissionModal(false);
    // Still load fallback/demo contacts so user experience is smooth
    loadContacts(false);
  };

  // Filter contacts by search query
  const query = search.trim().toLowerCase();

  const filteredRegistered = useMemo(() => {
    if (!query) return registeredContacts;
    return registeredContacts.filter((c) => {
      const name = (c.contactName || '').toLowerCase();
      const real = (c.registeredUser?.real_name || '').toLowerCase();
      const about = (c.registeredUser?.about || '').toLowerCase();
      const phone = (c.normalizedPhone || '').toLowerCase();
      return name.includes(query) || real.includes(query) || about.includes(query) || phone.includes(query);
    });
  }, [registeredContacts, query]);

  const filteredUnregistered = useMemo(() => {
    if (!query) return unregisteredContacts;
    return unregisteredContacts.filter((c) => {
      const name = (c.contactName || '').toLowerCase();
      const phone = (c.normalizedPhone || '').toLowerCase();
      const raw = (c.rawPhone || '').toLowerCase();
      return name.includes(query) || phone.includes(query) || raw.includes(query);
    });
  }, [unregisteredContacts, query]);

  const totalContactsCount = registeredContacts.length + unregisteredContacts.length;

  const handleContactClick = async (contact) => {
    if (!contact?.registeredUser?.id) return;
    try {
      setIsLoading(true);
      const res = await startDirectChatWithContact(contact.registeredUser.id, token);
      if (res?.club && onOpenDirectChat) {
        onOpenDirectChat(res.club);
        onClose();
      }
    } catch (err) {
      showToast(err.message || 'Could not open chat.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleInvite = (contact) => {
    const invite = generateInviteLink(contact.contactName);
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(invite.copyText);
    }
    setCopiedInvitePhone(contact.normalizedPhone);
    showToast(`Invite copied! Send to ${contact.contactName}`);
    setTimeout(() => setCopiedInvitePhone(null), 2500);

    // Also trigger SMS or web share if supported on mobile
    if (navigator.share) {
      navigator.share({
        title: 'Join BSDK Clubs',
        text: invite.copyText,
        url: invite.shareUrl
      }).catch(() => {});
    } else {
      window.open(invite.smsUrl, '_blank');
    }
  };

  const handleDismissBanner = (bannerId) => {
    dismissJoinedNotification(bannerId);
    setJoinedBanners((prev) => prev.filter((b) => b.id !== bannerId));
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className="modal-backdrop"
        style={{
          zIndex: 100,
          padding: 0,
          backgroundColor: 'var(--bg-app)'
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '520px',
            height: '100%',
            maxHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'var(--bg-panel)',
            boxShadow: 'var(--shadow-lg)'
          }}
        >
          {/* WhatsApp Android Header */}
          <div
            style={{
              backgroundColor: '#075E54',
              color: '#ffffff',
              padding: '12px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.18)'
            }}
          >
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#ffffff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '4px'
              }}
              title="Back"
            >
              <ArrowLeft size={22} />
            </button>

            {isSearchingBarOpen ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="Search contacts or numbers..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                  style={{
                    flex: 1,
                    background: 'rgba(255, 255, 255, 0.15)',
                    border: 'none',
                    borderRadius: '20px',
                    padding: '8px 14px',
                    color: '#ffffff',
                    fontSize: '15px',
                    outline: 'none'
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setIsSearchingBarOpen(false);
                  }}
                  style={{ background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer' }}
                >
                  <X size={20} />
                </button>
              </div>
            ) : (
              <>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '18px', fontWeight: 700, lineHeight: 1.2 }}>
                    Select contact
                  </div>
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.85)' }}>
                    {totalContactsCount} contacts
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setIsSearchingBarOpen(true)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#ffffff',
                    cursor: 'pointer',
                    padding: '6px'
                  }}
                  title="Search"
                >
                  <Search size={20} />
                </button>

                <button
                  type="button"
                  onClick={() => loadContacts(true)}
                  disabled={isRefreshing}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#ffffff',
                    cursor: 'pointer',
                    padding: '6px',
                    transform: isRefreshing ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.4s ease'
                  }}
                  title="Refresh Contacts"
                >
                  <RefreshCw size={19} />
                </button>
              </>
            )}
          </div>

          {/* Newly Joined Contact Banners (WhatsApp-style "X joined BSDK Clubs") */}
          {joinedBanners.length > 0 && !search && (
            <div style={{ backgroundColor: 'rgba(37, 211, 102, 0.12)', borderBottom: '1px solid rgba(37, 211, 102, 0.25)' }}>
              {joinedBanners.map((banner) => (
                <div
                  key={banner.id}
                  style={{
                    padding: '10px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Sparkles size={17} color="#128C7E" />
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {banner.contactName || 'A contact'} joined BSDK Clubs!
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {banner.user?.id && (
                      <button
                        type="button"
                        onClick={() => handleContactClick({ registeredUser: banner.user })}
                        style={{
                          padding: '4px 10px',
                          borderRadius: '12px',
                          border: 'none',
                          backgroundColor: '#128C7E',
                          color: '#ffffff',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        Say Hi 👋
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDismissBanner(banner.id)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Scrollable Contact List Body */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {/* Top Action Options (WhatsApp Android Style) */}
            {!query && (
              <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '4px' }}>
                {/* 1. New Group / Club */}
                <div
                  className="chat-row"
                  style={{ cursor: 'pointer', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '15px' }}
                  onClick={() => {
                    onClose();
                    onOpenCreateClub?.();
                  }}
                >
                  <div
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '50%',
                      backgroundColor: '#128C7E',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <Users size={21} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '15.5px', color: 'var(--text-primary)' }}>
                      New club / group
                    </div>
                    <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                      Create private anonymous group chat
                    </div>
                  </div>
                </div>

                {/* 2. Manual Number Entry */}
                <div
                  className="chat-row"
                  style={{ cursor: 'pointer', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '15px' }}
                  onClick={() => setShowManualModal(true)}
                >
                  <div
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '50%',
                      backgroundColor: '#128C7E',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <PhoneCall size={20} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '15.5px', color: 'var(--text-primary)' }}>
                      Manual number entry
                    </div>
                    <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                      Lookup and message any phone number directly
                    </div>
                  </div>
                </div>

                {/* 3. New Contact / Address Book shortcut */}
                <div
                  className="chat-row"
                  style={{ cursor: 'pointer', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '15px' }}
                  onClick={() => setShowManualModal(true)}
                >
                  <div
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '50%',
                      backgroundColor: '#128C7E',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <UserPlus size={20} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '15.5px', color: 'var(--text-primary)' }}>
                      New contact
                    </div>
                    <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                      Add someone using phone number
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 1: Contacts on BSDK Clubs */}
            <div style={{ marginTop: '8px' }}>
              <div
                style={{
                  padding: '10px 16px 6px',
                  fontSize: '13px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <span>Contacts on BSDK Clubs</span>
                <span
                  style={{
                    backgroundColor: 'rgba(18, 140, 126, 0.12)',
                    color: '#128C7E',
                    borderRadius: '10px',
                    padding: '2px 8px',
                    fontSize: '11.5px',
                    fontWeight: 700
                  }}
                >
                  {filteredRegistered.length}
                </span>
              </div>

              {filteredRegistered.length === 0 ? (
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13.5px' }}>
                  {query ? 'No matching contacts found on BSDK Clubs.' : 'No contacts on BSDK Clubs yet.'}
                </div>
              ) : (
                filteredRegistered.map((contact, i) => (
                  <div
                    key={`${contact.contactId}_${contact.phoneHash}_${i}`}
                    className="chat-row"
                    onClick={() => handleContactClick(contact)}
                    style={{
                      cursor: 'pointer',
                      padding: '10px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '14px'
                    }}
                  >
                    <img
                      src={
                        contact.registeredUser?.profile_photo_url ||
                        `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(contact.contactName)}`
                      }
                      alt={contact.contactName}
                      style={{
                        width: '46px',
                        height: '46px',
                        borderRadius: '50%',
                        objectFit: 'cover',
                        backgroundColor: 'var(--bg-panel-alt)'
                      }}
                    />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-primary)' }}>
                          {contact.contactName}
                          {contact.label && contact.label !== 'Mobile' && (
                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginLeft: '6px', fontWeight: 400 }}>
                              ({contact.label})
                            </span>
                          )}
                        </div>
                      </div>

                      <div
                        style={{
                          fontSize: '13px',
                          color: 'var(--text-secondary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          marginTop: '2px'
                        }}
                      >
                        {contact.registeredUser?.about || 'Hey there! I am on BSDK Clubs'}
                      </div>
                    </div>

                    <MessageSquare size={17} color="#128C7E" style={{ opacity: 0.7 }} />
                  </div>
                ))
              )}
            </div>

            {/* SECTION 2: Invite to BSDK Clubs */}
            <div style={{ marginTop: '14px', borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
              <div
                style={{
                  padding: '10px 16px 6px',
                  fontSize: '13px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <span>Invite to BSDK Clubs</span>
                <span
                  style={{
                    backgroundColor: 'rgba(0, 0, 0, 0.05)',
                    color: 'var(--text-secondary)',
                    borderRadius: '10px',
                    padding: '2px 8px',
                    fontSize: '11.5px',
                    fontWeight: 700
                  }}
                >
                  {filteredUnregistered.length}
                </span>
              </div>

              {filteredUnregistered.length === 0 ? (
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13.5px' }}>
                  {query ? 'No matching contacts to invite.' : 'All contacts are already on BSDK Clubs!'}
                </div>
              ) : (
                filteredUnregistered.map((contact, i) => {
                  const isCopied = copiedInvitePhone === contact.normalizedPhone;
                  return (
                    <div
                      key={`${contact.contactId}_${contact.phoneHash}_${i}`}
                      className="chat-row"
                      style={{
                        padding: '10px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '14px'
                      }}
                    >
                      <div
                        style={{
                          width: '46px',
                          height: '46px',
                          borderRadius: '50%',
                          backgroundColor: 'var(--bg-panel-alt, rgba(0,0,0,0.06))',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--text-secondary)'
                        }}
                      >
                        <UserPlus size={20} />
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-primary)' }}>
                          {contact.contactName}
                          {contact.label && contact.label !== 'Mobile' && (
                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginLeft: '6px', fontWeight: 400 }}>
                              ({contact.label})
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          {formatPhoneDisplay(contact.normalizedPhone)}
                        </div>
                      </div>

                      {/* WhatsApp Green INVITE Button */}
                      <button
                        type="button"
                        onClick={() => handleInvite(contact)}
                        style={{
                          padding: '6px 14px',
                          borderRadius: '16px',
                          border: '1.5px solid #128C7E',
                          backgroundColor: isCopied ? '#128C7E' : 'transparent',
                          color: isCopied ? '#ffffff' : '#128C7E',
                          fontWeight: 700,
                          fontSize: '12.5px',
                          letterSpacing: '0.4px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          transition: 'all 0.18s ease'
                        }}
                      >
                        {isCopied ? <Check size={14} /> : null}
                        {isCopied ? 'INVITED' : 'INVITE'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Privacy note at bottom */}
            <div
              style={{
                padding: '24px 16px',
                textAlign: 'center',
                fontSize: '12px',
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}
            >
              <ShieldCheck size={15} color="#128C7E" /> Numbers are SHA-256 hashed locally before matching.
            </div>
          </div>
        </div>
      </div>

      {/* Permission Explanation Modal Fallback */}
      <ContactsPermissionModal
        isOpen={showPermissionModal}
        onAllow={handleAllowPermission}
        onNotNow={handleNotNowPermission}
      />

      {/* Manual Number Entry Modal */}
      <ManualNumberModal
        isOpen={showManualModal}
        onClose={() => setShowManualModal(false)}
        onOpenChatWithUser={(club) => {
          setShowManualModal(false);
          onClose();
          onOpenDirectChat?.(club);
        }}
        token={token}
      />

      {/* Lightweight Toast */}
      {toastMessage && (
        <div className="toast" style={{ zIndex: 200 }}>
          {toastMessage}
        </div>
      )}
    </>
  );
}
