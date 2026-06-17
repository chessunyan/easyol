#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成一个本地 KOL 查看页面。

用法:
    python3 generate_kol_dashboard.py

产出:
    kol_dashboard.html
"""

import csv
import json
import os
import re
from datetime import datetime


DAILY_ROOT = "daily_results"
OUT = "kol_dashboard.html"
TODAY = datetime.now().strftime("%Y-%m-%d")


SECTIONS = [
    ("new", "未入飞书", "not_in_feishu.csv"),
    ("selected", "主名单", "selected_*.csv"),
    ("backup", "备用名单", "backup_passed_filter.csv"),
    ("rejected", "被筛掉", "rejected_by_filter.csv"),
    ("checked", "全部检查", "all_checked_channels.csv"),
]


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def clean_name(value):
    if not value:
        return ""
    match = re.match(r'^=HYPERLINK\(".*?","(.*)"\)$', value)
    return match.group(1) if match else value


def normalize_row(row):
    subscribers = row.get("subscribers", "")
    try:
        subscribers_num = int(float(str(subscribers).replace(",", ""))) if subscribers != "" else None
    except ValueError:
        subscribers_num = None
    return {
        "channel_id": row.get("channel_id", ""),
        "name": clean_name(row.get("name", "")),
        "url": row.get("url", ""),
        "subscribers": subscribers_num,
        "country": row.get("country", ""),
        "videos": row.get("videos", ""),
        "views": row.get("views", ""),
        "status": row.get("status", ""),
        "reject_reason": row.get("reject_reason", ""),
        "description": row.get("description", ""),
    }


def find_selected_file(day_dir):
    if not os.path.isdir(day_dir):
        return None
    for name in sorted(os.listdir(day_dir)):
        if name.startswith("selected_") and name.endswith(".csv") and name != "selected_clickable.csv":
            return os.path.join(day_dir, name)
    return None


def load_daily_results():
    days = []
    if not os.path.isdir(DAILY_ROOT):
        return days

    for day in sorted(os.listdir(DAILY_ROOT), reverse=True):
        day_dir = os.path.join(DAILY_ROOT, day)
        if not os.path.isdir(day_dir):
            continue
        sections = {}
        for key, label, filename in SECTIONS:
            path = find_selected_file(day_dir) if key == "selected" else os.path.join(day_dir, filename)
            rows = [normalize_row(r) for r in read_csv(path)] if path and os.path.exists(path) else []
            sections[key] = {"label": label, "rows": rows}
        total = sum(len(v["rows"]) for v in sections.values())
        if total:
            days.append({"date": day, "sections": sections})
    return days


def load_fallback():
    candidates = ["ai_youtubers.csv", "ai_youtubers_clickable.csv"]
    for path in candidates:
        if os.path.exists(path):
            rows = [normalize_row(r) for r in read_csv(path)]
            return [{
                "date": f"{TODAY} · 当前文件",
                "sections": {
                    "selected": {"label": "主名单", "rows": rows},
                    "backup": {"label": "备用名单", "rows": []},
                    "rejected": {"label": "被筛掉", "rows": []},
                    "checked": {"label": "全部检查", "rows": rows},
                },
            }]
    return []


def build_html(days):
    data = json.dumps(days, ensure_ascii=False)
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>YouTube KOL 每日看板</title>
<style>
:root {{
  --bg: #f7f8fb;
  --panel: #ffffff;
  --line: #d9dee8;
  --text: #172033;
  --muted: #687385;
  --accent: #0f766e;
  --accent-soft: #e6f4f1;
  --warn: #a16207;
  --bad: #b42318;
}}
* {{ box-sizing: border-box; }}
body {{
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, "PingFang SC", sans-serif;
}}
.app {{
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  min-height: 100vh;
}}
.side {{
  border-right: 1px solid var(--line);
  background: #fff;
  padding: 18px 14px;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: auto;
}}
.brand {{
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 2px 4px 18px;
}}
.mark {{
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: conic-gradient(from 210deg, #0f766e, #2f7dd1, #d97706, #0f766e);
}}
.brand h1 {{
  font-size: 16px;
  line-height: 1.2;
  margin: 0;
}}
.brand p {{
  color: var(--muted);
  margin: 2px 0 0;
  font-size: 12px;
}}
.date-btn {{
  width: 100%;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  padding: 10px 10px;
  border-radius: 8px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}}
.date-btn:hover {{ background: #f2f5f9; }}
.date-btn.active {{
  background: var(--accent-soft);
  border-color: #a8d8d0;
  color: #064e49;
}}
.date-count {{
  color: var(--muted);
  font-size: 12px;
}}
.main {{
  min-width: 0;
  padding: 22px;
}}
.topbar {{
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: start;
  margin-bottom: 16px;
}}
.title h2 {{
  margin: 0;
  font-size: 22px;
  letter-spacing: 0;
}}
.title p {{
  margin: 4px 0 0;
  color: var(--muted);
}}
.summary {{
  display: grid;
  grid-template-columns: repeat(4, minmax(112px, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}}
.metric {{
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px;
}}
.metric b {{
  display: block;
  font-size: 20px;
}}
.metric span {{
  color: var(--muted);
  font-size: 12px;
}}
.controls {{
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 130px 130px 150px;
  gap: 10px;
  margin-bottom: 14px;
}}
input, select {{
  width: 100%;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--text);
  border-radius: 8px;
  padding: 10px 11px;
  font: inherit;
}}
.tabs {{
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}}
.tab {{
  border: 1px solid var(--line);
  background: #fff;
  color: var(--text);
  cursor: pointer;
  border-radius: 8px;
  padding: 8px 11px;
}}
.tab.active {{
  background: #172033;
  border-color: #172033;
  color: #fff;
}}
.table-wrap {{
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: auto;
}}
table {{
  border-collapse: collapse;
  width: 100%;
  min-width: 980px;
}}
th, td {{
  border-bottom: 1px solid #edf0f5;
  padding: 10px 12px;
  text-align: left;
  vertical-align: top;
}}
th {{
  background: #f9fafc;
  color: #3a4658;
  font-size: 12px;
  position: sticky;
  top: 0;
  z-index: 1;
}}
.num {{ text-align: right; white-space: nowrap; }}
.name {{
  font-weight: 650;
  max-width: 260px;
}}
.desc {{
  color: var(--muted);
  max-width: 420px;
}}
.reason {{
  color: var(--warn);
  white-space: nowrap;
}}
.open {{
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 54px;
  height: 30px;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  text-decoration: none;
  font-size: 13px;
}}
.open:hover {{ filter: brightness(0.94); }}
.empty {{
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 28px;
  color: var(--muted);
  text-align: center;
}}
@media (max-width: 860px) {{
  .app {{ grid-template-columns: 1fr; }}
  .side {{
    position: static;
    height: auto;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }}
  .controls {{ grid-template-columns: 1fr 1fr; }}
  .summary {{ grid-template-columns: 1fr 1fr; }}
  .topbar {{ grid-template-columns: 1fr; }}
}}
</style>
</head>
<body>
<div class="app">
  <aside class="side">
    <div class="brand">
      <div class="mark" aria-hidden="true"></div>
      <div>
        <h1>YouTube KOL 看板</h1>
        <p>按天查看和直达频道</p>
      </div>
    </div>
    <div id="dates"></div>
  </aside>
  <main class="main">
    <div class="topbar">
      <div class="title">
        <h2 id="dateTitle">暂无数据</h2>
        <p id="dateMeta">运行抓取脚本后，这里会显示每天的频道名单。</p>
      </div>
    </div>
    <section class="summary" id="summary"></section>
    <section class="controls">
      <input id="q" type="search" placeholder="搜索名称、国家、简介">
      <input id="minSubs" inputmode="numeric" placeholder="最少粉丝">
      <input id="maxSubs" inputmode="numeric" placeholder="最多粉丝">
      <select id="sort">
        <option value="subs-desc">粉丝从高到低</option>
        <option value="subs-asc">粉丝从低到高</option>
        <option value="name">名称 A-Z</option>
      </select>
    </section>
    <section class="tabs" id="tabs"></section>
    <section id="content"></section>
  </main>
</div>
<script>
const DATA = {data};
const SECTION_ORDER = ["new", "selected", "backup", "rejected", "checked"];
let state = {{ day: 0, section: "new" }};

const labels = {{
  new: "未入飞书",
  selected: "主名单",
  backup: "备用名单",
  rejected: "被筛掉",
  checked: "全部检查"
}};

function formatNumber(value) {{
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : String(value);
}}

function currentDay() {{
  return DATA[state.day];
}}

function sectionRows(key) {{
  const day = currentDay();
  if (!day || !day.sections[key]) return [];
  return day.sections[key].rows || [];
}}

function rowText(row) {{
  return [row.name, row.country, row.description, row.reject_reason].join(" ").toLowerCase();
}}

function filteredRows() {{
  const q = document.getElementById("q").value.trim().toLowerCase();
  const min = Number(document.getElementById("minSubs").value || 0);
  const maxRaw = document.getElementById("maxSubs").value;
  const max = maxRaw ? Number(maxRaw) : Infinity;
  const sort = document.getElementById("sort").value;
  let rows = sectionRows(state.section).filter(row => {{
    const subs = row.subscribers === null ? null : Number(row.subscribers);
    if (q && !rowText(row).includes(q)) return false;
    if (subs !== null && Number.isFinite(min) && subs < min) return false;
    if (subs !== null && Number.isFinite(max) && subs > max) return false;
    return true;
  }});
  rows.sort((a, b) => {{
    const as = a.subscribers === null ? -1 : Number(a.subscribers);
    const bs = b.subscribers === null ? -1 : Number(b.subscribers);
    if (sort === "subs-asc") return as - bs;
    if (sort === "name") return String(a.name).localeCompare(String(b.name));
    return bs - as;
  }});
  return rows;
}}

function renderDates() {{
  const box = document.getElementById("dates");
  if (!DATA.length) {{
    box.innerHTML = '<div class="empty">还没有可显示的数据</div>';
    return;
  }}
  box.innerHTML = DATA.map((day, index) => {{
    const selected = day.sections.selected?.rows?.length || 0;
    const backup = day.sections.backup?.rows?.length || 0;
    return `<button class="date-btn ${{index === state.day ? "active" : ""}}" data-day="${{index}}">
      <span>${{day.date}}</span><span class="date-count">${{selected}} + ${{backup}}</span>
    </button>`;
  }}).join("");
  box.querySelectorAll("button").forEach(btn => {{
    btn.addEventListener("click", () => {{
      state.day = Number(btn.dataset.day);
      state.section = "selected";
      render();
    }});
  }});
}}

function renderSummary() {{
  const day = currentDay();
  const box = document.getElementById("summary");
  if (!day) {{
    box.innerHTML = "";
    return;
  }}
  box.innerHTML = SECTION_ORDER.map(key => {{
    const count = day.sections[key]?.rows?.length || 0;
    return `<div class="metric"><b>${{formatNumber(count)}}</b><span>${{labels[key]}}</span></div>`;
  }}).join("");
}}

function renderTabs() {{
  const box = document.getElementById("tabs");
  box.innerHTML = SECTION_ORDER.map(key => {{
    const count = sectionRows(key).length;
    return `<button class="tab ${{key === state.section ? "active" : ""}}" data-section="${{key}}">${{labels[key]}} · ${{formatNumber(count)}}</button>`;
  }}).join("");
  box.querySelectorAll("button").forEach(btn => {{
    btn.addEventListener("click", () => {{
      state.section = btn.dataset.section;
      render();
    }});
  }});
}}

function renderTable() {{
  const rows = filteredRows();
  const box = document.getElementById("content");
  if (!currentDay()) {{
    box.innerHTML = '<div class="empty">还没有数据。先运行 python3 fetch_ai_youtubers.py，再运行 python3 generate_kol_dashboard.py。</div>';
    return;
  }}
  if (!rows.length) {{
    box.innerHTML = '<div class="empty">当前筛选条件下没有频道。</div>';
    return;
  }}
  box.innerHTML = `<div class="table-wrap"><table>
    <thead>
      <tr>
        <th>频道</th><th class="num">粉丝</th><th>国家</th><th class="num">视频数</th><th class="num">总播放</th><th>筛选原因</th><th>简介</th><th>直达</th>
      </tr>
    </thead>
    <tbody>
      ${{rows.map(row => `<tr>
        <td class="name">${{escapeHtml(row.name || "未命名频道")}}</td>
        <td class="num">${{formatNumber(row.subscribers)}}</td>
        <td>${{escapeHtml(row.country || "")}}</td>
        <td class="num">${{formatNumber(row.videos)}}</td>
        <td class="num">${{formatNumber(row.views)}}</td>
        <td class="reason">${{escapeHtml(row.reject_reason || "")}}</td>
        <td class="desc">${{escapeHtml(row.description || "")}}</td>
        <td>${{row.url ? `<a class="open" href="${{escapeAttr(row.url)}}" target="_blank" rel="noopener">打开</a>` : ""}}</td>
      </tr>`).join("")}}
    </tbody>
  </table></div>`;
}}

function escapeHtml(value) {{
  return String(value).replace(/[&<>"']/g, ch => ({{ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }}[ch]));
}}

function escapeAttr(value) {{
  return escapeHtml(value);
}}

function render() {{
  const day = currentDay();
  document.getElementById("dateTitle").textContent = day ? day.date : "暂无数据";
  document.getElementById("dateMeta").textContent = day ? "点击“打开”可直接进入 YouTube 频道。" : "运行抓取脚本后，这里会显示每天的频道名单。";
  renderDates();
  renderSummary();
  renderTabs();
  renderTable();
}}

["q", "minSubs", "maxSubs", "sort"].forEach(id => {{
  document.getElementById(id).addEventListener("input", renderTable);
}});

render();
</script>
</body>
</html>
"""


def main():
    days = load_daily_results()
    if not days:
        days = load_fallback()
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(build_html(days))
    print(f"完成! 已生成 {OUT}, 共 {len(days)} 个日期。")


if __name__ == "__main__":
    main()
