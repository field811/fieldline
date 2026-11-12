# Pulse

Daily **recovery**, **strain** and **sleep** scores from your Apple Health data, in the style of a fitness band app. It's a web app (PWA) hosted free on GitHub Pages and added to your iPhone home screen.

**Your health data never leaves your phone.** GitHub only hosts the app's code. The Health export is read inside the browser and the results are saved on the device.

## Why a web app and not the App Store?

Apple only lets *native* iOS apps read HealthKit live, and those need a Mac, Xcode and a paid Apple developer account ($99 USD/yr). A web app can't read Health directly, so Pulse reads the **Export All Health Data** file instead. That's a few taps every few days, works from Windows, and costs nothing.

## Using it on your iPhone

1. Open your GitHub Pages link (below) in **Safari**.
2. Tap **Share → Add to Home Screen**. It now opens full screen like an app.
3. In the **Health** app: profile picture → **Export All Health Data** → **Save to Files**.
4. In Pulse: **Settings → Choose export.zip**.

Re-export and re-import whenever you want fresh numbers. New days are merged in.

Best results: wear an Apple Watch to bed with Sleep tracking on, so it records HRV, resting heart rate, breathing rate and sleep stages.

## What the scores mean

| Score | Built from |
| --- | --- |
| **Recovery** (1–99%) | Last night's HRV and resting heart rate compared with your own 30-day baseline, plus sleep performance and breathing rate. Green 67+, yellow 34–66, red under 34. |
| **Strain** (0–21) | Banister TRIMP: minutes with heart rate above ~30% of reserve, weighted harder for higher intensity, on a curve that flattens near 21. |
| **Sleep** (%) | Time asleep ÷ sleep need. Need = your base (default 8 h) + extra after high strain + part of last night's debt. |

These are our own formulas, not any company's, and not medical advice.

## Hosting on GitHub Pages

1. Create a new repository on github.com (e.g. `pulse`). Public repos get free Pages.
2. Push this folder to it:
   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/pulse.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `(root)` → Save**.
4. After a minute your app is at `https://YOUR-USERNAME.github.io/pulse/`.

Updating: make changes, commit, push. Bump `CACHE` in `sw.js` so phones pick up the new version.

## Running locally

```bash
node dev-server.js
```

Then open http://localhost:5173 and tap **Try it with demo data**.

## Files

- `index.html`, `css/styles.css` — the app shell
- `js/app.js` — screens, settings, storage
- `js/scoring.js` — recovery / strain / sleep maths
- `js/import-worker.js` — streams the Health export (zip or xml) without loading it all into memory
- `js/demo.js` — demo data
- `sw.js`, `manifest.webmanifest`, `icons/` — offline + home-screen install
