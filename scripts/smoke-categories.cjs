const {createRequire}=require('node:module'),path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const runtimeRequire=process.env.PLAYWRIGHT_MODULE?createRequire(path.join(process.env.PLAYWRIGHT_MODULE,'package.json')):require;
const {_electron}=runtimeRequire('playwright');
(async()=>{
  const root=path.resolve(__dirname,'..'),dir=path.join(root,'test-results',`categories-${Date.now()}`);
  const now=new Date(),date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const task={id:'old',title:'旧任务',minutes:30,priority:'medium',due:null,scheduled:date,done:false,locked:false,notes:''};
  await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'tasks.json'),JSON.stringify({version:1,tasks:[task],settings:{capacities:[480,480,480,480,480,480,480],preferences:''}}));
  const app=await _electron.launch({executablePath:process.env.WEEKWISE_EXECUTABLE||require('electron'),args:process.env.WEEKWISE_EXECUTABLE?[]:[root],env:{...process.env,WEEKWISE_TEST:'1',WEEKWISE_DATA_DIR:dir},timeout:30000});
  let page; const errors=[];
  try {
    page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('.week-board');
    assert.deepEqual(await page.locator('.category-legend-item').allTextContents(),['工作','运动','生活']);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.showInactive()));
    const settings=async()=>page.locator('[data-action=settings]').first().click();
    const save=async()=>{await page.locator('#settings-dialog [data-close=settings-dialog]').click();await page.locator('#settings-dialog').waitFor({state:'hidden'});};
    await settings();assert.deepEqual(await page.locator('.category-name').evaluateAll(els=>els.map(e=>e.value)),['工作','运动','生活']);
    await page.locator('.category-editor').first().locator('.category-name').fill('科研');
    await page.locator('.category-editor').first().locator('.category-description').fill('审稿、写论文与研究项目');
    await page.locator('.category-color').first().fill('#12abcd');
    const existingColors=await page.locator('.category-color').evaluateAll(els=>els.map(e=>e.value));
    await page.locator('#category-add').click();assert.ok(!existingColors.includes(await page.locator('.category-color').last().inputValue()));
    await page.locator('#routine-end').fill('21:30');
    await page.waitForFunction(async()=> (await window.desktop.read()).settings.dailyRoutine?.end==='21:30');
    assert.equal((await page.evaluate(()=>window.desktop.read())).settings.categories.length,3);
    assert.equal(await page.locator('#settings-dialog').isVisible(),true);
    await page.locator('.category-name').last().fill('社交');await page.locator('.category-description').last().fill('与朋友聚会和交流');
    await page.waitForFunction(async()=> (await window.desktop.read()).settings.categories?.length===4);
    await page.locator('[name=capacity-0]').fill('');await page.locator('#ai-preferences').fill('空闲时先处理科研任务');
    await page.waitForFunction(async()=> (await window.desktop.read()).settings.preferences==='空闲时先处理科研任务');
    assert.equal((await page.evaluate(()=>window.desktop.read())).settings.capacities[0],480);
    await page.locator('[name=capacity-0]').fill('420');
    await page.locator('#ai-key').fill('fake-categories-key');
    await page.waitForFunction(async()=> (await window.desktop.aiStatus()).configured);
    assert.equal(await page.locator('#settings-dialog').isVisible(),true);
    await page.locator('#category-fields').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(root,'test-results','category-settings.png')});await save();
    let state=await page.evaluate(()=>window.desktop.read());assert.equal(state.settings.categories.length,4);assert.deepEqual(await page.locator('.category-legend-item').allTextContents(),['科研','运动','生活','社交']);assert.equal(state.tasks[0].categoryId,undefined);
    await app.evaluate(({net})=>{
      globalThis.categoryOriginalFetch=net.fetch;globalThis.categoryInputs=[];
      net.fetch=async(url,options)=>{
        if(url!=='https://api.deepseek.com/chat/completions')return globalThis.categoryOriginalFetch.call(net,url,options);
        const body=JSON.parse(options.body),input=JSON.parse(body.messages[1].content);globalThis.categoryInputs.push(input);
        let value;
        if(input.startDate)value={summary:'安排审稿',assumptions:[],questions:[],goals:[{id:'G1',title:'审稿',quantity:null,unit:'',deadline:input.today}],tasks:[{goalId:'G1',title:'审稿',date:input.today,minutes:60,notes:'',items:[],categoryId:'work'}]};
        else if(input.referenceWeekStart)value={feasible:true,summary:'保留日期，补充类别',assumptions:[],issues:[],suggestions:[],assignments:input.tasks.map(t=>({id:t.id,date:t.scheduled,reason:'保留'})),capacityChanges:[],timedChanges:[],categoryAssignments:input.tasks.map(t=>({id:t.id,categoryId:'work'}))};
        else value={feasible:true,summary:'上午完成',assumptions:[],issues:[],suggestions:[],assignments:input.tasks.map((t,i)=>({id:t.id,slots:[{start:i===0?'10:30':'11:00',end:i===0?'11:00':'12:00'}]})),breaks:[],overlaps:[],categoryAssignments:input.tasks.map(t=>({id:t.id,categoryId:'work'}))};
        return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}));
      };
    });
    await page.locator('[data-action=natural]').click();await page.locator('#natural-description').fill('今天审一篇稿件');await page.locator('#natural-generate').click();
    await page.waitForFunction(()=>!document.getElementById('natural-apply').disabled);assert.equal(await page.locator('.natural-daily-task .category-marker[title="科研"]').count(),1);
    await page.locator('#natural-apply').click();await page.locator('#natural-dialog').waitFor({state:'hidden'});
    state=await page.evaluate(()=>window.desktop.read());const created=state.tasks.find(t=>t.origin);assert.equal(created.categoryId,'work');
    await page.locator(`[data-plan-day="${date}"]`).click();await page.locator('#day-plan-generate').click();await page.waitForFunction(()=>!document.getElementById('day-plan-apply').disabled);
    assert.equal(await page.locator('#day-plan-preview .category-marker').count(),2);assert.equal((await page.evaluate(()=>window.desktop.read())).tasks[0].categoryId,undefined);
    await page.locator('#day-plan-apply').click();await page.locator('#day-plan-dialog').waitFor({state:'hidden'});
    assert.equal((await page.evaluate(()=>window.desktop.read())).tasks[0].categoryId,'work');
    // Clear one manual category so a category-only replan can be previewed and applied.
    await page.locator('[data-task=old]').click();await page.locator('#task-category').selectOption('');await page.locator('#task-form button[type=submit]').click();await page.locator('#task-dialog').waitFor({state:'hidden'});
    await page.locator('[data-action=replan]').click();await page.locator('#replan-description').fill('日期保持不变');await page.locator('#replan-generate').click();await page.waitForFunction(()=>!document.getElementById('replan-apply').disabled);
    assert.equal(await page.locator('.replan-category-changes .category-marker').count(),1);await page.locator('#replan-apply').click();await page.locator('#replan-dialog').waitFor({state:'hidden'});
    let event=app.waitForEvent('window');await page.locator('[data-action=float]').click();let widget=await event;widget.on('pageerror',e=>errors.push(e.message));await widget.waitForSelector('.category-marker');assert.equal(await widget.locator('.category-marker').count(),2);
    event=app.waitForEvent('window');await widget.locator('#widget-mode').click();widget=await event;await widget.waitForSelector('.compact-page .category-marker');
    await settings();await page.locator('.category-color').first().fill('#ef4455');await save();
    await widget.waitForFunction(()=>document.querySelector('.category-marker')?.style.background==='rgb(239, 68, 85)');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.showInactive()));await widget.screenshot({path:path.join(root,'test-results','category-compact.png'),omitBackground:true});
    await page.locator('#view-switch').click();assert.equal(await page.locator('#category-legend').isVisible(),true);assert.ok(await page.locator('.month-task .category-marker').count()>0);await page.locator('#view-switch').click();
    await page.reload();await page.waitForSelector('.week-board');assert.equal(await page.locator('.task-card .category-marker').count(),0);assert.equal(await page.locator('.category-border-card').first().evaluate(el=>getComputedStyle(el).borderLeftColor),'rgb(239, 68, 85)');
    await page.screenshot({path:path.join(root,'test-results','category-board.png')});
    await page.locator('[data-view=today]').click();assert.equal(await page.locator('.task-card .category-marker').count(),0);assert.equal(await page.locator('.category-border-card').first().evaluate(el=>getComputedStyle(el).borderLeftColor),'rgb(239, 68, 85)');
    await page.screenshot({path:path.join(root,'test-results','category-today.png')});await page.locator('[data-section=plan]').click();
    // A failed autosave is visible and retry uses the latest task state from another window.
    await settings();
    await app.evaluate(({ipcMain})=>{const handler=ipcMain._invokeHandlers.get('tasks:save');ipcMain.removeHandler('tasks:save');let failed=false;ipcMain.handle('tasks:save',async(...args)=>{if(!failed){failed=true;throw Error('模拟保存失败');}return handler(...args);});});
    await page.locator('#routine-preferences').fill('按最新修改安排');await page.locator('#settings-retry').waitFor({state:'visible'});
    assert.notEqual((await page.evaluate(()=>window.desktop.read())).settings.dayPreferences,'按最新修改安排');
    await page.evaluate(()=>window.desktop.completeTask('old',22));await page.locator('#settings-retry').click();
    await page.waitForFunction(async()=> (await window.desktop.read()).settings.dayPreferences==='按最新修改安排');
    assert.equal((await page.evaluate(()=>window.desktop.read())).tasks.find(t=>t.id==='old').actualMinutes,22);
    await page.locator('#routine-preferences').fill('关闭时也要保留最新输入');await page.keyboard.press('Escape');await page.locator('#settings-dialog').waitFor({state:'hidden'});
    assert.equal((await page.evaluate(()=>window.desktop.read())).settings.dayPreferences,'关闭时也要保留最新输入');
    await settings();await page.locator('.category-remove').first().click();await save();
    await widget.waitForFunction(()=>!document.querySelector('.category-marker'));state=await page.evaluate(()=>window.desktop.read());assert.equal(state.tasks.length,2);assert.deepEqual(await page.locator('.category-legend-item').allTextContents(),['运动','生活','社交']);assert.ok(state.tasks.every(t=>!t.categoryId));
    const inputs=await app.evaluate(()=>globalThis.categoryInputs);assert.equal(inputs.length,3);assert.ok(inputs.every(i=>i.categories[0].description==='审稿、写论文与研究项目'));
    assert.deepEqual(errors,[]);console.log('PASS: automatic distinct draft colors, live partial settings autosave, encrypted key autosave, failure/retry without losing concurrent completion, Escape flush, default/custom categories, natural/day/replan classification preview and apply, manual clearing, month/card/full/compact markers, live color sync, reload, safe category deletion');
  }catch(error){if(page&&!page.isClosed())console.error((await page.locator('body').innerText()).slice(-1400));throw error;}
  finally{const timer=setTimeout(()=>app.process().kill(),5000);try{await app.close();}finally{clearTimeout(timer);}}
})().catch(error=>{console.error(error);process.exitCode=1;});
