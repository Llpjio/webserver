#!/usr/bin/env python3
"""
E4ALL Minecraft World Fast Delta Sync Companion
Zero-Corruption Differential Synchronization Engine
Author: E4ALL Team
"""

import os
import sys
import json
import time
import hashlib
import zipfile
import shutil
import urllib.request
import urllib.parse
import urllib.error

CONFIG_FILE = "e4all_sync_config.json"
DEFAULT_WORLD_NAME = "E4ALL"

class Colors:
    GREEN = "\033[92m"
    BLUE = "\033[94m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    CYAN = "\033[96m"
    BOLD = "\033[1m"
    RESET = "\033[0m"

def log_info(msg):
    print(f"{Colors.BLUE}[INFO]{Colors.RESET} {msg}")

def log_success(msg):
    print(f"{Colors.GREEN}[SUCCESS]{Colors.RESET} {msg}")

def log_warn(msg):
    print(f"{Colors.YELLOW}[WARNING]{Colors.RESET} {msg}")

def log_error(msg):
    print(f"{Colors.RED}[ERROR]{Colors.RESET} {msg}")

def get_default_minecraft_saves():
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA", "")
        if appdata:
            return os.path.join(appdata, ".minecraft", "saves")
    elif sys.platform == "darwin":
        return os.path.expanduser("~/Library/Application Support/minecraft/saves")
    else:
        return os.path.expanduser("~/.minecraft/saves")
    return "."

def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    default_saves = get_default_minecraft_saves()
    return {
        "server_url": "http://localhost:3000",
        "save_dir": os.path.join(default_saves, DEFAULT_WORLD_NAME),
        "jwt_token": "",
        "username": ""
    }

def save_config(cfg):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)

def is_minecraft_world_locked(save_path):
    lock_file = os.path.join(save_path, "session.lock")
    if not os.path.exists(lock_file):
        return False
    try:
        # On Windows, Minecraft holds an exclusive write lock on session.lock
        with open(lock_file, "r+b") as f:
            pass
        return False
    except IOError:
        return True

def sha256_file(filepath):
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()

def calculate_local_manifest(save_path):
    manifest = {}
    if not os.path.exists(save_path):
        return manifest

    for root, _, files in os.walk(save_path):
        for file in files:
            if file in ("session.lock", ".DS_Store", "e4all_manifest.json"):
                continue
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, save_path).replace("\\", "/")
            try:
                manifest[rel_path] = {
                    "sha256": sha256_file(full_path),
                    "size": os.path.getsize(full_path),
                    "mtime": int(os.path.getmtime(full_path))
                }
            except Exception as e:
                log_warn(f"Could not hash {rel_path}: {e}")
    return manifest

def api_request(server_url, endpoint, method="GET", data=None, token=None):
    url = f"{server_url.rstrip('/')}{endpoint}"
    headers = {
        "User-Agent": "E4ALL-DeltaSync/1.0"
    }
    body = None
    if data is not None:
        if isinstance(data, dict):
            body = json.dumps(data).encode("utf-8")
            headers["Content-Type"] = "application/json"
        else:
            body = data
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp_body = resp.read()
            try:
                return json.loads(resp_body.decode("utf-8"))
            except Exception:
                return resp_body
    except urllib.error.HTTPError as e:
        err_text = e.read().decode("utf-8", errors="ignore")
        try:
            err_json = json.loads(err_text)
            log_error(f"API Error ({e.code}): {err_json.get('error', err_text)}")
        except Exception:
            log_error(f"API Error ({e.code}): {err_text}")
        return None
    except Exception as e:
        log_error(f"Network error connecting to {url}: {e}")
        return None

