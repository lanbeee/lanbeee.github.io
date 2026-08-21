const SHARE_SCHEMA_VERSION = 1;
const SHARE_ID_BYTES = 16;
const SHARE_KEY_BYTES = 32;
const SHARE_NONCE_BYTES = 12;

function shareConfigured(){
  return Boolean(SHARE_WORKER_URL) && !String(SHARE_WORKER_URL).includes('YOUR-ACCOUNT');
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
    ownerCredential:shareRandomHex(SHARE_KEY_BYTES),
    viewerCredential:shareRandomHex(SHARE_KEY_BYTES)
  };
}
