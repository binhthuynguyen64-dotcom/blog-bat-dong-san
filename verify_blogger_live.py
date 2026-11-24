#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Kiểm tra thực tế giao diện và dữ liệu trên trang Live Blogger:
https://hongchaunhaungy.blogspot.com/p/kho-nha-that-gia-tot.html
- Đếm tổng số căn mở bán & căn đã bán
- Kiểm tra số lượng trên 5 tab danh mục (Tất cả, Mua để ở, Dòng tiền, Kinh doanh, Đất)
- Chụp ảnh minh chứng Desktop & Mobile
"""

import os
import sys
import json
import time
from playwright.sync_api import sync_playwright

LIVE_URL = "https://hongchaunhaungy.blogspot.com/p/kho-nha-that-gia-tot.html"
ARTIFACT_DIR = r"C:\Users\PC\.gemini\antigravity\brain\fd74a0a2-276c-4f36-af82-df537c0243c8"
os.makedirs(ARTIFACT_DIR, exist_ok=True)

def verify_live():
    print("==================================================================")
    print("BẮT ĐẦU KIỂM TRA LIVE BLOGGER QUA PLAYWRIGHT")
    print(f"URL: {LIVE_URL}")
    print("==================================================================")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        
        # 1. Desktop Test
        print("\n--- [1/2] KIỂM TRA GIAO DIỆN DESKTOP ---")
        context_dt = browser.new_context(viewport={"width": 1280, "height": 900})
        page_dt = context_dt.new_page()
        page_dt.goto(LIVE_URL, wait_until="networkidle", timeout=45000)
        time.sleep(3)

        # Lấy số liệu các tab danh mục
        tabs_data = page_dt.evaluate("""() => {
            const tabs = Array.from(document.querySelectorAll('.hc-tab-btn, [class*="tab"]')).map(btn => {
                return {
                    text: (btn.textContent || '').trim().replace(/\\s+/g, ' '),
                    category: btn.getAttribute('data-purpose') || btn.getAttribute('data-category') || ''
                };
            }).filter(t => t.text.length > 0);

            const cards = Array.from(document.querySelectorAll('.hc-card, [class*="card"]'));
            const soldCards = cards.filter(c => {
                const txt = c.textContent || '';
                return txt.includes('ĐÃ BÁN') || txt.includes('🚫');
            });

            return {
                tabs: tabs,
                totalCards: cards.length,
                soldCount: soldCards.length,
                activeCount: cards.length - soldCards.length
            };
        }""")

        print(f"Tổng số thẻ nhà hiển thị trên trang: {tabs_data['totalCards']}")
        print(f"Số căn đang mở bán: {tabs_data['activeCount']}")
        print(f"Số căn đã bán (🚫 ĐÃ BÁN): {tabs_data['soldCount']}")
        print("Danh sách tab và bộ đếm:")
        for t in tabs_data["tabs"][:6]:
            print(f"  - {t['text']}")

        desktop_shot = os.path.join(ARTIFACT_DIR, "v19_desktop_live_synced.png")
        page_dt.screenshot(path=desktop_shot, full_page=False)
        print(f"Đã chụp ảnh Desktop: {desktop_shot}")
        context_dt.close()

        # 2. Mobile Test
        print("\n--- [2/2] KIỂM TRA GIAO DIỆN MOBILE ---")
        context_mb = browser.new_context(
            viewport={"width": 390, "height": 844},
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15"
        )
        page_mb = context_mb.new_page()
        page_mb.goto(LIVE_URL, wait_until="networkidle", timeout=45000)
        time.sleep(3)

        mobile_shot = os.path.join(ARTIFACT_DIR, "v19_mobile_live_synced.png")
        page_mb.screenshot(path=mobile_shot, full_page=False)
        print(f"Đã chụp ảnh Mobile: {mobile_shot}")
        context_mb.close()

        browser.close()
        print("\n✅ KIỂM TRA HOÀN TẤT THÀNH CÔNG!")
        return tabs_data

if __name__ == "__main__":
    verify_live()
