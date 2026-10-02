import type { ChatMessage as ChatMessageData } from '../../providers/SignalRCrdtProvider';

export function ChatMessage({ message }: { message: ChatMessageData }) {
  const time = new Date(message.sentAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <article className="chat-message">
      <div className="chat-message-heading">
        <strong style={{ color: message.color }}>{message.author}</strong>
        <time dateTime={message.sentAt}>{time}</time>
      </div>
      <p>{message.content}</p>
    </article>
  );
}
