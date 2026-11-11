
import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

export default function useChatConnection(onMessage, onTypingStatus) {
  const [status, setStatus] = useState("Connecting to server…");
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = io(import.meta.env.VITE_SOCKET_URL || undefined, {
      autoConnect: false,
      auth: (callback) => callback({
        token: localStorage.getItem("token"),
      }),
    });

    socketRef.current = socket;

    function handleConnect() {
      setStatus("Connected to server.");
      onTypingStatus({ clearAll: true });
    }

    function handleConnectError() {
      setStatus(
        socket.active
          ? "Unable to connect to server. Retrying…"
          : "Connection rejected. Please log in again."
      );
      onTypingStatus({ clearAll: true });
    }

    function handleDisconnect() {
      setStatus(
        socket.active
          ? "Disconnected from server. Reconnecting…"
          : "Disconnected from server. Refresh to reconnect."
      );
      onTypingStatus({ clearAll: true });
    }

    socket.on("connect", handleConnect);
    socket.on("connect_error", handleConnectError);
    socket.on("disconnect", handleDisconnect);
    socket.on("new_message", onMessage);
    socket.on("typing_status", onTypingStatus);

    socket.connect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("connect_error", handleConnectError);
      socket.off("disconnect", handleDisconnect);
      socket.off("new_message", onMessage);
      socket.off("typing_status", onTypingStatus);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [onMessage, onTypingStatus]);

  const emitTyping = useCallback(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit("typing", { roomId: "general" });
    }
  }, []);

  const emitStopTyping = useCallback(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit("stop_typing", { roomId: "general" });
    }
  }, []);

  return { status, emitTyping, emitStopTyping };
}