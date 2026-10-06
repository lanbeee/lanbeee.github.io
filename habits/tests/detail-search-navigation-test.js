const assert = require('node:assert/strict');
const playwright = require('playwright');
const { baseHabit } = require('./helpers/planner-test-helpers');
(async()=>{
  const browser = await playwright[process.env.BROWSER || 'chromium'].launch();
  try{
    const page = await browser.newPage({viewport:{width:390,height:844}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({minimalMode:false,showWeekOnHome:false}));
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
    });
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'networkidle'});
    await page.evaluate(h=>{save([h,{...h,hid:'search-task',name:'Task',type:'task',dueDate:Date.now()+86400000}]);openDetail(0);},baseHabit({hid:'search-habit',name:'Search fixture'}));
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#detail-duration-disclosure').getAttribute('open'),'');
    assert.equal(await page.locator('#detail-logging-disclosure').getAttribute('open'),null);
    assert.equal(await page.locator('#detail-availability-disclosure').getAttribute('open'),null);
    const search=async query=>{
      if(!await page.locator('#detail-search-panel').isVisible())await page.locator('#detail-search-toggle').click();
      await page.locator('#detail-search-input').fill(query);
    };
    const result=label=>page.locator('.detail-search-result').filter({has:page.locator('b',{hasText:label})});
    const choose=async(query,label)=>{await search(query);await result(label).first().click();await page.waitForTimeout(80);};
    const original=await page.evaluate(()=>JSON.stringify(load()));
    const tabs=page.locator('.detail-page-tab');
    await tabs.nth(2).click();await page.waitForTimeout(350);
    await tabs.nth(2).focus();await page.keyboard.press('ArrowRight');
    assert.equal(await tabs.nth(3).getAttribute('aria-selected'),'true','arrow keys navigate labeled tabs');
    const navBox=await page.locator('.detail-page-nav').boundingBox();
    const pagerBox=await page.locator('.detail-pager').boundingBox();
    const footerBox=await page.locator('.detail-bottom-bar').boundingBox();
    assert.ok(navBox.y+navBox.height<=pagerBox.y && pagerBox.y+pagerBox.height<=footerBox.y,'navigation and footer reserve their own space');
    assert.ok(await tabs.nth(1).locator('span').isVisible(),'tab labels are visible on a phone');
    await page.evaluate(()=>{
      const panel=getSheetInner('detail-sheet').querySelector('[data-detail-nav="identity"]');
      panel.querySelectorAll('details').forEach(d=>d.open=true);panel.scrollTop=9999;
    });
    const returnScroll=await page.locator('[data-detail-nav="identity"]').evaluate(el=>el.scrollTop);
    assert.ok(returnScroll>0,'the return-position fixture scrolls');
    await search('weather');
    assert.equal(await page.locator('#detail-cool').getAttribute('aria-label'),'close detail search');
    await page.locator('#detail-search-toggle').click();
    assert.ok(await page.locator('#detail-search-panel').isVisible(),'the search icon focuses search without dismissing it');
    const fieldBox=await page.locator('.detail-search-control').boundingBox();
    assert.ok(fieldBox.y>600,'search expands in the bottom dock');
    const radius=await page.locator('.detail-search-control').evaluate(el=>parseFloat(getComputedStyle(el).borderRadius));
    assert.ok(radius>=fieldBox.height/2,'search container is a rounded pill');
    await page.locator('#detail-cool').click();
    assert.equal(await tabs.nth(3).getAttribute('aria-selected'),'true','X returns to the same detail tab');
    assert.equal(await page.locator('[data-detail-nav="identity"]').evaluate(el=>el.scrollTop),returnScroll,'X restores the detail scroll position');
    assert.equal(await page.locator('#detail-search-input').isVisible(),false);
    await search('weather');await page.locator('#detail-cool').click();
    assert.equal(await page.evaluate(()=>detailIdx),0,'X dismisses search without closing the item');
    assert.equal(await page.locator('#detail-search-panel').isVisible(),false);
    assert.equal(await page.locator('#detail-cool').getAttribute('aria-label'),'close details');
    await page.locator('#detail-cool').click();
    assert.equal(await page.evaluate(()=>detailIdx),null,'X closes the item outside search');
    assert.equal(await page.locator('#detail-sheet').evaluate(el=>el.classList.contains('open')),false);
    await page.evaluate(()=>openDetail(0));await page.waitForTimeout(100);
    await search('duraton');
    assert.ok(await result('Duration').count()>0,'single-letter typo finds duration');
    await page.evaluate(()=>openDetail(0));
    assert.equal(await page.locator('#detail-search-input').inputValue(),'duraton','refresh preserves a live query');
    assert.ok(await page.locator('#detail-search-panel').isVisible());
    await choose('late DAYS','Delay allowance');
    assert.equal(await page.locator('#detail-flexibility-disclosure').getAttribute('open'),'');
    assert.ok(await page.locator('#detail-delay-allowance').isVisible());
    await choose('best hours','Preferred time window');
    assert.equal(await page.locator('#detail-schedule-preferred').getAttribute('hidden'),null);
    await choose('preferred places','Place preferences');
    assert.equal(await page.evaluate(()=>detailScheduleView),'preferred');
    await choose('minimum chunk','Minimum chunk');
    assert.equal(await page.locator('#detail-breakable').getAttribute('aria-pressed'),'false');
    assert.ok(await page.locator('#detail-breakable').isVisible());
    await choose('emoji color','Emoji background');
    assert.ok(await page.locator('#detail-emoji-bg').isVisible());
    await choose('weight','Log a value or note');
    assert.ok(await page.locator('#detail-track-value').isVisible());
    await search('<script>alert(1)</script>');
    assert.equal(await page.locator('.detail-search-result').count(),0);
    assert.ok((await page.locator('#detail-search-status').textContent()).includes('No matching'));
    await page.locator('#detail-search-clear').click();
    assert.ok(await page.locator('.detail-search-result').count()>40);
    await page.locator('#detail-search-input').fill('duration');
    await page.locator('#detail-search-input').press('ArrowDown');
    assert.ok(await page.locator('.detail-search-result').first().evaluate(el=>document.activeElement===el));
    await page.keyboard.press('Enter');
    assert.ok(await page.locator('#detail-duration').isVisible());
    assert.equal(await page.evaluate(()=>JSON.stringify(load())),original,'search must not mutate data');
    await search('weather');await page.keyboard.press('Escape');
    assert.equal(await page.locator('#detail-search-panel').isVisible(),false);
    assert.ok(await page.locator('#detail-cool').isVisible());
    // Expanding appearance is itself sufficient to expose its controls.
    await page.evaluate(()=>{closeDetail();openDetail(0);scrollDetailToNav('identity');});
    await page.waitForTimeout(100);
    await page.locator('#detail-appearance-disclosure > summary').click();
    assert.ok(await page.locator('#detail-emoji').isVisible());
    assert.ok(await page.locator('#detail-emoji-bg').isVisible());
    assert.ok(await page.locator('#detail-generic-emoji button').count()>0);
    await page.evaluate(()=>document.documentElement.style.setProperty('--keyboard-lift','300px'));
    const regularPagerHeight=(await page.locator('.detail-pager').boundingBox()).height;
    await page.locator('#detail-habit-message').focus();
    assert.equal(await page.locator('.detail-page-nav').isVisible(),false,'field keyboard hides page navigation');
    assert.equal(await page.locator('#detail-search-toggle').isVisible(),false,'field keyboard hides search');
    assert.ok((await page.locator('.detail-pager').boundingBox()).height>regularPagerHeight,'editing gives space back to fields');
    assert.ok(await page.locator('#detail-cool').isVisible(),'exit stays reachable while focusing an unchanged field');
    await page.locator('#detail-habit-message').blur();
    await page.waitForTimeout(50);
    assert.ok(await page.locator('.detail-page-nav').isVisible(),'navigation returns after editing');
    assert.ok(await page.locator('#detail-search-toggle').isVisible());
    await search('name');
    assert.ok(await page.locator('#detail-search-input').isVisible(),'search keeps its own keyboard field');
    await page.locator('#detail-cool').click();
    await page.evaluate(()=>document.documentElement.style.setProperty('--keyboard-lift','0px'));
    // A tap that leaves the keyboard field must complete before the restored
    // navigation can move its intended button.
    await page.locator('#detail-habit-message').focus();
    await page.evaluate(()=>{document.documentElement.style.setProperty('--keyboard-lift','300px');syncDetailEditingChrome();});
    const taskButton=page.locator('#detail-type-seg [data-detail-type="task"]');
    const taskBox=await taskButton.boundingBox();
    await page.mouse.move(taskBox.x+taskBox.width/2,taskBox.y+taskBox.height/2);
    await page.mouse.down();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.detail-page-nav').isVisible(),false,'navigation stays hidden until the tap finishes');
    await page.mouse.up();
    assert.ok(await taskButton.evaluate(el=>el.classList.contains('on')),'the intended type button receives the tap');
    await page.locator('#detail-close').click();
    assert.equal(await page.evaluate(()=>load()[0].type),'keepup','cancel still restores the item after keyboard editing');
    await page.evaluate(()=>{document.documentElement.style.setProperty('--keyboard-lift','0px');openDetail(0);});
    // Dirty edit Cancel restores the snapshot through the existing Cancel path.
    await choose('name','Name');await page.locator('#detail-habit-message').fill('Changed name');
    await page.locator('#detail-habit-message').blur();
    assert.equal(await page.locator('#detail-search-toggle').isVisible(),false);
    assert.equal(await page.locator('#detail-cool').isVisible(),false);
    assert.ok(await page.locator('#detail-save').isVisible());
    await page.locator('#detail-close').click();
    assert.equal(await page.evaluate(()=>load()[0].name),'Search fixture');
    await page.setViewportSize({width:320,height:568});await page.waitForTimeout(250);
    await page.evaluate(()=>{
      const data=load();data.push({...data[0],hid:'long-title',name:'A very long habit name with link shortcuts in the header',type:'task',dueDate:Date.now()+86400000,eventTime:Date.now()+86400000,allowedTimeStartAnchor:'sunrise',allowedTimeEndAnchor:'sunset',scheduleOptions:[{weekdays:[],start:600,end:720}],scheduleLinks:[{anchorHid:'search-habit',direction:'before'}],links:[{kind:'link',value:'https://example.com'},{kind:'phone',value:'+15551234567'}]});save(data);openDetail(2);
    });await page.waitForTimeout(350);
    assert.ok((await page.locator('.detail-title-wrap').boundingBox()).width>100,'links cannot squeeze the name');
    const linkedClose=await page.locator('#detail-cool').boundingBox();assert.ok(linkedClose.y+linkedClose.height<=568);
    assert.equal(await page.locator('.detail-page-nav .detail-page-tab').count(),5,'page navigation sits above the content');
    assert.equal(await page.locator('.detail-bottom-bar .detail-page-tab').count(),0,'footer is reserved for search and exit');
    await page.locator('#detail-cool').click();
    // Every layout keeps bottom dismissal visible after long scrolls.
    for(const [width,height] of [[320,568],[844,390],[1440,900],[390,400]]){
      await page.setViewportSize({width,height});await page.waitForTimeout(300);
      await page.evaluate(()=>{
        openDetail(1);scrollDetailToNav('effort');
        getSheetInner('detail-sheet').querySelectorAll('details').forEach(d=>d.open=true);
        getSheetInner('detail-sheet').querySelector('[data-detail-nav="effort"]').scrollTop=9999;
      });await page.waitForTimeout(100);
      for(const selector of ['#detail-cool']){
        const box=await page.locator(selector).boundingBox();
        assert.ok(box && box.y>=0 && box.y+box.height<=height+1 && box.x>=0 && box.x+box.width<=width+1,`${selector} clipped ${width}x${height}: ${JSON.stringify(box)}`);
      }
      await choose('due date','Due date');assert.ok(await page.locator('#detail-due-date').isVisible());
      await page.locator('#detail-cool').click();
    }
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);
    await page.evaluate(()=>{
      openDetail(0);document.documentElement.style.setProperty('--keyboard-lift','300px');
      document.documentElement.style.setProperty('--safe-area-inset-top','36px');
      document.documentElement.style.setProperty('--safe-area-inset-bottom','24px');
      setDetailDirty(true);
    });
    await page.waitForTimeout(350);
    for(const selector of ['#detail-save','#detail-close']){
      const box=await page.locator(selector).boundingBox();
      assert.ok(box.y>=36 && box.y+box.height<=544,`${selector} hidden under keyboard or inset: ${JSON.stringify(box)}`);
    }
    await page.evaluate(()=>{
      setDetailDirty(false);closeDetail();document.documentElement.style.setProperty('--keyboard-lift','0px');
      document.documentElement.style.setProperty('--safe-area-inset-top','0px');
      document.documentElement.style.setProperty('--safe-area-inset-bottom','0px');
    });
    // A landscape keyboard and a keyboard in a mounted desktop pane also
    // reduce the usable sheet height, rather than covering its footer.
    for(const [width,height,lift] of [[390,400,220],[844,390,180],[1440,900,350]]){
      await page.setViewportSize({width,height});await page.waitForTimeout(250);
      await page.evaluate(lift=>{
        openDetail(0);document.documentElement.style.setProperty('--keyboard-lift',`${lift}px`);
        setDetailSearchOpen(true,false);
      },lift);
      await page.waitForTimeout(100);
      for(const selector of ['#detail-search-input','#detail-cool']){
        const box=await page.locator(selector).boundingBox();
        assert.ok(box && box.y>=0 && box.y+box.height<=height-lift+1,`${selector} covered by short-screen keyboard ${width}x${height}`);
      }
      await page.evaluate(()=>setDetailDirty(true));
      for(const selector of ['#detail-save','#detail-close']){
        const box=await page.locator(selector).boundingBox();
        assert.ok(box && box.y>=0 && box.y+box.height<=height-lift+1,`${selector} covered by short-screen keyboard`);
      }
      await page.locator('#detail-close').click();
      await page.evaluate(()=>document.documentElement.style.setProperty('--keyboard-lift','0px'));
    }
    await page.setViewportSize({width:390,height:568});await page.waitForTimeout(250);
    await page.evaluate(()=>{sortSettings.minimalMode=true;applyAppearanceSettings();openDetail(0);});
    assert.equal(await page.locator('#detail-search-toggle').isVisible(),false);
    assert.ok(await page.locator('#detail-duration').isVisible());
    assert.equal(await page.locator('#detail-priority-seg').isVisible(),false);
    assert.equal(await page.locator('#detail-emoji').isVisible(),false,'minimal mode keeps the optional picker collapsed');
    await page.locator('#detail-emoji-preview').click();
    assert.ok(await page.locator('#detail-emoji').isVisible(),'the emoji preview also opens the picker in minimal mode');
    await page.locator('#detail-cool').click();
    // Enlarged text and effective zoom widths: footer actions never share a row
    // with the title, and the actual controls stay inside each scrolled pane.
    await page.evaluate(()=>{sortSettings.minimalMode=false;applyAppearanceSettings();window.TingsNative={isNative:true};});
    for(const [width,height] of [[320,568],[240,420],[200,380],[844,390],[1440,900]]){
      await page.setViewportSize({width,height});await page.waitForTimeout(250);
      await page.evaluate(()=>{document.documentElement.style.setProperty('--font-scale','2');openDetail(2);});
      await page.waitForTimeout(350);
      for(const id of ['detail-search-toggle','detail-cool']){
        const box=await page.locator('#'+id).boundingBox();
        assert.ok(box && box.x>=0 && box.y>=0 && box.x+box.width<=width+1 && box.y+box.height<=height+1,`${id} fits at ${width}`);
        assert.ok(box.width>=44);assert.equal(box.height,44,'footer actions keep 44px touch targets');
        if(id==='detail-cool')assert.equal(box.width,44,'Close remains circular');
      }
      for(const nav of ['calendar','schedule','effort','identity','actions']){
        await page.evaluate(nav=>{getSheetInner('detail-sheet').querySelectorAll('details').forEach(d=>d.open=true);scrollDetailToNav(nav);},nav);
        await page.waitForTimeout(80);
        const overflow=await page.evaluate(nav=>{
          const panel=getSheetInner('detail-sheet').querySelector(`[data-detail-nav="${nav}"]`),bounds=panel.getBoundingClientRect();
          return [...panel.querySelectorAll('button,input,select,label')].filter(el=>el.getClientRects().length && !el.closest('[hidden]') && !el.closest('.tag-row,.app-preset-list')).filter(el=>{
            const r=el.getBoundingClientRect();return r.left<bounds.left-1 || r.right>bounds.right+1;
          }).map(el=>el.id || el.className);
        },nav);
        assert.deepEqual(overflow,[],`fields clipped at ${width}: ${nav}`);
      }
      await search('duration');
      assert.equal(await page.locator('#detail-search-input').evaluate(el=>getComputedStyle(el).boxShadow),'none');
      assert.equal(await page.locator('#detail-search-input').evaluate(el=>getComputedStyle(el).outlineStyle),'none','search has no focus glow');
      await page.keyboard.press('Escape');
      await page.evaluate(()=>setDetailDirty(true));
      assert.equal(await page.locator('#detail-search-toggle').isVisible(),false);
      assert.equal(await page.locator('#detail-cool').isVisible(),false);
      for(const id of ['detail-save','detail-close']){
        const box=await page.locator('#'+id).boundingBox();assert.ok(box && box.x>=0 && box.y>=0 && box.x+box.width<=width+1 && box.y+box.height<=height+1,`${id} fits at ${width}`);
      }
      await page.locator('#detail-close').click();
    }
    await page.evaluate(()=>{document.documentElement.style.removeProperty('--font-scale');window.TingsNative={isNative:false};});
    await page.setViewportSize({width:390,height:568});await page.waitForTimeout(250);
    // Saving still commits the edit; cancelling above left its snapshot intact.
    await page.evaluate(()=>{openDetail(0);scrollDetailToNav('identity');});
    await page.locator('#detail-habit-message').fill('Saved fixture');await page.locator('#detail-habit-message').blur();
    await page.locator('#detail-save').click();assert.equal(await page.evaluate(()=>load()[0].name),'Saved fixture');
    // Exactly one existing exit stays reachable at both scroll extremes.
    const sheetIds=['about-sheet','privacy-sheet','overview-sheet','free-time-sheet','weather-context-sheet','weather-metric-sheet','weather-agenda-sheet','slipped-sheet','day-capacity-sheet','day-logs-sheet','settings-sheet','sample-habits-sheet','activity-sheet','snooze-sheet','value-log-sheet','home-filter-sheet','calendar-filter-sheet','presence-picker-sheet'];
    for(const viewport of [{width:390,height:568},{width:1440,height:900}]){
      await page.setViewportSize(viewport);await page.waitForTimeout(250);
      for(const id of sheetIds){
        if(id==='overview-sheet' && viewport.width>1000)continue; // Permanent calendar pane has no dismissal.
        await page.evaluate(id=>{
          if(id==='day-logs-sheet'){resetDayLogsStep();dayLogsKey=todayIso();renderDayLogs(dayLogsKey);}
          openSheet(id);openSheet(id); // Reopening must not add another exit.
          const inner=getSheetInner(id);
          const host=inner.querySelector('.settings-stack,#day-logs-body,#weather-agenda-content') || inner;
          let spacer=host.querySelector('.exit-test-spacer');
          if(!spacer){spacer=document.createElement('div');spacer.className='exit-test-spacer';spacer.style.height='1800px';spacer.style.flexShrink='0';host.append(spacer);}
          inner.scrollTop=0;
        },id);
        const button=page.locator(`#${id} [data-sheet-dismissal]`);
        assert.equal(await button.count(),1,`${id} has one original dismissal control`);
        if(id.includes('filter-sheet') || id==='presence-picker-sheet'){
          assert.ok(await button.evaluate(el=>Boolean(el.closest('.home-filter-sheet-head,.utility-sheet-head'))),`${id} keeps its X with the header`);
          assert.ok((await button.getAttribute('aria-label')).startsWith('close'));
        }
        const prefix=id.replace(/-sheet$/,'');
        const exitIds=[prefix+'-head-close',prefix+'-close',...(id.includes('filter-sheet') ? [] : [prefix+'-done'])];
        const visibleExits=await page.locator(`#${id} button`).evaluateAll((buttons,ids)=>buttons.filter(b=>(ids.includes(b.id)||b.hasAttribute('data-sheet-dismissal')) && b.getClientRects().length).length,exitIds);
        assert.equal(visibleExits,1,`${id} has no duplicate visible exits`);
        for(const scroll of [0,99999]){
          await page.evaluate(({id,scroll})=>{const inner=getSheetInner(id);(inner.querySelector('.settings-stack,#day-logs-body,#weather-agenda-content') || inner).scrollTop=scroll;},{id,scroll});
          const box=await button.boundingBox();
          assert.ok(box && box.y>=0 && box.y+box.height<=viewport.height,`${id} exit unreachable ${JSON.stringify(box)}`);
        }
        await page.waitForTimeout(550); // Let the existing scroll-tap guard settle.
        await page.waitForFunction(id=>!isScrollGuarded(document.querySelector(`#${id} [data-sheet-dismissal]`)),id);
        const exitBox=await button.boundingBox();
        await page.mouse.click(exitBox.x+exitBox.width/2,exitBox.y+exitBox.height/2);
        assert.equal(await page.locator(`#${id}`).evaluate(el=>el.classList.contains('open')),false,`${id} exit closes its sheet`);
      }
    }
    // Native controls are rendered/indexed only on native, including each edge.
    await page.evaluate(()=>{sortSettings.minimalMode=false;applyAppearanceSettings();window.TingsNative={isNative:true};openDetail(0);});
    await search('travel departure');
    assert.ok((await page.locator('#detail-search-results').textContent()).includes('travel: departure'));
    assert.equal(await result('Shared display access').count(),0);
    await page.evaluate(()=>{closeDetail();window.TingsNative={isNative:false};openDetail(0);});
    await search('ringing alarm');assert.equal(await page.locator('.detail-search-result').count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS detail groups, live search, prerequisites, keyboard, dirty cancel, native/PWA, minimal and persistent exits');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
