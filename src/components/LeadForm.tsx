import { FormEvent, useState } from "react";
import { createEmptyCustomFields, normalizeCustomFields, spreadsheetCustomFieldLabels } from "../constants/customFields";
import {
  createEmptyServiceStatusMap,
  getServiceInterestsFromStatusMap,
  serviceOptions,
  serviceProviderStatusOptions,
} from "../constants/services";
import type {
  Lead,
  LeadSource,
  LeadStatus,
  LeadTemperature,
  LostReason,
  ServiceInterest,
  ServiceProviderStatus,
  ServiceStatusMap,
  LeadCustomFieldKey,
  LeadCustomFields,
} from "../types/Lead";
import { formatCurrencyBRL, formatPhone, normalizeWebsite } from "../utils/formatters";

const sourceOptions: LeadSource[] = [
  "",
  "Instagram",
  "Google",
  "Indicação",
  "WhatsApp",
  "Evento",
  "Landing Page",
  "Tráfego Pago",
  "Outro",
];

const statusOptions: LeadStatus[] = [
  "Novo lead",
  "Contato feito",
  "Sem resposta",
  "Reunião marcada",
  "Diagnóstico realizado",
  "Proposta enviada",
  "Em negociação",
  "Fechado",
  "Perdido",
];

const temperatureOptions: LeadTemperature[] = ["", "Frio", "Morno", "Quente"];

const lostReasonOptions: LostReason[] = [
  "",
  "Preço",
  "Sem resposta",
  "Sem orçamento",
  "Fechou com concorrente",
  "Não era o momento",
  "Não viu valor",
  "Fora do perfil",
  "Lead curioso",
  "Outro",
];

type FormState = {
  name: string;
  email: string;
  phone: string;
  company: string;
  website: string;
  advertisesOnMeta: boolean;
  advertisesOnGoogle: boolean;
  doesNotAdvertise: boolean;
  lastContactAt: string;
  contactMadeAt: string;
  nextContactAt: string;
  expectedCloseAt: string;
  estimatedBudget: string;
  isLost: boolean;
  lostReason: LostReason;
  commercialNotes: string;
  status: LeadStatus;
  responsible: string;
  responsibleUserId: string;
  temperature: LeadTemperature;
  pain: string;
  source: LeadSource;
  serviceStatusMap: ServiceStatusMap;
  customFields: LeadCustomFields;
};

type LeadFormProps = {
  onCreateLead: (lead: Lead) => void;
};

type FormTab = "contact" | "commercial" | "next" | "services" | "custom" | "notes";
type FormErrors = Partial<Record<"name" | "email" | "lostReason", string>>;

const initialFormState: FormState = {
  name: "",
  email: "",
  phone: "",
  company: "",
  website: "",
  advertisesOnMeta: false,
  advertisesOnGoogle: false,
  doesNotAdvertise: false,
  lastContactAt: "",
  contactMadeAt: "",
  nextContactAt: "",
  expectedCloseAt: "",
  estimatedBudget: "",
  isLost: false,
  lostReason: "",
  commercialNotes: "",
  status: "Novo lead",
  responsible: "",
  responsibleUserId: "",
  temperature: "",
  pain: "",
  source: "",
  serviceStatusMap: createEmptyServiceStatusMap(),
  customFields: createEmptyCustomFields(),
};

const tabs: { id: FormTab; label: string; helper: string }[] = [
  { id: "contact", label: "Dados do contato", helper: "Nome, telefone, e-mail, empresa e site." },
  { id: "commercial", label: "Contexto comercial", helper: "Status, origem, temperatura e dor." },
  { id: "next", label: "Próximo passo", helper: "Datas, retorno e orçamento." },
  { id: "services", label: "Serviços", helper: "Diagnóstico de canais e ofertas." },
  { id: "custom", label: "Campos da planilha", helper: "Dados extras do formulário." },
  { id: "notes", label: "Observações", helper: "Notas e perda quando aplicável." },
];

