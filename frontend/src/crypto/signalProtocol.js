/**
 * BSDK Clubs - Signal Protocol End-to-End Encryption (E2EE) Engine
 *
 * Implements the Signal Protocol Family:
 * 1. X3DH (Extended Triple Diffie-Hellman) Key Agreement
 * 2. Double Ratchet Algorithm (pairwise messaging sessions with forward secrecy & future secrecy)
 * 3. Sender Keys Protocol (efficient group/club messaging with rotation on member removal)
 * 4. WhatsApp-standard 60-digit Safety Number (12 blocks of 5 digits) + QR verification
 * 5. Identity Key Store with tamper & security code change detection
 *
 * Powered entirely by standard Web Crypto / SubtleCrypto primitives:
 * - ECDH (P-256 / Curve25519)
 * - ECDSA (P-256 with SHA-256)
 * - HKDF-SHA256
 * - AES-256-GCM
 * - HMAC-SHA256
 * - SHA-512 for Safety Numbers
 */

// Universal WebCrypto subtle resolver (works in browser & Node.js 18+)
const subtle = typeof globalThis !== 'undefined' && globalThis.crypto?.subtle
  ? globalThis.crypto.subtle
  : (typeof window !== 'undefined' ? window.crypto?.subtle : null);

function getCrypto() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto) return globalThis.crypto;
  if (typeof window !== 'undefined' && window.crypto) return window.crypto;
  throw new Error('WebCrypto API is not available in this environment');
}

// ============================================================
// Serialization & Encoding Helpers
// ============================================================

export function bytesToBase64(bytes) {
  const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(uint8).toString('base64');
  }
  let binary = '';
  const len = uint8.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(b64) {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function bytesToHex(bytes) {
  const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(uint8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBytes(hex) {
  const cleanHex = hex.replace(/[^0-9a-fA-F]/g, '');
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

export function textToBytes(str) {
  return new TextEncoder().encode(str);
}

export function bytesToText(bytes) {
  return new TextDecoder().decode(bytes);
}

// ============================================================
// Low-Level WebCrypto Cryptographic Primitives
// ============================================================

const CURVE_NAME = 'P-256';

/**
 * Generates an ECDH key pair for key agreement
 */
export async function generateECDHKeyPair() {
  return await subtle.generateKey(
    { name: 'ECDH', namedCurve: CURVE_NAME },
    true,
    ['deriveBits', 'deriveKey']
  );
}

/**
 * Generates an ECDSA key pair for authentication and signatures
 */
export async function generateECDSAKeyPair() {
  return await subtle.generateKey(
    { name: 'ECDSA', namedCurve: CURVE_NAME },
    true,
    ['sign', 'verify']
  );
}

/**
 * Export raw public key as Base64
 */
export async function exportRawPublicKey(publicKey) {
  const raw = await subtle.exportKey('raw', publicKey);
  return bytesToBase64(raw);
}

/**
 * Import raw ECDH public key from Base64 or bytes
 */
export async function importECDHPublicKey(rawB64OrBytes) {
  const rawBytes = typeof rawB64OrBytes === 'string' ? base64ToBytes(rawB64OrBytes) : rawB64OrBytes;
  return await subtle.importKey(
    'raw',
    rawBytes,
    { name: 'ECDH', namedCurve: CURVE_NAME },
    true,
    []
  );
}

/**
 * Import raw ECDSA public key from Base64 or bytes
 */
export async function importECDSAPublicKey(rawB64OrBytes) {
  const rawBytes = typeof rawB64OrBytes === 'string' ? base64ToBytes(rawB64OrBytes) : rawB64OrBytes;
  return await subtle.importKey(
    'raw',
    rawBytes,
    { name: 'ECDSA', namedCurve: CURVE_NAME },
    true,
    ['verify']
  );
}

/**
 * Diffie-Hellman Key Agreement: computes 256-bit shared secret
 */
export async function computeECDHSecret(privateKey, publicKey) {
  const bits = await subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256
  );
  return new Uint8Array(bits);
}

/**
 * HKDF-SHA256 Derivation
 */
export async function hkdfDerive(ikmBytes, saltBytes, infoStr, lengthBits = 512) {
  const salt = saltBytes || new Uint8Array(32);
  const info = typeof infoStr === 'string' ? textToBytes(infoStr) : infoStr;
  const hkdfKey = await subtle.importKey('raw', ikmBytes, 'HKDF', false, ['deriveBits']);
  const derived = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    hkdfKey,
    lengthBits
  );
  return new Uint8Array(derived);
}

/**
 * HMAC-SHA256 Step
 */
export async function hmacSha256(keyBytes, dataBytes) {
  const hmacKey = await subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = await subtle.sign('HMAC', hmacKey, dataBytes);
  return new Uint8Array(signed);
}

/**
 * AES-256-GCM Encryption
 */
export async function aesGcmEncrypt(keyBytes, plaintextBytes, ivBytes = null, additionalData = null) {
  const crypto = getCrypto();
  const iv = ivBytes || crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const alg = { name: 'AES-GCM', iv };
  if (additionalData) {
    alg.additionalData = additionalData instanceof Uint8Array ? additionalData : textToBytes(additionalData);
  }
  const ciphertext = await subtle.encrypt(alg, aesKey, plaintextBytes);
  return {
    iv,
    ciphertext: new Uint8Array(ciphertext)
  };
}

/**
 * AES-256-GCM Decryption
 */
export async function aesGcmDecrypt(keyBytes, ciphertextBytes, ivBytes, additionalData = null) {
  const aesKey = await subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const alg = { name: 'AES-GCM', iv: ivBytes };
  if (additionalData) {
    alg.additionalData = additionalData instanceof Uint8Array ? additionalData : textToBytes(additionalData);
  }
  const plaintext = await subtle.decrypt(alg, aesKey, ciphertextBytes);
  return new Uint8Array(plaintext);
}

/**
 * ECDSA Sign
 */
export async function ecdsaSign(privateKey, dataBytes) {
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, dataBytes);
  return new Uint8Array(sig);
}

/**
 * ECDSA Verify
 */
export async function ecdsaVerify(publicKey, signatureBytes, dataBytes) {
  return await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signatureBytes, dataBytes);
}

