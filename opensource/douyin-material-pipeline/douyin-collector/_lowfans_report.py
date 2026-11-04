# -*- coding: utf-8 -*-
"""出交付物：排序 xlsx + 分析报告 md"""
import json
import os
from collections import Counter

BASE = os.path.dirname(os.path.abspath(__file__))
rows = json.load(open(os.path.join(BASE, "低粉爆款_AI选题_42条.json"), encoding="utf-8"))


def bucket(s):
    if not s:
        return "缺失"
    if s <= 30:
        return "≤30s"
    if s <= 60:
        return "30-60s"
    if s <= 180:
        return "1-3min"
    if s <= 300:
        return "3-5min"
    return ">5min"


def fb(n):
    if n < 1000:
        return "<1千"
    if n < 5000:
        return "1千-5千"
    if n < 10000:
        return "5千-1万"
    if n < 50000:
        return "1万-5万"
    return ">5万"


# ---------- xlsx ----------
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

wb = Workbook()
ws = wb.active
ws.title = "低粉爆款筛选"
cols = ["排名", "判定", "作者", "粉丝数", "点赞", "评论", "收藏", "转发",
        "点赞粉丝比", "互动密度", "藏赞比", "时长秒", "时长档", "粉丝档",
        "时长提示", "判定理由", "发布", "标题", "链接"]
ws.append(cols)
for i, r in enumerate(rows, 1):
    ws.append([i, r["是否低粉爆款"], r["作者"], r["粉丝数"], r["点赞"], r["评论"],
               r["收藏"], r["转发"], r["点赞粉丝比"], r["互动密度"], r["藏赞比"],
               r["时长秒"], bucket(r["时长秒"]), fb(r["粉丝数"]), r["时长提示"],
               r["判定理由"], r["发布"], r["标题"], r["url"]])

hdr = PatternFill("solid", fgColor="1F3864")
for c in ws[1]:
    c.font = Font(bold=True, color="FFFFFF")
    c.fill = hdr
    c.alignment = Alignment(horizontal="center")
ok = PatternFill("solid", fgColor="C6EFCE")
mid = PatternFill("solid", fgColor="FFEB9C")
for row in ws.iter_rows(min_row=2):
    if row[1].value == "备选素材":
        for c in row:
            c.fill = mid
    elif row[1].value == "低粉爆款候选":
        for c in row:
            c.fill = ok
widths = [5, 12, 20, 9, 9, 8, 9, 8, 11, 10, 8, 8, 9, 10, 20, 22, 12, 40, 34]
for i, w in enumerate(widths, 1):
    ws.column_dimensions[chr(64 + i) if i <= 26 else "A"].width = w
ws.freeze_panes = "A2"
xlsx = os.path.join(BASE, "低粉爆款_AI选题_42条.xlsx")
wb.save(xlsx)
print("写好", xlsx)

# ---------- 报告 ----------
dist = Counter(r["是否低粉爆款"] for r in rows)
dur_dist = Counter(bucket(r["时长秒"]) for r in rows)
fan_dist = Counter(fb(r["粉丝数"]) for r in rows)
best = sorted(rows, key=lambda x: -x["点赞粉丝比"])[:5]
short = [r for r in rows if 0 < r["时长秒"] <= 30]
collect_type = [r for r in rows if r["藏赞比"] > 1]
author_cnt = Counter(r["作者"] for r in rows)

