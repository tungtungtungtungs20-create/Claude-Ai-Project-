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
