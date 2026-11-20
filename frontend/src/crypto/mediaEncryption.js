/**
 * BSDK Clubs - Client-Side Media Encryption Engine
 *
 * Implements WhatsApp-grade client-side media encryption:
 * 1. Generates ephemeral 32-byte AES-256-GCM media keys + 12-byte IVs per media file.
 * 2. Encrypts image/video/audio/document blobs into encrypted binary blobs prior to server upload.
 * 3. Media key, IV, mimeType, and SHA-256 checksum travel exclusively inside the end-to-end encrypted
 *    Signal message payload — the server only ever stores undecryptable ciphertext blobs.
 * 4. Decrypts received media blobs in client memory and provides secure object URLs/data URLs.
 */

import { bytesToBase64, base64ToBytes, bytesToHex } from './signalProtocol.js';

const subtle = typeof globalThis !== 'undefined' && globalThis.crypto?.subtle
  ? globalThis.crypto.subtle
  : (typeof window !== 'undefined' ? window.crypto?.subtle : null);

function getCrypto() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto) return globalThis.crypto;
  if (typeof window !== 'undefined' && window.crypto) return window.crypto;
  throw new Error('WebCrypto API is not available in this environment');
}

/**
 * Converts a Blob, File, or Buffer to an ArrayBuffer
 */
export async function blobToArrayBuffer(fileOrBlob) {
  if (fileOrBlob instanceof ArrayBuffer) {
    return fileOrBlob;
  }
  if (fileOrBlob instanceof Uint8Array) {
    return fileOrBlob.buffer.slice(fileOrBlob.byteOffset, fileOrBlob.byteOffset + fileOrBlob.byteLength);
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(fileOrBlob)) {
    return fileOrBlob.buffer.slice(fileOrBlob.byteOffset, fileOrBlob.byteOffset + fileOrBlob.byteLength);
  }
  if (typeof fileOrBlob?.arrayBuffer === 'function') {
    return await fileOrBlob.arrayBuffer();
  }
  if (typeof FileReader !== 'undefined') {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(fileOrBlob);
    });
  }
  throw new Error('Unsupported binary data type for media conversion');
}

/**
 * Converts an ArrayBuffer to a Blob
 */
export function arrayBufferToBlob(buffer, mimeType = 'application/octet-stream') {
  if (typeof Blob !== 'undefined') {
    return new Blob([buffer], { type: mimeType });
  }
  return buffer;
}

/**
 * Converts an ArrayBuffer or Uint8Array to a base64 Data URL
 */
export function bufferToDataUrl(buffer, mimeType = 'image/jpeg') {
  const b64 = bytesToBase64(buffer);
  return `data:${mimeType};base64,${b64}`;
}

/**
 * Converts a base64 Data URL to an ArrayBuffer
 */
export function dataUrlToBuffer(dataUrl) {
  const parts = dataUrl.split(',');
  const b64 = parts.length > 1 ? parts[1] : parts[0];
  const bytes = base64ToBytes(b64);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/**
 * Encrypts a media file (image, video, audio, snap) using client-side AES-256-GCM
 *
 * @param {Blob|File|ArrayBuffer|Uint8Array} fileInput - Plaintext media file
 * @param {Object} metadata - Optional filename, mimeType, description
 * @returns {Promise<Object>} { encryptedBlob, encryptedBuffer, encryptedBase64, mediaKeyMeta }
 */
export async function encryptMediaFile(fileInput, metadata = {}) {
  const crypto = getCrypto();
  const plaintextBuffer = await blobToArrayBuffer(fileInput);
  const plaintextBytes = new Uint8Array(plaintextBuffer);

  // Generate random 32-byte AES-GCM media key + 12-byte IV
  const mediaKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const ivBytes = crypto.getRandomValues(new Uint8Array(12));

  // Import key for AES-256-GCM
  const aesKey = await subtle.importKey(
    'raw',
    mediaKeyBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  // Encrypt binary media
  const ciphertextBuffer = await subtle.encrypt(
    { name: 'AES-GCM', iv: ivBytes },
    aesKey,
    plaintextBytes
  );
  const ciphertextBytes = new Uint8Array(ciphertextBuffer);

  // Calculate SHA-256 integrity hash of ciphertext
  const hashBuffer = await subtle.digest('SHA-256', ciphertextBytes);
  const hashHex = bytesToHex(new Uint8Array(hashBuffer));

  // Determine MIME type and file name
  const mimeType = metadata.mimeType || fileInput.type || 'image/jpeg';
  const fileName = metadata.fileName || fileInput.name || `snap-${Date.now()}.jpg`;

  const encryptedBlob = arrayBufferToBlob(ciphertextBuffer, 'application/octet-stream');
  const encryptedBase64 = bytesToBase64(ciphertextBytes);

  const mediaKeyMeta = {
    mediaKey: bytesToBase64(mediaKeyBytes),
    iv: bytesToBase64(ivBytes),
    sha256: hashHex,
    fileSize: plaintextBytes.byteLength,
    fileName,
    mimeType
  };

  return {
    encryptedBlob,
    encryptedBuffer: ciphertextBuffer,
    encryptedBase64,
    mediaKeyMeta
  };
}

/**
 * Decrypts an encrypted media blob using the mediaKeyMeta received in the E2EE message
 *
 * @param {Blob|ArrayBuffer|Uint8Array|string} encryptedData - Ciphertext data or Base64 string
 * @param {Object} mediaKeyMeta - Metadata containing mediaKey, iv, mimeType, sha256
 * @returns {Promise<Object>} { decryptedBlob, decryptedBuffer, decryptedBytes, dataUrl, objectUrl }
 */
export async function decryptMediaFile(encryptedData, mediaKeyMeta) {
  if (!mediaKeyMeta?.mediaKey || !mediaKeyMeta?.iv) {
    throw new Error('Missing media encryption key or IV in message payload');
  }

  let ciphertextBuffer;
  if (typeof encryptedData === 'string') {
    const bytes = base64ToBytes(encryptedData);
    ciphertextBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  } else {
    ciphertextBuffer = await blobToArrayBuffer(encryptedData);
  }

  const ciphertextBytes = new Uint8Array(ciphertextBuffer);

  // Verify SHA-256 integrity if present
  if (mediaKeyMeta.sha256) {
    const hashBuffer = await subtle.digest('SHA-256', ciphertextBytes);
    const calculatedHash = bytesToHex(new Uint8Array(hashBuffer));
    if (calculatedHash.toLowerCase() !== mediaKeyMeta.sha256.toLowerCase()) {
      throw new Error('Encrypted media file failed SHA-256 integrity check (tampered or corrupted)');
    }
  }

  const mediaKeyBytes = base64ToBytes(mediaKeyMeta.mediaKey);
  const ivBytes = base64ToBytes(mediaKeyMeta.iv);

  const aesKey = await subtle.importKey(
    'raw',
    mediaKeyBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const decryptedBuffer = await subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    aesKey,
    ciphertextBytes
  );
  const decryptedBytes = new Uint8Array(decryptedBuffer);

  const mimeType = mediaKeyMeta.mimeType || 'application/octet-stream';
  const decryptedBlob = arrayBufferToBlob(decryptedBuffer, mimeType);
  const dataUrl = bufferToDataUrl(decryptedBytes, mimeType);

  let objectUrl = null;
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && decryptedBlob instanceof Blob) {
    try {
      objectUrl = URL.createObjectURL(decryptedBlob);
    } catch {}
  }

  return {
    decryptedBlob,
    decryptedBuffer,
    decryptedBytes,
    dataUrl,
    objectUrl: objectUrl || dataUrl
  };
}
