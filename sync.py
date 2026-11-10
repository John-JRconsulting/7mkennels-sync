"""Publish Katy's 7mkennels site to Vercel when her GitHub repo gets a new commit.

Vercel can't watch the repo itself (it is on her personal GitHub account, and
only the owner can connect those), so a scheduled GitHub Action runs this.  It
asks Vercel which commit is live, and when main has moved it uploads public/
plus deployed.json (the commit that is live, for her Claude to check).
Remove in January 2027, when the site moves to her own Cloudflare account.
"""
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

REPO_URL = "https://github.com/7mkennels/website.git"
REPO_DIR = "site"
TEAM_ID = "team_X9H1EAQVFsgkIXstR5jwuIQH"
PROJECT_ID = "prj_VEtUWDz5NsxdZIX6AOIYvK4seFhj"
API = "https://api.vercel.com"
TOKEN = os.environ["VERCEL_TOKEN"]


def git(*args):
    return subprocess.check_output(["git"] + list(args), text=True).strip()


def call(method, path, body=None, headers=None):
    url = API + path + ("&" if "?" in path else "?") + "teamId=" + TEAM_ID
    h = {"Authorization": "Bearer " + TOKEN}
    h.update(headers or {})
    if isinstance(body, dict):
        body = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or b"{}")


def upload(data, path, files):
    sha = hashlib.sha1(data).hexdigest()
    call("POST", "/v2/files", data, {"Content-Type": "application/octet-stream",
                                     "x-vercel-digest": sha, "Content-Length": str(len(data))})
    files.append({"file": path, "sha": sha, "size": len(data)})


def main():
    remote = git("ls-remote", REPO_URL, "refs/heads/main").split()[0]
    live = call("GET", "/v6/deployments?projectId=%s&target=production&state=READY&limit=1" % PROJECT_ID)
    live_sha = ((live.get("deployments") or [{}])[0].get("meta") or {}).get("githubCommitSha")
    if remote == live_sha:
        print("Live:", remote[:7])
        return

    git("clone", "--quiet", REPO_URL, REPO_DIR)
    git("-C", REPO_DIR, "checkout", "--quiet", remote)
    msg = git("-C", REPO_DIR, "log", "-1", "--format=%s")

    files = []
    root = os.path.join(REPO_DIR, "public")
    for dirpath, _, names in os.walk(root):
        for name in names:
            full = os.path.join(dirpath, name)
            upload(open(full, "rb").read(), os.path.relpath(full, REPO_DIR), files)
    stamp = {"commit": remote, "message": msg, "published": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    upload(json.dumps(stamp, indent=1).encode(), "public/deployed.json", files)

    dep = call("POST", "/v13/deployments?skipAutoDetectionConfirmation=1", {
        "name": "7mkennels", "project": PROJECT_ID, "target": "production", "files": files,
        "projectSettings": {"framework": None, "buildCommand": None, "outputDirectory": "public"},
        "meta": {"githubCommitSha": remote, "githubCommitMessage": msg[:200]},
    })
    state = None
    for _ in range(36):
        state = call("GET", "/v13/deployments/" + dep["id"]).get("readyState")
        if state in ("READY", "ERROR", "CANCELED"):
            break
        time.sleep(5)
    print(remote[:7], state, dep["id"], "(%d files)" % len(files), msg)
    if state != "READY":
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read()[:300])
        sys.exit(1)
