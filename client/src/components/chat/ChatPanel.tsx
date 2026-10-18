import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CSSProperties } from 'react';
import { IoSend } from 'react-icons/io5';
import type { ChatMessage as ChatMessageData } from '../../providers/SignalRCrdtProvider';
import { ScrollbarPanel } from '../shared/ScrollbarPanel';
import { ChatMessage } from './ChatMessage';

interface ChatPanelProps {
  messages: ChatMessageData[];
  onSendMessage: (content: string) => Promise<void>;
  disabled?: boolean;
  style?: CSSProperties;
}

export function ChatPanel({
  messages,
  onSendMessage,
  disabled = false,
  style,
}: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const sendingRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleInputChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const textarea = event.currentTarget;
    setDraft(textarea.value);
    textarea.style.height = 'auto';

    if (textarea.scrollHeight > 36 && textarea.scrollHeight <= 150) {
      textarea.style.height = `${textarea.scrollHeight}px`;
    } else if (textarea.scrollHeight <= 36) {
      textarea.style.height = '36px';
    } else {
      textarea.style.height = '150px';
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || disabled || sendingRef.current) return;
    sendingRef.current = true;
    setIsSending(true);
    setSendError('');
    try {
      await onSendMessage(content);
      setDraft('');
      if (textareaRef.current) textareaRef.current.style.height = '36px';
    } catch {
      setSendError('Message could not be sent. Wait a moment and try again.');
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  }

  return (
    <aside className="chat-panel" style={style} aria-label="Room chat">
      <h2>Chat</h2>
      <ScrollbarPanel
        className="conversation-scroll-area chat-messages"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <p className="chat-empty">No messages yet.</p>
        ) : (
          messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))
        )}
        <div ref={messagesEndRef} />
      </ScrollbarPanel>
      <form className="chat-form" onSubmit={handleSubmit}>
        {sendError && (
          <p className="chat-error" role="alert">
            {sendError}
          </p>
        )}
        <div className="chat-composer">
          <textarea
            ref={textareaRef}
            rows={1}
            aria-label="Message"
            placeholder="Write a message…"
            value={draft}
            maxLength={2000}
            disabled={disabled}
            onChange={handleInputChange}
            style={{ height: '36px' }}
            className="chat-message-input"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button
            type="submit"
            aria-label="Send message"
            title="Send message"
            disabled={disabled || isSending || !draft.trim()}
          >
            <IoSend aria-hidden="true" />
          </button>
        </div>
      </form>
    </aside>
  );
}