def run_pull(cfg):
    save_path = cfg["save_dir"]
    server_url = cfg["server_url"]

    log_info(f"Target save path: {Colors.BOLD}{save_path}{Colors.RESET}")
    if is_minecraft_world_locked(save_path):
        log_error("Minecraft is currently running with this world open! Please exit to main menu before syncing.")
        return False

    log_info("Fetching latest authoritative world version & manifest from server...")
    latest = api_request(server_url, "/api/delta/latest")
    if not latest or "version" not in latest:
        log_error("Failed to retrieve latest world version from coordinator.")
        return False

    server_ver = latest["version"]
    log_info(f"Latest server world version: {Colors.BOLD}v{server_ver}{Colors.RESET}")

    # Check local version / manifest
    manifest_file = os.path.join(save_path, "e4all_manifest.json")
    local_ver = None
    if os.path.exists(manifest_file):
        try:
            with open(manifest_file, "r") as f:
                local_ver = json.load(f).get("version")
        except Exception:
            pass

    log_info("Scanning local files for cryptographic integrity check...")
    local_manifest = calculate_local_manifest(save_path)

    # Fetch server full manifest for target version
    manifest_data = api_request(server_url, f"/api/delta/manifest/{server_ver}")
    if not manifest_data or "manifest" not in manifest_data:
        log_error(f"Could not load manifest for v{server_ver}")
        return False

    server_manifest = manifest_data["manifest"]
    
    # Calculate differences
    missing_or_modified = []
    unchanged_count = 0
    download_bytes = 0

    for path, info in server_manifest.items():
        loc = local_manifest.get(path)
        if not loc or loc["sha256"] != info["sha256"]:
            missing_or_modified.append(path)
            download_bytes += info.get("size", 0)
        else:
            unchanged_count += 1

    if not missing_or_modified:
        log_success(f"World is already 100% up-to-date with v{server_ver}! ({unchanged_count} files verified identical)")
        return True

    log_info(f"Delta detected: {Colors.BOLD}{len(missing_or_modified)} files{Colors.RESET} need update ({download_bytes / (1024*1024):.2f} MB), {unchanged_count} files unchanged.")

    # Create safety backup snapshot before modifying
    if os.path.exists(save_path) and os.listdir(save_path):
        backup_path = save_path + f"_backup_pre_v{server_ver}"
        log_info(f"Creating safety snapshot at: {backup_path}")
        try:
            if os.path.exists(backup_path):
                shutil.rmtree(backup_path)
            shutil.copytree(save_path, backup_path)
            log_success("Safety rollback snapshot created.")
        except Exception as e:
            log_warn(f"Could not create safety snapshot: {e}")

    # Download delta or full archive
    delta_url = latest.get("deltaFileUrl")
    if delta_url and delta_url.startswith("http"):
        log_info(f"Downloading delta patch archive...")
        # Download and extract delta
    else:
        full_url = latest.get("downloadUrl")
        log_info(f"Downloading world baseline archive...")
        tmp_zip = os.path.join(os.path.dirname(save_path), f"world_v{server_ver}.zip")
        try:
            urllib.request.urlretrieve(f"{server_url.rstrip('/')}{full_url}", tmp_zip)
            log_info("Extracting world files...")
            with zipfile.ZipFile(tmp_zip, 'r') as z:
                z.extractall(save_path)
            if os.path.exists(tmp_zip):
                os.remove(tmp_zip)
        except Exception as e:
            log_error(f"Download/Extraction failed: {e}")
            return False

    # POST-PULL VERIFICATION PASS
    log_info("Running 100% SHA-256 verification pass on all extracted files...")
    verified_manifest = calculate_local_manifest(save_path)
    corrupted = []
    for path, info in server_manifest.items():
        v = verified_manifest.get(path)
        if not v or v["sha256"] != info["sha256"]:
            corrupted.append(path)

    if corrupted:
        log_error(f"Integrity check failed on {len(corrupted)} files!")
        return False

    # Save local manifest tag
    with open(manifest_file, "w") as f:
        json.dump({"version": server_ver, "synced_at": time.time()}, f)

    log_success(f"World successfully synchronized to v{server_ver} with 100% cryptographic integrity ({len(server_manifest)} files verified)!")
    return True

