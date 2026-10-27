import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectionRequest } from '../src/collection-request.mjs';
test('collection accepts only bounded Douyin HTTPS links without shell arguments',()=>{
 assert.equal(collectionRequest({mode:'links',urls:'https://v.douyin.com/abc/'}).urls.length,1);
 for(const input of [{mode:'x',urls:'https://douyin.com/a'},{mode:'links',urls:'file:///x'},{mode:'links',urls:'https://evil.example/a'},{mode:'links',urls:'https://douyin.com.evil.example/a'},{mode:'links',urls:'https://user@douyin.com/a'},{mode:'profile',urls:'https://douyin.com/a https://douyin.com/b'},{mode:'links',urls:''}])assert.throws(()=>collectionRequest(input),{statusCode:400});
});
test('collection request carries filters and selected fields',()=>{
 const result=collectionRequest({mode:'links',urls:'https://www.douyin.com/video/1',minPlayCount:1000,minDigg:20,fields:['title','playCount','diggCount']});
 assert.deepEqual(result.filters,{minPlayCount:1000,minDigg:20,minCollect:0,minComment:0});assert.deepEqual(result.fields,['title','playCount','diggCount']);
});
