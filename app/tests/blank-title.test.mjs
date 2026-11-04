import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createJob,draftContext} from '../src/workflow.mjs';
test('blank titles remain blank for rewrites and separate topic content; the model still receives the complete subject',()=>{
 const db={templates:[{id:'t',name:'模板',active:true,kind:'视频口播',platform:'抖音',bindings:[],prompt:'根据 {{topic}} 写作'}],documents:[],sources:[],knowledgeSets:[]};
 const rewrite=createJob(db,{templateId:'t',title:'',original:'完整原稿，不是标题。'},'参考改写');assert.equal(rewrite.title,'');
 const subject='很长的选题内容。'.repeat(100);const topic=createJob(db,{templateId:'t',title:'',topic:subject});assert.equal(topic.title,'');assert.equal(topic.topic,subject);assert.match(draftContext(db,topic).user,/很长的选题内容/);assert.match(draftContext(db,topic).system,/很长的选题内容/);
 const explicit=createJob(db,{templateId:'t',title:'独立标题',topic:subject});assert.equal(explicit.title,'独立标题');assert.equal(explicit.topic,subject);
});
