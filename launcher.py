"""
Grabbit launcher — compiled by PyInstaller into Grabbit.exe
Starts Flask server + system tray icon.
"""
import sys
import os
import threading
import time
import webbrowser
from pathlib import Path

# When packaged, set working directory to exe location
if getattr(sys, 'frozen', False):
    os.chdir(os.path.dirname(sys.executable))

# ── Single-instance lock ────────────────────────────────────
# If Grabbit is already running, just open the browser and exit.
import ctypes
_mutex = ctypes.windll.kernel32.CreateMutexW(None, False, "Global\\GrabbitSingleInstance")
if ctypes.windll.kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
    webbrowser.open("http://localhost:5000")
    sys.exit(0)

def open_browser():
    time.sleep(1.5)
    webbrowser.open("http://localhost:5000")

def run_tray():
    try:
        import pystray
        from PIL import Image

        icon_path = Path("static/icons/icon128.png")
        if not icon_path.exists():
            img = Image.new('RGBA', (128, 128), (56, 189, 248, 255))
        else:
            img = Image.open(icon_path)

        def on_open(icon, item):
            webbrowser.open("http://localhost:5000")

        def on_quit(icon, item):
            icon.stop()
            os._exit(0)

        menu = pystray.Menu(
            pystray.MenuItem("Open Grabbit", on_open, default=True),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", on_quit),
        )

        tray = pystray.Icon(
            name="Grabbit",
            icon=img,
            title="Grabbit — click to reopen",
            menu=menu,
        )

        def _show_startup_notification():
            time.sleep(2.5)
            try:
                tray.notify(
                    "Grabbit is running in the background.\n"
                    "Click the tray icon to reopen, or right-click to quit.",
                    "Grabbit"
                )
            except Exception:
                pass

        threading.Thread(target=_show_startup_notification, daemon=True).start()
        tray.run()

    except Exception as e:
        print(f"[Grabbit] Tray error: {e}")
        while True:
            time.sleep(60)

import app as grabbit_app

if __name__ == "__main__":
    threading.Thread(target=open_browser, daemon=True).start()
    threading.Thread(target=run_tray, daemon=False).start()
    grabbit_app.app.run(debug=False, port=5000)
