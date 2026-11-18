// Builds subtitles from each scene's narration text.
//
// Runway's speech output doesn't come with word timings, so each scene's
// narration is split into short captions and its spoken length is shared out
// between them by character count. That keeps every caption inside its scene
// and close to when it's said.

export const SUBTITLE_MODES = ['soft', 'burn', 'off'];
const MAX_LINE = 42; // characters per line, a common subtitle limit
const MAX_CUE = MAX_LINE * 2; // two lines per caption

/** Text as it should be read on screen: no [laughs]-style speech tags. */
export function cleanForSubtitles(text) {
  return text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:…])/g, '$1') // "The end [sighs]." -> "The end."
    .trim();
}

/** Split narration into captions of at most two short lines each. */
export function splitCaptions(text, maxChars = MAX_CUE) {
  const sentences = cleanForSubtitles(text).split(/(?<=[.!?…])\s+/).filter(Boolean);
  const captions = [];
  for (const sentence of sentences) {
    let rest = sentence;
    while (rest.length > maxChars) {
      // Prefer breaking after punctuation, otherwise at the last space that fits.
      const window = rest.slice(0, maxChars + 1);
      let cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(': '), window.lastIndexOf(' - '));
      cut = cut > maxChars / 3 ? cut + 1 : window.lastIndexOf(' ');
      if (cut <= 0) cut = maxChars;
      captions.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) captions.push(rest);
  }
  return captions.map((c) => wrapLines(c));
}

/** Break a caption into at most two balanced lines. */
function wrapLines(caption, maxLine = MAX_LINE) {
  if (caption.length <= maxLine) return caption;
  const middle = caption.length / 2;
  let best = -1;
  for (let i = caption.indexOf(' '); i !== -1; i = caption.indexOf(' ', i + 1)) {
    if (best === -1 || Math.abs(i - middle) < Math.abs(best - middle)) best = i;
  }
  return best === -1 ? caption : `${caption.slice(0, best)}\n${caption.slice(best + 1)}`;
}

/**
 * Timed captions for the whole film.
 * `measured` is the list from measureScenes(); `plan` supplies the narration text.
 * `startOffset` is when the first scene starts (after any title card).
 */
export function buildCues(plan, measured, startOffset = 0) {
  const textById = new Map(plan.scenes.map((s) => [s.id, s.narration || '']));
  const cues = [];
  let sceneStart = startOffset; // e.g. the title card's length
  for (const scene of measured) {
    const text = textById.get(scene.id);
    if (scene.audio && text) {
      const captions = splitCaptions(text);
      const totalChars = captions.reduce((n, c) => n + c.length, 0) || 1;
      let t = sceneStart;
      for (const caption of captions) {
        const length = (scene.audioSeconds * caption.length) / totalChars;
        cues.push({ start: t, end: t + length, text: caption });
        t += length;
      }
    }
    sceneStart += scene.seconds;
  }
  return cues;
}

export function toSrt(cues) {
  return cues
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
    .join('\n');
}

function srtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}
