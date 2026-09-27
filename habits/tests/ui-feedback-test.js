const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {baseHabit} = require('./helpers/planner-test-helpers');
(async()=>{
  const browser = await chromium.launch();
  try{
    const page = await browser.newPage({viewport:{width:390,height:844}});
    const errors = [];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
      window.audioNotes = [];
      window.AudioContext = class {
        state = 'running'; currentTime = 0; destination = {};
        createOscillator(){return {frequency:{setValueAtTime:v=>window.audioNotes.push(v)},connect(){},disconnect(){},start(){},stop(){this.onended?.();}};}
        createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
      };
    });
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/');
    await page.waitForFunction(()=>typeof playTingFeedback === 'function' && typeof render === 'function');
    await page.evaluate(h=>{save([h]);render();playTingFeedback();},baseHabit({hid:'feedback-test',name:'Read a little',target:1}));
    assert.equal(await page.evaluate(()=>audioNotes.length),0,'boot and programmatic work stay silent');
    await page.locator('#list [data-pulse]').first().click();
    await page.waitForFunction(()=>Boolean(load()[0].lastLog));
    assert.equal(await page.evaluate(()=>audioNotes.length),2,'successful completion plays a two-note chime');
    assert.ok(await page.evaluate(()=>load()[0].lastLog),'completion is saved');
    await page.evaluate(()=>playTingFeedback());
    assert.equal(await page.evaluate(()=>audioNotes.length),2,'rapid duplicate feedback is suppressed');
    await page.waitForTimeout(200);
    await page.evaluate(()=>logTing(0,{feedback:false}));
    assert.equal(await page.evaluate(()=>audioNotes.length),2,'automatic timer logs stay silent even after a recent gesture');
    await page.evaluate(()=>{
      toggleAppSettingButton(document.querySelector('[data-setting-toggle="soundEffects"]'));
    });
    await page.reload();
    await page.waitForFunction(()=>typeof playTingFeedback === 'function');
    assert.equal(await page.evaluate(()=>sortSettings.soundEffects),false,'mute survives reload');
    await page.evaluate(()=>{
      const button=document.createElement('button');button.id='sound-test';button.textContent='Test feedback';
      button.style='position:fixed;top:200px;left:20px;z-index:9999';
      button.onclick=()=>playTingFeedback('plan');document.body.append(button);
    });
    await page.locator('#sound-test').click();
    assert.equal(await page.evaluate(()=>audioNotes.length),0,'muted user gestures stay silent');
    await page.evaluate(()=>updateSortSetting({soundEffects:true},{renderNow:false}));
    await page.locator('#sound-test').click();
    assert.equal(await page.evaluate(()=>audioNotes.length),1,'planning has a single quiet note');
    await page.waitForTimeout(200);
    await page.evaluate(()=>{tingAudioContext=null;window.AudioContext=class {constructor(){throw Error('Audio unavailable');}};});
    await page.locator('#sound-test').click();
    assert.deepEqual(errors,[],'unavailable audio is harmless');
    console.log('PASS: feedback, gesture guard, throttling, persistent mute, and unavailable audio');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
