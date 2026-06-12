"""
Deploy Kindled to PythonAnywhere via the REST API.

Usage:
    python deploy.py                    # upload all files
    python deploy.py --reload           # upload all files + reload web app
    python deploy.py --reload-only      # just reload the web app

Requires the PYTHONANYWHERE_API_KEY and PYTHONANYWHERE_USERNAME
environment variables, or edit them at the top of this file.
"""

import os
import sys
import json
import urllib.request
import urllib.error

API_KEY = "46bc4e6409353b1dfee5e7681c49adaf6caa3515"
USERNAME = "speakora"
REMOTE_BASE = f"/home/{USERNAME}/mysite"
DOMAIN = f"{USERNAME}.pythonanywhere.com"
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))


def api_url(*parts):
    return "https://www.pythonanywhere.com/api/v0/" + "/".join(parts)


def upload_file(local_path, remote_path):
    url = api_url("user", USERNAME, "files", "path", remote_path.lstrip("/"))
    with open(local_path, "rb") as f:
        data = f.read()

    boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="content"; filename="{os.path.basename(local_path)}"\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n"
    ).encode() + data + f"\r\n--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Token {API_KEY}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )

    try:
        r = urllib.request.urlopen(req)
        status = r.getcode()
        if status in (200, 201, 204):
            print(f"  OK  {remote_path}")
            return True
        else:
            print(f"  FAIL {remote_path} ({status})")
            return False
    except urllib.error.HTTPError as e:
        print(f"  FAIL {remote_path} ({e.code}: {e.read().decode()[:200]})")
        return False


def reload_webapp():
    url = api_url("user", USERNAME, "webapps", DOMAIN, "reload/")
    req = urllib.request.Request(url, method="POST")
    req.add_header("Authorization", f"Token {API_KEY}")
    try:
        r = urllib.request.urlopen(req)
        print(f"\nReloaded {DOMAIN}")
        return True
    except urllib.error.HTTPError as e:
        print(f"\nReload failed ({e.code}: {e.read().decode()[:200]})")
        return False


def get_file_list():
    exclude_dirs = {".venv", "__pycache__", ".git", ".mypy_cache", "staticfiles"}
    exclude_exts = {".pyc", ".pyo", ".sqlite3"}
    exclude_subpaths = {"static/css/input.css"}
    exclude_files = {"deploy.py", "README_MAKER.md", "AGENTS.md", "PROJECT_STATUS.md", "DESIGN-vercel.md", ".env", "package.json", "tailwind.config.js"}

    files = []
    for root, dirs, filenames in os.walk(PROJECT_DIR):
        dirs[:] = [d for d in dirs if d not in exclude_dirs]
        for f in filenames:
            if any(f.endswith(ext) for ext in exclude_exts):
                continue
            if f in exclude_files:
                continue
            if f.startswith('.'):
                continue
            rel = os.path.relpath(os.path.join(root, f), PROJECT_DIR)
            if rel in exclude_subpaths:
                continue
            full = os.path.join(root, f)
            files.append((full, rel))
    return files


def main():
    args = set(sys.argv[1:])

    if "--reload-only" in args:
        reload_webapp()
        return

    files = get_file_list()
    print(f"Uploading {len(files)} files to {USERNAME}.pythonanywhere.com...\n")

    errors = 0
    for i, (local_path, rel_path) in enumerate(files):
        remote_path = f"{REMOTE_BASE}/{rel_path}"
        if not upload_file(local_path, remote_path):
            errors += 1
        if i % 10 == 9:
            import time; time.sleep(1)

    print(f"\nDone. {len(files) - errors} uploaded, {errors} failed.")

    if "--reload" in args:
        reload_webapp()


if __name__ == "__main__":
    main()
