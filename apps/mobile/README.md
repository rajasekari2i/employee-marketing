# Mobile app

React Native (Android first — see `android/`). Run from the repo root with `pnpm --filter mobile <script>`, or from this directory directly.

## Running on a physical device over USB

Two separate local ports need forwarding from the device to this machine — `adb reverse` only forwards what you explicitly tell it to, and the mapping is dropped on every USB disconnect/reconnect or device reboot:

```sh
adb reverse tcp:8081 tcp:8081   # Metro (the JS bundler) — without this: "Unable to load script"
adb reverse tcp:3000 tcp:3000   # the API (API_URL in .env.<flavor> is http://localhost:3000/...) — without this: "No internet connection" on every API call
```

Run both after reconnecting the device, then:

```sh
pnpm start      # Metro, in its own terminal — leave it running
pnpm android    # build + install (devDebug flavor; pnpm android:srt for the srt flavor)
```

If `adb devices` shows nothing: check the USB cable has data lines (not charge-only), USB debugging is enabled in Developer options, and the device's USB mode is set to file transfer, not charging-only. `adb kill-server && adb start-server` clears a stale adb server.
