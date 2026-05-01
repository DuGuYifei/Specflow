export function App() {
  return (
    <main className="workspace">
      <aside className="sidebar" aria-label="Workflow navigation">
        <div className="brand">Specflow</div>
        <button className="navItem isActive" type="button">
          Canvas
        </button>
        <button className="navItem" type="button">
          Sessions
        </button>
      </aside>

      <section className="canvasShell" aria-label="Workflow canvas">
        <header className="toolbar">
          <div>
            <p className="eyebrow">Workflow</p>
            <h1>New Specflow workflow</h1>
          </div>
          <button className="primaryAction" type="button">
            Run
          </button>
        </header>

        <div className="canvas">
          <div className="node nodeInput">
            <span className="nodeLabel">Input</span>
            <strong>Start context</strong>
          </div>
          <div className="node nodeAgent">
            <span className="nodeLabel">Agent</span>
            <strong>Codex task</strong>
          </div>
          <svg className="connectionLayer" aria-hidden="true">
            <path d="M 320 224 C 420 224, 430 334, 540 334" />
          </svg>
        </div>
      </section>
    </main>
  );
}
