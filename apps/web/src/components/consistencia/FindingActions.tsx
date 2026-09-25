import { FormEvent, useEffect, useId, useMemo, useState } from 'react';
import {
  apiErrorMessage,
  assignPortfolioOwner,
  createMember,
  fixMemberSapUserId,
  isConflict,
  listNodes,
  removeMember,
} from './consistencia.api';
import { Finding, FindingAction, FindingMember, HierarchyNode } from './consistencia.types';
import {
  REASON_MAX,
  SAP_USER_MAX,
  isValidEmail,
  reasonError,
  suggestionSourceLabel,
} from './consistencia.format';

/** Callbacks comunes: éxito (cierra y recarga) y recarga pedida tras un conflicto. */
interface Callbacks {
  onDone: (message: string) => void;
  onReload: () => void;
}

interface FormProps extends Callbacks {
  finding: Finding;
}

const ACTION_TITLE: Record<FindingAction, string> = {
  ALTA_MIEMBRO: 'Dar de alta en la jerarquía comercial',
  CORREGIR_SAPUSERID: 'Corregir el usuario SAP',
  BAJA_MIEMBRO: 'Dar de baja de la jerarquía comercial',
  ASIGNAR_DUENO: 'Asignar dueño de la cartera',
};

/** Estado de un envío: guardando, error del servidor y si fue un conflicto (409). */
function useSubmit(onDone: (message: string) => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  async function run(fn: () => Promise<unknown>, success: string, fallback: string) {
    setSaving(true);
    setError(null);
    setConflict(false);
    try {
      await fn();
      onDone(success);
    } catch (err) {
      setError(apiErrorMessage(err, fallback));
      setConflict(isConflict(err));
      setSaving(false);
    }
  }

  return { saving, error, conflict, run };
}

function ServerError({
  error,
  conflict,
  onReload,
}: {
  error: string | null;
  conflict: boolean;
  onReload: () => void;
}) {
  if (!error) return null;
  return (
    <div className="bo-cn__error" role="alert">
      <span>{error}</span>
      {conflict && (
        <button type="button" className="bo-cn__link-button" onClick={onReload}>
          Recargar
        </button>
      )}
    </div>
  );
}

function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <span id={id} className="bo-cn__field-error">
      {message}
    </span>
  );
}

/** Motivo de la corrección: obligatorio, queda en la auditoría. */
function ReasonField({
  value,
  onChange,
  error,
  disabled,
  label = 'Motivo (obligatorio)',
}: {
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  disabled: boolean;
  label?: string;
}) {
  const id = useId();
  const errId = `${id}-error`;
  return (
    <div className="bo-cn__field">
      <label className="bo-cn__label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="bo-cn__textarea"
        rows={3}
        maxLength={REASON_MAX}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        placeholder="Por qué se hace esta corrección. Queda registrado con tu nombre."
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="bo-cn__hint">
        {value.trim().length}/{REASON_MAX}
      </span>
      <FieldError id={errId} message={error} />
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  error,
  disabled,
  type = 'text',
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  disabled: boolean;
  type?: 'text' | 'email';
  maxLength?: number;
}) {
  const id = useId();
  const errId = `${id}-error`;
  return (
    <div className="bo-cn__field">
      <label className="bo-cn__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        className="bo-cn__input"
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      <FieldError id={errId} message={error} />
    </div>
  );
}

/** Compara sin mayúsculas ni acentos, para filtrar nodos como se escriben. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

function nodeLabel(node: HierarchyNode): string {
  const name = node.name ?? 'Sin nombre';
  return node.country ? `${name} — ${node.country}` : name;
}

/** Tope de opciones visibles: el resto se alcanza refinando el filtro. */
const MAX_NODE_OPTIONS = 200;

// ---- Alta de miembro --------------------------------------------------------

