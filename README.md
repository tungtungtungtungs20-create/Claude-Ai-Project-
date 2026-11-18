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

Turns a story written in Markdown into a narrated film with background music. For each scene it makes a **still image**, a **short video clip** and a **narration** track with the [Runway Dev API](https://docs.dev.runwayml.com/), then composes a **music** track for the whole film and stitches everything into **one video**.

- Images: `gen4_image` (can use up to 3 reference images to keep characters consistent)
- Clips: `gen4_turbo` (animates each scene's image, using it as the first frame)
- Narration: `eleven_v4` with a preset voice. Each scene is read with its neighbouring lines as context, so the narration flows from scene to scene.
- Music: `eleven_music_v2_5`, one instrumental track made to the film's exact length (you're billed per second requested)
- Stitching: [ffmpeg](https://ffmpeg.org/download.html), which must be installed (`brew install ffmpeg`, `sudo apt install ffmpeg`, or `winget install ffmpeg`)

### Setup

1. Sign in at the [Runway Dev Developer Portal](https://dev.runway.com/), create a project, and create a **project API key**.
2. Put the key in your environment (never commit it or share it):
   ```bash
   export RUNWAYML_API_SECRET="your-key"
   ```
3. Install: `npm install` (Node 20+), plus ffmpeg for the final film

### Write a story

See [`stories/noahs-ark.md`](stories/noahs-ark.md). Format:

```markdown
# Story Title
Style: added to every image prompt (art style, lighting, setting)
Ratio: 1280:720            # optional; 720:1280 for vertical
Duration: 5                # optional; clip length in seconds
Reference: noah = ../refs/noah.png   # optional, up to 3; use @noah in prompts
Voice: Bernard             # optional narrator preset (default Bernard)
Music: gentle orchestral strings, hopeful   # optional background music description
Music volume: 0.3          # optional, 0 to 1 (default 0.3)

## Scene title
Free text describing the scene (used for the image if there's no Image: line).
Image: optional; exactly what the still frame should show
Motion: optional; camera and subject movement for the clip
Narration: optional; what the narrator says over this scene
```

Each image prompt (description plus Style) and each Motion line can be at most 1000 characters.

### Run

```bash
npm run plan -- stories/noahs-ark.md       # free: shows every prompt and checks limits
npm run generate -- stories/noahs-ark.md   # spends credits: images, clips, narration, then the film
npm run generate -- stories/noahs-ark.md --images-only   # cheaper first pass
npm run stitch -- stories/noahs-ark.md     # free: rebuild the film from files already made
```

Other options: `--voice <name>`, `--music-volume <0-1>`, `--skip-narration`, `--skip-music`, `--skip-stitch`. Run with `--help` for the full list.

Output goes to `output/<story-title>/`:
- `scene-01-image.png`, `scene-01-video.mp4`, `scene-01-narration.mp3`, and so on for each scene
- `music.mp3` (if the story has a `Music:` line)
- `manifest.json` with the prompts and Runway task IDs
- **`<story-title>.mp4`, the finished film**

In the film, a scene lasts as long as its clip or its narration plus a short pause, whichever is longer. If the narration runs past the clip, the last frame is held so no words are cut off. Scenes without narration play silently. To shorten a held frame, write less narration or use a longer `Duration:`.

**Music** is made after all the scenes, because it's sized to the finished film's length. It's mixed in quietly with a fade-in and fade-out, and it dips automatically while the narrator speaks. If the film later gets longer, the track loops. To try a different track, delete `music.mp3` and run `generate` again; only the music is remade. To change just the volume, run `npm run stitch -- <story> --music-volume 0.2`, which is free.

- **Re-running is safe:** scenes that already have files are skipped, so a failed or interrupted run continues where it stopped. Use `--force` to regenerate everything.
- **Failed tasks** (for example, content moderation) are recorded in the manifest with their task ID and failure code. The other scenes still run.
- **Swapping models:** edit `src/config.js`. Each model has its own parameters and allowed values, so check its entry in the API reference first.

### Tests

`npm test` uses a fake Runway client, so it never calls the API or spends credits. The stitching tests build tiny clips with ffmpeg; they're skipped if ffmpeg isn't installed.
