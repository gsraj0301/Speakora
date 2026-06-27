# Decision: Face Skeleton vs Raw Webcam Feed

## Context

Users practice presentations by speaking into their webcam. The canvas displays either the raw video feed or a MediaPipe wireframe overlay. The choice affects user self-consciousness, usefulness of feedback, and overall experience.

## Options Considered

### Option A — Raw Webcam Feed (full face visible)
- Show the user's live camera feed on canvas
- No wireframe overlay
- MediaPipe analysis still runs silently in background

| Pros | Cons |
|------|------|
| User sees their natural expressions and posture | High self-consciousness — users stare at themselves and get distracted |
| No tech overhead, simplest rendering | Users adjust appearance instead of focusing on content |
| | Studies show people perform worse when watching themselves in real-time |

### Option B — Face Skeleton (wireframe only, default)
- Show a clean face wireframe (oval, eyes, brows, nose, lips) on dark gradient
- No real face visible by default
- Toggle button lets user switch to raw feed when desired
- MediaPipe analysis always running regardless of view

| Pros | Cons |
|------|------|
| Reduces self-consciousness — user sees a techy skeleton, not themselves | Less natural — some users may want to see their face |
| Looks cooler and more "AR coaching" aesthetic | Wireframe can be distracting if too dense |
| User focuses on speaking, not appearance | |
| Toggle gives user control when they want to check | |

## Decision

**Chosen: Option B — Face Skeleton as default with toggle to raw feed.**

### Rationale
1. **Primary goal**: Reduce self-consciousness. The whole point of the tool is to help users forget they're being analyzed so they speak naturally. A skeleton wireframe achieves this better than a mirror.
2. **Toggle preserves flexibility**: Users who want to see their face (e.g., to check posture or expression) can toggle the raw feed on at any time.
3. **Clean skeleton, not dense mesh**: Rather than drawing all 478 landmarks + contour connections (which looks like a messy blob), we draw only the key facial features — face oval, eyes, eyebrows, nose, lips — with thin cyan lines and no landmark dots. This gives a sleek, minimal AR look that feels like a coaching tool, not a surveillance system.
4. **Analysis is decoupled from rendering**: MediaPipe still tracks all 478 landmarks and computes every metric regardless of what's drawn. Switching views has zero effect on feedback accuracy.

### Implementation

- Default canvas: dark radial gradient background + selective face skeleton (feature groups drawn individually for a clean look)
- Toggle button: switches `showVideo` flag, drawing the mirrored webcam feed behind the skeleton
- Analysis pipeline: runs every 30 frames regardless of view mode
- No video is ever stored or uploaded — only audio is recorded for transcription

---

# Decision: Coaching Model Selection

## Context

The backend proxies the session transcript + stats to a Groq LLM which returns structured STRENGTH/IMPROVE/TIP feedback. The model must be free on Groq, fast enough for interactive use (~150 tokens), and reliable at following structured output rules.

## Options Considered

| Model | Speed (tok/s) | Quality (MMLU) | Free Tier | Notes |
|-------|-------|-------|-----------|-------|
| `llama-3.3-70b-versatile` (current) | ~280 | ~70% | 30 RPM / 12K TPM | Slowest option, decent quality |
| `openai/gpt-oss-120b` | ~500 | 90% | 30 RPM / 8K TPM | Best quality, JSON Schema, production-stable |
| `openai/gpt-oss-20b` | ~1000 | 85.3% | 30 RPM / 8K TPM | Fastest, strong quality |
| `meta-llama/llama-4-scout-17b-16e-instruct` | ~750 | ~70% | 30 RPM / 30K TPM | Preview status, 8K max output |

## Decision

**Chosen: `openai/gpt-oss-120b`**

### Rationale
1. **Highest quality**: 90% MMLU vs ~70% for Llama 3.3 70B. Better reasoning means more insightful coaching feedback for students.
2. **Fast enough**: ~500 tok/s generates a 150-token response in ~0.3s. The bottleneck is the Whisper transcription, not the LLM.
3. **Production-stable**: Not a preview model. Won't disappear or change behavior mid-semester.
4. **Free on Groq**: Same free tier (30 RPM) as the previous model. No cost change.
5. **JSON Schema support**: Enables guaranteed structured output in future iterations (currently using prompt engineering for STRENGTH/IMPROVE/TIP format).

### Implementation

- Single-line change in `core/views.py`: model string from `llama-3.3-70b-versatile` → `openai/gpt-oss-120b`
- Prompt and temperature (0.7) unchanged
- All rate limits and API endpoint remain the same
