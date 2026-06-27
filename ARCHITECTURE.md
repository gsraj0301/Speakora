# Speakora — Architecture

## Overview

Speakora is a browser-based AI presentation coach that runs entirely in the browser + a lightweight Django backend. A student opens their webcam and mic, speaks as if presenting to a room, and receives structured coaching feedback on delivery — filler words, pace, head position, eye contact, facial expression, and blink rate. No video is ever stored or uploaded. Audio is transcribed on-demand via Groq Whisper; stats are analyzed by Groq Llama for coaching tips.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         BROWSER (Client)                            │
│                                                                     │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐   │
│  │   MediaPipe Tasks     │    │   MediaRecorder                  │   │
│  │   FaceLandmarker      │    │   (audio capture, whole session) │   │
│  │   (face mesh, 478     │    └──────────┬───────────────────────┘   │
│  │    landmarks, GPU)    │               │ gets blob on demand       │
│  └──────────┬────────────┘               │                           │
│             │ every frame                 ▼                           │
│             ▼                    ┌──────────────────┐                │
│  ┌──────────────────────┐        │  Groq Whisper    │                │
│  │  detectLoop()        │        │  Large-v3 Turbo  │                │
│  │  every 30 frames:    │        │  POST /api/      │                │
│  │  • head position     │        │  transcribe/     │                │
│  │  • eye contact       │        └────────┬─────────┘                │
│  │  • smile %           │                 │                          │
│  │  • blink rate        │                 ▼ transcript               │
│  │  • mouth openness    │         ┌──────────────────┐               │
│  │  • eyebrow raise     │         │  countFillers()  │               │
│  └──────────────────────┘         │  countWords()    │               │
│                                   │  pace calc (5s)  │               │
│  ┌──────────────────────┐         └────────┬─────────┘               │
│  │  Web Speech API      │                   │                        │
│  │  (fallback, live     │                   ▼                        │
│  │   streaming, Google) │         ┌──────────────────┐               │
│  └──────────────────────┘         │  openai/gpt-oss- │               │
│                                   │  120b (free)     │               │
│  ┌──────────────────────┐         │  POST /api/coach/│               │
│  │  SpeechSynthesis API  │         └────────┬─────────┘               │
│  │  (TTS feedback)      │                   │ tip                    │
│  └──────────────────────┘                   ▼                        │
│                                   ┌──────────────────┐               │
│                                   │  /api/save-      │               │
│                                   │  session/        │               │
│                                   └────────┬─────────┘               │
│                                            │                         │
└────────────────────────────────────────────┼─────────────────────────┘
                                             │ JSON
                                             ▼
                               ┌─────────────────────────┐
                               │   DJANGO BACKEND         │
                               │                          │
                               │  urls.py → views.py      │
                               │  core/models.py          │
                               │   PracticeSession        │
                               │  SQLite (db.sqlite3)     │
                               └─────────────────────────┘