function CreateMemberForm({ finding, onDone, onReload }: FormProps) {
  const [nodes, setNodes] = useState<HierarchyNode[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [loadingNodes, setLoadingNodes] = useState(true);
  const [nodesError, setNodesError] = useState<string | null>(null);
  const [nodesRetry, setNodesRetry] = useState(0);

  const [filter, setFilter] = useState('');
  const [guidNode, setGuidNode] = useState('');
  const [role, setRole] = useState('');
  const [memberName, setMemberName] = useState(finding.personName ?? '');
  const [memberSapUserId, setMemberSapUserId] = useState(
    finding.sapUserId ?? finding.suggestion?.sapUserId ?? '',
  );
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { saving, error, conflict, run } = useSubmit(onDone);

  const filterId = useId();
  const nodeId = useId();
  const roleId = useId();

  useEffect(() => {
    let cancelled = false;
    setLoadingNodes(true);
    setNodesError(null);
    listNodes()
      .then((r) => {
        if (cancelled) return;
        setNodes(r.nodes);
        setRoles(r.roles);
      })
      .catch((err) => {
        if (!cancelled) {
          setNodesError(apiErrorMessage(err, 'No se pudo cargar la jerarquía comercial.'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingNodes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nodesRetry]);

  const filtered = useMemo(() => {
    const q = normalize(filter.trim());
    const list = q
      ? nodes.filter((n) =>
          normalize(
            [n.name, n.country, n.businessUnit, n.region].filter(Boolean).join(' '),
          ).includes(q),
        )
      : nodes;
    return [...list].sort((a, b) => nodeLabel(a).localeCompare(nodeLabel(b), 'es'));
  }, [nodes, filter]);

  const visible = filtered.slice(0, MAX_NODE_OPTIONS);
  // El nodo elegido sigue visible aunque el filtro lo deje afuera, para no perderlo.
  const selectedNode = nodes.find((n) => n.guid === guidNode) ?? null;
  const options =
    selectedNode && !visible.some((n) => n.guid === selectedNode.guid)
      ? [selectedNode, ...visible]
      : visible;

  const errors = {
    node: guidNode ? null : 'Elegí el nodo de la jerarquía.',
    role: role ? null : 'Elegí el rol.',
    name: memberName.trim() ? null : 'Escribí el nombre del miembro.',
    sap: memberSapUserId.trim() ? null : 'Escribí el usuario SAP del miembro.',
    reason: reasonError(reason),
  };
  const show = (m: string | null) => (submitted ? m : null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.values(errors).some(Boolean)) return;
    void run(
      () =>
        createMember({
          guidCommercialTeamHierarchies: guidNode,
          memberSapUserId: memberSapUserId.trim(),
          memberName: memberName.trim(),
          role,
          ...(finding.guidUsers ? { memberGuidUsers: finding.guidUsers } : {}),
          reason: reason.trim(),
          findingGroup: finding.group,
        }),
      'Se dio de alta al miembro en la jerarquía comercial.',
      'No se pudo dar de alta al miembro.',
    );
  }

  if (loadingNodes) return <p className="bo-cn__muted">Cargando la jerarquía comercial…</p>;
  if (nodesError) {
    return (
      <div className="bo-cn__error" role="alert">
        <span>{nodesError}</span>
        <button
          type="button"
          className="bo-cn__link-button"
          onClick={() => setNodesRetry((n) => n + 1)}
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <form className="bo-cn__form" onSubmit={onSubmit} noValidate aria-busy={saving}>
      <div className="bo-cn__field">
        <label className="bo-cn__label" htmlFor={filterId}>
          Buscar nodo
        </label>
        <input
          id={filterId}
          className="bo-cn__input"
          value={filter}
          disabled={saving}
          autoComplete="off"
          placeholder="Nombre, país, unidad de negocio o región"
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="bo-cn__field">
        <label className="bo-cn__label" htmlFor={nodeId}>
          Nodo de la jerarquía (obligatorio)
        </label>
        <select
          id={nodeId}
          className="bo-cn__listbox"
          size={Math.min(8, Math.max(3, options.length))}
          value={guidNode}
          disabled={saving}
          aria-invalid={show(errors.node) ? true : undefined}
          onChange={(e) => setGuidNode(e.target.value)}
        >
          {options.map((n) => (
            <option key={n.guid} value={n.guid}>
              {nodeLabel(n)}
            </option>
          ))}
        </select>
        {filtered.length > MAX_NODE_OPTIONS && (
          <span className="bo-cn__hint">
            Se muestran {MAX_NODE_OPTIONS} de {filtered.length}. Refiná la búsqueda.
          </span>
        )}
        {filtered.length === 0 && (
          <span className="bo-cn__hint">Ningún nodo coincide con la búsqueda.</span>
        )}
        <FieldError id={`${nodeId}-error`} message={show(errors.node)} />
      </div>
      <div className="bo-cn__field">
        <label className="bo-cn__label" htmlFor={roleId}>
          Rol (obligatorio)
        </label>
        <select
          id={roleId}
          className="bo-cn__select"
          value={role}
          disabled={saving}
          aria-invalid={show(errors.role) ? true : undefined}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="">Elegí un rol</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <FieldError id={`${roleId}-error`} message={show(errors.role)} />
      </div>
      <div className="bo-cn__form-row">
        <TextField
          label="Nombre del miembro"
          value={memberName}
          onChange={setMemberName}
          error={show(errors.name)}
          disabled={saving}
          maxLength={256}
        />
        <TextField
          label="Usuario SAP"
          value={memberSapUserId}
          onChange={setMemberSapUserId}
          error={show(errors.sap)}
          disabled={saving}
          maxLength={SAP_USER_MAX}
        />
      </div>
      <ReasonField
        value={reason}
        onChange={setReason}
        error={show(errors.reason)}
        disabled={saving}
      />
      <ServerError error={error} conflict={conflict} onReload={onReload} />
      <div className="bo-cn__form-actions">
        <button type="submit" className="bo-cn__button" disabled={saving}>
          {saving ? 'Guardando…' : 'Dar de alta'}
        </button>
      </div>
    </form>
  );
}

// ---- Corrección del usuario SAP --------------------------------------------

function memberCaption(m: FindingMember): string {
  const parts = [m.nodeName, m.nodeCountry, m.role].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Miembro de la jerarquía';
}

function FixSapUserIdForm({ finding, onDone, onReload }: FormProps) {
  const initial = finding.suggestion?.sapUserId ?? finding.sapUserId ?? '';
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(finding.members.map((m) => [m.guid, initial])),
  );
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState<string | null>(null);
  const { saving, error, conflict, run } = useSubmit(onDone);

  if (finding.members.length === 0) {
    return <p className="bo-cn__muted">No hay miembros de la jerarquía para corregir.</p>;
  }

  function valueError(m: FindingMember): string | null {
    const next = (values[m.guid] ?? '').trim();
    if (!next) return 'Escribí el usuario SAP correcto.';
    if (next === (m.sapUserId ?? '').trim()) return 'Es el mismo usuario SAP que ya tiene.';
    return null;
  }

  function submit(m: FindingMember) {
    setAttempted(m.guid);
    if (valueError(m) || reasonError(reason)) return;
    void run(
      () =>
        fixMemberSapUserId(m.guid, {
          memberSapUserId: (values[m.guid] ?? '').trim(),
          expectedSapUserId: m.sapUserId,
          reason: reason.trim(),
          findingGroup: finding.group,
        }),
      'Se corrigió el usuario SAP del miembro.',
      'No se pudo corregir el usuario SAP.',
    );
  }

  return (
    <div className="bo-cn__form" aria-busy={saving}>
      {finding.suggestion && (
        <p className="bo-cn__muted">
          Sugerido: <strong>{finding.suggestion.sapUserId}</strong>:{' '}
          {suggestionSourceLabel(finding.suggestion.source)}.
        </p>
      )}
      <ul className="bo-cn__member-list">
        {finding.members.map((m) => (
          <li key={m.guid} className="bo-cn__member-item">
            <span className="bo-cn__member-caption">{memberCaption(m)}</span>
            <span className="bo-cn__muted">
              Usuario SAP actual: <strong>{m.sapUserId ?? 'sin usuario SAP'}</strong>
            </span>
            <div className="bo-cn__inline-form">
              <TextField
                label="Usuario SAP correcto"
                value={values[m.guid] ?? ''}
                onChange={(v) => setValues((prev) => ({ ...prev, [m.guid]: v }))}
                error={attempted === m.guid ? valueError(m) : null}
                disabled={saving}
                maxLength={SAP_USER_MAX}
              />
              <button
                type="button"
                className="bo-cn__button"
                disabled={saving}
                onClick={() => submit(m)}
              >
                {saving && attempted === m.guid ? 'Guardando…' : 'Corregir'}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <ReasonField
        value={reason}
        onChange={setReason}
        error={attempted ? reasonError(reason) : null}
        disabled={saving}
      />
      <ServerError error={error} conflict={conflict} onReload={onReload} />
    </div>
  );
}

// ---- Baja de miembro ---------------------------------------------------------

function RemoveMemberForm({ finding, onDone, onReload }: FormProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const { saving, error, conflict, run } = useSubmit(onDone);

  if (finding.members.length === 0) {
    return <p className="bo-cn__muted">No hay miembros de la jerarquía para dar de baja.</p>;
  }

  function confirm(m: FindingMember) {
    setAttempted(true);
    if (reasonError(reason)) return;
    void run(
      () => removeMember(m.guid, { reason: reason.trim(), findingGroup: finding.group }),
      'Se dio de baja al miembro de la jerarquía comercial.',
      'No se pudo dar de baja al miembro.',
    );
  }

  return (
    <ul className="bo-cn__member-list" aria-busy={saving}>
      {finding.members.map((m) => (
        <li key={m.guid} className="bo-cn__member-item">
          <span className="bo-cn__member-caption">{memberCaption(m)}</span>
          <span className="bo-cn__muted">
            {m.memberName ?? 'Sin nombre'} · Usuario SAP:{' '}
            <strong>{m.sapUserId ?? 'sin usuario SAP'}</strong>
          </span>
          {pending === m.guid ? (
            <div className="bo-cn__confirm">
              <p className="bo-cn__warning">
                El miembro deja de figurar en ese nodo de la jerarquía. Queda registrado quién
                lo dio de baja y por qué.
              </p>
              <ReasonField
                value={reason}
                onChange={setReason}
                error={attempted ? reasonError(reason) : null}
                disabled={saving}
                label="Motivo de la baja (obligatorio)"
              />
              <ServerError error={error} conflict={conflict} onReload={onReload} />
              <div className="bo-cn__form-actions">
                <button
                  type="button"
                  className="bo-cn__button bo-cn__button--ghost"
                  disabled={saving}
                  onClick={() => {
                    setPending(null);
                    setAttempted(false);
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="bo-cn__button bo-cn__button--danger"
                  disabled={saving}
                  onClick={() => confirm(m)}
                >
                  {saving ? 'Dando de baja…' : 'Confirmar baja'}
                </button>
              </div>
            </div>
          ) : (
            <div className="bo-cn__form-actions bo-cn__form-actions--start">
              <button
                type="button"
                className="bo-cn__button bo-cn__button--danger-ghost"
                disabled={saving || pending !== null}
                onClick={() => {
                  setPending(m.guid);
                  setReason('');
                  setAttempted(false);
                }}
              >
                Dar de baja
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---- Dueño de cartera --------------------------------------------------------

function AssignOwnerForm({ finding, onDone, onReload }: FormProps) {
  const [guidPortfolio, setGuidPortfolio] = useState(
    finding.portfolios.length === 1 ? finding.portfolios[0].guid : '',
  );
  const [ownerSapUserId, setOwnerSapUserId] = useState(
    finding.suggestion?.sapUserId ?? finding.sapUserId ?? '',
  );
  const [ownerName, setOwnerName] = useState(finding.personName ?? '');
  const [ownerEmail, setOwnerEmail] = useState(finding.email ?? '');
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { saving, error, conflict, run } = useSubmit(onDone);
  const portfolioId = useId();

  if (finding.portfolios.length === 0) {
    return <p className="bo-cn__muted">El hallazgo no tiene carteras asociadas.</p>;
  }

  const errors = {
    portfolio: guidPortfolio ? null : 'Elegí la cartera.',
    sap: ownerSapUserId.trim() ? null : 'Escribí el usuario SAP del dueño.',
    name: ownerName.trim() ? null : 'Escribí el nombre del dueño.',
    email:
      ownerEmail.trim() && !isValidEmail(ownerEmail) ? 'El email no tiene un formato válido.' : null,
    reason: reasonError(reason),
  };
  const show = (m: string | null) => (submitted ? m : null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.values(errors).some(Boolean)) return;
    void run(
      () =>
        assignPortfolioOwner(guidPortfolio, {
          ownerSapUserId: ownerSapUserId.trim(),
          ownerName: ownerName.trim(),
          ...(finding.guidUsers ? { ownerGuidUsers: finding.guidUsers } : {}),
          ...(ownerEmail.trim() ? { ownerEmail: ownerEmail.trim() } : {}),
          reason: reason.trim(),
          findingGroup: finding.group,
        }),
      'Se asignó el dueño de la cartera.',
      'No se pudo asignar el dueño de la cartera.',
    );
  }

  return (
    <form className="bo-cn__form" onSubmit={onSubmit} noValidate aria-busy={saving}>
      {finding.portfolios.length === 1 ? (
        <p className="bo-cn__muted">
          Cartera: <strong>{finding.portfolios[0].name ?? 'Sin nombre'}</strong>
          {finding.portfolios[0].companyCode ? ` · Sociedad ${finding.portfolios[0].companyCode}` : ''}
        </p>
      ) : (
        <div className="bo-cn__field">
          <label className="bo-cn__label" htmlFor={portfolioId}>
            Cartera (obligatorio)
          </label>
          <select
            id={portfolioId}
            className="bo-cn__select"
            value={guidPortfolio}
            disabled={saving}
            aria-invalid={show(errors.portfolio) ? true : undefined}
            onChange={(e) => setGuidPortfolio(e.target.value)}
          >
            <option value="">Elegí una cartera</option>
            {finding.portfolios.map((p) => (
              <option key={p.guid} value={p.guid}>
                {p.name ?? 'Sin nombre'}
                {p.companyCode ? ` — Sociedad ${p.companyCode}` : ''}
              </option>
            ))}
          </select>
          <FieldError id={`${portfolioId}-error`} message={show(errors.portfolio)} />
        </div>
      )}
      <div className="bo-cn__form-row">
        <TextField
          label="Usuario SAP del dueño"
          value={ownerSapUserId}
          onChange={setOwnerSapUserId}
          error={show(errors.sap)}
          disabled={saving}
          maxLength={SAP_USER_MAX}
        />
        <TextField
          label="Nombre del dueño"
          value={ownerName}
          onChange={setOwnerName}
          error={show(errors.name)}
          disabled={saving}
          maxLength={256}
        />
      </div>
      <TextField
        label="Email del dueño (opcional)"
        type="email"
        value={ownerEmail}
        onChange={setOwnerEmail}
        error={show(errors.email)}
        disabled={saving}
        maxLength={320}
      />
      <ReasonField
        value={reason}
        onChange={setReason}
        error={show(errors.reason)}
        disabled={saving}
      />
      <ServerError error={error} conflict={conflict} onReload={onReload} />
      <div className="bo-cn__form-actions">
        <button type="submit" className="bo-cn__button" disabled={saving}>
          {saving ? 'Guardando…' : 'Asignar dueño'}
        </button>
      </div>
    </form>
  );
}

const FORMS: Record<FindingAction, (props: FormProps) => JSX.Element> = {
  ALTA_MIEMBRO: CreateMemberForm,
  CORREGIR_SAPUSERID: FixSapUserIdForm,
  BAJA_MIEMBRO: RemoveMemberForm,
  ASIGNAR_DUENO: AssignOwnerForm,
};

/** Un formulario por cada corrección que el hallazgo admite. */
export function FindingActions({ finding, onDone, onReload }: FormProps) {
  const actions = finding.actions.filter((a) => a in FORMS);
  if (actions.length === 0) {
    return (
      <p className="bo-cn__muted">
        No hay una corrección automática para este caso: revisalo con el área que corresponda.
      </p>
    );
  }
  return (
    <>
      {actions.map((action) => {
        const Form = FORMS[action];
        return (
          <section key={action} className="bo-cn__section" aria-label={ACTION_TITLE[action]}>
            <h3 className="bo-cn__section-title">{ACTION_TITLE[action]}</h3>
            <Form finding={finding} onDone={onDone} onReload={onReload} />
          </section>
        );
      })}
    </>
  );
}
