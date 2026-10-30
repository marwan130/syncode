import { useState } from 'react';
import {
  Routes,
  Route,
  useNavigate,
  Link,
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
import { AppActivityProvider } from './components/shared/AppActivity';
import { isValidRoomAccessKey } from './utils/roomInvites';
import { storeRoomProfile } from './utils/userStorage';
import { createRoomSession } from './utils/roomCreation';
import { SyncodeLogo } from './components/shared/SyncodeLogo';
import { PrivacyPolicyPage } from './components/shared/PrivacyPolicyPage';

function NotFoundPage() {
  return (
    <main className="home-page not-found-page">
      <Link to="/" className="home-title" aria-label="Syncode home">
        <SyncodeLogo className="home-logo" />
      </Link>
      <h1>Page not found</h1>
      <p>The page you requested does not exist.</p>
      <Link className="home-secondary not-found-link" to="/">
        Back to Syncode
      </Link>
    </main>
  );
}

function Home() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [intent, setIntent] = useState<'create' | 'join' | null>(null);

  async function createRoom(displayName: string, color: string) {
    setCreating(true);
    try {
      const roomUrl = await createRoomSession(displayName, color);
      navigate(roomUrl, { replace: true });
    } catch {
      setIntent(null);
      setError('Could not create a room. Please try again.');
      setCreating(false);
    }
  }

  function joinRoom(
    displayName: string,
    color: string,
    invite?: RoomProfileForm['invite']
  ) {
    if (!invite) {
      setError('Use a complete room invite link with its access key.');
      return;
    }
    storeRoomProfile(invite.roomId, displayName, color);
    navigate(`/room/${invite.roomId}#key=${invite.accessKey}`, {
      replace: true,
    });
  }

  async function startRoom({ displayName, color, invite }: RoomProfileForm) {
    setError('');
    if (intent === 'create') {
      await createRoom(displayName, color);
      return;
    }
    joinRoom(displayName, color, invite);
  }

  return (
    <main className="home-page">
      <h1 className="home-title">
        <SyncodeLogo className="home-logo" />
      </h1>
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
      <footer className="home-footer">
        <Link to="/privacy">Privacy</Link>
      </footer>
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
        <h1 className="home-title">
          <SyncodeLogo className="home-logo" />
        </h1>
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
        <AppActivityProvider>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/privacy" element={<PrivacyPolicyPage />} />
            <Route path="/github/callback" element={<GithubOAuthCallback />} />
            <Route path="/room/:roomId" element={<RoomRoute />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </AppActivityProvider>
      </AppFeedbackProvider>
    </GithubAuthProvider>
  );
}

export default App;
