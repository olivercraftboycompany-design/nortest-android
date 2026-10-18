# Nortest for Android

Nortest, Oliver's music player, as a real Android app (APK), not a website shortcut.

**Download (always the newest version):**
https://github.com/olivercraftboycompany-design/nortest-android/releases/latest/download/Nortest.apk

## What the app adds over the web version

- **Five buttons on the media controls** (notification shade, lock screen, Samsung media panel):
  Previous, Back 10 s, Play/Pause, Forward 10 s, Next.
- A seek bar on the lock screen / notification that you can drag.
- Keeps playing with the screen off and when you switch apps (it runs as a proper music
  service with a "Now playing" notification).
- Headphone, Bluetooth and car buttons work (play/pause, next, previous; unplugging
  headphones pauses).
- Back button keeps the music going (the app goes to the background instead of closing).
  Swiping Nortest away in Recents stops it.
- Backups ("Save to phone") are saved straight into your Downloads folder.
- **All the music on your phone shows up in your library** (v1.2+). After you tap **Allow** on
  "music and audio" access, every song on the phone is mixed into the library next to the songs you
  imported, with a small "phone" tag. They play straight from the phone (nothing is copied), and work
  in playlists, the queue, shuffle, favorites and the lock-screen controls. New downloads show up on
  their own (or tap **Rescan**); songs you delete from the phone disappear. Use the
  "All songs / Imported / On this phone" filter to see just one kind, and "Hide from library" in a
  song's menu to hide one. Songs you already imported are not shown twice. Phone songs are not
  included in backups (they are already on the phone).
- Everything else is the same player: playlists, lyrics, repeat/shuffle, EQ, landscape,
  backup/restore and the Tab remote.

## Install on a Samsung phone

1. Open the download link above in **Chrome**. If Chrome warns that the file might be
   harmful, tap **Download anyway**.
2. When it finishes, tap **Open** (or find `Nortest.apk` in **My Files > Downloads**).
3. Android asks to allow installs from Chrome: tap **Settings**, turn on
   **Allow from this source**, then go back.
4. Tap **Install**.
5. If **Play Protect** says the app is from an unknown developer, tap **More details >
   Install anyway**. (It is unknown because it is not on the Play Store.)
6. Open Nortest. When it asks to **allow notifications**, tap **Allow**, so the media
   controls show up.

### Optional, for long listening sessions
Samsung can put apps to sleep. If music ever stops by itself with the screen off:
**Settings > Apps > Nortest > Battery > Unrestricted**.

## Moving your songs from the web version

The app has its own storage, so your songs and playlists from the website do not appear
automatically. Either:

- **Fastest:** in the app tap **Upload songs** and pick your music files again, or
- **Keep everything (playlists, favourites, play counts):** in the web version open
  **Backup & restore > Back up > Save to phone**, then in the app open
  **Backup & restore > Restore** and pick that `.zip` from Downloads.

## Updating

From v1.1 on, Nortest tells you when there is a new version: you get an "Update available"
pop-up when you open it (it checks at most every 6 hours), tap **Update**, and it downloads
and opens the installer. The first time, Android asks you to allow installs from Nortest
(turn on **Allow from this source**, then come back). You can also long-press the Nortest
icon and tap **Check for updates**. Your songs stay; every release is signed with the same key.

(v1.0 does not have the checker, so going from 1.0 to 1.1 is one manual install from the link above.)

### Releasing a new version (for whoever maintains this)

1. Bump `versionCode` (+1) and `versionName` in `version.properties`, commit.
2. Publish a GitHub release tagged `v<versionName>`. The workflow builds, signs (same key, from
   the repo secrets) and attaches `Nortest.apk`. Check it downloaded and its versionCode.
3. Then bump `com.olivercraftboy.nortest` (versionCode, versionName, notes) in the shared
   https://oliver-apps.sites.tab.bot/versions.json (see the oliver-apps README). Its url stays
   `.../releases/latest/download/Nortest.apk`. Installed apps offer the update from then on.

## How it works (for the curious)

- Phone music: `DeviceMusic.kt` scans MediaStore (on open, on Rescan, and when MediaStore changes)
  and serves each song at `https://appassets.androidplatform.net/devicemusic/audio/<id>` (with HTTP
  Range support, so seeking works) and its cover at `.../devicemusic/art/<id>`. The bundled `app.js`
  merges them into `songs` with `device: true`; favorites/edits for them live in IndexedDB meta
  `devov`, never in the songs store. Note: these app.js / backup.js changes exist only in this
  bundled copy (the 3tbwg website is unchanged); keep them if you re-bundle the web player.

- `app/src/main/assets/www/` is the nortest web player (from the `3tbwg` repo), bundled
  inside the app so it works offline. It is served from a private https address inside the
  app so storage (IndexedDB) works normally.
- `nortest-android.js` is a small bridge: the web player tells the app what is playing
  (title, artist, album art, length, position, playing/paused) and the app sends button
  presses back (previous, next, play, pause, seek, -10 s, +10 s).
- `PlaybackService.kt` is a foreground media service with a MediaSession. On Android 13
  and newer the system media player draws its buttons from the session: Play/Pause,
  Previous and Next, plus two custom actions for -10 s and +10 s, so all five show. On
  older Android the notification itself has the same five buttons.
- The audio is played by the web player (same EQ, same everything). The app keeps that
  page running and at full priority while the screen is off, holds a wake lock while
  music plays, and never pauses the page when you leave the app.

## Look (1.5): Liquid Glass

1.5 keeps 1.4's code and settings and swaps the skin for Apple-style Liquid Glass:
`glass.css` (the glass look, loaded after `style.css`), `glass.js` (the refraction engine: one SVG
feDisplacementMap lens filter per floating surface, generated for its size and corner radius, used as
`backdrop-filter:url()` in Chromium/WebView with a blur fallback; glass droplet tab indicator; press wobble;
Settings > Look > Glass effects Full/Light/Off) and `sf.js` (SF-style line icons used by `mi()` in `m3.js`).

## Look (1.4): Material 3 Expressive

The web UI (`www/`) was rewritten in Material 3 Expressive and is shared with the website:
`style.css` (all styles, no injected style blocks), `m3.js` (Material Symbols icons, M3 color roles built
from the playing cover in OKLCH, expressive shapes as morphable clip-path polygons, ripple),
`fonts.css` (Google Sans Flex, bundled so it works offline). Settings is a full-screen page (`settings()`
in app.js); crossfade uses a second, hidden audio element for the old song's tail, so Media Session,
the remote and the queue always follow `au`. `NortestBridge.checkForUpdates()` backs
Settings > About > Check for updates. `www/glass.*` from the 1.3 draft are unused.

## Building

GitHub Actions builds, tests, lints and signs the APK on every push
(`.github/workflows/build.yml`); publishing a release attaches `Nortest.apk` to it.
Locally: JDK 17 + Android SDK 34, then `./gradlew assembleRelease`.
