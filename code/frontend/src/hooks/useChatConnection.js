
import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

// Decoding is only for display ownership. The server verifies the JWT.
function currentUserId() {
  try {
    const payload = localStorage.getItem("token").split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))).userId;
  } catch {
    return null;
  }
}

export default function useChatConnection(onMessage, onTypingStatus, onMessageError) {
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

    const userId = currentUserId();
    const handleMessage = (data) => onMessage(data, Boolean(userId && data?.senderId === userId));
    const handleTyping = (data) => {
      if (data?.userId !== userId) onTypingStatus(data);
    };
    function handleMessageError(data) {
      onMessageError(typeof data?.message === "string" ? data.message : "Message could not be sent.");
    }

    socket.on("message_error", handleMessageError);
    socket.on("connect", handleConnect);
    socket.on("connect_error", handleConnectError);
    socket.on("disconnect", handleDisconnect);
    socket.on("new_message", handleMessage);
    socket.on("typing_status", handleTyping);

    socket.connect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("connect_error", handleConnectError);
      socket.off("disconnect", handleDisconnect);
      socket.off("new_message", handleMessage);
      socket.off("typing_status", handleTyping);
      socket.off("message_error", handleMessageError);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [onMessage, onTypingStatus, onMessageError]);

  const emitTyping = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return false;
    socket.emit("typing", { roomId: "general" });
    return true;
  }, []);

  const sendMessage = useCallback((text) => {
    const socket = socketRef.current;
    if (!socket?.connected) return false;
    socket.emit("message", { roomId: "general", text });
    return true;
  }, []);

  const emitStopTyping = useCallback(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit("stop_typing", { roomId: "general" });
    }
  }, []);

  return { status, emitTyping, emitStopTyping, sendMessage };
}