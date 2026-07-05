const { chromium } = require('playwright');

const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';
const runId = `E2E ${Date.now()}`;
const scheduledName = `${runId} dentist appointment`;
const habitName = `${runId} daily walk`;

function pad(n){ return String(n).padStart(2,'0'); }
function dateInput(d){
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function datetimeInput(d){
  return `${dateInput(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

(async()=>{
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true });
  const errors = [];
  page.on('console', msg => {
    if(msg.type() === 'error')errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));

  await page.goto(baseUrl, { waitUntil:'domcontentloaded' });
  await page.waitForSelector('#open-add');

  async function addScheduledTask(){
    const when = new Date(Date.now() + 30 * 60 * 1000);
    if(dateInput(when) !== dateInput(new Date())){
      when.setTime(Date.now() + 5 * 60 * 1000);
    }
    await page.locator('#open-add').click();
    await page.locator('#ting-message').fill(scheduledName);
    await page.locator('#type-seg [data-v="task"]').click();
    await page.locator('#ting-due-date').fill(dateInput(when));
    await page.locator('#add-more-toggle').click();
    await page.locator('#ting-scheduled-time').fill(datetimeInput(when));
    await page.locator('#do-save').click();
    await page.waitForSelector('#detail-sheet.open, #pane-detail .detail-sheet', { timeout:5000 });
    await page.locator('#detail-scheduled-row').waitFor({ state:'visible' });
    await page.locator('#detail-due-row').waitFor({ state:'visible' });
    const typeOn = await page.locator('#detail-type-seg [data-detail-type="task"]').evaluate(el => el.classList.contains('on'));
    if(!typeOn)throw new Error('Scheduled task did not stay on task type');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('tings_v2')));
    const item = stored.find(h => h.name === scheduledName);
    if(!item)throw new Error('Scheduled task was not saved');
    if(item.type !== 'task')throw new Error(`Scheduled task saved with wrong type: ${item.type}`);
    if(!item.eventTime)throw new Error('Scheduled task missing eventTime');
    await page.locator('#detail-cool').click();
    return item;
  }

  async function verifyCalendarOverview(){
    await page.locator('#open-overview').click();
    await page.waitForSelector('#overview-sheet.open, #pane-overview .overview-sheet');
    const plannedText = await page.locator('#overview-stats').textContent();
    if(!/planned/.test(plannedText || ''))throw new Error('Calendar overview did not render planned stats');
    await page.locator('#overview-close').click();
  }

  async function completeScheduledTask(){
    await page.locator('#list .ting-card', { hasText:scheduledName }).click();
    await page.waitForSelector('#detail-sheet.open, #pane-detail .detail-sheet');
    await page.locator('#detail-mark').click();
    await page.waitForTimeout(250);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('tings_v2')));
    const item = stored.find(h => h.name === scheduledName);
    if(!item?.lastLog)throw new Error('Scheduled task was not completed via detail mark');
    await page.locator('#detail-cool').click();
  }

  async function addAndLogHabit(){
    await page.locator('#open-add').click();
    await page.locator('#ting-message').fill(habitName);
    await page.locator('#type-seg [data-v="keepup"]').click();
    await page.locator('#do-save').click();
    await page.waitForSelector('#detail-sheet.open, #pane-detail .detail-sheet');
    await page.locator('#detail-cool').click();
    await page.locator('#list .ting-card', { hasText:habitName }).locator('[data-pulse]').click();
    await page.waitForFunction((habitName) => {
      const items = JSON.parse(localStorage.getItem('tings_v2') || '[]');
      return Boolean(items.find(h => h.name === habitName)?.lastLog);
    }, habitName, { timeout:2000 });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('tings_v2')));
    const item = stored.find(h => h.name === habitName);
    if(!item?.lastLog)throw new Error('Habit quick log did not create lastLog');
  }

  async function cleanupRunItems(){
    await page.evaluate((runId) => {
      const raw = localStorage.getItem('tings_v2');
      if(!raw)return;
      const items = JSON.parse(raw);
      localStorage.setItem('tings_v2',JSON.stringify(items.filter(h => !String(h.name || '').startsWith(runId))));
    }, runId);
  }

  await addScheduledTask();
  await verifyCalendarOverview();
  await completeScheduledTask();
  await addAndLogHabit();
  await cleanupRunItems();

  if(errors.length)throw new Error(errors.join('\n'));
  await browser.close();
  console.log('E2E smoke passed');
})().catch(async err=>{
  console.error(err);
  process.exit(1);
});
