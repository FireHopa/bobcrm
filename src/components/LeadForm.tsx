import { FormEvent, useState } from "react";
import { createEmptyCustomFields } from "../constants/customFields";
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
} from "../types/Lead";
import { formatPhone, normalizeWebsite } from "../utils/formatters";

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
  "Sem interesse",
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
  instagram: string;
  advertisesOnMeta: boolean;
  advertisesOnGoogle: boolean;
  doesNotAdvertiseOnMeta: boolean;
  doesNotAdvertiseOnGoogle: boolean;
  doesNotAdvertise: boolean;
  isLost: boolean;
  lostReason: LostReason;
  commercialNotes: string;
  status: LeadStatus;
  temperature: LeadTemperature;
  pain: string;
  source: LeadSource;
  serviceStatusMap: ServiceStatusMap;
};

type LeadFormProps = {
  onCreateLead: (lead: Lead) => void;
};

type FormTab = "contact" | "commercial" | "services";
type FormErrors = Partial<Record<"name" | "email" | "lostReason", string>>;

const initialFormState: FormState = {
  name: "",
  email: "",
  phone: "",
  company: "",
  website: "",
  instagram: "",
  advertisesOnMeta: false,
  advertisesOnGoogle: false,
  doesNotAdvertiseOnMeta: false,
  doesNotAdvertiseOnGoogle: false,
  doesNotAdvertise: false,
  isLost: false,
  lostReason: "",
  commercialNotes: "",
  status: "Novo lead",
  temperature: "",
  pain: "",
  source: "",
  serviceStatusMap: createEmptyServiceStatusMap(),
};

const tabs: { id: FormTab; label: string; helper: string }[] = [
  { id: "contact", label: "Dados do contato", helper: "Contato, Instagram e observações." },
  { id: "commercial", label: "Contexto comercial", helper: "Status, origem, temperatura e dor." },
  { id: "services", label: "Serviços", helper: "Diagnóstico de canais e ofertas." },
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

  function handleNoAdsChange(checked: boolean) {
    setFormState((currentState) => ({
      ...currentState,
      doesNotAdvertise: checked,
      advertisesOnMeta: checked ? false : currentState.advertisesOnMeta,
      advertisesOnGoogle: checked ? false : currentState.advertisesOnGoogle,
      doesNotAdvertiseOnMeta: checked ? true : false,
      doesNotAdvertiseOnGoogle: checked ? true : false,
    }));
  }

  function handlePaidAdsChange(field: "advertisesOnMeta" | "advertisesOnGoogle", checked: boolean) {
    setFormState((currentState) => {
      const isMeta = field === "advertisesOnMeta";
      return {
        ...currentState,
        [field]: checked,
        doesNotAdvertise: checked ? false : currentState.doesNotAdvertise,
        doesNotAdvertiseOnMeta: isMeta && checked ? false : currentState.doesNotAdvertiseOnMeta,
        doesNotAdvertiseOnGoogle: !isMeta && checked ? false : currentState.doesNotAdvertiseOnGoogle,
      };
    });
  }

  function handleNegativeAdsChange(field: "doesNotAdvertiseOnMeta" | "doesNotAdvertiseOnGoogle", checked: boolean) {
    setFormState((currentState) => {
      const isMeta = field === "doesNotAdvertiseOnMeta";
      const nextDoesNotAdvertiseOnMeta = isMeta ? checked : currentState.doesNotAdvertiseOnMeta;
      const nextDoesNotAdvertiseOnGoogle = isMeta ? currentState.doesNotAdvertiseOnGoogle : checked;
      const nextAdvertisesOnMeta = isMeta && checked ? false : currentState.advertisesOnMeta;
      const nextAdvertisesOnGoogle = !isMeta && checked ? false : currentState.advertisesOnGoogle;
      const doesNotAdvertise = !nextAdvertisesOnMeta
        && !nextAdvertisesOnGoogle
        && nextDoesNotAdvertiseOnMeta
        && nextDoesNotAdvertiseOnGoogle;

      return {
        ...currentState,
        [field]: checked,
        advertisesOnMeta: nextAdvertisesOnMeta,
        advertisesOnGoogle: nextAdvertisesOnGoogle,
        doesNotAdvertise,
      };
    });
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
      setActiveTab("contact");
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
      instagram: formState.instagram.trim(),
      advertisesOnMeta: formState.advertisesOnMeta,
      advertisesOnGoogle: formState.advertisesOnGoogle,
      doesNotAdvertiseOnMeta: formState.doesNotAdvertiseOnMeta,
      doesNotAdvertiseOnGoogle: formState.doesNotAdvertiseOnGoogle,
      doesNotAdvertise: formState.doesNotAdvertise,
      lastContactAt: "",
      contactMadeAt: "",
      nextContactAt: "",
      expectedCloseAt: "",
      estimatedBudget: "",
      isLost,
      lostReason: isLost ? formState.lostReason : "",
      commercialNotes: formState.commercialNotes.trim(),
      status: isLost ? "Perdido" : formState.status,
      responsible: "",
      responsibleUserId: "",
      sdrResponsible: "",
      sdrResponsibleUserId: "",
      temperature: formState.temperature,
      pain: formState.pain.trim(),
      source: formState.source,
      serviceInterests,
      serviceStatusMap: formState.serviceStatusMap,
      customFields: createEmptyCustomFields(),
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
                <span>Concentre aqui os dados de contato e as observações iniciais.</span>
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

              <div className="fieldGrid fieldGridV34">
                <label className="field">
                  <span>Website</span>
                  <input type="text" placeholder="www.empresa.com.br" value={formState.website} onChange={(event) => updateField("website", event.target.value)} />
                </label>
                <label className="field">
                  <span>Instagram</span>
                  <input type="text" placeholder="@empresa ou instagram.com/empresa" value={formState.instagram} onChange={(event) => updateField("instagram", event.target.value)} />
                </label>
              </div>

              <label className="field">
                <span>Observação comercial</span>
                <textarea placeholder="Ex.: Lead pediu retorno, comparando fornecedores ou trouxe algum contexto importante..." value={formState.commercialNotes} onChange={(event) => updateField("commercialNotes", event.target.value)} rows={4} />
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
              ) : null}
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
                  <label className="checkCard"><input type="checkbox" checked={formState.doesNotAdvertiseOnMeta} onChange={(event) => handleNegativeAdsChange("doesNotAdvertiseOnMeta", event.target.checked)} /> Não anuncia na Meta</label>
                  <label className="checkCard"><input type="checkbox" checked={formState.doesNotAdvertiseOnGoogle} onChange={(event) => handleNegativeAdsChange("doesNotAdvertiseOnGoogle", event.target.checked)} /> Não anuncia no Google</label>
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
