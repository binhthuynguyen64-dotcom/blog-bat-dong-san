#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
==============================================================================
MODULE 1.3: GỢI Ý CĂN PHÙ HỢP CHO KHÁCH HÀNG (matcher.py)
Chức năng:
  - Đọc danh sách khách hàng từ tab `DS KHÁCH HÀNG` của Google Sheet.
  - Tự động bóc tách các tiêu chí nhu cầu: Tài chính, Khu vực, Số PN, Diện tích, Hẻm.
  - Chấm điểm độ tương thích (Matching Score 0-100%) theo 5 tiêu chí.
  - Khi có tin mới hoặc căn giảm giá, nếu độ khớp >= 60%, tự động gửi danh sách
    Top khách hàng tiềm năng nhất về Telegram / Email cho môi giới.
==============================================================================
"""

import os
import re
import csv
import json
import time
import logging
import urllib.request
from urllib.parse import urlencode

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("Matcher")
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DEFAULT_SHEET_CSV_URL = (
    "https://docs.google.com/spreadsheets/d/1wRZnlRKqBrGdI3yJjx1FNg3AdcdNPbRHRCATS2-95UA/export?format=csv&gid=1884454409"
)


def fetch_customer_list() -> list:
    """
    Tải danh sách khách hàng từ Google Sheet qua Apps Script API hoặc CSV export.
    """
    gas_url = os.getenv("GAS_WEBAPP_URL")
    gas_key = os.getenv("GAS_API_KEY")

    # Cách 1: Qua Google Apps Script Web App API nếu đã cấu hình
    if gas_url and gas_key:
        try:
            params = urlencode({"action": "get_clients", "api_key": gas_key})
            api_endpoint = f"{gas_url}?{params}"
            req = urllib.request.Request(api_endpoint, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=12) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if data.get("status") == "success" and "clients" in data:
                    logger.info(f"Đã tải {len(data['clients'])} khách hàng qua Apps Script Web App API.")
                    return data["clients"]
        except Exception as e:
            logger.warning(f"Không thể kết nối qua Apps Script API: {e}. Đang chuyển sang đọc CSV...")

    # Cách 2: Tải trực tiếp qua Google Sheet CSV Export
    csv_url = os.getenv("SHEET_CSV_URL", DEFAULT_SHEET_CSV_URL)
    try:
        req = urllib.request.Request(csv_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            content = resp.read().decode("utf-8", errors="ignore")
            reader = csv.reader(content.splitlines())
            rows = list(reader)
            if not rows:
                return []
            
            headers = [h.strip() for h in rows[0]]
            clients = []
            
            # Map tên cột linh hoạt
            def get_col(row, name_keywords, default=""):
                for idx, h in enumerate(headers):
                    if idx < len(row) and any(k.lower() in h.lower() for k in name_keywords):
                        return row[idx].strip()
                return default

            for r in rows[1:]:
                name = get_col(r, ["Tên liên lạc", "Tên", "Khách"])
                req_text = get_col(r, ["Yêu cầu", "Nhu cầu"])
                phone = get_col(r, ["Số điện thoại", "SĐT", "Điện thoại"])
                channel = get_col(r, ["Kênh liên lạc", "Kênh"])
                status = get_col(r, ["Hành động", "Trạng thái", "Giai đoạn"])

                # Bỏ qua khách đã ghi rõ ngừng liên lạc hoặc không có nhu cầu
                if not name or "Ngừng liên lạc" in status:
                    continue

                clients.append({
                    "name": name,
                    "phone": phone,
                    "channel": channel,
                    "requirement": req_text,
                    "status": status
                })

            logger.info(f"Đã nạp {len(clients)} khách hàng tiềm năng từ Google Sheet CSV.")
            return clients

    except Exception as e:
        logger.error(f"Lỗi khi tải danh sách khách hàng từ Sheet: {e}")
        return []


def parse_client_requirements(req_text: str) -> dict:
    """
    Phân tích chuỗi 'Yêu cầu của KH' để bóc tách các thông số định lượng.
    Ví dụ:
      'Tài chính: 5.4 trở xuống
       Khu vực: Song Hành - quận 12, Tân Hưng Thuận, Đông Hưng Thuận, Nguyễn Văn Quá
       Chi tiết: diện tích tốt, 3 PN'
    """
    text_lower = req_text.lower()
    
    # 1. Bóc tách Tài chính / Mức giá (tỷ VNĐ)
    max_price = 0.0
    min_price = 0.0
    
    m_range = re.search(r'([\d\.,]+)\s*(?:-|đến|tới)\s*([\d\.,]+)\s*t[ỷi]', text_lower)
    if m_range:
        min_price = float(m_range.group(1).replace(',', '.'))
        max_price = float(m_range.group(2).replace(',', '.'))
    else:
        m_max = re.search(r'([\d\.,]+)\s*(?:tỷ|ty|t)?\s*(?:trở xuống|quay đầu|đổ lại|đổ về|max)', text_lower)
        if m_max:
            max_price = float(m_max.group(1).replace(',', '.'))
        else:
            m_around = re.search(r'(?:quanh|tầm|khoảng|mốc|dưới)\s*([\d\.,]+)\s*(?:tỷ|ty|t)', text_lower)
            if m_around:
                max_price = float(m_around.group(1).replace(',', '.'))
            else:
                m_num = re.search(r'(\d+(?:\.\d+)?)\s*(?:tỷ|ty)', text_lower)
                if m_num:
                    max_price = float(m_num.group(1))

    # 2. Bóc tách Số phòng ngủ
    bedrooms = 0
    m_pn = re.search(r'(\d+)\s*(?:pn|phòng ngủ|phòng)', text_lower)
    if m_pn:
        bedrooms = int(m_pn.group(1))

    # 3. Bóc tách Diện tích (m²)
    min_area = 0.0
    m_area = re.search(r'(\d+)\s*(?:m2|m²)', text_lower)
    if m_area:
        min_area = float(m_area.group(1))

    # 4. Bóc tách yêu cầu Hẻm / Xe hơi
    needs_car_alley = any(k in text_lower for k in ["hxh", "xe hơi", "oto", "ô tô", "xe tai", "xe tải", "mặt tiền"])
    needs_bagac = any(k in text_lower for k in ["ba gác", "ba gac"])

    # 5. Bóc tách Khu vực / Địa điểm
    locations = []
    location_keywords = [
        "gò vấp", "quận 12", "q12", "tân bình", "tân phú", "bình thạnh", "phú nhuận", "quận 1", "quận 3",
        "thạnh lộc", "thạnh xuân", "tân hưng thuận", "đông hưng thuận", "nguyễn văn quá", "song hành",
        "trung mỹ tây", "an hội tây", "phan huy ích", "quang trung", "phạm văn chiêu", "lê văn thọ"
    ]
    for loc in location_keywords:
        if loc in text_lower:
            locations.append(loc)

    # 6. Bóc tách 4 nhóm Nhu cầu / Mục đích mua cốt lõi
    seeking_purposes = []
    if any(k in text_lower for k in ["đất", "đất nền", "thổ cư", "lô đất"]):
        seeking_purposes.append("dat")
    if any(k in text_lower for k in ["trọ", "chdv", "căn hộ dịch vụ", "dòng tiền", "cho thuê", "hợp đồng thuê", "thu nhập"]):
        seeking_purposes.append("dong_tien")
    if any(k in text_lower for k in ["kinh doanh", "buôn bán", "mặt tiền", "mở tiệm", "spa", "văn phòng", "công ty"]):
        seeking_purposes.append("kinh_doanh")
    if any(k in text_lower for k in ["để ở", "ở ngay", "gia đình", "ở định cư", "an ninh", "yên tĩnh"]):
        seeking_purposes.append("de_o")

    return {
        "max_price": max_price,
        "min_price": min_price,
        "bedrooms": bedrooms,
        "min_area": min_area,
        "needs_car_alley": needs_car_alley,
        "needs_bagac": needs_bagac,
        "locations": locations,
        "seeking_purposes": seeking_purposes,
        "raw_text": req_text
    }


def calculate_match_score(listing: dict, client: dict) -> tuple:
    """
    Tính điểm tương thích (0% -> 100%) giữa 1 căn nhà với 1 khách hàng theo 5 tiêu chí:
    1. Vị trí / Khu vực (30%)
    2. Mức giá (biên độ ±10%) (25%)
    3. Diện tích (15%)
    4. Số phòng ngủ (15%)
    5. Đường vào / Hẻm (15%)
    Trả về: (score_percent, match_reasons)
    """
    req = parse_client_requirements(client.get("requirement", ""))
    score = 0.0
    reasons = []

    listing_title = listing.get("title", "").lower()
    listing_desc = listing.get("description", "").lower()
    listing_ward = listing.get("ward", "").lower()
    listing_dist = listing.get("district", "").lower()
    listing_price = listing.get("price_ty", 0.0)
    listing_area = listing.get("area_m2", 0.0)
    listing_bed = listing.get("bedrooms", 0)
    listing_alley_w = listing.get("alley_width_m", 0.0)
    listing_alley_type = listing.get("alley_type", "").lower()

    # --- 1. TIÊU CHÍ VỊ TRÍ / KHU VỰC (Trọng số 30%) ---
    loc_matched = False
    if req["locations"]:
        for loc in req["locations"]:
            if (loc in listing_ward or loc in listing_dist or 
                loc in listing_title or loc in listing_desc):
                score += 30.0
                reasons.append(f"Đúng khu vực mong muốn '{loc.title()}' (+30%)")
                loc_matched = True
                break
        if not loc_matched:
            # Nếu khách tìm quận 12 nhưng nhà ở Gò Vấp sát vách (Phan Huy Ích, An Hội Tây)
            if "quận 12" in req["locations"] and "gò vấp" in listing_dist:
                score += 15.0
                reasons.append("Khu vực lân cận giáp ranh (+15%)")
    else:
        # Khách không ghi cụ thể khu vực
        score += 15.0

    # --- 2. TIÊU CHÍ MỨC GIÁ (Trọng số 25% - Cho phép biên độ ±10%) ---
    if req["max_price"] > 0 and listing_price > 0:
        max_budget = req["max_price"]
        # Trong tầm giá hoàn toàn
        if listing_price <= max_budget:
            score += 25.0
            reasons.append(f"Giá {listing_price} tỷ hoàn toàn trong ngân sách {max_budget} tỷ (+25%)")
        # Vượt nhẹ trong biên độ thương lượng 10%
        elif listing_price <= max_budget * 1.10:
            score += 18.0
            reasons.append(f"Giá {listing_price} tỷ nhỉnh nhẹ ngân sách {max_budget} tỷ nhưng đàm phán được (+18%)")
        else:
            # Vượt quá ngân sách
            score += 0.0
    else:
        score += 15.0

    # --- 3. TIÊU CHÍ SỐ PHÒNG NGỦ (Trọng số 15%) ---
    if req["bedrooms"] > 0:
        if listing_bed >= req["bedrooms"]:
            score += 15.0
            reasons.append(f"Đáp ứng đủ {listing_bed} PN (khách cần {req['bedrooms']} PN) (+15%)")
        elif listing_bed == req["bedrooms"] - 1:
            score += 8.0
            reasons.append(f"Có {listing_bed} PN (nhu cầu {req['bedrooms']} PN) (+8%)")
    else:
        score += 10.0

    # --- 4. TIÊU CHÍ DIỆN TÍCH (Trọng số 15%) ---
    if req["min_area"] > 0:
        if listing_area >= req["min_area"]:
            score += 15.0
            reasons.append(f"Diện tích {listing_area}m² đạt chuẩn (+15%)")
        elif listing_area >= req["min_area"] * 0.9:
            score += 10.0
    else:
        # Nếu khách ghi 'diện tích tốt' và căn nhà >= 35m²
        if "diện tích tốt" in req["raw_text"].lower() and listing_area >= 35:
            score += 15.0
            reasons.append(f"Diện tích {listing_area}m² rộng rãi phù hợp (+15%)")
        else:
            score += 10.0

    # --- 5. TIÊU CHÍ ĐƯỜNG VÀO / HẺM (Trọng số 15%) ---
    if req["needs_car_alley"]:
        if listing_alley_w >= 4.0 or "hơi" in listing_alley_type or "mặt tiền" in listing_alley_type:
            score += 15.0
            reasons.append("Đúng tiêu chuẩn Hẻm Xe Hơi / Ô tô (+15%)")
        else:
            score += 0.0
    elif req["needs_bagac"]:
        if listing_alley_w >= 3.0:
            score += 15.0
            reasons.append("Hẻm ba gác thông thoáng (+15%)")
    else:
        score += 10.0

    # --- 6. TIÊU CHÍ MỤC ĐÍCH PHÙ HỢP (Ưu tiên cộng điểm +20%) ---
    listing_purposes = listing.get("purposes", [])
    if req.get("seeking_purposes") and listing_purposes:
        for sp in req["seeking_purposes"]:
            if sp in listing_purposes:
                score += 20.0
                purpose_label_map = {
                    "dat": "Mua đất nền / Đất thổ cư",
                    "dong_tien": "BĐS Dòng tiền (Trọ / CHDV)",
                    "kinh_doanh": "Mua để Kinh doanh / Văn phòng",
                    "de_o": "Mua để ở gia đình"
                }
                reasons.append(f"Khớp đúng nhu cầu '{purpose_label_map.get(sp, sp)}' (+20%)")
                break

    score = round(min(100.0, score), 1)
    return score, reasons


def sync_matches_to_sheet(matches: list) -> bool:
    """
    Gửi danh sách gợi ý khách hàng lên Google Apps Script Web App
    để tự động lưu vào tab `GOI_Y_KHACH` trong Google Sheet.
    """
    gas_url = os.getenv("GAS_WEBAPP_URL")
    gas_key = os.getenv("GAS_API_KEY", "HongChauNhaUngY2026")

    if not gas_url or not matches:
        return False

    logger.info(f"Đang đồng bộ {len(matches)} gợi ý khách vào Google Sheet tab GOI_Y_KHACH...")
    payload = {
        "action": "sync_matches",
        "api_key": gas_key,
        "matches": matches
    }

    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            gas_url,
            data=data,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw_resp = resp.read().decode("utf-8")
            if not raw_resp:
                logger.info("Apps Script đã tiếp nhận yêu cầu đồng bộ GOI_Y_KHACH.")
                return True
            try:
                res_json = json.loads(raw_resp)
                if res_json.get("status") == "success":
                    logger.info(f"Đã lưu thành công các gợi ý khách vào tab GOI_Y_KHACH: {res_json.get('message')}")
                    return True
                else:
                    logger.warning(f"Apps Script phản hồi: {res_json}")
            except Exception:
                logger.info("Apps Script đã tiếp nhận dữ liệu thành công.")
                return True
    except Exception as e:
        logger.error(f"Lỗi khi gửi gợi ý khách sang Apps Script (Lưu ý cần deploy New Version trong Apps Script): {e}")

    return False


def match_new_listings_with_clients(new_listings: list, min_score: float = 75.0) -> dict:
    """
    Quét danh sách tin mới và so khớp với toàn bộ khách hàng trong Sheet.
    Lọc nhiễu: Ngưỡng min_score = 75.0 và lấy Top 3 khách sát nhất.
    Định dạng tin nhắn Telegram 1-click pitch và đồng bộ vào Sheet tab GOI_Y_KHACH.
    """
    logger.info(f"=== BẮT ĐẦU SO KHỚP TIN ĐĂNG VỚI KHÁCH HÀNG (Ngưỡng {min_score}%, Top 3) ===")
    clients = fetch_customer_list()
    if not clients:
        logger.warning("Không có dữ liệu khách hàng để so khớp.")
        return {}

    from price_tracker import send_telegram_alert, send_email_alert

    all_matches = {}
    all_sheet_matches = []
    number_emojis = ["1️⃣", "2️⃣", "3️⃣"]

    for item in new_listings:
        # Bỏ qua căn đã cọc hoặc đã bán
        if item.get("is_sold"):
            continue

        matched_clients = []
        for c in clients:
            score, reasons = calculate_match_score(item, c)
            if score >= min_score:
                matched_clients.append({
                    "client": c,
                    "score": score,
                    "reasons": reasons
                })

        # Sắp xếp khách hàng khớp nhất lên đầu
        matched_clients.sort(key=lambda x: x["score"], reverse=True)

        if matched_clients:
            top_3 = matched_clients[:3]
            all_matches[item["id"]] = top_3

            logger.info(
                f"🎯 Căn [{item['id']}] {item['title'][:40]}... "
                f"khớp {len(matched_clients)} khách hàng (Top 1: {top_3[0]['client']['name']} - {top_3[0]['score']}%)"
            )

            # Tạo nội dung thông báo Telegram siêu gọn kèm 1-click pitch
            tg_text = (
                f"🎯 <b>KHỚP KHÁCH CHO CĂN MỚI:</b> <a href=\"{item.get('url')}\">{item.get('title')}</a>\n"
                f"💰 {item.get('price_ty')} tỷ | 📐 {item.get('area_m2')}m² | 🛏 {item.get('bedrooms')}PN | 📍 {item.get('ward')}\n\n"
            )

            for idx, m in enumerate(top_3):
                c = m["client"]
                phone_str = c.get("phone") or "Chưa lưu SĐT (Xem Zalo)"
                raw_req = c.get("requirement", "").strip().replace("\n", " | ")
                short_req = raw_req[:80] + ("..." if len(raw_req) > 80 else "")
                emoji = number_emojis[idx] if idx < len(number_emojis) else f"{idx+1}️⃣"

                pitch_msg = (
                    f"Chào {c.get('name')}, Châu mới về căn {item.get('ward')} "
                    f"({item.get('area_m2')}m², {item.get('bedrooms')}PN, giá {item.get('price_ty')} tỷ) "
                    f"rất khớp với tiêu chí {short_req} của mình. Xem chi tiết tại đây nhé: {item.get('url')}"
                )

                tg_text += (
                    f"{emoji} <b>{c.get('name')}</b> ({m['score']}%) — 📞 <code>{phone_str}</code>\n"
                    f"<i>Nhu cầu: {short_req}</i>\n"
                    f"📋 <b>Mẫu gửi khách (chạm để copy):</b>\n"
                    f"<code>{pitch_msg}</code>\n\n"
                )

                all_sheet_matches.append({
                    "time": time.strftime("%d/%m/%Y %H:%M"),
                    "listing_id": item.get("id"),
                    "listing_title": item.get("title"),
                    "price": f"{item.get('price_ty')} tỷ",
                    "client_name": c.get("name"),
                    "client_phone": phone_str,
                    "score": f"{m['score']}%",
                    "pitch_message": pitch_msg,
                    "status": "Chưa gửi"
                })

            # Tắt gửi Telegram thông báo khớp khách hàng theo yêu cầu (chỉ ghi nhận vào Google Sheet)
            enable_match_tg = os.getenv("ENABLE_MATCH_TELEGRAM", "false").lower() == "true"
            if enable_match_tg:
                send_telegram_alert(tg_text)

            # send_email_alert(email_subject, email_html)

    # Đồng bộ toàn bộ các cặp khớp vào tab GOI_Y_KHACH trên Google Sheet
    if all_sheet_matches:
        sync_matches_to_sheet(all_sheet_matches)

    logger.info(f"Hoàn tất so khớp: {len(all_matches)} căn có khách hàng phù hợp (Tổng {len(all_sheet_matches)} lượt gợi ý).")
    return all_matches


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()

    # Test đọc 1 căn từ data/listings.json và so khớp thử
    listings_file = os.path.join(BASE_DIR, "data", "listings.json")
    if os.path.exists(listings_file):
        with open(listings_file, "r", encoding="utf-8") as f:
            test_listings = json.load(f)
        match_new_listings_with_clients(test_listings, min_score=60.0)
    else:
        print("Chưa có listings.json để test.")
