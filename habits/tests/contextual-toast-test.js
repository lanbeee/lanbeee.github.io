// Real completion/calendar flows, contextual shortcuts, dismiss vs undo,
// keyboard lifetime, and compact layouts in Chromium and WebKit.
const { chromium, webkit } = require('playwright');
const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
let passed = 0;
const failures = [];
function check(ok,label,detail){
  if(ok){ passed++; console.log(`  ok: ${label}`); }
  else{ failures.push(label); console.error(`  FAIL: ${label} ${detail ? JSON.stringify(detail) : ''}`); }
}

(async()=>{
  for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
    const browser = await engine.launch({headless:true});
    const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
    const errors = [];
    page.on('pageerror',error=>errors.push(String(error)));
    await page.clock.install({time:new Date(2026,9,10,14,0)});
    await page.addInitScript(()=>{
      localStorage.clear();
      const base = {target:1,logs:[],lastLog:null,durationMinutes:15,anywhereAllowed:true};
      localStorage.setItem('tings_v2',JSON.stringify([
        {...base,hid:'linked-task',name:'Read the report',type:'task',links:[{kind:'link',value:'https://example.com/report'}]},
        {...base,hid:'linked-habit',name:'Practice Spanish',type:'keepup',links:[{kind:'link',value:'https://example.com/spanish'}]},
        {...base,hid:'plain',name:'Stretch',type:'keepup'},
        {...base,hid:'stop',name:'Avoid distractions',type:'zero',links:[{kind:'link',value:'https://example.com/stop'}]},
        {...base,hid:'phone',name:'Call home',type:'keepup',links:[{kind:'phone',value:'+15551234567'}]},
        {...base,hid:'app',name:'Open notes',type:'task',links:[{kind:'app',label:'Notes',value:'https://example.com/store',launch:'https://example.com/notes'}]},
        {...base,hid:'multiple',name:'Two shortcuts',type:'keepup',links:[{kind:'link',value:'https://example.com/first'},{kind:'link',value:'https://example.com/second'}]}
      ]));
      localStorage.setItem('tings_app_settings_v2',JSON.stringify({agendaOptimizer:false,topics:[],travel:{},soundEffects:false}));
      window.__opened = [];
      window.open = url=>{ window.__opened.push(String(url)); return null; };
    });
    await page.goto(BASE,{waitUntil:'load'});
    await page.waitForFunction(()=>typeof logTing === 'function' && typeof renderDayLogs === 'function');
    const state = ()=>page.evaluate(()=>({
      link:!$('action-link').hidden,label:$('action-link').textContent,
      view:!$('action-open').hidden,plan:!$('action-plan').hidden,
      snooze:!$('snooze-until-planned').hidden,
      pending:!!pendingAction,opened:window.__opened.slice(),
      show:$('action-toast').classList.contains('show'),
      logs:actualLogs(load()[0].logs).length
    }));
    const assert = (ok,label,detail)=>check(ok,`${name}: ${label}`,detail);

    await page.evaluate(()=>logTing(0));
    let s = await state();
    assert(s.link && s.label === 'open link' && !s.view && s.opened.length === 0,'completion offers an explicit link without launching automatically',s);
    await page.locator('#action-link').tap();
    s = await state();
    assert(s.opened[0] === 'https://example.com/report' && s.logs === 1 && s.pending && s.show,'link opens once and keeps completion/Undo available',s);
    await page.locator('#action-undo').tap();
    s = await state();
    assert(s.logs === 0 && !s.pending,'Undo still reverses the completion after opening its link',s);

    await page.evaluate(()=>logTing(0));
    await page.locator('#action-close').tap();
    s = await state();
    assert(!s.show && !s.pending && s.logs === 1,'Dismiss leaves the saved completion intact',s);
    assert(await page.evaluate(()=>$('action-toast').inert && $('action-toast').getAttribute('aria-hidden') === 'true'),'dismissed toast is excluded from keyboard and accessibility navigation');

    await page.evaluate(()=>logTing(4));
    s = await state();
    assert(s.label === 'call' && s.link,'phone completion offers Call',s);
    await page.evaluate(()=>logTing(5));
    s = await state();
    assert(s.label === 'open Notes','app completion names the app',s);
    await page.locator('#action-link').tap();
    assert((await state()).opened.at(-1) === 'https://example.com/notes','app shortcut uses its saved direct-open target');
    await page.clock.runFor(7300);
    assert(!(await state()).show,'touching a link does not suspend automatic dismissal');
    await page.evaluate(()=>logTing(6));
    await page.locator('#action-link').tap();
    assert((await state()).opened.at(-1) === 'https://example.com/first','multiple links use the same primary link as the former shortcut');

    await page.evaluate(()=>logTing(2));
    s = await state();
    assert(!s.link && s.view && s.plan,'unlinked home completion retains details and its planning correction',s);
    await page.evaluate(()=>logTing(3));
    s = await state();
    assert(!s.link && !s.plan && !s.snooze,'stop-habit lapse omits completion shortcuts and planning',s);

    // Exercise the actual calendar item button and form, not just the toast helper.
    await page.evaluate(()=>{
      dayLogsKey = todayIso(); dayLogsScopeIndex = 1; dayLogsStep = 'item';
      renderDayLogs(dayLogsKey); openSheet('day-logs-sheet');
    });
    assert(await page.locator('#day-logs-plan').isVisible(),'calendar already provides its planning action');
    await page.locator('[data-log-day-item="1"]').tap();
    s = await state();
    assert(s.link && !s.plan && !s.view,'calendar completion offers link/Undo without duplicate planning or details',s);
    await page.locator('#action-undo').tap();
    assert(await page.evaluate(()=>actualLogs(load()[1].logs).length === 0),'calendar completion Undo removes the entry');
    await page.locator('#day-logs-plan').tap();
    await page.locator('#day-log-add').tap();
    s = await state();
    assert(!s.link && !s.plan && !s.view,'calendar plan omits completion link and duplicate logging shortcut',s);
    await page.evaluate(()=>{
      dayLogsKey = dateKey(Date.now() - 86400000);dayLogsStep = 'log';renderDayLogs(dayLogsKey);
    });
    await page.locator('#day-log-entry-save').tap();
    s = await state();
    assert(s.link && !s.plan && !s.view,'past-day calendar log also omits Plan today',s);
    await page.locator('#action-undo').tap();
    assert(await page.evaluate(()=>actualLogs(load()[1].logs).length === 0),'past-day form completion remains reversible');
    await page.evaluate(()=>{closeSheet('day-logs-sheet');dayLogsKey = null;resetDayLogsStep();});

    // Home planning corrections still work, including linked completion from a plan.
    await page.evaluate(()=>logTing(1));
    assert(await page.evaluate(()=>pendingAction.toastAction === 'keep-plan'),'home completion of a plan retains Keep plan');
    await page.locator('#action-undo').tap();
    assert(await page.evaluate(()=>load()[1].logs.some(isPlanLog) && actualLogs(load()[1].logs).length === 0),'Undo restores the consumed plan');
    await page.evaluate(()=>planTingOnDay(2,todayIso()));
    s = await state();
    assert(s.plan && !s.link,'home plan offers Done now without a completion link',s);
    await page.locator('#action-plan').tap();
    assert(await page.evaluate(()=>actualLogs(load()[2].logs).length === 2),'Done now converts the plan to a completion');

    await page.evaluate(()=>planTingOnDay(1,todayIso()));
    await page.locator('#action-plan').tap();
    s = await state();
    assert(s.link && !s.plan,'linked completion via Done now offers its link',s);

    await page.evaluate(()=>{
      sortSettings.minimalMode = true;
      const next = dateKey(Date.now() + 86400000);
      planTingOnDay(1,next);
    });
    s = await state();
    assert(!s.link && !s.plan && !s.snooze,'future plans in minimal mode omit inapplicable actions',s);
    await page.evaluate(()=>{
      sortSettings.minimalMode = false;
      planTingOnDay(1,dateKey(Date.now() + 86400000));
    });
    assert((await state()).snooze,'future plan offers Snooze until planned in regular mode');
    await page.evaluate(()=>doSnoozeHours(2,2));
    s = await state();
    assert(!s.link && !s.plan && !s.view && !s.snooze && await page.locator('#action-undo').textContent() === 'show','snooze replaces stale shortcuts with its relevant Show action',s);
    await page.locator('#action-close').tap();
    assert(await page.evaluate(()=>load()[2].snoozedUntil > Date.now()),'dismissing snooze preserves its saved hidden state');

    await page.evaluate(()=>showToast('Saved'));
    assert(await page.evaluate(()=>$('toast').textContent.trim() === 'Saved' && $('toast').classList.contains('show') && !$('action-toast').classList.contains('show')),'informational toast replaces the previous notification');
    await page.locator('#toast-close').tap();
    assert(await page.evaluate(()=>!$('toast').classList.contains('show') && $('toast').inert),'informational toast is dismissible');
    await page.evaluate(()=>{showToast('Earlier notice');logTing(1);});
    assert(await page.evaluate(()=>!$('toast').classList.contains('show') && $('action-toast').classList.contains('show')),'new action toast clears the earlier informational message');

    await page.keyboard.press('Tab');
    await page.locator('#action-undo').focus();
    await page.clock.runFor(8000);
    assert((await state()).show,'keyboard focus keeps action toast available past its default timeout');
    await page.evaluate(()=>document.activeElement.blur());
    await page.clock.runFor(7300);
    s = await state();
    assert(!s.show && !s.pending,'unfocused action toast expires and clears its pending action',s);
    await page.evaluate(()=>showToast('Brief notice'));
    await page.clock.runFor(2900);
    assert(await page.evaluate(()=>!$('toast').classList.contains('show') && $('toast').inert),'regular toast still expires automatically');

    await page.setViewportSize({width:320,height:640});
    await page.evaluate(()=>{
      const data = load();
      data[5].name = 'A long item name for a narrow phone';
      data[5].links[0].label = 'A very long app shortcut name';
      save(data);logTing(5);
    });
    // Browser CSS transitions use the compositor clock, separate from the
    // mocked JS clock. Measure and capture the settled toast.
    await page.evaluate(()=>Promise.all(['toast','action-toast'].flatMap(id=>$(id).getAnimations()).map(animation=>animation.finished.catch(()=>{}))));
    const layout = await page.evaluate(()=>{
      const toast = $('action-toast').getBoundingClientRect();
      const buttons = [...$('action-toast').querySelectorAll('button')].filter(b=>!b.hidden).map(b=>b.getBoundingClientRect());
      const text = $('action-text').getBoundingClientRect();
      const close = $('action-close').getBoundingClientRect();
      return {toast:toast.toJSON(),width:innerWidth,buttons:buttons.map(b=>b.toJSON()),fits:toast.left >= 0 && toast.right <= innerWidth && buttons.every(b=>b.left >= toast.left && b.right <= toast.right && b.height >= 43.9),
        overlap:text.left + $('action-text').clientWidth - parseFloat(getComputedStyle($('action-text')).paddingRight) > close.left};
    });
    assert(layout.fits && !layout.overlap,'long labels and close control fit a 320px screen',layout);
    await page.screenshot({path:`test-results/contextual-toast-${name.toLowerCase()}.png`});
    assert(errors.length === 0,'no page errors',errors);
    await browser.close();
  }
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if(failures.length)process.exitCode = 1;
})().catch(error=>{console.error(error);process.exitCode = 1;});
