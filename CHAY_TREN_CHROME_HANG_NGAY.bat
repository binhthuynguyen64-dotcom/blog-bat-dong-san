@echo off
chcp 65001 >nul
cd /d "D:\affiliate\skill-edit-blogspot\blog-bat-dong-san"

echo ==============================================================================
echo Đang khởi động lại trình duyệt Chrome hằng ngày của bạn để giữ nguyên phiên 
echo đăng nhập Nhadat247 & Tài khoản đối tác...
echo ==============================================================================
echo.

echo [1/4] Đang đóng các tiến trình Chrome cũ để giải phóng khóa phiên đăng nhập...
taskkill /F /IM chrome.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/4] Đang dò tìm đường dẫn Chrome trên máy tính...
set "CHROME_EXE="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "CHROME_EXE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
) else if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"
)

if "%CHROME_EXE%"=="" (
    echo [LỖI] Không tìm thấy file chrome.exe trên máy tính!
    pause
    exit /b 1
)
echo Đã tìm thấy: "%CHROME_EXE%"

echo [3/4] Đang tạo liên kết trực tiếp tới User Data hằng ngày để mở cổng kết nối 9222...
if not exist "C:\Users\PC\.chrome_daily_profile" (
    mklink /J "C:\Users\PC\.chrome_daily_profile" "%LocalAppData%\Google\Chrome\User Data" >nul 2>&1
)

echo [4/4] Khởi chạy Chrome hằng ngày (Giữ nguyên toàn bộ Cookie, Tài khoản đối tác & Tab cũ)...
start "" "%CHROME_EXE%" --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="C:\Users\PC\.chrome_daily_profile" --restore-last-session "https://nhadat247.vn/tai-khoan/quan-ly-tin-dang?status=draft"

echo Đang chờ Chrome khởi động xong (5 giây)...
timeout /t 5 /nobreak >nul

echo.
echo ==============================================================================
if "%1"=="--all" (
    echo KÍCH HOẠT AUTO-DRAFT: XỬ LÝ TOÀN BỘ TẤT CẢ TIN NHÁP (--all)
    python auto_fill_drafts.py --all
) else (
    echo KÍCH HOẠT AUTO-DRAFT: CHẠY THỬ NGHIỆM 2 TIN NHÁP ĐẦU TIÊN (--limit 2)
    python auto_fill_drafts.py --limit 2
)
echo ==============================================================================
echo.
echo Hoàn thành phiên làm việc. Nhấn phím bất kỳ để đóng cửa sổ này...
pause >nul
