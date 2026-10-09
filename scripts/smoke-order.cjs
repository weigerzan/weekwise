const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const runtimeRequire = process.env.PLAYWRIGHT_MODULE ? createRequire(path.join(process.env.PLAYWRIGHT_MODULE,'package.json')) : require;
const { _electron } = runtimeRequire('playwright');

(async () => {
  const root = path.resolve(__dirname,'..'), directory = path.join(root,'test-results',`order-${Date.now()}`);
  const { dateKey, addDays } = await import('../src/planner.js');
  const today = dateKey(), tomorrow = addDays(today,1);
  const base = { priority:'medium',minutes:60,due:null,scheduled:today,locked:true,done:false,notes:'' };
  const initial = { version:1,settings:{capacities:[240,240,240,240,240,240,240],preferences:''},tasks:[
    {...base,id:'a',title:'同日任务 A'},
    {...base,id:'other',title:'另一日任务',scheduled:tomorrow},
    {...base,id:'b',title:'定时面试 B',timeSlot:{start:'14:00',end:'15:00',reminders:[]}},
    {...base,id:'done1',title:'完成记录 1',done:true,actualMinutes:45},
    {...base,id:'c',title:'同日任务 C',origin:{batchId:'order',goalTitle:'审稿',unit:'篇',items:[1]}},
    {...base,id:'done2',title:'完成记录 2',done:true,actualMinutes:55}
  ]};
  await fs.mkdir(directory,{recursive:true}); await fs.writeFile(path.join(directory,'tasks.json'),JSON.stringify(initial));
  const executablePath = process.env.WEEKWISE_EXECUTABLE || path.join(root,'node_modules','electron','dist','electron.exe');
  const app = await _electron.launch({executablePath,args:process.env.WEEKWISE_EXECUTABLE?[]:[root],env:{...process.env,WEEKWISE_TEST:'1',WEEKWISE_DATA_DIR:directory},timeout:30000});
  let page; const errors=[];
  try {
    page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror',e=>errors.push(e.message));
    await page.waitForSelector('.week-board');
    const day = page.locator(`[data-day="${today}"]`);
    const pending = () => day.locator('[data-task]:not(.done)').evaluateAll(elements=>elements.map(el=>el.dataset.task));
    const waitOrder = expected => page.waitForFunction(({today,expected})=>JSON.stringify([...document.querySelectorAll(`[data-day="${today}"] [data-task]:not(.done)`)].map(el=>el.dataset.task))===JSON.stringify(expected),{today,expected});
    async function drag(id,target,after=false) {
      const card = page.locator(`[data-task="${target}"]`), bounds=await card.boundingBox();
      await page.locator(`[data-task="${id}"]`).dragTo(card,{targetPosition:{x:bounds.width/2,y:after?bounds.height-4:4}});
    }
    const originalLoad=await day.locator('.day-load').innerText();
    const created=app.waitForEvent('window'); await page.locator('[data-action=float]').click(); let widget=await created;
    widget.on('pageerror',e=>errors.push(e.message)); await widget.waitForSelector('.widget-task');
    const widgetOrder = () => widget.locator('[data-toggle]').evaluateAll(elements=>elements.map(el=>el.dataset.toggle));
    await drag('c','a'); await waitOrder(['c','a','b']);
    assert.deepEqual(await widgetOrder(),['c','a','b']);
    assert.equal(await day.locator('.day-load').innerText(),originalLoad);
    let state=await page.evaluate(()=>window.desktop.read());
    for(const task of initial.tasks) assert.deepEqual(state.tasks.find(t=>t.id===task.id),task);
    await drag('c','b',true); await waitOrder(['a','b','c']);
    await drag('b','a'); await waitOrder(['b','a','c']);
    await page.locator('#undo-btn').click(); await waitOrder(['a','b','c']);
    assert.deepEqual(await widgetOrder(),['a','b','c']);
    // Filtered-out cards remain saved, and ordinary pointer sorting still works.
    await page.locator('#search').fill('同日任务');
    await drag('c','a'); await waitOrder(['c','a']);
    await page.locator('#search').fill(''); await waitOrder(['c','a','b']);
    await page.reload(); await page.waitForSelector('.week-board'); assert.deepEqual(await pending(),['c','a','b']);
    const disk=JSON.parse(await fs.readFile(path.join(directory,'tasks.json'),'utf8'));
    assert.deepEqual(disk.tasks.filter(t=>t.scheduled===today&&!t.done).map(t=>t.id),['c','a','b']);
    // Completion records may be reordered at the bottom without changing the widget.
    await drag('done2','done1');
    await page.waitForFunction(today=>JSON.stringify([...document.querySelectorAll(`[data-day="${today}"] .done[data-task]`)].map(el=>el.dataset.task))==='["done2","done1"]',today);
    assert.deepEqual(await pending(),['c','a','b']); assert.deepEqual(await widgetOrder(),['c','a','b']);
    // Cross-date insertion continues to work, and undo restores the manual order.
    await drag('c','other');
    await page.waitForSelector(`[data-day="${tomorrow}"] [data-task=c]`);
    assert.deepEqual(await page.locator(`[data-day="${tomorrow}"] [data-task]`).evaluateAll(elements=>elements.map(el=>el.dataset.task)),['c','other']);
    await page.locator('#undo-btn').click(); await waitOrder(['c','a','b']);
    await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.showInactive();});
    await page.screenshot({path:path.join(root,'test-results','ordered-board.png'),fullPage:true});
    const compactCreated=app.waitForEvent('window'); await widget.locator('#widget-mode').click(); widget=await compactCreated;
    widget.on('pageerror',e=>errors.push(e.message)); await widget.waitForSelector('.widget-task');
    assert.deepEqual(await widgetOrder(),['c','a','b']);
    await widget.screenshot({path:path.join(root,'test-results','ordered-compact.png'),omitBackground:true});
    // Main recreation reads the same saved order.
    await page.close(); const restored=app.waitForEvent('window'); await widget.locator('#compact-open').click(); page=await restored;
    await page.waitForSelector('.week-board');
    assert.deepEqual(await page.locator(`[data-day="${today}"] [data-task]:not(.done)`).evaluateAll(elements=>elements.map(el=>el.dataset.task)),['c','a','b']);
    assert.deepEqual(errors,[]);
    console.log('PASS: pointer ordering before/after, timed-task metadata, unchanged daily load, undo, search preservation, reload/disk persistence, completed grouping, cross-day insertion, full/compact sync and main recreation');
  } catch(error) {console.error('ORDER SMOKE FAILURE:',error); if(page&&!page.isClosed())console.error((await page.locator('body').innerText()).slice(-1800)); throw error;}
  finally {const timer=setTimeout(()=>app.process().kill(),5000);try{await app.close();}finally{clearTimeout(timer);}}
})().catch(error=>{console.error(error);process.exitCode=1;});
