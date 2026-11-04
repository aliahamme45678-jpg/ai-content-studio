# -*- coding: utf-8 -*-
"""评论过滤规则（需求第 1~3 条）。

原则：**评论区不是拿来全存的**，先把无效的挡在外面，再把高价值的挑出来。

两级：
  1. `classify_invalid()` —— 硬过滤，命中即丢（纯表情/纯数字/无意义短词/
     广告引流/重复/@他人/互关互赞/灌水）
  2. `value_score()` —— 打分排序，用于「优先保留高价值评论」

所有规则都是**可解释的**：丢掉时给出原因码，方便回头调规则、也方便抽查误杀。
"""

import re

# ---------------------------------------------------------------- 基础工具

# 抖音表情是 [xx] 形式，1~6 个字符
EMOJI_RE = re.compile(r"\[[^\[\]]{1,6}\]")
# 话题标签 #xxx、@xxx
AT_RE = re.compile(r"@[^\s@，,。.！!？?、:：;；\"'（）()\[\]]{1,30}")
HASH_RE = re.compile(r"#[^\s#]{1,40}")
URL_RE = re.compile(r"(https?://|www\.)\S+")
# 联系方式
CONTACT_RE = re.compile(
    r"(加\s*[vV微薇]\s*[:：]?\s*[a-zA-Z0-9_\-]{3,}"
    r"|[vV][xX]\s*[:：]?\s*[a-zA-Z0-9_\-]{4,}"
    r"|微信\s*[:：号]?\s*[a-zA-Z0-9_\-]{4,}"
    r"|weixin\s*[:：]?\s*[a-zA-Z0-9_\-]{4,}"
    r"|[qQ]{2}\s*[:：]?\s*\d{5,}"
    r"|电话\s*[:：]?\s*1[3-9]\d{9}"
    r"|\b1[3-9]\d{9}\b)"
)

# 灌水/无意义词表（去表情标点后完全匹配才算命中，避免误杀长句）
MEANINGLESS_EXACT = {
    "k", "kk", "ok", "okay", "嗯", "哦", "噢", "额", "呃", "啊", "呀", "哈", "嘿",
    "好", "好的", "行", "可以", "是", "对", "是的", "对的", "没错", "确实",
    "哈哈", "哈哈哈", "哈哈哈哈", "嘿嘿", "嘻嘻", "呵呵", "笑死", "笑死我了",
    "赞", "点赞", "支持", "顶", "收藏", "已阅", "打卡", "来了", "路过", "沙发",
    "牛", "牛啊", "牛逼", "厉害", "强", "太强了", "优秀", "学到了", "受教了",
    "谢谢", "感谢", "多谢", "谢了", "3q", "6", "666", "6666", "233", "111",
    "这个", "这", "那", "啥", "什么鬼", "无语", "无语了", "服了", "离谱",
    "第一", "前排", "mark", "码住", "占楼", "水", "1", "2", "0", "。。",
    "哈哈哈哈哈", "太好了", "不错", "挺好", "可以的", "顶一个", "报到",
}

# 「问题/需求」信号词 —— 命中就不算无意义短词
QUESTION_SIGNALS = (
    "怎么", "如何", "怎样", "哪", "什么", "为啥", "为什么", "求", "能不能",
    "可不可以", "可以吗", "有没有", "有没有人", "是不是", "有没有用", "吗",
    "呢", "吧", "教程", "链接", "资料", "方法", "步骤", "哪来", "在哪",
    "多久", "多少钱", "贵", "难", "会不", "可以教", "带带", "指路",
)

# 广告引流关键词
AD_KEYWORDS = (
    "加微", "加v", "加薇", "私信我", "私我", "加我", "找我", "联系我",
    "免费领", "免费送", "免费拿", "领取", "领资料", "资料包", "资料分享",
    "扫码", "扫我", "二维码", "公众号", "进群", "加群", "群主", "扣1",
    "代做", "接单", "代运营", "包教", "包会", "低价", "优惠", "折扣",
    "课程咨询", "报名", "原价", "限时", "名额", "只剩", "点击主页",
    "看我主页", "主页有", "置顶视频", "评论区扣", "需要的扣",
)

# 互关互赞
FOLLOW_TRADE = (
    "互关", "互赞", "回关", "互粉", "秒回", "关注必回", "有关必回",
    "已关请回", "互关互赞", "点赞必回", "关注我", "求关注", "求互",
)

# AI 助手名 —— @它们是在"指挥 AI 干活"，属于真实需求。
# `@豆包 总结` 这种去掉 @ 之后只剩两个字，以前会被判 at_only 丢掉，
# 但它表达的正是「想让 AI 把这个视频摘要出来」这个需求（2026-09-22 用户指出）。
AI_ASSISTANTS = ("豆包", "deepseek", "deepsee", "kimi", "文心一言", "文心",
                 "通义千问", "通义", "chatgpt", "gpt", "claude", "元宝",
                 "智谱", "清言", "gemini", "即梦", "可灵", "秘塔")
