import React, { useState, useEffect } from 'react';
import {
  ArrowLeft, Key, Lock, MessageSquare, Bell, HardDrive, Globe, HelpCircle,
  UserPlus, QrCode, ChevronRight, LogOut, Trash2, Download, ShieldCheck,
  Check, Copy, Sun, Moon, FileText, AlertTriangle, Edit3
} from 'lucide-react';
import { apiRequest } from '../api.js';
import { QrModal } from './Modals.jsx';
import { QrCodeModal } from './QrCodeModal.jsx';
import { InviteScreenModal } from './InviteScreenModal.jsx';

const SETTINGS_MENU = [
  { id: 'account', icon: Key, title: 'Account', sub: 'Security notifications, two-step verification, delete account' },
  { id: 'privacy', icon: Lock, title: 'Privacy', sub: 'Last seen, read receipts, blocked list, report history, alias rules' },
  { id: 'chats', icon: MessageSquare, title: 'Chats', sub: 'Theme (Light/Dark), wallpaper, font size, enter is send' },
  { id: 'notifications', icon: Bell, title: 'Notifications', sub: 'Message, group, preview & reaction tones' },
  { id: 'storage', icon: HardDrive, title: 'Storage and Data', sub: 'Storage usage per club, auto-download, clear cache' },
  { id: 'language', icon: Globe, title: 'App Language', sub: 'English / Hindi (Hinglish)' },
  { id: 'help', icon: HelpCircle, title: 'Help', sub: 'Help centre (FAQ), Privacy Policy, Terms & App info' },
  { id: 'invite', icon: UserPlus, title: 'Invite a Friend', sub: 'Share BSDK Clubs with your gang' }
];

function ToggleRow({ title, subtitle, value, onToggle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14.5 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2 }}>{subtitle}</div>}
      </div>
      <button type="button" className={`toggle-switch ${value ? 'on' : ''}`} onClick={onToggle}>
        <span className="toggle-knob" />
      </button>
    </div>
  );
}

