# -*- coding: utf-8 -*-
"""
抖音素材采集工具 - Web 版
两种模式：链接采集（粘贴链接直接取数据+文案）/ 主页采集（筛爆款）
运行后打开 http://127.0.0.1:5000
"""

import asyncio
import os
import threading

from flask import Flask, jsonify, render_template_string, request, send_file

from collector import (BASE_DIR, DEFAULT_MIN_COLLECT, DEFAULT_MIN_COMMENT,
                       DEFAULT_MIN_DIGG, DouyinCollector, LinkCollector,
                       export_to_excel, extract_links)

app = Flask(__name__)

task_status = {
    "running": False,
    "mode": "links",
    "progress": "",
    "videos": [],
    "filtered": [],
    "results": [],
}

HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>抖音素材采集工具</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #f5f5f5; padding: 20px; color: #222;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white; padding: 28px; border-radius: 12px; margin-bottom: 20px;
        }
        .header h1 { font-size: 26px; margin-bottom: 8px; }
        .header p { opacity: 0.9; font-size: 14px; }
        .card {
            background: white; padding: 24px; border-radius: 12px; margin-bottom: 20px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }
        .tabs { display: flex; gap: 8px; margin-bottom: 20px; }
        .tab {
            padding: 8px 18px; border-radius: 8px; cursor: pointer; font-size: 14px;
            background: #f0f0f5; color: #555; border: none;
        }
        .tab.active { background: #667eea; color: #fff; }
        .form-group { margin-bottom: 16px; }
        .form-group label { display: block; margin-bottom: 6px; font-weight: 500; color: #333; font-size: 14px; }
        .form-group input, .form-group textarea {
            width: 100%; padding: 10px 14px; border: 1px solid #ddd; border-radius: 8px;
            font-size: 14px; outline: none; font-family: inherit;
        }
        .form-group textarea { min-height: 150px; resize: vertical; line-height: 1.6; }
        .form-group input:focus, .form-group textarea:focus { border-color: #667eea; }
        .row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
        .btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white; border: none; padding: 12px 32px; border-radius: 8px;
            font-size: 16px; cursor: pointer;
        }
        .btn:hover { opacity: 0.9; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-ghost { background: #fff; color: #667eea; border: 1px solid #667eea; margin-left: 8px; }
        .progress { background: #f8f9fa; padding: 16px; border-radius: 8px; margin-top: 16px; display: none; }
        .progress.active { display: block; }
        .progress-text { color: #666; font-size: 14px; }
        .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 20px 0; }
        .stat-card {
            background: white; padding: 20px; border-radius: 12px; text-align: center;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }
        .stat-number { font-size: 26px; font-weight: bold; color: #667eea; }
        .stat-label { color: #999; font-size: 13px; margin-top: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #eee; vertical-align: top; }
        th { background: #f8f9fa; font-weight: 600; color: #333; }
        tr:hover { background: #f8f9fa; }
        .video-title { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .content-cell div { max-height: 110px; overflow-y: auto; color: #555; line-height: 1.6; }
        .link-cell a { color: #667eea; font-size: 12px; }
        .empty { text-align: center; color: #999; padding: 40px; }
        .hint { color: #888; font-size: 12px; margin-top: 6px; }
        .muted { color: #aaa; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>抖音素材采集工具</h1>
            <p>粘贴视频链接直接取数据 + 口播文案，或按主页批量筛爆款</p>
        </div>

        <div class="card">
            <div class="tabs">
                <button class="tab active" id="tabLinks" onclick="setMode('links')">链接采集</button>
                <button class="tab" id="tabHome" onclick="setMode('home')">主页采集</button>
            </div>

            <div id="panelLinks">
                <div class="form-group">
                    <label>视频链接（每行一条，支持短链和整段分享文案）</label>
                    <textarea id="links" placeholder="https://v.douyin.com/xxxxx/&#10;https://www.douyin.com/video/123456789&#10;也可以直接把抖音的分享文案整段粘进来"></textarea>
                    <div class="hint" id="linkCount">识别到 0 条链接</div>
                </div>
            </div>

            <div id="panelHome" style="display:none">
                <div class="form-group">
                    <label>抖音主页 URL</label>
                    <input type="text" id="url" placeholder="https://www.douyin.com/user/...">
                </div>
                <div class="row">
                    <div class="form-group">
                        <label>最低点赞数</label>
                        <input type="number" id="min_digg" value="3000">
                    </div>
                    <div class="form-group">
                        <label>最低评论数</label>
                        <input type="number" id="min_comment" value="50">
                    </div>
                    <div class="form-group">
                        <label>最低收藏数</label>
                        <input type="number" id="min_collect" value="1000">
                    </div>
                </div>
            </div>

            <button class="btn" id="startBtn" onclick="startCollect()">开始采集</button>
            <button class="btn btn-ghost" id="exportBtn" style="display:none" onclick="exportXlsx()">导出 Excel</button>

            <div class="progress" id="progress">
                <div class="progress-text" id="progressText">准备中...</div>
            </div>
        </div>

        <div class="stats" id="stats" style="display:none">
            <div class="stat-card"><div class="stat-number" id="totalVideos">0</div><div class="stat-label">采集总数</div></div>
            <div class="stat-card"><div class="stat-number" id="filteredVideos">0</div><div class="stat-label">结果条数</div></div>
            <div class="stat-card"><div class="stat-number" id="extractedCount">0</div><div class="stat-label">已提取文案</div></div>
            <div class="stat-card"><div class="stat-number" id="statusBadge">-</div><div class="stat-label">状态</div></div>
        </div>

        <div class="card" id="resultCard" style="display:none">
            <h3 style="margin-bottom: 16px; font-size: 15px;">采集结果</h3>
            <table>
                <thead id="thead"></thead>
                <tbody id="resultBody"></tbody>
            </table>
        </div>
    </div>

    <script>
        let mode = 'links';
        let pollTimer = null;

        function setMode(m) {
            mode = m;
            document.getElementById('tabLinks').classList.toggle('active', m === 'links');
            document.getElementById('tabHome').classList.toggle('active', m === 'home');
            document.getElementById('panelLinks').style.display = m === 'links' ? 'block' : 'none';
            document.getElementById('panelHome').style.display = m === 'home' ? 'block' : 'none';
        }

        document.getElementById('links').addEventListener('input', function () {
            const urls = this.value.match(/https?:\\/\\/[^\\s，,、；;"'）)】\\]]+/g) || [];
            document.getElementById('linkCount').textContent = '识别到 ' + urls.length + ' 条链接';
        });

        async function startCollect() {
            const payload = { mode: mode };
            if (mode === 'links') {
                payload.links = document.getElementById('links').value;
            } else {
                payload.url = document.getElementById('url').value;
                payload.min_digg = document.getElementById('min_digg').value;
                payload.min_comment = document.getElementById('min_comment').value;
                payload.min_collect = document.getElementById('min_collect').value;
                if (!payload.url) { alert('请输入抖音主页 URL'); return; }
            }

            document.getElementById('startBtn').disabled = true;
            document.getElementById('progress').classList.add('active');
            document.getElementById('stats').style.display = 'grid';
            document.getElementById('resultCard').style.display = 'block';
            document.getElementById('exportBtn').style.display = 'none';

            const res = await fetch('/api/start', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.error) {
                alert(data.error);
                document.getElementById('startBtn').disabled = false;
                return;
            }
            pollTimer = setInterval(pollStatus, 1000);
        }

        async function pollStatus() {
            const res = await fetch('/api/status');
            const data = await res.json();
            const rows = data.mode === 'links' ? data.results : data.filtered;

            document.getElementById('progressText').textContent = data.progress;
            document.getElementById('totalVideos').textContent =
                data.mode === 'links' ? rows.length : data.videos.length;
            document.getElementById('filteredVideos').textContent = rows.length;
            document.getElementById('extractedCount').textContent = rows.filter(v => v.content).length;
            document.getElementById('statusBadge').textContent = data.running ? '采集中' : '完成';

            document.getElementById('thead').innerHTML = data.mode === 'links'
                ? '<tr><th>作者</th><th>标题</th><th>点赞</th><th>评论</th><th>收藏</th><th>转发</th><th>链接</th><th>文案</th></tr>'
                : '<tr><th>作者</th><th>标题</th><th>点赞</th><th>评论</th><th>收藏</th><th>转发</th><th>文案</th></tr>';

            const tbody = document.getElementById('resultBody');
            tbody.innerHTML = '';
            rows.forEach(v => {
                const tr = document.createElement('tr');
                const linkCell = data.mode === 'links'
                    ? '<td class="link-cell"><a href="' + (v.url || '#') + '" target="_blank">打开视频</a></td>' : '';
                tr.innerHTML =
                    '<td>' + (v.author_name || '-') + '</td>' +
                    '<td class="video-title" title="' + (v.title || '') + '">' + ((v.title || '').slice(0, 32) || '-') + '</td>' +
                    '<td>' + fmt(v.digg_count) + '</td>' +
                    '<td>' + fmt(v.comment_count) + '</td>' +
                    '<td>' + fmt(v.collect_count) + '</td>' +
                    '<td>' + fmt(v.share_count) + '</td>' +
                    linkCell +
                    '<td class="content-cell"><div>' + (v.content || '<span class="muted">提取中...</span>') + '</div></td>';
                tbody.appendChild(tr);
            });

            if (!data.running) {
                clearInterval(pollTimer);
                document.getElementById('startBtn').disabled = false;
                document.getElementById('progressText').textContent = '采集完成';
                if (rows.length) document.getElementById('exportBtn').style.display = 'inline-block';
            }
        }

        function fmt(n) {
            n = Number(n || 0);
            return n >= 10000 ? (n / 10000).toFixed(1) + '万' : n;
        }

        function exportXlsx() {
            window.location.href = '/api/export';
        }
    </script>
</body>
</html>
"""


def run_links(links):
    results = []

    def on_progress(p):
        stage = p.get("stage")
        if stage == "fetch":
            task_status["progress"] = f"正在采集第 {p['current']}/{p['total']} 条链接..."
        elif stage == "done":
            results.append(p["item"])
            task_status["results"] = results
            task_status["progress"] = f"已完成 {p['current']}/{p['total']} 条"

    try:
        collector = LinkCollector(links, with_content=True, on_progress=on_progress)
        asyncio.run(collector.run())
        task_status["results"] = collector.results
        task_status["progress"] = "采集完成"
    except Exception as e:
        task_status["progress"] = f"出错了: {e}"
    finally:
        task_status["running"] = False


def run_home(url, min_digg, min_comment, min_collect):
    def on_progress(p):
        stage = p.get("stage")
        if stage == "scroll":
            task_status["progress"] = f"正在滚动加载视频（第 {p['current']} 轮）..."
        elif stage == "filtered":
            task_status["filtered"] = p["item"]
            task_status["progress"] = f"筛出 {p['total']} 个爆款，准备提取文案..."
        elif stage == "content":
            task_status["progress"] = f"正在提取文案 {p['current']}/{p['total']}..."

    try:
        collector = DouyinCollector(min_digg, min_comment, min_collect, on_progress=on_progress)
        filtered = asyncio.run(collector.run(url))
        task_status["videos"] = collector.videos
        task_status["filtered"] = filtered
        task_status["progress"] = "采集完成"
    except Exception as e:
        task_status["progress"] = f"出错了: {e}"
    finally:
        task_status["running"] = False


@app.route('/')
def index():
    return render_template_string(HTML_TEMPLATE)


@app.route('/api/start', methods=['POST'])
def start():
    if task_status["running"]:
        return jsonify({"error": "正在采集中，请等待完成"})

    data = request.json or {}
    mode = data.get("mode", "links")
    task_status["mode"] = mode
    task_status["progress"] = "准备中..."
    task_status["videos"] = []
    task_status["filtered"] = []
    task_status["results"] = []

    if mode == "links":
        links = extract_links(data.get("links", ""))
        if not links:
            return jsonify({"error": "没有识别到有效链接"})
        task_status["running"] = True
        threading.Thread(target=run_links, args=(links,), daemon=True).start()
        return jsonify({"success": True, "count": len(links)})

    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error": "请输入主页 URL"})
    args = (
        url,
        int(data.get("min_digg") or DEFAULT_MIN_DIGG),
        int(data.get("min_comment") or DEFAULT_MIN_COMMENT),
        int(data.get("min_collect") or DEFAULT_MIN_COLLECT),
    )
    task_status["running"] = True
    threading.Thread(target=run_home, args=args, daemon=True).start()
    return jsonify({"success": True})


@app.route('/api/status')
def status():
    return jsonify({
        "running": task_status["running"],
        "mode": task_status["mode"],
        "progress": task_status["progress"],
        "videos": task_status["videos"],
        "filtered": task_status["filtered"],
        "results": task_status["results"],
    })


@app.route('/api/export')
def export():
    rows = task_status["results"] if task_status["mode"] == "links" else task_status["filtered"]
    if not rows:
        return "暂无可导出的数据", 400
    path = export_to_excel(rows, "douyin_export.xlsx")
    if not path or not os.path.exists(path):
        return "导出失败", 500
    return send_file(path, as_attachment=True, download_name="douyin_export.xlsx")


if __name__ == '__main__':
    print("=" * 50)
    print("抖音素材采集工具 - Web 版")
    print("打开浏览器访问: http://127.0.0.1:5000")
    print("=" * 50)
    app.run(host='127.0.0.1', port=5000, debug=False)
