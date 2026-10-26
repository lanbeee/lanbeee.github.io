// Settings search should land on the right control when the words are close
// but not the label itself.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');

(async()=>{
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try{
    await page.addInitScript(()=>{
      localStorage.setItem('tings_coach_install_v2','done');
      localStorage.setItem('tings_coach_essentials_v2','done');
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
  }finally{
    await browser.close();
  }
})().catch(err=>{console.error(err);process.exit(1);});