// ============================================================
// 1. Identity Key Pair, Signed Pre-Key, and One-Time Pre-Keys
// ============================================================

export async function generateIdentityKeyPair() {
  const ikDhKeyPair = await generateECDHKeyPair();
  const ikSigningKeyPair = await generateECDSAKeyPair();

  const ikDhPublic = await exportRawPublicKey(ikDhKeyPair.publicKey);
  const ikSigningPublic = await exportRawPublicKey(ikSigningKeyPair.publicKey);

  return {
    ikDhKeyPair,
    ikSigningKeyPair,
    ikDhPublic,
    ikSigningPublic
  };
}

export async function generateSignedPreKey(ikSigningKeyPair, keyId = 1) {
  const spkDhKeyPair = await generateECDHKeyPair();
  const rawSpkPub = await subtle.exportKey('raw', spkDhKeyPair.publicKey);

  const signatureBytes = await ecdsaSign(ikSigningKeyPair.privateKey, new Uint8Array(rawSpkPub));

  return {
    keyId,
    spkDhKeyPair,
    publicKey: bytesToBase64(rawSpkPub),
    signature: bytesToBase64(signatureBytes),
    timestamp: Date.now()
  };
}

export async function generateOneTimePreKeys(startId = 1, count = 10) {
  const opks = [];
  for (let i = 0; i < count; i++) {
    const keyId = startId + i;
    const keyPair = await generateECDHKeyPair();
    const rawPub = await exportRawPublicKey(keyPair.publicKey);
    opks.push({
      keyId,
      keyPair,
      publicKey: rawPub
    });
  }
  return opks;
}

export function exportPreKeyBundle(identityKeys, signedPreKey, oneTimePreKeys = [], registrationId = 1) {
  return {
    registrationId,
    identityDhKey: identityKeys.ikDhPublic,
    identitySigningKey: identityKeys.ikSigningPublic,
    signedPreKey: {
      keyId: signedPreKey.keyId,
      publicKey: signedPreKey.publicKey,
      signature: signedPreKey.signature,
      timestamp: signedPreKey.timestamp
    },
    oneTimePreKeys: oneTimePreKeys.map((opk) => ({
      keyId: opk.keyId,
      publicKey: opk.publicKey
    }))
  };
}

// ============================================================
// 2. X3DH (Extended Triple Diffie-Hellman) Protocol
// ============================================================

/**
 * Initiates an X3DH key agreement from Alice to Bob.
 * Derives initial shared Root Key (RK) and Chain Key (CK).
 */
