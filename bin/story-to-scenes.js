#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import RunwayML from '@runwayml/sdk';
import { parseStory } from '../src/story.js';
import { buildPlan, describePlan, runPlan } from '../src/pipeline.js';

const HELP = `Turn a story into scene images and video clips with Runway.

Usage:
  node bin/story-to-scenes.js <story.md> [options]

Options:
  --dry-run        Show the scenes and prompts; don't call Runway (free)
  --images-only    Generate the still images, skip the video clips
  --force          Regenerate scenes that already have files
  --out <dir>      Output folder (default: output/<story-title>)
  --ratio <w:h>    Image ratio, e.g. 1280:720 or 720:1280 (default 1280:720)
  --duration <s>   Clip length in seconds (default 5)
  -h, --help       Show this help

Needs RUNWAYML_API_SECRET set to a Runway Dev project API key.
Every image and clip uses project credits.`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'dry-run': { type: 'boolean' },
      'images-only': { type: 'boolean' },
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
  if (!process.env.RUNWAYML_API_SECRET) {
    console.error('RUNWAYML_API_SECRET is not set. Create a project API key in the Runway Dev Developer Portal and set it in your environment (never commit it).');
    process.exit(1);
  }

  const outDir = path.resolve(values.out ?? path.join('output', plan.slug));
  console.log(`Generating ${plan.scenes.length} scene(s) into ${outDir}`);

  const client = new RunwayML(); // reads RUNWAYML_API_SECRET
  const { failures, manifestPath } = await runPlan(plan, {
    client,
    outDir,
    storyDir: path.dirname(storyPath),
    imagesOnly: values['images-only'],
    force: values.force,
  });

  console.log(`\nDone. Details in ${manifestPath}`);
  if (failures) {
    console.error(`${failures} scene(s) failed; see the manifest for task IDs. Re-run to retry only the missing scenes.`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
