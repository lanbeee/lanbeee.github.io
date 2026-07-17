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
  page.on('pageerror', err => logs.push(`[PAGEERROR] ${err.message}`));
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

  // Tap a day cell to open day-logs-sheet
  const planCell = await page.locator('#overview-calendar [data-log-day]').filter({ has: page.locator('.cal-dot.plan') }).last();
  await planCell.click();
  await page.locator('#day-logs-sheet.open').waitFor();
  console.log('day-logs-sheet opened (after click on day cell)');

  const openBtn = page.locator('#day-logs-list .overview-item', { hasText: name }).locator('[data-open-day-item]');
  const btnBox = await openBtn.boundingBox();
  console.log('open button box:', JSON.stringify(btnBox));

  // Simulate a realistic tap WITH movement (the forgiving button path)
  console.log('--- simulating open tap with ~25px movement ---');
  await simulateTouch(page, btnBox.x + btnBox.width/2, btnBox.y + btnBox.height/2, 25);
  await page.waitForTimeout(900);

  let detailOpen = await page.locator('#detail-sheet.open').count();
  let daySheetOpen = await page.locator('#day-logs-sheet.open').count();
  console.log('MOVE TAP: detail open =', detailOpen, '| day-logs open =', daySheetOpen);

  console.log('--- recent logs ---');
  console.log(logs.slice(-10).join('\n'));
  await browser.close();
})().catch(async err => { console.error(err); process.exit(1); });

async function simulateTouch(page, x, y, move){
  const steps = 4;
  await page.touchscreen.tap(x, y).catch(()=>{});
  // touchscreen.tap doesn't allow movement; use CDP-free pointer events via evaluate
  await page.evaluate(({x,y,move,steps}) => {
    const el = document.elementFromPoint(x, y);
    const make = (type, cx, cy) => new PointerEvent(type, {
      bubbles:true, cancelable:true, pointerId:1, pointerType:'touch',
      clientX:cx, clientY:cy, isPrimary:true
    });
    const down = make('pointerdown', x, y);
    el.dispatchEvent(down);
    document.dispatchEvent(down);
    let i = 0;
    const iv = setInterval(()=>{
      i++;
      const cx = x + (move * i)/steps;
      const cy = y + (move * i)/steps;
      const mv = make('pointermove', cx, cy);
      el.dispatchEvent(mv);
      document.dispatchEvent(mv);
      if(i >= steps){
        clearInterval(iv);
        const up = make('pointerup', x + move, y + move);
        el.dispatchEvent(up);
        document.dispatchEvent(up);
        // fire native click
        const clk = new MouseEvent('click',{bubbles:true,cancelable:true,clientX:x+move,clientY:y+move});
        el.dispatchEvent(clk);
      }
    }, 20);
  }, {x, y, move, steps});
  await page.waitForTimeout(200);
}
