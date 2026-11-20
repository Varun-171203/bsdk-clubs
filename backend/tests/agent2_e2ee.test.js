/**
 * BSDK Clubs - Agent 2 E2EE Verification Test Suite
 *
 * Tests the complete Signal Protocol End-to-End Encryption (E2EE) engine:
 * 1. Key Bundle generation & ECDSA signed pre-key signature verification
 * 2. X3DH (Extended Triple Diffie-Hellman) key agreement handshake
 * 3. Double Ratchet 1-to-1 messaging (multi-turn conversation & out-of-order delivery)
 * 4. Sender Keys group protocol & forward secrecy rotation on member removal
 * 5. Client-side media encryption / decryption roundtrip & integrity check
 * 6. WhatsApp-standard 60-digit Safety Number derivation, symmetry & QR verification
 * 7. Security code change detection on key tampering
 */

import assert from 'node:assert/strict';
import {
  SignalProtocolManager,
  generateIdentityKeyPair,
  generateSignedPreKey,
  generateOneTimePreKeys,
  exportPreKeyBundle,
  initiateX3DH,
  respondX3DH,
  initAliceSession,
  initBobSession,
  encryptDoubleRatchet,
  decryptDoubleRatchet,
  createSenderKeyState,
  exportSenderKeyDistribution,
  importSenderKeyDistribution,
  encryptSenderKeyMessage,
  decryptSenderKeyMessage,
  rotateSenderKey,
  computeSafetyNumber,
  createSafetyNumberQRData,
  verifySafetyNumberQR,
  IdentityKeyStore,
  ecdsaVerify,
  importECDSAPublicKey,
  base64ToBytes,
  bytesToBase64
} from '../../frontend/src/crypto/signalProtocol.js';

import {
  encryptMediaFile,
  decryptMediaFile
} from '../../frontend/src/crypto/mediaEncryption.js';