```

### Data Flow — Practice Session Lifecycle

| Step | What Happens |
|------|-------------|
| 1 | User clicks **Start Practice** → `init()` fires |
| 2 | `getUserMedia({video, audio})` → webcam + mic stream |
| 3 | `FaceLandmarker.createFromOptions()` loads MediaPipe model (GPU) |
| 4 | `detectLoop()` begins `requestAnimationFrame` loop on `<canvas>` |
| 5 | `MediaRecorder.start()` begins recording full session audio |
| 6 | `tryWebSpeech()` optionally starts live Web Speech API transcription |
| 7 | Every 30 frames: head position, eye contact, smile, blink, brow, mouth metrics recorded |
| 8 | Every 5s: pace (WPM) recalculated |
| 9 | User clicks **Get Feedback** → `sessionActive = false`, recording stops |
| 10 | Audio blob → `POST /api/transcribe/` → Groq Whisper → transcript |
| 11 | Fillers counted on transcript, final metrics computed |
| 12 | If seconds ≥ 15: stats → `POST /api/coach/` → Groq Llama → tip → TTS |
| 13 | Payload → `POST /api/save-session/` → DB → redirect to `/results/?session_id=N` |

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Backend framework | Django 4.2 | Monolith, no DRF |
| Database | SQLite | Single file, adequate for single-user/small-group |
| Frontend | Vanilla JS + Tailwind CSS 3 (CDN) | No framework, no build step |
| Face tracking | MediaPipe Tasks Vision 0.10.18 (CDN) | `FaceLandmarker` with GPU delegate |
| Speech-to-text | Groq Whisper large-v3-turbo | Via `POST /api/transcribe/` proxy |
| Coaching LLM | Groq openai/gpt-oss-120b | Via `POST /api/coach/` proxy |
| Live STT fallback | Web Speech API (`SpeechRecognition`) | Silent fail if Google unreachable |
| Text-to-speech | `SpeechSynthesis` API | Browser-native |
| Charts | Chart.js 4.4.7 (CDN) | Dashboard line charts |
| Hosting | PythonAnywhere | Free tier, deployed via REST API |

---

## Directory Structure

```
coach/
├── ARCHITECTURE.md              # This file
├── AGENTS.md                    # AI assistant project memory (frequently updated)
├── PROJECT_STATUS.md            # Feature tracking
├── DESIGN-vercel.md             # Vercel design language reference
├── manage.py                    # Django CLI
├── requirements.txt             # Django >=4.2, requests, python-dotenv
├── .env                         # GROQ_API_KEY, DJANGO_SECRET_KEY, etc.
├── db.sqlite3                   # SQLite database
├── deploy.py                    # PythonAnywhere REST API uploader
├── package.json                 # (placeholder, no build tools)
├── tailwind.config.js           # Tailwind config (unused — CDN mode)
│
├── coach/                       # Django project package
│   ├── settings.py              # App config, static files, auth, GROQ_API_KEY
│   ├── urls.py                  # All URL routing
│   ├── wsgi.py / asgi.py        # WSGI/ASGI entry points
│
├── core/                        # Django app
│   ├── models.py                # PracticeSession model
│   ├── views.py                 # All views (pages + API endpoints)
│   ├── admin.py                 # Register PracticeSession in admin
│   ├── tests.py                 # (placeholder)
│   ├── migrations/              # Database migrations
│
├── templates/                   # Django templates
│   ├── base.html                # Tailwind + Inter + JetBrains Mono base
│   ├── landing.html             # Vercel-style landing page
│   ├── coach.html               # Practice screen (canvas + timer + buttons)
│   ├── results.html             # Results page (stat cards + parsed feedback)
│   ├── dashboard.html           # Chart.js charts + sessions table
│   ├── login.html               # Login form
│   └── register.html            # Registration form
│
├── static/
│   ├── js/
│   │   └── coach.js             # All client-side JS (single file, ES module)
│   ├── css/
│   │   ├── input.css            # Tailwind source (unused — CDN)
│   │   └── tailwind.css         # Generated (unused — CDN)
│   ├── favicon.svg              # SVG favicon
│   └── robots.txt               # Allow all
│
└── staticfiles/                 # collectstatic output (deployment)
```

---

## Backend Architecture

### Django Project (`coach/`)

**`coach/settings.py`**
- Loads env vars from `.env` via `python-dotenv`
- `GROQ_API_KEY` read from environment
- `SECRET_KEY`, `DEBUG`, `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS` from env
- PythonAnywhere detection: enables `SECURE_SSL_REDIRECT`, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`
- Static files: `STATICFILES_DIRS` = `static/`, `STATIC_ROOT` = `staticfiles/`
- Templates: custom `DIRS` pointing to `templates/`
- Installed apps: standard Django + `core`

**`coach/urls.py`**
| Path | View | Auth |
|------|------|------|
| `/` | `landing_page` | Public |
| `/practice/` | `coach_page` | `@login_required` |
| `/results/` | `results_page` | `@login_required` |
| `/dashboard/` | `dashboard` | `@login_required` |
| `/login/` | `user_login` | Public |
| `/register/` | `user_register` | Public |
| `/logout/` | `user_logout` | Public |
| `/api/transcribe/` | `transcribe` | `@login_required` |
| `/api/coach/` | `coach` | `@login_required` |
| `/api/save-session/` | `save_session` | `@login_required` |
| `/api/run-migration/` | `run_migration` | Token-gated |
| `/admin/` | Django admin | Staff |
| `/favicon.ico` | Inline handler | Public |
| `/robots.txt` | Inline handler | Public |

### Core App (`core/`)

