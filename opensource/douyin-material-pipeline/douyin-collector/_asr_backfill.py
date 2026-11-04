"""给已采集的视频就地补口播文案（阿里云 Paraformer）。
- keep=True：不删临时文件，避免触发沙箱批量删除确认拦截
- 每转完一条立即回写 douyin_filtered.json（断点续跑，崩了不丢进度）
- 已有 content 的跳过（重跑可续）
失败不崩：单条失败记日志、留空，最后汇报。
"""
import json, sys, os, time
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aliyun_asr
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "douyin_filtered.json")


def transcribe_one(rec):
    url = rec.get("play_url") or rec.get("url") or ""
    if not url:
        return rec, ""
    try:
        # keep=True：临时文件留着，避免 os.remove 触发沙箱批量删除确认
        txt = aliyun_asr.transcribe_video(url, keep=True)
    except Exception as e:
        return rec, f"ERR:{e}"
    return rec, txt


def main():
    recs = json.load(open(SRC, encoding="utf-8"))
    # 断点续跑：content 非空的直接算完成
    todo = [r for r in recs if not (r.get("content") or "").strip()]
    done_already = len(recs) - len(todo)
    print(f"总 {len(recs)} 条，已有文案 {done_already}，待转写 {len(todo)}")
    if not todo:
        print("无需转写，退出")
        return

    t0 = time.time()

    def save():
        json.dump(recs, open(SRC, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    ok = fail = 0
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = {ex.submit(transcribe_one, r): r for r in todo}
        for f in as_completed(futs):
            rec, txt = f.result()
            if isinstance(txt, str) and txt.startswith("ERR:"):
                fail += 1
                rec["content"] = ""
                print(f"  ✗ [{rec.get('author_name')}] {str(rec.get('title'))[:22]} {txt[:60]}")
            else:
                ok += 1
                rec["content"] = txt
                print(f"  ✓ {len(txt):>5}字 [{rec.get('author_name')}] {str(rec.get('title'))[:22]}")
            # 每完成一条就回写，崩了不丢
            save()
            n = ok + fail
            if n % 10 == 0 or n == len(todo):
                print(f"  --- 进度 {n}/{len(todo)}  用时 {time.time()-t0:.0f}s ---")

    # 重新导出 excel
    try:
        import collector
        collector.export_to_excel(recs, os.path.join(BASE, "douyin_20261013.xlsx"))
    except Exception as e:
        print(f"  excel 导出失败: {e}")
    print(f"\n完成：成功 {ok} / 失败 {fail} / 共 {len(todo)}，耗时 {time.time()-t0:.0f}s")
    print(f"已写回 {SRC}")


if __name__ == "__main__":
    main()
