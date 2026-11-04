import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMaterial } from '../src/materials.mjs';
import { collectionRequest } from '../src/collection-request.mjs';

test('upstream fields survive normalization, including canonical reimport and unknown plays',()=>{
  const raw={aweme_id:'123',author_name:'作者',publish_time:'2026-10-28',content:'原始转写',collect_count:3,comment_count:5,share_count:7};
  const first=normalizeMaterial(raw);const twice=normalizeMaterial(first);
  assert.equal(first.author,'作者');assert.equal(twice.transcript,raw.content);assert.equal(twice.collectCount,3);assert.equal(twice.playCount,null);assert.equal(twice.playCountKnown,false);assert.match(first.url,/video\/123$/);
  assert.equal(normalizeMaterial({play_count:12000,play_count_estimated:true}).playCountKnown,false);
});

test('the advertised 500-link limit and nested UI filters are enforced by the API',()=>{
  const urls=Array.from({length:500},(_,i)=>`https://www.douyin.com/video/${i+1}`).join('\n');
  assert.equal(collectionRequest({mode:'links',urls,filters:{minDigg:7000}}).urls.length,500);
  assert.equal(collectionRequest({mode:'links',urls,filters:{minDigg:7000}}).filters.minDigg,7000);
  assert.throws(()=>collectionRequest({mode:'links',urls:urls+'\nhttps://www.douyin.com/video/501'}));
  for(const value of [-1,'abc',Infinity])assert.throws(()=>collectionRequest({mode:'links',urls,filters:{minDigg:value}}));
});
