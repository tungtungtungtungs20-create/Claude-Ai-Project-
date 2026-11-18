// Tests use a fake Runway client, so they never call the API or spend credits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TaskFailedError } from '@runwayml/sdk';
import { parseStory, slugify } from '../src/story.js';
import { buildPlan, runPlan } from '../src/pipeline.js';
import { matchingVideoRatio } from '../src/config.js';

const STORY = `# Test Tale
Style: watercolor
Reference: hero_1 = https://example.com/hero.png

## Opening
A fox on a hill.
Motion: slow pan

## Ending
Description that is ignored when an Image line exists.
Image: The fox asleep under stars.
`;

function fakeClient({ failVideoFor } = {}) {
  const calls = { image: [], video: [] };
  let n = 0;
  const task = (kind, body) => ({
    waitForTaskOutput: async () => {
      const id = `${kind}-task-${++n}`;
      if (kind === 'video' && failVideoFor && body.promptText === failVideoFor) {
        throw new TaskFailedError({ id, status: 'FAILED', failure: 'moderation', failureCode: 'SAFETY.INPUT.TEXT', createdAt: '' });
      }
      return { id, status: 'SUCCEEDED', output: [`https://cdn.example.com/${id}.${kind === 'image' ? 'png' : 'mp4'}`] };
    },
  });
  return {
    calls,
    textToImage: { create: (body) => (calls.image.push(body), task('image', body)) },
    imageToVideo: { create: (body) => (calls.video.push(body), task('video', body)) },
  };
}

const fakeFetch = async (url) => ({
  ok: true,
  headers: new Headers({ 'content-type': url.endsWith('.png') ? 'image/png' : 'video/mp4' }),
  arrayBuffer: async () => new TextEncoder().encode(url).buffer,
});

test('parses title, settings, references and scenes', () => {
  const story = parseStory(STORY);
  assert.equal(story.title, 'Test Tale');
  assert.equal(story.style, 'watercolor');
  assert.deepEqual(story.references, [{ tag: 'hero_1', source: 'https://example.com/hero.png' }]);
  assert.equal(story.scenes.length, 2);
  assert.equal(story.scenes[0].text, 'A fox on a hill.');
  assert.equal(story.scenes[0].motion, 'slow pan');
  assert.equal(story.scenes[1].image, 'The fox asleep under stars.');
});

test('ignores HTML comments, including multi-line ones', () => {
  const story = parseStory('# T\n<!--\nReference: hero = x.png\n-->\n## S\nA scene. <!-- note -->');
  assert.deepEqual(story.references, []);
  assert.equal(story.scenes[0].text, 'A scene.');
});

test('rejects bad reference tags', () => {
  assert.throws(() => parseStory('# T\nReference: a-b = x.png\n## S\nx'), /Bad "Reference:"/);
});

test('builds prompts with the story style and validates limits', () => {
  const plan = buildPlan(parseStory(STORY));
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.scenes[0].imagePrompt, 'A fox on a hill. watercolor');
  assert.equal(plan.scenes[1].imagePrompt, 'The fox asleep under stars. watercolor');
  assert.equal(plan.videoRatio, '1280:720');

  const long = buildPlan(parseStory(`# T\n## S\n${'x'.repeat(1001)}`));
  assert.match(long.errors.join('\n'), /limit is 1000/);
  assert.match(buildPlan(parseStory('# T\n## S\nx'), { ratio: '3:2' }).errors.join(), /isn't supported/);
  assert.match(buildPlan(parseStory('# T')).errors.join(), /No scenes/);
});

test('picks a video ratio matching the image orientation', () => {
  assert.equal(matchingVideoRatio('1920:1080'), '1280:720');
  assert.equal(matchingVideoRatio('1080:1920'), '720:1280');
  assert.equal(matchingVideoRatio('1024:1024'), '960:960');
  assert.equal(matchingVideoRatio('2112:912'), '1584:672');
});

test('generates image then video for each scene, and skips finished scenes on re-run', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'sts-'));
  const plan = buildPlan(parseStory(STORY));
  const client = fakeClient();

  const res = await runPlan(plan, { client, outDir, fetchFn: fakeFetch, log: () => {} });
  assert.equal(res.failures, 0);
  assert.equal(client.calls.image.length, 2);
  assert.equal(client.calls.video.length, 2);

  const img = client.calls.image[0];
  assert.equal(img.model, 'gen4_image');
  assert.equal(img.ratio, '1280:720');
  assert.deepEqual(img.referenceImages, [{ tag: 'hero_1', uri: 'https://example.com/hero.png' }]);

  const vid = client.calls.video[0];
  assert.equal(vid.model, 'gen4_turbo');
  assert.equal(vid.promptImage, 'https://cdn.example.com/image-task-1.png');
  assert.equal(vid.promptText, 'slow pan');
  assert.equal(vid.duration, 5);

  const files = (await readdir(outDir)).sort();
  assert.deepEqual(files, ['manifest.json', 'scene-01-image.png', 'scene-01-video.mp4', 'scene-02-image.png', 'scene-02-video.mp4']);
  const manifest = JSON.parse(await readFile(path.join(outDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.scenes['scene-01'].imageTaskId, 'image-task-1');

  const again = fakeClient();
  await runPlan(plan, { client: again, outDir, fetchFn: fakeFetch, log: () => {} });
  assert.equal(again.calls.image.length + again.calls.video.length, 0);
});

test('resumes a missing video from the saved image as a data URI', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'sts-'));
  await writeFile(path.join(outDir, 'scene-01-image.png'), Buffer.from([1, 2, 3]));
  const plan = buildPlan(parseStory('# T\n## Only\nA scene.'));
  const client = fakeClient();
  await runPlan(plan, { client, outDir, fetchFn: fakeFetch, log: () => {} });
  assert.equal(client.calls.image.length, 0);
  assert.equal(client.calls.video[0].promptImage, 'data:image/png;base64,AQID');
});

test('records a failed task and continues with the next scene', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'sts-'));
  const plan = buildPlan(parseStory(STORY));
  const client = fakeClient({ failVideoFor: 'slow pan' });
  const res = await runPlan(plan, { client, outDir, fetchFn: fakeFetch, log: () => {} });
  assert.equal(res.failures, 1);
  assert.equal(client.calls.video.length, 2);
  const manifest = JSON.parse(await readFile(path.join(outDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.scenes['scene-01'].videoError.failureCode, 'SAFETY.INPUT.TEXT');
  assert.equal(manifest.scenes['scene-01'].image, 'scene-01-image.png');
  assert.equal(manifest.scenes['scene-02'].video, 'scene-02-video.mp4');
});

test('slugify', () => {
  assert.equal(slugify('The Ark & the Rainbow!'), 'the-ark-the-rainbow');
});
