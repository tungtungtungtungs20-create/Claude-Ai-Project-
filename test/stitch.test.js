// Builds tiny real clips with ffmpeg and checks the stitched film. Skipped if ffmpeg isn't installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseStory } from '../src/story.js';
import { buildPlan } from '../src/pipeline.js';
import { measureScenes, probeDuration, stitchFilm } from '../src/stitch.js';

let hasFfmpeg = true;
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
} catch {
  hasFfmpeg = false;
}

const ff = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
const clip = (file, seconds, size = '320x180') =>
  ff('-f', 'lavfi', '-i', `testsrc=size=${size}:rate=24:duration=${seconds}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file);
const tone = (file, seconds) => ff('-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, file);
const streams = (file) =>
  execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'csv=p=0', file]).toString().trim().split('\n').sort();

test('stitches clips, holds the last frame for long narration, and adds silence where there is none', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'stitch-'));
  // Scene 1: 2s clip, 3s narration -> 3s + 0.6s tail. Scene 2: 2s clip, no narration -> 2s.
  // Scene 3: 2s clip of a different size, 1s narration -> clip length wins (2s).
  clip(path.join(outDir, 'scene-01-video.mp4'), 2);
  tone(path.join(outDir, 'scene-01-narration.mp3'), 3);
  clip(path.join(outDir, 'scene-02-video.mp4'), 2);
  clip(path.join(outDir, 'scene-03-video.mp4'), 2, '200x200');
  tone(path.join(outDir, 'scene-03-narration.mp3'), 1);

  const plan = buildPlan(parseStory('# Little Film\n## A\nx\n## B\ny\n## C\nz\n## D\nnot generated yet'), { ratio: '1280:720' });
  const logs = [];
  const film = await stitchFilm(plan, { outDir, log: (m) => logs.push(m) });

  assert.equal(film.output, path.join(outDir, 'little-film.mp4'));
  assert.equal(film.scenes, 3);
  assert.deepEqual(film.missing, ['scene-04']);
  assert.ok(Math.abs(film.duration - 7.6) < 0.3, `expected about 7.6s, got ${film.duration}`);
  assert.deepEqual(streams(film.output), ['audio', 'video,1280,720']);
  assert.ok(Math.abs((await probeDuration('ffprobe', path.join(outDir, 'segments', 'scene-01.mp4'))) - 3.6) < 0.2);
  assert.ok(logs.some((l) => l.includes('scene-04')));
});

// Average loudness (dB) of a stretch of a file's audio; -91 means silence.
const meanVolume = (file, start, seconds) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-ss', String(start), '-t', String(seconds), '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = r.stderr.match(/mean_volume:\s*(-?[\d.]+|-inf) dB/);
  return !m || m[1] === '-inf' ? -91 : Number(m[1]);
};

test('mixes looping, faded background music under the film without changing its length', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'stitch-'));
  clip(path.join(outDir, 'scene-01-video.mp4'), 2);
  tone(path.join(outDir, 'scene-01-narration.mp3'), 1);
  clip(path.join(outDir, 'scene-02-video.mp4'), 3); // silent scene: only music should be heard
  // A 2s "music" track, shorter than the film, so it has to loop.
  ff('-f', 'lavfi', '-i', 'sine=frequency=220:duration=2', path.join(outDir, 'music.mp3'));

  const plan = buildPlan(parseStory('# Music Film\nMusic: test\n## A\nx\n## B\ny'));
  const measured = await measureScenes(plan, { outDir });
  assert.ok(Math.abs(measured.totalSeconds - 5) < 0.2, `expected about 5s, got ${measured.totalSeconds}`);

  const film = await stitchFilm(plan, { outDir, log: () => {} });
  assert.equal(film.music, 'music.mp3');
  assert.ok(Math.abs(film.duration - 5) < 0.3, `expected about 5s, got ${film.duration}`);
  assert.deepEqual(streams(film.output), ['audio', 'video,1280,720']);
  // Music is heard in the silent scene (after it has looped)...
  assert.ok(meanVolume(film.output, 3, 1) > -45, 'music should be audible in the silent scene');

  // ...and that same stretch is silent when music is turned off.
  const silent = await stitchFilm(plan, { outDir, log: () => {}, music: false, output: path.join(outDir, 'no-music.mp4') });
  assert.equal(silent.music, null);
  assert.ok(meanVolume(silent.output, 3, 1) < -80, 'no music: the silent scene should be silent');
});

test('explains when there is nothing to stitch', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'stitch-'));
  const plan = buildPlan(parseStory('# T\n## A\nx'));
  await assert.rejects(stitchFilm(plan, { outDir, log: () => {} }), /No scene videos found/);
});

test('explains when ffmpeg is missing', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'stitch-'));
  const plan = buildPlan(parseStory('# T\n## A\nx'));
  await assert.rejects(stitchFilm(plan, { outDir, ffmpeg: 'no-such-ffmpeg-binary' }), /isn't installed/);
});
