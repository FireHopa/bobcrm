import { getClientIntelligence } from "../constants/services";
import type { Lead } from "../types/Lead";
import { getLeadScores, isActiveLead } from "../utils/commercial";
import { isPastDate, isToday } from "../utils/formatters";
import { MetricCard } from "./MetricCard";

type MetricsProps = {
  leads: Lead[];
};

export function Metrics({ leads }: MetricsProps) {
  const active = leads.filter(isActiveLead).length;
  const google = leads.filter((lead) => lead.advertisesOnGoogle).length;
  const dueFollowUps = leads.filter(
    (lead) => isActiveLead(lead) && (isToday(lead.nextContactAt) || isPastDate(lead.nextContactAt)),
  ).length;
  const highPriority = leads.filter((lead) => isActiveLead(lead) && getLeadScores(lead).priority >= 70).length;
  const migration = leads.filter((lead) => getClientIntelligence(lead).items.find((item) => item.id === "hasMigrationOpportunity")?.value === "Sim").length;
  const expansion = leads.filter((lead) => getClientIntelligence(lead).items.find((item) => item.id === "hasExpansionOpportunity")?.value === "Sim").length;

  return (
    <section className="metricsGrid metricsGridV31" aria-label="Indicadores do CRM">
      <MetricCard label="Leads ativos" value={active} accent="blue" helper="Carteira" footnote="Base viva para atendimento e venda" />
      <MetricCard label="Follow-ups pendentes" value={dueFollowUps} accent="red" helper="Urgente" footnote="Contatos vencidos ou programados para hoje" />
      <MetricCard label="Alta prioridade" value={highPriority} accent="yellow" helper="Ação" footnote="Leads com score forte para abordar primeiro" />
      <MetricCard label="Anunciam no Google" value={google} accent="green" helper="Mídia" footnote="Bons candidatos para auditoria e otimização" />
      <MetricCard label="Oportunidade de migração" value={migration} accent="gray" helper="Concorrência" footnote="Parte do serviço já está em outra agência" />
      <MetricCard label="Expansão com a Casa" value={expansion} accent="blue" helper="Upsell" footnote="Cliente com espaço para novas frentes" />
    </section>
  );
}
