// Parses a story Markdown file into a title, story-wide settings, and scenes.
//
//   # Story Title
//   Style: painterly, warm golden light, cinematic
//   Ratio: 1280:720
//   Reference: noah = refs/noah.png
//   Voice: Bernard
//   Music: gentle orchestral strings, hopeful, slow build
//   Music volume: 0.3
//
//   ## The Storm Gathers
//   Free text describing the scene (used for the image if there's no Image: line).
//   Image: what the still frame should show
//   Motion: how the camera and subjects move in the clip
//   Narration: what the narrator says over this scene
//
// Each "## " heading starts a new scene.

const SETTING_RE = /^(style|ratio|reference|duration|seed|voice|music\s+volume|music)\s*:\s*(.*)$/i;
const SCENE_FIELD_RE = /^(image|motion|seed|narration)\s*:\s*(.*)$/i;

export function parseStory(markdown) {
  const lines = markdown
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n');
  const story = { title: '', style: '', ratio: null, duration: null, seed: null, voice: null, music: '', musicVolume: null, references: [], scenes: [] };
  let scene = null;

  const flush = () => {
    if (!scene) return;
    scene.text = scene.textLines.join(' ').replace(/\s+/g, ' ').trim();
    delete scene.textLines;
    story.scenes.push(scene);
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('## ')) {
      flush();
      scene = { title: line.slice(3).trim(), image: '', motion: '', narration: '', seed: null, textLines: [] };
      continue;
    }
    if (line.startsWith('# ') && !scene) {
      story.title = line.slice(2).trim();
      continue;
    }

    if (!scene) {
      const m = line.match(SETTING_RE);
      if (!m) continue;
      const [, key, value] = m;
      switch (key.toLowerCase().replace(/\s+/g, ' ')) {
        case 'style': story.style = value.trim(); break;
        case 'ratio': story.ratio = value.trim(); break;
        case 'duration': story.duration = Number(value); break;
        case 'seed': story.seed = Number(value); break;
        case 'voice': story.voice = value.trim(); break;
        case 'music': story.music = value.trim(); break;
        case 'music volume': story.musicVolume = Number(value); break;
        case 'reference': story.references.push(parseReference(value)); break;
      }
      continue;
    }

    const m = line.match(SCENE_FIELD_RE);
    if (m) {
      const [, key, value] = m;
      const k = key.toLowerCase();
      if (k === 'seed') scene.seed = Number(value);
      // Several Narration: lines in one scene are read as one passage.
      else if (k === 'narration') scene.narration = [scene.narration, value.trim()].filter(Boolean).join(' ');
      else scene[k] = value.trim();
    } else {
      scene.textLines.push(line);
    }
  }
  flush();

  if (!story.title) story.title = 'Untitled Story';
  return story;
}

function parseReference(value) {
  const m = value.match(/^\s*([A-Za-z][A-Za-z0-9_]{2,15})\s*=\s*(.+)$/);
  if (!m) {
    throw new Error(
      `Bad "Reference:" line "${value}". Use "Reference: tag = path-or-https-url"; the tag must be 3-16 characters, start with a letter, and use only letters, digits and underscores.`,
    );
  }
  return { tag: m[1], source: m[2].trim() };
}

export function slugify(text) {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'story'
  );
}
