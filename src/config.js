// Default model settings. Checked against the types in @runwayml/sdk 4.28.0.
// Each Runway model has its own parameters and allowed values, so if you switch
// models here, check that model's entry in the API reference
// (https://docs.dev.runwayml.com/api/) instead of reusing these values.

export const DEFAULTS = {
  image: {
    // gen4_image accepts up to 3 reference images, which helps keep
    // characters looking the same from scene to scene.
    model: 'gen4_image',
    ratio: '1280:720',
    allowedRatios: [
      '1024:1024', '1080:1080', '1168:880', '1360:768', '1440:1080', '1080:1440',
      '1808:768', '1920:1080', '1080:1920', '2112:912', '1280:720', '720:1280',
      '720:720', '960:720', '720:960', '1680:720',
    ],
    maxReferences: 3,
  },
  video: {
    // gen4_turbo animates a still image (used as the first frame).
    model: 'gen4_turbo',
    ratio: '1280:720',
    allowedRatios: ['1280:720', '720:1280', '1104:832', '832:1104', '960:960', '1584:672'],
    // The SDK types don't list allowed durations; check the API reference.
    duration: 5,
  },
  speech: {
    // eleven_v4 reads each scene's narration with a preset voice.
    model: 'eleven_v4',
    voice: 'Bernard',
    presetVoices: [
      'Maya', 'Arjun', 'Serene', 'Bernard', 'Billy', 'Mark', 'Clint', 'Mabel', 'Chad', 'Leslie',
      'Eleanor', 'Elias', 'Elliot', 'Grungle', 'Brodie', 'Sandra', 'Kirk', 'Kylie', 'Lara', 'Lisa',
      'Malachi', 'Marlene', 'Martin', 'Miriam', 'Monster', 'Paula', 'Pip', 'Rusty', 'Ragnar', 'Xylar',
      'Maggie', 'Jack', 'Katie', 'Noah', 'James', 'Rina', 'Ella', 'Mariah', 'Frank', 'Claudia',
      'Niki', 'Vincent', 'Kendrick', 'Myrna', 'Tom', 'Wanda', 'Benjamin', 'Kiana', 'Rachel',
    ],
  },
  music: {
    // eleven_music_v2_5 makes an instrumental track sized to the finished film.
    // You're billed for the requested length.
    model: 'eleven_music_v2_5',
    // Music level under the narration (0 to 1), before ducking.
    volume: 0.3,
    fadeInSeconds: 2,
    fadeOutSeconds: 3,
    // Extra seconds requested beyond the film's length, as a safety margin.
    paddingSeconds: 2,
  },
  cards: {
    titleSeconds: 4.5,
    creditsMinSeconds: 6,
    creditsMaxSeconds: 15,
    fadeSeconds: 0.8,
    // Font families looked up by fontconfig; any installed font name works.
    titleFont: 'Serif',
    textFont: 'Sans',
  },
  // Final film: silence kept after each scene's narration before the cut (seconds).
  narrationTailSeconds: 0.6,
  fps: 24,
  // Both promptText fields allow at most 1000 UTF-16 code units.
  maxPromptLength: 1000,
  // Data URI inputs are limited to 5MB.
  maxDataUriBytes: 5 * 1024 * 1024,
  // How long to wait for each task before giving up (ms).
  taskTimeoutMs: 10 * 60 * 1000,
};

// Pick a video ratio with the same orientation as the image ratio.
export function matchingVideoRatio(imageRatio) {
  const [w, h] = imageRatio.split(':').map(Number);
  if (w > h) return w / h > 2.2 ? '1584:672' : '1280:720';
  if (h > w) return '720:1280';
  return '960:960';
}
