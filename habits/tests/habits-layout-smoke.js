const { chromium } = require('playwright');

const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

(async()=>{
  const browser = await chromium.launch();
  const cases = [
    {name:'mobile', viewport:{width:390,height:844}, isMobile:true},
    {name:'desktop', viewport:{width:1280,height:900}, isMobile:false}
  ];

  for(const testCase of cases){
    const page = await browser.newPage({viewport:testCase.viewport,isMobile:testCase.isMobile});
    const errors = [];
    page.on('console', msg => { if(msg.type() === 'error')errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(baseUrl,{waitUntil:'domcontentloaded'});
    const addButton = testCase.name === 'desktop' ? '#bar-open-add' : '#open-add';
    await page.locator(addButton).waitFor({state:'visible'});
    await page.locator(addButton).click();
    await page.waitForSelector('#add-sheet.open');
    await page.locator('#type-seg [data-v="task"]').click();
    await page.locator('#task-due-row').waitFor({state:'visible'});
    await page.locator('#add-more-toggle').click();
    await page.locator('#scheduled-time-row').waitFor({state:'visible'});
    await page.waitForTimeout(450);
    const box = await page.locator('#add-sheet .sheet').boundingBox();
    if(!box || box.width <= 0 || box.height <= 0)throw new Error(`${testCase.name}: add sheet is not measurable`);
    await page.screenshot({path:`/private/tmp/habits-${testCase.name}.png`,fullPage:true});
    if(errors.length)throw new Error(`${testCase.name}: ${errors.join('\n')}`);
    await page.close();
  }
  await browser.close();
  console.log('Layout smoke passed');
})().catch(err=>{
  console.error(err);
  process.exit(1);
});
