import { useState } from 'react'
import { displayAgentName } from '../identity.ts'
import { formatDateTime, formatNumber } from '../format.ts'
import { usePolling } from '../polling.ts'
import type { AgentMemory, MemoryDocument, MemorySnapshot, MemoryStore } from '../types.ts'
import { EmptyState, LoadingState, PageTitle, SearchInput, SourceStatus, Unavailable } from '../ui.tsx'
import { PixelCharacter } from './Office.tsx'
import { PrivateGate, ProfileUnlock } from '../ProfileLock.tsx'

function DocumentBody({ document, empty }: { document?: MemoryDocument; empty: string }) {
  if (!document || !document.exists) return <p className="muted">{empty}</p>
  if (document.error) return <p className="file-notice locked">{document.error}</p>
  return <>
    <p className="doc-meta">{formatNumber(document.chars ?? 0)} chars · updated {formatDateTime(document.modified)}{document.redactions ? ` · ${document.redactions} line(s) redacted` : ''}{document.truncated ? ' · showing first 256 KB' : ''}</p>
    <pre className="task-text doc-text">{document.content || <span className="muted">(empty file)</span>}</pre>
  </>
}

function StoreCard({ title, subtitle, store, enabled, needle }: { title: string; subtitle: string; store?: MemoryStore; enabled: boolean; needle: string }) {
  const percent = store?.percent ?? 0
  const tone = percent >= 100 ? 'bad' : percent >= 80 ? 'unknown' : 'good'
  const entries = (store?.entries ?? []).map((entry, index) => ({ entry, index })).filter(({ entry }) => !needle || entry.toLowerCase().includes(needle))
  return <article className="card memory-card">
    <header className="memory-card-head"><div><p className="eyebrow">{title}</p><h2>{subtitle}</h2></div>{!enabled && <span className="badge muted">disabled in config</span>}</header>
    {!store || !store.exists ? <p className="muted">No entries yet. <code>{store?.path ?? 'memories/'}</code> is created when the agent first saves with the <code>memory</code> tool.</p>
      : store.error ? <p className="file-notice locked">{store.error}</p>
        : <>
          <div className="usage" role="img" aria-label={`${title} usage ${percent}%`}><i className={`tone-${tone}`} style={{ width: `${Math.min(100, percent)}%` }}/></div>
          <p className="doc-meta"><b>{percent}%</b> — {formatNumber(store.used)} / {formatNumber(store.limit)} chars · {store.entries.length} entr{store.entries.length === 1 ? 'y' : 'ies'} · updated {formatDateTime(store.modified)}</p>
          {percent >= 80 && <p className="file-notice">Above 80% of the limit. Hermes rejects writes that would exceed it, so the agent will need to consolidate entries soon.</p>}
          {entries.length === 0 ? <p className="muted">{needle ? 'No matching entries.' : 'The file is empty.'}</p> : <ol className="memory-entries">{entries.map(({ entry, index }) => <li key={index}><span className="entry-index">§{index + 1}</span><p>{entry}</p><small>{formatNumber(entry.length)} chars</small></li>)}</ol>}
        </>}
  </article>
}

