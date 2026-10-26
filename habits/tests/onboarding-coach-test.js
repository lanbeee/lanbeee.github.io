// Refined essentials + full-mode advanced coach smoke test.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/onboarding-coach-test.js
const { chromium } = require('playwright');

const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
const coachUrl = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'planner=fast';
const habitName = `Coach reading ${Date.now()}`;

function assert(condition,message){
  if(!condition)throw new Error(message);
  console.log('  ok: ' + message);
}

async function stage(page,name,timeout = 4000){
  await page.waitForSelector(`#tings-coach[data-coach-stage="${name}"]`,{timeout});
}

async function tapCalDay(page,kind){
  await page.evaluate(which=>{
    const selector = which === 'future'
      ? '#overview-calendar .cal-day.pickable.future'
      : '#overview-calendar .cal-day.pickable:not(.today):not(.future)';
    const day = document.querySelector(selector);
    if(!day)return;
    const box = day.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const opts = {bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:1,pointerType:'touch'};
    day.dispatchEvent(new PointerEvent('pointerdown',opts));
    day.dispatchEvent(new PointerEvent('pointerup',opts));
    day.click();
  },kind);
}

// Same tap, but the closing click goes to whatever node now sits under the
// finger: the app's own reaction to the pointer events can re-render the
// calendar and detach the tapped cell before the click dispatch.
async function tapLiveCalDay(page,kind){
  await page.evaluate(which=>{
    const selector = which === 'future'
      ? '#overview-calendar .cal-day.pickable.future'
      : '#overview-calendar .cal-day.pickable:not(.today):not(.future)';
    const day = document.querySelector(selector);
    if(!day)return;
    const box = day.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const opts = {bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:1,pointerType:'touch'};
    day.dispatchEvent(new PointerEvent('pointerdown',opts));
    day.dispatchEvent(new PointerEvent('pointerup',opts));
    const hit = document.elementFromPoint(x,y);
    (hit?.closest('.cal-day.pickable') || document.querySelector(selector))?.click();
  },kind);
}

async function tapInPage(page,selector){
  await page.evaluate(sel=>{
    const el = document.querySelector(sel);
    if(el)el.click();
  },selector);
}

async function primary(page,current,next){
  await stage(page,current);
  await page.locator('[data-coach-primary]').click();
  if(next)await stage(page,next);
}

// A real DOM click on an in-sheet control: the app's own handler and the
// coach's document listener both fire, without Playwright's hit-test racing
// the spotlight geometry while the detail pager is still settling.
async function tapTarget(page,selector){
  await page.evaluate(sel=>{
    const el = document.querySelector(sel);
    if(el)el.click();
  },selector);
}

// Tours show a bar, never a visible "3 of 21" count; position lives only in
// the progressbar aria attributes.
async function progressBar(page){
  return page.evaluate(()=>{
    const bar = document.querySelector('.tings-coach-progress');
    return {
      role:bar?.getAttribute('role'),
      now:Number(bar?.getAttribute('aria-valuenow')),
      max:Number(bar?.getAttribute('aria-valuemax')),
      fill:Number((bar?.querySelector('i')?.style.width || '0%').replace('%','')),
      headText:(document.querySelector('.tings-coach-head')?.textContent || '').trim()
    };
  });
}

// Check real hit targets and the full field/footer geometry, not just CSS sizes.
async function checkAddLayout(page,selector,label){
  await page.waitForTimeout(250);
  const layout = await page.evaluate(sel=>{
    const target = document.querySelector(sel);
    const field = target.getBoundingClientRect();
    const bubble = document.querySelector('.tings-coach-bubble').getBoundingClientRect();
    const content = document.querySelector('.add-content').getBoundingClientRect();
    const footer = document.querySelector('.add-actions').getBoundingClientRect();
    const nativeResized=window.TingsNative?.isNative && window.TingsNative.platform === 'android';
    const viewport = nativeResized ? {offsetTop:0,height:document.documentElement.clientHeight} : window.visualViewport;
    const top = viewport?.offsetTop || 0;
    const bottom = top + (viewport?.height || innerHeight);
    const hit = document.elementFromPoint(field.left + field.width / 2,field.top + field.height / 2);
    return {typing:document.getElementById('tings-coach').dataset.typing,bubbleHeight:bubble.height,clear:!rectOverlap(field,bubble),hit:hit === target || target.contains(hit),inside:field.top >= Math.max(top,content.top) - 1 && field.bottom <= Math.min(bottom,sel === '#do-save' ? bottom : content.bottom) + 1,footerClear:footer.bottom <= bubble.top - 4,bubbleInside:bubble.top >= top && bubble.bottom <= bottom,rail:document.getElementById('tings-coach').dataset.addRail};
    function rectOverlap(a,b){return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;}
  },selector);
  if(label.includes('keyboard'))assert(layout.typing === 'true' && layout.bubbleHeight <= 130,`${label}: typing collapses the coach to at most 130px`);
  assert(layout.rail === 'true' && layout.clear && layout.hit && layout.inside && layout.footerClear && layout.bubbleInside,`${label}: field and Add footer stay visible and tappable above the coach rail (${JSON.stringify(layout)})`);
}

async function phoneQuickStart(browser,width,height,task,minimal = false){
  const page = await browser.newPage({viewport:{width,height},isMobile:true,hasTouch:true});
  await page.addInitScript(minimal=>{
    window.Capacitor={isNativePlatform:()=>true};
    localStorage.setItem('tings_app_settings_v2',JSON.stringify({minimalMode:minimal}));
  },minimal);
  await page.goto(coachUrl,{waitUntil:'load'});
  await primary(page,'eIntro','eAdd');
  await page.locator('#open-add').click();
  await stage(page,'eName');
  await checkAddLayout(page,'#ting-message',`${width}×${height} name`);
  await page.setViewportSize({width,height:360});
  await checkAddLayout(page,'#ting-message',`${width}×360 keyboard`);
  await page.locator('#ting-message').fill(task ? 'Quick start task' : 'Quick start habit');
  await page.setViewportSize({width,height});
  await primary(page,'eName','eKind');
  await checkAddLayout(page,'#type-seg',`${width}×${height} kind`);
  await page.locator(`#type-seg [data-v="${task ? 'task' : 'keepup'}"]`).click();
  await stage(page,task ? 'eTask' : 'eRhythm');
  await checkAddLayout(page,task ? '#ting-due-date' : '#add-frequency',`${width}×${height} ${task ? 'deadline' : 'rhythm'}`);
  if(task)await page.locator('#ting-due-date').fill('2026-10-20');
  else{
    await page.locator('[data-add-rhythm="3,7"]').click();
    if(minimal)assert(!(await page.locator('[data-add-repeat="opportunity"]').isVisible()),'minimal Quick start hides when conditions fit');
    if(width === 393)assert(await page.locator('#add-frequency .add-presets').evaluate(row=>{
      const boxes=[...row.children].filter(button=>!button.hidden).map(button=>button.getBoundingClientRect());
      return boxes.every(box=>Math.abs(box.top-boxes[0].top)<1 && box.height>=44);
    }),`393px Quick start keeps every frequency choice on one line, minimal=${minimal}`);
  }
  await page.screenshot({path:`test-results/quick-start-${width}-${task ? 'task' : 'habit'}.png`});
  await primary(page,task ? 'eTask' : 'eRhythm','eSave');
  await checkAddLayout(page,'#do-save',`${width}×${height} save`);
  await page.locator('#do-save').click();
  await stage(page,'eDetailEffort');
  assert(await page.locator('#add-sheet .add-sheet[data-coach-space]').count() === 0,'leaving the form removes coach layout space');
  await primary(page,'eDetailEffort','eHomeCard');
  await primary(page,'eHomeCard','eLog');
  await page.locator('[data-coach-later]').click();
  await primary(page,'eHomeGroups','eCalendar');
  await page.locator('#open-overview').click();
  await primary(page,'eOverview','eAbout');
  await page.locator('#open-about').click();
  await stage(page,'eMinimal');
  await page.locator('[data-coach-primary]').click();
  assert(await page.evaluate(minimal=>isMinimalMode() === minimal && load().length === 1,minimal),`${width}×${height} ${task ? 'task' : 'habit'} path finishes with one item and preserves mode=${minimal}`);
  const saved = await page.evaluate(()=>({item:load()[0],due:dateKey(load()[0].dueDate),done:localStorage.getItem('tings_coach_essentials_v2')}));
  assert(saved.done === 'done' && saved.item.type === (task ? 'task' : 'keepup') && (task ? saved.due === '2026-10-20' : saved.item.target === 7/3),'Quick start saves the selected type and frequency or deadline, and remembers completion');
  await page.close();
}

