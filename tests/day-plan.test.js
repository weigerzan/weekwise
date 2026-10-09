import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, validateState } from '../src/planner.js';
import { DEFAULT_DAILY_ROUTINE, dayTimeline, dayTaskSlots } from '../src/day-plan.js';
import { moveTask } from '../src/task-order.js';
import { dayInput, validateDayPlan, requestDayPlan } from '../desktop/day-plan.js';

const date='2026-10-10',today='2026-10-09';
const description='这一天8点开始，下午3-5有事不能安排任务，晚上8点后不工作。';
function fixture() {
  const state=emptyState(); state.settings.dailyRoutine=structuredClone(DEFAULT_DAILY_ROUTINE); state.settings.dayPreferences='长任务允许分段';
  const base={priority:'medium',minutes:60,due:null,scheduled:date,locked:true,done:false,notes:''};
  state.tasks=[{...base,id:'review',title:'审稿',minutes:120},{...base,id:'write',title:'修改稿件'},{...base,id:'meeting',title:'组会',timeSlot:{start:'16:00',end:'17:00',reminders:[120,30]}},{...base,id:'done',title:'已完成任务',done:true,actualMinutes:55},{...base,id:'other',title:'其它日期任务',scheduled:'2026-10-11'}];
  return state;
}
function response() {return {feasible:true,summary:'分两段审稿，午后修改稿件，保留组会与吃饭时间',assumptions:[],issues:[],suggestions:[],assignments:[{id:'T1',slots:[{start:'11:00',end:'12:00'},{start:'13:30',end:'14:30'}]},{id:'T2',slots:[{start:'14:30',end:'15:30'}]}],breaks:structuredClone(DEFAULT_DAILY_ROUTINE.breaks)};}
const transport=(state=fixture(),text='按基础作息安排')=>dayInput(state,text,date,today,'16:20');
const completion=value=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}));

