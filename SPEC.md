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

## Files Changed

- `core/views.py` — Coach endpoint (lines ~149-197)
- `static/js/coach.js` — Fallback tip + `generateFallbackTip()` function
- `AGENTS.md` — Model/prompt documentation
