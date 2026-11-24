#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
==============================================================================
TỰ ĐỘNG ĐIỀN MÔ TẢ CHI TIẾT & LƯU NHÁP HÀNG LOẠT TIN NHÁP TRÊN NHADAT247.VN
==============================================================================
Sử dụng Playwright launch_persistent_context trực tiếp:
- Tự động mở cửa sổ trình duyệt (headless=False)
- Tự động fallback giữa channel="chrome" và Chromium tích hợp
- Lưu giữ phiên đăng nhập vĩnh viễn trong thư mục chrome_nhadat247_session
- Chống lặp, chống chèn trùng, chụp ảnh minh chứng trước và sau khi lưu nháp
==============================================================================
"""

import os
import re
import sys
import json
import time
import random
import logging
import argparse
from datetime import datetime
from playwright.sync_api import sync_playwright, Page, BrowserContext

# Thiết lập logging chuẩn UTF-8
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("AutoDraft")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(BASE_DIR, "logs")
PROCESSED_LOG_PATH = os.path.join(LOG_DIR, "draft_processed.json")
SCREENSHOT_DIR = os.path.join(LOG_DIR, "screenshots")
SESSION_DIR = os.path.join(BASE_DIR, "chrome_nhadat247_session")
ARTIFACT_DIR = r"C:\Users\PC\.gemini\antigravity\brain\fd74a0a2-276c-4f36-af82-df537c0243c8"

os.makedirs(LOG_DIR, exist_ok=True)
os.makedirs(SCREENSHOT_DIR, exist_ok=True)
os.makedirs(SESSION_DIR, exist_ok=True)
if os.path.exists(ARTIFACT_DIR):
    os.makedirs(ARTIFACT_DIR, exist_ok=True)

BASE_DRAFT_URL = "https://nhadat247.vn/tai-khoan/quan-ly-tin-dang?status=draft"

# Chuỗi mô tả chuẩn cần thêm vào ô "Mô tả chi tiết *"
TEMPLATE_DESC = """📍Vị trí: đường Phan Huy Ích, tiện đi ra Quang Trung, Nguyễn Văn Khối, Trường Chinh (Tân Bình), Phan Văn Trị...
🧭 Trong bán kính 1-2km: Emart Phan Huy Ích, trường học 3 cấp, phòng khám, mua sắm, chợ,...
🏡 Diện tích thực tế 50m2, 5PN. BTCT mới đẹp dọn vào ở ngay. Khu cao tầng đồng bộ văn minh. Hẻm xe hơi vào nhà.
✅ Mã SP: 
📞 Gọi/Zalo Châu 0783.515.486 để biết thêm thông tin và xem nhà thực tế.
🏡 NHẬN KÝ GỬI NHÀ ĐẤT TẤT CẢ CÁC QUẬN TPHCM - Alo Châu!"""


def load_processed_data() -> dict:
    """Đọc danh sách tin nháp đã xử lý từ logs/draft_processed.json."""
    if os.path.exists(PROCESSED_LOG_PATH):
        try:
            with open(PROCESSED_LOG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Lỗi đọc {PROCESSED_LOG_PATH}: {e}")
    return {"processed_ids": [], "history": []}


def save_processed_data(data: dict):
    """Lưu danh sách tin nháp đã xử lý vào logs/draft_processed.json."""
    try:
        with open(PROCESSED_LOG_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Lỗi ghi {PROCESSED_LOG_PATH}: {e}")


def launch_browser_context(playwright) -> BrowserContext:
    """
    Khởi chạy trình duyệt với Persistent Context:
    Ưu tiên channel='chrome', nếu máy thiếu Google Chrome sẽ tự động fallback sang Chromium của Playwright.
    """
    args = [
        "--start-maximized",
        "--disable-blink-features=AutomationControlled",
        "--no-default-browser-check",
    ]
    
    try:
        logger.info(f"Đang mở Google Chrome (channel='chrome'). Thư mục phiên: {SESSION_DIR}")
        context = playwright.chromium.launch_persistent_context(
            user_data_dir=SESSION_DIR,
            channel="chrome",
            headless=False,
            viewport=None,
            args=args
        )
        logger.info("Khởi chạy Google Chrome thành công!")
        return context
    except Exception as e:
        logger.warning(f"Không thể khởi chạy channel='chrome' ({e}). Đang fallback sang Chromium tích hợp...")
        context = playwright.chromium.launch_persistent_context(
            user_data_dir=SESSION_DIR,
            headless=False,
            viewport=None,
            args=args
        )
        logger.info("Khởi chạy Chromium tích hợp thành công!")
        return context


def check_is_logged_in(page: Page) -> bool:
    """Kiểm tra xem trang hiện tại đã ở trạng thái đăng nhập hay chưa."""
    try:
        return page.evaluate("""() => {
            const body = document.body ? document.body.innerText : '';
            const title = document.title || '';
            const url = window.location.href;
            
            // Nếu URL là trang đăng nhập hoặc tiêu đề / nội dung có yêu cầu đăng nhập
            if (url.includes('/dang-nhap') || title.includes('Đăng nhập') || 
                body.includes('Đăng nhập hoặc tạo tài khoản') || 
                body.includes('Nhập số điện thoại để tiếp tục')) {
                return false;
            }
            
            // Nếu có các thành phần chứng minh đã đăng nhập
            const hasUserMenu = !!document.querySelector("a[href*='/tai-khoan'], [class*='avatar'], a[href*='/dang-tin']");
            const hasDraftList = body.includes('Quản lý tin') || body.includes('Tin nháp') || 
                                 !!document.querySelector("a[href*='/dang-tin/'], button, a");
            return hasUserMenu || hasDraftList;
        }""")
    except Exception:
        return False


def wait_for_user_login(page: Page, max_wait_sec: int = 300) -> bool:
    """Kiểm tra và đợi người dùng hoàn tất đăng nhập nếu đang ở trang login."""
    start_time = time.time()
    last_print = 0
    while time.time() - start_time < max_wait_sec:
        if check_is_logged_in(page):
            logger.info("✅ ĐÃ XÁC NHẬN ĐĂNG NHẬP THÀNH CÔNG! Phiên đăng nhập được lưu tự động.")
            return True
            
        remaining = int(max_wait_sec - (time.time() - start_time))
        if time.time() - last_print >= 5:
            logger.warning(
                f"[CHỜ ĐĂNG NHẬP] Vui lòng đăng nhập tài khoản trên cửa sổ trình duyệt vừa mở "
                f"(Bấm 'Tiếp tục bằng Google' hoặc nhập SĐT)... Còn {remaining}s"
            )
            last_print = time.time()
        time.sleep(2)
        
    logger.error("Hết thời gian chờ đăng nhập (300 giây). Vui lòng đăng nhập lại.")
    return False


def get_draft_items_on_page(page: Page) -> list:
    """
    Quét danh sách các tin nháp trên trang hiện tại.
    Trả về danh sách dict: [{'index': ..., 'id': ..., 'title': ..., 'href': ...}]
    """
    page.wait_for_load_state("domcontentloaded")
    time.sleep(1.5)

    items = page.evaluate("""() => {
        const results = [];
        
        // Tìm tất cả các nút hoặc link 'Chỉnh sửa' / 'Sửa'
        const editCandidates = Array.from(document.querySelectorAll("a, button")).filter(el => {
            const txt = (el.textContent || '').trim().toLowerCase();
            const href = el.getAttribute('href') || '';
            const titleAttr = (el.getAttribute('title') || '').toLowerCase();
            const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            
            return txt === 'chỉnh sửa' || txt === 'sửa' || txt.includes('chỉnh sửa') || 
                   titleAttr.includes('chỉnh sửa') || ariaLabel.includes('chỉnh sửa') ||
                   href.includes('/dang-tin/');
        });

        editCandidates.forEach((el, index) => {
            let row = el.closest('tr') || el.closest('div[class*="item"]') || el.closest('div[class*="card"]') || el.closest('div[class*="border"]') || el.parentElement;
            let title = '';
            let id = '';

            if (row) {
                const titleEl = row.querySelector('h2, h3, h4, a[href*="/ban-"], div[class*="font-semibold"], div[class*="font-medium"], [class*="title"]');
                if (titleEl) {
                    title = titleEl.textContent.trim();
                    const href = titleEl.getAttribute('href') || '';
                    const mId = href.match(/-([0-9a-f]{6,16})(?:$|\\?)/);
                    if (mId) id = mId[1];
                }
            }

            const href = el.getAttribute('href') || '';
            if (!id && href) {
                const mId2 = href.match(/\/dang-tin\/([^\/\?]+)/);
                if (mId2) id = mId2[1];
            }

            if (!id) {
                id = 'draft_' + index + '_' + (title ? title.substring(0, 15).replace(/[^a-zA-Z0-9]/g, '') : Math.random().toString(36).substring(7));
            }

            results.push({
                index: index,
                id: id,
                title: title || ('Tin nháp #' + (index + 1)),
                href: href
            });
        });

        return results;
    }""")

    return items


def fill_description_and_save(page: Page, draft_info: dict, is_test_run: bool = False) -> bool:
    """
    Thực hiện quy trình:
    1. Bấm nút Chỉnh sửa của tin nháp.
    2. Chuyển sang Bước 2 (Thông tin BĐS) nếu đang ở Bước 1.
    3. Tại Bước 2 -> Tìm textarea 'Mô tả chi tiết *'.
    4. Kiểm tra chống chèn trùng (nếu đã có '0783.515.486' -> bỏ qua).
    5. Nối TEMPLATE_DESC -> Kích hoạt event input/change React.
    6. Chụp ảnh before/after và bấm 'Lưu nháp'.
    """
    draft_id = draft_info["id"]
    draft_title = draft_info["title"]
    logger.info(f"\n--- Đang xử lý tin: [{draft_id}] {draft_title[:60]} ---")

    # 1. Bấm nút Chỉnh sửa
    if draft_info.get("href") and "/dang-tin/" in draft_info["href"]:
        target_url = "https://nhadat247.vn" + draft_info["href"] if draft_info["href"].startswith("/") else draft_info["href"]
        logger.info(f"Điều hướng trực tiếp tới form sửa: {target_url}")
        page.goto(target_url, wait_until="domcontentloaded")
    else:
        logger.info(f"Bấm nút 'Chỉnh sửa' tại vị trí #{draft_info['index']}...")
        edit_btns = page.locator("a:has-text('Chỉnh sửa'), button:has-text('Chỉnh sửa'), a[href*='/dang-tin/'], [aria-label*='Chỉnh sửa']").all()
        if draft_info["index"] < len(edit_btns):
            edit_btns[draft_info["index"]].click()
        else:
            logger.error(f"Không tìm thấy nút Chỉnh sửa cho index {draft_info['index']}")
            return False

    page.wait_for_load_state("domcontentloaded")
    time.sleep(2)

    # 2. Xử lý chuyển sang Bước 2 (Thông tin BĐS) nếu đang ở Bước 1
    textarea = page.locator("textarea[name='description'], textarea#description, textarea[placeholder*='mô tả'], textarea").first
    if not textarea.is_visible():
        logger.info("Đang ở Bước 1 (Địa chỉ BĐS). Đang chuyển sang Bước 2 (Thông tin BĐS)...")
        # Thử bấm tab bước 2 nếu có
        step2_tab = page.locator("text='Thông tin BĐS', text='Bước 2'").first
        if step2_tab.is_visible():
            step2_tab.click()
            time.sleep(1.5)

        # Nếu vẫn chưa thấy textarea, bấm nút 'Tiếp tục'
        if not textarea.is_visible():
            next_btn = page.locator("button:has-text('Tiếp tục'), button:has-text('Tiếp theo'), button[type='submit']:has-text('Tiếp tục')").first
            try:
                next_btn.wait_for(state="visible", timeout=6000)
                next_btn.click()
                time.sleep(2)
            except Exception as e:
                logger.warning(f"Không tìm thấy nút 'Tiếp tục' ở bước 1: {e}")

    page.wait_for_load_state("domcontentloaded")

    # 3. Tìm ô textarea 'Mô tả chi tiết *'
    logger.info("Đang ở Bước 2 (Thông tin BĐS). Tìm ô 'Mô tả chi tiết *'...")
    try:
        textarea.wait_for(state="visible", timeout=12000)
    except Exception as e:
        logger.error(f"Không tìm thấy ô textarea mô tả: {e}")
        err_shot = os.path.join(SCREENSHOT_DIR, f"err_no_textarea_{draft_id}.png")
        page.screenshot(path=err_shot)
        return False

    textarea.scroll_into_view_if_needed()
    time.sleep(0.5)

    current_val = textarea.input_value() or ""
    logger.info(f"Độ dài mô tả hiện tại: {len(current_val)} ký tự.")

    # Chụp ảnh trước khi sửa
    before_shot_path = os.path.join(SCREENSHOT_DIR, f"before_edit_{draft_id}.png")
    before_artifact = os.path.join(ARTIFACT_DIR, f"before_edit_{draft_id}.png")
    try:
        textarea.screenshot(path=before_shot_path)
        if os.path.exists(ARTIFACT_DIR):
            textarea.screenshot(path=before_artifact)
    except Exception as e:
        logger.warning(f"Lỗi chụp ảnh before: {e}")

    # Kiểm tra chống chèn trùng
    if "0783.515.486" in current_val or "NHẬN KÝ GỬI NHÀ ĐẤT" in current_val:
        logger.info("ℹ️ Ô mô tả đã chứa sẵn thông tin liên hệ / ký gửi. Bỏ qua không chèn trùng.")
        page.goto(BASE_DRAFT_URL, wait_until="domcontentloaded")
        time.sleep(1.5)
        return True

    # Nối nội dung mới
    if current_val.strip():
        new_val = current_val.strip() + "\n\n" + TEMPLATE_DESC
    else:
        new_val = TEMPLATE_DESC

    # Điền nội dung và kích hoạt sự kiện React
    textarea.fill(new_val)
    page.evaluate("""({ selector, text }) => {
        const el = document.querySelector(selector) || document.querySelector('textarea');
        if (el) {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            nativeSetter.call(el, text);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }""", {"selector": "textarea[name='description']", "text": new_val})

    time.sleep(1)

    # Chụp ảnh sau khi điền
    after_shot_path = os.path.join(SCREENSHOT_DIR, f"after_edit_{draft_id}.png")
    after_artifact = os.path.join(ARTIFACT_DIR, f"after_edit_{draft_id}.png")
    try:
        textarea.screenshot(path=after_shot_path)
        if os.path.exists(ARTIFACT_DIR):
            textarea.screenshot(path=after_artifact)
    except Exception as e:
        logger.warning(f"Lỗi chụp ảnh after: {e}")
    logger.info(f"Đã cập nhật mô tả ({len(new_val)} ký tự). Đã chụp ảnh minh chứng sau khi sửa.")

    # 4. Tìm và bấm nút 'Lưu nháp'
    logger.info("Tìm và bấm nút 'Lưu nháp'...")
    save_draft_btn = page.locator("button:has-text('Lưu nháp'), button:has-text('Lưu tạm'), a:has-text('Lưu nháp'), [aria-label*='Lưu nháp']").first
    try:
        save_draft_btn.wait_for(state="visible", timeout=8000)
        save_draft_btn.click()
        logger.info("Đã bấm nút 'Lưu nháp'. Chờ xác nhận lưu...")
        time.sleep(3)
    except Exception as e:
        logger.warning(f"Lỗi khi bấm nút Lưu nháp: {e}. Thử tìm nút Lưu khác...")
        alt_save = page.locator("button:has-text('Lưu')").all()
        for b in alt_save:
            txt = b.text_content().strip()
            if "nháp" in txt.lower() or "tạm" in txt.lower():
                b.click()
                time.sleep(3)
                break

    page.goto(BASE_DRAFT_URL, wait_until="domcontentloaded")
    time.sleep(2)
    return True


def run_batch_process(limit: int = 2):
    """Quy trình chính xử lý tự động toàn bộ hoặc giới hạn số tin nháp."""
    logger.info("==================================================================")
    logger.info(f"BẮT ĐẦU QUY TRÌNH TỰ ĐỘNG ĐIỀN MÔ TẢ TIN NHÁP (LIMIT={limit})")
    logger.info("==================================================================")

    with sync_playwright() as p:
        context = launch_browser_context(p)
        pages = context.pages
        page = pages[0] if pages else context.new_page()

        # 1. Điều hướng tới trang quản lý tin nháp
        logger.info(f"Điều hướng tới: {BASE_DRAFT_URL}")
        page.goto(BASE_DRAFT_URL, wait_until="domcontentloaded")
        time.sleep(3)

        # 2. Kiểm tra đăng nhập (chờ tối đa 300s nếu chưa đăng nhập)
        if not wait_for_user_login(page, max_wait_sec=300):
            logger.error("Dừng tiến trình do chưa đăng nhập.")
            context.close()
            return

        # Nạp lịch sử đã xử lý
        processed_data = load_processed_data()
        processed_ids = set(processed_data.get("processed_ids", []))
        logger.info(f"Số lượng tin nháp đã xử lý trước đó: {len(processed_ids)}")

        total_processed_in_session = 0
        current_page_num = 1
        max_pages = 25

        while current_page_num <= max_pages:
            page_url = BASE_DRAFT_URL if current_page_num == 1 else f"{BASE_DRAFT_URL}&trang={current_page_num}"
            logger.info(f"\n================ ĐANG DUYỆT TRANG {current_page_num}: {page_url} ================")
            page.goto(page_url, wait_until="domcontentloaded")
            time.sleep(2.5)

            items = get_draft_items_on_page(page)
            logger.info(f"Phát hiện {len(items)} tin trên trang {current_page_num}.")

            if not items:
                logger.info("Không còn tin nháp nào trên trang này. Kết thúc.")
                break

            # Lọc các tin chưa xử lý
            unprocessed_items = [it for it in items if it["id"] not in processed_ids]
            logger.info(f"Số tin chưa xử lý trên trang {current_page_num}: {len(unprocessed_items)} / {len(items)}")

            if not unprocessed_items:
                logger.info("Tất cả tin trên trang này đã được xử lý. Chuyển sang trang tiếp theo...")
                current_page_num += 1
                continue

            for item in unprocessed_items:
                if limit is not None and total_processed_in_session >= limit:
                    logger.info(f"Đã đạt giới hạn LIMIT = {limit} tin xử lý. Dừng phiên.")
                    break

                success = fill_description_and_save(page, item, is_test_run=(limit is not None and limit <= 5))
                if success:
                    processed_ids.add(item["id"])
                    processed_data["processed_ids"] = list(processed_ids)
                    processed_data["history"].append({
                        "id": item["id"],
                        "title": item["title"],
                        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        "status": "success"
                    })
                    save_processed_data(processed_data)
                    total_processed_in_session += 1
                    logger.info(f"✅ Hoàn tất tin {total_processed_in_session} (ID: {item['id']})")
                else:
                    logger.warning(f"⚠️ Thất bại khi xử lý tin ID: {item['id']}")

                # Nghỉ ngẫu nhiên 1.5 - 2.5 giây giữa các tin
                delay = random.uniform(1.5, 2.5)
                logger.info(f"Nghỉ {delay:.1f}s trước khi xử lý tin tiếp theo...")
                time.sleep(delay)

            if limit is not None and total_processed_in_session >= limit:
                break

            current_page_num += 1

        logger.info("==================================================================")
        logger.info(f"HOÀN TẤT ĐỢT XỬ LÝ! Tổng số tin đã xử lý trong phiên: {total_processed_in_session}")
        logger.info(f"Tổng số tin nháp đã lưu trong log: {len(processed_ids)}")
        logger.info("==================================================================")
        
        # Giữ context nếu chạy thử nghiệm để người dùng xem kết quả
        time.sleep(2)
        context.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Tự động điền mô tả và lưu nháp tin đăng nhadat247")
    parser.add_argument("--limit", type=int, default=2, help="Giới hạn số tin xử lý (Mặc định: 2 để kiểm thử, truyền -1 hoặc --all để xử lý tất cả)")
    parser.add_argument("--all", action="store_true", help="Xử lý toàn bộ không giới hạn")
    args = parser.parse_args()

    lim = None if args.all or args.limit == -1 else args.limit
    run_batch_process(limit=lim)
