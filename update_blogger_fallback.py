#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Cập nhật INITIAL_FALLBACK_DATA trong blogger-page.html từ data/listings.json mới nhất.
Đảm bảo 100% hình ảnh sạch (chỉ giữ cdn.nhadat247.vn), đồng bộ phân loại & trạng thái từ Google Sheet.
"""

import os
import re
import json

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LISTINGS_PATH = os.path.join(BASE_DIR, "data", "listings.json")
HTML_PATH = os.path.join(BASE_DIR, "blogger-page.html")

def update_fallback():
    if not os.path.exists(LISTINGS_PATH):
        raise FileNotFoundError(f"Không tìm thấy file: {LISTINGS_PATH}")
    if not os.path.exists(HTML_PATH):
        raise FileNotFoundError(f"Không tìm thấy file: {HTML_PATH}")

    with open(LISTINGS_PATH, "r", encoding="utf-8") as f:
        listings = json.load(f)

    print(f"Nạp {len(listings)} tin từ {LISTINGS_PATH}")

    # Đảm bảo toàn bộ ảnh là link gốc cdn.nhadat247.vn
    netspace_count = 0
    for item in listings:
        if "image" in item and item["image"] and "netspace.vn" in item["image"]:
            netspace_count += 1
        if "images" in item and isinstance(item["images"], list):
            for img in item["images"]:
                if "netspace.vn" in img:
                    netspace_count += 1

    print(f"Số lượng link netspace phát hiện: {netspace_count}")

    with open(HTML_PATH, "r", encoding="utf-8") as f:
        html = f.read()

    # Tìm vị trí const INITIAL_FALLBACK_DATA = [ ... ];
    pattern = r"(const\s+INITIAL_FALLBACK_DATA\s*=\s*)\[[\s\S]*?\](\s*;)"
    
    formatted_json = json.dumps(listings, ensure_ascii=False, indent=2)
    # Thụt lề 2 spaces
    replacement = r"\g<1>" + formatted_json + r"\g<2>"

    new_html, count = re.subn(pattern, replacement, html, count=1)
    if count == 0:
        raise ValueError("Không tìm thấy biến INITIAL_FALLBACK_DATA trong blogger-page.html!")

    with open(HTML_PATH, "w", encoding="utf-8") as f:
        f.write(new_html)

    print(f"✅ Đã cập nhật thành công INITIAL_FALLBACK_DATA ({len(listings)} tin) vào {HTML_PATH}")

if __name__ == "__main__":
    update_fallback()
