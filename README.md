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

Download the newest APK from the same link and install it over the top. Your songs stay;
every release is signed with the same key.

## How it works (for the curious)

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

## Building

GitHub Actions builds, tests, lints and signs the APK on every push
(`.github/workflows/build.yml`); publishing a release attaches `Nortest.apk` to it.
Locally: JDK 17 + Android SDK 34, then `./gradlew assembleRelease`.
