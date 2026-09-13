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

/**
 * return type defined as an interface to prevent accidently leaking internal variables
 * or changing the return types when modifying the hook's internals
 */

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

  /**
   * when roomId changes the ref goes from old connection to null to new connection.
   * sendEdit just needs to grab whatever the current connection is and call .invoke()
   * on it so it does not need the component to re-render to see the new connection
   * because refs are already visible immediately.
   */
  const connectionRef = useRef<HubConnection | null>(null);

  /**
   * onReceiveEdit gets a new reference on every parent render so putting it in the
   * useEffect dependency array would tear down and rebuild the websocket each time.
   * storing it in a ref keeps it up to date without re-running the effect
   */
  const onReceiveEditRef = useRef(onReceiveEdit);
  useEffect(() => {
    onReceiveEditRef.current = onReceiveEdit;
  });

  /**
   * stores the latest edit if user types while disconnected
   * will be sent automatically once connection is established or reconnected
   */
  const pendingEditRef = useRef<string | null>(null);

  useEffect(() => {
    if (!roomId) {
      return;
    }

    const connection = new HubConnectionBuilder()
      .withUrl(`${serverUrl}/collabhub`)
      .withAutomaticReconnect([0, 2000, 5000, 10000])
      .configureLogging(LogLevel.Information)
      .build();

    /**
     * storing signalR connection in ref so it is accessible by sendEdit outside
     * the useEffect hook's scope
     */
    connectionRef.current = connection;

    connection.on('ReceiveEdit', (fullText: string) => {
      onReceiveEditRef.current?.(fullText);
    });

    connection.onreconnecting((err) => {
      console.warn('[useSignalRConnection] Reconnecting to hub...', err);
      setIsConnected(false);
    });

    const flushPendingEdit = async (conn: HubConnection) => {
      if (
        pendingEditRef.current !== null &&
        conn.state === HubConnectionState.Connected
      ) {
        const textToSync = pendingEditRef.current;
        try {
          await conn.invoke('SendEdit', roomId, textToSync);
          if (pendingEditRef.current === textToSync) {
            pendingEditRef.current = null;
          }
        } catch (flushError) {
          console.error(
            '[useSignalRConnection] Failed to flush queued edit:',
            flushError
          );
        }
      }
    };

    connection.onreconnected((connectionId) => {
      console.info(
        '[useSignalRConnection] Reconnected successfully. ConnectionId:',
        connectionId
      );
      setIsConnected(true);

      // server drops group membership on disconnect, so rejoin the room
      connection
        .invoke('JoinRoom', roomId)
        .then(() => flushPendingEdit(connection))
        .catch((rejoinError) => {
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

    /**
     * connecting takes time over the network
     * if the user leaves before the connection opens, this flag tells us
     * to skip state updates and shut down the socket so we don't have a zoombie
     * websocket that consumes resources with no component listening for events
     */
    let isCancelled = false;

    const startConnection = async () => {
      try {
        await connection.start();

        if (isCancelled) {
          await connection.stop();
          return;
        }

        setIsConnected(true);
        setError(null);

        await connection.invoke('JoinRoom', roomId);
        await flushPendingEdit(connection);
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

    // cleanup runs when the components unmount or when roomId/serverUrl changes
    return () => {
      isCancelled = true;
      setIsConnected(false);

      if (connection.state !== HubConnectionState.Disconnected) {
        connection
          .stop()
          .catch((err) =>
            console.warn('[useSignalRConnection] Error during disconnect:', err)
          );
      }

      connectionRef.current = null;
      pendingEditRef.current = null;
    };
  }, [roomId, serverUrl]);

  /**
   * sends the edit to the server if connected, or queues the latest edit
   * to be sent automatically once the connection is restored
   */
  const sendEdit = useCallback(
    async (fullText: string): Promise<void> => {
      const connection = connectionRef.current;
      if (!connection || connection.state !== HubConnectionState.Connected) {
        pendingEditRef.current = fullText;
        return;
      }

      try {
        await connection.invoke('SendEdit', roomId, fullText);
        pendingEditRef.current = null;
      } catch (err) {
        console.error('[useSignalRConnection] Failed to send edit:', err);
        pendingEditRef.current = fullText;
      }
    },
    [roomId]
  );

  return { isConnected, sendEdit, error };
};