**`core/models.py` — `PracticeSession`**
| Field | Type | Description |
|-------|------|-------------|
| `user` | ForeignKey(User) | FK to auth_user; `request.user` |
| `date` | DateTimeField(auto_now_add) | Session timestamp |
| `duration_seconds` | IntegerField | Session length |
| `filler_word_count` | IntegerField | Count of um/uh/like/you-know etc. |
| `avg_pace_wpm` | FloatField | Words per minute |
| `posture_score` | FloatField | Head position (0–100) |
| `eye_contact_score` | FloatField | Percentage of frames looking at camera |
| `gestures_per_minute` | FloatField | Legacy (unused since face mesh migration) |
| `openness_score` | FloatField | Legacy (unused since face mesh migration) |
| `smile_score` | IntegerField | Percentage of frames smiling |
| `blink_rate` | FloatField | Blinks per minute |
| `mouth_openness` | FloatField | Avg lip distance (arbitrary units) |
| `feedback_text` | TextField | STRENGTH/IMPROVE/TIP text |
| `transcript` | TextField | Full session transcript |

**`core/views.py` — API Endpoints**

- **`transcribe(request)`** — Accepts `POST` with audio file → forwards to Groq Whisper `whisper-large-v3-turbo` with English language hint and filler-word prompt → returns `{text: "..."}`

- **`coach(request)`** — Accepts `POST` with JSON → builds structured prompt for Groq `openai/gpt-oss-120b` containing transcript, filler count, pace, posture, eye contact, smile %, blink rate, mouth openness → returns `{tip: "STRENGTH: ...\nIMPROVE: ...\nTIP: ..."}`

- **`save_session(request)`** — Accepts `POST` with JSON payload → creates `PracticeSession` with `user=request.user` → returns `{id: N}`

- **`results_page(request)`** — Reads `?session_id=` → loads session → serializes to JSON → renders template (data also available via sessionStorage as fallback)

- **`dashboard(request)`** — Filters `PracticeSession` by `user=request.user` → passes queryset + JSON-serialized list to template → Chart.js renders 5 line charts (fillers, pace, head position, smile %, blink rate)

---

## Frontend Architecture

All client logic lives in a single ES module: `static/js/coach.js`.

### Session State (`sessionState` object)

Central state object holding all runtime data:
- **Pose/facial**: `postureScores[]`, `frameCount`, `lastVideoTime`, `faceLandmarker`
- **Audio**: `mediaRecorder`, `audioChunks[]`, `transcript`
- **Metrics**: `fillerCount`, `wordCount`, `pace`, `eyeContactFrames`, `totalFrames`, `smileFrames`, `blinkCount`, `lastBlinkState`, `mouthOpennessValues[]`, `eyebrowRaiseCount`, `baselineBrowY`
- **Session control**: `startTime`, `paceInterval`, `timerInterval`, `sessionActive`, `coachingTips[]`, `webSpeechFailed`
- **UI**: `showVideo` (toggle webcam feed visibility)

### MediaPipe Face Mesh Pipeline

**Initialization** (`init()`):
1. `getUserMedia({video, audio})` → webcam stream
2. Dynamic import of `@mediapipe/tasks-vision@0.10.18` from CDN
3. `FaceLandmarker.createFromOptions()` with GPU delegate, VIDEO mode, `refineLandmarks: true` (enables iris landmarks 468/473)

**Detection Loop** (`detectLoop()`):
- `requestAnimationFrame` loop rendering to `<canvas>`
- Canvas background: dark radial gradient (`#0a0f12 → #000000`)
- Canvas is mirrored (scale -1, 1) for natural user experience
- FaceLandmarker draws cyan contours (`#00e5ff`) + teal landmarks (`#00b8d4`) using `DrawingUtils.drawConnectors()` and `drawLandmarks()`
- Optional: toggle to show raw webcam feed behind wireframe

**Every 30 frames, 5 analyses run:**

| Metric | Method | Landmarks Used |
|--------|--------|---------------|
| **Head Position** | Nose angle (4→152), forward lean (nose Y vs ear Y), rotation (nose X offset from center) | 4 (nose), 152 (chin), 234/454 (ears) |
| **Eye Contact** | Iris offset within eye socket normalized by eye width; both irises must have offset < 0.3 | 468/473 (iris L/R), 133/33 (L eye bounds), 263/362 (R eye bounds) |
| **Smile %** | Mouth corner uplift vs center; avg of L/R > 0.02 = smiling | 61/291 (corners), 13 (center) |
| **Blink** | Eyelid distance 159→145; transition open→closed = 1 blink; threshold < 0.015 | 159 (upper lid), 145 (lower lid) |
| **Mouth Openness** | Distance 13→14; averaged across all samples for session | 13 (upper lip), 14 (lower lip) |
| **Eyebrow Raise** | Brow-to-eye distance; running exponential baseline (0.95/0.05); 1.3× threshold | 105/334 (brow L/R), 159/386 (eye L/R) |

