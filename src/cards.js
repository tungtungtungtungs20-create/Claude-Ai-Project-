// Title card and end credits, drawn with ffmpeg so they cost no Runway credits.
//
// Each line is drawn by its own drawtext filter (centred on its own), which
// works on older ffmpeg versions too. Text is read from small files rather than
// put in the filter string, so quotes, colons and other symbols can't break it.
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { DEFAULTS } from './config.js';

const run = promisify(execFile);

/** How long each card lasts, so music and subtitles can allow for them. */
export function cardDurations(plan) {
  const title = plan.titleCard ? DEFAULTS.cards.titleSeconds : 0;
  const lines = plan.endCredits ? creditLines(plan).filter((l) => l.text).length : 0;
  const credits = plan.endCredits
    ? Math.min(DEFAULTS.cards.creditsMaxSeconds, Math.max(DEFAULTS.cards.creditsMinSeconds, 2.5 + 0.6 * lines))
    : 0;
  return { title, credits };
}

/** The end-credit lines: the story's own credits, then what made the film. */
export function creditLines(plan) {
  const lines = [{ text: plan.title, size: 'heading' }, { text: '' }];
  if (plan.author) lines.push({ text: `Written by ${plan.author}` });
  for (const c of plan.credits ?? []) lines.push({ text: c });
  if (plan.author || plan.credits?.length) lines.push({ text: '' });

  lines.push({ text: `Images: Runway ${plan.imageModel}`, size: 'small' });
  lines.push({ text: `Animation: Runway ${plan.videoModel}`, size: 'small' });
  if (plan.scenes.some((s) => s.narration)) {
    lines.push({ text: `Narration: Runway ${plan.speechModel} (voice: ${plan.voice})`, size: 'small' });
  }
  if (plan.music) lines.push({ text: `Music: Runway ${plan.musicModel}`, size: 'small' });
  return lines;
}

/** Wrap text to lines of at most `max` characters, breaking at spaces. */
export function wrap(text, max) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > max) {
      lines.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderTitleCard(plan, { ffmpeg, segDir, width, height, fps, seconds, backgroundImage }) {
  const titleSize = Math.round(height * 0.085);
  const smallSize = Math.round(height * 0.04);
  const titleLines = wrap(plan.title, 26);
  const below = [plan.tagline, plan.author && `by ${plan.author}`].filter(Boolean);

  // Lay the block out around the middle of the frame.
  const gap = Math.round(height * 0.035);
  const blockHeight = titleLines.length * titleSize * 1.2 + (below.length ? gap + below.length * smallSize * 1.5 : 0);
  let y = (height - blockHeight) / 2;
  const items = [];
  for (const t of titleLines) {
    items.push({ text: t, size: titleSize, y, font: DEFAULTS.cards.titleFont });
    y += titleSize * 1.2;
  }
  y += gap;
  for (const t of below) {
    items.push({ text: t, size: smallSize, y, font: DEFAULTS.cards.textFont, alpha: 0.85 });
    y += smallSize * 1.5;
  }

  return renderCard({ name: 'title-card', items, ffmpeg, segDir, width, height, fps, seconds, backgroundImage });
}

export async function renderCredits(plan, { ffmpeg, segDir, width, height, fps, seconds }) {
  const sizes = { heading: Math.round(height * 0.06), normal: Math.round(height * 0.04), small: Math.round(height * 0.032) };
  const lines = creditLines(plan).flatMap((l) =>
    l.text ? wrap(l.text, l.size === 'heading' ? 34 : 60).map((t) => ({ ...l, text: t })) : [l],
  );
  const lineHeight = (l) => (l.text ? sizes[l.size ?? 'normal'] * 1.5 : sizes.normal * 0.8);
  // Shrink everything if there are too many lines to fit.
  const total = lines.reduce((n, l) => n + lineHeight(l), 0);
  const scale = Math.min(1, (height * 0.85) / total);
  let y = (height - total * scale) / 2;
  const items = [];
  for (const l of lines) {
    if (l.text) {
      items.push({
        text: l.text,
        size: Math.round(sizes[l.size ?? 'normal'] * scale),
        y,
        font: l.size === 'heading' ? DEFAULTS.cards.titleFont : DEFAULTS.cards.textFont,
        alpha: l.size === 'small' ? 0.75 : 1,
      });
    }
    y += lineHeight(l) * scale;
  }
  return renderCard({ name: 'end-credits', items, ffmpeg, segDir, width, height, fps, seconds });
}

async function renderCard({ name, items, ffmpeg, segDir, width, height, fps, seconds, backgroundImage }) {
  const fade = Math.min(DEFAULTS.cards.fadeSeconds, seconds / 3);
  const files = [];
  for (const [i, item] of items.entries()) {
    const file = `${name}-line-${i + 1}.txt`;
    await writeFile(path.join(segDir, file), item.text);
    files.push(file);
  }

  const background = backgroundImage
    ? ['-loop', '1', '-framerate', String(fps), '-t', seconds.toFixed(3), '-i', path.resolve(backgroundImage)]
    : ['-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${seconds.toFixed(3)}`];
  // A blurred, darkened still from the film behind the title, so the text stands out.
  const prep = backgroundImage
    ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=18,eq=brightness=-0.18:saturation=0.8,`
    : '';
  const text = items
    .map((item, i) =>
      `drawtext=textfile=${files[i]}:expansion=none:font='${item.font}':fontsize=${item.size}:` +
      `fontcolor=white@${item.alpha ?? 1}:x=(w-text_w)/2:y=${Math.round(item.y)}:` +
      `shadowcolor=black@0.6:shadowx=2:shadowy=2`,
    )
    .join(',');
  const filter =
    `[0:v]${prep}${text}${text ? ',' : ''}setsar=1,fps=${fps},format=yuv420p,` +
    `fade=t=in:st=0:d=${fade.toFixed(2)},fade=t=out:st=${(seconds - fade).toFixed(3)}:d=${fade.toFixed(2)}[v]`;

  const output = path.join(segDir, `${name}.mp4`);
  // Run inside segDir so the text files are found by plain name.
  await run(ffmpeg, [
    '-y', '-loglevel', 'error',
    ...background,
    '-f', 'lavfi', '-t', seconds.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo',
    '-filter_complex', filter,
    '-map', '[v]', '-map', '1:a',
    '-t', seconds.toFixed(3),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    output,
  ], { cwd: segDir });
  return output;
}
