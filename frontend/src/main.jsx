import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, ArrowLeft, ArrowUp, Check, ChevronDown, FileKey2, KeyRound,
  LockKeyhole, Menu, MessageSquare, Moon, MoreHorizontal, Plus, Settings2,
  ShieldCheck, Sparkles, Sun, Trash2, X,
} from 'lucide-react';
import './style.css';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const initialMessages = [{
  id: 'welcome', role: 'assistant', kind: 'welcome',
  content: 'Hi, I’m ready to investigate your Vault access issues.',
  time: 'Just now',
}];
const starterPrompts = [
  { icon: KeyRound, title: 'Check a token', text: 'Why can’t my token read secret/data/app/db?' },
  { icon: FileKey2, title: 'Review a policy', text: 'Help me understand my app policy permissions.' },
  { icon: Activity, title: 'Inspect Vault health', text: 'Check the status of my Vault server.' },
];

function readStored(key, fallback) {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; }
  catch { return fallback; }
}
function makeChat() {
  return { id: crypto.randomUUID(), title: 'New investigation', updated: Date.now(), messages: [...initialMessages] };
}
function App() {
  const [chats, setChats] = useState(() => {
    const saved = readStored('vaultsleuth.chats', []);
    return saved.length ? saved : [makeChat()];
  });
  const [activeId, setActiveId] = useState(() => localStorage.getItem('vaultsleuth.active') || null);
  const [settings, setSettings] = useState(() => {
    const saved = readStored('vaultsleuth.settings', {});
    return { name: saved.name || '', theme: saved.theme || 'light' };
  });
  const [drawer, setDrawer] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [backend, setBackend] = useState('checking');
  const [backendConfig, setBackendConfig] = useState(null);
  const [vaultState, setVaultState] = useState('unknown');
  const [toast, setToast] = useState('');
  const activeChat = chats.find(chat => chat.id === activeId) || chats[0];

  useEffect(() => {
    if (!activeId || !chats.some(chat => chat.id === activeId)) setActiveId(chats[0]?.id);
  }, [activeId, chats]);
  useEffect(() => { localStorage.setItem('vaultsleuth.chats', JSON.stringify(chats)); }, [chats]);
  useEffect(() => { if (activeChat) localStorage.setItem('vaultsleuth.active', activeChat.id); }, [activeChat]);
  useEffect(() => {
    localStorage.setItem('vaultsleuth.settings', JSON.stringify(settings));
    document.documentElement.dataset.theme = settings.theme;
  }, [settings]);
  useEffect(() => {
    fetch(`${API_BASE}/health`).then(r => setBackend(r.ok ? 'online' : 'offline')).catch(() => setBackend('offline'));
    fetch(`${API_BASE}/api/config`).then(r => r.ok ? r.json() : null).then(setBackendConfig).catch(() => setBackendConfig(null));
  }, []);

  const updateChat = (id, updater) => setChats(items => items.map(chat => chat.id === id ? updater(chat) : chat));
  const createChat = () => {
    const chat = makeChat(); setChats(items => [chat, ...items]); setActiveId(chat.id); setDrawer(false);
  };
  const removeChat = (id, event) => {
    event?.stopPropagation();
    setChats(items => {
      const remaining = items.filter(item => item.id !== id);
      return remaining.length ? remaining : [makeChat()];
    });
    if (activeId === id) setActiveId(chats.find(item => item.id !== id)?.id || null);
  };
  const sendMessage = async (override) => {
    const text = (override ?? draft).trim();
    if (!text || busy || !activeChat) return;
    const userMessage = { id: crypto.randomUUID(), role: 'user', content: text, time: 'Now', author: settings.name || 'Guest', authorInitial: (settings.name || 'Guest').trim().slice(0, 1).toUpperCase() };
    updateChat(activeChat.id, chat => ({ ...chat, title: chat.messages.length <= 1 ? text.slice(0, 38) : chat.title, updated: Date.now(), messages: [...chat.messages, userMessage] }));
    setDraft(''); setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || 'Could not reach VaultSleuth. Check the backend settings.');
      const answer = { id: crypto.randomUUID(), role: 'assistant', content: body.answer, time: 'Now' };
      updateChat(activeChat.id, chat => ({ ...chat, updated: Date.now(), messages: [...chat.messages, answer] }));
    } catch (error) {
      updateChat(activeChat.id, chat => ({ ...chat, messages: [...chat.messages, { id: crypto.randomUUID(), role: 'assistant', kind: 'error', content: error.message, time: 'Now' }] }));
    } finally { setBusy(false); }
  };
  const checkVault = async () => {
    setVaultState('checking');
    try {
      const response = await fetch(`${API_BASE}/api/vault/check`, { method: 'POST' });
      const result = await response.json();
      setVaultState(result.reachable && result.token_valid ? 'connected' : result.reachable ? 'warning' : 'offline');
    } catch { setVaultState('offline'); }
  };
  const saveSettings = async (next) => {
    const safeSettings = { name: next.name.trim(), theme: next.theme };
    setSettings(safeSettings);
    setToast('Preferences saved on this device.'); setTimeout(() => setToast(''), 3200);
  };
  const groupedChats = useMemo(() => ({
    today: chats.filter(chat => Date.now() - chat.updated < 86400000),
    earlier: chats.filter(chat => Date.now() - chat.updated >= 86400000),
  }), [chats]);

  return <div className="app-shell">
    <aside className={`sidebar ${drawer ? 'sidebar-open' : ''}`}>
      <div className="brand-row"><div className="brand-mark"><ShieldCheck size={21} strokeWidth={2.3}/></div><span className="brand-name">vault<span>sleuth</span></span><button className="icon-button close-mobile" onClick={() => setDrawer(false)} aria-label="Close menu"><X size={18}/></button></div>
      <button className="new-chat" onClick={createChat}><Plus size={17}/><span>New investigation</span><kbd>⌘ K</kbd></button>
      <div className="sidebar-section"><div className="section-title"><span>Workspace</span><ChevronDown size={14}/></div>
        <button className="nav-item active"><MessageSquare size={16}/><span>Conversations</span><span className="nav-count">{chats.length}</span></button>
        <button className="nav-item" onClick={checkVault}><Activity size={16}/><span>Vault connections</span><span className={`tiny-status ${vaultState === 'connected' ? 'good' : ''}`}/></button>
      </div>
      <div className="history-list">
        {groupedChats.today.length > 0 && <><div className="history-label">Today</div>{groupedChats.today.map(chat => <div key={chat.id} onClick={() => { setActiveId(chat.id); setDrawer(false); }} className={`history-item ${chat.id === activeChat?.id ? 'selected' : ''}`}><MessageSquare size={14}/><span>{chat.title}</span><button onClick={e => removeChat(chat.id, e)} aria-label="Delete conversation"><Trash2 size={13}/></button></div>)}</>}
        {groupedChats.earlier.length > 0 && <><div className="history-label">Previous 7 days</div>{groupedChats.earlier.map(chat => <div key={chat.id} onClick={() => setActiveId(chat.id)} className={`history-item ${chat.id === activeChat?.id ? 'selected' : ''}`}><MessageSquare size={14}/><span>{chat.title}</span></div>)}</>}
      </div>
      <div className="sidebar-bottom">
        <button className="profile-row" onClick={() => setSettingsOpen(true)}><div className="avatar">{(settings.name || 'Guest').trim().slice(0, 1).toUpperCase()}</div><div className="profile-info"><strong>{settings.name || 'Guest'}</strong><span>Personal settings</span></div><MoreHorizontal size={17}/></button>
      </div>
    </aside>
    {drawer && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setDrawer(false)}/>}

    <main className="main-area">
      <header className="topbar"><div className="top-left"><button className="icon-button menu-toggle" onClick={() => setDrawer(true)} aria-label="Open menu"><Menu size={19}/></button><div className="breadcrumb">Workspace <span>/</span> <strong>Investigation</strong></div><div className="secure-label"><LockKeyhole size={12}/> Secure session</div></div><div className="top-right"><button className="connection-pill" onClick={checkVault}><span className={`connection-dot ${vaultState === 'connected' ? 'connected' : vaultState === 'offline' ? 'offline' : ''}`}/><span>Vault {vaultState === 'connected' ? 'connected' : vaultState === 'checking' ? 'checking' : 'not checked'}</span><ChevronDown size={14}/></button><button className="icon-button theme-toggle" onClick={() => setSettings(s => ({...s, theme: s.theme === 'dark' ? 'light' : 'dark'}))} aria-label="Toggle theme">{settings.theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}</button><button className="top-avatar" onClick={() => setSettingsOpen(true)}>{(settings.name || 'Guest').trim().slice(0, 1).toUpperCase()}</button></div></header>
      <section className={`chat-view ${activeChat?.messages.length > 1 ? 'has-messages' : ''}`}>
        {activeChat?.messages.length <= 1 ? <div className="welcome-wrap">
          <div className="welcome-eyebrow"><span className="sparkle-icon"><Sparkles size={13}/></span> YOUR VAULT, DECODED</div>
          <h1>Access issues,<br/><span>meet their match.</span></h1>
          <p className="welcome-copy">Tell me what’s going wrong. I’ll trace the permissions,<br className="desktop-break"/> policies, and paths behind it.</p>
          <div className="starter-grid">{starterPrompts.map(({icon: Icon, title, text}) => <button key={title} className="starter-card" onClick={() => sendMessage(text)}><span className="starter-icon"><Icon size={17}/></span><span className="starter-title">{title}</span><span className="starter-text">{text}</span><ArrowLeft size={14} className="starter-arrow"/></button>)}</div>
          <div className="welcome-input-wrap"><Composer value={draft} onChange={setDraft} onSend={() => sendMessage()} busy={busy}/><div className="input-hint"><span><span className="hint-dot"/> Read-only inspection · Your secrets stay private</span><span>Press <kbd>↵</kbd> to send</span></div></div>
          <div className="welcome-footer"><div className="avatar-stack"><span>V</span><span>H</span><span>✓</span></div><span>Built for teams who run on Vault</span><span className="footer-divider"/> <span className="backend-state"><i className={backend === 'online' ? 'online' : ''}/>{backend === 'online' ? 'System operational' : backend === 'checking' ? 'Connecting…' : 'Backend offline'}</span></div>
        </div> : <>
          <div className="conversation-heading"><div><div className="welcome-eyebrow"><span className="sparkle-icon"><Sparkles size={13}/></span> INVESTIGATION</div><h2>{activeChat?.title}</h2></div><button className="subtle-button" onClick={checkVault}><Activity size={15}/> Check connection</button></div>
          <div className="messages">{activeChat?.messages.filter(m => m.id !== 'welcome').map(message => <Message key={message.id} message={message}/>)}{busy && <div className="message assistant-message"><div className="message-avatar"><ShieldCheck size={16}/></div><div className="message-body"><div className="message-meta"><strong>VaultSleuth</strong><span>Investigating</span></div><div className="typing"><i/><i/><i/><span>Checking Vault permissions</span></div></div></div>}</div>
          <div className="conversation-composer"><Composer value={draft} onChange={setDraft} onSend={() => sendMessage()} busy={busy}/><div className="input-hint"><span><span className="hint-dot"/> Read-only inspection · Your secrets stay private</span><span>Press <kbd>↵</kbd> to send</span></div></div>
        </>}
      </section>
      <footer className="page-footer"><span>VaultSleuth can make mistakes. Verify critical changes before applying them.</span><span><a href="http://localhost:8000/docs" target="_blank" rel="noreferrer">API docs</a><span className="footer-divider"/><a href="https://developer.hashicorp.com/vault/docs" target="_blank" rel="noreferrer">Vault docs <ArrowUp size={11}/></a></span></footer>
    </main>
    {settingsOpen && <SettingsModal settings={settings} backendConfig={backendConfig} onClose={() => setSettingsOpen(false)} onSave={saveSettings}/>}
    {toast && <div className="toast"><Check size={16}/>{toast}</div>}
  </div>;
}

