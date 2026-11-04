# -*- coding: utf-8 -*-
"""把采集到的抖音素材推进已有的飞书多维表格（内容蒸馏库）。

只写表里已有的表头，字段名对不上的一律丢掉（不新建字段、不硬塞）。
数值型比率（藏赞比/评赞比/转赞比）表里是百分比样式，存小数（0.596 = 59.6%）。

用法：
    python push_to_feishu.py --data cache_素材_AI赚钱_4条.json ^
        --audio "D:\douyin_audio\素材_AI赚钱_4条\audio_manifest.json" ^
        --asr   "D:\douyin_audio\素材_AI赚钱_4条\asr_result.json" ^
        --analysis analysis_素材_AI赚钱_4条.json ^
        --base-token IjbBblKh0amzztsiExVc1PqInfd --table-id tbljaR1tbDTzyl0s
"""

import argparse
import json
import os
import subprocess
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# 两个落地目标
#   distill = 内容蒸馏库（25 字段，含 8 个文案分析维度，需要人工/模型分析后填）
#   collect = 新建文本文档(3)_数据汇总（9 字段，纯采集结果，日常默认）
PRESETS = {
    "distill": {
        "base": "IjbBblKh0amzztsiExVc1PqInfd",
        "table": "tbljaR1tbDTzyl0s",
        "url": "https://hcngrs2jw5fb.feishu.cn/base/IjbBblKh0amzztsiExVc1PqInfd",
    },
    "collect": {
        "base": "WTBVbWH98a4KNgskZ6BcXjgUnCe",
        "table": "tbl65u3jTdpZ4zDw",
        "url": "https://hcngrs2jw5fb.feishu.cn/base/WTBVbWH98a4KNgskZ6BcXjgUnCe",
        # 采集表的字段名和内部字段名不一样，这里做映射
        "map": {
            "作者": "作者名称", "标题": "视频标题", "来源链接": "视频链接",
            "原文 / 文案": "提取文案", "发布时间": "发布时间",
        },
    },
}
DEFAULT_BASE = PRESETS["distill"]["base"]
DEFAULT_TABLE = PRESETS["distill"]["table"]

# 表里没有的字段（音频路径、音频时长秒等）一律不写
ANALYSIS_FIELDS = ["标题", "话题", "行业类型", "选题切口", "黄金开头", "Hook机制",
                   "内容结构", "核心观点", "论证方式", "表达方式", "可复用机制"]


CLI = "lark-cli.cmd" if os.name == "nt" else "lark-cli"


