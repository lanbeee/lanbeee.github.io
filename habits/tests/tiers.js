const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const name = `Tier ${Date.now()}`;
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  await page.addInitScript(({ name, dayStart }) => {
    const ex = JSON.parse(localStorage.getItem('tings_v2') || '[]');
    ex.push({ name, type:'keepup', target:7, logs:[dayStart-86400000], emoji:'', pinned:false, sample:false, snoozedUntil:null, topics:[], allowedWeekdays:[], allowedMonthDays:[], flexibilityDays:0, durationMinutes:30, createdAt:Date.now()-5*86400000, lastLog:dayStart-86400000 });
    localStorage.setItem('tings_v2', JSON.stringify(ex));
  }, { name, dayStart });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  const topAt = (x=195,y=400)=>page.evaluate(({x,y})=>{const el=document.elementFromPoint(x,y);return el?el.closest('.sheet-wrap')?.id||el.id||el.tagName:'nothing';},{x,y});

  // Open detail directly
  await page.evaluate(()=>{ if(typeof openDetail==='function')openDetail(0); });
  await page.waitForTimeout(250);
  console.log('detail top:', await topAt());

  // snooze over detail
  await page.evaluate(()=>document.getElementById('snooze-sheet').classList.add('open'));
  await page.waitForTimeout(150);
  console.log('snooze-over-detail top:', await topAt());
  await page.evaluate(()=>document.getElementById('snooze-sheet').classList.remove('open'));

  // activity over detail
  await page.evaluate(()=>document.getElementById('activity-sheet').classList.add('open'));
  await page.waitForTimeout(150);
  console.log('activity-over-detail top:', await topAt());

  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