async function overlayKeyboardQuickStart(browser,width,height){
  const page = await browser.newPage({viewport:{width,height},isMobile:true,hasTouch:true});
  await page.addInitScript(({width,height})=>{
    localStorage.setItem('tings_coach_install_v2','done');
    const viewport = new EventTarget();
    Object.assign(viewport,{height,width,offsetTop:0,offsetLeft:0,scale:1});
    Object.defineProperty(window,'visualViewport',{value:viewport,configurable:true});
  },{width,height});
  await page.goto(coachUrl,{waitUntil:'load'});
  await primary(page,'eIntro','eAdd');
  await page.locator('#open-add').click();
  await stage(page,'eName');
  await page.locator('#ting-message').fill('Keyboard habit');
  for(const visible of [400,320,280]){
    await page.evaluate(h=>{visualViewport.height=h;visualViewport.dispatchEvent(new Event('resize'));},visible);
    await checkAddLayout(page,'#ting-message',`${width}×${visible} overlay keyboard name`);
  }
  await page.screenshot({path:`test-results/quick-start-${width}-keyboard.png`});
  await primary(page,'eName','eKind');
  assert(await page.evaluate(()=>document.activeElement.id !== 'ting-message'),'Continue dismisses the name keyboard');
  await page.evaluate(h=>{visualViewport.height=h;visualViewport.dispatchEvent(new Event('resize'));},height);
  await page.locator('#type-seg [data-v="keepup"]').click();
  await stage(page,'eRhythm');
  await page.locator('#ting-times').fill('3');
  await page.evaluate(()=>{visualViewport.height=300;visualViewport.dispatchEvent(new Event('resize'));});
  await checkAddLayout(page,'#target-slider-row',`${width}×300 overlay keyboard frequency`);
  await primary(page,'eRhythm','eSave');
  assert(await page.evaluate(()=>document.activeElement.id !== 'ting-times'),'Continue dismisses the frequency keyboard before Add');
  await page.evaluate(()=>window.TingsCoach.stop());
  assert(await page.locator('#add-sheet .add-sheet[data-coach-space]').count() === 0,'ending Quick start while adding removes its reserved space');
  await page.close();
}

async function conditionalQuickStart(browser,minimal,choice){
  const page = await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({minimal,choice})=>{
    localStorage.setItem('tings_coach_install_v2','done');
    localStorage.setItem('tings_app_settings_v2',JSON.stringify({minimalMode:minimal,
      locations:choice === 'new-place' ? [] : [{id:'park',name:'Park',lat:40,lng:-74}],
      weatherProfiles:choice === 'new-weather' ? [] : [{id:'dry',name:'Dry',rules:[{metric:'precipitation_probability',max:30}]}]
    }));
    if(choice === 'new-weather'){
      const viewport=new EventTarget();
      Object.assign(viewport,{height:852,width:393,offsetTop:0,offsetLeft:0,scale:1});
      Object.defineProperty(window,'visualViewport',{value:viewport,configurable:true});
    }
  },{minimal,choice});
  await page.goto(coachUrl,{waitUntil:'load'});
  await primary(page,'eIntro','eAdd');
  await page.locator('#open-add').click();
  await stage(page,'eName');
  await page.locator('#ting-message').fill('Conditional walk');
  await primary(page,'eName','eKind');
  await page.locator('#type-seg [data-v="keepup"]').click();
  await stage(page,'eRhythm');
  await page.locator('[data-add-repeat="opportunity"]').click();
  await primary(page,'eRhythm','eConditions');
  assert(await page.locator('[data-coach-primary]').isDisabled(),'conditional Quick start waits for a place or weather rule');
  if(choice === 'place' || choice === 'new-place')await page.locator('#ting-condition-trigger').selectOption('location');
  if(choice === 'new-place'){
    await page.locator('#ting-tag-chips [data-location-add]').click();
    await page.waitForFunction(()=>document.querySelector('#tings-coach-title')?.textContent === 'Add a place');
    await page.locator('#picker-name').fill('Park');
    await checkConditionalKeyboard(page,'#picker-name',false);
    await page.locator('.picker-coords-details > summary').click();
    await page.locator('#picker-lat').fill('40');
    await checkConditionalKeyboard(page,'#picker-lat',false);
    await page.locator('#picker-lng').fill('-74');
    await checkConditionalKeyboard(page,'#picker-lng',false);
    await page.locator('#picker-apply-coords').click();
    await page.locator('[data-coach-primary]').click();
    await page.waitForSelector('#location-picker-sheet.open',{state:'hidden'});
    assert(await page.locator('#ting-message').inputValue() === 'Conditional walk','adding a place inside Quick start preserves the habit draft');
  }else if(choice === 'new-weather'){
    await page.locator('#ting-weather-profiles').click();
    await page.waitForFunction(()=>document.querySelector('#tings-coach-title')?.textContent === 'Set up your conditions');
    await page.locator('#weather-profile-add').click();
    await page.locator('[data-weather-profile-name]').fill('Dry');
    await checkConditionalKeyboard(page,'[data-weather-profile-name]',true);
    await page.locator('[data-weather-profile-name]').blur();
    await page.locator('[data-weather-rule-metric]').selectOption('precipitation_probability');
    await page.locator('[data-weather-rule-max]').fill('30');
    await checkConditionalKeyboard(page,'[data-weather-rule-max]',true);
    await page.locator('[data-weather-rule-max]').blur();
    await page.locator('[data-coach-primary]').click();
    await page.waitForSelector('#add-sheet.open');
    const profileId = await page.evaluate(()=>loadSortSettings().weatherProfiles[0].id);
    await page.locator('#ting-weather-profile').selectOption(profileId);
    assert(await page.locator('#ting-message').inputValue() === 'Conditional walk','weather setup inside Quick start preserves the habit draft');
  }else if(choice === 'place')await page.locator('#ting-tag-chips [data-location-id="park"]').click();
  else await page.locator('#ting-weather-profile').selectOption('dry');
  await page.locator('[data-coach-primary]').waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('[data-coach-primary]').disabled);
  await page.screenshot({path:`test-results/quick-start-conditions-${minimal ? 'minimal' : 'regular'}-${choice}.png`});
  await primary(page,'eConditions','eSave');
  await checkAddLayout(page,'#do-save',`393px conditional ${choice} save`);
  await page.locator('[data-coach-back]').click();
  await stage(page,'eConditions');
  assert(await page.locator('[data-coach-primary]').isEnabled(),'Back from Add returns to editable conditions');
  await primary(page,'eConditions','eSave');
  await page.locator('#do-save').click();
  await stage(page,'eDetailEffort');
  assert(await page.evaluate(()=>load().length === 1 && load()[0].repeatMode === 'opportunity'),'conditional Quick start saves one valid conditional habit');
  assert(errors.length === 0,'conditional Quick start has no page errors');
  await page.evaluate(()=>window.TingsCoach.stop());
  await page.close();
}

