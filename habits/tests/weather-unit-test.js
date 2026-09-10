// Display units for temperature, precipitation (snowfall follows it), and
// wind: forecast payloads stay in the metric API units (°C, mm, cm, km/h);
// only the rendered numbers convert. 'auto' infers from the home city's
// country, explicit values win. No network: a pre-normalized forecast bucket
// is seeded straight into the weather cache, so every loadSortSettings()
// rebuilds the same context.
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
      mm:autoCheck('MM'),
      precipUs:weatherEffectivePrecipUnit(settings('US')),
      precipGb:weatherEffectivePrecipUnit(settings('GB')),
      precipEmpty:weatherEffectivePrecipUnit(settings('')),
      windUs:weatherEffectiveWindUnit(settings('US')),
      windGb:weatherEffectiveWindUnit(settings('GB')),
      windEmpty:weatherEffectiveWindUnit(settings('')),
      precipJunk:normalizeWeatherPrecipUnit('nonsense'),
      windJunk:normalizeWeatherWindUnit('nonsense'),
      precipExplicitIn:weatherEffectivePrecipUnit({...settings('GB'),weatherPrecipUnit:'in'}),
      windExplicitKmh:weatherEffectiveWindUnit({...settings('US'),weatherWindUnit:'kmh'}),
      lrTemp:weatherTempUnitForCountry('LR'),
      lrMeasure:weatherMeasureUnitForCountry('LR'),
      mmMeasure:weatherMeasureUnitForCountry('MM')
    };
  });
  assert(helpers.us==='f' && helpers.usLower==='f' && helpers.bs==='f' && helpers.mm==='f','Fahrenheit countries infer °F in auto mode');
  assert(helpers.gb==='c' && helpers.empty==='c' && helpers.autoDefault==='c','unknown or non-Fahrenheit countries keep the °C default');
  assert(helpers.autoUs==='f','auto resolves to °F once a US home city country is stored');
  assert(helpers.explicitCEverywhere==='c' && helpers.explicitFEverywhere==='f','an explicit unit overrides the inferred country default');
  assert(helpers.junkUnit==='auto','junk unit values normalize back to auto');
  assert(helpers.precipUs==='in' && helpers.windUs==='mph','US home cities infer inches and mph in auto mode');
  assert(helpers.precipGb==='mm' && helpers.windGb==='kmh' && helpers.precipEmpty==='mm' && helpers.windEmpty==='kmh',
    'unknown or non-measure countries keep the mm and km/h defaults');
  assert(helpers.precipJunk==='auto' && helpers.windJunk==='auto','junk precip/wind values normalize back to auto');
  assert(helpers.precipExplicitIn==='in' && helpers.windExplicitKmh==='kmh','explicit precip/wind units override the inferred country default');
  assert(helpers.lrTemp==='f' && helpers.lrMeasure==='metric' && helpers.mmMeasure==='metric',
    'Liberia and Myanmar temper in °F but stay on metric precipitation and wind');

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

  // Settings segs: state syncs, taps persist, and auto explains its inference.
  const seg=await page.evaluate(()=>{
    saveSortSettings({...loadSortSettings(),weatherTempUnit:'auto',weatherPrecipUnit:'auto',weatherWindUnit:'auto',homeCityCountry:'',homeCityName:''});
    openSheet('settings-sheet');
    syncSettingsControls();
    const body=$('settings-weather-body');
    if(body && body.hidden)$('settings-weather-head').click();
    const onValue=segId=>[...document.querySelectorAll(`#${segId} .seg-opt`)]
      .find(btn=>btn.classList.contains('on'))?.dataset.segValue || '';
    const autoOn=onValue('weather-temp-unit-seg');
    const autoHint=$('weather-temp-unit-hint').textContent;
    document.querySelector('#weather-temp-unit-seg [data-seg-value="f"]').click();
    const savedF=loadSortSettings().weatherTempUnit;
    const fOn=onValue('weather-temp-unit-seg');
    const fHint=$('weather-temp-unit-hint').textContent;
    document.querySelector('#weather-temp-unit-seg [data-seg-value="c"]').click();
    const savedC=loadSortSettings().weatherTempUnit;
    const precipAutoOn=onValue('weather-precip-unit-seg');
    const precipAutoHint=$('weather-precip-unit-hint').textContent;
    const windAutoOn=onValue('weather-wind-unit-seg');
    const windAutoHint=$('weather-wind-unit-hint').textContent;
    document.querySelector('#weather-precip-unit-seg [data-seg-value="in"]').click();
    const precipSavedIn=loadSortSettings().weatherPrecipUnit;
    const precipInHint=$('weather-precip-unit-hint').textContent;
    document.querySelector('#weather-wind-unit-seg [data-seg-value="mph"]').click();
    const windSavedMph=loadSortSettings().weatherWindUnit;
    const windMphHint=$('weather-wind-unit-hint').textContent;
    document.querySelector('#weather-precip-unit-seg [data-seg-value="auto"]').click();
    document.querySelector('#weather-wind-unit-seg [data-seg-value="auto"]').click();
    const precipReset=loadSortSettings().weatherPrecipUnit;
    const windReset=loadSortSettings().weatherWindUnit;
    return {autoOn,autoHint,savedF,fOn,fHint,savedC,precipAutoOn,precipAutoHint,windAutoOn,windAutoHint,
      precipSavedIn,precipInHint,windSavedMph,windMphHint,precipReset,windReset};
  });
  assert(seg.autoOn==='auto','the unit segment defaults to auto');
  assert(/°C/.test(seg.autoHint) && !/°F/.test(seg.autoHint),'auto hint admits it falls back to °C while no country is known');
  assert(seg.savedF==='f' && seg.fOn==='f','tapping °F persists and reflects immediately');
  assert(/°F/.test(seg.fHint) && /°C/.test(seg.fHint),'the hint names the active unit and the stored °C data');
  assert(seg.savedC==='c','tapping °C persists too');
  assert(seg.precipAutoOn==='auto' && seg.windAutoOn==='auto','precipitation and wind segments default to auto');
  assert(/snowfall follows this setting/.test(seg.precipAutoHint) && /mm/.test(seg.precipAutoHint),
    'the precipitation auto hint names the mm default and the snowfall coupling');
  assert(/km\/h/.test(seg.windAutoHint),'the wind auto hint names the km/h default');
  assert(seg.precipSavedIn==='in' && /showing in everywhere/.test(seg.precipInHint) && /snowfall follows this setting/.test(seg.precipInHint),
    'tapping in persists and the hint keeps the snowfall note');
  assert(seg.windSavedMph==='mph' && /showing mph everywhere/.test(seg.windMphHint) && /km\/h/.test(seg.windMphHint),
    'tapping mph persists and the hint names the stored km/h data');
  assert(seg.precipReset==='auto' && seg.windReset==='auto','tapping auto restores inference for both new segments');

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

  // Agenda comparison: all timed agenda rows are available in a dedicated
  // vertical day view, even when the item explicitly has no weather guidance.
  // Names, exact times, and weather are printed without requiring selection.
  const agendaCompare=await page.evaluate(({base})=>{
    saveSortSettings({...loadSortSettings(),weatherTempUnit:'c',blockedTimes:[]});
    sortSettings=loadSortSettings();
    const walk={hid:'walk',name:'Park walk',type:'habit',target:1,weatherProfileMode:'none'};
    const day={dayBase:base,dayKey:dateKey(base),isToday:true,timeline:[
      {kind:'fill',h:walk,i:0,start:base+9.5*3600000,end:base+10.5*3600000}
    ]};
    openWeatherContextSheet(base,day,'');
    document.querySelector('[data-weather-metric="temp"]').click();
    const button=document.getElementById('weather-metric-agenda');
    const offered=!button.hidden && /day × weather/.test(button.textContent);
    const cleanBefore=!document.querySelector('#weather-metric-content .weather-agenda-vertical');
    button.click();
    const compared=document.getElementById('weather-agenda-sheet').classList.contains('open');
    const items=document.querySelectorAll('#weather-agenda-content .weather-agenda-item').length;
    const label=document.querySelector('.weather-agenda-item b')?.textContent || '';
    const detail=document.querySelector('.weather-agenda-item small')?.textContent || '';
    const vertical=document.querySelector('.weather-agenda-vertical');
    const trace=document.querySelector('.weather-agenda-weather-svg .trace');
    const metricButtons=document.querySelectorAll('#weather-agenda-metrics button').length;
    document.getElementById('weather-agenda-done').click();
    const hiddenAgain=!document.getElementById('weather-agenda-sheet').classList.contains('open');
    const chartStillOpen=document.getElementById('weather-metric-sheet').classList.contains('open');
    document.getElementById('weather-metric-close').click();
    document.getElementById('weather-context-done').click();
    return {offered,cleanBefore,compared,items,label,detail,height:vertical?.getBoundingClientRect().height || 0,trace:Boolean(trace),metricButtons,hiddenAgain,chartStillOpen};
  },seeded);
  assert(agendaCompare.offered && agendaCompare.cleanBefore,'a timed day offers a dedicated comparison without cluttering the default chart');
  assert(agendaCompare.compared && agendaCompare.items===1 && agendaCompare.height>=110 && agendaCompare.trace,
    'day × weather opens a tall time-aligned agenda and weather trace');
  assert(agendaCompare.label==='Park walk' && /09:30–10:30/.test(agendaCompare.detail) && /feels\s+10–11°C/.test(agendaCompare.detail),
    'the agenda block directly prints its name, exact interval, and weather across that interval');
  assert(agendaCompare.metricButtons===4,'the dedicated comparison can switch among all four weather measures');
  assert(agendaCompare.hiddenAgain && agendaCompare.chartStillOpen,'back to chart closes only the comparison and preserves the hourly chart');

  const denseAgenda=await page.evaluate(({base})=>{
    saveSortSettings({...loadSortSettings(),blockedTimes:[]});
    sortSettings=loadSortSettings();
    const timeline=Array.from({length:12},(_,i)=>({
      kind:'fill',start:base+(9+i*.25)*3600000,end:base+(9+(i+1)*.25)*3600000,
      h:{hid:`dense-${i}`,name:`Packed item ${i+1}`,type:'habit',target:1,weatherProfileMode:'none'}
    }));
    openWeatherContextSheet(base,{dayBase:base,dayKey:dateKey(base),isToday:true,timeline},'');
    document.querySelector('[data-weather-metric="temp"]').click();
    document.getElementById('weather-metric-agenda').click();
    const track=document.querySelector('.weather-agenda-vertical');
    const blocks=[...track.querySelectorAll('.weather-agenda-item')];
    const height=Math.round(track.getBoundingClientRect().height);
    const names=blocks.map(block=>block.querySelector('b')?.textContent || '');
    const directDetails=blocks.every(block=>/\d{2}:\d{2}–\d{2}:\d{2} · feels/.test(block.querySelector('small')?.textContent || ''));
    const tenthTop=parseFloat(blocks[9].style.top);
    document.querySelector('[data-weather-agenda-metric="precip"]').click();
    const rainHours=document.querySelectorAll('.weather-agenda-rain-hour').length;
    document.getElementById('weather-agenda-done').click();
    document.getElementById('weather-metric-close').click();
    document.getElementById('weather-context-done').click();
    return {blocks:blocks.length,height,names,directDetails,tenthTop,rainHours};
  },seeded);
  assert(denseAgenda.blocks===12 && denseAgenda.height>=330 && denseAgenda.names.includes('Packed item 10'),
    'a packed day expands vertically so all twelve item names remain directly visible');
  assert(denseAgenda.directDetails && Math.abs(denseAgenda.tenthTop-252)<2,
    'packed items directly print their time/weather and retain exact proportional positions');
  assert(denseAgenda.rainHours>=3,'switching to rain replaces the trace with aligned hourly probability bands');

  // Busy (blocked) times belong in the comparison: sleep anchored at midnight
  // must widen the chart's domain so the block is reachable by scrolling, and
  // very short items must grow to a readable height without covering the next
  // block in the same lane.
  const busyAndTiny=await page.evaluate(({base})=>{
    const timeline=[
      {kind:'blocked',label:'sleep',start:base,end:base+5*3600000,locationId:null},
      {kind:'fill',start:base+9*3600000,end:base+9*3600000+5*60000,
        h:{hid:'tiny-a',name:'Quick check',type:'habit',target:1,weatherProfileMode:'none'}},
      {kind:'fill',start:base+9*3600000+5*60000,end:base+9*3600000+10*60000,
        h:{hid:'tiny-b',name:'Quick follow-up',type:'habit',target:1,weatherProfileMode:'none'}},
      {kind:'fill',start:base+10*3600000,end:base+10.5*3600000,
        h:{hid:'normal-c',name:'Midmorning read',type:'habit',target:1,weatherProfileMode:'none'}}
    ];
    openWeatherContextSheet(base,{dayBase:base,dayKey:dateKey(base),isToday:true,timeline},'');
    document.querySelector('[data-weather-metric="temp"]').click();
    document.getElementById('weather-metric-agenda').click();
    const track=document.querySelector('.weather-agenda-vertical');
    const blocks=[...track.querySelectorAll('.weather-agenda-item')];
    const read=block=>block ? {
      cls:block.className,
      label:block.querySelector('b')?.textContent || '',
      aria:block.getAttribute('aria-label') || '',
      height:parseFloat(block.style.height)
    } : {cls:'',label:'',aria:'',height:0};
    const found={
      sleep:read(blocks.find(block=>block.classList.contains('blocked'))),
      tinyA:read(blocks[1]),tinyB:read(blocks[2]),normal:read(blocks[3])
    };
    const overview=document.querySelector('.weather-agenda-overview b')?.textContent || '';
    const firstHour=track.querySelector('.weather-agenda-hour')?.textContent || '';
    const chartHeight=Math.round(track.getBoundingClientRect().height);
    const homePresent=Boolean(document.getElementById('weather-agenda-home'));
    document.getElementById('weather-agenda-home').click();
    const homeClosesAll=!document.getElementById('weather-agenda-sheet').classList.contains('open')
      && !document.getElementById('weather-metric-sheet').classList.contains('open')
      && !document.getElementById('weather-context-sheet').classList.contains('open');
    return {found,overview,firstHour,chartHeight,homePresent,homeClosesAll};
  },seeded);
  assert(busyAndTiny.found.sleep.cls.includes('blocked') && busyAndTiny.found.sleep.label==='sleep'
    && /^busy time sleep/.test(busyAndTiny.found.sleep.aria),
    'blocked times render as distinct busy blocks whose accessibility name says busy time');
  assert(/3 items · 1 busy time/.test(busyAndTiny.overview),'the overview separates items from busy times');
  assert(busyAndTiny.firstHour==='00:00' && busyAndTiny.chartHeight>=1000,
    'a midnight sleep block pulls the chart domain up to 00:00 so earlier hours are scrollable');
  assert(busyAndTiny.found.tinyA.height>=19 && busyAndTiny.found.tinyA.height<40,
    'a tiny item wedged against the next block takes its own lane and still grows tall enough for its name');
  assert(busyAndTiny.found.tinyB.height>=22 && busyAndTiny.found.tinyB.height<40,
    'a tiny item with free room below grows tall enough to print its name');
  assert(busyAndTiny.found.normal.height>=50,'ordinary items keep their proportional height');
  assert(busyAndTiny.homePresent && busyAndTiny.homeClosesAll,
    'home exits the whole comparison → hourly → context stack at once');

  // Home's displayed timeline carries no blocked rows — the comparison must
  // resolve them from settings itself, and skip them when none are defined.
  const busyFromSettings=await page.evaluate(({base})=>{
    saveSortSettings({...loadSortSettings(),blockedTimes:[{label:'sleep',days:[],start:23*60,end:24*60}]});
    sortSettings=loadSortSettings();
    const day={dayBase:base,dayKey:dateKey(base),isToday:true,timeline:[
      {kind:'fill',start:base+9*3600000,end:base+10*3600000,
        h:{hid:'walk',name:'Park walk',type:'habit',target:1,weatherProfileMode:'none'}}
    ]};
    const withBlock=weatherAgendaComparisonRows(base,day,[]);
    saveSortSettings({...loadSortSettings(),blockedTimes:[]});
    sortSettings=loadSortSettings();
    const withoutBlock=weatherAgendaComparisonRows(base,day,[]);
    return {
      withBlock:withBlock.map(row=>({blocked:row.blocked,label:row.label,start:startOfDayOffset(row.start,base)})),
      withoutCount:withoutBlock.length
    };
    function startOfDayOffset(ts,dayBase){return Math.round((ts-dayBase)/60000);}
  },seeded);
  assert(busyFromSettings.withBlock.length===2
    && busyFromSettings.withBlock[1].blocked===true
    && busyFromSettings.withBlock[1].label==='sleep'
    && busyFromSettings.withBlock[1].start===23*60
    && busyFromSettings.withBlock[0].blocked===false,
    'busy times absent from the day timeline are pulled from settings and sorted into the day');
  assert(busyFromSettings.withoutCount===1,'no configured busy times keeps the comparison items-only');

  // Today's comparison is anchored to the current time: a now line marks the
  // position on the chart, the block it falls inside reads as happening now,
  // and the sheet opens scrolled so the line sits under the sticky head. The
  // marker only exists when the render carries a current timestamp, so other
  // days keep the plain top-down view.
  const agendaNow=await page.evaluate(async ({base})=>{
    const now=Date.now();
    const dayRows=[{start:base+9*3600000,end:base+10*3600000,label:'X',hid:'',kind:'fill',blocked:false}];
    const htmlPlain=weatherAgendaTimelineHtml(dayRows,{timezone:''},'temp',[],null);
    const htmlNow=weatherAgendaTimelineHtml(dayRows,{timezone:''},'temp',[],base+9.5*3600000);
    const timeline=[
      {kind:'fill',start:base+9*3600000,end:base+9.5*3600000,
        h:{hid:'morning',name:'Morning run',type:'habit',target:1,weatherProfileMode:'none'}},
      {kind:'fill',start:now-30*60000,end:now+30*60000,
        h:{hid:'current',name:'Deep work',type:'habit',target:1,weatherProfileMode:'none'}}
    ];
    openWeatherContextSheet(base,{dayBase:base,dayKey:dateKey(base),isToday:true,timeline},'');
    document.querySelector('[data-weather-metric="temp"]').click();
    document.getElementById('weather-metric-agenda').click();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const content=document.getElementById('weather-agenda-content');
    const line=document.querySelector('.weather-agenda-now');
    const current=document.querySelector('.weather-agenda-item.current');
    const track=document.querySelector('.weather-agenda-vertical');
    const result={
      plainMarker:htmlPlain.includes('weather-agenda-now'),
      nowMarker:htmlNow.includes('weather-agenda-now'),
      hasLine:Boolean(line),
      lineText:line ? line.textContent.trim() : '',
      offset:line ? line.getBoundingClientRect().top-content.getBoundingClientRect().top : -1,
      scrolled:content.scrollTop,
      maxScroll:content.scrollHeight-content.clientHeight,
      viewport:content.clientHeight,
      currentLabel:current ? current.querySelector('b')?.textContent || '' : '',
      currentAria:current?.getAttribute('aria-label') || ''
    };
    document.getElementById('weather-agenda-done').click();
    document.getElementById('weather-metric-close').click();
    document.getElementById('weather-context-done').click();
    return result;
  },seeded);
  assert(!agendaNow.plainMarker && agendaNow.nowMarker,
    'the now marker renders only when the comparison carries a current timestamp');
  assert(agendaNow.hasLine && /^now · \d{2}:\d{2}$/.test(agendaNow.lineText),
    'today’s comparison draws a labelled now line at the current time');
  const anchored=Math.abs(agendaNow.offset-31)<=12;
  const clamped=Math.abs(agendaNow.scrolled-agendaNow.maxScroll)<=1
    && agendaNow.offset>0 && agendaNow.offset<agendaNow.viewport;
  assert(anchored || clamped,
    'opening today’s comparison starts at the now position — anchored under the sticky head when the day continues below, fully scrolled toward it otherwise');
  assert(agendaNow.currentLabel==='Deep work' && /happening now/.test(agendaNow.currentAria),
    'the block containing the current time is highlighted as happening now');

  // The narrow comparison traces use semantic value colour, subtle zones,
  // and a filled ribbon instead of one flat-colour legacy line.
  const comparisonColour=await page.evaluate(({base})=>{
    const uvRows=[
      {ts:base+9*3600000,uv_index:1},
      {ts:base+10*3600000,uv_index:5},
      {ts:base+11*3600000,uv_index:9},
      {ts:base+12*3600000,uv_index:12}
    ];
    const html=weatherAgendaTraceHtml('uv',uvRows,base+9*3600000,base+13*3600000,320);
    const host=document.createElement('div');
    host.innerHTML=html;
    const svg=host.querySelector('svg');
    return {
      zones:svg.querySelectorAll('.trace-zone').length,
      ribbon:Boolean(svg.querySelector('.trace-area')),
      halo:Boolean(svg.querySelector('.trace-halo')),
      gradientStroke:svg.querySelector('.trace')?.getAttribute('stroke') || '',
      dotTones:[...svg.querySelectorAll('.trace-dot')].map(dot=>dot.getAttribute('class')),
      aria:svg.getAttribute('aria-label') || '',
      uvLow:weatherMetricTone('uv',1),uvHigh:weatherMetricTone('uv',9),
      windLow:weatherMetricTone('wind',8),windHigh:weatherMetricTone('wind',48),
      tempLow:weatherMetricTone('temp',-4),tempHigh:weatherMetricTone('temp',35)
    };
  },seeded);
  assert(comparisonColour.zones>=4 && comparisonColour.ribbon && comparisonColour.halo
    && /^url\(#weather-agenda-gradient-uv\)$/.test(comparisonColour.gradientStroke),
    'comparison line charts use zoned gradient ribbons with a clean halo');
  assert(comparisonColour.dotTones.some(value=>/tone-green/.test(value))
    && comparisonColour.dotTones.some(value=>/tone-red/.test(value))
    && comparisonColour.dotTones.some(value=>/tone-purple/.test(value)),
    'UV points change colour from low through high and extreme');
  assert(comparisonColour.uvLow==='green' && comparisonColour.uvHigh==='red'
    && comparisonColour.windLow==='green' && comparisonColour.windHigh==='orange'
    && comparisonColour.tempLow==='blue' && comparisonColour.tempHigh==='red'
    && /colour indicates low to high/.test(comparisonColour.aria),
    'temperature, wind, and UV share explicit low-to-high visual semantics');

  // Open-time weather starts hidden; the sheet header's cloud toggle reveals
  // four compact controls that can add exactly two charts with shared busy shading.
  const freeWeather=await page.evaluate(({base})=>{
    saveSortSettings({...loadSortSettings(),weatherTempUnit:'c'});
    sortSettings=loadSortSettings();
    const info={
      windowStart:base+9*3600000,windowEnd:base+12*3600000,
      gaps:[{start:base+9*3600000,end:base+10*3600000},{start:base+11*3600000,end:base+12*3600000}],
      busy:[{start:base+10*3600000,end:base+11*3600000}],
      totalFreeMinutes:120,largestGapMinutes:60,nextGapStart:base+9*3600000
    };
    const panel=renderFreePanel(info);
    document.body.appendChild(panel);
    const context=panel.querySelector('.free-weather-context');
    const headerButton=document.getElementById('free-time-weather');
    const initialCharts=context.querySelectorAll('.free-weather-chart').length;
    const compact=context.hidden && !context.textContent.trim()
      && !headerButton.hidden && headerButton.getAttribute('aria-expanded')==='false'
      && !context.querySelector('.free-weather-picker');
    headerButton.click();
    const choices=context.querySelectorAll('[data-free-weather-metric]').length;
    const initialCount=context.querySelector('.free-weather-head em')?.textContent || '';
    context.querySelector('[data-free-weather-metric="precip"]').click();
    const oneChart=context.querySelectorAll('.free-weather-chart').length;
    context.querySelector('[data-free-weather-metric="temp"]').click();
    const twoCharts=context.querySelectorAll('.free-weather-chart').length;
    const disabledAtMax=context.querySelectorAll('[data-free-weather-metric]:disabled').length;
    const start=panel.querySelector('.free-fit-start');
    const end=panel.querySelector('.free-fit-end');
    start.value='09:30';
    start.dispatchEvent(new Event('input',{bubbles:true}));
    end.value='10:30';
    end.dispatchEvent(new Event('input',{bubbles:true}));
    const linkedSelection={
      dayMap:panel.querySelector('.free-day-strip')?.classList.contains('has-selection'),
      dayMapCopy:panel.querySelector('.free-day-focus')?.textContent || '',
      bands:context.querySelectorAll('.free-weather-selection-band').length,
      edges:context.querySelectorAll('.free-weather-selection-edge').length,
      focusHead:context.querySelector('.free-weather-head small')?.textContent || '',
      focusedCaptions:[...context.querySelectorAll('.free-weather-chart figcaption b')].map(node=>node.textContent),
      tones:[...context.querySelectorAll('.free-weather-chart')].map(node=>node.dataset.selectionTone)
    };
    const busyMasks=[...context.querySelectorAll('.free-weather-chart')]
      .map(chart=>chart.querySelectorAll('.free-weather-busy').length);
    const heights=[...context.querySelectorAll('.free-weather-chart svg')]
      .map(svg=>Math.round(svg.getBoundingClientRect().height));
    context.querySelector('[data-free-weather-metric="precip"]').click();
    const afterRemove=context.querySelectorAll('.free-weather-chart').length;
    const enabledAfterRemove=context.querySelectorAll('[data-free-weather-metric]:not(:disabled)').length;
    context.remove();
    context.querySelector('[data-free-weather-metric="temp"]').click();
    const allOff=context.querySelectorAll('.free-weather-chart').length;
    const compactAgain=context.hidden && !context.textContent.trim()
      && headerButton.getAttribute('aria-expanded')==='false'
      && !context.querySelector('.free-weather-picker');
    return {initialCharts,compact,initialCount,choices,oneChart,twoCharts,disabledAtMax,linkedSelection,busyMasks,heights,afterRemove,enabledAfterRemove,allOff,compactAgain};
  },seeded);
  assert(freeWeather.initialCharts===0 && freeWeather.compact && freeWeather.initialCount==='0/2',
    'weather context stays hidden until the header cloud toggle opens it');
  assert(freeWeather.choices===4 && freeWeather.oneChart===1 && freeWeather.twoCharts===2 && freeWeather.disabledAtMax===2,
    'open time offers all four measures and enforces a two-chart maximum');
  assert(freeWeather.busyMasks.every(count=>count===1) && freeWeather.heights.every(height=>height<=60),
    'each mini chart stays short and shades the same occupied time span');
  assert(freeWeather.linkedSelection.dayMap && /9:30.*10:30/i.test(freeWeather.linkedSelection.dayMapCopy)
    && freeWeather.linkedSelection.bands===2 && freeWeather.linkedSelection.edges===4
    && /9:30.*10:30/i.test(freeWeather.linkedSelection.focusHead)
    && freeWeather.linkedSelection.focusedCaptions.some(copy=>/20%/.test(copy))
    && freeWeather.linkedSelection.focusedCaptions.some(copy=>/10–11°C/.test(copy))
    && freeWeather.linkedSelection.tones.every(tone=>tone==='active'),
    `changing the time fields links one exact focus window across the day map and both weather charts (${JSON.stringify(freeWeather.linkedSelection)})`);
  assert(freeWeather.afterRemove===1 && freeWeather.enabledAfterRemove===4,
    'removing one chart immediately makes every weather choice available again');
  assert(freeWeather.allOff===0 && freeWeather.compactAgain,
    'removing the final chart folds weather context away behind the header toggle');

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

  // Precipitation + wind imperial mode: every rendered speed and amount
  // converts at the last formatting step; the stored forecast stays metric.
  const imperial=await page.evaluate(({base,key})=>{
    saveSortSettings({...loadSortSettings(),weatherTempUnit:'c',weatherPrecipUnit:'in',weatherWindUnit:'mph'});
    sortSettings=loadSortSettings();
    const settings=sortSettings;
    const cue=weatherDayCueHtml(base,{dayBase:base,dayKey:key,isToday:true,timeline:[],homeDisplayedTimeline:[]},settings,{data:[]});
    const sheet=renderWeatherContextSheet(weatherContextSheetModel(base,null,''))!==false
      ? document.querySelector('#weather-context-sheet').textContent : '';
    const block=overviewDayWeatherBlockHtml(key,{dayBase:base,dayKey:key,isToday:true,timeline:[],homeDisplayedTimeline:[]},[]);
    const pill=weatherPeriodPillHtml(base+9*3600000,base+12*3600000,settings,{});
    const storedDaily=loadSortSettings()._weatherContext.days[0];
    return {
      conversions:{wind:weatherWindConverted(9),mm:weatherPrecipConverted(25.4),cm:weatherSnowConverted(2.54)},
      snowUnit:weatherSnowUnitLabel(),
      cue,sheet,block,pill,
      storedWind:storedDaily.wind_speed_10m_max,storedPrecip:storedDaily.precipitation_sum
    };
  },seeded);
  assert(Math.abs(imperial.conversions.wind-5.592)<0.001 && imperial.conversions.mm===1 && imperial.conversions.cm===1,
    '9 km/h converts to ~5.59 mph; 25.4 mm and 2.54 cm convert to exactly 1 in');
  assert(imperial.snowUnit==='in','snowfall follows the precipitation setting (inches)');
  assert(/6 mph wind/.test(imperial.cue) && !/km\/h/.test(imperial.cue),'mph converts the day-cue wind detail (9 km/h → 6 mph)');
  assert(/6 mph/.test(imperial.sheet) && /gusts 9/.test(imperial.sheet) && /0 in/.test(imperial.sheet) && !/km\/h/.test(imperial.sheet),
    'context sheet cards convert wind, gusts, and the mm total (0.6 mm → 0 in)');
  assert(/6 mph wind/.test(imperial.block),'overview day block converts the wind detail');
  assert(/6 mph wind/.test(imperial.pill),'period pills convert the wind accessibility detail');
  assert(imperial.storedWind===9 && imperial.storedPrecip===0.5,'the stored forecast stays km/h and mm — conversion is display-only');

  // Auto + a stored US country resolves to inches and mph with no override;
  // Liberia stays on metric measures even though it tempers in Fahrenheit.
  const imperialAuto=await page.evaluate(({base})=>{
    saveSortSettings({...loadSortSettings(),weatherPrecipUnit:'auto',weatherWindUnit:'auto',homeCityName:'New York',homeCityCountry:'US'});
    sortSettings=loadSortSettings();
    const cue=weatherDayCueHtml(base,{dayBase:base,dayKey:dateKey(base),isToday:true,timeline:[],homeDisplayedTimeline:[]},sortSettings,{data:[]});
    return {cue,wind:weatherWindUnitLabel(),precip:weatherPrecipUnitLabel(),snow:weatherSnowUnitLabel()};
  },seeded);
  assert(imperialAuto.wind==='mph' && imperialAuto.precip==='in' && imperialAuto.snow==='in',
    'auto + US home city resolves mph, inches, and snowfall in inches');
  assert(/mph wind/.test(imperialAuto.cue),'auto + US renders mph on day cues with no explicit override');

  // The hourly drill-down converts its stats, marks, and readout too.
  const imperialDrill=await page.evaluate(({base})=>{
    openWeatherContextSheet(base,null,'');
    document.querySelector('[data-weather-metric="wind"]').click();
    const windStats=[...document.querySelectorAll('#weather-metric-content .weather-metric-stat')]
      .map(stat=>stat.textContent.replace(/\s+/g,' ').trim());
    const windMarks=[...document.querySelectorAll('#weather-metric-content svg .mark')].map(m=>m.textContent);
    const windReadout=document.getElementById('weather-metric-readout').textContent.replace(/\s+/g,' ').trim();
    document.getElementById('weather-metric-close').click();
    document.querySelector('[data-weather-metric="precip"]').click();
    const precipStats=[...document.querySelectorAll('#weather-metric-content .weather-metric-stat')]
      .map(stat=>stat.textContent.replace(/\s+/g,' ').trim());
    document.getElementById('weather-metric-close').click();
    document.getElementById('weather-context-done').click();
    // Reset to the metric defaults (no stored country) for the later blocks.
    saveSortSettings({...loadSortSettings(),weatherPrecipUnit:'auto',weatherWindUnit:'auto',homeCityName:'',homeCityCountry:''});
    sortSettings=loadSortSettings();
    return {windStats,windMarks,windReadout,precipStats};
  },seeded);
  assert(/wind\s*up\s*to\s*6\s*mph/.test(imperialDrill.windStats.join(' ')) && /gusts\s*up\s*to\s*9\s*mph/.test(imperialDrill.windStats.join(' ')),
    'wind stat chips pair the mph peak with the mph gust figure (9/14 km/h → 6/9 mph)');
  assert(imperialDrill.windMarks.includes('6'),'mph converts the on-chart wind callout');
  assert(/6 mph/.test(imperialDrill.windReadout) && /gusts/.test(imperialDrill.windReadout),'the wind readout pairs mph speed with gusts');
  assert(/total\s*0\s*in/.test(imperialDrill.precipStats.join(' ')),'the precipitation total chip converts mm → in');

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
    // The scrub starts at the current wall-clock hour, so walk to the last
    // seeded hour first — otherwise this block only passes in the afternoon.
    const chart=document.querySelector('#weather-metric-content svg.weather-metric-chart');
    for(let i=0;i<24;i++)chart.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
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
    saveSortSettings({...loadSortSettings(),weatherWindUnit:'mph'});
    sortSettings=loadSortSettings();
    const windMph=open('wind');
    saveSortSettings({...loadSortSettings(),weatherWindUnit:'auto'});
    sortSettings=loadSortSettings();
    const precip=open('precip');
    const uv=open('uv');
    document.getElementById('weather-context-done').click();
    return {temp,tempF,wind,windMph,precip,uv};
  },seeded);
  assert(refLines.temp.refs.join()==='freezing 0°' && refLines.temp.meta.geom.yMin<0,
    'the freezing line draws inside a sub-zero day and the domain keeps the negative floor');
  assert(refLines.temp.meta.primary.every(v=>v>=refLines.temp.meta.geom.yMin && v<=refLines.temp.meta.geom.yMax),
    'every feels-like sample stays inside the chart frame on a sub-zero day');
  assert(refLines.temp.sunMarks===2,'the feels-like chart carries the sunrise/sunset context too');
  assert(refLines.tempF.refs.join()==='freezing 32°','°F converts the freezing reference label');
  assert(refLines.wind.refs.join()==='strong 39' && refLines.wind.meta.geom.yMax>=45,
    'the wind chart marks the strong-breeze threshold the shared frame still covers gusts');
  assert(refLines.windMph.refs.join()==='strong 24','mph converts the wind reference label (39 km/h → 24 mph)');
  assert(refLines.precip.refs.join()==='even 50%','the precipitation chart marks the even-chance line');
  assert(refLines.uv.refs.join()==='moderate 3','the UV chart marks the moderate level when the peak reaches it');
  assert(errors.length===0,'no page errors during unit switching');

  await browser.close();
  console.log(`\nweather-unit-test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(error=>{console.error(error);process.exit(1);});
