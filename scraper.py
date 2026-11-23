#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
==============================================================================
MODULE 1.1: TOOL CÀO DỮ LIỆU BẤT ĐỘNG SẢN (scraper.py)
Website nguồn: https://nhadat247.vn/moi-gioi/nguyenthihongchau.355
Mục tiêu:
  - Cào toàn bộ tin đăng của môi giới Hồng Châu (bao gồm phân trang).
  - Bóc tách chi tiết từng tin (Mã tin, Tiêu đề, Giá, Diện tích, Số PN, Hẻm, Phường, Quận...).
  - Chuẩn hóa dữ liệu JSON sẵn sàng phục vụ bộ lọc Blogger.
==============================================================================
"""

import os
import re
import ssl
import json
import time
import logging
import urllib.request
import urllib.error
from urllib.parse import urljoin
from bs4 import BeautifulSoup

# Thiết lập logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("Scraper")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUTPUT_PATH = os.path.join(BASE_DIR, "data", "listings.json")

# Cấu hình SSL và Headers giả lập trình duyệt thật
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
}

DEFAULT_BROKER_URL = "https://nhadat247.vn/moi-gioi/nguyenthihongchau.355"


def fetch_html(url: str, max_retries: int = 3, delay: float = 1.0) -> str:
    """Tải mã nguồn HTML của trang web kèm cơ chế tự động thử lại (retry)."""
    for attempt in range(1, max_retries + 1):
        try:
            req = urllib.request.Request(url, headers=DEFAULT_HEADERS)
            with urllib.request.urlopen(req, context=SSL_CTX, timeout=20) as resp:
                return resp.read().decode("utf-8", errors="ignore")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                logger.warning(f"Trang không tồn tại (404): {url}")
                return ""
            logger.warning(f"Lỗi HTTP {e.code} (lần {attempt}/{max_retries}): {url}")
            if attempt == max_retries:
                return ""
            time.sleep(delay * attempt)
        except Exception as e:
            logger.warning(f"Lỗi kết nối (lần {attempt}/{max_retries}): {url} -> {e}")
            if attempt == max_retries:
                return ""
            time.sleep(delay * attempt)
    return ""


def extract_listing_urls_from_broker_page(broker_url: str = DEFAULT_BROKER_URL) -> list:
    """
    Quét toàn bộ trang môi giới để thu thập danh sách URL chi tiết tin đăng.
    Hỗ trợ duyệt phân trang (?page=1, ?page=2, ...) đến khi hết dữ liệu.
    Deduplicate chính xác theo mã tin 8 ký tự hex.
    """
    logger.info(f"Bắt đầu quét danh sách tin đăng từ: {broker_url}")
    detail_urls = []
    seen_ids = set()
    page = 1
    max_pages = 50

    while page <= max_pages:
        page_url = broker_url if page == 1 else f"{broker_url}?trang={page}"
        logger.info(f"Đang duyệt trang {page}: {page_url}")
        html = fetch_html(page_url)
        if not html:
            break

        soup = BeautifulSoup(html, "html.parser")
        new_in_page = 0
        
        # 1. Tìm trong thẻ <a>
        for a in soup.find_all("a", href=True):
            href = a["href"].strip()
            m_hex = re.search(r"-([0-9a-f]{6,16})(?:$|\?)", href)
            if m_hex and ("/ban-" in href or "/cho-thue-" in href):
                lid = m_hex.group(1)
                if lid not in seen_ids:
                    seen_ids.add(lid)
                    clean_url = urljoin("https://nhadat247.vn", href.split("?")[0])
                    detail_urls.append(clean_url)
                    new_in_page += 1

        # 2. Tìm trong RSC Next.js chunks nếu không có trong DOM
        if new_in_page == 0 and page == 1:
            for m in re.finditer(r"((?:/ban-|/cho-thue-)[a-zA-Z0-9\-_/]+-([0-9a-f]{6,16}))", html):
                full_path, lid = m.group(1), m.group(2)
                if lid not in seen_ids:
                    seen_ids.add(lid)
                    clean_url = urljoin("https://nhadat247.vn", full_path)
                    detail_urls.append(clean_url)
                    new_in_page += 1

        logger.info(f"Trang {page}: phát hiện {new_in_page} tin mới.")
        if new_in_page == 0:
            logger.info("Không phát hiện thêm tin đăng mới. Kết thúc duyệt trang.")
            break

        # Kiểm tra sự tồn tại của link trang tiếp theo
        has_next = any((f"trang={page + 1}" in (a.get("href") or "")) or (f"page={page + 1}" in (a.get("href") or "")) for a in soup.find_all("a", href=True))
        if not has_next and page > 1:
            break

        page += 1
        time.sleep(0.5)

    logger.info(f"Tổng hợp: tìm thấy {len(detail_urls)} tin đăng duy nhất.")
    return detail_urls


def classify_alley(width_m: float, title: str, desc: str) -> tuple:
    """
    Phân loại đường vào / hẻm thành dạng chuẩn để lọc trên Blogger.
    Trả về: (alley_type_text, alley_category_code)
    
    Quy tắc phân loại:
    1. Ưu tiên 1 (Tuyệt đối theo số mét đo được ở trường 'Đường vào' của tin đăng):
       - width_m >= 6.0: "Xe tải / Mặt tiền (>6m)", "mat_tien"
       - 4.0 <= width_m < 6.0: "Hẻm xe hơi (4-6m)", "hem_xe_hoi"
       - 3.0 <= width_m < 4.0: "Hẻm ba gác (3-4m)", "hem_ba_gac"
       - 0 < width_m < 3.0: f"Hẻm xe máy ({width_m:g}m)", "hem_xe_may"
       (Tuyệt đối KHÔNG để cụm từ 'gần mặt tiền đường' hay 'ra mặt tiền' trong mô tả ghi đè width_m).
    2. Ưu tiên 2 (Chỉ dùng khi width_m == 0):
       - Tiêu đề bắt đầu bằng 'Mặt tiền' hoặc 'Bán nhà mặt phố' -> "mat_tien"
       - Tiêu đề/mô tả có 'hxh', 'xe hơi', 'hẻm xe hơi' -> "hem_xe_hoi"
       - Tiêu đề/mô tả có 'ba gác', 'hbg' -> "hem_ba_gac"
       - Mặc định: "Hẻm xe máy (<3m)", "hem_xe_may"
    """
    if width_m >= 6.0:
        return "Xe tải / Mặt tiền (>6m)", "mat_tien"
    elif width_m >= 4.0:
        return "Hẻm xe hơi (4-6m)", "hem_xe_hoi"
    elif width_m >= 3.0:
        return "Hẻm ba gác (3-4m)", "hem_ba_gac"
    elif width_m > 0:
        return f"Hẻm xe máy ({width_m:g}m)", "hem_xe_may"
    else:
        title_clean = (title or "").lower().strip()
        desc_clean = (desc or "").lower()
        full_text = f"{title_clean} {desc_clean}"
        
        if title_clean.startswith("mặt tiền") or title_clean.startswith("bán nhà mặt phố") or title_clean.startswith("nhà mặt tiền"):
            return "Xe tải / Mặt tiền (>6m)", "mat_tien"
        elif any(k in full_text for k in ["hxh", "hẻm xe hơi", "xe hơi"]):
            return "Hẻm xe hơi (4-6m)", "hem_xe_hoi"
        elif any(k in full_text for k in ["ba gác", "hbg"]):
            return "Hẻm ba gác (3-4m)", "hem_ba_gac"
        return "Hẻm xe máy (<3m)", "hem_xe_may"


def classify_price_range(price_ty: float) -> str:
    """Gán mã nhóm khoảng giá để bộ lọc giao diện Blogger hoạt động cực nhanh."""
    if price_ty <= 0:
        return "thoathuan"
    if price_ty < 3.0:
        return "duoi_3_ty"
    if price_ty <= 5.0:
        return "3_5_ty"
    if price_ty <= 7.0:
        return "5_7_ty"
    if price_ty <= 10.0:
        return "7_10_ty"
    return "tren_10_ty"


def classify_area_range(area_m2: float) -> str:
    """Gán mã nhóm diện tích."""
    if area_m2 <= 0:
        return "khac"
    if area_m2 < 40.0:
        return "duoi_40"
    if area_m2 <= 60.0:
        return "40_60"
    if area_m2 <= 80.0:
        return "60_80"
    if area_m2 <= 100.0:
        return "80_100"
    return "tren_100"


def extract_dimensions(text: str) -> tuple:
    """
    Trích xuất kích thước chiều ngang và chiều dài từ tiêu đề hoặc mô tả.
    Trả về: (width_m, length_m)
    """
    text_lower = text.lower()
    # Tìm dạng '4x18', '4 x 18m', '5.2x16', '4*20'
    m_dim = re.search(r'(\d+(?:[\.,]\d+)?)\s*[xX*]\s*(\d+(?:[\.,]\d+)?)', text_lower)
    if m_dim:
        try:
            w = float(m_dim.group(1).replace(',', '.'))
            l = float(m_dim.group(2).replace(',', '.'))
            return w, l
        except Exception:
            pass

    # Tìm dạng 'dài 18m', 'sâu 20m', 'chiều dài 16m'
    m_len = re.search(r'(?:chiều dài|dài|sâu)\s*[:\-]?\s*(\d+(?:[\.,]\d+)?)\s*m', text_lower)
    if m_len:
        try:
            l = float(m_len.group(1).replace(',', '.'))
            return 0.0, l
        except Exception:
            pass

    return 0.0, 0.0


def classify_purposes_and_cashflow(title: str, desc: str, area_m2: float, bedrooms: int, alley_width_m: float, price_ty: float, url: str = "") -> tuple:
    """
    Tự động phân loại 5 mảng BĐS & bóc tách BĐS dòng tiền (Dãy trọ / CHDV / Tiềm năng CHDV).
    Trả về: (purposes, cashflow_subtype, estimated_rent_text)
    
    5 nhóm mảng BĐS:
    1. 'dat': Đất nền / Đất thổ cư (URL chứa /ban-dat- hoặc từ khóa bán đất, đất nền, thổ cư, lô đất).
    2. 'dong_tien': BĐS Dòng tiền (tách rõ dãy trọ sẵn, CHDV, hoặc tiềm năng xây CHDV).
    3. 'kinh_doanh': Mua để kinh doanh / văn phòng (mặt tiền đường, hẻm lớn >= 6m, hoặc tiêu đề có chữ mặt tiền/kinh doanh/buôn bán).
    4. 'de_o': Mua để ở (nhà ở gia đình, hẻm yên tĩnh, 2-4 PN).
    """
    full_text = f"{title} {desc}".lower()
    title_lower = (title or "").lower()
    url_lower = (url or "").lower()
    purposes = []

    # 1. 'dat' (🏞 Đất nền / Đất thổ cư)
    is_dat = (
        "/ban-dat-" in url_lower or
        any(k in full_text for k in ["bán đất", "đất nền", "đất thổ cư", "lô đất", "mảnh đất", "đất phân lô"])
    )
    if is_dat:
        purposes.append("dat")

    # 2. 'dong_tien' (💵 BĐS Dòng tiền: Trọ / CHDV / Tiềm năng xây CHDV)
    # Chỉ tự động gắn khi tiêu đề hoặc mô tả có từ khóa rõ ràng, KHÔNG tự gắn chỉ vì nhà có 5 PN:
    has_day_tro_kw = any(k in full_text for k in ["dãy trọ", "nhà trọ", "phòng trọ", "dãy phòng trọ", "kín phòng"])
    has_chdv_kw = any(k in full_text for k in [
        "căn hộ dịch vụ", "chdv", "thu nhập", "đang cho thuê", "hợp đồng thuê", "hđt", "khai thác cho thuê"
    ])
    has_tiem_nang_kw = any(k in full_text for k in ["xây chdv", "làm chdv", "tiềm năng chdv", "xây căn hộ dịch vụ", "làm căn hộ dịch vụ"])

    cashflow_subtype = ""
    is_cashflow = False

    if has_day_tro_kw:
        cashflow_subtype = "day_tro"
        is_cashflow = True
    elif has_chdv_kw:
        cashflow_subtype = "chdv"
        is_cashflow = True
    elif has_tiem_nang_kw:
        cashflow_subtype = "tiem_nang_chdv"
        is_cashflow = True

    if is_cashflow:
        purposes.append("dong_tien")

    # 3. 'kinh_doanh' (🏪 Mua để kinh doanh / Làm văn phòng)
    # Siết chặt điều kiện: chỉ gắn khi URL có /ban-nha-mat-pho-, alley_width_m >= 6.0, hoặc tiêu đề có chữ mặt tiền / kinh doanh / buôn bán
    is_business = (
        ("/ban-nha-mat-pho-" in url_lower) or
        (alley_width_m >= 6.0 and not is_dat) or
        any(k in title_lower for k in ["mặt tiền", "mặt phố", "kinh doanh", "buôn bán"])
    )
    if is_business:
        purposes.append("kinh_doanh")

    # 4. 'de_o' (🏡 Mua để ở)
    de_o_kw = ["để ở", "ở ngay", "dọn vào ở", "gia đình", "yên tĩnh", "an ninh", "gần chợ", "trường học", "emart", "nội thất", "khu dân cư"]
    if any(k in full_text for k in de_o_kw) or (2 <= bedrooms <= 4 and alley_width_m < 6.0 and not is_dat):
        purposes.append("de_o")

    # Đảm bảo mỗi căn có ít nhất 1 mục đích cơ bản (nếu không phải đất và chưa có gì thì là de_o)
    if not purposes:
        purposes.append("de_o")

    # Trích xuất mức thu nhập cho thuê nếu bài đăng nhắc tới
    estimated_rent_text = ""
    m_rent = re.search(r"(?:thu nhập|đang cho thuê|cho thuê|dòng tiền|hđt)\s*(?:được|khoảng|tầm)?\s*[:\-]?\s*(\d+(?:[\.,]\d+)?\s*(?:triệu|tr|tỷ|ty)(?:\s*/\s*(?:tháng|thg|th))?)", full_text, re.I)
    if m_rent:
        rent_val = m_rent.group(1).strip()
        if not re.search(r"/(?:tháng|thg|th)", rent_val, re.I):
            rent_val += "/tháng"
        estimated_rent_text = f"Thu nhập {rent_val}"

    return purposes, cashflow_subtype, estimated_rent_text


def detect_district(ward: str, title: str, desc: str, breadcrumb_text: str) -> str:
    """
    Tự động nhận diện Quận/Huyện tại TP.HCM dựa trên tiêu đề, mô tả và phường/xã.
    Ưu tiên nhận diện theo Phường/Xã chính thức trước.
    """
    ward_lower = (ward or "").lower()

    # 1. Hóc Môn
    hm_wards = ["bà điểm", "ba diem", "xuân thới", "thới tam thôn", "trung chánh", "tân xuân", "đông thạnh", "nhị bình", "hóc môn", "hoc mon"]
    if any(w in ward_lower for w in hm_wards):
        return "Hóc Môn"

    # 2. Quận 12
    q12_wards = [
        "trung mỹ tây", "đông hưng thuận", "tân hưng thuận", "tân thới hiệp",
        "hiệp thành", "thạnh lộc", "thạnh xuân", "an phú đông", "tân chánh hiệp",
        "thới an", "tân thới nhất"
    ]
    if any(w in ward_lower for w in q12_wards):
        return "Quận 12"

    # 3. Gò Vấp
    gv_wards = [
        "an hội tây", "thông tây hội", "hạnh thông", "phường 1", "phường 3", "phường 4",
        "phường 5", "phường 6", "phường 7", "phường 8", "phường 9", "phường 10",
        "phường 11", "phường 12", "phường 13", "phường 14", "phường 15", "phường 16", "phường 17"
    ]
    if any(w in ward_lower for w in gv_wards):
        return "Gò Vấp"

    full_text = f"{ward} {title} {desc} {breadcrumb_text}".lower()

    # Nhận diện theo từ khóa trong toàn bộ văn bản (nếu chưa xác định được qua ward)
    districts_map = {
        "Hóc Môn": ["hóc môn", "hoc mon", "bà điểm", "ba diem", "xuân thới", "thới tam thôn", "trung chánh", "tân xuân", "đông thạnh", "nhị bình"],
        "Quận 12": ["quận 12", "q12", "tân hưng thuận", "đông hưng thuận", "nguyễn văn quá", "song hành", "thạnh lộc", "thạnh xuân", "hiệp thành", "trung mỹ tây", "an phú đông"],
        "Gò Vấp": ["gò vấp", "go vap", "phan huy ích", "quang trung", "phạm văn chiêu", "lê văn thọ", "cây trâm", "an hội tây", "phường 14, gò vấp"],
        "Tân Bình": ["tân bình", "tan binh", "cộng hòa", "bạch đằng", "hoàng hoa thám", "trường chinh"],
        "Tân Phú": ["tân phú", "tan phu", "lũy bán bích", "tân sơn nhì", "phú thọ hòa", "hòa thạnh"],
        "Bình Thạnh": ["bình thạnh", "binh thanh", "bạch đằng", "nơ trang long", "xô viết nghệ tĩnh"],
        "Phú Nhuận": ["phú nhuận", "phu nhuan", "phan xích long", "nguyễn văn trỗi"],
        "Thủ Đức": ["thủ đức", "thu duc", "hiệp bình", "linh đông", "tam phú", "bình chiểu"],
        "Bình Tân": ["bình tân", "binh tan", "tên lửa", "an lạc", "bình trị đông"],
        "Quận 1": ["quận 1", "q1"],
        "Quận 3": ["quận 3", "q3"],
        "Quận 10": ["quận 10", "q10"]
    }

    for dist, keywords in districts_map.items():
        if any(kw in full_text for kw in keywords):
            return dist

    return "TP. Hồ Chí Minh"


def parse_detail_page(url: str) -> dict:
    """
    Bóc tách toàn diện dữ liệu của 1 bài đăng chi tiết bất động sản.
    """
    html = fetch_html(url)
    if not html:
        return None

    soup = BeautifulSoup(html, "html.parser")

    # 1. Trích xuất ID tin (6-16 ký tự hex ở đuôi URL)
    m_id = re.search(r"-([0-9a-f]{6,16})(?:$|\?)", url)
    listing_id = m_id.group(1) if m_id else url.rstrip("/").split("-")[-1]

    # 2. Tiêu đề
    h1 = soup.find("h1")
    title = h1.get_text(strip=True) if h1 else (soup.title.string.strip() if soup.title else "")

    # 3. Breadcrumb & vị trí (Ưu tiên đọc từ Nav Breadcrumb điều hướng & Khối địa chỉ ngay dưới H1)
    crumb_text = ""
    ward = ""

    # Ưu tiên 1: Lấy từ Breadcrumb điều hướng
    nav_crumb = soup.find("nav", class_=re.compile(r"text-muted|gap-1\.5|breadcrumb", re.I))
    if not nav_crumb:
        nav_crumb = soup.find("nav")

    if nav_crumb:
        crumb_links = [a.get_text(strip=True) for a in nav_crumb.find_all("a") if a.get_text(strip=True)]
        crumb_text = " / ".join(crumb_links)
        for clk in crumb_links:
            clk_clean = clk.strip()
            # Bắt dạng "Xã Bà Điểm", "Phường Trung Mỹ Tây", "Phường 14"
            if re.search(r"^(?:Phường|Xã)\s+", clk_clean, re.I):
                ward = clk_clean
                break
            # Hoặc tên phường/xã không có tiền tố trong breadcrumb
            clk_lower = clk_clean.lower()
            if clk_lower in ["bà điểm", "ba diem"]:
                ward = "Xã Bà Điểm"
                break
            elif clk_lower in [
                "trung mỹ tây", "đông hưng thuận", "tân hưng thuận", "tân thới hiệp",
                "hiệp thành", "thạnh lộc", "thạnh xuân", "an phú đông", "tân chánh hiệp",
                "thới an", "tân thới nhất", "an hội tây", "thông tây hội"
            ]:
                ward = f"Phường {clk_clean}"
                break

    # Ưu tiên 2: Khối địa chỉ ngay dưới thẻ <h1> (trước khi xuống phần mô tả)
    if not ward and h1:
        parent_h1 = h1.parent
        for el in parent_h1.find_all(["p", "div", "span"]):
            t = el.get_text(" ", strip=True)
            m_addr = re.search(r"((?:Phường|Xã)\s+[^,]+),\s*(?:(?:Quận|Huyện)\s+[^,]+,\s*)?Hồ Chí Minh", t, re.I)
            if m_addr:
                ward = m_addr.group(1).strip()
                break

    # Ưu tiên 3: Tìm trong các thẻ phía trên khối mô tả (tránh quét nhầm xuống footer / tin liên quan)
    if not ward:
        desc_block = soup.find("div", class_=re.compile(r"whitespace-pre-line"))
        all_p = soup.find_all(["p", "div", "span"])
        for el in all_p:
            if desc_block and el in desc_block.descendants:
                continue
            t = el.get_text(" ", strip=True)
            m_ward = re.search(r"\b((?:Phường|Xã)\s+[a-zA-ZàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđĐ0-9\s]+?),\s*(?:(?:Quận|Huyện)\s+[^,]+,\s*)?Hồ Chí Minh", t, re.I)
            if m_ward:
                ward = m_ward.group(1).strip()
                break

    # 4. Giá và Diện tích từ khối thông số nổi bật (div.card)
    price_text = ""
    price_ty = 0.0
    area_m2 = 0.0
    updated_at = ""

    header_block = ""
    for c in soup.find_all("div", class_="card"):
        t = c.get_text(" ", strip=True)
        if "Mức giá" in t and "Diện tích" in t:
            header_block = t
            break

    # Trích xuất giá (ví dụ: 4.99 tỷ, 4.57 tỷ, 950 triệu...)
    m_price = re.search(r"Mức giá\s*([\d\.,]+)\s*(tỷ|triệu|tr|ty)", header_block, re.I)
    if m_price:
        val_str = m_price.group(1).replace(",", ".")
        unit = m_price.group(2).lower()
        val = float(val_str)
        if "t" in unit:
            price_ty = round(val, 2)
            price_text = f"{price_ty:g} tỷ"
        elif "tr" in unit:
            price_ty = round(val / 1000.0, 3)
            price_text = f"{int(val)} triệu"
    else:
        m_p_title = re.search(r"([\d\.,]+)\s*tỷ", title, re.I)
        if m_p_title:
            price_ty = round(float(m_p_title.group(1).replace(",", ".")), 2)
            price_text = f"{price_ty:g} tỷ"
        else:
            price_text = "Thỏa thuận"

    # Trích xuất diện tích m²
    m_area = re.search(r"Diện tích\s*([\d\.,]+)\s*m²", header_block, re.I)
    if m_area:
        area_m2 = float(m_area.group(1).replace(",", "."))

    # Trích xuất ngày đăng
    m_date = re.search(r"Đăng tin:\s*(\d{2}:\d{2}\s+\d{2}/\d{2}/\d{4})", header_block)
    if m_date:
        updated_at = m_date.group(1)
    else:
        m_d2 = re.search(r"\b(\d{2}/\d{2}/\d{4})\b", header_block)
        if m_d2:
            updated_at = m_d2.group(1)

    # 5. Bảng thông số chi tiết (Số phòng ngủ, Đường vào, Mặt tiền ngang nhà...)
    # Tách biệt hoàn toàn: alley_width_m (chỉ từ 'Đường vào') vs frontage_m (chỉ từ 'Mặt tiền')
    bedrooms = 0
    alley_width_m = 0.0
    frontage_m = 0.0

    # 5.1. Bóc tách Đường vào (chiều rộng hẻm/đường trước nhà)
    for span in soup.find_all(lambda e: e.name in ["span", "dt", "div", "p"] and e.get_text(strip=True) == "Đường vào"):
        parent = span.parent
        if parent:
            text_block = parent.get_text(" ", strip=True)
            m_dv = re.search(r"([\d\.,]+)\s*m", text_block)
            if m_dv:
                alley_width_m = float(m_dv.group(1).replace(",", "."))
                break

    # 5.2. Bóc tách Mặt tiền (bề ngang căn nhà) - TUYỆT ĐỐI chỉ lưu frontage_m, KHÔNG BAO GIỜ gán cho alley_width_m
    for span in soup.find_all(lambda e: e.name in ["span", "dt", "div", "p"] and e.get_text(strip=True) == "Mặt tiền"):
        parent = span.parent
        if parent:
            text_block = parent.get_text(" ", strip=True)
            m_mt = re.search(r"([\d\.,]+)\s*m", text_block)
            if m_mt:
                frontage_m = float(m_mt.group(1).replace(",", "."))
                break

    # 5.3. Bóc tách Phòng ngủ
    for span in soup.find_all(lambda e: e.name in ["span", "dt", "div", "p"] and e.get_text(strip=True) == "Phòng ngủ"):
        parent = span.parent
        if parent:
            text_block = parent.get_text(" ", strip=True)
            m_pn = re.search(r"(\d+)", text_block)
            if m_pn:
                bedrooms = int(m_pn.group(1))
                break

    # 5.4. Quét dự phòng nếu các thẻ trên không có
    if bedrooms == 0 or (alley_width_m == 0.0 and frontage_m == 0.0):
        for row in soup.find_all("div", class_=re.compile(r"flex.*(?:border-b|items-center)", re.I)):
            row_t = row.get_text(" ", strip=True)
            if "Phòng ngủ" in row_t and bedrooms == 0:
                m_pn = re.search(r"(\d+)\s*phòng", row_t)
                if m_pn:
                    bedrooms = int(m_pn.group(1))
            elif "Đường vào" in row_t and alley_width_m == 0.0:
                m_dv = re.search(r"([\d\.,]+)\s*m", row_t)
                if m_dv:
                    alley_width_m = float(m_dv.group(1).replace(",", "."))
            elif "Mặt tiền" in row_t and frontage_m == 0.0:
                m_mt = re.search(r"([\d\.,]+)\s*m", row_t)
                if m_mt:
                    frontage_m = float(m_mt.group(1).replace(",", "."))

    if bedrooms == 0:
        m_pn_t = re.search(r"(\d+)\s*PN", title, re.I)
        if m_pn_t:
            bedrooms = int(m_pn_t.group(1))

    # 6. Nội dung mô tả chi tiết & Trích xuất Mã SP nội bộ
    desc_elem = soup.find("div", class_=re.compile(r"whitespace-pre-line"))
    description = desc_elem.get_text("\n", strip=True) if desc_elem else ""

    internal_code = ""
    m_code = re.search(r"(?:Mã\s*(?:SP|tin|bđs|sp\s*nội\s*bộ)?|MSP)\s*[:\-]?\s*([A-Za-z0-9\-]+)", description, re.I)
    if m_code:
        internal_code = m_code.group(1).strip().upper()

    # 7. Nhận diện Quận
    district = detect_district(ward, title, description, crumb_text)

    # 8. Phân loại hẻm và khoảng giá/diện tích
    alley_type, alley_category = classify_alley(alley_width_m, title, description)
    price_range = classify_price_range(price_ty)
    area_range = classify_area_range(area_m2)

    # 9. Xác định loại giao dịch (Mua bán vs Cho thuê - sẵn sàng mở rộng sau 2 tháng)
    is_rent = ("/cho-thue-" in url.lower()) or title.lower().startswith("cho thuê")
    transaction_type = "rent" if is_rent else "sale"

    # 10. Phân loại 5 mảng BĐS & Nhận diện BĐS Dòng tiền (Dãy trọ / CHDV / Tiềm năng CHDV)
    purposes, cashflow_subtype, estimated_rent_text = classify_purposes_and_cashflow(
        title=title,
        desc=description,
        area_m2=area_m2,
        bedrooms=bedrooms,
        alley_width_m=alley_width_m,
        price_ty=price_ty,
        url=url
    )

    # 11. Hình ảnh đại diện & Album ảnh thật của tin đăng
    images = []
    
    # Ưu tiên 1: Thẻ meta og:image (luôn là ảnh bìa chính nét nhất của tin)
    og_img = soup.find("meta", property="og:image")
    if og_img and og_img.get("content"):
        og_url = og_img["content"].strip()
        if "nhadat247.vn" in og_url and "logo" not in og_url.lower():
            images.append(og_url)

    # Ưu tiên 2: Quét toàn bộ ảnh thật trong bài đăng (bỏ qua avatar, icon, banner)
    for img in soup.find_all("img"):
        src = (img.get("data-src") or img.get("src") or "").strip()
        if not src or src.startswith("data:"):
            continue
        if "cdn.nhadat247.vn" in src:
            lower_src = src.lower()
            if not any(bad in lower_src for bad in ["avatar", "logo", "icon", "banner", "default"]):
                # Chuyển sang bản ảnh kích thước lớn nếu có hậu tố thumb
                clean_src = re.sub(r"-\d+x\d+(?=\.(?:jpg|jpeg|png|webp))", "", src)
                if clean_src not in images:
                    images.append(clean_src)

    image = images[0] if images else "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80"

    return {
        "id": listing_id,
        "internal_code": internal_code,
        "title": title,
        "url": url,
        "transaction_type": transaction_type,
        "image": image,
        "images": images[:6] if images else [image],
        "ward": ward if ward else "Đang cập nhật",
        "district": district,
        "area_m2": area_m2,
        "bedrooms": bedrooms,
        "price_ty": price_ty,
        "price_text": price_text,
        "frontage_m": frontage_m,
        "alley_width_m": alley_width_m,
        "alley_type": alley_type,
        "alley_category": alley_category,
        "price_range": price_range,
        "area_range": area_range,
        "description": description[:350] + ("..." if len(description) > 350 else ""),
        "purposes": purposes,
        "cashflow_subtype": cashflow_subtype,
        "estimated_rent_text": estimated_rent_text,
        "updated_at": updated_at if updated_at else time.strftime("%d/%m/%Y"),
        "status": "active",
        "is_sold": False,
        "is_price_dropped": False,
        "old_price_ty": None,
        "drop_amount_ty": None,
        "last_checked_at": time.strftime("%Y-%m-%d %H:%M:%S")
    }


def run_scraper(broker_url: str = DEFAULT_BROKER_URL, output_path: str = DEFAULT_OUTPUT_PATH) -> list:
    """
    Quy trình chính: Cào toàn bộ tin -> Ghép với dữ liệu cũ -> Xuất ra file JSON.
    """
    logger.info("=== BẮT ĐẦU QUY TRÌNH CÀO DỮ LIỆU BẤT ĐỘNG SẢN ===")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    # Đọc dữ liệu cũ nếu có
    old_listings_map = {}
    if os.path.exists(output_path):
        try:
            with open(output_path, "r", encoding="utf-8") as f:
                old_data = json.load(f)
                for item in old_data:
                    old_listings_map[item["id"]] = item
            logger.info(f"Đã nạp {len(old_listings_map)} tin đăng từ file lưu trữ trước đó.")
        except Exception as e:
            logger.warning(f"Không thể đọc file dữ liệu cũ: {e}")

    urls = extract_listing_urls_from_broker_page(broker_url)
    current_listings = []
    scraped_ids = set()

    for idx, u in enumerate(urls, 1):
        logger.info(f"[{idx}/{len(urls)}] Đang cào chi tiết: {u}")
        data = parse_detail_page(u)
        if data:
            lid = data["id"]
            scraped_ids.add(lid)
            
            # Kế thừa trạng thái giảm chào & đã bán nếu có từ lần trước
            if lid in old_listings_map:
                old_item = old_listings_map[lid]
                if old_item.get("is_price_dropped"):
                    data["is_price_dropped"] = True
                    data["old_price_ty"] = old_item.get("old_price_ty")
                    data["drop_amount_ty"] = old_item.get("drop_amount_ty")
                if old_item.get("is_sold"):
                    data["is_sold"] = True
                if old_item.get("internal_code") and not data.get("internal_code"):
                    data["internal_code"] = old_item.get("internal_code")

            current_listings.append(data)
        time.sleep(0.5)

    # Đánh dấu các tin không còn xuất hiện là sold_or_removed (chỉ giữ tin thật nhadat247)
    for lid, old_item in old_listings_map.items():
        if lid not in scraped_ids and "nhadat247.vn" in (old_item.get("url") or ""):
            old_item["status"] = "sold_or_removed"
            old_item["last_checked_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
            current_listings.append(old_item)

    # Ghi ra file JSON
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(current_listings, f, ensure_ascii=False, indent=2)

    active_count = sum(1 for x in current_listings if x.get("status") == "active")
    logger.info(f"Cào dữ liệu hoàn tất! Đã lưu {len(current_listings)} tin ({active_count} đang mở bán) vào: {output_path}")
    return current_listings


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    target_broker = os.getenv("BROKER_URL", DEFAULT_BROKER_URL)
    run_scraper(target_broker, DEFAULT_OUTPUT_PATH)