export function LeadForm({ onCreateLead }: LeadFormProps) {
  const [formState, setFormState] = useState<FormState>(initialFormState);
  const [activeTab, setActiveTab] = useState<FormTab>("contact");
  const [formErrors, setFormErrors] = useState<FormErrors>({});

  function updateField<Field extends keyof FormState>(field: Field, value: FormState[Field]) {
    setFormState((currentState) => ({
      ...currentState,
      [field]: value,
    }));
    if (field === "name" || field === "email" || field === "lostReason") {
      setFormErrors((currentErrors) => ({ ...currentErrors, [field]: undefined }));
    }
  }

  function updateServiceStatus(service: ServiceInterest, status: ServiceProviderStatus) {
    setFormState((currentState) => ({
      ...currentState,
      serviceStatusMap: {
        ...currentState.serviceStatusMap,
        [service]: status || "Não sabemos",
      },
    }));
  }

  function updateCustomField(field: LeadCustomFieldKey, value: string) {
    setFormState((currentState) => ({
      ...currentState,
      customFields: {
        ...currentState.customFields,
        [field]: value,
      },
    }));
  }

  function handleNoAdsChange(checked: boolean) {
    setFormState((currentState) => ({
      ...currentState,
      doesNotAdvertise: checked,
      advertisesOnMeta: checked ? false : currentState.advertisesOnMeta,
      advertisesOnGoogle: checked ? false : currentState.advertisesOnGoogle,
    }));
  }

  function handlePaidAdsChange(field: "advertisesOnMeta" | "advertisesOnGoogle", checked: boolean) {
    setFormState((currentState) => ({
      ...currentState,
      [field]: checked,
      doesNotAdvertise: checked ? false : currentState.doesNotAdvertise,
    }));
  }

  function handleStatusChange(status: LeadStatus) {
    setFormState((currentState) => ({
      ...currentState,
      status,
      isLost: status === "Perdido",
      lostReason: status === "Perdido" ? currentState.lostReason : "",
    }));
  }

  function resetForm() {
    setFormState(initialFormState);
    setFormErrors({});
    setActiveTab("contact");
  }

  function validateForm(): FormErrors {
    const errors: FormErrors = {};
    if (!formState.name.trim()) errors.name = "Informe o nome do lead.";
    if (formState.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formState.email.trim())) {
      errors.email = "Informe um e-mail válido.";
    }
    if ((formState.status === "Perdido" || formState.isLost) && !formState.lostReason) {
      errors.lostReason = "Selecione o motivo da perda.";
    }
    return errors;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const errors = validateForm();
    setFormErrors(errors);
    if (Object.keys(errors).length) {
      setActiveTab(errors.name || errors.email ? "contact" : "notes");
      return;
    }

    const isLost = formState.isLost || formState.status === "Perdido";
    const serviceInterests = getServiceInterestsFromStatusMap(formState.serviceStatusMap);

    const lead: Lead = {
      id: crypto.randomUUID(),
      name: formState.name.trim(),
      email: formState.email.trim(),
      phone: formState.phone.trim(),
      company: formState.company.trim(),
      website: normalizeWebsite(formState.website),
      advertisesOnMeta: formState.advertisesOnMeta,
      advertisesOnGoogle: formState.advertisesOnGoogle,
      doesNotAdvertise: formState.doesNotAdvertise,
      lastContactAt: formState.lastContactAt,
      contactMadeAt: formState.contactMadeAt,
      nextContactAt: formState.nextContactAt,
      expectedCloseAt: formState.expectedCloseAt,
      estimatedBudget: formState.estimatedBudget,
      isLost,
      lostReason: isLost ? formState.lostReason : "",
      commercialNotes: formState.commercialNotes.trim(),
      status: isLost ? "Perdido" : formState.status,
      responsible: "",
      responsibleUserId: "",
      temperature: formState.temperature,
      pain: formState.pain.trim(),
      source: formState.source,
      serviceInterests,
      serviceStatusMap: formState.serviceStatusMap,
      customFields: normalizeCustomFields(formState.customFields),
      createdAt: new Date().toISOString(),
    };

    onCreateLead(lead);
    resetForm();
  }

  return (
    <aside className="panel formPanel leadFormPanelV33 leadFormPanelV34">
      <div className="panelHeader leadFormHeaderV33 leadFormHeaderV34">
        <div>
          <span className="eyebrow">Novo lead</span>
          <h2>Novo lead</h2>
          <p>Cadastre o contato e registre o contexto comercial inicial.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="leadForm leadFormV33 leadFormV34" noValidate>
        {Object.keys(formErrors).length ? (
          <div className="formValidationSummary" role="alert">
            <strong>Revise os campos destacados.</strong>
            <span>O lead ainda não foi salvo.</span>
          </div>
        ) : null}

        <nav className="leadFormTabsV34" aria-label="Etapas do cadastro">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? "leadFormTabActiveV34" : ""}
              onClick={() => setActiveTab(tab.id)}
            >
              <strong>{tab.label}</strong>
              <span>{tab.helper}</span>
            </button>
          ))}
        </nav>

        <section className="leadFormTabPanelV34">
          {activeTab === "contact" ? (
            <div className="formSectionV33 formSectionV34">
              <header>
                <strong>Dados do contato</strong>
                <span>Comece pelos dados que permitem encontrar e acionar o lead.</span>
              </header>

              <div className="fieldGrid fieldGridV34">
                <label className="field">
                  <span>Nome</span>
                  <input id="lead-name" type="text" placeholder="Ex.: João Silva" value={formState.name} onChange={(event) => updateField("name", event.target.value)} aria-invalid={Boolean(formErrors.name)} aria-describedby={formErrors.name ? "lead-name-error" : undefined} />{formErrors.name ? <small id="lead-name-error" className="fieldError">{formErrors.name}</small> : null}
                </label>
                <label className="field">
                  <span>Telefone</span>
                  <input type="tel" placeholder="(11) 99999-9999" value={formState.phone} onChange={(event) => updateField("phone", formatPhone(event.target.value))} />
                </label>
              </div>

              <div className="fieldGrid fieldGridV34">
                <label className="field">
                  <span>E-mail</span>
                  <input id="lead-email" type="email" placeholder="joao@empresa.com.br" value={formState.email} onChange={(event) => updateField("email", event.target.value)} aria-invalid={Boolean(formErrors.email)} aria-describedby={formErrors.email ? "lead-email-error" : undefined} />{formErrors.email ? <small id="lead-email-error" className="fieldError">{formErrors.email}</small> : null}
                </label>
                <label className="field">
                  <span>Empresa</span>
                  <input type="text" placeholder="Nome da empresa" value={formState.company} onChange={(event) => updateField("company", event.target.value)} />
                </label>
              </div>

              <label className="field">
                <span>Website</span>
                <input type="text" placeholder="www.empresa.com.br" value={formState.website} onChange={(event) => updateField("website", event.target.value)} />
              </label>
            </div>
          ) : null}

          {activeTab === "commercial" ? (
            <div className="formSectionV33 formSectionV34">
              <header>
                <strong>Contexto comercial</strong>
                <span>Classifique o lead para o time saber o que fazer primeiro.</span>
              </header>

              <div className="fieldGrid fieldGridV34">
                <label className="field">
                  <span>Status do lead</span>
                  <select value={formState.status} onChange={(event) => handleStatusChange(event.target.value as LeadStatus)}>
                    {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </label>
                <div className="field leadAssignmentNoticeV43">
                  <span>Responsável</span>
                  <strong>Sem responsável no cadastro inicial</strong>
                  <small>Depois de salvar, use “Encaminhar para consultor” para definir vendedor, funil, etapa e primeira tarefa.</small>
                </div>
              </div>

              <div className="fieldGrid fieldGridV34">
                <label className="field">
                  <span>Temperatura</span>
                  <select value={formState.temperature} onChange={(event) => updateField("temperature", event.target.value as LeadTemperature)}>
                    {temperatureOptions.map((temperature) => <option key={temperature || "empty"} value={temperature}>{temperature || "Selecione"}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Origem</span>
                  <select value={formState.source} onChange={(event) => updateField("source", event.target.value as LeadSource)}>
                    {sourceOptions.map((source) => <option key={source || "empty"} value={source}>{source || "Selecione"}</option>)}
                  </select>
                </label>
              </div>

              <label className="field">
                <span>Dor do lead</span>
                <textarea placeholder="Ex.: Não gera leads qualificados, agência não entrega resultado, precisa vender mais..." value={formState.pain} onChange={(event) => updateField("pain", event.target.value)} rows={4} />
              </label>
            </div>
          ) : null}

          {activeTab === "next" ? (
            <div className="formSectionV33 formSectionV34">
              <header>
                <strong>Próximo passo</strong>
                <span>Deixe a próxima ação clara para evitar lead parado.</span>
              </header>

              <div className="fieldGrid fieldGridV34">
                <label className="field">
                  <span>Próximo passo em</span>
                  <input type="date" value={formState.nextContactAt} onChange={(event) => updateField("nextContactAt", event.target.value)} />
                </label>
                <label className="field">
                  <span>Fechamento previsto</span>
                  <input type="date" value={formState.expectedCloseAt} onChange={(event) => updateField("expectedCloseAt", event.target.value)} />
                </label>
              </div>

              <div className="fieldGrid fieldGridV34">
                <label className="field">
                  <span>Orçamento estimado</span>
                  <input type="text" inputMode="numeric" placeholder="R$ 0,00" value={formState.estimatedBudget} onChange={(event) => updateField("estimatedBudget", formatCurrencyBRL(event.target.value))} />
                </label>
                <label className="field">
                  <span>Último contato em</span>
                  <input type="date" value={formState.lastContactAt} onChange={(event) => updateField("lastContactAt", event.target.value)} />
                </label>
              </div>

              <div className="fieldGrid fieldGridV34">
                <label className="field">
                  <span>Contato feito em</span>
                  <input type="date" value={formState.contactMadeAt} onChange={(event) => updateField("contactMadeAt", event.target.value)} />
                </label>
              </div>
            </div>
          ) : null}

          {activeTab === "services" ? (
            <div className="formSectionV33 formSectionV34 servicesTabV34">
              <header>
                <strong>Adicionar diagnóstico de serviços</strong>
                <span>Preencha somente o que já foi identificado. O restante fica como desconhecido.</span>
              </header>

              <div className="adsBox adsBoxV33">
                <span className="fieldTitle">Canais de mídia paga</span>
                <div className="adsOptions adsOptionsV34">
                  <label className="checkCard"><input type="checkbox" checked={formState.advertisesOnMeta} onChange={(event) => handlePaidAdsChange("advertisesOnMeta", event.target.checked)} /> Anuncia na Meta</label>
                  <label className="checkCard"><input type="checkbox" checked={formState.advertisesOnGoogle} onChange={(event) => handlePaidAdsChange("advertisesOnGoogle", event.target.checked)} /> Anuncia no Google</label>
                  <label className="checkCard"><input type="checkbox" checked={formState.doesNotAdvertise} onChange={(event) => handleNoAdsChange(event.target.checked)} /> Não anuncia</label>
                </div>
              </div>

              <div className="servicesBox servicesBoxV33">
                <div className="servicesBoxHeader">
                  <span className="fieldTitle">Mapeamento de serviços</span>
                  <small>Casa, outra agência, não faz ou desconhecido.</small>
                </div>

                <div className="serviceStatusGrid serviceStatusGridV34">
                  {serviceOptions.map((service) => (
                    <label className="serviceStatusCard" key={service}>
                      <span>{service}</span>
                      <select value={formState.serviceStatusMap[service] || "Não sabemos"} onChange={(event) => updateServiceStatus(service, event.target.value as ServiceProviderStatus)}>
                        {serviceProviderStatusOptions.map((status) => <option key={status} value={status}>{status === "Não sabemos" ? "Desconhecido" : status}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ) : null}


          {activeTab === "custom" ? (
            <div className="formSectionV33 formSectionV34">
              <header>
                <strong>Campos adicionais da planilha</strong>
                <span>Campos presentes no formulário original que agora ficam salvos no cadastro do lead.</span>
              </header>

              <div className="fieldGrid fieldGridV34">
                {spreadsheetCustomFieldLabels.map((field) => (
                  <label className="field" key={field}>
                    <span>{field}</span>
                    <input
                      type="text"
                      value={formState.customFields[field] || ""}
                      onChange={(event) => updateCustomField(field, event.target.value)}
                      placeholder="Clique para adicionar"
                    />
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {activeTab === "notes" ? (
            <div className="formSectionV33 formSectionV34">
              <header>
                <strong>Observações</strong>
                <span>Use para registrar histórico comercial, contexto e objeções.</span>
              </header>

              <label className="field">
                <span>Observação comercial</span>
                <textarea placeholder="Ex.: Lead pediu retorno na próxima semana, comparando com outra agência, quer começar com Google Ads..." value={formState.commercialNotes} onChange={(event) => updateField("commercialNotes", event.target.value)} rows={5} />
              </label>

              {formState.status === "Perdido" ? (
                <div className="lostReasonSectionV33 lostReasonSectionV34">
                  <label className="field">
                    <span>Motivo da perda</span>
                    <select id="lead-lost-reason" value={formState.lostReason} onChange={(event) => updateField("lostReason", event.target.value as LostReason)} aria-invalid={Boolean(formErrors.lostReason)} aria-describedby={formErrors.lostReason ? "lead-lost-reason-error" : undefined}>
                      {lostReasonOptions.map((reason) => <option key={reason || "empty"} value={reason}>{reason || "Selecione"}</option>)}
                    </select>
                    {formErrors.lostReason ? <small id="lead-lost-reason-error" className="fieldError">{formErrors.lostReason}</small> : null}
                  </label>
                </div>
              ) : (
                <div className="formHintV34">Campos de perda aparecem somente quando o status do lead for Perdido.</div>
              )}
            </div>
          ) : null}
        </section>

        <div className="buttonRow formStickyActionsV33 formStickyActionsV34">
          <button className="primaryButton" type="submit">Salvar lead</button>
          <button className="secondaryButton" type="button" onClick={resetForm}>Limpar</button>
          <button className="ghostButton" type="button" onClick={resetForm}>Cancelar</button>
        </div>
      </form>
    </aside>
  );
}
