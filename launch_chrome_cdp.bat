@echo off
chcp 65001 >nul
echo =======================================================
echo KHỞI CHẠY CHROME DEBUG CHO NHADAT247.VN (PORT 9222)
echo =======================================================
echo Đang mở Chrome với remote debugging port 9222...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="C:\Users\PC\.chrome_debug_profile" "https://nhadat247.vn/tai-khoan/quan-ly-tin-dang?status=draft"
echo Đã mở Chrome. Vui lòng đăng nhập tài khoản nếu chưa đăng nhập.
