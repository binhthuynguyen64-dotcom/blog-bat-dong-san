@echo off
chcp 65001 >nul
cd /d "D:\affiliate\skill-edit-blogspot\blog-bat-dong-san"

echo ==============================================================================
echo Đang khởi động trình duyệt Chrome BĐS & Đối tác Thiên Khôi (Nhadat247)...
echo ==============================================================================
echo.

echo [1/5] Đang đóng các tiến trình Chrome cũ để giải phóng khóa phiên đăng nhập...
taskkill /F /IM chrome.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/5] Đang dò tìm đường dẫn Chrome trên máy tính...
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

echo [3/5] Đang kiểm tra liên kết thư mục User Data (Port 9222)...
if not exist "C:\Users\PC\.chrome_daily_profile" (
    mklink /J "C:\Users\PC\.chrome_daily_profile" "%LocalAppData%\Google\Chrome\User Data" >nul 2>&1
)

echo [4/5] Tự động nhận diện Profile Chrome chứa tài khoản Nhadat247 ^& Thiên Khôi...
python detect_chrome_profile.py

set "CHOSEN_PROFILE=Profile 2"
if exist "data\chrome_profile_choice.txt" (
    set /p CHOSEN_PROFILE=<"data\chrome_profile_choice.txt"
)
echo.
echo => KHỞI CHẠY CHROME VỚI PROFILE: "%CHOSEN_PROFILE%"

echo [5/5] Đang mở Chrome (Giữ nguyên toàn bộ Cookie, Tài khoản đối tác ^& Tab cũ)...
start "" "%CHROME_EXE%" --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="C:\Users\PC\.chrome_daily_profile" --profile-directory="%CHOSEN_PROFILE%" --restore-last-session "https://nhadat247.vn/tai-khoan/quan-ly-tin-dang?status=draft"

echo Đang chờ Chrome khởi động xong (5 giây)...
timeout /t 5 /nobreak >nul

echo.
echo ==============================================================================
if "%1"=="" (
    echo KÍCH HOẠT AUTO-DRAFT: CHẠY THỬ NGHIỆM 2 TIN NHÁP ĐẦU TIÊN (--limit 2)
    echo (Để chạy toàn bộ không giới hạn, hãy chạy: CHAY_TREN_CHROME_HANG_NGAY.bat --all)
    echo.
    python auto_fill_drafts.py --limit 2
) else (
    echo KÍCH HOẠT AUTO-DRAFT VỚI THAM SỐ: %*
    echo.
    python auto_fill_drafts.py %*
)
echo ==============================================================================
echo.
echo Hoàn thành phiên làm việc. Nhấn phím bất kỳ để đóng cửa sổ này...
pause >nul
