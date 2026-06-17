#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 ai_youtubers.csv 转成可点击的 HTML 表格 + Excel 可点击 CSV。
用法: python3 make_clickable.py
产出: ai_youtubers.html / ai_youtubers_clickable.csv
"""
import csv, html, os
from datetime import datetime

SRC = "ai_youtubers.csv"
HTML_OUT = "ai_youtubers.html"
CSV_OUT = "ai_youtubers_clickable.csv"
TODAY = datetime.now().strftime("%Y-%m-%d")
DAY_DIR = os.path.join("daily_results", TODAY)
DAY_HTML_OUT = os.path.join(DAY_DIR, "selected_clickable.html")
DAY_CSV_OUT = os.path.join(DAY_DIR, "selected_clickable.csv")


def main():
    with open(SRC, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    # 1) HTML:浏览器里直接点名字打开频道
    cells = []
    for r in rows:
        url = html.escape(r["url"], quote=True)
        name = html.escape(r["name"])
        cells.append(
            "<tr>"
            f'<td><a href="{url}" target="_blank" data-u="{url}">{name}</a></td>'
            f'<td class="num">{int(r["subscribers"]):,}</td>'
            f'<td>{html.escape(r["country"])}</td>'
            f'<td class="num">{html.escape(r["videos"])}</td>'
            f'<td class="num">{html.escape(r["views"])}</td>'
            f'<td>{html.escape(r["description"])}</td>'
            "</tr>"
        )
    doc = f"""<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8">
<title>AI YouTubers ({len(rows)})</title>
<style>
 body{{font-family:-apple-system,Segoe UI,Arial,sans-serif;margin:24px;color:#222}}
 h1{{font-size:18px}}
 table{{border-collapse:collapse;width:100%;font-size:13px}}
 th,td{{border:1px solid #ddd;padding:6px 9px;text-align:left;vertical-align:top}}
 th{{background:#f4f4f4;position:sticky;top:0}}
 tr:nth-child(even){{background:#fafafa}}
 td.num{{text-align:right;white-space:nowrap}}
 a{{color:#1a56db;text-decoration:none}} a:hover{{text-decoration:underline}}
 a.seen{{color:#9aa0a6;font-style:italic}}
 tr.seen{{background:#f0f0f0 !important}}
 td:last-child{{max-width:420px;color:#555}}
 #bar{{margin:8px 0 14px;font-size:13px;color:#555}}
 #bar button{{font-size:12px;margin-left:10px;cursor:pointer}}
</style></head><body>
<h1>AI YouTubers · 共 {len(rows)} 个频道(点名字打开频道)</h1>
<div id="bar">已看过 <b id="cnt">0</b> 个(点过的会变灰,关掉网页也记得)
<button onclick="clearSeen()">清除全部标记</button></div>
<table>
<thead><tr><th>名称</th><th>订阅数</th><th>国家</th><th>视频数</th><th>总播放</th><th>简介</th></tr></thead>
<tbody>
{chr(10).join(cells)}
</tbody></table>
<script>
 var KEY="ai_youtubers_seen";
 function load(){{try{{return JSON.parse(localStorage.getItem(KEY))||{{}}}}catch(e){{return {{}}}}}}
 function save(s){{localStorage.setItem(KEY,JSON.stringify(s))}}
 function mark(a){{a.classList.add("seen");var tr=a.closest("tr");if(tr)tr.classList.add("seen")}}
 function refresh(){{var s=load();document.getElementById("cnt").textContent=Object.keys(s).length}}
 function clearSeen(){{if(!confirm("清除全部已看过标记?"))return;localStorage.removeItem(KEY);
   document.querySelectorAll("a.seen").forEach(function(a){{a.classList.remove("seen");
     var tr=a.closest("tr");if(tr)tr.classList.remove("seen")}});refresh()}}
 var seen=load();
 document.querySelectorAll("a[data-u]").forEach(function(a){{
   if(seen[a.dataset.u])mark(a);
   a.addEventListener("click",function(){{var s=load();s[a.dataset.u]=1;save(s);mark(a);refresh()}});
 }});
 refresh();
</script>
</body></html>"""
    for path in [HTML_OUT, DAY_HTML_OUT] if os.path.isdir(DAY_DIR) else [HTML_OUT]:
        folder = os.path.dirname(path)
        if folder:
            os.makedirs(folder, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(doc)

    # 2) Excel 可点击 CSV:用 HYPERLINK 公式
    for path in [CSV_OUT, DAY_CSV_OUT] if os.path.isdir(DAY_DIR) else [CSV_OUT]:
        folder = os.path.dirname(path)
        if folder:
            os.makedirs(folder, exist_ok=True)
        with open(path, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(["name", "url", "subscribers", "country", "videos", "views", "description"])
            for r in rows:
                link = f'=HYPERLINK("{r["url"]}","{r["name"]}")'
                w.writerow([link, r["url"], r["subscribers"], r["country"],
                            r["videos"], r["views"], r["description"]])

    print(f"完成!{HTML_OUT}(浏览器打开,点名字进频道) / {CSV_OUT}(Excel 里点单元格跳转) 共 {len(rows)} 条")
    if os.path.isdir(DAY_DIR):
        print(f"当天副本已保存到 {DAY_HTML_OUT} / {DAY_CSV_OUT}")


if __name__ == "__main__":
    main()
