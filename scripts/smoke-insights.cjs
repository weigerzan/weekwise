const {createRequire}=require('node:module');
const path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const runtimeRequire=process.env.PLAYWRIGHT_MODULE?createRequire(path.join(process.env.PLAYWRIGHT_MODULE,'package.json')):require;
const {_electron}=runtimeRequire('playwright');
(async()=>{
  const root=path.resolve(__dirname,'..'),directory=path.join(root,'test-results',`insights-${Date.now()}`);
  const {dateKey,addDays}=await import('../src/planner.js'); const today=dateKey(),tomorrow=addDays(today,1),yesterday=addDays(today,-1),year=Number(today.slice(0,4));
  const base={priority:'medium',minutes:120,due:null,scheduled:today,locked:false,done:false,notes:''};
  const tasks=[
    {...base,id:'future',title:'提前完成明天的审稿',scheduled:tomorrow},
    {...base,id:'widget',title:'从浮窗完成'},
    {...base,id:'recorded',title:'今天完成的实验',done:true,actualMinutes:80,completedOn:today},
    {...base,id:'legacy',title:'旧记录 <img onerror=x>',done:true,actualMinutes:45},
    {...base,id:'missing',title:'未填写耗时的任务',done:true},
    {...base,id:'old-year',title:'去年完成的任务',scheduled:`${year-1}-12-30`,done:true,actualMinutes:100},
  ];
  // Isolated sample history to exercise real chart layout and varying totals.
  for(let i=2;i<100;i++)if(i%5!==0)tasks.push({...base,id:`history-${i}`,title:`历史审稿 ${i}`,scheduled:addDays(today,-i),completedOn:addDays(today,-i),done:true,actualMinutes:30+(i*37)%270});
  const initial={version:1,settings:{capacities:[240,240,240,240,240,240,240],preferences:''},tasks};
  await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'tasks.json'),JSON.stringify(initial));
  const app=await _electron.launch({executablePath:process.env.WEEKWISE_EXECUTABLE||path.join(root,'node_modules','electron','dist','electron.exe'),args:process.env.WEEKWISE_EXECUTABLE?[]:[root],env:{...process.env,WEEKWISE_TEST:'1',WEEKWISE_DATA_DIR:directory},timeout:30000});
  let page;const errors=[];
  try{
    page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('.week-board');
    assert.equal(await page.locator('.month-calendar,.activity-chart,.heat-grid').count(),0);
    assert.deepEqual(await page.locator('.sidebar nav [data-section]').evaluateAll(nodes=>nodes.map(n=>n.dataset.section)),['plan','today','statistics']);
    assert.equal(await page.locator('#plan-tabs').isVisible(),true);assert.equal(await page.locator('#statistics-tabs').isVisible(),false);
    await page.locator('#view-switch').click();await page.waitForSelector('.month-grid');
    assert.equal(await page.locator('#view-label').innerText(),'月视图');assert.equal(await page.locator('[data-view=month]').getAttribute('aria-pressed'),'true');
    await page.locator('#view-switch').press('Enter');await page.waitForSelector('.week-board');
    assert.equal(await page.locator('#view-label').innerText(),'周视图');assert.equal(await page.locator('[data-view=week]').getAttribute('aria-pressed'),'true');
    await page.locator('[data-view=month]').click();await page.waitForSelector('.month-grid');assert.equal(await page.locator('#view-label').innerText(),'月视图');
    assert.equal(await page.locator('.month-weekdays span').count(),7);
    assert((await page.locator('#week-label').innerText()).includes(`${year}年`));
    await page.locator(`[data-month-day="${tomorrow}"]`).click();await page.waitForSelector('.month-detail [data-task=future]');
    await page.locator('[data-toggle=future]').click();await page.locator('#completion-minutes').fill('35');await page.locator('#completion-save').click();
    await page.waitForSelector('.month-detail [data-task=future].done');
    let saved=await page.evaluate(()=>window.desktop.read());assert.equal(saved.tasks.find(t=>t.id==='future').completedOn,today);assert.equal(saved.tasks.find(t=>t.id==='future').scheduled,tomorrow);
    await page.evaluate(()=>{window.syncEcho = new Promise(resolve=>{const off=window.desktop.onState(()=>{off();resolve();});});});
    await app.evaluate(({BrowserWindow},saved)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')).webContents.send('tasks:changed',saved),saved);
    await page.evaluate(()=>window.syncEcho);assert.equal(await page.locator('#undo-btn').isVisible(),true);
    await page.locator('#undo-btn').click();await page.waitForSelector('.month-detail [data-task=future]:not(.done)');
    await page.locator('[data-action=prev-week]').click();assert(!((await page.locator('#week-label').innerText()).includes(`${Number(today.slice(5,7))}月`)));
    await page.locator('[data-action=this-week]').click();await page.locator(`[data-month-day="${tomorrow}"]`).click();
    await page.locator('[data-task=future]').dragTo(page.locator(`[data-month-day="${today}"]`));
    await page.waitForFunction(async today=>(await window.desktop.read()).tasks.find(t=>t.id==='future').scheduled===today,today);
    await page.locator('#undo-btn').click();
    await page.locator('[data-section=statistics]').click();await page.waitForSelector('.heat-grid');
    assert.equal(await page.locator('[data-section=statistics]').getAttribute('aria-current'),'page');
    assert.equal(await page.locator('#plan-tabs').isVisible(),false);assert.equal(await page.locator('#statistics-tabs').isVisible(),true);
    await page.locator('[data-view=all]').click();assert.equal(await page.locator('.task-list [data-task]').count(),2);assert.equal(await page.locator('.task-list .done').count(),0);
    assert.equal(await page.locator('#view-switch').isDisabled(),true);
    await page.locator('#search').fill('从浮窗完成');assert.equal(await page.locator('.task-list [data-task]').count(),1);await page.locator('#search').fill('');
    await page.locator('[data-view=done]').click();assert.equal(await page.locator('.task-list [data-task]:not(.done)').count(),0);
    assert.equal(await page.locator('#done-count').innerText(),String(initial.tasks.filter(t=>t.done).length));
    await page.locator('[data-section=today]').click();assert.equal(await page.locator('#statistics-tabs').isVisible(),false);
    await page.locator('[data-section=statistics]').click();assert.equal(await page.locator('[data-view=done]').getAttribute('aria-pressed'),'true');
    await page.locator('[data-view=activity]').click();await page.waitForSelector('.heat-grid');
    assert.equal(await page.locator('.workspace-toolbar').isVisible(),false);assert.equal(await page.locator('#stats').isVisible(),false);
    const heat=d=>page.locator(`.heat-grid [data-activity-day="${d}"]`);
    assert.equal(await heat(today).getAttribute('data-minutes'),'245');
    assert.equal(await heat(tomorrow).isDisabled(),true);
    assert((await page.locator('.activity-note').innerText()).includes('1 项完成任务未填写') && (await page.locator('.activity-note').innerText()).includes('已按计划耗时计入'));
    assert((await page.locator('.activity-note').innerText()).includes('旧记录'));
    assert.equal(await page.locator('.heat-months span').count(),12);
    assert.equal(await page.locator('.chart-hit').count(),30);
    assert.equal(await page.locator('.activity-chart text').first().evaluate(el=>getComputedStyle(el).stroke),'none');
    assert.equal(await page.locator('.chart-hit').first().evaluate(el=>getComputedStyle(el).stroke),'none');
    for(const n of [7,90,30]){await page.locator(`[data-activity-range="${n}"]`).click();assert.equal(await page.locator('.chart-hit').count(),n);}
    await page.locator(`.chart-hit[data-activity-day="${today}"]`).focus();await page.keyboard.press('Enter');
    assert((await page.locator('.activity-detail').innerText()).includes(today));
    assert.equal(await page.locator('.activity-record img').count(),0);
    assert((await page.locator('.activity-record[data-task=missing]').innerText()).includes('2 小时'));assert((await page.locator('.activity-record[data-task=missing]').innerText()).includes('按计划耗时计入'));
    assert.equal(await page.locator(`.chart-hit[data-activity-day="${today}"]`).getAttribute('data-minutes'),'245');
    await page.locator('.activity-record[data-task=missing]').click();assert.equal(await page.locator('#task-actual').inputValue(),'');
    await page.locator('#task-actual').fill('30');await page.locator('#task-form button[type=submit]').click();await page.locator('#task-dialog').waitFor({state:'hidden'});
    assert.equal(await heat(today).getAttribute('data-minutes'),'155');assert.equal(await page.locator(`.chart-hit[data-activity-day="${today}"]`).getAttribute('data-minutes'),'155');
    await page.locator('.activity-record[data-task=missing]').click();await page.locator('#task-actual').fill('');await page.locator('#task-form button[type=submit]').click();await page.locator('#task-dialog').waitFor({state:'hidden'});
    assert.equal(await heat(today).getAttribute('data-minutes'),'245');assert((await page.locator('.activity-record[data-task=missing]').innerText()).includes('按计划耗时计入'));
    await page.locator('.activity-record[data-task=legacy]').click();assert.equal(await page.locator('#task-completed-on').inputValue(),today);
    await page.locator('#task-completed-on').fill(yesterday);await page.locator('#task-actual').fill('50');await page.locator('#task-form button[type=submit]').click();await page.locator('#task-dialog').waitFor({state:'hidden'});
    assert.equal(await heat(today).getAttribute('data-minutes'),'200');assert.equal(await heat(yesterday).getAttribute('data-minutes'),'50');
    await page.locator('#undo-btn').click();await page.waitForFunction(today=>document.querySelector(`.heat-grid [data-activity-day="${today}"]`).dataset.minutes==='245',today);
    await page.locator('#activity-year').selectOption(String(year-1));assert.equal(await heat(`${year-1}-12-30`).getAttribute('data-minutes'),'100');
    await page.locator('#activity-year').selectOption(String(year));
    // Native widget completion updates the charts while the statistics view stays open.
    const created=app.waitForEvent('window');await page.locator('[data-action=float]').click();const widget=await created;widget.on('pageerror',e=>errors.push(e.message));await widget.waitForSelector('[data-toggle=widget]');
    await widget.locator('[data-toggle=widget]').click();await widget.locator('#completion-minutes').fill('20');await widget.locator('#completion-save').click();
    await page.waitForFunction(today=>document.querySelector(`.heat-grid [data-activity-day="${today}"]`).dataset.minutes==='265',today);
    saved=await page.evaluate(()=>window.desktop.read());assert.equal(saved.tasks.find(t=>t.id==='widget').completedOn,today);
    const disk=JSON.parse(await fs.readFile(path.join(directory,'tasks.json'),'utf8'));assert.equal(disk.tasks.find(t=>t.id==='widget').completedOn,today);
    await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.showInactive();});
    await page.screenshot({path:path.join(root,'test-results','activity.png'),fullPage:true});
    await page.locator('[data-section=plan]').click();await page.waitForSelector('.month-calendar');
    assert.equal(await page.locator('[data-view=month]').getAttribute('aria-pressed'),'true');
    await page.locator(`[data-month-day="${today}"]`).click();await page.screenshot({path:path.join(root,'test-results','month.png'),fullPage:true});
    await page.locator('[data-view=week]').click();await page.waitForSelector('.week-board');
    await page.reload();await page.waitForSelector('.week-board');assert.equal(await page.locator('.heat-grid,.month-calendar').count(),0);
    assert.deepEqual(errors,[]);console.log('PASS: default weekly view, monthly navigation/details/completion/drag/undo, actual completion date, annual heatmap, trend ranges/keyboard/details, edit/undo, legacy data, native widget live sync, persistence and screenshots');
  }catch(e){console.error('INSIGHTS SMOKE FAILURE:',e);if(page&&!page.isClosed())console.error((await page.locator('body').innerText()).slice(-1400));throw e;}
  finally{const timer=setTimeout(()=>app.process().kill(),5000);try{await app.close();}finally{clearTimeout(timer);}}
})().catch(e=>{console.error(e);process.exitCode=1;});
