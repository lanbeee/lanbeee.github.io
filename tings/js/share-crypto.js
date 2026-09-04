const SHARE_SCHEMA_VERSION = 1;
const SHARE_ID_BYTES = 16;
const SHARE_KEY_BYTES = 32;
const SHARE_NONCE_BYTES = 12;

function shareConfigured(){
  const url = typeof shareWorkerBaseUrl === 'function'
    ? shareWorkerBaseUrl()
    : (typeof SHARE_WORKER_URL !== 'undefined' ? SHARE_WORKER_URL : '');
  return Boolean(url) && !String(url).includes('YOUR-ACCOUNT');
}

function shareRandomHex(byteLength){
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return shareBytesToHex(bytes);
}

function shareBytesToHex(bytes){
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  for(const b of view) out += b.toString(16).padStart(2,'0');
  return out;
}

function shareHexToBytes(hex){
  const out = new Uint8Array(hex.length / 2);
  for(let i = 0;i < out.length;i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function shareBytesToB64(bytes){
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for(let i = 0;i < view.length;i += 0x8000){
    bin += String.fromCharCode.apply(null, view.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function shareB64ToBytes(value){
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for(let i = 0;i < bin.length;i++) out[i] = bin.charCodeAt(i);
  return out;
}

function shareAadBytes(fields){
  return new TextEncoder().encode([
    fields.schemaVersion,
    fields.objectId,
    fields.recordKind,
    fields.revision,
    fields.operationId || ''
  ].join('|'));
}

async function shareImportAesKey(contentKeyHex){
  return crypto.subtle.importKey('raw', shareHexToBytes(contentKeyHex), 'AES-GCM', false, ['encrypt','decrypt']);
}

async function shareEncrypt(contentKeyHex, plaintext, fields){
  const key = await shareImportAesKey(contentKeyHex);
  const nonce = crypto.getRandomValues(new Uint8Array(SHARE_NONCE_BYTES));
  const encoded = new TextEncoder().encode(JSON.stringify(plaintext));
  const ciphertext = await crypto.subtle.encrypt(
    { name:'AES-GCM', iv:nonce, additionalData:shareAadBytes(fields) },
    key,
    encoded
  );
  return {
    schemaVersion:fields.schemaVersion,
    recordKind:fields.recordKind,
    objectId:fields.objectId,
    revision:fields.revision,
    operationId:fields.operationId,
    op:fields.op,
    logId:fields.logId,
    nonce:shareBytesToHex(nonce),
    ciphertext:shareBytesToB64(new Uint8Array(ciphertext))
  };
}

async function shareDecrypt(contentKeyHex, envelope){
  const key = await shareImportAesKey(contentKeyHex);
  const bytes = await crypto.subtle.decrypt(
    {
      name:'AES-GCM',
      iv:shareHexToBytes(envelope.nonce),
      additionalData:shareAadBytes(envelope)
    },
    key,
    shareB64ToBytes(envelope.ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(bytes));
}

function shareNewItemSecrets(){
  return {
    id:shareRandomHex(SHARE_ID_BYTES),
    contentKey:shareRandomHex(SHARE_KEY_BYTES),
    ownerCredential:shareRandomHex(SHARE_KEY_BYTES),
    claimSecret:shareRandomHex(SHARE_KEY_BYTES)
  };
}

function shareNewAgendaSecrets(){
  return {
    id:shareRandomHex(SHARE_ID_BYTES),
    contentKey:shareRandomHex(SHARE_KEY_BYTES),
    ownerCredential:shareRandomHex(SHARE_KEY_BYTES)
  };
}

const AGENDA_PAIR_CODE_DIGITS = 8;

async function shareSha256Hex(value){
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(value)));
  return shareBytesToHex(digest);
}

function shareNewAgendaPairCode(){
  let code = '';
  while(code.length < AGENDA_PAIR_CODE_DIGITS){
    const bytes = crypto.getRandomValues(new Uint8Array(AGENDA_PAIR_CODE_DIGITS));
    for(const byte of bytes){
      if(byte >= 250) continue;
      code += String(byte % 10);
      if(code.length === AGENDA_PAIR_CODE_DIGITS) break;
    }
  }
  return code;
}

function shareNormalizeAgendaPairCode(value){
  return String(value || '').replace(/[^0-9]/g,'').slice(0,AGENDA_PAIR_CODE_DIGITS);
}

function shareFormatAgendaPairCode(value){
  const code = shareNormalizeAgendaPairCode(value);
  return code.length > 4 ? `${code.slice(0,4)}-${code.slice(4)}` : code;
}

async function shareAgendaPairConfirmationProof(pairingId,code){
  return shareSha256Hex(`tings-agenda-pair-code-v1|${pairingId}|${shareNormalizeAgendaPairCode(code)}`);
}

function shareAgendaPairPublicKey(key){
  return {
    kty:'EC',
    crv:'P-256',
    x:String(key && key.x || ''),
    y:String(key && key.y || ''),
    ext:true
  };
}

function shareAgendaPairPublicKeyValid(key){
  return Boolean(key)
    && key.kty === 'EC'
    && key.crv === 'P-256'
    && key.ext === true
    && /^[A-Za-z0-9_-]{43}$/.test(key.x || '')
    && /^[A-Za-z0-9_-]{43}$/.test(key.y || '');
}

async function shareNewAgendaPairingRequest(){
  const pairingId = shareRandomHex(SHARE_ID_BYTES);
  const pollCredential = shareRandomHex(SHARE_KEY_BYTES);
  const deviceCredential = shareRandomHex(SHARE_KEY_BYTES);
  const confirmationCode = shareNewAgendaPairCode();
  const keyPair = await crypto.subtle.generateKey(
    { name:'ECDH',namedCurve:'P-256' },
    true,
    ['deriveKey']
  );
  const displayPublicKey = shareAgendaPairPublicKey(await crypto.subtle.exportKey('jwk',keyPair.publicKey));
  return {
    pairingId,
    pollCredential,
    deviceCredential,
    deviceCredentialHash:await shareSha256Hex(deviceCredential),
    confirmationCode,
    confirmationProof:await shareAgendaPairConfirmationProof(pairingId,confirmationCode),
    displayPublicKey,
    privateKey:keyPair.privateKey
  };
}

function shareAgendaPairAad(pairingId,feedId){
  return new TextEncoder().encode(`tings-agenda-pair-transfer-v1|${pairingId}|${feedId}`);
}

async function shareImportAgendaPairPublicKey(publicKey){
  if(!shareAgendaPairPublicKeyValid(publicKey)) throw new Error('invalid_pairing_key');
  return crypto.subtle.importKey(
    'jwk',
    shareAgendaPairPublicKey(publicKey),
    { name:'ECDH',namedCurve:'P-256' },
    false,
    []
  );
}

async function shareAgendaPairEncrypt(contentKey,feedId,pairingId,displayPublicKey){
  const displayKey = await shareImportAgendaPairPublicKey(displayPublicKey);
  const ownerKeys = await crypto.subtle.generateKey(
    { name:'ECDH',namedCurve:'P-256' },
    true,
    ['deriveKey']
  );
  const wrappingKey = await crypto.subtle.deriveKey(
    { name:'ECDH',public:displayKey },
    ownerKeys.privateKey,
    { name:'AES-GCM',length:256 },
    false,
    ['encrypt']
  );
  const nonce = crypto.getRandomValues(new Uint8Array(SHARE_NONCE_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify({
    schemaVersion:1,
    pairingId,
    feedId,
    contentKey
  }));
  const ciphertext = await crypto.subtle.encrypt(
    { name:'AES-GCM',iv:nonce,additionalData:shareAgendaPairAad(pairingId,feedId) },
    wrappingKey,
    plaintext
  );
  return {
    ownerPublicKey:shareAgendaPairPublicKey(await crypto.subtle.exportKey('jwk',ownerKeys.publicKey)),
    nonce:shareBytesToHex(nonce),
    ciphertext:shareBytesToB64(new Uint8Array(ciphertext))
  };
}

async function shareAgendaPairDecrypt(transfer,privateKey,feedId,pairingId){
  const ownerKey = await shareImportAgendaPairPublicKey(transfer && transfer.ownerPublicKey);
  const wrappingKey = await crypto.subtle.deriveKey(
    { name:'ECDH',public:ownerKey },
    privateKey,
    { name:'AES-GCM',length:256 },
    false,
    ['decrypt']
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      name:'AES-GCM',
      iv:shareHexToBytes(transfer.nonce),
      additionalData:shareAgendaPairAad(pairingId,feedId)
    },
    wrappingKey,
    shareB64ToBytes(transfer.ciphertext)
  );
  const payload = JSON.parse(new TextDecoder().decode(plaintext));
  if(payload.schemaVersion !== 1
    || payload.pairingId !== pairingId
    || payload.feedId !== feedId
    || !/^[0-9a-f]{64}$/.test(payload.contentKey || '')) throw new Error('invalid_pairing_transfer');
  return payload.contentKey;
}
