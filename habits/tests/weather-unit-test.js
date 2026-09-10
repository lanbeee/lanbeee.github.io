// Temperature display unit: forecast payloads stay °C; only the rendered
// numbers convert. 'auto' infers from the home city's country, 'c'/'f' win.
// No network: a pre-normalized forecast bucket is seeded straight into the
// weather cache, so every loadSortSettings() rebuilds the same context.
const { chromium, BASE } = require('./helpers/planner-test-helpers');

let pass=0,fail=0;
function assert(value,message){
  if(value){pass+=1;console.log('  ok: '+message);}
  else{fail+=1;console.error('  FAIL: '+message);}
}

(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(BASE,{waitUntil:'networkidle'});

  // Pure inference helpers.
  const helpers=await page.evaluate(()=>{
    const settings=unit=>({...DEFAULT_SORT_SETTINGS,weatherTempUnit:'auto',homeCityCountry:unit});
    function autoCheck(code){return weatherEffectiveTempUnit(settings(code));}
    return {
      us:weatherTempUnitForCountry('US'),
      usLower:weatherTempUnitForCountry('us'),
      gb:weatherTempUnitForCountry('GB'),
      empty:weatherTempUnitForCountry(''),
      autoDefault:weatherEffectiveTempUnit(settings('')),
      autoUs:weatherEffectiveTempUnit(settings('US')),
      explicitCEverywhere:weatherEffectiveTempUnit({...settings('US'),weatherTempUnit:'c'}),
      explicitFEverywhere:weatherEffectiveTempUnit({...settings('GB'),weatherTempUnit:'f'}),
      junkUnit:normalizeWeatherTempUnit('nonsense'),
      bs:autoCheck('BS'),
      mm:autoCheck('MM')
    };
  });
  assert(helpers.us==='f' && helpers.usLower==='f' && helpers.bs==='f' && helpers.mm==='f','Fahrenheit countries infer °F in auto mode');
  assert(helpers.gb==='c' && helpers.empty==='c' && helpers.autoDefault==='c','unknown or non-Fahrenheit countries keep the °C default');
  assert(helpers.autoUs==='f','auto resolves to °F once a US home city country is stored');
  assert(helpers.explicitCEverywhere==='c' && helpers.explicitFEverywhere==='f','an explicit unit overrides the inferred country default');
  assert(helpers.junkUnit==='auto','junk unit values normalize back to auto');

  // Seed the persisted forecast at the home coords: daily feels-like 5–13°C,
  // hourly apparent 10–12°C across 9:00–12:00.
  const seeded=await page.evaluate(()=>{
    const now=Date.now();
    const base=dayStart(now);
    const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
    const samples=[9,10,11].map(hour=>({ts:base+hour*3600000,temperature_2m:12+hour-9,
      apparent_temperature:10+hour-9,precipitation_probability:20,precipitation:.2,
      wind_speed_10m:9,wind_gusts_10m:14,uv_index:2,weather_code:3,source:'weekly'}));
    const days=[{ts:base,key:dateKey(base),weather_code:3,temperature_2m_min:7,temperature_2m_max:14,
      apparent_temperature_min:5,apparent_temperature_max:13,precipitation_probability_max:20,
      precipitation_sum:.5,wind_speed_10m_max:9,wind_gusts_10m_max:14,uv_index_max:2}];
    localStorage.setItem(WEATHER_CACHE_KEY,JSON.stringify({
      weekly:{lat:52.52,lng:13.405,fetchedAt:now-600000,timezone:tz,samples,days}
    }));
    saveSortSettings({...loadSortSettings(),minimalMode:false,showWeatherTemperatureRanges:true,
      weatherTempUnit:'auto',homeCityName:'',homeCityCountry:'',homeCityLat:52.52,homeCityLng:13.405,
      locations:[],weatherProfiles:[]});
    // saveSortSettings strips the transient _weatherContext; loadSortSettings
    // rebuilds it from the seeded cache, so re-read before rendering.
    sortSettings=loadSortSettings();
    return {
      base,
      key:dateKey(base),
      hasContext:Boolean(loadSortSettings()._weatherContext),
      dayCount:(loadSortSettings()._weatherContext?.days || []).length
    };
  });
  assert(seeded.hasContext && seeded.dayCount===1,'seeded cache bucket rebuilds a forecast context with day summaries');

  // Default auto with no stored country must stay exactly as before: °C.
  const celsius=await page.evaluate(({base,key})=>{
    sortSettings=loadSortSettings();
    const settings=sortSettings;
    const cue=weatherDayCueHtml(base,{dayBase:base,dayKey:key,isToday:true,timeline:[],homeDisplayedTimeline:[]},settings,{data:[]});
    const sheet=renderWeatherContextSheet(weatherContextSheetModel(base,null,''))!==false
      ? document.querySelector('#weather-context-sheet').textContent : '';
    const block=overviewDayWeatherBlockHtml(key,{dayBase:base,dayKey:key,isToday:true,timeline:[],homeDisplayedTimeline:[]},[]);
    const pill=weatherPeriodPillHtml(base+9*3600000,base+12*3600000,settings,{});
    return {cue,sheet,block,pill};
  },seeded);
  assert(/5–13°/.test(celsius.cue),'default auto keeps the °C feels-like range on day cues');
  assert(/5–13°C/.test(celsius.sheet) && !/°F/.test(celsius.sheet),'default auto keeps °C in the context sheet');
  assert(/feels like 5–13°C/.test(celsius.block),'default auto keeps °C in the overview day block');
  assert(!/Fahrenheit/.test(celsius.pill),'default auto keeps Celsius wording in pill accessibility text');

  // Explicit °F converts every rendered temperature; °C data is untouched.
  const fahrenheit=await page.evaluate(({base,key})=>{
    saveSortSettings({...loadSortSettings(),weatherTempUnit:'f'});
    sortSettings=loadSortSettings();
    const settings=sortSettings;
    const cue=weatherDayCueHtml(base,{dayBase:base,dayKey:key,isToday:true,timeline:[],homeDisplayedTimeline:[]},settings,{data:[]});
    const sheet=renderWeatherContextSheet(weatherContextSheetModel(base,null,''))!==false
      ? document.querySelector('#weather-context-sheet').textContent : '';
    const block=overviewDayWeatherBlockHtml(key,{dayBase:base,dayKey:key,isToday:true,timeline:[],homeDisplayedTimeline:[]},[]);
    const longPill=weatherPeriodPillHtml(base+9*3600000,base+12*3600000,settings,{});
    const storedDaily=loadSortSettings()._weatherContext.days[0].apparent_temperature_max;
    return {cue,sheet,block,longPill,storedDaily};
  },seeded);
  assert(/41–55°/.test(fahrenheit.cue),'°F converts the feels-like range (5–13°C → 41–55°F)');
  assert(!/5–13°/.test(fahrenheit.cue),'°F mode no longer shows the °C numbers');
  assert(/41–55°F/.test(fahrenheit.sheet) && !/5–13°C/.test(fahrenheit.sheet),'context sheet labels the range °F');
  assert(/feels like 41–55°F/.test(fahrenheit.block),'overview day block labels the range °F');
  assert(/Fahrenheit/.test(fahrenheit.longPill) && /50–54°/.test(fahrenheit.longPill),'period pills convert numbers and accessibility wording (10–12°C → 50–54°F)');
  assert(fahrenheit.storedDaily===13,'the stored forecast stays °C — conversion is display-only');

  // Auto + a stored US country resolves to °F without an explicit override.
  const autoUs=await page.evaluate(({base})=>{
    saveSortSettings({...loadSortSettings(),weatherTempUnit:'auto',homeCityName:'New York',homeCityCountry:'US'});
    sortSettings=loadSortSettings();
    return {
      range:weatherTemperatureRange(weatherDaySummary(sortSettings._weatherContext,base,sortSettings)),
      word:weatherTempUnitWord()
    };
  },seeded);
  assert(/41–55°/.test(autoUs.range) && autoUs.word==='Fahrenheit','auto + US home city renders Fahrenheit with no explicit override');

  // Settings seg: state syncs, taps persist, and auto explains its inference.
  const seg=await page.evaluate(()=>{
    saveSortSettings({...loadSortSettings(),weatherTempUnit:'auto',homeCityCountry:'',homeCityName:''});
    openSheet('settings-sheet');
    syncSettingsControls();
    const body=$('settings-weather-body');
    if(body && body.hidden)$('settings-weather-head').click();
    const onValue=()=>[...document.querySelectorAll('#weather-temp-unit-seg .seg-opt')]
      .find(btn=>btn.classList.contains('on'))?.dataset.segValue || '';
    const autoOn=onValue();
    const autoHint=$('weather-temp-unit-hint').textContent;
    document.querySelector('#weather-temp-unit-seg [data-seg-value="f"]').click();
    const savedF=loadSortSettings().weatherTempUnit;
    const fOn=onValue();
    const fHint=$('weather-temp-unit-hint').textContent;
    document.querySelector('#weather-temp-unit-seg [data-seg-value="c"]').click();
    const savedC=loadSortSettings().weatherTempUnit;
    return {autoOn,autoHint,savedF,fOn,fHint,savedC};
  });
  assert(seg.autoOn==='auto','the unit segment defaults to auto');
  assert(/°C/.test(seg.autoHint) && !/°F/.test(seg.autoHint),'auto hint admits it falls back to °C while no country is known');
  assert(seg.savedF==='f' && seg.fOn==='f','tapping °F persists and reflects immediately');
  assert(/°F/.test(seg.fHint) && /°C/.test(seg.fHint),'the hint names the active unit and the stored °C data');
  assert(seg.savedC==='c','tapping °C persists too');

  // Metric drill-down: summary cards with hourly data are buttons that open
  // the stacked hourly sheet for the day the context sheet is showing.
  const drill=await page.evaluate(({base})=>{
    saveSortSettings({...loadSortSettings(),weatherTempUnit:'c'});
    sortSettings=loadSortSettings();
    openWeatherContextSheet(base,null,'');
    const cards=[...document.querySelectorAll('#weather-context-content [data-weather-metric]')]
      .map(btn=>btn.dataset.weatherMetric);
    const tempBtn=document.querySelector('[data-weather-metric="temp"]');
    const tempIsButton=Boolean(tempBtn && tempBtn.tagName==='BUTTON');
    tempBtn.click();
    const open=document.getElementById('weather-metric-sheet').classList.contains('open');
    const title=document.getElementById('weather-metric-title').textContent;
    const eyebrow=document.getElementById('weather-metric-eyebrow').textContent;
    const stats=[...document.querySelectorAll('#weather-metric-content .weather-metric-stat')]
      .map(stat=>stat.textContent.replace(/\s+/g,' ').trim());
    const chart=document.querySelector('#weather-metric-content svg.weather-metric-chart');
    const chartHasLineAndArea=Boolean(chart?.querySelector('path.line') && chart?.querySelector('path.area'));
    const firstDotTitle=chart?.querySelector('circle')?.getAttribute('title') || '';
    const legend=document.querySelector('#weather-metric-content .weather-metric-legend')?.textContent || '';
    document.getElementById('weather-metric-done').click();
    const metricClosed=!document.getElementById('weather-metric-sheet').classList.contains('open');
    const contextStillOpen=document.getElementById('weather-context-sheet').classList.contains('open');
    return {cards,tempIsButton,open,title,eyebrow,stats,chartHasLineAndArea,firstDotTitle,legend,metricClosed,contextStillOpen};
  },seeded);
  assert(drill.cards.includes('temp') && drill.cards.includes('precip')
    && drill.cards.includes('wind') && drill.cards.includes('uv'),'all four seeded metric cards are tappable');
  assert(drill.tempIsButton,'the feels-like card renders as a button');
  assert(drill.open && drill.title==='feels like' && drill.eyebrow==='hourly forecast',
    'tapping feels-like opens the hourly sheet titled feels like');
  assert(drill.chartHasLineAndArea,'the feels-like sheet opens with an SVG trend chart');
  assert(/coolest\s*10°/.test(drill.stats.join(' ')) && /warmest\s*12°/.test(drill.stats.join(' ')),
    'stat chips name the °C coolest and warmest feels-like extremes');
  assert(/feels like/.test(drill.legend) && /actual/.test(drill.legend),'the temp chart legend explains both lines');
  assert(drill.metricClosed && drill.contextStillOpen,'done closes the hourly sheet but keeps the context sheet open');

  // °F converts the chart labels and stats too; each metric gets its own shape.
  const drillF=await page.evaluate(()=>{
    saveSortSettings({...loadSortSettings(),weatherTempUnit:'f'});
    sortSettings=loadSortSettings();
    document.querySelector('[data-weather-metric="temp"]').click();
    const tempStats=[...document.querySelectorAll('#weather-metric-content .weather-metric-stat')]
      .map(stat=>stat.textContent.replace(/\s+/g,' ').trim());
    const tempMarks=[...document.querySelectorAll('#weather-metric-content svg .mark')].map(m=>m.textContent);
    document.getElementById('weather-metric-close').click();
    document.querySelector('[data-weather-metric="wind"]').click();
    const windTitle=document.getElementById('weather-metric-title').textContent;
    const windStats=[...document.querySelectorAll('#weather-metric-content .weather-metric-stat')]
      .map(stat=>stat.textContent.replace(/\s+/g,' ').trim());
    const windBars=document.querySelectorAll('#weather-metric-content svg rect.bar').length;
    document.getElementById('weather-metric-close').click();
    document.querySelector('[data-weather-metric="precip"]').click();
    const precipStats=[...document.querySelectorAll('#weather-metric-content .weather-metric-stat')]
      .map(stat=>stat.textContent.replace(/\s+/g,' ').trim());
    const precipBars=document.querySelectorAll('#weather-metric-content svg rect.bar').length;
    document.getElementById('weather-metric-close').click();
    document.getElementById('weather-context-done').click();
    const allClosed=!document.getElementById('weather-context-sheet').classList.contains('open');
    return {tempStats,tempMarks,windTitle,windStats,windBars,precipStats,precipBars,allClosed};
  });
  assert(/coolest\s*50°/.test(drillF.tempStats.join(' ')) && /warmest\s*54°/.test(drillF.tempStats.join(' ')),
    '°F converts the stat chips (10–12°C → 50–54°F)');
  assert(drillF.tempMarks.includes('50°') && drillF.tempMarks.includes('54°'),'°F converts the on-chart callouts');
  assert(drillF.windTitle==='wind' && /wind\s*up\s*to\s*9\s*km\/h/.test(drillF.windStats.join(' '))
    && /gusts\s*up\s*to\s*14\s*km\/h/.test(drillF.windStats.join(' ')),'wind stats pair the peak speed with the gust figure');
  assert(drillF.windBars===0,'wind renders as a line, not bars');
  assert(/chance\s*up\s*to\s*20%/.test(drillF.precipStats.join(' ')) && /total\s*0\.6\s*mm/.test(drillF.precipStats.join(' ')),
    'precipitation stats pair the chance with the total');
  assert(drillF.precipBars===3,'precipitation renders as one bar per hour');
  assert(drillF.allClosed,'done on the context sheet closes everything');
  assert(errors.length===0,'no page errors during unit switching');

  await browser.close();
  console.log(`\nweather-unit-test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(error=>{console.error(error);process.exit(1);});
