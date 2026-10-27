"""Project-owned adapter. Reuses upstream collectors without invoking ASR/comments/Feishu."""
import asyncio
import importlib.util
import json
import os
import sys
from pathlib import Path

job_dir = Path(sys.argv[1]).resolve()
request = json.loads((job_dir / 'request.json').read_text(encoding='utf-8'))
upstream = Path(__file__).resolve().parents[2] / 'opensource' / 'douyin-material-pipeline' / 'douyin-collector'
sys.path.insert(0, str(upstream))
os.environ['DOUYIN_NO_STATE'] = '1'
os.environ['DOUYIN_BROWSER'] = 'chromium'
spec = importlib.util.spec_from_file_location('collector', upstream / 'collector.py')
collector = importlib.util.module_from_spec(spec)
sys.modules['collector'] = collector
spec.loader.exec_module(collector)
collector.BASE_DIR = str(job_dir)
if request['mode'] == 'links':
    rows = asyncio.run(collector.LinkCollector(request['urls'], with_content=False, headless=True).run())
else:
    rows = asyncio.run(collector.DouyinCollector(0, 0, 0, headless=True, with_content=False).run(request['urls'][0]))
filters = request.get('filters', {})
def num(row, *keys):
    for key in keys:
        value = row.get(key)
        if value is not None:
            try: return float(value)
            except (ValueError, TypeError): pass
    return 0
rows = [row for row in rows if num(row,'play_count','playCount') >= filters.get('minPlayCount',0) and num(row,'digg_count','diggCount','digg') >= filters.get('minDigg',0) and num(row,'collect_count','collectCount','collect') >= filters.get('minCollect',0) and num(row,'comment_count','commentCount','comment') >= filters.get('minComment',0)]
fields = request.get('fields', [])
if fields:
    aliases = {'title':'title','url':'url','author':'author','publishedAt':'published_at','diggCount':'digg_count','collectCount':'collect_count','commentCount':'comment_count','shareCount':'share_count','playCount':'play_count','transcript':'transcript','comments':'comments'}
    rows = [{key: row.get(aliases.get(key,key)) for key in fields} for row in rows]
if not rows:
    raise RuntimeError('no_results: 可能需要登录、触发风控或链接无效，不能视为成功')
(job_dir / 'result.json').write_text(json.dumps(rows, ensure_ascii=False), encoding='utf-8')
print(f'完成：{len(rows)} 条作品数据；未调用转写、评论或飞书推送', flush=True)
