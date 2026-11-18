#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import RunwayML from '@runwayml/sdk';
import { parseStory } from '../src/story.js';
import { buildPlan, describePlan, generateMusic, runPlan } from '../src/pipeline.js';
import { measureScenes, stitchFilm } from '../src/stitch.js';

const HELP = `Turn a story into scene images, video clips, narration and background
music with Runway, then stitch them into one film.

Usage:
  node bin/story-to-scenes.js <story.md> [options]

Options:
  --dry-run        Show the scenes and prompts; don't call Runway (free)
  --images-only    Generate the still images, skip clips, narration and stitching
  --skip-narration Don't generate narration (the film is silent where none exists)
  --skip-music     Don't generate or mix in background music
  --skip-stitch    Generate scenes but don't build the final film
  --stitch-only    Only build the final film from files already generated (free)
  --force          Regenerate scenes that already have files
  --out <dir>      Output folder (default: output/<story-title>)
  --ratio <w:h>    Image ratio, e.g. 1280:720 or 720:1280 (default 1280:720)
  --duration <s>   Clip length in seconds (default 5)
  --voice <name>   Narrator preset voice (default Bernard)
  --music-volume <0-1>  Background music level under the narration (default 0.3)
  --subtitles <mode>    soft (switchable track, default), burn (drawn into the picture) or off
  -h, --help       Show this help

Needs RUNWAYML_API_SECRET set to a Runway Dev project API key.
Every image, clip, narration and music track uses project credits.
Stitching needs ffmpeg installed.`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'dry-run': { type: 'boolean' },
      'images-only': { type: 'boolean' },
      'skip-narration': { type: 'boolean' },
      'skip-stitch': { type: 'boolean' },
      'skip-music': { type: 'boolean' },
      'music-volume': { type: 'string' },
      subtitles: { type: 'string' },
      'stitch-only': { type: 'boolean' },
      voice: { type: 'string' },
      force: { type: 'boolean' },
      out: { type: 'string' },
      ratio: { type: 'string' },
      duration: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help || positionals.length !== 1) {
    console.log(HELP);
    process.exit(values.help ? 0 : 1);
  }

  const storyPath = path.resolve(positionals[0]);
  const story = parseStory(await readFile(storyPath, 'utf8'));
  const plan = buildPlan(story, {
    ratio: values.ratio,
    voice: values.voice,
    subtitles: values.subtitles?.toLowerCase(),
    musicVolume: values['music-volume'] !== undefined ? Number(values['music-volume']) : undefined,
    duration: values.duration !== undefined ? Number(values.duration) : undefined,
  });

  if (values['dry-run']) {
    console.log(describePlan(plan));
    if (plan.errors.length) {
      console.error(`\nProblems to fix before generating:\n- ${plan.errors.join('\n- ')}`);
      process.exit(1);
    }
    console.log('\nLooks good. Run again without --dry-run to generate.');
    return;
  }

  if (plan.errors.length) {
    console.error(`Problems to fix before generating:\n- ${plan.errors.join('\n- ')}`);
    process.exit(1);
  }

  const outDir = path.resolve(values.out ?? path.join('output', plan.slug));
  const stitch = async () => {
    console.log(`\nStitching film...`);
    const film = await stitchFilm(plan, { outDir, music: !values['skip-music'] });
    const extras = [film.music && 'music', film.subtitles && `${film.subtitles.count} subtitles`].filter(Boolean);
    console.log(`Film: ${film.output} (${film.duration.toFixed(1)}s, ${film.scenes} scenes${extras.length ? `, with ${extras.join(' and ')}` : ''})`);
    if (film.subtitles) console.log(`Subtitles file: ${film.subtitles.file}`);
  };

  if (values['stitch-only']) {
    await stitch();
    return;
  }

  if (!process.env.RUNWAYML_API_SECRET) {
    console.error('RUNWAYML_API_SECRET is not set. Create a project API key in the Runway Dev Developer Portal and set it in your environment (never commit it).');
    process.exit(1);
  }

  console.log(`Generating ${plan.scenes.length} scene(s) into ${outDir}`);

  const client = new RunwayML(); // reads RUNWAYML_API_SECRET
  const { failures, manifestPath } = await runPlan(plan, {
    client,
    outDir,
    storyDir: path.dirname(storyPath),
    imagesOnly: values['images-only'],
    narration: !values['skip-narration'],
    force: values.force,
  });

  console.log(`\nScenes done. Details in ${manifestPath}`);
  if (failures) {
    console.error(`${failures} scene(s) failed; see the manifest for task IDs. Re-run to retry only the missing scenes, then the film is stitched.`);
    process.exit(2);
  }
  if (values['images-only']) return;

  // Music is sized to the finished film, so it's made once every scene is done.
  let musicFailed = false;
  if (plan.music && !values['skip-music']) {
    const { totalSeconds } = await measureScenes(plan, { outDir });
    ({ failed: musicFailed = false } = await generateMusic(plan, { client, outDir, seconds: totalSeconds, force: values.force }));
  }

  if (!values['skip-stitch']) await stitch();
  if (musicFailed) {
    console.error('The music task failed (see the manifest), so the film has no music. Re-run to try the music again.');
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
