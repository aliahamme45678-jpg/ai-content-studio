# -*- coding: utf-8 -*-
"""评论采集：视频链接清单 → 抓评论 → 无效过滤 → 落盘。

抓取方案复用 `_probe_comments.py` 验证过的路子（实测 34 条 1.2 s）：
  1. 让页面自己发一次评论请求，记下带签名的完整 URL
  2. 在页面上下文里用同一 URL 改 cursor 反复 fetch —— 复用页面已有签名，
     不用自己算 a_bogus

三种用法：
    # 1) 独立跑（批量补历史）
    python comments_step.py --todo _comments_todo.json --workers 3 --resume

    # 2) 小规模验证
    python comments_step.py --todo _comments_todo.json --limit 3

    # 3) 被 collector.py / pipeline 调用（采集完顺手抓评论）
    from comments_step import collect_for
    collect_for(videos)          # videos 是 collector 的采集结果列表

并发：多个 context 共享一个 browser，asyncio.Semaphore 控并发。
断点续跑：`--resume` 跳过已抓过的视频 key（中途崩了不用从头来）。
"""

import argparse
import asyncio
import json
import os
import sys
import time

from playwright.async_api import async_playwright

import comments_filter as F

BASE = os.path.dirname(os.path.abspath(__file__))
sys.stdout.reconfigure(encoding="utf-8")

STATE = os.path.join(BASE, "douyin_state.json")
ALL_PATH = os.path.join(BASE, "comments_all.ndjson")
KEPT_PATH = os.path.join(BASE, "comments_kept.ndjson")
MANI_PATH = os.path.join(BASE, "comments_manifest.json")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

FETCH_JS = """async (u) => {
    const r = await fetch(u, {credentials: 'include'});
    return await r.text();
}"""


# ---------------------------------------------------------------- 输入处理

def norm(u):
    """剥掉飞书 text 字段的 [url](url) 壳。"""
    u = str(u or "")
    if u.startswith("[") and "](" in u:
        u = u[u.index("](") + 2:].rstrip(")")
    return u.strip()


def load_todo(path, limit=0):
    todo = json.load(open(path, encoding="utf-8"))
    for t in todo:
        t["link"] = norm(t.get("link"))
    todo = [t for t in todo if t["link"]]
    # 表里记 0 条评论的直接跳过，别白开一次浏览器
    todo = [t for t in todo if int(t.get("评论数") or 0) > 0]
    if limit:
        todo = todo[:limit]
    return todo


def build_items(videos):
    """把采集结果（collector.py 的 dict 列表）转成抓取用的 item 列表。"""
    items, seen = [], set()
    for v in videos:
        # 链接采集模式落的是 source_url；主页采集模式落的是 url。两个都认。
        link = norm(v.get("source_url")) or norm(v.get("url"))
        if not link:
            continue
        key = str(v.get("aweme_id") or link)
        if key in seen:
            continue
        seen.add(key)
        items.append({
            "key": key,
            "link": link,
            "作者": v.get("author_name") or "",
            "标题": v.get("title") or "",
            "评论数": v.get("comment_count") or 0,
        })
    return items


# ---------------------------------------------------------------- 抓取

async def launch(p, headless):
    for kw in ({"channel": "msedge"}, {}):
        try:
            return await p.chromium.launch(headless=headless, args=["--mute-audio"], **kw)
        except Exception:
            continue
    raise SystemExit("浏览器启动失败")


async def grab_one(browser, item, state, max_pages, sem, verbose=False):
    """抓一条视频的评论。返回 dict。"""
    async with sem:
        t0 = time.time()
        tag = f"{item['作者'][:10]:<12}"
        ctx = await browser.new_context(storage_state=state, user_agent=UA,
                                        viewport={"width": 1400, "height": 900})
        try:
            page = await ctx.new_page()
            holder = {"u": None}

            def on_resp(r):
                if "/aweme/v1/web/comment/list/" in r.url and not holder["u"]:
                    holder["u"] = r.url

            page.on("response", on_resp)
            await page.goto(item["link"], wait_until="domcontentloaded", timeout=60000)
            await page.wait_for_timeout(4000)
            # 评论区不一定在首屏，滚一滚把请求逼出来
            for _ in range(4):
                if holder["u"]:
                    break
                await page.mouse.wheel(0, 1600)
                await page.wait_for_timeout(1400)

            if not holder["u"]:
                return {"key": item["key"], "status": "no_comment_api",
                        "comments": [], "elapsed": round(time.time() - t0, 1)}

            base_u = holder["u"].split("&cursor=")[0]
            all_c, seen, cursor = [], set(), 0
            pages = 0
            for _ in range(max_pages):
                url = f"{base_u}&cursor={cursor}&count=20"
                try:
                    txt = await page.evaluate(FETCH_JS, url)
                    d = json.loads(txt)
                except Exception as e:
                    if verbose:
                        print(f"    {tag} 第{pages+1}页失败 {type(e).__name__}")
                    break
                cs = d.get("comments") or []
                pages += 1
                for c in cs:
                    cid = c.get("cid")
                    if cid and cid not in seen:
                        seen.add(cid)
                        all_c.append(c)
                if not d.get("has_more") or not cs:
                    break
                cursor = d.get("cursor") or (cursor + 20)
                await page.wait_for_timeout(300)

            el = round(time.time() - t0, 1)
            if verbose:
                print(f"    {tag} {len(all_c):>4} 条 / {pages} 页 / {el}s")
            return {"key": item["key"], "status": "ok", "comments": all_c,
                    "pages": pages, "elapsed": el}
        except Exception as e:
            return {"key": item["key"], "status": "error",
                    "error": f"{type(e).__name__}: {str(e)[:120]}",
                    "comments": [], "elapsed": round(time.time() - t0, 1)}
        finally:
            try:
                await ctx.close()
            except Exception:
                pass


