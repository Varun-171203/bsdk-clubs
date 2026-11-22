import React, { useState, useEffect, useRef } from 'react';
import {
  Phone, PhoneOff, Video, VideoOff, Mic, MicOff, Volume2, VolumeX,
  RotateCw, Wand2, Users, ShieldAlert, Sparkles, Check
} from 'lucide-react';
import { createVoiceChanger, VOICE_PRESETS } from '../services/voiceChanger.js';
import { apiRequest } from '../api.js';

/**
 * Ringtone generator using Web Audio API
 * Generates telephone call tones (Incoming ring and Outgoing ringback)
 */
function createToneGenerator() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return { playRingtone: () => {}, playRingback: () => {}, stop: () => {} };

  let ctx = null;
  let intervalId = null;

  function initCtx() {
    if (!ctx) ctx = new AudioCtx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function playDualTone(f1, f2, durationMs) {
    const c = initCtx();
    const osc1 = c.createOscillator();
    const osc2 = c.createOscillator();
    const gain = c.createGain();

    osc1.frequency.setValueAtTime(f1, c.currentTime);
    osc2.frequency.setValueAtTime(f2, c.currentTime);
    gain.gain.setValueAtTime(0.08, c.currentTime);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(c.destination);

    osc1.start();
    osc2.start();

    setTimeout(() => {
      try {
        gain.gain.linearRampToValueAtTime(0.001, c.currentTime + 0.05);
        setTimeout(() => {
          osc1.stop();
          osc2.stop();
          osc1.disconnect();
          osc2.disconnect();
          gain.disconnect();
        }, 60);
      } catch {}
    }, durationMs);
  }

  return {
    playRingtone: () => {
      // European/WhatsApp dual ring tone (440Hz + 480Hz): 1.5s on, 3s off
      if (intervalId) clearInterval(intervalId);
      playDualTone(440, 480, 1400);
      intervalId = setInterval(() => {
        playDualTone(440, 480, 1400);
      }, 3500);
    },
    playRingback: () => {
      // Standard outgoing ringback (440Hz + 480Hz): 1s on, 3s off
      if (intervalId) clearInterval(intervalId);
      playDualTone(440, 480, 1000);
      intervalId = setInterval(() => {
        playDualTone(440, 480, 1000);
      }, 3000);
    },
    stop: () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      if (ctx) {
        try { ctx.close(); } catch {}
        ctx = null;
      }
    }
  };
}

