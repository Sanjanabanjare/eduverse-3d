# Deploying EduVerse 3D on Render — step by step

## Before you start

- Push this project to a GitHub repo (the `.gitignore` already keeps `.env`,
  the data store, uploads, and backups out of git).
- You need a Render account. The persistent disk below needs a paid instance
  (Starter, ~$7/month). Without the disk, every deploy wipes your database.

## 1. Create the service from the blueprint

1. Render dashboard → **New → Blueprint** → connect the repo.
2. Render reads `render.yaml` and shows one Web Service: `eduverse-3d`.
3. Click **Apply**. Render generates `JWT_SECRET` and
   `EDUVERSE_ADMIN_SETUP_CODE` for you.

## 2. Set your real URL

1. After the first deploy, Render gives you an address like
   `https://eduverse-3d.onrender.com`.
2. Dashboard → the service → **Environment** → set `APP_BASE_URL` to that
   exact address (or your custom domain, once you add one).
3. Save — the service restarts automatically.

## 3. Create the first admin

1. Open your site → **Set up admin** (or go to `/api/auth/setup-admin`).
2. Use the **setup code** Render generated (dashboard → Environment →
   `EDUVERSE_ADMIN_SETUP_CODE` → click the eye icon to reveal it).
3. The demo OTP is any 4–8 digit number (for example `1234`).
4. That admin account creates teacher and student accounts from the
   admin dashboard. **Do not share the setup code with anyone.**

## 4. Check it is healthy

- `https://<your-url>/api/health` should return
  `{"ok":true,"service":"eduverse-learning-api"}`.
- `npm run check:prod` on your own machine catches missing production
  variables before you deploy.

## 5. Backups

- The data file lives on the persistent disk at `backend/data/store.json`
  (see `render.yaml`). It survives deploys and restarts.
- Still take backups: download one from the admin dashboard
  (**Backup & restore**) once a week, or run `scripts/backup.sh` if you
  also run the app locally. Keep a copy off Render.
- If you ever need to restore: stop the service, copy the backup over
  `backend/data/store.json` (via the Render Shell), start again.

## What Render gives you for free, and what it doesn't

- **HTTPS and PORT**: automatic. Don't set them yourself.
- **Free tier sleeps**: on the free instance type the service spins down
  after inactivity, so the first visit after a while takes ~30–60 seconds
  to wake up. Starter doesn't sleep.
- **Uploads vanish on redeploy**: files in `backend/uploads/` are not on
  the disk. Set the `S3_*` variables to keep uploads permanently, or accept
  losing them on the next deploy.
- **One server only**: sessions now survive restarts (they're in the data
  file), but the app runs as a single process — it can't scale sideways yet.
- **Vision Lab**: the webcam handwriting lab needs a local Python service
  (`.venv-mediapipe`) that Render doesn't have. The app still runs; that one
  experiment will report the service as unavailable.

## When something goes wrong

- **Deploy fails**: check the deploy logs in the dashboard; the most common
  cause is a missing `package-lock.json` (it's in the repo — don't delete it).
- **"Application failed to respond"**: the service didn't bind to Render's
  `PORT` — check the logs for the startup error (usually a missing
  `JWT_SECRET` or `APP_BASE_URL` in production).
- **Login stops working after a deploy**: the data disk wasn't attached —
  check the service's **Disks** tab.
