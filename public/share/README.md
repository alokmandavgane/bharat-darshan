# Share assets

Served from https://darshan.alokm.com/share/.

| File | Size | Made by | Use |
|------|------|---------|-----|
| `og-en.jpg`, `og-hi.jpg` | 2400×1260 | `tools/share-image.mjs` | Open Graph and Twitter cards, referenced from `index.html` per language shell |
| `og-<lang>-<plate>.jpg` | 2400×1260 | `tools/share-image.mjs` | One per page of the atlas per language, so a page pasted into a chat shows that page. `vite.config.js` uses one when it exists and falls back to the language card when it does not |
| `qr.png` | 1640×2020 | `tools/qr-image.py` | QR to the site with the bilingual title, print resolution |
| `qr-800.png` | 800×985 | `tools/qr-image.py` | The same, for chat and slides |
| `qr-plain-800.png` | 800×800 | `tools/qr-image.py` | QR alone, no title |

The cards are screenshots of the app in poster mode, so they cannot drift from how it
actually looks, and they carry the Survey of India-compliant outline by construction. A
page's card is the page itself, with its title block carrying the page's own words.

```
npm run preview                       # then, from the repo root:
DRY=1 node tools/share-image.mjs      # what would be rendered, no browser needed
node tools/share-image.mjs            # everything missing; FORCE=1 redoes what is there
ONLY=rivers node tools/share-image.mjs
```

The QR codes encode `https://darshan.alokm.com` at error-correction level H and were
checked to decode down to 200 px. Their title is set in Yatra One, the face the site
self-hosts; `tools/fonts/` holds the TrueType build because Pillow cannot read woff2,
under the licence already recorded in `public/fonts/YatraOne-OFL.txt`.

Neither tool is a project dependency. See the header of each for what it needs.
