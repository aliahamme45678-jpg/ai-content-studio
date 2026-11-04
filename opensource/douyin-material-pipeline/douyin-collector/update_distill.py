r"""
把 analysis 里的拆解字段**更新**到飞书已有记录上（不是新建，避免重复记录）。

坑（都踩过）：
  1. 依赖 ndjson 快照 → 推完新数据必须先重新拉，否则匹配不到新 record_id，
     表现为「待更新 0 条」。
  2. 飞书 text 字段读出来 URL 是 [url](url)，匹配前必须剥壳。
  3. `+record-batch-update` 参数是 `--json`（不是 --data），大 JSON 要用 `@文件`，
     直接塞命令行会被 cmd 解析炸掉。
  4. select 字段（行业类型）必须传数组。

用法：
    python update_distill.py --analysis analysis_主页2_15条.json
    python update_distill.py --analysis xxx.json --all    # 连没拆的一起更新（一般不用）
"""

import argparse
import json
import os
import re
import subprocess
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
BASE_TOKEN = "IjbBblKh0amzztsiExVc1PqInfd"
TABLE_ID = "tbljaR1tbDTzyl0s"
FIELDS = ["标题", "行业类型", "选题切口", "核心观点", "可复用机制", "话题", "黄金开头",
          # 2026-09-22 补：原来只回填 7 个字段，另外 4 个拆解维度一直被漏掉
          "Hook机制", "内容结构", "论证方式", "表达方式",
          # 2026-10-14 补：爆款类型也是 select，跟行业类型一样要传数组
          "爆款类型"]
# select 字段必须传数组（否则飞书报类型错误）
SELECT_FIELDS = ("行业类型", "爆款类型")

sys.stdout.reconfigure(encoding="utf-8")


def norm(u):
    """URL 归一化：剥掉飞书 text 的 [url](url) 壳。

    返回 video/note id 或**去掉 query 的短链**（蒸馏库里 来源链接 存的是
    `v.douyin.com/xxx` 短链，没有 /video/<id>，所以走短链分支）。
    """
    u = str(u or "")
    if u.startswith("[") and "](" in u:
        u = u[u.index("](") + 2:].rstrip(")")
    m = re.search(r"/(?:video|note)/(\d+)", u)
    return m.group(1) if m else u.split("?")[0].rstrip("/")


def pull(table_id, out):
    """拉**全量**记录 —— `--limit 200` 是硬上限，必须按 offset 翻页。

    2026-09-22 踩过：只拉第一页时新插入的记录全在最后一页，
    表现为「待更新 0 条」，看着像匹配失败其实是快照不全。

    2026-10-14 踩过两连坑（导致「待更新 0 条」的真凶）：
      ① **lark-cli 的 `--output` 默认不覆盖**：它还会写一个同名
         `<file>.manifest.json` 伴随文件，只要 manifest 已存在就直接报
         `output file already exists` 并退出（rc=2），ndjson 也不生成 ——
         而旧代码没查 returncode，于是静默读到几天前的旧快照、新记录全匹配不到。
         → 取数前先删 part + manifest，并加 `--overwrite` 双保险。
      ② `--output` 只认**相对路径**，传绝对路径也会失败 → 固定用相对文件名。
    """
    rows, offset = [], 0
    name = os.path.basename(out)
    while True:
        part = name if offset == 0 else name.replace(".ndjson", f"_{offset}.ndjson")
        for f in (part, part.replace(".ndjson", ".manifest.json")):  # 不删就永远读旧文件
            if os.path.exists(f):
                os.remove(f)
        r = subprocess.run(["lark-cli.cmd", "base", "+record-list", "--base-token", BASE_TOKEN,
                            "--table-id", table_id, "--format", "ndjson", "--output", part,
                            "--limit", "200", "--offset", str(offset), "--overwrite",
                            "--as", "user"], cwd=BASE, capture_output=True)
        if not os.path.exists(part):
            raise SystemExit(f"拉取失败 rc={r.returncode}: "
                             + (r.stderr or b"").decode("utf-8", "replace")[:300])
        got = [json.loads(l) for l in open(part, encoding="utf-8") if l.strip()]
        rows += got
        if len(got) < 200:
            break
        offset += 200
        if offset > 5000:
            break
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--analysis", required=True)
    ap.add_argument("--all", action="store_true", help="连没拆的也更新（默认只更新有核心观点的）")
    args = ap.parse_args()

    apath = args.analysis if os.path.isabs(args.analysis) \
        else os.path.join(BASE, args.analysis)
    ana = json.load(open(apath, encoding="utf-8"))

    # 每次都重新拉，避免用过期快照
    nd = os.path.join(BASE, "_distill_snapshot.ndjson")
    rows = pull(TABLE_ID, nd)
    rec = {norm(r.get("来源链接")): r["record_id"] for r in rows if r.get("来源链接")}
    print(f"飞书快照 {len(rows)} 行 / 可匹配 {len(rec)} 个链接")

    updates, miss = {}, 0
    for url, v in ana.items():
        if not args.all and not v.get("核心观点"):
            continue
        rid = rec.get(norm(url))
        if not rid:
            miss += 1
            continue
        f = {k: v[k] for k in FIELDS if v.get(k)}
        for sf in SELECT_FIELDS:      # select 字段必须传数组
            if sf in f:
                f[sf] = [f[sf]]
        updates[rid] = f

    print(f"待更新 {len(updates)} 条" + (f"（{miss} 条在飞书里找不到）" if miss else ""))
    if not updates:
        return

    payload = {"update_records": updates}
    p = os.path.join(BASE, "_upd_payload.json")
    json.dump(payload, open(p, "w", encoding="utf-8"), ensure_ascii=False)

    r = subprocess.run(["lark-cli.cmd", "base", "+record-batch-update",
                        "--base-token", BASE_TOKEN, "--table-id", TABLE_ID,
                        "--json", "@" + p], cwd=BASE, capture_output=True)
    out = (r.stdout or b"").decode("utf-8", "replace")
    print("ok" if '"ok": true' in out else out[:400])


if __name__ == "__main__":
    main()
