import { useEffect, useRef, useState, useCallback } from 'react';
import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr';

interface UseSignalRConnectionProps {
  roomId: string;
  onReceiveEdit?: (fullText: string) => void;
  serverUrl?: string;
}

interface UseSignalRConnectionReturn {
  isConnected: boolean;
  sendEdit: (fullText: string) => Promise<void>;
  error: Error | null;
}

const DEFAULT_SERVER_URL = import.meta.env.VITE_BACKEND_URL || '';

export const useSignalRConnection = ({
  roomId,
  onReceiveEdit,
  serverUrl = DEFAULT_SERVER_URL,
}: UseSignalRConnectionProps): UseSignalRConnectionReturn => {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const connectionRef = useRef<HubConnection | null>(null);

  // keep callback in a ref so re-renders do not trigger a reconnect
  const onReceiveEditRef = useRef(onReceiveEdit);
  onReceiveEditRef.current = onReceiveEdit;

  useEffect(() => {
    if (!roomId) {
      return;
    }

    const connection = new HubConnectionBuilder()
      .withUrl(`${serverUrl}/collabhub`)
      .withAutomaticReconnect([0, 2000, 5000, 10000])
      .configureLogging(LogLevel.Information)
      .build();

    connectionRef.current = connection;

    connection.on('ReceiveEdit', (fullText: string) => {
      onReceiveEditRef.current?.(fullText);
    });

    connection.onreconnecting((err) => {
      console.warn('[useSignalRConnection] Reconnecting to hub...', err);
      setIsConnected(false);
    });

    connection.onreconnected((connectionId) => {
      console.info(
        '[useSignalRConnection] Reconnected successfully. ConnectionId:',
        connectionId
      );
      setIsConnected(true);

      // server drops group membership on disconnect, so rejoin the room
      connection.invoke('JoinRoom', roomId).catch((rejoinError) => {
        console.error(
          '[useSignalRConnection] Failed to rejoin room after reconnect:',
          rejoinError
        );
      });
    });

    connection.onclose((closeError) => {
      setIsConnected(false);
      if (closeError) {
        console.error(
          '[useSignalRConnection] Connection closed with error:',
          closeError
        );
        setError(closeError);
      }
    });

    let isCancelled = false;

    const startConnection = async () => {
      try {
        await connection.start();

        // stop if unmounted while the handshake was in flight to avoid leaking connections
        if (isCancelled) {
          await connection.stop();
          return;
        }

        setIsConnected(true);
        setError(null);

        await connection.invoke('JoinRoom', roomId);
      } catch (err) {
        if (!isCancelled) {
          console.error(
            '[useSignalRConnection] Connection failed to start:',
            err
          );
          setError(err instanceof Error ? err : new Error(String(err)));
          setIsConnected(false);
        }
      }
    };

    startConnection();

    return () => {
      isCancelled = true;
      setIsConnected(false);

      if (connection.state === HubConnectionState.Connected) {
        connection
          .stop()
          .catch((err) =>
            console.warn('[useSignalRConnection] Error during disconnect:', err)
          );
      }

      connectionRef.current = null;
    };
  }, [roomId, serverUrl]);

  const sendEdit = useCallback(
    async (fullText: string): Promise<void> => {
      const connection = connectionRef.current;
      if (!connection || connection.state !== HubConnectionState.Connected) {
        return;
      }

      try {
        await connection.invoke('SendEdit', roomId, fullText);
      } catch (err) {
        console.error('[useSignalRConnection] Failed to send edit:', err);
      }
    },
    [roomId]
  );

  return { isConnected, sendEdit, error };
};
