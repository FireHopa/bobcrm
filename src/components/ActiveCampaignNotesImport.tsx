import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  cancelActiveCampaignImportOnServer,
  getAsyncJobOnServer,
  getLatestActiveCampaignImportJobOnServer,
  startActiveCampaignNotesImportOnServer,
  testActiveCampaignConnectionOnServer,
  type ActiveCampaignImportProgress,
  type ActiveCampaignImportSummary,
  type AsyncJob,
} from "../utils/api";
import { BrDateInput } from "./BrDateInput";

function formatNumber(value: number) { return Number(value || 0).toLocaleString("pt-BR"); }
function formatDateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" }); }

const PROGRESS_STAGES = [
  { id: "preparing", label: "Preparando" },
  { id: "fetch_notes", label: "Buscando notas" },
  { id: "fetch_deals", label: "Localizando negócios" },
  { id: "fetch_contacts", label: "Localizando contatos" },
  { id: "match_leads", label: "Cruzando leads" },
  { id: "import_notes", label: "Importando notas" },
  { id: "finalizing", label: "Finalizando" },
] as const;

function stageIndex(stage?: string) {
  if (stage === "filter_notes") return 1;
  if (stage === "completed") return PROGRESS_STAGES.length;
  const index = PROGRESS_STAGES.findIndex((item) => item.id === stage);
  return index < 0 ? 0 : index;
}

function jobSummary(job: AsyncJob | null): ActiveCampaignImportSummary | null {
  return (job?.result?.summary as ActiveCampaignImportSummary | undefined) || null;
}

function jobProgress(job: AsyncJob | null): ActiveCampaignImportProgress | null {
  return (job?.result?.progress as ActiveCampaignImportProgress | undefined) || null;
}

