# Third-party notices

NotchMine is released under the [MIT License](LICENSE). It includes or relies on the third-party work listed below. Each item stays under its own license.

## Bundled software

### Electron (MIT)

Copyright (c) Electron contributors. Copyright (c) 2013-2020 GitHub Inc.

Built Windows packages include the Electron runtime, which bundles Chromium, Node.js and their dependencies. Their licenses ship with every build as `LICENSE.electron.txt` and `LICENSES.chromium.html` next to `NotchMine.exe`.

### node-qrcode (MIT)

Copyright (c) 2012 Ryan Day. <https://github.com/soldair/node-qrcode>

It is used to draw the QR code for phone drop. Its runtime dependencies are:

| Package | License |
|---|---|
| ansi-regex, ansi-styles, camelcase, color-convert, color-name, decamelize, dijkstrajs, emoji-regex, find-up, is-fullwidth-code-point, locate-path, p-limit, p-locate, p-try, path-exists, pngjs, require-directory, string-width, strip-ansi, wrap-ansi, yargs | MIT |
| cliui, get-caller-file, require-main-filename, set-blocking, which-module, y18n, yargs-parser | ISC |

Each package's full license text is in its folder under `node_modules/`.

Build-only tools such as electron-builder are not shipped in the app.

## Icons

Many of the line icons in `src/renderer/icons.js` are adapted from these two sets:

- **Feather Icons**, <https://feathericons.com>
- **Lucide**, <https://lucide.dev>, a fork of Feather

The sun/moon, weather, battery, Wi-Fi bar and party glyphs, the app icon and the tray icon were drawn for NotchMine.

<details>
<summary>Feather Icons license (MIT)</summary>

```
The MIT License (MIT)

Copyright (c) 2013-2017 Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
</details>

<details>
<summary>Lucide license (ISC)</summary>

```
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of
Feather (MIT). All other copyright (c) for Lucide are held by Lucide
Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```
</details>

## Online services and data

NotchMine does not bundle any data from these services. It fetches their data while running.

- **Weather and city search:** [Open-Meteo](https://open-meteo.com). The data is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), and the app shows a credit in Settings → Widgets. Open-Meteo's free API is meant for non-commercial use. A commercial fork needs an [Open-Meteo API plan](https://open-meteo.com/en/pricing).
- **Synced lyrics:** [LRCLIB](https://lrclib.net), a free community lyrics database. Lyrics are the property of their songwriters and publishers. NotchMine only displays them while a song plays. It keeps a small private cache of recent look-ups (up to 300 songs) in `%APPDATA%\NotchMine` and never redistributes them. Lyrics can be turned off in Settings → Live.

## Fonts, emoji and sounds

- **Fonts:** none are bundled. The UI uses fonts already installed with Windows, such as Segoe UI.
- **Emoji:** shown with the system emoji font.
- **Notification chime:** generated in code with the Web Audio API. No audio files are bundled.

## Trademarks

- "Dynamic Island", "Apple" and "iPhone" are trademarks of Apple Inc.
- "Windows" and "Microsoft" are trademarks of Microsoft Corporation.
- "Spotify", "Chrome", "WhatsApp", "Discord" and the other app names that appear in the app or the docs are trademarks of their respective owners. They are used only to identify those apps.
- "QR Code" is a registered trademark of DENSO WAVE INCORPORATED.

NotchMine is an independent project. It is not affiliated with, endorsed by or sponsored by any of these companies.

The README screenshots use a made-up demo song ("Neon Skyline" by "Demo Artist") and made-up notifications.
