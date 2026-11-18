import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TaskFailedError, TaskTimedOutError } from '@runwayml/sdk';
import { DEFAULTS, matchingVideoRatio } from './config.js';
import { slugify } from './story.js';
import { SUBTITLE_MODES } from './subtitles.js';

const DEFAULT_MOTION = 'Slow, gentle cinematic camera push-in; subtle natural movement in the scene.';

const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const EXT_BY_MIME = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
  'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav',
  'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/aac': '.aac',
};

/**
 * Turn a parsed story into the exact requests that will be sent, and check
 * them against the model limits before any credits are spent.
 */
export function buildPlan(story, overrides = {}) {
  const ratio = overrides.ratio ?? story.ratio ?? DEFAULTS.image.ratio;
  const videoRatio = overrides.videoRatio ?? matchingVideoRatio(ratio);
  const duration = overrides.duration ?? story.duration ?? DEFAULTS.video.duration;
  const voice = overrides.voice ?? story.voice ?? DEFAULTS.speech.voice;
  const musicVolume = overrides.musicVolume ?? story.musicVolume ?? DEFAULTS.music.volume;
  const subtitles = overrides.subtitles ?? story.subtitles ?? 'soft';
  const errors = [];

  if (!SUBTITLE_MODES.includes(subtitles)) {
    errors.push(`Subtitles must be one of ${SUBTITLE_MODES.join(', ')} (got "${subtitles}").`);
  }
  if (!Number.isFinite(musicVolume) || musicVolume < 0 || musicVolume > 1) {
    errors.push(`Music volume must be between 0 and 1 (got "${musicVolume}").`);
  }
  if (!DEFAULTS.speech.presetVoices.includes(voice)) {
    errors.push(`Voice "${voice}" isn't a ${DEFAULTS.speech.model} preset. Use one of: ${DEFAULTS.speech.presetVoices.join(', ')}`);
  }
  if (!DEFAULTS.image.allowedRatios.includes(ratio)) {
    errors.push(`Image ratio "${ratio}" isn't supported by ${DEFAULTS.image.model}. Use one of: ${DEFAULTS.image.allowedRatios.join(', ')}`);
  }
  if (!DEFAULTS.video.allowedRatios.includes(videoRatio)) {
    errors.push(`Video ratio "${videoRatio}" isn't supported by ${DEFAULTS.video.model}. Use one of: ${DEFAULTS.video.allowedRatios.join(', ')}`);
  }
  if (!Number.isInteger(duration) || duration <= 0) {
    errors.push(`Duration must be a whole number of seconds (got "${duration}").`);
  }
  if (story.references.length > DEFAULTS.image.maxReferences) {
    errors.push(`${DEFAULTS.image.model} accepts at most ${DEFAULTS.image.maxReferences} reference images (got ${story.references.length}).`);
  }
  if (story.scenes.length === 0) {
    errors.push('No scenes found. Start each scene with a "## Scene title" heading.');
  }

  const scenes = story.scenes.map((scene, i) => {
    const n = String(i + 1).padStart(2, '0');
    const description = scene.image || scene.text;
    const imagePrompt = [description.replace(/[\s.]+$/, ''), story.style].filter(Boolean).join('. ');
    const videoPrompt = scene.motion || DEFAULT_MOTION;
    const label = `Scene ${i + 1} ("${scene.title}")`;

    if (!description) errors.push(`${label} has no description or "Image:" line.`);
    if (imagePrompt.length > DEFAULTS.maxPromptLength) {
      errors.push(`${label}: image prompt is ${imagePrompt.length} characters; the limit is ${DEFAULTS.maxPromptLength} (including the story Style). Shorten it or add a shorter "Image:" line.`);
    }
    if (videoPrompt.length > DEFAULTS.maxPromptLength) {
      errors.push(`${label}: motion prompt is ${videoPrompt.length} characters; the limit is ${DEFAULTS.maxPromptLength}.`);
    }

    return {
      number: i + 1,
      id: `scene-${n}`,
      title: scene.title,
      imagePrompt,
      videoPrompt,
      narration: scene.narration,
      seed: scene.seed ?? story.seed ?? undefined,
    };
  });

  // Give the speech model the lines around each scene so the read flows.
  scenes.forEach((s, i) => {
    s.previousNarration = scenes.slice(0, i).reverse().find((p) => p.narration)?.narration ?? '';
    s.nextNarration = scenes.slice(i + 1).find((p) => p.narration)?.narration ?? '';
  });

  return {
    title: story.title,
    slug: slugify(story.title),
    imageModel: DEFAULTS.image.model,
    videoModel: DEFAULTS.video.model,
    speechModel: DEFAULTS.speech.model,
    voice,
    musicModel: DEFAULTS.music.model,
    music: story.music,
    musicVolume,
    subtitles,
    author: story.author ?? '',
    tagline: story.tagline ?? '',
    credits: story.credits ?? [],
    titleCard: overrides.titleCard ?? story.titleCard ?? true,
    endCredits: overrides.endCredits ?? story.endCredits ?? true,
    ratio,
    videoRatio,
    duration,
    references: story.references,
    scenes,
    errors,
  };
}

