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

  // Interactive scrub: pointer drags and arrow keys move the crosshair and
  // readout; temp/wind draw their secondary series; UV overlays the sun.
  const scrub=await page.evaluate(({base})=>{
    saveSortSettings({...loadSortSettings(),weatherTempUnit:'c'});
    sortSettings=loadSortSettings();
    openWeatherContextSheet(base,null,'');
    document.querySelector('[data-weather-metric="temp"]').click();
    const readout=()=>document.getElementById('weather-metric-readout').textContent.replace(/\s+/g,' ').trim();
    const svg=document.querySelector('#weather-metric-content svg.weather-metric-chart');
    const focusable=Boolean(svg && svg.getAttribute('tabindex')==='0');
    const hasSecondaryLine=Boolean(svg.querySelector('path.line.secondary'));
    const initial=readout();
    const rect=svg.getBoundingClientRect();
    const midX=rect.left+rect.width*0.5;
    svg.dispatchEvent(new PointerEvent('pointerdown',{clientX:midX,clientY:rect.top+rect.height/2,bubbles:true,pointerId:7}));
    svg.dispatchEvent(new PointerEvent('pointermove',{clientX:midX,clientY:rect.top+rect.height/2,bubbles:true,pointerId:7}));
    const scrubbed=readout();
    svg.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
    const afterKey=readout();
    document.getElementById('weather-metric-close').click();
    document.querySelector('[data-weather-metric="wind"]').click();
    const windSvg=document.querySelector('#weather-metric-content svg.weather-metric-chart');
    const windSecondary=Boolean(windSvg.querySelector('path.line.secondary'));
    const windLegend=document.querySelector('#weather-metric-content .weather-metric-legend')?.textContent || '';
    const windReadout=readout();
    document.getElementById('weather-metric-close').click();
    document.querySelector('[data-weather-metric="uv"]').click();
    const uvSvg=document.querySelector('#weather-metric-content svg.weather-metric-chart');
    const summary=weatherDaySummary(sortSettings._weatherContext,base,sortSettings);
    const sun=weatherSunTimesFor(summary);
    const sunMarks=uvSvg.querySelectorAll('.sunmark').length;
    const nightRects=uvSvg.querySelectorAll('rect.night').length;
    const uvStats=[...document.querySelectorAll('#weather-metric-content .weather-metric-stat')]
      .map(stat=>stat.textContent.replace(/\s+/g,' ').trim());
    const uvReadout=readout();
    document.getElementById('weather-metric-close').click();
    document.getElementById('weather-context-done').click();
    const allClosed=!document.getElementById('weather-context-sheet').classList.contains('open');
    return {focusable,hasSecondaryLine,initial,scrubbed,afterKey,windSecondary,windLegend,windReadout,
      sun,sunMarks,nightRects,uvStats,uvReadout,allClosed};
  },seeded);
  assert(scrub.focusable,'the chart is keyboard-focusable for scrubbing');
  assert(scrub.hasSecondaryLine,'the feels-like chart draws the actual temperature behind the main line');
  assert(/feels\s*\d+°/.test(scrub.initial),'the readout names the feels-like value for the opening hour');
  assert(/feels\s*11°/.test(scrub.scrubbed),'scrubbing to mid-chart reads the 11°C hour');
  assert(/feels\s*10°/.test(scrub.afterKey),'arrow keys step the readout an hour back');
  assert(scrub.windSecondary && /wind/.test(scrub.windLegend) && /gusts/.test(scrub.windLegend),
    'the wind chart draws gusts as its secondary line with a legend');
  assert(/km\/h/.test(scrub.windReadout) && /gusts/.test(scrub.windReadout),'the wind readout pairs speed with gusts');
  if(scrub.sun){
    assert(scrub.sunMarks===2,'the UV chart marks sunrise and sunset');
    // The seeded samples span 09:00–11:00 — all daylight — so the night
    // bookends correctly collapse away (full shading verified visually).
    assert(scrub.nightRects===0,'night shading stays off when the charted span is all daylight');
    assert(/daylight/.test(scrub.uvStats.join(' ')),'the UV stats include a daylight chip');
    assert(/UV\s*\d/.test(scrub.uvReadout),'the UV readout names the index');
  }else{
    assert(scrub.sunMarks===0 && scrub.nightRects===0,'without sun times the UV chart stays clean');
  }
  assert(scrub.allClosed,'done on the context sheet closes everything');

  // Near-term refreshes re-stamp the hourly rows they overlap as 'near'; the
  // drill-down must still chart those hours (one row per hour bucket) instead
  // of truncating the day at the refresh horizon. The domain must also span
  // the dashed secondary series, and probability bars keep the 0–100 scale.
  const nearTail=await page.evaluate(({base})=>{
    saveSortSettings({...loadSortSettings(),weatherTempUnit:'c',homeCityName:'Berlin',homeCityCountry:''});
    sortSettings=loadSortSettings();
    const now=Date.now();
    const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
    const weeklySamples=[9,10].map(hour=>({ts:base+hour*3600000,temperature_2m:12+hour-9,
      apparent_temperature:10+hour-9,precipitation_probability:20,precipitation:.2,
      wind_speed_10m:9,wind_gusts_10m:14,uv_index:2,weather_code:3,source:'weekly'}));
    // Production shape after a near refresh: the weekly rows inside the
    // horizon were enriched and re-sourced, and 15-minute detail was added.
    const nearSamples=[{ts:base+11*3600000,temperature_2m:25,apparent_temperature:11,
      precipitation_probability:20,precipitation:.2,wind_speed_10m:9,wind_gusts_10m:30,
      uv_index:2,weather_code:3,is_day:1},
      {ts:base+11.25*3600000,temperature_2m:25,apparent_temperature:11,
      precipitation_probability:20,precipitation:.2,wind_speed_10m:9,wind_gusts_10m:30,
      uv_index:2,weather_code:3,is_day:1},
      {ts:base+12*3600000,temperature_2m:25,apparent_temperature:11,
      precipitation_probability:20,precipitation:.2,wind_speed_10m:9,wind_gusts_10m:30,
      uv_index:2,weather_code:3,is_day:1},
      {ts:base+13*3600000,temperature_2m:25,apparent_temperature:11,
      precipitation_probability:20,precipitation:.2,wind_speed_10m:9,wind_gusts_10m:30,
      uv_index:2,weather_code:3,is_day:1}].map(sample=>({...sample,source:'near'}));
    const days=[{ts:base,key:dateKey(base),weather_code:3,temperature_2m_min:7,temperature_2m_max:14,
      apparent_temperature_min:5,apparent_temperature_max:13,precipitation_probability_max:20,
      precipitation_sum:.5,wind_speed_10m_max:9,wind_gusts_10m_max:14,uv_index_max:2}];
    localStorage.setItem(WEATHER_CACHE_KEY,JSON.stringify({
      weekly:{lat:52.52,lng:13.405,fetchedAt:now-600000,timezone:tz,samples:weeklySamples,days},
      near:{lat:52.52,lng:13.405,fetchedAt:now-600000,timezone:tz,samples:nearSamples,horizonMs:14400000}
    }));
    sortSettings=loadSortSettings();
    openWeatherContextSheet(base,null,'');
    document.querySelector('[data-weather-metric="temp"]').click();
    const meta=_weatherChartMeta;
    const hours=[...document.querySelectorAll('#weather-metric-content svg .hour')].map(t=>t.textContent);
    const secInBounds=meta.secondary.every(v=>!Number.isFinite(v)||(v>=meta.geom.yMin&&v<=meta.geom.yMax));
    const tempStacked=document.getElementById('weather-metric-sheet').style.zIndex;
    document.getElementById('weather-metric-close').click();
    document.querySelector('[data-weather-metric="precip"]').click();
    const precipMeta=_weatherChartMeta;
    const precipBars=document.querySelectorAll('#weather-metric-content svg rect.bar').length;
    document.getElementById('weather-metric-close').click();
    document.getElementById('weather-context-done').click();
    return {count:meta.ts.length,hours,yMax:meta.geom.yMax,secInBounds,tempStacked,
      precipMax:precipMeta.geom.yMax,precipBars};
  },seeded);
  assert(nearTail.count===5,'near-enriched hours stay on the chart (5 hourly points, not 2)');
  assert(nearTail.hours.includes('13'),'the axis labels the final hour even when it is not a 3-hour tick');
  assert(nearTail.yMax>=25 && nearTail.secInBounds,'the chart frame spans the secondary series so gusts/actual stay inside');
  assert(nearTail.tempStacked==='140','the metric sheet pins its stacking tier inline when it opens');
  assert(nearTail.precipMax===100,'precipitation bars use the natural 0–100% scale');
  assert(nearTail.precipBars===5,'every hour keeps its precipitation bar on the shared scale');

  // Winter preview: snowfall rides in the same precipitation drill-down —
  // the card names the day's snow total, snow hours get their own bar tint,
  // the readout switches to centimetres, and a snow chip joins the stats.
  const snowDay=await page.evaluate(({base})=>{
    const now=Date.now();
    const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
    const samples=[9,10,11].map((hour,i)=>({ts:base+hour*3600000,temperature_2m:-2+i/10,
      apparent_temperature:-6+i/10,precipitation_probability:40+i*20,
      precipitation:i===0?.2:(i===1?.1:0),snowfall:i===0?0:(i===1?.4:1.2),
      wind_speed_10m:9,wind_gusts_10m:14,uv_index:0,weather_code:73,source:'weekly'}));
    const days=[{ts:base,key:dateKey(base),weather_code:73,temperature_2m_min:-4,temperature_2m_max:0,
      apparent_temperature_min:-8,apparent_temperature_max:-4,precipitation_probability_max:80,
      precipitation_sum:.3,snowfall_sum:1.6,wind_speed_10m_max:9,wind_gusts_10m_max:14,uv_index_max:0}];
    localStorage.setItem(WEATHER_CACHE_KEY,JSON.stringify({
      weekly:{lat:52.52,lng:13.405,fetchedAt:now-600000,timezone:tz,samples,days}
    }));
    sortSettings=loadSortSettings();
    openWeatherContextSheet(base,null,'');
    const precipCard=[...document.querySelectorAll('#weather-context-content [data-weather-metric="precip"] b')]
      .map(b=>b.textContent).join(' ');
    document.querySelector('[data-weather-metric="precip"]').click();
    const bars=document.querySelectorAll('#weather-metric-content svg rect.bar').length;
    const snowBars=document.querySelectorAll('#weather-metric-content svg rect.bar.snow').length;
    const yMax=_weatherChartMeta.geom.yMax;
    const readout=()=>document.getElementById('weather-metric-readout').textContent.replace(/\s+/g,' ').trim();
    const snowyHour=readout();
    document.querySelector('#weather-metric-content svg.weather-metric-chart')
      .dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
    const mixedHour=readout();
    const stats=[...document.querySelectorAll('#weather-metric-content .weather-metric-stat')]
      .map(stat=>stat.textContent.replace(/\s+/g,' ').trim());
    document.getElementById('weather-metric-close').click();
    document.getElementById('weather-context-done').click();
    return {precipCard,bars,snowBars,yMax,snowyHour,mixedHour,stats};
  },seeded);
  assert(/1\.6\s*cm\s*snow/.test(snowDay.precipCard),'the precipitation card names the day\'s snow total');
  assert(snowDay.bars===3 && snowDay.snowBars===2,'snowfall hours render their bars with the snow tint');
  assert(snowDay.yMax===100,'snowy days keep the 0–100% bar scale');
  assert(/1\.2\s*cm\s*snow/.test(snowDay.snowyHour) && !/0\s*mm/.test(snowDay.snowyHour),
    'a pure-snow hour reads in centimetres instead of 0 mm');
  assert(/cm\s*snow/.test(snowDay.mixedHour),'a mixed hour pairs liquid mm with snow cm');
  assert(/snow\s*1\.6\s*cm/.test(snowDay.stats.join(' ')),'the stats include the day\'s snow total');

  // Reference lines give each curve its meaning (freezing, UV level, breeze
  // strength, even chance); thresholds outside the day's range stay hidden.
  // A sub-zero day must also keep its whole curve inside the frame.
  const refLines=await page.evaluate(({base})=>{
    const now=Date.now();
    const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
    const samples=[9,10,11].map((hour,i)=>({ts:base+hour*3600000,temperature_2m:i,
      apparent_temperature:-1+i*1.5,precipitation_probability:20,precipitation:.2,
      snowfall:0,wind_speed_10m:30,wind_gusts_10m:45,uv_index:5,weather_code:71,source:'weekly'}));
    const days=[{ts:base,key:dateKey(base),weather_code:71,temperature_2m_min:-2,temperature_2m_max:1,
      apparent_temperature_min:-3,apparent_temperature_max:2,precipitation_probability_max:20,
      precipitation_sum:.6,snowfall_sum:0,wind_speed_10m_max:30,wind_gusts_10m_max:45,uv_index_max:5}];
    localStorage.setItem(WEATHER_CACHE_KEY,JSON.stringify({
      weekly:{lat:52.52,lng:13.405,fetchedAt:now-600000,timezone:tz,samples,days}
    }));
    sortSettings=loadSortSettings();
    const open=metric=>{
      openWeatherContextSheet(base,null,'');
      document.querySelector(`[data-weather-metric="${metric}"]`).click();
      const out={refs:[...document.querySelectorAll('#weather-metric-content svg .reflabel')].map(t=>t.textContent),
        meta:_weatherChartMeta,
        sunMarks:document.querySelectorAll('#weather-metric-content svg .sunmark').length};
      document.getElementById('weather-metric-close').click();
      return out;
    };
    const temp=open('temp');
    saveSortSettings({...loadSortSettings(),weatherTempUnit:'f'});
    sortSettings=loadSortSettings();
    const tempF=open('temp');
    saveSortSettings({...loadSortSettings(),weatherTempUnit:'c'});
    sortSettings=loadSortSettings();
    const wind=open('wind');
    const precip=open('precip');
    const uv=open('uv');
    document.getElementById('weather-context-done').click();
    return {temp,tempF,wind,precip,uv};
  },seeded);
  assert(refLines.temp.refs.join()==='freezing 0°' && refLines.temp.meta.geom.yMin<0,
    'the freezing line draws inside a sub-zero day and the domain keeps the negative floor');
  assert(refLines.temp.meta.primary.every(v=>v>=refLines.temp.meta.geom.yMin && v<=refLines.temp.meta.geom.yMax),
    'every feels-like sample stays inside the chart frame on a sub-zero day');
  assert(refLines.temp.sunMarks===2,'the feels-like chart carries the sunrise/sunset context too');
  assert(refLines.tempF.refs.join()==='freezing 32°','°F converts the freezing reference label');
  assert(refLines.wind.refs.join()==='strong 39' && refLines.wind.meta.geom.yMax>=45,
    'the wind chart marks the strong-breeze threshold the shared frame still covers gusts');
  assert(refLines.precip.refs.join()==='even 50%','the precipitation chart marks the even-chance line');
  assert(refLines.uv.refs.join()==='moderate 3','the UV chart marks the moderate level when the peak reaches it');
  assert(errors.length===0,'no page errors during unit switching');

  await browser.close();
  console.log(`\nweather-unit-test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(error=>{console.error(error);process.exit(1);});
