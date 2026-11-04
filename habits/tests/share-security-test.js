// Exercise actual browser Web Crypto and fetch security, using synthetic data.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch();
  try{
    const context=await browser.newContext({serviceWorkers:'block'});
    const page=await context.newPage();
    await page.route(/habits-share.*workers\.dev/,r=>r.fulfill({json:{}}));
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'load'});
    const cryptoResult=await page.evaluate(async()=>{
      const rejects=async fn=>{try{await fn();return false;}catch(_){return true;}};
      const key=shareRandomHex(32),otherKey=shareRandomHex(32),id=shareRandomHex(16);
      const fields={schemaVersion:1,objectId:id,recordKind:'agenda_replica',revision:1};
      const privateData={name:'PRIVATE meeting',address:'PRIVATE address',notes:'PRIVATE notes'};
      const sealed=await shareEncrypt(key,privateData,fields);
      const another=await shareEncrypt(key,privateData,fields);
      const opened=await shareDecrypt(key,sealed);
      const mutations=[{nonce:shareRandomHex(12)},{ciphertext:sealed.ciphertext.replace(/^./,sealed.ciphertext[0]==='A'?'B':'A')},
        {objectId:shareRandomHex(16)},{recordKind:'agenda_snapshot'},{revision:2},{schemaVersion:2}];
      const tamperDenied=await Promise.all(mutations.map(patch=>rejects(()=>shareDecrypt(key,{...sealed,...patch}))));
      const pair=await shareNewAgendaPairingRequest(),otherPair=await shareNewAgendaPairingRequest();
      const contentKey=shareRandomHex(32),replicaKey=shareRandomHex(32);
      const transfer=await shareAgendaPairEncrypt(contentKey,id,pair.pairingId,pair.displayPublicKey,'clone',replicaKey);
      const paired=await shareAgendaPairDecrypt(transfer,pair.privateKey,id,pair.pairingId);
      const glance=await shareAgendaPairEncrypt(contentKey,id,pair.pairingId,pair.displayPublicKey,'glance',replicaKey);
      const glanceKeys=await shareAgendaPairDecrypt(glance,pair.privateKey,id,pair.pairingId);
      return {
        roundTrip:JSON.stringify(opened)===JSON.stringify(privateData),
        opaque:!JSON.stringify(sealed).includes('PRIVATE') && !JSON.stringify(transfer).includes(contentKey)
          && !JSON.stringify(transfer).includes(replicaKey),
        uniqueNonces:sealed.nonce!==another.nonce && sealed.ciphertext!==another.ciphertext,
        wrongKeyDenied:await rejects(()=>shareDecrypt(otherKey,sealed)),tamperDenied,
        paired:paired.contentKey===contentKey && paired.replicaKey===replicaKey,
        wrongDeviceDenied:await rejects(()=>shareAgendaPairDecrypt(transfer,otherPair.privateKey,id,pair.pairingId)),
        wrongFeedDenied:await rejects(()=>shareAgendaPairDecrypt(transfer,pair.privateKey,shareRandomHex(16),pair.pairingId)),
        wrongPairDenied:await rejects(()=>shareAgendaPairDecrypt(transfer,pair.privateKey,id,otherPair.pairingId)),
        privateKeyNonExportable:!pair.privateKey.extractable && await rejects(()=>crypto.subtle.exportKey('jwk',pair.privateKey)),
        glanceHasNoLibraryKey:glanceKeys.replicaKey===null,
        glanceCannotReadLibrary:await rejects(async()=>shareDecrypt(contentKey,await shareEncrypt(replicaKey,privateData,fields)))
      };
    });
    for(const [name,value] of Object.entries(cryptoResult))assert(Array.isArray(value)?value.every(Boolean):value,name);

    const fetchResult=await page.evaluate(async()=>{
      const realFetch=window.fetch,realBase=shareWorkerBaseUrl;
      const calls=[];
      window.fetch=async(url,opts)=>{calls.push({url,opts});return new Response('{}',{status:200});};
      let invalidPathRejected=false,untrustedRelayRejected=false;
      try{
        await shareFetch('/v1/agendas/'+shareRandomHex(16),{credential:shareRandomHex(32),method:'POST',body:{sealed:true}});
        try{await shareFetch('//evil.example/v1/agendas',{credential:'never-send'});}catch(_){invalidPathRejected=true;}
        shareWorkerBaseUrl=()=> 'https://evil.example';
        try{await shareFetch('/v1/agendas',{body:{ownerCredential:'never-send'}});}catch(_){untrustedRelayRejected=true;}
      }finally{window.fetch=realFetch;shareWorkerBaseUrl=realBase;}
      const opts=calls[0].opts;
      return {oneRequest:calls.length===1,invalidPathRejected,untrustedRelayRejected,
        credentials:opts.credentials,redirect:opts.redirect,mode:opts.mode,referrerPolicy:opts.referrerPolicy};
    });
    assert(fetchResult.oneRequest && fetchResult.invalidPathRejected && fetchResult.untrustedRelayRejected);
    assert.equal(fetchResult.credentials,'omit');assert.equal(fetchResult.redirect,'error');
    assert.equal(fetchResult.mode,'cors');assert.equal(fetchResult.referrerPolicy,'no-referrer');

    // A real fetch must fail on a redirect before transmitting a pairing body to its destination.
    let followed=0,redirected=0;
    await page.route('**/v1/security-redirect-target',r=>{followed++;return r.fulfill({json:{}});});
    await page.route('**/v1/security-redirect',r=>{
      const headers={'Access-Control-Allow-Origin':new URL(page.url()).origin,
        'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type'};
      if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers});
      redirected++;
      return r.fulfill({status:307,headers:{...headers,
        Location:'https://habits-share.contactnabilkhan.workers.dev/v1/security-redirect-target'}});
    });
    assert(await page.evaluate(async()=>{
      try{await shareFetch('/v1/security-redirect',{method:'POST',body:{ownerCredential:'synthetic-secret'}});return false;}
      catch(_){return true;}
    }),'relay redirects fail closed');
    assert.equal(redirected,1,'the test must reach an actual redirect response');
    assert.equal(followed,0,'redirect destination must never receive credentials or request bodies');
    console.log('Share security: authenticated encryption, key separation, exact relay, redirect, cookie and referrer protections passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