AI_AT_RE = re.compile(r"@\s*(?:" + "|".join(AI_ASSISTANTS) + r")", re.I)

# 纯灌水（与视频内容无关）
SPAM_PATTERNS = (
    re.compile(r"^[0-9\s]+$"),
    re.compile(r"^[a-zA-Z\s]+$"),
    re.compile(r"^[。，、！？…\.\,\!\?~\s]+$"),
    re.compile(r"^(哈|嘿|嘻|呵|额|呃|嗯|哦|噢)+[。，！？…\.\!\?~]*$"),
)

# 纯夸奖 / 纯情绪 —— 用户点名的无效评论：
#   "老天鹅怎么帅成这样了" / "[尬笑]居然很帅" / "醍醐灌顶[比心]"
# 做法：剥掉语气词和程度词之后，如果剩下的全是夸奖词，就是纯夸赞。
# ⚠️ 必须按长度降序剥 —— 否则"醍醐灌顶"里的"顶"会先被剥掉，剩"醍醐灌"判不出纯夸赞
PRAISE_WORDS = tuple(sorted((
    "帅", "美", "漂亮", "好看", "可爱", "厉害", "牛", "强", "优秀", "棒",
    "绝", "顶", "赞", "干货", "有才", "专业", "神仙", "天花板", "醍醐灌顶",
    "受益", "学到", "受教", "佩服", "膜拜", "聪明", "清晰", "透彻", "到位",
    "精髓", "通透", "宝藏", "高质量", "讲得好", "说得好", "干货满满", "太爱",
    "爱了", "上头", "破防", "救命", "yyds", "nb", "牛批", "牛逼", "给力",
), key=len, reverse=True))
# 语气 / 程度 / 指代词 —— 判纯夸赞时先剥掉（同样长的在前）
PRAISE_FILLER = tuple(sorted((
    "老天鹅", "老天", "我的天", "怎么", "居然", "竟然", "真的", "真是", "简直",
    "太", "好", "很", "超", "也", "还", "就是", "确实", "不得不", "这么", "那么",
    "这", "那", "个", "了", "啊", "呀", "吧", "呢", "的", "我", "你", "他", "她",
    "成", "样", "是", "有", "多", "能", "会", "都", "又", "再", "并", "但", "啥",
), key=len, reverse=True))


def is_pure_praise(sq):
    """整条只是夸奖/感叹 → True。sq 是去掉表情标点后的文本。"""
    t = sq
    for w in PRAISE_FILLER:
        t = t.replace(w, "")
    if not t:
        return False
    for p in PRAISE_WORDS:
        t = t.replace(p, "")
    return t == ""


def clean(t):
    """去掉表情、@、话题标签、URL，留纯文字。"""
    t = str(t or "")
    t = URL_RE.sub(" ", t)
    t = EMOJI_RE.sub(" ", t)
    t = AT_RE.sub(" ", t)
    t = HASH_RE.sub(" ", t)
    return t.strip()


def _squeeze(t):
    """去掉所有空白和标点，用于判空/判重。"""
    return re.sub(r"[\s\W_]+", "", t, flags=re.UNICODE)


# ---------------------------------------------------------------- 一级：硬过滤

