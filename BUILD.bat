@echo off
echo ============================================
echo   Grabbit — Build Script
echo ============================================
echo.

cd /d "C:\Users\enriq\OneDrive\Documents\grabbit-app"

echo [1/4] Generating grabbit.ico...
python -c "from PIL import Image; imgs=[Image.open('extension/icons/icon128.png').resize((s,s)) for s in [16,32,48,128]]; imgs[0].save('grabbit.ico', format='ICO', sizes=[(16,16),(32,32),(48,48),(128,128)])"

if errorlevel 1 (
  echo ERROR: Could not generate icon. Run: pip install pillow
  pause
  exit /b 1
)

echo [2/4] Building Grabbit.exe with PyInstaller...
python -m PyInstaller ^
  --name Grabbit ^
  --onedir ^
  --noconsole ^
  --icon "grabbit.ico" ^
  --add-data "templates;templates" ^
  --add-data "static;static" ^
  --hidden-import flask ^
  --hidden-import werkzeug ^
  --hidden-import jinja2 ^
  --hidden-import PIL ^
  --hidden-import PIL.Image ^
  --hidden-import pystray ^
  --hidden-import pystray._win32 ^
  launcher.py

if errorlevel 1 (
  echo.
  echo ERROR: PyInstaller failed. Check errors above.
  pause
  exit /b 1
)

echo.
echo [3/4] Copying app source files into dist...
xcopy /E /I /Y templates dist\Grabbit\templates\
xcopy /E /I /Y static dist\Grabbit\static\
copy /Y app.py dist\Grabbit\

rem Copy tools if they exist (yt-dlp, ffmpeg)
if exist tools (
  xcopy /E /I /Y tools dist\Grabbit\tools\
  echo Tools folder copied.
) else (
  echo NOTE: tools\ folder not found - app will auto-download yt-dlp and ffmpeg on first run.
)

echo.
echo [4/4] Done! Now:
echo   - Open Inno Setup Compiler
echo   - File -^> Open -^> grabbit.iss
echo   - Build -^> Compile
echo   - Installer will be at: dist\GrabbitSetup.exe
echo.
pause