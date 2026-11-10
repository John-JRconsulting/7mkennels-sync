// Publish Katy's 7mkennels site to Vercel when her GitHub repo gets a new commit.
//
// Vercel can't watch the repo itself (it is on her personal GitHub account, and only the owner can connect those),
// so a Vercel cron calls this every 5 minutes.  It reads the head of main from GitHub, asks Vercel which commit is
// live, and when main has moved it uploads public/ plus deployed.json (the commit that is live, for her Claude to
// check).  Remove in January 2027, when the site moves to her own Cloudflare account.
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const REPO = "7mkennels/website";
const TEAM_ID = "team_X9H1EAQVFsgkIXstR5jwuIQH";
const PROJECT_ID = "prj_VEtUWDz5NsxdZIX6AOIYvK4seFhj";
const API = "https://api.vercel.com";

async function call(method, path, body, headers = {}) {
  const url = API + path + (path.includes("?") ? "&" : "?") + "teamId=" + TEAM_ID;
  const h = { Authorization: "Bearer " + process.env.VERCEL_TOKEN, ...headers };
  if (body && !(body instanceof Buffer)) { body = JSON.stringify(body); h["Content-Type"] = "application/json"; }
  const r = await fetch(url, { method, headers: h, body });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

// The head of main from git's own ref listing, which has no API rate limit.
async function headOfMain() {
  const r = await fetch(`https://github.com/${REPO}.git/info/refs?service=git-upload-pack`);
  const m = (await r.text()).match(/([0-9a-f]{40}) refs\/heads\/main/);
  if (!m) throw new Error("main not found in " + REPO);
  return m[1];
}

// The files under public/ in a GitHub tarball, as [path relative to the repo, contents].
function publicFiles(tgz) {
  const tar = gunzipSync(tgz);
  const files = [];
  let longName = null;
  for (let off = 0; off + 512 <= tar.length;) {
    const head = tar.subarray(off, off + 512);
    if (head.every((b) => b === 0)) break;
    const str = (a, b) => head.subarray(a, b).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(str(124, 136).trim() || "0", 8);
    const type = String.fromCharCode(head[156]);
    const data = tar.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") { const m = data.toString("utf8").match(/\d+ path=([^\n]+)\n/); longName = m ? m[1] : null; continue; }
    if (type === "g") continue;
    const prefix = str(345, 500);
    const name = longName ?? (prefix ? prefix + "/" + str(0, 100) : str(0, 100));
    longName = null;
    if (type !== "0" && type !== "\0") continue;
    const path = name.split("/").slice(1).join("/");   // drop the "<owner>-<repo>-<sha>/" top folder
    if (path.startsWith("public/")) files.push([path, Buffer.from(data)]);
  }
  return files;
}

async function upload(data, path, files) {
  const sha = createHash("sha1").update(data).digest("hex");
  await call("POST", "/v2/files", data, { "Content-Type": "application/octet-stream", "x-vercel-digest": sha, "Content-Length": String(data.length) });
  files.push({ file: path, sha, size: data.length });
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).end();
  try {
    const remote = await headOfMain();
    // The newest production deployment in any state, so a run that starts while the last one is still building
    // does not publish the same commit twice.
    const latest = (await call("GET", `/v6/deployments?projectId=${PROJECT_ID}&target=production&limit=1`)).deployments?.[0];
    if (latest?.meta?.githubCommitSha === remote && latest.state !== "ERROR" && latest.state !== "CANCELED") {
      return res.json({ live: remote.slice(0, 7), state: latest.state });
    }

    const tgz = Buffer.from(await (await fetch(`https://codeload.github.com/${REPO}/tar.gz/${remote}`)).arrayBuffer());
    const commit = await fetch(`https://api.github.com/repos/${REPO}/commits/${remote}`, { headers: { "User-Agent": "7mkennels-sync" } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const message = (commit?.commit?.message ?? "").split("\n")[0];

    const files = [];
    for (const [path, data] of publicFiles(tgz)) await upload(data, path, files);
    const stamp = { commit: remote, message, published: new Date().toISOString().replace(/\.\d+Z$/, "Z") };
    await upload(Buffer.from(JSON.stringify(stamp, null, 1)), "public/deployed.json", files);

    const dep = await call("POST", "/v13/deployments?skipAutoDetectionConfirmation=1", {
      name: "7mkennels", project: PROJECT_ID, target: "production", files,
      projectSettings: { framework: null, buildCommand: null, outputDirectory: "public" },
      meta: { githubCommitSha: remote, githubCommitMessage: message.slice(0, 200) },
    });
    console.log("published", remote.slice(0, 7), dep.id, files.length, "files", message);
    return res.json({ published: remote.slice(0, 7), deployment: dep.id, files: files.length, message });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message ?? e) });
  }
}
