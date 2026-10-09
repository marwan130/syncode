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
import { getStoredDisplayName, setStoredColor, setStoredDisplayName } from './utils/userStorage';

function Home() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [intent, setIntent] = useState<'create' | 'join' | null>(null);

  async function startRoom({ displayName, color, inviteLink }: RoomProfileForm) {
    if (intent === 'create') setCreating(true);
    setError('');
    if (intent === 'create') {
      try {
        const response = await fetch('/api/rooms', { method: 'POST' });
        if (!response.ok)
          throw new Error(`Room creation failed (${response.status})`);
        const { roomId, accessKey } = await response.json();
        if (!roomId || !accessKey)
          throw new Error('The server did not return a complete room invite.');
        setStoredDisplayName(roomId, displayName);
        setStoredColor(color);
        navigate(`/room/${roomId}#key=${accessKey}`, { replace: true });
      } catch {
        setIntent(null);
        setError('Could not create a room. Please try again.');
        setCreating(false);
      }
      return;
    }

    let inviteUrl: URL;
    try {
      inviteUrl = new URL(
        inviteLink.startsWith('/') || inviteLink.startsWith('http')
          ? inviteLink
          : `/room/${inviteLink}`,
        window.location.origin
      );
    } catch {
      setError('Enter a valid room invite link.');
      return;
    }
    const roomId = inviteUrl.pathname.match(/\/room\/([a-zA-Z0-9_-]+)\/?$/)?.[1];
    const accessKey = new URLSearchParams(inviteUrl.hash.slice(1)).get('key') ?? '';
    if (!roomId || !/^[0-9a-f]{64}$/i.test(accessKey)) {
      setError('Use a complete room invite link with its access key.');
      return;
    }
    const name = getStoredDisplayName(roomId) ?? displayName;
    setStoredDisplayName(roomId, name);
    setStoredColor(color);
    navigate(`/room/${roomId}#key=${accessKey}`, { replace: true });
  }

  return (
    <main className="home-page">
      <h1>Syncode</h1>
      <div className="home-actions">
        <button onClick={() => setIntent('create')} disabled={creating}>
          Create a room
        </button>
        <button
          className="home-secondary"
          onClick={() => setIntent('join')}
        >
          Join a room
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {intent && (
        <RoomJoin
          mode={intent}
          presentation="dialog"
          onClose={() => setIntent(null)}
          onStart={(profile) => void startRoom(profile)}
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

  if (!/^[0-9a-f]{64}$/i.test(accessKey)) {
    return (
      <main className="home-page">
        <p style={{ color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', maxWidth: 340 }}>
          This room link is missing its access key. Ask for a fresh invite link.
        </p>
        <button className="home-secondary" onClick={() => navigate('/')}>Back to home</button>
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
    <>
      <ThemeInitializer />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:roomId" element={<RoomRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default App;
