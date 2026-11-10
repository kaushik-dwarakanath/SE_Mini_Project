import { useEffect, useState } from "react";
import { io } from "socket.io-client";

export default function useChatConnection(onMessage) {
  const [status, setStatus] = useState("Connecting to server…");

  useEffect(() => {
    const socket = io(import.meta.env.VITE_SOCKET_URL || undefined, {
      autoConnect: false,
      auth: (callback) => callback({ token: localStorage.getItem("token") }),
    });

    function handleConnect() {
      setStatus("Connected to server.");
    }

    function handleConnectError() {
      setStatus(socket.active
        ? "Unable to connect to server. Retrying…"
        : "Connection rejected. Please log in again.");
    }

    function handleDisconnect() {
      setStatus(socket.active
        ? "Disconnected from server. Reconnecting…"
        : "Disconnected from server. Refresh to reconnect.");
    }

    socket.on("connect", handleConnect);
    socket.on("connect_error", handleConnectError);
    socket.on("disconnect", handleDisconnect);
    socket.on("new_message", onMessage);
    socket.connect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("connect_error", handleConnectError);
      socket.off("disconnect", handleDisconnect);
      socket.off("new_message", onMessage);
      socket.disconnect();
    };
  }, [onMessage]);

  return status;
}
