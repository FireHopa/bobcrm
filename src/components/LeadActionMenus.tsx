import type { ReactNode } from "react";
import type { Lead } from "../types/Lead";
import { getRecommendedCommercialPlan } from "../utils/commercial";
import { ActionMenu, type ActionMenuItem } from "./ActionMenu";
import { notifyAction } from "./ActionFeedback";

type LeadActionMenuProps = {
  lead: Lead;
  onViewLead?: (leadId: string) => void;
  onEditLead?: (leadId: string) => void;
  onDeleteLead?: (leadId: string) => void;
  includeOpen?: boolean;
  includeEdit?: boolean;
  includeScript?: boolean;
  includeContactChannels?: boolean;
  extraItems?: ActionMenuItem[];
  ariaLabel?: string;
  triggerLabel?: string;
  triggerClassName?: string;
};

type LeadContactMenuProps = {
  lead: Lead;
  onEditLead?: (leadId: string) => void;
  className?: string;
  label?: string;
};

type IconName = "open" | "edit" | "copy" | "whatsapp" | "phone" | "email" | "delete" | "calendar" | "check" | "handoff";

function MenuIcon({ name }: { name: IconName }) {
  const commonProps = {
    "aria-hidden": true,
    viewBox: "0 0 24 24",
    width: 18,
    height: 18,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (name === "open") return <svg {...commonProps}><path d="M14 5h5v5" /><path d="m10 14 9-9" /><path d="M19 13v6H5V5h6" /></svg>;
  if (name === "edit") return <svg {...commonProps}><path d="M4 20h4l11-11-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></svg>;
  if (name === "copy") return <svg {...commonProps}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" /></svg>;
  if (name === "whatsapp") return <svg {...commonProps}><path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4A8 8 0 1 1 20 11.5Z" /><path d="M8.5 8.5c.7 2.8 2.2 4.3 5 5" /><path d="m8.5 8.5 1.4-.7 1.2 2-1 1" /><path d="m13.5 13.5 1-1 2 1.2-.7 1.4" /></svg>;
  if (name === "phone") return <svg {...commonProps}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" /></svg>;
  if (name === "email") return <svg {...commonProps}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>;
  if (name === "delete") return <svg {...commonProps}><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="m6 7 1 14h10l1-14" /><path d="M9 7V4h6v3" /></svg>;
  if (name === "calendar") return <svg {...commonProps}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>;
  if (name === "handoff") return <svg {...commonProps}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M17 8h5M20 5l3 3-3 3" /></svg>;
  return <svg {...commonProps}><path d="m5 12 4 4L19 6" /></svg>;
}

export function createLeadMenuIcon(name: IconName): ReactNode {
  return <MenuIcon name={name} />;
}

function normalizePhoneForLink(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) return `55${digits}`;
  return digits;
}

async function copyText(text: string): Promise<boolean> {
  if (!text.trim()) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback abaixo cobre navegadores sem permissão de clipboard.
  }

  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.select();
    const copied = document.execCommand("copy");
    textArea.remove();
    return copied;
  } catch {
    return false;
  }
}

function openExternal(url: string) {
  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (popup) popup.opener = null;
}