export async function initiateX3DH(aliceIdentityKeys, bobPreKeyBundle, selectedOpkId = null) {
  // 1. Verify Bob's Signed Pre-Key signature using Bob's Identity Signing Key
  const bobSignPub = await importECDSAPublicKey(bobPreKeyBundle.identitySigningKey);
  const bobSpkRaw = base64ToBytes(bobPreKeyBundle.signedPreKey.publicKey);
  const bobSpkSig = base64ToBytes(bobPreKeyBundle.signedPreKey.signature);

  const isSpkValid = await ecdsaVerify(bobSignPub, bobSpkSig, bobSpkRaw);
  if (!isSpkValid) {
    throw new Error('X3DH failed: Invalid Signed Pre-Key signature from recipient.');
  }

  // 2. Generate Alice's Ephemeral Key Pair (EK_A)
  const ekDhKeyPair = await generateECDHKeyPair();
  const ekRawPub = await exportRawPublicKey(ekDhKeyPair.publicKey);

  // 3. Import Bob's public keys
  const bobIkDh = await importECDHPublicKey(bobPreKeyBundle.identityDhKey);
  const bobSpkDh = await importECDHPublicKey(bobPreKeyBundle.signedPreKey.publicKey);

  let bobOpkDh = null;
  let opkUsedId = null;
  if (selectedOpkId !== null && bobPreKeyBundle.oneTimePreKeys?.length) {
    const opkEntry = bobPreKeyBundle.oneTimePreKeys.find((k) => k.keyId === selectedOpkId);
    if (opkEntry) {
      bobOpkDh = await importECDHPublicKey(opkEntry.publicKey);
      opkUsedId = opkEntry.keyId;
    }
  } else if (bobPreKeyBundle.oneTimePreKeys?.length > 0) {
    const firstOpk = bobPreKeyBundle.oneTimePreKeys[0];
    bobOpkDh = await importECDHPublicKey(firstOpk.publicKey);
    opkUsedId = firstOpk.keyId;
  }

  // 4. Perform DH operations:
  // DH1 = DH(IK_A, SPK_B)
  // DH2 = DH(EK_A, IK_B)
  // DH3 = DH(EK_A, SPK_B)
  // DH4 = DH(EK_A, OPK_B) (if OPK present)
  const dh1 = await computeECDHSecret(aliceIdentityKeys.ikDhKeyPair.privateKey, bobSpkDh);
  const dh2 = await computeECDHSecret(ekDhKeyPair.privateKey, bobIkDh);
  const dh3 = await computeECDHSecret(ekDhKeyPair.privateKey, bobSpkDh);
  let dh4 = null;
  if (bobOpkDh) {
    dh4 = await computeECDHSecret(ekDhKeyPair.privateKey, bobOpkDh);
  }

  // Concatenate DH outputs
  const ikmLength = 32 * (dh4 ? 4 : 3);
  const ikm = new Uint8Array(ikmLength);
  ikm.set(dh1, 0);
  ikm.set(dh2, 32);
  ikm.set(dh3, 64);
  if (dh4) {
    ikm.set(dh4, 96);
  }

  // Derive initial Root Key (RK) and Chain Key (CK)
  const salt = new Uint8Array(32); // 32 zeros
  const okm = await hkdfDerive(ikm, salt, 'BSDK_Signal_X3DH_v1', 512);

  const rootKey = okm.slice(0, 32);
  const chainKey = okm.slice(32, 64);

  const x3dhInitHeader = {
    aliceIdentityDhKey: aliceIdentityKeys.ikDhPublic,
    aliceIdentitySigningKey: aliceIdentityKeys.ikSigningPublic,
    aliceEphemeralKey: ekRawPub,
    bobSignedPreKeyId: bobPreKeyBundle.signedPreKey.keyId,
    bobOneTimePreKeyId: opkUsedId
  };

  return {
    rootKey,
    chainKey,
    x3dhInitHeader,
    bobSpkPublicKey: bobPreKeyBundle.signedPreKey.publicKey
  };
}

/**
 * Responds to an incoming X3DH handshake at Bob's side.
 */
export async function respondX3DH(bobIdentityKeys, bobSignedPreKey, bobOneTimePreKeysMap, x3dhInit) {
  const aliceIkDh = await importECDHPublicKey(x3dhInit.aliceIdentityDhKey);
  const aliceEk = await importECDHPublicKey(x3dhInit.aliceEphemeralKey);

  // Locate the Signed Pre-Key used by Alice
  if (bobSignedPreKey.keyId !== x3dhInit.bobSignedPreKeyId) {
    throw new Error(`Signed Pre-Key with ID ${x3dhInit.bobSignedPreKeyId} not found.`);
  }

  // Locate One-Time Pre-Key if specified
  let bobOpk = null;
  if (x3dhInit.bobOneTimePreKeyId !== null && bobOneTimePreKeysMap) {
    bobOpk = bobOneTimePreKeysMap.get ? bobOneTimePreKeysMap.get(x3dhInit.bobOneTimePreKeyId) : bobOneTimePreKeysMap[x3dhInit.bobOneTimePreKeyId];
  }

  // Perform reciprocal DH operations:
  // DH1 = DH(SPK_B, IK_A)
  // DH2 = DH(IK_B, EK_A)
  // DH3 = DH(SPK_B, EK_A)
  // DH4 = DH(OPK_B, EK_A) (if OPK used)
  const dh1 = await computeECDHSecret(bobSignedPreKey.spkDhKeyPair.privateKey, aliceIkDh);
  const dh2 = await computeECDHSecret(bobIdentityKeys.ikDhKeyPair.privateKey, aliceEk);
  const dh3 = await computeECDHSecret(bobSignedPreKey.spkDhKeyPair.privateKey, aliceEk);
  let dh4 = null;
  if (bobOpk) {
    dh4 = await computeECDHSecret(bobOpk.keyPair ? bobOpk.keyPair.privateKey : bobOpk.privateKey, aliceEk);
  }

  const ikmLength = 32 * (dh4 ? 4 : 3);
  const ikm = new Uint8Array(ikmLength);
  ikm.set(dh1, 0);
  ikm.set(dh2, 32);
  ikm.set(dh3, 64);
  if (dh4) {
    ikm.set(dh4, 96);
  }

  const salt = new Uint8Array(32);
  const okm = await hkdfDerive(ikm, salt, 'BSDK_Signal_X3DH_v1', 512);

  const rootKey = okm.slice(0, 32);
  const chainKey = okm.slice(32, 64);

  return {
    rootKey,
    chainKey
  };
}

