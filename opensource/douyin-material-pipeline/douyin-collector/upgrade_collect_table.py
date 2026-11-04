# -*- coding: utf-8 -*-
"""给采集汇总表加列 + 填满 + 加视图。幂等：已有字段会跳过。"""

import json
import os
import re
import subprocess

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BASE = "WTBVbWH98a4KNgskZ6BcXjgUnCe"
TABLE = "tbl65u3jTdpZ4zDw"
CLI = "lark-cli.cmd" if os.name == "nt" else "lark-cli"

PCT = {"type": "plain", "percentage": True, "precision": 2, "thousands_separator": False}
NEW_FIELDS = [
    {"type": "number", "name": "藏赞比", "style": dict(PCT)},
    {"type": "number", "name": "评赞比", "style": dict(PCT)},
    {"type": "number", "name": "转赞比", "style": dict(PCT)},
    {"type": "number", "name": "字数", "style": {"type": "plain", "percentage": False,
                                                "precision": 0, "thousands_separator": False}},
    {"type": "text", "name": "时长"},
]

AUDIO_MANIFESTS = [
    r"D:\douyin_audio\audio_manifest.json",
    r"D:\douyin_audio\素材_AI赚钱_4条\audio_manifest.json",
    r"D:\douyin_audio\素材_AI应用_9条\audio_manifest.json",
]


def run(cmd, check=True):
    cmd = [CLI if c == "lark-cli" else c for c in cmd]
    r = subprocess.run(cmd, cwd=BASE_DIR, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print("  ! 失败:", " ".join(cmd[:4]), "->", (r.stdout or r.stderr)[:300])
        if check:
            return None
    return r.stdout


def jout(s):
    try:
        return json.loads(s)
    except Exception:
        return {}


def fmt_dur(sec):
    sec = int(round(sec or 0))
    return f"{sec // 60}分{sec % 60}秒"


def main():
    # ① 建字段
    out = run(["lark-cli", "base", "+field-list", "--base-token", BASE,
               "--table-id", TABLE, "--as", "user"])
    header = [f.get("name") for f in (jout(out).get("data") or {}).get("fields") or []]
    print("现有字段:", header)

    todo = [f for f in NEW_FIELDS if f["name"] not in header]
    if todo:
        pf = "_new_fields.json"
        with open(os.path.join(BASE_DIR, pf), "w", encoding="utf-8") as f:
            json.dump(todo, f, ensure_ascii=False)
        res = run(["lark-cli", "base", "+field-create", "--base-token", BASE,
                   "--table-id", TABLE, "--json", "@" + pf, "--as", "user"], check=False)
        if res is None:
            print("  样式字段被拒，改用无样式重试")
            for f in todo:
                f.pop("style", None)
            with open(os.path.join(BASE_DIR, pf), "w", encoding="utf-8") as fh:
                json.dump(todo, fh, ensure_ascii=False)
            run(["lark-cli", "base", "+field-create", "--base-token", BASE,
                 "--table-id", TABLE, "--json", "@" + pf, "--as", "user"], check=False)
        print(f"新增字段: {[f['name'] for f in todo]}")
    else:
        print("字段已存在，跳过")

    # ② 拉数据算值
    out = run(["lark-cli", "base", "+record-list", "--base-token", BASE,
               "--table-id", TABLE, "--limit", "200", "--format", "json", "--as", "user"])
    dd = jout(out)["data"]
    names = dd["fields"]
    ix = {n: i for i, n in enumerate(names)}
    rows, ids = dd["data"], dd["record_id_list"]
    print(f"行数 {len(rows)}")

    dur, dur_by_url = {}, {}
    for p in AUDIO_MANIFESTS:
        if not os.path.exists(p):
            continue
        try:
            for it in json.load(open(p, encoding="utf-8"))["items"]:
                aid = str(it.get("aweme_id") or "")
                if aid:
                    dur[aid] = it.get("duration_sec")
                if it.get("source_url"):
                    dur_by_url[it["source_url"].rstrip("/")] = it.get("duration_sec")
        except Exception:
            pass

    updates = {}
    for rid, r in zip(ids, rows):
        dg = r[ix["点赞数"]] or 0
        co = r[ix["收藏数"]] or 0
        cm = r[ix["评论数"]] or 0
        sh = r[ix["转发数"]] or 0
        wen = str(r[ix["提取文案"]] or "")
        f = {
            "藏赞比": round(co / dg, 4) if dg else None,
            "评赞比": round(cm / dg, 4) if dg else None,
            "转赞比": round(sh / dg, 4) if dg else None,
            "字数": len(wen),
        }
        link = str(r[ix["视频链接"]] or "")
        sec = dur_by_url.get(link.rstrip("/"))
        if sec is None:
            m = re.search(r"/(?:video|slides|note)/(\d+)", link)
            if m:
                sec = dur.get(m.group(1))
        if sec:
            f["时长"] = fmt_dur(sec)
        updates[rid] = f

    pf = "_fill_collect.json"
    with open(os.path.join(BASE_DIR, pf), "w", encoding="utf-8") as fh:
        json.dump({"update_records": updates}, fh, ensure_ascii=False)
    res = run(["lark-cli", "base", "+record-batch-update", "--base-token", BASE,
               "--table-id", TABLE, "--json", "@" + pf, "--as", "user"], check=False)
    print("填值 ok:", jout(res or "{}").get("ok"))
    print("  有时长的行:", sum(1 for v in updates.values() if "时长" in v), "/", len(updates))

    # ③ 建视图
    out = run(["lark-cli", "base", "+view-list", "--base-token", BASE,
               "--table-id", TABLE, "--as", "user"])
    have = {v.get("name") for v in (jout(out).get("data") or {}).get("views") or []}
    plans = [
        ("点赞榜", {"sort_config": [{"field": "点赞数", "desc": True}]}, None),
        ("藏赞比榜", {"sort_config": [{"field": "藏赞比", "desc": True}]}, None),
        ("按作者", None, {"group_config": [{"field": "作者名称", "desc": False}]}),
    ]
    for name, sort, group in plans:
        if name in have:
            print(f"视图已存在: {name}")
            continue
        run(["lark-cli", "base", "+view-create", "--base-token", BASE, "--table-id", TABLE,
             "--json", json.dumps({"name": name, "type": "grid"}, ensure_ascii=False),
             "--as", "user"], check=False)
        if sort:
            run(["lark-cli", "base", "+view-set-sort", "--base-token", BASE,
                 "--table-id", TABLE, "--view-id", name,
                 "--json", json.dumps(sort, ensure_ascii=False), "--as", "user"], check=False)
        if group:
            run(["lark-cli", "base", "+view-set-group", "--base-token", BASE,
                 "--table-id", TABLE, "--view-id", name,
                 "--json", json.dumps(group, ensure_ascii=False), "--as", "user"], check=False)
        print(f"视图已建: {name}")

    print(f"\n表格: https://hcngrs2jw5fb.feishu.cn/base/{BASE}")


if __name__ == "__main__":
    main()
