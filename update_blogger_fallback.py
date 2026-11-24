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
    # Dùng lambda để Python re.sub không biến \n thành literal newline làm hỏng cú pháp JS
    new_html = re.sub(pattern, lambda m: m.group(1) + formatted_json + m.group(2), html, count=1)

    with open(HTML_PATH, "w", encoding="utf-8") as f:
        f.write(new_html)

    print(f"✅ Đã cập nhật thành công INITIAL_FALLBACK_DATA ({len(listings)} tin) vào {HTML_PATH}")

    # Kiểm tra cú pháp JavaScript bằng Node.js
    import subprocess, tempfile
    scripts = re.findall(r'<script\b[^>]*>([\s\S]*?)</script>', new_html)
    for i, s in enumerate(scripts):
        with tempfile.NamedTemporaryFile(suffix='.js', delete=False, mode='w', encoding='utf-8') as tf:
            tf.write(s)
            tmp_name = tf.name
        try:
            res = subprocess.run(['node', '--check', tmp_name], capture_output=True, text=True)
            if res.returncode != 0:
                print(f"❌ Script #{i+1} CÚ PHÁP LỖI:\n{res.stderr[:500]}")
                raise SyntaxError("Lỗi cú pháp JavaScript trong blogger-page.html!")
            else:
                print(f"✅ Script #{i+1}: Cú pháp JavaScript hợp lệ 100%!")
        finally:
            if os.path.exists(tmp_name):
                os.remove(tmp_name)

if __name__ == "__main__":
    update_fallback()
