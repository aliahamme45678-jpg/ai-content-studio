r"""
主页 → 两张飞书表，一条命令跑完。

把这几轮踩过的坑全部固化进来（见 SKILL.md「主页批量采集」章节）：
  1. 滚动必须滚 .route-scroll-container，滚 window 等于没滚 → 卡在 55 条
  2. 不逐条开浏览器抓互动数据（fill_stats 会卡死），直接用接口自带数据造 cache
  3. 音频必须串行（官方脚本要求），转写可并发
  4. 两张表都要推（只推 collect 用户会说"没看到数据"）
  5. 不出 xlsx
  6. 新批次独立文件 + 独立音频目录，不覆盖上一批
  7. 读数一律 ndjson，不用 --limit 200（表 >200 行会读不全）
  8. 拆解字段走 update 不新建，避免重复记录
  9. 飞书 text 里的 URL 读出来是 [url](url)，匹配前必须剥壳

用法：
    python home2table.py "https://www.douyin.com/user/MS4wLjABAAAA..." [--name 巧掌柜]
    python home2table.py MS4wLjABAAAA... --no-analysis     # 只采集不拆解
    python home2table.py <url> --dry-run                    # 只采集，不推飞书
"""

import argparse
import datetime
import json
import os
import re
import subprocess
import sys
import time

BASE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
AUDIO_ROOT = r"D:\douyin_audio"
DISTILL_BASE = "IjbBblKh0amzztsiExVc1PqInfd"
DISTILL_TABLE = "tbljaR1tbDTzyl0s"

sys.stdout.reconfigure(encoding="utf-8")
T0 = time.time()


def log(msg=""):
    print(f"[{time.time() - T0:6.1f}s] {msg}", flush=True)


def run(cmd, desc, quiet=True):
    log(f"{desc} ...")
    r = subprocess.run(cmd, cwd=BASE, capture_output=True)
    out = (r.stdout or b"").decode("utf-8", "replace")
    err = (r.stderr or b"").decode("utf-8", "replace")
    if r.returncode != 0:
        log(f"  ✗ {desc} 失败（退出码 {r.returncode}）")
        tail = (out + err).strip().splitlines()[-6:]
        for line in tail:
            log("    " + line)
        return False, out + err
    if not quiet:
        for line in out.strip().splitlines()[-6:]:
            log("    " + line)
    return True, out


def sec_uid(url_or_id):
    m = re.search(r"/user/(MS4wLjABAAAA[\w\-]+)", url_or_id)
    return m.group(1) if m else url_or_id.strip()


