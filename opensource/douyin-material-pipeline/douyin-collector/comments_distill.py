# -*- coding: utf-8 -*-
"""评论 AI 蒸馏：有效评论 → 评论类型 + 核心需求/痛点 + 可延伸选题 + 选题价值。

走阿里云百炼（DashScope）OpenAI 兼容接口，key 在 .env 的 DASHSCOPE_API_KEY。
批量：一次送 BATCH 条，让模型返回 JSON —— 比一条一请求省 10 倍以上的开销。
断点续跑：已蒸馏过的 cid 跳过，中途崩了重跑不会重复花钱。

用法：
    python comments_distill.py --limit 24            # 小规模试质量
    python comments_distill.py --workers 8           # 全量
"""

import argparse
import concurrent.futures as cf
import json
import os
import re
import sys
import time

import requests

BASE = os.path.dirname(os.path.abspath(__file__))
sys.stdout.reconfigure(encoding="utf-8")

API = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
KEPT_PATH = os.path.join(BASE, "comments_kept.ndjson")
OUT_PATH = os.path.join(BASE, "comments_distilled.ndjson")
BATCH = 12
MAXLEN = 400  # 单条评论送模型前截断，超长评论多半是复制粘贴

TYPES = ["问题", "痛点", "需求", "争议", "反对观点",
         "经验分享", "案例", "情绪反馈", "其他"]

SYSTEM = """你是短视频选题分析师。用户会给你一批抖音视频评论，你要把每条评论蒸馏成可用的选题素材。

对每条评论判断：

1. 类型（只能选一个）：问题 / 痛点 / 需求 / 争议 / 反对观点 / 经验分享 / 案例 / 情绪反馈 / 其他
2. 核心需求/痛点：一句话说清这条评论背后用户真正在意什么。要概括，不要复述原评论。15~35 字。
3. 可延伸选题：能直接拍成短视频的选题，1~2 个，用「 / 」分隔。要具体到能当标题用，不要写"讲讲XX"这种空话。
4. 选题价值：高 / 中 / 低
   - 高：**真实疑问**、**明确痛点**、**具体经验或案例**、**有价值的反对或争议**；
         且能延伸出具体选题，并且不是原视频已经讲过的内容
   - 中：有信息量，但选题指向不明确，或同类内容已经泛滥
   - 低：纯情绪、纯夸奖、接梗调侃、社交意愿（求带/带我/加我一个/怎么联系）、
         与视频主题无关、无法延伸成选题

注意：
- 评论里可能有错别字、语音转写错字、表情符号，按上下文理解真实意思。
- **陈述句、反问接梗、调侃都不算「问题」**。只有真的在问、且答案对他有用，才算问题。
  例："产品化，首先要有一个产品" 是调侃接梗，不是问题，价值低。
- 只是表达社交意愿的（"带我一起搞""加我一个""求带""想合作"）价值判低 ——
  它反映不了内容需求，延伸不出选题。
- 和视频主题完全无关的（闲聊、广告、跨领域刷屏），类型判「其他」，价值判「低」。
- 不要因为评论点赞高就判高价值，看内容本身。
- 价值判「低」的，核心需求/痛点 和 可延伸选题 留空字符串即可，不要硬编。

只输出 JSON，不要任何解释文字，格式：
{"results":[{"i":0,"类型":"问题","核心需求/痛点":"...","可延伸选题":"...","选题价值":"高"}]}"""


def load_key():
    p = os.path.join(BASE, ".env")
    if os.path.exists(p):
        for l in open(p, encoding="utf-8"):
            if l.strip().startswith("DASHSCOPE_API_KEY"):
                return l.split("=", 1)[1].strip().strip('"').strip("'")
    return os.environ.get("DASHSCOPE_API_KEY", "")


