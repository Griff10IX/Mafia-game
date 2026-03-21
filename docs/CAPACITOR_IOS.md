# iOS (App Store) via Capacitor

This app is a Create React App bundle wrapped with [Capacitor](https://capacitorjs.com/) for a native iOS shell.

## Prerequisites

- **macOS** with **Xcode** (required to open the iOS project, run the simulator, and submit to App Store Connect).
- Node 20.x (see `package.json` engines).

## One-time setup

```bash
npm install
npm run build
npx cap add ios
```

On **Windows**, `cap add ios` can scaffold `ios/`, but **CocoaPods** and **Xcode** only run on **macOS**. After copying the repo to a Mac (or syncing), run `npm run cap:sync` there once so `pod install` completes inside `ios/App`.

If `ios/` already exists, skip `cap add ios` and use:

```bash
npm run cap:sync
```

## Day-to-day

1. Set **`REACT_APP_BACKEND_URL`** in `.env` to your **HTTPS** API origin (no trailing `/api`). Example: `https://game.example.com`  
   The web app uses `/api` on that host (see `src/utils/api.js`). Plain HTTP is blocked by iOS App Transport Security unless you add exceptions (not recommended).

2. Build the web app and copy into the native project:

   ```bash
   npm run cap:sync
   ```

3. Open Xcode:

   ```bash
   npm run cap:open:ios
   ```

4. In Xcode: set **Signing & Capabilities** (your Apple team), bump **Version** / **Build**, then **Archive** for TestFlight / App Store.

## `package.json` `homepage`

`"homepage": "."` makes CRA emit **relative** asset URLs so the app loads from the Capacitor WebView (`capacitor://localhost`).  
If you deploy the **same** build to a subpath on the web (e.g. `https://example.com/app/`), configure `homepage` accordingly for that pipeline.

## Bundle ID

Default in `capacitor.config.json`: `com.mafiawars.app`. Change `appId` there and in Xcode **Signing** if you use your own identifier.

## Review notes

- Apple may scrutinize “thin” web shells under guideline **4.2**; add native polish (splash, offline message, push/IAP only if needed) as you grow.
- Digital purchases may require **In-App Purchase**; consult App Store guidelines.
