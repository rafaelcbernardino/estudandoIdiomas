# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: Estudando Idiomas

A local web application for studying languages (English, Japanese, Spanish), built with Node.js + Express + SQLite. Reads course content (MP3 audio, PDF files) dynamically from `C:\Cursos` on the filesystem.

## Git Workflow (REQUIRED)

- **Every code change** must be: `git add <files>` → `git commit` → `git push origin staging`
- **Never merge to `main`** unless the user explicitly requests it
- Branch `staging` receives all development work; `main` is only updated on user request

```bash
git add <changed files>
git commit -m "description"
git push origin staging
```

## Commands

```bash
# Install dependencies
npm install

# Start development server (with auto-reload)
npm run dev

# Start production server
npm start
```

Server runs at `http://localhost:3000`.

## Architecture

```
server.js          — Express API + static file serving
database/db.js     — SQLite connection and schema initialization
public/            — Frontend (Vanilla HTML/CSS/JS, no build step)
  index.html       — Landing page (EN/JP/ES greeting cards, floating particles)
  ingles.html      — English course (dynamic modules/lessons from API)
  aula.html        — Lesson page (audio player, homework, notes)
  japones.html     — Japanese course placeholder
  espanhol.html    — Spanish course placeholder
  css/style.css    — Global design system (variables: --color-bg, --color-primary, --color-accent)
  js/              — Page-specific JavaScript
transcripts/       — Timed subtitle JSON files per audio clip
database/          — SQLite file (learning.db, not committed to git)
```

## Course Content Location

All course files live in `C:\Cursos` (one level above project root):

| Key | Folder |
|-----|--------|
| `ingles` | `Inglês - Junior Silveira` |
| `japones` | `Japonês - Rafael Luiz` |
| `espanhol` | `Espanhol` |

The server resolves `COURSES_ROOT = path.join(__dirname, '..')` → `C:\Cursos`.

Expected folder layout per course:
```
Módulo 1/
  Aula 1/
    Homeworks/
      *.mp3   ← audio files served via /api/audio/:course/*
      *.pdf   ← reference only (homework recreated as interactive HTML)
```

Root-level `Aula X/` directories are automatically grouped under Módulo 1.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/courses/:course/structure` | Dynamic module/lesson tree |
| GET | `/api/audio/:course/*` | Stream audio file |
| GET | `/api/transcript/:course/*?file=` | Get subtitle JSON |
| POST | `/api/transcript/:course/*?file=` | Save subtitle JSON |
| GET | `/api/notes/:course/:aula` | Load notes |
| POST | `/api/notes/:course/:aula` | Save notes |
| GET | `/api/homework/:course/:aula` | Load homework answers |
| POST | `/api/homework/:course/:aula` | Save single homework answer |

## Design System

Colors (defined as CSS variables in `style.css`):
- `--color-bg`: `#0D0120` (dark background)
- `--color-primary`: `#7411A0` (purple, predominant)
- `--color-accent`: `#A6E312` (lime green, highlights/CTAs)

Font: Poppins (Google Fonts)

## Adding a New Lesson

1. Create the folder: `C:\Cursos\Inglês - Junior Silveira\Módulo X\Aula Y\Homeworks\`
2. Drop MP3 and PDF files in `Homeworks\`
3. The course page auto-discovers it (no code changes needed)
4. Optionally create a transcript: `transcripts/ingles/Módulo X/Aula Y/<audioname>.json`

## Transcript JSON Format

```json
{
  "title": "Dialogue Title",
  "segments": [
    { "start": 0.0, "end": 2.5, "speaker": "Brian", "text": "Hello, good morning!" }
  ]
}
```

## What NOT to commit

`.gitignore` excludes: `node_modules/`, `database/learning.db`, `*.mp3`, `*.wav`, `*.pdf`, `*.jpg`, `*.png` (large binary course files stay local only).