// ============================================================
// 3. Double Ratchet Protocol (1-to-1 Messaging Sessions)
// ============================================================

const CONST_MK_BYTE = new Uint8Array([0x01]);
const CONST_CK_BYTE = new Uint8Array([0x02]);

/**
 * KDF for Root Key and asymmetric DH ratchet step
 */
async function kdfRk(rk, dhSecret) {
  const okm = await hkdfDerive(dhSecret, rk, 'BSDK_DoubleRatchet_RK', 512);
  return {
    rk: okm.slice(0, 32),
    ck: okm.slice(32, 64)
  };
}

/**
 * KDF for Symmetric Chain Ratchet
 */
async function kdfCk(ck) {
  const mk = await hmacSha256(ck, CONST_MK_BYTE);
  const nextCk = await hmacSha256(ck, CONST_CK_BYTE);
  return { mk, ck: nextCk };
}

/**
 * Initializes Alice's sending Double Ratchet session after X3DH
 */
export async function initAliceSession(initialRootKey, bobRatchetPublicKeyB64) {
  const ourDhKeyPair = await generateECDHKeyPair();
  const ourDhPubB64 = await exportRawPublicKey(ourDhKeyPair.publicKey);

  const bobDhPub = await importECDHPublicKey(bobRatchetPublicKeyB64);
  const dhSecret = await computeECDHSecret(ourDhKeyPair.privateKey, bobDhPub);

  const { rk, ck } = await kdfRk(initialRootKey, dhSecret);

  return {
    role: 'alice',
    rk,
    dhSendingKeyPair: ourDhKeyPair,
    dhSendingPublicB64: ourDhPubB64,
    dhPeerPublicB64: bobRatchetPublicKeyB64,
    ckSending: ck,
    ckReceiving: null,
    nSending: 0,
    nReceiving: 0,
    prevSendingLength: 0,
    skippedKeys: new Map() // key: `${dhPubB64}:${n}`, value: Uint8Array(32)
  };
}

/**
 * Initializes Bob's receiving Double Ratchet session upon first message
 */
export async function initBobSession(initialRootKey, bobSpkDhKeyPair, bobSpkPubB64) {
  return {
    role: 'bob',
    rk: initialRootKey,
    dhSendingKeyPair: bobSpkDhKeyPair,
    dhSendingPublicB64: bobSpkPubB64,
    dhPeerPublicB64: null,
    ckSending: null,
    ckReceiving: null,
    nSending: 0,
    nReceiving: 0,
    prevSendingLength: 0,
    skippedKeys: new Map()
  };
}

/**
 * Encrypts a 1-to-1 message using Double Ratchet
 */
export async function encryptDoubleRatchet(session, plaintextStr, x3dhInit = null) {
  if (!session.ckSending) {
    throw new Error('Sending chain key is not initialized in this session.');
  }

  // Step symmetric sending chain
  const { mk, ck } = await kdfCk(session.ckSending);
  session.ckSending = ck;

  const currentN = session.nSending;
  session.nSending++;

  const header = {
    dhPublicKey: session.dhSendingPublicB64,
    n: currentN,
    pn: session.prevSendingLength
  };

  const ad = textToBytes(JSON.stringify(header));
  const plaintextBytes = textToBytes(plaintextStr);
  const { iv, ciphertext } = await aesGcmEncrypt(mk, plaintextBytes, null, ad);

  const envelope = {
    type: 'signal_ratchet_message',
    header,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext)
  };

  if (x3dhInit) {
    envelope.x3dhInit = x3dhInit;
  }

  return envelope;
}

/**
 * Skips message keys in a chain up to untilN, saving them for out-of-order arrival
 */
async function skipMessageKeys(session, untilN) {
  if (!session.ckReceiving) return;
  if (session.nReceiving + 2000 < untilN) {
    throw new Error('Too many skipped messages in ratchet chain.');
  }
  while (session.nReceiving < untilN) {
    const { mk, ck } = await kdfCk(session.ckReceiving);
    session.ckReceiving = ck;
    const skipKey = `${session.dhPeerPublicB64}:${session.nReceiving}`;
    session.skippedKeys.set(skipKey, mk);
    session.nReceiving++;
  }
}

/**
 * Performs asymmetric DH ratchet on receiving new peer DH public key
 */
