// Native sound storage/delivery is covered by NotificationSoundsTest in the Android shell.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
    });
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'load'});
    await page.waitForFunction(()=>typeof nativeNotificationSoundControls==='function');
    assert.equal(await page.evaluate(()=>nativeNotificationSoundControls()),null,'sound controls stay absent in the PWA');
    assert.equal(await page.evaluate(()=>nativeItemReminderControls('item:x','X').querySelector('[data-reminder-sound]')),null,'item sounds stay absent in the PWA');
    assert.deepEqual(await page.evaluate(()=>buildPrayerSamples().map(h=>h.hid)),
      ['fajr','dhuhr','asr','maghrib','isha'].map(id=>`sample-prayer-${id}`),'prayer sample identities match native Warm routing');
    const before=await page.evaluate(()=>{
      // Start with persisted preferences; opening native settings normally initializes this key.
      localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify({...nativeReminderPreferences(),daily:nativeCatchupRule(),weekly:nativeCatchupRule(null,true)}));
      return localStorage.getItem(NATIVE_REMINDERS_KEY);
    });
    await page.evaluate(()=>{
      window.soundTest={selected:'calm',silent:false,enabled:true,calls:[],reject:false};
      const choices=[['default','Phone default'],['calm','Calm'],['warm','Warm'],['deep','Deep'],['gentle','Gentle'],['silent','Silent']]
        .map(([id,name])=>({id,name}));
      const state=()=>({selected:soundTest.selected,choices:[...choices,...(soundTest.custom ? [{id:'custom',name:'<b>my tone</b>'}] : [])],
        effectiveName:soundTest.silent ? 'Silent' : soundTest.selected,silent:soundTest.silent,enabled:soundTest.enabled});
      window.TingsNative={isNative:true,sounds:{
        status:async()=>state(),
        select:async id=>{soundTest.calls.push(['select',id]);if(soundTest.reject)throw new Error('Sound unavailable');soundTest.selected=id;return state();},
        preview:async id=>soundTest.calls.push(['preview',id || '']),stopPreview:async()=>soundTest.calls.push(['stop']),
        pick:async()=>{soundTest.calls.push(['pick']);return state();}, // Cancel leaves the stored choice intact.
        pickFile:async()=>{soundTest.custom=true;soundTest.selected='custom';return state();},
        openSettings:async()=>{soundTest.calls.push(['settings']);soundTest.silent=true;soundTest.enabled=false;}
      }};
      const panel=document.createElement('div');panel.id='native-reminder-controls';panel.append(nativeNotificationSoundControls());
      document.getElementById('settings-reminders-body').replaceChildren(panel);
      openSettingsSheet();
      document.getElementById('settings-reminders-body').hidden=false;
    });
    const host=page.locator('#native-notification-sounds'),select=host.locator('select');
    await page.waitForFunction(()=>!document.querySelector('#native-notification-sound').disabled);
    assert.deepEqual(await select.locator('option').allTextContents(),['Phone default','Calm','Warm','Deep','Gentle','Silent']);
    await select.selectOption('warm');
    await page.waitForFunction(()=>soundTest.selected==='warm' && !document.querySelector('#native-notification-sound').disabled);
    await host.getByRole('button',{name:'Preview',exact:true}).click();
    assert(await page.evaluate(()=>soundTest.calls.some(call=>call[0]==='preview')),'preview reaches the native notification stream');
    await host.getByRole('button',{name:'Stop preview',exact:true}).click();
    await page.evaluate(()=>soundTest.reject=true);
    await select.selectOption('deep');
    await page.waitForFunction(()=>!document.querySelector('#native-notification-sound').disabled);
    assert.equal(await select.inputValue(),'warm','failed sound selection restores the saved choice');
    await page.evaluate(()=>soundTest.reject=false);
    await host.getByRole('button',{name:'Choose phone sound',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('#native-notification-sound').disabled);
    assert.equal(await select.inputValue(),'warm','cancelling the native picker keeps the selected tone');
    await host.getByRole('button',{name:'Choose audio file',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#native-notification-sound').value==='custom' && !document.querySelector('#native-notification-sound').disabled);
    assert.equal(await select.locator('option[value="custom"]').textContent(),'<b>my tone</b>','file names are rendered as text');
    await host.getByRole('button',{name:'Android sound settings',exact:true}).click();
    await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(()=>document.querySelector('#native-notification-sounds [role="status"]').textContent.includes('Notifications are off'));
    assert(await host.getByRole('button',{name:'Preview',exact:true}).isDisabled(),'Android silent override is reflected after returning');
    assert.equal(await page.evaluate(()=>localStorage.getItem(NATIVE_REMINDERS_KEY)),before,'sound choices do not alter item reminder preferences');
    await page.evaluate(()=>{
      window.reconcileNativeReminders=async()=>{};
      window.showToast=()=>{};
      const base={emoji:'•',durationMinutes:30,priority:2,locationIds:[],anywhereAllowed:true,logs:[],active:true,hid:'read',name:'Read',type:'keepup',target:7};
      save(normalize([base]));
      const listed=()=>[
        {id:'default',name:'Phone default'},{id:'calm',name:'Calm'},{id:'warm',name:'Warm'},
        {id:'deep',name:'Deep'},{id:'gentle',name:'Gentle'},
        ...(soundTest.library?[{id:soundTest.library,name:'Kitchen'}]:[]),
        {id:'silent',name:'Silent'}
      ];
      const state=()=>({selected:soundTest.selected,choices:listed(),effectiveName:'Calm',silent:soundTest.silent,enabled:soundTest.enabled});
      TingsNative.sounds.status=async()=>state();
      TingsNative.sounds.preview=async id=>soundTest.calls.push(['preview',id||'']);
      TingsNative.sounds.addPick=async()=>{soundTest.calls.push(['addPick']);return state();};
      TingsNative.sounds.addFile=async()=>{
        soundTest.calls.push(['addFile']);
        soundTest.library='lib:kitchen01';
        return {...state(),savedId:'lib:kitchen01'};
      };
      const box=nativeItemReminderControls('item:read','Read');
      box.id='item-sound-test';
      document.body.append(box);
    });
    const itemSound=page.locator('#item-sound-test [data-reminder-sound]');
    await page.waitForFunction(()=>!document.querySelector('#item-sound-test [data-reminder-sound]').disabled);
    assert.match(await itemSound.locator('option').first().textContent(),/Use the default \(Calm\)/);
    await itemSound.selectOption('warm');
    await page.waitForFunction(()=>nativeReminderPreferences().items['item:read'].sound==='warm');
    assert.equal(await page.evaluate(()=>soundTest.selected),'custom','an item sound leaves the phone default alone');
    await page.evaluate(()=>document.querySelector('#item-sound-test .native-sound-actions .btn').click());
    assert.deepEqual(await page.evaluate(()=>soundTest.calls.filter(call=>call[0]==='preview').at(-1)),['preview','warm']);
    await page.evaluate(()=>[...document.querySelectorAll('#item-sound-test .mini-text-btn')].find(button=>button.textContent==='Choose phone sound').click());
    assert.equal(await page.evaluate(()=>nativeReminderPreferences().items['item:read'].sound),'warm','cancelling a per-item picker keeps that item’s sound');
    await page.evaluate(()=>[...document.querySelectorAll('#item-sound-test .mini-text-btn')].find(button=>button.textContent==='Choose audio file').click());
    await page.waitForFunction(()=>nativeReminderPreferences().items['item:read'].sound==='lib:kitchen01' && !document.querySelector('#item-sound-test [data-reminder-sound]').disabled);
    assert.equal(await page.evaluate(()=>soundTest.selected),'custom');
    assert.equal(await itemSound.locator('option[value="lib:kitchen01"]').textContent(),'Kitchen');
    await itemSound.selectOption('');
    await page.waitForFunction(()=>nativeReminderPreferences().items['item:read'].sound==null);
    const projection=await page.evaluate(()=>{
      const data=load(),base=dayStart(Date.now())+86400000;
      const week={days:[{dayBase:base,dayKey:dateKey(base),isToday:false,timeline:[{kind:'fill',h:data[0],i:0,start:base+10*3600000,end:base+10.5*3600000}]}]};
      const prefs=nativeReminderPreferences();
      prefs.enabled=true;
      prefs.items['item:read']={start:'notification',sound:'warm'};
      const sounded=nativeReminderEvents(week,data,loadSortSettings(),prefs,Date.now()).filter(event=>event.owner==='item:read');
      const plain=nativeReminderEvents(week,data,loadSortSettings(),{...prefs,items:{'item:read':{start:'notification'}}},Date.now()).filter(event=>event.owner==='item:read');
      return {count:sounded.length,sounds:sounded.map(event=>event.sound||''),plain:plain.map(event=>event.sound||'')};
    });
    assert(projection.count>0,'a chosen sound is attached to that item’s reminders');
    assert.deepEqual(projection.sounds,Array(projection.count).fill('warm'));
    assert.deepEqual(projection.plain,Array(projection.count).fill(''),'items without a sound keep the phone default');
    await page.evaluate(()=>{
      TingsNative.platform='ios';
      delete TingsNative.sounds.addPick;
      delete TingsNative.sounds.addFile;
      delete TingsNative.sounds.openSettings;
      TingsNative.sounds.status=async()=>({
        selected:'default',effectiveName:'Phone default',silent:false,
        choices:[{id:'default',name:'Phone default'},{id:'warm',name:'Warm'}]
      });
      const box=nativeItemReminderControls('item:read','Read');
      box.id='ios-item-sound-test';
      document.body.append(box);
    });
    const iosSound=page.locator('#ios-item-sound-test .native-reminder-sound');
    const iosPreview=iosSound.getByRole('button',{name:'Preview',exact:true});
    await iosSound.getByRole('combobox').locator('option[value="warm"]').waitFor({state:'attached'});
    assert.equal(await iosSound.locator('.settings-actions').count(),0,'iOS has no Android-only picker or settings buttons');
    assert.equal(await iosPreview.isDisabled(),true,'iOS does not substitute another preview for the system sound');
    await iosSound.getByRole('combobox').selectOption('warm');
    await page.waitForFunction(()=>!document.querySelector('#ios-item-sound-test .native-sound-actions button').disabled);
    await iosPreview.evaluate(button=>button.click());
    assert.deepEqual(await page.evaluate(()=>soundTest.calls.filter(call=>call[0]==='preview').at(-1)),['preview','warm']);
    const day='2026-11-20';
    await page.evaluate(day=>{
      const box=nativeItemReminderControls('item:read','Read',{dayKey:day});
      box.id='dated-item-sound-test';
      document.body.append(box);
    },day);
    const datedSound=page.locator('#dated-item-sound-test [data-reminder-sound]');
    await datedSound.locator('option[value="default"]').waitFor({state:'attached'});
    assert.match(await datedSound.locator('option').first().textContent(),/Use the default \(Warm\)/);
    await datedSound.selectOption('default');
    await page.waitForFunction(day=>nativeReminderPreferences().items['item:read'].dates?.[day]?.sound==='default',day);
    assert.equal(await page.evaluate(()=>nativeReminderPreferences().items['item:read'].sound),'warm','the date selection leaves the item sound intact');
    await datedSound.selectOption('');
    await page.waitForFunction(day=>nativeReminderPreferences().items['item:read'].dates?.[day]?.sound==null,day);
    assert.equal(await page.evaluate(day=>nativeReminderChoices(nativeReminderPreferences(),'item:read',day).sound,day),'warm');
    await host.screenshot({path:'test-results/native-notification-sounds.png'});
    assert.deepEqual(errors,[]);
    console.log('PASS: native-only sound choices, preview, rollback, picker cancellation, safe file labels, Android overrides, and per-item sounds');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