function AgentPanel({ agent, onOpenFolders }: { agent: AgentMemory; onOpenFolders?: () => void }) {
  const [query, setQuery] = useState('')
  const [openContext, setOpenContext] = useState<string | undefined>()
  const needle = query.trim().toLowerCase()
  if (!agent.available) return <EmptyState title="Not available">{agent.reason ?? 'This agent folder is not available.'}</EmptyState>
  const settings = agent.settings
  return <div className="memory-panel">
    <div className="toolbar">
      {agent.kind === 'hermes' && <SearchInput value={query} onChange={setQuery} label="Search memory entries"/>}
      <code className="folder-path">{agent.path}</code>
      {onOpenFolders && <button type="button" className="refresh-button" onClick={onOpenFolders}>OPEN IN FOLDERS →</button>}
    </div>
    {settings && <div className="chip-row" aria-label="Memory settings">
      <span className={`chip ${settings.memoryEnabled ? '' : 'chip-muted'}`}>memory {settings.memoryEnabled ? 'on' : 'off'}</span>
      <span className={`chip ${settings.userProfileEnabled ? '' : 'chip-muted'}`}>user profile {settings.userProfileEnabled ? 'on' : 'off'}</span>
      <span className={`chip ${settings.writeApproval ? 'chip-priority' : 'chip-muted'}`}>write approval {settings.writeApproval ? 'required' : 'off'}</span>
      {settings.provider && <span className="chip chip-priority">external provider: {settings.provider}</span>}
      <span className="chip chip-muted">limits from {settings.source}</span>
    </div>}
    {agent.kind === 'hermes' ? <>
      <section className="memory-grid">
        <StoreCard title="MEMORY.MD" subtitle="Agent notes" store={agent.memory} enabled={settings?.memoryEnabled ?? true} needle={needle}/>
        <StoreCard title="USER.MD" subtitle="User profile" store={agent.user} enabled={settings?.userProfileEnabled ?? true} needle={needle}/>
      </section>
      <article className="card memory-soul">
        <header className="memory-card-head"><div><p className="eyebrow">SOUL.MD · IDENTITY (SYSTEM PROMPT SLOT #1)</p><h2>Who this agent is</h2></div></header>
        <DocumentBody document={agent.soul} empty="No SOUL.md in this profile. Hermes seeds a default one; the agent uses the built-in identity until then."/>
      </article>
    </> : <p className="card-note">OpenCode is not a Hermes profile, so it has no MEMORY.md / USER.md. Its global rules files are shown below.</p>}
    <article className="card memory-soul">
      <header className="memory-card-head"><div><p className="eyebrow">CONTEXT FILES</p><h2>{agent.kind === 'hermes' ? 'AGENTS.md, HERMES.md, CLAUDE.md…' : 'Global rules'}</h2></div></header>
      {agent.contextFiles.length === 0 ? <p className="muted">No context files in this folder. Project context files (AGENTS.md, .hermes.md) usually live in the project being worked on, not in the profile.</p>
        : <ul className="context-list">{agent.contextFiles.map((document) => <li key={document.path}>
          <button type="button" className="file-row" aria-expanded={openContext === document.path} onClick={() => setOpenContext(openContext === document.path ? undefined : document.path)}><span className="file-icon" aria-hidden="true">📄</span><span className="file-name">{document.name}</span><span className="file-size">{formatNumber(document.chars ?? 0)} chars</span></button>
          {openContext === document.path && <DocumentBody document={document} empty=""/>}
        </li>)}</ul>}
    </article>
  </div>
}

/** One agent's memory (SOUL.md, MEMORY.md, USER.md, context files), for the Office agent dialog. */
export function AgentMemoryView({ profile }: { profile: string }) {
  const snapshot = usePolling<MemorySnapshot>('/api/memory', 30_000)
  const agent = snapshot.status === 'ready' ? snapshot.data.agents.find((item) => item.profile === profile) : undefined
  if (snapshot.status === 'pending') return <LoadingState message="Reading agent memory..."/>
  if (snapshot.status === 'failed') return <EmptyState title="Not Available">{snapshot.message ?? 'Memory could not be read.'}</EmptyState>
  if (!agent) return <EmptyState title="Not available">No memory was found for this agent.</EmptyState>
  return <PrivateGate agent={agent.profile} compact>{agent.locked ? <ProfileUnlock agent={agent.profile} compact/> : <AgentPanel key={agent.profile} agent={agent}/>}</PrivateGate>
}

export function Memory({ onOpenFolders }: { onOpenFolders?: () => void }) {
  const snapshot = usePolling<MemorySnapshot>('/api/memory', 30_000)
  const data = snapshot.status === 'ready' ? snapshot.data : undefined
  const [selected, setSelected] = useState<string | undefined>()
  const agents = data?.agents ?? []
  const agent = agents.find((item) => item.profile === selected) ?? agents.find((item) => item.available) ?? agents[0]
  const source = data ? { availability: 'available' as const, data: null } : undefined
  return <><PageTitle eyebrow="MEMORY & KNOWLEDGE" title="Memory">What each agent carries into every session: its identity (SOUL.md), its bounded memory (MEMORY.md and USER.md, injected as a frozen snapshot at session start) and its context files. Read-only; secrets are redacted.</PageTitle>
    <SourceStatus source={source} fetchedAt={data?.fetchedAt} request={snapshot}/>
    <Unavailable source={source} request={snapshot}/>
    {snapshot.status === 'pending' ? <LoadingState message="Reading agent memory..."/> : agent && <>
      <div className="memory-tabs" role="tablist" aria-label="Agents">{agents.map((item) => {
        const peak = Math.max(item.memory?.percent ?? 0, item.user?.percent ?? 0)
        return <button key={item.profile} role="tab" aria-selected={item.profile === agent.profile} className={`memory-tab${item.profile === agent.profile ? ' active' : ''}`} onClick={() => setSelected(item.profile)} disabled={!item.available && !item.locked}>
          <span className="folder-glyph small" aria-hidden="true"><PixelCharacter agent={item.profile}/></span>
          <span><strong title={displayAgentName(item.profile).title}>{item.locked ? '🔒 ' : ''}{displayAgentName(item.profile).label}</strong><small>{!item.available ? item.reason ?? 'not available' : item.kind === 'opencode' ? `${item.contextFiles.length} rules file(s)` : `${(item.memory?.entries.length ?? 0) + (item.user?.entries.length ?? 0)} entries · ${peak}% peak`}</small></span>
        </button>
      })}</div>
      <PrivateGate agent={agent.profile}>{agent.locked ? <ProfileUnlock agent={agent.profile}/> : <AgentPanel key={agent.profile} agent={agent} onOpenFolders={onOpenFolders}/>}</PrivateGate>
    </>}
  </>
}