function getContactItems(lead: Lead): ActionMenuItem[] {
  const plan = getRecommendedCommercialPlan(lead);
  const phone = normalizePhoneForLink(lead.phone);
  const email = lead.email.trim();
  const leadName = lead.name || lead.company || "cliente";
  const items: ActionMenuItem[] = [];

  if (phone) {
    items.push({
      id: "whatsapp",
      label: "WhatsApp",
      description: "Abrir conversa com a abordagem pronta",
      icon: <MenuIcon name="whatsapp" />,
      onSelect: () => openExternal(`https://wa.me/${phone}?text=${encodeURIComponent(plan.script)}`),
    });
    items.push({
      id: "phone",
      label: "Ligar",
      description: lead.phone,
      icon: <MenuIcon name="phone" />,
      onSelect: () => { window.location.href = `tel:${phone}`; },
    });
  }

  if (email) {
    const subject = `Próximo passo com a Casa do Ads`;
    const body = `Olá, ${leadName}.\n\n${plan.script}`;
    items.push({
      id: "email",
      label: "Enviar e-mail",
      description: email,
      icon: <MenuIcon name="email" />,
      onSelect: () => { window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`; },
    });
  }

  return items;
}

function getCopyScriptItem(lead: Lead): ActionMenuItem {
  const plan = getRecommendedCommercialPlan(lead);
  return {
    id: "copy-script",
    label: "Copiar script",
    description: "Copiar a abordagem recomendada",
    icon: <MenuIcon name="copy" />,
    onSelect: async () => {
      const copied = await copyText(plan.script);
      notifyAction(copied ? "Script copiado para a área de transferência." : "Não foi possível copiar o script.", copied ? "success" : "error");
    },
  };
}

export function LeadContactMenu({ lead, onEditLead, className = "tableActionButton primaryTableAction", label = "Contatar" }: LeadContactMenuProps) {
  const contactItems = getContactItems(lead);
  const items: ActionMenuItem[] = contactItems.length
    ? contactItems
    : [
      {
        id: "no-contact",
        label: "Nenhum canal cadastrado",
        description: "Adicione telefone ou e-mail para contatar",
        icon: <MenuIcon name="phone" />,
        disabled: true,
      },
      ...(onEditLead ? [{
        id: "edit-contact",
        label: "Atualizar contato",
        description: "Abrir os campos de contato permitidos",
        icon: <MenuIcon name="edit" />,
        onSelect: () => onEditLead(lead.id),
      }] : []),
    ];

  return (
    <ActionMenu
      ariaLabel={`Contatar ${lead.name || lead.company || "lead"}`}
      items={items}
      triggerContent={<span>{label}</span>}
      triggerClassName={`${className} actionMenuTextTrigger`.trim()}
      showChevron
    />
  );
}

export function LeadOverflowMenu({
  lead,
  onViewLead,
  onEditLead,
  onDeleteLead,
  includeOpen = true,
  includeEdit = true,
  includeScript = true,
  includeContactChannels = false,
  extraItems = [],
  ariaLabel,
  triggerLabel,
  triggerClassName,
}: LeadActionMenuProps) {
  const items: ActionMenuItem[] = [];

  if (includeOpen && onViewLead) {
    items.push({
      id: "open",
      label: "Abrir lead",
      description: "Ver detalhes, diagnóstico e histórico",
      icon: <MenuIcon name="open" />,
      onSelect: () => onViewLead(lead.id),
    });
  }

  if (includeEdit && onEditLead) {
    items.push({
      id: "edit",
      label: "Editar",
      description: "Atualizar os campos permitidos para o seu papel",
      icon: <MenuIcon name="edit" />,
      onSelect: () => onEditLead(lead.id),
    });
  }

  if (includeContactChannels) items.push(...getContactItems(lead));
  if (includeScript) items.push(getCopyScriptItem(lead));
  items.push(...extraItems);

  if (onDeleteLead) {
    items.push({
      id: "delete",
      label: "Excluir lead",
      description: "Mover o lead para a lixeira",
      icon: <MenuIcon name="delete" />,
      danger: true,
      separatorBefore: true,
      onSelect: () => onDeleteLead(lead.id),
    });
  }

  return (
    <ActionMenu
      ariaLabel={ariaLabel || `Mais ações para ${lead.name || lead.company || "lead"}`}
      items={items}
      triggerContent={triggerLabel ? <span>{triggerLabel}</span> : undefined}
      triggerClassName={triggerClassName || (triggerLabel ? "secondaryButton actionMenuTextTrigger" : undefined)}
      showChevron={Boolean(triggerLabel)}
    />
  );
}
