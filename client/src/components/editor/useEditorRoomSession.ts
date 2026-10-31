import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useCrdtSync } from '../../hooks/useCrdtSync';
import { useEditorRoomIdentity } from '../../hooks/useEditorRoomIdentity';
import { useGithubAuth } from '../../github/useGithubAuth';
import {
  createSiteId,
  getOrCreateJoinRequestId,
  getStoredRoomCreatorToken,
  renewJoinRequestId,
} from '../../utils/userStorage';
import { isValidRoomAccessKey } from '../../utils/roomInvites';

export function useEditorRoomSession(
  propRoomId: string | undefined,
  accessKey: string
) {
  const params = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const roomId = resolveRoomId(propRoomId, params.roomId);
  const identity = useEditorRoomIdentity(roomId);
  const { account } = useGithubAuth();
  const [siteId] = useState(createSiteId);
  const creatorToken = getStoredRoomCreatorToken(roomId);
  const connection = useCrdtSync({
    siteId,
    roomId,
    accessKey,
    displayName: identity.displayName || undefined,
    color: identity.localColor,
    creatorToken,
    enabled: hasRoomConnectionDetails(roomId, accessKey, identity.displayName),
  });
  const leaveRoom = async () => {
    const provider = connection.providerRef.current;
    if (!provider) throw new Error('The room connection is unavailable.');
    if (connection.status === 'awaiting-approval') {
      // Cancel the pending join request and create a fresh room for ourselves
      await provider.cancelJoinRequest();
      renewJoinRequestId(roomId);
      navigate('/', { replace: true });
      return;
    }
    await provider.leaveRoom();
    navigate('/', { replace: true });
  };

  useEffect(() => {
    connection.providerRef.current?.setLocalAvatarUrl(account?.avatarUrl);
  }, [account?.avatarUrl, connection.providerRef]);

  useEffect(() => {
    if (connection.wasKicked) navigate('/', { replace: true });
  }, [connection.wasKicked, navigate]);

  useEffect(() => {
    if (connection.status !== 'join-rejected') return;
    renewJoinRequestId(roomId);
    navigate(getReturnRoomInvite(location.state)?.path ?? '/', {
      replace: true,
      state: null,
    });
  }, [connection.status, location.state, navigate, roomId]);

  useEffect(() => {
    if (connection.status !== 'connected') return;
    const previousRoom = getReturnRoomInvite(location.state);
    const provider = connection.providerRef.current;
    if (!previousRoom || !provider) return;
    void provider
      .revokeRoomMembership(
        previousRoom.roomId,
        previousRoom.accessKey,
        getOrCreateJoinRequestId(previousRoom.roomId)
      )
      .catch(() => {});
  }, [connection.providerRef, connection.status, location.state]);

  useEffect(() => {
    const provider = connection.providerRef.current;
    if (!provider) return;
    return provider.onRoomExpired(() => {
      // Room expired: preserve local offline work so it can be restored
      // or downloaded, rather than immediately navigating away.
    });
  }, [connection.providerRef, connection.status, navigate, roomId]);

  return { roomId, identity, account, leaveRoom, ...connection };
}

function resolveRoomId(
  propRoomId: string | undefined,
  routeRoomId: string | undefined
): string {
  return propRoomId ?? routeRoomId ?? '';
}

function hasRoomConnectionDetails(
  roomId: string,
  accessKey: string,
  displayName: string
): boolean {
  return Boolean(roomId && accessKey && displayName);
}

function getReturnRoomInvite(
  state: unknown
): { path: string; roomId: string; accessKey: string } | null {
  if (!state || typeof state !== 'object') return null;
  const returnTo = (state as { returnTo?: unknown }).returnTo;
  if (typeof returnTo !== 'string' || !returnTo.startsWith('/room/'))
    return null;

  try {
    const url = new URL(returnTo, window.location.origin);
    const roomId = url.pathname.match(/^\/room\/([a-zA-Z0-9_-]+)\/?$/)?.[1];
    const accessKey = new URLSearchParams(url.hash.slice(1)).get('key') ?? '';
    if (
      url.origin !== window.location.origin ||
      !roomId ||
      !isValidRoomAccessKey(accessKey)
    )
      return null;
    return {
      path: `${url.pathname}${url.search}${url.hash}`,
      roomId,
      accessKey,
    };
  } catch {
    return null;
  }
}
