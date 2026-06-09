export type CoachSoundKind = 'send' | 'reply';

export function coachSoundFile(kind: CoachSoundKind): string {
  return kind === 'send' ? 'coach-send.wav' : 'coach-reply.wav';
}

function coachSoundSource(kind: CoachSoundKind) {
  if (kind === 'send') {
    return require('../assets/sounds/coach-send.wav');
  }
  return require('../assets/sounds/coach-reply.wav');
}

export async function playCoachSound(kind: CoachSoundKind): Promise<void> {
  try {
    const { Audio } = require('expo-av') as typeof import('expo-av');
    const { sound } = await Audio.Sound.createAsync(coachSoundSource(kind), {
      shouldPlay: true,
      volume: kind === 'send' ? 0.28 : 0.22
    });
    sound.setOnPlaybackStatusUpdate((status) => {
      if ('didJustFinish' in status && status.didJustFinish) {
        void sound.unloadAsync();
      }
    });
  } catch {
    // Audio feedback is decorative; chat must stay responsive if Android blocks playback.
  }
}