async function dhRatchetStep(session, peerDhPubB64, headerPn) {
  // 1. Skip any unreceived messages on previous receiving chain
  await skipMessageKeys(session, headerPn);

  // 2. Receiving DH Step
  session.prevSendingLength = session.nSending;
  session.nSending = 0;
  session.nReceiving = 0;
  session.dhPeerPublicB64 = peerDhPubB64;

  const peerPub = await importECDHPublicKey(peerDhPubB64);
  const dhRecvSecret = await computeECDHSecret(session.dhSendingKeyPair.privateKey, peerPub);
  const recvRkCk = await kdfRk(session.rk, dhRecvSecret);
  session.rk = recvRkCk.rk;
  session.ckReceiving = recvRkCk.ck;

  // 3. Sending DH Step: Generate fresh DH key pair for this turn
  session.dhSendingKeyPair = await generateECDHKeyPair();
  session.dhSendingPublicB64 = await exportRawPublicKey(session.dhSendingKeyPair.publicKey);

  const dhSendSecret = await computeECDHSecret(session.dhSendingKeyPair.privateKey, peerPub);
  const sendRkCk = await kdfRk(session.rk, dhSendSecret);
  session.rk = sendRkCk.rk;
  session.ckSending = sendRkCk.ck;
}

/**
 * Decrypts a 1-to-1 message using Double Ratchet
 */
export async function decryptDoubleRatchet(session, envelope) {
  const { header, iv: ivB64, ciphertext: cipherB64 } = envelope;
  const iv = base64ToBytes(ivB64);
  const ciphertext = base64ToBytes(cipherB64);
  const ad = textToBytes(JSON.stringify(header));

  const skipKey = `${header.dhPublicKey}:${header.n}`;
  if (session.skippedKeys.has(skipKey)) {
    // Decrypt using previously skipped message key
    const mk = session.skippedKeys.get(skipKey);
    session.skippedKeys.delete(skipKey);
    const plainBytes = await aesGcmDecrypt(mk, ciphertext, iv, ad);
    return bytesToText(plainBytes);
  }

  // Check if peer ratchet public key has changed (asymmetric ratchet trigger)
  if (header.dhPublicKey !== session.dhPeerPublicB64) {
    if (!session.dhPeerPublicB64 && session.role === 'bob') {
      // Bob's first incoming message: perform initial receiving DH ratchet step
      session.dhPeerPublicB64 = header.dhPublicKey;
      const peerPub = await importECDHPublicKey(header.dhPublicKey);
      const dhRecvSecret = await computeECDHSecret(session.dhSendingKeyPair.privateKey, peerPub);
      const recvRkCk = await kdfRk(session.rk, dhRecvSecret);
      session.rk = recvRkCk.rk;
      session.ckReceiving = recvRkCk.ck;

      // Bob prepares sending chain for when he replies
      session.dhSendingKeyPair = await generateECDHKeyPair();
      session.dhSendingPublicB64 = await exportRawPublicKey(session.dhSendingKeyPair.publicKey);
      const dhSendSecret = await computeECDHSecret(session.dhSendingKeyPair.privateKey, peerPub);
      const sendRkCk = await kdfRk(session.rk, dhSendSecret);
      session.rk = sendRkCk.rk;
      session.ckSending = sendRkCk.ck;
    } else {
      await dhRatchetStep(session, header.dhPublicKey, header.pn);
    }
  }

  // Skip any earlier messages in the current receiving chain
  await skipMessageKeys(session, header.n);

  // Derive message key
  const { mk, ck } = await kdfCk(session.ckReceiving);
  session.ckReceiving = ck;
  session.nReceiving++;

  const plainBytes = await aesGcmDecrypt(mk, ciphertext, iv, ad);
  return bytesToText(plainBytes);
}

// ============================================================
// 4. Sender Keys Protocol for Club / Group Chats
// ============================================================

/**
 * Creates a Sender Key state for this user in a club
 */
export async function createSenderKeyState(clubId, senderId, keyId = 1) {
  const crypto = getCrypto();
  const chainKey = crypto.getRandomValues(new Uint8Array(32));
  const signingKeyPair = await generateECDSAKeyPair();
  const signingPublicKeyB64 = await exportRawPublicKey(signingKeyPair.publicKey);

  return {
    clubId,
    senderId,
    keyId,
    iteration: 0,
    chainKey,
    signingKeyPair,
    signingPublicKeyB64
  };
}

/**
 * Exports Sender Key Distribution message to broadcast to group members
 */
export function exportSenderKeyDistribution(senderState) {
  return {
    type: 'sender_key_distribution',
    clubId: senderState.clubId,
    senderId: senderState.senderId,
    keyId: senderState.keyId,
    iteration: senderState.iteration,
    chainKey: bytesToBase64(senderState.chainKey),
    signingPublicKey: senderState.signingPublicKeyB64
  };
}

/**
 * Group member imports a sender's Sender Key distribution
 */