export function CallScreen({
  callSession,      // { mode: 'incoming' | 'outgoing' | 'connected', callType: 'voice' | 'video', roomId, peer, club, isGroup }
  currentUser,
  socket,
  onEndCall
}) {
  const [callState, setCallState] = useState(callSession.mode || 'outgoing'); // 'incoming' | 'outgoing' | 'connected'
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(callSession.callType === 'video');
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [facingMode, setFacingMode] = useState('user'); // 'user' | 'environment'
  const [callDuration, setCallDuration] = useState(0);
  const [activePreset, setActivePreset] = useState('normal');
  const [showVoiceMenu, setShowVoiceMenu] = useState(false);
  const [groupParticipants, setGroupParticipants] = useState([]);
  const [warningAccepted, setWarningAccepted] = useState(() => {
    return localStorage.getItem('bsdk_club_voice_warning_accepted') === 'true';
  });

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);

  const localStreamRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const voiceChangerRef = useRef(null);
  const timerRef = useRef(null);
  const toneGenRef = useRef(null);
  const candidateQueueRef = useRef([]);

  const isVideo = callSession.callType === 'video' && !callSession.isGroup;
  const isClubCall = Boolean(callSession.isGroup || callSession.club);

  // Initialize tone generator
  useEffect(() => {
    toneGenRef.current = createToneGenerator();
    if (callState === 'incoming') {
      toneGenRef.current.playRingtone();
    } else if (callState === 'outgoing') {
      toneGenRef.current.playRingback();
    }
    return () => {
      toneGenRef.current?.stop();
    };
  }, []);

  // For club calls or outgoing calls, initialize early
  useEffect(() => {
    if (isClubCall) {
      if (warningAccepted) {
        socket?.emit('call:join_room', {
          room_id: callSession.roomId,
          alias_name: callSession.club?.my_alias || 'Member',
          alias_color: callSession.club?.my_alias_color || '#128C7E',
          is_video: isVideo
        });
        setCallState('connected');
        setupPeerConnection();
      }
    } else if (callSession.mode === 'outgoing') {
      setupPeerConnection();
    }
  }, [warningAccepted]);

  // Format call duration into MM:SS
  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Timer loop when connected
  useEffect(() => {
    if (callState === 'connected') {
      toneGenRef.current?.stop();
      timerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callState]);

  // Clean up media tracks and WebRTC on unmount
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
      if (voiceChangerRef.current) {
        voiceChangerRef.current.close();
      }
    };
  }, []);

  // Socket event listeners for call lifecycle
  useEffect(() => {
    if (!socket) return;

    const handleAnswered = async () => {
      toneGenRef.current?.stop();
      setCallState('connected');
      if (!peerConnectionRef.current) {
        await setupPeerConnection();
      }
      const pc = peerConnectionRef.current;
      if (pc && callSession.mode === 'outgoing') {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('call:signal', {
            room_id: callSession.roomId,
            to_user_id: callSession.peer?.id,
            signal: { sdp: offer }
          });
        } catch (e) {
          console.warn('[Create Offer on Answer Error]', e);
        }
      }
    };

    const handleRejected = () => {
      toneGenRef.current?.stop();
      handleTerminate('declined');
    };

    const handleEnded = () => {
      toneGenRef.current?.stop();
      handleTerminate('completed');
    };

    const handleUserJoined = (data) => {
      setGroupParticipants((prev) => {
        if (prev.some((p) => p.user_id === data.user_id)) return prev;
        return [...prev, data];
      });
    };

    const handleUserLeft = (data) => {
      setGroupParticipants((prev) => prev.filter((p) => p.user_id !== data.user_id));
    };

    const handleSignal = async ({ from_user_id, signal }) => {
      // Ignore self-signals
      if (from_user_id && currentUser?.id && from_user_id === currentUser.id) return;

      if (!peerConnectionRef.current) {
        await setupPeerConnection();
      }
      const pc = peerConnectionRef.current;
      if (!pc || !signal) return;

      try {
        if (signal.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          if (signal.sdp.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('call:signal', {
              room_id: callSession.roomId,
              to_user_id: from_user_id,
              signal: { sdp: answer }
            });
          }
          // Drain candidate queue
          while (candidateQueueRef.current.length > 0) {
            const cand = candidateQueueRef.current.shift();
            try {
              await pc.addIceCandidate(cand);
            } catch (err) {
              console.warn('[Drain candidate error]', err);
            }
          }
        } else if (signal.candidate) {
          if (pc.remoteDescription && pc.remoteDescription.type) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } else {
            candidateQueueRef.current.push(new RTCIceCandidate(signal.candidate));
          }
        }
      } catch (err) {
        console.warn('[WebRTC Signal Error]', err);
      }
    };

    socket.on('call:answered', handleAnswered);
    socket.on('call:rejected', handleRejected);
    socket.on('call:ended', handleEnded);
    socket.on('call:user_joined', handleUserJoined);
    socket.on('call:user_left', handleUserLeft);
    socket.on('call:signal', handleSignal);

    return () => {
      socket.off('call:answered', handleAnswered);
      socket.off('call:rejected', handleRejected);
      socket.off('call:ended', handleEnded);
      socket.off('call:user_joined', handleUserJoined);
      socket.off('call:user_left', handleUserLeft);
      socket.off('call:signal', handleSignal);
    };
  }, [socket, callSession.roomId, callSession.mode, callSession.peer?.id, currentUser?.id]);

  // Request user media and create voice changer
  async function initializeMedia() {
    try {
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: isVideo ? { facingMode } : false
      };

      const rawStream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = rawStream;

      // Apply Voice Changer DSP
      const vc = createVoiceChanger(rawStream, activePreset);
      voiceChangerRef.current = vc;

      // Display local video
      if (localVideoRef.current && isVideo) {
        localVideoRef.current.srcObject = rawStream;
      }

      return vc.outputStream;
    } catch (err) {
      console.error('[Media Access Error]', err);
      return null;
    }
  }

  // Set up RTCPeerConnection for WebRTC
  async function setupPeerConnection() {
    if (peerConnectionRef.current) return;

    const stream = await initializeMedia();
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    peerConnectionRef.current = pc;

    if (stream) {
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('call:signal', {
          room_id: callSession.roomId,
          to_user_id: callSession.peer?.id,
          signal: { candidate: event.candidate }
        });
      }
    };

    pc.ontrack = (event) => {
      if (remoteVideoRef.current && isVideo) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = event.streams[0];
      }
    };

    // If caller, create offer
    if (callSession.mode === 'outgoing') {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket?.emit('call:signal', {
          room_id: callSession.roomId,
          to_user_id: callSession.peer?.id,
          signal: { sdp: offer }
        });
      } catch (e) {
        console.warn('[Create Offer Error]', e);
      }
    }
  }

  // Handle answering incoming call
  async function handleAnswer() {
    toneGenRef.current?.stop();
    setCallState('connected');

    if (socket) {
      socket.emit('call:answer', {
        room_id: callSession.roomId,
        to_user_id: callSession.peer?.id
      });
    }

    await setupPeerConnection();
  }

  // Handle rejecting call
  function handleDecline() {
    toneGenRef.current?.stop();
    if (socket) {
      socket.emit('call:reject', {
        room_id: callSession.roomId,
        to_user_id: callSession.peer?.id,
        reason: 'declined'
      });
    }
    handleTerminate('declined');
  }

  // Terminate and record call metadata
  async function handleTerminate(status = 'completed') {
    toneGenRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);

    // End call on backend to save metadata only
    try {
      await apiRequest('/calls/end', {
        method: 'POST',
        body: {
          room_id: callSession.roomId,
          caller_id: callSession.mode === 'outgoing' ? currentUser?.id : callSession.peer?.id,
          callee_id: callSession.isGroup ? null : (callSession.mode === 'outgoing' ? callSession.peer?.id : currentUser?.id),
          club_id: callSession.club?.id || null,
          call_type: callSession.callType,
          is_group: Boolean(callSession.isGroup),
          status: callDuration > 0 ? 'completed' : status,
          duration_seconds: callDuration
        }
      });
    } catch (err) {
      console.warn('[Calls End API Warning]', err);
    }

    if (socket) {
      socket.emit('call:leave', { room_id: callSession.roomId });
    }

    onEndCall?.({
      duration: callDuration,
      status: callDuration > 0 ? 'completed' : status
    });
  }

  // Toggle Mute Audio
  function toggleMute() {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  }

  // Toggle Video
  function toggleVideo() {
    if (localStreamRef.current && isVideo) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
      }
    }
  }

  // Flip Camera
  async function flipCamera() {
    if (!isVideo || !localStreamRef.current) return;
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextMode);

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextMode }
      });
      const oldVideoTrack = localStreamRef.current.getVideoTracks()[0];
      const newVideoTrack = newStream.getVideoTracks()[0];

      if (oldVideoTrack) {
        localStreamRef.current.removeTrack(oldVideoTrack);
        oldVideoTrack.stop();
      }
      localStreamRef.current.addTrack(newVideoTrack);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }

      // Replace track on RTCPeerConnection
      if (peerConnectionRef.current) {
        const sender = peerConnectionRef.current.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) {
          sender.replaceTrack(newVideoTrack);
        }
      }
    } catch (err) {
      console.warn('[Camera Flip Error]', err);
    }
  }

  // Change Voice Changer Preset
  function handleSelectVoicePreset(presetId) {
    setActivePreset(presetId);
    if (voiceChangerRef.current) {
      voiceChangerRef.current.setPreset(presetId);
    }
    setShowVoiceMenu(false);
  }

  // Show Club Warning if first time joining club voice call
  if (isClubCall && !warningAccepted) {
    return (
      <div className="wa-call-overlay">
        <div className="wa-call-warning-box">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#F59E0B', marginBottom: 12 }}>
            <ShieldAlert size={28} />
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#FFFFFF' }}>Voice Call Notice</h3>
          </div>
          <p style={{ fontSize: 14.5, lineHeight: 1.5, color: '#E2E8F0', marginBottom: 20 }}>
            Voice calls can reveal who you are. Other members may recognise your voice.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn-secondary"
              style={{ background: 'rgba(255,255,255,0.15)', color: '#FFFFFF', border: 'none' }}
              onClick={() => handleTerminate('declined')}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              style={{ background: '#25D366', color: '#000000', fontWeight: 700 }}
              onClick={() => {
                localStorage.setItem('bsdk_club_voice_warning_accepted', 'true');
                setWarningAccepted(true);
                if (callSession.mode === 'incoming') {
                  handleAnswer();
                } else {
                  setupPeerConnection();
                }
              }}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  const displayName = isClubCall
    ? (callSession.club?.name || 'Club Voice Call')
    : (callSession.peer?.name || callSession.peer?.real_name || 'Contact');

  const displaySubtitle = isClubCall
    ? `Club Call (${groupParticipants.length + 1}/8 members)`
    : (callState === 'connected' ? formatTimer(callDuration) : (callState === 'incoming' ? 'Incoming call...' : 'Calling...'));

  return (
    <div className="wa-call-overlay">
      {/* Hidden remote audio element */}
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />

      {/* Video feeds for video call */}
      {isVideo && callState === 'connected' && (
        <div className="wa-call-video-container">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="wa-remote-video"
          />
          <div className="wa-local-video-pip">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="wa-local-video"
            />
          </div>
        </div>
      )}

      {/* Voice Call Avatar View */}
      {(!isVideo || callState !== 'connected') && (
        <div className="wa-call-header-info">
          <div className="wa-call-pulse-avatar">
            {callSession.peer?.photo_url || callSession.club?.photo_url ? (
              <img
                src={callSession.peer?.photo_url || callSession.club?.photo_url}
                alt={displayName}
                className="wa-call-avatar-img"
              />
            ) : (
              <div
                className="wa-call-avatar-fallback"
                style={{ background: callSession.club ? '#128C7E' : '#075E54' }}
              >
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <h2 className="wa-call-display-name">{displayName}</h2>
          <p className="wa-call-status-subtitle">{displaySubtitle}</p>

          {/* Group member alias chips (aliases ONLY, max 8) */}
          {isClubCall && (
            <div className="wa-call-group-aliases">
              <span className="wa-alias-chip" style={{ background: '#128C7E' }}>
                {callSession.club?.my_alias || 'You'}
              </span>
              {groupParticipants.map((p, i) => (
                <span
                  key={i}
                  className="wa-alias-chip"
                  style={{ background: p.alias_color || '#075E54' }}
                >
                  {p.alias_name}
                </span>
              ))}
            </div>
          )}

          {/* Active Voice Changer Preset Pill */}
          {callState === 'connected' && (
            <button
              type="button"
              className="wa-voice-changer-badge"
              onClick={() => setShowVoiceMenu(true)}
            >
              <Sparkles size={14} style={{ marginRight: 5 }} />
              Voice: {VOICE_PRESETS.find((p) => p.id === activePreset)?.name || 'Normal'}
            </button>
          )}
        </div>
      )}

      {/* Voice Changer Selector Modal */}
      {showVoiceMenu && (
        <div className="wa-voice-menu-modal" onClick={() => setShowVoiceMenu(false)}>
          <div className="wa-voice-menu-content" onClick={(e) => e.stopPropagation()}>
            <h4 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 700, color: '#075E54' }}>
              Select Voice Disguise
            </h4>
            <div className="wa-voice-presets-list">
              {VOICE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`wa-voice-preset-row ${activePreset === p.id ? 'active' : ''}`}
                  onClick={() => handleSelectVoicePreset(p.id)}
                >
                  <span style={{ fontSize: 20 }}>{p.icon}</span>
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{p.description}</div>
                  </div>
                  {activePreset === p.id && <Check size={18} color="#25D366" />}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn-secondary"
              style={{ width: '100%', marginTop: 12 }}
              onClick={() => setShowVoiceMenu(false)}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Control Dock Bottom */}
      <div className="wa-call-bottom-dock">
        {callState === 'incoming' ? (
          /* Incoming Call Actions: Answer (Green) or Decline (Red) */
          <div className="wa-call-incoming-actions">
            <button
              type="button"
              className="wa-call-btn wa-call-btn-decline"
              onClick={handleDecline}
              title="Decline"
            >
              <PhoneOff size={28} />
            </button>
            <button
              type="button"
              className="wa-call-btn wa-call-btn-answer"
              onClick={handleAnswer}
              title="Answer"
            >
              <Phone size={28} />
            </button>
          </div>
        ) : (
          /* Active Call In-Call Controls */
          <div className="wa-call-active-actions">
            {/* Speaker Toggle */}
            <button
              type="button"
              className={`wa-call-action-btn ${isSpeaker ? 'active' : ''}`}
              onClick={() => setIsSpeaker(!isSpeaker)}
              title="Speaker"
            >
              {isSpeaker ? <Volume2 size={22} /> : <VolumeX size={22} />}
            </button>

            {/* Video Flip (for video calls) */}
            {isVideo && (
              <button
                type="button"
                className="wa-call-action-btn"
                onClick={flipCamera}
                title="Flip Camera"
              >
                <RotateCw size={22} />
              </button>
            )}

            {/* Video Toggle (for video calls) */}
            {isVideo && (
              <button
                type="button"
                className={`wa-call-action-btn ${!isVideoEnabled ? 'muted' : ''}`}
                onClick={toggleVideo}
                title="Toggle Video"
              >
                {isVideoEnabled ? <Video size={22} /> : <VideoOff size={22} />}
              </button>
            )}

            {/* Mute Mic */}
            <button
              type="button"
              className={`wa-call-action-btn ${isMuted ? 'muted' : ''}`}
              onClick={toggleMute}
              title="Mute"
            >
              {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
            </button>

            {/* Voice Changer Preset Selector */}
            <button
              type="button"
              className={`wa-call-action-btn ${activePreset !== 'normal' ? 'magic-active' : ''}`}
              onClick={() => setShowVoiceMenu(true)}
              title="Voice Changer"
            >
              <Wand2 size={22} />
            </button>

            {/* End Call Button */}
            <button
              type="button"
              className="wa-call-btn wa-call-btn-end"
              onClick={() => handleTerminate('completed')}
              title="End Call"
            >
              <PhoneOff size={26} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