async function checkConditionalKeyboard(page,selector,overlay){
  await page.locator(selector).focus();
  for(const height of (overlay ? [400,320,280] : [360])){
    if(overlay)await page.evaluate(height=>{visualViewport.height=height;visualViewport.offsetTop=20;visualViewport.dispatchEvent(new Event('resize'));},height);
    else await page.setViewportSize({width:393,height});
    await page.waitForTimeout(250);
    const layout = await page.locator(selector).evaluate(field=>{
      const rect=field.getBoundingClientRect();
      const bubble=document.querySelector('.tings-coach-bubble').getBoundingClientRect();
      const sheet=field.closest('.sheet').getBoundingClientRect();
      const top=visualViewport?.offsetTop || 0;
      const bottom=top+(visualViewport?.height || innerHeight);
      const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
      return {inside:rect.top>=Math.max(top,sheet.top)-1 && rect.bottom<=Math.min(bottom,sheet.bottom)+1,
        clear:rect.bottom<=bubble.top,hit:hit===field || field.contains(hit),
        compact:document.querySelector('#tings-coach').dataset.typing === 'true' && bubble.height<=130};
    });
    assert(layout.inside && layout.clear && layout.hit && layout.compact,`${selector}: ${overlay ? 'overlay' : 'resized'} keyboard at ${height}px keeps the active field visible and tappable (${JSON.stringify(layout)})`);
  }
  if(overlay)await page.evaluate(()=>{visualViewport.height=852;visualViewport.offsetTop=0;visualViewport.dispatchEvent(new Event('resize'));});
  else await page.setViewportSize({width:393,height:852});
  await page.locator(selector).blur();
}

async function nativeKeyboardQuickStart(browser){
  const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await page.addInitScript(()=>{
    window.Capacitor={isNativePlatform:()=>true};
    const viewport=new EventTarget();
    Object.assign(viewport,{height:844,width:390,offsetTop:0,offsetLeft:0,scale:1});
    Object.defineProperty(window,'visualViewport',{value:viewport,configurable:true});
  });
  await page.goto(coachUrl,{waitUntil:'load'});
  await primary(page,'eIntro','eAdd');
  await page.locator('#open-add').click();
  await stage(page,'eName');
  await page.locator('#ting-message').fill('Native keyboard habit');
  await page.setViewportSize({width:390,height:420});
  await page.evaluate(()=>{
    window.TingsNative={isNative:true,platform:'android'};
    visualViewport.height=160;
    visualViewport.offsetTop=25;
    updateKeyboardLift();
    visualViewport.dispatchEvent(new Event('resize'));
  });
  await checkAddLayout(page,'#ting-message','Android staggered keyboard viewport');
  assert(await page.locator('.tings-coach-bubble').evaluate(el=>el.getBoundingClientRect().bottom > 390),'native coach follows the resized WebView without subtracting the keyboard twice');
  await page.evaluate(()=>window.TingsCoach.stop());
  await page.close();
}

