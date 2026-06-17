#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抓取 AI 领域 YouTube 博主,过滤粉丝数 1,000 - 1,000,000,导出 CSV。
用法:
    1. pip install requests
    2. 把下面 API_KEY 改成你自己的 key(或用环境变量 YT_API_KEY)
    3. python fetch_ai_youtubers.py

产出:
    ai_youtubers.csv   —— 所有通过过滤的频道(可直接用 Excel 打开)
    channel_ids.txt    —— 已收集的候选频道ID缓存(自动累积,永不丢失)

配额说明(重要):
    - search.list 每次花 100 单位,默认每天 10,000 单位 = 约 100 次 search。
    - channels.list 每次只花 1 单位,且与 search 的配额相对独立。
    所以即使 search 配额用尽,只要 channel_ids.txt 里有缓存,重跑也能继续查详情、补全 CSV。

多天补跑:
    脚本会先读取 channel_ids.txt 里已有的ID,再用 search 追加新的(search 配额够的话),
    然后对全部ID查详情。配额用尽会自动停下并保存,隔天再跑即可累积更多。
"""

import os, csv, sys
from datetime import datetime, timedelta, timezone
import requests

API_KEY = os.environ.get("YT_API_KEY", "在这里粘贴你的API_KEY")

TODAY = datetime.now().strftime("%Y-%m-%d")

TARGET_MIN = 1_000          # 粉丝下限
TARGET_MAX = 1_000_000      # 粉丝上限
WANT = int(os.environ.get("YT_WANT", "300"))  # 每天主名单数量
OUT = "ai_youtubers.csv"
IDS_CACHE = "channel_ids.txt"   # 候选频道ID缓存文件
SEEN_CACHE = "seen_channel_ids.txt"  # 已经导出过的频道ID,用于每天去重
RESULTS_ROOT = "daily_results"
DAY_DIR = os.path.join(RESULTS_ROOT, TODAY)
DAILY_OUT = os.path.join(DAY_DIR, f"selected_{WANT}.csv")
BACKUP_OUT = os.path.join(DAY_DIR, "backup_passed_filter.csv")
REJECTED_OUT = os.path.join(DAY_DIR, "rejected_by_filter.csv")
CHECKED_OUT = os.path.join(DAY_DIR, "all_checked_channels.csv")
DAY_IDS_OUT = os.path.join(DAY_DIR, "candidate_channel_ids.txt")

# 默认尽量跑满 search 配额。需要临时限额时可设置 YT_DAILY_SEARCH_LIMIT。
DAILY_SEARCH_LIMIT = int(os.environ.get("YT_DAILY_SEARCH_LIMIT", "0"))
MAX_PAGES_PER_PAIR = int(os.environ.get("YT_MAX_PAGES_PER_PAIR", "5"))
RECENT_DAYS = int(os.environ.get("YT_RECENT_DAYS", "14"))

# 搜索关键词(中英西多语,覆盖 AI 各细分)
QUERIES = [
    "artificial intelligence", "AI tutorial", "machine learning", "AI agents",
    "AI tools", "AI news", "LLM ChatGPT", "n8n AI automation", "deep learning",
    "generative AI", "AI coding",
    # 西班牙语
    "inteligencia artificial", "tutorial IA", "agentes de IA", "herramientas IA",
    "automatizacion IA",
    # 其他欧洲语言可按需加:德/法/意
    "kuenstliche intelligenz", "intelligence artificielle", "intelligenza artificiale",
]

# 地区偏好(ISO 国家码):西班牙 + 欧美主要国家
REGIONS = ["ES", "US", "GB", "DE", "FR", "IT", "NL", "IE", "PT"]

# 只保留这些国家的频道?(频道资料里的 country 字段;很多频道为空)
# 设为 None 表示不按 country 硬过滤(因为 country 经常缺失,硬过滤会漏掉很多人)
COUNTRY_WHITELIST = None  # 或例如 {"ES","US","GB","DE","FR","IT","NL","IE","PT"}

SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels"


def quota_exhausted(r):
    """判断响应是否为配额用尽。同时兼容 'quotaExceeded' 和 'Quota exceeded' 两种文案。"""
    if r.status_code in (403, 429):
        t = r.text.lower()
        return "quota" in t or "ratelimit" in t
    return False


def load_ids():
    if os.path.exists(IDS_CACHE):
        with open(IDS_CACHE, encoding="utf-8") as f:
            return set(line.strip() for line in f if line.strip())
    return set()


def save_set(path, values):
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(sorted(values)))


def load_set(path):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return set(line.strip() for line in f if line.strip())
    return set()


def save_ids(ids):
    with open(IDS_CACHE, "w", encoding="utf-8") as f:
        f.write("\n".join(sorted(ids)))


def daily_pairs():
    """按日期轮换搜索组合,避免每天从同一个关键词开始拿到重复结果。"""
    pairs = [(q, region) for q in QUERIES for region in REGIONS]
    if not pairs:
        return []
    day_index = datetime.now().toordinal()
    offset = day_index % len(pairs)
    rotated = pairs[offset:] + pairs[:offset]
    if DAILY_SEARCH_LIMIT > 0:
        return rotated[:DAILY_SEARCH_LIMIT]
    return rotated


def collect_channel_ids():
    ids = load_ids()
    today_ids = set()
    if ids:
        print(f"已从 {IDS_CACHE} 载入 {len(ids)} 个缓存ID,今天继续追加近期活跃频道 ...")

    published_after = (datetime.now(timezone.utc) - timedelta(days=RECENT_DAYS)).isoformat().replace("+00:00", "Z")

    search_calls = 0
    for q, region in daily_pairs():
        page = None
        for page_num in range(1, MAX_PAGES_PER_PAIR + 1):
            params = {
                "key": API_KEY,
                "part": "snippet",
                "type": "video",
                "q": q,
                "maxResults": 50,
                "regionCode": region,
                "relevanceLanguage": "es" if region == "ES" else "en",
                "order": "date",
                "publishedAfter": published_after,
                "safeSearch": "moderate",
            }
            if page:
                params["pageToken"] = page
            r = requests.get(SEARCH_URL, params=params, timeout=30)
            search_calls += 1
            if r.status_code != 200:
                if quota_exhausted(r):
                    print(f">>> search 配额已用完。本次 search 调用 {search_calls} 次,进入查详情阶段。")
                    save_ids(ids)
                    save_set(DAY_IDS_OUT, today_ids)
                    return ids, today_ids
                print(f"[search 警告] q={q} region={region} page={page_num} -> {r.status_code} {r.text[:200]}")
                break
            data = r.json()
            before = len(ids)
            for it in data.get("items", []):
                cid = it["snippet"].get("channelId")
                if cid:
                    ids.add(cid)
                    today_ids.add(cid)
            save_ids(ids)  # 每跑完一页就存盘,防止中途丢失
            save_set(DAY_IDS_OUT, today_ids)
            print(f"已收集频道ID: {len(ids)} (+{len(ids)-before})  今日新增/命中 {len(today_ids)}  (q='{q}' / {region} / 第 {page_num} 页)")
            page = data.get("nextPageToken")
            if not page:
                break
    print(f"search 组合已全部跑完。本次 search 调用 {search_calls} 次,未收到配额用尽提示。")
    return ids, today_ids


def fetch_details(ids, seen_ids=None):
    seen_ids = seen_ids or set()
    accepted = []
    rejected = []
    checked = []
    ids = [cid for cid in ids if cid not in seen_ids]
    if seen_ids:
        print(f"已排除历史导出过的频道 {len(seen_ids)} 个,剩余候选 {len(ids)} 个")
    for i in range(0, len(ids), 50):  # channels.list 一次最多 50 个
        batch = ids[i:i+50]
        params = {"key": API_KEY, "part": "snippet,statistics", "id": ",".join(batch)}
        r = requests.get(CHANNELS_URL, params=params, timeout=30)
        if r.status_code != 200:
            if quota_exhausted(r):
                print(f">>> channels 配额也用尽,用已查到的 {len(accepted)} 条继续。隔天重跑可补全。")
                break
            print(f"[channels 警告] {r.status_code} {r.text[:200]}")
            continue
        for it in r.json().get("items", []):
            stats = it.get("statistics", {})
            sn = it.get("snippet", {})
            cid = it["id"]
            country = sn.get("country", "")
            handle = sn.get("customUrl", "")
            url = f"https://www.youtube.com/{handle}" if handle else f"https://www.youtube.com/channel/{cid}"
            row = {
                "channel_id": cid,
                "name": sn.get("title", ""),
                "url": url,
                "subscribers": "",
                "country": country,
                "videos": stats.get("videoCount", ""),
                "views": stats.get("viewCount", ""),
                "description": (sn.get("description", "") or "").replace("\n", " ")[:160],
                "status": "accepted",
                "reject_reason": "",
            }
            if stats.get("hiddenSubscriberCount"):
                row["status"] = "rejected"
                row["reject_reason"] = "hidden_subscriber_count"
                rejected.append(row)
                checked.append(row)
                continue
            subs = int(stats.get("subscriberCount", 0))
            row["subscribers"] = subs
            if not (TARGET_MIN <= subs <= TARGET_MAX):
                row["status"] = "rejected"
                row["reject_reason"] = "subscriber_out_of_range"
                rejected.append(row)
                checked.append(row)
                continue
            if COUNTRY_WHITELIST and country not in COUNTRY_WHITELIST:
                row["status"] = "rejected"
                row["reject_reason"] = "country_not_allowed"
                rejected.append(row)
                checked.append(row)
                continue
            accepted.append(row)
            checked.append(row)
        print(f"已查详情: {min(i+50, len(ids))}/{len(ids)} 个候选,通过过滤 {len(accepted)} 条,排除 {len(rejected)} 条")
    return accepted, rejected, checked


def write_csv(path, rows, fields):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for row in rows:
            w.writerow({k: row.get(k, "") for k in fields})


def main():
    if "在这里" in API_KEY or not API_KEY:
        print("请先把 API_KEY 改成你自己的 key,或设置环境变量 YT_API_KEY。")
        sys.exit(1)
    os.makedirs(DAY_DIR, exist_ok=True)
    print("第1步:收集频道ID(读缓存 + search 追加)...")
    ids, today_ids = collect_channel_ids()
    print(f"共 {len(ids)} 个候选频道,开始查详情并过滤粉丝数 {TARGET_MIN}-{TARGET_MAX} ...")
    seen_ids = load_set(SEEN_CACHE)
    rows, rejected, checked = fetch_details(ids, seen_ids)
    # 去重 + 按粉丝数排序
    seen, uniq = set(), []
    for row in sorted(rows, key=lambda x: -x["subscribers"]):
        if row["url"] in seen:
            continue
        seen.add(row["url"]); uniq.append(row)

    selected = uniq[:WANT]
    backup = uniq[WANT:]
    if not selected:
        print(f"查到 0 条主名单,为避免覆盖,保留原有 {OUT} 不动。当天排除/检查记录仍会保存在 {DAY_DIR}。")
        fields_all = ["channel_id","name","url","subscribers","country","videos","views","status","reject_reason","description"]
        write_csv(REJECTED_OUT, rejected, fields_all)
        write_csv(CHECKED_OUT, checked, fields_all)
        return

    fields_public = ["name","url","subscribers","country","videos","views","description"]
    fields_internal = ["channel_id","name","url","subscribers","country","videos","views","status","reject_reason","description"]
    write_csv(OUT, selected, fields_public)
    write_csv(DAILY_OUT, selected, fields_public)
    write_csv(BACKUP_OUT, backup, fields_public)
    write_csv(REJECTED_OUT, rejected, fields_internal)
    write_csv(CHECKED_OUT, checked, fields_internal)

    # 主名单和备用名单都记入历史,保证明天优先找新频道。
    seen_ids.update(row["channel_id"] for row in selected + backup)
    save_set(SEEN_CACHE, seen_ids)
    print(f"完成!主名单 {len(selected)} 条: {DAILY_OUT}")
    print(f"备用名单 {len(backup)} 条: {BACKUP_OUT}")
    print(f"排除名单 {len(rejected)} 条: {REJECTED_OUT}")
    print(f"当天所有已检查频道 {len(checked)} 条: {CHECKED_OUT}")
    print(f"今日候选频道ID {len(today_ids)} 个: {DAY_IDS_OUT}")
    print(f"最新主名单也已同步到 {OUT}; 历史已记录 {len(seen_ids)} 个频道。")


if __name__ == "__main__":
    main()