async function runTestSuite() {
  console.log('============================================================');
  console.log('🚀 BSDK CLUBS - SIGNAL PROTOCOL E2EE ENGINE TEST SUITE');
  console.log('============================================================\n');

  // ------------------------------------------------------------
  // Test 1: Key Bundle Generation & SPK Signature Verification
  // ------------------------------------------------------------
  console.log('TEST 1: Generating Key Bundles & Verifying Signed Pre-Keys...');
  const aliceIK = await generateIdentityKeyPair();
  const aliceSPK = await generateSignedPreKey(aliceIK.ikSigningKeyPair, 1);
  const aliceOPKs = await generateOneTimePreKeys(1, 5);
  const aliceBundle = exportPreKeyBundle(aliceIK, aliceSPK, aliceOPKs, 1001);

  assert.ok(aliceBundle.identityDhKey, 'Alice must have identityDhKey');
  assert.ok(aliceBundle.identitySigningKey, 'Alice must have identitySigningKey');
  assert.equal(aliceBundle.signedPreKey.keyId, 1);
  assert.equal(aliceBundle.oneTimePreKeys.length, 5);

  // Mathematically verify Bob can verify Alice's SPK signature using Alice's identity signing public key
  const aliceSignPub = await importECDSAPublicKey(aliceBundle.identitySigningKey);
  const aliceSpkRaw = base64ToBytes(aliceBundle.signedPreKey.publicKey);
  const aliceSpkSig = base64ToBytes(aliceBundle.signedPreKey.signature);
  const isSpkValid = await ecdsaVerify(aliceSignPub, aliceSpkSig, aliceSpkRaw);
  assert.equal(isSpkValid, true, 'Signed Pre-Key signature must be mathematically valid');
  console.log('  ✅ Key bundle generated and ECDSA signed pre-key signature verified!\n');

  // ------------------------------------------------------------
  // Test 2: X3DH Handshake Agreement
  // ------------------------------------------------------------
  console.log('TEST 2: Testing X3DH Key Agreement Handshake (Alice -> Bob)...');
  const bobIK = await generateIdentityKeyPair();
  const bobSPK = await generateSignedPreKey(bobIK.ikSigningKeyPair, 1);
  const bobOPKs = await generateOneTimePreKeys(1, 5);
  const bobBundle = exportPreKeyBundle(bobIK, bobSPK, bobOPKs, 1002);

  const bobOpkMap = new Map();
  for (const opk of bobOPKs) {
    bobOpkMap.set(opk.keyId, opk);
  }

  // Alice initiates X3DH with Bob's bundle
  const aliceX3dh = await initiateX3DH(aliceIK, bobBundle, bobBundle.oneTimePreKeys[0].keyId);
  assert.equal(aliceX3dh.rootKey.byteLength, 32);
  assert.equal(aliceX3dh.chainKey.byteLength, 32);
  assert.ok(aliceX3dh.x3dhInitHeader);

  // Bob receives Alice's initial handshake envelope
  const bobX3dh = await respondX3DH(bobIK, bobSPK, bobOpkMap, aliceX3dh.x3dhInitHeader);
  assert.equal(bobX3dh.rootKey.byteLength, 32);
  assert.equal(bobX3dh.chainKey.byteLength, 32);

  // Crucial cryptographic assertion: Both derive EXACT same root key and chain key
  assert.deepEqual(
    Array.from(aliceX3dh.rootKey),
    Array.from(bobX3dh.rootKey),
    'Alice and Bob MUST compute identical Root Key from X3DH'
  );
  assert.deepEqual(
    Array.from(aliceX3dh.chainKey),
    Array.from(bobX3dh.chainKey),
    'Alice and Bob MUST compute identical Chain Key from X3DH'
  );
  console.log('  ✅ X3DH handshake succeeded with 100% identical derived shared secrets!\n');

  // ------------------------------------------------------------
  // Test 3: Double Ratchet 1-to-1 Messaging Session
  // ------------------------------------------------------------
  console.log('TEST 3: Testing Double Ratchet Messaging (Multi-Turn & Out-of-Order)...');
  const aliceManager = new SignalProtocolManager('alice');
  await aliceManager.initialize(10);
  const bobManager = new SignalProtocolManager('bob');
  await bobManager.initialize(10);

  // Alice starts outbound session with Bob
  const { session: aliceSession } = await aliceManager.startOutboundSession('bob', bobManager.exportPreKeyBundle());

  // Message 1: Alice -> Bob (First message with X3DH init header)
  const msg1Text = 'Hey Bob, this is an end-to-end encrypted message from Alice!';
  const env1 = await aliceManager.encryptMessage('bob', msg1Text);
  assert.ok(env1.x3dhInit, 'First message must carry X3DH initialization header');

  const dec1 = await bobManager.decryptMessage('alice', env1);
  assert.equal(dec1, msg1Text, 'Bob must decrypt Alice message 1 accurately');

  // Message 2: Bob replies -> Alice (DH ratchet turns!)
  const msg2Text = 'Hello Alice! I received your message and my DH ratchet has rotated.';
  const env2 = await bobManager.encryptMessage('alice', msg2Text);
  assert.ok(!env2.x3dhInit, 'Subsequent messages must not repeat X3DH init');

  const dec2 = await aliceManager.decryptMessage('bob', env2);
  assert.equal(dec2, msg2Text, 'Alice must decrypt Bob message 2 after DH ratchet step');

  // Message 3 & 4: Alice sends two consecutive messages in the same sending chain
  const msg3Text = 'Message 3: Ratchet turn step 2';
  const msg4Text = 'Message 4: Sent immediately after message 3';
  const env3 = await aliceManager.encryptMessage('bob', msg3Text);
  const env4 = await aliceManager.encryptMessage('bob', msg4Text);

  // Test Out-Of-Order Delivery: Bob receives Message 4 BEFORE Message 3
  console.log('  Testing out-of-order message arrival (Message 4 received before Message 3)...');
  const dec4 = await bobManager.decryptMessage('alice', env4);
  assert.equal(dec4, msg4Text, 'Bob must decrypt out-of-order Message 4 using skipped chain key advancement');

  // Now Message 3 arrives late: Bob decrypts it using stored skipped message key
  const dec3 = await bobManager.decryptMessage('alice', env3);
  assert.equal(dec3, msg3Text, 'Bob must decrypt late Message 3 using stored skipped message key');

  console.log('  ✅ Double Ratchet multi-turn conversation and out-of-order handling passed!\n');

  // ------------------------------------------------------------
  // Test 4: Group Sender Keys Protocol & Rotation on Member Removal
  // ------------------------------------------------------------
  console.log('TEST 4: Testing Group Sender Keys & Rotation on Member Removal...');
  const charlieManager = new SignalProtocolManager('charlie');
  await charlieManager.initialize(5);

  const clubId = 'club-hostel-gang-99';

  // Alice creates Sender Key for the club
  const distMsg = await aliceManager.createGroupSenderKey(clubId);
  assert.equal(distMsg.type, 'sender_key_distribution');
  assert.equal(distMsg.clubId, clubId);
  assert.equal(distMsg.senderId, 'alice');

  // Distribute key to Bob and Charlie
  bobManager.processGroupSenderKeyDistribution(distMsg);
  charlieManager.processGroupSenderKeyDistribution(distMsg);

  // Alice posts Group Message 1
  const groupMsg1 = await aliceManager.encryptGroupMessage(clubId, 'Welcome to Hostel Gang 99 Club!');
  const bobDecGroup1 = await bobManager.decryptGroupMessage(groupMsg1);
  const charlieDecGroup1 = await charlieManager.decryptGroupMessage(groupMsg1);
  assert.equal(bobDecGroup1, 'Welcome to Hostel Gang 99 Club!');
  assert.equal(charlieDecGroup1, 'Welcome to Hostel Gang 99 Club!');

  // Alice posts Group Message 2
  const groupMsg2 = await aliceManager.encryptGroupMessage(clubId, 'Late night chai session at 11pm?');
  const bobDecGroup2 = await bobManager.decryptGroupMessage(groupMsg2);
  const charlieDecGroup2 = await charlieManager.decryptGroupMessage(groupMsg2);
  assert.equal(bobDecGroup2, 'Late night chai session at 11pm?');
  assert.equal(charlieDecGroup2, 'Late night chai session at 11pm?');

  // MEMBER REMOVAL & FORWARD SECRECY ROTATION:
  // Charlie is removed from the club!
  console.log('  Simulating Charlie being removed from the club...');
  const rotatedDistMsg = await aliceManager.rotateGroupSenderKey(clubId);
  assert.notEqual(rotatedDistMsg.keyId, distMsg.keyId, 'Rotated key must increment keyId');

  // Rotated key is sent ONLY to remaining member Bob (NOT Charlie!)
  bobManager.processGroupSenderKeyDistribution(rotatedDistMsg);

  // Alice posts Group Message 3 with rotated Sender Key
  const postRemovalMsg = 'Hostel secret: Charlie is no longer in this club!';
  const groupMsg3 = await aliceManager.encryptGroupMessage(clubId, postRemovalMsg);

  // Bob must be able to decrypt
  const bobDecGroup3 = await bobManager.decryptGroupMessage(groupMsg3);
  assert.equal(bobDecGroup3, postRemovalMsg, 'Bob must decrypt message encrypted with rotated Sender Key');

  // Charlie MUST fail to decrypt (Forward Secrecy preserved!)
  let charlieFailed = false;
  try {
    await charlieManager.decryptGroupMessage(groupMsg3);
  } catch (err) {
    charlieFailed = true;
  }
  assert.equal(charlieFailed, true, 'Charlie MUST NOT be able to decrypt messages after removal');
  console.log('  ✅ Sender Keys group encryption & rotation on member removal verified!\n');

  // ------------------------------------------------------------
  // Test 5: Client-Side Media Encryption & Decryption Roundtrip
  // ------------------------------------------------------------
  console.log('TEST 5: Testing Client-Side Media Encryption & Integrity Checking...');
  const fakeImageBytes = Buffer.from('RAW_JPEG_IMAGE_PIXELS_DATA_HOSTEL_SNAP_PHOTO_2026_TEST_PAYLOAD');
  const mediaResult = await encryptMediaFile(fakeImageBytes, {
    fileName: 'night-snap.jpg',
    mimeType: 'image/jpeg'
  });

  assert.ok(mediaResult.mediaKeyMeta.mediaKey, 'Media key must be present');
  assert.ok(mediaResult.mediaKeyMeta.iv, 'Media IV must be present');
  assert.ok(mediaResult.mediaKeyMeta.sha256, 'Ciphertext SHA-256 hash must be present');
  assert.notEqual(
    Buffer.from(mediaResult.encryptedBuffer).toString(),
    fakeImageBytes.toString(),
    'Encrypted ciphertext must not match plaintext'
  );

  // Decrypt media blob
  const decMedia = await decryptMediaFile(mediaResult.encryptedBuffer, mediaResult.mediaKeyMeta);
  assert.equal(
    Buffer.from(decMedia.decryptedBytes).toString(),
    fakeImageBytes.toString(),
    'Decrypted media payload must match original plaintext image'
  );

  // Verify tampering detection on corrupted ciphertext
  const corruptedBuffer = mediaResult.encryptedBuffer.slice(0);
  const corruptedBytes = new Uint8Array(corruptedBuffer);
  corruptedBytes[0] ^= 0xff; // Flip bits in first byte

  let tamperDetected = false;
  try {
    await decryptMediaFile(corruptedBuffer, mediaResult.mediaKeyMeta);
  } catch (err) {
    tamperDetected = true;
  }
  assert.equal(tamperDetected, true, 'Corrupted media ciphertext must fail decryption integrity check');
  console.log('  ✅ Media client-side encryption, decryption, and integrity checks passed!\n');

  // ------------------------------------------------------------
  // Test 6: WhatsApp-Standard 60-Digit Safety Number & QR Verification
  // ------------------------------------------------------------
  console.log('TEST 6: Testing WhatsApp-Standard 60-Digit Safety Number & QR Format...');
  const aliceKeyStr = aliceManager.identityKeys.ikDhPublic;
  const bobKeyStr = bobManager.identityKeys.ikDhPublic;

  // Compute from Alice's side
  const safetyNumberAlice = await aliceManager.computeSafetyNumber('bob', bobKeyStr);
  // Compute from Bob's side
  const safetyNumberBob = await bobManager.computeSafetyNumber('alice', aliceKeyStr);

  // Must be 100% symmetric
  assert.equal(safetyNumberAlice, safetyNumberBob, 'Safety number calculation must be symmetric');

  // Validate formatting: 12 blocks of 5 decimal digits
  const blocks = safetyNumberAlice.split(' ');
  assert.equal(blocks.length, 12, 'Safety number must have exactly 12 blocks');
  for (const block of blocks) {
    assert.match(block, /^[0-9]{5}$/, 'Each block must be exactly 5 decimal digits');
  }
  const digitsOnly = safetyNumberAlice.replace(/[^0-9]/g, '');
  assert.equal(digitsOnly.length, 60, 'Total digits must be exactly 60');

  // QR Code Data formatting and verification
  const qrString = aliceManager.createSafetyNumberQR('bob', bobKeyStr, safetyNumberAlice);
  const verifyRes = verifySafetyNumberQR(qrString, safetyNumberBob);
  assert.equal(verifyRes.verified, true, 'QR verification must succeed with authentic payload');

  const invalidVerify = verifySafetyNumberQR('99999 88888 77777 66666 55555 44444 33333 22222 11111 00000 12345 67890', safetyNumberBob);
  assert.equal(invalidVerify.verified, false, 'QR verification must reject mismatched numbers');

  console.log(`  Safety Number Sample: ${safetyNumberAlice}`);
  console.log('  ✅ 60-digit numeric fingerprint and QR verification passed!\n');

  // ------------------------------------------------------------
  // Test 7: Tamper & Security Code Change Detection
  // ------------------------------------------------------------
  console.log('TEST 7: Testing Security Code Change / Tamper Detection...');
  const store = new IdentityKeyStore('test_store_' + Date.now());

  // First time seeing Bob's key: saved cleanly
  const check1 = store.verifyOrUpdateIdentityKey('bob', bobKeyStr);
  assert.equal(check1.isNew, true);
  assert.equal(check1.changed, false);

  // Next time seeing same key: no change
  const check2 = store.verifyOrUpdateIdentityKey('bob', bobKeyStr);
  assert.equal(check2.changed, false);

  // Eve tampers with Bob's key (e.g. key replacement / MITM attempt)
  const tamperedKey = bytesToBase64(new Uint8Array(65).fill(99));
  const checkTamper = store.verifyOrUpdateIdentityKey('bob', tamperedKey);
  assert.equal(checkTamper.changed, true, 'Key tampering must trigger changed: true');
  assert.ok(checkTamper.warning, 'Warning message must be returned on key change');
  console.log(`  Security code change alert: "${checkTamper.warning}"`);
  console.log('  ✅ Tamper & security code change detection verified!\n');

  console.log('============================================================');
  console.log('🎉 ALL 7 E2EE CRYPTOGRAPHIC ENGINE TESTS PASSED 100%!');
  console.log('============================================================');
}

runTestSuite().catch((err) => {
  console.error('\n❌ TEST SUITE FAILURE:', err);
  process.exit(1);
});
