# Speakora — Project Memory

## Architecture
- **Django backend** (PythonAnywhere ready): serves pages, stores practice history, proxies Groq API (Whisper + LLM)
- **Client-side JS** (browser): MediaPipe Pose, MediaRecorder + Groq Whisper (primary), Web Speech API (fallback), filler counting, pace calc

## Tech stack
- Django 4.2 + Tailwind CSS (CDN, neutral palette)
- MediaPipe Tasks Vision 0.10.18 (CDN) — pose landmarker, DrawingUtils instance API
- Groq Whisper (`whisper-large-v3-turbo`) — speech-to-text via `/api/transcribe/`
- Groq LLM (`llama-3.3-70b-versatile`) — coaching feedback via `/api/coach/`
- Web Speech API (SpeechRecognition + SpeechSynthesis) — optional live transcription, falls back silently if Google servers unreachable
- Chart.js (CDN) — progress dashboard charts
- SQLite — database

## Implementation status

### Step 1 ✅ — Django project + model
- Project: `coach/`, App: `core/`
- Model: `PracticeSession(student_id, date, duration_seconds, filler_word_count, avg_pace_wpm, posture_score, eye_contact_score, gestures_per_minute, openness_score, feedback_text, transcript)`

### Step 2 ✅ — Templates + URLs + Views
- `landing.html` — Vercel-inspired landing page with mesh gradient hero, feature cards, auth-conditional nav (Dashboard visible only when logged in)
- `coach.html` — practice screen (skeleton-only on dark gradient, session timer, single Get Feedback button)
- `results.html` — dark card layout (slate-900), stat cards with color-coded dots (green/amber/red), parsed STRENGTH/IMPROVE/TIP feedback cards, auto-generated summary line
- `dashboard.html` — Chart.js charts + sessions table + improvement summary
- `login.html` / `register.html` — auth forms with neutral-900 styling
- `base.html` — Tailwind CSS base template
- Routes: `/` landing, `/practice/` coach, `/results/`, `/dashboard/`, `/login/`, `/register/`, `/logout/`, `/api/coach/`, `/api/transcribe/`, `/api/save-session/`

### Step 3 ✅ — MediaPipe Pose Detection
- PoseLandmarker Lite from CDN with GPU delegate
- 33 landmarks tracked, skeleton drawn on canvas (mirrored)
- Cyan/teal skeleton colors (`#00e5ff` connectors, `#00b8d4` landmarks) on dark radial gradient background
- Posture analysis every 30 frames: shoulder tilt (>0.05 → -10), neck angle (>30 → -15), averaged across frames
- Scores stored in `sessionState.postureScores[]`
- Eye contact analysis every 30 frames: nose drift from center (<0.08 horizontally, <0.55 vertically = looking)
- Gesture analysis every 30 frames: wrist delta between frames, threshold >0.02
- Openness analysis every 30 frames: average wrist-to-shoulder distance, threshold >0.15

### Step 4 ✅ — Speech-to-Text + Filler Words + Pace
- **Primary**: MediaRecorder + Groq Whisper for on-demand transcription
- **Fallback**: Web Speech API for live streaming (fails silently on networks that can't reach Google)
- Filler word lists: `singleWordFillers = ['um', 'uh', 'like', 'emm', 'ah']`, `multiWordFillers = ['you know', 'i mean', 'kind of', 'sort of']`
- Multi-word fillers checked first with flexible whitespace regex; single words use `\b` boundaries
- Pace calculated every 5 seconds via interval
- Session timer (`MM:SS`) displayed in top bar via `setInterval(updateTimer, 1000)`
- Session data saved to DB via `POST /api/save-session/` → redirect to `/results/?session_id=`

### Step 5 ✅ — Groq Coaching (Get Feedback button)
- Django endpoint `POST /api/coach/` → Groq LLM
- Get Feedback button: transcribes audio via Whisper → counts fillers/words → if session >= 15s, sends stats to LLM → gets tip → TTS + saved to DB
- If session < 15s: skips Groq API, pushes message: "Please speak for at least five minutes before our agents can analyze your presentation and give you feedback."
- Debug logging added before the 15s check to verify data pipeline (transcript, wordCount, pace, fillerCount, postureScore)

### Step 6 ✅ — History Dashboard
- Chart.js line charts for filler count, pace, posture over time
- Table of recent sessions (date, duration, fillers, pace, posture)
- Improvement summary (first session vs last session comparison)
- Filtered by `request.user.username`

### Step 7 ✅ — Auth System
- `user_register` view: creates User, auto-login, redirects to `/practice/`
- `user_login` view: authenticates, respects `?next=` param, redirects to `/practice/`
- `user_logout` view: logs out, redirects to `/`
- `@login_required(login_url='/login/')` on `coach_page` and `dashboard`
- Landing page nav shows Log in / Register when unauthenticated, Dashboard / Log out when authenticated
- `save_session` uses `request.user.username` as `student_id`

### Step 8 🔲 — Deploy on PythonAnywhere

## Recent tweaks
- **Eye contact**: nose-drift thresholds tightened to `horizontalDrift > 0.08`, `verticalDrift > 0.55` for better detection of head movement
- **Posture**: shoulder tilt threshold raised to `0.05` (was `0.03`) with penalty reduced to `-10`; neck angle threshold raised to `30` (was `25`) with penalty reduced to `-15`

## Key decisions
- **Transcription**: MediaRecorder + Groq Whisper is the primary path (works everywhere with an API key). Web Speech API is a free bonus if Google servers are reachable.
- **Feedback**: On-demand "Get Feedback" button. Tip spoken via TTS + saved to DB. Minimum 5 min session required for analysis.
- **Skeleton-only display**: No video feed shown to user — skeleton on dark gradient to reduce self-consciousness and look cooler.
- **Stats hidden during practice**: Clean screen, just skeleton + timer + button.
- **Browser support**: Chrome/Edge/Brave recommended. Firefox lacks SpeechRecognition; Web Speech API is entirely optional.
- **Secrets**: Moved to env vars (`GROQ_API_KEY`, `DJANGO_SECRET_KEY`) with hardcoded defaults for dev.
- **Session state**: Single `sessionState` object, no `window._` globals.

## Known issues
- Groq API rate limits: ~30 req/min for Whisper, ~6000/day for chat. Exceeded → 429 errors (silent, just no feedback for that attempt).
- Web Speech API "network" error in some regions (India, corporate networks) — Google speech servers unreachable; falls back to Whisper automatically.
- MediaRecorded mimeType logs as empty string (`video/webm;codecs=vp8,opus`) — confirmed working, Chrome reports it inconsistently.
- `sessionState.sessionActive` must be set `true` before `tryWebSpeech()` or Web Speech never restarts on `onend`.
- Results page tip array is split on `\n` from DB; must be `join('\n')` before running STRENGTH/IMPROVE/TIP regex, not `tips[0]`.
