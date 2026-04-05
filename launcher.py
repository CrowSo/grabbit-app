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

def open_browser():
    time.sleep(1.5)
    webbrowser.open("http://localhost:5000")

def run_tray():
    try:
        import pystray
        from PIL import Image

        # Load icon from static/icons/
        icon_path = Path("static/icons/icon128.png")
        if not icon_path.exists():
            # Fallback: generate a simple icon
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
            title="Grabbit",
            menu=menu,
        )
        tray.run()

    except Exception as e:
        print(f"[Grabbit] Tray error: {e}")
        # If tray fails, just keep Flask running
        while True:
            time.sleep(60)

import app as grabbit_app

if __name__ == "__main__":
    # Start browser
    threading.Thread(target=open_browser, daemon=True).start()
    # Start tray icon in background thread
    threading.Thread(target=run_tray, daemon=False).start()
    # Start Flask (blocking)
    grabbit_app.app.run(debug=False, port=5000)