# ---------------------------------------------------------------- 落盘

def to_row(c, item):
    u = c.get("user") or {}
    return {
        "视频key": item["key"],
        "作者": item["作者"],
        "视频标题": item["标题"],
        "视频链接": item["link"],
        "评论": c.get("text") or "",
        "点赞": c.get("digg_count") or 0,
        "IP属地": c.get("ip_label") or "",
        "回复数": c.get("reply_comment_total") or 0,
        "是否热评": bool(c.get("is_hot")),
        "时间": c.get("create_time") or 0,
        "昵称": u.get("nickname") or "",
        "抖音号": u.get("unique_id") or "",
        "作者是否点赞": bool(c.get("is_author_digged")),
        "cid": c.get("cid") or "",
    }


def mark(rows):
    """就地打标：过滤原因 + 价值分 + 粗分类。同视频内重复的只留点赞最高的。"""
    groups = {}
    for r in rows:
        k = (r["视频key"], F._squeeze(F.clean(r["评论"])))
        groups.setdefault(k, []).append(r)
    dup_keep = set()
    for k, g in groups.items():
        if not k[1]:
            continue
        if len(g) > 1:
            dup_keep.add(id(max(g, key=lambda x: x["点赞"])))

    kept = 0
    for r in rows:
        k = (r["视频key"], F._squeeze(F.clean(r["评论"])))
        is_dup = len(groups.get(k, [])) > 1 and id(r) not in dup_keep
        r["过滤原因"] = F.classify_invalid(r["评论"], dup=is_dup)
        r["价值分"] = F.value_score(r["评论"], r["点赞"], r["是否热评"], r["回复数"])
        r["粗分类"] = F.detect_types(r["评论"])
        if not r["过滤原因"]:
            kept += 1
    return kept


