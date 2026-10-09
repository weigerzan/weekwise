const {createRequire}=require('node:module');
const path=require('node:path');
const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
const runtimeRequire=process.env.PLAYWRIGHT_MODULE?createRequire(path.join(process.env.PLAYWRIGHT_MODULE,'package.json')):require;
const {_electron}=runtimeRequire('playwright');
(async()=>{
  const root=path.resolve(__dirname,'..'),directory=path.join(root,'test-results',`day-${Date.now()}`);
  const {dateKey,addDays}=await import('../src/planner.js');const date=dateKey();
  const base={priority:'medium',minutes:60,due:null,scheduled:date,locked:true,done:false,notes:''};
  const initial={version:1,settings:{capacities:[240,240,240,240,240,240,240],preferences:''},tasks:[
    {...base,id:'review',title:'审稿',minutes:120},
    {...base,id:'meeting',title:'组会',timeSlot:{start:'17:00',end:'18:00',reminders:[]}},
    {...base,id:'write',title:'修改稿件'},
    {...base,id:'done',title:'已完成的任务',done:true,actualMinutes:55},
    {...base,id:'other',title:'明天的任务',scheduled:addDays(date,1)}
  ]};
  await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'tasks.json'),JSON.stringify(initial));
  const executablePath=process.env.WEEKWISE_EXECUTABLE||path.join(root,'node_modules','electron','dist','electron.exe');
  const app=await _electron.launch({executablePath,args:process.env.WEEKWISE_EXECUTABLE?[]:[root],env:{...process.env,WEEKWISE_TEST:'1',WEEKWISE_DATA_DIR:directory},timeout:30000});
  let page;const errors=[];
  try{
    page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.waitForSelector('.week-board');
    await page.locator('[data-action=settings]').first().click();
    assert.equal(await page.locator('#routine-start').inputValue(),'10:30');assert.equal(await page.locator('#routine-end').inputValue(),'21:00');
    assert.equal(await page.locator('.routine-break-row').count(),2);
    await page.locator('#routine-end').fill('22:00');await page.locator('#routine-preferences').fill('优先审稿');
    await page.locator('#routine-add-break').click();assert.equal(await page.locator('.routine-break-row').count(),3);
    await page.locator('.routine-break-row').last().locator('button').click();
    await page.locator('#ai-key').fill('fake-day-plan-key');
    await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.showInactive();});
    await page.screenshot({path:path.join(root,'test-results','daily-routine-settings.png')});
    await page.locator('#settings-dialog [data-close=settings-dialog]').click();await page.locator('#settings-dialog').waitFor({state:'hidden'});
    const baseline=await page.evaluate(()=>window.desktop.read());assert.equal(baseline.settings.dailyRoutine.end,'22:00');assert.deepEqual(baseline.tasks,initial.tasks);
    await app.evaluate(({net})=>{
      globalThis.dayOriginalFetch=net.fetch;globalThis.dayMode='base';globalThis.dayInputs=[];
      net.fetch=async(url,options)=>{
        if(url!=='https://api.deepseek.com/chat/completions')return globalThis.dayOriginalFetch.call(net,url,options);
        const body=JSON.parse(options.body),input=JSON.parse(body.messages[1].content);globalThis.dayInputs.push(input);
        if(!input.baseRoutine||!input.allowedTaskIds)throw Error('Expected day planning payload');
        const value=globalThis.dayMode==='infeasible'?{feasible:false,summary:'当前结束时间太早，排不下全部任务',assumptions:[],issues:['需要3小时普通工作，加上原有定时组会和吃饭空档'],suggestions:['放宽当天结束时间，或者把修改稿件移到别的日期'],assignments:[],breaks:[]}:{
          feasible:true,summary:globalThis.dayMode==='parallel'?'组会后一个小时同时批改考试题，组会时间保留。':globalThis.dayMode==='override'?'这一天8点开始，15–17点保留空档，20点结束。':'按日常作息安排，审稿分两段。',assumptions:['工作时段为建议安排'],issues:[],suggestions:[],
          assignments:input.tasks.map(t=>({id:t.id,slots:t.title==='审稿'?(globalThis.dayMode==='override'?[{start:'08:00',end:'09:00'},{start:'13:30',end:'14:30'}]:[{start:'11:00',end:'12:00'},{start:'13:30',end:'14:30'}]):globalThis.dayMode==='parallel'?[{start:'16:00',end:'17:00'}]:globalThis.dayMode==='override'?[{start:'10:00',end:'11:00'}]:[{start:'14:30',end:'15:30'}]})),
          breaks:globalThis.dayMode==='override'?[...input.baseRoutine.breaks,{title:'其它事情',start:'15:00',end:'17:00'}]:input.baseRoutine.breaks,
          overlaps:globalThis.dayMode==='parallel'?[{ids:[input.tasks.find(t=>t.title==='批改考试题').id,input.fixedTasks.find(t=>t.title==='组会').id],start:'16:00',end:'17:00',permission:input.description}]:[]
        };
        return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}));
      };
    });
    await page.locator(`[data-plan-day="${date}"]`).click();
    assert.equal(await page.locator('#day-plan-date').inputValue(),date);assert.match(await page.locator('#day-plan-base').innerText(),/10:30–22:00/);
    await page.locator('#day-plan-generate').click();await page.waitForFunction(()=>!document.getElementById('day-plan-apply').disabled);
    assert.equal(await page.locator('.day-timeline-row').count(),6);assert.match(await page.locator('#day-plan-preview').innerText(),/11:00–12:00.*午饭.*13:30–14:30/s);
    assert.deepEqual(await page.evaluate(()=>window.desktop.read()),baseline);
    const previous=await page.locator('#day-plan-preview').innerHTML();
    await page.locator('#day-plan-example').click();assert.equal(await page.locator('#day-plan-preview').innerHTML(),previous);assert.equal(await page.locator('#day-plan-apply').isDisabled(),true);
    await app.evaluate(()=>{globalThis.dayMode='override';});
    await page.locator('#day-plan-generate').click();await page.waitForFunction(()=>!document.getElementById('day-plan-apply').disabled);
    assert.match(await page.locator('#day-plan-preview').innerText(),/08:00–09:00/);assert.match(await page.locator('#day-plan-preview').innerText(),/15:00–17:00.*其它事情/s);
    const inputs=await app.evaluate(()=>globalThis.dayInputs);assert.equal(inputs[1].baseRoutine.start,'10:30');assert.equal(inputs[1].baseRoutine.end,'22:00');assert.match(inputs[1].description,/8点开始.*3-5.*8点之后/s);
    await page.locator('#day-plan-preview').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(root,'test-results','day-plan-preview.png')});
    await page.locator('#day-plan-apply').click();await page.locator('#day-plan-dialog').waitFor({state:'hidden'});
    let saved=await page.evaluate(()=>window.desktop.read());assert.deepEqual(saved.tasks,baseline.tasks);assert.equal(saved.settings.dailyRoutine.start,'10:30');assert.equal(saved.settings.dailyRoutine.end,'22:00');assert.ok(saved.settings.dayOverrides[date]);assert.ok(saved.dayPlans[date]);
    assert.equal(await page.locator('[data-task=review] .work-slots span').count(),2);assert.equal(await page.locator('[data-task=review]').count(),1);
    const created=app.waitForEvent('window');await page.locator('[data-action=float]').click();let widget=await created;widget.on('pageerror',e=>errors.push(e.message));await widget.waitForSelector('.widget-task');
    assert.match(await widget.locator('.widget-task:has([data-toggle=review]) .widget-work-slots').innerText(),/08:00–09:00.*13:30–14:30/);
    const compactCreated=app.waitForEvent('window');await widget.locator('#widget-mode').click();widget=await compactCreated;widget.on('pageerror',e=>errors.push(e.message));await widget.waitForSelector('[data-toggle=review]');
    assert.equal(await widget.locator('[data-toggle=review]').count(),1);assert.match(await widget.locator('.widget-task:has([data-toggle=review])').innerText(),/08:00–09:00/);
    await widget.locator('[data-toggle=review]').click();await widget.locator('#completion-minutes').fill('130');await widget.locator('#completion-save').click();await page.waitForSelector('[data-task=review].done');await widget.locator('[data-toggle=review]').waitFor({state:'detached'});
    saved=await page.evaluate(()=>window.desktop.read());assert.equal(saved.tasks.find(t=>t.id==='review').actualMinutes,130);assert.ok(saved.dayPlans[date]);assert.equal(saved.tasks.find(t=>t.id==='write').done,false);
    await page.locator('[data-view=today]').click();assert.equal(await page.locator('.today-agenda .day-timeline-row.finished').count(),2);
    await page.locator('[data-task=review] [data-toggle=review]').click();await widget.waitForSelector('[data-toggle=review]');
    await page.reload();await page.waitForSelector('[data-task=review] .work-slots');
    assert.ok(JSON.parse(await fs.readFile(path.join(directory,'tasks.json'),'utf8')).dayPlans[date]);
    await page.locator('[data-view=today]').click();await page.screenshot({path:path.join(root,'test-results','day-plan-today.png'),fullPage:true});
    // Another window completing a task must make an unapplied preview stale.
    await page.locator('[data-action=dayplan]').click();assert.match(await page.locator('#day-plan-description').inputValue(),/8点开始/);
    await page.locator('#day-plan-generate').click();await page.waitForFunction(()=>!document.getElementById('day-plan-apply').disabled);
    await widget.locator('[data-toggle=write]').click();await widget.locator('#completion-skip').click();await page.waitForSelector('[data-task=write].done');
    await page.locator('#day-plan-apply').click();assert.equal(await page.locator('#day-plan-apply').isDisabled(),true);await page.locator('[data-close=day-plan-dialog]').first().click();
    // Infeasible generation keeps the previously applied agenda and base routine.
    const beforeImpossible=await page.evaluate(()=>window.desktop.read());await app.evaluate(()=>{globalThis.dayMode='infeasible';});
    await page.locator('[data-action=dayplan]').click();await page.locator('#day-plan-description').fill('上午只工作半小时，不能增加其它时段');await page.locator('#day-plan-generate').click();await page.waitForSelector('#day-plan-preview .day-result');
    assert.match(await page.locator('#day-plan-preview').innerText(),/放宽当天结束时间/);assert.equal(await page.locator('#day-plan-apply').isDisabled(),true);assert.deepEqual(await page.evaluate(()=>window.desktop.read()),beforeImpossible);
    await page.locator('#day-plan-clear').click();await page.locator('#day-plan-dialog').waitFor({state:'hidden'});assert.equal((await page.evaluate(()=>window.desktop.read())).dayPlans,undefined);
    await page.locator('#undo-btn').click();await page.waitForSelector('[data-task=review] .work-slots');assert.deepEqual(await page.evaluate(()=>window.desktop.read()),beforeImpossible);
    // Editing effort clears stale slots while keeping that date's natural exceptions.
    await page.locator('[data-task=review]').click();await page.locator('#task-minutes').fill('90');await page.locator('#task-form button[type=submit]').click();await page.locator('#task-dialog').waitFor({state:'hidden'});
    saved=await page.evaluate(()=>window.desktop.read());assert.equal(saved.dayPlans,undefined);assert.ok(saved.settings.dayOverrides[date]);
    await page.locator('#undo-btn').click();await page.waitForSelector('[data-task=review] .work-slots');assert.ok((await page.evaluate(()=>window.desktop.read())).dayPlans[date]);
    // Explicit parallel work must survive validation, previews, widgets and reload.
    await page.locator('[data-task=write] [data-toggle=write]').click();await widget.waitForSelector('[data-toggle=write]');
    await page.locator('[data-task=write]').click();await page.locator('#task-title').fill('批改考试题');await page.locator('#task-form button[type=submit]').click();await page.locator('#task-dialog').waitFor({state:'hidden'});
    await page.locator('[data-task=meeting]').click();await page.locator('#task-start-time').fill('15:00');await page.locator('#task-end-time').fill('17:00');await page.locator('#task-form button[type=submit]').click();await page.locator('#task-dialog').waitFor({state:'hidden'});
    const parallelBaseline=await page.evaluate(()=>window.desktop.read()),permission='组会的后一个小时可以用来批改考试题';await app.evaluate(()=>{globalThis.dayMode='parallel';});
    await page.locator('[data-action=dayplan]').click();await page.locator('#day-plan-description').fill(permission);await page.locator('#day-plan-generate').click();await page.waitForFunction(()=>!document.getElementById('day-plan-apply').disabled);
    assert.equal(await page.locator('#day-plan-preview .parallel-note').count(),2);assert.match(await page.locator('#day-plan-preview').innerText(),/16:00–17:00 与「组会」同时进行/);
    assert.deepEqual(await page.evaluate(()=>window.desktop.read()),parallelBaseline);
    await page.locator('#day-plan-preview').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(root,'test-results','day-plan-parallel-preview.png')});
    await page.locator('#day-plan-apply').click();await page.locator('#day-plan-dialog').waitFor({state:'hidden'});
    saved=await page.evaluate(()=>window.desktop.read());assert.deepEqual(saved.tasks,parallelBaseline.tasks);assert.deepEqual(saved.dayPlans[date].overlaps,[{taskIds:['write','meeting'],start:'16:00',end:'17:00',permission}]);
    assert.equal(await page.locator('.today-agenda .day-timeline-row.parallel').count(),2);assert.match(await page.locator('[data-task=write] .work-slots').innerText(),/16:00–17:00.*并行/);
    assert.match(await widget.locator('.widget-task:has([data-toggle=write])').innerText(),/16:00–17:00（并行）/);
    const fullCreated=app.waitForEvent('window');await widget.locator('#compact-full').click();widget=await fullCreated;widget.on('pageerror',e=>errors.push(e.message));await widget.waitForSelector('[data-toggle=write]');
    assert.match(await widget.locator('.widget-task:has([data-toggle=write])').innerText(),/16:00–17:00（并行）/);
    await page.reload();await page.waitForSelector('[data-task=write] .work-slots');await page.locator('[data-view=today]').click();assert.equal(await page.locator('.today-agenda .parallel-note').count(),2);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,'tasks.json'),'utf8')).dayPlans[date].overlaps,saved.dayPlans[date].overlaps);
    await page.locator('[data-action=dayplan]').click();assert.equal(await page.locator('#day-plan-description').inputValue(),permission);await page.locator('#day-plan-clear').click();await page.locator('#day-plan-dialog').waitFor({state:'hidden'});assert.equal((await page.evaluate(()=>window.desktop.read())).dayPlans,undefined);
    await page.locator('#undo-btn').click();await page.waitForSelector('.today-agenda .parallel-note');assert.ok((await page.evaluate(()=>window.desktop.read())).dayPlans[date].overlaps);
    await app.evaluate(({net})=>{net.fetch=globalThis.dayOriginalFetch;});await page.evaluate(()=>window.desktop.saveAIConfig({key:'',model:'deepseek-flash'}));
    assert.deepEqual(errors,[]);console.log('PASS: configurable routine; daily override precedence; split-task time preview; old preview preservation; apply/persistence; unchanged task IDs/effort/dates; full/compact slots; one checkbox; completed agenda; stale protection; infeasible feedback; clear/undo; automatic invalidation with exceptions retained');
  }catch(error){console.error('DAY SMOKE FAILURE:',error);if(page&&!page.isClosed())console.error((await page.locator('body').innerText()).slice(-2400));throw error;}
  finally{const timer=setTimeout(()=>app.process().kill(),5000);try{await app.close();}finally{clearTimeout(timer);}}
})().catch(error=>{console.error(error);process.exitCode=1;});
