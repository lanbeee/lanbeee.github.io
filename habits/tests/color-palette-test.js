const assert = require('node:assert/strict');
const {chromium} = require('playwright');
(async()=>{
  const browser = await chromium.launch();
  try{
    const page = await browser.newPage({viewport:{width:390,height:844}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
    });
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/');
    await page.waitForFunction(()=>document.documentElement.dataset.palette);
    assert.equal(await page.getAttribute('html','data-palette'),'default');
    await page.locator('#open-about').click();
    await page.locator('#open-settings').click();
    await page.locator('#settings-appearance-head').click();
    const colors=new Set();
    for(const palette of ['default','neutral','sage','sky','lavender','sand']){
      const button=page.locator(`[data-palette-value="${palette}"]`);
      await button.click();
      assert.equal(await button.getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('.palette-option[aria-pressed="true"]').count(),1);
      const themeColors=[];
      for(const theme of ['light','dark']){
        await page.locator(`#theme-mode-seg [data-seg-value="${theme}"]`).click();
        const values=await page.evaluate(()=>{
          const css=getComputedStyle(document.documentElement);
          return {palette:document.documentElement.dataset.palette,bg:css.getPropertyValue('--bg').trim(),text:css.getPropertyValue('--text').trim(),accent:css.getPropertyValue('--teal-bg').trim()};
        });
        assert.equal(values.palette,palette);
        assert.notEqual(values.bg,values.text);
        themeColors.push(values.bg+values.accent);
      }
      assert.notEqual(themeColors[0],themeColors[1],'light and dark both apply');
      colors.add(themeColors.join(','));
    }
    assert.equal(colors.size,6,'all six palettes have distinct surface/accent combinations');
    await page.locator('[data-palette-value="sky"]').focus();
    await page.keyboard.press('Enter');
    await page.reload();
    await page.waitForFunction(()=>document.documentElement.dataset.palette === 'sky');
    assert.equal(await page.evaluate(()=>loadSortSettings().colorPalette),'sky','keyboard selection persists');
    await page.evaluate(()=>updateSortSetting({themeMode:'system',fontScale:'large'}));
    await page.emulateMedia({colorScheme:'light'});
    const light=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--bg'));
    await page.emulateMedia({colorScheme:'dark'});
    const dark=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--bg'));
    assert.notEqual(light,dark,'palette follows system theme');
    await page.setViewportSize({width:320,height:844});
    await page.evaluate(()=>{openSheet('settings-sheet');document.getElementById('settings-appearance-head').click();});
    await page.locator('#color-palette-picker').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#color-palette-picker').evaluate(el=>el.scrollWidth>el.clientWidth),false,'swatches fit at 320px with large text');
    await page.evaluate(()=>updateSortSetting({colorPalette:'unknown'}));
    assert.equal(await page.getAttribute('html','data-palette'),'default','invalid palette falls back safely');
    assert.deepEqual(errors,[]);
    console.log('PASS: six palettes, both themes, keyboard, persistence, system theme, narrow layout, invalid fallback');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
