/**
 * Hosts SessionReplacedModal — listens to sessionNoticeBus.
 * Mount once near the app root (outside auth redirect is fine).
 */

import React, { useEffect, useState } from "react";
import SessionReplacedModal, {
  type SessionNoticeKind,
} from "@/components/SessionReplacedModal";
import {
  dismissSessionNotice,
  getSessionNoticeState,
  onSessionNotice,
} from "@/services/sessionNoticeBus";

export function SessionNoticeHost() {
  const [visible, setVisible] = useState(false);
  const [kind, setKind] = useState<SessionNoticeKind>("replaced");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const initial = getSessionNoticeState();
    setVisible(initial.visible);
    setKind(initial.kind);
    setMessage(initial.message);
    return onSessionNotice((state) => {
      setVisible(state.visible);
      setKind(state.kind);
      setMessage(state.message);
    });
  }, []);

  return (
    <SessionReplacedModal
      visible={visible}
      kind={kind}
      message={message}
      onDismiss={() => dismissSessionNotice()}
    />
  );
}
