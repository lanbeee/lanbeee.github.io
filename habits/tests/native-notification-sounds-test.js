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
        preview:async()=>soundTest.calls.push(['preview']),stopPreview:async()=>soundTest.calls.push(['stop']),
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
    await host.screenshot({path:'test-results/native-notification-sounds.png'});
    assert.deepEqual(errors,[]);
    console.log('PASS: native-only sound choices, preview, rollback, picker cancellation, safe file labels and Android overrides');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
