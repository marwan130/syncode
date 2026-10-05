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
import { JoinRoomModal } from './components/room/JoinRoomModal';
import { ThemeInitializer } from './components/editor/ThemePicker';

function Home() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [joinRoomOpen, setJoinRoomOpen] = useState(false);

  async function createRoom() {
    setCreating(true);
    setError('');
    try {
      const response = await fetch('/api/rooms', { method: 'POST' });
      if (!response.ok)
        throw new Error(`Room creation failed (${response.status})`);
      const { roomId, accessKey } = await response.json();
      if (!roomId || !accessKey)
        throw new Error('The server did not return a complete room invite.');
      navigate(`/room/${roomId}#key=${accessKey}`, { replace: true });
    } catch {
      setError('Could not create a room. Please try again.');
      setCreating(false);
    }
  }

  return (
    <main className="home-page">
      <h1>Syncode</h1>
      <div className="home-actions">
        <button onClick={createRoom} disabled={creating}>
          Create a room
        </button>
        <button
          className="home-secondary"
          onClick={() => setJoinRoomOpen(true)}
        >
          Join a room
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <JoinRoomModal
        isOpen={joinRoomOpen}
        onClose={() => setJoinRoomOpen(false)}
      />
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