/** Human-readable summary of a plan, for --dry-run. */
export function describePlan(plan) {
  const out = [];
  out.push(`Story: ${plan.title}`);
  out.push(`Images: ${plan.imageModel} @ ${plan.ratio}   Videos: ${plan.videoModel} @ ${plan.videoRatio}, ${plan.duration}s`);
  if (plan.references.length) {
    out.push(`References: ${plan.references.map((r) => `@${r.tag} (${r.source})`).join(', ')}`);
  }
  const narrated = plan.scenes.filter((s) => s.narration).length;
  out.push(`Narration: ${plan.speechModel}, voice ${plan.voice}`);
  out.push(plan.music
    ? `Music: ${plan.musicModel}, instrumental, ${Math.round(plan.musicVolume * 100)}% volume: ${plan.music}`
    : 'Music: none (add a "Music:" line to the story header)');
  out.push(`Title card: ${plan.titleCard ? 'on' : 'off'}   End credits: ${plan.endCredits ? 'on' : 'off'}`);
  out.push(`Subtitles: ${{ soft: 'on (viewers can turn them off) + .srt file', burn: 'burned into the picture + .srt file', off: 'off' }[plan.subtitles] ?? plan.subtitles}`);
  out.push(`Scenes: ${plan.scenes.length} (${plan.scenes.length} images + ${plan.scenes.length} videos + ${narrated} narration clips)`);
  for (const s of plan.scenes) {
    out.push('');
    out.push(`[${s.id}] ${s.title}`);
    out.push(`  image  (${s.imagePrompt.length} chars): ${s.imagePrompt}`);
    out.push(`  motion (${s.videoPrompt.length} chars): ${s.videoPrompt}`);
    out.push(`  narration: ${s.narration || '(none)'}`);
  }
  return out.join('\n');
}

/**
 * Generate each scene's image, animate it into a clip, then record its narration.
 * Scenes already on disk are skipped, so you can re-run after a failure
 * without paying for finished scenes again (use force to regenerate).
 */
