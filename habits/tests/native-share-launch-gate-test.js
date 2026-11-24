// Launch-gate acceptance: the packaged Play build disables the share
// subsystem end to end (no relay requests, no sharing UI, saved pairing
// records untouched), while a personal native build and the plain PWA keep
// every entry point. Both production and staging relay hosts are intercepted
// and every attempt is counted before being fulfilled.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.HABITS_URL || 'http://127.0.0.1:4181/';
const RELAY_HOSTS=/https:\/\/habits-share(?:-staging)?\.contactnabilkhan\.workers\.dev/;
const PRODUCTION_RELAY='https://habits-share.contactnabilkhan.workers.dev';
const STAGING_RELAY='https://habits-share-staging.contactnabilkhan.workers.dev';
const hex=n=>[...crypto.getRandomValues(new Uint8Array(n))].map(b=>b.toString(16).padStart(2,'0')).join('');

(async()=>{
  const browser=await chromium.launch();
  try{
    // One browser context per case: fresh storage, blocked service workers so
    // request interception sees every attempt, and a relay counter shared by
    // every page in the case. The bridge shim installs before navigation.
    async function newCase({sharingEnabled,native=true,seed=null}){
      const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
      const attempts=[];
      await context.route(RELAY_HOSTS,route=>{
        attempts.push({method:route.request().method(),url:route.request().url()});
        return route.fulfill({status:200,contentType:'application/json',body:'{}'});
      });
      await context.addInitScript(({sharingEnabled,native,seed})=>{
        if(native){
          // The packaged native bridge runs before config.js in both pages.
          window.Capacitor={isNativePlatform:()=>true};
          window.TingsNative={isNative:true,platform:'android',
            ...(sharingEnabled === undefined ? {} : {sharingEnabled}),
            notifications:{permissions:async()=>({display:'denied'}),
              exactAlarmPermission:async()=>({exact_alarm:'denied'}),pending:async()=>({notifications:[]})}};
        }
        localStorage.clear();
        localStorage.setItem('tings_coach_essentials_v2','done');
        localStorage.setItem('tings_coach_install_v2','done');
        localStorage.setItem('tings_app_settings_v2',JSON.stringify({minimalMode:false,showWeekOnHome:false,localAssistant:false,localAssistantSetupVersion:2,agendaOptimizer:false}));
        if(seed?.ownerFeed){
          localStorage.setItem('tings_share_v1',JSON.stringify({shares:{},feeds:{agenda:seed.ownerFeed},outbox:[]}));
        }
        if(seed?.cloneEnrollment){
          localStorage.setItem('tings_agenda_display_v4',JSON.stringify(seed.cloneEnrollment));
        }
      },{sharingEnabled,native,seed});
      const page=await context.newPage();
      const errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      return {context,page,attempts,errors};
    }

    const seedItems=async page=>{
      await page.waitForFunction(()=>typeof save==='function' && typeof render==='function');
      await page.evaluate(()=>{
        const now=Date.now();
        const base={type:'keepup',repeatMode:'routine',lastLog:null,logs:[],emoji:'',emojiBgColor:'teal',pinned:false,
          showOnSharedDisplay:true,allowSharedDisplayCompletion:true,priority:2,topics:[],locationIds:[],anywhereAllowed:true,
          locationPrefs:{},weatherProfileMode:'inherit',weatherProfileId:null,weatherLocationId:null,showWeather:false,
          showWeatherAtLocation:false,allowedWeekdays:[],allowedTimeStart:null,allowedTimeEnd:null,minGapMinutes:0,
          createdAt:now,earlyWindowDays:0,delayAllowanceDays:0,target:7,durationMinutes:20,breakable:false,minChunkMinutes:null};
        save([{...base,hid:'gate-read',name:'Read'}]);
        render();
      });
      await page.waitForTimeout(300);
    };

    // ── Case 1: Android launch build, fresh install ──
    {
      const {context,page,attempts,errors}=await newCase({sharingEnabled:false});
      await page.goto(base,{waitUntil:'load'});
      await seedItems(page);
      const fresh=await page.evaluate(()=>({
        configured:shareConfigured(),
        shareWrapHidden:document.querySelector('#detail-share-item')?.closest('.habit-action-with-leave')?.style.display==='none',
        displayControlHidden:document.querySelector('.detail-shared-display-control')?.style.display==='none'
      }));
      assert.equal(fresh.configured,false,'sharing is unconfigured in the launch build');
      assert(fresh.shareWrapHidden,'the share item wrapper is hidden');
      assert(fresh.displayControlHidden,'the shared display detail control is hidden');

      await page.evaluate(()=>openSettingsSheet());
      await page.waitForTimeout(150);
      assert(await page.evaluate(()=>document.getElementById('settings-agenda-head')?.closest('section')?.hidden!==false),'the shared display settings section is hidden');
      await page.evaluate(()=>closeSheet('settings-sheet'));
      await page.waitForTimeout(200);

      await page.evaluate(()=>openDetail(0));
      await page.waitForTimeout(200);
      const entries=await page.evaluate(()=>detailSearchEntries().map(e=>({
        shareItem:e.target.id==='detail-share-item',
        sharedDisplay:Boolean(e.target.closest && e.target.closest('.detail-shared-display-control'))
      })));
      assert(!entries.some(e=>e.shareItem),'detail search omits the share item control');
      assert(!entries.some(e=>e.sharedDisplay),'detail search omits the shared display control');

      // Bulk edit exposes both operations independently of the detail pane.
      await page.evaluate(()=>{closeDetail();closeSheet('settings-sheet');});
      await page.waitForTimeout(250);
      await page.locator('[data-open-home-filters]').click();
      await page.waitForTimeout(200);
      await page.locator('#home-filter-sheet [data-open-bulk-edit]').click();
      await page.waitForTimeout(300);
      await page.locator('[data-bulk-check]').first().check();
      await page.locator('#bulk-edit-continue').click();
      await page.waitForTimeout(300);
      const bulk=await page.evaluate(()=>({
        sharedDisplayRow:document.querySelector('[data-bulk-op-row="sharedDisplay"]') !== null,
        sharedCompletionRow:document.querySelector('[data-bulk-op-row="sharedCompletion"]') !== null,
        sharedDisplayVisible:bulkOpVisible(bulkOpById('sharedDisplay')),
        sharedCompletionVisible:bulkOpVisible(bulkOpById('sharedCompletion'))
      }));
      assert(!bulk.sharedDisplayRow && !bulk.sharedCompletionRow,'bulk edit renders no shared display rows');
      assert(!bulk.sharedDisplayVisible && !bulk.sharedCompletionVisible,'bulk edit treats both operations as hidden');

      // The real invite path toasts instead of contacting the relay.
      await page.evaluate(()=>{
        openDetail(0);
        const original=showToast;
        window.detailToast='';
        window.showToast=text=>{window.detailToast=String(text);return original(text);};
      });
      await page.evaluate(async()=>{await shareCurrentDetailItem();});
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(()=>window.detailToast),'sharing is not available in this build','an item invite stays local');
      assert.equal(attempts.length,0,'an item invite causes zero relay requests');
      assert.deepEqual(errors,[],'case 1 has zero page errors');
      await context.close();
    }

    // ── Case 2a: Android launch build, saved owner feed ──
    {
      const ownerFeed={feedId:hex(16),contentKey:hex(32),replicaKey:hex(32),ownerCredential:hex(32),ownerId:hex(8),
        lastRevision:1,syncMode:'clone',devices:[],replicaRowIds:{}};
      const {context,page,attempts,errors}=await newCase({sharingEnabled:false,seed:{ownerFeed}});
      // A legacy display fragment must open the planner, not agenda-display.html.
      await page.goto(`${base}#feed=${hex(16)}&key=${hex(32)}&viewer=${hex(16)}`,{waitUntil:'load'});
      await page.waitForTimeout(400);
      assert(!page.url().includes('agenda-display.html'),'a legacy display link opens the planner');
      const ownerState=await page.evaluate(feed=>({
        scannerHidden:document.getElementById('agenda-pair-scanner')?.hidden!==false,
        feedSurvives:JSON.parse(localStorage.getItem('tings_share_v1') || 'null')?.feeds?.agenda?.feedId===feed.feedId,
        feedInactive:agendaFeedRecord()===null,
        sync:nativeBackgroundSnapshot().sync
      }),ownerFeed);
      assert(ownerState.scannerHidden,'no scanner modal on a legacy display link');
      assert(ownerState.feedSurvives,'the saved owner feed survives');
      assert(ownerState.feedInactive,'the saved owner feed reads as inactive to share consumers');
      assert.deepEqual(ownerState.sync,{},'a newly generated native snapshot carries sync: {}');

      // A valid pairing fragment must never open the scanner on startup.
      await page.goto(`${base}#agendaPair=${hex(16)}&x=${'A'.repeat(43)}&y=${'B'.repeat(43)}`,{waitUntil:'load'});
      await page.waitForTimeout(400);
      assert(!page.url().includes('agenda-display.html'),'a pairing link opens the planner');
      assert(await page.evaluate(()=>document.getElementById('agenda-pair-scanner')?.hidden!==false),'a valid pairing fragment never opens the scanner');
      assert.equal(attempts.length,0,'pairing and legacy fragments cause zero relay requests');
      assert.deepEqual(errors,[],'case 2a has zero page errors');
      await context.close();
    }

    // ── Case 2b: Android launch build, saved clone enrollment ──
    {
      const cloneEnrollment={feedId:hex(16),contentKey:hex(32),replicaKey:hex(32),deviceCredential:hex(32),pairingId:hex(16),syncMode:'clone',meta:{revision:1}};
      const {context,page,attempts,errors}=await newCase({sharingEnabled:false,seed:{cloneEnrollment}});
      // ?display=1 is checked independently of saved enrollment by the mount
      // guard; the launch build must stay on the regular planner.
      await page.goto(`${base}?display=1`,{waitUntil:'load'});
      await page.waitForTimeout(400);
      assert(!page.url().includes('agenda-display.html'),'?display=1 opens the planner');
      const state=await page.evaluate(feed=>({
        replicaBar:document.querySelector('.replica-display-bar')!==null,
        enrollmentSurvives:JSON.parse(localStorage.getItem('tings_agenda_display_v4') || 'null')?.feedId===feed.feedId,
        feedInactive:replicaEnrollment()===null,
        sync:nativeBackgroundSnapshot().sync
      }),cloneEnrollment);
      assert(!state.replicaBar,'no replica bar appears in display-query mode');
      assert(state.enrollmentSurvives,'the saved clone enrollment survives');
      assert(state.feedInactive,'the saved enrollment reads as inactive to share consumers');
      assert.deepEqual(state.sync,{},'the clone snapshot also carries sync: {}');

      // Direct agenda-display.html navigation returns to the local planner
      // without purging the enrollment, rendering a display, or relaying.
      await page.goto(`${base}agenda-display.html`,{waitUntil:'load'});
      await page.waitForFunction(()=>!location.pathname.includes('agenda-display.html'),undefined,{timeout:5000});
      const returned=await page.evaluate(feed=>({
        noQueryNoFragment:location.search==='' && location.hash==='',
        enrollmentSurvives:JSON.parse(localStorage.getItem('tings_agenda_display_v4') || 'null')?.feedId===feed.feedId,
        replicaBar:document.querySelector('.replica-display-bar')!==null
      }),cloneEnrollment);
      assert(!page.url().includes('agenda-display.html'),'agenda-display.html returns to the local planner');
      assert(returned.noQueryNoFragment,'the return strips query and fragment');
      assert(returned.enrollmentSurvives,'direct display navigation leaves the enrollment in place');
      assert(!returned.replicaBar,'no replica bar after the return');
      assert.equal(attempts.length,0,'saved-clone navigation causes zero relay requests');
      assert.deepEqual(errors,[],'case 2b has zero page errors');
      await context.close();
    }

    // ── Case 3: Android personal build (flag true) ──
    {
      const {context,page,attempts,errors}=await newCase({sharingEnabled:true});
      await page.goto(base,{waitUntil:'load'});
      await seedItems(page);
      const on=await page.evaluate(()=>({configured:shareConfigured(),worker:shareWorkerBaseUrl()}));
      assert.equal(on.configured,true,'a personal build configures sharing');
      assert.equal(on.worker,PRODUCTION_RELAY,'a personal build uses the production relay');

      await page.evaluate(()=>openSettingsSheet());
      await page.waitForTimeout(150);
      const settings=await page.evaluate(()=>({
        sectionOpen:document.getElementById('settings-agenda-head')?.closest('section')?.hidden===false,
        emptyVisible:document.getElementById('settings-agenda-empty')?.hidden===false
      }));
      assert(settings.sectionOpen,'the shared display settings section is available');
      assert(settings.emptyVisible,'the settings pane shows its normal empty state');

      await page.evaluate(()=>openDetail(0));
      await page.waitForTimeout(200);
      const detail=await page.evaluate(()=>{
        const entries=detailSearchEntries().map(e=>({
          shareItem:e.target.id==='detail-share-item',
          sharedDisplay:Boolean(e.target.closest && e.target.closest('.detail-shared-display-control'))
        }));
        return {
          shareItemEntry:entries.some(e=>e.shareItem),
          sharedDisplayEntry:entries.some(e=>e.sharedDisplay),
          shareWrapShown:document.querySelector('#detail-share-item')?.closest('.habit-action-with-leave')?.style.display!=='none',
          displayControlShown:document.querySelector('.detail-shared-display-control')?.style.display!=='none'
        };
      });
      assert(detail.shareItemEntry && detail.sharedDisplayEntry,'detail search includes both controls');
      assert(detail.shareWrapShown && detail.displayControlShown,'both detail controls are available in the open pane');

      // An item invitation points at the public owner origin; the encrypted
      // create POST is the single allowed relay request in this case.
      const invited=await page.evaluate(async()=>{
        const created=await createItemShare(load()[0],null);
        return {url:created.url,origin:new URL(created.url).origin};
      });
      assert.equal(invited.origin,'https://lanbeee.github.io','an item invitation uses the public Tings URL');
      assert(await page.evaluate(()=>Object.keys(loadShareState().shares).length===1),'the created share is recorded');
      assert.equal(attempts.length,1,'the invitation posts exactly once');
      assert(attempts[0].url.startsWith(`${PRODUCTION_RELAY}/v1/items`),'the invitation targets the production relay');
      assert.deepEqual(errors,[],'case 3 has zero page errors');
      await context.close();
    }

    // ── Case 4: plain PWA, no native bridge ──
    {
      const {context,page,attempts,errors}=await newCase({native:false});
      await page.goto(base,{waitUntil:'load'});
      const web=await page.evaluate(()=>({
        configured:shareConfigured(),
        worker:shareWorkerBaseUrl(),
        flagUndefined:window.TingsNative===undefined
      }));
      assert.equal(web.configured,true,'the web build configures sharing with the repository relay');
      assert.equal(web.worker,STAGING_RELAY,'localhost web builds use the staging relay');
      assert(web.flagUndefined,'no native bridge is present');
      await page.evaluate(()=>openSettingsSheet());
      await page.waitForTimeout(150);
      assert(await page.evaluate(()=>document.getElementById('settings-agenda-head')?.closest('section')?.hidden===false),'the shared display settings section is available on the web');
      assert.deepEqual(attempts.filter(a=>!a.url.includes('/v1/')),[],'no unexpected relay traffic while idle');
      assert.deepEqual(errors,[],'case 4 has zero page errors');
      await context.close();
    }

    console.log('PASS: launch gate hides sharing end to end with zero relay attempts, saved pairing survives, personal and web builds keep every entry point.');
  }finally{
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
