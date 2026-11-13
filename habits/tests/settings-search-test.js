// Settings search should land on the right control when the words are close
// but not the label itself.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');

(async()=>{
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.addInitScript(()=>{
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
      // Distinctive saved-place fixture: search must never surface user data.
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({locations:[
        {id:'loc-zzyxx',name:'Zzyxx Fitness',address:'742 Evergreen Terrace',lat:31.52,lng:74.35}
      ]}));
      const viewport = new EventTarget();
      Object.assign(viewport,{height:844,width:390,offsetTop:0,offsetLeft:0,scale:1});
      Object.defineProperty(window,'visualViewport',{value:viewport,configurable:true});
    });
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'networkidle'});
    await page.waitForFunction(()=>typeof renderSettingsSearch === 'function' && document.querySelector('[data-setting-toggle="minimalMode"]'));
    const labelsFor = query=>page.evaluate(query=>{
      $('settings-search-input').value = query;
      renderSettingsSearch();
      return [...document.querySelectorAll('#settings-search-results b')].map(el=>el.textContent);
    },query);
    const expectHit = async(query,label)=>{
      const labels = await labelsFor(query);
      assert.ok(labels.includes(label),`${query} → ${labels.slice(0,8).join(', ')}`);
    };
    await expectHit('notification','reminders');
    await expectHit('dark mode','appearance');
    await expectHit('theme','theme');
    await expectHit('simple','minimal mode');
    await expectHit('sleep','busy times');
    await expectHit('celsius','weather guidance');
    await expectHit('tag','topics');
    await expectHit('download','export backup');
    await expectHit('restore','import backup');
    await expectHit('wipe','clear all data');
    await expectHit('sunrise','relative times');
    await expectHit('qwen','local assistant');
    await expectHit('place','locations');
    assert.deepEqual(await labelsFor('night'),['appearance']);
    assert.deepEqual(await labelsFor('mute'),['gentle sounds']);
    const ai = await labelsFor('ai');
    assert.ok(ai.includes('local assistant'),ai.join(', '));
    assert.ok(ai.length < 8,ai.join(', '));
    const address = await labelsFor('address');
    assert.ok(address.includes('locations'),address.join(', '));
    assert.ok(address.every(label=>!label.includes('Photon')),address.join(', '));
    assert.deepEqual(await labelsFor('zzzz-not-a-setting'),[]);

    // Ranked destinations: the narrowest matching control leads.
    const first = async query=>(await labelsFor(query))[0];
    assert.equal(await first('weather'),'weather guidance');
    assert.equal(await first('font'),'font size');
    assert.equal(await first('duration'),'duration');
    const dark = await labelsFor('dark');
    assert.ok(dark.includes('theme'));
    assert.ok(!dark.includes('light') && !dark.includes('system'),'group aliases never match contradictory choices');
    assert.deepEqual(await labelsFor('urgent'),['importance'],'priority aliases describe the field, not every P0–P5 choice');
    const needle = await labelsFor('needle');
    assert.ok(needle.includes('model source'));
    assert.ok(!needle.includes('auto server') && !needle.includes('LM Studio / API'),'provider aliases stay on their field');
    // Associated-control aliases: sublabels bound with label[for], seg-group
    // ids, and unassociated heading spans each resolve their own synonyms.
    await expectHit('overnight','all-day events');
    await expectHit('attachment','choose ICS or PDF');
    await expectHit('commute','default travel mode');
    // Typos (deletion, transposition), plurals, case, and accents.
    await expectHit('remnders','reminders');
    await expectHit('notificaiton','reminders');
    await expectHit('reminders','reminders');
    await expectHit('DARK MODE','appearance');
    assert.deepEqual(await labelsFor('héllo'),[]);
    // Saved places and addresses stay unindexed even when distinctive.
    await page.evaluate(()=>renderLocationControls());
    assert.equal(await page.locator('#location-list .location-name').inputValue(),'Zzyxx Fitness','privacy fixture is mounted before searching');
    assert.deepEqual(await labelsFor('Zzyxx'),[]);
    assert.deepEqual(await labelsFor('Evergreen'),[]);
    assert.ok((await labelsFor('address')).every(label=>!label.includes('Zzyxx')));
    assert.deepEqual(await labelsFor('<script>alert(1)</script>'),[]);
    const browse = await labelsFor('');
    assert.ok(browse.length > 40,'empty query retains all settings');
    assert.deepEqual(browse,[...browse].sort((a,b)=>a.localeCompare(b)),'empty query preserves alphabetical browsing');
    await labelsFor('day');
    const dayResult = page.locator('#settings-search-results button').filter({has:page.locator('b',{hasText:'all-day events'})});
    assert.equal(await dayResult.locator('b mark').textContent(),'day','punctuation uses the same word boundaries for matching and highlighting');
    assert.equal(await dayResult.locator('b').textContent(),'all-day events','highlighting preserves the result name');

    await page.locator('#open-about').tap();
    await page.waitForFunction(()=>$('settings-sheet').classList.contains('open'));
    await page.evaluate(()=>document.querySelector('#settings-sheet .settings-stack').scrollTop=600);
    const returnScroll = await page.locator('#settings-sheet .settings-stack').evaluate(el=>el.scrollTop);
    const savedSettings = await page.evaluate(()=>JSON.stringify(sortSettings));
    await page.locator('#settings-search-toggle').tap();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'settings-search-input','tap opens the keyboard field immediately');
    await page.locator('#settings-search-input').fill('weather');
    await page.locator('#settings-search-toggle').tap();
    assert.ok(await page.locator('#settings-search-panel').isVisible(),'loupe refocuses the open search');
    assert.equal(await page.locator('#settings-search-input').inputValue(),'weather');
    assert.equal(await page.locator('#settings-close').isVisible(),false,'the settings exit does not compress the search field');
    assert.equal(await page.locator('#settings-search-input').evaluate(el=>getComputedStyle(el).outlineStyle),'none','search has the same flat focus style as detail');
    assert.equal(await page.locator('#settings-sheet .sheet-search-dock').evaluate(el=>getComputedStyle(el).borderRadius),'28px');

    // Follow each IME frame, including a panned visual viewport and retained
    // home-indicator inset, without lifting the dock twice.
    await page.evaluate(()=>document.documentElement.style.setProperty('--safe-area-inset-bottom','34px'));
    const resize = (height,offsetTop=0)=>page.evaluate(async({height,offsetTop})=>{
      Object.assign(visualViewport,{height,offsetTop});
      visualViewport.dispatchEvent(new Event('resize'));
      visualViewport.dispatchEvent(new Event('scroll'));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    },{height,offsetTop});
    for(const [height,offset] of [[740,0],[640,0],[510,34],[680,0],[844,0]]){
      await resize(height,offset);
      const dock = await page.locator('#settings-sheet .sheet-search-dock').boundingBox();
      const expected = height + offset - (height===844 ? 34 : 0);
      assert.ok(Math.abs(dock.y+dock.height-expected)<=1,`settings dock meets keyboard/safe edge at ${height}+${offset}: ${JSON.stringify(dock)}`);
      const input = await page.locator('#settings-search-input').boundingBox();
      assert.ok(input.y>=offset && input.y+input.height<=expected,'typed text stays visible');
      for(const [selector,size] of [['#settings-search-dismiss',44],['#settings-search-clear',32]]){
        const box = await page.locator(selector).boundingBox();
        assert.equal(box.width,size);assert.equal(box.height,size,'search icons remain circular');
      }
    }
    await page.locator('#settings-search-dismiss').tap();
    assert.ok(await page.locator('#settings-sheet').evaluate(el=>el.classList.contains('open')),'X closes search and retains Settings');
    assert.equal(await page.locator('#settings-sheet .settings-stack').evaluate(el=>el.scrollTop),returnScroll,'closing search restores the settings scroll');
    await page.locator('#settings-search-toggle').tap();
    await page.locator('#settings-open-about').tap();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#about-sheet').evaluate(el=>el.classList.contains('open')),false,'nested Help dismisses first');
    assert.ok(await page.locator('#settings-search-panel').isVisible(),'nested Help dismissal retains search');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#settings-search-panel').isVisible(),false);
    assert.ok(await page.locator('#settings-sheet').evaluate(el=>el.classList.contains('open')),'Escape only dismisses search');

    // Highlighting marks matched words only; alias-only hits stay unmarked.
    await page.locator('#settings-search-toggle').tap();
    await page.locator('#settings-search-input').fill('weather');
    assert.ok(await page.locator('#settings-search-results mark').first().isVisible(),'matched words are marked');
    await page.locator('#settings-search-input').fill('qwen');
    assert.equal(await page.locator('#settings-search-results mark').count(),0,'alias-only hits stay unmarked');
    // IME composition renders only after completion.
    await page.evaluate(()=>{
      const input = $('settings-search-input');
      input.value = 'zzzz-not-a-setting';
      input.dispatchEvent(new InputEvent('input',{data:input.value,isComposing:true}));
    });
    assert.equal(await page.locator('#settings-search-status').textContent(),'1 match','IME composition does not render mid-composition');
    await page.evaluate(()=>$('settings-search-input').dispatchEvent(new Event('compositionend')));
    assert.ok((await page.locator('#settings-search-status').textContent()).includes('No matching settings'),'completed composition renders');
    await page.locator('#settings-search-dismiss').tap();

    await page.locator('#settings-search-toggle').tap();
    await page.locator('#settings-search-input').fill('mute');
    await page.locator('#settings-search-input').press('ArrowDown');
    assert.equal(await page.evaluate(()=>document.activeElement.closest('#settings-search-results')?.id),'settings-search-results');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#settings-appearance-head').getAttribute('aria-expanded'),'true');
    assert.ok(await page.locator('[data-setting-toggle="soundEffects"]').isVisible());
    assert.equal(await page.evaluate(()=>JSON.stringify(sortSettings)),savedSettings,'search navigation never changes a setting');

    await page.evaluate(()=>document.documentElement.style.setProperty('--safe-area-inset-bottom','0px'));
    // Effective zoom widths, landscape, and desktop modal search. Expanded
    // settings remain scrollable and all circular controls keep their shape.
    for(const [width,height,lift] of [[200,380,0],[240,420,0],[320,568,240],[390,400,220],[844,390,180],[1440,900,350]]){
      await page.setViewportSize({width,height});
      await page.waitForTimeout(250); // Allow the responsive pane transition to finish.
      await resize(height-lift);
      await page.evaluate(()=>{
        sortSettings.fontScale='large';applyAppearanceSettings();openSettingsSheet();
        document.querySelectorAll('#settings-sheet .settings-collapse-body').forEach(el=>el.hidden=false);
      });
      const layout = await page.evaluate(()=>({
        overflow:[...document.querySelectorAll('#settings-sheet .settings-block')].filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>el.querySelector('.settings-label')?.textContent),
        circles:[...document.querySelectorAll('#settings-sheet button')].filter(el=>el.getClientRects().length && getComputedStyle(el).borderRadius==='50%').map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}))
      }));
      assert.deepEqual(layout.overflow,[],`expanded settings overflow at ${width}`);
      layout.circles.forEach(box=>assert.equal(box.width,box.height,`squashed control at ${width}`));
      await page.evaluate(()=>setSettingsSearchOpen(true));
      await page.locator('#settings-search-input').fill('weather');
      for(const selector of ['#settings-search-input','#settings-search-dismiss']){
        const box = await page.locator(selector).boundingBox();
        assert.ok(box.x>=0 && box.x+box.width<=width+1 && box.y>=0 && box.y+box.height<=height-lift+1,`${selector} covered at ${width}x${height}: ${JSON.stringify(box)}`);
      }
      await page.locator('#settings-search-clear').tap();
      assert.equal(await page.locator('#settings-search-input').inputValue(),'');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'settings-search-input');
    }

    // Android resizes the layout viewport itself; visualViewport can still
    // contain the previous keyboard deduction on that first frame.
    await page.setViewportSize({width:390,height:844});
    await page.waitForTimeout(250);
    await resize(844);
    await page.evaluate(()=>{window.TingsNative={isNative:true,platform:'android'};updateKeyboardLift();});
    await page.setViewportSize({width:390,height:494});
    await resize(144);
    const nativeDock = await page.locator('#settings-sheet .sheet-search-dock').boundingBox();
    assert.ok(Math.abs(nativeDock.y+nativeDock.height-494)<=1,`native search uses the resized WebView edge once: ${JSON.stringify(nativeDock)}`);
    await page.setViewportSize({width:390,height:844});
    await resize(844);
    await page.evaluate(()=>{delete window.TingsNative;sortSettings.minimalMode=true;applyAppearanceSettings();});
    assert.equal(await page.locator('#settings-search-toggle').isVisible(),false,'minimal mode hides search');
    assert.ok(await page.locator('#settings-close').isVisible(),'minimal mode keeps the close cross reachable');
    assert.deepEqual(errors,[]);
    console.log('PASS settings search navigation, shared dock, keyboard geometry, native resize and narrow controls');
  }finally{
    await browser.close();
  }
})().catch(err=>{console.error(err);process.exit(1);});
