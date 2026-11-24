@echo off
chcp 65001 >nul
cd /d "D:\affiliate\skill-edit-blogspot\blog-bat-dong-san"
echo ==============================================================================
echo TỰ ĐỘNG ĐIỀN MÔ TẢ CHI TIẾT & LƯU NHÁP HÀNG LOẠT TRÊN NHADAT247.VN
echo ==============================================================================
if "%1"=="--all" (
    echo [CHẾ ĐỘ] Chạy toàn bộ tất cả tin nháp (--all)
    python auto_fill_drafts.py --all
) else (
    echo [CHẾ ĐỘ] Chạy kiểm thử 2 tin nháp đầu tiên (--limit 2)
    python auto_fill_drafts.py --limit 2
)
echo.
echo ==============================================================================
echo Đã kết thúc phiên xử lý. Nhấn phím bất kỳ để đóng cửa sổ này...
echo ==============================================================================
pause >nul
