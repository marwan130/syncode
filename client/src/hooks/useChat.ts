import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type {
  ChatMessage,
  ConnectionStatus,
  SignalRCrdtProvider,
} from '../providers/SignalRCrdtProvider';

interface UseChatProps {
  providerRef: RefObject<SignalRCrdtProvider | null>;
  status: ConnectionStatus;
}

export function useChat({ providerRef, status }: UseChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider || status === 'disconnected') {
      setMessages([]);
      return;
    }

    const appendMessage = (message: ChatMessage) => {
      setMessages((current) => {
        if (current.some((existing) => existing.id === message.id))
          return current;
        return [...current, message].slice(-100);
      });
    };
    const unsubscribeMessage = provider.onChatMessage(appendMessage);
    const unsubscribeHistory = provider.onChatHistory((history) => {
      setMessages((current) => {
        const merged = new Map(history.map((message) => [message.id, message]));
        current.forEach((message) => merged.set(message.id, message));
        return Array.from(merged.values()).slice(-100);
      });
    });

    return () => {
      unsubscribeMessage();
      unsubscribeHistory();
    };
  }, [providerRef, status]);

  const sendMessage = useCallback(
    async (content: string) => {
      const text = content.trim();
      if (!text || text.length > 2000) return;
      await providerRef.current?.sendChatMessage(text);
    },
    [providerRef]
  );

  return { messages, sendMessage };
}
