import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../public/prompt-library.js',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(source,context);

test('一键复制全部：提示词 + 语言 DNA + 结构模板 + 选题认知 + 视觉，顺序固定',()=>{
 const text=vm.runInContext('promptBundleText',context)('墨鱼风格','先说结论再解释。',{
  language:'平均句长 21 字，短句为主。',
  structure:'反常识纠偏 → 三步动作 → 一句收束。',
  cognition:'核心命题 1：钱少先做东南亚。',
  visual:'未提供视频画面。',
  articles:68,
 });
 const order=['# 墨鱼风格','## 提示词','先说结论再解释。','## 语言 DNA','平均句长 21 字','## 结构模板','## 选题、素材与认知','## 视觉与资料范围'];
 let cursor=-1;
 for(const piece of order){const at=text.indexOf(piece);assert.ok(at>cursor,`${piece} 应按顺序出现`);cursor=at;}
 assert.equal(text.includes('68'),false,'统计字段不进复制内容');
});

test('没有分层内容时只复制提示词，空字段自动跳过',()=>{
 const build=vm.runInContext('promptBundleText',context);
 const plain=build('普通模板','只写提示词。',null);
 assert.equal(plain,'# 普通模板\n\n## 提示词\n\n只写提示词。');
 const partial=build('部分','正文',{language:'短句',structure:'',cognition:null});
 assert.ok(partial.includes('## 语言 DNA'));
 assert.ok(!partial.includes('## 结构模板')&&!partial.includes('## 选题'),'空层不输出标题');
 assert.equal(build('', '', {}),'# 提示词\n\n## 提示词');
});
