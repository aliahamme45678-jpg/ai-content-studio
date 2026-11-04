"""Project-owned adapter. Reuses upstream collectors without invoking ASR/comments/Feishu."""
import asyncio
import importlib.util
import json
import os
import sys
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name('python-runtime.py')))['ensure_runtime'](sys.argv)
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
print(f'Python: {sys.executable}', flush=True)

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
original_parse_aweme = collector.parse_aweme
def parse_with_metadata(aweme):
    row = original_parse_aweme(aweme)
    author = aweme.get('author') or {}
    stats = aweme.get('statistics') or {}
    row['author_id'] = author.get('uid')
    row['sec_uid'] = author.get('sec_uid')
    row['statistics'] = stats
    row['is_ads'] = aweme.get('is_ads')
    row['follower_count'] = author.get('follower_count')
    row['followerCountKnown'] = author.get('follower_count') is not None
    for key in ('digg_count', 'collect_count', 'comment_count', 'share_count', 'play_count'):
        row[key] = stats.get(key)
    return row
collector.parse_aweme = parse_with_metadata
if os.environ.get('DOUYIN_STATE_PATH'):
    state_path = Path(os.environ['DOUYIN_STATE_PATH']).expanduser()
    if state_path.is_file():
        collector.STATE_FILE = str(state_path.resolve())
        collector.NO_STATE = False
        collector.check_login_once = lambda **kwargs: print('登录状态：使用工作台配置的本机登录态。', flush=True)
if request['mode'] == 'links':
    rows = asyncio.run(collector.LinkCollector(request['urls'], with_content=False, headless=True).run())
elif request.get('collectAll'):
    from importlib.util import spec_from_file_location, module_from_spec
    history_spec = spec_from_file_location('profile_history', Path(__file__).with_name('collect-profile-all.py'))
    history_module = module_from_spec(history_spec)
    history_spec.loader.exec_module(history_module)
    rows = asyncio.run(history_module.collect_profile_history(collector, request['urls'][0], job_dir))
else:
    rows = asyncio.run(collector.DouyinCollector(0, 0, 0, max_videos=request.get('maxVideos',500), headless=True, with_content=False).run(request['urls'][0]))
filters = request.get('filters', {})
def num(row, *keys):
    for key in keys:
        value = row.get(key)
        if value is not None:
            try: return float(value)
            except (ValueError, TypeError): pass
    return 0
if not rows:
    raise RuntimeError('no_results: 可能需要登录、触发风控或链接无效，不能视为成功')
(job_dir / 'raw.json').write_text(json.dumps(rows, ensure_ascii=False), encoding='utf-8')
valid = [row for row in rows if row.get('aweme_id') and row.get('title')]
if not valid:
    raise RuntimeError('no_valid_results: 采集器只返回了失败占位记录，请检查登录状态和链接')
selected = []
unknown_play = 0
for row in valid:
    metrics = [('PlayCount', 'play_count', 'playCount'), ('Digg', 'digg_count', 'diggCount'), ('Collect', 'collect_count', 'collectCount'), ('Comment', 'comment_count', 'commentCount'), ('Share', 'share_count', 'shareCount')]
    matched = True
    for metric, raw, camel in metrics:
        lower, upper = filters.get('min' + metric, 0), filters.get('max' + metric)
        value = row.get(raw, row.get(camel))
        active = lower > 0 or upper is not None
        if active and value is None:
            if metric == 'PlayCount': unknown_play += 1
            matched = False
            break
        value = num(row, raw, camel)
        if value < lower or upper is not None and value > upper:
            matched = False
            break
    if matched: selected.append(row)
summary = {'total':len(rows),'valid':len(valid),'matched':len(selected),'failedRows':len(rows)-len(valid),'unknownPlayCountExcluded':unknown_play,'filteredOut':len(valid)-len(selected)-unknown_play}
if (job_dir / 'coverage.json').exists():
    summary['coverage'] = json.loads((job_dir / 'coverage.json').read_text(encoding='utf-8'))
    summary['coverage']['filters'] = filters
    summary['coverage']['matched'] = len(selected)
(job_dir / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False), encoding='utf-8')
# Preserve stable identifiers and audio URLs even when not chosen as display fields.
(job_dir / 'result.json').write_text(json.dumps(selected, ensure_ascii=False), encoding='utf-8')
print(f'完成：{len(selected)} 条匹配；播放量未知排除 {unknown_play} 条；作品失败 {summary["failedRows"]} 条。未调用转写、评论或飞书。', flush=True)
