// Joins the scene clips into one film, laying each scene's narration over its clip.
// Needs ffmpeg and ffprobe installed (https://ffmpeg.org/download.html).
//
// If a scene's narration runs longer than its clip, the clip's last frame is
// held until the narration (plus a short pause) finishes, so no words are cut off.
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { DEFAULTS } from './config.js';
import { findFile } from './pipeline.js';

const run = promisify(execFile);

export async function stitchFilm(plan, {
  outDir,
  output = path.join(outDir, `${plan.slug}.mp4`),
  log = console.log,
  ffmpeg = 'ffmpeg',
  ffprobe = 'ffprobe',
  tailSeconds = DEFAULTS.narrationTailSeconds,
  fps = DEFAULTS.fps,
}) {
  await checkTool(ffmpeg);
  await checkTool(ffprobe);

  const [width, height] = plan.videoRatio.split(':').map((n) => Math.round(Number(n) / 2) * 2);
  const segDir = path.join(outDir, 'segments');
  await mkdir(segDir, { recursive: true });

  const segments = [];
  const missing = [];
  for (const scene of plan.scenes) {
    const video = await findFile(outDir, `${scene.id}-video`);
    if (!video) {
      missing.push(scene.id);
      continue;
    }
    const audio = await findFile(outDir, `${scene.id}-narration`);
    const videoSeconds = await probeDuration(ffprobe, video);
    const audioSeconds = audio ? await probeDuration(ffprobe, audio) : 0;
    const seconds = Math.max(videoSeconds, audio ? audioSeconds + tailSeconds : 0);
    const hold = Math.max(0, seconds - videoSeconds);

    const segment = path.join(segDir, `${scene.id}.mp4`);
    const audioInput = audio
      ? ['-i', audio]
      : ['-f', 'lavfi', '-t', seconds.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo'];
    // Same size, frame rate and audio format for every segment, so they join cleanly.
    const filter =
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p,` +
      `tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)}[v];` +
      `[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad[a]`;

    log(`${scene.id}: ${seconds.toFixed(1)}s${audio ? ` (narration ${audioSeconds.toFixed(1)}s)` : ' (no narration)'}`);
    await run(ffmpeg, [
      '-y', '-loglevel', 'error',
      '-i', video, ...audioInput,
      '-filter_complex', filter,
      '-map', '[v]', '-map', '[a]',
      '-t', seconds.toFixed(3),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      segment,
    ]);
    segments.push(segment);
  }

  if (missing.length) log(`Skipping scenes with no video yet: ${missing.join(', ')}`);
  if (!segments.length) throw new Error(`No scene videos found in ${outDir}. Generate the clips first.`);

  const listFile = path.join(segDir, 'concat.txt');
  await writeFile(listFile, segments.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  await run(ffmpeg, [
    '-y', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', listFile,
    '-c', 'copy', '-movflags', '+faststart',
    output,
  ]);

  const duration = await probeDuration(ffprobe, output);
  return { output, duration, scenes: segments.length, missing };
}

async function checkTool(cmd) {
  try {
    await run(cmd, ['-version']);
  } catch {
    throw new Error(`"${cmd}" isn't installed or isn't on your PATH. Install ffmpeg (https://ffmpeg.org/download.html) to stitch the film.`);
  }
}

export async function probeDuration(ffprobe, file) {
  const { stdout } = await run(ffprobe, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ]);
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds)) throw new Error(`Couldn't read the length of ${file}`);
  return seconds;
}
