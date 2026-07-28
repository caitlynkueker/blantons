# Blanton's Install QC — Review Engine

This is the worker that makes **drop-a-zip = automatic report** real. The Install QC
app uploads a job's zip here; this service extracts frames + audio, has Claude review
the install against the NC residential checklist, builds the standardized report, and
posts it back onto the job in the hub.

You host this on **Render** (managed, always-on). Two secrets you provide: a **Claude
API key** and a couple of shared passwords. Below is the whole setup, click by click.

---

## What you need
- A **Render** account (render.com) — free to sign up.
- A **Claude API key** with billing — from console.anthropic.com → API keys.
- Your Install QC hub is already live at `qcinstall.netlify.app`.

## Cost
- Render **Starter** instance ≈ **$7/month** (always on). *(A free instance also works but sleeps between jobs and cold-starts slowly.)*
- Claude API: **roughly a few dollars per job** — it's reading all the photos + video frames. Lower `FRAME_FPS` or `MAX_IMAGES` to spend less.

---

## Step 1 — Put this folder in a GitHub repo
Render deploys from a Git repo.
1. Create a new **private** GitHub repo, e.g. `blantons-qc-engine`.
2. Push the contents of this folder to it (the folder already has everything, including the `Dockerfile`).

## Step 2 — Pick two shared secrets
Generate two random strings (in a terminal: `openssl rand -hex 24` twice), and label them:
- **QC_SUBMIT_KEY** — lets the engine post reports to the hub.
- **QC_UPLOAD_SECRET** — signs the app's upload tokens.

Keep both handy; they go on **both** the engine and the hub, and must match exactly.

## Step 3 — Create the Render service
1. Render dashboard → **New +** → **Web Service** → connect your `blantons-qc-engine` repo.
2. Render detects the `Dockerfile` — runtime **Docker**. Instance type **Starter**.
3. Under **Environment**, add these variables:

   | Key | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | your Claude API key |
   | `ANTHROPIC_MODEL` | your current vision model (e.g. `claude-sonnet-4-5`) |
   | `QC_SUBMIT_KEY` | the first secret from Step 2 |
   | `QC_UPLOAD_SECRET` | the second secret from Step 2 |
   | `HUB_SUBMIT_URL` | `https://qcinstall.netlify.app/.netlify/functions/qc-submit` |

4. **Create Web Service.** When it finishes, copy the service URL — e.g. `https://blantons-qc-engine.onrender.com`.
5. Sanity check: open that URL in a browser. You should see `{"ok":true,"service":"blantons-qc-engine","ready":true}`. If `ready` is false, the API key isn't set.

## Step 4 — Point the hub at the engine
On the **hub** site (Netlify → `qcinstall` → Site configuration → Environment variables), add:

| Key | Value |
|---|---|
| `QC_ENGINE_URL` | your Render URL from Step 3 (e.g. `https://blantons-qc-engine.onrender.com`) |
| `QC_UPLOAD_SECRET` | **same** value as on the engine |
| `QC_SUBMIT_KEY` | **same** value as on the engine |

Then redeploy the hub:
```
bash ~/Downloads/deploy-qc.sh
```

## Step 5 — Try it
Open the Install QC app → drag a job's zip into the box → type the job number → **Queue for review**.
You'll see "uploaded — the review is running." In a minute or two the row flips from
**Queued for AI review** to **Ready for Manager Review** (or **Technical Review Required**),
and clicking it opens the full report. Done — no other steps.

---

## Tuning
- **Cheaper / faster:** lower `MAX_IMAGES` (e.g. 30) and `FRAME_FPS` (e.g. 0.25).
- **More thorough:** raise them. `FRAME_FPS=1` samples a frame every second.
- **Model:** set `ANTHROPIC_MODEL` to whichever current Claude vision model you prefer.

## How the guardrails carry over
The engine uses the exact QC skill rules: it never approves a job, routes electrical/gas/
uncertain items to a qualified person, never invents a code citation (writes "Source not
verified" instead), and honors the crawlspace aux-pan exception. Every report ends with the
manager-decision line. The manager still makes the final call.

## Troubleshooting
- **Report never appears:** open the Render service **Logs**. `hub rejected post: HTTP 401` = `QC_SUBMIT_KEY` doesn't match between engine and hub. `unauthorized` on upload = `QC_UPLOAD_SECRET` mismatch.
- **`engine_not_configured`:** `ANTHROPIC_API_KEY` isn't set on Render.
- **Out of memory on huge videos:** bump the Render instance from Starter to Standard.
