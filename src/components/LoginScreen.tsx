import { FormEvent, useState } from "react";
import type { CRMUser } from "../types/Lead";
import { loginToServer } from "../utils/api";

type LoginScreenProps = {
  onLogin: (user: CRMUser) => void;
  serverStatus: "loading" | "online" | "offline";
};

function getServerStatusLabel(serverStatus: LoginScreenProps["serverStatus"]) {
  if (serverStatus === "online") return "Servidor online";
  if (serverStatus === "loading") return "Conectando ao servidor";
  return "Servidor offline";
}

export function LoginScreen({ onLogin, serverStatus }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await loginToServer(email, password);
      onLogin(response.user);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível entrar no CRM.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="loginShell loginShellV31 loginShellV32 loginShellV37">
      <section className="loginPanelLayout loginPanelLayoutV37">
        <aside className="panel loginShowcasePanel loginShowcasePanelV37">
          <div className="loginBrandMark" aria-hidden="true" />
          <span className="eyebrow">CRM Casa do Ads</span>
          <h1>Central Comercial</h1>
          <p>
            CRM mais compacto, operacional e orientado por próxima ação comercial.
          </p>

          <div className="loginHighlights">
            <article>
              <strong>Operação de hoje</strong>
              <span>Prioridades, follow-ups e próximos passos em um painel mais limpo.</span>
            </article>
            <article>
              <strong>Leads e oportunidades</strong>
              <span>Visual mais enxuto, filtros melhores e leitura comercial muito mais rápida.</span>
            </article>
            <article>
              <strong>Equipe e administração</strong>
              <span>Usuários, backups, lixeira, duplicados e auditoria fora da operação diária.</span>
            </article>
          </div>
        </aside>

        <section className="panel loginPanel loginPanelV31 loginPanelV37">
          <div className="loginTopMeta">
            <span className={`statusPill ${serverStatus === "online" ? "statusPillgreen" : serverStatus === "loading" ? "statusPillyellow" : "statusPillred"}`}>
              <span className="statusDot" />
              {getServerStatusLabel(serverStatus)}
            </span>
          </div>

          <span className="eyebrow">Acesso seguro</span>
          <h2>Entrar na Central Comercial</h2>
          <p>
            Faça login para acessar a base, operar leads e gerir a equipe com segurança.
          </p>

          <form className="loginForm" onSubmit={handleSubmit}>
            <label className="field">
              <span>E-mail</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                required
              />
            </label>

            <label className="field">
              <span>Senha</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>

            {error ? <div className="importError">{error}</div> : null}

            <button className="primaryButton" type="submit" disabled={isSubmitting || serverStatus === "offline"}>
              {isSubmitting ? "Entrando..." : "Entrar"}
            </button>
          </form>

          <div className="loginHint loginHintV31">
            <strong>Credenciais individuais</strong>
            <span>Use o usuário criado pelo administrador da operação.</span>
            <small>Credenciais iniciais devem ser configuradas no servidor e nunca exibidas nesta tela.</small>
          </div>
        </section>
      </section>
    </main>
  );
}