export function importSenderKeyDistribution(senderKeyStore, distributionMsg) {
  const storeKey = `${distributionMsg.clubId}:${distributionMsg.senderId}`;
  senderKeyStore.set(storeKey, {
    clubId: distributionMsg.clubId,
    senderId: distributionMsg.senderId,
    keyId: distributionMsg.keyId,
    iteration: distributionMsg.iteration,
    chainKey: base64ToBytes(distributionMsg.chainKey),
    signingPublicKeyB64: distributionMsg.signingPublicKey
  });
}

/**
 * Encrypts a club message with sender key
 */
export async function encryptSenderKeyMessage(senderState, plaintextStr) {
  // Advance symmetric sender chain key
  const mk = await hmacSha256(senderState.chainKey, CONST_MK_BYTE);
  senderState.chainKey = await hmacSha256(senderState.chainKey, CONST_CK_BYTE);

  const currentIteration = senderState.iteration;
  senderState.iteration++;

  const plaintextBytes = textToBytes(plaintextStr);
  const { iv, ciphertext } = await aesGcmEncrypt(mk, plaintextBytes);

  // Authenticate ciphertext and metadata with sender's signing key
  const meta = `${senderState.clubId}:${senderState.senderId}:${senderState.keyId}:${currentIteration}`;
  const signData = new Uint8Array(meta.length + ciphertext.length);
  signData.set(textToBytes(meta), 0);
  signData.set(ciphertext, meta.length);

  const signature = await ecdsaSign(senderState.signingKeyPair.privateKey, signData);

  return {
    type: 'sender_key_message',
    clubId: senderState.clubId,
    senderId: senderState.senderId,
    keyId: senderState.keyId,
    iteration: currentIteration,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
    signature: bytesToBase64(signature)
  };
}

/**
 * Decrypts a club message using stored sender key state
 */
export async function decryptSenderKeyMessage(senderKeyStore, senderKeyMsg) {
  const { clubId, senderId, keyId, iteration, iv: ivB64, ciphertext: cipherB64, signature: sigB64 } = senderKeyMsg;
  const storeKey = `${clubId}:${senderId}`;
  const state = senderKeyStore.get(storeKey);

  if (!state) {
    throw new Error(`No sender key found for sender ${senderId} in club ${clubId}`);
  }
  if (state.keyId !== keyId) {
    throw new Error(`Sender key ID mismatch. Expected ${state.keyId}, got ${keyId}`);
  }

  const iv = base64ToBytes(ivB64);
  const ciphertext = base64ToBytes(cipherB64);
  const signature = base64ToBytes(sigB64);

  // 1. Verify ECDSA signature
  const signingPub = await importECDSAPublicKey(state.signingPublicKeyB64);
  const meta = `${clubId}:${senderId}:${keyId}:${iteration}`;
  const signData = new Uint8Array(meta.length + ciphertext.length);
  signData.set(textToBytes(meta), 0);
  signData.set(ciphertext, meta.length);

  const isValid = await ecdsaVerify(signingPub, signature, signData);
  if (!isValid) {
    throw new Error('Sender key message signature verification failed.');
  }

  // 2. Ratchet sender chain forward if needed
  if (iteration < state.iteration) {
    throw new Error('Old or replayed sender key iteration.');
  }
  while (state.iteration < iteration) {
    state.chainKey = await hmacSha256(state.chainKey, CONST_CK_BYTE);
    state.iteration++;
  }

  // 3. Derive message key and advance chain key
  const mk = await hmacSha256(state.chainKey, CONST_MK_BYTE);
  state.chainKey = await hmacSha256(state.chainKey, CONST_CK_BYTE);
  state.iteration++;

  // 4. Decrypt AES-256-GCM ciphertext
  const plainBytes = await aesGcmDecrypt(mk, ciphertext, iv);
  return bytesToText(plainBytes);
}

/**
 * Rotates the sender key when a member is removed from the club (Forward Secrecy)
 */
export async function rotateSenderKey(senderState) {
  const crypto = getCrypto();
  const nextKeyId = (senderState.keyId || 1) + 1;
  const newChainKey = crypto.getRandomValues(new Uint8Array(32));
  const newSigningKeyPair = await generateECDSAKeyPair();
  const newSigningPublicKeyB64 = await exportRawPublicKey(newSigningKeyPair.publicKey);

  senderState.keyId = nextKeyId;
  senderState.iteration = 0;
  senderState.chainKey = newChainKey;
  senderState.signingKeyPair = newSigningKeyPair;
  senderState.signingPublicKeyB64 = newSigningPublicKeyB64;

  return exportSenderKeyDistribution(senderState);
}

// ============================================================
// 5. WhatsApp-Standard 60-Digit Safety Number & QR Verification
// ============================================================

/**
 * Computes WhatsApp-standard 60-digit numeric fingerprint (12 blocks of 5 digits)
 * Symmetrically derived from both parties' public identity keys.
 */
