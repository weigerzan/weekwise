import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, validateState } from '../src/planner.js';
import { getCategories, validateCategories, categoryAssignments, applyCategories, nextCategoryColor } from '../src/categories.js';
import { categoryMarker } from '../src/category-ui.js';
import { naturalInput, validateNaturalPlan, requestNaturalPlan } from '../desktop/natural.js';
import { replanInput, validateReplan } from '../desktop/replan.js';
import { dayInput, validateDayPlan } from '../desktop/day-plan.js';
const date = '2026-10-09';
const category = {id:'research',name:'科研',description:'与论文和研究相关的工作，包括审阅文稿。',color:'#12abcd'};
const task = {id:'paper',title:'审稿',minutes:60,priority:'medium',due:null,scheduled:date,done:false,locked:false,notes:''};
function fixture() { return {...emptyState(),tasks:[{...task}],settings:{...emptyState().settings,categories:[{...category}]}}; }
function naturalResponse(categoryId='research') { return {summary:'今天审稿',assumptions:[],questions:[],goals:[{id:'G1',title:'审稿',quantity:null,unit:'',deadline:date}],tasks:[{goalId:'G1',title:'审稿',date,minutes:60,items:[],notes:'',categoryId}]}; }
test('new category colors avoid existing and draft colors, including after the preset palette is exhausted', () => {
  const used = getCategories(emptyState()).map(c => c.color.toUpperCase());
  for (let i=0;i<30;i++) {
    const color = nextCategoryColor(used);
    assert.match(color,/^#[0-9a-f]{6}$/);
    assert.ok(!used.some(c=>c.toLowerCase()===color)); used.push(color);
  }
});
test('old backups retain their shape and default categories; explicit empty list disables categories', () => {
  const old = emptyState(); assert.deepEqual(validateState(old),old);
  assert.deepEqual(getCategories(old).map(c => c.name),['工作','运动','生活']);
  old.settings.categories=[]; assert.deepEqual(getCategories(validateState(old)),[]);
  for(const bad of [{...category,color:'red'},{...category,description:''},{...category,name:''}]) assert.throws(()=>validateCategories([bad]));
  assert.throws(()=>validateCategories([category,{...category,id:'second'}]));
});
test('custom category IDs and colors round-trip; deletion removes only category markers and preserves all task data', () => {
  const state=fixture(); state.tasks[0].categoryId='research';
  const saved=validateState(state); assert.deepEqual(saved,state);
  assert.match(categoryMarker(saved,saved.tasks[0]),/#12abcd/);
  saved.settings.categories=[];
  assert.deepEqual(validateState(saved).tasks,[task]);
  const hostile=fixture(); hostile.settings.categories[0].name='<img>'; hostile.tasks[0].categoryId='research';
  assert.ok(!categoryMarker(hostile,hostile.tasks[0]).includes('title="<img>'));
});
test('new tasks accept only model-selected predefined IDs; null is unclassified and malformed IDs are rejected', () => {
  const input=naturalInput(fixture(),'审稿',date,date);
  assert.deepEqual(input.categories,[category]);
  assert.equal(validateNaturalPlan(naturalResponse(),input).tasks[0].categoryId,'research');
  assert.ok(!Object.hasOwn(validateNaturalPlan(naturalResponse(null),input).tasks[0],'categoryId'));
  assert.throws(()=>validateNaturalPlan(naturalResponse('invented'),input),/未知类别/);
  input.categories=[]; assert.throws(()=>validateNaturalPlan(naturalResponse(),input));
});
test('DeepSeek receives descriptions; invalid classification is repaired with the same user definitions', async () => {
  let calls=0;
  const result=await requestNaturalPlan({state:fixture(),description:'审稿',startDate:date,today:date,key:'fake',model:'test',fetcher:async (_url,options)=>{
    const body=JSON.parse(options.body),input=JSON.parse(body.messages[1].content);
    assert.deepEqual(input.categories,[category]); assert.match(body.messages[0].content,/description/);
    return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(naturalResponse(++calls===1?'bad':'research'))}}]}));
  }});
  assert.equal(calls,2);assert.equal(result.tasks[0].categoryId,'research');
});
test('classification validates task references, preserves manual categories and completed tasks, and does not mutate input', () => {
  const state=fixture(); state.tasks.push({...task,id:'manual',categoryId:'research'},{...task,id:'done',done:true});
  const ids=new Map([['T1','paper'],['T2','manual'],['F1','done']]);
  const rows=categoryAssignments([{id:'T1',categoryId:'research'},{id:'T2',categoryId:null},{id:'F1',categoryId:'research'}],state,ids);
  assert.deepEqual(rows,[{taskId:'paper',categoryId:'research'}]);
  applyCategories(structuredClone(state),rows); assert.equal(state.tasks[0].categoryId,undefined);
  for(const bad of [[{id:'unknown',categoryId:'research'}],[{id:'T1',categoryId:'bad'}],[{id:'T1',categoryId:null},{id:'T1',categoryId:null}]])assert.throws(()=>categoryAssignments(bad,state,ids));
});
test('day and replan classify only on accepted results, keep schedule metadata and reject partial infeasible edits', () => {
  const state=fixture(), baseline=structuredClone(state);
  const transport=dayInput(state,'按作息安排',date,date,'10:00');
  assert.deepEqual(transport.input.categories,[category]);
  const response={feasible:true,summary:'上午完成',assumptions:[],issues:[],suggestions:[],assignments:[{id:'T1',slots:[{start:'11:00',end:'12:00'}]}],breaks:[],categoryAssignments:[{id:'T1',categoryId:'research'}]};
  const day=validateDayPlan(response,transport);assert.equal(day.categoryAssignments[0].categoryId,'research');
  assert.throws(()=>validateDayPlan({...response,feasible:false,assignments:[]},transport),/类别修改/);
  const rt=replanInput(state,'保持日期',date,date,date);
  assert.deepEqual(rt.input.categories,[category]);
  const rr={...response,assignments:[{id:'T1',date,reason:'保留'}],capacityChanges:[],timedChanges:[]};
  const result=validateReplan(rr,rt);
  assert.deepEqual(result.tasks,[{...task,categoryId:'research'}]);assert.deepEqual(state,baseline);
  assert.throws(()=>validateReplan({...rr,feasible:false,assignments:[]},rt),/类别修改/);
});
