/**
 * BSDK Clubs Real-Time Voice Changer DSP Engine
 * Uses Web Audio API to process local microphone audio in real-time before sending to WebRTC peers.
 * Protects user anonymity in anonymous Club voice calls and 1-to-1 calls.
 * 
 * Presets:
 * - normal: Unaltered natural voice
 * - robot: Metallic robotic ring modulation (50Hz carrier wave)
 * - deep: Low-pitch / heavy bass boost + low-pass filter
 * - chipmunk: High-pitch spectral shift + formant boost
 * - radio: 300Hz-3400Hz bandpass filter + slight overdrive crunch
 */

export const VOICE_PRESETS = [
  { id: 'normal', name: 'Normal', icon: '🎤', description: 'Original voice' },
  { id: 'robot', name: 'Robot', icon: '🤖', description: 'Metallic cyber voice' },
  { id: 'deep', name: 'Deep Voice', icon: '🦁', description: 'Deep low-pitch disguise' },
  { id: 'chipmunk', name: 'Chipmunk', icon: '🐿️', description: 'High-pitch animated voice' },
  { id: 'radio', name: 'Walkie-Talkie', icon: '📻', description: 'Vintage radio filter' }
];

function makeDistortionCurve(amount = 20) {
  const k = typeof amount === 'number' ? amount : 20;
  const n_samples = 44100;
  const curve = new Float32Array(n_samples);
  const deg = Math.PI / 180;
  for (let i = 0; i < n_samples; ++i) {
    const x = (i * 2) / n_samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

export function createVoiceChanger(inputStream, initialPreset = 'normal') {
  if (!inputStream || !inputStream.getAudioTracks().length) {
    return {
      outputStream: inputStream,
      setPreset: () => {},
      getPreset: () => 'normal',
      close: () => {}
    };
  }

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) {
    return {
      outputStream: inputStream,
      setPreset: () => {},
      getPreset: () => 'normal',
      close: () => {}
    };
  }

  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(inputStream);
  const destination = ctx.createMediaStreamDestination();

  // Dry (unprocessed) path
  const dryGain = ctx.createGain();

  // Wet (processed) path
  const wetGain = ctx.createGain();

  // Nodes for DSP effects
  // 1. Robot Effect (Ring Modulation)
  const robotOsc = ctx.createOscillator();
  robotOsc.type = 'sine';
  robotOsc.frequency.setValueAtTime(55, ctx.currentTime);
  const ringModGain = ctx.createGain();
  ringModGain.gain.setValueAtTime(0, ctx.currentTime);
  try {
    robotOsc.start();
  } catch {}

  // 2. Deep Voice Nodes (Low-shelf boost + low-pass)
  const deepBass = ctx.createBiquadFilter();
  deepBass.type = 'lowshelf';
  deepBass.frequency.setValueAtTime(160, ctx.currentTime);
  deepBass.gain.setValueAtTime(14, ctx.currentTime);

  const deepLowpass = ctx.createBiquadFilter();
  deepLowpass.type = 'lowpass';
  deepLowpass.frequency.setValueAtTime(850, ctx.currentTime);

  // 3. Chipmunk Voice Nodes (High-pass + upper mid boost)
  const chipHighpass = ctx.createBiquadFilter();
  chipHighpass.type = 'highpass';
  chipHighpass.frequency.setValueAtTime(600, ctx.currentTime);

  const chipPeaking = ctx.createBiquadFilter();
  chipPeaking.type = 'peaking';
  chipPeaking.frequency.setValueAtTime(2200, ctx.currentTime);
  chipPeaking.gain.setValueAtTime(12, ctx.currentTime);
  chipPeaking.Q.setValueAtTime(1.5, ctx.currentTime);

  // 4. Walkie-Talkie Radio Nodes (Bandpass + Waveshaper)
  const radioHighpass = ctx.createBiquadFilter();
  radioHighpass.type = 'highpass';
  radioHighpass.frequency.setValueAtTime(350, ctx.currentTime);

  const radioLowpass = ctx.createBiquadFilter();
  radioLowpass.type = 'lowpass';
  radioLowpass.frequency.setValueAtTime(3200, ctx.currentTime);

  const radioDistortion = ctx.createWaveShaper();
  radioDistortion.curve = makeDistortionCurve(18);
  radioDistortion.oversample = '2x';

  // Output mixer to destination
  dryGain.connect(destination);
  wetGain.connect(destination);

  let currentPreset = initialPreset;

  function disconnectEffectChains() {
    try { source.disconnect(); } catch {}
    try { robotOsc.disconnect(); } catch {}
    try { ringModGain.disconnect(); } catch {}
    try { deepBass.disconnect(); } catch {}
    try { deepLowpass.disconnect(); } catch {}
    try { chipHighpass.disconnect(); } catch {}
    try { chipPeaking.disconnect(); } catch {}
    try { radioHighpass.disconnect(); } catch {}
    try { radioLowpass.disconnect(); } catch {}
    try { radioDistortion.disconnect(); } catch {}
  }

  function applyPreset(preset) {
    currentPreset = preset;
    disconnectEffectChains();

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    if (preset === 'normal') {
      // Direct pass-through
      dryGain.gain.setValueAtTime(1, ctx.currentTime);
      wetGain.gain.setValueAtTime(0, ctx.currentTime);
      source.connect(dryGain);
    } else if (preset === 'robot') {
      // Ring modulation
      dryGain.gain.setValueAtTime(0, ctx.currentTime);
      wetGain.gain.setValueAtTime(1, ctx.currentTime);
      source.connect(ringModGain);
      robotOsc.connect(ringModGain.gain);
      ringModGain.connect(wetGain);
    } else if (preset === 'deep') {
      // Deep bass disguise
      dryGain.gain.setValueAtTime(0, ctx.currentTime);
      wetGain.gain.setValueAtTime(1.2, ctx.currentTime);
      source.connect(deepBass);
      deepBass.connect(deepLowpass);
      deepLowpass.connect(wetGain);
    } else if (preset === 'chipmunk') {
      // High pitch sparkle
      dryGain.gain.setValueAtTime(0, ctx.currentTime);
      wetGain.gain.setValueAtTime(1.1, ctx.currentTime);
      source.connect(chipHighpass);
      chipHighpass.connect(chipPeaking);
      chipPeaking.connect(wetGain);
    } else if (preset === 'radio') {
      // Walkie-talkie / police radio
      dryGain.gain.setValueAtTime(0, ctx.currentTime);
      wetGain.gain.setValueAtTime(0.9, ctx.currentTime);
      source.connect(radioHighpass);
      radioHighpass.connect(radioLowpass);
      radioLowpass.connect(radioDistortion);
      radioDistortion.connect(wetGain);
    } else {
      dryGain.gain.setValueAtTime(1, ctx.currentTime);
      wetGain.gain.setValueAtTime(0, ctx.currentTime);
      source.connect(dryGain);
    }
  }

  applyPreset(initialPreset);

  // If input stream has video tracks, attach them to the output stream
  const videoTracks = inputStream.getVideoTracks();
  for (const vt of videoTracks) {
    destination.stream.addTrack(vt);
  }

  return {
    outputStream: destination.stream,
    setPreset: applyPreset,
    getPreset: () => currentPreset,
    close: () => {
      try {
        disconnectEffectChains();
        robotOsc.stop();
        ctx.close();
      } catch {}
    }
  };
}
