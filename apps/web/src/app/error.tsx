"use client";
export default function WorkspaceError() {
  return <main id="main" className="container">
    <h1>The workspace could not be loaded</h1>
    <p role="alert">This may be a temporary connection or workspace error. It does not necessarily mean you are signed out. Saved research and private drafts remain on the server.</p>
    <p>Keep any other tabs with unfinished work open. Retry this page to check your session and load the latest saved work.</p>
    <button className="primary" onClick={() => window.location.reload()}>Retry this page</button>
  </main>;
}