### Audio Pipeline

- **Primary**: `MediaRecorder` captures full session audio → on "Get Feedback", audio blob → `POST /api/transcribe/` → Groq Whisper → transcript
- **Fallback**: `webkitSpeechRecognition` (Web Speech API) for live streaming; auto-restarts on `onend` while `sessionActive` is true; silent network fallback sets `webSpeechFailed` flag
- **Filler detection**: Regex-based on lowercase transcript; multi-word fillers (`you know`, `i mean`, etc.) matched with flexible whitespace regex first, then single-word (`um`, `uh`, `like`) with `\b` word boundaries
- **Pace**: `setInterval(updatePace, 5000)` — word count / elapsed minutes

### UI Components (coach.html)

- **Top bar**: Timer (`MM:SS`) + status text + toggle camera button + Get Feedback button
- **Start overlay**: "Ready to practice?" with Start Practice button (hidden after start)
- **Canvas**: Face wireframe on dark gradient; no video feed shown by default

### Results Page Parsing

The coaching tip from Groq comes as structured text:
```
STRENGTH: One thing they did well.
IMPROVE: The single most important thing to fix.
TIP: One concrete drill or technique.
```

Results page regex-parses these into 3 colored cards (emerald/amber/blue). If the response doesn't match the expected structure, it falls back to a generic card. Striped of non-standard formatting with `join('\n')` before regex to handle DB storage artifacts.

---

## Auth System

- Standard Django `auth_user` table
- `user_register`: validates fields, creates user, auto-login, redirect to `/practice/`
- `user_login`: authenticate, respects `?next=` param, redirect to `/practice/`
- `user_logout`: logout, redirect to `/`
- `@login_required(login_url='/login/')` decorator on `coach_page` and `dashboard`
- Landing page nav conditionally shows Dashboard/Log out vs Log in/Sign up
- `user` FK in PracticeSession = `request.user`

---

## Deployment

### PythonAnywhere (`deploy.py`)

- REST API uploader: authenticates with `PYTHONANYWHERE_API_KEY` + `PYTHONANYWHERE_USERNAME`
- Uploads ~30 files to `/home/speakora/mysite` via multipart POST
- Supports `--reload`, `--migrate`, `--reload-only` flags
- Environment variables set via PythonAnywhere web app config (not `.env`)
- See `speakora.pythonanywhere.com`

### Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `GROQ_API_KEY` | Yes | Groq API key for Whisper + Llama |
| `DJANGO_SECRET_KEY` | Yes | Django secret key |
| `DJANGO_DEBUG` | No | Set "True" for debug mode |
| `DJANGO_ALLOWED_HOSTS` | No | Comma-separated host list |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | No | Comma-separated origin list |

---

## Key Design Decisions

1. **Face mesh only** — No video feed stored or shown by default; only cyan wireframe on dark gradient. Reduces self-consciousness, looks cooler, minimizes privacy concerns.

2. **On-demand transcription** — Audio records the full session but only transcribes when user clicks Get Feedback. Saves Groq API quota (~30 Whisper req/min).

3. **15-second guard** — Sessions shorter than 15s skip Groq API entirely and show a "speak longer" message. Prevents wasted API calls.

4. **No DRF** — JSON responses use `JsonResponse` with CSRF cookie auth. Simple enough for a college project; avoids DRF dependency.

5. **Web Speech as fallback only** — Relies on Groq Whisper for the canonical transcript. Web Speech is a free bonus if Google servers are reachable.

6. **Single sessionState object** — No `window._` globals. Everything lives in one const for clarity.

7. **Iris-based eye contact** — More accurate than nose-drift proxy. Uses actual iris landmarks (468/473) from MediaPipe's `refineLandmarks: true`.

---

## Known Architecture Constraints

- Groq API rate limits: ~30 req/min Whisper, ~6000/day chat. Exceeded → silent 429s.
- MediaPipe FaceLandmarker requires GPU delegate; falls back to CPU on some devices (slower).
- Eye contact threshold (iris offset < 0.3) tuned for 720p webcam; may need recalibration.
- Blink threshold (eyeOpenDist < 0.015) may vary with face size/distance from camera.
- `audioChunks[]` grows unbounded during long sessions — no streaming upload.
- Web Speech API requires Google servers; fails silently in restricted networks (India, corporate).
- No WebSocket — dashboard charts don't update in real time; page reload required.
- SQLite is adequate for single-user; would need PostgreSQL for multi-user scale.