function Composer({ value, onChange, onSend, busy }) {
  return <div className="composer"><div className="composer-leading"><div className="composer-logo"><ShieldCheck size={18}/></div></div><textarea value={value} onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }} placeholder="Describe your Vault access issue…" rows={1}/><button className={`send-button ${value.trim() && !busy ? 'ready' : ''}`} disabled={!value.trim() || busy} onClick={onSend} aria-label="Send message">{busy ? <div className="spinner"/> : <ArrowUp size={18}/>}</button></div>;
}
function Message({ message }) {
  const isUser = message.role === 'user';
  return <article className={`message ${isUser ? 'user-message' : 'assistant-message'} ${message.kind === 'error' ? 'error-message' : ''}`}><div className="message-avatar">{isUser ? (message.authorInitial || 'G') : <ShieldCheck size={16}/>}</div><div className="message-body"><div className="message-meta"><strong>{isUser ? (message.author || 'Guest') : 'VaultSleuth'}</strong><span>{message.time}</span></div><div className="message-content">{message.kind === 'error' && <div className="error-title">I couldn’t complete that request</div>}{message.content}</div>{!isUser && !message.kind && <div className="source-tag"><ShieldCheck size={12}/> Based on Vault inspection</div>}</div></article>;
}
function SettingsModal({ settings, backendConfig, onClose, onSave }) {
  const [form, setForm] = useState({name: settings.name || ''});
  return <div className="modal-scrim" onMouseDown={e => e.target === e.currentTarget && onClose()}><section className="settings-modal"><header><div className="modal-heading-icon"><Settings2 size={18}/></div><div><h3>Personal settings</h3><p>Your name is saved in this browser. Backend connections are managed by the operator.</p></div><button className="icon-button modal-close" onClick={onClose}><X size={18}/></button></header><div className="modal-content"><label>Your name<span className="field-subtitle">Optional — shown only in this browser</span><div className="field-wrap"><span className="name-field-icon">Aa</span><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Guest" maxLength={48}/></div></label><div className="connection-summary"><span><i className={backendConfig?.vault_token_configured ? 'status-good' : ''}/>{backendConfig?.vault_token_configured ? 'Vault token configured' : 'Vault token not configured'}</span><span><i className={backendConfig?.gemini_configured ? 'status-good' : ''}/>{backendConfig?.gemini_configured ? 'Gemini API key configured' : 'Gemini API key not configured'}</span></div><div className="security-note"><LockKeyhole size={15}/><span>Vault and Gemini credentials are never sent from this screen. Configure them through the backend environment or an approved secret manager.</span></div></div><footer><button className="cancel-button" onClick={onClose}>Cancel</button><button className="save-button" onClick={() => { onSave(form); onClose(); }}>Save preferences <ArrowLeft size={15}/></button></footer></section></div>;
}

createRoot(document.getElementById('root')).render(<App/>);
