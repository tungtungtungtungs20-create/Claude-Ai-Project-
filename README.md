# Claude-Ai-Project-
# Claude AI ProjectWelcome to my AI-powered creative project!## PurposeExploring artificial intelligence, creative storytelling, animation, and innovative ideas using Claude AI.## Projects- AI storytelling- Cinematic animation scripts- Bible and historical storytelling- Creative AI experiments

# Claude AI Project

Welcome to my AI-powered creative project!

## Purpose
Exploring artificial intelligence, creative storytelling, animation, and innovative ideas using Claude AI.

## Projects
- AI storytelling
- Cinematic animation scripts
- Bible and historical storytelling
- Creative AI experiments


## Story → Scenes (Runway Dev)

Turns a story written in Markdown into one **still image** and one **short video clip** per scene, using the [Runway Dev API](https://docs.dev.runwayml.com/).

- Images: `gen4_image` (can use up to 3 reference images to keep characters consistent)
- Clips: `gen4_turbo` (animates each scene's image, using it as the first frame)

### Setup

1. Sign in at the [Runway Dev Developer Portal](https://dev.runway.com/), create a project, and create a **project API key**.
2. Put the key in your environment (never commit it or share it):
   ```bash
   export RUNWAYML_API_SECRET="your-key"
   ```
3. Install: `npm install` (Node 20+)

### Write a story

See [`stories/noahs-ark.md`](stories/noahs-ark.md). Format:

```markdown
# Story Title
Style: added to every image prompt (art style, lighting, setting)
Ratio: 1280:720            # optional; 720:1280 for vertical
Duration: 5                # optional; clip length in seconds
Reference: noah = ../refs/noah.png   # optional, up to 3; use @noah in prompts

## Scene title
Free text describing the scene (used for the image if there's no Image: line).
Image: optional; exactly what the still frame should show
Motion: optional; camera and subject movement for the clip
```

Each image prompt (description plus Style) and each Motion line can be at most 1000 characters.

### Run

```bash
npm run plan -- stories/noahs-ark.md       # free: shows every prompt and checks limits
npm run generate -- stories/noahs-ark.md   # spends credits: images + clips
npm run generate -- stories/noahs-ark.md --images-only   # cheaper first pass
```

Output goes to `output/<story-title>/`: `scene-01-image.png`, `scene-01-video.mp4`, …, plus `manifest.json` with prompts and Runway task IDs.

- **Re-running is safe:** scenes that already have files are skipped, so a failed or interrupted run continues where it stopped. Use `--force` to regenerate everything.
- **Failed tasks** (for example, content moderation) are recorded in the manifest with their task ID and failure code. The other scenes still run.
- **Swapping models:** edit `src/config.js`. Each model has its own parameters and allowed values, so check its entry in the API reference first.

### Tests

`npm test` uses a fake Runway client, so it never calls the API or spends credits.
