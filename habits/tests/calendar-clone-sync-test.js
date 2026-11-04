// Real import/save/encryption/owner fold/snapshot merge across two isolated devices.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.HABITS_URL || 'http://127.0.0.1:4181/';
(async()=>{
  const browser=await chromium.launch();
  try{
    const owner=await browser.newPage(),clone=await browser.newPage();
    for(const page of [owner,clone]){
      await page.route(/habits-share.*workers\.dev/,r=>r.fulfill({json:{}}));
      await page.goto(base,{waitUntil:'load'});
    }
    const secrets=await owner.evaluate(()=>({feedId:shareRandomHex(16),contentKey:shareRandomHex(32),replicaKey:shareRandomHex(32),ownerId:shareRandomHex(8)}));
    await owner.evaluate(s=>{
      Storage.write(KEY,[]);
      window.testFeed={...s,ownerCredential:shareRandomHex(32),syncMode:'clone',lastRevision:1,rowMaps:[]};
      saveAgendaFeedRecord(testFeed);
    },secrets);
    const imported=await clone.evaluate(s=>{
      Storage.write(KEY,[]);
      writeReplicaEnrollment({...s,deviceCredential:shareRandomHex(32),pairingId:shareRandomHex(16),syncMode:'clone',meta:{revision:1}});
      // No replicaMode/replicaRows yet: the library may arrive minutes after pairing.
      _replicaFlushBusy=true;
      const from=dayStart(Date.now())+86400000;
      const stamp=ts=>new Date(ts).toISOString().replace(/[-:]/g,'').replace('.000','');
      const ics='BEGIN:VCALENDAR\nVERSION:2.0\n'+Array.from({length:120},(_,i)=>{
        const start=from+i*3600000;
        return `BEGIN:VEVENT\nUID:clone-${i}\nSUMMARY:Imported ${i}\nDTSTART:${stamp(start)}\nDTEND:${stamp(start+1800000)}\nEND:VEVENT`;
      }).join('\n')+'\nEND:VCALENDAR';
      const events=parseCalendarIcsText(ics,{from,to:from+10*86400000}).events;
      applyCalendarImport(events,{source:'ics'});
      const pending=Object.keys(replicaEnrollment().replicaPendingDefinitions || {}).length;
      mergeReplicaSnapshot({schemaVersion:1,mode:'clone',items:[],settings:null},replicaEnrollment());
      return {pending,remaining:load().length};
    },secrets);
    assert.equal(imported.pending,120,'imports queue before the first library arrives');
    assert.equal(imported.remaining,120,'the first empty owner snapshot preserves every imported meeting');
    // Simulate a reload/offline interval with the actual persisted enrollment.
    await clone.reload({waitUntil:'load'});
    const persisted=await clone.evaluate(()=>({items:load().length,pending:Object.keys(replicaEnrollment().replicaPendingDefinitions || {}).length}));
    assert.deepEqual(persisted,{items:120,pending:120});
    const queued=await clone.evaluate(async()=>{
      window.testPosts=[];window.testAttempts=0;
      shareFetch=async(path,opts={})=>{
        testAttempts++;
        if(testPosts.length===100)throw Object.assign(Error('rate limited'),{status:429});
        testPosts.push({createdAt:Date.now(),envelope:opts.body.definition});
        return {status:200,body:{}};
      };
      _replicaFlushBusy=false;await flushReplicaOutbox();
      return {posts:testPosts,attempts:testAttempts,remaining:replicaEnrollment().replicaOutbox.length};
    });
    assert.equal(queued.posts.length,100);assert.equal(queued.attempts,101,'bulk upload stops when throttled');
    assert.equal(queued.remaining,20,'unsent rows stay queued');
    async function ownerFold(records,revision){
      return owner.evaluate(async({records,revision})=>{
        testFeed.lastRevision=revision;
        shareFetch=async()=>({status:200,body:{revision,definitions:records,completions:[]}});
        _agendaCompletionSyncAt=0;
        const result=await syncHouseholdAgendaCompletions(testFeed,{force:true});
        testFeed=result.feed;saveAgendaFeedRecord(testFeed);
        return buildHouseholdReplica(load(),loadSortSettings(),testFeed,{});
      },{records,revision});
    }
    let snapshot=await ownerFold(queued.posts,2);
    assert.equal(snapshot.items.length,100,'the main device accepts the encrypted imported definitions');
    await clone.evaluate(snapshot=>mergeReplicaSnapshot(snapshot,replicaEnrollment()),snapshot);
    assert.equal(await clone.evaluate(()=>load().length),120,'owner batch acknowledgment keeps the remaining local imports');
    const tail=await clone.evaluate(async()=>{
      testPosts=[];shareFetch=async(path,opts)=>{testPosts.push({createdAt:Date.now(),envelope:opts.body.definition});return {status:200,body:{}};};
      await flushReplicaOutbox();return testPosts;
    });
    snapshot=await ownerFold(tail,3);
    await clone.evaluate(snapshot=>mergeReplicaSnapshot(snapshot,replicaEnrollment()),snapshot);
    assert.equal(snapshot.items.length,120);
    assert.equal(await clone.evaluate(()=>Object.keys(replicaEnrollment().replicaPendingDefinitions || {}).length),0,'published definitions settle receipts even for a large import');
    assert.equal(await clone.evaluate(()=>load().length),120);
    // Imports on an already installed clone must also survive a stale snapshot.
    const later=await clone.evaluate(()=>{
      _replicaFlushBusy=true;
      const start=Date.now()+86400000;
      applyCalendarImport([{id:'ics:after-install',subject:'Later import',start,end:start+3600000}],{source:'ics'});
      return Object.keys(replicaEnrollment().replicaPendingDefinitions || {}).length;
    });
    assert(later>=1);
    await clone.evaluate(snapshot=>mergeReplicaSnapshot(snapshot,replicaEnrollment()),snapshot);
    assert.equal(await clone.evaluate(()=>load().length),121);

    const mirror=await clone.evaluate(()=>{
      localStorage.setItem(DEVICE_CALENDARS_KEY,JSON.stringify({enabled:true,calendarIds:['7']}));
      const prefs=deviceCalendarPreferences({ensureSourceId:true});
      const saved=JSON.parse(nativeBackgroundSnapshot().storage[DEVICE_CALENDARS_KEY]);
      return {same:prefs.sourceId===saved.sourceId,valid:/^[0-9a-f]{16}$/.test(saved.sourceId),adopt:saved.adoptLegacy};
    });
    assert.deepEqual(mirror,{same:true,valid:true,adopt:false},'the background mirror retains the same connection identity and protects legacy owner rows');
    const ownership=await clone.evaluate(()=>{
      const from=dayStart(Date.now()),start=from+86400000;
      const snapshot={complete:true,calendarIds:['7'],from,to:from+14*86400000,events:[{id:'device:7:20',calendarId:'7',subject:'Phone A',start,end:start+3600000}]};
      const a=reconcileDeviceCalendarSnapshot([],snapshot,{sourceId:'11'.repeat(8),adoptLegacy:false});
      const b=reconcileDeviceCalendarSnapshot(a.data,{...snapshot,events:[{...snapshot.events[0],subject:'Phone B'}]},{sourceId:'22'.repeat(8),adoptLegacy:false});
      const stopped=reconcileDeviceCalendarSnapshot(b.data,{...snapshot,events:[],calendarIds:[]},{calendarIds:[],sourceId:'22'.repeat(8),adoptLegacy:false});
      return {count:b.data.length,ids:new Set(b.data.map(h=>h.hid)).size,afterStop:stopped.data.map(h=>h.name)};
    });
    assert.deepEqual(ownership,{count:2,ids:2,afterStop:['Phone A']},'each phone reconciles only its own calendar rows');
    console.log('Calendar clone sync: first import, stale polls, reload, encrypted owner merge, bulk backpressure and phone ownership passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