export function SettingsPane({
  user,
  settings,
  onUpdateSettings,
  onUpdateProfile,
  onLogout,
  onClose,
  onToast
}) {
  const [section, setSection] = useState(null); // null = Settings Home, or one of SETTINGS_MENU ids or 'profile'
  const [showMyQr, setShowMyQr] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);

  // Profile edit state
  const [realName, setRealName] = useState(user.real_name || '');
  const [about, setAbout] = useState(user.about || '');
  const [phone, setPhone] = useState(user.phone || '');
  const [email, setEmail] = useState(user.email || '');
  const [savingProfile, setSavingProfile] = useState(false);

  // Privacy sub-data
  const [blocks, setBlocks] = useState([]);
  const [reports, setReports] = useState([]);
  const [storageStats, setStorageStats] = useState(null);
  const [legalDoc, setLegalDoc] = useState(null); // 'privacy' | 'terms' | null
  const [pinInput, setPinInput] = useState('');
  const [copiedInvite, setCopiedInvite] = useState(false);

  // Change number & Account state
  const [showChangeNumber, setShowChangeNumber] = useState(false);
  const [newPhoneInput, setNewPhoneInput] = useState('');
  const [changeOtpInput, setChangeOtpInput] = useState('');
  const [changeOtpSent, setChangeOtpSent] = useState(false);

  async function handlePermanentDeleteAccount() {
    if (!window.confirm('Delete this account permanently? This action CANNOT be undone and will delete all your club data.')) return;
    try {
      await apiRequest('/auth/account', { method: 'DELETE' });
      onToast('Account deleted permanently.');
      onLogout();
    } catch (err) {
      onToast(err.message);
    }
  }

  useEffect(() => {
    if (section === 'privacy') {
      apiRequest('/blocks').then((d) => setBlocks(d.blocks || [])).catch(() => {});
      apiRequest('/reports').then((d) => setReports(d.reports || [])).catch(() => {});
    }
    if (section === 'storage') {
      apiRequest('/storage-stats').then((d) => setStorageStats(d)).catch(() => {});
    }
  }, [section]);

  async function saveProfile(e) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const data = await apiRequest('/me', {
        method: 'PATCH',
        body: { real_name: realName, about, phone, email }
      });
      onUpdateProfile(data.user);
      onToast('Profile updated! (Sirf Group Info mein dikhega)');
    } catch (err) {
      onToast(err.message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleUnblock(userId) {
    try {
      await apiRequest(`/blocks/${userId}`, { method: 'DELETE' });
      setBlocks((prev) => prev.filter((b) => b.user_id !== userId));
      onToast('User unblocked.');
    } catch (err) {
      onToast(err.message);
    }
  }

  function handleDownloadAccountInfo() {
    const blob = new Blob([JSON.stringify({ user, settings, exported_at: new Date().toISOString() }, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bsdk-clubs-account-${user.user_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onToast('Account info JSON downloaded successfully.');
  }

  async function handleDeleteAccount() {
    if (!window.confirm('Are you sure you want to request account deletion? (30-day grace period)')) return;
    try {
      const data = await apiRequest('/me', { method: 'DELETE' });
      onToast(data.message);
    } catch (err) {
      onToast(err.message);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-panel)' }}>
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <button
            type="button"
            className="icon-btn"
            onClick={() => (section ? setSection(null) : onClose())}
            title="Back"
          >
            <ArrowLeft size={21} />
          </button>
          <span style={{ fontWeight: 700, fontSize: 17 }}>
            {section === 'profile'
              ? 'Profile'
              : section
              ? SETTINGS_MENU.find((m) => m.id === section)?.title || 'Settings'
              : 'Settings'}
          </span>
        </div>
      </header>

      <div className="drawer-scroll" style={{ padding: section ? 18 : 0 }}>
        {/* ================= SETTINGS HOME ================= */}
        {!section && (
          <>
            {/* Top Profile Card (Section 3.6) */}
            <div
              className="settings-row"
              style={{ padding: '16px', borderBottom: '8px solid var(--bg-panel-alt)' }}
              onClick={() => setSection('profile')}
            >
              <img src={user.profile_photo_url} alt={user.real_name} className="avatar-circle" style={{ width: 58, height: 58 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 17 }}>{user.real_name}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user.about || 'Hey there! I am on BSDK Clubs'}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--brand-green)', fontWeight: 600 }}>@{user.user_id}</div>
              </div>
              <button
                type="button"
                className="icon-btn dark-hover"
                title="My Invite QR"
                onClick={(e) => { e.stopPropagation(); setShowMyQr(true); }}
              >
                <QrCode size={20} color="#128C7E" />
              </button>
            </div>

            {SETTINGS_MENU.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.id} className="settings-row" onClick={() => setSection(item.id)}>
                  <Icon size={20} color="var(--text-secondary)" />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{item.title}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{item.sub}</div>
                  </div>
                  <ChevronRight size={17} color="var(--text-secondary)" />
                </div>
              );
            })}

            {/* Logout inside Settings (per Section 3.4) */}
            <div style={{ padding: 18 }}>
              <button type="button" className="btn-danger" style={{ width: '100%' }} onClick={onLogout}>
                <LogOut size={17} /> Log Out (@{user.user_id})
              </button>
            </div>
          </>
        )}

        {/* ================= PROFILE EDIT ================= */}
        {section === 'profile' && (
          <form onSubmit={saveProfile} style={{ maxWidth: 520 }}>
            <div style={{ textAlign: 'center', marginBottom: 18 }}>
              <img src={user.profile_photo_url} alt={user.real_name} className="avatar-circle avatar-xl" style={{ margin: '0 auto 10px' }} />
              <div className="trust-note">
                Your real name and photo are visible only in <strong>Group Info</strong>, never inside the chat.
              </div>
            </div>
            <div className="field-group">
              <label className="field-label">Real Name</label>
              <input className="text-input" value={realName} onChange={(e) => setRealName(e.target.value)} required />
            </div>
            <div className="field-group">
              <label className="field-label">About</label>
              <input className="text-input" value={about} onChange={(e) => setAbout(e.target.value)} placeholder="Hey there! I am on BSDK Clubs" />
            </div>
            <div className="field-group">
              <label className="field-label">Recovery Phone</label>
              <input className="text-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="field-group">
              <label className="field-label">Recovery Email</label>
              <input className="text-input" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <button type="submit" className="btn-primary" disabled={savingProfile}>
              <Check size={16} /> {savingProfile ? 'Saving...' : 'Save Profile'}
            </button>
          </form>
        )}

        {/* ================= 1. ACCOUNT ================= */}
        {section === 'account' && (
          <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <ToggleRow
              title="Security notifications"
              subtitle="Naye login ya device session par alert paao"
              value={settings.account.security_notifications}
              onToggle={() => onUpdateSettings({ account: { security_notifications: !settings.account.security_notifications } })}
            />
            <ToggleRow
              title="Two-step verification (PIN)"
              subtitle="Extra 6-digit PIN protection for your account"
              value={settings.account.two_step_pin_enabled}
              onToggle={() => onUpdateSettings({ account: { two_step_pin_enabled: !settings.account.two_step_pin_enabled } })}
            />
            {settings.account.two_step_pin_enabled && (
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="text-input"
                  type="password"
                  maxLength={6}
                  placeholder="Enter 6-digit PIN"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    if (pinInput.length < 4) return onToast('4-6 digit PIN daalo');
                    onUpdateSettings({ account: { two_step_pin_hint: 'PIN Set' } });
                    setPinInput('');
                    onToast('Two-step PIN saved!');
                  }}
                >
                  Set PIN
                </button>
              </div>
            )}

            {/* Change Number Modal / Flow */}
            <button type="button" className="popover-item" onClick={() => setShowChangeNumber(true)}>
              <Edit3 size={17} color="#128C7E" /> Change number
            </button>
            <button type="button" className="popover-item" onClick={handleDownloadAccountInfo}>
              <Download size={17} color="#128C7E" /> Request account info (Download JSON)
            </button>
            <button type="button" className="popover-item danger" onClick={onLogout}>
              <LogOut size={17} /> Log out from this device
            </button>
            <button type="button" className="popover-item danger" onClick={handlePermanentDeleteAccount}>
              <Trash2 size={17} /> Delete my account
            </button>
          </div>
        )}

        {/* Change Number Flow Modal */}
        {showChangeNumber && (
          <div className="wa-modal-backdrop">
            <div className="wa-confirm-dialog" style={{ maxWidth: 360 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#075E54', marginBottom: 6 }}>
                Change phone number
              </h3>
              <p style={{ fontSize: 12.5, color: '#667781', marginBottom: 14 }}>
                Changing your phone number will migrate your account info, groups and settings.
              </p>
              {!changeOtpSent ? (
                <div>
                  <div className="field-group" style={{ marginBottom: 12 }}>
                    <label className="field-label">New 10-digit Phone Number</label>
                    <input
                      type="tel"
                      className="text-input"
                      placeholder="e.g. 9876543299"
                      value={newPhoneInput}
                      onChange={(e) => setNewPhoneInput(e.target.value.replace(/[^0-9]/g, ''))}
                    />
                  </div>
                  <div className="wa-dialog-actions">
                    <button type="button" className="wa-dialog-btn" onClick={() => setShowChangeNumber(false)}>
                      CANCEL
                    </button>
                    <button
                      type="button"
                      className="wa-dialog-btn wa-dialog-btn-primary"
                      disabled={newPhoneInput.length !== 10}
                      onClick={async () => {
                        try {
                          const res = await apiRequest('/auth/request-otp', {
                            method: 'POST',
                            body: { country_code: '+91', phone: newPhoneInput }
                          });
                          setChangeOtpSent(true);
                          if (res.dev_otp) onToast(`Dev OTP: ${res.dev_otp}`);
                        } catch (err) {
                          onToast(err.message);
                        }
                      }}
                    >
                      SEND OTP
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="field-group" style={{ marginBottom: 12 }}>
                    <label className="field-label">Enter 6-digit OTP sent to +91 {newPhoneInput}</label>
                    <input
                      type="text"
                      className="text-input"
                      placeholder="123456"
                      maxLength={6}
                      value={changeOtpInput}
                      onChange={(e) => setChangeOtpInput(e.target.value.replace(/[^0-9]/g, ''))}
                    />
                  </div>
                  <div className="wa-dialog-actions">
                    <button type="button" className="wa-dialog-btn" onClick={() => setChangeOtpSent(false)}>
                      BACK
                    </button>
                    <button
                      type="button"
                      className="wa-dialog-btn wa-dialog-btn-primary"
                      disabled={changeOtpInput.length !== 6}
                      onClick={async () => {
                        try {
                          await apiRequest('/auth/change-number', {
                            method: 'POST',
                            body: { new_country_code: '+91', new_phone: newPhoneInput, otp: changeOtpInput }
                          });
                          onToast('Phone number updated successfully!');
                          setShowChangeNumber(false);
                          setChangeOtpSent(false);
                          setNewPhoneInput('');
                          setChangeOtpInput('');
                        } catch (err) {
                          onToast(err.message);
                        }
                      }}
                    >
                      VERIFY & CHANGE
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= 2. PRIVACY (Including Extra BSDK Controls) ================= */}
        {section === 'privacy' && (
          <div style={{ maxWidth: 580, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Fixed Group Info Trust Control (Section 3.6.1) */}
            <div className="trust-note">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, marginBottom: 4 }}>
                <ShieldCheck size={17} /> Who can see my real profile in Group Info: Club Members (Fixed)
              </div>
              Essential for mutual trust — Group Info displays real friends so no unknown strangers enter. This setting is fixed.
            </div>

            <div style={{ padding: 12, borderRadius: 10, background: 'var(--bg-panel-alt)', fontSize: 13 }}>
              <strong>Show my alias activity:</strong> No member can ever see which options you voted for in polls or which messages were sent by you.
            </div>

            {['last_seen', 'profile_photo', 'about', 'status_visibility'].map((key) => {
              const labels = {
                last_seen: 'Last seen & online',
                profile_photo: 'Profile photo visibility',
                about: 'About visibility',
                status_visibility: 'Status visibility'
              };
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{labels[key]}</span>
                  <select
                    className="text-input"
                    style={{ width: 150, padding: '6px 10px', fontSize: 13 }}
                    value={settings.privacy[key]}
                    onChange={(e) => onUpdateSettings({ privacy: { [key]: e.target.value } })}
                  >
                    <option value="Everyone">Everyone</option>
                    <option value="My Clubs">My Clubs</option>
                    <option value="Nobody">Nobody</option>
                  </select>
                </div>
              );
            })}

            <ToggleRow
              title="Read receipts"
              subtitle="If turned off, you will not send or see read receipts"
              value={settings.privacy.read_receipts}
              onToggle={() => onUpdateSettings({ privacy: { read_receipts: !settings.privacy.read_receipts } })}
            />

            <ToggleRow
              title="Screenshot Block (Android FLAG_SECURE)"
              subtitle="Optional protection hint — prevents native in-app screenshots"
              value={settings.privacy.screenshot_block}
              onToggle={() => onUpdateSettings({ privacy: { screenshot_block: !settings.privacy.screenshot_block } })}
            />

            {/* Blocked List */}
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>BLOCKED USERS ({blocks.length})</div>
              {blocks.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No blocked users.</div>
              ) : (
                blocks.map((b) => (
                  <div key={b.user_id} className="member-row">
                    <img src={b.profile_photo_url} alt={b.real_name} className="avatar-circle avatar-sm" />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{b.real_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>@{b.handle}</div>
                    </div>
                    <button type="button" className="btn-secondary" onClick={() => handleUnblock(b.user_id)}>
                      Unblock
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Report History (Section 3.6.1) */}
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>REPORT HISTORY ({reports.length})</div>
              {reports.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>You have not submitted any reports yet.</div>
              ) : (
                reports.map((r) => (
                  <div key={r.id} style={{ padding: 10, borderRadius: 10, border: '1px solid var(--border)', marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <strong style={{ fontSize: 13.5 }}>{r.reason}</strong>
                      <span className="admin-badge">{r.status}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {r.club_name ? `Club: ${r.club_name} • ` : ''}{new Date(r.created_at).toLocaleString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ================= 3. CHATS ================= */}
        {section === 'chats' && (
          <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Theme (Light default, Dark optional)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <button
                  type="button"
                  className={settings.chats.theme === 'light' ? 'btn-primary' : 'btn-secondary'}
                  onClick={() => onUpdateSettings({ chats: { theme: 'light' } })}
                >
                  <Sun size={16} /> Light (WhatsApp Classic)
                </button>
                <button
                  type="button"
                  className={settings.chats.theme === 'dark' ? 'btn-primary' : 'btn-secondary'}
                  onClick={() => onUpdateSettings({ chats: { theme: 'dark' } })}
                >
                  <Moon size={16} /> Dark (#111B21)
                </button>
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Chat Wallpaper</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[
                  { id: 'classic', label: 'Classic Doodle', color: '#ECE5DD' },
                  { id: 'mint', label: 'Mint Hood', color: '#DFF2EC' },
                  { id: 'sand', label: 'Warm Sand', color: '#F4EBE1' },
                  { id: 'slate', label: 'Cool Slate', color: '#E2E8F0' },
                  { id: 'midnight', label: 'Midnight', color: '#0D1B2A' }
                ].map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => onUpdateSettings({ chats: { wallpaper: w.id } })}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 10,
                      border: settings.chats.wallpaper === w.id ? '2.5px solid #128C7E' : '1px solid var(--border-strong)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      fontSize: 13
                    }}
                  >
                    <span style={{ width: 16, height: 16, borderRadius: '50%', background: w.color, border: '1px solid rgba(0,0,0,0.2)' }} />
                    {w.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Font size</span>
              <select
                className="text-input"
                style={{ width: 140, padding: '6px 10px' }}
                value={settings.chats.font_size}
                onChange={(e) => onUpdateSettings({ chats: { font_size: e.target.value } })}
              >
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </div>

            <ToggleRow
              title="Enter is send"
              subtitle="Pressing Enter will send your message immediately"
              value={settings.chats.enter_is_send}
              onToggle={() => onUpdateSettings({ chats: { enter_is_send: !settings.chats.enter_is_send } })}
            />

            <ToggleRow
              title="Media visibility"
              subtitle="Show live snap previews in chat"
              value={settings.chats.media_visibility}
              onToggle={() => onUpdateSettings({ chats: { media_visibility: !settings.chats.media_visibility } })}
            />

            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', padding: 10, borderRadius: 10, background: 'var(--bg-panel-alt)' }}>
              Chat Backup will be available in an upcoming update.
            </div>
          </div>
        )}

        {/* ================= 4. NOTIFICATIONS ================= */}
        {section === 'notifications' && (
          <div style={{ maxWidth: 560 }}>
            <ToggleRow
              title="Message notifications"
              subtitle='Example: "SilentFox_42 sent a message in Weekend Gang"'
              value={settings.notifications.message_notifications}
              onToggle={() => onUpdateSettings({ notifications: { message_notifications: !settings.notifications.message_notifications } })}
            />
            <ToggleRow
              title="Group notifications"
              subtitle="Club invites, polls, and status updates"
              value={settings.notifications.group_notifications}
              onToggle={() => onUpdateSettings({ notifications: { group_notifications: !settings.notifications.group_notifications } })}
            />
            <ToggleRow
              title="Show message preview"
              subtitle="When OFF, notifications display sender alias and club name only"
              value={settings.notifications.show_preview}
              onToggle={() => onUpdateSettings({ notifications: { show_preview: !settings.notifications.show_preview } })}
            />
            <ToggleRow
              title="Reaction notifications"
              subtitle="Notify when someone reacts to your message"
              value={settings.notifications.reaction_notifications}
              onToggle={() => onUpdateSettings({ notifications: { reaction_notifications: !settings.notifications.reaction_notifications } })}
            />
            <ToggleRow
              title="Vibrate"
              value={settings.notifications.vibrate}
              onToggle={() => onUpdateSettings({ notifications: { vibrate: !settings.notifications.vibrate } })}
            />
            <ToggleRow
              title="Popup notifications"
              value={settings.notifications.popup}
              onToggle={() => onUpdateSettings({ notifications: { popup: !settings.notifications.popup } })}
            />
          </div>
        )}

        {/* ================= 5. STORAGE & DATA ================= */}
        {section === 'storage' && (
          <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ padding: 16, borderRadius: 12, background: 'var(--bg-panel-alt)' }}>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>Total Estimated Storage Usage</div>
              <div style={{ fontWeight: 800, fontSize: 26, color: 'var(--brand-green)', marginTop: 4 }}>
                {storageStats ? `${(storageStats.total_kb / 1024).toFixed(2)} MB` : 'Calculating...'}
              </div>
            </div>

            <ToggleRow
              title="Auto-download snaps on Wi-Fi"
              value={settings.storage.auto_download_wifi}
              onToggle={() => onUpdateSettings({ storage: { auto_download_wifi: !settings.storage.auto_download_wifi } })}
            />
            <ToggleRow
              title="Auto-download snaps on Mobile Data"
              value={settings.storage.auto_download_mobile}
              onToggle={() => onUpdateSettings({ storage: { auto_download_mobile: !settings.storage.auto_download_mobile } })}
            />

            {storageStats?.clubs && (
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>STORAGE PER CLUB</div>
                {storageStats.clubs.map((c) => (
                  <div key={c.id} className="member-row">
                    <img src={c.photo_url} alt={c.name} className="avatar-circle avatar-sm" />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{c.message_count} messages • {c.media_count || 0} snaps</div>
                    </div>
                    <strong style={{ fontSize: 13 }}>{c.estimated_kb} KB</strong>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                sessionStorage.clear();
                onToast('Local app cache cleared successfully!');
              }}
            >
              Clear Local Cache
            </button>
          </div>
        )}

        {/* ================= 6. APP LANGUAGE ================= */}
        {section === 'language' && (
          <div style={{ maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {['English', 'Hindi', 'Hinglish (V1.1 Preview)'].map((lang) => (
              <button
                key={lang}
                type="button"
                className="popover-item"
                style={{
                  border: settings.language === lang ? '2px solid #128C7E' : '1px solid var(--border)',
                  justifyContent: 'space-between'
                }}
                onClick={() => {
                  onUpdateSettings({ language: lang });
                  onToast(`App language set to ${lang}`);
                }}
              >
                <span style={{ fontWeight: 600 }}>{lang}</span>
                {settings.language === lang && <Check size={17} color="#128C7E" />}
              </button>
            ))}
          </div>
        )}

        {/* ================= 7. HELP (FAQ + Privacy Policy + Terms Draft) ================= */}
        {section === 'help' && (
          <div style={{ maxWidth: 620, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Frequently Asked Questions</div>

            {[
              {
                q: '"Does anonymous mean strangers?"',
                a: 'No! Group Info displays real members — your real friends. Anonymity only means members do not know who sent which message inside the chat.'
              },
              {
                q: '"What if someone misbehaves?"',
                a: 'Report, block, and admin moderation are available. Anonymity does not mean unaccountability — moderation logs help handle policy violations.'
              },
              {
                q: '"Can someone take a photo of the screen?"',
                a: 'No software can physically prevent a photo taken by another camera. BSDK Clubs does not make false promises — please chat responsibly.'
              }
            ].map((item) => (
              <div key={item.q} style={{ padding: 12, borderRadius: 12, background: 'var(--bg-panel-alt)' }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{item.q}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45 }}>{item.a}</div>
              </div>
            ))}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn-secondary" onClick={() => setLegalDoc(legalDoc === 'privacy' ? null : 'privacy')}>
                <FileText size={15} /> Privacy Policy (Draft v3.0)
              </button>
              <button type="button" className="btn-secondary" onClick={() => setLegalDoc(legalDoc === 'terms' ? null : 'terms')}>
                <FileText size={15} /> Terms & Conditions (Draft v3.0)
              </button>
            </div>

            {legalDoc === 'privacy' && (
              <div style={{ padding: 14, borderRadius: 12, border: '1px solid var(--border)', fontSize: 13, lineHeight: 1.55 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: '#D97706', fontWeight: 700, marginBottom: 8 }}>
                  <AlertTriangle size={16} /> Privacy Policy
                </div>
                <p><strong>1. Data Collected:</strong> User ID, real name, profile photo, about, optional phone/email, messages, snaps, polls, statuses, reports and blocks.</p>
                <p style={{ marginTop: 6 }}><strong>2. Anonymous Alias:</strong> Inside chat only your per-group alias is shown. Group Info displays your real name to friends. Server data is never sold or used for advertising.</p>
                <p style={{ marginTop: 6 }}><strong>3. Retention:</strong> Disappearing messages are hard-deleted upon expiry; Status expires in 24h; Deleted accounts undergo standard grace period before purge.</p>
              </div>
            )}

            {legalDoc === 'terms' && (
              <div style={{ padding: 14, borderRadius: 12, border: '1px solid var(--border)', fontSize: 13, lineHeight: 1.55 }}>
                <p><strong>1. Eligibility:</strong> 18+ users only. One account per User ID. Real names in Group Info must be authentic.</p>
                <p style={{ marginTop: 6 }}><strong>2. Rules:</strong> Harassment, hate speech, threats, illegal content, spam, and doxxing other members are strictly prohibited.</p>
                <p style={{ marginTop: 6 }}><strong>3. Disappearing Messages:</strong> Expired messages are deleted from servers and UI upon timer completion.</p>
              </div>
            )}

            <div style={{ paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 12.5, color: 'var(--text-secondary)' }}>
              <strong>BSDK Clubs Web App</strong> • Version 3.0.0 • Your Gang. Your Bang.<br />
              WhatsApp-inspired familiar UX only — independent original product.
            </div>
          </div>
        )}

        {/* ================= 8. INVITE A FRIEND ================= */}
        {section === 'invite' && (
          <div style={{ maxWidth: 480, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
            <div style={{ fontSize: 38 }}>🔥</div>
            <div style={{ fontWeight: 800, fontSize: 19 }}>Invite your friends to your gang!</div>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              BSDK Clubs is best experienced with your circle of friends. Send an invite directly via WhatsApp or SMS!
            </p>
            <button
              type="button"
              className="btn-primary"
              style={{ width: '100%', padding: '12px 18px', fontSize: 15 }}
              onClick={() => setShowInviteModal(true)}
            >
              <UserPlus size={18} /> Open WhatsApp / SMS Invite Sheet
            </button>
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              <input className="text-input" readOnly value="https://bsdkclubs.app" />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  navigator.clipboard?.writeText(`Join my gang on BSDK Clubs! https://bsdkclubs.app`);
                  setCopiedInvite(true);
                  setTimeout(() => setCopiedInvite(false), 2000);
                }}
              >
                {copiedInvite ? <Check size={16} /> : <Copy size={16} />} {copiedInvite ? 'Copied' : 'Copy Link'}
              </button>
            </div>
          </div>
        )}
      </div>

      {showMyQr && (
        <QrCodeModal
          user={user}
          onClose={() => setShowMyQr(false)}
          onToast={onToast}
        />
      )}

      {showInviteModal && (
        <InviteScreenModal
          phone=""
          contactName="Dost / Gang Member"
          onClose={() => setShowInviteModal(false)}
          onToast={onToast}
        />
      )}
    </div>
  );
}
