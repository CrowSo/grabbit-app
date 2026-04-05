import os
import sys
import subprocess
import platform
import threading
import json
import re
import zipfile
import shutil
import stat
import time
from pathlib import Path
from flask import Flask, render_template, request, jsonify, Response
import urllib.request
import urllib.parse

# ── Version ────────────────────────────────────────────────
APP_VERSION     = "1.1.1"
GITHUB_REPO     = "CrowSo/grabbit-app"
GITHUB_API_URL  = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"

update_status = {"available": False, "version": None, "url": None, "checked": False}

app = Flask(__name__)

@app.after_request
def add_cors(response):
    response.headers['Access-Control-Allow-Origin']  = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return response

@app.route('/', methods=['OPTIONS'])
@app.route('/api/<path:path>', methods=['OPTIONS'])
def options_handler(path=''):
    return '', 204

# ── Paths — works both in dev and when frozen by PyInstaller ──
if getattr(sys, 'frozen', False):
    # Running as compiled exe — use the exe's directory
    BASE_DIR = Path(sys.executable).parent
else:
    # Running as script
    BASE_DIR = Path(__file__).parent
TOOLS_DIR     = BASE_DIR / "tools"
DATA_DIR      = BASE_DIR / "data"
DOWNLOADS_DIR = Path.home() / "Downloads" / "Grabbit"
TEMP_DIR      = DOWNLOADS_DIR / ".grabbit_tmp"   # hidden temp — user never sees .part files
STATE_FILE    = DATA_DIR / "queue.json"

TOOLS_DIR.mkdir(exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)
DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
TEMP_DIR.mkdir(parents=True, exist_ok=True)

IS_WINDOWS = platform.system() == "Windows"
IS_MAC     = platform.system() == "Darwin"

# Suppress CMD popup windows on Windows for ALL subprocess calls
WIN_FLAGS = {"creationflags": subprocess.CREATE_NO_WINDOW} if IS_WINDOWS else {}

# Hide temp folder on Windows
if IS_WINDOWS:
    try:
        subprocess.run(["attrib", "+H", str(TEMP_DIR)], capture_output=True, **WIN_FLAGS)
    except Exception:
        pass

YTDLP_PATH  = TOOLS_DIR / ("yt-dlp.exe" if IS_WINDOWS else "yt-dlp")
FFMPEG_PATH = TOOLS_DIR / ("ffmpeg.exe" if IS_WINDOWS else "ffmpeg")

download_progress = {}
progress_lock     = threading.Lock()

# ─── SETTINGS PERSISTENCE ─────────────────────────────────────────────────────

SETTINGS_FILE = DATA_DIR / "settings.json"

def load_settings():
    try:
        if SETTINGS_FILE.exists():
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {"save_folder": str(DOWNLOADS_DIR)}

def save_settings_to_disk(data):
    try:
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Grabbit] Could not save settings: {e}")

@app.route("/api/settings", methods=["GET"])
def get_settings():
    return jsonify(load_settings())

@app.route("/api/settings", methods=["POST"])
def post_settings():
    data = request.json or {}
    current = load_settings()
    current.update(data)
    save_settings_to_disk(current)
    return jsonify({"ok": True})

LIMITS_FILE = DATA_DIR / "limits.json"
limits_lock = threading.Lock()

