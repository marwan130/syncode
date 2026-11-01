import { Link } from 'react-router-dom';
import { ScrollbarPanel } from './ScrollbarPanel';
import { SyncodeLogo } from './SyncodeLogo';

export function PrivacyPolicyPage() {
  return (
    <main className="privacy-page">
      <header className="privacy-header">
        <Link className="privacy-brand" to="/" aria-label="Syncode home">
          <SyncodeLogo className="privacy-logo" />
        </Link>
        <Link to="/">Back to Syncode</Link>
      </header>
      <ScrollbarPanel
        className="privacy-scroll-area"
        role="region"
        aria-label="Privacy policy"
      >
        <article className="privacy-content">
          <h1>Privacy</h1>
          <p>
            This page explains what Syncode handles when you use collaborative
            rooms, GitHub features, and code execution. Syncode does not require
            an account or password. Anyone with a complete room invite can ask
            to enter. Room approval settings determine whether they can join.
          </p>

          <h2>Information used in a room</h2>
          <p>
            Syncode processes the display name, avatar, and color you choose,
            room membership and access identifiers, and collaboration data such
            as project files, code, chat messages, cursor positions, and online
            presence. Room participants can see shared room content and profile
            details. Room admins can manage roles, editing access, and entry.
          </p>

          <h2>Where data is stored</h2>
          <p>
            The browser keeps theme and color preferences in local storage.
            Display names, membership identifiers, creator recovery tokens, and
            cached GitHub account details are kept in session storage. The room
            invitation key is carried in the URL fragment and used by the client
            to connect. Active room state is stored by the room server in Redis.
            Rooms are normally removed after the configured inactivity period,
            which defaults to 120 minutes and is checked every five minutes.
          </p>
          <p>
            The browser also keeps pending offline file and folder changes in
            IndexedDB, including room IDs, paths, and operation details needed
            to replay those changes after reconnecting. A change is removed
            after the server acknowledges it or after room recovery or expiry
            clears the pending queue. Leaving a room does not clear pending
            changes, so they can remain in that browser profile until one of
            those events occurs.
          </p>
          <p>
            For eligible rooms, the server keeps a separate recovery record for
            up to 30 days after room expiry. That record contains hashed room
            access credentials, the project root name, and approved members’
            recovery identifiers and role/edit-lock settings. It does not
            contain the room’s file contents or chat history. The active room
            data is deleted during expiry cleanup.
          </p>

          <h2>GitHub</h2>
          <p>
            GitHub sign-in is optional. When you authorize it, Syncode keeps
            GitHub tokens in the server-side encrypted token vault and uses them
            for the GitHub actions you request. The browser receives an HttpOnly
            session cookie, not the GitHub token. GitHub receives repository
            requests and changes that you choose to import or push. GitHub’s own
            privacy terms apply to its services and account data.
          </p>

          <h2>Code execution</h2>
          <p>
            When you run code or use a room terminal, the selected project files
            and submitted input are sent to Syncode’s execution service for
            processing in its runner environment. Do not put passwords, private
            keys, or other secrets in shared code or terminal input. Network
            access and available tools depend on the runner configuration of the
            Syncode deployment you use.
          </p>

          <h2>Service logs and analytics</h2>
          <p>
            Server logs may include service errors and lifecycle events. GitHub
            sign-in is rate-limited with temporary Redis counters keyed by a
            hash of the client network address. Syncode does not currently load
            advertising analytics or session-replay tools.
          </p>

          <h2>Choices and questions</h2>
          <p>
            You can stop using a room at any time. Active room data is removed
            by the inactivity cleanup described above; recovery metadata has the
            separate 30-day retention described above. Leaving a room removes
            your membership but does not immediately delete the shared files or
            chat from other participants’ room. Re-entry may require admin
            approval. For privacy questions, contact the project maintainer
            through the{' '}
            <a
              href="https://github.com/marwan130"
              target="_blank"
              rel="noreferrer"
            >
              Syncode maintainer profile
            </a>
            . Please do not post private information or credentials in a public
            issue.
          </p>

          <p className="privacy-disclaimer">
            This page describes the current implementation and is not legal
            advice.
          </p>
        </article>
      </ScrollbarPanel>
    </main>
  );
}
