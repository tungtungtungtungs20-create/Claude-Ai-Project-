import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStory } from '../src/story.js';
import { buildPlan } from '../src/pipeline.js';
import { cardDurations, creditLines, wrap } from '../src/cards.js';

const STORY = `# The Ark
Author: Jane Doe
Tagline: A promise in the sky
Credit: Produced by Jane Doe
Credit: Thanks to my family
Music: strings
## A
x
Narration: Hello.`;

test('parses title card and credit settings', () => {
  const story = parseStory(STORY);
  assert.equal(story.author, 'Jane Doe');
  assert.equal(story.tagline, 'A promise in the sky');
  assert.deepEqual(story.credits, ['Produced by Jane Doe', 'Thanks to my family']);
  const plan = buildPlan(story);
  assert.equal(plan.titleCard, true);
  assert.equal(plan.endCredits, true);
  const off = buildPlan(parseStory('# T\nTitle card: off\nEnd credits: no\n## A\nx'));
  assert.equal(off.titleCard, false);
  assert.equal(off.endCredits, false);
  assert.throws(() => parseStory('# T\nTitle card: maybe'), /should be on or off/);
});

test('credits list the story credits, then the Runway models actually used', () => {
  const text = creditLines(buildPlan(parseStory(STORY))).map((l) => l.text);
  assert.deepEqual(text, [
    'The Ark', '',
    'Written by Jane Doe', 'Produced by Jane Doe', 'Thanks to my family', '',
    'Images: Runway gen4_image',
    'Animation: Runway gen4_turbo',
    'Narration: Runway eleven_v4 (voice: Bernard)',
    'Music: Runway eleven_music_v2_5',
  ]);
  // No narration or music lines when the story has none.
  const bare = creditLines(buildPlan(parseStory('# T\n## A\nx'))).map((l) => l.text);
  assert.deepEqual(bare, ['T', '', 'Images: Runway gen4_image', 'Animation: Runway gen4_turbo']);
});

test('credits get longer with more lines, within limits', () => {
  const short = cardDurations(buildPlan(parseStory('# T\n## A\nx')));
  assert.deepEqual(short, { title: 4.5, credits: 6 });
  const many = '# T\n' + Array.from({ length: 40 }, (_, i) => `Credit: Person ${i}`).join('\n') + '\n## A\nx';
  assert.equal(cardDurations(buildPlan(parseStory(many))).credits, 15);
  assert.deepEqual(cardDurations(buildPlan(parseStory('# T\n## A\nx'), { titleCard: false, endCredits: false })), { title: 0, credits: 0 });
});

test('wraps long titles at spaces', () => {
  assert.deepEqual(wrap('The Ark and the Rainbow of the Covenant Promise', 20), ['The Ark and the', 'Rainbow of the', 'Covenant Promise']);
  assert.deepEqual(wrap('Short', 20), ['Short']);
});
