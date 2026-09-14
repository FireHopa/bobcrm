import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  connectWhatsapp,
  describeApiError,
  disconnectWhatsapp,
  fetchKanbanPipelines,
  fetchWhatsappAccounts,
  fetchWhatsappChats,
  fetchWhatsappLeadRouting,
  fetchWhatsappMedia,
  fetchWhatsappMessages,
  fetchWhatsappStatus,
  reconnectWhatsapp,
  sendWhatsappAudio,
  sendWhatsappDocument,
  sendWhatsappImage,
  sendWhatsappText,
  updateWhatsappLeadRouting,
  type WhatsappChat,
  type WhatsappConnectionStatus,
  type WhatsappLeadRouting,
  type WhatsappManagedAccount,
  type WhatsappMedia,
  type WhatsappMessage,
} from "../utils/api";
import type { KanbanPipeline } from "../types/Kanban";
import type { CRMUser } from "../types/Lead";

const MAX_OUTBOUND_MEDIA_BYTES = 10 * 1024 * 1024;

type PendingAttachment = {
  file: File;
  kind: "image" | "document";
  previewUrl: string;
};

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 KB";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(value >= 5 * 1024 * 1024 ? 0 : 1)} MB`;
}

function attachmentLabel(file: File) {
  const extension = file.name.split(".").pop()?.toUpperCase();
  return extension && extension.length <= 6 ? extension : "ARQUIVO";
}

const EMPTY_STATUS: WhatsappConnectionStatus = {
  enabled: false,
  status: "disconnected",
  connected: false,
  qrCodeDataUrl: "",
  phone: "",
  displayName: "",
  lastError: "",
  lastQrAt: "",
  lastReadyAt: "",
  lastDisconnectAt: "",
};

function formatTime(timestamp: number) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp * 1000));
}

function messagePreview(message: WhatsappMessage | null) {
  if (!message) return "Sem mensagens";
  if (message.body) return message.body;
  if (message.mediaKind === "image") return "📷 Imagem";
  if (message.mediaKind === "audio") return "🎙️ Áudio";
  if (message.mediaKind === "video") return "🎥 Vídeo";
  if (message.mediaKind === "document") return "📎 Arquivo";
  if (message.hasMedia) return "📎 Mídia";
  return "Mensagem";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("Falha ao ler arquivo."));
    reader.readAsDataURL(blob);
  });
}

function WhatsappMessageMedia({ message, local, accountUserId }: { message: WhatsappMessage; local?: WhatsappMedia; accountUserId?: string }) {
  const [media, setMedia] = useState<WhatsappMedia | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setMedia(local || null);
    setError("");
    if (local) return undefined;
    if (!message.hasMedia || !["image", "audio", "video", "document"].includes(message.mediaKind)) return undefined;
    void fetchWhatsappMedia(message.id, accountUserId || "")
      .then((nextMedia) => {
        if (active) setMedia(nextMedia);
      })
      .catch((caughtError) => {
        if (active) setError(describeApiError(caughtError, "Mídia indisponível."));
      });
    return () => { active = false; };
  }, [accountUserId, local, message.hasMedia, message.id, message.mediaKind]);

  if (error) return <span className="whatsappMediaError">{error}</span>;
  if (!media) return <span className="whatsappMediaLoading">Carregando mídia...</span>;
  const src = `data:${media.mimetype};base64,${media.data}`;
  if (message.mediaKind === "image") return <img className="whatsappMessageImage" src={src} alt={message.body || "Imagem recebida no WhatsApp"} />;
  if (message.mediaKind === "audio") return <audio className="whatsappMessageAudio" src={src} controls preload="metadata" />;
  if (message.mediaKind === "video") return <video className="whatsappMessageVideo" src={src} controls preload="metadata" />;
  if (message.mediaKind === "document") {
    return <a className="whatsappDocumentLink" href={src} download={media.filename || "arquivo"}>📎 {media.filename || "Baixar arquivo"}</a>;
  }
  return null;
}

