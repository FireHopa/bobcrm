import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  changeOwnPasswordOnServer,
  fetchPasswordPolicyFromServer,
  type PasswordPolicy,
} from "../utils/api";
import { ModalDialog } from "./ModalDialog";

const FALLBACK_POLICY: PasswordPolicy = {
  minLength: 12,
  maxLength: 256,
  requireLowercase: true,
  requireUppercase: true,
  requireNumber: true,
  requireSpecial: true,
};

type ChangePasswordDialogProps = {
  onClose: () => void;
};

export function ChangePasswordDialog({ onClose }: ChangePasswordDialogProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [policy, setPolicy] = useState<PasswordPolicy>(FALLBACK_POLICY);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [revokedSessions, setRevokedSessions] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    fetchPasswordPolicyFromServer()
      .then((serverPolicy) => {
        if (active) setPolicy(serverPolicy);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const rules = useMemo(() => [
    {
      id: "length",
      label: `${policy.minLength} a ${policy.maxLength} caracteres`,
      valid: newPassword.length >= policy.minLength && newPassword.length <= policy.maxLength,
    },
    { id: "lower", label: "Pelo menos 1 letra minúscula", valid: !policy.requireLowercase || /[a-z]/.test(newPassword) },
    { id: "upper", label: "Pelo menos 1 letra maiúscula", valid: !policy.requireUppercase || /[A-Z]/.test(newPassword) },
    { id: "number", label: "Pelo menos 1 número", valid: !policy.requireNumber || /\d/.test(newPassword) },
    { id: "special", label: "Pelo menos 1 caractere especial", valid: !policy.requireSpecial || /[^A-Za-z0-9]/.test(newPassword) },
  ], [newPassword, policy]);

  const passwordMeetsPolicy = rules.every((rule) => rule.valid);
  const confirmationMatches = Boolean(confirmPassword) && newPassword === confirmPassword;
  const canSubmit = Boolean(currentPassword) && passwordMeetsPolicy && confirmationMatches && !isSaving;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setIsSaving(true);
    setError("");
    try {
      const result = await changeOwnPasswordOnServer({ currentPassword, newPassword, confirmPassword });
      setRevokedSessions(result.revokedSessions);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível alterar a senha.");
    } finally {
      setIsSaving(false);
    }
  }

  if (revokedSessions !== null) {
    return (
      <ModalDialog
        title="Senha alterada"
        description="Sua nova senha já está valendo."
        onClose={onClose}
        size="small"
        footer={<button className="primaryButton" type="button" data-dialog-initial-focus onClick={onClose}>Concluir</button>}
      >
        <div className="passwordChangeSuccessV46" role="status">
          <strong>Senha atualizada com sucesso.</strong>
          <p>
            {revokedSessions > 0
              ? `${revokedSessions} outra(s) sessão(ões) foram encerradas por segurança.`
              : "Sua sessão atual foi mantida e não havia outras sessões ativas para encerrar."}
          </p>
        </div>
      </ModalDialog>
    );
  }

  return (
    <ModalDialog
      title="Alterar minha senha"
      description="Confirme sua senha atual e escolha uma nova senha segura."
      onClose={onClose}
      closeDisabled={isSaving}
      dismissOnBackdrop={!isSaving}
      size="small"
      footer={(
        <>
          <button className="secondaryButton" type="button" onClick={onClose} disabled={isSaving}>Cancelar</button>
          <button className="primaryButton" type="submit" form="change-own-password-form" disabled={!canSubmit}>
            {isSaving ? "Alterando..." : "Alterar senha"}
          </button>
        </>
      )}
    >
      <form id="change-own-password-form" className="passwordChangeFormV46" onSubmit={handleSubmit}>
        {error ? <div className="systemNotice systemNoticeError" role="alert"><strong>Não foi possível alterar a senha.</strong><span>{error}</span></div> : null}

        <label className="field">
          <span>Senha atual</span>
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            maxLength={policy.maxLength}
            data-dialog-initial-focus
            required
          />
        </label>

        <label className="field">
          <span>Nova senha</span>
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            maxLength={policy.maxLength}
            required
          />
        </label>

        <div className="passwordRequirementsV46" aria-live="polite">
          <strong>Requisitos da nova senha</strong>
          <ul>
            {rules.map((rule) => (
              <li key={rule.id} className={rule.valid ? "passwordRuleOkV46" : "passwordRulePendingV46"}>
                <span aria-hidden="true">{rule.valid ? "✓" : "○"}</span>
                {rule.label}
              </li>
            ))}
          </ul>
        </div>

        <label className="field">
          <span>Confirmar nova senha</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            maxLength={policy.maxLength}
            required
          />
          {confirmPassword ? (
            <small className={confirmationMatches ? "passwordMatchOkV46" : "passwordMatchErrorV46"}>
              {confirmationMatches ? "As senhas conferem." : "As senhas ainda não conferem."}
            </small>
          ) : null}
        </label>
      </form>
    </ModalDialog>
  );
}