export async function runPlan(plan, {
  client,
  outDir,
  storyDir = process.cwd(),
  fetchFn = globalThis.fetch,
  log = console.log,
  imagesOnly = false,
  narration = true,
  force = false,
  timeoutMs = DEFAULTS.taskTimeoutMs,
}) {
  if (plan.errors.length) throw new Error(`Plan has problems:\n- ${plan.errors.join('\n- ')}`);
  await mkdir(outDir, { recursive: true });

  const manifestPath = path.join(outDir, 'manifest.json');
  const manifest = await loadManifest(manifestPath, plan);
  const save = () => writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  const referenceImages = await Promise.all(
    plan.references.map(async (r) => ({ tag: r.tag, uri: await toImageUri(r.source, storyDir) })),
  );

  let failures = 0;
  for (const scene of plan.scenes) {
    const entry = (manifest.scenes[scene.id] ??= { title: scene.title });
    entry.imagePrompt = scene.imagePrompt;
    entry.videoPrompt = scene.videoPrompt;
    entry.narrationText = scene.narration || undefined;
    let stage = 'image';

    try {
      // 1. Still image
      let imageUri;
      const existingImage = !force && (await findFile(outDir, `${scene.id}-image`));
      if (existingImage) {
        log(`${scene.id}: image already exists (${path.basename(existingImage)}), skipping`);
        imageUri = await fileToDataUri(existingImage);
      } else {
        log(`${scene.id}: generating image...`);
        const task = await client.textToImage
          .create({
            model: plan.imageModel,
            promptText: scene.imagePrompt,
            ratio: plan.ratio,
            ...(referenceImages.length ? { referenceImages } : {}),
            ...(scene.seed !== undefined ? { seed: scene.seed } : {}),
          })
          .waitForTaskOutput({ timeout: timeoutMs });
        imageUri = task.output[0];
        const file = await download(fetchFn, imageUri, path.join(outDir, `${scene.id}-image`));
        Object.assign(entry, { imageTaskId: task.id, image: path.basename(file), imageError: undefined });
        await save();
        log(`${scene.id}: saved ${path.basename(file)}`);
      }

      if (imagesOnly) continue;

      // 2. Video clip from the still image
      const existingVideo = !force && (await findFile(outDir, `${scene.id}-video`));
      if (existingVideo) {
        log(`${scene.id}: video already exists (${path.basename(existingVideo)}), skipping`);
      } else {
        stage = 'video';
        log(`${scene.id}: animating clip...`);
        const task = await client.imageToVideo
          .create({
            model: plan.videoModel,
            promptImage: imageUri,
            promptText: scene.videoPrompt,
            ratio: plan.videoRatio,
            duration: plan.duration,
            ...(scene.seed !== undefined ? { seed: scene.seed } : {}),
          })
          .waitForTaskOutput({ timeout: timeoutMs });
        const file = await download(fetchFn, task.output[0], path.join(outDir, `${scene.id}-video`));
        Object.assign(entry, { videoTaskId: task.id, video: path.basename(file), videoError: undefined });
        await save();
        log(`${scene.id}: saved ${path.basename(file)}`);
      }

      // 3. Narration for the scene
      if (!narration || !scene.narration) continue;
      const existingAudio = !force && (await findFile(outDir, `${scene.id}-narration`));
      if (existingAudio) {
        log(`${scene.id}: narration already exists (${path.basename(existingAudio)}), skipping`);
        continue;
      }
      stage = 'narration';
      log(`${scene.id}: recording narration...`);
      const speech = await client.textToSpeech
        .create({
          model: plan.speechModel,
          promptText: scene.narration,
          voice: { type: 'runway-preset', presetId: plan.voice },
          ...(scene.previousNarration ? { previousText: scene.previousNarration } : {}),
          ...(scene.nextNarration ? { nextText: scene.nextNarration } : {}),
          ...(scene.seed !== undefined ? { seed: scene.seed } : {}),
        })
        .waitForTaskOutput({ timeout: timeoutMs });
      const audioFile = await download(fetchFn, speech.output[0], path.join(outDir, `${scene.id}-narration`));
      Object.assign(entry, { narrationTaskId: speech.id, narration: path.basename(audioFile), narrationError: undefined });
      await save();
      log(`${scene.id}: saved ${path.basename(audioFile)}`);
    } catch (err) {
      if (err instanceof TaskFailedError || err instanceof TaskTimedOutError) {
        // Record the task so it can be checked in the Developer Portal;
        // don't resubmit automatically (that would spend credits again).
        failures++;
        const d = err.taskDetails ?? {};
        const info = { taskId: d.id, status: d.status, failureCode: d.failureCode, message: err.message };
        entry[`${stage}Error`] = info;
        await save();
        log(`${scene.id}: ${err.name} (task ${d.id ?? 'unknown'}${d.failureCode ? `, ${d.failureCode}` : ''}): ${err.message}`);
        continue;
      }
      await save();
      throw err; // auth, bad request, network: stop rather than fail every scene
    }
  }

  manifest.updatedAt = new Date().toISOString();
  await save();
  return { failures, manifestPath };
}

