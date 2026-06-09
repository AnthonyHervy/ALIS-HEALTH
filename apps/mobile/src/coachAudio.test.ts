import { coachSoundFile } from './coachAudio';

test('uses distinct short sounds for sent and received coach messages', () => {
  expect(coachSoundFile('send')).toBe('coach-send.wav');
  expect(coachSoundFile('reply')).toBe('coach-reply.wav');
});
