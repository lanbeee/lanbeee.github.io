// Catalog spelling recovery and local, confirmed field-question controls.
const {chromium, BASE, waitForAssistant}=require('./helpers/planner-test-helpers');
let passed=0;
function assert(ok,message){if(!ok)throw new Error(message);passed++;console.log(`  ok: ${message}`);}
(async()=>{
  let browser;try{browser=await chromium.launch({headless:true,channel:'chrome'});}catch(_){browser=await chromium.launch({headless:true});}
  try{
    const page=await browser.newPage({serviceWorkers:'block',viewport:{width:390,height:844}});
    await page.goto(BASE);await waitForAssistant(page);
    await page.evaluate(()=>{
      window.pickerTest={
        seed(){
          saveSortSettings({...loadSortSettings(),locations:[
            {id:'a',name:'LocationA',lat:40,lng:-74},{id:'b',name:'LocationB',lat:41,lng:-74},
            {id:'home',name:'Home',lat:40,lng:-74},{id:'work',name:'Work',lat:40,lng:-74},
            {id:'park',name:'Park',lat:40,lng:-74},{id:'gym',name:'Gym',lat:40,lng:-74}
          ],topics:['Health','Learning','Work','Travel','Family','Personal'],weatherProfiles:[{id:'dry',name:'Dry weather',rules:[]} ]});
          save([{hid:'target',name:'Walk',type:'keepup',target:7,durationMinutes:30,priority:2,logs:[],topics:['Work'],locationIds:['home'],anywhereAllowed:true}]);
        },
        open(){return assistantFocusOpen({operation:'edit',kind:'habit',targetId:'target',entry:'detail'});},
        options(decline=false){return {rank:async()=>({rankings:[]}),extract:async spec=>{
          if(spec.family==='families')return {confidence:1,function_calls:[{arguments:{evidence:'',outside:''}}]};
          if(spec.family==='completeness')return {confidence:1,function_calls:[{arguments:{missing:''}}]};
          if(spec.family==='family-routing')return {confidence:1,function_calls:[{arguments:{family:'conversation'}}]};
          const [key,property]=Object.entries(spec.tool.parameters.properties)[0];
          return {confidence:1,function_calls:[{name:spec.tool.name,arguments:{[key]:decline?'':property.enum?.[0]||''}}]};
        }};}
      };
    });
    const matching=await page.evaluate(()=>{
      pickerTest.seed();const s=pickerTest.open(),def=assistantFieldCatalog().find(f=>f.id==='places');
      const parse=text=>assistantFieldNormalize(def,text,s);
      return {
        typo:parse('This will be done at locaton A'),space:parse('At Location A'),
        transpose:parse('At Wrok'),ambiguous:parse('At LocationC'),unknown:parse('At Moonbase'),
        extended:parse('At Home Annex'),negative:parse('Not at Home'),
        topic:assistantFocusNormalize('topics','Helath',s),
        newTopic:assistantFocusNormalize('topics','Astronomy',s)
      };
    });
    for(const key of ['typo','space'])assert(matching[key].ok&&matching[key].changes[0].value[0]==='a',`${key}: complete location names tolerate spacing and spelling`);
    assert(matching.transpose.ok&&matching.transpose.changes[0].value[0]==='work','adjacent typing errors resolve locally');
    assert(!matching.ambiguous.ok&&!matching.unknown.ok&&!matching.extended.ok&&!matching.negative.ok,'competing names, unknown places, longer names and negation never pick a place');
    assert(/“Moonbase” isn’t a saved place/.test(matching.unknown.error)&&/Which one/.test(matching.ambiguous.error),`questions name the place that was not found (${matching.unknown.error} / ${matching.ambiguous.error})`);
    assert(matching.topic.value[0]==='Health'&&matching.newTopic.value[0]==='Astronomy','topics recover a unique typo and still allow new names');
    const turns=await page.evaluate(async()=>{
      const results=[];
      for(const text of ['This will be done at locaton A','This is done only at locaton A','Only at Location A','This can only be done at LocationA','Do this at LocationA only','This is done at only LocationA','This is only done at LocationA']){
        pickerTest.seed();const s=pickerTest.open(),before=JSON.stringify(load());
        await assistantFocusTurn(s,text,pickerTest.options());
        results.push({text,r:assistantFocusMaterialize(s),ready:assistantFocusCanSave(s),unchanged:before===JSON.stringify(load()),questions:s.unresolved});
      }
      return results;
    });
    for(const [i,result] of turns.entries())assert(result.ready===(i!==0)&&result.unchanged&&result.r.locationIds.join()==='a'&&result.r.anywhereAllowed===(i===0)
      &&(i!==0||result.questions.some(q=>q.placeFollowup)),`full field pipeline: ${result.text} (${JSON.stringify(result.questions)})`);
    const followups=await page.evaluate(async()=>{
      const runs=[];
      for(const answer of ['yes','no']){
        pickerTest.seed();const s=pickerTest.open(),before=JSON.stringify(load());
        await assistantFocusTurn(s,'This will be done at locaton A',pickerTest.options());
        const staged=assistantFocusMaterialize(s).locationIds.join()==='a'&&!assistantFocusCanSave(s);
        const q=s.unresolved.find(row=>row.placeFollowup),trace=s.trace.length;
        const chosen=assistantFocusChoose(s,'anywhereAllowed',answer);
        assistantFocusReviewModel(s);
        const ready=assistantFocusCanSave(s),local=trace===s.trace.length,unchanged=before===JSON.stringify(load());
        const commit=await assistantFocusCommit(s);
        runs.push({ok:staged&&q.choices.length===2&&chosen.ok&&ready&&local&&unchanged&&commit.ok
          &&load()[0].locationIds.join()==='a'&&load()[0].anywhereAllowed===(answer==='yes'),answer,staged,chosen,ready,local,unchanged,commit});
      }
      pickerTest.seed();const explicit=pickerTest.open();
      await assistantFocusTurn(explicit,'Set the place to LocationA; allow anywhere',pickerTest.options());
      const noRepeat=!explicit.unresolved.length&&assistantFocusCanSave(explicit);
      pickerTest.seed();save([{...load()[0],anywhereAllowed:false}]);const restricted=pickerTest.open();
      await assistantFocusTurn(restricted,'Set the place to LocationA',pickerTest.options());
      return {runs,noRepeat,restricted:!restricted.unresolved.length&&assistantFocusCanSave(restricted)&&!assistantFocusMaterialize(restricted).anywhereAllowed};
    });
    assert(followups.runs.every(row=>row.ok),`places stage first, then either Anywhere answer resolves locally and saves only on confirmation (${JSON.stringify(followups.runs)})`);
    assert(followups.noRepeat&&followups.restricted,'explicit Anywhere instructions and existing restrictions avoid unnecessary questions');
    const resolvedFollowup=await page.evaluate(async()=>{
      pickerTest.seed();const s=pickerTest.open();await assistantFocusTurn(s,'This will be done at LocationC',pickerTest.options());
      const first=s.unresolved.some(q=>q.field==='places')&&!s.unresolved.some(q=>q.placeFollowup);
      const trace=s.trace.length;assistantFocusPickValues(s,'places',['a']);
      const next=s.unresolved.some(q=>q.placeFollowup)&&!s.unresolved.some(q=>q.field==='places')&&!assistantFocusCanSave(s);
      assistantFocusCorrect(s,'places','clear');
      return first&&next&&trace===s.trace.length&&!s.unresolved.some(q=>q.placeFollowup);
    });
    assert(resolvedFollowup,'an unknown location is resolved before asking Anywhere; clearing it removes the follow-up');
    const declined=await page.evaluate(async()=>{
      pickerTest.seed();const s=pickerTest.open();await assistantFocusTurn(s,'This will be done at locaton A',pickerTest.options(true));
      return !s.changes.length&&!assistantFocusCanSave(s)&&assistantFocusReviewHtml(s).includes('data-focus-picker="places"');
    });
    assert(declined,'a declined model read asks with saved choices and never supplies a parsed fallback');
    const ambiguous=await page.evaluate(async()=>{
      pickerTest.seed();const s=pickerTest.open();await assistantFocusTurn(s,'Only at Home and LocationC',pickerTest.options());
      const q=s.unresolved.find(row=>row.field==='places'),picker=assistantFocusQuestionPicker(s,q);
      const before=JSON.stringify(load()),blocked=!assistantFocusCanSave(s),trace=s.trace.length;
      const picked=assistantFocusPickValues(s,'places',['home','a']);
      return {q,picker,picked,blocked,ready:assistantFocusCanSave(s),r:assistantFocusMaterialize(s),local:trace===s.trace.length,unchanged:before===JSON.stringify(load())};
    });
    assert(ambiguous.blocked&&ambiguous.q.selection.includes('home')&&ambiguous.picker.options.length===6,'a multiple-place question keeps resolved partners and exposes the complete saved catalog');
    assert(ambiguous.picked.ok&&ambiguous.ready&&ambiguous.local&&ambiguous.unchanged&&ambiguous.r.locationIds.join()==='home,a'&&!ambiguous.r.anywhereAllowed,'a choice resolves only its field, preserves only-at intent, and needs no inference or write');
    const guards=await page.evaluate(()=>{
      pickerTest.seed();const s=pickerTest.open();assistantFocusUnresolve(s,{field:'places',question:'Choose places'});
      const empty=assistantFocusPickValues(s,'places',[]),bad=assistantFocusPickValues(s,'places',['missing']);
      s._focusInFlight=true;const busy=assistantFocusPickValues(s,'places',['a']);s._focusInFlight=false;
      assistantFocusPickValues(s,'places',['a']);const stale=assistantFocusPickValues(s,'places',['b']);
      return !empty.ok&&!bad.ok&&!busy.ok&&!stale.ok&&assistantFocusMaterialize(s).locationIds.join()==='a';
    });
    assert(guards,'empty, invalid, in-flight and retired choices cannot change the draft');
    const finite=await page.evaluate(()=>{
      pickerTest.seed();const s=pickerTest.open();
      const fields=['priority','pinned','topics','weatherProfile','weatherLocationId'];
      const rows=fields.map(field=>{assistantFocusUnresolve(s,{field,question:'Choose a value'});return assistantFocusQuestionPicker(s,s.unresolved.find(row=>row.field===field));});
      const missing=assistantFocusQuestionPicker(s,{field:'reminderDnd'});
      return {rows,missing};
    });
    assert(finite.rows.every(row=>row?.options.length)&&finite.missing===null,'known values get field-specific menus while native-only controls stay absent in the PWA');
    // Exercise the actual delegated mobile controls, explicit staging, then Save.
    await page.evaluate(()=>{
      pickerTest.seed();patchLocalAssistant({localAssistant:true,localAssistantProvider:'needle'});
      assistantOpenForItem('target','detail');const s=_assistantSession.focus;
      assistantFocusUnresolve(s,{field:'topics',family:'organization',question:'Which topics should this use?'});
      assistantShowFocusReview(s);window.pickerBefore=JSON.stringify(load());window.pickerTrace=(s.trace||[]).length;
    });
    const box=page.locator('[data-focus-picker="topics"]');
    assert(await box.locator('[data-focus-option]').count()===6,'mobile topics show every saved option as a chip');
    assert(await box.locator('[data-focus-pick]').isDisabled(),'the apply button waits for an explicit choice');
    await box.locator('[data-focus-option="Health"]').click();await box.locator('[data-focus-option="Learning"]').click();
    await box.locator('[data-focus-option="Work"]').click();await box.locator('[data-focus-option="Work"]').click();
    assert(await box.locator('[data-focus-pick]').textContent()==='Use 2 selected'&&await page.evaluate(()=>!assistantFocusMaterialize(_assistantSession.focus).topics.includes('Health')),
      'toggling chips counts the selection without staging it');
    await page.screenshot({path:'test-results/assistant-value-picker-mobile.png'});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'the mobile picker fits the viewport');
    await box.locator('[data-focus-pick]').click();
    assert(await page.evaluate(()=>{
      const s=_assistantSession.focus;return JSON.stringify(load())===pickerBefore&&(s.trace||[]).length===pickerTrace&&assistantFocusMaterialize(s).topics.join()==='Health,Learning'&&assistantFocusCanSave(s);
    }),'mobile topic choices stage immediately without a model call or persistence');
    await page.locator('[data-focus-save]').click();
    assert(await page.evaluate(()=>load()[0].topics.join()==='Health,Learning'&&load()[0].locationIds.join()==='home'),'Save persists only the chosen settings');
    await page.evaluate(()=>{
      assistantOpenForItem('target','detail');const s=_assistantSession.focus;
      assistantFocusUnresolve(s,{field:'priority',question:'Which priority?'});assistantShowFocusReview(s);
    });
    assert(await page.locator('[data-focus-picker="priority"] [data-focus-pick]').count()===0
      &&await page.locator('[data-focus-option="1"]').textContent()==='P1','single choices are labelled chips without a separate apply step');
    await page.locator('[data-focus-picker="priority"] [data-focus-option="1"]').click();
    assert(await page.evaluate(()=>assistantFocusMaterialize(_assistantSession.focus).priority===1&&load()[0].priority===2),'one tap stages priority and still waits for Save');
    // Needle's product entry is the embedded item Summary, with its own events.
    await page.evaluate(()=>{
      closeAssistantSheet();pickerTest.seed();openDetail(0);scrollDetailToNav('summary','auto');
      const s=pickerTest.open();detailSummary.session=s;
      assistantFocusStage(s,{field:'pinned',value:true,origin:'correction'});
      assistantFocusUnresolve(s,{field:'places',family:'places',question:'Choose the places where this can happen.',placeOnly:true,selection:['home']});
      detailSummaryShowProposal();window.summaryBefore=JSON.stringify(load());
    });
    const summary=page.locator('[data-detail-proposal]:not(.is-retired)');
    assert(await summary.locator('[data-focus-option="home"]').getAttribute('aria-pressed')==='true','already-resolved places start selected');
    await summary.locator('[data-focus-option="a"]').click();
    await page.screenshot({path:'test-results/assistant-summary-picker-mobile.png'});
    await summary.locator('[data-focus-pick]').click();
    const product=await page.evaluate(()=>{
      const s=detailSummary.session,r=assistantFocusMaterialize(s);
      return {r,ready:assistantFocusCanSave(s),unchanged:JSON.stringify(load())===summaryBefore,questions:s.unresolved,error:s.correctionError};
    });
    assert(product.r.locationIds.slice().sort().join()==='a,home'&&!product.r.anywhereAllowed&&product.r.pinned&&product.ready&&product.unchanged,'the product Summary stages selected places, keeps earlier edits and removes Anywhere for only-at requests');
    await summary.locator('[data-focus-save]').click();
    assert(await page.evaluate(()=>load()[0].locationIds.slice().sort().join()==='a,home'&&!load()[0].anywhereAllowed&&load()[0].pinned),'Summary Save confirms the complete location restriction');
    await page.evaluate(()=>{
      pickerTest.seed();openDetail(0);scrollDetailToNav('summary','auto');
      const s=pickerTest.open();detailSummary.session=s;
      assistantFocusCorrect(s,'places','a');detailSummaryShowProposal();window.summaryBefore=JSON.stringify(load());
    });
    assert(await summary.locator('[data-focus-choice="anywhereAllowed"]').count()===2,'Summary asks Anywhere with two direct buttons after staging the place');
    await summary.locator('[data-focus-choice="anywhereAllowed"][data-focus-value="no"]').click();
    assert(await page.evaluate(()=>{
      const s=detailSummary.session,r=assistantFocusMaterialize(s);
      return r.locationIds.join()==='a'&&!r.anywhereAllowed&&assistantFocusCanSave(s)&&JSON.stringify(load())===summaryBefore;
    }),'the follow-up button keeps the requested place and stages its permission without inference or a write');
    await summary.locator('[data-focus-save]').click();
    assert(await page.evaluate(()=>load()[0].locationIds.join()==='a'&&!load()[0].anywhereAllowed),'the reviewed follow-up saves its place and Anywhere answer together');
    console.log(`\n${passed} passed`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
