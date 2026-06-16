import type { CoachChatMessage } from './types';

const MAX_COACH_HISTORY_MESSAGES = 30;
const MAX_COACH_MESSAGE_CHARS = 3000;

function compactCoachMessage(message: CoachChatMessage): CoachChatMessage | null {
  const role = message.role === 'assistant' ? 'assistant' : message.role === 'user' ? 'user' : null;
  const content = typeof message.content === 'string' ? message.content.trim() : '';
  if (!role || !content) {
    return null;
  }
  return {
    role,
    content: content.slice(0, MAX_COACH_MESSAGE_CHARS),
    ...(message.hidden ? { hidden: true } : {})
  };
}

export function normalizeCoachChatHistory(messages: readonly CoachChatMessage[] | null | undefined): CoachChatMessage[] {
  return (Array.isArray(messages) ? messages : [])
    .map(compactCoachMessage)
    .filter((message): message is CoachChatMessage => message !== null)
    .slice(-MAX_COACH_HISTORY_MESSAGES);
}

export function coachHistoryForRequest(messages: readonly CoachChatMessage[] | null | undefined): CoachChatMessage[] {
  return normalizeCoachChatHistory(messages).map(({ role, content }) => ({ role, content }));
}
