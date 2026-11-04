"""Collect visible profile history, preserving page-end evidence and raw responses."""
import asyncio
import json
import time


async def collect_profile_history(collector, homepage_url, job_dir):
    items, seen, pending = [], set(), set()
    coverage = {'requestedAll': True, 'complete': False, 'stopReason': 'starting', 'pages': 0, 'collected': 0, 'expectedPublicCount': None}
    raw_file = job_dir / 'profile-raw.ndjson'

    def checkpoint():
        coverage['collected'] = len(items)
        (job_dir / 'result.json').write_text(json.dumps(items, ensure_ascii=False), encoding='utf-8')
        (job_dir / 'coverage.json').write_text(json.dumps(coverage, ensure_ascii=False), encoding='utf-8')

    async def capture(response):
        if '/user/profile/' in response.url:
            try:
                profile = (await response.json()).get('user') or {}
                count = profile.get('aweme_count')
                if isinstance(count, int):
                    coverage['expectedPublicCount'] = count
            except Exception:
                pass
            return
        if '/aweme/' not in response.url or '/post/' not in response.url:
            return
        try:
            payload = await response.json()
            awemes = collector.iter_awemes(payload)
            coverage['pages'] += 1
            if payload.get('has_more') in (0, False) and 'has_more' in payload:
                coverage['complete'] = True
                coverage['stopReason'] = 'platform_list_end'
            with raw_file.open('a', encoding='utf-8') as output:
                for aweme in awemes:
                    video_id = aweme.get('aweme_id')
                    if not video_id or video_id in seen:
                        continue
                    seen.add(video_id)
                    output.write(json.dumps(aweme, ensure_ascii=False) + '\n')
                    row = collector.parse_aweme(aweme)
                    if not row.get('title'):
                        row['title'] = f'无标题作品 {video_id}'
                    stats = aweme.get('statistics') or {}
                    author = aweme.get('author') or {}
                    for raw_key in ('digg_count', 'collect_count', 'comment_count', 'share_count', 'play_count'):
                        row[raw_key] = stats.get(raw_key)
                    row.update({'statistics': stats, 'author_id': author.get('uid'), 'sec_uid': author.get('sec_uid'),
                                'follower_count': author.get('follower_count'), 'followerCountKnown': author.get('follower_count') is not None,
                                'collected_at': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
                                'is_top': bool(aweme.get('is_top')), 'is_ads': aweme.get('is_ads'),
                                'aweme_type': aweme.get('aweme_type'), 'text_extra': aweme.get('text_extra') or [],
                                'mix_info': aweme.get('mix_info') or {}, 'commerce_info': aweme.get('commerce_info') or {}})
                    items.append(row)
            checkpoint()
            print(f'第 {coverage["pages"]} 页：累计收到 {len(items)} 条作品' + (f' / 主页显示 {coverage["expectedPublicCount"]} 条' if coverage['expectedPublicCount'] is not None else ''), flush=True)
        except Exception as error:
            coverage['lastPageError'] = type(error).__name__

    def on_response(response):
        task = asyncio.create_task(capture(response))
        pending.add(task)
        task.add_done_callback(pending.discard)

    started = time.monotonic()
    interrupted = False
    async def check_access(page):
        if await page.evaluate(collector.VERIFY_JS):
            raise RuntimeError('platform_verification_required: 平台要求验证，请更新登录态后重试')
        if await page.evaluate(collector.LOGIN_JS):
            raise RuntimeError('platform_login_required: 平台要求登录，请在连接和设置配置可用登录态')
    async with collector.async_playwright() as playwright:
        browser, context = await collector.open_browser(playwright, True)
        page = await context.new_page()
        page.on('response', on_response)
        try:
            print('正在采集博主可见作品，按分页直到平台返回末页；不筛掉普通作品。', flush=True)
            await page.goto(homepage_url, wait_until='domcontentloaded', timeout=60000)
            await asyncio.sleep(3)
            await check_access(page)
            idle = 0
            for scroll in range(10000):
                if pending:
                    await asyncio.gather(*list(pending), return_exceptions=True)
                if coverage['complete']:
                    break
                if time.monotonic() - started > 3600 or len(items) >= 100000:
                    coverage['stopReason'] = 'runtime_protection_limit'
                    break
                before = len(items)
                await collector.smart_scroll(page)
                await asyncio.sleep(collector.SCROLL_PAUSE_TIME)
                if pending:
                    await asyncio.gather(*list(pending), return_exceptions=True)
                idle = idle + 1 if len(items) == before else 0
                print(f'已取得 {len(items)} 条作品；第 {scroll + 1} 轮加载；末页确认 {coverage["complete"]}', flush=True)
                if idle >= 8:
                    coverage['stopReason'] = 'no_new_items_without_end_confirmation'
                    break
                await check_access(page)
            else:
                coverage['stopReason'] = 'scroll_protection_limit'
        except Exception as error:
            interrupted = True
            coverage['stopReason'] = 'collection_interrupted'
            coverage['error'] = str(error)[:300]
            print(f'采集暂停：{error}；已保留 {len(items)} 条。需要扫码登录时，请在工作台点击“扫码登录抖音”。', flush=True)
            if not items:
                raise
        finally:
            if pending:
                await asyncio.gather(*list(pending), return_exceptions=True)
            if interrupted:
                coverage['complete'] = False
            checkpoint()
            await browser.close()
    print(f'采集结束：{len(items)} 条；完整性：{coverage["complete"]}；原因：{coverage["stopReason"]}', flush=True)
    return items
