export function formatDate(date: string): string {
  if (!date) return "Pendente";

  const parsed = new Date(date.includes("T") ? date : `${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "Pendente";

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  const sameDay = (first: Date, second: Date) =>
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate();

  const hasTime = date.includes("T") || /\d{1,2}:\d{2}/.test(date);
  const time = parsed.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  if (sameDay(parsed, today)) return hasTime ? `Hoje às ${time}` : "Hoje";
  if (sameDay(parsed, yesterday)) return hasTime ? `Ontem às ${time}` : "Ontem";
  if (sameDay(parsed, tomorrow)) return hasTime ? `Amanhã às ${time}` : "Amanhã";

  const day = parsed.toLocaleDateString("pt-BR");
  return hasTime ? `${day} às ${time}` : day;
}

export function normalizeWebsite(website: string): string {
  if (!website.trim()) return "";

  const cleanWebsite = website.trim();

  if (/^https?:\/\//i.test(cleanWebsite)) {
    return cleanWebsite;
  }

  return `https://${cleanWebsite}`;
}

export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 13);

  if (digits.startsWith("351") && digits.length >= 12) {
    return `+${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`;
  }

  const brDigits = digits.startsWith("55") ? digits.slice(2) : digits;

  if (brDigits.length > 10) {
    return brDigits.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
  }

  if (brDigits.length > 6) {
    return brDigits.replace(/^(\d{2})(\d{4})(\d{0,4})$/, "($1) $2-$3");
  }

  if (brDigits.length > 2) {
    return brDigits.replace(/^(\d{2})(\d{0,5})$/, "($1) $2");
  }

  if (brDigits.length > 0) {
    return brDigits.replace(/^(\d*)$/, "($1");
  }

  return "";
}

export function formatCurrencyBRL(value: string): string {
  const digits = value.replace(/\D/g, "");

  if (!digits) return "";

  const amount = Number(digits) / 100;

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amount);
}

export function isPastDate(date: string): boolean {
  if (!date) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const comparedDate = new Date(date.includes("T") ? date : `${date}T00:00:00`);
  comparedDate.setHours(0, 0, 0, 0);

  return comparedDate < today;
}

export function isToday(date: string): boolean {
  if (!date) return false;

  const today = new Date();
  const comparedDate = new Date(date.includes("T") ? date : `${date}T00:00:00`);

  return (
    today.getFullYear() === comparedDate.getFullYear() &&
    today.getMonth() === comparedDate.getMonth() &&
    today.getDate() === comparedDate.getDate()
  );
}