test('day input sends base routine plus exact daily exceptions without completed or other-date tasks',()=>{
  const {input,ids}=transport(fixture(),description);
  assert.equal(input.description,description); assert.equal(input.currentTime,'16:20');
  assert.deepEqual(input.baseRoutine,DEFAULT_DAILY_ROUTINE);assert.equal(input.routinePreferences,'长任务允许分段');
  assert.deepEqual([...ids.values()],['review','write']); assert.equal(input.fixedTasks[0].start,'16:00');
  assert.ok(!JSON.stringify(input).includes('actualMinutes'));assert.ok(!input.tasks.some(t=>t.title==='已完成任务'||t.title==='其它日期任务'));
});
test('split work slots persist without creating tasks, changing estimates, dates, reminders or manual order',()=>{
  const state=fixture(),original=structuredClone(state),result=validateDayPlan(response(),transport(state));
  const saved=validateState({...state,dayPlans:{[date]:result.plan}});
  assert.deepEqual(saved.tasks,original.tasks);assert.deepEqual(saved.settings,original.settings);assert.deepEqual(state,original);
  assert.equal(dayTaskSlots(saved,saved.tasks[0]).length,2);
  assert.deepEqual(dayTimeline(saved,date).map(row=>[row.kind,row.start]),[['work','11:00'],['break','12:00'],['work','13:30'],['work','14:30'],['fixed','16:00'],['break','18:00']]);
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(saved))),saved);
});
test('completion, actual-duration edits and manual sorting preserve the agenda; task duration/date/time edits invalidate it',()=>{
  const state=fixture();state.dayPlans={[date]:validateDayPlan(response(),transport(state)).plan};
  state.tasks[0].done=true;state.tasks[0].actualMinutes=140;
  let saved=validateState(state);assert.ok(saved.dayPlans[date]);assert.ok(dayTimeline(saved,date).find(row=>row.taskId==='review').done);
  saved.tasks=moveTask(saved.tasks,'write',date,'review');assert.ok(validateState(saved).dayPlans[date]);
  for(const edit of [s=>s.tasks[0].minutes=130,s=>s.tasks[0].scheduled='2026-10-11',s=>s.tasks[2].timeSlot={...s.tasks[2].timeSlot,start:'17:00',end:'18:00'}]) {
    const next=structuredClone(state);edit(next);assert.equal(validateState(next).dayPlans,undefined);
  }
});
test('unknown, duplicate, missing, fixed task IDs, wrong effort totals and time conflicts are rejected',()=>{
  for(const edit of [v=>v.assignments[0].id='F1',v=>v.assignments[0].id='T99',v=>v.assignments[1].id='T1',v=>v.assignments.pop(),v=>v.assignments[0].slots[0].end='11:30',v=>v.assignments[0].slots[0].start='25:00',v=>v.assignments[1].slots=[{start:'16:00',end:'17:00'}],v=>v.breaks.push({title:'冲突午饭',start:'11:00',end:'11:30'})]) {
    const value=response();edit(value);assert.throws(()=>validateDayPlan(value,transport()),/编号|遗漏|耗时|时段/);
  }
});
test('infeasible day feedback makes no partial agenda and leaves previous plans untouched',()=>{
  const value={feasible:false,summary:'无法在晚8点前排下',assumptions:[],issues:['下午空档占用两小时'],suggestions:['把修改稿件移到后一天，或放宽结束时间'],assignments:[],breaks:[]};
  const result=validateDayPlan(value,transport());assert.equal(result.plan,null);assert.equal(result.suggestions.length,1);
  assert.throws(()=>validateDayPlan({...value,assignments:response().assignments},transport()),/部分安排/);
});
test('DeepSeek receives daily overrides with precedence over base routine; no local natural-language parsing',async()=>{
  const state=fixture();state.tasks=state.tasks.filter(t=>t.id!=='meeting');let calls=0;
  const result=await requestDayPlan({state,description,date,today,currentTime:'16:20',key:'fake',model:'deepseek-flash',fetcher:async(_url,options)=>{
    calls++;const body=JSON.parse(options.body),input=JSON.parse(body.messages[1].content);
    assert.equal(input.description,description);assert.equal(input.baseRoutine.start,'10:30');
    assert.match(body.messages[0].content,/覆盖对应基础要求/);assert.match(body.messages[0].content,/所有自然语言理解/);
    const value=response();value.assignments[0].slots=[{start:'08:00',end:'10:00'}];value.assignments[1].slots=[{start:'10:00',end:'11:00'}];value.breaks.push({title:'有其它事情',start:'15:00',end:'17:00'});return completion(value);
  }});
  assert.equal(calls,1);assert.equal(result.plan.assignments[0].slots[0].start,'08:00');assert.equal(state.settings.dailyRoutine.start,'10:30');
});
test('one repair corrects malformed day plan identity and basic routine rejects impossible time formats',async()=>{
  let calls=0;
  const result=await requestDayPlan({state:fixture(),description:'按基础作息安排',date,today,key:'fake',model:'deepseek-flash',fetcher:async(_url,options)=>{
    calls++;const value=response();if(calls===1)value.assignments[0].id='T99';else assert.match(JSON.parse(options.body).messages[2].content,/恰好覆盖/);return completion(value);
  }});
  assert.equal(calls,2);assert.ok(result.plan);
  const invalid=fixture();invalid.settings.dailyRoutine.end='09:00';assert.throws(()=>validateState(invalid),/基础作息/);
  assert.throws(()=>dayInput(emptyState(),'按基础作息安排',date,today),/没有待安排/);
});

test('explicit last-hour meeting permission allows grading while preserving task effort, fixed schedule, reminders and backup',()=>{
  const state=fixture();state.tasks.find(t=>t.id==='write').title='批改考试题';
  state.tasks.find(t=>t.id==='meeting').timeSlot.start='15:00';state.tasks.find(t=>t.id==='meeting').minutes=120;
  const permission='组会的后一个小时可以用来批改考试题',original=structuredClone(state),value=response();
  value.assignments[1].slots=[{start:'16:00',end:'17:00'}];value.overlaps=[{ids:['T2','F1'],start:'16:00',end:'17:00',permission}];
  const result=validateDayPlan(value,transport(state,permission));
  const saved=validateState({...state,dayPlans:{[date]:result.plan}});
  assert.deepEqual(saved.tasks,original.tasks);assert.deepEqual(state,original);
  assert.deepEqual(result.plan.overlaps,[{taskIds:['write','meeting'],start:'16:00',end:'17:00',permission}]);
  assert.equal(dayTaskSlots(saved,saved.tasks.find(t=>t.id==='write'))[0].parallel[0].title,'组会');
  const fixed=dayTimeline(saved,date).find(row=>row.taskId==='meeting');assert.equal(fixed.start,'15:00');assert.equal(fixed.end,'17:00');assert.equal(fixed.parallel[0].start,'16:00');
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(saved))),saved);
  saved.tasks.find(t=>t.id==='write').done=true;assert.ok(validateState(saved).dayPlans[date].overlaps);
  saved.tasks.find(t=>t.id==='meeting').timeSlot.end='18:00';assert.equal(validateState(saved).dayPlans,undefined);
});