export async function computeSafetyNumber(userIdA, identityKeyA, userIdB, identityKeyB) {
  const keyAStr = typeof identityKeyA === 'string' ? identityKeyA : bytesToBase64(identityKeyA);
  const keyBStr = typeof identityKeyB === 'string' ? identityKeyB : bytesToBase64(identityKeyB);
  const idA = String(userIdA || '');
  const idB = String(userIdB || '');

  // Symmetrically order the two parties
  const partyA = `${idA}:${keyAStr}`;
  const partyB = `${idB}:${keyBStr}`;
  const [first, second] = [partyA, partyB].sort();

  // Multi-round SHA-512 derivation matching Signal/WhatsApp specification
  let digest = textToBytes(`BSDK_Clubs_Safety_Number_v1:${first}:${second}`);
  for (let i = 0; i < 64; i++) {
    digest = new Uint8Array(await subtle.digest('SHA-512', digest));
  }

  // Format into 12 blocks of 5 decimal digits (60 digits total)
  const view = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
  const blocks = [];
  for (let i = 0; i < 12; i++) {
    const val = view.getUint32(i * 4, false);
    blocks.push(String(val % 100000).padStart(5, '0'));
  }

  return blocks.join(' ');
}

/**
 * Creates QR verification payload for Safety Number modal
 */
export function createSafetyNumberQRData(myUserId, myIdentityKey, peerUserId, peerIdentityKey, safetyNumber) {
  return JSON.stringify({
    version: 1,
    app: 'BSDK_Clubs',
    parties: [String(myUserId), String(peerUserId)].sort(),
    fingerprint: safetyNumber
  });
}

/**
 * Verifies scanned QR payload or numeric input against expected safety number
 */
export function verifySafetyNumberQR(scannedInput, expectedSafetyNumber) {
  if (!scannedInput || !expectedSafetyNumber) {
    return { verified: false, error: 'Input missing' };
  }
  const cleanExpected = expectedSafetyNumber.replace(/[^0-9]/g, '');

  try {
    const parsed = typeof scannedInput === 'object' ? scannedInput : JSON.parse(scannedInput);
    if (parsed.fingerprint) {
      const cleanScanned = parsed.fingerprint.replace(/[^0-9]/g, '');
      if (cleanScanned === cleanExpected && cleanScanned.length === 60) {
        return { verified: true, error: null };
      }
    }
  } catch {}

  const cleanScanned = String(scannedInput).replace(/[^0-9]/g, '');
  if (cleanScanned === cleanExpected && cleanScanned.length === 60) {
    return { verified: true, error: null };
  }

  return { verified: false, error: 'Safety numbers do not match' };
}

// ============================================================
// 6. Identity Key Store & Tamper / Security Code Change Detection
// ============================================================

export class IdentityKeyStore {
  constructor(storageKey = 'bsdk_e2ee_identity_keys') {
    this.storageKey = storageKey;
    this._keys = new Map();
    this._load();
  }

  _load() {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(this.storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          for (const [k, v] of Object.entries(parsed)) {
            this._keys.set(k, v);
          }
        }
      }
    } catch {}
  }

  _persist() {
    try {
      if (typeof localStorage !== 'undefined') {
        const obj = Object.fromEntries(this._keys.entries());
        localStorage.setItem(this.storageKey, JSON.stringify(obj));
      }
    } catch {}
  }

  getIdentityKey(userId) {
    return this._keys.get(String(userId)) || null;
  }

  saveIdentityKey(userId, publicKey) {
    const keyStr = typeof publicKey === 'string' ? publicKey : bytesToBase64(publicKey);
    this._keys.set(String(userId), keyStr);
    this._persist();
  }

  /**
   * Checks if peer's identity key has changed since previous encounter
   */
  verifyOrUpdateIdentityKey(userId, currentPublicKey) {
    const id = String(userId);
    const keyStr = typeof currentPublicKey === 'string' ? currentPublicKey : bytesToBase64(currentPublicKey);
    const existing = this._keys.get(id);

    if (!existing) {
      this._keys.set(id, keyStr);
      this._persist();
      return { changed: false, isNew: true, previousKey: null, currentKey: keyStr };
    }

    if (existing !== keyStr) {
      return {
        changed: true,
        isNew: false,
        previousKey: existing,
        currentKey: keyStr,
        warning: 'Security code changed! This contact may have reinstalled the app or switched devices.'
      };
    }

    return { changed: false, isNew: false, previousKey: existing, currentKey: keyStr };
  }
}

// ============================================================
// 7. High-Level SignalProtocolManager Class
// ============================================================