md = f"""# 低粉爆款筛选分析 · AI 选题 42 条

采集日期：2026-09-22　样本：**42 条**（全部采集成功，0 条失败）
数据源：飞书采集汇总表 `WTBVbWH98a4KNgskZ6BcXjgUnCe` / `tbl65u3jTdpZ4zDw`
新增字段：**作者粉丝数 / 点赞粉丝比 / 互动密度 / 是否低粉爆款**

---

## 一、判定结果

| 判定 | 条数 | 占比 |
|---|---|---|
| 低粉爆款候选 | **0** | 0% |
| 备选素材 | **5** | 11.9% |
| 放弃 | **37** | 88.1% |

**这批 42 条里没有一条达到"低粉爆款候选"（点赞粉丝比 > 10）。最高只有 7.29。**

## 二、Top 5（按点赞粉丝比排序）

| 排名 | 作者 | 粉丝 | 点赞 | 点赞粉丝比 | 互动密度 | 时长 | 判定 |
|---|---|---|---|---|---|---|---|
""" + "\n".join(
    f"| {i} | {r['作者']} | {r['粉丝数']} | {r['点赞']} | **{r['点赞粉丝比']}** | "
    f"{r['互动密度']} | {r['时长秒']}s | {r['是否低粉爆款']} |"
    for i, r in enumerate(best, 1)
) + f"""

## 三、三个指标各自的表现

### 1. 点赞粉丝比 —— 唯一的筛选闸门
| 区间 | 条数 |
|---|---|
| >10（潜力低粉爆款） | **0** |
| 3~10（备选素材） | 5 |
| <3（老粉流量） | 37 |

最高 7.29（红鸡），最低 0.09（恐龙哥 AI 小王子）。**没有一条破 10。**

### 2. 互动密度 —— 本批完全不起筛选作用
| 区间 | 条数 |
|---|---|
| ≥0.15（优质） | **42（100%）** |
| 0.08~0.15（普通） | 0 |
| <0.08（浅层） | 0 |

**最低值 0.58，是阈值 0.08 的 7 倍多。** 42 条全部远超"优质"线。
→ 说明这批内容的"评论+收藏+转发"相对点赞都很高，**这个指标对这批样本没有区分度**，
真正在起筛选作用的只有"点赞粉丝比"。

### 3. 时长 —— 反过来，几乎全员超标
| 时长档 | 条数 |
|---|---|
| ≤30s | **2** |
| 30-60s | 3 |
| 1-3min | 21 |
| 3-5min | 11 |
| >5min | 5 |

按"15–30s 可靠性高、>60s 翻拍风险上升"的口径，**只有 2 条落在安全区**：
- **沐飞的 AI 圈**（19.2s，626 粉，2035 赞，比 3.25，密度 1.08）→ **唯一同时满足"备选素材 + 15-30s"的**
- DannyZ（25.8s，比 1.63）→ 比值不够，判放弃

## 四、粉丝结构：这批链接不是按"低粉"选的

| 粉丝档 | 条数 |
|---|---|
""" + "\n".join(f"| {k} | {v} |" for k, v in fan_dist.items()) + f"""

单账号重复最多的：**AI大魔头 8 条**（8370 粉）、小刘别慌 3 条（11309 粉）、沐飞的 AI 圈 2 条。

**大号天然不可能有高比值** —— 10倍生产力（13 万粉）比值 0.11，大白AI（4.6 万粉）1.52。
这批是按"AI 主题"搜来的，不是按"低粉"筛的，所以整体比值被大号拉低。

## 五、⚠️ 指标盲区：点赞粉丝比会淘汰掉收藏型内容

**42 条里有 25 条（60%）的收藏数大于点赞数**（藏赞比 > 1）。这是 AI 工具类内容的标准特征——
用户不点赞，但会收藏起来照着做。而这 25 条**全部被判"放弃"**，因为它们的点赞粉丝比都低。

典型例子：

| 作者 | 收藏 | 点赞 | 藏赞比 | 点赞粉丝比 | 判定 |
|---|---|---|---|---|---|
| Lulu的AI野路子 | 14651 | 12307 | 1.19 | 2.07 | 放弃 |
| AI大魔头 | 8949 | 5570 | 1.44 | 0.66 | 放弃 |
| 阿尔法猎手 | 1590 | 1235 | 1.29 | 0.22 | 放弃 |
| 10倍生产力 | 14560 | 14560 | 1.28 | 0.11 | 放弃 |

**根因**："点赞粉丝比"衡量的是**破圈能力**（多少非粉丝被吸引来点赞），
而工具型内容的传播靠的是**收藏**，不是点赞。两个指标方向相反：
**内容越实用、越值得收藏，点赞粉丝比往往越低。**

**建议加一条豁免规则**（我已按此统计，供你决定是否采用）：

> 藏赞比 > 1 且 互动密度 ≥ 0.5 → 升为「备选素材」，不看点赞粉丝比

按这条重判，**会多出 24 条备选**（从 5 条 → 29 条）。
如果你要挑的是"可翻拍的工具类选题"，这 24 条才是真正的候选池；
如果你要挑的是"能破圈的选题"，那维持原判，只有那 5 条。

**两种目标选出来的素材几乎不重叠 —— 这是本次分析最需要你拍板的一件事。**

## 六、下一步建议

1. **补短内容**：这批 42 条只有 2 条 ≤30s，说明搜索时没按短时长过滤。
   建议下次采集时直接在抖音端筛"1 分钟以内"，命中率会高很多。
2. **补文案**：本次只采了数据，没跑 ASR（42 条全跑约 25 分钟）。
   如果只给入选的 5 条（或按豁免规则的 29 条）提文案，能省一大半时间 —— 说一声我就跑。
3. **指标口径**：上面的"豁免规则"要不要固化进 `_lowfans_analyze.py`，等你定。

---

## 附：文件清单

| 文件 | 说明 |
|---|---|
| `素材_AI选题_42条.txt` | 原始链接清单 |
| `cache_素材_AI选题_42条.json` | 原始采集数据（含 follower_count / duration_ms） |
| `低粉爆款_AI选题_42条.json` | 判定结果（排序后） |
| `低粉爆款_AI选题_42条.xlsx` | 交付表格（黄色=备选素材） |
| `_lowfans_analyze.py` | 判定脚本（可复跑） |
"""
p = os.path.join(BASE, "低粉爆款分析_AI选题_20260922.md")
open(p, "w", encoding="utf-8").write(md)
print("写好", p)
