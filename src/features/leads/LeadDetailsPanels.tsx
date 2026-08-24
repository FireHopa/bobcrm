import { getClientIntelligence, getServiceStatusBadgeClass, serviceOptions } from "../../constants/services";
import type { ExternalLeadOrigin, Lead, ServiceStatusMap } from "../../types/Lead";
import { getLeadScores, getRecommendedCommercialPlan } from "../../utils/commercial";

export function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="drawerInfoItem">
      <span>{label}</span>
      <strong>{value || "Não informado"}</strong>
    </div>
  );
}

export function InfoText({ label, value }: { label: string; value: string }) {
  return (
    <div className="drawerInfoText">
      <span>{label}</span>
      <p>{value || "Não informado"}</p>
    </div>
  );
}

export function ServiceStatusList({ serviceStatusMap }: { serviceStatusMap: ServiceStatusMap }) {
  const mappedServices = serviceOptions.filter((service) => Boolean(serviceStatusMap[service]));
  if (!mappedServices.length) return <InfoText label="Mapeamento dos serviços" value="" />;

  return (
    <div className="drawerInfoText">
      <span>Mapeamento dos serviços</span>
      <div className="drawerServiceStatusList">
        {mappedServices.map((service) => {
          const status = serviceStatusMap[service] || "Não sabemos";
          return (
            <div className="drawerServiceStatusItem" key={service}>
              <strong>{service}</strong>
              <span className={`badge ${getServiceStatusBadgeClass(status)}`}>{status}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ExternalOriginsSection({ origins, error }: { origins: ExternalLeadOrigin[]; error: string }) {
  if (!origins.length && !error) return null;
  return (
    <section className="drawerSection externalOriginsSection">
      <h3>Origens automáticas</h3>
      {error ? <p className="mutedText">{error}</p> : null}
      <div className="externalOriginsList">
        {origins.map((origin) => (
          <article className="externalOriginCard" key={origin.id}>
            <div>
              <strong>{origin.webhookName || "Webhook sem nome"}</strong>
              <span>{origin.source || "WhatsApp"} • painel {origin.tenantId || "não informado"}</span>
            </div>
            <div className="externalOriginMeta">
              <b>{origin.occurrences} entrada(s)</b>
              <span>{origin.lastSeenAt ? new Date(origin.lastSeenAt).toLocaleString("pt-BR") : ""}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function CommercialRecommendationPanel({ lead }: { lead: Lead }) {
  const scores = getLeadScores(lead);
  const plan = getRecommendedCommercialPlan(lead);
  return (
    <div className="drawerInfoText commercialRecommendationPanel">
      <span>Próxima ação recomendada</span>
      <div className="recommendationScoreRow">
        <strong className="badge badgeRed">Potencial {scores.commercialPotential}</strong>
        <strong className="badge badgeYellow">Mapeamento {scores.mappingUrgency}</strong>
        <strong className="badge badgeBlue">Prioridade {scores.priority}</strong>
      </div>
      <div className="recommendationCopy">
        <strong>{plan.diagnosis}</strong>
        <p><b>Ação:</b> {plan.nextAction}</p>
        <p><b>Oferta provável:</b> {plan.offer}</p>
        <p><b>Script:</b> {plan.script}</p>
      </div>
    </div>
  );
}

export function ClientIntelligencePanel({ lead }: { lead: Lead }) {
  const intelligence = getClientIntelligence(lead);
  const primaryItems = intelligence.items.filter((item) => [
    "announcesGoogle",
    "announcesMeta",
    "hasWebsite",
    "hasGooglePresence",
    "usesAi",
    "isCasaClient",
    "usesExternalAgency",
    "hasExpansionOpportunity",
    "needsMapping",
  ].includes(item.id));

  return (
    <div className="drawerInfoText drawerIntelligencePanel">
      <span>Oportunidades de expansão</span>
      <div className="drawerIntelligenceSummary">
        <strong>{intelligence.casaServicesCount}</strong> serviço(s) na Casa do Ads
        <small>•</small>
        <strong>{intelligence.externalAgencyServicesCount}</strong> em outra agência
        <small>•</small>
        <strong>{intelligence.unknownServicesCount}</strong> pendente(s) de mapeamento
      </div>
      <div className="drawerIntelligenceGrid">
        {primaryItems.map((item) => (
          <div className="drawerIntelligenceItem" title={item.description} key={item.id}>
            <span>{item.label}</span>
            <strong className={`badge ${item.className}`}>{item.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
