// Blanton's Install QC — review engine (Render worker).
//
// Flow: the Install QC app uploads a job's zip here (POST /jobs, multipart:
// field "zip", field "job", header "x-upload-key"). We answer 202 immediately,
// then in the background: unzip -> ffmpeg frames+audio -> Claude review against
// the NC residential checklist -> build the standardized report -> POST it back
// to the hub's qc-submit endpoint. The hub shows the finished report on the job.
//
// Env (set these in Render):
//   ANTHROPIC_API_KEY   your Claude API key
//   ANTHROPIC_MODEL     vision model to use (default claude-sonnet-4-5 — set to your current one)
//   QC_SUBMIT_KEY       must match the hub's QC_SUBMIT_KEY (so the hub accepts our post)
//   HUB_SUBMIT_URL      https://qcinstall.netlify.app/.netlify/functions/qc-submit
//   UPLOAD_KEY          shared secret the app sends as x-upload-key (so only the app can upload)
//   FRAME_FPS           frames per second to sample from video (default 0.5)
//   MAX_IMAGES          cap images sent to Claude to control cost (default 42)
//   PORT                provided by Render automatically

import express from "express";
import multer from "multer";
import os from "os";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { reviewJob } from "./review.js";

// Verify the short-lived upload token the hub minted (HMAC with the shared
// QC_UPLOAD_SECRET). Returns the token's job number, or null if invalid/expired.
function verifyUploadToken(token) {
  const secret = process.env.QC_UPLOAD_SECRET;
  if (!secret || !token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot), sig = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try { const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); if (!c || c.exp <= Date.now()) return null; return String(c.job || ""); }
  catch { return null; }
}

const app = express();
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 600 * 1024 * 1024 } });

// CORS so the hub (different origin) can upload.
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-Upload-Token");
  res.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/", (_req, res) => res.json({ ok: true, service: "blantons-qc-engine", ready: !!process.env.ANTHROPIC_API_KEY }));
app.get("/healthz", (_req, res) => res.send("ok"));

app.post("/jobs", upload.single("zip"), async (req, res) => {
  const job = String((req.body && req.body.job) || "").trim();
  // Auth: only the hub (holding a valid, unexpired signed token for THIS job) may submit.
  const tokenJob = verifyUploadToken(req.get("x-upload-token"));
  if (!tokenJob || tokenJob !== job) { cleanup(req.file); return res.status(401).json({ error: "unauthorized" }); }

  if (!/^\d{4,}$/.test(job)) { cleanup(req.file); return res.status(400).json({ error: "bad_job", message: "numeric job number required" }); }
  if (!req.file) return res.status(400).json({ error: "no_zip" });
  if (!process.env.ANTHROPIC_API_KEY) { cleanup(req.file); return res.status(500).json({ error: "engine_not_configured", message: "ANTHROPIC_API_KEY missing" }); }

  const zipPath = req.file.path;
  const name = (req.body && req.body.name) || req.file.originalname || "job.zip";
  const note = String((req.body && req.body.note) || "").slice(0, 600); // per-job critical info
  // Answer now; do the heavy work in the background.
  res.status(202).json({ ok: true, job, status: "Reviewing", message: "Review started; the report will post to the hub when it finishes." });

  reviewJob({ job, zipPath, name, note })
    .then((r) => console.log(`[job ${job}] done -> ${r && r.status}`))
    .catch((e) => console.error(`[job ${job}] FAILED:`, e && (e.stack || e.message || e)))
    .finally(() => { try { fs.rmSync(zipPath, { force: true }); } catch {} });
});

function cleanup(file) { if (file && file.path) { try { fs.rmSync(file.path, { force: true }); } catch {} } }

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`QC engine listening on :${PORT}`));