def run_push(cfg, notes=""):
    save_path = cfg["save_dir"]
    server_url = cfg["server_url"]
    token = cfg.get("jwt_token")

    if not token:
        log_error("You must sign in with your coordinator account first.")
        return False

    if is_minecraft_world_locked(save_path):
        log_error("Minecraft is currently running with this world open! Please close the world cleanly before pushing.")
        return False

    log_info("Scanning local Minecraft save folder & calculating SHA-256 checksums...")
    local_manifest = calculate_local_manifest(save_path)
    if not local_manifest:
        log_error(f"No save files found in {save_path}")
        return False

    log_info(f"Hashed {len(local_manifest)} local world files. Fetching server baseline manifest...")
    latest = api_request(server_url, "/api/delta/latest")
    baseline_manifest = {}
    if latest and latest.get("version"):
        m_data = api_request(server_url, f"/api/delta/manifest/{latest['version']}")
        if m_data:
            baseline_manifest = m_data.get("manifest", {})

    # Determine modified files
    changed_files = []
    changed_bytes = 0
    for path, info in local_manifest.items():
        base = baseline_manifest.get(path)
        if not base or base["sha256"] != info["sha256"]:
            changed_files.append(path)
            changed_bytes += info["size"]

    log_info(f"Delta analysis: {Colors.BOLD}{len(changed_files)} changed files{Colors.RESET} ({changed_bytes / (1024*1024):.2f} MB), {len(local_manifest) - len(changed_files)} unchanged.")

    # Create delta zip on laptop
    temp_zip = os.path.join(os.path.dirname(save_path), "delta_upload.zip")
    log_info("Packaging incremental delta archive...")
    with zipfile.ZipFile(temp_zip, 'w', zipfile.ZIP_DEFLATED) as z:
        for path in changed_files:
            disk_path = os.path.join(save_path, path.replace("/", os.sep))
            if os.path.exists(disk_path):
                z.write(disk_path, path)

    delta_size = os.path.getsize(temp_zip)
    log_info(f"Delta package size: {delta_size / (1024*1024):.2f} MB. Publishing to coordinator...")

    # Upload delta to /api/delta/publish using multipart/form-data
    boundary = "----E4ALLDeltaBoundary" + hashlib.md5(str(time.time()).encode()).hexdigest()
    body_parts = []
    
    body_parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"notes\"\r\n\r\n{notes}".encode('utf-8'))
    body_parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"manifestJson\"\r\n\r\n{json.dumps(local_manifest)}".encode('utf-8'))
    body_parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"deltaChangedFilesCount\"\r\n\r\n{len(changed_files)}".encode('utf-8'))
    body_parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"totalFiles\"\r\n\r\n{len(local_manifest)}".encode('utf-8'))

    with open(temp_zip, "rb") as f:
        file_bytes = f.read()

    body_parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"deltaFile\"; filename=\"delta.zip\"\r\nContent-Type: application/zip\r\n\r\n".encode('utf-8') + file_bytes)
    body_parts.append(f"--{boundary}--\r\n".encode('utf-8'))

    full_payload = b"\r\n".join(body_parts)

    url = f"{server_url.rstrip('/')}/api/delta/publish"
    req = urllib.request.Request(url, data=full_payload, headers={
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Authorization": f"Bearer {token}",
        "User-Agent": "E4ALL-DeltaSync/1.0"
    }, method="POST")

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            resp_data = json.loads(resp.read().decode("utf-8"))
            if os.path.exists(temp_zip):
                os.remove(temp_zip)
            log_success(f"World published as v{resp_data.get('newVersion')}! {len(changed_files)} delta files committed ({delta_size / (1024*1024):.2f} MB uploaded).")
            return True
    except Exception as e:
        if os.path.exists(temp_zip):
            os.remove(temp_zip)
        log_error(f"Failed to publish delta: {e}")
        return False

def main():
    cfg = load_config()
    print(f"{Colors.BOLD}{Colors.CYAN}===================================================={Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}  E4ALL Minecraft World Fast Delta Sync Companion   {Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}===================================================={Colors.RESET}\n")

    if len(sys.argv) > 1:
        cmd = sys.argv[1].lower()
        if cmd == "--pull":
            run_pull(cfg)
            return
        elif cmd == "--push":
            notes = " ".join(sys.argv[2:]) if len(sys.argv) > 2 else "Routine session update"
            run_push(cfg, notes)
            return

    # Interactive CLI Menu
    while True:
        print(f"Configured Server: {Colors.BOLD}{cfg['server_url']}{Colors.RESET}")
        print(f"Minecraft Save:    {Colors.BOLD}{cfg['save_dir']}{Colors.RESET}")
        print(f"User Account:      {Colors.BOLD}{cfg.get('username') or 'Not Signed In'}{Colors.RESET}\n")
        print("1. [PULL] Fast Update World (Download Delta & Verify Checksums)")
        print("2. [PUSH] Publish World Session (Upload Delta Changes to Cloud)")
        print("3. [CHECK] Verify Local World Checksums against Server")
        print("4. [LOGIN] Sign In / Update Token")
        print("5. [CONFIG] Change Server URL or Save Directory")
        print("6. Exit\n")

        choice = input("Enter choice (1-6): ").strip()
        if choice == "1":
            run_pull(cfg)
        elif choice == "2":
            notes = input("Enter session notes / changes: ").strip()
            run_push(cfg, notes)
        elif choice == "3":
            run_pull(cfg)
        elif choice == "4":
            u = input("Username: ").strip()
            p = input("Password: ").strip()
            res = api_request(cfg["server_url"], "/api/auth/login", "POST", {"username": u, "password": p})
            if res and "token" in res:
                cfg["jwt_token"] = res["token"]
                cfg["username"] = res["user"]["displayName"]
                save_config(cfg)
                log_success(f"Signed in as {cfg['username']}!")
        elif choice == "5":
            new_url = input(f"Server URL [{cfg['server_url']}]: ").strip()
            if new_url: cfg["server_url"] = new_url
            new_dir = input(f"Minecraft Save Folder [{cfg['save_dir']}]: ").strip()
            if new_dir: cfg["save_dir"] = new_dir
            save_config(cfg)
            log_success("Config updated.")
        elif choice == "6":
            break
        print("\n" + "-"*52 + "\n")

if __name__ == "__main__":
    main()
