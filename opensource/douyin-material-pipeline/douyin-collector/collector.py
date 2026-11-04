# -*- coding: utf-8 -*-
"""
抖音素材采集工具 v3.0

两种模式：
  1. 链接采集（推荐）—— 直接粘贴一条或多条视频链接，打开视频页拦截详情接口
     拿到点赞/评论/收藏/转发，再调 API 提取口播文案。
  2. 主页采集 —— 打开博主主页滚动加载全部视频，按阈值筛出爆款，再提取文案。

公共能力：
  - 支持短链(v.douyin.com)、完整链接、分享文案里混着的链接
  - 登录态持久化（首次手动过验证码后写入 douyin_state.json，后续免登录）
  - 逐条落盘 JSON，长任务中断不丢数据
"""

import argparse
import asyncio
import json
import os
import re
import time

import requests
from playwright.async_api import async_playwright

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(BASE_DIR, "douyin_state.json")
# 游客模式：设 DOUYIN_NO_STATE=1 就不加载登录态，以未登录身份采集。
# 用途见 open_browser() 里的说明（登录态被风控降权时的绕过方案）。
NO_STATE = os.environ.get("DOUYIN_NO_STATE", "").strip() not in ("", "0", "false", "False")
# 全新登录：设 DOUYIN_FRESH_LOGIN=1 时**不加载**旧登录态，但**允许保存**新的。
# 为什么需要它：login_douyin 走 open_browser，如果加载了旧 state，浏览器一开就是
# 已登录状态 → 脚本 3 秒内判定"已登录"→ 直接保存 → 用户根本没机会扫码，
# 等于把那个出问题的旧会话原样存回去。（2026-10-17 踩到）
FRESH_LOGIN = os.environ.get("DOUYIN_FRESH_LOGIN", "").strip() not in ("", "0", "false", "False")

# ============ 配置 ============
KUHUYUN_API_URL = "https://api.kuhuyun.com/api/aibasic/videoanalysis"
# 酷虎云已废弃（口播文案改走阿里云百炼 Paraformer，见 aliyun_asr.py）。
# 这里仅为兼容保留常量；**不要**再把 key 写进代码 —— 2026-10-17 清掉过一次
# 硬编码的默认值（当时是唯一的 key 来源，等于明文泄露）。要用请放 .env。
KUHUYUN_API_KEY = os.environ.get("KUHUYUN_API_KEY", "")

DEFAULT_MIN_DIGG = 3000
DEFAULT_MIN_COMMENT = 50
DEFAULT_MIN_COLLECT = 1000

SCROLL_PAUSE_TIME = 3.5
MAX_SCROLLS = 50
MAX_VIDEOS = 100

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

# 详情/列表接口特征串
DETAIL_API_KEYS = (
    "/aweme/v1/web/aweme/detail/",
    "/aweme/v1/web/aweme/post/",
    "/aweme/post/",
)

URL_RE = re.compile(r"https?://[^\s，,、；;\"'）)】\]]+", re.I)


# ============ 通用工具 ============
def log(msg=""):
    print(msg, flush=True)


def extract_links(text):
    """从任意文本抽出抖音链接：多行、逗号分隔、整段分享文案都支持"""
    if not text:
        return []
    links, seen = [], set()
    for raw in URL_RE.findall(text):
        url = raw.rstrip("。.!！?？")
        if url not in seen:
            seen.add(url)
            links.append(url)
    return links


AWEME_ID_PATTERNS = (
    r"/(?:video|slides|note|aweme)/(\d+)",
    r"(?:modal_id|aweme_id|item_id)=(\d+)",
    r"/(\d{15,})",
)


def extract_aweme_id(url):
    """从链接里抠出视频 id，短链跳转后用 page.url 再抠一次"""
    if not url:
        return ""
    for pattern in AWEME_ID_PATTERNS:
        m = re.search(pattern, url)
        if m:
            return m.group(1)
    return ""


def to_int(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def fmt_time(ts):
    ts = to_int(ts)
    if not ts:
        return ""
    if ts > 1e12:
        ts = ts // 1000
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(ts))


def iter_awemes(data):
    """从响应 JSON 里捞出全部视频对象（主页接口一次返回多条）"""
    out = []
    if not isinstance(data, dict):
        return out
    for key in ("aweme_detail", "aweme", "item"):
        node = data.get(key)
        if isinstance(node, dict) and node.get("aweme_id"):
            out.append(node)
    for key in ("aweme_list", "items", "item_list", "data"):
        node = data.get(key)
        if isinstance(node, list):
            for x in node:
                if isinstance(x, dict) and x.get("aweme_id"):
                    out.append(x)
    return out