async def _run_items(items, state, workers, max_pages, verbose,
                     all_path=ALL_PATH, kept_path=KEPT_PATH, mani_path=MANI_PATH,
                     quiet=False):
    """核心：并发抓 + 过滤 + 写盘。main() 和 collect_for() 都走这里。"""
    t0 = time.time()
    fa = open(all_path, "a", encoding="utf-8")
    fk = open(kept_path, "a", encoding="utf-8")
    stats = {"ok": 0, "no_comment_api": 0, "error": 0}
    n_all = n_kept = 0
    fails = []
    by_key = {t["key"]: t for t in items}

    async with async_playwright() as p:
        b = await launch(p, True)
        sem = asyncio.Semaphore(workers)
        tasks = [asyncio.create_task(grab_one(b, t, state, max_pages, sem, verbose))
                 for t in items]
        for i, fut in enumerate(asyncio.as_completed(tasks), 1):
            res = await fut
            item = by_key[res["key"]]
            stats[res["status"]] = stats.get(res["status"], 0) + 1
            rows = [to_row(c, item) for c in res["comments"]]
            n_kept += mark(rows)
            n_all += len(rows)
            for r in rows:
                fa.write(json.dumps(r, ensure_ascii=False) + "\n")
                if not r["过滤原因"]:
                    fk.write(json.dumps(r, ensure_ascii=False) + "\n")
            fa.flush()
            fk.flush()
            if res["status"] != "ok":
                fails.append({"key": res["key"], "作者": item["作者"],
                              "status": res["status"], "error": res.get("error", ""),
                              "link": item["link"]})
            if not quiet:
                print(f"  [{i}/{len(items)}] {item['作者'][:12]:<14} "
                      f"{len(rows):>4} 条 (有效 {sum(1 for r in rows if not r['过滤原因']):>4}) "
                      f"{res['status']:<14} 累计 {time.time()-t0:.0f}s")
        try:
            await b.close()
        except Exception as e:
            # Playwright sync/async 混用或跨线程 close 会抛错，但**结果已经写完了**，
            # 不能让它把整个流程炸掉（2026-09-22 在 batch_extract.py 上踩过）
            print(f"  [warn] 关闭浏览器失败（不影响结果）: {type(e).__name__}")

    fa.close()
    fk.close()
    el = round(time.time() - t0, 1)
    mani = {
        "finished_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "elapsed_sec": el,
        "videos": len(items),
        "comments_all": n_all,
        "comments_kept": n_kept,
        "drop_rate": round(1 - n_kept / n_all, 3) if n_all else None,
        "status": stats,
        "fails": fails,
    }
    if mani_path:
        json.dump(mani, open(mani_path, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)
    if not quiet:
        print(f"\n完成 {el}s | 视频 {len(items)} | 评论 {n_all} 条，有效 {n_kept} 条 "
              f"(丢弃 {n_all - n_kept}, {mani['drop_rate']})")
        print(f"状态 {stats}")
        if fails:
            print(f"失败 {len(fails)} 条，已记入 manifest")
        print(f"→ {all_path}\n→ {kept_path}")
    return mani


def collect_for(videos, state=None, workers=3, max_pages=80, verbose=True,
                all_path=ALL_PATH, kept_path=KEPT_PATH, mani_path=None,
                track_only=True):
    """给 collector.py / pipeline 调的同步入口：采集完主数据后顺手抓评论。

    与独立跑的区别：这里**不做 resume**（每次采集都是新视频），直接追加写盘。
    失败不抛异常 —— 评论抓不到不该把主采集流程带崩。

    track_only=True（默认）只抓 AI / 跨境赛道作者的评论，规则见 track_rules.py。
    没判定过的作者会被当「其他」剔掉**并打印出来** —— 看到陌生作者名，
    就去跑 track_judge.py，或直接加进 track_override.json。
    """
    try:
        items = build_items(videos)
        if not items:
            print("  [评论] 没有可抓链接，跳过")
            return None
        if track_only:
            from track_rules import is_kept, track_of
            cut = [i for i in items if not is_kept(i.get("作者") or "")]
            items = [i for i in items if is_kept(i.get("作者") or "")]
            if cut:
                print(f"  [评论] 赛道过滤剔掉 {len(cut)} 条非 AI/跨境：")
                for i in cut[:10]:
                    a = i.get("作者") or "(空)"
                    print(f"         ✗ {a}  [{track_of(a)}]")
                if len(cut) > 10:
                    print(f"         … 另有 {len(cut) - 10} 条")
            if not items:
                print("  [评论] 没有本赛道（AI/跨境）的视频，跳过")
                return None
        st = state or STATE
        if not os.path.isabs(st):
            st = os.path.join(BASE, st)
        if not os.path.exists(st):
            print(f"  [评论] 登录态不存在，跳过：{st}")
            return None
        print(f"\n  [评论] 抓 {len(items)} 条视频的评论（并发 {workers}）")
        return asyncio.run(_run_items(items, st, workers, max_pages, verbose,
                                      all_path, kept_path, mani_path))
    except Exception as e:
        print(f"  [评论] 采集失败（不影响主流程）: {type(e).__name__}: {e}")
        return None


# ---------------------------------------------------------------- CLI

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--todo", default="_comments_todo.json")
    ap.add_argument("--state", default="")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--max-pages", type=int, default=80, help="单视频最多翻多少页(每页20条)")
    ap.add_argument("--limit", type=int, default=0, help="只跑前 N 条（验证用）")
    ap.add_argument("--resume", action="store_true", help="跳过已抓过的视频")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    try:
        import login_state
        info = login_state.ensure_fresh(verbose=True)
        if info.get("need_login"):
            print("  [登录态] 已过期，需要扫码一次：python refresh_login.py --login")
    except Exception as e:
        print(f"  [登录态] 体检跳过（不影响采集）: {type(e).__name__}: {e}")

    state = args.state or STATE
    if not os.path.isabs(state):
        state = os.path.join(BASE, state)
    if not os.path.exists(state):
        raise SystemExit(f"登录态文件不存在：{state}")

    todo_path = args.todo if os.path.isabs(args.todo) else os.path.join(BASE, args.todo)
    todo = load_todo(todo_path, args.limit)
    print(f"待采集 {len(todo)} 条视频")

    if args.resume and os.path.exists(ALL_PATH):
        done = set()
        for l in open(ALL_PATH, encoding="utf-8"):
            if l.strip():
                try:
                    done.add(json.loads(l)["视频key"])
                except Exception:
                    pass
        before = len(todo)
        todo = [t for t in todo if t["key"] not in done]
        print(f"续跑：跳过已完成 {before - len(todo)} 条，剩 {len(todo)} 条")

    if not todo:
        print("没有要跑的，退出")
        return

    asyncio.run(_run_items(todo, state, args.workers, args.max_pages, args.verbose))


if __name__ == "__main__":
    main()
