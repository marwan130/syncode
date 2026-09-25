import { useState } from 'react';
import {
  Routes,
  Route,
  useNavigate,
  Navigate,
  useParams,
} from 'react-router-dom';
import EditorComponent from './components/editor/Editor';
import { JoinRoomModal } from './components/room/JoinRoomModal';

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
      const { roomId } = await response.json();
      if (!roomId) throw new Error('The server did not return a room ID.');
      navigate(`/room/${roomId}`, { replace: true });
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
  return <EditorComponent key={roomId} roomId={roomId} />;
}

function App() {
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        margin: 0,
        padding: 0,
        overflow: 'hidden',
      }}
    >
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:roomId" element={<RoomRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default App;