def parse_json(txt):
    """模型有时会用 ```json 包起来，兜一下。"""
    t = (txt or "").strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", t, re.S)
    if m:
        t = m.group(1).strip()
    try:
        return json.loads(t)
    except Exception:
        m = re.search(r"\{.*\}", t, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                return None
    return None


def distill_batch(items, key, model, retries=4, verbose=False):
    """items: [{"i":0,"评论":"..."}]  → {i: {类型,核心需求/痛点,可延伸选题,选题价值}}"""
    user = "评论列表（JSON）：\n" + json.dumps(
        [{"i": it["i"], "评论": it["评论"][:MAXLEN]} for it in items],
        ensure_ascii=False)
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM},
                     {"role": "user", "content": user}],
        "response_format": {"type": "json_object"},
        "temperature": 0.3,
    }
    for att in range(retries):
        try:
            r = requests.post(API, headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json"},
                json=payload, timeout=180)
            if r.status_code == 200:
                d = r.json()
                txt = d["choices"][0]["message"]["content"]
                obj = parse_json(txt)
                if not obj:
                    raise ValueError("返回不是 JSON: " + txt[:150])
                out = {}
                for x in (obj.get("results") or []):
                    try:
                        i = int(x.get("i"))
                    except Exception:
                        continue
                    ty = str(x.get("类型") or "").strip()
                    if ty not in TYPES:
                        ty = "其他"
                    v = str(x.get("选题价值") or "").strip()
                    if v not in ("高", "中", "低"):
                        v = "低"
                    out[i] = {
                        "评论类型": ty,
                        "核心需求/痛点": str(x.get("核心需求/痛点") or "").strip(),
                        "可延伸选题": str(x.get("可延伸选题") or "").strip(),
                        "选题价值": v,
                    }
                if out:
                    return out
                raise ValueError("results 为空")
            # 限流 / 服务端错误 → 退避重试
            if verbose:
                print(f"    HTTP {r.status_code}: {r.text[:120]}")
            time.sleep(1.5 * (att + 1))
        except Exception as e:
            if verbose:
                print(f"    第{att+1}次失败 {type(e).__name__}: {str(e)[:100]}")
            time.sleep(1.5 * (att + 1))
    return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kept", default=KEPT_PATH)
    ap.add_argument("--out", default=OUT_PATH)
    ap.add_argument("--model", default="qwen-turbo")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--batch", type=int, default=BATCH)
    ap.add_argument("--limit", type=int, default=0, help="只蒸馏前 N 条（试质量）")
    ap.add_argument("--resume", action="store_true", default=True)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    key = load_key()
    if not key:
        raise SystemExit("没有 DASHSCOPE_API_KEY")

    rows = [json.loads(l) for l in open(args.kept, encoding="utf-8") if l.strip()]
    print(f"有效评论 {len(rows)} 条")

    done = set()
    if args.resume and os.path.exists(args.out):
        for l in open(args.out, encoding="utf-8"):
            if l.strip():
                try:
                    done.add(json.loads(l)["cid"])
                except Exception:
                    pass
        if done:
            rows = [r for r in rows if r.get("cid") not in done]
            print(f"续跑：跳过已蒸馏 {len(done)} 条，剩 {len(rows)} 条")

    if args.limit:
        rows = rows[:args.limit]
    if not rows:
        print("没有要蒸馏的，退出")
        return

    batches = []
    for i in range(0, len(rows), args.batch):
        chunk = rows[i:i + args.batch]
        batches.append([{"i": j, "评论": c["评论"]} for j, c in enumerate(chunk)])
    print(f"分 {len(batches)} 批（每批 {args.batch} 条），并发 {args.workers}，模型 {args.model}")

    t0 = time.time()
    fout = open(args.out, "a", encoding="utf-8")
    n_ok = n_fail = n_row = 0

    def work(bi):
        return bi, distill_batch(batches[bi], key, args.model, verbose=args.verbose)

    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(work, bi): bi for bi in range(len(batches))}
        for k, fut in enumerate(cf.as_completed(futs), 1):
            bi, res = fut.result()
            chunk = rows[bi * args.batch: bi * args.batch + args.batch]
            if not res:
                n_fail += len(chunk)
                print(f"  [{k}/{len(batches)}] 批{bi} 失败（{len(chunk)} 条）")
                continue
            for j, c in enumerate(chunk):
                m = res.get(j)
                if not m:
                    n_fail += 1
                    continue
                rec = dict(c)
                rec.update(m)
                fout.write(json.dumps(rec, ensure_ascii=False) + "\n")
                n_row += 1
            fout.flush()
            n_ok += 1
            el = time.time() - t0
            print(f"  [{k}/{len(batches)}] 批{bi} ok（{len(chunk)} 条）"
                  f" 累计 {n_row} 条 / {el:.0f}s")
    fout.close()

    el = round(time.time() - t0, 1)
    print(f"\n完成 {el}s | 成功批次 {n_ok}/{len(batches)} | 蒸馏 {n_row} 条 | 失败 {n_fail} 条")
    print(f"→ {args.out}")
    if n_fail:
        print("失败的批重跑一次即可（--resume 会自动跳过已完成的）")


if __name__ == "__main__":
    main()
