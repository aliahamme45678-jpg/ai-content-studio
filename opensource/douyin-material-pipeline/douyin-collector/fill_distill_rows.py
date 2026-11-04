# -*- coding: utf-8 -*-
"""往内容蒸馏库回填指定行的分析字段 / 行业类型 / 时长。

用法：
    python fill_distill_rows.py --analysis analysis_164_174.json \
        --rows 164-174 --audio D:\douyin_audio\audio_manifest.json
    python fill_distill_rows.py --industry 同行业 --rows 175-187
"""

import argparse
import json
import os
import re
import subprocess

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BASE = "IjbBblKh0amzztsiExVc1PqInfd"
TABLE = "tbljaR1tbDTzyl0s"
CLI = "lark-cli.cmd" if os.name == "nt" else "lark-cli"


def run(cmd):
    cmd = [CLI if c == "lark-cli" else c for c in cmd]
    r = subprocess.run(cmd, cwd=BASE_DIR, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print("CMD:", " ".join(cmd))
        print(r.stdout, r.stderr)
        raise SystemExit(f"失败 rc={r.returncode}")
    return r.stdout


def load(p):
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


def fmt_dur(sec):
    sec = int(round(sec or 0))
    return f"{sec // 60}分{sec % 60}秒"


def parse_rows(s):
    """'164-174' -> range(163,174)；'164,166' -> [163,165]"""
    out = []
    for part in s.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-")
            out.extend(range(int(a) - 1, int(b)))
        else:
            out.append(int(part) - 1)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--analysis", help="JSON: {record_id: {字段: 值}}")
    ap.add_argument("--rows", required=True, help="行号，如 164-174 或 164,166,170")
    ap.add_argument("--industry", help="强制把行业类型设成这个值（同行业/跨行业）")
    ap.add_argument("--audio", help="audio_manifest.json，按 aweme_id 匹配补时长")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    # 拉全表
    out = run(["lark-cli", "base", "+record-list", "--base-token", BASE,
               "--table-id", TABLE, "--limit", "200", "--format", "json", "--as", "user"])
    dd = json.loads(out)["data"]
    names = dd["fields"]
    idx = {n: i for i, n in enumerate(names)}
    rows, ids = dd["data"], dd["record_id_list"]
    print(f"表内 {len(rows)} 行")

    ana = load(args.analysis) if args.analysis else {}
    dur_by_id = {}
    if args.audio:
        try:
            for it in load(args.audio)["items"]:
                aid = str(it.get("aweme_id") or "")
                if aid:
                    dur_by_id[aid] = it.get("duration_sec")
        except Exception as e:
            print("（音频清单读取跳过:", e, "）")

    updates = {}
    for j in parse_rows(args.rows):
        if j >= len(rows):
            print(f"跳过越界行 {j+1}")
            continue
        rid = ids[j]
        cur = rows[j]
        fields = dict(ana.get(rid, {}))

        if args.industry:
            fields["行业类型"] = [args.industry]

        # 时长：从来源链接里抠 aweme_id 去匹配音频清单
        link = str(cur[idx["来源链接"]] or "")
        m = re.search(r"/(?:video|slides|note)/(\d+)", link)
        if m and m.group(1) in dur_by_id:
            fields["时长"] = fmt_dur(dur_by_id[m.group(1)])

        if fields:
            updates[rid] = fields
        print(f"行{j+1:>4} {rid} -> {list(fields.keys())}")

    if args.dry_run:
        print("\n[dry-run] 预览：")
        print(json.dumps(updates, ensure_ascii=False, indent=2)[:2000])
        return

    payload = {"update_records": updates}
    pf = "_update_rows.json"
    with open(os.path.join(BASE_DIR, pf), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    out = run(["lark-cli", "base", "+record-batch-update", "--base-token", BASE,
               "--table-id", TABLE, "--json", "@" + pf, "--as", "user"])
    try:
        print("ok:", json.loads(out).get("ok"))
    except Exception:
        print(out[:800])
    print(f"\n表格: https://hcngrs2jw5fb.feishu.cn/base/{BASE}")


if __name__ == "__main__":
    main()
