@echo off
chcp 65001 >nul
echo ==============================================================================
echo CHẠY ĐỒNG BỘ KHO NHÀ & BÁO CÁO TELEGRAM: HỒNG CHÂU - NHÀ ƯNG Ý
echo ==============================================================================
D:
cd "D:\affiliate\skill-edit-blogspot\blog-bat-dong-san"
if not exist "logs" mkdir logs
echo Đang chạy đồng bộ dữ liệu... Vui lòng đợi trong giây lát!
python main.py > logs\daily_sync.log 2>&1
echo Hoàn tất! Đã lưu log vào thư mục logs\daily_sync.log.
pause
