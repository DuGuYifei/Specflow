import { useState, useRef, useEffect } from 'react';
import type { Workflow, Run } from '../types';
import { Icon } from './icon';

interface SidebarProps {
  workflows: Workflow[];
  runs: Run[];
  activeWorkflow: string;
  activeRun: string;
  onSelectWorkflow: (id: string) => void;
  onSelectRun: (id: string) => void;
  onNewRun: () => void;
  onDeleteRun: (id: string) => void;
  onCreateWorkflow: () => void;
}

export function Sidebar({ workflows, runs, activeWorkflow, activeRun, onSelectWorkflow, onSelectRun, onNewRun, onDeleteRun, onCreateWorkflow }: SidebarProps) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const wf = workflows.find((w) => w.id === activeWorkflow) || workflows[0];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ⌘K / Ctrl+K focuses search
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setQuery(''); searchRef.current?.blur(); }
  };

  const filteredWorkflows = query.trim()
    ? workflows.filter((w) => w.name.toLowerCase().includes(query.toLowerCase()))
    : workflows;

  return (
    <div className="left two-col">
      <div className="col">
        <div className="col-head">
          <div>
            <div className="col-title">Workflows</div>
          </div>
          <button className="btn sm icon" title="New workflow" onClick={onCreateWorkflow}>
            <Icon name="plus" size={12} />
          </button>
        </div>
        <div className="search">
          <Icon name="search" size={12} />
          <input
            ref={searchRef}
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          <span className="kbd">⌘K</span>
        </div>
        <div className="col-list">
          {filteredWorkflows.map((w) => (
            <div
              key={w.id}
              className={`wf-card${w.id === activeWorkflow ? ' active' : ''}`}
              onClick={() => onSelectWorkflow(w.id)}
            >
              <div className="name">{w.name}</div>
              <div className="meta">
                <span><Icon name="flow" size={10} style={{ verticalAlign: -1 }} /> {w.meta}</span>
                <span><Icon name="history" size={10} style={{ verticalAlign: -1 }} /> {w.runs} runs</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="col">
        <div className="col-head">
          <div>
            <div className="col-title">Runs</div>
            <div className="col-sub">{wf?.name}</div>
          </div>
          <button className="btn sm primary" title="Start a new run" onClick={onNewRun}>
            <Icon name="play" size={10} />New
          </button>
        </div>
        <div className="col-list">
          {runs.map((r) => (
            <div
              key={r.id}
              className={`run-card${r.id === activeRun ? ' active' : ''}`}
              onClick={() => onSelectRun(r.id)}
            >
              <div className="row">
                <span className={`status-dot ${r.status}`} />
                <span className="label">{r.label}</span>
                <div className="actions" onClick={(e) => e.stopPropagation()}>
                  <button className="btn sm icon" title="Re-run" onClick={onNewRun}>
                    <Icon name="rotate" size={11} />
                  </button>
                  <button className="btn sm icon" title="Edit workflow" onClick={() => onSelectWorkflow(activeWorkflow)}>
                    <Icon name="edit" size={11} />
                  </button>
                  <button className="btn sm icon" title="Delete" onClick={() => onDeleteRun(r.id)}>
                    <Icon name="trash" size={11} />
                  </button>
                </div>
              </div>
              <div className="ticket">{r.ticket}</div>
              <div className="meta-row">
                <span>{r.time}</span>
                <span>·</span>
                <span>{r.duration}</span>
                <span style={{ marginLeft: 'auto' }} className="agent-badge">
                  <span className="dot" />{r.agent}
                </span>
              </div>
              {r.errorMsg && (
                <div style={{ color: 'var(--err)', fontSize: 10.5, fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                  {r.errorMsg}
                </div>
              )}
              {r.status === 'running' && r.progress && (
                <div style={{ color: 'var(--running)', fontSize: 10.5, fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                  {r.progress}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
