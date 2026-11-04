import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('profile history distinguishes confirmed last page from stalled loading and preserves unfiltered source metrics',()=>{
  const script=String.raw`
import asyncio, importlib.util, json, tempfile
from pathlib import Path
from types import SimpleNamespace
source=Path('app/src/collect-profile-all.py').resolve()
spec=importlib.util.spec_from_file_location('profile_history_test',source)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
async def no_wait(_): pass
module.asyncio.sleep=no_wait
class Response:
 url='https://www.douyin.com/aweme/v1/web/aweme/post/'
 def __init__(self,payload): self.payload=payload
 async def json(self): return self.payload
class Page:
 def __init__(self,complete): self.complete=complete;self.scrolled=False
 def on(self,event,callback): self.callback=callback
 async def goto(self,*a,**k):
  self.callback(Response({'has_more':0 if self.complete=='login' else 1,'aweme_list':[{'aweme_id':'1','desc':'普通作品','statistics':{'digg_count':0,'collect_count':0}}]}))
  await asyncio.gather(*[task for task in asyncio.all_tasks() if task is not asyncio.current_task()])
 async def evaluate(self,kind): return self.complete=='login' and kind=='login'
 async def scroll(self):
  if self.complete and not self.scrolled:
   self.scrolled=True;self.callback(Response({'has_more':0,'aweme_list':[{'aweme_id':'2','desc':'','statistics':{'digg_count':10000,'collect_count':100}}]}))
class Playwright:
 async def __aenter__(self): return self
 async def __aexit__(self,*a): pass
class Browser:
 async def close(self): pass
async def run(complete):
 page=Page(complete)
 async def new_page(): return page
 async def open_browser(*a): return Browser(),SimpleNamespace(new_page=new_page)
 async def scroll(_): await page.scroll()
 collector=SimpleNamespace(async_playwright=Playwright,open_browser=open_browser,iter_awemes=lambda p:p['aweme_list'],parse_aweme=lambda a:{'aweme_id':a['aweme_id'],'title':a['desc'],'url':'https://www.douyin.com/video/'+a['aweme_id']},smart_scroll=scroll,SCROLL_PAUSE_TIME=0,VERIFY_JS='verify',LOGIN_JS='login')
 with tempfile.TemporaryDirectory() as tmp:
  path=Path(tmp);rows=await module.collect_profile_history(collector,'https://www.douyin.com/user/test',path)
  coverage=json.loads((path/'coverage.json').read_text(encoding='utf-8'))
  assert coverage['complete'] is (False if complete=='login' else complete)
  assert rows[0]['digg_count']==0 and rows[0]['comment_count'] is None
  assert len(rows)==(2 if complete is True else 1)
  if complete is True: assert rows[1]['title'].startswith('无标题作品')
  elif complete=='login': assert coverage['stopReason']=='collection_interrupted'
  else: assert coverage['stopReason']=='no_new_items_without_end_confirmation'
  assert (path/'profile-raw.ndjson').exists()
asyncio.run(run(True));asyncio.run(run(False));asyncio.run(run('login'))
`;
  const result=spawnSync(process.env.STUDIO_PYTHON||'python',['-c',script],{cwd:new URL('../..',import.meta.url),encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'},timeout:20000});
  assert.equal(result.status,0,result.stderr||result.stdout);
});
