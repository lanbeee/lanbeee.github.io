const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const client = await page.context().newCDPSession(page);
  await page.setContent('<div style="height:4000px;background:linear-gradient(red,yellow)"></div>');
  await page.evaluate(() => window.scrollTo(0, 800));
  await new Promise(r => setTimeout(r, 300));
  // try drag up
  await client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x:195, y:600, radiusX:10, radiusY:10, force:1, id:0}], modifiers:0 });
  for(let i = 1; i <= 12; i++){
    await client.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{x:195, y:600 - i*12, radiusX:10, radiusY:10, force:1, id:0}], modifiers:0 });
    await new Promise(r => setTimeout(r, 16));
  }
  await client.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[{x:195, y:456, id:0}], modifiers:0 });
  await new Promise(r => setTimeout(r, 300));
  console.log('after CDP touch drag, scrollY =', await page.evaluate(() => window.scrollY));
  // try synthesizeScrollGesture
  await client.send('Input.synthesizeScrollGesture', {
    x:195, y:600, xDistance:0, yDistance:-400, speed:800, gestureSourceType:'touch'
  });
  await new Promise(r => setTimeout(r, 400));
  console.log('after synthesizeScrollGesture, scrollY =', await page.evaluate(() => window.scrollY));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
