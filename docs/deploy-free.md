# Free Deployment Guide

This project is easiest to publish with:

- frontend: Vercel
- backend: Render

## 1. Deploy the API to Render

Use the root file:
- [render.yaml](/C:/Users/aryaf/OneDrive/Documents/Codex/render.yaml)

Steps:

1. Push this repo to GitHub.
2. Open Render.
3. Click `New +` -> `Blueprint`.
4. Select your GitHub repo.
5. Render will detect [render.yaml](/C:/Users/aryaf/OneDrive/Documents/Codex/render.yaml).
6. Create the service.

Render service details:

- root directory: `apps/api`
- build command: `npm install && npm run install:browsers && npm run build`
- start command: `npm run start`
- health check: `/analysis/catalog`

Environment variables:

- `PORT=4000` is optional on Render because Render usually injects `PORT`

Important note:

- This backend uses Playwright and Instagram scraping.
- On free hosting, scraping can be slower and less reliable than local runs.
- If Instagram blocks the Render server IP, the dashboard may still work, but live collection can become partial.

## 2. Deploy the frontend to Vercel

Use the app config:
- [vercel.json](/C:/Users/aryaf/OneDrive/Documents/Codex/apps/web/vercel.json)

Steps:

1. Open Vercel.
2. Import the same GitHub repo.
3. Set the project root directory to `apps/web`.
4. Add this environment variable:
   - `NEXT_PUBLIC_API_URL=https://your-render-service.onrender.com`
5. Deploy.

You can copy the variable name from:
- [apps/web/.env.example](/C:/Users/aryaf/OneDrive/Documents/Codex/apps/web/.env.example)

## 3. Final check

After both are deployed:

1. Open the Render API URL and check:
   - `/analysis/catalog`
2. Open the Vercel frontend URL.
3. Run a known brand first, such as:
   - `The Whole Truth`
   - `Mamaearth`

## 4. Fastest no-hassle path

If you only need a demo quickly:

- deploy frontend to Vercel
- deploy backend to Render
- use smaller runs first, like:
  - competitors: `3-5`
  - collection cap: `20-40`

This makes the live dashboard feel much faster on free hosting.

## 5. Known limitation

Free cloud hosting is good for demos, but not perfect for Instagram scraping.

If the API becomes unstable in cloud:

- keep the frontend on Vercel
- run the API locally on your laptop
- set `NEXT_PUBLIC_API_URL` to your local/public tunnel backend for demo use

That is the most reliable low-cost fallback.
