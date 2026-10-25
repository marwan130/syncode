import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCrdtSync } from '../../hooks/useCrdtSync';
import { useEditorRoomIdentity } from '../../hooks/useEditorRoomIdentity';
import { useGithubAuth } from '../../github/useGithubAuth';
import { createSiteId, getStoredRoomCreatorToken } from '../../utils/userStorage';

export function useEditorRoomSession(propRoomId: string | undefined, accessKey: string) {
  const params = useParams<{ roomId: string }>();
  const navigate = useNavigate();
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

  useEffect(() => {
    connection.providerRef.current?.setLocalAvatarUrl(account?.avatarUrl);
  }, [account?.avatarUrl, connection.providerRef]);

  useEffect(() => {
    if (connection.wasKicked) navigate('/', { replace: true });
  }, [connection.wasKicked, navigate]);

  return { roomId, identity, account, ...connection };
}

function resolveRoomId(propRoomId: string | undefined, routeRoomId: string | undefined): string {
  return propRoomId ?? routeRoomId ?? '';
}

function hasRoomConnectionDetails(
  roomId: string,
  accessKey: string,
  displayName: string
): boolean {
  return Boolean(roomId && accessKey && displayName);
}