test('ordinary tasks can share a slot only with the corresponding user permission',()=>{
  const state=fixture();state.tasks=state.tasks.filter(t=>!t.timeSlot);const permission='审稿和修改稿件可以同时进行',value=response();
  value.assignments[1].slots=[{start:'13:30',end:'14:30'}];value.overlaps=[{ids:['T1','T2'],start:'13:30',end:'14:30',permission}];
  assert.equal(validateDayPlan(value,transport(state,permission)).plan.overlaps.length,1);
  delete value.overlaps;assert.throws(()=>validateDayPlan(value,transport(state,permission)),/并行许可/);
});

test('parallel permission cannot invent approval, use unknown IDs, grant another hour, hide meal conflicts or repeat itself',()=>{
  const state=fixture(),permission='组会期间可以修改稿件',value=response();value.assignments[1].slots=[{start:'16:00',end:'17:00'}];
  value.overlaps=[{ids:['T2','F1'],start:'16:00',end:'17:00',permission}];
  for(const edit of [v=>v.overlaps[0].permission='用户允许所有任务并行',v=>v.overlaps[0].ids[1]='F99',v=>v.overlaps[0].ids[1]='T2',v=>v.overlaps[0].start='16:30',v=>v.overlaps[0].end='18:00',v=>v.overlaps.push({...v.overlaps[0]}),v=>v.breaks.push({title:'不能工作的空档',start:'16:15',end:'16:30'})]) {
    const next=structuredClone(value);edit(next);assert.throws(()=>validateDayPlan(next,transport(state,permission)),/并行|重叠/);
  }
  assert.throws(()=>validateDayPlan(value,transport(state,'按基础作息安排')),/原文许可/);
  const self=response();self.assignments[0].slots=[{start:'10:30',end:'11:30'},{start:'11:00',end:'12:00'}];assert.throws(()=>validateDayPlan(self,transport(state,permission)),/重叠/);
});

test('authorizing one slot inside a longer meeting does not implicitly authorize later slots or skip nested conflicts',()=>{
  const state=fixture();state.tasks.find(t=>t.id==='review').minutes=60;state.tasks.find(t=>t.id==='meeting').timeSlot={start:'15:00',end:'18:00',reminders:[30]};state.tasks.find(t=>t.id==='meeting').minutes=180;
  const permission='组会第一小时可以审稿',value=response();value.assignments[0].slots=[{start:'15:00',end:'16:00'}];value.assignments[1].slots=[{start:'16:00',end:'17:00'}];value.overlaps=[{ids:['T1','F1'],start:'15:00',end:'16:00',permission}];
  assert.throws(()=>validateDayPlan(value,transport(state,permission)),/重叠/);
});

test('DeepSeek interprets explicit concurrency and repair preserves its permission rather than forbidding all overlaps',async()=>{
  const permission='组会期间可以修改稿件';let calls=0;
  const result=await requestDayPlan({state:fixture(),description:permission,date,today,key:'fake',model:'deepseek-flash',fetcher:async(_url,options)=>{
    calls++;const body=JSON.parse(options.body),input=JSON.parse(body.messages[1].content);assert.equal(input.description,permission);assert.equal(input.fixedTasks[0].id,'F1');
    assert.match(body.messages[0].content,/组会的后一个小时/);assert.match(body.messages[0].content,/逐字引用/);
    const value=response();value.assignments[1].slots=[{start:'16:00',end:'17:00'}];value.overlaps=[{ids:[calls===1?'T99':'T2','F1'],start:'16:00',end:'17:00',permission}];
    if(calls===2)assert.match(body.messages[2].content,/不能取消用户已明确允许的并行/);
    return completion(value);
  }});
  assert.equal(calls,2);assert.ok(result.plan.overlaps);
  assert.throws(()=>validateDayPlan({feasible:false,summary:'排不下',assumptions:[],issues:[],suggestions:[],assignments:[],breaks:[],overlaps:[{}]},transport()),/部分安排/);
});