def main():
    ap = argparse.ArgumentParser(description="抖音主页 → 两张飞书表 一条命令")
    ap.add_argument("url", help="主页 URL 或 sec_user_id")
    ap.add_argument("--name", help="批次名（默认用作者名）")
    ap.add_argument("--workers", type=int, default=4, help="转写并发（音频强制串行）")
    ap.add_argument("--no-analysis", action="store_true", help="不做拆解预填")
    ap.add_argument("--dry-run", action="store_true", help="只采集，不推飞书")
    args = ap.parse_args()

    sec = sec_uid(args.url)

    # ---- ⓪ 先备份上一批（必须在采集覆盖之前！）----
    prev_raw = os.path.join(BASE, "_home_raw.json")
    if os.path.exists(prev_raw):
        try:
            prev = json.load(open(prev_raw, encoding="utf-8"))
            prev_author = re.sub(r'[\\/:*?"<>|\s]+', "_",
                                 (prev[0].get("author_name") if prev else "") or "上一批")
        except Exception:
            prev_author = "上一批"
        for f in ("_home_raw.json", "素材_主页全量.txt"):
            src = os.path.join(BASE, f)
            if not os.path.exists(src):
                continue
            dst = os.path.join(BASE, f"_{prev_author}_备份_{f.lstrip('_')}")
            if not os.path.exists(dst):
                subprocess.run(["cp", src, dst], cwd=BASE)
                log(f"⓪ 已备份上一批：{os.path.basename(dst)}")

    # ---- ① 采集：走浏览器里真实的 aweme/post 接口 ----
    log("① 采集主页作品（接口版，滚真实容器）")
    ok, out = run([PY, "_home_api.py", sec], "  抓接口", quiet=False)
    if not ok:
        raise SystemExit("采集失败")

    raw = json.load(open(os.path.join(BASE, "_home_raw.json"), encoding="utf-8"))
    if not raw:
        raise SystemExit("没采到作品")
    author = raw[0].get("author_name") or "未知作者"
    name = args.name or re.sub(r'[\\/:*?"<>|\s]+', "_", author)
    log(f"  作者「{author}」共 {len(raw)} 条，总时长 "
        f"{sum((r.get('duration') or 0) / 1000 for r in raw) / 60:.1f} 分钟")

    # ---- ② 造 cache（跳过 fill_stats）----
    log("② 造 cache（用接口自带互动数据，跳过逐条开浏览器）")
    links = os.path.join(BASE, f"素材_{name}_{len(raw)}条.txt")
    open(links, "w", encoding="utf-8").write(
        "\n".join(r["share_url"] or f"https://www.douyin.com/video/{r['aweme_id']}"
                  for r in raw) + "\n")
    cache = os.path.join(BASE, f"cache_素材_{name}_{len(raw)}条.json")
    items = []
    for r in raw:
        ct = r.get("create_time") or 0
        items.append({
            "aweme_id": str(r["aweme_id"]), "author_name": r.get("author_name", ""),
            "title": r.get("title", ""), "url": r["share_url"],
            "digg_count": r.get("digg") or 0, "comment_count": r.get("comment") or 0,
            "collect_count": r.get("collect") or 0, "share_count": r.get("share") or 0,
            "create_time": ct,
            "publish_time": datetime.datetime.fromtimestamp(ct).strftime("%Y-%m-%d %H:%M"),
            "content": "", "source_url": r["share_url"],
            # 接口 duration 是毫秒，必须 /1000
            "duration_sec": round((r.get("duration") or 0) / 1000.0, 1),
        })
    json.dump(items, open(cache, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    log(f"  {os.path.basename(cache)}  {len(items)} 条")

    if args.dry_run:
        log("--dry-run，到此为止")
        return

    # ---- ③ 音频 + 转写 ----
    adir = os.path.join(AUDIO_ROOT, f"素材_{name}_{len(raw)}条")
    log("③ 提音频（官方脚本，强制串行）")
    ok, out = run([PY, "audio_step.py", "--cache", cache, "--out", adir], "  提取+质检")
    for line in out.strip().splitlines()[-3:]:
        log("    " + line)
    if not ok:
        raise SystemExit("音频环节失败")

    manifest = os.path.join(adir, "audio_manifest.json")
    asr = os.path.join(adir, "asr_result.json")
    log("④ 阿里云转写（可并发）")
    ok, out = run([PY, "asr_batch.py", "--audio", manifest, "--out", asr,
                   "--workers", str(args.workers)], "  转写")
    for line in out.strip().splitlines()[-3:]:
        log("    " + line)
    if not ok:
        raise SystemExit("转写失败")

    # ---- ⑤ 预填拆解字段 ----
    analysis = os.path.join(BASE, f"analysis_{name}_{len(raw)}条.json")
    ana_arg = []
    if not args.no_analysis and os.path.exists(asr):
        log("⑤ 预填话题/黄金开头/行业类型")
        run([PY, "auto_fill.py", "--data", cache, "--asr", asr, "-o", analysis], "  预填")
        d = json.load(open(analysis, encoding="utf-8"))
        for v in d.values():
            v.setdefault("行业类型", "同行业")   # 基准账号是 AI/电商 → 同行业
        json.dump(d, open(analysis, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        ana_arg = ["--analysis", analysis]

    # ---- ⑥ 两张表都推 ----
    log("⑥ 推飞书（两张表）")
    common = ["--data", cache, "--audio", manifest, "--asr", asr]
    ok1, _ = run([PY, "push_to_feishu.py", "--preset", "collect"] + common, "  采集汇总表")
    ok2, _ = run([PY, "push_to_feishu.py", "--preset", "distill"] + common + ana_arg,
                 "  内容蒸馏库")

    log("=" * 56)
    log(f"完成：{author} {len(raw)} 条   耗时 {time.time() - T0:.0f}s")
    log(f"  采集汇总表 {'✓' if ok1 else '✗'}   内容蒸馏库 {'✓' if ok2 else '✗'}")
    log(f"  文案: {asr}")
    log(f"  拆解草稿: {analysis if ana_arg else '（未生成）'}")


if __name__ == "__main__":
    main()