def classify_invalid(text, *, dup=False):
    """返回 None 表示有效；否则返回原因码。

    原因码：empty / emoji_only / number_only / meaningless / ad / at_only /
            follow_trade / spam / dup
    """
    raw = str(text or "").strip()
    if not raw:
        return "empty"

    # @他人：整条只是在 @ 某人 —— 去掉 @ 之后要么没内容，要么剩下的本身就是灌水。
    # 注意：`@豆包 总结国内电商参考视频怎么找机会` 这种 **@ 后面带实质内容**的不算，
    # 它表达的是真实需求，按需求第 3 条要留着。所以这里递归判一下剩余部分。
    # ⚠️ 必须判 `stripped != raw` —— `@` 后面跟空格/标点时 AT_RE 不匹配，
    #     stripped 会等于 raw，直接递归就是无限递归（2026-09-22 踩过 RecursionError）。
    if "@" in raw:
        stripped = AT_RE.sub("", raw).strip()
        if not stripped:
            # `@豆包` 光秃秃一个，也是"想让 AI 干活"，留着
            return None if AI_AT_RE.search(raw) else "at_only"
        if stripped != raw and classify_invalid(stripped) is not None:
            # @AI助手 例外：`@豆包 总结` `@豆包 转文字` 这类是真实需求，不能丢
            if AI_AT_RE.search(raw):
                return None
            return "at_only"

    body = clean(raw)
    sq = _squeeze(body)

    # 纯表情 / 纯标点 / 纯符号
    if not sq:
        return "emoji_only"
    # 纯数字
    if sq.isdigit():
        return "number_only"
    # 纯字母（单字母 k、ok 之类已在词表，这里兜底超短）
    if sq.isalpha() and len(sq) <= 3 and sq.lower() in MEANINGLESS_EXACT:
        return "meaningless"
    # 灌水词表
    if sq.lower() in MEANINGLESS_EXACT:
        return "meaningless"
    # 短词 + 无问题信号 → 无意义
    if len(sq) <= 2 and not any(s in body for s in QUESTION_SIGNALS):
        return "meaningless"
    # 广告引流
    if CONTACT_RE.search(raw) or any(k in raw for k in AD_KEYWORDS):
        return "ad"
    # 互关互赞
    if any(k in raw for k in FOLLOW_TRADE):
        return "follow_trade"
    # 纯夸奖 / 纯情绪（"好聪明啊" / "老天鹅怎么帅成这样了" / "醍醐灌顶"）
    if is_pure_praise(sq):
        return "meaningless"
    # 重复
    if dup:
        return "dup"
    # 灌水正则
    for p in SPAM_PATTERNS:
        if p.match(body):
            return "spam"
    return None


# ---------------------------------------------------------------- 二级：价值分

# 高价值信号（需求第 3 条）
VALUE_SIGNALS = {
    "问题": ("怎么", "如何", "怎样", "为什么", "为啥", "请问", "求教", "能不能",
             "可以吗", "有没有", "是不是", "在哪", "哪来", "多久", "多少钱"),
    "痛点": ("太难", "麻烦", "搞不定", "不会", "学不会", "门槛", "小白",
             "新手", "看不懂", "听不懂", "试了", "失败", "踩坑", "卡在"),
    "需求": ("想要", "需要", "求", "希望", "有没有人", "求个", "蹲", "等一个",
             "出个", "能不能出"),
    "争议": ("不对", "不同意", "我觉得不是", "未必", "未必吧", "存疑", "质疑",
             "真的吗", "认真的吗", "不至于", "夸张"),
    "反对": ("没用", "没用吧", "假的", "忽悠", "割韭菜", "智商税", "骗",
             "吹", "吹牛", "过时", "早就", "又来了", "别信",
             "又是", "还在讲", "去年就", "好几月", "老掉牙", "炒冷饭",
             "早看过", "早就有了", "不是新的"),
    "经验": ("我用过", "我试过", "实测", "亲测", "我的做法", "我是", "我们公司",
             "我做了", "我的经验", "补充一下", "其实"),
    "案例": ("比如", "举个例子", "案例", "我认识", "有个朋友", "我们团队",
             "我们店", "我的账号"),
    "情绪": ("太", "真的", "服了", "离谱", "绝了", "泪", "哭", "笑死", "震惊",
             "无语", "离谱", "感动", "破防"),
}


def detect_types(text):
    """粗判评论类型（AI 分类前的兜底 + 给 AI 的提示）。可多标签。"""
    t = str(text or "")
    hits = [k for k, ws in VALUE_SIGNALS.items() if any(w in t for w in ws)]
    return hits


def value_score(text, digg=0, is_hot=False, reply_total=0):
    """价值分：长内容 + 有信号词 + 高赞 + 热评 + 有人回复。

    用途只有一个 —— 排序，好让「优先保留高价值评论」有可执行的口径。
    """
    t = clean(str(text or ""))
    n = len(t)
    score = 0.0
    # 长度：3~80 字是有效表达区，太长往往是复制粘贴的长文
    if n >= 80:
        score += 3
    elif n >= 30:
        score += 4
    elif n >= 15:
        score += 3
    elif n >= 8:
        score += 1.5
    elif n >= 3:
        score += 0.5
    # 信号词
    score += 1.2 * len(detect_types(t))
    # 互动
    try:
        score += min(4.0, (int(digg or 0)) ** 0.5 / 2.2)
    except Exception:
        pass
    if is_hot:
        score += 1.0
    try:
        score += min(2.0, (int(reply_total or 0)) ** 0.5 / 1.5)
    except Exception:
        pass
    # 带问号直接加分（用户提问是最直接的选题来源）
    if "?" in t or "？" in t:
        score += 1.0
    return round(score, 2)


REASON_LABEL = {
    "empty": "空",
    "emoji_only": "纯表情/纯符号",
    "number_only": "纯数字",
    "meaningless": "无意义短词",
    "ad": "广告引流",
    "at_only": "@他人",
    "follow_trade": "互关互赞",
    "spam": "灌水",
    "dup": "重复",
}
