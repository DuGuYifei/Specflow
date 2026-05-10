import type { Workflow, Run } from '../types';
import { Icon } from './icon';

interface SidebarProps {
  workflows: Workflow[];
  runs: Run[];
  activeWorkflow: string;
  activeRun: string;
  onSelectWorkflow: (id: string) => void;
  onSelectRun: (id: string) => void;
}

export function Sidebar({ workflows, runs, activeWorkflow, activeRun, onSelectWorkflow, onSelectRun }: SidebarProps) {
  const wf = workflows.find((w) => w.id === activeWorkflow) || workflows[0];

  return (
    <div className="left two-col">
      <div className="col">
        <div className="col-head">
          <div>
            <div className="col-title">Workflows</div>
          </div>
          <button className="btn sm icon" title="New workflow"><Icon name="plus" size={12} /></button>
        </div>
        <div className="search">
          <Icon name="search" size={12} /><input placeholder="Search…" /><span className="kbd">⌘K</span>
        </div>
        <div className="col-list">
          {workflows.map((w) => (
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
          <button className="btn sm primary" title="Start a new run"><Icon name="play" size={10} />New</button>
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
                  <button className="btn sm icon" title="Re-run"><Icon name="rotate" size={11} /></button>
                  <button className="btn sm icon" title="Edit workflow"><Icon name="edit" size={11} /></button>
                  <button className="btn sm icon" title="Delete"><Icon name="trash" size={11} /></button>
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
