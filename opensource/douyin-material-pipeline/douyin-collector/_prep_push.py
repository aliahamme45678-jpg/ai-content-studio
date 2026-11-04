"""推送前整理：把采集 json 整理成 push_to_feishu.py 要吃的两个输入。
1. 给每条记录补 source_url（= 短链 url），让飞书「来源链接」有值、去重按短链。
2. 把 content 文案打包成 --asr 文件（{"items":[{aweme_id, source_url, text, char_count, status}]}）。
"""
import json, os, sys, argparse
sys.stdout.reconfigure(encoding="utf-8")
BASE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SRC = os.path.join(BASE, "douyin_filtered.json")
DEFAULT_ASR = os.path.join(BASE, "_asr_result.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data", nargs="?", default=DEFAULT_SRC, help="采集结果 json")
    ap.add_argument("--asr", default=DEFAULT_ASR, help="asr 输出文件")
    args = ap.parse_args()
    SRC = args.data
    ASR = args.asr
    recs = json.load(open(SRC, encoding="utf-8"))
    items, n_text = [], 0
    for r in recs:
        url = r.get("url") or r.get("source_url") or ""
        # 让「来源链接」存短链（飞书匹配按短链，不按 aweme_id）
        r["source_url"] = url
        txt = (r.get("content") or "").strip()
        if txt:
            n_text += 1
        items.append({
            "aweme_id": str(r.get("aweme_id") or ""),
            "source_url": url,
            "text": txt,
            "char_count": len(txt),
            "status": "ok" if txt else "empty",
        })
    json.dump(recs, open(SRC, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    json.dump({"items": items}, open(ASR, "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print(f"整理 {len(recs)} 条，其中带文案 {n_text} 条")
    print(f"已写回 {SRC}（补 source_url）")
    print(f"已生成 {ASR}（asr 输入）")


if __name__ == "__main__":
    main()