def parse_aweme(aweme):
    """统一字段提取，缺字段补 0"""
    stats = aweme.get("statistics") or {}
    author = aweme.get("author") or {}
    aweme_id = aweme.get("aweme_id", "")
    # 作者粉丝数：detail 接口的 author.follower_count；兼容 follower_count_str
    follower = to_int(author.get("follower_count"))
    if not follower:
        raw = str(author.get("follower_count_str") or "").strip()
        if raw.endswith("w") or raw.endswith("W"):
            try:
                follower = int(float(raw[:-1]) * 10000)
            except Exception:
                follower = 0
        elif raw.isdigit():
            follower = int(raw)
    # CDN 直链（2026-09-22 新增）：detail 接口里自带 video.play_addr.url_list，
    # 存下来就能让音频环节直接 ffmpeg，**省掉一次专门的浏览器解析**（实测 11.2s/条）。
    # 直链里的 token 解出来是几小时后过期（实测 6ab26192 → 19:08），同一次跑内用绰绰有余。
    # 拿不到就留空，音频环节会自动回落到浏览器解析。
    play_url = ""
    video = aweme.get("video") or {}
    for key in ("play_addr_h264", "play_addr", "play_addr_265"):
        node = video.get(key) or {}
        urls = node.get("url_list") or []
        if urls:
            play_url = urls[0]
            break
    return {
        "aweme_id": aweme_id,
        "author_name": author.get("nickname", ""),
        "follower_count": follower,
        "title": aweme.get("desc", "") or "",
        "url": aweme.get("share_url") or f"https://www.douyin.com/video/{aweme_id}",
        "digg_count": to_int(stats.get("digg_count")),
        "comment_count": to_int(stats.get("comment_count")),
        "collect_count": to_int(stats.get("collect_count")),
        "share_count": to_int(stats.get("share_count")),
        "create_time": to_int(aweme.get("create_time")),
        "publish_time": fmt_time(aweme.get("create_time")),
        "duration_ms": to_int((aweme.get("video") or {}).get("duration")
                              or aweme.get("duration")),
        "play_url": play_url,
        "content": "",
    }


def extract_content(video_url, poll_interval=3, max_poll=30):
    """提取口播文案：走阿里云百炼 Paraformer（酷虎云已停用）。

    入参应是视频直链（play_url）；传分享链接也能跑，但直链更稳更快。
    失败（额度/下载/转写）一律返回空字符串，不让主采集流程崩。
    """
    if not video_url:
        return ""
    try:
        import aliyun_asr
        if not aliyun_asr.is_ready():
            log("    阿里云 ASR 未就绪（缺 DASHSCOPE_API_KEY），跳过文案")
            return ""
        # keep=True：不删临时文件，避免触发沙箱批量删除确认拦截（曾把整批转写卡死）
        return aliyun_asr.transcribe_video(video_url, keep=True)
    except Exception as e:
        log(f"    文案提取异常: {e}")
        return ""


def export_to_excel(videos, filename="douyin_videos.xlsx", dirpath=None):
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Font

        wb = Workbook()
        ws = wb.active
        ws.title = "采集结果"

        headers = ["作者名称", "视频标题", "发布时间", "点赞数", "评论数",
                   "收藏数", "转发数", "视频链接", "提取文案"]
        for col, name in enumerate(headers, 1):
            cell = ws.cell(row=1, column=col, value=name)
            cell.font = Font(bold=True)
            cell.alignment = Alignment(horizontal="center")

        for row, v in enumerate(videos, 2):
            ws.cell(row=row, column=1, value=v.get("author_name", ""))
            ws.cell(row=row, column=2, value=v.get("title", ""))
            ws.cell(row=row, column=3, value=v.get("publish_time", ""))
            ws.cell(row=row, column=4, value=to_int(v.get("digg_count")))
            ws.cell(row=row, column=5, value=to_int(v.get("comment_count")))
            ws.cell(row=row, column=6, value=to_int(v.get("collect_count")))
            ws.cell(row=row, column=7, value=to_int(v.get("share_count")))
            ws.cell(row=row, column=8, value=v.get("url", ""))
            ws.cell(row=row, column=9, value=v.get("content", ""))

        for col, width in zip("ABCDEFGHI", (18, 40, 18, 12, 12, 12, 12, 46, 80)):
            ws.column_dimensions[col].width = width

        filepath = os.path.join(dirpath or BASE_DIR, filename)
        wb.save(filepath)
        log(f"\n已导出 Excel: {filepath}")
        return filepath
    except Exception as e:
        log(f"导出 Excel 失败: {e}")
        return None