(async()=>{
  const browser = await chromium.launch({headless:true});
  const nativePage = await browser.newPage({viewport:{width:390,height:844}});
  await nativePage.addInitScript(()=>{window.Capacitor={isNativePlatform:()=>true};});
  await nativePage.goto(coachUrl,{waitUntil:'load'});
  await stage(nativePage,'eIntro',3500);
  assert(await nativePage.locator('#open-install-guide').isHidden(),'fresh Android launches hide the install guide and offer quick start');
  await nativePage.evaluate(async()=>{window.TingsCoach.stop();await startTingsCoach('install',{force:true});});
  await stage(nativePage,'eIntro');
  assert(true,'explicit install-tour requests on Android also open quick start');
  await nativePage.close();
  await nativeKeyboardQuickStart(browser);
  await overlayKeyboardQuickStart(browser,320,568);
  await overlayKeyboardQuickStart(browser,390,844);
  await phoneQuickStart(browser,320,568,false);
  await phoneQuickStart(browser,360,640,true);
  await phoneQuickStart(browser,390,844,false);
  for(const minimal of [false,true]){
    await phoneQuickStart(browser,393,852,false,minimal);
    await phoneQuickStart(browser,393,852,true,minimal);
  }
  await conditionalQuickStart(browser,false,'place');
  await conditionalQuickStart(browser,false,'weather');
  await conditionalQuickStart(browser,false,'new-place');
  await conditionalQuickStart(browser,false,'new-weather');
  const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors = [];
  page.on('pageerror',error=>errors.push(error.message));

  await page.goto(coachUrl,{waitUntil:'load'});
  await page.evaluate(()=>localStorage.clear());
  await page.reload({waitUntil:'load'});

  assert(await page.locator('script[data-tings-coach]').count() === 0,'coach assets stay lazy before the first-run offer');
  await stage(page,'iSteps',3500);
  assert(await page.locator('link[data-tings-coach]').count() === 1,'first-run coach loads its stylesheet on demand');
  const installBar = await progressBar(page);
  assert(installBar.role === 'progressbar' && installBar.now === 1 && installBar.max === 2,'a first-run browser user gets the install guide first');
  assert(!/\d/.test(installBar.headText),'the coach head shows a progress bar, never a step count');
  assert(await page.locator('.tings-step-glyph i').count() === 3,'install guidance shows numbered icon tiles');
  const stepNums = await page.locator('.tings-step-num').allTextContents();
  assert(stepNums.length === 3 && stepNums[0] === '1' && stepNums[2] === '3','install steps are numbered in order');
  await primary(page,'iSteps','iNext');
  assert((await page.locator('.tings-coach-title').textContent()) === 'Close this tab','after install, the guide tells the user to leave the browser tab');
  assert(await page.locator('.tings-coach-handoff').count() === 1,'the leave-the-browser step shows a close-tab vs open-app visual');
  assert((await page.locator('.tings-handoff-pane.is-leave figcaption strong').textContent()) === 'Close this tab','the leave pane is labeled Close this tab');
  assert((await page.locator('.tings-handoff-pane.is-open figcaption strong').textContent()) === 'Open Tings','the open pane is labeled Open Tings');
  assert((await page.locator('[data-coach-primary]').textContent()) === 'Got it','the main action confirms leaving the browser tab');
  assert((await page.locator('[data-coach-later]').textContent()) === 'Stay in this tab','staying in the browser is the secondary path');
  await page.locator('[data-coach-later]').click();
  await stage(page,'eIntro');
  const essentialsBar = await progressBar(page);
  assert(essentialsBar.now === 1 && essentialsBar.max === 14,'staying in the tab chains into the full essentials tour');

  await primary(page,'eIntro','eAdd');
  assert(await page.locator('#tings-coach').getAttribute('data-locked') === 'true','required action steps lock interaction to the highlighted target');
  await page.locator('#open-add').click();
  await stage(page,'eName');
  await page.setViewportSize({width:390,height:480});
  await page.waitForTimeout(150);
  const keyboardLayout = await page.evaluate(()=>{
    const bubble = document.querySelector('.tings-coach-bubble').getBoundingClientRect();
    const input = document.getElementById('ting-message').getBoundingClientRect();
    const kind = document.getElementById('type-seg').getBoundingClientRect();
    const atKind = document.elementFromPoint(kind.left + kind.width / 2,kind.top + kind.height / 2);
    const overlap = !(bubble.right <= input.left || bubble.left >= input.right || bubble.bottom <= input.top || bubble.top >= input.bottom);
    return {bubbleBottom:bubble.bottom,viewport:window.visualViewport?.height || window.innerHeight,overlap,guarded:!atKind || Boolean(atKind.closest('#tings-coach'))};
  });
  assert(keyboardLayout.bubbleBottom <= keyboardLayout.viewport + 1 && !keyboardLayout.overlap,'name guidance stays inside a keyboard-sized visual viewport without covering the input');
  assert(keyboardLayout.guarded,'controls outside the name step are shielded from accidental taps');
  await page.setViewportSize({width:390,height:844});

  await page.locator('#ting-message').fill(habitName);
  await primary(page,'eName','eKind');
  await page.evaluate(()=>cancelAdd());
  await stage(page,'eAdd');
  assert(true,'coach recovers to the correct step when the add sheet closes unexpectedly');

  await page.locator('#open-add').click();
  await stage(page,'eName');
  await page.locator('#ting-message').fill(habitName);
  await primary(page,'eName','eKind');
  await page.locator('#type-seg [data-v="task"]').click();
  await stage(page,'eTask');
  assert(await page.locator('#task-due-row').isVisible(),'task branch teaches optional due dates and fixed times');
  await page.locator('[data-coach-back]').click();
  await stage(page,'eKind');
  await page.locator('#type-seg [data-v="keepup"]').click();
  await stage(page,'eRhythm');
  await page.locator('#ting-times').fill('3');
  await page.locator('#ting-days').fill('7');
  await primary(page,'eRhythm','eSave');
  await page.locator('#do-save').click();
  await stage(page,'eDetailEffort',5000);
  assert(await page.locator('#detail-sheet').evaluate(el=>el.classList.contains('open')),'coach follows the saved Ting into its real detail screen');

  await primary(page,'eDetailEffort','eHomeCard');
  await primary(page,'eHomeCard','eLog');
  assert(await page.locator('#tings-coach').getAttribute('data-locked') === 'true','logging practice is a required action');
  await page.locator('[data-coach-later]').click();
  await stage(page,'eHomeGroups');
  await page.locator('[data-coach-back]').click();
  await stage(page,'eLog');
  await page.locator('.ting-card [data-pulse]').first().click();
  await stage(page,'eHomeGroups');
  assert(true,'logging practice advances via the real pulse button');

  const guardedNav = await page.evaluate(()=>{
    const btn = document.getElementById('open-add').getBoundingClientRect();
    const hit = document.elementFromPoint(btn.left + btn.width / 2,btn.top + btn.height / 2);
    return Boolean(hit?.closest('[data-coach-guard]'));
  });
  assert(guardedNav,'guided steps shield navigation controls outside the spotlight');
  await page.evaluate(()=>document.getElementById('open-add').click());
  await page.waitForTimeout(300);
  assert(await page.locator('#add-sheet.open').count() === 0,'the coach closes any sheet the current step did not ask for');

  await primary(page,'eHomeGroups','eCalendar');
  await page.locator('#open-overview').click();
  await stage(page,'eOverview');
  await primary(page,'eOverview','eAbout');
  await tapInPage(page,'#open-about');
  await stage(page,'eMinimal');
  assert(await page.locator('#settings-sheet.open').count() === 1,'Quick start opens the real Settings page');
  assert(/overwhelmed.*Minimal mode.*Tings → Settings → Display/.test(await page.locator('#tings-coach-copy').textContent()),'Quick start explains Minimal mode and how to find it again');
  const minimalToggle = page.locator('[data-setting-toggle="minimalMode"]');
  assert(await minimalToggle.isVisible(),'Minimal mode is revealed in Display');
  await minimalToggle.click();
  assert(await page.evaluate(()=>isMinimalMode()),'Minimal mode is optional and can be enabled during Quick start');
  await page.locator('[data-coach-back]').click();
  await stage(page,'eAbout');
  await page.locator('#open-about').click();
  await stage(page,'eMinimal');
  await page.locator('[data-coach-primary]').click();
  assert(await page.locator('#tings-coach').count() === 0,'finishing Quick start removes the coach');
  const essentialState = await page.evaluate(name=>{
    const data = JSON.parse(localStorage.getItem('tings_v2') || '[]');
    const item = data.find(h=>h.name === name);
    return {marker:localStorage.getItem('tings_coach_essentials_v2'),target:item?.target,type:item?.type,logs:item?.logs?.length || 0,count:data.length};
  },habitName);
  assert(essentialState.marker === 'done' && essentialState.target === 7 / 3 && essentialState.type === 'keepup','Quick start preserves the chosen rhythm and remembers completion');
  assert(essentialState.logs >= 1,'logging practice recorded a real log entry');
  assert(essentialState.count === 1,'Quick start only requires one item, without a second task or sample');

  // Advanced coach: a chapter menu, not a serial march. Each chapter runs
  // standalone, checks itself off, and lands back on the menu. Minimal mode
  // is opt-in now, so turn it on first — that is what puts the full-mode
  // reveal chapter in front of these chapters.
  await page.evaluate(()=>updateSortSetting({minimalMode:true},{renderNow:false}));
  await page.evaluate(()=>window.startTingsCoach('advanced',{force:true}));
  await stage(page,'aIntro');
  assert(await page.locator('[data-coach-chapter]').count() === 7,'the advanced coach offers seven focused chapters');
  assert(await page.locator('[data-coach-chapter].is-next').count() === 1,'the first unfinished chapter is gently recommended');
  assert(/temporary demo/i.test(await page.locator('.tings-coach-note').textContent()),'the menu explains that coach demo data is temporary');
  assert(await page.locator('.tings-coach-chapter.is-done').count() === 0,'no chapter claims done before it is taken');

  await page.locator('[data-coach-chapter="home"]').click();
  await stage(page,'aFullMode');
  await page.locator('[data-setting-toggle="minimalMode"]').click();
  await stage(page,'aHome');
  assert(await page.evaluate(()=>JSON.parse(localStorage.getItem('tings_app_settings_v2') || '{}').minimalMode === false),'advanced coach teaches and enables full mode');
  await primary(page,'aHome','aActions');
  assert(/do it now/i.test(await page.locator('#tings-coach-copy').textContent()),'card actions teach drag-to-top doing now alongside swipe and audit');
  await primary(page,'aActions','aMissed');
  // Demo state always seeds a missed pill and open-time pill, so these steps
  // are always locked and always require the real controls.
  // Wait for the dropped pill to appear (demo render may be async).
  await page.waitForSelector('.dropped-pill', {timeout: 5000});
  assert(await page.locator('#tings-coach[data-coach-stage="aMissed"]').getAttribute('data-locked') === 'true','the missed step is always locked to the dropped pill (demo state guarantees it)');
  await tapTarget(page,'.dropped-pill');
  await stage(page,'aMissedList',5000);
  assert(await page.locator('#slipped-sheet.open').count() === 1,'tapping the missed count opens the real missed list');
  await primary(page,'aMissedList','aOpenTime');
  // Closing the slipped sheet can re-render Home, so the free pill and the
  // coach's lock re-mount on the next observer cycle — wait for the lock
  // instead of reading it in the same frame as the stage flip.
  await page.waitForFunction(()=>document.querySelector('#tings-coach[data-coach-stage="aOpenTime"]')?.dataset.locked === 'true',null,{timeout:5000});
  assert(await page.locator('#tings-coach[data-coach-stage="aOpenTime"]').getAttribute('data-locked') === 'true','the open-time step is always locked to the free pill (demo state guarantees it)');
  await tapTarget(page,'.free-pill');
  await page.waitForSelector('#free-time-sheet.open',{timeout:5000});
  await stage(page,'aOpenStrip',5000);
  assert(await page.locator('#free-time-sheet.open').count() === 1,'tapping the open-time count opens the real day strip');
  await primary(page,'aOpenStrip','aIntro');
  assert(await page.locator('[data-coach-chapter="home"].is-done').count() === 1,'finishing a chapter checks it off on the menu');

  // Schedule chapter: general Allowed and Preferred rules are distinguished
  // from specific time-and-place alternatives.
  await page.locator('[data-coach-chapter="schedule"]').click();
  await stage(page,'aDetailRead');
  assert(await page.locator('#detail-sheet.open').count() === 1,'starting the schedule chapter opens a real detail page');
  await page.locator('.detail-page-tab[aria-label="schedule"]').click();
  await stage(page,'aSchedule');
  assert(/general schedule/i.test(await page.locator('.tings-coach-title').textContent()),'the schedule starts by naming the general Allowed rule');
  await tapTarget(page,'#detail-weekday-chips .schedule-chip');
  await stage(page,'aSchedulePreferences');
  await tapTarget(page,'#detail-schedule-view-seg [data-schedule-view="preferred"]');
  await stage(page,'aGeneralSchedule');
  assert(/every general place/i.test(await page.locator('#tings-coach-copy').textContent()),'the general time window is explained as applying at every general place');
  await primary(page,'aGeneralSchedule','aScheduleOrder');
  await primary(page,'aScheduleOrder','aTimesPlaces');
  await stage(page,'aTimesPlaces');
  assert(/specific time & place/i.test(await page.locator('.tings-coach-title').textContent()),'specific times and places get their own hands-on step');
  await tapTarget(page,'#detail-habit-option-add');
  await stage(page,'aOptionRow');
  assert(await page.locator('#detail-habit-option-list .habit-option-row').count() === 1,'add option builds a real specific time-and-place row');
  assert(/alternatives/i.test(await page.locator('.tings-coach-title').textContent()),'the option row teaches the alternatives rule');
  await tapTarget(page,'.habit-option-row .time-mode-toggle [data-time-mode="relative"]');
  await stage(page,'aTaskRules');
  assert(/deadline/.test(await page.locator('#tings-coach-copy').textContent()),'task dates and fixed times are distinguished');
  await primary(page,'aTaskRules','aIntro');
  assert(await page.locator('[data-coach-chapter="schedule"].is-done').count() === 1,'the schedule chapter checks off');

  // Progress & item tools: history, plans, effort, logging controls, identity,
  // and the full Actions toolbox are taught on the real detail page.
  await page.locator('[data-coach-chapter="progress"]').click();
  await stage(page,'aProgressHistory');
  await tapTarget(page,'[data-detail-viz="gaps"]');
  await stage(page,'aHistoryPlans');
  assert(/Plan by/.test(await page.locator('#tings-coach-copy').textContent()),'history teaches plans and plan-by alongside activity');
  await primary(page,'aHistoryPlans','aEffort');
  await stage(page,'aEffort');
  await tapTarget(page,'#detail-breakable');
  await stage(page,'aEffortTools');
  assert(/Value tracking/.test(await page.locator('#tings-coach-copy').textContent()),'effort tools teach values, notes, auto mark, and timers');
  await primary(page,'aEffortTools','aIdentity');
  await stage(page,'aIdentity');
  await tapTarget(page,'#detail-emoji-preview');
  await stage(page,'aLifecycle');
  assert(/link buttons/.test(await page.locator('#tings-coach-copy').textContent()),'actions step teaches explicit link buttons');
  await tapTarget(page,'#detail-pinned');
  await stage(page,'aIntro');
  assert(await page.locator('[data-coach-chapter="progress"].is-done').count() === 1,'tapping pin completes the progress chapter');
  assert(await page.locator('#detail-sheet.open').count() === 0,'the chapter menu closes the detail page again');

  // Plan chapter: demo state ensures >10 habits so search is always a real
  // locked step — no manual injection needed.
  await page.locator('[data-coach-chapter="plan"]').click();
  await stage(page,'aSearch');
  assert(await page.locator('#tings-coach[data-coach-stage="aSearch"]').getAttribute('data-locked') === 'true','demo state guarantees enough habits for search to be a locked step');
  await page.locator('#open-search').click();
  await stage(page,'aSearchTools');
  assert(/keyboard, \/ jumps/i.test(await page.locator('#tings-coach-copy').textContent()),'search teaches its keyboard shortcut and filters');
  await primary(page,'aSearchTools','aCalendar');
  await stage(page,'aCalendar');
  await page.locator('#open-overview').click();
  await stage(page,'aOverview');
  await tapLiveCalDay(page,'future');
  await stage(page,'aOverviewDay');
  assert(await page.locator('#day-logs-sheet.open').count() === 1,'the calendar chapter pauses on the real day planning desk');
  await primary(page,'aOverviewDay','aOverviewTools');
  await stage(page,'aOverviewTools');
  assert(await page.locator('#day-logs-sheet.open').count() === 0,'the tools step closes the opened day first');
  await primary(page,'aOverviewTools','aIntro');

  // Places & weather: weather is configured, not merely mentioned, and the
  // resulting profile is attached on the demo Ting's Schedule page.
  await page.locator('[data-coach-chapter="places"]').click();
  await stage(page,'aLocations');
  assert(/map pin|travel/i.test(await page.locator('#tings-coach-copy').textContent()),'places cover map entry, presence, and travel');
  await primary(page,'aLocations','aBusy');
  await primary(page,'aBusy','aWeather');
  // The settings body opens and scrolls on the next task so the spotlight does
  // not race the sheet's own layout. Assert after the real target is visible.
  await page.waitForFunction(()=>{
    const target=document.getElementById('weather-profile-add');
    const rect=target?.getBoundingClientRect();
    return document.querySelector('#tings-coach[data-coach-stage="aWeather"]')?.dataset.locked === 'true'
      && rect?.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight
      && document.elementFromPoint(rect.left + rect.width / 2,rect.top + rect.height / 2)?.closest('#weather-profile-add');
  },null,{timeout:5000});
  assert(await page.locator('#tings-coach[data-coach-stage="aWeather"]').getAttribute('data-locked') === 'true','weather starts with a real add-profile action');
  await page.locator('#weather-profile-add').click();
  await stage(page,'aWeatherRule');
  assert(/Preferences steer; hard limits reject/.test(await page.locator('.tings-coach-title').textContent()),'weather explains preference versus hard-limit semantics');
  assert(await page.locator('.weather-profile-card .weather-rule').count() === 1,'the coach creates a real temporary weather rule');
  await primary(page,'aWeatherRule','aWeatherAttach');
  await page.locator('#detail-weather-profile').selectOption({index:1});
  await stage(page,'aPrayer');
  assert(/general windows, specific options/.test(await page.locator('#tings-coach-copy').textContent()),'relative times are tied back to both schedule levels');
  assert(!/prayer|fajr|isha|asr/i.test(await page.locator('#tings-coach-copy').textContent()),'general relative-time guidance uses inclusive day-part names');
  await primary(page,'aPrayer','aIntro');
  assert(await page.locator('[data-coach-chapter="places"].is-done').count() === 1,'places and weather chapter checks off');

  await page.locator('[data-coach-chapter="data"]').click();
  await stage(page,'aBackup');
  assert(await page.locator('#tings-coach[data-coach-stage="aBackup"]').getAttribute('data-locked') === 'true','the backup step locks to the real export button');
  await page.locator('#backup-export').click();
  await stage(page,'aCalendarImport');
  await primary(page,'aCalendarImport','aShare');
  await page.waitForFunction(()=>document.getElementById('settings-agenda-head')?.getAttribute('aria-expanded') === 'true',null,{timeout:2000});
  assert(true,'the shared display section opens for its step');
  assert(/QR/.test(await page.locator('#tings-coach-copy').textContent()),'the share step teaches QR pairing for a display feed');
  await primary(page,'aShare','aCleanup');
  await page.waitForFunction(()=>document.getElementById('settings-cleanup-head')?.getAttribute('aria-expanded') === 'true',null,{timeout:2000});
  assert(true,'the cleanup section opens for its step');
  await primary(page,'aCleanup','aIntro');

  await page.locator('[data-coach-chapter="tuning"]').click();
  await stage(page,'aSettingsDisplay');
  assert(/automatically/.test(await page.locator('#tings-coach-copy').textContent()),'personalization explains automatic agenda inclusion');
  await primary(page,'aSettingsDisplay','aCards');
  await primary(page,'aCards','aDefaults');
  await primary(page,'aDefaults','aAppearance');
  await primary(page,'aAppearance','aReminders');
  assert(/dated tasks and fixed appointments/i.test(await page.locator('#tings-coach-copy').textContent()),'personalization covers commitment-only reminders');
  await primary(page,'aReminders','aOptimizer');
  // aOptimizer is now locked to the settings-advanced-head; opening it auto-advances to the toggle step.
  assert(await page.locator('#tings-coach[data-coach-stage="aOptimizer"]').getAttribute('data-locked') === 'true','optimizer step locks to the Advanced section header');
  await page.locator('#settings-advanced-head').click();
  await stage(page,'aOptimizerToggle');
  // Wait for the accordion to expand and toggle to become visible.
  await page.waitForSelector('[data-setting-toggle="agendaOptimizer"]', {timeout: 3000});
  await page.waitForTimeout(300); // allow position() to re-run after layout
  assert(await page.locator('#tings-coach[data-coach-stage="aOptimizerToggle"]').getAttribute('data-locked') === 'true','optimizer toggle step locks to the real toggle control');
  await page.locator('[data-setting-toggle="agendaOptimizer"],[data-ui-toggle="agendaOptimizer"]').first().click();
  await stage(page,'aIntro');
  assert(await page.locator('.tings-coach-chapter.is-done').count() === 7,'every chapter registers as done');
  const advancedChapters = await page.evaluate(()=>JSON.parse(localStorage.getItem('tings_coach_advanced_v3') || '{}'));
  assert(['home','schedule','progress','plan','places','tuning','data'].every(id=>advancedChapters[id] === 'done'),'chapter completion is remembered per chapter');
  await page.locator('[data-coach-primary]').click();
  assert(await page.locator('#tings-coach').count() === 0,'closing the chapter menu ends the advanced coach');
  assert(await page.locator('#settings-sheet.open').count() === 0,'advanced coach closes its final settings sheet');

  await page.locator('#open-about').click();
  await page.locator('#settings-open-about').click();
  await page.waitForSelector('#about-sheet.open');
  assert(await page.locator('#start-essentials-coach').isVisible() && await page.locator('#start-advanced-coach').isVisible(),'About exposes both coaches for replay');
  assert((await page.locator('#start-essentials-coach').textContent()).trim() === 'quick start','Help uses the Quick start name');
  await page.evaluate(()=>window.startTingsCoach('essentials',{force:true}));
  await stage(page,'eIntro');
  await page.locator('[data-coach-skip]').click();
  assert(await page.locator('[data-coach-skip]').getAttribute('data-armed') === '1','first skip tap arms instead of ending the tour');
  await page.locator('[data-coach-skip]').click();
  assert(await page.locator('#tings-coach').count() === 0,'second skip tap ends the tour');
  assert(await page.evaluate(()=>localStorage.getItem('tings_coach_essentials_v2')) === 'skipped','skipping is recorded only after confirmation');

  // Install guide from About: iconified steps, then the quick-start handover.
  await page.locator('#open-about').click();
  await page.locator('#settings-open-about').click();
  await page.waitForSelector('#about-sheet.open');
  assert(await page.locator('#open-install-guide').isVisible(),'browser About still offers install app');
  await page.locator('#open-install-guide').click();
  await stage(page,'iSteps');
  const aboutInstallBar = await progressBar(page);
  assert(aboutInstallBar.role === 'progressbar' && aboutInstallBar.now === 1 && aboutInstallBar.max === 2,'About runs the install guide as its own tour');
  assert(await page.locator('.tings-step-glyph i').count() === 3,'install guidance lists three iconified steps');
  const desktopSteps = await page.locator('.tings-step-text').allTextContents();
  assert(desktopSteps.some(text=>text.includes('Cast, save, and share')),'desktop install guidance teaches the current Chrome menu path');
  const desktopIcons = await page.locator('.tings-step-glyph i').evaluateAll(els=>els.map(el=>el.className));
  assert(JSON.stringify(desktopIcons) === JSON.stringify(['ti ti-device-desktop-down','ti ti-dots-vertical','ti ti-window']),'desktop install guidance shows the monitor, menu-dots, and window glyphs');
  assert(await page.locator('[data-coach-back]').count() === 0,'the install tour opens on its first step');
  assert(await page.locator('#tings-coach').getAttribute('data-gated') === 'true','install guidance keeps the rest of the app locked');
  const coverGuard = await page.evaluate(()=>{
    const top = document.querySelector('[data-coach-guard="top"]').getBoundingClientRect();
    return {w:top.width,h:top.height,vw:window.innerWidth,vh:window.innerHeight};
  });
  assert(coverGuard.h >= coverGuard.vh - 1 && coverGuard.w >= coverGuard.vw - 1,'the install step has no in-page target so guards cover the whole surface');
  await primary(page,'iSteps','iNext');
  assert((await page.locator('.tings-coach-title').textContent()) === 'Close this tab','About’s install tour still ends by telling the user to leave the tab');
  assert((await page.locator('[data-coach-later]').textContent()) === 'Stay in this tab','the leave-the-tab step keeps a stay-in-browser escape');
  await page.locator('[data-coach-primary]').click();
  assert(await page.locator('#tings-coach').count() === 0,'confirming the leave-the-tab step ends the install tour');

  // Native-prompt variant: a captured install gesture swaps in an Install
  // button; a declined or broken prompt falls back to the manual steps.
  await page.evaluate(()=>window.dispatchEvent(new Event('beforeinstallprompt')));
  await page.evaluate(()=>window.startTingsCoach('install',{force:true}));
  await stage(page,'iSteps');
  assert((await page.locator('[data-coach-primary]').textContent()) === 'Install','a captured install gesture offers the native prompt');
  assert((await page.locator('[data-coach-later]').textContent()) === 'Not now','the native install step keeps a soft escape');
  await page.locator('[data-coach-primary]').click();
  await page.waitForTimeout(200);
  assert(await page.locator('.tings-step-glyph i').count() === 3,'a declined native prompt falls back to manual install steps');
  await primary(page,'iSteps','iNext');
  await page.locator('[data-coach-later]').click();
  await stage(page,'eIntro');
  const replayBar = await progressBar(page);
  assert(replayBar.now === 1 && replayBar.max === 8,'staying in the tab chains into the quick start replay');
  await page.evaluate(()=>window.TingsCoach.stop());

  // Live gesture upgrade: Chrome often fires beforeinstallprompt a beat
  // after the card rendered with the manual steps — the card must swap
  // itself to the one-tap Install button instead of teaching the long way,
  // and an install finished from browser chrome jumps straight to the
  // close-this-tab handoff.
  await page.evaluate(()=>window.startTingsCoach('install',{force:true}));
  await stage(page,'iSteps');
  assert((await page.locator('[data-coach-primary]').textContent()) === 'Next','the manual install card renders while no native gesture is captured yet');
  await page.evaluate(()=>window.dispatchEvent(new Event('beforeinstallprompt')));
  await page.waitForTimeout(150);
  assert((await page.locator('[data-coach-primary]').textContent()) === 'Install','a late beforeinstallprompt swaps the manual card for the one-tap Install button');
  assert(await page.locator('.tings-step-glyph i').count() === 0,'the swapped card drops the manual steps entirely');
  await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));
  await stage(page,'iNext');
  assert((await page.locator('.tings-coach-title').textContent()) === 'Close this tab','installing through browser chrome jumps to the leave-the-tab handoff');
  await page.evaluate(()=>window.TingsCoach.stop());

  // Already installed (standalone display mode): the first-run offer goes
  // straight to the quick start, and About refuses a second install tour.
  const savedStore = await page.evaluate(()=>localStorage.getItem('tings_v2'));
  await page.addInitScript(()=>{
    const original = window.matchMedia.bind(window);
    window.matchMedia = query => /standalone|minimal-ui|fullscreen/.test(query)
      ? {matches:true,media:query,onchange:null,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent(){return false;}}
      : original(query);
  });
  await page.evaluate(()=>{
    localStorage.setItem('tings_v2','[]');
    localStorage.removeItem('tings_coach_essentials_v2');
    localStorage.removeItem('tings_coach_advanced_v3');
    localStorage.removeItem('tings_coach_install_v2');
  });
  await page.reload({waitUntil:'load'});
  await stage(page,'eIntro',3500);
  assert(true,'standalone fresh users are offered the quick start directly, not the install guide');
  await page.evaluate(()=>window.TingsCoach.stop());
  await page.evaluate(data=>{localStorage.setItem('tings_v2',data);},savedStore);
  await page.locator('#open-about').click();
  await page.locator('#settings-open-about').click();
  await page.waitForSelector('#about-sheet.open');
  assert(await page.locator('#open-install-guide').isHidden(),'already-installed users do not see install app on About');
  await page.evaluate(()=>closeSheet('about-sheet'));

  // Per-platform glyphs and labels: the compact rails quote each control
  // exactly as the browser labels it. iOS teaches ••• → Share → Add to Home
  // Screen → Add on every version (ti-dots, then ti-share-2 — not the
  // Android node-graph ti-share), with a toolbar-Share hedge for layouts
  // without a ••• button; both current and older iOS UAs get the same rail.
  // Android shows Chrome's ⋮ menu, Install app, and Confirm on a
  // bottom-docked rail.
  const uaCases = [
    {
      name:'ios',
      ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
      icons:['ti ti-dots','ti ti-share-2','ti ti-square-rounded-plus','ti ti-check'],
      labels:['•••','Share','Add to Home Screen','Add'],
      dock:'top'
    },
    {
      name:'ios-legacy',
      ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      icons:['ti ti-dots','ti ti-share-2','ti ti-square-rounded-plus','ti ti-check'],
      labels:['•••','Share','Add to Home Screen','Add'],
      dock:'top'
    },
    {
      name:'android',
      ua:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
      icons:['ti ti-dots-vertical','ti ti-device-mobile-down','ti ti-check'],
      labels:['⋮ menu','Install app','Confirm'],
      dock:'bottom',
      copyNeedle:'Install app'
    }
  ];
  for(const {name,ua,icons,labels,dock,copyNeedle = '•••'} of uaCases){
    const ctx = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:ua});
    const uaPage = await ctx.newPage();
    await uaPage.goto(coachUrl,{waitUntil:'load'});
    await uaPage.waitForSelector('#tings-coach[data-coach-stage="iSteps"]',{timeout:5000});
    const shown = await uaPage.locator('.tings-step-glyph i').evaluateAll(els=>els.map(el=>el.className));
    assert(JSON.stringify(shown) === JSON.stringify(icons),`${name} install guidance shows the correct platform glyphs`);
    const shownLabels = await uaPage.locator('.tings-step-text').allTextContents();
    assert(JSON.stringify(shownLabels) === JSON.stringify(labels),`${name} install rail quotes the browser's own control labels`);
    assert(await uaPage.locator('.tings-step-arrow').count() === labels.length - 1,`${name} install rail uses arrows between steps`);
    assert(await uaPage.locator('.tings-coach-chrome-nudge').count() === 1,`${name} install card points at the browser chrome`);
    const rail = await uaPage.evaluate(()=>({
      dock:document.getElementById('tings-coach').getAttribute('data-install-dock'),
      compact:Boolean(document.querySelector('.tings-coach-steps.is-compact')),
      bubbleTop:document.querySelector('.tings-coach-bubble').getBoundingClientRect().top,
      bubbleBottom:document.querySelector('.tings-coach-bubble').getBoundingClientRect().bottom,
      viewport:window.innerHeight,
      copy:(document.getElementById('tings-coach-copy') || {}).textContent || '',
      hintShown:Boolean(document.querySelector('.tings-coach-overlay-hint'))
    }));
    assert(rail.dock === dock && rail.compact,`${name} install guidance is a compact rail docked at the ${dock}`);
    if(dock === 'top')assert(rail.bubbleTop <= 24,`${name} install card sits at the top so Safari’s bottom menus do not cover it`);
    else assert(rail.bubbleBottom >= rail.viewport - 24,`${name} install card sits at the bottom so the browser menu does not cover it`);
    assert(rail.copy.includes(copyNeedle) && rail.hintShown,`${name} install card keeps a short locator in visible copy`);
    assert((rail.bubbleBottom - rail.bubbleTop) <= 340,`${name} install card stays short enough that a native menu cannot cover the rail`);
    if(name === 'ios'){
      assert(await uaPage.locator('#tings-coach').getAttribute('data-chrome-overlay') === 'false','iOS install card starts expanded before Safari’s menu opens');
      await uaPage.evaluate(()=>window.dispatchEvent(new Event('blur')));
      const overlay = await uaPage.evaluate(()=>{
        const root = document.getElementById('tings-coach');
        const bubble = document.querySelector('.tings-coach-bubble').getBoundingClientRect();
        const hint = document.querySelector('.tings-coach-overlay-hint');
        const title = document.querySelector('.tings-coach-title');
        const copy = document.getElementById('tings-coach-copy');
        return {
          flag:root.getAttribute('data-chrome-overlay'),
          hintShown:Boolean(hint) && getComputedStyle(hint).display !== 'none',
          titleShown:Boolean(title) && getComputedStyle(title).display !== 'none',
          copyShown:Boolean(copy) && getComputedStyle(copy).display !== 'none',
          height:bubble.height,
          top:bubble.top
        };
      });
      assert(overlay.flag === 'true' && overlay.hintShown && overlay.titleShown === false,'opening Safari’s menu collapses the card to a top reminder');
      assert(overlay.copyShown === false,'the long locator copy hides while Safari’s menu is open');
      assert(overlay.height < rail.bubbleBottom - rail.bubbleTop && overlay.top <= 24 && overlay.height <= 140,'the overlay reminder is shorter and stays at the top');
      await uaPage.evaluate(()=>window.dispatchEvent(new Event('focus')));
      assert(await uaPage.locator('#tings-coach').getAttribute('data-chrome-overlay') === 'false','closing Safari’s menu restores the full iOS install card');
    }
    if(name === 'ios-legacy'){
      const legacyCopy = await uaPage.locator('#tings-coach-copy').textContent();
      assert(legacyCopy.includes('No •••'),'older iOS keeps the •••-first rail and hedges with the toolbar Share button');
    }
    await ctx.close();
  }

  // Desktop tier: wide layouts keep the overview as a permanent pane with no
  // calendar button, and mount the detail page in a side pane instead of a
  // modal. The pane click-away must not unmount what a chapter tap just
  // mounted, and the calendar-open steps must not exist where nothing can be
  // tapped.
  const desktopCtx = await browser.newContext({viewport:{width:1280,height:800}});
  const desk = await desktopCtx.newPage();
  await desk.goto(coachUrl,{waitUntil:'load'});
  await desk.evaluate(()=>localStorage.clear());
  await desk.reload({waitUntil:'load'});
  await desk.evaluate(()=>window.TingsCoach?.stop?.());
  await desk.evaluate(()=>openSheet('add-sheet'));
  await desk.fill('#ting-message','Walk the dog');
  await desk.locator('#do-save').click();
  await desk.waitForTimeout(300);
  await desk.evaluate(()=>closeSheet('detail-sheet'));
  await desk.evaluate(()=>window.startTingsCoach('advanced',{force:true}));
  // Minimal mode is opt-in, so put this context back into minimal mode: the
  // schedule chapter must then detour through the full-mode reveal before its
  // full-only controls exist.
  await desk.evaluate(()=>updateSortSetting({minimalMode:true},{renderNow:false}));
  await desk.locator('[data-coach-chapter="schedule"]').click();
  await desk.waitForTimeout(400);
  assert(await desk.locator('#tings-coach[data-coach-stage="aFullMode"]').count() === 1,'desktop schedule chapter detours through the full-mode reveal in minimal mode');
  await desk.locator('[data-setting-toggle="minimalMode"]').click();
  await stage(desk,'aDetailRead');
  assert(await desk.locator('#tings-coach[data-coach-stage="aDetailRead"]').count() === 1,'desktop schedule chapter survives the pane click-away');
  assert(await desk.evaluate(()=>document.getElementById('pane-detail').dataset.activeSheet === 'detail-sheet'),'desktop schedule chapter mounts the real detail pane');
  // The same hands-on schedule walk works on the desktop pane tier.
  await desk.locator('.detail-page-tab[aria-label="schedule"]').click();
  await stage(desk,'aSchedule');
  await tapTarget(desk,'#detail-weekday-chips .schedule-chip');
  await stage(desk,'aSchedulePreferences');
  await tapTarget(desk,'#detail-schedule-view-seg [data-schedule-view="preferred"]');
  await stage(desk,'aGeneralSchedule');
  await primary(desk,'aGeneralSchedule','aScheduleOrder');
  await primary(desk,'aScheduleOrder','aTimesPlaces');
  await stage(desk,'aTimesPlaces');
  await tapTarget(desk,'#detail-habit-option-add');
  await stage(desk,'aOptionRow');
  await tapTarget(desk,'.habit-option-row .time-mode-toggle [data-time-mode="relative"]');
  await stage(desk,'aTaskRules');
  await primary(desk,'aTaskRules','aIntro');
  await stage(desk,'aIntro');
  assert(await desk.locator('[data-coach-chapter="schedule"].is-done').count() === 1,'desktop schedule chapter finishes and checks off');
  await desk.locator('[data-coach-chapter="plan"]').click();
  await stage(desk,'aSearch');
  // aSearch is now locked: use tapTarget which waits for the element to be reachable.
  await tapTarget(desk,'#open-search,#bar-open-search');
  await stage(desk,'aSearchTools');
  await primary(desk,'aSearchTools','aOverview');
  await stage(desk,'aOverview');
  assert(await desk.locator('#tings-coach[data-coach-stage="aOverview"]').count() === 1,'desktop plan chapter skips the calendar-open step and reads the live pane');
  await tapLiveCalDay(desk,'future');
  await stage(desk,'aOverviewDay');
  await primary(desk,'aOverviewDay','aOverviewTools');
  await primary(desk,'aOverviewTools','aIntro');
  // Essentials replay: no calendar-open step on the desktop tier either.
  await desk.evaluate(()=>window.startTingsCoach('essentials',{force:true}));
  await stage(desk,'eIntro');
  const deskReplayBar = await progressBar(desk);
  assert(deskReplayBar.max === 7,'desktop quick start replay drops the calendar-open step from its count');
  await primary(desk,'eIntro','eAddInfo');
  await primary(desk,'eAddInfo','eHomeCard');
  await primary(desk,'eHomeCard','eHomeGroups');
  await primary(desk,'eHomeGroups','eOverview');
  assert(await desk.locator('#tings-coach[data-coach-stage="eOverview"]').count() === 1,'desktop replay jumps straight to the always-open calendar pane');
  await desk.evaluate(()=>window.TingsCoach.stop());
  await desktopCtx.close();

  await page.evaluate(()=>{
    localStorage.removeItem('tings_coach_essentials_v2');
    localStorage.removeItem('tings_coach_advanced_v3');
  });
  await page.reload({waitUntil:'load'});
  await page.waitForTimeout(1200);
  assert(await page.locator('script[data-tings-coach]').count() === 0,'existing users do not download coach assets automatically');

  if(errors.length)throw new Error(errors.join('\n'));
  await browser.close();
  console.log('ONBOARDING COACH TEST PASSED');
})().catch(error=>{
  console.error(error);
  process.exit(1);
});
