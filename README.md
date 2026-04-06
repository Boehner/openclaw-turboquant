# TurboQuant — Context Compression Plugin for OpenClaw

Inspired by [Google's TurboQuant](https://research.google/blog/turboquant-redefining-ai-efficiency-with-extreme-compression/) (ICLR 2026), this plugin brings the same hot/cold cache compression principle to OpenClaw at the application layer.

## What it does

Every time you send a message to an AI, the entire conversation history goes along with it. The longer the session, the more tokens you're burning — and tokens cost money.

TurboQuant splits your conversation into two zones:

- **Hot cache** — the last N turns, kept verbatim (full fidelity)
- **Cold cache** — everything older, compressed to ~25% of original size

Net result: **40–70% fewer tokens sent** on long sessions. Same quality, lower cost, faster responses.

## Install

1. Clone into your OpenClaw extensions folder:
```bash
git clone https://github.com/Boehner/openclaw-turboquant ~/.openclaw/extensions/turboquant
```

2. Add to your `openclaw.json`:
```json
{
  "plugins": {
    "allow": ["turboquant"],
    "load": {
      "paths": ["/path/to/.openclaw/extensions/turboquant"]
    },
    "entries": {
      "turboquant": {
        "enabled": true,
        "config": {
          "keepRecentTurns": 6,
          "compressionRatio": 0.25,
          "minTurnsBeforeCompression": 10
        }
      }
    }
  }
}
```

3. Restart the OpenClaw gateway.

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Enable/disable the plugin |
| `keepRecentTurns` | `6` | Number of recent turns to keep uncompressed (hot cache) |
| `compressionRatio` | `0.25` | Target size for compressed turns (0.25 = 25% of original) |
| `minTurnsBeforeCompression` | `10` | Don't compress until conversation has this many turns |

## How it works

Uses extractive summarization — scores every sentence by information density (term frequency × position), keeps the highest-value sentences, drops the rest. No AI calls needed for compression — it's fast, deterministic, and free.

The algorithm mirrors TurboQuant's core insight: **not all context is equally important**. Recent turns matter most. Old turns can be compressed aggressively without hurting response quality.

## Expected savings

On a 30-turn conversation:
- Without TurboQuant: ~3,200 tokens of history sent per request
- With TurboQuant: ~1,100 tokens (hot: 6 turns verbatim, cold: 24 turns at 25%)
- **Savings: ~2,100 tokens per request (~66%)**

## License

MIT
