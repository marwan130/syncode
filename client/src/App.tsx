import { useEffect } from 'react';
import {
  Routes,
  Route,
  useNavigate,
  Navigate,
  useParams,
} from 'react-router-dom';
import EditorComponent from './components/editor/Editor';

function AutoCreateRoom() {
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;

    async function createAndRedirect() {
      try {
        const res = await fetch('/api/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) {
          const data = await res.json();
          if (active && data?.roomId) {
            navigate(`/room/${data.roomId}`, { replace: true });
            return;
          }
        }
      } catch (err) {
        console.warn(
          '[AutoCreateRoom] Server room creation failed, falling back to local id:',
          err
        );
      }

      if (active) {
        const fallbackId = Math.random().toString(36).substring(2, 10);
        navigate(`/room/${fallbackId}`, { replace: true });
      }
    }

    createAndRedirect();

    return () => {
      active = false;
    };
  }, [navigate]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100vw',
        height: '100vh',
        background: '#121214',
        color: '#9ca3af',
        fontFamily: 'system-ui, sans-serif',
        gap: 16,
      }}
    >
      <div
        style={{
          fontSize: 26,
          fontWeight: 700,
          background: 'linear-gradient(135deg, #a5f3fc 0%, #38bdf8 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          letterSpacing: '-0.5px',
        }}
      >
        syncode
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 13,
          color: '#6b7280',
        }}
      >
        <div
          style={{
            width: 14,
            height: 14,
            border: '2px solid #38bdf8',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <span>Creating your room...</span>
      </div>
    </div>
  );
}

function RoomRoute() {
  const { roomId } = useParams<{ roomId: string }>();
  return <EditorComponent key={roomId} roomId={roomId} />;
}

function App() {
  return (
    <main
      style={{
        width: '100vw',
        height: '100vh',
        margin: 0,
        padding: 0,
        overflow: 'hidden',
      }}
    >
      <Routes>
        <Route path="/" element={<AutoCreateRoom />} />
        <Route path="/room/:roomId" element={<RoomRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </main>
  );
}

export default App;