export function WhatsappWorkspace({ currentUser }: { currentUser: CRMUser }) {
  const isAdminView = currentUser.permissions.includes("access_all_whatsapp");
  const [accounts, setAccounts] = useState<WhatsappManagedAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(isAdminView);
  const [selectedAccountUserId, setSelectedAccountUserId] = useState(isAdminView ? "" : currentUser.id);
  const [status, setStatus] = useState<WhatsappConnectionStatus>(EMPTY_STATUS);
  const [chats, setChats] = useState<WhatsappChat[]>([]);
  const [messages, setMessages] = useState<WhatsappMessage[]>([]);
  const [selectedChatId, setSelectedChatId] = useState("");
  const [chatSearch, setChatSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [composerFeedback, setComposerFeedback] = useState("");
  const [localMedia, setLocalMedia] = useState<Record<string, WhatsappMedia>>({});
  const [pipelines, setPipelines] = useState<KanbanPipeline[]>([]);
  const [leadRouting, setLeadRouting] = useState<WhatsappLeadRouting>({ pipelineId: "", stageId: "", usesDefault: true });
  const [routingPipelineId, setRoutingPipelineId] = useState("");
  const [routingStageId, setRoutingStageId] = useState("");
  const [routingBusy, setRoutingBusy] = useState(false);
  const [routingFeedback, setRoutingFeedback] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const activeAccountUserId = isAdminView ? selectedAccountUserId : "";
  const selectedAccount = useMemo(() => accounts.find((account) => account.userId === selectedAccountUserId) || null, [accounts, selectedAccountUserId]);
  const selectedChat = useMemo(() => chats.find((chat) => chat.id === selectedChatId) || null, [chats, selectedChatId]);
  const routingPipeline = useMemo(() => pipelines.find((pipeline) => pipeline.id === routingPipelineId) || null, [pipelines, routingPipelineId]);
  const routingStages = routingPipeline?.stages || [];
  const routingDirty = routingPipelineId !== leadRouting.pipelineId || routingStageId !== leadRouting.stageId;

  async function refreshStatus() {
    try {
      const next = await fetchWhatsappStatus(activeAccountUserId);
      setStatus(next);
      if (next.connected) setError("");
      return next;
    } catch (caughtError) {
      setError(describeApiError(caughtError, "Não foi possível consultar a conexão do WhatsApp."));
      return null;
    }
  }

  async function refreshChats(search = chatSearch) {
    try {
      const next = await fetchWhatsappChats(search, activeAccountUserId);
      setChats(next);
      setSelectedChatId((current) => current && next.some((chat) => chat.id === current) ? current : next[0]?.id || "");
    } catch (caughtError) {
      setError(describeApiError(caughtError, "Não foi possível carregar as conversas."));
    }
  }

  async function refreshMessages(chatId = selectedChatId) {
    if (!chatId) {
      setMessages([]);
      return;
    }
    try {
      setMessages(await fetchWhatsappMessages(chatId, 120, activeAccountUserId));
    } catch (caughtError) {
      setError(describeApiError(caughtError, "Não foi possível carregar as mensagens."));
    }
  }

  async function refreshAccounts(showLoading = false) {
    if (!isAdminView) return [];
    if (showLoading) setAccountsLoading(true);
    try {
      const next = await fetchWhatsappAccounts();
      setAccounts(next);
      setSelectedAccountUserId((current) => current && next.some((account) => account.userId === current) ? current : next[0]?.userId || "");
      return next;
    } catch (caughtError) {
      setError(describeApiError(caughtError, "Não foi possível carregar as sessões de WhatsApp da equipe."));
      return [];
    } finally {
      if (showLoading) setAccountsLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void fetchKanbanPipelines()
      .then((nextPipelines) => { if (active) setPipelines(nextPipelines); })
      .catch((caughtError) => { if (active) setError(describeApiError(caughtError, "Não foi possível carregar os funis do CRM.")); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!isAdminView) return undefined;
    void refreshAccounts(true);
    const timer = window.setInterval(() => void refreshAccounts(false), 5000);
    return () => window.clearInterval(timer);
  }, [isAdminView]);

  useEffect(() => {
    setStatus(EMPTY_STATUS);
    setChats([]);
    setMessages([]);
    setSelectedChatId("");
    setChatSearch("");
    setDraft("");
    setError("");
    setPendingAttachment((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setLocalMedia({});
    setComposerFeedback("");
    setRoutingFeedback("");
    if (isAdminView && !activeAccountUserId) {
      setLeadRouting({ pipelineId: "", stageId: "", usesDefault: true });
      setRoutingPipelineId("");
      setRoutingStageId("");
      return undefined;
    }

    let active = true;
    void fetchWhatsappLeadRouting(activeAccountUserId)
      .then((nextRouting) => {
        if (!active) return;
        setLeadRouting(nextRouting);
        setRoutingPipelineId(nextRouting.pipelineId || "");
        setRoutingStageId(nextRouting.stageId || "");
      })
      .catch((caughtError) => {
        if (active) setError(describeApiError(caughtError, "Não foi possível carregar o destino dos leads do WhatsApp."));
      });
    return () => { active = false; };
  }, [activeAccountUserId, isAdminView]);

  useEffect(() => {
    if (isAdminView && !activeAccountUserId) return undefined;
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 2500);
    return () => window.clearInterval(timer);
  }, [activeAccountUserId, isAdminView]);

  useEffect(() => {
    if (!status.connected) {
      setChats([]);
      setMessages([]);
      setSelectedChatId("");
      return undefined;
    }
    void refreshChats();
    const timer = window.setInterval(() => void refreshChats(), 3500);
    return () => window.clearInterval(timer);
  }, [activeAccountUserId, status.connected, chatSearch]);

  useEffect(() => {
    if (!status.connected || !selectedChatId) return undefined;
    void refreshMessages(selectedChatId);
    const timer = window.setInterval(() => void refreshMessages(selectedChatId), 2200);
    return () => window.clearInterval(timer);
  }, [activeAccountUserId, status.connected, selectedChatId]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => () => {
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    const recorder = mediaRecorderRef.current;
    if (recorder) recorder.onstop = null;
    if (recorder?.state === "recording") recorder.stop();
    if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current);
  }, []);

  useEffect(() => () => {
    if (pendingAttachment?.previewUrl) URL.revokeObjectURL(pendingAttachment.previewUrl);
  }, [pendingAttachment?.previewUrl]);

  async function handleSaveLeadRouting() {
    if (routingBusy) return;
    if (Boolean(routingPipelineId) !== Boolean(routingStageId)) {
      setError("Selecione o funil e a etapa de destino juntos.");
      return;
    }
    setRoutingBusy(true);
    setRoutingFeedback("");
    setError("");
    try {
      const saved = await updateWhatsappLeadRouting({ pipelineId: routingPipelineId, stageId: routingStageId, ...(activeAccountUserId ? { accountUserId: activeAccountUserId } : {}) });
      setLeadRouting(saved);
      setRoutingPipelineId(saved.pipelineId || "");
      setRoutingStageId(saved.stageId || "");
      setRoutingFeedback(saved.usesDefault ? "Destino padrão do CRM salvo." : "Destino dos novos leads salvo.");
      window.setTimeout(() => setRoutingFeedback(""), 2600);
    } catch (caughtError) {
      setError(describeApiError(caughtError, "Não foi possível salvar o destino dos leads."));
    } finally {
      setRoutingBusy(false);
    }
  }

  async function handleConnect() {
    setBusy(true);
    setError("");
    try {
      setStatus(await connectWhatsapp(activeAccountUserId));
    } catch (caughtError) {
      setError(describeApiError(caughtError, "Não foi possível iniciar o WhatsApp."));
    } finally {
      setBusy(false);
    }
  }

  async function handleReconnect() {
    setBusy(true);
    setError("");
    try {
      setStatus(await reconnectWhatsapp(activeAccountUserId));
      if (isAdminView) void refreshAccounts(false);
    } catch (caughtError) {
      setError(describeApiError(caughtError, "Não foi possível reconectar o WhatsApp."));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    setError("");
    try {
      setStatus(await disconnectWhatsapp(activeAccountUserId));
      if (isAdminView) await refreshAccounts(false);
    } catch (caughtError) {
      setError(describeApiError(caughtError, "Não foi possível desconectar o WhatsApp."));
    } finally {
      setBusy(false);
    }
  }

  async function handleSendText(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!selectedChatId || !text || busy) return;
    setBusy(true);
    setError("");
    try {
      const sent = await sendWhatsappText(selectedChatId, text, activeAccountUserId);
      setDraft("");
      setMessages((current) => [...current.filter((message) => message.id !== sent.id), sent].sort((a, b) => a.timestamp - b.timestamp));
      void refreshChats();
    } catch (caughtError) {
      setError(describeApiError(caughtError, "Não foi possível enviar a mensagem."));
    } finally {
      setBusy(false);
    }
  }

  function clearPendingAttachment() {
    setPendingAttachment((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
  }

  function handleAttachment(file: File | null) {
    if (!file || !selectedChatId) return;
    if (file.size > MAX_OUTBOUND_MEDIA_BYTES) {
      setError("O arquivo deve ter no máximo 10 MB.");
      return;
    }
    setError("");
    setComposerFeedback("");
    setPendingAttachment((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      const kind = file.type.startsWith("image/") ? "image" : "document";
      return { file, kind, previewUrl: kind === "image" ? URL.createObjectURL(file) : "" };
    });
  }

  async function sendPendingAttachment() {
    if (!pendingAttachment || !selectedChatId || busy) return;
    const { file, kind } = pendingAttachment;
    const chatId = selectedChatId;
    setBusy(true);
    setError("");
    setComposerFeedback(`Enviando ${file.name}...`);
    try {
      const data = await blobToBase64(file);
      const sent = kind === "image"
        ? await sendWhatsappImage({
            chatId,
            data,
            mimetype: file.type || "image/jpeg",
            filename: file.name || "imagem",
            caption: draft.trim() || undefined,
            ...(activeAccountUserId ? { accountUserId: activeAccountUserId } : {}),
          })
        : await sendWhatsappDocument({
            chatId,
            data,
            mimetype: file.type || "application/octet-stream",
            filename: file.name || "arquivo",
            ...(activeAccountUserId ? { accountUserId: activeAccountUserId } : {}),
          });
      setLocalMedia((current) => ({
        ...current,
        [sent.id]: { mimetype: file.type || "application/octet-stream", data, filename: file.name || "arquivo", filesize: file.size },
      }));
      setMessages((current) => [...current.filter((message) => message.id !== sent.id), sent].sort((a, b) => a.timestamp - b.timestamp));
      if (kind === "image") setDraft("");
      clearPendingAttachment();
      setComposerFeedback("Arquivo enviado.");
      window.setTimeout(() => setComposerFeedback((current) => current === "Arquivo enviado." ? "" : current), 2200);
      void refreshChats();
      window.setTimeout(() => void refreshMessages(chatId), 700);
    } catch (caughtError) {
      setComposerFeedback("");
      setError(describeApiError(caughtError, "Não foi possível enviar o arquivo."));
    } finally {
      setBusy(false);
    }
  }

  function handleComposerSubmit(event: FormEvent) {
    if (pendingAttachment) {
      event.preventDefault();
      void sendPendingAttachment();
      return;
    }
    void handleSendText(event);
  }

  async function startRecording() {
    if (!selectedChatId || busy || recording) return;
    clearPendingAttachment();
    setComposerFeedback("");
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const preferredType = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm"]
        .find((type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
      audioStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) audioChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        void (async () => {
          const recordedMime = String(recorder.mimeType || preferredType || "audio/webm").trim() || "audio/webm";
          const blob = new Blob(audioChunksRef.current, { type: recordedMime });
          stream.getTracks().forEach((track) => track.stop());
          audioStreamRef.current = null;
          mediaRecorderRef.current = null;
          if (recordingTimerRef.current !== null) {
            window.clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }
          setRecordingSeconds(0);
          if (!blob.size) return;
          if (blob.size > MAX_OUTBOUND_MEDIA_BYTES) {
            setError("O áudio gravado deve ter no máximo 10 MB. Grave uma mensagem mais curta.");
            return;
          }
          setBusy(true);
          setComposerFeedback("Enviando áudio...");
          try {
            const data = await blobToBase64(blob);
            const sent = await sendWhatsappAudio({
              chatId: selectedChatId,
              data,
              mimetype: recordedMime,
              filename: recordedMime.includes("ogg") ? "audio.ogg" : "audio.webm",
              ...(activeAccountUserId ? { accountUserId: activeAccountUserId } : {}),
            });
            setLocalMedia((current) => ({
              ...current,
              [sent.id]: { mimetype: recordedMime, data, filename: recordedMime.includes("ogg") ? "audio.ogg" : "audio.webm", filesize: blob.size },
            }));
            setMessages((current) => [...current.filter((message) => message.id !== sent.id), sent].sort((a, b) => a.timestamp - b.timestamp));
            setComposerFeedback("Áudio enviado.");
            window.setTimeout(() => setComposerFeedback((current) => current === "Áudio enviado." ? "" : current), 2200);
            void refreshChats();
            window.setTimeout(() => void refreshMessages(selectedChatId), 700);
          } catch (caughtError) {
            setComposerFeedback("");
            setError(describeApiError(caughtError, "Não foi possível enviar o áudio."));
          } finally {
            setBusy(false);
          }
        })();
      };
      recorder.start(250);
      setRecordingSeconds(0);
      if (recordingTimerRef.current !== null) window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = window.setInterval(() => setRecordingSeconds((value) => value + 1), 1000);
      setRecording(true);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? `Não foi possível acessar o microfone: ${caughtError.message}` : "Não foi possível acessar o microfone.");
    }
  }

  function stopRecording() {
    if (!recording) return;
    setRecording(false);
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
  }

  const adminToolbar = isAdminView ? (
    <section className="whatsappAdminToolbar panel">
      <div className="whatsappAdminToolbarCopy">
        <span className="eyebrow">Visão administrativa</span>
        <strong>WhatsApps da equipe</strong>
        <small>Acesse as sessões conectadas pelos consultores e responda usando o número de cada um.</small>
      </div>
      <label className="whatsappAdminAccountPicker">
        <span>Sessão do consultor</span>
        <select
          value={selectedAccountUserId}
          disabled={accountsLoading || busy || recording}
          onChange={(event) => setSelectedAccountUserId(event.target.value)}
        >
          <option value="">{accountsLoading ? "Carregando sessões..." : accounts.length ? "Selecione um consultor" : "Nenhuma sessão conectada"}</option>
          {accounts.map((account) => (
            <option key={account.userId} value={account.userId}>
              {account.userName}{account.phone ? ` · +${account.phone}` : ""}
            </option>
          ))}
        </select>
      </label>
      <div className="whatsappAdminSessionState">
        <span className={`whatsappStatusDot whatsappStatusDot-${selectedAccount?.status || "disconnected"}`} />
        <div>
          <strong>{selectedAccount ? (selectedAccount.connected ? "Conectado" : "Sessão disponível") : `${accounts.length} sessão${accounts.length === 1 ? "" : "ões"}`}</strong>
          <small>{selectedAccount ? selectedAccount.userEmail : "Escolha um consultor para abrir o WhatsApp."}</small>
        </div>
        <button className="ghostButton" type="button" onClick={() => void refreshAccounts(true)} disabled={accountsLoading || busy || recording}>Atualizar</button>
      </div>
    </section>
  ) : null;

  if (isAdminView && accountsLoading && !accounts.length) {
    return (
      <>
        {adminToolbar}
        <section className="whatsappAdminEmpty panel">Carregando as sessões de WhatsApp da equipe...</section>
      </>
    );
  }

  if (isAdminView && !selectedAccountUserId) {
    return (
      <>
        {adminToolbar}
        <section className="whatsappAdminEmpty panel">
          <strong>Nenhum WhatsApp disponível</strong>
          <span>Quando um consultor conectar a própria sessão, ela aparecerá aqui automaticamente para a administração.</span>
          {error ? <div className="systemNotice systemNoticeError">{error}</div> : null}
        </section>
      </>
    );
  }

  if (!status.connected) {
    return (
      <>
        {adminToolbar}
        <section className="whatsappConnectPanel panel">
          <div className="whatsappConnectCopy">
            <span className="eyebrow">{isAdminView ? `Sessão de ${selectedAccount?.userName || "consultor"}` : "WhatsApp do consultor"}</span>
            <h2>{isAdminView ? `WhatsApp de ${selectedAccount?.userName || "consultor"}` : "Conecte seu número"}</h2>
            <p>{isAdminView ? "Esta sessão foi conectada pelo consultor e pode ser operada pela administração. Se ela cair, você pode tentar reconectar sem afetar as demais sessões." : "Esta sessão é exclusiva do seu usuário. Depois do primeiro pareamento, o servidor reutiliza a sessão automaticamente enquanto ela continuar válida."}</p>
            <div className="whatsappConnectionState">
              <span className={`whatsappStatusDot whatsappStatusDot-${status.status}`} />
              <strong>{status.status === "qr" ? "Aguardando leitura do QR Code" : status.status === "initializing" || status.status === "reconnecting" ? "Inicializando WhatsApp" : status.status === "authenticated" ? "Autenticado, concluindo conexão" : "WhatsApp desconectado"}</strong>
            </div>
            {status.lastError ? <div className="systemNotice systemNoticeError">{status.lastError}</div> : null}
            {error ? <div className="systemNotice systemNoticeError">{error}</div> : null}
            <div className="whatsappConnectActions">
              {isAdminView ? (
                <>
                  <button className="primaryButton" type="button" disabled={busy} onClick={handleReconnect}>Reconectar sessão</button>
                  <button className="secondaryButton" type="button" disabled={busy} onClick={handleDisconnect}>Desvincular sessão</button>
                </>
              ) : (
                <>
                  {!status.enabled ? <button className="primaryButton" type="button" disabled={busy} onClick={handleConnect}>Gerar QR Code</button> : <button className="primaryButton" type="button" disabled={busy} onClick={handleReconnect}>Reconectar</button>}
                  {status.enabled ? <button className="secondaryButton" type="button" disabled={busy} onClick={handleDisconnect}>Desvincular sessão</button> : null}
                </>
              )}
            </div>
          </div>
          <div className="whatsappQrCard">
            {status.qrCodeDataUrl ? <img src={status.qrCodeDataUrl} alt="QR Code para conectar o WhatsApp" /> : <div className="whatsappQrPlaceholder"><strong>QR Code</strong><span>{status.enabled ? "O servidor está preparando o pareamento..." : isAdminView ? "A sessão deste consultor foi desvinculada." : "Clique em Gerar QR Code para iniciar."}</span></div>}
            <small>WhatsApp → Dispositivos conectados → Conectar dispositivo.</small>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      {adminToolbar}
      <section className="whatsappWorkspace panel">
      <aside className="whatsappSidebar">
        <div className="whatsappAccountHeader">
          <div>
            <span className="eyebrow">{isAdminView ? `Conta de ${selectedAccount?.userName || "consultor"}` : "Conectado"}</span>
            <strong>{status.displayName || (status.phone ? `+${status.phone}` : "WhatsApp")}</strong>
            {status.phone ? <small>+{status.phone}{isAdminView && selectedAccount?.userName ? ` · ${selectedAccount.userName}` : ""}</small> : null}
          </div>
          <button className="ghostButton" type="button" onClick={handleReconnect} disabled={busy}>Reconectar</button>
        </div>
        <div className="whatsappLeadRoutingCard">
          <div className="whatsappLeadRoutingHeader">
            <div>
              <span className="eyebrow">Leads automáticos</span>
              <strong>Destino de novos leads</strong>
            </div>
            {leadRouting.invalid ? <span className="whatsappRoutingWarning">Revisar</span> : null}
          </div>
          <label>
            <span>Funil</span>
            <select
              value={routingPipelineId}
              disabled={routingBusy}
              onChange={(event) => {
                const nextPipelineId = event.target.value;
                setRoutingPipelineId(nextPipelineId);
                const nextPipeline = pipelines.find((pipeline) => pipeline.id === nextPipelineId);
                setRoutingStageId((current) => nextPipeline?.stages.some((stage) => stage.id === current) ? current : "");
                setRoutingFeedback("");
              }}
            >
              <option value="">Padrão do CRM</option>
              {pipelines.map((pipeline) => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>)}
            </select>
          </label>
          <label>
            <span>Etapa</span>
            <select
              value={routingStageId}
              disabled={routingBusy || !routingPipelineId}
              onChange={(event) => { setRoutingStageId(event.target.value); setRoutingFeedback(""); }}
            >
              <option value="">{routingPipelineId ? "Selecione a etapa" : "Automática pelo CRM"}</option>
              {routingStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
            </select>
          </label>
          <div className="whatsappLeadRoutingFooter">
            <small>
              {!routingPipelineId
                ? "Sem configuração manual: novos leads usam o funil/etapa padrão do CRM."
                : routingStageId
                  ? `Novos leads entrarão em ${routingPipeline?.name || "funil selecionado"} → ${routingStages.find((stage) => stage.id === routingStageId)?.name || "etapa selecionada"}.`
                  : "Escolha a etapa em que os novos leads devem entrar."}
            </small>
            <button className="ghostButton whatsappRoutingSave" type="button" onClick={handleSaveLeadRouting} disabled={routingBusy || !routingDirty || Boolean(routingPipelineId) !== Boolean(routingStageId)}>
              {routingBusy ? "Salvando..." : "Salvar destino"}
            </button>
            {routingFeedback ? <span className="whatsappRoutingFeedback">✓ {routingFeedback}</span> : null}
          </div>
        </div>

        <input className="whatsappChatSearch" type="search" placeholder="Buscar conversa..." value={chatSearch} onChange={(event) => setChatSearch(event.target.value)} />
        <div className="whatsappChatList" role="list">
          {chats.map((chat) => (
            <button key={chat.id} className={`whatsappChatItem ${selectedChatId === chat.id ? "isActive" : ""}`} type="button" onClick={() => setSelectedChatId(chat.id)}>
              <span className="whatsappAvatar" aria-hidden="true">{chat.isGroup ? "G" : (chat.name.trim()[0] || "W").toUpperCase()}</span>
              <span className="whatsappChatMeta">
                <span className="whatsappChatTitle"><strong>{chat.name}</strong><small>{formatTime(chat.timestamp)}</small></span>
                <span className="whatsappChatPreview">{messagePreview(chat.lastMessage)}</span>
              </span>
              {chat.unreadCount > 0 ? <span className="whatsappUnread">{chat.unreadCount > 99 ? "99+" : chat.unreadCount}</span> : null}
            </button>
          ))}
          {!chats.length ? <div className="whatsappEmptyList">Nenhuma conversa encontrada.</div> : null}
        </div>
      </aside>

      <div className="whatsappConversation">
        {selectedChat ? (
          <>
            <header className="whatsappConversationHeader">
              <div>
                <strong>{selectedChat.name}</strong>
                <span>{selectedChat.isGroup ? "Grupo · não gera leads automáticos" : "Conversa individual"}</span>
              </div>
              <button className="ghostButton" type="button" onClick={handleDisconnect} disabled={busy}>{isAdminView ? "Desvincular sessão" : "Desconectar número"}</button>
            </header>
            {error ? <div className="whatsappInlineError">{error}</div> : null}
            <div className="whatsappMessages" aria-live="polite">
              {messages.map((message) => (
                <article key={message.id} className={`whatsappBubble ${message.fromMe ? "isMine" : "isTheirs"}`}>
                  {message.hasMedia ? <WhatsappMessageMedia message={message} local={localMedia[message.id]} accountUserId={activeAccountUserId} /> : null}
                  {message.body ? <p>{message.body}</p> : null}
                  <time>{formatTime(message.timestamp)}{message.fromMe ? <span className="whatsappDeliveryState" aria-label={message.ack >= 3 ? "Lida" : message.ack >= 2 ? "Entregue" : message.ack >= 1 ? "Enviada" : "Enviando"}>{message.ack >= 2 ? " ✓✓" : " ✓"}</span> : null}</time>
                </article>
              ))}
              {!messages.length ? <div className="whatsappNoMessages">Nenhuma mensagem carregada nesta conversa.</div> : null}
              <div ref={messageEndRef} />
            </div>
            <form className={`whatsappComposer ${pendingAttachment || recording || composerFeedback ? "hasComposerStatus" : ""}`} onSubmit={handleComposerSubmit}>
              {pendingAttachment ? (
                <div className="whatsappAttachmentPreview">
                  {pendingAttachment.kind === "image" ? <img src={pendingAttachment.previewUrl} alt="Prévia do anexo" /> : <span className="whatsappFileBadge">{attachmentLabel(pendingAttachment.file)}</span>}
                  <span className="whatsappAttachmentMeta">
                    <strong>{pendingAttachment.file.name}</strong>
                    <small>{formatBytes(pendingAttachment.file.size)} · {pendingAttachment.kind === "image" ? "Imagem" : "Documento"}</small>
                  </span>
                  <span className="whatsappAttachmentState">{busy ? <><i className="whatsappMiniSpinner" /> Enviando...</> : "Pronto para enviar"}</span>
                  <button className="whatsappAttachmentRemove" type="button" onClick={clearPendingAttachment} disabled={busy} aria-label="Remover anexo">×</button>
                </div>
              ) : null}
              {recording ? (
                <div className="whatsappRecordingStatus" role="status">
                  <span className="whatsappRecordingDot" />
                  <strong>Gravando áudio</strong>
                  <span>{String(Math.floor(recordingSeconds / 60)).padStart(2, "0")}:{String(recordingSeconds % 60).padStart(2, "0")}</span>
                  <small>Clique no botão vermelho para parar e enviar</small>
                </div>
              ) : composerFeedback ? (
                <div className={`whatsappComposerFeedback ${composerFeedback.startsWith("Enviando") ? "isSending" : "isSuccess"}`}>
                  {composerFeedback.startsWith("Enviando") ? <i className="whatsappMiniSpinner" /> : <span>✓</span>}
                  {composerFeedback}
                </div>
              ) : null}
              <div className="whatsappComposerRow">
                <label className="whatsappAttachButton" title="Anexar arquivo ou imagem">
                  <span>＋</span>
                  <input type="file" onChange={(event) => { const file = event.target.files?.[0] || null; handleAttachment(file); event.currentTarget.value = ""; }} disabled={busy || recording} />
                </label>
                <input type="text" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={pendingAttachment?.kind === "image" ? "Adicione uma legenda (opcional)" : "Digite uma mensagem"} disabled={busy || recording} />
                <button className={`whatsappRecordButton ${recording ? "isRecording" : ""}`} type="button" onClick={recording ? stopRecording : startRecording} disabled={busy && !recording} title={recording ? "Parar e enviar áudio" : "Gravar áudio"}>{recording ? "■" : "🎙"}</button>
                <button className="primaryButton whatsappSendButton" type="submit" disabled={busy || recording || (!pendingAttachment && !draft.trim())}>{busy && pendingAttachment ? "Enviando..." : pendingAttachment ? "Enviar arquivo" : "Enviar"}</button>
              </div>
            </form>
          </>
        ) : <div className="whatsappConversationEmpty"><strong>Selecione uma conversa</strong><span>{isAdminView ? `Você está atendendo pelo WhatsApp de ${selectedAccount?.userName || "consultor"}.` : "As mensagens ficam disponíveis após a conexão do seu número."}</span></div>}
      </div>
      </section>
    </>
  );
}
