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
import uuid as _uuid
import traceback
from datetime import datetime, timezone, timedelta

# ── Supabase — load from .env if present ──────────────────
def _load_env_file():
    try:
        env_path = Path(__file__).parent / ".env"
        if env_path.exists():
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        k, v = line.split('=', 1)
                        os.environ.setdefault(k.strip(), v.strip())
    except Exception:
        pass
_load_env_file()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://esfaxfwrftiafghtxmnk.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzZmF4ZndyZnRpYWZnaHR4bW5rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNzEwODIsImV4cCI6MjA5MDg0NzA4Mn0.Hm1QEEBd2WXq7nM_JE7U4Zqhp5GZ-L4a_QnasL3GvXM")

# ── Version ────────────────────────────────────────────────
APP_VERSION     = "2.0.0"
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
WATCHLIST_FILE = DATA_DIR / "watchlist.json"
ERROR_LOG_FILE = DATA_DIR / "error_log.json"

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
DENO_PATH   = TOOLS_DIR / ("deno.exe" if IS_WINDOWS else "deno")

def _ytdlp_env():
    """Return os.environ with TOOLS_DIR prepended to PATH so yt-dlp finds deno."""
    env = os.environ.copy()
    env["PATH"] = str(TOOLS_DIR) + os.pathsep + env.get("PATH", "")
    return env

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

def get_or_create_machine_id():
    settings = load_settings()
    if 'machine_id' not in settings:
        settings['machine_id'] = str(_uuid.uuid4())
        save_settings_to_disk(settings)
    return settings['machine_id']

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

# ── Free tier limits ───────────────────────────────────────
TRIAL_LIMITS = {"single": 10, "batch": 1, "transcript": 2}

# Deduplicate batch increments within a server session (in-memory)
_seen_batch_sessions     = set()
_batch_session_lock      = threading.Lock()

def _is_pro(code: str) -> bool:
    """Return True if the given license code is active in Supabase."""
    if not code or not re.match(r'^GRAB-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$', code):
        return False
    try:
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/licenses?code=eq.{urllib.parse.quote(code)}&select=is_active,days_left",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
        return bool(data and data[0].get("is_active") and data[0].get("days_left", 0) > 0)
    except Exception:
        return False

def _get_trial_usage(machine_id: str) -> dict:
    """Fetch trial usage counters from Supabase. Returns zeros on error."""
    try:
        body = json.dumps({"p_machine_id": machine_id}).encode()
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/rpc/get_trial_usage",
            data=body,
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read()) or {}
    except Exception:
        return {}

def _increment_trial_usage(machine_id: str, dl_type: str):
    """Increment a usage counter in Supabase. Fire-and-forget."""
    try:
        body = json.dumps({"p_machine_id": machine_id, "p_type": dl_type}).encode()
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/rpc/increment_trial_usage",
            data=body,
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=5) as _:
            pass
    except Exception:
        pass

@app.route("/api/limits/status")
def limits_status():
    code       = (load_settings().get("license_code") or request.args.get("license", "")).strip().upper()
    is_pro     = _is_pro(code)
    machine_id = get_or_create_machine_id()
    usage      = {} if is_pro else _get_trial_usage(machine_id)
    return jsonify({
        "is_pro":      is_pro,
        "singles_used":    usage.get("singles",    0),
        "batches_used":    usage.get("batches",    0),
        "transcripts_used":usage.get("transcripts",0),
        "limits": TRIAL_LIMITS,
    })

@app.route("/api/limits/reset", methods=["POST"])
def limits_reset():
    return jsonify({"ok": True})

# ── Session ping ───────────────────────────────────────────
def _ping_session():
    """Upsert one row per machine into `installs` table. Fire-and-forget.
    Never throws — if Supabase is unreachable the app continues normally."""
    try:
        _plat = (
            "windows" if sys.platform == "win32" else
            "mac"     if sys.platform == "darwin" else
            "linux"
        )
        settings    = load_settings()
        has_license = bool(settings.get("license_code", ""))
        body = json.dumps({
            "p_machine_id":  get_or_create_machine_id(),
            "p_last_seen":   datetime.now(timezone.utc).isoformat(),
            "p_app_version": APP_VERSION,
            "p_platform":    _plat,
            "p_has_license": has_license,
        }).encode()
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/rpc/ping_install",
            data=body,
            headers={
                "apikey":        SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type":  "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=8) as _:
            pass
        print(f"[Grabbit] Session ping OK — {_plat} v{APP_VERSION}")
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        print(f"[Grabbit] Session ping {e.code}: {body[:300]}")
    except Exception as e:
        print(f"[Grabbit] Session ping skipped: {e}")

def _session_ping_loop():
    """Ping on startup, then once every 24 h."""
    _ping_session()
    while True:
        time.sleep(24 * 3600)
        _ping_session()

def _ping_download():
    """Fire-and-forget: increment total_downloads + set last_download on each successful download."""
    try:
        body = json.dumps({"p_machine_id": get_or_create_machine_id()}).encode()
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/rpc/ping_download",
            data=body,
            headers={
                "apikey":        SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type":  "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=8) as _:
            pass
    except Exception:
        pass

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

def get_channel_info(url):
    """Fetch channel name, id, and thumbnail from a channel URL.
    Uses --flat-playlist --playlist-end 1 instead of --dump-json so yt-dlp
    only needs one lightweight request instead of downloading full video info."""
    cmd = [
        str(YTDLP_PATH),
        "--flat-playlist",
        "--playlist-end", "1",
        "--dump-single-json",
        "--no-warnings",
        "--quiet",
        _yt_videos_url(url),
    ]
    result = subprocess.run(
        cmd, capture_output=True, encoding="utf-8", errors="replace",
        timeout=30, env=_ytdlp_env(), **WIN_FLAGS,
    )

    if result.returncode != 0:
        raise Exception((result.stderr or "Could not fetch channel info").strip()[:200])

    raw = result.stdout.strip()
    if not raw:
        raise Exception("yt-dlp returned no data for this URL")

    data = json.loads(raw)

    # Channel-level keys come from the top-level object
    channel_name = (
        data.get("channel") or
        data.get("uploader") or
        data.get("title")
    )

    # Fall back to first entry if top-level keys are missing
    entries = data.get("entries") or []
    if not channel_name and entries and entries[0]:
        entry = entries[0]
        channel_name = entry.get("channel") or entry.get("uploader")

    if not channel_name:
        raise Exception("Could not determine channel name from URL.")

    # Thumbnail: prefer channel-level, fall back to first video thumbnail
    thumbnail = None
    if data.get("thumbnails"):
        thumbnail = data["thumbnails"][-1].get("url")
    elif entries and entries[0]:
        entry = entries[0]
        thumbnail = entry.get("thumbnail")
        if not thumbnail and entry.get("thumbnails"):
            thumbnail = entry["thumbnails"][-1].get("url")

    channel_id = data.get("channel_id") or data.get("id")
    if not channel_id and entries and entries[0]:
        channel_id = entries[0].get("channel_id")

    return {
        "channel_name": channel_name,
        "channel_id":   channel_id,
        "thumbnail":    thumbnail,
    }

