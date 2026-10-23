import { useState } from 'react';
import {
  Routes,
  Route,
  useNavigate,
  Navigate,
  useParams,
  useLocation,
} from 'react-router-dom';
import EditorComponent from './components/editor/Editor';
import { RoomJoin } from './components/room/RoomJoin';
import type { RoomProfileForm } from './components/room/RoomJoin';
import { ThemeInitializer } from './components/editor/ThemePicker';
import { GithubOAuthCallback } from './components/github/GithubOAuthCallback';
import { GithubAuthProvider } from './github/GithubAuthProvider';
import { AppFeedbackProvider } from './components/shared/AppFeedback';
import { isValidRoomAccessKey } from './utils/roomInvites';
import {
  createSiteId,
  getStoredDisplayName,
  getOrCreateParticipantId,
  setStoredColor,
  setStoredDisplayName,
  setParticipantId,
  setStoredRoomCreatorToken,
} from './utils/userStorage';

function Home() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [intent, setIntent] = useState<'create' | 'join' | null>(null);

  async function startRoom({ displayName, color, invite }: RoomProfileForm) {
    if (intent === 'create') setCreating(true);
    setError('');
    if (intent === 'create') {
      try {
        const participantId = createSiteId();
        const response = await fetch('/api/rooms', { method: 'POST' });
        if (!response.ok)
          throw new Error(`Room creation failed (${response.status})`);
        const { roomId, accessKey, creatorToken } = await response.json();
        if (!roomId || !accessKey || !creatorToken)
          throw new Error('The server did not return a complete room invite.');
        setStoredDisplayName(roomId, displayName);
        setParticipantId(roomId, participantId);
        setStoredColor(color, participantId);
        setStoredRoomCreatorToken(roomId, creatorToken);
        navigate(`/room/${roomId}#key=${accessKey}`, { replace: true });
      } catch {
        setIntent(null);
        setError('Could not create a room. Please try again.');
        setCreating(false);
      }
      return;
    }

    if (!invite) {
      setError('Use a complete room invite link with its access key.');
      return;
    }
    const name = getStoredDisplayName(invite.roomId) ?? displayName;
    const participantId = getOrCreateParticipantId(invite.roomId);
    setStoredDisplayName(invite.roomId, name);
    setStoredColor(color, participantId);
    navigate(`/room/${invite.roomId}#key=${invite.accessKey}`, {
      replace: true,
    });
  }

  return (
    <main className="home-page">
      <h1>Syncode</h1>
      <div className="home-actions">
        <button onClick={() => setIntent('create')} disabled={creating}>
          Create a room
        </button>
        <button className="home-secondary" onClick={() => setIntent('join')}>
          Join a room
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {intent && (
        <RoomJoin
          key={intent}
          mode={intent}
          presentation="dialog"
          onClose={() => setIntent(null)}
          onStart={startRoom}
        />
      )}
    </main>
  );
}

function RoomRoute() {
  const { roomId } = useParams<{ roomId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const accessKey =
    new URLSearchParams(location.hash.slice(1)).get('key') ?? '';

  if (!isValidRoomAccessKey(accessKey)) {
    return (
      <main className="home-page">
        <p
          style={{
            color: 'var(--text-muted)',
            fontSize: 14,
            textAlign: 'center',
            maxWidth: 340,
          }}
        >
          This room link is missing its access key. Ask for a fresh invite link.
        </p>
        <button className="home-secondary" onClick={() => navigate('/')}>
          Back to home
        </button>
      </main>
    );
  }

  return (
    <EditorComponent
      key={`${roomId}:${accessKey}`}
      roomId={roomId}
      accessKey={accessKey}
    />
  );
}

function App() {
  return (
    <GithubAuthProvider>
      <ThemeInitializer />
      <AppFeedbackProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/github/callback" element={<GithubOAuthCallback />} />
          <Route path="/room/:roomId" element={<RoomRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppFeedbackProvider>
    </GithubAuthProvider>
  );
}

export default App;
