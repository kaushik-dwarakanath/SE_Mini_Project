
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

export default function Profile({ onSessionExpired }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("token");
    const controller = new AbortController();

    async function fetchProfile() {
      try {
        if (!token) {
          onSessionExpired();
          return;
        }

        const response = await fetch("/api/auth/me", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        });

        if (response.status === 401) {
          onSessionExpired();
          return;
        }

        const responseText = await response.text();
        let data = {};

        try {
          data = responseText ? JSON.parse(responseText) : {};
        } catch {
          throw new Error(
            `Server returned an invalid response (HTTP ${response.status}).`
          );
        }

        if (!response.ok) {
          throw new Error(
            data.message || "Unable to load your profile."
          );
        }

        if (!data.user) {
          throw new Error("Invalid profile response.");
        }

        setUser(data.user);
      } catch (err) {
        if (err.name !== "AbortError") {
          setError(err.message || "Something went wrong.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    fetchProfile();

    return () => controller.abort();
  }, [onSessionExpired]);

  if (loading) {
    return (
      <main className="page">
        <section className="profile-card" aria-live="polite">
          <p>Loading profile...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="profile-card" aria-labelledby="profile-title">
        <div className="profile-avatar" aria-hidden="true">
          {user?.username?.charAt(0).toUpperCase() || "?"}
        </div>

        <h1 id="profile-title">My Profile</h1>
        <p className="subtitle">Your account information.</p>

        {error ? (
          <p className="notice" role="alert">{error}</p>
        ) : user ? (
          <div className="profile-details">
            <div className="profile-field">
              <span>Username</span>
              <strong>{user.username}</strong>
            </div>

            <div className="profile-field">
              <span>Email address</span>
              <strong>{user.email}</strong>
            </div>
          </div>
        ) : null}

        <Link className="profile-back-link" to="/chat">
          Back to Chat
        </Link>
      </section>
    </main>
  );
}
