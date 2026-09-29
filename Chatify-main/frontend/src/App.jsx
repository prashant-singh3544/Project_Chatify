import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const API_BASE = import.meta.env.VITE_API_URL || '';
const socketUrl = import.meta.env.VITE_SOCKET_URL
  || API_BASE
  || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? `http://${window.location.hostname}:3000`
    : window.location.origin);
const socket = io(socketUrl, { autoConnect: false });

const formatTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Now';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const validateEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const getInitials = (value = '') =>
  value
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'U';

const getPrivateRoom = (firstUserId, secondUserId) => [String(firstUserId), String(secondUserId)].sort().join(':');

const readResponse = async (response) => {
  const body = await response.text();
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw new Error(`Server returned ${response.status} instead of JSON. Restart the backend and open the Vite URL.`);
  }
};

function App() {
  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState('');
  const [token, setToken] = useState(localStorage.getItem('chatify-token') || '');
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('chatify-user') || 'null'));
  const [contacts, setContacts] = useState([]);
  const [selectedContact, setSelectedContact] = useState(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileName, setProfileName] = useState(user?.name || '');
  const [profileAvatar, setProfileAvatar] = useState(user?.avatar || '');
  const [typingUser, setTypingUser] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('chatify-theme') || 'dark');
  const [connectionState, setConnectionState] = useState('connecting');
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editText, setEditText] = useState('');

  const updateUser = (nextUser) => {
    localStorage.setItem('chatify-user', JSON.stringify(nextUser));
    setUser(nextUser);
    setProfileName(nextUser.name || '');
    setProfileAvatar(nextUser.avatar || '');
  };

  useEffect(() => {
    document.body.dataset.theme = theme;
    localStorage.setItem('chatify-theme', theme);
  }, [theme]);

  const avatarContent = (value, label) => value
    ? <img src={value} alt={`${label} avatar`} />
    : getInitials(label);

  useEffect(() => {
    if (!token) {
      setContacts([]);
      setSelectedContact(null);
      return undefined;
    }

    const fetchContacts = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/auth/users`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json();
        const availableContacts = (data.users || []).filter((contact) => String(contact.id) !== String(user?.id));
        setContacts(availableContacts);
        setSelectedContact((currentContact) =>
          availableContacts.find((contact) => String(contact.id) === String(currentContact?.id)) || availableContacts[0] || null
        );
      } catch {
        setStatus('Could not load contacts.');
      }
    };

    fetchContacts();
    return undefined;
  }, [token, user?.id]);

  useEffect(() => {
    if (!token || !selectedContact) {
      setMessages([]);
      return undefined;
    }

    let cancelled = false;
    setMessages([]);

    const fetchMessages = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/messages?contactId=${encodeURIComponent(selectedContact.id)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (response.ok && !cancelled) {
          const data = await response.json();
          setMessages((data.messages || []).map((msg) => ({
            ...msg,
            time: formatTime(msg.createdAt || Date.now()),
          })));
        }
      } catch {
        setStatus('Failed to load messages.');
      }
    };

    fetchMessages();

    return () => {
      cancelled = true;
    };
  }, [token, selectedContact]);

  useEffect(() => {
    if (!token || !selectedContact || !user?.id) return undefined;

    const privateRoom = getPrivateRoom(user.id, selectedContact.id);
    const joinPrivateRoom = () => socket.emit('join-room', privateRoom);

    socket.auth = { token };
    socket.on('connect', () => {
      setConnectionState('online');
      joinPrivateRoom();
    });
    socket.on('disconnect', () => setConnectionState('offline'));
    socket.on('reconnect', () => setConnectionState('online'));

    if (socket.connected) {
      setConnectionState('online');
      joinPrivateRoom();
    } else {
      setConnectionState('connecting');
      socket.connect();
    }

    socket.on('new-message', (msg) => {
      const normalized = {
        ...msg,
        time: formatTime(msg.createdAt || Date.now()),
      };

      setMessages((prev) => {
        const isThisConversation = (String(normalized.senderId) === String(user.id) && String(normalized.recipientId) === String(selectedContact.id))
          || (String(normalized.senderId) === String(selectedContact.id) && String(normalized.recipientId) === String(user.id));
        if (!isThisConversation) return prev;

        const exists = prev.some((item) => String(item._id || item.id) === String(normalized._id || normalized.id));
        if (exists) return prev;
        return [...prev, normalized];
      });
    });

    socket.on('message-deleted', ({ messageId }) => {
      setMessages((prev) => prev.filter((item) => String(item._id || item.id) !== String(messageId)));
    });

    socket.on('message-updated', (updatedMessage) => {
      setMessages((prev) => prev.map((message) => {
        const currentId = String(message._id || message.id);
        const nextId = String(updatedMessage._id || updatedMessage.id);
        if (currentId !== nextId) return message;
        return { ...message, ...updatedMessage, text: updatedMessage.text || message.text, time: formatTime(updatedMessage.createdAt || message.createdAt || Date.now()) };
      }));
    });

    socket.on('typing', ({ room, user: typingName, isTyping }) => {
      if (room === privateRoom) setTypingUser(isTyping ? typingName : '');
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('reconnect');
      socket.off('new-message');
      socket.off('message-deleted');
      socket.off('message-updated');
      socket.off('typing');
      socket.disconnect();
    };
  }, [token, selectedContact, user?.id]);

  const submitEditedMessage = async () => {
    if (!editingMessageId) return;
    const trimmedValue = editText.trim();
    if (!trimmedValue) {
      setStatus('Message text cannot be empty.');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/messages/${editingMessageId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: trimmedValue }),
      });

      const result = await readResponse(response);
      if (!response.ok) throw new Error(result.message || 'Unable to update message');

      setMessages((previousMessages) => previousMessages.map((message) => {
        const id = String(message._id || message.id);
        if (id !== String(editingMessageId)) return message;
        return { ...message, ...result.payload, text: result.payload.text || message.text, time: formatTime(result.payload.createdAt || message.createdAt || Date.now()) };
      }));
      setEditingMessageId(null);
      setEditText('');
      setStatus('Message updated successfully.');
    } catch (error) {
      setStatus(error.message);
    }
  };

  const handleDeleteMessage = async (message) => {
    const targetId = String(message._id || message.id);
    if (!targetId) return;

    try {
      const response = await fetch(`${API_BASE}/api/messages/${targetId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await readResponse(response);
      if (!response.ok) throw new Error(result.message || 'Unable to delete message');
      setMessages((previousMessages) => previousMessages.filter((item) => String(item._id || item.id) !== targetId));
      setStatus(result.message);
    } catch (error) {
      setStatus(error.message);
    }
  };

  const handleProfileSave = async (event) => {
    event.preventDefault();
    try {
      const response = await fetch(`${API_BASE}/api/auth/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: profileName, avatar: profileAvatar }),
      });
      const result = await readResponse(response);
      if (!response.ok) throw new Error(result.message || 'Unable to update profile');
      updateUser(result.user);
      setIsEditingProfile(false);
      setStatus(result.message);
    } catch (error) {
      setStatus(error.message);
    }
  };

  const handleAvatarUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatus('Please choose an image file.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setStatus('Please choose an image smaller than 10 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxDimension = 512;
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        setProfileAvatar(canvas.toDataURL('image/jpeg', 0.82));
        setStatus('Image ready. Save your profile to upload it.');
      };
      image.onerror = () => setStatus('That image could not be read.');
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const handleAuth = async (event) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password || (isLogin ? false : !trimmedName)) {
      setStatus('Please complete all required fields.');
      return;
    }

    if (!validateEmail(trimmedEmail)) {
      setStatus('Please use a valid email address.');
      return;
    }

    if (!isLogin && password.length < 6) {
      setStatus('Password must be at least 6 characters long.');
      return;
    }

    setStatus('Connecting...');

    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/signup';
    const payload = isLogin ? { email: trimmedEmail, password } : { name: trimmedName, email: trimmedEmail, password };

    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await readResponse(response);

      if (!response.ok) {
        throw new Error(result.message || 'Authentication failed');
      }

      localStorage.setItem('chatify-token', result.token);
      localStorage.setItem('chatify-user', JSON.stringify(result.user));
      setToken(result.token);
      setUser(result.user);
      setStatus(result.message);
      setMessages([]);
    } catch (error) {
      setStatus(error.message);
    }
  };

  const handleSendMessage = async (event) => {
    event.preventDefault();
    if (!message.trim() || !token) return;

    if (!selectedContact) {
      setStatus('Choose someone to chat with first.');
      return;
    }

    const privateRoom = getPrivateRoom(user.id, selectedContact.id);
    socket.emit('typing', { room: privateRoom, user: user?.name, isTyping: false });

    try {
      const response = await fetch(`${API_BASE}/api/messages/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: message.trim(), recipientId: selectedContact.id }),
      });

      const result = await readResponse(response);
      if (!response.ok) {
        throw new Error(result.message || 'Unable to send message');
      }

      const sentMessage = result.payload;
      if (sentMessage) {
        setMessages((previousMessages) => {
          const alreadyAdded = previousMessages.some((item) => String(item._id || item.id) === String(sentMessage._id || sentMessage.id));
          if (alreadyAdded) return previousMessages;
          return [...previousMessages, { ...sentMessage, time: formatTime(sentMessage.createdAt || Date.now()) }];
        });
      }

      setStatus(result.message);
      setMessage('');
    } catch (error) {
      setStatus(error.message);
    }
  };

  const handleTyping = (event) => {
    setMessage(event.target.value);
    if (selectedContact && user?.id) {
      socket.emit('typing', {
        room: getPrivateRoom(user.id, selectedContact.id),
        user: user.name || 'Someone',
        isTyping: Boolean(event.target.value),
      });
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('chatify-token');
    localStorage.removeItem('chatify-user');
    setToken('');
    setUser(null);
    setMessage('');
    setStatus('Logged out successfully');
    setMessages([]);
    setContacts([]);
    setSelectedContact(null);
    setIsEditingProfile(false);
    setEditingMessageId(null);
    setEditText('');
  };

  return (
    <div className="app-shell">
      <aside className="sidebar-panel">
        <div className="brand-row">
          <div>
            <p className="eyebrow">Workspace</p>
            <h1>Chatify</h1>
          </div>
          {user && <button className="ghost-btn" onClick={handleLogout}>Logout</button>}
        </div>

        <div className="auth-card">
          {user && (
            <div className="contact-picker">
              <p className="section-label">Private chat</p>
              <label>
                Chat with
                <select
                  value={selectedContact?.id || ''}
                  onChange={(event) => setSelectedContact(contacts.find((contact) => String(contact.id) === event.target.value) || null)}
                >
                  <option value="" disabled>Select a person</option>
                  {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
                </select>
              </label>
              {contacts.length === 0 && <p className="helper-text">Create another account to start a private chat.</p>}
            </div>
          )}
          <p className="section-label">Account</p>
          {!user ? (
            <form onSubmit={handleAuth} className="auth-form">
              {!isLogin && (
                <label>
                  Full name
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
                </label>
              )}

              <label>
                Email
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@example.com" />
              </label>

              <label>
                Password
                <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="********" />
              </label>

              <div className="toggle-row">
                <button type="button" className={isLogin ? 'active' : ''} onClick={() => setIsLogin(true)}>Login</button>
                <button type="button" className={!isLogin ? 'active' : ''} onClick={() => setIsLogin(false)}>Sign Up</button>
              </div>

              <button type="submit" className="primary-btn full-width">
                {isLogin ? 'Login' : 'Create account'}
              </button>
            </form>
          ) : (
            <div className="profile-box">
              <div className="avatar">{avatarContent(user.avatar, user.name || 'User')}</div>
              <div>
                <strong>{user.name}</strong>
                <p>{user.email}</p>
              </div>
              <button
                type="button"
                className="icon-btn profile-edit-btn"
                onClick={() => setIsEditingProfile((value) => !value)}
                aria-label={isEditingProfile ? 'Close profile editor' : 'Edit profile'}
                title={isEditingProfile ? 'Close profile editor' : 'Edit profile'}
              >
                {isEditingProfile ? '×' : '✎'}
              </button>
            </div>
          )}
          {user && isEditingProfile && (
            <form onSubmit={handleProfileSave} className="profile-form">
              <label>Display name<input value={profileName} onChange={(event) => setProfileName(event.target.value)} /></label>
              <label className="upload-control">
                Profile photo
                <input type="file" accept="image/*" onChange={handleAvatarUpload} />
                <span className="upload-button">Choose image</span>
              </label>
              <label>Avatar URL <span className="optional-label">optional</span><input value={profileAvatar.startsWith('data:') ? '' : profileAvatar} onChange={(event) => setProfileAvatar(event.target.value)} placeholder="https://..." /></label>
              <button type="submit" className="primary-btn full-width">Save profile</button>
            </form>
          )}
        </div>
      </aside>

      <main className="chat-panel">
        <header className="chat-header">
          <div>
            <p className="eyebrow">Live conversation</p>
            <h2>{selectedContact ? selectedContact.name : 'Private chat'}</h2>
          </div>
          <div className="header-actions">
            <button type="button" className="theme-toggle" onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <span className={`status-pill ${connectionState}`}>{connectionState}</span>
          </div>
        </header>

        <div className="message-list">
          {messages.length === 0 ? (
            <p className="empty-state">No messages yet. Start the conversation.</p>
          ) : (
            messages.map((msg, index) => {
              const messageId = String(msg._id || msg.id || index);
              const isMine = String(msg.senderId) === String(user?.id);
              return (
                <div key={`${messageId}-${msg.text}`} className={`message ${isMine ? 'mine' : 'their'}`}>
                  <div className="message-head">
                    <span className="avatar-pill">{getInitials(msg.sender)}</span>
                    <strong>{msg.sender}</strong>
                    <span className="time-stamp">{msg.time || formatTime(msg.createdAt || Date.now())}</span>
                    {isMine && (
                      <div className="message-actions">
                        <button type="button" onClick={() => { setEditingMessageId(messageId); setEditText(msg.text || ''); }}>Edit</button>
                        <button type="button" onClick={() => handleDeleteMessage(msg)}>Delete</button>
                      </div>
                    )}
                  </div>

                  {editingMessageId === messageId ? (
                    <div className="message-editor">
                      <input value={editText} onChange={(event) => setEditText(event.target.value)} />
                      <div className="message-editor-actions">
                        <button type="button" className="primary-btn" onClick={submitEditedMessage}>Save</button>
                        <button type="button" className="ghost-btn" onClick={() => { setEditingMessageId(null); setEditText(''); }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <p>{msg.text}</p>
                  )}
                </div>
              );
            })
          )}
        </div>

        {typingUser && <p className="typing-indicator">{typingUser} is typing...</p>}

        <form onSubmit={handleSendMessage} className="composer">
          <input
            value={message}
            onChange={handleTyping}
            placeholder={token ? 'Type a message...' : 'Log in to send messages'}
            disabled={!token}
          />
          <button type="submit" className="primary-btn" disabled={!token}>Send</button>
        </form>

        {status && <p className="status">{status}</p>}
      </main>
    </div>
  );
}

export default App;
