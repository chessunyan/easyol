#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""抓取日本 AI 领域 YouTube KOL。

用法:
    YT_API_KEY="你的 YouTube Data API key" python3 fetch_japan_ai_kols.py

也兼容 YOUTUBE_API_KEY / GOOGLE_API_KEY。脚本会尽量跑完今天可用的
search.list 配额；配额耗尽后会保存已收集频道，并继续用 channels.list
补全详情。
"""

import csv
import os
import sys
from datetime import datetime, timedelta, timezone

import requests


API_KEY = (
    os.environ.get("YT_API_KEY")
    or os.environ.get("YOUTUBE_API_KEY")
    or os.environ.get("GOOGLE_API_KEY")
    or ""
)

TODAY = datetime.now().strftime("%Y-%m-%d")
RUN_LABEL = f"{TODAY}-japan-ai"

TARGET_MIN = int(os.environ.get("YT_TARGET_MIN", "1000"))
TARGET_MAX = int(os.environ.get("YT_TARGET_MAX", "1000000"))
WANT = int(os.environ.get("YT_WANT", "300"))

RESULTS_ROOT = "daily_results"
DAY_DIR = os.path.join(RESULTS_ROOT, RUN_LABEL)
IDS_CACHE = "japan_ai_channel_ids.txt"
SEEN_CACHE = "japan_ai_seen_channel_ids.txt"

OUT = "japan_ai_youtubers.csv"
DAILY_OUT = os.path.join(DAY_DIR, f"selected_{WANT}.csv")
BACKUP_OUT = os.path.join(DAY_DIR, "backup_passed_filter.csv")
REJECTED_OUT = os.path.join(DAY_DIR, "rejected_by_filter.csv")
CHECKED_OUT = os.path.join(DAY_DIR, "all_checked_channels.csv")
DAY_IDS_OUT = os.path.join(DAY_DIR, "candidate_channel_ids.txt")

# 0 表示不主动限额，跑到组合结束或 API 返回 quotaExceeded。
DAILY_SEARCH_LIMIT = int(os.environ.get("YT_DAILY_SEARCH_LIMIT", "0"))
MAX_PAGES_PER_QUERY = int(os.environ.get("YT_MAX_PAGES_PER_QUERY", "5"))
RECENT_DAYS = int(os.environ.get("YT_RECENT_DAYS", "30"))

SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels"

QUERIES = [
    "AIエージェント",
    "AI エージェント 使い方",
    "自律型AIエージェント",
    "エージェントAI 解説",
    "Claude 使い方",
    "Claude Code 使い方",
    "Claude Opus 解説",
    "Claude Opus 4 日本語",
    "ChatGPT 活用",
    "ChatGPT 使い方",
    "ChatGPT 業務効率化",
    "ChatGPT 自動化",
    "Codex 使い方",
    "OpenAI Codex 日本語",
    "Codex AI コーディング",
    "Manus AI 日本語",
    "Manus 使い方",
    "Manus AI 解説",
    "OpenClaw 使い方",
    "OpenClaw 日本語",
    "生成AI 最新",
    "生成AI ニュース",
    "生成AI 活用",
    "人工知能 解説",
    "AIツール おすすめ",
    "AIツール 最新",
    "AI自動化",
    "AI コーディング",
    "AI開発",
    "AI副業",
    "バイブコーディング",
    "Cursor AI 使い方",
    "Dify 使い方",
    "n8n AI 自動化",
    "Devin AI 日本語",
    "Gemini AI 使い方",
    "RAG 生成AI",
    "プロンプトエンジニアリング",
]

JAPANESE_MARKERS = ("AI", "生成AI", "人工知能", "ChatGPT", "Claude", "Codex", "Manus", "LLM", "エージェント")


def has_japanese(text):
    return any(
        ("\u3040" <= char <= "\u30ff") or ("\u4e00" <= char <= "\u9fff")
        for char in text or ""
    )


def quota_exhausted(response):
    if response.status_code in (403, 429):
        text = response.text.lower()
        return "quota" in text or "ratelimit" in text
    return False


def load_set(path):
    if not os.path.exists(path):
        return set()
    with open(path, encoding="utf-8") as handle:
        return set(line.strip() for line in handle if line.strip())


def save_set(path, values):
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(sorted(values)))


def query_plan():
    queries = list(QUERIES)
    offset = datetime.now().toordinal() % len(queries)
    queries = queries[offset:] + queries[:offset]
    if DAILY_SEARCH_LIMIT > 0:
        return queries[:DAILY_SEARCH_LIMIT]
    return queries


def collect_channel_ids():
    ids = load_set(IDS_CACHE)
    today_ids = set()
    if ids:
        print(f"已载入日本 AI 候选缓存 {len(ids)} 个频道，继续追加。")

    published_after = (
        datetime.now(timezone.utc) - timedelta(days=RECENT_DAYS)
    ).isoformat().replace("+00:00", "Z")

    search_calls = 0
    for query in query_plan():
        page_token = None
        for page_num in range(1, MAX_PAGES_PER_QUERY + 1):
            params = {
                "key": API_KEY,
                "part": "snippet",
                "type": "video",
                "q": query,
                "maxResults": 50,
                "regionCode": "JP",
                "relevanceLanguage": "ja",
                "order": "date",
                "publishedAfter": published_after,
                "safeSearch": "moderate",
            }
            if page_token:
                params["pageToken"] = page_token

            response = requests.get(SEARCH_URL, params=params, timeout=30)
            search_calls += 1
            if response.status_code != 200:
                if quota_exhausted(response):
                    print(f">>> search 配额已用完。本次 search 调用 {search_calls} 次。")
                    save_set(IDS_CACHE, ids)
                    save_set(DAY_IDS_OUT, today_ids)
                    return ids, today_ids
                print(f"[search 警告] q={query} page={page_num} -> {response.status_code} {response.text[:200]}")
                break

            data = response.json()
            before = len(ids)
            for item in data.get("items", []):
                channel_id = item.get("snippet", {}).get("channelId")
                if channel_id:
                    ids.add(channel_id)
                    today_ids.add(channel_id)

            save_set(IDS_CACHE, ids)
            save_set(DAY_IDS_OUT, today_ids)
            print(
                f"已收集频道ID: {len(ids)} (+{len(ids) - before}) "
                f"今日命中 {len(today_ids)} (q='{query}' 第 {page_num} 页)"
            )

            page_token = data.get("nextPageToken")
            if not page_token:
                break

    print(f"搜索组合已全部跑完。本次 search 调用 {search_calls} 次，未收到配额用尽提示。")
    return ids, today_ids


def classify_channel(snippet):
    title = snippet.get("title", "")
    description = snippet.get("description", "") or ""
    country = snippet.get("country", "")
    text = f"{title} {description}"

    score = 0
    reasons = []
    if country == "JP":
        score += 3
        reasons.append("country_jp")
    if has_japanese(text):
        score += 2
        reasons.append("japanese_text")
    marker_hits = [marker for marker in JAPANESE_MARKERS if marker.lower() in text.lower()]
    if marker_hits:
        score += min(3, len(marker_hits))
        reasons.append("ai_keywords:" + "/".join(marker_hits[:4]))
    return score, ",".join(reasons)


def fetch_details(ids, seen_ids):
    accepted = []
    rejected = []
    checked = []
    ids = [channel_id for channel_id in ids if channel_id not in seen_ids]
    if seen_ids:
        print(f"已排除历史导出过的日本 AI 频道 {len(seen_ids)} 个，剩余候选 {len(ids)} 个。")

    for start in range(0, len(ids), 50):
        batch = ids[start:start + 50]
        params = {"key": API_KEY, "part": "snippet,statistics", "id": ",".join(batch)}
        response = requests.get(CHANNELS_URL, params=params, timeout=30)
        if response.status_code != 200:
            if quota_exhausted(response):
                print(f">>> channels 配额也用尽，已查到 {len(accepted)} 条可用频道。")
                break
            print(f"[channels 警告] {response.status_code} {response.text[:200]}")
            continue

        for item in response.json().get("items", []):
            stats = item.get("statistics", {})
            snippet = item.get("snippet", {})
            channel_id = item["id"]
            handle = snippet.get("customUrl", "")
            url = f"https://www.youtube.com/{handle}" if handle else f"https://www.youtube.com/channel/{channel_id}"
            score, locale_reason = classify_channel(snippet)
            row = {
                "channel_id": channel_id,
                "name": snippet.get("title", ""),
                "url": url,
                "subscribers": "",
                "country": snippet.get("country", ""),
                "videos": stats.get("videoCount", ""),
                "views": stats.get("viewCount", ""),
                "japan_ai_score": score,
                "locale_reason": locale_reason,
                "status": "accepted",
                "reject_reason": "",
                "description": (snippet.get("description", "") or "").replace("\n", " ")[:220],
            }

            if stats.get("hiddenSubscriberCount"):
                row["status"] = "rejected"
                row["reject_reason"] = "hidden_subscriber_count"
                rejected.append(row)
                checked.append(row)
                continue

            subscribers = int(stats.get("subscriberCount", 0))
            row["subscribers"] = subscribers
            if not (TARGET_MIN <= subscribers <= TARGET_MAX):
                row["status"] = "rejected"
                row["reject_reason"] = "subscriber_out_of_range"
                rejected.append(row)
                checked.append(row)
                continue
            if score < 3:
                row["status"] = "rejected"
                row["reject_reason"] = "not_japan_ai_enough"
                rejected.append(row)
                checked.append(row)
                continue

            accepted.append(row)
            checked.append(row)

        print(
            f"已查详情: {min(start + 50, len(ids))}/{len(ids)}，"
            f"通过 {len(accepted)}，排除 {len(rejected)}"
        )

    return accepted, rejected, checked


def write_csv(path, rows, fields):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in fields})


def main():
    if not API_KEY:
        print("没有检测到 YouTube API key。请设置 YT_API_KEY、YOUTUBE_API_KEY 或 GOOGLE_API_KEY 后重跑。")
        sys.exit(1)

    os.makedirs(DAY_DIR, exist_ok=True)
    print("第1步: 用日本地区 + 日语相关关键词收集频道ID...")
    ids, today_ids = collect_channel_ids()

    print(f"共 {len(ids)} 个候选频道，开始查详情并过滤粉丝数 {TARGET_MIN}-{TARGET_MAX}。")
    accepted, rejected, checked = fetch_details(ids, load_set(SEEN_CACHE))

    unique = {}
    for row in sorted(accepted, key=lambda item: (-int(item["subscribers"]), -int(item["japan_ai_score"]))):
        unique.setdefault(row["channel_id"], row)

    selected = list(unique.values())[:WANT]
    backup = list(unique.values())[WANT:]
    fields_public = [
        "name", "url", "subscribers", "country", "videos", "views",
        "japan_ai_score", "locale_reason", "description",
    ]
    fields_internal = [
        "channel_id", "name", "url", "subscribers", "country", "videos", "views",
        "japan_ai_score", "locale_reason", "status", "reject_reason", "description",
    ]

    write_csv(REJECTED_OUT, rejected, fields_internal)
    write_csv(CHECKED_OUT, checked, fields_internal)
    if selected:
        write_csv(OUT, selected, fields_public)
        write_csv(DAILY_OUT, selected, fields_public)
        write_csv(BACKUP_OUT, backup, fields_public)
        seen_ids = load_set(SEEN_CACHE)
        seen_ids.update(row["channel_id"] for row in selected + backup)
        save_set(SEEN_CACHE, seen_ids)
    else:
        print(f"查到 0 条主名单，为避免覆盖，保留原有 {OUT} 不动。")

    print(f"完成! 主名单 {len(selected)} 条: {DAILY_OUT}")
    print(f"备用名单 {len(backup)} 条: {BACKUP_OUT}")
    print(f"排除名单 {len(rejected)} 条: {REJECTED_OUT}")
    print(f"全部检查 {len(checked)} 条: {CHECKED_OUT}")
    print(f"今日候选频道ID {len(today_ids)} 个: {DAY_IDS_OUT}")


if __name__ == "__main__":
    main()