def load_limits():
    try:
        if LIMITS_FILE.exists():
            with open(LIMITS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {}

def save_limits(data):
    try:
        with open(LIMITS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f)
    except Exception:
        pass

def get_today_key():
    from datetime import date
    return str(date.today())

def get_daily_count():
    key = get_today_key()
    with limits_lock:
        data = load_limits()
        return data.get(key, 0)

def increment_daily_count():
    key = get_today_key()
    with limits_lock:
        data = load_limits()
        # Keep only today's key
        data = {key: data.get(key, 0) + 1}
        save_limits(data)
        return data[key]

@app.route("/api/limits/status")
def limits_status():
    code   = request.args.get("license", "").strip().upper()
    is_pro = False

    if code and re.match(r'^GRAB-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$', code):
        try:
            req = urllib.request.Request(
                f"{SUPABASE_URL}/rest/v1/licenses?code=eq.{urllib.parse.quote(code)}&select=is_active,days_left",
                headers={
                    "apikey":        SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                }
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read())
            if data and data[0].get("is_active") and data[0].get("days_left", 0) > 0:
                is_pro = True
        except Exception:
            # If Supabase unreachable, check local cache
            pass

    used  = get_daily_count()
    limit = 999999 if is_pro else 5
    return jsonify({
        "used":      used,
        "limit":     5,  # always show 5 as the free limit in UI
        "remaining": max(0, limit - used),
        "is_pro":    is_pro,
        "allowed":   used < limit,
    })

@app.route("/api/limits/reset", methods=["POST"])
def limits_reset():
    """Resets today's download counter. Useful for testing."""
    key = get_today_key()
    with limits_lock:
        save_limits({key: 0})
    return jsonify({"ok": True, "count": 0})
def limits_increment():
    # Kept for backward compat but /api/download now handles incrementing
    # Don't increment here to avoid double counting
    return jsonify({"count": get_daily_count()})

state_lock = threading.Lock()

def load_queue_state():
    try:
        if STATE_FILE.exists():
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {"items": []}

def save_queue_state(items):
    try:
        with state_lock:
            with open(STATE_FILE, "w", encoding="utf-8") as f:
                json.dump({"items": items}, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Grabbit] Could not save queue state: {e}")

def update_item_status(item_id, status, extra=None):
    """Update a single item's status in the state file."""
    state = load_queue_state()
    for item in state["items"]:
        if item["id"] == item_id:
            item["status"] = status
            if extra:
                item.update(extra)
            break
    save_queue_state(state["items"])

# ─── TOOL HELPERS ─────────────────────────────────────────────────────────────

def get_tool_status():
    return {"ytdlp": YTDLP_PATH.exists(), "ffmpeg": FFMPEG_PATH.exists()}

def download_file(url, dest, label="", job_id=None):
    def hook(count, block_size, total_size):
        if total_size > 0 and job_id:
            pct = min(int(count * block_size * 100 / total_size), 100)
            with progress_lock:
                download_progress[job_id] = {"status": "downloading", "label": label, "pct": pct}
    urllib.request.urlretrieve(url, dest, reporthook=hook)

def install_ytdlp(job_id=None):
    if IS_WINDOWS:
        url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    elif IS_MAC:
        url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
    else:
        url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
    download_file(url, YTDLP_PATH, "yt-dlp", job_id)
    if not IS_WINDOWS:
        os.chmod(YTDLP_PATH, os.stat(YTDLP_PATH).st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)

def install_ffmpeg(job_id=None):
    with progress_lock:
        if job_id: download_progress[job_id] = {"status": "downloading", "label": "FFmpeg", "pct": 0}
    tmp = TOOLS_DIR / "ffmpeg_tmp"
    tmp.mkdir(exist_ok=True)
    if IS_WINDOWS:
        url     = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
        archive = TOOLS_DIR / "ffmpeg.zip"
        download_file(url, archive, "FFmpeg", job_id)
        with zipfile.ZipFile(archive, "r") as z:
            z.extractall(tmp)
        for f in tmp.rglob("ffmpeg.exe"):
            shutil.copy(f, FFMPEG_PATH); break
        archive.unlink(missing_ok=True)
        shutil.rmtree(tmp, ignore_errors=True)
    elif IS_MAC:
        url     = "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip"
        archive = TOOLS_DIR / "ffmpeg.zip"
        download_file(url, archive, "FFmpeg", job_id)
        with zipfile.ZipFile(archive, "r") as z:
            z.extractall(tmp)
        for f in tmp.rglob("ffmpeg"):
            shutil.copy(f, FFMPEG_PATH); break
        os.chmod(FFMPEG_PATH, os.stat(FFMPEG_PATH).st_mode | stat.S_IEXEC)
        archive.unlink(missing_ok=True)
        shutil.rmtree(tmp, ignore_errors=True)
    else:
        result = subprocess.run(["which", "ffmpeg"], capture_output=True)
        if result.returncode == 0:
            shutil.copy(result.stdout.decode().strip(), FFMPEG_PATH)
            os.chmod(FFMPEG_PATH, os.stat(FFMPEG_PATH).st_mode | stat.S_IEXEC)

# ─── PLATFORM DETECTION ───────────────────────────────────────────────────────

def detect_platform(url):
    checks = {
        "youtube":    ["youtube.com", "youtu.be"],
        "tiktok":     ["tiktok.com"],
        "instagram":  ["instagram.com"],
        "facebook":   ["facebook.com", "fb.watch"],
        "twitter":    ["twitter.com", "x.com"],
        "pinterest":  ["pinterest.com", "pin.it"],
        "twitch":     ["twitch.tv"],
        "soundcloud": ["soundcloud.com"],
    }
    for platform_id, domains in checks.items():
        if any(d in url for d in domains):
            return platform_id
    return "other"

PLATFORM_NAMES = {
    "youtube": "YouTube", "tiktok": "TikTok", "instagram": "Instagram",
    "facebook": "Facebook", "twitter": "X / Twitter", "pinterest": "Pinterest",
    "twitch": "Twitch", "soundcloud": "SoundCloud", "other": "this platform",
}

# ─── VIDEO INFO ────────────────────────────────────────────────────────────────

def get_video_info(url):
    cmd    = [str(YTDLP_PATH), "--dump-json", "--no-playlist", url]
    result = subprocess.run(cmd, capture_output=True, encoding="utf-8", errors="replace", timeout=30, **WIN_FLAGS)
    if result.returncode != 0:
        raise Exception(result.stderr or "Could not fetch video info")
    data    = json.loads(result.stdout)
    formats = []
    seen    = set()
    for f in data.get("formats", []):
        h      = f.get("height")
        vcodec = f.get("vcodec", "none")
        if h and vcodec != "none" and h not in seen:
            seen.add(h)
            formats.append({"height": h, "label": f"{h}p"})
    formats.sort(key=lambda x: x["height"], reverse=True)

    plat  = detect_platform(url)
    title = data.get("title", "") or data.get("uploader", "Video")
    if plat == "instagram" and (not title or title == "-"):
        title = f"Reel de @{data.get('uploader', 'instagram')}"

    return {
        "title":     title,
        "thumbnail": data.get("thumbnail", ""),
        "duration":  data.get("duration", 0),
        "channel":   data.get("uploader", ""),
        "formats":   formats,
        "platform":  plat,
    }

# ─── FRIENDLY ERROR MESSAGES ──────────────────────────────────────────────────

def build_error_msg(error_lines, platform_id):
    platform_name = PLATFORM_NAMES.get(platform_id, "this platform")
    if not error_lines:
        return {"msg": f"Couldn't download from {platform_name}.", "code": "unknown"}

    last = error_lines[-1]

    if "Cannot parse data" in last or "please report this issue" in last:
        return {
            "msg": f"This {platform_name} video has a format that can't be downloaded right now. It's a platform-side limitation.",
            "code": "parse_error"
        }
    if "Private video" in last or ("private" in last.lower() and "video" in last.lower()):
        return {
            "msg": f"This {platform_name} video is private.",
            "code": "private"
        }
    if "not available" in last.lower() and "region" in last.lower():
        return {
            "msg": f"This {platform_name} video isn't available in your region.",
            "code": "region"
        }
    if "Sign in" in last or "log in" in last.lower() or "login" in last.lower():
        return {
            "msg": f"This {platform_name} video requires you to be logged in.",
            "code": "login_required"
        }
    if "HTTP Error 403" in last:
        return {
            "msg": f"Access denied by {platform_name}. The video may require login.",
            "code": "forbidden"
        }
    if "HTTP Error 404" in last:
        return {
            "msg": "Video not found. The link may be broken or deleted.",
            "code": "not_found"
        }
    if "Unsupported URL" in last:
        return {
            "msg": "This URL isn't supported. Make sure it's a direct video link.",
            "code": "unsupported"
        }

    return {
        "msg": f"Couldn't download this {platform_name} video. The content may have restrictions set by the platform.",
        "code": "platform_restriction"
    }

# ─── DOWNLOAD WORKER ──────────────────────────────────────────────────────────

def run_download(job_id, item_id, url, quality, audio_only, no_audio,
                 start_time, end_time, save_folder=None):
    platform_id = detect_platform(url)
    try:
        with progress_lock:
            download_progress[job_id] = {"status": "starting", "pct": 0, "msg": "Preparing..."}
        # Save job_id so resume can detect if this download is still running
        update_item_status(item_id, "downloading", {"active_job_id": job_id})

        out_dir = Path(save_folder) if save_folder else DOWNLOADS_DIR
        out_dir.mkdir(parents=True, exist_ok=True)
        TEMP_DIR.mkdir(parents=True, exist_ok=True)

        cmd = [str(YTDLP_PATH), "--ffmpeg-location", str(TOOLS_DIR)]

        # Concurrent fragments only helps on HLS/DASH (Twitch, TikTok, YouTube)
        # On Instagram/Facebook it can cause errors and slowdowns
        if platform_id in ("twitch", "tiktok", "youtube"):
            cmd += ["--concurrent-fragments", "4"]

        # Download everything to temp dir first — fragments, .part files, all hidden
        # Final file moves to out_dir only after 100% complete
        cmd += ["-o", str(TEMP_DIR / "%(title)s.%(ext)s")]

        # Platform-specific fixes
        if platform_id == "facebook":
            cmd += ["--compat-options", "no-youtube-prefer-utc-upload-date"]

        # Format selection
        is_twitch = platform_id == "twitch"
        if is_twitch:
            if audio_only:
                cmd += ["-f", "bestaudio", "--extract-audio", "--audio-format", "mp3"]
            else:
                cmd += ["-f", f"best[height<={quality}]/best" if quality != "best" else "best"]
        elif audio_only:
            cmd += ["-f", "bestaudio", "--extract-audio", "--audio-format", "mp3"]
        elif no_audio:
            cmd += ["-f", f"bestvideo[height<={quality}]" if quality != "best" else "bestvideo"]
        else:
            if quality == "best":
                cmd += ["-f", "bestvideo+bestaudio/best", "--merge-output-format", "mp4"]
            else:
                cmd += ["-f", f"bestvideo[height<={quality}]+bestaudio/best[height<={quality}]", "--merge-output-format", "mp4"]
            # Force AAC audio — fully compatible with Windows Media Player and all players
            # No quality loss — AAC is YouTube's native audio codec
            cmd += ["--postprocessor-args", "ffmpeg:-c:a aac -b:a 192k"]

        if start_time or end_time:
            section = f"*{start_time or '0'}-{end_time or 'inf'}"
            cmd += ["--download-sections", section, "--force-keyframes-at-cuts"]

        cmd += ["--no-playlist", "--newline", url]

        # Windows: hide CMD window + force UTF-8 output
        popen_kwargs = {
            "stdout":   subprocess.PIPE,
            "stderr":   subprocess.STDOUT,
            "encoding": "utf-8",
            "errors":   "replace",
            "bufsize":  1,
            **WIN_FLAGS,
        }
        process = subprocess.Popen(cmd, **popen_kwargs)

        downloaded_file = None
        error_lines = []

        for line in process.stdout:
            line = line.strip()
            if "ERROR" in line:
                error_lines.append(line)

            # Detect final output filename from yt-dlp output
            dest_match = re.search(r'\[download\] Destination: (.+)', line)
            merge_match = re.search(r'\[Merger\] Merging formats into "(.+)"', line)
            ffmpeg_match = re.search(r'\[ffmpeg\] Destination: (.+)', line)
            if merge_match:
                downloaded_file = merge_match.group(1).strip()
            elif ffmpeg_match:
                downloaded_file = ffmpeg_match.group(1).strip()
            elif dest_match and not downloaded_file:
                f = dest_match.group(1).strip()
                if not f.endswith('.part') and 'Frag' not in f:
                    downloaded_file = f

            pct_match   = re.search(r'(\d+\.?\d*)%', line)
            speed_match = re.search(r'at\s+([\d.]+\w+/s)', line)
            eta_match   = re.search(r'ETA\s+([\d:]+)', line)

            if pct_match:
                pct = float(pct_match.group(1))
                msg = f"Downloading... {pct:.1f}%"
                if speed_match: msg += f" · {speed_match.group(1)}"
                if eta_match:   msg += f" · ETA {eta_match.group(1)}"
                with progress_lock:
                    download_progress[job_id] = {"status": "downloading", "pct": min(pct, 99), "msg": msg}
            elif "[Merger]" in line or "Merging" in line:
                with progress_lock:
                    download_progress[job_id] = {"status": "downloading", "pct": 99, "msg": "Merging streams..."}
            elif "[ffmpeg]" in line or "Destination:" in line:
                with progress_lock:
                    download_progress[job_id] = {"status": "downloading", "pct": 99, "msg": "Processing with FFmpeg..."}

        process.wait()

        if process.returncode == 0:
            # Move completed file from temp to final destination
            moved = False
            if downloaded_file and Path(downloaded_file).exists():
                src = Path(downloaded_file)
                dst = out_dir / src.name
                # Handle name collision
                if dst.exists():
                    stem = src.stem
                    suffix = src.suffix
                    dst = out_dir / f"{stem}_{int(time.time())}{suffix}"
                shutil.move(str(src), str(dst))
                moved = True
            else:
                # Fallback: move any new non-partial files from temp
                for f in TEMP_DIR.iterdir():
                    if not f.name.endswith('.part') and 'Frag' not in f.name and f.is_file():
                        dst = out_dir / f.name
                        if dst.exists():
                            dst = out_dir / f"{f.stem}_{int(time.time())}{f.suffix}"
                        shutil.move(str(f), str(dst))
                        moved = True

            # Clean up any leftover temp files for this download
            for f in list(TEMP_DIR.iterdir()):
                try:
                    if f.is_file():
                        f.unlink()
                except Exception:
                    pass

            with progress_lock:
                download_progress[job_id] = {"status": "done", "pct": 100, "msg": str(out_dir), "save_folder": str(out_dir)}
            update_item_status(item_id, "done")
        else:
            err = build_error_msg(error_lines, platform_id)
            # Clean up temp leftovers on error too
            for f in list(TEMP_DIR.iterdir()):
                try:
                    if f.is_file():
                        f.unlink()
                except Exception:
                    pass
            with progress_lock:
                download_progress[job_id] = {
                    "status": "error", "pct": 0,
                    "msg": err["msg"], "error_code": err["code"], "platform": platform_id,
                }
            update_item_status(item_id, "error", {"error_msg": err["msg"]})

    except Exception as e:
        with progress_lock:
            download_progress[job_id] = {
                "status": "error", "pct": 0,
                "msg": str(e), "error_code": "exception", "platform": platform_id,
            }
        update_item_status(item_id, "error", {"error_msg": str(e)})

# ─── ROUTES ───────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/status")
def status():
    return jsonify(get_tool_status())

@app.route("/api/install", methods=["POST"])
def install():
    tool   = request.json.get("tool")
    job_id = f"install_{tool}"
    with progress_lock:
        download_progress[job_id] = {"status": "starting", "pct": 0}

    def do_install():
        try:
            if tool == "ytdlp":    install_ytdlp(job_id)
            elif tool == "ffmpeg": install_ffmpeg(job_id)
            with progress_lock:
                download_progress[job_id] = {"status": "done", "pct": 100}
        except Exception as e:
            with progress_lock:
                download_progress[job_id] = {"status": "error", "msg": str(e)}

    threading.Thread(target=do_install, daemon=True).start()
    return jsonify({"job_id": job_id})

@app.route("/api/progress/<job_id>")
def progress(job_id):
    with progress_lock:
        return jsonify(download_progress.get(job_id, {"status": "unknown"}))

@app.route("/api/info", methods=["POST"])
def info():
    url = request.json.get("url", "").strip()
    if not url:
        return jsonify({"error": "Empty URL"}), 400
    try:
        return jsonify(get_video_info(url))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/download", methods=["POST"])
def download():
    data        = request.json
    url         = data.get("url", "").strip()
    item_id     = data.get("item_id", "").strip()
    quality     = data.get("quality", "best")
    audio_only  = data.get("audio_only", False)
    no_audio    = data.get("no_audio", False)
    start_time  = data.get("start_time", "").strip()
    end_time    = data.get("end_time", "").strip()
    save_folder = data.get("save_folder", "").strip() or None
    title       = data.get("title", url[:60] if url else "Unknown")
    thumbnail   = data.get("thumbnail", "")
    platform    = data.get("platform", detect_platform(url))

    if not url:
        return jsonify({"error": "URL required"}), 400

    # Use configured folder if not specified
    if not save_folder:
        settings    = load_settings()
        save_folder = settings.get("save_folder") or None

    job_id = f"dl_{int(time.time()*1000)}"

    # Save to queue state so the frontend can see it
    fmt = "audio" if audio_only else ("video" if no_audio else "video+audio")
    state = load_queue_state()
    state["items"].append({
        "id":          item_id or job_id,
        "url":         url,
        "title":       title,
        "thumbnail":   thumbnail,
        "platform":    platform,
        "format":      fmt,
        "quality":     quality,
        "startTime":   start_time,
        "endTime":     end_time,
        "saveFolder":  save_folder or str(DOWNLOADS_DIR),
        "status":      "downloading",
        "active_job_id": job_id,
    })
    save_queue_state(state["items"])

    # Auto-increment server counter
    increment_daily_count()

    GENERIC_TITLES = ('instagram', 'youtube', 'tiktok', 'facebook', 'twitter', 'pinterest', 'twitch', 'soundcloud')
    needs_info = (
        not thumbnail or                                          # no thumbnail at all
        not title or                                              # no title
        title == url[:60] or                                      # title is just the URL
        title.lower().strip() in GENERIC_TITLES                  # generic platform name
    )

    if needs_info:
        def fetch_info_and_start():
            nonlocal title, thumbnail, platform
            try:
                info      = get_video_info(url)
                title     = info.get("title", title) or title
                thumbnail = info.get("thumbnail", thumbnail) or thumbnail
                platform  = info.get("platform", platform) or platform
            except Exception:
                pass
            # Update queue state with real info
            state2 = load_queue_state()
            for itm in state2["items"]:
                if itm["id"] == (item_id or job_id):
                    itm["title"]     = title
                    itm["thumbnail"] = thumbnail
                    itm["platform"]  = platform
                    break
            save_queue_state(state2["items"])
            run_download(job_id, item_id or job_id, url, quality, audio_only, no_audio,
                        start_time, end_time, save_folder)

        threading.Thread(target=fetch_info_and_start, daemon=True).start()
    else:
        threading.Thread(
            target=run_download,
            args=(job_id, item_id or job_id, url, quality, audio_only, no_audio,
                  start_time, end_time, save_folder),
            daemon=True
        ).start()

    return jsonify({"job_id": job_id})

# ─── QUEUE STATE API ──────────────────────────────────────────────────────────

@app.route("/api/queue/state", methods=["GET"])
def get_queue_state():
    return jsonify(load_queue_state())

@app.route("/api/queue/save", methods=["POST"])
def save_queue():
    items = request.json.get("items", [])
    save_queue_state(items)
    return jsonify({"ok": True})

@app.route("/api/queue/resume", methods=["POST"])
def resume_pending():
    """Called on app load — reconnects to running downloads or restarts interrupted ones."""
    state   = load_queue_state()
    result  = []
    resumed = 0

    for item in state["items"]:
        if item.get("status") not in ("pending", "downloading"):
            continue

        active_job_id = item.get("active_job_id")

        # Check if a download for this item is still running in memory
        already_running = False
        if active_job_id:
            with progress_lock:
                prog = download_progress.get(active_job_id, {})
            if prog.get("status") in ("starting", "downloading"):
                # Still running — just reconnect the frontend to it
                item["job_id"]  = active_job_id
                already_running = True

        if not already_running:
            # Server was restarted or process died — start a new download
            job_id = f"dl_{int(time.time()*1000)}_{item['id']}"
            threading.Thread(
                target=run_download,
                args=(
                    job_id, item["id"], item["url"],
                    item.get("quality", "best"),
                    item.get("format") == "audio",
                    item.get("format") == "video",
                    item.get("startTime", ""),
                    item.get("endTime",   ""),
                    item.get("saveFolder") or None,
                ),
                daemon=True
            ).start()
            item["job_id"] = job_id
            resumed += 1

        result.append(item)

    if result:
        save_queue_state(state["items"])

    return jsonify({"resumed": resumed, "items": result})

# ─── THUMBNAIL PROXY ──────────────────────────────────────────────────────────

@app.route("/api/placeholder_thumb")
def placeholder_thumb():
    """Generate a simple SVG placeholder thumbnail with platform color."""
    platform = request.args.get("platform", "other")
    COLORS = {
        "youtube":    "#ff4444", "tiktok": "#00f2ea", "instagram": "#e1306c",
        "facebook":   "#1877f2", "twitter": "#1d9bf0", "pinterest": "#e60023",
        "twitch":     "#9146ff", "soundcloud": "#ff5500", "other": "#5b6ef5",
    }
    color  = COLORS.get(platform, "#5b6ef5")
    letter = platform[0].upper() if platform else "G"
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
  <rect width="320" height="180" fill="{color}" opacity="0.15"/>
  <rect width="320" height="180" fill="none" stroke="{color}" stroke-width="2" opacity="0.3"/>
  <text x="160" y="105" font-family="Arial,sans-serif" font-size="72" font-weight="bold"
        fill="{color}" opacity="0.5" text-anchor="middle">{letter}</text>
</svg>'''
    from flask import Response
    return Response(svg, content_type='image/svg+xml')

THUMB_CACHE_DIR = DATA_DIR / "thumb_cache"
THUMB_CACHE_DIR.mkdir(exist_ok=True)

@app.route("/api/thumbnail")
def proxy_thumbnail():
    img_url = request.args.get("url", "")
    if not img_url:
        return "", 400

    # Use a hash of the URL as cache key (strip expiry params for Instagram)
    import hashlib
    # For Instagram/Facebook, strip the expiry token to get a stable key
    cache_key = img_url.split('&oh=')[0].split('?stp=')[0]
    cache_hash = hashlib.md5(cache_key.encode()).hexdigest()
    cache_file = THUMB_CACHE_DIR / f"{cache_hash}.jpg"

    # Serve from cache if available
    if cache_file.exists():
        try:
            with open(cache_file, 'rb') as f:
                return Response(f.read(), content_type='image/jpeg')
        except Exception:
            pass

    # Fetch and cache
    try:
        req = urllib.request.Request(img_url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer":    "https://www.instagram.com/",
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            data  = resp.read()
            ctype = resp.headers.get("Content-Type", "image/jpeg")

        # Cache if it's an image
        if data and 'image' in ctype:
            try:
                with open(cache_file, 'wb') as f:
                    f.write(data)
            except Exception:
                pass

        return Response(data, content_type=ctype)
    except Exception:
        return "", 404

# ─── FOLDER UTILS ─────────────────────────────────────────────────────────────

@app.route("/api/open_folder")
def open_folder():
    path = request.args.get("path") or str(DOWNLOADS_DIR)
    try:
        target = Path(path)
        if not target.exists():
            target = DOWNLOADS_DIR
        if IS_WINDOWS:  os.startfile(str(target))
        elif IS_MAC:    subprocess.Popen(["open",     str(target)])
        else:           subprocess.Popen(["xdg-open", str(target)])
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)})

@app.route("/api/file_exists")
def file_exists():
    path = request.args.get("path", "").strip()
    if not path:
        return jsonify({"exists": False})
    try:
        p = Path(path)
        if p.is_file():
            return jsonify({"exists": True, "type": "file"})
        if p.is_dir():
            files = [f.name for f in p.iterdir() if f.is_file() and not f.name.startswith('.')]
            return jsonify({"exists": len(files) > 0, "type": "folder", "count": len(files), "files": files})
        return jsonify({"exists": False})
    except Exception:
        return jsonify({"exists": False})

@app.route("/api/browse_folder", methods=["POST"])
def browse_folder():
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes('-topmost', True)
        folder = filedialog.askdirectory(title="Select download folder", initialdir=str(DOWNLOADS_DIR))
        root.destroy()
        return jsonify({"path": folder or None})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ─── LICENSE ──────────────────────────────────────────────────────────────────

SUPABASE_URL = "https://esfaxfwrftiafghtxmnk.supabase.co"
SUPABASE_KEY = "sb_publishable_0O8uU2ZZxjK7B4ycReFDsA_B4NkAyZy"

@app.route("/api/license/deactivate", methods=["POST"])
def deactivate_license():
    try:
        cfg = load_settings()
        cfg.pop('license_code', None)
        save_settings_to_disk(cfg)
    except Exception:
        pass
    return jsonify({"ok": True})

@app.route("/api/license/verify", methods=["POST"])
def verify_license():
    code = request.json.get("code", "").strip().upper()
    if not code:
        return jsonify({"valid": False, "error": "No code provided"})

    try:
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/licenses?code=eq.{urllib.parse.quote(code)}&select=*",
            headers={
                "apikey":        SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type":  "application/json",
            }
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read())

        if not data:
            return jsonify({"valid": False, "error": "License not found"})

        license = data[0]

        if not license.get("is_active"):
            return jsonify({
                "valid":     False,
                "error":     "License expired",
                "days_left": license.get("days_left", 0),
                "email":     license.get("email", ""),
            })

        # Cache license code in server settings so extension can use it
        try:
            cfg = load_settings()
            cfg['license_code'] = code
            save_settings_to_disk(cfg)
        except Exception:
            pass

        return jsonify({
            "valid":          True,
            "days_left":      license.get("days_left", 0),
            "email":          license.get("email", ""),
            "plan":           license.get("plan", "pro"),
            "created_at":     license.get("created_at", ""),
            "last_renewed_at":license.get("last_renewed_at", ""),
        })

    except Exception as e:
        # Fallback — allow if Supabase unreachable (avoid locking out users on outage)
        print(f"[Grabbit] License check failed: {e}")
        return jsonify({"valid": False, "error": "Could not reach license server"})

# ─── AUTO-UPDATE ON STARTUP ───────────────────────────────────────────────────

startup_status = {"ytdlp": "checking", "ffmpeg": "checking"}

def check_for_updates():
    """Check GitHub releases for a newer version. Runs in background thread."""
    global update_status
    try:
        req = urllib.request.Request(
            GITHUB_API_URL,
            headers={"User-Agent": f"Grabbit/{APP_VERSION}"}
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read())

        latest = data.get("tag_name", "").lstrip("v")
        if not latest:
            return

        def version_tuple(v):
            return tuple(int(x) for x in v.split(".") if x.isdigit())

        if version_tuple(latest) > version_tuple(APP_VERSION):
            # Find the zip asset
            assets   = data.get("assets", [])
            zip_asset = next((a for a in assets if a["name"].endswith(".zip")), None)
            dl_url   = zip_asset["browser_download_url"] if zip_asset else data.get("html_url", "")
            update_status = {
                "available": True,
                "version":   latest,
                "url":       dl_url,
                "checked":   True,
            }
            print(f"[Grabbit] Update available: v{latest}")
        else:
            update_status["checked"] = True
            print(f"[Grabbit] Up to date: v{APP_VERSION}")
    except Exception as e:
        print(f"[Grabbit] Update check failed: {e}")
        update_status["checked"] = True

@app.route("/api/update/status")
def update_check_status():
    return jsonify({**update_status, "current": APP_VERSION})

@app.route("/api/update/apply", methods=["POST"])
def update_apply():
    """Direct user to download the new installer."""
    download_url = f"https://github.com/{GITHUB_REPO}/releases/latest/download/GrabbitSetup.exe"
    return jsonify({"ok": True, "download_url": download_url})

# ── AUTO-UPDATE CHECK ON STARTUP ──────────────────────────
def auto_setup():
    global startup_status
    try:
        if not YTDLP_PATH.exists():
            startup_status["ytdlp"] = "installing"
            install_ytdlp()
        else:
            startup_status["ytdlp"] = "updating"
            subprocess.run([str(YTDLP_PATH), "-U"], capture_output=True, timeout=60, **WIN_FLAGS)
        startup_status["ytdlp"] = "ok"
    except Exception as e:
        startup_status["ytdlp"] = "error"
        print(f"[Grabbit] yt-dlp setup failed: {e}")

    try:
        if not FFMPEG_PATH.exists():
            startup_status["ffmpeg"] = "installing"
            install_ffmpeg()
        startup_status["ffmpeg"] = "ok"
    except Exception as e:
        startup_status["ffmpeg"] = "error"
        print(f"[Grabbit] ffmpeg setup failed: {e}")

@app.route("/api/startup_status")
def api_startup_status():
    return jsonify(startup_status)

@app.route("/api/startup_ready")
def api_startup_ready():
    """Returns true only when both tools are installed and ready."""
    ready = startup_status.get("ytdlp") == "ok" and startup_status.get("ffmpeg") == "ok"
    return jsonify({"ready": ready, "status": startup_status})

# ─── MAIN ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"\n{'─'*50}")
    print(f"  Grabbit running at:")
    print(f"  → http://localhost:5000")
    print(f"  Downloads: {DOWNLOADS_DIR}")
    print(f"{'─'*50}\n")
    threading.Thread(target=auto_setup, daemon=True).start()
    threading.Thread(target=check_for_updates, daemon=True).start()
    app.run(debug=False, port=5000)
else:
    # Imported by launcher.py (PyInstaller build)
    # Start background tasks immediately
    threading.Thread(target=auto_setup, daemon=True).start()
    threading.Thread(target=check_for_updates, daemon=True).start()