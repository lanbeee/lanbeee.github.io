const { chromium } = require('playwright');

const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

function assert(condition,message){
  if(!condition)throw new Error(message);
}

(async()=>{
  const browser = await chromium.launch();
  const cases = [
    {name:'mobile',viewport:{width:390,height:844},isMobile:true,minHit:34},
    {name:'desktop',viewport:{width:1280,height:900},isMobile:false,minHit:34}
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
    const crown = page.locator('#list .breakable-crown').first();
    await crown.waitFor({state:'visible'});

    const metrics = await crown.evaluate(el=>{
      const card = el.closest('.ting-card').getBoundingClientRect();
      const hit = el.getBoundingClientRect();
      const progress = el.closest('.breakable-progress').getBoundingClientRect();
      return {
        hitHeight:hit.height,
        hitWidth:hit.width,
        progressWidth:progress.width,
        cardWidth:card.width,
        viewportWidth:document.documentElement.clientWidth,
        overflowX:document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    assert(metrics.hitHeight >= testCase.minHit,
      `${testCase.name}: crown hit area ${metrics.hitHeight}px < ${testCase.minHit}px`);
    assert(metrics.hitWidth >= 60,
      `${testCase.name}: crown is too narrow at ${metrics.hitWidth}px`);
    assert(metrics.progressWidth <= metrics.cardWidth,
      `${testCase.name}: crown row overflows its card`);
    assert(metrics.overflowX <= 1,
      `${testCase.name}: page has ${metrics.overflowX}px horizontal overflow`);

    // Keyboard forward: 210 ArrowRight presses → 210m target (50% of 420).
    await crown.evaluate(el=>{
      for(let i = 0; i < 210; i++) el.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    });
    const pending = await page.evaluate(()=>{
      const row = document.querySelector('#list .swipe-row:has(.breakable-crown)');
      return {
        dirty:row?.dataset.progressDirty,
        target:row?.dataset.progressTarget,
        label:row?.querySelector('.breakable-progress-label')?.textContent
      };
    });
    assert(pending.dirty === '1',`${testCase.name}: keyboard input ahead should mark dirty`);
    assert(Number(pending.target) === 210,`${testCase.name}: 210 ArrowRight should set 210m, got ${pending.target}`);
    assert(pending.label === '210/420m',`${testCase.name}: pending label is ${pending.label}`);

    // Keyboard reverse clamps at committed (0): cannot go below.
    await crown.evaluate(el=>{
      for(let i = 0; i < 300; i++) el.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
    });
    const clamped = await page.evaluate(()=>{
      const row = document.querySelector('#list .swipe-row:has(.breakable-crown)');
      const h = load().find(item=>item.name === 'Deep work');
      return {
        dirty:row?.dataset.progressDirty,
        target:Number(row?.dataset.progressTarget),
        progress:breakableProgressMinutes(h),
        detailOpen:document.querySelector('#detail-sheet')?.classList.contains('open') || false
      };
    });
    assert(clamped.dirty === '0',`${testCase.name}: clamping at committed should clear dirty`);
    assert(clamped.target === 0,`${testCase.name}: ArrowLeft should clamp at committed=0, got ${clamped.target}`);
    assert(clamped.progress === 0,`${testCase.name}: keyboard did not log ${clamped.progress}m before pulse`);
    assert(!clamped.detailOpen,`${testCase.name}: crown interaction opened detail`);

    await page.screenshot({path:`/private/tmp/habits-breakable-${testCase.name}.png`,fullPage:true});
    console.log(`${testCase.name}: ${JSON.stringify(metrics)}`);
    await page.close();
  }

  await browser.close();
  console.log('Breakable crown layout passed');
})().catch(error=>{
  console.error(error);
  process.exit(1);
});
