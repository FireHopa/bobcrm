import { memo, type FormEvent } from "react";
import type { CRMUser } from "../types/Lead";

type HeaderProps = {
  storageLabel?: string;
  storageTone?: "green" | "yellow" | "red";
  currentUser?: CRMUser | null;
  globalSearch?: string;
  onGlobalSearchChange?: (value: string) => void;
  onGlobalSearchSubmit?: (value: string) => void | Promise<void>;
  onLogout?: () => void;
  totalLeadsCount?: number;
};

export const Header = memo(function Header({
  storageLabel = "MySQL ativo",
  storageTone = "green",
  currentUser,
  globalSearch = "",
  onGlobalSearchChange,
  onGlobalSearchSubmit,
  onLogout,
  totalLeadsCount = 0,
}: HeaderProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const value = String(formData.get("globalSearch") || "").trim();
    onGlobalSearchSubmit?.(value);
  }

  const searchPlaceholder = totalLeadsCount > 0
    ? `Buscar em ${totalLeadsCount.toLocaleString("pt-BR")} leads por nome, empresa, telefone ou e-mail...`
    : "Buscar leads por nome, empresa, telefone, e-mail ou responsável...";

  return (
    <header className="topbar cockpitTopbar cockpitTopbarV34 cockpitTopbarV37" aria-label="Topo do CRM">
      <div className="brand cockpitBrand cockpitBrandV34 cockpitBrandV37">
        <div className="brandLogo cockpitBrandLogo cockpitBrandLogoV34" aria-hidden="true">
          <span />
        </div>

        <div className="brandCopy cockpitBrandCopy cockpitBrandCopyV34">
          <strong>Central Comercial</strong>
          <span>Casa do Ads · operação CRM</span>
        </div>
      </div>

      <form className="globalSearchForm globalSearchFormV34 globalSearchFormV37" role="search" onSubmit={handleSubmit}>
        <input
          name="globalSearch"
          type="search"
          value={globalSearch}
          onChange={(event) => onGlobalSearchChange?.(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label="Busca global"
        />
      </form>

      <div className="topActions cockpitTopActions cockpitTopActionsV34">
        {currentUser ? (
          <div className="userPill cockpitUserPill cockpitUserPillV34">
            <div className="userPillMeta">
              <strong>{currentUser.name}</strong>
              <span>{currentUser.roleLabel}</span>
            </div>
            <button className="ghostButton" type="button" onClick={onLogout}>
              Sair
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
});