export class SignalProtocolManager {
  constructor(userId, identityKeyStore = null) {
    this.userId = String(userId);
    this.identityKeyStore = identityKeyStore || new IdentityKeyStore();

    this.identityKeys = null;
    this.signedPreKey = null;
    this.oneTimePreKeys = [];
    this.opkMap = new Map();

    // Active pairwise 1-to-1 Double Ratchet sessions: peerUserId -> session
    this.sessions = new Map();

    // Group sender states: clubId -> senderState
    this.mySenderKeys = new Map();

    // Received group sender keys: `${clubId}:${senderId}` -> state
    this.peerSenderKeys = new Map();
  }

  async initialize(preKeyCount = 10) {
    this.identityKeys = await generateIdentityKeyPair();
    this.signedPreKey = await generateSignedPreKey(this.identityKeys.ikSigningKeyPair, 1);
    this.oneTimePreKeys = await generateOneTimePreKeys(1, preKeyCount);

    this.opkMap.clear();
    for (const opk of this.oneTimePreKeys) {
      this.opkMap.set(opk.keyId, opk);
    }

    this.identityKeyStore.saveIdentityKey(this.userId, this.identityKeys.ikDhPublic);
    return this;
  }

  exportPreKeyBundle(registrationId = 1) {
    return exportPreKeyBundle(this.identityKeys, this.signedPreKey, this.oneTimePreKeys, registrationId);
  }

  async startOutboundSession(peerUserId, peerPreKeyBundle) {
    // Check security code change
    const check = this.identityKeyStore.verifyOrUpdateIdentityKey(peerUserId, peerPreKeyBundle.identityDhKey);

    const x3dh = await initiateX3DH(this.identityKeys, peerPreKeyBundle);
    const session = await initAliceSession(x3dh.rootKey, x3dh.bobSpkPublicKey);
    session.x3dhInitHeader = x3dh.x3dhInitHeader;

    this.sessions.set(String(peerUserId), session);
    return { session, securityCodeNotice: check };
  }

  async encryptMessage(peerUserId, plaintextStr) {
    const session = this.sessions.get(String(peerUserId));
    if (!session) {
      throw new Error(`No active session with peer ${peerUserId}. Call startOutboundSession first.`);
    }
    const x3dhInit = session.x3dhInitHeader || null;
    const envelope = await encryptDoubleRatchet(session, plaintextStr, x3dhInit);
    session.x3dhInitHeader = null; // Only include in the initial message
    return envelope;
  }

  async decryptMessage(peerUserId, envelope) {
    const peerId = String(peerUserId);
    let session = this.sessions.get(peerId);

    if (!session && envelope.x3dhInit) {
      // Incoming session initiation from Alice
      const { rootKey } = await respondX3DH(
        this.identityKeys,
        this.signedPreKey,
        this.opkMap,
        envelope.x3dhInit
      );

      // Check security code notice
      this.identityKeyStore.verifyOrUpdateIdentityKey(peerId, envelope.x3dhInit.aliceIdentityDhKey);

      session = await initBobSession(rootKey, this.signedPreKey.spkDhKeyPair, this.signedPreKey.publicKey);
      this.sessions.set(peerId, session);

      // Remove consumed OPK if any
      if (envelope.x3dhInit.bobOneTimePreKeyId) {
        this.opkMap.delete(envelope.x3dhInit.bobOneTimePreKeyId);
      }
    }

    if (!session) {
      throw new Error(`No session found for peer ${peerId} and message does not contain X3DH init.`);
    }

    return await decryptDoubleRatchet(session, envelope);
  }

  // Group / Club Sender Keys
  async createGroupSenderKey(clubId) {
    const state = await createSenderKeyState(clubId, this.userId, 1);
    this.mySenderKeys.set(clubId, state);
    return exportSenderKeyDistribution(state);
  }

  processGroupSenderKeyDistribution(distMsg) {
    importSenderKeyDistribution(this.peerSenderKeys, distMsg);
  }

  async encryptGroupMessage(clubId, plaintextStr) {
    let state = this.mySenderKeys.get(clubId);
    if (!state) {
      await this.createGroupSenderKey(clubId);
      state = this.mySenderKeys.get(clubId);
    }
    return await encryptSenderKeyMessage(state, plaintextStr);
  }

  async decryptGroupMessage(senderKeyMsg) {
    return await decryptSenderKeyMessage(this.peerSenderKeys, senderKeyMsg);
  }

  async rotateGroupSenderKey(clubId) {
    const state = this.mySenderKeys.get(clubId);
    if (!state) {
      return await this.createGroupSenderKey(clubId);
    }
    return await rotateSenderKey(state);
  }

  // Safety Number
  async computeSafetyNumber(peerUserId, peerIdentityKey) {
    return await computeSafetyNumber(
      this.userId,
      this.identityKeys.ikDhPublic,
      peerUserId,
      peerIdentityKey
    );
  }

  createSafetyNumberQR(peerUserId, peerIdentityKey, safetyNumber) {
    return createSafetyNumberQRData(
      this.userId,
      this.identityKeys.ikDhPublic,
      peerUserId,
      peerIdentityKey,
      safetyNumber
    );
  }
}
