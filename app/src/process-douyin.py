"""Run one optional upstream stage; checkpoint each item and keep original metadata."""
import asyncio
import json
import os
import sys
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name('python-runtime.py')))['ensure_runtime'](sys.argv)
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

task_dir = Path(sys.argv[1]).resolve()
stage_dir = Path(sys.argv[2]).resolve()
stage = sys.argv[3]
upstream = Path(__file__).resolve().parents[2] / 'opensource' / 'douyin-material-pipeline' / 'douyin-collector'
sys.path.insert(0, str(upstream))
rows = json.loads((task_dir / 'result.json').read_text(encoding='utf-8'))
rows = [dict(row, aweme_id=row.get('aweme_id') or row.get('externalId'),
             author_name=row.get('author_name') or row.get('author', ''),
             comment_count=row.get('comment_count', row.get('commentCount', 0))) for row in rows]
summary = {'succeeded': 0, 'failed': 0, 'skipped': 0, 'unknown': 0}


def checkpoint():
    (stage_dir / 'result.json').write_text(json.dumps(rows, ensure_ascii=False), encoding='utf-8')
    (stage_dir / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False), encoding='utf-8')


if stage == 'asr':
    if not os.environ.get('DASHSCOPE_API_KEY'):
        raise RuntimeError('DASHSCOPE_API_KEY not configured')
    import aliyun_asr as asr
    if not asr.is_ready():
        raise RuntimeError('ASR disabled or not configured')
    for index, row in enumerate(rows):
        if row.get('content') or row.get('transcript'):
            summary['skipped'] += 1
            continue
        if row.get('transcriptState') == 'unknown':
            # 提交后未收到结果（例如进程中断），计费结果不明，需人工核对后才重试
            summary['skipped'] += 1
            continue
        row['transcriptState'] = 'unknown'
        # Save before submitting so interruption cannot silently cause a paid retry.
        checkpoint()
        try:
            url = row.get('play_url') or row.get('playUrl')
            text = asr.transcribe_video(url, workdir=str(stage_dir / 'audio')) if url else asr.transcribe_douyin(row.get('url', ''), headless=True)
            if not text.strip(): raise RuntimeError('empty_transcript')
            row['content'] = row['transcript'] = text
            row['transcriptState'] = 'succeeded'
            row.pop('transcriptError', None)
            summary['succeeded'] += 1
        except Exception as error:
            # 请求已完整结束且明确失败（含 empty_transcript）→ failed，下次可直接重试；
            # 只有上面「提交前标记 unknown 后无任何结果」的中断才需要人工核对计费。
            row['transcriptError'] = str(error)[:500]
            row['transcriptState'] = 'failed'
            summary['failed'] += 1
        checkpoint()
        print(f'ASR {index+1}/{len(rows)}: {row["transcriptState"]}', flush=True)
    # 真正「未确认结果」的行才计入 unknown（确定性失败已记 failed，可直接重试）
    summary['unknown'] = sum(1 for row in rows if row.get('transcriptState') == 'unknown')
elif stage == 'comments':
    import comments_step as comments
    items = comments.build_items(rows)
    if not items: raise RuntimeError('no_video_urls_for_comments')
    state_file = os.environ.get('DOUYIN_STATE_PATH')
    state = json.loads(Path(state_file).read_text(encoding='utf-8')) if state_file else None
    manifest = asyncio.run(comments._run_items(items, state, workers=1, max_pages=10, verbose=True,
        all_path=str(stage_dir / 'comments-all.jsonl'), kept_path=str(stage_dir / 'comments-kept.jsonl'),
        mani_path=str(stage_dir / 'comments-summary.json')))
    grouped = {}
    for line in (stage_dir / 'comments-kept.jsonl').read_text(encoding='utf-8').splitlines():
        item = json.loads(line)
        grouped.setdefault(str(item['视频key']), []).append(item)
    failed = {str(item['key']) for item in manifest.get('fails', [])}
    for row in rows:
        key = str(row.get('aweme_id') or row.get('externalId') or row.get('url'))
        row['comments'] = grouped.get(key, [])
        row['commentsState'] = 'failed' if key in failed else 'succeeded'
        summary['failed' if key in failed else 'succeeded'] += 1
else:
    raise RuntimeError('invalid_stage')
checkpoint()
