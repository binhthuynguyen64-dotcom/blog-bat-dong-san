#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
==============================================================================
HỆ THỐNG ĐỒNG BỘ BẤT ĐỘNG SẢN: HỒNG CHÂU - NHÀ ƯNG Ý
MAIN ORCHESTRATOR (main.py)
Chạy toàn bộ quy trình:
  Bước 1: Cào & chuẩn hóa dữ liệu tin đăng (scraper.py)
  Bước 2: Phát hiện nhà giảm chào & tạo pitch gửi khách (price_tracker.py)
  Bước 3: So khớp tin mới & tin giảm chào với khách hàng CRM (matcher.py)
  Bước 4: Đồng bộ dữ liệu vào Google Sheet tab DATA_NHA qua Apps Script (nếu có)
==============================================================================
"""

import os
import sys
import json
import logging
import urllib.request
from urllib.parse import urlencode
from dotenv import load_dotenv

# Thiết lập đường dẫn thư mục gốc
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(BASE_DIR)

# Nạp biến môi trường từ .env
load_dotenv(os.path.join(BASE_DIR, ".env"))

from scraper import run_scraper, DEFAULT_OUTPUT_PATH, DEFAULT_BROKER_URL
from price_tracker import track_and_alert_price_drops, PRICE_HISTORY_PATH
from matcher import match_new_listings_with_clients

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("MainOrchestrator")


def sync_listings_to_google_sheet(listings: list) -> bool:
    """
    Gửi dữ liệu danh sách tin đăng lên Google Apps Script Web App
    để tự động cập nhật vào tab `DATA_NHA` trong Google Sheet.
    """
    gas_url = os.getenv("GAS_WEBAPP_URL")
    gas_key = os.getenv("GAS_API_KEY", "HongChauNhaUngY2026")

    if not gas_url:
        logger.info("Chưa cấu hình GAS_WEBAPP_URL. Bỏ qua đồng bộ vào Google Sheet DATA_NHA.")
        return False

    logger.info("Đang đồng bộ dữ liệu vào Google Sheet (tab DATA_NHA) qua Apps Script...")
    payload = {
        "action": "sync_listings",
        "api_key": gas_key,
        "listings": listings
    }

    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            gas_url,
            data=data,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            res_json = json.loads(resp.read().decode("utf-8"))
            if res_json.get("status") == "success":
                logger.info("Đã đồng bộ thành công vào Google Sheet tab DATA_NHA.")
                return True
            else:
                logger.warning(f"Apps Script phản hồi cảnh báo: {res_json}")
    except Exception as e:
        logger.error(f"Lỗi khi gửi dữ liệu sang Apps Script: {e}")

    return False


def sync_sold_status_from_gas(listings: list) -> int:
    """
    Gọi Google Apps Script Web App để lấy danh sách căn đã bán/đã cọc
    từ các sheet nguồn thực tế và đồng bộ cờ is_sold vào listings.
    """
    gas_url = os.getenv("GAS_WEBAPP_URL")
    gas_key = os.getenv("GAS_API_KEY", "HongChauNhaUngY2026")
    if not gas_url:
        return 0
    try:
        params = urlencode({"action": "get_listings", "api_key": gas_key})
        req = urllib.request.Request(f"{gas_url}?{params}", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("status") == "success" and "listings" in data:
                sold_ids = {str(x["id"]) for x in data["listings"] if x.get("is_sold")}
                updated_count = 0
                for item in listings:
                    if str(item.get("id")) in sold_ids:
                        if not item.get("is_sold"):
                            item["is_sold"] = True
                            updated_count += 1
                if updated_count > 0:
                    logger.info(f"Đã cập nhật trạng thái '🚫 Đã bán' cho {updated_count} căn từ Google Sheet.")
                return updated_count
    except Exception as e:
        logger.warning(f"Không thể đồng bộ trạng thái đã bán từ Google Apps Script: {e}")
    return 0


def fetch_traffic_report() -> dict:
    """
    Lấy dữ liệu thống kê lưu lượng truy cập từ Google Apps Script Web App.
    """
    gas_url = os.getenv("GAS_WEBAPP_URL")
    gas_key = os.getenv("GAS_API_KEY", "HongChauNhaUngY2026")
    default_report = {
        "today_views": 0,
        "today_pageviews": 0,
        "yesterday_views": 0,
        "total_views": 0,
        "today_drawer_opens": 0
    }
    if not gas_url:
        return default_report
    try:
        params = urlencode({"action": "get_traffic_report", "api_key": gas_key})
        req = urllib.request.Request(f"{gas_url}?{params}", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("status") == "success" and "report" in data:
                return data["report"]
    except Exception as e:
        logger.warning(f"Không thể lấy báo cáo truy cập từ Google Apps Script: {e}")
    return default_report


def main():
    logger.info("==================================================================")
    logger.info("BẮT ĐẦU CHU KỲ TỰ ĐỘNG ĐỒNG BỘ: HỒNG CHÂU - NHÀ ƯNG Ý")
    logger.info("==================================================================")

    # 1. Đọc danh sách ID cũ trước khi cào để phát hiện tin mới
    old_ids = set()
    if os.path.exists(DEFAULT_OUTPUT_PATH):
        try:
            with open(DEFAULT_OUTPUT_PATH, "r", encoding="utf-8") as f:
                old_items = json.load(f)
                old_ids = {x["id"] for x in old_items if x.get("status") == "active"}
        except Exception:
            pass

    # 2. Bước 1: Cào toàn bộ tin từ trang cá nhân môi giới
    broker_url = os.getenv("BROKER_URL", DEFAULT_BROKER_URL)
    current_listings = run_scraper(broker_url, DEFAULT_OUTPUT_PATH)

    # 2.1 Đồng bộ trạng thái Đã cọc/Đã bán từ Google Sheet nguồn
    sold_updated = sync_sold_status_from_gas(current_listings)
    if sold_updated > 0:
        with open(DEFAULT_OUTPUT_PATH, "w", encoding="utf-8") as f:
            json.dump(current_listings, f, ensure_ascii=False, indent=2)

    # 3. Bước 2: Theo dõi biến động giá & báo giảm chào
    dropped_items = track_and_alert_price_drops(current_listings, PRICE_HISTORY_PATH)

    # Cập nhật lại file listings.json nếu có biến động giảm giá
    if dropped_items:
        with open(DEFAULT_OUTPUT_PATH, "w", encoding="utf-8") as f:
            json.dump(current_listings, f, ensure_ascii=False, indent=2)

    # 4. Bước 3: Xác định các tin cần so khớp khách hàng
    # Gồm: (A) Tin mới tinh lần đầu xuất hiện HOẶC (B) Căn vừa giảm giá chào
    # Lưu ý: Bỏ qua hoàn toàn các căn đã cọc / đã bán (is_sold == True)
    new_active_listings = [
        item for item in current_listings
        if item.get("status") == "active" and not item.get("is_sold") and (item["id"] not in old_ids or item.get("is_price_dropped"))
    ]

    if new_active_listings:
        logger.info(f"Phát hiện {len(new_active_listings)} căn cần gợi ý khách (mới hoặc vừa giảm giá).")
        match_new_listings_with_clients(new_active_listings, min_score=75.0)
    else:
        logger.info("Không có tin mới hoặc giảm giá cần so khớp khách ở chu kỳ này.")

    # 5. Bước 4: Đồng bộ sang Google Sheet tab DATA_NHA (nếu đã cấu hình GAS)
    sync_listings_to_google_sheet(current_listings)

    # 6. Bước 5: Tự động cập nhật trực tiếp lên Blogger (Chỉ chạy ở local khi có token.json)
    token_path = os.path.join(BASE_DIR, "token.json")
    if os.path.exists(token_path):
        try:
            from blogger_publisher import publish_to_blogger
            blogger_res = publish_to_blogger()
            logger.info(f"Đã cập nhật trực tiếp lên Blogger: {blogger_res.get('url')}")
        except Exception as e:
            logger.warning(f"Bỏ qua cập nhật Blogger: {e}")
    else:
        logger.info("Môi trường đám mây/Actions không có token.json. Bỏ qua xuất bản HTML trực tiếp lên Blogger (Blogger nạp dữ liệu động từ listings.json).")

    # 7. Bước 6: Gửi Báo Cáo Tổng Kết Hàng Ngày về Telegram
    try:
        from price_tracker import send_telegram_alert
        from datetime import datetime
        today_vn = datetime.now().strftime("%d/%m/%Y")
        traffic = fetch_traffic_report()

        total_active = sum(1 for x in current_listings if x.get("status") == "active" and not x.get("is_sold"))
        total_sold = sum(1 for x in current_listings if x.get("is_sold"))
        new_count = len([x for x in current_listings if x.get("status") == "active" and not x.get("is_sold") and x["id"] not in old_ids])
        drop_count = len(dropped_items) if dropped_items else 0

        sold_info = f" | Đã bán: {total_sold}" if total_sold > 0 else ""
        report_msg = (
            f"📊 <b>BÁO CÁO KHO NHÀ HỒNG CHÂU ({today_vn})</b>\n\n"
            f"👀 Khách vào xem Blog hôm nay: <b>{traffic.get('today_views', 0)} khách</b> "
            f"({traffic.get('today_pageviews', 0)} lượt xem | Hôm qua: {traffic.get('yesterday_views', 0)} | Tổng: {traffic.get('total_views', 0)})\n"
            f"📋 Khách mở form tư vấn hôm nay: <b>{traffic.get('today_drawer_opens', 0)} lượt</b>\n"
            f"🏠 Tổng kho nhà đang mở bán: <b>{total_active} căn</b> ({sold_info}Tin mới hôm nay: +{new_count} | Giảm chào: {drop_count})\n"
            f"🔗 <a href=\"https://hongchaunhaungy.blogspot.com/p/kho-nha-that-gia-tot.html\">Mở trang Kho Nhà</a>"
        )
        send_telegram_alert(report_msg)
        logger.info("Đã gửi Báo Cáo Hàng Ngày qua Telegram Bot.")
    except Exception as e:
        logger.warning(f"Không thể gửi báo cáo Telegram: {e}")

    logger.info("==================================================================")
    logger.info("HOÀN TẤT CHU KỲ ĐỒNG BỘ!")
    logger.info("==================================================================")


if __name__ == "__main__":
    main()
