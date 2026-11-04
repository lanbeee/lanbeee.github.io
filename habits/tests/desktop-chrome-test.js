// Desktop shell: the wordmark, search, and add stay in the top bar, and a
// modal covers the right-pane search instead of sitting under it.
const assert = require('node:assert/strict');
const playwright = require('playwright');

(async()=>{
  const browser = await playwright[process.env.BROWSER || 'chromium'].launch();
  const context = await browser.newContext({
    viewport:{width:1440,height:900},
    serviceWorkers:'block'
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.addInitScript(()=>{
      localStorage.setItem('tings_v2',JSON.stringify([{
        hid:'desk-lamp',name:'Desk lamp',type:'keepup',target:1,logs:[],priority:2
      }]));
    });
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'load'});
    await page.waitForFunction(()=>document.body.dataset.paneCount === '3');
    await page.waitForSelector('#list .ting-card');

    const boxOf = async selector=>{
      const box = await page.locator(selector).boundingBox();
      assert.ok(box && box.width >= 24 && box.height >= 24,`${selector} is not rendered`);
      return box;
    };
    const logo = await boxOf('#bar-open-about');
    const search = await boxOf('#bar-open-search');
    const add = await boxOf('#bar-open-add');
    const bar = await boxOf('#app-bar');
    for(const box of [logo,search,add]){
      assert.ok(box.y >= bar.y - 1 && box.y + box.height <= bar.y + bar.height + 1,'control sits in the top bar');
      assert.ok(box.x >= 0 && box.x + box.width <= 1440,'control is inside the desktop window');
    }
    assert.ok(logo.x < 80,'wordmark stays at the leading edge');
    assert.ok(search.x > add.x,'search sits with add at the trailing edge');

    await page.evaluate(()=>document.getElementById('app-bar').setAttribute('hidden',''));
    const forced = await page.locator('#bar-open-add').boundingBox();
    assert.ok(forced && forced.width >= 24,'a leftover hidden attribute cannot remove the desktop bar');

    await page.locator('#bar-open-search').click();
    await page.waitForSelector('#app-bar-search.is-open');
    assert.equal(await page.locator('#habit-search').inputValue(),'');
    await page.locator('#bar-open-search').click();
    await page.waitForFunction(()=>!document.getElementById('app-bar-search').classList.contains('is-open'));

    const stack = await page.evaluate(()=>{
      openDetail(0);
      openSheet('assistant-sheet');
      const within = (root,node)=>Boolean(root && node && (node === root || root.contains(node)));
      const hit = rect=>{
        const node = document.elementsFromPoint(rect.left + rect.width / 2,rect.top + Math.min(20,rect.height / 2))[0];
        return node;
      };
      const dock = document.querySelector('.pane-detail .sheet-search-dock').getBoundingClientRect();
      const logoBox = document.getElementById('bar-open-about').getBoundingClientRect();
      const assistant = document.getElementById('assistant-sheet');
      const bar = document.getElementById('app-bar');
      const dockHit = hit(dock);
      const logoHit = hit(logoBox);
      const assistantBox = assistant.querySelector('.assistant-sheet').getBoundingClientRect();
      return {
        dockCovered:within(assistant,dockHit) && !within(document.querySelector('.pane-detail'),dockHit),
        dockHidden:getComputedStyle(document.querySelector('.pane-detail .sheet-search-dock')).visibility === 'hidden',
        logoStays:within(bar,logoHit) && !within(assistant,logoHit),
        assistantBelowBar:assistantBox.top >= bar.getBoundingClientRect().bottom - 1
      };
    });
    assert.equal(stack.dockCovered,true,'right-pane search stays under the assistant');
    assert.equal(stack.dockHidden,true,'the item close button does not sit beside an open modal');
    assert.equal(stack.logoStays,true,'wordmark stays available while a modal is open');
    assert.equal(stack.assistantBelowBar,true,'assistant card does not cover the top bar');
    await page.locator('#bar-open-add').click();
    await page.waitForSelector('#add-sheet.open');
    const addOnTop = await page.evaluate(()=>{
      const title = document.getElementById('add-title').getBoundingClientRect();
      const hit = document.elementsFromPoint(title.left + 12,title.top + title.height / 2)[0];
      return document.getElementById('add-sheet').contains(hit);
    });
    assert.equal(addOnTop,true,'add opened from the bar paints above the assistant');

    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>getComputedStyle(document.getElementById('app-bar')).display === 'none');
    const phoneStack = await page.evaluate(()=>{
      openSheet('day-logs-sheet');
      openDetail(0);
      const detail = document.getElementById('detail-sheet');
      const logs = document.getElementById('day-logs-sheet');
      return {
        inline:detail.style.zIndex,
        detailBehind:parseInt(getComputedStyle(detail).zIndex,10) < parseInt(getComputedStyle(logs).zIndex,10)
      };
    });
    assert.equal(phoneStack.inline,'','phone detail keeps its stylesheet layer');
    assert.equal(phoneStack.detailBehind,true,'phone detail stays behind the day sheet');
    await page.evaluate(()=>{
      closeSheet('detail-sheet');
      closeSheet('day-logs-sheet');
    });
    await page.setViewportSize({width:1280,height:800});
    await page.waitForFunction(()=>{
      const bar = document.getElementById('app-bar');
      const search = document.getElementById('bar-open-search');
      const style = getComputedStyle(bar);
      return document.body.dataset.paneCount === '3'
        && style.display === 'flex'
        && search.getBoundingClientRect().width >= 24
        && !search.classList.contains('is-hidden');
    });
    assert.deepEqual(errors,[]);
    console.log('PASS desktop chrome: top bar stays rendered and modals cover the right-pane search');
  }finally{
    await browser.close();
  }
})().catch(error=>{
  console.error(error);
  process.exitCode = 1;
});
