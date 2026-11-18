import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCues, cleanForSubtitles, splitCaptions, toSrt } from '../src/subtitles.js';

test('removes speech tags like [laughs] from on-screen text', () => {
  assert.equal(cleanForSubtitles('Hello [laughs] there [pause]  friend.'), 'Hello there friend.');
  assert.equal(cleanForSubtitles('The end [sighs].'), 'The end.');
});

test('splits narration into short captions of at most two lines', () => {
  const text =
    'Long ago, when the world had turned to wickedness, one man still listened. ' +
    'Noah was told to build an ark, and so, beam by beam, through the long hot days and the cold nights that followed, he built it.';
  const captions = splitCaptions(text);
  assert.ok(captions.length >= 3);
  for (const c of captions) {
    const lines = c.split('\n');
    assert.ok(lines.length <= 2, c);
    for (const l of lines) assert.ok(l.length <= 46, `line too long: "${l}"`);
  }
  assert.equal(captions.join(' ').replace(/\n/g, ' '), text);
});

test('times captions inside each scene, in proportion to their length', () => {
  const plan = { scenes: [
    { id: 'scene-01', narration: 'One two three. Four five six seven eight nine.' },
    { id: 'scene-02', narration: '' },
    { id: 'scene-03', narration: 'The end.' },
  ] };
  const measured = [
    { id: 'scene-01', audio: 'a.mp3', audioSeconds: 4, seconds: 4.6 },
    { id: 'scene-02', audio: null, audioSeconds: 0, seconds: 5 },
    { id: 'scene-03', audio: 'c.mp3', audioSeconds: 1, seconds: 5 },
  ];
  const cues = buildCues(plan, measured);
  assert.equal(cues.length, 3);
  assert.equal(cues[0].start, 0);
  assert.ok(cues[0].end < cues[1].end);
  assert.ok(Math.abs(cues[1].end - 4) < 1e-9, 'scene 1 captions end when its narration ends');
  assert.ok(cues[1].end - cues[1].start > cues[0].end - cues[0].start, 'longer caption gets more time');
  assert.ok(Math.abs(cues[2].start - 9.6) < 1e-9, 'scene 3 starts after scenes 1 and 2');
  assert.ok(Math.abs(cues[2].end - 10.6) < 1e-9);
});

test('writes valid SRT', () => {
  const srt = toSrt([{ start: 0, end: 1.5, text: 'Hello' }, { start: 3661.25, end: 3662, text: 'Line one\nLine two' }]);
  assert.equal(srt, '1\n00:00:00,000 --> 00:00:01,500\nHello\n\n2\n01:01:01,250 --> 01:01:02,000\nLine one\nLine two\n');
});