def save_json(videos, filename="douyin_result.json"):
    try:
        filepath = os.path.join(BASE_DIR, filename)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(videos, f, ensure_ascii=False, indent=2)
        return filepath
    except Exception:
        return None


# ============ 浏览器公共部分 ============
_LOGIN_CHECKED = False


def check_login_once(verbose=True):
    """开跑前做一次登录态体检（每个进程只做一次）。

    用户 2026-09-22 授权持久化登录：核心 cookie 约 59 天，
    剩不到 10 天时 `login_state` 会自动静默续期，不用扫码。
    这里只负责"体检 + 提醒"，续期交给 refresh_login.py / ensure_fresh。
    """
    global _LOGIN_CHECKED
    if _LOGIN_CHECKED:
        return
    _LOGIN_CHECKED = True
    try:
        import login_state
        info = login_state.inspect()
        if not info.get("exists"):
            log("  [登录态] 没有 douyin_state.json —— 需要跑 "
                "`python refresh_login.py --login` 扫码一次")
            return
        left = info.get("core_days_left")
        if left is None:
            log("  [登录态] 核心 cookie 缺失，建议重新扫码")
        elif left <= 0:
            log("  [登录态] ⚠️ 已过期，需要跑 `python refresh_login.py --login`")
        elif left <= login_state.REFRESH_WHEN_DAYS_LEFT:
            log(f"  [登录态] 只剩 {left} 天，跑 `python refresh_login.py --refresh` "
                f"可静默续期（不用扫码）")
        elif verbose:
            log(f"  [登录态] 健康，还能用约 {int(left)} 天")
    except Exception as e:
        log(f"  [登录态] 体检失败（不影响采集）: {type(e).__name__}: {e}")


async def open_browser(p, headless=False):
    """启动浏览器；有登录态则复用，免重复过验证码

    2026-10-17 风控绕过（实测矩阵结论）：
      只有「内置 Chromium + 游客身份」这个组合能拿到 detail 数据。
        chromium + 登录 → 302 到 /jingxuan，detail 空
        chromium + 游客 → ✓ 拿到 10 万+ 字节
        Edge     + 登录 → 空
        Edge     + 游客 → 空
      所以：
        DOUYIN_NO_STATE=1   → 不加载登录态（游客）
        DOUYIN_BROWSER=chromium → 强制用内置 Chromium，不用 Edge
      两个一起用才是有效组合。默认行为不变（Edge + 有登录态就加载）。
    """
    check_login_once(verbose=not headless)
    use_chromium = os.environ.get("DOUYIN_BROWSER", "").strip().lower() == "chromium"
    browser = None
    if use_chromium:
        browser = await p.chromium.launch(headless=headless,
                                         args=["--start-maximized"])
        log("  [浏览器] 用内置 Chromium（DOUYIN_BROWSER=chromium）")
    else:
        try:
            browser = await p.chromium.launch(channel="msedge", headless=headless,
                                              args=["--start-maximized"])
        except Exception:
            log("  Edge 启动失败，改用内置 Chromium")
            browser = await p.chromium.launch(headless=headless,
                                              args=["--start-maximized"])

    kwargs = {"user_agent": UA, "viewport": {"width": 1280, "height": 800}}
    # 2026-10-17：登录态被风控降权时（带 cookie 反而 302 到 /jingxuan、
    # detail 返回空 body），用 DOUYIN_NO_STATE=1 以游客身份跑 —— 实测游客能拿到
    # 完整 detail 数据。见 NO_STATE 说明。
    # FRESH_LOGIN（重新扫码用）同样不加载旧 state，但**允许** save_state 回写。
    if FRESH_LOGIN:
        log("  [登录态] 全新登录模式：不加载旧 douyin_state.json（等扫码后覆盖）")
    elif os.path.exists(STATE_FILE) and not NO_STATE:
        kwargs["storage_state"] = STATE_FILE
    elif NO_STATE:
        log("  [登录态] 游客模式（DOUYIN_NO_STATE=1），不加载 douyin_state.json")
    context = await browser.new_context(**kwargs)
    return browser, context


async def save_state(context):
    # 游客模式下**绝不能**回写 state：那会把用户的真实登录态覆盖成游客会话。
    if NO_STATE:
        return
    try:
        await context.storage_state(path=STATE_FILE)
    except Exception:
        pass


