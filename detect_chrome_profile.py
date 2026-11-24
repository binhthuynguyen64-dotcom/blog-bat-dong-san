#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
==============================================================================
TỰ ĐỘNG NHẬN DIỆN VÀ CHỌN ĐÚNG CHROME PROFILE CHỨA TÀI KHOẢN NHADAT247 & CÔNG TY
==============================================================================
- Quét Local State và các thư mục Profile trong Chrome User Data
- Đối chiếu lịch sử truy cập nhadat247.vn, thienkhoi.com, proptech.thienkhoi.com
- Hiển thị menu chọn Profile (tự động chọn Profile mới nhất sau 5 giây)
- Ghi nhận lựa chọn vào data/chrome_profile_choice.txt
==============================================================================
"""

import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
import json
import time
import shutil
import sqlite3
import tempfile
import argparse
from datetime import datetime, timezone

try:
    import msvcrt
    HAS_MSVCRT = True
except ImportError:
    HAS_MSVCRT = False

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
CHOICE_FILE = os.path.join(DATA_DIR, "chrome_profile_choice.txt")
os.makedirs(DATA_DIR, exist_ok=True)


def chrome_time_to_dt(chrometime):
    """Chuyển đổi Chrome timestamp (microseconds since 1601-01-01) sang local datetime string."""
    if not chrometime:
        return None
    try:
        utc_dt = datetime.fromtimestamp((chrometime - 11644473600000000) / 1000000, tz=timezone.utc)
        return utc_dt.astimezone()  # Local time
    except Exception:
        return None


def scan_chrome_profiles() -> list:
    """
    Quét tất cả các Profile trong Chrome User Data.
    Trả về danh sách các Profile có liên quan tới nhadat247 hoặc thienkhoi, sắp xếp theo độ ưu tiên.
    """
    user_data = os.path.expandvars(r"%LocalAppData%\Google\Chrome\User Data")
    local_state_path = os.path.join(user_data, "Local State")

    profile_info = {}
    if os.path.exists(local_state_path):
        try:
            with open(local_state_path, "r", encoding="utf-8") as f:
                ls = json.load(f)
            profile_info = ls.get("profile", {}).get("info_cache", {})
        except Exception as e:
            print(f"[CẢNH BÁO] Không đọc được Local State: {e}")

    # Tìm các thư mục Profile
    candidate_dirs = []
    if os.path.exists(user_data):
        for item in os.listdir(user_data):
            p_path = os.path.join(user_data, item)
            if os.path.isdir(p_path) and (item == "Default" or item.startswith("Profile ")):
                candidate_dirs.append(item)

    matched_profiles = []

    for p_dir in candidate_dirs:
        p_path = os.path.join(user_data, p_dir)
        meta = profile_info.get(p_dir, {})
        display_name = meta.get("name", p_dir)
        user_name = meta.get("user_name", "")  # Email

        # Kiểm tra Preferences
        pref_keywords = []
        pref_path = os.path.join(p_path, "Preferences")
        if os.path.exists(pref_path):
            try:
                with open(pref_path, "r", encoding="utf-8", errors="ignore") as f:
                    pref_txt = f.read().lower()
                for kw in ["nhadat247", "thienkhoi", "hongchau", "batdongsan"]:
                    if kw in pref_txt:
                        pref_keywords.append(kw)
            except Exception:
                pass

        # Kiểm tra History SQLite
        hist_path = os.path.join(p_path, "History")
        hist_matches = []
        max_visit_time = 0
        draft_visit_count = 0
        has_logged_in_title = False
        has_thienkhoi_oauth = False

        if os.path.exists(hist_path):
            temp_db = os.path.join(tempfile.gettempdir(), f"chrome_check_{p_dir.replace(' ', '_')}_{os.getpid()}.db")
            try:
                shutil.copy2(hist_path, temp_db)
                conn = sqlite3.connect(temp_db)
                cur = conn.cursor()
                cur.execute("""
                    SELECT url, title, visit_count, last_visit_time 
                    FROM urls 
                    WHERE url LIKE '%nhadat247%' OR url LIKE '%thienkhoi%'
                    ORDER BY last_visit_time DESC
                """)
                rows = cur.fetchall()
                for r in rows:
                    u, title, count, last_time = r[0], r[1] or "", r[2], r[3]
                    hist_matches.append(r)
                    if last_time > max_visit_time:
                        max_visit_time = last_time
                    if "status=draft" in u or "quan-ly-tin-dang" in u:
                        draft_visit_count += count
                    if "Tin bán" in title or "Quản lý tin" in title:
                        has_logged_in_title = True
                    if "thienkhoi" in u and ("oauth" in u or "callback" in u or "proptech" in u):
                        has_thienkhoi_oauth = True
                conn.close()
                try:
                    os.remove(temp_db)
                except Exception:
                    pass
            except Exception:
                pass

        # Chỉ đưa vào danh sách nếu có dấu vết nhadat247 hoặc thienkhoi
        if hist_matches or "nhadat247" in pref_keywords or "thienkhoi" in pref_keywords or "thienkhoi" in user_name.lower():
            # Tính điểm ưu tiên
            score = 0
            if draft_visit_count > 0:
                score += 1000 + draft_visit_count
            if has_logged_in_title:
                score += 500
            if has_thienkhoi_oauth or "thienkhoi" in user_name.lower():
                score += 300
            if max_visit_time > 0:
                # Điểm theo thời gian gần nhất (chia bớt để làm thứ cấp)
                score += max_visit_time / 100000000000

            dt_recent = chrome_time_to_dt(max_visit_time)
            dt_str = dt_recent.strftime("%Y-%m-%d %H:%M:%S") if dt_recent else "Chưa ghi nhận"

            matched_profiles.append({
                "dir": p_dir,
                "name": display_name,
                "email": user_name,
                "score": score,
                "max_visit_time": max_visit_time,
                "recent_time_str": dt_str,
                "draft_count": draft_visit_count,
                "has_login": has_logged_in_title,
                "has_thienkhoi": has_thienkhoi_oauth or "thienkhoi" in user_name.lower(),
                "total_urls": len(hist_matches)
            })

    # Sắp xếp theo score giảm dần
    matched_profiles.sort(key=lambda x: x["score"], reverse=True)
    return matched_profiles


def prompt_profile_choice(profiles: list, timeout_sec: int = 5) -> str:
    """
    Hiển thị giao diện lựa chọn Profile trên CMD có đếm ngược timeout.
    Trả về tên thư mục Profile được chọn.
    """
    if not profiles:
        print("[LƯU Ý] Không tìm thấy Profile nào có lịch sử Nhadat247/Thiên Khôi. Sử dụng 'Default'.")
        return "Default"

    # Đọc lựa chọn cũ nếu có
    saved_choice = ""
    if os.path.exists(CHOICE_FILE):
        try:
            with open(CHOICE_FILE, "r", encoding="utf-8") as f:
                saved_choice = f.read().strip()
        except Exception:
            saved_choice = ""

    # Nếu chỉ có 1 profile
    if len(profiles) == 1:
        chosen = profiles[0]["dir"]
        print(f"\n[XÁC NHẬN TỰ ĐỘNG] Chỉ có 1 Profile BĐS phù hợp: [{chosen}] {profiles[0]['name']} ({profiles[0]['email']})")
        with open(CHOICE_FILE, "w", encoding="utf-8") as f:
            f.write(chosen)
        return chosen

    # Tìm index mặc định (ưu tiên saved_choice nếu có, nếu không thì index 0)
    default_idx = 0
    if saved_choice:
        for idx, p in enumerate(profiles):
            if p["dir"] == saved_choice:
                default_idx = idx
                break

    print("\n" + "=" * 80)
    print(" DANH SÁCH PROFILE CHROME ĐƯỢC PHÁT HIỆN CÓ TÀI KHOẢN NHADAT247 & CÔNG TY:")
    print("=" * 80)

    for i, p in enumerate(profiles):
        tag = ""
        if i == default_idx:
            tag = "  <-- [ĐƯỢC ĐỀ XUẤT / ĐÃ CHỌN TRƯỚC ĐÓ]" if saved_choice == p["dir"] else "  <-- [KHUYÊN DÙNG]"
        
        status_parts = []
        if p["has_login"]:
            status_parts.append("Đã đăng nhập")
        if p["draft_count"] > 0:
            status_parts.append(f"{p['draft_count']} lần vào Quản lý tin nháp")
        if p["has_thienkhoi"]:
            status_parts.append("Tài khoản Đối tác Thiên Khôi")
        
        status_desc = " • ".join(status_parts) if status_parts else "Từng truy cập"

        print(f" [{i + 1}] Profile: {p['dir']} | Tên: '{p['name']}' | Email: '{p['email']}'{tag}")
        print(f"     └─ Hoạt động gần nhất: {p['recent_time_str']} | {status_desc}")

    print("=" * 80)

    # Đếm ngược 5 giây nếu có terminal tương tác
    recommended_profile = profiles[default_idx]["dir"]
    is_interactive = sys.stdin.isatty() and HAS_MSVCRT

    if not is_interactive:
        print(f"Chế độ chạy tự động / Không hỗ trợ bàn phím. Mặc định chọn [{default_idx + 1}]: {recommended_profile}")
        with open(CHOICE_FILE, "w", encoding="utf-8") as f:
            f.write(recommended_profile)
        return recommended_profile

    print(f"Nhập số thứ tự (1-{len(profiles)}) để chọn, hoặc đợi {timeout_sec}s để tự động chọn [{default_idx + 1}]: ", end="", flush=True)

    start_time = time.time()
    user_choice = None

    while True:
        elapsed = time.time() - start_time
        remaining = int(timeout_sec - elapsed)

        if remaining < 0:
            break

        if msvcrt.kbhit():
            ch = msvcrt.getwche()
            if ch in ["\r", "\n"]:
                break
            elif ch.isdigit():
                val = int(ch)
                if 1 <= val <= len(profiles):
                    user_choice = val - 1
                    print(f"\n=> Bạn đã chọn: [{val}] {profiles[user_choice]['dir']}")
                    break
                else:
                    print(f"\n[Lỗi] Lựa chọn không hợp lệ (hãy chọn 1-{len(profiles)})")
                    break
        time.sleep(0.05)

    if user_choice is None:
        user_choice = default_idx
        print(f"\n=> Hết {timeout_sec} giây, tự động chọn [{default_idx + 1}]: {recommended_profile}")

    chosen_dir = profiles[user_choice]["dir"]
    with open(CHOICE_FILE, "w", encoding="utf-8") as f:
        f.write(chosen_dir)

    print(f"Đã lưu cấu hình Profile vào: {CHOICE_FILE}\n")
    return chosen_dir


def main():
    parser = argparse.ArgumentParser(description="Tự động phát hiện và chọn Chrome Profile cho Nhadat247")
    parser.add_argument("--auto", action="store_true", help="Tự động chọn profile tối ưu nhất không cần đợi")
    parser.add_argument("--print-only", action="store_true", help="Chỉ in tên profile đã chọn ra console")
    args = parser.parse_args()

    profiles = scan_chrome_profiles()

    if args.auto:
        if profiles:
            chosen = profiles[0]["dir"]
        else:
            chosen = "Default"
        with open(CHOICE_FILE, "w", encoding="utf-8") as f:
            f.write(chosen)
    else:
        chosen = prompt_profile_choice(profiles, timeout_sec=5)

    if args.print_only:
        print(chosen)
    else:
        print(f"CHOSEN_PROFILE={chosen}")


if __name__ == "__main__":
    main()
