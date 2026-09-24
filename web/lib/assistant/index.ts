export { SseParser, type SseMessage } from "./sse";
export {
  CANCEL_RE, CONFIRM_RE, assistantApiBase, cancelAction, confirmAction, streamAssistant,
  type AssistantEvent, type StreamOptions,
} from "./client";
export { useAssistant, type AssistantStatus, type AssistantSurface, type ChatMessage, type UseAssistantOptions } from "./hooks";
