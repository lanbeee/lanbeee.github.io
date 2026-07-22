// Regression coverage for home loading, compact presentation, scroll-safe
// cards, search positioning, location combinations, and modal scroll locking.
const fs = require('fs');
const path = require('path');
const { chromium, webkit } = require('playwright');

const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

(async()=>{
  const failures = [];
  const check = (name,condition,detail='')=>{
    if(condition)console.log(`  ok  - ${name}`);
    else{
      failures.push(`${name}${detail ? ` :: ${detail}` : ''}`);
      console.log(`  FAIL- ${name}${detail ? ` :: ${detail}` : ''}`);
    }
  };

  const html = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  check('cold HTML starts with an agenda loading state',/id="list"[^>]*>\s*<div class="home-loading"/.test(html));
  check('cold HTML keeps the new-user empty state hidden',/id="empty"[^>]*style="display:none"/.test(html));

  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext({
    viewport:{width:390,height:844},
    isMobile:true,
    hasTouch:true,
    serviceWorkers:'block'
  });
  const fixed = new Date(2026,6,22,8,0,0,0).getTime();
  await context.clock.setFixedTime(fixed);
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror',error=>pageErrors.push(String(error)));

  await page.addInitScript(({now})=>{
    const tasks = Array.from({length:10},(_,i)=>({
      hid:`refinement-${i}`,
      name:i === 0 ? 'Needle planning task' : `Planning task ${i}`,
      type:'task',
      dueDate:now,
      durationMinutes:i === 1 ? 150 : 30,
      logs:[],
      lastLog:null,
      priority:2,
      locationIds:[i % 2 ? 'office' : 'home'],
      anywhereAllowed:false
    }));
    tasks.push({
      hid:'compact-work',name:'Focused work',type:'keepup',target:1,
      durationMinutes:122,logs:[now-2*86400000],lastLog:now-2*86400000,
      priority:1,locationIds:['home'],anywhereAllowed:true,preferredLocationId:'home'
    });
    localStorage.clear();
    localStorage.setItem('tings_v2',JSON.stringify(tasks));
    localStorage.setItem('tings_app_settings_v2',JSON.stringify({
      preset:'todayFirst',showWeekOnHome:true,agendaOptimizer:false,
      showDurationOnCards:true,homeExtraMode:'cards',
      availabilityMinutes:[600,600,600,600,600,600,600],availabilityOverrides:{},
      topics:[],travel:{},defaultTravelMode:'walking',lastKnownLocationId:'home',
      locations:[
        {id:'home',name:'Home',lat:40.700,lng:-74.000},
        {id:'office',name:'Office',lat:40.715,lng:-74.005}
      ],
      blockedTimes:[{label:'Work',days:[0,1,2,3,4,5,6],start:540,end:1020,locationId:'office'}]
    }));
  },{now:fixed});

  await page.goto(BASE,{waitUntil:'load'});
  await page.waitForSelector('#list .ting-card');

  const compact = await page.evaluate(()=>({
    nine:compactHomeTime(new Date(2026,6,22,9,0).getTime()),
    five:compactHomeTime(new Date(2026,6,22,17,0).getTime()),
    quarter:compactHomeTime(new Date(2026,6,22,9,15).getTime()),
    short:compactHomeDuration(29),
    rounded:compactHomeDuration(122),
    half:compactHomeDuration(150)
  }));
  check('home clocks omit redundant minutes and spaces',compact.nine === '9AM' && compact.five === '5PM',JSON.stringify(compact));
  check('home clocks retain meaningful minutes',compact.quarter === '9:15AM',JSON.stringify(compact));
  check('home durations compact minutes and decimal hours',compact.short === '29m' && compact.rounded === '2h' && compact.half === '2.5h',JSON.stringify(compact));

  const hierarchy = await page.evaluate(()=>{
    const host = document.createElement('div');
    host.className = 'ting-info';
    host.style.width = '220px';
    const start = new Date(2026,6,22,9,0).getTime();
    host.innerHTML = `<div class="ting-main"><span class="ting-name">Prepare a very long quarterly planning document</span>${agendaCardPill({kind:'fill',start,end:start+122*60000,chunkIndex:0,chunkMinutes:122},{breakable:true})}</div><div class="ting-meta">${cardStatusPill(72,'warn','due soon','red')}</div>`;
    document.body.appendChild(host);
    const lead = host.querySelector('.agenda-lead');
    const name = host.querySelector('.ting-name');
    const style = getComputedStyle(lead);
    const result = {
      text:lead.textContent.replace(/\s+/g,' ').trim(),
      inFirstRow:Boolean(lead.closest('.ting-main')),
      statusInMeta:Boolean(host.querySelector('.ting-meta .status-pill')),
      transparent:style.backgroundColor === 'rgba(0, 0, 0, 0)' && parseFloat(style.borderTopWidth) === 0,
      leadSize:parseFloat(style.fontSize),
      titleSize:parseFloat(getComputedStyle(name).fontSize),
      leadFits:lead.scrollWidth <= lead.clientWidth,
      titleEllipses:name.scrollWidth > name.clientWidth
    };
    host.remove();
    return result;
  });
  check('agenda suggestion is an inline first-row cue',hierarchy.inFirstRow && hierarchy.transparent,JSON.stringify(hierarchy));
  check('agenda suggestion is no larger than the title',hierarchy.leadSize <= hierarchy.titleSize,JSON.stringify(hierarchy));
  check('long titles ellipsize before agenda time is cut',hierarchy.titleEllipses && hierarchy.leadFits,JSON.stringify(hierarchy));
  check('agenda cue and status use compact copy in their intended rows',hierarchy.text === '9AM · 2h' && hierarchy.statusInMeta,JSON.stringify(hierarchy));

  const homeCopy = await page.evaluate(()=>({
    block:document.querySelector('.blocked-card:not(.blocked-card-merge) span')?.textContent || '',
    duration:[...document.querySelectorAll('.context-pill[title^="duration "]')].map(el=>el.textContent.trim())
  }));
  check('blocked rows use compact time ranges',homeCopy.block.includes('9AM–5PM') && !homeCopy.block.includes(':00'),JSON.stringify(homeCopy));
  check('card effort metadata uses compact duration copy',homeCopy.duration.includes('2h') && homeCopy.duration.includes('2.5h'),JSON.stringify(homeCopy));

  const scrollSafety = await page.evaluate(()=>{
    document.querySelectorAll('.sheet-wrap.open').forEach(el=>el.classList.remove('open'));
    updateFullPageState();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const day = new Date(2026,6,22).getTime();
    appendHomeBlockedCard(host,{label:'Test block',start:day+9*3600000,end:day+10*3600000,locationId:'home'});
    appendHomeTravelCard(host,'home','office',day+11*3600000);
    const exercise = el=>{
      el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:7,clientX:20,clientY:100}));
      el.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:7,clientX:20,clientY:55}));
      el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:7,clientX:20,clientY:55}));
      el.click();
    };
    exercise(host.querySelector('.blocked-card'));
    exercise(host.querySelector('.travel-card'));
    const result = {
      blockOpen:document.querySelector('#block-edit-sheet.open') !== null,
      travelOpen:document.querySelector('#travel-edit-sheet.open') !== null
    };
    host.remove();
    return result;
  });
  check('scroll gestures do not activate blocked or travel cards',!scrollSafety.blockOpen && !scrollSafety.travelOpen,JSON.stringify(scrollSafety));

  await page.evaluate(()=>{ document.querySelector('.pane-list').scrollTop = 600; });
  await page.locator('#open-search').click();
  await page.locator('#habit-search').fill('Needle');
  await page.waitForSelector('.ting-card:has-text("Needle planning task")');
  await page.waitForTimeout(40);
  const search = await page.evaluate(()=>({
    scrollTop:document.querySelector('.pane-list').scrollTop,
    cards:document.querySelectorAll('#list .ting-card').length,
    gap:getComputedStyle(document.body).getPropertyValue('--nav-bottom').trim()
  }));
  check('search results start at the top even from a scrolled home list',search.scrollTop === 0 && search.cards === 1,JSON.stringify(search));
  check('phone search uses the reduced bottom gap',search.gap === '6px',JSON.stringify(search));

  await page.evaluate(()=>setSearchOpen(false,{clear:true,focus:false}));
  await page.evaluate(()=>openSheet('add-sheet'));
  const modal = await page.evaluate(()=>{
    const pane = document.querySelector('.pane-list');
    return {
      bodyLocked:document.body.classList.contains('modal-open') && document.body.classList.contains('modal-scroll-fixed'),
      paneOverflow:getComputedStyle(pane).overflowY,
      top:document.body.style.top
    };
  });
  check('open sheets lock the body and underlying home pane',modal.bodyLocked && modal.paneOverflow === 'hidden' && Boolean(modal.top),JSON.stringify(modal));
  await page.evaluate(()=>closeSheet('add-sheet'));
  check('closing the last sheet restores page scrolling',await page.evaluate(()=>!document.body.classList.contains('modal-open') && !document.body.classList.contains('modal-scroll-fixed')));

  const travelButtons = await page.evaluate(()=>{
    const buttons = [...document.querySelectorAll('.travel-edit-row .icon-btn')];
    return buttons.map(button=>{
      const style = getComputedStyle(button);
      return {width:style.width,height:style.height,radius:style.borderRadius};
    });
  });
  check('travel adjustment buttons remain circular',travelButtons.length === 2 && travelButtons.every(x=>x.width === x.height && x.radius === '50%'),JSON.stringify(travelButtons));
  check('no page errors',pageErrors.length === 0,JSON.stringify(pageErrors));

  await browser.close();

  const webkitBrowser = await webkit.launch({headless:true});
  const webkitPage = await webkitBrowser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await webkitPage.addInitScript(()=>{
    const today = new Date();
    const day = new Date(today.getFullYear(),today.getMonth(),today.getDate()).getTime();
    localStorage.clear();
    localStorage.setItem('tings_v2',JSON.stringify([{
      name:'Blocked tap fixture',type:'task',dueDate:day,durationMinutes:30,
      logs:[],lastLog:null,priority:2,locationIds:[],anywhereAllowed:true
    }]));
    localStorage.setItem('tings_app_settings_v2',JSON.stringify({
      preset:'todayFirst',showWeekOnHome:true,agendaOptimizer:false,homeExtraMode:'cards',
      availabilityMinutes:[600,600,600,600,600,600,600],locations:[],
      blockedTimes:[{label:'Work',days:[0,1,2,3,4,5,6],start:540,end:1020}]
    }));
  });
  await webkitPage.goto(BASE,{waitUntil:'networkidle'});
  const webkitBlock = webkitPage.locator('.blocked-card:not(.blocked-card-merge)').first();
  await webkitBlock.tap();
  const webkitOpened = await webkitPage.locator('#block-edit-sheet.open').waitFor({state:'visible',timeout:3000}).then(()=>true).catch(()=>false);
  check('a clean WebKit tap opens the blocked-time editor',webkitOpened);
  await webkitBrowser.close();

  if(failures.length){
    console.log(`\n${failures.length} FAILURES`);
    failures.forEach(failure=>console.log(` - ${failure}`));
    process.exit(1);
  }
  console.log('\nPASS - general home refinements are regression covered');
})().catch(error=>{ console.error(error); process.exit(1); });
