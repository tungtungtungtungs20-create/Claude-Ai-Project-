// Joins the scene clips into one film, laying each scene's narration over its clip,
// mixes in background music if there is any, and adds subtitles from the narration.
// Needs ffmpeg and ffprobe installed (https://ffmpeg.org/download.html).
//
// If a scene's narration runs longer than its clip, the clip's last frame is
// held until the narration (plus a short pause) finishes, so no words are cut off.
import { execFile } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { DEFAULTS } from './config.js';
import { findFile } from './pipeline.js';
import { buildCues, toSrt } from './subtitles.js';

const run = promisify(execFile);

/**
 * Work out how long each scene will run in the film, from the files on disk.
 * Used to size the music track before the film exists.
 */
export async function measureScenes(plan, {
  outDir,
  ffprobe = 'ffprobe',
  tailSeconds = DEFAULTS.narrationTailSeconds,
}) {
  await checkTool(ffprobe);
  const scenes = [];
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
    scenes.push({ id: scene.id, video, audio, videoSeconds, audioSeconds, seconds });
  }
  const totalSeconds = scenes.reduce((sum, s) => sum + s.seconds, 0);
  return { scenes, missing, totalSeconds };
}

export async function stitchFilm(plan, {
  outDir,
  output = path.join(outDir, `${plan.slug}.mp4`),
  log = console.log,
  ffmpeg = 'ffmpeg',
  ffprobe = 'ffprobe',
  tailSeconds = DEFAULTS.narrationTailSeconds,
  fps = DEFAULTS.fps,
  music = true,
  musicVolume = plan.musicVolume ?? DEFAULTS.music.volume,
  subtitles = plan.subtitles ?? 'soft',
}) {
  await checkTool(ffmpeg);
  const { scenes, missing } = await measureScenes(plan, { outDir, ffprobe, tailSeconds });

  const [width, height] = plan.videoRatio.split(':').map((n) => Math.round(Number(n) / 2) * 2);
  const segDir = path.join(outDir, 'segments');
  await mkdir(segDir, { recursive: true });

  const segments = [];
  for (const s of scenes) {
    const hold = Math.max(0, s.seconds - s.videoSeconds);
    const segment = path.join(segDir, `${s.id}.mp4`);
    const audioInput = s.audio
      ? ['-i', s.audio]
      : ['-f', 'lavfi', '-t', s.seconds.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo'];
    // Same size, frame rate and audio format for every segment, so they join cleanly.
    const filter =
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p,` +
      `tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)}[v];` +
      `[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad[a]`;

    log(`${s.id}: ${s.seconds.toFixed(1)}s${s.audio ? ` (narration ${s.audioSeconds.toFixed(1)}s)` : ' (no narration)'}`);
    await run(ffmpeg, [
      '-y', '-loglevel', 'error',
      '-i', s.video, ...audioInput,
      '-filter_complex', filter,
      '-map', '[v]', '-map', '[a]',
      '-t', s.seconds.toFixed(3),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      segment,
    ]);
    segments.push(segment);
  }

  if (missing.length) log(`Skipping scenes with no video yet: ${missing.join(', ')}`);
  if (!segments.length) throw new Error(`No scene videos found in ${outDir}. Generate the clips first.`);

  const musicFile = music ? await findFile(outDir, 'music') : null;
  const cues = subtitles === 'off' ? [] : buildCues(plan, scenes);
  // Each finishing step writes a new file in segments/; the last one becomes the film.
  const joined = path.join(segDir, 'joined.mp4');
  let current = joined;

  const listFile = path.join(segDir, 'concat.txt');
  await writeFile(listFile, segments.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  await run(ffmpeg, [
    '-y', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', listFile,
    '-c', 'copy', '-movflags', '+faststart',
    joined,
  ]);

  if (musicFile) {
    log(`Mixing in ${path.basename(musicFile)} at ${Math.round(musicVolume * 100)}% volume`);
    const next = path.join(segDir, 'with-music.mp4');
    await mixMusic({ ffmpeg, ffprobe, film: current, music: musicFile, output: next, volume: musicVolume });
    current = next;
  }

  let srtFile = null;
  if (cues.length) {
    srtFile = output.replace(/\.[^.]+$/, '') + '.srt';
    await writeFile(srtFile, toSrt(cues));
    const next = path.join(segDir, 'with-subtitles.mp4');
    if (subtitles === 'burn') {
      log(`Burning ${cues.length} subtitles into the picture`);
      await burnSubtitles({ ffmpeg, film: current, srt: srtFile, output: next });
    } else {
      log(`Adding ${cues.length} subtitles (viewers can turn them on or off)`);
      await embedSubtitles({ ffmpeg, film: current, srt: srtFile, output: next });
    }
    current = next;
  }

  await rename(current, output);
  const duration = await probeDuration(ffprobe, output);
  return {
    output,
    duration,
    scenes: segments.length,
    missing,
    music: musicFile ? path.basename(musicFile) : null,
    subtitles: cues.length ? { mode: subtitles, file: srtFile, count: cues.length } : null,
  };
}

/**
 * Lay a music track under the film's audio. The music is looped if it's too
 * short, faded in and out, and pushed down ("ducked") while the narrator speaks.
 */
async function mixMusic({ ffmpeg, ffprobe, film, music, output, volume }) {
  const seconds = await probeDuration(ffprobe, film);
  const fadeIn = Math.min(DEFAULTS.music.fadeInSeconds, seconds / 4);
  const fadeOut = Math.min(DEFAULTS.music.fadeOutSeconds, seconds / 4);
  const filter =
    `[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${volume},` +
    `atrim=0:${seconds.toFixed(3)},afade=t=in:d=${fadeIn.toFixed(2)},` +
    `afade=t=out:st=${(seconds - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(2)}[m];` +
    `[0:a]asplit=2[voice][key];` +
    `[m][key]sidechaincompress=threshold=0.03:ratio=6:attack=50:release=600[ducked];` +
    `[voice][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`;
  await run(ffmpeg, [
    '-y', '-loglevel', 'error',
    '-i', film,
    '-stream_loop', '-1', '-i', music,
    '-filter_complex', filter,
    '-map', '0:v', '-map', '[a]',
    '-t', seconds.toFixed(3),
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart',
    output,
  ]);
}

/** A subtitle track players can switch on and off. Nothing is re-encoded. */
async function embedSubtitles({ ffmpeg, film, srt, output }) {
  await run(ffmpeg, [
    '-y', '-loglevel', 'error',
    '-i', film, '-i', srt,
    '-map', '0:v', '-map', '0:a', '-map', '1:s',
    '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'mov_text',
    '-metadata:s:s:0', 'title=Narration',
    '-disposition:s:0', 'default',
    '-movflags', '+faststart',
    output,
  ]);
}

/** Subtitles drawn into the picture, so they show everywhere (social media, etc.). */
async function burnSubtitles({ ffmpeg, film, srt, output }) {
  // Sizes are relative to libass's default 288-pixel-high canvas, so they scale with the video.
  const style = [
    'FontName=Arial', 'FontSize=18', 'PrimaryColour=&H00FFFFFF', 'OutlineColour=&H00000000',
    'BackColour=&H80000000', 'BorderStyle=1', 'Outline=1.6', 'Shadow=0.8', 'MarginV=22', 'Alignment=2',
  ].join(',');
  // Run inside the .srt's folder so the filter only sees a plain file name (no escaping trouble).
  await run(ffmpeg, [
    '-y', '-loglevel', 'error',
    '-i', path.resolve(film),
    '-vf', `subtitles=${path.basename(srt)}:force_style='${style}'`,
    '-map', '0:v', '-map', '0:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    path.resolve(output),
  ], { cwd: path.dirname(srt) });
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
