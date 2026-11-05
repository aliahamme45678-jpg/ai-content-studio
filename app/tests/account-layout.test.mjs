import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/account-analysis.js',import.meta.url),'utf8');
test('all numeric columns sort stably and keep unknown values last in both directions',()=>{
 const ctx=vm.createContext({});vm.runInContext(source,ctx);
 for(const key of ['diggCount','collectCount','commentCount','shareCount','saveLikeRatio','medianMultiple'])for(const direction of ['asc','desc']){
  ctx.key=key;ctx.direction=direction;const result=vm.runInContext(`accountView.sortKey=key;accountView.sortDirection=direction;accountView.reportsById=new Map();accountSortedVideos([{id:'unknown',[key]:null},{id:'ten',[key]:10},{id:'zero',[key]:0},{id:'ten2',[key]:10}]).map(v=>v.id).join(',')`,ctx);
  assert.equal(result,direction==='asc'?'zero,ten,ten2,unknown':'ten,ten2,zero,unknown');
 }
 const tags=vm.runInContext(`accountView.sortKey='tags';accountView.sortDirection='asc';accountView.reportsById=new Map([['a',{tags:['优质文案']}]]);accountSortedVideos([{id:'none',ruleTags:[]},{id:'a',ruleTags:[]},{id:'b',ruleTags:['广告作品']}]).map(v=>v.id).join(',')`,ctx);assert.ok(tags.endsWith(',none'));
});
test('sorting is applied before pagination and exposes accessible header state',()=>{
 const node={innerHTML:'',querySelectorAll:()=>[]};const ctx=vm.createContext({$:id=>id==='#account-video-table'?node:null,esc:String});vm.runInContext(source,ctx);
 vm.runInContext(`accountView.sortKey='diggCount';accountView.sortDirection='desc';accountView.reportsById=new Map();accountView.data={stats:{videos:Array.from({length:35},(_,i)=>({id:String(i),date:'2026-11-05',title:'作品'+i,topics:[],diggCount:i,ruleTags:[],funnels:[]}))}};drawAccountTable();`,ctx);
 assert.ok(node.innerHTML.indexOf('data-account-detail="34"')<node.innerHTML.indexOf('data-account-detail="33"'));assert.ok(!node.innerHTML.includes('data-account-detail="0"'));assert.ok(node.innerHTML.includes('aria-sort="descending"'));assert.ok(node.innerHTML.includes('data-account-sort="tags"'));
});
test('account entry keeps input and current works visible instead of opening a report',()=>{
 const node={innerHTML:'',classList:{toggle:()=>{}},querySelectorAll:()=>[]};const ctx=vm.createContext({$:()=>null,esc:String,douyinTab:'account',collectionStateLabel:String,collectionProgressLog:()=>'<section>日志</section>',bindCollectionFilters:()=>{},bindCollectionFlowButtons:()=>{}});vm.runInContext(source,ctx);
 vm.runInContext(`accountWorkflowForm=()=>'';addAccountClearButton=()=>{};renderAccountReport=()=>{throw Error('must not open report')};accountView.data={taskId:'t',tasks:[{id:'t',title:'当前博主',mode:'profile',count:1,state:'running'}],stats:{videos:[]}};`,ctx);ctx.node=node;vm.runInContext('renderAccountAnalysis(node)',ctx);
 assert.ok(node.innerHTML.includes('id="account-profile"'));assert.ok(node.innerHTML.includes('id="account-collect"'));assert.ok(node.innerHTML.includes('id="account-video-table"'));assert.ok(node.innerHTML.includes('查看完整报告'));assert.ok(!node.innerHTML.includes('account-pane-report'));
});
test('report comparisons use compact rows and identify missing comparison samples',()=>{
 const ctx=vm.createContext({esc:String});vm.runInContext(source,ctx);
 const html=vm.runInContext(`accountTurningPoints({turningPoints:[{id:'video',date:'2026-11-05',title:'真实标题 #话题',likes:100,medianMultiple:3,pattern:'对照作品不足',previous:{count:0,medianLikes:null},following:{count:1,medianLikes:100}}]})`,ctx);
 assert.ok(html.includes('account-comparison-table'));assert.ok(html.includes('无前期样本'));assert.ok(html.includes('data-account-open="video"'));assert.ok(!html.includes('>未知<'));assert.ok(!html.includes('account-turning-grid'));
});
test('works table separates all metrics and shortens titles without dropping detail identity',()=>{
 const node={innerHTML:'',querySelectorAll:()=>[]};const ctx=vm.createContext({$:id=>id==='#account-video-table'?node:null,esc:String});vm.runInContext(source,ctx);
 vm.runInContext(`accountView.data={stats:{videos:[{id:'v',date:'2026-11-05',title:'真实标题 #长话题',transcript:'正文',topics:[],diggCount:10,collectCount:5,commentCount:3,shareCount:2,saveLikeRatio:.5,medianMultiple:2,ruleTags:[],funnels:['主页']} ]}};accountView.reportsById=new Map();drawAccountTable();`,ctx);
 for(const label of ['发布日期','作品标题','点赞','收藏','评论','转发','藏赞比','基线倍数','AI 分类','线索','操作'])assert.ok(node.innerHTML.includes('>'+label+'<'));
 assert.ok(node.innerHTML.includes('title="真实标题 #长话题">真实标题</a>'));assert.ok(node.innerHTML.includes('data-account-detail="v"'));
});
test('clear detaches only the page and preserves task history without cancelling any backend task',()=>{
 let requests=0;const ctx=vm.createContext({clearTimeout:()=>{},api:()=>requests++});vm.runInContext(source,ctx);
 vm.runInContext(`renderAccountAnalysis=()=>{};accountView.data={tasks:[{id:'t',state:'running'}],taskId:'t',stats:{}};accountView.taskId='t';accountView.profile='url';accountView.requestSerial=4;clearAccountPage({});`,ctx);
 assert.equal(requests,0);assert.equal(vm.runInContext('accountView.taskId',ctx),null);assert.equal(vm.runInContext('accountView.profile',ctx),'');assert.equal(vm.runInContext('accountView.requestSerial',ctx),5);assert.equal(vm.runInContext('accountView.data.tasks[0].state',ctx),'running');assert.equal(vm.runInContext('accountView.cleared',ctx),true);
});