def collect_responses(store):
    """回调里只存 response 对象，json 解析放到主流程 await"""

    def handler(response):
        url = response.url
        if any(k in url for k in DETAIL_API_KEYS):
            store.append(response)

    return handler


async def drain(store):
    """解析并清空已捕获的响应，返回全部视频对象"""
    items = []
    for resp in store:
        try:
            data = await resp.json()
        except Exception:
            continue
        items.extend(iter_awemes(data))
    store.clear()
    return items


def alert_box(title, msg):
    """系统模态弹窗提醒。

    浏览器窗口经常被压在别的窗口后面，只在终端里 log 一行"检测到验证码"
    用户根本看不见，结果脚本干等两分钟然后采不全。这个弹窗一定会弹到最前。
    """
    try:
        import subprocess
        subprocess.Popen(
            ["powershell", "-NoProfile", "-Command",
             "Add-Type -AssemblyName System.Windows.Forms;"
             "[System.Windows.Forms.MessageBox]::Show('%s','%s')" % (msg, title)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass


VERIFY_POLL = 5            # 每 5 秒检查一次验证码是否还在
VERIFY_WAIT_ROUNDS = 24    # 单次最多等 2 分钟
VERIFY_MAX_WAITS = 2       # 全程最多等 2 次，防止死等
_verify_wait_count = 0

# 只认"看得见的验证码容器"，不要碰页面文字。
#
# 踩过的坑：最早用 document.body.innerText 匹配"验证|滑块"，结果在
# 跨境出海运营站主页上疯狂误判——那个号的作品标题/文案里本来就有"验证"
# "滑块"这类词（feed 页会把几十条视频标题渲染进 DOM）。误判一次就要等
# 2 分钟，50 轮滚动能干等两个小时，最后还采不全。
# 现在规则：必须是真的验证码 DOM 元素，且尺寸可见（宽>60 高>20）。
VERIFY_JS = """
() => {
  const sels = ['#captcha_container', '.captcha_verify_container',
                '.captcha-verify-container', '.captcha-verify-bar',
                '#captcha-verify-image', '.verify-wrap', '.validate-box',
                '.shumei_captcha', '#captcha'];
  for (const s of sels) {
    const el = document.querySelector(s);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 60 && r.height > 20) return 'el:' + s;
  }
  for (const f of document.querySelectorAll('iframe')) {
    const src = f.src || '';
    if (!/captcha|verify|slider|shumei/i.test(src)) continue;
    const r = f.getBoundingClientRect();
    if (r.width > 60 && r.height > 20) return 'iframe:' + src.slice(0, 90);
  }
  return '';
}
"""


async def _has_verify(page):
    """返回 '' 表示没验证码；返回非空字符串表示命中，并说明命中的是什么。"""
    try:
        return await page.evaluate(VERIFY_JS) or ""
    except Exception:
        return ""


async def check_verify(page):
    """碰到验证码就轮询等人在浏览器里处理，不用 input() 等回车。

    两个坑都踩过：
    1. input() 在后台/非交互下 stdin 立刻 EOF，等于没等 → 后面几轮滚动全空 →
       误判"没有更多视频"（73 个作品只采到 55 个，未登录时只有 21 个）。
    2. 用页面全文匹配"验证"+"滑块"会误判（抖音页面上本来就有这些字），
       每轮滚动后都触发一次 3 分钟等待，50 轮能跑两个小时。
    现在改成：JS 精确找验证码容器 + 全程最多等 2 次。
    """
    global _verify_wait_count
    hit = await _has_verify(page)
    if not hit:
        return
    if _verify_wait_count >= VERIFY_MAX_WAITS:
        log(f"验证码已等过 {VERIFY_MAX_WAITS} 次，这次直接跳过（可能采不全）")
        return
    _verify_wait_count += 1
    log("\n" + "=" * 50)
    log(f"检测到验证码（命中 {hit}）：请在弹出的浏览器里完成验证")
    log(f"不用按回车 — 每 {VERIFY_POLL}s 自动检查，最多等 "
        f"{VERIFY_WAIT_ROUNDS * VERIFY_POLL // 60} 分钟")
    log("=" * 50)
    try:
        await page.bring_to_front()
    except Exception:
        pass
    alert_box("抖音采集需要你操作", "检测到验证码，请在浏览器里拖完滑块")
    for _ in range(VERIFY_WAIT_ROUNDS):
        await asyncio.sleep(VERIFY_POLL)
        if not await _has_verify(page):
            log("验证已通过，继续采集")
            await asyncio.sleep(2)
            return
    log("等待验证超时，继续（可能只能采到一部分）")


# ---- 滚动：必须滚真正的容器，不是 window ----
#
# 巨大坑（2026-09-21 定位）：抖音主页 window 根本不可滚
# （scrollHeight == clientHeight == 720），作品列表在一个内部 div 里
# （.route-scroll-container，scrollHeight 3402 / clientHeight 720）。
# 之前一直写 window.scrollTo(0, document.body.scrollHeight)，等于每次都在滚一个
# 滚不动的东西，接口永远只加载首屏那几页 —— 所以 73 个作品只采到 55 个，
# 还被误判成"没有更多视频"。现在自动挑可滚动距离最大的容器滚到底。
SMART_SCROLL_JS = """
() => {
  const cands = [...document.querySelectorAll('div,section,main,ul')].filter(el => {
    const cs = getComputedStyle(el);
    return /auto|scroll/.test(cs.overflowY) && (el.scrollHeight - el.clientHeight) > 20;
  });
  if (cands.length) {
    cands.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
    const el = cands[0];
    el.scrollTop = el.scrollHeight;
    return {where: (el.className || '').toString().slice(0, 50),
            top: el.scrollTop, sh: el.scrollHeight};
  }
  window.scrollTo(0, document.scrollingElement.scrollHeight);
  return {where: 'window', top: window.scrollY,
          sh: document.scrollingElement.scrollHeight};
}
"""


async def smart_scroll(page):
    """滚到真正的列表底部，返回命中信息（调试用）。"""
    try:
        return await page.evaluate(SMART_SCROLL_JS)
    except Exception:
        return None


# ---- 登录墙 ----
LOGIN_JS = """
() => {
  for (const f of document.querySelectorAll('iframe')) {
    const src = f.src || '';
    if (!/passport|login/i.test(src)) continue;
    const r = f.getBoundingClientRect();
    if (r.width > 100 && r.height > 100) return 'iframe:' + src.slice(0, 90);
  }
  const sels = ['#login-pannel', '.login-pannel', '.login-container',
                '.login-modal', '[data-e2e="login-modal"]', '.qrcode-img'];
  for (const s of sels) {
    const el = document.querySelector(s);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 60 && r.height > 60) return 'el:' + s;
  }
  const t = document.body.innerText || '';
  if (/扫码登录|验证码登录|登录后查看/.test(t)) return 'text';
  return '';
}
"""

LOGIN_POLL = 5
LOGIN_WAIT_ROUNDS = 36     # 3 分钟，扫码要时间
_login_waited = False


async def check_login(page):
    """碰到登录墙就弹窗叫人扫码，轮询等登录完成。

    用户明确说过「每次我都会帮你扫码，你只需要判断需要登录，提示我帮你扫码」。
    所以这里不做猜测：检测到 → 弹窗 → 轮询等到登录态出现。
    """
    global _login_waited
    try:
        hit = await page.evaluate(LOGIN_JS) or ""
    except Exception:
        return
    if not hit or _login_waited:
        return
    _login_waited = True
    log("\n" + "=" * 50)
    log(f"需要登录（命中 {hit}）—— 请在弹出的浏览器里扫码")
    log("不用按回车，扫完自动继续")
    log("=" * 50)
    try:
        await page.bring_to_front()
    except Exception:
        pass
    alert_box("抖音采集需要你扫码", "请先在弹出的浏览器里扫码登录抖音")
    for _ in range(LOGIN_WAIT_ROUNDS):
        await asyncio.sleep(LOGIN_POLL)
        try:
            if not (await page.evaluate(LOGIN_JS) or ""):
                log("登录成功，继续采集")
                await asyncio.sleep(2)
                return
        except Exception:
            pass
    log("等扫码超时，继续（未登录可能采不全）")


# ============ 模式一：链接采集 ============
class LinkCollector:
    """给一批视频链接，逐条打开取数据 + 提文案"""

    def __init__(self, links, with_content=True, headless=False, on_progress=None,
                 cache_file="douyin_result.json"):
        self.links = links
        self.with_content = with_content
        self.headless = headless
        self.on_progress = on_progress
        self.cache_file = cache_file
        self.results = []

    def _progress(self, stage, current, total, item=None):
        if self.on_progress:
            try:
                self.on_progress({"stage": stage, "current": current,
                                  "total": total, "item": item})
            except Exception:
                pass

    async def run(self):
        log("=" * 60)
        log(f"链接采集模式：共 {len(self.links)} 条链接")
        log("=" * 60)

        async with async_playwright() as p:
            browser, context = await open_browser(p, self.headless)
            page = await context.new_page()
            store = []
            page.on("response", collect_responses(store))

            try:
                for idx, link in enumerate(self.links, 1):
                    log(f"\n[{idx}/{len(self.links)}] {link}")
                    self._progress("fetch", idx, len(self.links))
                    item = await self.fetch_one(page, store, link)
                    if item is None:
                        item = {
                            "aweme_id": "", "author_name": "", "follower_count": 0,
                            "title": "", "url": link,
                            "digg_count": 0, "comment_count": 0, "collect_count": 0,
                            "share_count": 0, "create_time": 0, "publish_time": "",
                            "duration_ms": 0, "play_url": "",
                            "content": "", "note": "数据未获取到",
                        }
                        log("    未抓到详情接口，数据留空")

                    item["source_url"] = link  # 记住原始输入链接（短链），回写时靠它配对
                    log(f"    @{item['author_name'] or '-'} | "
                        f"赞 {item['digg_count']} 评 {item['comment_count']} "
                        f"藏 {item['collect_count']} 转 {item['share_count']}")

                    if self.with_content:
                        log("    正在提取文案...")
                        item["content"] = extract_content(
                            item.get("play_url") or item.get("url") or link)

                    self.results.append(item)
                    self._progress("done", idx, len(self.links), item)
                    save_json(self.results, self.cache_file)

                await save_state(context)
            finally:
                await browser.close()

        return self.results

    async def _wait_detail(self, page, timeout):
        """等一个详情接口响应；用事件等待代替死等，命中即返回"""
        return asyncio.ensure_future(
            page.wait_for_event(
                "response",
                predicate=lambda r: any(k in r.url for k in DETAIL_API_KEYS),
                timeout=timeout,
            )
        )

    async def _resolve(self, waiter, store, target_id):
        """从等待中的响应 + 已捕获的响应里挑出目标视频"""
        items = []
        try:
            resp = await waiter
        except Exception:
            resp = None
        if resp is not None:
            try:
                items.extend(iter_awemes(await resp.json()))
            except Exception:
                pass
        items.extend(await drain(store))
        # 2026-10-17 修：抖音现在把 detail 请求**发两次** —— 第一次 body 为空
        # （www.douyin.com，秒回），第二次才是真数据（www-hj.douyin.com，**实测约 13 秒后**）。
        # waiter 在第一个空响应到达时就返回，drain 拿到的是空的。
        # 所以必须轮询等到真数据，20 秒上限（实测 13 秒左右到，留足余量）。
        if not items:
            for _ in range(40):              # 0.5s × 40 = 最多 20 秒
                await asyncio.sleep(0.5)
                items.extend(await drain(store))
                if items:
                    break
        if not items:
            return None
        # 页面里常混着推荐视频，优先取 id 对得上的那条
        if target_id:
            for aweme in items:
                if aweme.get("aweme_id") == target_id:
                    return parse_aweme(aweme)
        return parse_aweme(items[0])

    async def _poll_resolve(self, store, target_id, timeout=25.0):
        """轮询等待 detail 真数据到达，命中就返回。

        2026-10-17 新增。原因：抖音把 detail 请求发两次 —— 第一次 body 为空
        （www.douyin.com，秒回），第二次才有真数据（www-hj.douyin.com，**约 13 秒后**）。
        原来靠 `page.wait_for_event` 等响应，它会在**第一个空响应**到达时就返回，
        于是永远解析不到数据。改成"每 0.5 秒 drain 一次、直到解析出 aweme"最稳。
        """
        import time as _t
        deadline = _t.time() + timeout
        while _t.time() < deadline:
            await asyncio.sleep(0.5)
            items = await drain(store)
            if not items:
                continue
            if target_id:
                for aweme in items:
                    if aweme.get("aweme_id") == target_id:
                        return parse_aweme(aweme)
            return parse_aweme(items[0])
        return None

    async def fetch_one(self, page, store, link):
        """打开单条视频页取数据；失败返回 None"""
        target_id = extract_aweme_id(link)

        store.clear()
        opened = False
        for attempt in (1, 2):
            try:
                await page.goto(link, wait_until="domcontentloaded", timeout=60000)
                opened = True
                break
            except Exception as e:
                log(f"    打开失败({attempt}): {e}")
                await asyncio.sleep(2)
        if not opened:
            return None

        if not target_id:
            target_id = extract_aweme_id(page.url)  # 短链跳转后才有真实 id

        item = await self._poll_resolve(store, target_id, timeout=25.0)
        if item:
            return item

        # 没抓到就刷新一次，还不行就放弃（这里可能遇到验证码，先给机会手动过）
        await check_verify(page)
        log("    未捕获到详情接口，刷新重试一次")
        store.clear()
        try:
            await page.reload(wait_until="domcontentloaded", timeout=60000)
            item = await self._poll_resolve(store, target_id, timeout=20.0)
            if item:
                return item
        except Exception:
            pass

        try:
            title = await page.title()
            if title and "抖音" not in title:
                return {
                    "aweme_id": target_id, "author_name": "", "follower_count": 0,
                    "title": title, "url": link,
                    "digg_count": 0, "comment_count": 0, "collect_count": 0,
                    "share_count": 0, "create_time": 0, "publish_time": "",
                    "duration_ms": 0, "play_url": "",
                    "content": "", "note": "互动数据未获取到",
                }
        except Exception:
            pass
        return None


# ============ 模式二：主页采集 ============
class DouyinCollector:
    def __init__(self, min_digg=DEFAULT_MIN_DIGG, min_comment=DEFAULT_MIN_COMMENT,
                 min_collect=DEFAULT_MIN_COLLECT, max_videos=MAX_VIDEOS, headless=False,
                 on_progress=None, with_content=True):
        self.min_digg = min_digg
        self.min_comment = min_comment
        self.min_collect = min_collect
        self.max_videos = max_videos
        self.headless = headless
        self.on_progress = on_progress
        self.with_content = with_content
        self.videos = []
        self.seen_ids = set()

    def _progress(self, stage, current=0, total=0, item=None):
        if self.on_progress:
            try:
                self.on_progress({"stage": stage, "current": current,
                                  "total": total, "item": item})
            except Exception:
                pass

    def add_aweme(self, aweme):
        aweme_id = aweme.get("aweme_id", "")
        if not aweme_id or aweme_id in self.seen_ids:
            return False
        self.seen_ids.add(aweme_id)
        item = parse_aweme(aweme)
        self.videos.append(item)
        log(f"  [{len(self.videos)}] @{item['author_name']} | {item['title'][:28]} | "
            f"赞:{item['digg_count']} 评:{item['comment_count']} 藏:{item['collect_count']}")
        return True

    def filter_videos(self):
        filtered = [v for v in self.videos
                    if v["digg_count"] >= self.min_digg
                    and v["comment_count"] >= self.min_comment
                    and v["collect_count"] >= self.min_collect]
        log(f"\n筛选完成：{len(filtered)}/{len(self.videos)} 个符合条件")
        return filtered

    async def run(self, homepage_url):
        log("=" * 60)
        log("主页采集模式")
        log("=" * 60)
        log(f"筛选条件: 点赞>={self.min_digg}, 评论>={self.min_comment}, 收藏>={self.min_collect}\n")

        async with async_playwright() as p:
            browser, context = await open_browser(p, self.headless)
            page = await context.new_page()
            store = []
            page.on("response", collect_responses(store))

            filtered = []
            try:
                log(f"正在打开: {homepage_url}")
                await page.goto(homepage_url, wait_until="domcontentloaded", timeout=60000)
                await asyncio.sleep(3)
                await check_verify(page)
                await check_login(page)

                log("\n开始滚动加载视频...")
                no_new = 0
                for i in range(MAX_SCROLLS):
                    before = len(self.videos)
                    await smart_scroll(page)
                    await asyncio.sleep(SCROLL_PAUSE_TIME)

                    for aweme in await drain(store):
                        self.add_aweme(aweme)

                    after = len(self.videos)
                    log(f"  第{i + 1}轮滚动，当前共 {after} 个视频")
                    self._progress("scroll", i + 1, MAX_SCROLLS)

                    if after == before:
                        no_new += 1
                        if no_new >= 5:
                            log("没有更多视频了")
                            break
                    else:
                        no_new = 0

                    await check_verify(page)
                    if len(self.videos) >= self.max_videos:
                        log(f"达到最大采集数 {self.max_videos}")
                        break

                log(f"\n共采集到 {len(self.videos)} 个视频")
                filtered = self.filter_videos()
                self._progress("filtered", 0, len(filtered), filtered)

                if filtered and self.with_content:
                    log(f"\n开始为 {len(filtered)} 个视频提取文案...")
                    for i, v in enumerate(filtered, 1):
                        log(f"\n[{i}/{len(filtered)}] {v['title'][:32]}")
                        v["content"] = extract_content(v.get("play_url") or v["url"])
                        self._progress("content", i, len(filtered), v)
                        save_json(filtered, "douyin_filtered.json")

                await save_state(context)
            finally:
                await browser.close()

        return filtered


# ============ 入口 ============
def interactive():
    log("=" * 60)
    log("抖音素材采集工具 v3.0")
    log("=" * 60)
    log("  1. 链接采集 —— 粘贴视频链接，直接取数据 + 文案")
    log("  2. 主页采集 —— 打开博主主页，批量筛爆款 + 提文案")
    choice = input("\n请选择模式 [1]: ").strip() or "1"

    if choice == "1":
        log("\n粘贴视频链接（可多行、逗号分隔，也支持整段分享文案）")
        log("输入完单独一行敲 done 或直接空行结束：")
        lines = []
        while True:
            try:
                line = input()
            except EOFError:
                break
            s = line.strip()
            if s.lower() in ("done", "d", "q"):
                break
            if s == "":
                if lines:
                    break
                continue
            lines.append(line)
        links = extract_links("\n".join(lines))
        if not links:
            log("没有识别到链接")
            return
        log(f"\n识别到 {len(links)} 条链接")
        results = asyncio.run(LinkCollector(links).run())
        if results:
            export_to_excel(results)
            save_json(results)
    else:
        url = input("\n请输入抖音主页 URL: ").strip()
        if not url:
            log("URL 不能为空")
            return
        c = DouyinCollector(
            to_int(input(f"最低点赞数 [{DEFAULT_MIN_DIGG}]: ").strip(), DEFAULT_MIN_DIGG),
            to_int(input(f"最低评论数 [{DEFAULT_MIN_COMMENT}]: ").strip(), DEFAULT_MIN_COMMENT),
            to_int(input(f"最低收藏数 [{DEFAULT_MIN_COLLECT}]: ").strip(), DEFAULT_MIN_COLLECT),
        )
        filtered = asyncio.run(c.run(url))
        if filtered:
            export_to_excel(filtered)
            save_json(filtered, "douyin_filtered.json")


def main():
    parser = argparse.ArgumentParser(description="抖音素材采集工具 v3.0")
    parser.add_argument("-l", "--links", nargs="*", help="视频链接，可多条")
    parser.add_argument("-f", "--file", help="存放链接的文本文件")
    parser.add_argument("-u", "--url", help="博主主页 URL（主页采集模式）")
    parser.add_argument("--min-digg", type=int, default=DEFAULT_MIN_DIGG)
    parser.add_argument("--min-comment", type=int, default=DEFAULT_MIN_COMMENT)
    parser.add_argument("--min-collect", type=int, default=DEFAULT_MIN_COLLECT)
    parser.add_argument("--no-content", action="store_true", help="只取数据不提文案")
    parser.add_argument("--headless", action="store_true", help="无头模式")
    # 2026-09-22 新增：采集完顺手把评论也抓下来，沉淀到飞书【评论库】。
    # 默认开启 —— 用户明确要求「之后采集的时候也要把评论给采集上」。
    parser.add_argument("--no-comments", action="store_true",
                        help="不抓评论（默认会抓）")
    # 2026-09-22 新增：只采 AI / 跨境赛道的评论，其他赛道作者的视频跳过评论抓取。
    # 默认开启 —— 用户要求「只采集 AI 或者跨境的评论 其他的删除」。
    parser.add_argument("--all-tracks", action="store_true",
                        help="不限赛道，所有作者的评论都抓（默认只抓 AI/跨境）")
    parser.add_argument("-o", "--output", default="douyin_videos.xlsx")
    args = parser.parse_args()

    if args.links or args.file:
        links = list(args.links or [])
        if args.file:
            try:
                with open(args.file, "r", encoding="utf-8") as f:
                    links += extract_links(f.read())
            except Exception as e:
                log(f"读取链接文件失败: {e}")
        if not links:
            log("没有可处理的链接")
            return
        results = asyncio.run(
            LinkCollector(links, with_content=not args.no_content,
                          headless=args.headless).run()
        )
        if results:
            export_to_excel(results, args.output)
            save_json(results)
            if not args.no_comments:
                from comments_step import collect_for
                collect_for(results, track_only=not args.all_tracks)
        return

    if args.url:
        c = DouyinCollector(args.min_digg, args.min_comment, args.min_collect,
                            headless=args.headless, with_content=not args.no_content)
        filtered = asyncio.run(c.run(args.url))
        if filtered:
            export_to_excel(filtered, args.output)
            save_json(filtered, "douyin_filtered.json")
            if not args.no_comments:
                from comments_step import collect_for
                collect_for(filtered, track_only=not args.all_tracks)
        return

    interactive()


if __name__ == "__main__":
    main()
