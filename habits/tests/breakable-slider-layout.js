const { chromium } = require('playwright');

const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

function assert(condition,message){
  if(!condition)throw new Error(message);
}

(async()=>{
  const browser = await chromium.launch();
  const cases = [
    {name:'mobile',viewport:{width:390,height:844},isMobile:true,minHit:52,minTrack:18},
    {name:'desktop',viewport:{width:1280,height:900},isMobile:false,minHit:48,minTrack:16}
  ];

  for(const testCase of cases){
    const page = await browser.newPage({
      viewport:testCase.viewport,
      isMobile:testCase.isMobile,
      hasTouch:testCase.isMobile
    });
    await page.addInitScript(()=>{
      if(navigator.serviceWorker){
        navigator.serviceWorker.register = ()=>Promise.resolve({
          unregister:()=>Promise.resolve(true),
          update:()=>Promise.resolve()
        });
      }
    });
    await page.goto(BASE,{waitUntil:'networkidle'});
    await page.evaluate(()=>{
      const now = Date.now();
      localStorage.clear();
      localStorage.setItem('tings_v2',JSON.stringify([{
        name:'Deep work',type:'keepup',target:1,
        durationMinutes:420,breakable:true,minChunkMinutes:60,
        lastLog:now - 2 * 86400000,logs:[now - 2 * 86400000],
        allowedWeekdays:[],allowedMonthDays:[],preferredWeekdays:[],preferredMonthDays:[],
        allowedTimeStart:null,allowedTimeEnd:null,preferredTimeStart:null,preferredTimeEnd:null,
        topics:[],locationIds:[],priority:0,pinned:false,snoozedUntil:null,emoji:''
      }]));
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({
        preset:'todayFirst',focus:'balanced',showWeekOnHome:false,
        availabilityMinutes:[720,720,720,720,720,720,720],
        availabilityOverrides:{},blockedTimes:[{label:'sleep',days:[],start:0,end:420}],
        showDueHabitsInAgenda:true,showTaskDateOnCards:true,
        topics:[],locations:[],travel:{},defaultTravelMode:'driving'
      }));
    });
    await page.reload({waitUntil:'networkidle'});
    const slider = page.locator('#list .breakable-slider').first();
    await slider.waitFor({state:'visible'});

    const metrics = await slider.evaluate(el=>{
      const card = el.closest('.ting-card').getBoundingClientRect();
      const hit = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const progress = el.closest('.breakable-progress').getBoundingClientRect();
      return {
        hitHeight:hit.height,
        hitWidth:hit.width,
        trackHeight:parseFloat(style.getPropertyValue('--breakable-track-height')),
        progressWidth:progress.width,
        cardWidth:card.width,
        viewportWidth:document.documentElement.clientWidth,
        overflowX:document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    assert(metrics.hitHeight >= testCase.minHit,
      `${testCase.name}: slider hit area ${metrics.hitHeight}px < ${testCase.minHit}px`);
    assert(metrics.trackHeight >= testCase.minTrack,
      `${testCase.name}: track ${metrics.trackHeight}px < ${testCase.minTrack}px`);
    assert(metrics.hitWidth >= 140,
      `${testCase.name}: slider is too narrow at ${metrics.hitWidth}px`);
    assert(metrics.progressWidth <= metrics.cardWidth,
      `${testCase.name}: slider row overflows its card`);
    assert(metrics.overflowX <= 1,
      `${testCase.name}: page has ${metrics.overflowX}px horizontal overflow`);

    const hitBox = await slider.boundingBox();
    const tapPosition = {x:hitBox.width * 0.75,y:hitBox.height / 2};
    if(testCase.isMobile)await slider.tap({position:tapPosition});
    else await slider.click({position:tapPosition});
    const tapped = await page.evaluate(()=>{
      const row = document.querySelector('#list .swipe-row:has(.breakable-slider)');
      const h = load().find(item=>item.name === 'Deep work');
      return {
        dirty:row?.dataset.progressDirty,
        target:Number(row?.dataset.progressTarget),
        progress:breakableProgressMinutes(h),
        detailOpen:document.querySelector('#detail-sheet')?.classList.contains('open') || false
      };
    });
    assert(tapped.dirty === '1',`${testCase.name}: tapping the track did not set a target`);
    assert(tapped.target > 210 && tapped.target < 420,
      `${testCase.name}: 75% track tap produced ${tapped.target}m`);
    assert(tapped.progress === 0,`${testCase.name}: slider tap logged ${tapped.progress}m before pulse`);
    assert(!tapped.detailOpen,`${testCase.name}: slider tap opened detail`);

    await slider.evaluate(el=>{
      el.value = '50';
      el.dispatchEvent(new Event('input',{bubbles:true}));
    });
    const pending = await page.evaluate(()=>{
      const row = document.querySelector('#list .swipe-row:has(.breakable-slider)');
      return {
        dirty:row?.dataset.progressDirty,
        target:row?.dataset.progressTarget,
        label:row?.querySelector('.breakable-progress-label')?.textContent
      };
    });
    assert(pending.dirty === '1',`${testCase.name}: pending target is not marked dirty`);
    assert(Number(pending.target) === 210,`${testCase.name}: 50% target is ${pending.target}, not 210m`);
    assert(pending.label === '210/420m',`${testCase.name}: pending label is ${pending.label}`);

    await page.screenshot({path:`/private/tmp/habits-breakable-${testCase.name}.png`,fullPage:true});
    console.log(`${testCase.name}: ${JSON.stringify(metrics)}`);
    await page.close();
  }

  await browser.close();
  console.log('Breakable slider layout passed');
})().catch(error=>{
  console.error(error);
  process.exit(1);
});
