# Your fonts — the drop folder

Put font files in **this folder** and they show up in the app's font picker under
**“Your fonts (dropped in)”**. No uploading, no metadata, no settings. Drop a file, relaunch
(or click **Rescan folder** in the picker), and it’s there.

This folder is yours to manage in Finder. It’s separate from the fonts the app installs for you
through the in-app Google Fonts browser (those live in `public/fonts/installed/` and are added
and removed through the UI). Both show up in the picker, in their own groups.

## How to drop fonts in

There are two ways. **The first is the reliable one.**

### 1. One subfolder per family  ← recommended

Make a folder named exactly what you want the family to be called, and put every weight and
style inside it:

```
public/fonts/custom/
  Acme Grotesk/
    AcmeGrotesk-Regular.ttf
    AcmeGrotesk-Bold.ttf
    AcmeGrotesk-Italic.ttf
```

That gives you a family called **Acme Grotesk** with three faces. The folder name is the family
name — spaces, capitals and accents are all fine and are shown exactly as you typed them.

### 2. Loose files, straight in the folder

```
public/fonts/custom/
  Acme-Bold.ttf
  Acme-Italic.ttf
```

The family name is **guessed from the filename** by stripping off weight/style words
(`Bold`, `Italic`, `Light`, …). `Acme-Bold.ttf` and `Acme-Italic.ttf` both become the family
**Acme**. This is convenient but a guess — if a name doesn’t split cleanly, use a subfolder
(way 1) instead, where the family name is never in doubt.

Either way, the weight and style of each face are read from its filename (`Bold` → 700,
`Italic` → italic, and so on), so name your files sensibly.

## Supported formats

`.ttf`, `.otf`, `.woff`, `.woff2`. Files are checked by their actual contents, not their
extension, so anything that isn’t really a font — a `.DS_Store`, a stray PDF, a text file — is
just ignored. TrueType and OpenType (`.ttf` / `.otf`) work fine and export correctly; `woff2`
is only worth bothering with if you care about the files on disk being smaller.

## Picking them up

- **Relaunch the app** — the folder is scanned every time the dev server starts.
- **Or click “Rescan folder”** in the font picker (under the “Your fonts” group) while the dev
  server is running — no relaunch needed.

## A note on git

Everything you drop here is **git-ignored by default**, along with the generated `custom.css`.
Your fonts are your own files with their own licences, so they’re not committed to the repo
automatically. If you deliberately want to commit one — and you’ve confirmed its licence lets
you redistribute it — force-add it:

```
git add -f "public/fonts/custom/Acme Grotesk"
```

On a machine that doesn’t have these files, the picker marks the family as missing and the app
falls back to a default font, so nothing breaks — the fonts just aren’t there until you drop
them in again.
