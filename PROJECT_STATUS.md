# Presentation Coach — Project Status

## Overview
A free AI-powered presentation coach for college students. Records video + audio during a practice presentation, then gives structured feedback on filler words, pace, posture, body language, and provides actionable improvement tips.

**Goal**: Free platform on PythonAnywhere for all college students.

---

## Current Features

### ✅ Working

| Feature | How it works | Tech |
|---|---|---|
| **Landing page** | Vercel-inspired hero with mesh gradient, feature cards, auth-conditional nav | Tailwind neutral palette |
| **User auth** | Register / Login / Logout with Django's auth_user table | Django auth + session |
| **Protected routes** | `/practice/` and `/dashboard/` redirect to login if unauthenticated | `@login_required` |
| **Live webcam** | Camera stream, hidden `<video>` element (only skeleton shown) | `getUserMedia` |
| **Pose skeleton overlay** | Cyan/teal hologram-style skeleton on dark radial gradient | MediaPipe Pose Landmarker Lite (CDN) |
| **Posture scoring** | Shoulder tilt + neck angle → score 0–100 every 30 frames | JS in `analyzePosture()` |
| **Audio recording** | Full session recorded via MediaRecorder | `MediaRecorder` API |
| **Speech-to-text** | Full audio → Groq Whisper → transcript | `POST /api/transcribe/` → Whisper Large V3 Turbo |
| **Filler word detection** | Regex on transcript: um, uh, like, you know, emm, ah | JS `countFillers()` |
| **Pace calculation** | Words-per-minute from transcript duration | JS `countWords()` + timer |
| **Session timer** | Live `MM:SS` displayed in top bar | `setInterval(updateTimer, 1000)` |
| **Debug logging** | Console logs transcript, wordCount, pace, fillers, posture before coaching call | `console.log` in click handler |
| **Get Feedback button** | Sends transcript + stats → Groq Llama → spoken tip | `POST /api/coach/` → Llama 3.3 70B |
| **15s feedback guard** | Sessions < 15s skip Groq API with message to speak longer | `seconds < 15` check in JS |
| **Save to DB** | Session saved to `PracticeSession` with `student_id = username` | `POST /api/save-session/` |
| **Results page** | Dark card layout (slate-900), stat cards with color dots, parsed STRENGTH/IMPROVE/TIP sections | DRF-free JSON + regex |
| **History dashboard** | Chart.js line charts + sessions table + improvement summary | Filtered by user |
| **Groq free tier** | Whisper + Llama via free API key | Groq API ($0, signup with email) |
| **Echo prevention** | Mic muted during TTS, video element muted | `video.muted`, audio tracks toggled |

### ❌ Not Yet Built

| Feature | Priority | Notes |
|---|---|---|
| **Eye contact detection** | High | Track nose position relative to camera center |
| **Hand gesture analysis** | High | Track wrist landmarks 15,16 movement |
| **PythonAnywhere deploy** | Medium | After core features stable |
| **Firefox support** | Low | MediaRecorder works, Whisper is browser-agnostic |

---

## Tech Stack

| Layer | Tech | Cost |
|---|---|---|
| Backend | Django 4.2 + SQLite | Free |
| Frontend | Tailwind CSS 3 (CDN, neutral palette) | Free |
| Pose detection | MediaPipe Tasks Vision 0.10.18 (CDN) | Free |
| Audio recording | Browser MediaRecorder API | Free |
| Speech-to-text | Groq Whisper Large V3 Turbo | Free (20 req/min) |
| LLM coaching | Groq Llama 3.3 70B Versatile | Free (30 req/min) |
| TTS feedback | Browser SpeechSynthesis API | Free |
| Charts | Chart.js (CDN) | Free |
| Hosting | PythonAnywhere (future) | Free tier |

---

## File Structure

```
coach/
├── AGENTS.md                       # AI assistant memory
├── PROJECT_STATUS.md               # This file
├── DESIGN-vercel.md                # Vercel design language spec
├── manage.py
├── db.sqlite3
├── static/
│   └── js/
│       └── coach.js                # All client JS (MediaPipe, recorder, transcription, filler counting, UI, timer)
├── templates/
│   ├── base.html                   # Tailwind base template
│   ├── landing.html                # Vercel-inspired landing page
│   ├── coach.html                  # Practice screen (skeleton + timer + Get Feedback button)
│   ├── results.html                # Post-session results page
│   ├── dashboard.html              # Chart.js charts + history table
│   ├── login.html                  # Login form
│   └── register.html               # Registration form
├── coach/
│   ├── settings.py                 # Django settings, GROQ_API_KEY here
│   ├── urls.py                     # Routes: /, /practice/, /results/, /dashboard/, /login/, /register/, /logout/, /api/*
│   └── wsgi.py
└── core/
    ├── models.py                   # PracticeSession model
    ├── views.py                    # landing_page, coach_page, user_register, user_login, user_logout, transcribe, coach, save_session, results_page, dashboard
    └── admin.py
```

---

## Known Issues

### Critical
1. **Groq API key in settings.py** — hardcoded, should be environment variable for security on PythonAnywhere
2. **No CSRF protection on API** — `@csrf_exempt` on transcribe/coach views (acceptable for college project but needs proper handling before real deployment)

### Moderate
3. **Memory leak** — `audioChunks[]` grows unbounded during long sessions. Should upload in background or cap size.
4. **No loading spinner** — "Processing..." text replaces button, no visual feedback while LLM processes
5. **No session timeout** — If user stays on page for hours, MediaPipe runs continuously (GPU usage)
6. **Graceful error handling** — If Groq API is down, no fallback message for students

### Minor
7. **Pace calculation** — Only calculated on final transcript, not live
8. **Results page refresh** — `sessionStorage` data lost if user refreshes results page
9. **Mobile not tested** — `getUserMedia` with `audio: true` may behave differently on phones
10. **No recording indicator** — Student can't tell if mic is live (no red dot/level meter)

---

## Future Roadmap

### Phase 1 — Core Analysis
- Eye contact: check if nose landmark is centered in frame
- Hand gestures: track wrist movement frequency
- Enhanced posture: body openness (arms not crossed)

### Phase 2 — Launch
- Move API key to env variable
- Deploy on PythonAnywhere
- Share with college students
