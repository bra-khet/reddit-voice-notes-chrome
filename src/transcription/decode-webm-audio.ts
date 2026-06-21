import { VOSK_TARGET_SAMPLE_RATE } from './constants';

/**
 * Decode muxed WebM (Reddit voice-note capture) to mono PCM at 16 kHz for Vosk.
 * Tries AudioContext.decodeAudioData first; falls back to OfflineAudioContext render
 * (same class of muxed-WebM issue as Design Studio voice preview).
 */
export async function decodeWebmToMonoPcm(blob: Blob): Promise<{ samples: Float32Array; sampleRate: number }> {
  const buffer = await decodeWebmToAudioBuffer(blob);
  return audioBufferToMono16k(buffer);
}

async function decodeWebmToAudioBuffer(blob: Blob): Promise<AudioBuffer> {
  const bytes = await blob.arrayBuffer();

  const decodeContext = new AudioContext();
  try {
    return await decodeContext.decodeAudioData(bytes.slice(0));
  } catch {
    return decodeMuxedWebmViaOfflineRender(blob);
  } finally {
    await decodeContext.close();
  }
}

async function decodeMuxedWebmViaOfflineRender(blob: Blob): Promise<AudioBuffer> {
  const url = URL.createObjectURL(blob);

  try {
    const audio = new Audio(url);
    await new Promise<void>((resolve, reject) => {
      audio.addEventListener('loadedmetadata', () => resolve(), { once: true });
      audio.addEventListener('error', () => reject(new Error('WebM audio metadata load failed')), {
        once: true,
      });
    });

    const duration = audio.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('WebM has invalid duration for offline audio decode');
    }

    const frameCount = Math.ceil(duration * VOSK_TARGET_SAMPLE_RATE);
    const offline = new OfflineAudioContext(1, frameCount, VOSK_TARGET_SAMPLE_RATE);
    // OfflineAudioContext supports MediaElementSource in Chromium; typings omit it on the base class.
    const source = (offline as unknown as AudioContext).createMediaElementSource(audio);
    source.connect(offline.destination);

    const playPromise = audio.play();
    const rendered = await offline.startRendering();
    await playPromise.catch(() => undefined);

    return rendered;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function audioBufferToMono16k(buffer: AudioBuffer): Promise<{ samples: Float32Array; sampleRate: number }> {
  if (buffer.numberOfChannels === 1 && buffer.sampleRate === VOSK_TARGET_SAMPLE_RATE) {
    return { samples: buffer.getChannelData(0), sampleRate: VOSK_TARGET_SAMPLE_RATE };
  }

  const offline = new OfflineAudioContext(
    1,
    Math.ceil(buffer.duration * VOSK_TARGET_SAMPLE_RATE),
    VOSK_TARGET_SAMPLE_RATE,
  );
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  return { samples: rendered.getChannelData(0), sampleRate: VOSK_TARGET_SAMPLE_RATE };
}