def run(cmd, check=True):
    cmd = [CLI if c == "lark-cli" else c for c in cmd]
    r = subprocess.run(cmd, cwd=BASE_DIR, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0 and check:
        print("CMD:", " ".join(cmd))
        print("STDOUT:", r.stdout)
        print("STDERR:", r.stderr)
        raise SystemExit(f"命令失败 rc={r.returncode}")
    return r.stdout


def load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def fmt_dur(sec):
    sec = int(round(sec or 0))
    return f"{sec // 60}分{sec % 60}秒"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--audio")
    ap.add_argument("--asr")
    ap.add_argument("--analysis")
    ap.add_argument("--preset", choices=list(PRESETS), default="distill",
                    help="distill=内容蒸馏库(含分析) / collect=采集结果汇总表")
    ap.add_argument("--base-token")
    ap.add_argument("--table-id")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    p = PRESETS[args.preset]
    args.base_token = args.base_token or p["base"]
    args.table_id = args.table_id or p["table"]
    fmap = p.get("map", {})
    print(f"目标: {args.preset}  {p['url']}")

    data = load(args.data)

    def index2(items):
        """按 source_url + aweme_id 双索引；同一 key 有多条时优先保留 status=ok 的。

        同一个视频可能有多条短链，转写结果里它们的 source_url 会被写成同一个，
        而 failed 的那条会覆盖 ok 的那条 —— 这里必须按 ok 优先。
        """
        bu, bi = {}, {}
        for i in items:
            ok = i.get("status") == "ok"
            u = i.get("source_url")
            if u and (ok or u not in bu):
                bu[u] = i
            aid = str(i.get("aweme_id") or "")
            if aid and (ok or aid not in bi):
                bi[aid] = i
        return bu, bi

    a_u, a_i = index2(load(args.audio)["items"]) if args.audio else ({}, {})
    t_u, t_i = index2(load(args.asr)["items"]) if args.asr else ({}, {})
    ana = load(args.analysis) if args.analysis else {}

    # 同一视频的多条短链只留一条，避免表里出现重复行
    seen, uniq = set(), []
    for r in data:
        k = str(r.get("aweme_id") or r.get("source_url") or id(r))
        if k in seen:
            continue
        seen.add(k)
        uniq.append(r)
    if len(uniq) != len(data):
        print(f"去重：{len(data)} 条链接 -> {len(uniq)} 个视频")
    data = uniq

    # 读表头，只保留表里真实存在的字段
    out = run(["lark-cli", "base", "+field-list", "--base-token", args.base_token,
               "--table-id", args.table_id, "--as", "user"])
    fd = json.loads(out)
    fields = (fd.get("data") or {}).get("fields") or []
    header = [f.get("name") for f in fields]
    select_opts = {f.get("name"): [o.get("name") for o in (f.get("options") or [])]
                   for f in fields if f.get("type") == "select"}
    print(f"表头 {len(header)} 个字段")

    records, skipped = [], {}
    for r in data:
        u = r.get("source_url") or ""
        dg = r.get("digg_count") or 0
        co = r.get("collect_count") or 0
        cm = r.get("comment_count") or 0
        sh = r.get("share_count") or 0
        aid = str(r.get("aweme_id") or "")
        a = a_u.get(u) or a_i.get(aid) or {}
        t = t_u.get(u) or t_i.get(aid) or {}
        n = ana.get(u) or ana.get(aid) or {}

        # ---- 低粉爆款三件套（2026-09-22 新增）----
        # 判定口径（用户拍板，不可自行改）：
        #   点赞粉丝比 = 点赞 / 作者粉丝数      >=3 且 互动密度 >=0.08 → 低粉爆款
        #   互动密度   = (评论+收藏+转发)/点赞
        # 结果写进表里已有的「爆款类型」select（选项：正常爆款/低粉爆款/起号爆款），
        # 不再新建「是否低粉爆款」字段（2026-09-22 已删）。
        fo = r.get("follower_count") or 0
        ratio = round(dg / fo, 2) if fo else None
        inter = round((cm + co + sh) / dg, 3) if dg else None
        low_label = None
        if fo and dg and ratio >= 3 and inter >= 0.08:
            low_label = "低粉爆款"
        # 时长：优先用音频实测；没有音频就用接口返回的 duration_ms
        dur_sec = a.get("duration_sec") or (r.get("duration_ms") or 0) / 1000 or 0

        rec = {
            "作者": r.get("author_name") or "",
            "标题": n.get("标题") or r.get("title") or "",
            "话题": n.get("话题") or r.get("topic") or "",
            "点赞数": dg, "评论数": cm, "收藏数": co, "转发数": sh,
            "藏赞比": round(co / dg, 3) if dg else None,
            "评赞比": round(cm / dg, 3) if dg else None,
            "转赞比": round(sh / dg, 3) if dg else None,
            "字数": t.get("char_count") or 0,
            "时长": fmt_dur(dur_sec) if dur_sec else "",
            "来源链接": u,
            "原文 / 文案": t.get("text") or "",
            "平台": ["抖音"],
            "发布时间": r.get("publish_time") or "",
            "作者粉丝数": fo or None,
            "点赞粉丝比": ratio,
            "互动密度": inter,
        }
        if low_label:
            rec["爆款类型"] = low_label
        for k in ANALYSIS_FIELDS:
            if n.get(k):
                rec[k] = n[k]

        # 过滤：先按目标表改名，再只留表头里有的字段；单选值必须是已有选项
        clean, drop = {}, []
        for k, v in rec.items():
            k = fmap.get(k, k)
            if k not in header:
                drop.append(k)
                continue
            if k in select_opts:
                vals = v if isinstance(v, list) else [v]
                vals = [x for x in vals if x in select_opts[k]]
                if not vals:
                    drop.append(k + "(选项不存在)")
                    continue
                v = vals
            clean[k] = v
        for k in drop:
            skipped[k] = skipped.get(k, 0) + 1
        records.append(clean)

    print(f"组装 {len(records)} 条")
    if skipped:
        print("被丢弃的字段（表里没有 / 选项不匹配）:", skipped)

    # 注意：create_records 里直接放字段 map，不要套 {"fields": ...}
    payload = {"create_records": records}
    pfile = "_feishu_records.json"
    with open(os.path.join(BASE_DIR, pfile), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    if args.dry_run:
        print("\n[dry-run] 预览第一条：")
        print(json.dumps(records[0], ensure_ascii=False, indent=2)[:1500])
        return

    out = run(["lark-cli", "base", "+record-batch-create",
               "--base-token", args.base_token, "--table-id", args.table_id,
               "--json", "@" + pfile, "--as", "user"])
    try:
        d = json.loads(out)
        print("ok:", d.get("ok"))
        print(json.dumps(d.get("data"), ensure_ascii=False)[:800])
    except Exception:
        print(out[:1500])
    print(f"\n表格: https://hcngrs2jw5fb.feishu.cn/base/{args.base_token}")


if __name__ == "__main__":
    main()
