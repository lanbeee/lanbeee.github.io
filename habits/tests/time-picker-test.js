// iOS Safari ignores <input type="time" step>, so the Clock-style wheels
// must expose twelve minute stops and write a real HH:mm value.
const {chromium} = require('playwright');
const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

(async()=>{
  const failures = [];
  const check = (name, condition, detail='')=>{
    if(condition)console.log(`  ok  - ${name}`);
    else{
      failures.push(`${name}${detail ? ` :: ${detail}` : ''}`);
      console.log(`  FAIL- ${name}${detail ? ` :: ${detail}` : ''}`);
    }
  };

  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:390, height:844}, isMobile:true, hasTouch:true});
  await page.addInitScript(()=>{
    window.__tingsForceTimePicker = true;
    window.__tingsTimePicker12h = true;
  });
  await page.goto(BASE, {waitUntil:'load'});
  await page.waitForFunction(()=>typeof timePickerMinuteValues === 'function');

  const math = await page.evaluate(()=>{
    const minutes = timePickerMinuteValues(5);
    const twoFifteen = timePickerMinutesFromParts({hour:2, minute:15, period:'pm'}, true);
    const eight = timePickerPartsFromMinutes(8 * 60, true);
    const snap = timePickerSnapMinutes(9 * 60 + 3);
    return {
      count:minutes.length,
      minutes,
      twoFifteen,
      eightHour:eight.hour,
      eightPeriod:eight.period,
      snap
    };
  });
  check('five-minute grid has twelve stops', math.count === 12 && math.minutes[0] === 0 && math.minutes[11] === 55, JSON.stringify(math.minutes));
  check('2:15 PM is 14:15', math.twoFifteen === 14 * 60 + 15, String(math.twoFifteen));
  check('08:00 is 8 AM', math.eightHour === 8 && math.eightPeriod === 'am', JSON.stringify(math));
  check('09:03 snaps to 09:05', math.snap === 9 * 60 + 5, String(math.snap));

  await page.locator('#open-add').click();
  await page.waitForSelector('#add-sheet.open');
  await page.locator('#type-seg [data-v="task"]').click();
  await page.waitForSelector('#task-due-row:not([hidden])');

  await page.locator('#ting-due-time').click();
  await page.waitForSelector('#time-step-picker.open', {timeout:3000});

  const wheel = await page.evaluate(()=>{
    const host = document.getElementById('time-step-picker');
    const minuteVals = [...host.querySelectorAll('[data-col="minute"] .time-step-picker-item')].map(el=>el.dataset.value);
    const hourCount = host.querySelectorAll('[data-col="hour"] .time-step-picker-item').length;
    const periodCount = host.querySelectorAll('[data-col="period"] .time-step-picker-item').length;
    const sheet = document.getElementById('add-sheet');
    return {
      open:host.classList.contains('open'),
      minuteVals,
      hourCount,
      periodCount,
      addStillOpen:sheet.classList.contains('open'),
      isSheetWrap:host.classList.contains('sheet-wrap')
    };
  });
  check('picker opens in the keyboard slot, not as another sheet', wheel.open && !wheel.isSheetWrap && wheel.addStillOpen);
  check('minute wheel only lists 00, 05, … 55', wheel.minuteVals.join(',') === '0,5,10,15,20,25,30,35,40,45,50,55', wheel.minuteVals.join(','));
  check('hour wheel has twelve Clock hours', wheel.hourCount === 12, String(wheel.hourCount));
  check('AM/PM is a third wheel', wheel.periodCount === 2, String(wheel.periodCount));

  await page.locator('[data-col="hour"] .time-step-picker-item[data-value="2"]').click();
  await page.locator('[data-col="minute"] .time-step-picker-item[data-value="15"]').click();
  await page.locator('[data-col="period"] .time-step-picker-item[data-value="pm"]').click();
  await page.locator('#time-step-picker-done').click();
  await page.waitForFunction(()=>!document.getElementById('time-step-picker')?.classList.contains('open'));

  const committed = await page.evaluate(()=>({
    value:document.getElementById('ting-due-time').value,
    addOpen:document.getElementById('add-sheet').classList.contains('open'),
    pickerOpen:document.getElementById('time-step-picker').classList.contains('open')
  }));
  check('Done writes 14:15 and leaves the add sheet open', committed.value === '14:15' && committed.addOpen && !committed.pickerOpen, JSON.stringify(committed));

  await page.locator('#ting-due-time').evaluate(el=>{ el.value = ''; el.dispatchEvent(new Event('input', {bubbles:true})); });
  await page.locator('#ting-due-time').click();
  await page.waitForSelector('#time-step-picker.open');
  await page.waitForTimeout(450);
  await page.mouse.click(200, 40);
  const accidental = await page.evaluate(()=>({
    value:document.getElementById('ting-due-time').value,
    pickerOpen:document.getElementById('time-step-picker').classList.contains('open')
  }));
  check('dismissing an untouched empty field does not invent a time', accidental.value === '' && !accidental.pickerOpen, JSON.stringify(accidental));

  await browser.close();

  const plain = await chromium.launch({headless:true});
  const plainPage = await plain.newPage({viewport:{width:390, height:844}});
  await plainPage.goto(BASE, {waitUntil:'load'});
  await plainPage.locator('#open-add').click();
  await plainPage.waitForSelector('#add-sheet.open');
  await plainPage.locator('#type-seg [data-v="task"]').click();
  await plainPage.waitForSelector('#task-due-row:not([hidden])');
  await plainPage.locator('#ting-due-time').click();
  await plainPage.waitForTimeout(250);
  const native = await plainPage.evaluate(()=>document.getElementById('time-step-picker')?.classList.contains('open'));
  check('Android/desktop keep the native time picker', native === false);
  await plain.close();

  if(failures.length){
    console.error(`FAILED ${failures.length}`);
    failures.forEach(item=>console.error('  - ' + item));
    process.exit(1);
  }
  console.log('time-picker-test: ok');
})().catch(err=>{
  console.error(err);
  process.exit(1);
});
