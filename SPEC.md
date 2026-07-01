# AI Coaching Overhaul — SPEC

## Problem

The results page shows no AI coaching tips despite metrics being displayed. Three root causes:

1. **Empty API response**: `openai/gpt-oss-120b` is a reasoning model — its chain-of-thought consumes `max_completion_tokens`, returning `content: ""`.
2. **No fallback on failure**: When the API call fails (429 rate limit, network error, empty response), `coachingTips[]` stays empty → feedback panel stays hidden.
3. **Generic prompt**: Old prompt gave vague advice like "practice in front of a mirror."

## Changes

### 1. `core/views.py` — Model switch + system prompt rewrite

| Before | After |
|--------|-------|
| `openai/gpt-oss-120b` | `llama-3.3-70b-versatile` |
| Single `user` message | `system` + `user` messages |
| `reasoning_effort: "low"` | Removed (not applicable) |
| `max_completion_tokens: 2048` | `max_tokens: 1024` |
| Generic rules | Metric-specific concrete techniques |
| "suggest practicing in front of a mirror" | "Place a sticker next to the lens..." |

**System prompt** includes per-metric techniques:
- Eye contact < 60% → camera-lens / sticker / bridge-of-nose drill
- Smile < 40% → slight-smile / pen-between-teeth exercise
- Pace < 100 → metronome drill
- Pace > 180 → pause-at-punctuation exercise
- Fillers > 10 → silence / pause drill
- Blink abnormal → intentional blink exercise

### 2. `static/js/coach.js` — Client-side fallback tip

A `generateFallbackTip()` function creates a basic tip from available metrics. Added after the coach API try/catch:

```js
if (sessionState.coachingTips.length === 0) {
  sessionState.coachingTips.push(generateFallbackTip({...}));
}
```

This ensures `data.tips` is never empty — the feedback panel always shows.

### 3. `AGENTS.md` — Documentation

Update model reference and prompt description.

### 3. `deploy.py` — Mirror static files to `staticfiles/`

PythonAnywhere serves static files from `STATIC_ROOT` (`staticfiles/`), but `deploy.py` only uploaded to `STATICFILES_DIRS` (`static/`). Old code was always served.

**Fix**: After uploading each file under `static/`, also upload it to `staticfiles/` with the same relative path.

### 4. `static/js/coach.js` — Duration fix

`seconds`/`minutes` were calculated AFTER `await transcribeAndProcess()` (5-10s latency). Unnecessary LLM processing inflated session time.

**Fix**: Capture `seconds`/`minutes` BEFORE any async calls.

### 5. `static/js/coach.js` — Blink baseline fix

`maxEyeOpenDist: 0` meant the first sampled frame set the baseline. If the eyes were partially closed, the 40% threshold was too low → blinks never detected.

**Fix**: Initialize `maxEyeOpenDist: 0.02`.

## Files Changed

- `core/views.py` — Coach endpoint (lines ~149-197, model switch + system prompt)
- `static/js/coach.js` — Fallback tip (`generateFallbackTip()`), duration capture, blink baseline
- `deploy.py` — Static files mirroring to `staticfiles/`
- `AGENTS.md` — Batch 6/7/7b documentation
