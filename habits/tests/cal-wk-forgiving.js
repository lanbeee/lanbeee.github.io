const { webkit } = require('playwright');

(async () => {
  const name = `CalMoveWK ${Date.now()}`;
  const now = new Date();
  const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 15, 0, 0).getTime();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const browser = await webkit.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const logs = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => logs.push(`[PAGEERROR] ${err.message || err}`));
  await page.addInitScript(({ name, scheduled, dayStart }) => {
    const key = 'tings_v2';
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    const filtered = existing.filter(item => item.name !== name);
    filtered.push({
      name, type: 'task', target: null, dueDate: dayStart, hardDue: false,
      eventTime: scheduled, logs: [], emoji: '🧪', pinned: false, sample: false,
      snoozedUntil: null, topics: ['qa'], durationMinutes: 25, flexibilityDays: 0, createdAt: Date.now()
    });
    localStorage.setItem(key, JSON.stringify(filtered));
  }, { name, scheduled, dayStart });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.locator('#open-overview').click();
  await page.waitForTimeout(300);

  // Open day logs via clean tap
  const planCell = page.locator('#overview-calendar [data-log-day]').filter({ has: page.locator('.cal-dot.plan') }).last();
  await planCell.tap();
  await page.locator('#day-logs-sheet.open').waitFor();
  console.log('day-logs-sheet opened');

  const openBtn = page.locator('#day-logs-list .overview-item', { hasText: name }).locator('[data-open-day-item]');
  await openBtn.waitFor();
  const btnBox = await openBtn.boundingBox();
  console.log('open button at:', JSON.stringify(btnBox));

  // Simulate a touch with ~25px horizontal movement (forgiving-button path)
  console.log('=== forgiving path: pointerdown/move(25px)/up + synthetic click suppression ===');
  await page.evaluate(({x,y}) => {
    const el = document.elementFromPoint(x, y);
    const mk = (type,cx,cy)=>new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:1,pointerType:'touch',clientX:cx,clientY:cy,isPrimary:true});
    const target = el;
    const down = mk('pointerdown', x, y);
    document.dispatchEvent(down);
    // move 25px
    for(let i=1;i<=5;i++){
      const mv = mk('pointermove', x + 5*i, y);
      document.dispatchEvent(mv);
    }
    const up = mk('pointerup', x+25, y);
    document.dispatchEvent(up);
    // native click that would follow
    const clk = new MouseEvent('click',{bubbles:true,cancelable:true,clientX:x+25,clientY:y});
    target.dispatchEvent(clk);
  }, { x: btnBox.x + btnBox.width/2, y: btnBox.y + btnBox.height/2 });

  await page.waitForTimeout(900);
  let detailOpen = await page.locator('#detail-sheet.open').count();
  let daySheetOpen = await page.locator('#day-logs-sheet.open').count();
  console.log('FORGIVING PATH RESULT: detail open =', detailOpen, '| day-logs open =', daySheetOpen);

  console.log('--- recent logs ---');
  console.log(logs.slice(-10).join('\n'));
  await browser.close();
})().catch(async err => { console.error(err); process.exit(1); });