def load_watchlist_state():
    """Loads the watchlist items from data/watchlist.json."""
    try:
        if WATCHLIST_FILE.exists():
            with open(WATCHLIST_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {"items": []}

def save_watchlist_state(items):
    """Saves the watchlist items to data/watchlist.json."""
    try:
        # Use a lock if we anticipate concurrent writes, for now it's simple
        with open(WATCHLIST_FILE, "w", encoding="utf-8") as f:
            json.dump({"items": items}, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Grabbit] Could not save watchlist state: {e}")



# ─── TOOL HELPERS ─────────────────────────────────────────────────────────────

def get_tool_status():
    return {"ytdlp": YTDLP_PATH.exists(), "ffmpeg": FFMPEG_PATH.exists(), "deno": DENO_PATH.exists()}

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

def install_deno(job_id=None):
    if IS_WINDOWS:
        url = "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip"
    elif IS_MAC:
        url = "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-apple-darwin.zip"
    else:
        url = "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip"
    archive = TOOLS_DIR / "deno.zip"
    download_file(url, archive, "Deno", job_id)
    with zipfile.ZipFile(archive, "r") as z:
        z.extractall(TOOLS_DIR)
    archive.unlink(missing_ok=True)
    if not IS_WINDOWS:
        os.chmod(DENO_PATH, os.stat(DENO_PATH).st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)

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
    url = _resolve_short_url(url)
    base_cmd = [str(YTDLP_PATH), "--dump-json", "--no-playlist"]

    def _run(extra):
        return subprocess.run(
            base_cmd + extra + [url],
            capture_output=True, encoding="utf-8", errors="replace",
            timeout=30, env=_ytdlp_env(), **WIN_FLAGS,
        )

    result = None
    for attempt in range(2):
        result = _run([])
        if result.returncode == 0:
            break
        if "429" in (result.stderr or "") and attempt == 0:
            time.sleep(2)
            continue
        break

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

    # Detect which of our 3 supported transcript languages have captions.
    # yt-dlp reports available subtitle tracks under "subtitles" (manual) and
    # "automatic_captions" (auto-generated). We check both.
    _TRANSCRIPT_CODES = {
        "en": {"en", "en-US", "en-GB", "en-orig", "en-auto"},
        "es": {"es", "es-419", "es-ES", "es-MX", "es-orig"},
        "pt": {"pt", "pt-BR", "pt-PT", "pt-orig"},
    }
    all_caption_langs = (
        set((data.get("automatic_captions") or {}).keys()) |
        set((data.get("subtitles") or {}).keys())
    )
    available_langs = [
        lang for lang, codes in _TRANSCRIPT_CODES.items()
        if codes & all_caption_langs
    ]

    return {
        "title":           title,
        "thumbnail":       data.get("thumbnail", ""),
        "duration":        data.get("duration", 0),
        "channel":         data.get("uploader", ""),
        "formats":         formats,
        "platform":        plat,
        "available_langs": available_langs,        # empty = no captions at all
        "original_lang":   data.get("language", ""), # e.g. "en", "es", "ko"
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

ERROR_LOG_LOCK = threading.Lock()
ERROR_LOG_MAX  = 200  # keep latest 200 entries

def _log_error(entry):
    """Persist a download error entry to data/error_log.json (rolling)."""
    try:
        with ERROR_LOG_LOCK:
            data = []
            if ERROR_LOG_FILE.exists():
                try:
                    with open(ERROR_LOG_FILE, "r", encoding="utf-8") as f:
                        data = json.load(f) or []
                except Exception:
                    data = []
            data.insert(0, entry)
            data = data[:ERROR_LOG_MAX]
            with open(ERROR_LOG_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Grabbit] Could not write error log: {e}")


_CHROME_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,"
              "image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "identity",   # no gzip — easier to read response
    "Cache-Control": "max-age=0",
    "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}


def _resolve_short_url(url):
    """Some platforms (Pinterest, Facebook fb.watch) use short URLs that
    redirect to error pages when followed by simple HTTP clients. Build a
    cookie jar, prime it with a homepage visit, then follow the redirect."""
    short_hosts = ("pin.it", "fb.watch")
    if not any(h in url for h in short_hosts):
        return url

    is_pinterest = "pin.it" in url

    try:
        # Use a cookie jar so we look like a real session
        from http.cookiejar import CookieJar
        cj = CookieJar()
        opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(cj),
            urllib.request.HTTPRedirectHandler(),
        )

        # Step 1 (Pinterest only): prime the cookie jar by hitting the homepage
        # so we have the same _routing_id / _b cookies a real browser would
        if is_pinterest:
            try:
                req0 = urllib.request.Request("https://www.pinterest.com/",
                                              headers=_CHROME_HEADERS)
                opener.open(req0, timeout=10).read(1024)  # discard body
            except Exception:
                pass

        # Step 2: follow the short URL with our primed session
        req = urllib.request.Request(url, headers=_CHROME_HEADERS)
        with opener.open(req, timeout=10) as resp:
            final = resp.geturl()

            if "show_error" not in final and \
               not final.rstrip("/").endswith("pinterest.com") and \
               not final.rstrip("/").endswith("pinterest.com/"):
                return final

            # Bot-detected fallback: try to extract pin ID from body
            try:
                body = resp.read().decode("utf-8", errors="replace")
                # Pinterest embeds pin IDs in many places: og:url, pinId, etc.
                patterns = [
                    r'pinterest\.com/pin/(\d{10,})',
                    r'"id"\s*:\s*"(\d{10,})"',
                    r'pinId["\']?\s*[:=]\s*["\']?(\d{10,})',
                ]
                for pat in patterns:
                    m = re.search(pat, body)
                    if m:
                        return f"https://www.pinterest.com/pin/{m.group(1)}/"
            except Exception:
                pass

            return url  # give up — let yt-dlp try the original
    except Exception as e:
        print(f"[Grabbit] Could not resolve short URL {url}: {e}")
        return url


# ─── EXTRACTOR_BROKEN PATTERNS ────────────────────────────────────────────────
# These patterns indicate yt-dlp's extractor can't handle the platform anymore.
# Only an updated yt-dlp can fix them — they are "external" errors.
# If a download fails with ANY of these patterns, we trigger an auto-update.
EXTRACTOR_BROKEN_PATTERNS = {
    "youtube": [
        "signature extraction failed",
        "nsig extraction failed",
        "could not find player",
        "failed to extract any player response",
        "unable to extract player response",
        # NOTE: do NOT add "some web client https formats have been skipped" or
        # "some formats may be missing" here — those are common WARNINGS, not
        # fatal errors. yt-dlp falls back to other formats and downloads fine.
        # Treating them as extractor_broken caused false positives.
    ],
    "instagram": [
        "unable to extract initial data",
        "main webpage is locked",
        "instagram sent an empty response",
        "the page requires login",
    ],
    "facebook": [
        "unable to extract video data",
        "unable to extract video url",
        "unable to extract uploader",
        "no media found",
    ],
    "tiktok": [
        "unable to extract video data",
        "aweme id",
        "could not find video",
        "tiktok api returned no data",
    ],
    "twitter": [
        "unable to extract tweet data",
        "unable to extract guest token",
        "could not extract media",
    ],
    "twitch": [
        "unable to extract clip slug",
        "could not find video information",
        "channel went offline",
    ],
}


def _is_extractor_broken(raw_err, platform_id):
    """Check if the error matches a known 'platform changed' pattern.
    Only these errors should trigger an auto-update of the download engine."""
    if not raw_err or not platform_id:
        return False
    patterns = EXTRACTOR_BROKEN_PATTERNS.get(platform_id, [])
    r = raw_err.lower()
    return any(p in r for p in patterns)


def _classify_error(raw_err, platform_id=None, original_url=None):
    """Classify yt-dlp error output into (error_code, i18n_key). Returns terminal=True if no retry makes sense."""
    r = raw_err.lower()

    # ── TERMINAL errors (no retry — saves the IP from being flagged) ──

    # Age-restricted (+18). We deliberately don't use login cookies (yt-dlp's
    # own docs say they're unreliable for YouTube and risk an account ban).
    if ("confirm your age" in r or "inappropriate for some users" in r
            or "age-restricted" in r or "age restricted" in r):
        return "age_restricted", "err_age_restricted", True

    # Geo-blocked — can't bypass without a proxy/VPN.
    if ("not available in your country" in r or "not available in your region" in r
            or "blocked it in your country" in r or "geo-restricted" in r
            or "video is not available" in r):
        return "geo_blocked", "err_geo_blocked", True

    # Private video.
    if "private video" in r or "this video is private" in r:
        return "private", "err_private", True

    # Removed / unavailable / terminated account.
    if ("has been removed" in r or "video unavailable" in r
            or "no longer available" in r
            or "account associated with this video has been terminated" in r):
        return "removed", "err_removed", True

    # Pinterest pin.it short link bot block (terminal — needs long URL).
    if platform_id == "pinterest" and "show_error" in r:
        if original_url and "pin.it" in original_url:
            return "pinterest_share_blocked", "err_pinterest_share", True
        return "pinterest_blocked", "err_pinterest_blocked", True

    # ── RETRYABLE errors ──

    # Platform extractor broken — needs an engine update.
    if _is_extractor_broken(raw_err, platform_id):
        return "extractor_broken", "err_platform_changed", False
    if "429" in raw_err or "too many requests" in r:
        return "rate_limited", "err_rate_limited", False
    if "merger" in r or "ffmpeg" in r and "error" in r:
        return "merge_failed", "err_merge_failed", False
    if "requested format is not available" in r or "format is not available" in r:
        return "format_gone", "err_format_gone", False
    # Generic bot/sign-in (NOT age — handled above as terminal).
    if "sign in to confirm you" in r or "bot" in r or "verify" in r:
        return "bot_detected", "err_bot_detected", False
    if "no space left" in r or "disk quota" in r:
        return "disk_space", "err_disk_space", True
    return "unknown", "err_unknown", False


PLATFORM_DISPLAY = {
    "youtube":    "YouTube",
    "tiktok":     "TikTok",
    "instagram":  "Instagram",
    "facebook":   "Facebook",
    "twitter":    "X",
    "pinterest":  "Pinterest",
    "twitch":     "Twitch",
    "soundcloud": "SoundCloud",
    "other":      "Video",
}

def _build_cmd(url, platform_id, quality, audio_only, no_audio,
               start_time, end_time, filename_tmpl, audio_format,
               audio_bitrate, video_codec, video_container,
               job_temp_dir, strategy=0, safe_filename=False):
    """Build yt-dlp command. strategy=0 normal, 1=fallback format, 2=android client, 3=ios client.
    safe_filename=True forces a short, sanitized filename to avoid Windows path length issues."""
    cmd = [str(YTDLP_PATH), "--ffmpeg-location", str(TOOLS_DIR)]

    if platform_id in ("twitch", "tiktok", "youtube"):
        cmd += ["--concurrent-fragments", "4"]

    # Sanitize filenames + cap length so Windows (260-char path limit) doesn't choke
    cmd += ["--restrict-filenames", "--trim-filenames", "120"]

    if safe_filename:
        # Fallback template — short, predictable, always works on Windows
        # E.g. "YouTube video - MrBeast.mp4"
        platform_name = PLATFORM_DISPLAY.get(platform_id, "Video")
        out_tmpl = f"{platform_name} video - %(uploader,channel,id)s.%(ext)s"
        cmd += ["-o", str(job_temp_dir / out_tmpl)]
    else:
        cmd += ["-o", str(job_temp_dir / filename_tmpl)]

    # Print real (un-sanitized) title and thumbnail so we can update the queue
    # item after the download completes. These markers are easy to grep from
    # the output stream.
    cmd += [
        "--print", "before_dl:GRABBIT_TITLE::%(title)s",
        "--print", "before_dl:GRABBIT_THUMB::%(thumbnail)s",
        "--print", "before_dl:GRABBIT_DURATION::%(duration)s",
    ]

    if platform_id == "facebook":
        cmd += ["--compat-options", "no-youtube-prefer-utc-upload-date"]

    # Pinterest is aggressive about bot detection — pass browser-like headers
    if platform_id == "pinterest":
        cmd += [
            "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "--referer", "https://www.pinterest.com/",
            "--add-header", "Accept-Language:en-US,en;q=0.9",
        ]
    # Add player client for YouTube on retry strategies
    if platform_id == "youtube" and strategy == 2:
        cmd += ["--extractor-args", "youtube:player_client=android"]
    elif platform_id == "youtube" and strategy == 3:
        cmd += ["--extractor-args", "youtube:player_client=ios"]

    is_twitch = platform_id == "twitch"
    if is_twitch:
        if audio_only:
            cmd += ["-f", "bestaudio", "--extract-audio", "--audio-format", audio_format]
        else:
            cmd += ["-f", f"best[height<={quality}]/best" if quality != "best" else "best"]
    elif audio_only:
        cmd += ["-f", "bestaudio", "--extract-audio", "--audio-format", audio_format,
                "--audio-quality", f"{audio_bitrate}k"]
    elif no_audio:
        if strategy >= 1:
            cmd += ["-f", "bestvideo/best"]
        else:
            cmd += ["-f", f"bestvideo[height<={quality}]" if quality != "best" else "bestvideo"]
    else:
        if strategy >= 1:
            # Fallback: simplest possible format, no codec constraint, pre-merged
            cmd += ["-f", "bestvideo+bestaudio/best", "--merge-output-format", "mp4"]
            cmd += ["--postprocessor-args", f"ffmpeg:-c:a aac -b:a {audio_bitrate}k"]
        else:
            vcodec_filter = "[vcodec^=avc]" if video_codec == "h264" else "[vcodec^=hev]"
            if quality == "best":
                fmt = f"bestvideo{vcodec_filter}+bestaudio/bestvideo+bestaudio/best"
            else:
                fmt = (f"bestvideo[height<={quality}]{vcodec_filter}+bestaudio"
                       f"/bestvideo[height<={quality}]+bestaudio/best[height<={quality}]")
            cmd += ["-f", fmt, "--merge-output-format", video_container]
            cmd += ["--postprocessor-args", f"ffmpeg:-c:a aac -b:a {audio_bitrate}k"]

    if start_time or end_time:
        section = f"*{start_time or '0'}-{end_time or 'inf'}"
        cmd += ["--download-sections", section, "--force-keyframes-at-cuts"]

    # --progress forces yt-dlp to emit the progress bar even though --print
    # (used above to capture the title) otherwise suppresses it. Without this,
    # the progress line with the % is never printed and the UI jumps 0 -> 100.
    # --no-colors is CRITICAL otherwise yt-dlp outputs ANSI codes which break regex matching.
    cmd += ["--no-playlist", "--newline", "--no-colors", "--progress", url]
    return cmd


def _run_cmd(cmd, job_id):
    """Run a yt-dlp command, stream output, update progress.
    Returns (returncode, error_lines, downloaded_file, real_title, real_thumb)."""
    env = _ytdlp_env()
    env["PYTHONUNBUFFERED"] = "1"   # force yt-dlp to flush stdout in real time
    popen_kwargs = {
        "stdout": subprocess.PIPE, "stderr": subprocess.STDOUT,
        "encoding": "utf-8", "errors": "replace", "bufsize": 1,
        "env": env, **WIN_FLAGS,
    }
    process = subprocess.Popen(cmd, **popen_kwargs)
    downloaded_file = None
    error_lines = []
    real_title = None
    real_thumb = None
    real_duration = None

    def _handle_line(line):
        nonlocal downloaded_file, real_title, real_thumb, real_duration
        line = line.strip()
        if not line:
            return
            
        # Debug logging
        with open("ytdlp_debug.log", "a", encoding="utf-8") as f:
            f.write(line + "\n")
            

        if "ERROR" in line:
            error_lines.append(line)

        if line.startswith("GRABBIT_TITLE::"):
            real_title = line[len("GRABBIT_TITLE::"):].strip() or real_title
            return
        if line.startswith("GRABBIT_THUMB::"):
            val = line[len("GRABBIT_THUMB::"):].strip()
            if val and val.lower() != "na":
                real_thumb = val
            return
        if line.startswith("GRABBIT_DURATION::"):
            val = line[len("GRABBIT_DURATION::"):].strip()
            if val and val.lower() != "na":
                real_duration = val
            return

        dest_match   = re.search(r'\[download\] Destination: (.+)', line)
        merge_match  = re.search(r'\[Merger\] Merging formats into "(.+)"', line)
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

        with progress_lock:
            current_state = download_progress.setdefault(job_id, {"status": "starting", "pct": 0, "msg": "Starting...", "logs": []})
            if "logs" not in current_state:
                current_state["logs"] = []
            
            # Filter out pure progress bar updates from the log so it's readable
            if "]" in line and "%" not in line:
                current_state["logs"].append(line)
                if len(current_state["logs"]) > 2:
                    current_state["logs"].pop(0)

        if pct_match:
            pct = float(pct_match.group(1))
            
            with progress_lock:
                prev_raw_pct = current_state.get("raw_pct", 0)
                phase = current_state.get("phase", "video")
                
                # If progress drops from >50 to <5, it means yt-dlp finished video stream
                # and is now downloading the audio stream.
                if phase == "video" and prev_raw_pct > 50 and pct < 5:
                    phase = "audio"
                
                # If audio is at 100% and process is still running, it's silently merging
                if phase == "audio" and pct >= 99.9:
                    phase = "merging"
                    msg = "Processing... (FFmpeg)"
                else:
                    msg = f"{pct:.1f}%"
                    if speed_match: msg += f" · {speed_match.group(1)}"
                    if eta_match:   msg += f" · ETA {eta_match.group(1)}"
                
                # Keep the display percentage from going backwards
                display_pct = max(current_state.get("pct", 0), pct) if phase == "video" else max(current_state.get("pct", 0), 90 + (pct * 0.09))
                
                current_state.update({
                    "status": "downloading", 
                    "pct": min(display_pct, 99), 
                    "raw_pct": pct,
                    "phase": phase,
                    "msg": msg
                })
        elif any(kw in line for kw in ["[Merger]", "Merging", "[ffmpeg]", "Fixup", "ExtractAudio"]):
            with progress_lock:
                current_state = download_progress.setdefault(job_id, {})
                current_state.update({"status": "downloading", "pct": 99, "phase": "merging", "msg": "Processing... (FFmpeg)"})

    # Read char-by-char, splitting on BOTH \n and \r. Progress bars from yt-dlp
    # use \r to overwrite the line in place; reading whole lines (\n only) would
    # buffer the entire progress until the download finished.
    cur = []
    while True:
        ch = process.stdout.read(1)
        if not ch:
            break
        if ch in ('\n', '\r'):
            if cur:
                _handle_line("".join(cur))
                cur = []
        else:
            cur.append(ch)
    if cur:
        _handle_line("".join(cur))

    process.wait()
    return process.returncode, error_lines, downloaded_file, real_title, real_thumb, real_duration


_INTERMEDIATE_FILE_RE = re.compile(r"\.f\d{2,4}\.[a-z0-9]+$", re.IGNORECASE)

def _is_intermediate(name):
    """yt-dlp leaves per-stream files like 'video.f137.mp4' or 'video.f251.webm'
    before merging them. These are not the final output and must be ignored."""
    return bool(_INTERMEDIATE_FILE_RE.search(name))

def _safe_move_with_progress(src, dst, job_id, max_retries=8):
    """Moves the file to the final destination, tracking progress if a full copy is needed.
    Ensures the UI doesn't say 'DONE' until the file is 100% physically available."""
    src = Path(src)
    dst = Path(dst)
    last_err = None
    
    for i in range(max_retries):
        try:
            # Attempt an instantaneous OS rename (fastest, works if on same drive)
            os.rename(str(src), str(dst))
            return True
        except OSError as e:
            # WinError 32 / errno 13 = File in use by another process (ffmpeg still closing it)
            if getattr(e, 'winerror', None) == 32 or e.errno == 13:
                last_err = e
                time.sleep(0.3 * (i + 1))
                continue
            
            # Cross-device link or other error requiring a physical copy bit-by-bit
            try:
                total_size = src.stat().st_size
                copied = 0
                
                with progress_lock:
                    if job_id in download_progress:
                        download_progress[job_id]["msg"] = "0%"
                        download_progress[job_id]["pct"] = 99
                        download_progress[job_id]["phase"] = "saving"
                
                with open(src, 'rb') as fsrc, open(dst, 'wb') as fdst:
                    while True:
                        chunk = fsrc.read(4 * 1024 * 1024) # 4MB chunks
                        if not chunk:
                            break
                        fdst.write(chunk)
                        copied += len(chunk)
                        
                        pct = (copied / total_size) * 100
                        with progress_lock:
                            if job_id in download_progress:
                                download_progress[job_id]["msg"] = f"{int(pct)}%"
                                download_progress[job_id]["phase"] = "saving"
                                
                shutil.copystat(str(src), str(dst))
                src.unlink() # Delete original after successful copy
                return True
            except Exception as copy_err:
                # If copy fails midway (e.g., out of disk space), clean up the broken destination file
                if dst.exists():
                    try: dst.unlink()
                    except: pass
                last_err = copy_err
                break # Don't retry a failed physical copy
    
    if last_err:
        raise last_err
    return False

def _move_to_output(downloaded_file, out_dir, job_temp_dir, job_id):
    """Move downloaded file(s) from job_temp_dir to out_dir with progress tracking.
    Returns the Path of the final output file (or None if nothing was moved).
    Filters out yt-dlp intermediate streams (.fNNN.ext, .temp.ext, .part)."""
    time.sleep(0.3)

    if downloaded_file and Path(downloaded_file).exists() and not _is_intermediate(downloaded_file):
        src = Path(downloaded_file)
        dst = out_dir / src.name
        if dst.exists():
            dst = out_dir / f"{src.stem}_{int(time.time())}{src.suffix}"
        if _safe_move_with_progress(src, dst, job_id):
            return dst
        return None

    # Fallback: move only "final" files from the JOB-specific temp dir
    if not job_temp_dir.exists():
        return None
    last_moved = None
    for f in job_temp_dir.iterdir():
        if not f.is_file() or f.name.endswith('.part') or 'Frag' in f.name:
            continue
        if _is_intermediate(f.name) or '.temp.' in f.name or f.name.endswith('.temp'):
            continue
        dst = out_dir / f.name
        if dst.exists():
            dst = out_dir / f"{f.stem}_{int(time.time())}{f.suffix}"
        try:
            if _safe_move_with_progress(f, dst, job_id):
                last_moved = dst
        except Exception:
            pass
    return last_moved


def _title_from_filename(path):
    """Derive a clean display title from a downloaded filename.
    Converts 'El_Kick_Ass_falso_viral_peliculas_shorts.mp3' to
    'El Kick Ass falso viral peliculas shorts'."""
    if not path:
        return None
    stem = Path(path).stem
    # Drop common yt-dlp suffixes like ".f137" or "_1780028..."
    stem = re.sub(r'\.f\d{2,4}$', '', stem)
    # Restore spaces from underscores produced by --restrict-filenames
    return stem.replace('_', ' ').strip()


def _cleanup_job_temp(job_temp_dir):
    """Remove the job-specific temp subdirectory and all its files."""
    if not job_temp_dir or not job_temp_dir.exists():
        return
    # Delete files first with retry, then the dir itself
    for f in list(job_temp_dir.iterdir()):
        if not f.is_file():
            continue
        for i in range(5):
            try:
                f.unlink()
                break
            except PermissionError:
                time.sleep(0.2 * (i + 1))
            except Exception:
                break
    try:
        shutil.rmtree(job_temp_dir, ignore_errors=True)
    except Exception:
        pass


def run_download(job_id, item_id, url, quality, audio_only, no_audio,
                 start_time, end_time, save_folder=None):
    # Resolve short URLs (pin.it, fb.watch) with a browser-like UA before
    # handing the URL to yt-dlp — otherwise the platform may redirect to
    # an error page.
    original_url = url
    url = _resolve_short_url(url)
    platform_id = detect_platform(url)
    settings    = load_settings()

    filename_style  = settings.get("filename_style", "basic")
    video_codec     = settings.get("video_codec", "h264")
    video_container = settings.get("video_container", "mp4")
    audio_format    = settings.get("audio_format", "mp3")
    audio_bitrate   = settings.get("audio_bitrate", "192")

    filename_templates = {
        "basic":  "%(title)s.%(ext)s",
        "pretty": "%(uploader)s - %(title)s.%(ext)s",
        "nerdy":  "%(upload_date>%Y-%m-%d)s - %(title)s [%(height)sp].%(ext)s",
    }
    filename_tmpl = filename_templates.get(filename_style, filename_templates["basic"])

    # Retry strategies.
    # 0 = normal, 1 = fallback format, 2 = android client, 3 = ios client
    #
    # NOTE: We deliberately do NOT use browser cookies. yt-dlp's own docs say
    # cookies-from-browser is unreliable for YouTube (cookies rotate) and can
    # get the YouTube account banned. Trying many requests per video also gets
    # the IP flagged as a bot. So: a few clean attempts, then a clear message.
    if platform_id == "youtube":
        strategies = [0, 1, 2, 3]
    else:
        strategies = [0, 1]

    try:
        with progress_lock:
            download_progress[job_id] = {"status": "starting", "pct": 0, "msg": "Preparing..."}
        update_item_status(item_id, "downloading", {"active_job_id": job_id})

        out_dir = Path(save_folder) if save_folder else DOWNLOADS_DIR
        out_dir.mkdir(parents=True, exist_ok=True)
        TEMP_DIR.mkdir(parents=True, exist_ok=True)

        # Isolated subdir per job — prevents concurrent downloads from
        # stealing each other's temp files
        job_temp_dir = TEMP_DIR / job_id
        job_temp_dir.mkdir(parents=True, exist_ok=True)

        last_error_code = "unknown"
        last_i18n_key   = "err_unknown"
        attempt_logs    = []  # collected for error_log.json
        safe_filename_mode = False  # flip to True after a filename-related failure

        for attempt, strategy in enumerate(strategies):
            if attempt > 0:
                with progress_lock:
                    download_progress[job_id] = {
                        "status": "downloading", "pct": 0,
                        "msg": f"Retrying ({attempt}/{len(strategies)-1})...",
                    }
                # Brief pause before retry to avoid immediate rate limiting
                time.sleep(5 if last_error_code == "rate_limited" else 2)

            cmd = _build_cmd(url, platform_id, quality, audio_only, no_audio,
                             start_time, end_time, filename_tmpl, audio_format,
                             audio_bitrate, video_codec, video_container,
                             job_temp_dir, strategy, safe_filename=safe_filename_mode)

            returncode, error_lines, downloaded_file, real_title, real_thumb, real_duration = _run_cmd(cmd, job_id)

            if returncode == 0:
                final_path = _move_to_output(downloaded_file, out_dir, job_temp_dir, job_id)
                _cleanup_job_temp(job_temp_dir)

                # If yt-dlp didn't print the real title, derive one from the
                # downloaded filename so the queue/library never show a raw URL.
                if not real_title and final_path:
                    real_title = _title_from_filename(final_path)

                # Ensure we only mark as DONE if the file physically exists in the final directory
                if final_path and Path(final_path).exists():
                    file_size = Path(final_path).stat().st_size
                    with progress_lock:
                        download_progress[job_id] = {
                            "status": "done", "pct": 100,
                            "msg": str(out_dir), "save_folder": str(out_dir),
                            "title": real_title, "thumbnail": real_thumb,
                            "duration": real_duration, "file_size": file_size
                        }
                    extra = {"save_folder": str(out_dir), "file_size": file_size}
                    if real_title: extra["title"]     = real_title
                    if real_thumb: extra["thumbnail"] = real_thumb
                    if real_duration: extra["duration"] = real_duration
                    update_item_status(item_id, "done", extra)
                    threading.Thread(target=_ping_download, daemon=True).start()
                else:
                    # File failed to copy or doesn't exist. Report an error.
                    with progress_lock:
                        download_progress[job_id] = {
                            "status": "error", "pct": 0,
                            "msg": "File missing after copy", "error_code": "err_file_missing",
                            "platform": platform_id,
                        }
                    update_item_status(item_id, "error", {
                        "error_msg": "Could not save file to disk.",
                        "error_code": "err_file_missing",
                    })

                # Success — reset the failure counter and clear any platform issue flag
                _clear_recent_failures(platform_id)
                return

            # Classify error and decide whether to retry
            raw_err = " ".join(error_lines)
            error_code, i18n_key, terminal = _classify_error(raw_err, platform_id, original_url)
            last_error_code = error_code
            last_i18n_key   = i18n_key

            attempt_logs.append({
                "attempt": attempt + 1,
                "strategy": strategy,
                "returncode": returncode,
                "cmd": cmd,
                "stderr": error_lines,
                "classified_as": error_code,
            })

            # Detect filename-related failures — switch to safe filename for next retry
            err_lower = raw_err.lower()
            if not safe_filename_mode and (
                "unable to open for writing" in err_lower
                or "no such file or directory" in err_lower
                or "filename too long" in err_lower
                or "path too long" in err_lower
            ):
                safe_filename_mode = True
                # Make sure we have at least one more attempt with the safe filename
                if attempt + 1 >= len(strategies):
                    strategies = list(strategies) + [0]

            _cleanup_job_temp(job_temp_dir)
            # Recreate the dir for the next attempt
            job_temp_dir.mkdir(parents=True, exist_ok=True)

            if terminal:
                break  # No point retrying (private, geo-blocked, removed)

            # For rate-limit, only retry with same strategy (no format change needed)
            if error_code == "rate_limited" and attempt == 0:
                strategies = [0, 0]  # retry same twice

        # All strategies exhausted — mark as error, keep in queue
        with progress_lock:
            download_progress[job_id] = {
                "status": "error", "pct": 0,
                "msg": last_i18n_key,        # frontend uses t(msg) to translate
                "error_code": last_error_code,
                "platform": platform_id,
            }
        update_item_status(item_id, "error", {
            "error_msg": last_i18n_key,
            "error_code": last_error_code,
        })

        # Persist full error log for debugging
        _log_error({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "item_id":   item_id,
            "job_id":    job_id,
            "url":       url,
            "platform":  platform_id,
            "quality":   quality,
            "format":    "audio" if audio_only else ("video" if no_audio else "video+audio"),
            "final_code": last_error_code,
            "final_i18n_key": last_i18n_key,
            "attempts":  attempt_logs,
        })

        # Track failures for heuristic detection of platform-wide issues
        _record_platform_failure(platform_id, last_error_code)

    except Exception as e:
        try:
            _cleanup_job_temp(job_temp_dir)
        except Exception:
            pass
        tb_str = traceback.format_exc()
        print(f"[Grabbit] run_download exception for {url}:\n{tb_str}")
        with progress_lock:
            download_progress[job_id] = {
                "status": "error", "pct": 0,
                "msg": "err_unknown", "error_code": "exception", "platform": platform_id,
            }
        update_item_status(item_id, "error", {"error_msg": "err_unknown", "error_code": "exception"})
        # Log the exception with full traceback for debugging
        try:
            _log_error({
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "item_id":   item_id,
                "job_id":    job_id,
                "url":       url,
                "platform":  platform_id,
                "quality":   quality,
                "format":    "audio" if audio_only else ("video" if no_audio else "video+audio"),
                "final_code": "exception",
                "final_i18n_key": "err_unknown",
                "attempts":  [{
                    "attempt": 0,
                    "strategy": -1,
                    "returncode": -1,
                    "cmd": [],
                    "stderr": [f"Python exception: {type(e).__name__}: {e}", tb_str],
                    "classified_as": "exception",
                }],
            })
        except Exception as log_err:
            print(f"[Grabbit] Could not log exception: {log_err}")

# ─── TRANSCRIPT HELPERS ───────────────────────────────────────────────────────

def _srt_to_text(content):
    """Strip SRT/VTT formatting and produce clean, deduplicated plain text.

    YouTube auto-captions use a rolling 2-line window: each cue shares lines
    with the next cue separated by a blank line in the SRT. Simple consecutive
    dedup fails because blank lines reset context. We collect all non-empty
    lines first, then deduplicate with a sliding window of the last N seen.
    """
    text = re.sub(r'^\d+\s*$', '', content, flags=re.MULTILINE)
    text = re.sub(
        r'\d{1,2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,\.]\d{3}[^\n]*',
        '', text,
    )
    text = re.sub(r'^WEBVTT.*$', '', text, flags=re.MULTILINE)
    text = re.sub(r'^NOTE\b.*$', '', text, flags=re.MULTILINE)
    text = re.sub(r'<[^>]+>', '', text)

    all_lines = [l.strip() for l in text.splitlines() if l.strip()]

    # Sliding-window dedup: each line can appear in several consecutive cues
    WINDOW = 5
    result = []
    recent = []
    for line in all_lines:
        if line not in recent:
            result.append(line)
        recent.append(line)
        if len(recent) > WINDOW:
            recent.pop(0)

    return '\n'.join(result).strip()


def run_transcript_download(job_id, item_id, url, original_lang=None, save_folder=None):
    """Download subtitles of a YouTube video and save as clean .txt (original language)."""
    platform_id  = detect_platform(url)
    job_temp_dir = TEMP_DIR / job_id

    try:
        with progress_lock:
            download_progress[job_id] = {"status": "downloading", "pct": 10, "msg": "Fetching transcript..."}
        update_item_status(item_id, "downloading", {"active_job_id": job_id})

        out_dir = Path(save_folder) if save_folder else DOWNLOADS_DIR
        out_dir.mkdir(parents=True, exist_ok=True)
        job_temp_dir.mkdir(parents=True, exist_ok=True)

        # Use the video's original language code if known; otherwise try a broad match.
        # original_lang comes from yt-dlp's "language" field (e.g. "en", "es", "ko").
        if original_lang:
            # Also try the "-orig" variant that YouTube uses for auto-generated originals
            sub_langs = f"{original_lang},{original_lang}-orig"
        else:
            sub_langs = "all"

        cmd = [
            str(YTDLP_PATH),
            "--write-auto-sub",   # auto-generated captions
            "--write-sub",        # manual captions (preferred when available)
            "--sub-langs", sub_langs,
            "--skip-download",    # we only want the subtitle file, not the video
            "--convert-subs", "srt",
            "--no-playlist",
            "--restrict-filenames",
            "--trim-filenames", "120",
            "-o", str(job_temp_dir / "%(title)s.%(ext)s"),
            url,
        ]

        with progress_lock:
            download_progress[job_id] = {"status": "downloading", "pct": 40, "msg": "Downloading transcript..."}

        result = subprocess.run(
            cmd, capture_output=True, encoding="utf-8", errors="replace",
            timeout=60, env=_ytdlp_env(), **WIN_FLAGS,
        )

        with progress_lock:
            download_progress[job_id] = {"status": "downloading", "pct": 75, "msg": "Processing text..."}

        srt_files = sorted(job_temp_dir.glob("*.srt"))

        if not srt_files:
            _cleanup_job_temp(job_temp_dir)
            with progress_lock:
                download_progress[job_id] = {
                    "status": "error", "pct": 0,
                    "msg": "err_no_transcript",
                    "error_code": "no_transcript", "platform": platform_id,
                }
            update_item_status(item_id, "error", {
                "error_msg": "err_no_transcript", "error_code": "no_transcript",
            })
            return

        # yt-dlp names the file like "Title.en.srt" or "Title.es-419.srt"
        # Use the first file (prefer manual over auto if both present — manual ends without .auto)
        manual = [f for f in srt_files if ".auto." not in f.name]
        chosen = manual[0] if manual else srt_files[0]

        srt_content = chosen.read_text(encoding="utf-8", errors="replace")
        clean_text  = _srt_to_text(srt_content)

        if not clean_text.strip():
            _cleanup_job_temp(job_temp_dir)
            with progress_lock:
                download_progress[job_id] = {
                    "status": "error", "pct": 0,
                    "msg": "err_no_transcript",
                    "error_code": "no_transcript", "platform": platform_id,
                }
            update_item_status(item_id, "error", {
                "error_msg": "err_no_transcript", "error_code": "no_transcript",
            })
            return

        # Build output filename: strip yt-dlp's language suffix (.en, .es-419, etc.)
        txt_stem = re.sub(r'\.[a-z]{2}(-[A-Za-z0-9]{2,5})?$', '', chosen.stem)
        txt_name = f"{txt_stem}.txt"
        dst = out_dir / txt_name
        if dst.exists():
            dst = out_dir / f"{txt_stem}_{int(time.time())}.txt"

        dst.write_text(clean_text, encoding="utf-8")
        _cleanup_job_temp(job_temp_dir)

        file_size = dst.stat().st_size
        with progress_lock:
            download_progress[job_id] = {
                "status": "done", "pct": 100,
                "msg": str(out_dir), "save_folder": str(out_dir),
                "file_size": file_size,
            }
        update_item_status(item_id, "done", {
            "save_folder": str(out_dir), "file_size": file_size,
        })
        threading.Thread(target=_ping_download, daemon=True).start()

    except Exception as e:
        try:
            _cleanup_job_temp(job_temp_dir)
        except Exception:
            pass
        tb_str = traceback.format_exc()
        print(f"[Grabbit] run_transcript_download exception:\n{tb_str}")
        with progress_lock:
            download_progress[job_id] = {
                "status": "error", "pct": 0,
                "msg": "err_unknown", "error_code": "exception", "platform": platform_id,
            }
        update_item_status(item_id, "error", {"error_msg": "err_unknown", "error_code": "exception"})


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
    data            = request.json
    url             = data.get("url", "").strip()
    item_id         = data.get("item_id", "").strip()
    quality         = data.get("quality", "best")
    audio_only      = data.get("audio_only", False)
    no_audio        = data.get("no_audio", False)
    start_time      = data.get("start_time", "").strip()
    end_time        = data.get("end_time", "").strip()
    save_folder     = data.get("save_folder", "").strip() or None
    title           = data.get("title", url[:60] if url else "Unknown")
    thumbnail       = data.get("thumbnail", "")
    platform        = data.get("platform", detect_platform(url))
    is_transcript   = data.get("format", "") == "text"
    original_lang   = data.get("transcript_lang", "").strip().lower() or None

    if not url:
        return jsonify({"error": "URL required"}), 400

    if not save_folder:
        settings    = load_settings()
        save_folder = settings.get("save_folder") or None

    # ── Free-tier limit check ──────────────────────────────────
    settings   = load_settings()
    _code      = settings.get("license_code", "").strip().upper()
    if not _is_pro(_code):
        _machine   = get_or_create_machine_id()
        _is_batch  = bool(data.get("is_batch"))
        _dl_type   = "transcript" if is_transcript else ("batch" if _is_batch else "single")
        _key_map   = {"single": "singles", "batch": "batches", "transcript": "transcripts"}
        _usage     = _get_trial_usage(_machine)
        _used      = _usage.get(_key_map[_dl_type], 0)
        _limit     = TRIAL_LIMITS[_dl_type]
        if _used >= _limit:
            return jsonify({"error": "trial_limit_reached", "type": _dl_type, "limit": _limit}), 403
        # Increment — for batch, only once per batch session
        if _is_batch:
            _session_id = data.get("batch_session_id", "")
            with _batch_session_lock:
                if _session_id not in _seen_batch_sessions:
                    _seen_batch_sessions.add(_session_id)
                    threading.Thread(target=_increment_trial_usage, args=(_machine, "batch"), daemon=True).start()
        else:
            threading.Thread(target=_increment_trial_usage, args=(_machine, _dl_type), daemon=True).start()

    import uuid
    job_id = f"dl_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"

    fmt = "text" if is_transcript else ("audio" if audio_only else ("video" if no_audio else "video+audio"))
    state = load_queue_state()
    state["items"].append({
        "id":              item_id or job_id,
        "url":             url,
        "title":           title,
        "thumbnail":       thumbnail,
        "platform":        platform,
        "format":          fmt,
        "quality":         quality,
        "startTime":       start_time,
        "endTime":         end_time,
        "saveFolder":      save_folder or str(DOWNLOADS_DIR),
        "status":          "downloading",
        "active_job_id":   job_id,
        "transcript_lang": original_lang if is_transcript else None,
    })
    save_queue_state(state["items"])

    # ── Transcript download ────────────────────────────────
    if is_transcript:
        threading.Thread(
            target=run_transcript_download,
            args=(job_id, item_id or job_id, url, original_lang, save_folder),
            daemon=True,
        ).start()
        return jsonify({"job_id": job_id})

    # ── Regular video/audio download ───────────────────────
    GENERIC_TITLES = ('instagram', 'youtube', 'tiktok', 'facebook', 'twitter', 'pinterest', 'twitch', 'soundcloud')
    needs_info = (
        not thumbnail or
        not title or
        title == url[:60] or
        title.lower().strip() in GENERIC_TITLES
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

# ─── WATCHLIST — CORE LOGIC ───────────────────────────────────────────────────

_watchlist_lock     = threading.Lock()
_channel_video_cache = {}          # {(channel_url, period): (fetched_at_ts, videos)}
_CACHE_TTL           = 15 * 60    # 15 minutes


_YT_TABS = ("/videos", "/shorts", "/live", "/streams", "/playlists", "/featured")

def _yt_tab_url(url, tab="videos"):
    """Return the YouTube channel URL for the given tab (videos/shorts/etc).
    Replaces any existing tab suffix or appends the new one."""
    if not any(x in url for x in ["youtube.com/@", "youtube.com/c/", "youtube.com/channel/", "youtube.com/user/"]):
        return url  # not a YouTube channel — leave as-is
    base = url.rstrip("/")
    for t in _YT_TABS:
        if base.endswith(t):
            base = base[:-len(t)]
            break
    return f"{base}/{tab}"

def _yt_videos_url(url):
    return _yt_tab_url(url, "videos")


def _fetch_latest_video_id(channel_url):
    """Fetch the single most-recent video ID from a channel. Very fast (~1-3s)."""
    cmd = [
        str(YTDLP_PATH),
        "--flat-playlist", "--playlist-end", "1",
        "--dump-single-json", "--no-warnings", "--quiet",
        _yt_videos_url(channel_url),
    ]
    result = subprocess.run(
        cmd, capture_output=True, text=True, timeout=30,
        env=_ytdlp_env(), **WIN_FLAGS,
    )
    if result.returncode != 0 or not result.stdout.strip():
        raise Exception((result.stderr or "yt-dlp returned no data").strip()[:200])

    data    = json.loads(result.stdout)
    entries = data.get("entries") or []
    if not entries or not entries[0]:
        return None
    return entries[0].get("id")


def _run_one_new_video_check(item, items_list):
    """Check whether the channel has a new video since last check.
    Updates has_new / last_video_id in-place and persists."""
    try:
        latest_id = _fetch_latest_video_id(item["channel_url"])
        now_iso   = datetime.now(timezone.utc).isoformat()
        item["last_check_at"] = now_iso
        item["last_error"]    = None

        if latest_id and latest_id != item.get("last_video_id"):
            item["has_new"]       = True
            item["last_video_id"] = latest_id
            print(f"[Grabbit] Watch: new video detected for {item.get('channel_name')}")
        else:
            # No change — keep has_new as-is (don't clear it)
            pass

    except Exception as e:
        item["last_check_at"] = datetime.now(timezone.utc).isoformat()
        item["last_error"]    = str(e)[:200]
        print(f"[Grabbit] Watch check failed for {item.get('channel_name')}: {e}")

    save_watchlist_state(items_list)


def _poll_watchlist_channels():
    """One cycle: check every channel that is due for a check."""
    with _watchlist_lock:
        data  = load_watchlist_state()
        items = data.get("items", [])
        if not items:
            return
        now = datetime.now(timezone.utc)
        for item in items:
            interval_h = float(item.get("check_interval_hours", 6))
            last_check = item.get("last_check_at")
            if last_check:
                try:
                    last_dt = datetime.fromisoformat(last_check.replace("Z", "+00:00"))
                    if (now - last_dt).total_seconds() < interval_h * 3600:
                        continue
                except Exception:
                    pass
            _run_one_new_video_check(item, items)


def watchlist_polling_loop():
    """Background thread: runs a poll cycle every 6 hours."""
    time.sleep(20)
    print("[Grabbit] Watchlist polling loop started.")
    while True:
        try:
            _poll_watchlist_channels()
        except Exception as e:
            print(f"[Grabbit] Watchlist poll cycle error: {e}")
        time.sleep(6 * 60 * 60)


def _fetch_channel_videos(channel_url, tab="videos"):
    """Fetch up to 300 videos from a channel tab (videos/shorts) without date filter.
    Date filtering is done client-side using the upload_date field so all period
    switches are instant without extra requests."""
    cmd = [
        str(YTDLP_PATH),
        "--flat-playlist",
        "--playlist-end", "500",
        "--dump-single-json",
        "--no-warnings", "--quiet",
        _yt_tab_url(channel_url, tab),
    ]
    result = subprocess.run(
        cmd, capture_output=True, text=True, timeout=120,
        env=_ytdlp_env(), **WIN_FLAGS,
    )
    if result.returncode != 0:
        raise Exception((result.stderr or "yt-dlp failed").strip()[:300])
    if not result.stdout.strip():
        return []

    data     = json.loads(result.stdout)
    entries  = data.get("entries") or []
    platform = detect_platform(channel_url)
    videos   = []

    for entry in entries:
        if not entry:
            continue
        vid_id = entry.get("id")
        if not vid_id:
            continue
        url = entry.get("url") or entry.get("webpage_url")
        if not url and platform == "youtube":
            url = f"https://www.youtube.com/watch?v={vid_id}"
        if not url:
            continue
        thumb = entry.get("thumbnail")
        if not thumb and entry.get("thumbnails"):
            thumb = entry["thumbnails"][-1].get("url")
        videos.append({
            "id":          vid_id,
            "title":       entry.get("title") or vid_id,
            "url":         url,
            "upload_date": entry.get("upload_date"),  # YYYYMMDD string
            "thumbnail":   thumb,
            "duration":    entry.get("duration"),
        })

    return videos


# ─── WATCHLIST API ────────────────────────────────────────────────────────────

@app.route("/api/watchlist/add", methods=["POST"])
def add_to_watchlist():
    url = (request.json or {}).get("url", "").strip()
    if not url:
        return jsonify({"error": "URL is required"}), 400

    current_list = load_watchlist_state().get("items", [])
    if any(item.get("channel_url") == url for item in current_list):
        return jsonify({"error": "Channel is already in the watch list"}), 409

    try:
        info = get_channel_info(url)
        # Grab the latest video ID immediately so we have a baseline for future checks
        try:
            latest_id = _fetch_latest_video_id(url)
        except Exception:
            latest_id = None

        new_item = {
            "id":                   str(_uuid.uuid4()),
            "channel_url":          url,
            "channel_name":         info.get("channel_name"),
            "channel_id":           info.get("channel_id"),
            "thumbnail":            info.get("thumbnail"),
            "platform":             detect_platform(url),
            "added_at":             datetime.now(timezone.utc).isoformat(),
            "check_interval_hours": 6,
            "last_check_at":        datetime.now(timezone.utc).isoformat(),
            "last_video_id":        latest_id,
            "has_new":              False,
            "last_error":           None,
        }
        current_list.insert(0, new_item)
        save_watchlist_state(current_list)
        return jsonify(new_item)
    except Exception as e:
        tb_str = traceback.format_exc()
        print(f"[Grabbit] Error adding to watchlist: {e}\n{tb_str}")
        if "Unsupported URL" in str(e):
            return jsonify({"error": "This URL is not a valid channel page."}), 400
        return jsonify({"error": "Could not get channel information. Check the URL and try again."}), 500


@app.route("/api/watchlist/state", methods=["GET"])
def get_watchlist_state():
    return jsonify(load_watchlist_state())


@app.route("/api/watchlist/delete", methods=["POST"])
def watchlist_delete():
    item_id = (request.json or {}).get("id")
    if not item_id:
        return jsonify({"error": "id required"}), 400
    data  = load_watchlist_state()
    items = [i for i in data.get("items", []) if i.get("id") != item_id]
    save_watchlist_state(items)
    return jsonify({"ok": True})


@app.route("/api/watchlist/check_now", methods=["POST"])
def watchlist_check_now():
    """Force an immediate new-video check for a specific channel (non-blocking)."""
    item_id = (request.json or {}).get("id")
    if not item_id:
        return jsonify({"error": "id required"}), 400

    def _run():
        with _watchlist_lock:
            data  = load_watchlist_state()
            items = data.get("items", [])
            item  = next((i for i in items if i.get("id") == item_id), None)
            if item:
                _run_one_new_video_check(item, items)

    threading.Thread(target=_run, daemon=True).start()
    return jsonify({"ok": True})


@app.route("/api/watchlist/seen", methods=["POST"])
def watchlist_seen():
    """Mark a channel as seen — clears the has_new badge."""
    item_id = (request.json or {}).get("id")
    if not item_id:
        return jsonify({"error": "id required"}), 400
    data = load_watchlist_state()
    for item in data.get("items", []):
        if item.get("id") == item_id:
            item["has_new"] = False
            break
    save_watchlist_state(data.get("items", []))
    return jsonify({"ok": True})


@app.route("/api/watchlist/channel_videos", methods=["POST"])
def watchlist_channel_videos():
    """Fetch videos from a channel tab (videos/shorts). No date filter — the full
    list (up to 300) is returned and the client filters by period. Cached 15 min."""
    body = request.json or {}
    url  = body.get("channel_url", "").strip()
    tab  = body.get("tab", "videos")   # videos | shorts

    if not url:
        return jsonify({"error": "channel_url required"}), 400
    if tab not in ("videos", "shorts"):
        tab = "videos"

    cache_key = (url, tab)
    cached    = _channel_video_cache.get(cache_key)
    if cached:
        fetched_at, videos = cached
        if time.time() - fetched_at < _CACHE_TTL:
            return jsonify({"videos": videos, "cached": True})

    try:
        videos = _fetch_channel_videos(url, tab)
        _channel_video_cache[cache_key] = (time.time(), videos)
        return jsonify({"videos": videos, "cached": False})
    except Exception as e:
        print(f"[Grabbit] channel_videos error for {url}: {e}")
        return jsonify({"error": str(e)[:300]}), 500

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
    filename = request.args.get("file")
    try:
        target = Path(path)
        if not target.exists():
            target = DOWNLOADS_DIR
        
        if IS_WINDOWS:
            if filename and (target / filename).exists():
                # Open folder and select the specific file, brings window to front
                file_path = str(target / filename)
                subprocess.Popen(f'explorer /select,"{file_path}"')
            else:
                os.startfile(str(target))
        elif IS_MAC:
            if filename and (target / filename).exists():
                subprocess.Popen(["open", "-R", str(target / filename)])
            else:
                subprocess.Popen(["open", str(target)])
        else:
            subprocess.Popen(["xdg-open", str(target)])
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

startup_status = {"ytdlp": "checking", "ffmpeg": "checking", "deno": "checking"}

# Engine (yt-dlp) update state — exposed to frontend via /api/engine/status
engine_state = {
    "version":          None,            # current yt-dlp version
    "last_checked":     None,            # iso timestamp of last check
    "last_updated":     None,            # iso timestamp of last actual update
    "update_in_progress": False,
    "platform_issue":   None,            # set when extractor_broken detected and no update available
    "platform_issue_at": None,
}
engine_state_lock = threading.Lock()
_engine_check_cooldown = 60 * 30  # 30 minutes — don't re-check too often

def _get_ytdlp_version():
    """Return the current yt-dlp version as a string, or None on failure."""
    if not YTDLP_PATH.exists():
        return None
    try:
        result = subprocess.run(
            [str(YTDLP_PATH), "--version"],
            capture_output=True, text=True, timeout=10, **WIN_FLAGS,
        )
        return result.stdout.strip() or None
    except Exception:
        return None


def update_engine(force=False):
    """Update yt-dlp silently. Returns (changed, old_version, new_version).
    Honors a cooldown unless force=True."""
    with engine_state_lock:
        if engine_state["update_in_progress"]:
            return (False, None, None)
        # Cooldown check
        last = engine_state.get("last_checked")
        if not force and last:
            try:
                last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
                if (datetime.now(timezone.utc) - last_dt).total_seconds() < _engine_check_cooldown:
                    return (False, engine_state.get("version"), engine_state.get("version"))
            except Exception:
                pass
        engine_state["update_in_progress"] = True

    old_version = _get_ytdlp_version()
    new_version = old_version

    try:
        if not YTDLP_PATH.exists():
            install_ytdlp()
        else:
            # yt-dlp self-update
            subprocess.run(
                [str(YTDLP_PATH), "-U"],
                capture_output=True, timeout=120, **WIN_FLAGS,
            )
        new_version = _get_ytdlp_version() or old_version
    except Exception as e:
        print(f"[Grabbit] Engine update failed: {e}")
    finally:
        now = datetime.now(timezone.utc).isoformat()
        with engine_state_lock:
            engine_state["version"]      = new_version
            engine_state["last_checked"] = now
            engine_state["update_in_progress"] = False
            if new_version and old_version and new_version != old_version:
                engine_state["last_updated"] = now

    changed = bool(new_version and old_version and new_version != old_version)
    if changed:
        print(f"[Grabbit] Engine updated: {old_version} -> {new_version}")
    return (changed, old_version, new_version)


def engine_update_loop():
    """Re-check for updates every 4 hours while the app is running."""
    while True:
        time.sleep(60 * 60 * 4)  # 4 hours
        try:
            update_engine()
        except Exception as e:
            print(f"[Grabbit] Periodic engine update failed: {e}")


# ─── PLATFORM ISSUE TRACKING ──────────────────────────────────────────────────
# Tracks consecutive extractor_broken errors per platform.
# If we hit the threshold or the engine update doesn't fix it, we mark the
# platform as "having issues" so the UI can warn the user.
_recent_failures = {}  # {platform_id: [timestamp, ...]} — last hour only
_recent_failures_lock = threading.Lock()
_FAILURE_THRESHOLD  = 3       # 3 failures = trigger update check
_FAILURE_WINDOW     = 60 * 60 # 1 hour

def _record_platform_failure(platform_id, error_code):
    """Record a failed download for heuristic detection of platform issues.
    Triggers an engine update check if too many recent failures."""
    if not platform_id or platform_id == "other":
        return
    now = time.time()
    with _recent_failures_lock:
        bucket = _recent_failures.setdefault(platform_id, [])
        # Drop entries older than the window
        bucket[:] = [t for t in bucket if now - t < _FAILURE_WINDOW]
        bucket.append(now)
        count = len(bucket)

    # Either an explicit extractor_broken error OR many failures in a row
    # → force an update check and mark the platform as troubled if no fix
    if error_code == "extractor_broken" or count >= _FAILURE_THRESHOLD:
        threading.Thread(
            target=_handle_platform_issue,
            args=(platform_id,),
            daemon=True,
        ).start()


def _handle_platform_issue(platform_id):
    """Called when we detect a platform might be broken. Tries to update the
    engine — if there's a new version, great. If not, mark it as a known issue
    so the UI can warn the user."""
    print(f"[Grabbit] Possible platform issue detected: {platform_id}")
    changed, old_v, new_v = update_engine(force=True)
    now = datetime.now(timezone.utc).isoformat()

    if changed:
        # Engine updated — clear any previous platform issue
        with engine_state_lock:
            engine_state["platform_issue"] = None
            engine_state["platform_issue_at"] = None
        print(f"[Grabbit] Engine updated ({old_v} -> {new_v}) — platform issue likely resolved")
    else:
        # No new version available — platform might be broken until upstream fixes it
        with engine_state_lock:
            engine_state["platform_issue"] = platform_id
            engine_state["platform_issue_at"] = now
        print(f"[Grabbit] No engine update available — marking {platform_id} as having issues")


def _clear_recent_failures(platform_id):
    """Call when a download for this platform succeeds — resets the counter."""
    if not platform_id:
        return
    with _recent_failures_lock:
        _recent_failures.pop(platform_id, None)
    # If this platform was marked as troubled and now works, clear it
    with engine_state_lock:
        if engine_state.get("platform_issue") == platform_id:
            engine_state["platform_issue"] = None
            engine_state["platform_issue_at"] = None

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

@app.route("/api/version")
def api_version():
    return jsonify({"version": APP_VERSION})

@app.route("/api/engine/status")
def api_engine_status():
    """Current state of the download engine (yt-dlp).
    Used by the frontend to show 'Platform has issues' warnings."""
    with engine_state_lock:
        return jsonify(dict(engine_state))

@app.route("/api/engine/check", methods=["POST"])
def api_engine_check():
    """Manual 'Check for updates now' from Settings."""
    def _run():
        update_engine(force=True)
    threading.Thread(target=_run, daemon=True).start()
    return jsonify({"ok": True, "checking": True})

# ─── ERROR LOG (dev) ──────────────────────────────────────────────────────────
@app.route("/errors")
def errors_page():
    return render_template("errors.html")

@app.route("/api/errors/log")
def api_errors_log():
    try:
        if ERROR_LOG_FILE.exists():
            with open(ERROR_LOG_FILE, "r", encoding="utf-8") as f:
                return jsonify(json.load(f) or [])
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify([])

@app.route("/api/errors/clear", methods=["POST"])
def api_errors_clear():
    try:
        if ERROR_LOG_FILE.exists():
            ERROR_LOG_FILE.unlink()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

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
            engine_state["version"]  = _get_ytdlp_version()
            engine_state["last_checked"] = datetime.now(timezone.utc).isoformat()
        else:
            startup_status["ytdlp"] = "updating"
            update_engine(force=True)  # force first check at startup
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

    try:
        if not DENO_PATH.exists():
            startup_status["deno"] = "installing"
            install_deno()
        startup_status["deno"] = "ok"
    except Exception as e:
        startup_status["deno"] = "error"
        print(f"[Grabbit] deno setup failed: {e}")

@app.route("/api/startup_status")
def api_startup_status():
    return jsonify(startup_status)

@app.route("/api/startup_ready")
def api_startup_ready():
    """Returns true only when both tools are installed and ready."""
    ready = (startup_status.get("ytdlp") == "ok" and
             startup_status.get("ffmpeg") == "ok" and
             startup_status.get("deno") in ("ok", "error"))  # deno error = non-blocking
    return jsonify({"ready": ready, "status": startup_status})

# ─── MAIN ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"\n{'-'*50}")
    print(f"  Grabbit running at:")
    print(f"  http://localhost:5000")
    print(f"  Downloads: {DOWNLOADS_DIR}")
    print(f"{'-'*50}\n")
    threading.Thread(target=auto_setup, daemon=True).start()
    threading.Thread(target=check_for_updates, daemon=True).start()
    threading.Thread(target=engine_update_loop, daemon=True).start()
    threading.Thread(target=watchlist_polling_loop, daemon=True).start()
    threading.Thread(target=_session_ping_loop, daemon=True).start()
    app.run(debug=False, port=5000)
else:
    # Imported by launcher.py (PyInstaller build)
    threading.Thread(target=auto_setup, daemon=True).start()
    threading.Thread(target=check_for_updates, daemon=True).start()
    threading.Thread(target=engine_update_loop, daemon=True).start()
    threading.Thread(target=watchlist_polling_loop, daemon=True).start()
    threading.Thread(target=_session_ping_loop, daemon=True).start()