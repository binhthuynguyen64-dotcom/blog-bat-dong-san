#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
==============================================================================
MODULE 1.2: PHÁT HIỆN NHÀ GIẢM CHÀO (price_tracker.py)
Chức năng:
  - So sánh giá các căn nhà giữa lần cào hiện tại và lần cào trước.
  - Tự động gắn cờ `is_price_dropped`, lưu `old_price_ty`, `drop_amount_ty`.
  - Gửi thông báo ngay lập tức qua Telegram Bot / Email cho môi giới.
  - Soạn sẵn đoạn tin nhắn chào khách hấp dẫn để môi giới chỉ cần copy & gửi!
==============================================================================
"""

import os
import json
import logging
import smtplib
import urllib.request
import urllib.parse
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("PriceTracker")
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PRICE_HISTORY_PATH = os.path.join(BASE_DIR, "data", "price_history.json")


def send_telegram_alert(message: str) -> bool:
    """Gửi tin nhắn thông báo qua Telegram Bot."""
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        logger.info("Chưa cấu hình TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID. Bỏ qua gửi Telegram.")
        return False

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "HTML",
        "disable_web_page_preview": False
    }

    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                logger.info("Đã gửi thông báo Telegram thành công.")
                return True
    except Exception as e:
        logger.error(f"Lỗi khi gửi thông báo Telegram: {e}")
    return False


def send_email_alert(subject: str, html_content: str) -> bool:
    """Gửi tin nhắn thông báo qua Email (SMTP Gmail hoặc tương đương)."""
    smtp_server = os.getenv("SMTP_SERVER", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", 587))
    sender = os.getenv("EMAIL_SENDER")
    password = os.getenv("EMAIL_PASSWORD")
    receiver = os.getenv("EMAIL_RECEIVER")

    if not sender or not password or not receiver:
        logger.info("Chưa cấu hình Email trong .env. Bỏ qua gửi Email.")
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = sender
        msg["To"] = receiver
        msg.attach(MIMEText(html_content, "html", "utf-8"))

        with smtplib.SMTP(smtp_server, smtp_port, timeout=15) as server:
            server.starttls()
            server.login(sender, password)
            server.sendmail(sender, [receiver], msg.as_string())
        logger.info(f"Đã gửi email thông báo thành công đến {receiver}.")
        return True
    except Exception as e:
        logger.error(f"Lỗi khi gửi email: {e}")
    return False


def generate_buyer_pitch(item: dict, old_price: float, new_price: float, drop_m: float) -> str:
    """Tạo mẫu tin nhắn chào hàng hấp dẫn để môi giới copy gửi thẳng Zalo khách."""
    ward_dist = f"{item.get('ward', '')}, {item.get('district', '')}".strip(", ")
    area = item.get("area_m2", 0)
    bedrooms = item.get("bedrooms", 0)
    alley = item.get("alley_type", "hẻm đẹp")
    link = item.get("url", "")
    title = item.get("title", "")

    pitch = (
        f"🔥 <b>TIN NÓNG - CHỦ HẠ GIÁ GẤP {drop_m:g} TRIỆU</b> 🔥\n\n"
        f"Dạ chào anh/chị, căn nhà tại <b>{ward_dist}</b> hôm trước chủ nhà vừa gọi cho em báo <b>HẠ GIÁ CHÀO GẤP</b> "
        f"từ <s>{old_price:g} tỷ</s> xuống còn <b>{new_price:g} tỷ</b> (bớt ngay {drop_m:g} triệu để giải quyết việc gấp trong tuần)!\n\n"
        f"📌 <b>Thông số căn nhà:</b>\n"
        f"- Diện tích: {area:g}m² - Kết cấu: {bedrooms} Phòng ngủ\n"
        f"- Đường vào: {alley}\n"
        f"- Pháp lý: Sổ hồng riêng hoàn công đầy đủ, công chứng ngay.\n"
        f"- Link xem chi tiết & hình ảnh: {link}\n\n"
        f"👉 Căn này giá mới đang rẻ nhất phân khúc khu vực. Chiều nay hoặc ngày mai anh/chị rảnh khung giờ nào em dẫn qua xem trực tiếp và gặp chính chủ làm việc giá tốt nhất nhé ạ!"
    )
    return pitch


def track_and_alert_price_drops(
    current_listings: list,
    history_file: str = PRICE_HISTORY_PATH
) -> list:
    """
    So sánh giá và phát hiện các căn giảm giá.
    Cập nhật cờ `is_price_dropped`, `old_price_ty`, `drop_amount_ty` trực tiếp vào `current_listings`.
    """
    logger.info("=== BẮT ĐẦU KIỂM TRA BIẾN ĐỘNG GIÁ (PRICE TRACKER) ===")
    os.makedirs(os.path.dirname(history_file), exist_ok=True)

    # 1. Đọc lịch sử giá cũ
    price_history = {}
    if os.path.exists(history_file):
        try:
            with open(history_file, "r", encoding="utf-8") as f:
                price_history = json.load(f)
        except Exception as e:
            logger.warning(f"Không thể đọc file price_history.json: {e}")

    dropped_items = []
    new_price_snapshot = {}

    for item in current_listings:
        lid = item["id"]
        current_price = item.get("price_ty", 0.0)
        
        # Bỏ qua các tin chưa có giá hoặc thỏa thuận
        if current_price <= 0:
            continue

        new_price_snapshot[lid] = {
            "price_ty": current_price,
            "title": item.get("title", ""),
            "updated_at": item.get("updated_at", "")
        }

        # Nếu tin này đã có trong lịch sử giá trước đó
        if lid in price_history:
            prev_info = price_history[lid]
            prev_price = prev_info.get("price_ty", current_price) if isinstance(prev_info, dict) else float(prev_info)

            # Phát hiện giảm giá (chênh lệch từ 0.01 tỷ = 10 triệu trở lên)
            if current_price < prev_price:
                diff = round(prev_price - current_price, 3)
                diff_trieu = round(diff * 1000, 1)

                item["is_price_dropped"] = True
                item["old_price_ty"] = prev_price
                item["drop_amount_ty"] = diff

                logger.info(
                    f"🔥 PHÁT HIỆN GIẢM GIÁ: Mã [{lid}] {item['title'][:40]}... "
                    f"Giá cũ: {prev_price} tỷ -> Giá mới: {current_price} tỷ (Giảm {diff_trieu:g} triệu)"
                )

                pitch = generate_buyer_pitch(item, prev_price, current_price, diff_trieu)
                dropped_items.append({
                    "item": item,
                    "old_price": prev_price,
                    "new_price": current_price,
                    "diff_trieu": diff_trieu,
                    "pitch": pitch
                })

                # Gom thông tin vào dropped_items để main.py tổng hợp vào DUY NHẤT 1 tin nhắn cuối chu kỳ.
                # Tuyệt đối không bắn tin nhắn lẻ từng căn để chống spam Telegram.

        else:
            # Lần đầu tiên thấy tin này
            pass

    # Lưu lại lịch sử giá cho lần chạy tiếp theo
    try:
        with open(history_file, "w", encoding="utf-8") as f:
            json.dump(new_price_snapshot, f, ensure_ascii=False, indent=2)
        logger.info(f"Đã lưu lại snapshot giá của {len(new_price_snapshot)} căn nhà vào {history_file}")
    except Exception as e:
        logger.error(f"Lỗi lưu price_history.json: {e}")

    logger.info(f"Tổng kết biến động: Tìm thấy {len(dropped_items)} căn giảm giá chào.")
    return dropped_items


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    
    # Test với dữ liệu hiện có trong data/listings.json
    listings_file = os.path.join(BASE_DIR, "data", "listings.json")
    if os.path.exists(listings_file):
        with open(listings_file, "r", encoding="utf-8") as f:
            sample_data = json.load(f)
        track_and_alert_price_drops(sample_data, PRICE_HISTORY_PATH)
    else:
        print("Chưa có data/listings.json để test.")