/**
 * Make one instrumental track for the whole film, sized to its length.
 * Skipped if music already exists (use force to make a new track).
 */
export async function generateMusic(plan, {
  client,
  outDir,
  seconds,
  fetchFn = globalThis.fetch,
  log = console.log,
  force = false,
  timeoutMs = DEFAULTS.taskTimeoutMs,
}) {
  if (!plan.music) return { skipped: 'no Music: line in the story' };
  const existing = !force && (await findFile(outDir, 'music'));
  if (existing) {
    log(`music: already exists (${path.basename(existing)}), skipping`);
    return { file: existing };
  }

  const manifestPath = path.join(outDir, 'manifest.json');
  const manifest = await loadManifest(manifestPath, plan);
  const save = () => writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const duration = Math.ceil(seconds + DEFAULTS.music.paddingSeconds);

  log(`music: composing ${duration}s track...`);
  try {
    const task = await client.textToMusic
      .create({ model: plan.musicModel, promptText: plan.music, duration, instrumental: true })
      .waitForTaskOutput({ timeout: timeoutMs });
    const file = await download(fetchFn, task.output[0], path.join(outDir, 'music'));
    manifest.music = { taskId: task.id, file: path.basename(file), prompt: plan.music, seconds: duration };
    await save();
    log(`music: saved ${path.basename(file)}`);
    return { file };
  } catch (err) {
    if (err instanceof TaskFailedError || err instanceof TaskTimedOutError) {
      const d = err.taskDetails ?? {};
      manifest.music = { prompt: plan.music, error: { taskId: d.id, status: d.status, failureCode: d.failureCode, message: err.message } };
      await save();
      log(`music: ${err.name} (task ${d.id ?? 'unknown'}${d.failureCode ? `, ${d.failureCode}` : ''}): ${err.message}`);
      return { failed: true };
    }
    throw err;
  }
}

async function loadManifest(manifestPath, plan) {
  try {
    return JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    return {
      title: plan.title,
      imageModel: plan.imageModel,
      videoModel: plan.videoModel,
      speechModel: plan.speechModel,
      voice: plan.voice,
      ratio: plan.ratio,
      videoRatio: plan.videoRatio,
      duration: plan.duration,
      scenes: {},
    };
  }
}

export async function findFile(dir, base) {
  const names = await readdir(dir).catch(() => []);
  const hit = names.find((n) => path.parse(n).name === base);
  return hit ? path.join(dir, hit) : null;
}

// Output URLs are temporary, so download right away.
async function download(fetchFn, url, basePath) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${basePath}`);
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  const isAudio = basePath.endsWith('-narration') || path.basename(basePath) === 'music';
  const fallback = basePath.endsWith('-video') ? '.mp4' : isAudio ? '.mp3' : '.png';
  const ext = EXT_BY_MIME[type] || path.extname(new URL(url).pathname) || fallback;
  const file = basePath + ext;
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

async function toImageUri(source, baseDir) {
  if (/^https:\/\//i.test(source)) return source;
  if (/^https?:/i.test(source)) throw new Error(`Reference "${source}" must use https.`);
  return fileToDataUri(path.resolve(baseDir, source));
}

async function fileToDataUri(file) {
  const mime = MIME_BY_EXT[path.extname(file).toLowerCase()];
  if (!mime) throw new Error(`Unsupported image type for ${file}; use .png, .jpg or .webp.`);
  const { size } = await stat(file);
  // base64 grows the data by 4/3; keep the whole URI under the limit.
  if (Math.ceil(size / 3) * 4 > DEFAULTS.maxDataUriBytes) {
    throw new Error(`${file} is too large to send inline (limit is about 3.75MB). Use a smaller image or an https URL.`);
  }
  return `data:${mime};base64,${(await readFile(file)).toString('base64')}`;
}
