import React, { useState, useEffect, useRef } from 'react';
import {
  X, Camera, RefreshCw, Plus, Trash2, Copy, Check, ShieldAlert,
  BarChart2, Sparkles, Users, Image as ImageIcon, Send
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { apiRequest, resolveMediaUrl } from '../api.js';

const ALIAS_COLORS = [
  '#128C7E', '#F472B6', '#E11D48', '#D97706', '#7C3AED', '#0284C7',
  '#059669', '#EA580C', '#4F46E5', '#BE185D', '#0D9488', '#9333EA'
];

// ============================================================
// 1. In-App Camera Snap Modal (NO Gallery Upload - Snapchat Rule)
// ============================================================
export function CameraSnapModal({ title = 'Take Live Snap', onClose, onCapture }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [cameraError, setCameraError] = useState('');
  const [capturedDataUrl, setCapturedDataUrl] = useState(null);
  const [caption, setCaption] = useState('');
  const [facingMode, setFacingMode] = useState('user');
  const [uploading, setUploading] = useState(false);
  const [studioText, setStudioText] = useState('Hostel Live Moment 📸');
  const [studioBg, setStudioBg] = useState('#075E54');

  useEffect(() => {
    let active = true;
    async function startCam() {
      setCameraError('');
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera API is not available in this browser.');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 720 }, height: { ideal: 720 } },
          audio: false
        });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch {
        if (active) {
          setCameraError('Camera not detected. You can click a test snap from Snap Studio (gallery upload disabled).');
        }
      }
    }
    if (!capturedDataUrl) startCam();
    return () => {
      active = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [facingMode, capturedDataUrl]);

  function takePhoto() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (videoRef.current && streamRef.current && videoRef.current.videoWidth > 0) {
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    } else {
      // Live Canvas Snap fallback when device has no webcam
      canvas.width = 640;
      canvas.height = 480;
      ctx.fillStyle = studioBg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.arc(540, 90, 120, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 30px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(studioText || 'Live BSDK Snap', 320, 230);
      ctx.font = '16px sans-serif';
      ctx.fillStyle = '#A7F3D0';
      ctx.fillText(`LIVE CAM • ${new Date().toLocaleTimeString()}`, 320, 275);
    }
    setCapturedDataUrl(canvas.toDataURL('image/jpeg', 0.85));
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  async function handleSend() {
    if (!capturedDataUrl) return;
    setUploading(true);
    try {
      const { upload_url } = await apiRequest('/media/upload-url', { method: 'POST' });
      const uploadPath = upload_url.replace('/api/v1', '');
      const { media_url } = await apiRequest(uploadPath, {
        method: 'POST',
        body: { data_url: capturedDataUrl }
      });
      await onCapture({ media_url, caption });
      onClose();
    } catch (err) {
      alert(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 17 }}>
            <Camera size={20} color="#128C7E" /> {title}
          </div>
          <button className="icon-btn dark-hover" onClick={onClose}><X size={19} /></button>
        </div>

        <div className="trust-note" style={{ marginBottom: 12 }}>
          <strong>In-App Camera Only:</strong> Gallery uploads are disabled to keep all media authentic and live.
        </div>

        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {!capturedDataUrl ? (
          <div>
            {!cameraError ? (
              <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#000', aspectRatio: '4/3' }}>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </div>
            ) : (
              <div style={{ borderRadius: 12, padding: 20, background: studioBg, color: '#fff', textAlign: 'center', minHeight: 220, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12 }}>
                <div style={{ fontSize: 12, opacity: 0.85 }}>{cameraError}</div>
                <input
                  className="text-input"
                  value={studioText}
                  onChange={(e) => setStudioText(e.target.value)}
                  placeholder="Live snap caption..."
                  style={{ background: 'rgba(255,255,255,0.16)', color: '#fff', borderColor: 'rgba(255,255,255,0.3)', textAlign: 'center' }}
                />
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
                  {['#075E54', '#128C7E', '#7C3AED', '#BE185D', '#0284C7', '#1F2C34'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setStudioBg(c)}
                      style={{
                        width: 24, height: 24, borderRadius: '50%', background: c,
                        border: studioBg === c ? '2.5px solid #fff' : '2px solid transparent'
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 14 }}>
              {!cameraError && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setFacingMode((m) => (m === 'user' ? 'environment' : 'user'))}
                >
                  <RefreshCw size={16} /> Flip Camera
                </button>
              )}
              <button type="button" className="btn-primary" onClick={takePhoto}>
                <Camera size={17} /> Capture Live Snap
              </button>
            </div>
          </div>
        ) : (
          <div>
            <img
              src={capturedDataUrl}
              alt="Captured snap"
              style={{ width: '100%', maxHeight: 300, objectFit: 'cover', borderRadius: 12, marginBottom: 12 }}
            />
            <div className="field-group">
              <input
                className="text-input"
                placeholder="Add a caption (optional)..."
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <button type="button" className="btn-secondary" onClick={() => setCapturedDataUrl(null)}>
                Retake
              </button>
              <button type="button" className="btn-primary" onClick={handleSend} disabled={uploading}>
                <Send size={16} /> {uploading ? 'Sending...' : 'Send Anonymously'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 2. Create Anonymous Poll Modal (2-6 Options + Multi-Choice)
// ============================================================
export function CreatePollModal({ clubId, onClose, onCreated }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiChoice, setMultiChoice] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function updateOpt(idx, val) {
    setOptions((prev) => prev.map((o, i) => (i === idx ? val : o)));
  }

  function addOpt() {
    if (options.length < 6) setOptions((prev) => [...prev, '']);
  }

  function removeOpt(idx) {
    if (options.length > 2) setOptions((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const validOpts = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim() || validOpts.length < 2) {
      setError('Question aur kam se kam 2 options likho.');
      return;
    }
    setLoading(true);
    try {
      const clientMessageId = `cmsg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const data = await apiRequest(`/clubs/${clubId}/polls`, {
        method: 'POST',
        body: {
          question: question.trim(),
          options: validOpts,
          multi_choice: multiChoice,
          client_message_id: clientMessageId
        }
      });
      onCreated({ ...data.message, is_mine: true, client_message_id: clientMessageId });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 17 }}>
            <BarChart2 size={20} color="#128C7E" /> Create Anonymous Poll
          </div>
          <button className="icon-btn dark-hover" onClick={onClose}><X size={19} /></button>
        </div>

        <div className="trust-note" style={{ marginBottom: 14 }}>
          Poll creator and voter selections are completely anonymous. No one can see who voted for what.
        </div>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field-group">
            <label className="field-label">Question</label>
            <input
              className="text-input"
              placeholder="e.g. Where should we go this weekend?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              required
            />
          </div>

          <div className="field-group">
            <label className="field-label">Options (2–6)</label>
            {options.map((opt, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input
                  className="text-input"
                  placeholder={`Option ${idx + 1}`}
                  value={opt}
                  onChange={(e) => updateOpt(idx, e.target.value)}
                  required={idx < 2}
                />
                {options.length > 2 && (
                  <button type="button" className="icon-btn dark-hover" onClick={() => removeOpt(idx)}>
                    <Trash2 size={16} color="#F87171" />
                  </button>
                )}
              </div>
            ))}
            {options.length < 6 && (
              <button type="button" className="btn-secondary" onClick={addOpt} style={{ alignSelf: 'flex-start', marginTop: 4 }}>
                <Plus size={15} /> Add Option
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0 16px' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Allow multiple answers</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Members ek se zyada options select kar payenge</div>
            </div>
            <button
              type="button"
              className={`toggle-switch ${multiChoice ? 'on' : ''}`}
              onClick={() => setMultiChoice((v) => !v)}
            >
              <span className="toggle-knob" />
            </button>
          </div>

          <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Posting Poll...' : 'Post Anonymous Poll'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// 3. Change Per-Group Alias Modal (FR-05)
// ============================================================
export function AliasModal({ club, onClose, onUpdated }) {
  const [alias, setAlias] = useState(club.my_alias || '');
  const [color, setColor] = useState(club.my_alias_color || '#128C7E');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await apiRequest(`/clubs/${club.id}/my-alias`, {
        method: 'PATCH',
        body: { alias_name: alias, alias_color: color }
      });
      onUpdated(data);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRandomize() {
    setError('');
    setLoading(true);
    try {
      const data = await apiRequest(`/clubs/${club.id}/my-alias`, {
        method: 'PATCH',
        body: { randomize: true }
      });
      setAlias(data.alias_name);
      setColor(data.alias_color);
      onUpdated(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 17 }}>
            <Sparkles size={20} color="#128C7E" /> Change Display Alias
          </div>
          <button className="icon-btn dark-hover" onClick={onClose}><X size={19} /></button>
        </div>

        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
          Choose your display name for <strong>{club.name}</strong>. Your alias will be different in other clubs.
        </p>

        {error && <div className="error-banner">{error}</div>}

        <div style={{ padding: 12, borderRadius: 12, background: 'var(--bg-chat)', marginBottom: 14 }}>
          <div className="msg-bubble" style={{ background: 'var(--bubble-other)', maxWidth: 260 }}>
            <div className="msg-alias" style={{ color }}>{alias || 'YourAlias_07'}</div>
            <div style={{ fontSize: 13.5 }}>This is how your name appears in chat</div>
          </div>
        </div>

        <form onSubmit={handleSave}>
          <div className="field-group">
            <label className="field-label">Temporary Display Name</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="text-input"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="e.g. TurboSamosa_42"
                required
              />
              <button type="button" className="btn-secondary" onClick={handleRandomize} disabled={loading} title="Randomize">
                <RefreshCw size={16} />
              </button>
            </div>
          </div>

          <div className="field-group">
            <label className="field-label">Alias Colour</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              {ALIAS_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  style={{
                    width: 28, height: 28, borderRadius: '50%', background: c,
                    border: color === c ? '3px solid var(--text-primary)' : '2px solid transparent'
                  }}
                />
              ))}
            </div>
          </div>

          <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Saving...' : 'Save Alias'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// 4. Create Club Modal
// ============================================================
const CLUB_AVATARS = [
  'https://api.dicebear.com/9.x/shapes/svg?seed=ClubA&backgroundColor=075e54',
  'https://api.dicebear.com/9.x/shapes/svg?seed=ClubB&backgroundColor=128c7e',
  'https://api.dicebear.com/9.x/shapes/svg?seed=ClubC&backgroundColor=1f2c34',
  'https://api.dicebear.com/9.x/shapes/svg?seed=ClubD&backgroundColor=7c3aed',
  'https://api.dicebear.com/9.x/shapes/svg?seed=ClubE&backgroundColor=be185d'
];

export function CreateClubModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [disappearing, setDisappearing] = useState(604800);
  const [photo, setPhoto] = useState(CLUB_AVATARS[0]);
  const [createdClub, setCreatedClub] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await apiRequest('/clubs', {
        method: 'POST',
        body: { name, description, photo_url: photo, disappearing_seconds: disappearing }
      });
      setCreatedClub(data.club);
      onCreated(data.club);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function copyCode() {
    if (!createdClub) return;
    navigator.clipboard?.writeText(createdClub.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 17 }}>
            <Users size={20} color="#128C7E" /> {createdClub ? 'Club Created! 🎉' : 'Create New Club'}
          </div>
          <button className="icon-btn dark-hover" onClick={onClose}><X size={19} /></button>
        </div>

        {!createdClub ? (
          <form onSubmit={handleCreate}>
            {error && <div className="error-banner">{error}</div>}
            <div className="field-group">
              <label className="field-label">Club Icon</label>
              <div style={{ display: 'flex', gap: 10 }}>
                {CLUB_AVATARS.map((url) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setPhoto(url)}
                    style={{
                      padding: 2, borderRadius: '50%',
                      border: photo === url ? '2.5px solid #128C7E' : '2.5px solid transparent'
                    }}
                  >
                    <img src={url} alt="Club icon" className="avatar-circle" />
                  </button>
                ))}
              </div>
            </div>
            <div className="field-group">
              <label className="field-label">Club Name</label>
              <input
                className="text-input"
                placeholder="e.g. College Gang 2026"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="field-group">
              <label className="field-label">Description</label>
              <textarea
                className="text-input"
                rows={2}
                placeholder="What is this club about?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="field-group">
              <label className="field-label">Disappearing Messages Default</label>
              <select
                className="text-input"
                value={disappearing}
                onChange={(e) => setDisappearing(Number(e.target.value))}
              >
                <option value={604800}>7 days (Recommended default)</option>
                <option value={86400}>24 hours</option>
                <option value={0}>Off</option>
              </select>
            </div>
            <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={loading}>
              {loading ? 'Creating Club...' : 'Create Club & Generate Invite'}
            </button>
          </form>
        ) : (
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <img src={createdClub.photo_url} alt={createdClub.name} className="avatar-circle avatar-lg" />
            <div style={{ fontWeight: 800, fontSize: 18 }}>{createdClub.name}</div>
            <div className="trust-note" style={{ width: '100%' }}>
              Your alias in this club: <strong style={{ color: createdClub.my_alias_color }}>{createdClub.my_alias}</strong>
            </div>
            <div style={{ padding: 14, background: '#fff', borderRadius: 12, border: '1px solid var(--border)' }}>
              <QRCodeSVG value={`bsdkclubs://join/${createdClub.invite_code}`} size={136} fgColor="#075E54" />
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Share this invite code with your friends:
            </div>
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              <input className="text-input" readOnly value={createdClub.invite_code} style={{ textAlign: 'center', fontWeight: 800, letterSpacing: '0.1em' }} />
              <button type="button" className="btn-primary" onClick={copyCode}>
                {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <button type="button" className="btn-secondary" style={{ width: '100%' }} onClick={onClose}>
              Open Club Chat →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 5. Pre-Join Preview Modal (Page 3 Step 5: See members BEFORE joining!)
// ============================================================
export function JoinPreviewModal({ inviteCode, previewData, onClose, onJoined }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleAccept() {
    setError('');
    setLoading(true);
    try {
      const data = await apiRequest('/clubs/join', {
        method: 'POST',
        body: { invite_code: inviteCode }
      });
      onJoined(data.club);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ fontWeight: 700, fontSize: 17 }}>Preview Club Before Joining</div>
          <button className="icon-btn dark-hover" onClick={onClose}><X size={19} /></button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <img src={previewData.photo_url} alt={previewData.name} className="avatar-circle avatar-lg" />
          <div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>{previewData.name}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{previewData.description || 'Private anonymous club'}</div>
            <div style={{ fontSize: 12, color: 'var(--brand-green)', fontWeight: 600, marginTop: 3 }}>
              {previewData.member_count} real members already in this club
            </div>
          </div>
        </div>

        <div className="trust-note" style={{ marginBottom: 12 }}>
          Upon joining, you will receive a unique anonymous alias. Your real name will not be shown in chat.
        </div>

        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: 'var(--text-secondary)' }}>
          CURRENT MEMBERS (REAL NAMES)
        </div>
        <div style={{ maxHeight: 190, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: '4px 12px', marginBottom: 16 }}>
          {previewData.members.map((m) => (
            <div key={m.user_id} className="member-row">
              <img src={m.profile_photo_url} alt={m.real_name} className="avatar-circle avatar-sm" />
              <div style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{m.real_name}</div>
              {m.role === 'admin' && <span className="admin-badge">Admin</span>}
            </div>
          ))}
        </div>

        {error && <div className="error-banner">{error}</div>}

        {previewData.already_member ? (
          <button type="button" className="btn-secondary" style={{ width: '100%' }} onClick={onClose}>
            Tum already is club mein ho!
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn-danger" style={{ flex: 1 }} onClick={onClose}>
              Reject
            </button>
            <button type="button" className="btn-primary" style={{ flex: 1 }} onClick={handleAccept} disabled={loading}>
              {loading ? 'Joining...' : 'Accept & Join Club'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 6. Report Modal (Anonymous Reporter)
// ============================================================
const REPORT_REASONS = [
  'Harassment or bullying',
  'Hate speech or threats',
  'Spam or scam links',
  'Doxxing / exposing private info',
  'Inappropriate or illegal content',
  'Other safety concern'
];

export function ReportModal({ target, onClose, onSubmitted }) {
  const [reason, setReason] = useState(REPORT_REASONS[0]);
  const [details, setDetails] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await apiRequest('/reports', {
        method: 'POST',
        body: {
          club_id: target.club_id,
          message_id: target.message_id || null,
          reported_user_id: target.reported_user_id || null,
          reason,
          details
        }
      });
      onSubmitted(data.message);
      onClose();
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 17, color: '#DC2626' }}>
            <ShieldAlert size={20} /> Report {target.label || 'Content'}
          </div>
          <button className="icon-btn dark-hover" onClick={onClose}><X size={19} /></button>
        </div>

        <div className="trust-note" style={{ marginBottom: 14 }}>
          Your identity as a reporter remains confidential. Anonymity does not mean unaccountability.
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field-group">
            <label className="field-label">Reason</label>
            <select className="text-input" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REPORT_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="field-group">
            <label className="field-label">Extra Details (optional)</label>
            <textarea
              className="text-input"
              rows={3}
              placeholder="Kya hua tha? Brief context do..."
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn-secondary" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-danger" style={{ flex: 1 }} disabled={loading}>
              {loading ? 'Submitting...' : 'Submit Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// 7. QR Code Modal
// ============================================================
export function QrModal({ title, subtitle, value, codeLabel, onClose }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard?.writeText(codeLabel || value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ fontWeight: 700, fontSize: 17 }}>{title}</div>
          <button className="icon-btn dark-hover" onClick={onClose}><X size={19} /></button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>{subtitle}</p>
        <div style={{ display: 'inline-block', padding: 18, background: '#fff', borderRadius: 16, border: '1px solid var(--border)', marginBottom: 14 }}>
          <QRCodeSVG value={value} size={180} fgColor="#075E54" />
        </div>
        {codeLabel && (
          <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: '0.12em', marginBottom: 14, color: 'var(--brand-green)' }}>
            {codeLabel}
          </div>
        )}
        <button type="button" className="btn-primary" style={{ width: '100%' }} onClick={copy}>
          {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied!' : 'Copy Invite Code / Link'}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 8. Media Gallery Modal (Snaps shared in a club)
// ============================================================
export function MediaGalleryModal({ clubName, messages, onClose }) {
  const mediaMsgs = messages.filter((m) => m.type === 'image' && m.media_url && !m.deleted_at);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 17 }}>
            <ImageIcon size={20} color="#128C7E" /> {clubName} — Media Gallery
          </div>
          <button className="icon-btn dark-hover" onClick={onClose}><X size={19} /></button>
        </div>
        {mediaMsgs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 12px', color: 'var(--text-secondary)' }}>
            No live camera snaps have been shared yet.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {mediaMsgs.map((m) => (
              <div key={m.id} style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                <img src={resolveMediaUrl(m.media_url)} alt="Club snap" style={{ width: '100%', height: 100, objectFit: 'cover' }} />
                <div style={{ fontSize: 10.5, padding: '3px 5px', fontWeight: 700, color: m.alias_color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {m.alias_name}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
