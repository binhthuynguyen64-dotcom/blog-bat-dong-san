@echo off
cd /d "D:\affiliate\skill-edit-blogspot\blog-bat-dong-san"
echo ==============================================================================
echo AUTO-FILL DRAFTS NHADAT247.VN - CHROME DAILY PROFILE
echo ==============================================================================

echo [1/5] Auto-detecting Chrome Profile for Nhadat247 and Thien Khoi...
python detect_chrome_profile.py

set "TARGET_PROFILE=Profile 2"
if exist "data\chrome_profile_choice.txt" set /p TARGET_PROFILE=<"data\chrome_profile_choice.txt"

echo [INFO] Selected Chrome Profile: "%TARGET_PROFILE%"
echo [2/5] Closing old Chrome processes to release profile lock...
taskkill /F /IM chrome.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo [3/5] Locating chrome.exe...
set "CHROME_EXE="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
if "%CHROME_EXE%"=="" if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if "%CHROME_EXE%"=="" if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if "%CHROME_EXE%"=="" goto chrome_not_found

echo [INFO] Found Chrome: "%CHROME_EXE%"
echo [4/5] Checking User Data link (Port 9222)...
if not exist "C:\Users\PC\.chrome_daily_profile" mklink /J "C:\Users\PC\.chrome_daily_profile" "%LocalAppData%\Google\Chrome\User Data" >nul 2>&1

echo [5/5] Launching Chrome with Profile "%TARGET_PROFILE%" and Port 9222...
start "" "%CHROME_EXE%" --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="C:\Users\PC\.chrome_daily_profile" --profile-directory="%TARGET_PROFILE%" --restore-last-session "https://nhadat247.vn/tai-khoan/quan-ly-tin-dang?status=draft"

echo [INFO] Waiting 5 seconds for Chrome to initialize...
timeout /t 5 /nobreak >nul

echo.
echo ==============================================================================
if "%1"=="--all" goto run_all
if not "%1"=="" goto run_args
goto run_limit2

:run_all
echo [RUNNING] Auto-draft processing ALL listings (--all)
python auto_fill_drafts.py --all
goto end

:run_args
echo [RUNNING] Auto-draft processing with args: %*
python auto_fill_drafts.py %*
goto end

:run_limit2
echo [RUNNING] Auto-draft test run on 2 listings (--limit 2)
echo (To process ALL drafts, run: CHAY_TREN_CHROME_HANG_NGAY.bat --all)
python auto_fill_drafts.py --limit 2
goto end

:chrome_not_found
echo [ERROR] chrome.exe not found on this computer!
pause
exit /b 1

:end
echo.
echo ==============================================================================
echo [COMPLETED] Work session finished. Press any key to close this window...
pause >nul
