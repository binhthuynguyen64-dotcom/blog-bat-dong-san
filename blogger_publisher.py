#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
==============================================================================
MODULE TỰ ĐỘNG CẬP NHẬT TRANG LÊN BLOGGER (blogger_publisher.py)
Blog: Hồng Châu - Nhà Ưng Ý (Blog ID: 6393463168628520519)
API: Google Blogger API v3
Chức năng:
  - Tự động xác thực qua OAuth2 (dùng token.json / credentials.json)
  - Tự động tìm kiếm Trang tĩnh (Page) hoặc tạo mới nếu chưa có
  - Ghi đè toàn bộ nội dung HTML mới nhất từ blogger-page.html
  - Trả về đường link công khai trực tiếp để xem ngay kết quả
  - Tùy chọn tự động đồng bộ git push listings.json (nếu có Git)
==============================================================================
"""

import os
import sys
import json
import logging
import subprocess
from dotenv import load_dotenv

# Thiết lập logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("BloggerPublisher")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.append(BASE_DIR)

# Nạp cấu hình từ .env
ENV_FILE = os.path.join(BASE_DIR, ".env")
load_dotenv(ENV_FILE)

DEFAULT_BLOG_ID = os.getenv("BLOGGER_BLOG_ID", "6393463168628520519")
DEFAULT_PAGE_ID = os.getenv("BLOGGER_PAGE_ID", "")
DEFAULT_PAGE_TITLE = os.getenv("BLOGGER_PAGE_TITLE", "Kho Nhà Thật Giá Tốt")
HTML_FILE_PATH = os.path.join(BASE_DIR, "blogger-page.html")
OLD_ERROR_PAGE_ID = "6896894773260115609"

SCOPES = [
    "https://www.googleapis.com/auth/blogger",
    "https://www.googleapis.com/auth/spreadsheets"
]


def update_env_variable(key: str, value: str):
    """Cập nhật hoặc thêm một biến vào file .env một cách an toàn."""
    if not os.path.exists(ENV_FILE):
        with open(ENV_FILE, "w", encoding="utf-8") as f:
            f.write(f"{key}={value}\n")
        return

    lines = []
    found = False
    with open(ENV_FILE, "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith(f"{key}=") or line.startswith(f"{key} ="):
                lines.append(f"{key}={value}\n")
                found = True
            else:
                lines.append(line)

    if not found:
        lines.append(f"{key}={value}\n")

    with open(ENV_FILE, "w", encoding="utf-8") as f:
        f.writelines(lines)
    logger.info(f"Đã lưu {key}={value} vào file .env")


def get_blogger_service():
    """
    Khởi tạo dịch vụ Google Blogger API v3 bằng OAuth2.
    Tự động tìm kiếm token.json / credentials.json trong thư mục hiện tại hoặc thư mục cha.
    """
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build

    token_candidates = [
        os.path.join(BASE_DIR, "token.json"),
        os.path.join(os.path.dirname(BASE_DIR), "token.json"),
        os.path.join(os.path.dirname(BASE_DIR), "token.json.bak")
    ]
    
    cred_candidates = [
        os.path.join(BASE_DIR, "credentials.json"),
        os.path.join(os.path.dirname(BASE_DIR), "credentials.json")
    ]

    # Hỗ trợ nạp token từ biến môi trường (dành cho GitHub Actions Secrets)
    env_token = os.getenv("BLOGGER_TOKEN_JSON")
    if env_token and not any(os.path.exists(p) and os.path.getsize(p) > 0 for p in token_candidates):
        try:
            target_token_path = os.path.join(BASE_DIR, "token.json")
            with open(target_token_path, "w", encoding="utf-8") as f:
                f.write(env_token)
            token_candidates.insert(0, target_token_path)
            logger.info("Đã khôi phục token từ biến môi trường BLOGGER_TOKEN_JSON.")
        except Exception as e:
            logger.warning(f"Lỗi nạp BLOGGER_TOKEN_JSON: {e}")

    token_file = None
    for p in token_candidates:
        if os.path.exists(p) and os.path.getsize(p) > 0:
            token_file = p
            break

    credentials_file = None
    for p in cred_candidates:
        if os.path.exists(p) and os.path.getsize(p) > 0:
            credentials_file = p
            break

    creds = None
    if token_file:
        try:
            creds = Credentials.from_authorized_user_file(token_file, SCOPES)
        except Exception as e:
            logger.warning(f"Lỗi đọc file {token_file}: {e}")

    # Tự động refresh token nếu đã hết hạn
    if creds and creds.expired and creds.refresh_token:
        try:
            logger.info("Đang tự động làm mới (refresh) Google OAuth2 token...")
            creds.refresh(Request())
            # Lưu lại token mới vào thư mục hiện tại
            save_path = os.path.join(BASE_DIR, "token.json")
            with open(save_path, "w", encoding="utf-8") as f:
                f.write(creds.to_json())
            logger.info(f"Đã lưu token mới vào: {save_path}")
        except Exception as e:
            logger.warning(f"Không thể làm mới token: {e}. Cần xác thực lại.")
            creds = None

    # Nếu chưa có token hoặc token không hợp lệ -> Chạy xác thực bằng trình duyệt
    if not creds or not creds.valid:
        if not credentials_file:
            raise FileNotFoundError(
                "Không tìm thấy file credentials.json (OAuth Client ID). "
                "Vui lòng tải credentials.json từ Google Cloud Console và đặt vào thư mục dự án."
            )

        from google_auth_oauthlib.flow import InstalledAppFlow
        logger.info(f"Đang mở trình duyệt để xác thực Google OAuth2 từ: {credentials_file}")
        flow = InstalledAppFlow.from_client_secrets_file(credentials_file, SCOPES)
        creds = flow.run_local_server(port=0)
        
        save_path = os.path.join(BASE_DIR, "token.json")
        with open(save_path, "w", encoding="utf-8") as f:
            f.write(creds.to_json())
        logger.info(f"Xác thực thành công! Đã lưu token vào: {save_path}")

    service = build("blogger", "v3", credentials=creds)
    return service


def git_sync():
    """Tùy chọn tự động add, commit và push dữ liệu mới lên GitHub nếu thư mục có git."""
    try:
        git_dir = os.path.join(BASE_DIR, ".git")
        if not os.path.exists(git_dir):
            return

        subprocess.run(["git", "add", "data/listings.json", "data/price_history.json"], cwd=BASE_DIR, check=True)
        # Check if there are changes to commit
        diff = subprocess.run(["git", "diff", "--staged", "--quiet"], cwd=BASE_DIR)
        if diff.returncode != 0:
            subprocess.run(["git", "commit", "-m", "chore: auto-sync property listings [skip ci]"], cwd=BASE_DIR, check=True)
            subprocess.run(["git", "push"], cwd=BASE_DIR, check=True)
            logger.info("Đã đồng bộ commit & push dữ liệu listings.json lên GitHub.")
    except Exception as e:
        logger.warning(f"Bỏ qua đồng bộ git: {e}")


def publish_to_blogger(
    blog_id: str = DEFAULT_BLOG_ID,
    page_id: str = DEFAULT_PAGE_ID,
    page_title: str = DEFAULT_PAGE_TITLE,
    html_path: str = HTML_FILE_PATH,
    recreate_seo: bool = False
) -> dict:
    """
    Tự động cập nhật nội dung từ blogger-page.html lên Trang tĩnh Blogger.
    Nếu chưa có page_id, tự động tìm kiếm trang cũ hoặc tạo trang mới.
    """
    logger.info("==================================================================")
    logger.info("BẮT ĐẦU ĐẨY NỘI DUNG TỰ ĐỘNG LÊN BLOGGER")
    logger.info(f"Blog ID: {blog_id} | Tiêu đề: {page_title}")
    logger.info("==================================================================")

    if not os.path.exists(html_path):
        raise FileNotFoundError(f"Không tìm thấy file giao diện HTML tại: {html_path}")

    with open(html_path, "r", encoding="utf-8") as f:
        html_content = f.read()

    service = get_blogger_service()

    # Kiểm tra blog
    try:
        blog_info = service.blogs().get(blogId=blog_id).execute()
        logger.info(f"Đã kết nối Blog: '{blog_info.get('name')}' ({blog_info.get('url')})")
    except Exception as e:
        raise RuntimeError(f"Không thể kết nối đến Blog ID {blog_id}: {e}")

    target_page_id = page_id.strip() if page_id else ""

    # Kiểm tra yêu cầu xóa trang cũ bị lỗi URL (/p/reset-triet-e-container-cua-moi-giao.html) để tạo trang mới chuẩn SEO
    is_old_error_page = (target_page_id == OLD_ERROR_PAGE_ID) or recreate_seo or ("--recreate" in sys.argv)
    if is_old_error_page:
        logger.info(f"Yêu cầu tạo Trang tĩnh mới chuẩn SEO (Tiêu đề: '{page_title}')...")
        old_id_to_delete = target_page_id if target_page_id else OLD_ERROR_PAGE_ID
        try:
            logger.info(f"Đang xóa trang cũ có link bị lỗi (Page ID: {old_id_to_delete})...")
            service.pages().delete(blogId=blog_id, pageId=old_id_to_delete).execute()
            logger.info("Đã xóa trang cũ trên Blogger thành công!")
        except Exception as e:
            logger.warning(f"Lỗi khi xóa trang cũ {old_id_to_delete} (hoặc trang đã được xóa): {e}")
        target_page_id = ""  # Reset để chạy vào luồng tạo trang mới (Insert)

    # Nếu chưa có page_id trong .env, quét danh sách trang tĩnh trên Blog
    if not target_page_id:
        logger.info("Chưa có BLOGGER_PAGE_ID. Đang quét các trang hiện có trên Blog...")
        try:
            pages_list = service.pages().list(blogId=blog_id).execute()
            items = pages_list.get("items", [])
            for p in items:
                # Nếu tiêu đề khớp chính xác với tiêu đề chuẩn SEO
                p_title = p.get("title") or ""
                if p_title and p_title.lower() == page_title.lower():
                    target_page_id = p.get("id")
                    logger.info(f"Phát hiện trang tĩnh chuẩn SEO đã có: ID={target_page_id} | Tiêu đề: {p_title}")
                    update_env_variable("BLOGGER_PAGE_ID", target_page_id)
                    break
        except Exception as e:
            logger.warning(f"Lỗi khi quét danh sách trang: {e}")

    result_page = None

    # TRƯỜNG HỢP 1: CẬP NHẬT TRANG ĐÃ CÓ
    if target_page_id:
        logger.info(f"Đang cập nhật (Update) trang tĩnh ID: {target_page_id}...")
        body = {
            "title": page_title,
            "content": html_content
        }
        try:
            result_page = service.pages().update(
                blogId=blog_id,
                pageId=target_page_id,
                body=body
            ).execute()
            logger.info("Cập nhật nội dung trang Blogger thành công!")
        except Exception as e:
            logger.warning(f"Lỗi khi cập nhật trang {target_page_id}: {e}. Đang thử tạo trang mới...")
            target_page_id = ""

    # TRƯỜNG HỢP 2: TẠO MỚI TRANG TĨNH CHUẨN SEO
    if not target_page_id:
        logger.info(f"Đang tạo mới (Insert) trang tĩnh chuẩn SEO '{page_title}' trên Blogger...")
        body = {
            "title": page_title,
            "content": html_content
        }
        result_page = service.pages().insert(
            blogId=blog_id,
            isDraft=False,
            body=body
        ).execute()
        new_page_id = result_page.get("id")
        logger.info(f"Tạo trang mới thành công! Page ID mới: {new_page_id}")
        update_env_variable("BLOGGER_PAGE_ID", new_page_id)
        update_env_variable("BLOGGER_PAGE_TITLE", page_title)

    public_url = result_page.get("url") if result_page else ""
    page_id_final = result_page.get("id") if result_page else target_page_id

    # Đồng bộ git nếu có
    git_sync()

    print("\n" + "=" * 70)
    print("🎉 XUẤT BẢN THÀNH CÔNG LÊN BLOGGER 'HỒNG CHÂU - NHÀ ƯNG Ý'!")
    print(f"📌 Tiêu đề trang: {page_title}")
    print(f"🆔 Page ID: {page_id_final}")
    print(f"🌐 LINK XEM TRỰC TIẾP TRANG BLOGGER:")
    print(f"👉 {public_url}")
    print("=" * 70 + "\n")

    return {
        "status": "success",
        "blog_id": blog_id,
        "page_id": page_id_final,
        "title": page_title,
        "url": public_url
    }


if __name__ == "__main__":
    load_dotenv(ENV_FILE)
    b_id = os.getenv("BLOGGER_BLOG_ID", DEFAULT_BLOG_ID)
    p_id = os.getenv("BLOGGER_PAGE_ID", DEFAULT_PAGE_ID)
    p_title = os.getenv("BLOGGER_PAGE_TITLE", DEFAULT_PAGE_TITLE)
    publish_to_blogger(b_id, p_id, p_title, HTML_FILE_PATH)