export function ActiveCampaignNotesImport() {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [busy, setBusy] = useState<"test" | "start" | "cancel" | "">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [job, setJob] = useState<AsyncJob | null>(null);
  const [summary, setSummary] = useState<ActiveCampaignImportSummary | null>(null);
  const [restoring, setRestoring] = useState(true);

  const isJobActive = job?.status === "queued" || job?.status === "running";
  const cancellationRequested = Boolean(job?.result?.cancellationRequested) || job?.errorCode === "JOB_CANCEL_REQUESTED";
  const progress = jobProgress(job);
  const progressPercent = useMemo(() => {
    if (!job) return 0;
    if (job.status === "completed") return 100;
    if (job.status === "queued") return 0;
    if (!job.progressTotal) return Math.max(0, Math.min(99, Math.round(job.progressCurrent || 0)));
    return Math.max(0, Math.min(100, Math.round((job.progressCurrent / job.progressTotal) * 100)));
  }, [job]);
  const currentStageIndex = stageIndex(progress?.stage || (job?.status === "completed" ? "completed" : "preparing"));
  const stats = progress?.stats || {};

  function consumeJob(nextJob: AsyncJob) {
    setJob(nextJob);
    const nextSummary = jobSummary(nextJob);
    if (nextSummary) setSummary(nextSummary);
    if (nextJob.status === "completed" && nextSummary) {
      setMessage(`Importação concluída: ${formatNumber(nextSummary.imported)} nota(s) nova(s) e ${formatNumber(nextSummary.updated)} atualizada(s).`);
      setError("");
    } else if (nextJob.status === "canceled") {
      setMessage("Importação cancelada. O que já havia sido importado foi mantido e nenhuma nova etapa será iniciada por este job.");
      setError("");
    } else if (nextJob.status === "failed") {
      setError(nextJob.errorMessage || "A importação da ActiveCampaign não foi concluída.");
      setMessage("");
    } else if (Boolean(nextJob.result?.cancellationRequested) || nextJob.errorCode === "JOB_CANCEL_REQUESTED") {
      setMessage("Cancelamento solicitado. O servidor está encerrando a etapa atual com segurança...");
      setError("");
    }
  }

  useEffect(() => {
    let canceled = false;
    void (async () => {
      try {
        const latest = await getLatestActiveCampaignImportJobOnServer();
        if (!canceled && latest) consumeJob(latest);
      } catch {
        // A ausência do histórico não impede uma nova importação.
      } finally {
        if (!canceled) setRestoring(false);
      }
    })();
    return () => { canceled = true; };
  }, []);

  useEffect(() => {
    if (!job?.id || !isJobActive) return undefined;
    let canceled = false;
    let timer = 0;

    const poll = async () => {
      try {
        const updated = await getAsyncJobOnServer(job.id);
        if (canceled) return;
        consumeJob(updated);
        if (updated.status === "queued" || updated.status === "running") {
          timer = window.setTimeout(() => void poll(), 1500);
        }
      } catch (caught) {
        if (!canceled) {
          setError(caught instanceof Error ? caught.message : "Não foi possível atualizar o progresso da importação.");
          timer = window.setTimeout(() => void poll(), 3000);
        }
      }
    };

    timer = window.setTimeout(() => void poll(), 700);
    return () => { canceled = true; window.clearTimeout(timer); };
  }, [job?.id, isJobActive]);

  async function handleTest(event: FormEvent) {
    event.preventDefault();
    setBusy("test"); setError(""); setMessage("");
    try {
      const result = await testActiveCampaignConnectionOnServer({ baseUrl, apiToken });
      setMessage(`Conexão confirmada. A API respondeu corretamente${result.contacts ? ` e informou ${formatNumber(result.contacts)} contato(s)` : ""}.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível testar a ActiveCampaign."); }
    finally { setBusy(""); }
  }

  async function handleImport() {
    if (isJobActive) return;
    setBusy("start"); setError(""); setMessage(""); setSummary(null);
    try {
      const queued = await startActiveCampaignNotesImportOnServer({ baseUrl, apiToken, fromDate: fromDate || undefined });
      consumeJob(queued);
      setApiToken("");
      setMessage("Importação iniciada. O processamento continua no servidor e pode ser acompanhado abaixo.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível iniciar a importação das notas."); }
    finally { setBusy(""); }
  }

  async function handleCancel() {
    if (!job?.id || !isJobActive || cancellationRequested) return;
    const confirmed = window.confirm("Cancelar esta importação da ActiveCampaign? As notas já gravadas serão mantidas, mas o processamento restante será interrompido.");
    if (!confirmed) return;
    setBusy("cancel"); setError("");
    try {
      const updated = await cancelActiveCampaignImportOnServer(job.id);
      consumeJob(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível solicitar o cancelamento da importação.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="panel productionPanel productionPanelV32 activeCampaignPanel">
      <div className="sectionTitleRow">
        <div><h3>ActiveCampaign · Importar notas</h3><p>Busca notas de contatos e de negócios (Deals) na ActiveCampaign e adiciona cada uma ao lead correspondente no BobCRM.</p></div>
        <span className="badge badgeBlue">Importação manual</span>
      </div>

      <div className="activeCampaignNotice">
        <strong>Como o BobCRM encontra o lead</strong>
        <span>Notas de negócios são vinculadas ao contato principal do Deal. Depois, o lead é localizado primeiro pelo e-mail e, se necessário, pelo telefone normalizado. Correspondências ambíguas não são importadas.</span>
      </div>

      <form className="activeCampaignForm" onSubmit={handleTest}>
        <label><span>URL da API da ActiveCampaign</span><input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://sua-conta.api-us1.com" autoComplete="off" required disabled={isJobActive} /></label>
        <label><span>API Token</span><input type="password" value={apiToken} onChange={(e) => setApiToken(e.target.value)} placeholder={isJobActive ? "Importação em andamento" : "Cole o token somente quando for importar"} autoComplete="new-password" required disabled={isJobActive} /></label>
        <label><span>Importar notas a partir de</span><BrDateInput value={fromDate} onChange={setFromDate} placeholder="DD/MM/AAAA" disabled={isJobActive} /><small>Opcional. Em branco, busca todo o histórico disponível.</small></label>
        <div className="activeCampaignSecurityNote">O token é usado somente nesta execução. Após o processamento, a credencial é removida do job e não fica disponível pela interface.</div>
        <div className="settingsActions settingsActionsV32">
          <button className="secondaryButton" type="submit" disabled={Boolean(busy) || isJobActive}>{busy === "test" ? "Testando..." : "Testar conexão"}</button>
          <button className="primaryButton" type="button" onClick={() => void handleImport()} disabled={Boolean(busy) || isJobActive || !baseUrl.trim() || !apiToken.trim()}>{busy === "start" ? "Iniciando..." : isJobActive ? "Importação em andamento" : "Importar notas agora"}</button>
          {isJobActive ? (
            <button className="dangerButton" type="button" onClick={() => void handleCancel()} disabled={Boolean(busy) || cancellationRequested}>
              {busy === "cancel" ? "Cancelando..." : cancellationRequested ? "Cancelamento solicitado..." : "Cancelar importação"}
            </button>
          ) : null}
        </div>
      </form>

      {restoring ? <div className="activeCampaignRestoring">Verificando se existe uma importação em andamento...</div> : null}
      {error ? <div className="systemNotice systemNoticeError"><strong>Erro:</strong><span>{error}</span></div> : null}
      {message ? <div className="systemNotice systemNoticeMigration"><strong>Status:</strong><span>{message}</span></div> : null}

      {job && (isJobActive || job.status === "failed" || job.status === "canceled") ? (
        <div className="activeCampaignProgressCard" aria-live="polite">
          <div className="activeCampaignProgressHeader">
            <div>
              <span className="activeCampaignProgressEyebrow">{job.status === "queued" ? "Na fila" : job.status === "failed" ? "Falhou" : job.status === "canceled" ? "Cancelada" : cancellationRequested ? "Cancelando" : "Importação em andamento"}</span>
              <h4>{job.progressMessage || progress?.stageLabel || "Preparando importação"}</h4>
            </div>
            <strong className="activeCampaignProgressPercent">{progressPercent}%</strong>
          </div>

          <div className="activeCampaignProgressTrack" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
            <span style={{ width: `${progressPercent}%` }} />
          </div>

          <div className="activeCampaignStageList">
            {PROGRESS_STAGES.map((stage, index) => {
              const state = currentStageIndex > index ? "done" : currentStageIndex === index && isJobActive ? "active" : "pending";
              return <div key={stage.id} className={`activeCampaignStage activeCampaignStage-${state}`}><span>{state === "done" ? "✓" : index + 1}</span><strong>{stage.label}</strong></div>;
            })}
          </div>

          <div className="activeCampaignLiveGrid">
            <article><span>Notas encontradas</span><strong>{formatNumber(Number(stats.notesFetched || 0))}</strong></article>
            <article><span>Notas de contatos</span><strong>{formatNumber(Number(stats.contactNotes || 0))}</strong></article>
            <article><span>Notas de negócios</span><strong>{formatNumber(Number(stats.dealNotes || 0))}</strong></article>
            <article><span>Notas processadas</span><strong>{formatNumber(Number(stats.processedNotes || 0))}</strong></article>
            <article><span>Importadas</span><strong>{formatNumber(Number(stats.imported || 0))}</strong></article>
            <article><span>Atualizadas</span><strong>{formatNumber(Number(stats.updated || 0))}</strong></article>
            <article><span>Duplicadas</span><strong>{formatNumber(Number(stats.duplicates || 0))}</strong></article>
            <article><span>Sem lead</span><strong>{formatNumber(Number(stats.contactsWithoutLead || 0))}</strong></article>
            <article><span>Ambíguas</span><strong>{formatNumber(Number(stats.ambiguousContacts || 0))}</strong></article>
            <article><span>Erros</span><strong>{formatNumber(Number(stats.errors || (job.status === "failed" ? 1 : 0)))}</strong></article>
          </div>

          <div className="activeCampaignProgressFooter">
            <span>{progress?.currentPage ? `Página atual: ${formatNumber(progress.currentPage)} · ` : ""}Última atualização: {formatDateTime(progress?.lastUpdatedAt || job.updatedAt)}</span>
            {isJobActive ? <strong>{cancellationRequested ? "Cancelamento solicitado. Aguarde o servidor encerrar a etapa atual." : "Você pode continuar usando o CRM e voltar para esta aba depois."}</strong> : job.status === "canceled" ? <strong>Importação interrompida pelo usuário.</strong> : null}
          </div>
        </div>
      ) : null}

      {summary ? (
        <div className="activeCampaignResults">
          <div className="sectionTitleRow"><div><h4>Resumo da última importação</h4><p>{formatDateTime(summary.startedAt)} → {formatDateTime(summary.completedAt)}</p></div></div>
          <div className="activeCampaignResultGrid">
            <article><span>Notas encontradas</span><strong>{formatNumber(summary.notesFetched)}</strong></article>
            <article><span>Notas de contatos</span><strong>{formatNumber(summary.contactNotes)}</strong></article>
            <article><span>Notas de negócios</span><strong>{formatNumber(summary.dealNotes)}</strong></article>
            <article><span>Negócios localizados</span><strong>{formatNumber(summary.dealsFound)} / {formatNumber(summary.dealsReferenced)}</strong></article>
            <article><span>Notas de negócio sem contato</span><strong>{formatNumber(summary.dealNotesWithoutContact)}</strong></article>
            <article><span>Notas processadas</span><strong>{formatNumber(summary.processedNotes)}</strong></article>
            <article><span>Novas importadas</span><strong>{formatNumber(summary.imported)}</strong></article>
            <article><span>Notas atualizadas</span><strong>{formatNumber(summary.updated)}</strong></article>
            <article><span>Duplicadas ignoradas</span><strong>{formatNumber(summary.duplicates)}</strong></article>
            <article><span>Contatos por e-mail</span><strong>{formatNumber(summary.contactsMatchedByEmail)}</strong></article>
            <article><span>Contatos por telefone</span><strong>{formatNumber(summary.contactsMatchedByPhone)}</strong></article>
            <article><span>Sem lead correspondente</span><strong>{formatNumber(summary.contactsWithoutLead)}</strong></article>
            <article><span>Correspondência ambígua</span><strong>{formatNumber(summary.ambiguousContacts)}</strong></article>
            <article><span>Ignoradas pela data</span><strong>{formatNumber(summary.ignoredByDate)}</strong></article>
          </div>
          {summary.dealLookupErrors ? <p className="activeCampaignFootnote">{formatNumber(summary.dealLookupErrors)} negócio(s) não puderam ser consultados pela API, normalmente por permissão de pipeline ou porque o negócio não existe mais.</p> : null}
          {summary.truncated ? <p className="activeCampaignFootnote">{formatNumber(summary.truncated)} nota(s) excediam 5.000 caracteres e foram truncadas para respeitar o limite atual do BobCRM.</p> : null}
        </div>
      ) : null}
    </section>
  );
}
