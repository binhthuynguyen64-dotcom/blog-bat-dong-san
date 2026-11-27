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
        "listings": listings,
        "overwrite_purposes": False
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


def sync_sheet_overrides_from_gas(listings: list) -> int:
    """
    Đồng bộ trạng thái đã bán (is_sold), trạng thái (status), mục đích (purposes), 
    phân loại dòng tiền (cashflow_subtype) từ Google Sheet / Apps Script Web App.
    Bảo toàn 100% các chỉnh sửa tay của người dùng trên tab DATA_NHA.
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
                gas_map = {str(x["id"]): x for x in data["listings"] if "id" in x}
                override_count = 0
                for item in listings:
                    lid = str(item.get("id"))
                    if lid in gas_map:
                        g_item = gas_map[lid]
                        
                        # 1. Trạng thái đã bán / đang bán (chuẩn hóa status sang 'active' hoặc 'sold')
                        if g_item.get("is_sold") is not None:
                            if item.get("is_sold") != bool(g_item.get("is_sold")):
                                item["is_sold"] = bool(g_item.get("is_sold"))
                                override_count += 1
                        if g_item.get("status"):
                            s_val = str(g_item.get("status")).strip().lower()
                            if "đã bán" in s_val or "da ban" in s_val or "đã cọc" in s_val or item.get("is_sold"):
                                item["is_sold"] = True
                                item["status"] = "sold"
                            else:
                                item["status"] = "active"

                        # 2. Phân loại mục đích (purposes) nếu người dùng đã chỉnh trên Sheet
                        g_purposes = g_item.get("purposes")
                        if g_purposes:
                            if isinstance(g_purposes, list) and len(g_purposes) > 0:
                                if item.get("purposes") != g_purposes:
                                    item["purposes"] = g_purposes
                                    override_count += 1
                            elif isinstance(g_purposes, str) and g_purposes.strip():
                                parsed_p = [p.strip() for p in g_purposes.split(",") if p.strip()]
                                if parsed_p and item.get("purposes") != parsed_p:
                                    item["purposes"] = parsed_p
                                    override_count += 1

                        # 3. Phân loại dòng tiền (cashflow_subtype) nếu người dùng đã chỉnh trên Sheet
                        if g_item.get("cashflow_subtype") is not None:
                            cf_val = str(g_item.get("cashflow_subtype")).strip()
                            if cf_val and item.get("cashflow_subtype") != cf_val:
                                item["cashflow_subtype"] = cf_val
                                override_count += 1

                        # 4. Mã SP (internal_code) - Chỉ chấp nhận mã hợp lệ có chứa số
                        if g_item.get("internal_code"):
                            val_code = str(g_item.get("internal_code")).strip().upper()
                            if val_code not in ["SP", "TIN", "BDS", "MSP", "DE", "VA"] and any(c.isdigit() for c in val_code):
                                item["internal_code"] = val_code
                            else:
                                item["internal_code"] = ""

                        # 5. Tiêu đề sản phẩm & Link website từ 7 sheet nguồn
                        if g_item.get("product_title"):
                            item["product_title"] = str(g_item.get("product_title")).strip()
                        if g_item.get("website_link"):
                            item["website_link"] = str(g_item.get("website_link")).strip()

                if override_count > 0:
                    logger.info(f"Đã đồng bộ {override_count} cập nhật trạng thái/mục đích/dòng tiền từ Google Sheet vào dữ liệu.")
                return override_count
    except Exception as e:
        logger.warning(f"Không thể đồng bộ dữ liệu từ Google Apps Script: {e}")
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


def check_bot_paused_from_gas() -> bool:
    """
    Kiểm tra xem bot có đang ở trạng thái tạm dừng (BOT_PAUSED) hay không
    qua API của Google Apps Script Web App.
    """
    gas_url = os.getenv("GAS_WEBAPP_URL")
    gas_key = os.getenv("GAS_API_KEY", "HongChauNhaUngY2026")
    if not gas_url:
        return False
    try:
        params = urlencode({"action": "check_bot_status", "api_key": gas_key})
        req = urllib.request.Request(f"{gas_url}?{params}", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("status") == "success":
                return bool(data.get("bot_paused"))
    except Exception as e:
        logger.warning(f"Không thể kiểm tra trạng thái bot từ GAS: {e}")
    return False


def audit_missing_internal_codes(listings: list) -> list:
    """
    Quét và báo cáo danh sách tin đăng đang mở bán nhưng thiếu Mã SP hợp lệ
    (hoặc bị dính chuỗi rác như SP, TIN, BDS).
    In danh sách kèm link trực tiếp ra console để tiện sửa trên nhadat247.vn.
    """
    missing_items = []
    invalid_codes = {"", "SP", "TIN", "BDS", "MSP", "DE", "VA"}
    for item in listings:
        if item.get("status") == "active" and not item.get("is_sold"):
            code = (item.get("internal_code") or "").strip().upper()
            if not code or code in invalid_codes or not any(c.isdigit() for c in code):
                missing_items.append(item)

    if missing_items:
        logger.warning(f"⚠️ PHÁT HIỆN {len(missing_items)} CĂN ĐANG BÁN THIẾU MÃ SP HỢP LỆ:")
        for idx, item in enumerate(missing_items, 1):
            logger.warning(f"  {idx}. [{item.get('id')}] {item.get('title', '')[:45]} | {item.get('price_text', '')} | {item.get('url', '')}")
    else:
        logger.info("✅ Toàn bộ các căn đang mở bán đều có Mã SP hợp lệ!")

    return missing_items


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

    # 2.1 Đồng bộ ngược các trường chỉnh sửa tay (purposes, cashflow_subtype, is_sold) từ Google Sheet
    overrides_applied = sync_sheet_overrides_from_gas(current_listings)
    if overrides_applied > 0:
        with open(DEFAULT_OUTPUT_PATH, "w", encoding="utf-8") as f:
            json.dump(current_listings, f, ensure_ascii=False, indent=2)

    # 2.2 Quét và audit các tin đang bán nhưng thiếu Mã SP nội bộ
    missing_code_listings = audit_missing_internal_codes(current_listings)

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

    matched_houses_count = 0
    if new_active_listings:
        logger.info(f"Phát hiện {len(new_active_listings)} căn cần gợi ý khách (mới hoặc vừa giảm giá).")
        matches = match_new_listings_with_clients(new_active_listings, min_score=75.0)
        matched_houses_count = len(matches) if matches else 0
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

    # 7. Bước 6: Gửi DUY NHẤT 1 Báo Cáo Tổng Hợp Chu Kỳ về Telegram (chống spam & tôn trọng BOT_PAUSED)
    try:
        is_paused = check_bot_paused_from_gas()
        if is_paused:
            logger.info("🛑 Bot đang ở trạng thái TẠM DỪNG (BOT_PAUSED = True). Bỏ qua gửi báo cáo Telegram.")
        else:
            from price_tracker import send_telegram_alert
            from datetime import datetime
            today_vn = datetime.now().strftime("%d/%m/%Y")
            traffic = fetch_traffic_report()

            total_active = sum(1 for x in current_listings if x.get("status") == "active" and not x.get("is_sold"))
            total_sold = sum(1 for x in current_listings if x.get("is_sold"))
            new_count = len([x for x in current_listings if x.get("status") == "active" and not x.get("is_sold") and x["id"] not in old_ids])
            drop_count = len(dropped_items) if dropped_items else 0

            sold_info = f" | Đã bán: {total_sold}" if total_sold > 0 else ""
            
            # Khối danh sách căn giảm chào tóm tắt nếu có
            drop_summary = ""
            if dropped_items:
                drop_summary = "\n\n🔥 <b>CÁC CĂN GIẢM CHÀO MỚI:</b>\n"
                for idx, d in enumerate(dropped_items[:5], 1):
                    it = d["item"]
                    drop_summary += f"{idx}. <b>{it.get('title')[:36]}</b>: <s>{d['old_price']:g} tỷ</s> ➔ <b>{d['new_price']:g} tỷ</b> (-{d['diff_trieu']:g}Tr)\n"
                if len(dropped_items) > 5:
                    drop_summary += f"<i>... và còn {len(dropped_items) - 5} căn khác vừa hạ giá.</i>\n"

            # Khối tóm tắt gợi ý khách hàng CRM nếu có
            match_summary = ""
            if matched_houses_count > 0:
                match_summary = f"\n🎯 <b>Gợi ý khách CRM:</b> Đã lưu <b>{matched_houses_count} căn khớp khách</b> vào tab GOI_Y_KHACH\n"

            report_msg = (
                f"📊 <b>BÁO CÁO KHO NHÀ HỒNG CHÂU ({today_vn})</b>\n\n"
                f"👀 Khách vào xem Blog hôm nay: <b>{traffic.get('today_views', 0)} khách</b> "
                f"({traffic.get('today_pageviews', 0)} lượt xem | Hôm qua: {traffic.get('yesterday_views', 0)} | Tổng: {traffic.get('total_views', 0)})\n"
                f"📋 Khách mở form tư vấn hôm nay: <b>{traffic.get('today_drawer_opens', 0)} lượt</b>\n"
                f"🏠 Tổng kho nhà đang mở bán: <b>{total_active} căn</b> ({sold_info}Tin mới: +{new_count} | Giảm chào: {drop_count})"
                f"{drop_summary}"
                f"{match_summary}\n"
                f"🔗 <a href=\"https://hongchaunhaungy.blogspot.com/p/kho-nha-that-gia-tot.html\">Mở trang Kho Nhà</a>"
            )
            send_telegram_alert(report_msg)
            logger.info("Đã gửi Báo Cáo Tổng Hợp qua Telegram Bot.")
    except Exception as e:
        logger.warning(f"Không thể gửi báo cáo Telegram: {e}")

    logger.info("==================================================================")
    logger.info("HOÀN TẤT CHU KỲ ĐỒNG BỘ!")
    logger.info("==================================================================")


if __name__ == "__main__":
    main()
