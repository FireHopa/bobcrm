import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { downloadWhatsappAccountConversionCsv, fetchWhatsappAccountConversionReport, type WhatsappAccountConversionReport } from "../utils/api";

type Props = { period: "24h" | "7d" | "30d" | "90d" };
const nf = new Intl.NumberFormat("pt-BR");
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
function pct(value: number) { return `${Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`; }
function duration(ms: number) { if (!ms) return "Sem resposta medida"; if (ms < 60_000) return `${Math.round(ms / 1000)} s`; return `${(ms / 60_000).toFixed(1)} min`; }

function Trend({ report }: { report: WhatsappAccountConversionReport }) {
  const values = report.trend.map((row) => Number(row.leads || 0));
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => `${values.length <= 1 ? 50 : (index / (values.length - 1)) * 100},${90 - (value / max) * 75}`).join(" ");
  return <article className="integrationChartCard"><div><h4>Leads por conta no período</h4><p>Evolução da coorte conforme o modelo de atribuição selecionado.</p></div><svg viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="0" y1="90" x2="100" y2="90" className="chartAxis"/><polyline points={points || "0,90 100,90"} fill="none" className="chartLine" vectorEffect="non-scaling-stroke"/></svg><div className="integrationChartFooter"><span>{report.trend[0]?.date || "Início"}</span><strong>{nf.format(values.length ? values[values.length - 1] : 0)}</strong><span>{report.trend.length ? report.trend[report.trend.length - 1]?.date || "Agora" : "Agora"}</span></div></article>;
}

export function WhatsappAccountConversionPanel({ period }: Props) {
  const [attribution, setAttribution] = useState<"first_touch" | "last_touch" | "assisted">("first_touch");
  const [view, setView] = useState<"acquisition" | "production">("acquisition");
  const [report, setReport] = useState<WhatsappAccountConversionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => { let active = true; setLoading(true); setError(""); fetchWhatsappAccountConversionReport({ period, attribution, view }).then((data) => { if (active) setReport(data); }).catch((e) => { if (active) setError(e instanceof Error ? e.message : "Não foi possível carregar o relatório."); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [period, attribution, view]);
  const top = useMemo(() => report?.byTenant[0] || null, [report]);
  return <section className="panel integrationTenantPanel whatsappConversionPanel">
    <div className="integrationSectionTitle"><div><h3>Conversão por conta do WhatsApp</h3><p>First touch mede aquisição. Last touch mede a conta da última interação. Assistida considera todas as contas participantes.</p></div><button className="secondaryButton" type="button" disabled={!report} onClick={() => void downloadWhatsappAccountConversionCsv({ period, attribution, view })}>Exportar conversão</button></div>
    <div className="integrationFilters"><select value={attribution} onChange={(e: ChangeEvent<HTMLSelectElement>) => setAttribution(e.target.value as typeof attribution)}><option value="first_touch">Primeira conta, aquisição</option><option value="last_touch">Última conta, fechamento</option><option value="assisted">Todas as contas assistentes</option></select><select value={view} onChange={(e: ChangeEvent<HTMLSelectElement>) => setView(e.target.value as typeof view)}><option value="acquisition">Coorte de entrada</option><option value="production">Produção no período</option></select>{top ? <span className="badge badgeBlue">Maior volume: {top.tenantId}</span> : null}</div>
    {error ? <div className="systemNotice systemNoticeError"><strong>Erro:</strong><span>{error}</span></div> : null}
    <div className="integrationConversionFunnel"><article><span>Leads atribuídos</span><strong>{nf.format(report?.totals.leads || 0)}</strong></article><article><span>Qualificados</span><strong>{nf.format(report?.totals.qualified || 0)}</strong></article><article><span>Reuniões</span><strong>{nf.format(report?.totals.meetings || 0)}</strong></article><article><span>Propostas</span><strong>{nf.format(report?.totals.proposals || 0)}</strong></article><article className="conversionWon"><span>Vendas</span><strong>{nf.format(report?.totals.won || 0)}</strong><small>{pct(report?.totals.conversionRate || 0)}</small></article><article><span>Receita</span><strong>{money.format(report?.totals.revenue || 0)}</strong><small>Ticket {money.format(report?.totals.ticketAverage || 0)}</small></article></div>
    {report ? <div className="integrationChartsGrid"><Trend report={report}/><article className="integrationChartCard"><div><h4>Participação das contas</h4><p>Leads atribuídos a cada número ou operação.</p></div><div className="integrationCompactList">{report.byTenant.slice(0,8).map((row) => <article key={row.tenantId}><strong>{row.tenantId}</strong><small>{nf.format(row.leads)} leads · {nf.format(row.won)} vendas · {pct(row.conversionRate)}</small></article>)}</div></article></div> : null}
    <div className="integrationTableWrap"><table className="integrationTable"><thead><tr><th>Conta</th><th>Leads</th><th>Recebidas</th><th>Enviadas</th><th>Qualificados</th><th>Reuniões</th><th>Propostas</th><th>Vendas</th><th>Conversão</th><th>Receita</th><th>1ª resposta</th><th>Até 5 min</th></tr></thead><tbody>{report?.byTenant.map((row) => <tr key={row.tenantId}><td><strong>{row.tenantId}</strong></td><td>{nf.format(row.leads)}</td><td>{nf.format(row.inboundMessages)}</td><td>{nf.format(row.outboundMessages)}</td><td>{nf.format(row.qualified)}<small>{pct(row.qualificationRate)}</small></td><td>{nf.format(row.meetings)}<small>{pct(row.meetingRate)}</small></td><td>{nf.format(row.proposals)}</td><td>{nf.format(row.won)}</td><td><strong>{pct(row.conversionRate)}</strong></td><td>{money.format(row.revenue)}</td><td>{duration(row.averageFirstResponseMs)}</td><td>{pct(row.within5Rate)}</td></tr>)}{!loading && !report?.byTenant.length ? <tr><td colSpan={12} className="integrationEmptyCell">Ainda não existem dados atribuídos neste período.</td></tr> : null}</tbody></table></div>
    {loading ? <p className="integrationEmptyText">Calculando atribuição e conversão por conta...</p> : null}
  </section>;
}
