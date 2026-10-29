import { useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";


function Navbar() {
  const [isLoggedIn, setIsLoggedIn] = useState(
    () => Boolean(localStorage.getItem("token"))
  );
  const navigate = useNavigate();

  function handleLogout() {
    localStorage.removeItem("token");
    setIsLoggedIn(false);
    navigate("/login", { replace: true });
  }

  return (
    <header className="navbar">
      <Link to="/login" className="brand">
        SimpleChat
      </Link>

      <nav>
        {!isLoggedIn ? (
          <>
            <Link to="/register">Register</Link>
            <Link to="/login">Login</Link>
          </>
        ) : (
          <>
            <Link to="/chat">Chat</Link>
            <button type="button" onClick={handleLogout}>
              Logout
            </button>
          </>
        )}
      </nav>
    </header>
  );
}



function Register() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanUsername || !cleanEmail || !password) {
      setError("Please fill in all fields.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: cleanUsername,
          email: cleanEmail,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Registration failed. Please try again.");
        return;
      }

      setSuccess("Account created successfully. You can now log in.");
      setUsername("");
      setEmail("");
      setPassword("");
    } catch {
      setError(
        "Unable to connect to the server. Please try again later."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <section className="form-card">
        <h1>Create an account</h1>
        <p className="subtitle">Register to get started.</p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="username">Username</label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Enter username"
            autoComplete="username"
            required
          />

          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Enter email"
            autoComplete="email"
            required
          />

          <label htmlFor="register-password">Password</label>
          <input
            id="register-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            minLength={8}
            required
          />

          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}

          {success && (
            <p className="notice" role="status">
              {success}
            </p>
          )}

          <button type="submit" disabled={loading}>
            {loading ? "Registering..." : "Register"}
          </button>
        </form>

        <p className="form-footer">
          Already have an account? <Link to="/login">Login</Link>
        </p>
      </section>
    </main>
  );
}


function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    const identifier = username.trim();

    if (!identifier || !password) {
      setError("Please enter your username/email and password.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          identifier,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Login failed. Please try again.");
        return;
      }

      // Save the JWT for authenticated requests.
      localStorage.setItem("token", data.token);

      // Navigate to the chat page after successful login.
      window.location.href = "/chat";
    } catch (error) {
      setError(
        "Unable to connect to the server. Please check that the backend is running."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <section className="form-card">
        <h1>Welcome back</h1>
        <p className="subtitle">Login to your account.</p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="login-username">Username or email</label>
          <input
            id="login-username"
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Enter username or email"
            autoComplete="username"
            required
          />

          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter password"
            autoComplete="current-password"
            required
          />

          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}

          <button type="submit" disabled={loading}>
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>

        <p className="form-footer">
          Don't have an account? <Link to="/register">Register</Link>
        </p>
      </section>
    </main>
  );
}


function ProtectedRoute({ children }) {
  const token = localStorage.getItem("token");

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return children;
}


function Chat() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);

  function handleSubmit(event) {
    event.preventDefault();

    const text = message.trim();

    if (!text) return;

    setMessages((currentMessages) => [
      ...currentMessages,
      { id: Date.now(), text },
    ]);

    setMessage("");
  }

  return (
    <main className="page">
      <section className="chat-card">
        <div className="chat-header">
          <h1>Chat Room</h1>
          <p className="subtitle">Your messages appear here.</p>
        </div>

        <div className="messages" aria-live="polite">
          {messages.length === 0 ? (
            <p className="empty-message">
              No messages yet. Send a message to get started.
            </p>
          ) : (
            messages.map((item) => (
              <div className="message" key={item.id}>
                <span className="message-sender">You</span>
                <p>{item.text}</p>
              </div>
            ))
          )}
        </div>

        <form className="message-form" onSubmit={handleSubmit}>
          <label className="visually-hidden" htmlFor="chat-message">
            Message
          </label>

          <input
            id="chat-message"
            type="text"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Type a message..."
            autoComplete="off"
          />

          <button type="submit">Send</button>
        </form>
      </section>
    </main>
  );
}

export default function App() {
  return (
    <>
      <Navbar />

      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login />} />
        <Route path="/chat" element={<ProtectedRoute><Chat /></ProtectedRoute>}/>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  );
}