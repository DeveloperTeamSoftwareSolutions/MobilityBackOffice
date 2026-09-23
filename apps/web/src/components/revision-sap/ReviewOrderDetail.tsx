import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDateTime } from '../soporte/DocumentHeader';
import {
  apiErrorMessage,
  cancelItem,
  changeGroupInvoice,
  changeItemCenter,
  changeItemDestination,
  getReviewCatalogs,
  getReviewOrder,
  listNoSaleReasons,
  listSapOrders,
  reactivateItem,
  rejectOrder,
  resendToSap,
} from './revision-sap.api';
import {
  activeItems,
  blockingItemCount,
  draftsTrasRecarga,
  groupSapOrdersByAttempt,
  initialDrafts,
  lineChanges,
  planResend,
  salesAreaParts,
  statusLabel,
  statusTone,
} from './revision-sap.logic';
import {
  LineDraft,
  LineDrafts,
  NoSaleReason,
  ResendResult,
  ReviewCatalogs,
  ReviewItem,
  ReviewOrderDetail as Detail,
  SapOrder,
} from './revision-sap.types';
import { SapOrdersPanel } from './SapOrdersPanel';
import { ReviewItemsTable } from './ReviewItemsTable';
import { SapErrorMessage } from './SapErrorMessage';
import { GroupInvoiceModal } from './GroupInvoiceModal';
import { RejectOrderModal } from './RejectOrderModal';
import { ResendModal } from './ResendModal';
import { CancelItemModal } from './CancelItemModal';

interface Props {
  guid: string;
  onBack: () => void;
}

type Tab = 'items' | 'sap';

/**
 * Detalle de una orden en revisión, en dos pestañas.
 *
 * **Productos** es la orden tal como se va a volver a enviar: ahí se corrige el centro y
 * el destino de cada línea. **Órdenes SAP** es el historial de cómo salió cada intento,
 * una orden por centro, y por eso es solo consulta.
 */
export function ReviewOrderDetail({ guid, onBack }: Props) {
  const [tab, setTab] = useState<Tab>('items');
  const [order, setOrder] = useState<Detail | null>(null);
  const [catalogs, setCatalogs] = useState<ReviewCatalogs | null>(null);
  const [sapOrders, setSapOrders] = useState<SapOrder[]>([]);
  const [drafts, setDrafts] = useState<LineDrafts>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  // Agrupa factura se guarda solo, confirmado aparte: no es un borrador como el centro
  // y el destino, porque cambia cómo se envía la orden entera.
  const [askGroupInvoice, setAskGroupInvoice] = useState(false);
  const [savingGroupInvoice, setSavingGroupInvoice] = useState(false);
  const [groupInvoiceError, setGroupInvoiceError] = useState<string | null>(null);
  // Reenvío a SAP: el modal pregunta primero y después muestra qué contestó SAP.
  const [askResend, setAskResend] = useState(false);
  const [sending, setSending] = useState(false);
  const [resendResult, setResendResult] = useState<ResendResult | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  // Rechazo: cierra la orden y no se deshace, así que se confirma aparte.
  const [askReject, setAskReject] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);
  // Cancelar una línea: se confirma con motivo. Reactivar no, porque no se pierde nada.
  const [cancelFor, setCancelFor] = useState<ReviewItem | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  /** La línea que está esperando al servidor: apaga su botón, no toda la tabla. */
  const [busyItemGuid, setBusyItemGuid] = useState<string | null>(null);
  const [reasons, setReasons] = useState<NoSaleReason[]>([]);
  const [reasonsLoading, setReasonsLoading] = useState(true);
  const [reasonsError, setReasonsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getReviewOrder(guid), getReviewCatalogs(guid, false), listSapOrders(guid)])
      .then(([detail, options, sap]) => {
        if (cancelled) return;
        setOrder(detail);
        setCatalogs(options);
        setSapOrders(sap);
        setDrafts(initialDrafts(detail.items));
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorMessage(err, 'No se pudo cargar la orden.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [guid]);

  /**
   * El catálogo de motivos se pide una vez y aparte: no depende de la orden y es lo que
   * necesita el modal de cancelación. Si falla, no se rompe el detalle — sólo no se va a
   * poder cancelar una línea, y el modal lo dice.
   */
  useEffect(() => {
    let cancelled = false;
    setReasonsLoading(true);
    listNoSaleReasons()
      .then((data) => {
        if (!cancelled) setReasons(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setReasonsError(
            apiErrorMessage(err, 'No se pudo cargar el catálogo de motivos de no venta.'),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setReasonsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const changes = useMemo(() => (order ? lineChanges(order.items, drafts) : []), [order, drafts]);
  /** Código -> etiqueta, para mostrar el motivo de una línea cancelada con su nombre. */
  const reasonLabels = useMemo(
    () => Object.fromEntries(reasons.map((r) => [r.code, r.label])),
    [reasons],
  );
  const activos = useMemo(() => (order ? activeItems(order.items) : []), [order]);
  /**
   * Cómo va a salir el próximo envío: una orden SAP por centro, con sus productos y el
   * número de intento. Se calcula con lo que hay EN PANTALLA —incluidos los cambios sin
   * guardar— porque es lo que el operador está por mandar; y sin las líneas canceladas,
   * porque ésas no viajan.
   *
   * El número de intento sale de agrupar las órdenes SAP que ya existen: el próximo es el
   * siguiente. Es el mismo agrupamiento que muestra la pestaña "Órdenes SAP", así que los
   * dos números coinciden.
   */
  const plan = useMemo(
    () =>
      order
        ? planResend(
            order.items,
            drafts,
            order.centerCode,
            catalogs?.centers ?? [],
            groupSapOrdersByAttempt(sapOrders).length,
          )
        : { orders: [], attemptNumber: 1, cancelledCount: 0, itemCount: 0 },
    [order, drafts, catalogs, sapOrders],
  );
  const blocking = useMemo(
    () =>
      order && catalogs ? blockingItemCount(order.items, drafts, order.centerCode, catalogs) : 0,
    [order, catalogs, drafts],
  );

  const onChange = useCallback((itemGuid: string, next: LineDraft) => {
    setDrafts((prev) => ({ ...prev, [itemGuid]: next }));
    setSaveMessage(null);
    setSaveErrors((prev) => {
      if (!(itemGuid in prev)) return prev;
      const rest = { ...prev };
      delete rest[itemGuid];
      return rest;
    });
  }, []);

  function onDiscard() {
    if (!order) return;
    setDrafts(initialDrafts(order.items));
    setSaveErrors({});
    setSaveMessage(null);
  }

  /**
   * Agrupa factura se guarda al confirmar, no con el resto: no es una corrección de
   * línea sino un cambio en cómo se envía la orden entera, y el usuario ya vio en el
   * modal qué implica.
   */
  async function onConfirmGroupInvoice(reasonNotes: string | null) {
    if (!order) return;
    setSavingGroupInvoice(true);
    setGroupInvoiceError(null);
    try {
      const result = await changeGroupInvoice(order.guid, !order.groupInvoice, reasonNotes);
      setOrder({ ...order, groupInvoice: result.groupInvoice });
      setAskGroupInvoice(false);
      setSaveMessage(
        result.groupInvoice
          ? 'Agrupa factura quedó en Sí: la orden ya no puede salir parcial.'
          : 'Agrupa factura quedó en No: la orden puede salir parcial.',
      );
    } catch (err) {
      setGroupInvoiceError(apiErrorMessage(err, 'No se pudo guardar agrupa factura.'));
    }
    setSavingGroupInvoice(false);
  }

  /**
   * Guarda cambio por cambio. Uno que falla no frena a los demás: su error queda al lado
   * del producto y ese cambio sigue pendiente para corregirlo y volver a guardar.
   */
  async function onSave() {
    if (!order || changes.length === 0) return;
    setSaving(true);
    setSaveMessage(null);
    const errors: Record<string, string> = {};
    let saved = 0;
    for (const change of changes) {
      if (!change.after) continue;
      try {
        if (change.field === 'center') {
          await changeItemCenter(order.guid, change.item.guid, change.after);
        } else {
          await changeItemDestination(order.guid, change.item.guid, change.after);
        }
        saved += 1;
      } catch (err) {
        const fallback =
          change.field === 'center'
            ? 'No se pudo guardar el centro.'
            : 'No se pudo guardar el destino.';
        errors[change.item.guid] = apiErrorMessage(err, fallback);
      }
    }
    try {
      const [fresh, sap] = await Promise.all([getReviewOrder(order.guid), listSapOrders(order.guid)]);
      setOrder(fresh);
      setSapOrders(sap);
      setDrafts((prev) => {
        const next = initialDrafts(fresh.items);
        for (const itemGuid of Object.keys(errors)) {
          if (prev[itemGuid]) next[itemGuid] = prev[itemGuid];
        }
        return next;
      });
    } catch (err) {
      setError(apiErrorMessage(err, 'Se guardaron los cambios, pero no se pudo recargar la orden.'));
    }
    setSaveErrors(errors);
    const failed = Object.keys(errors).length;
    if (saved > 0) {
      setSaveMessage(
        (saved === 1 ? 'Se guardó 1 cambio.' : `Se guardaron ${saved} cambios.`) +
          (failed > 0
            ? ` ${failed === 1 ? '1 producto no' : `${failed} productos no`} se pudo guardar.`
            : ''),
      );
    }
    setSaving(false);
  }

  /**
   * Reenvía la orden entera a SAP.
   *
   * Una sola llamada: el servidor manda el pedido, estampa el resultado y —si SAP
   * aceptó con entrega— cierra la revisión. Después se recarga todo, porque el estado,
   * los números de SAP y las órdenes SAP cambiaron.
   *
   * El modal NO se cierra al terminar: ahí queda el número de pedido o el motivo del
   * rechazo, que es lo que hay que leer.
   */
  async function onConfirmResend() {
    if (!order) return;
    setSending(true);
    setResendError(null);
    try {
      const result = await resendToSap(order.guid);
      setResendResult(result);
      const [fresh, sap] = await Promise.all([
        getReviewOrder(order.guid),
        listSapOrders(order.guid),
      ]);
      setOrder(fresh);
      setSapOrders(sap);
      setDrafts(initialDrafts(fresh.items));
      setSaveErrors({});
      setSaveMessage(null);
    } catch (err) {
      setResendError(apiErrorMessage(err, 'No se pudo reenviar la orden a SAP.'));
    }
    setSending(false);
  }

  function onCloseResend() {
    setAskResend(false);
    setResendResult(null);
    setResendError(null);
  }

  /**
   * Cancela una línea con su motivo de no venta.
   *
   * Recarga la orden en vez de parchear la línea: la respuesta trae la línea, pero el
   * detalle también cambia alrededor —`BackofficeDecidedBy`, y el resto de las líneas si
   * alguien más tocó la orden—. Parchear sólo la línea dejaría la pantalla contando una
   * verdad a medias.
   */
  async function onConfirmCancelItem(reasonCode: string, reasonNotes: string | null) {
    if (!order || !cancelFor) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const result = await cancelItem(order.guid, cancelFor.guid, reasonCode, reasonNotes);
      const fresh = await getReviewOrder(order.guid);
      setOrder(fresh);
      // Los cambios sin guardar de las OTRAS líneas se conservan: cancelar una línea no
      // es motivo para descartar lo que el usuario venía editando en el resto.
      setDrafts((prev) => draftsTrasRecarga(fresh.items, order.items, prev));
      setCancelFor(null);
      setSaveMessage(
        result.activosRestantes === 0
          ? 'La línea quedó cancelada. No queda ninguna línea activa: el envío a SAP no va a poder salir.'
          : `La línea quedó cancelada y no se va a enviar a SAP. Quedan ${
              result.activosRestantes === 1 ? '1 línea activa' : `${result.activosRestantes} líneas activas`
            }.`,
      );
    } catch (err) {
      setCancelError(apiErrorMessage(err, 'No se pudo cancelar la línea.'));
    }
    setCancelling(false);
  }

  /**
   * Reactiva una línea cancelada. No se confirma: no destruye nada y se puede volver a
   * cancelar. El servidor lo frena si hubo un envío después de la cancelación, y ese
   * mensaje es el que se muestra.
   */
  async function onReactivateItem(item: ReviewItem) {
    if (!order) return;
    setBusyItemGuid(item.guid);
    setSaveMessage(null);
    try {
      await reactivateItem(order.guid, item.guid);
      const fresh = await getReviewOrder(order.guid);
      setOrder(fresh);
      // Igual que al cancelar: lo que el usuario venía editando en otras líneas se queda.
      setDrafts((prev) => draftsTrasRecarga(fresh.items, order.items, prev));
      setSaveMessage(`La línea ${item.lineNumber} vuelve a incluirse en el próximo envío.`);
    } catch (err) {
      setSaveErrors((prev) => ({
        ...prev,
        [item.guid]: apiErrorMessage(err, 'No se pudo reactivar la línea.'),
      }));
    }
    setBusyItemGuid(null);
  }

  /**
   * Rechaza la orden: la cierra y se la devuelve al vendedor como "Rechazada".
   *
   * No se deshace, así que después de rechazar se RECARGA la orden en vez de parchear el
   * estado local: lo que vuelve trae el estado nuevo, quién la rechazó y cuándo, y con
   * `inReview` en false el detalle pasa solo a modo lectura. Parchearlo a mano dejaría la
   * pantalla diciendo que todavía se puede editar.
   *
   * Los cambios sin guardar se descartan: sobre una orden cerrada ya no significan nada.
   */
  async function onConfirmReject(reasonNotes: string) {
    if (!order) return;
    setRejecting(true);
    setRejectError(null);
    try {
      await rejectOrder(order.guid, reasonNotes);
      const fresh = await getReviewOrder(order.guid);
      setOrder(fresh);
      setDrafts(initialDrafts(fresh.items));
      setSaveErrors({});
      setAskReject(false);
      setSaveMessage(
        'La orden quedó rechazada y volvió al vendedor. El motivo quedó en el hilo de comentarios.',
      );
    } catch (err) {
      setRejectError(apiErrorMessage(err, 'No se pudo rechazar la orden.'));
    }
    setRejecting(false);
  }

  const backBar = (
    <div className="bo-rs__detail-bar">
      <button type="button" className="bo-rs__back" onClick={onBack}>
        ← Volver a la bandeja
      </button>
    </div>
  );

  if (loading || error || !order || !catalogs) {
    return (
      <>
        {backBar}
        {error ? <p className="bo-rs__error">{error}</p> : <p className="bo-rs__empty">Cargando orden…</p>}
      </>
    );
  }

  const editable = order.backoffice.inReview && !saving;
  const lastError = order.sap.lastError ?? order.sapAttempts.find((a) => a.error)?.error ?? null;
  const otherErrors = catalogs.errors.filter((e) => e.source !== 'stock');
  const rechazadas = sapOrders.filter((s) => s.status === 'rejected').length;

  return (
    <>
      {backBar}

      {!order.backoffice.inReview && (
        <p className="bo-rs__error" role="status">
          Esta orden ya no está en revisión de BackOffice
          {order.backoffice.decidedBy
            ? ` (la cerró ${order.backoffice.decidedBy} el ${formatDateTime(order.backoffice.decidedAt)})`
            : ''}
          . Se muestra en solo lectura.
        </p>
      )}

      <section className="bo-rs__card" aria-labelledby="bo-rs-order-title">
        <header className="bo-rs__card-head">
          <h2 id="bo-rs-order-title" className="bo-rs__doc-number">
            {order.orderNumber}
          </h2>
          {/* UNA sola etiqueta, nunca dos.
              Mientras la orden está en revisión, el único dato que importa es ese: el
              StatusCode no agrega nada y encima confunde — las órdenes nuevas quedan en
              `PendingBackofficeReview`, que diría lo mismo dos veces, y las viejas en
              `Processed`, que se lee como "terminada" cuando es lo contrario (MobilityIA
              se lo muestra al vendedor como "Pendiente envío a SAP").
              Cuando sale de revisión, el estado pasa a ser lo único que importa. */}
          {order.backoffice.inReview ? (
            <span className="bo-rs__status" title={order.statusCode ?? undefined}>
              En revisión por BackOffice
            </span>
          ) : (
            <span
              className={`bo-rs__pill bo-rs__pill--${statusTone(order.statusCode)}`}
              title={order.statusCode ?? undefined}
            >
              {statusLabel(order.statusCode)}
            </span>
          )}
        </header>
        <dl className="bo-rs__facts">
          <div className="bo-rs__fact">
            <dt>Cliente</dt>
            <dd>
              {order.customerName ?? '—'}
              {order.customerCode && <span className="bo-rs__cell-sub">{order.customerCode}</span>}
            </dd>
          </div>
          <div className="bo-rs__fact">
            <dt>Vendedor</dt>
            <dd>{order.sellerName ?? order.sellerEmail ?? '—'}</dd>
          </div>
          <div className="bo-rs__fact">
            <dt title="Organización de ventas de SAP: sociedad / canal de distribución / sector">
              Área de venta
            </dt>
            <dd>
              <ul className="bo-rs__area">
                {salesAreaParts(order.salesArea).map((p) => (
                  <li key={p.label}>
                    <span className="bo-rs__area-label">{p.label}</span> {p.value}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
          <div className="bo-rs__fact">
            <dt>Fecha de la orden</dt>
            <dd>{formatDateTime(order.orderDate)}</dd>
          </div>
          <div className="bo-rs__fact">
            <dt>Centro de cabecera</dt>
            <dd>
              <span className="bo-rs__mono">{order.centerCode ?? '—'}</span>
              {order.centerName && <span className="bo-rs__cell-sub">{order.centerName}</span>}
            </dd>
          </div>
          <div className="bo-rs__fact">
            <dt title="Se factura junto con la orden de compra del cliente">Agrupa factura</dt>
            <dd>
              <span className="bo-rs__gi-current">
                {order.groupInvoice ? (
                  <span className="bo-rs__pill bo-rs__pill--warn">Sí</span>
                ) : (
                  <span className="bo-rs__pill">No</span>
                )}
                {editable && (
                  <button
                    type="button"
                    className="bo-rs__link-button"
                    onClick={() => {
                      setGroupInvoiceError(null);
                      setAskGroupInvoice(true);
                    }}
                  >
                    Cambiar a {order.groupInvoice ? 'No' : 'Sí'}
                  </button>
                )}
              </span>
              <span className="bo-rs__cell-sub">
                {order.groupInvoice
                  ? 'La orden no puede salir parcial: o va entera, o SAP la rebota.'
                  : 'La orden puede salir parcial: las líneas sin stock se dejan afuera.'}
              </span>
            </dd>
          </div>
        </dl>
      </section>

      <section className="bo-rs__card bo-rs__card--sap" aria-labelledby="bo-rs-sap-title">
        <header className="bo-rs__card-head">
          <h3 id="bo-rs-sap-title" className="bo-rs__card-title">
            Motivo del rechazo de SAP
          </h3>
          <span className="bo-rs__cell--muted">
            {order.sapAttempts.length === 1 ? '1 intento' : `${order.sapAttempts.length} intentos`}
            {order.sap.lastAttemptAt ? ` · último ${formatDateTime(order.sap.lastAttemptAt)}` : ''}
          </span>
        </header>
        <SapErrorMessage error={lastError} />
      </section>

      <div className="bo-rs__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'items'}
          className={`bo-rs__tab ${tab === 'items' ? 'bo-rs__tab--active' : ''}`}
          onClick={() => setTab('items')}
        >
          Productos ({order.items.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'sap'}
          className={`bo-rs__tab ${tab === 'sap' ? 'bo-rs__tab--active' : ''}`}
          onClick={() => setTab('sap')}
        >
          Órdenes SAP ({sapOrders.length})
        </button>
      </div>

      {tab === 'items' ? (
        <section className="bo-rs__card" aria-labelledby="bo-rs-items-title">
          <header className="bo-rs__card-head">
            <h3 id="bo-rs-items-title" className="bo-rs__card-title">
              Productos de la orden
            </h3>
            <span className="bo-rs__cell--muted">
              Corregí acá el centro y el destino: así se va a volver a enviar.
            </span>
          </header>
          {otherErrors.length > 0 && (
            <p className="bo-rs__error">
              No se pudo cargar todo lo necesario para corregir la orden:{' '}
              {otherErrors.map((e) => e.message).join(' · ')}
            </p>
          )}
          <ReviewItemsTable
            orderGuid={order.guid}
            items={order.items}
            headerCenterCode={order.centerCode}
            drafts={drafts}
            catalogs={catalogs}
            editable={editable}
            saveErrors={saveErrors}
            onChange={onChange}
            onCancelItem={(item) => {
              setCancelError(null);
              setCancelFor(item);
            }}
            onReactivateItem={(item) => void onReactivateItem(item)}
            busyItemGuid={busyItemGuid}
            reasonLabels={reasonLabels}
          />
        </section>
      ) : (
        <section className="bo-rs__card" aria-labelledby="bo-rs-sap-orders-title">
          <header className="bo-rs__card-head">
            <h3 id="bo-rs-sap-orders-title" className="bo-rs__card-title">
              Órdenes SAP y sus productos
            </h3>
            <span className="bo-rs__cell--muted">
              {sapOrders.length === 1 ? '1 orden SAP' : `${sapOrders.length} órdenes SAP`}
              {rechazadas > 0 &&
                ` · ${rechazadas === 1 ? '1 rechazada' : `${rechazadas} rechazadas`}`}
            </span>
          </header>
          <SapOrdersPanel sapOrders={sapOrders} />
        </section>
      )}

      {askResend && (
        <ResendModal
          orderNumber={order.orderNumber}
          pendingChanges={changes.length}
          blocking={blocking}
          plan={plan}
          groupInvoice={order.groupInvoice}
          sending={sending}
          result={resendResult}
          error={resendError}
          onConfirm={() => void onConfirmResend()}
          onClose={onCloseResend}
        />
      )}

      {askReject && (
        <RejectOrderModal
          orderNumber={order.orderNumber}
          sellerEmail={order.sellerEmail}
          saving={rejecting}
          error={rejectError}
          onConfirm={(reasonNotes) => void onConfirmReject(reasonNotes)}
          onCancel={() => {
            setAskReject(false);
            setRejectError(null);
          }}
        />
      )}

      {cancelFor && (
        <CancelItemModal
          item={cancelFor}
          reasons={reasons}
          reasonsLoading={reasonsLoading}
          reasonsError={reasonsError}
          // Es la última si, sacándola, no queda ninguna activa. Se calcula con lo que
          // hay en pantalla, que es lo mismo que va a ver el envío.
          esLaUltima={activos.length === 1 && activos[0]?.guid === cancelFor.guid}
          saving={cancelling}
          error={cancelError}
          onConfirm={(reasonCode, reasonNotes) =>
            void onConfirmCancelItem(reasonCode, reasonNotes)
          }
          onCancel={() => {
            setCancelFor(null);
            setCancelError(null);
          }}
          onRejectOrder={() => {
            // El rechazo reemplaza a la cancelación, no se suma: cerramos éste antes.
            setCancelFor(null);
            setCancelError(null);
            setRejectError(null);
            setAskReject(true);
          }}
        />
      )}

      {askGroupInvoice && (
        <GroupInvoiceModal
          current={order.groupInvoice}
          saving={savingGroupInvoice}
          error={groupInvoiceError}
          onConfirm={(reasonNotes) => void onConfirmGroupInvoice(reasonNotes)}
          onCancel={() => setAskGroupInvoice(false)}
        />
      )}

      <div className="bo-rs__actions">
        <p className="bo-rs__actions-status" aria-live="polite">
          {saveMessage ??
            (changes.length === 0
              ? 'Sin cambios'
              : changes.length === 1
                ? '1 cambio sin guardar'
                : `${changes.length} cambios sin guardar`)}
          {blocking > 0 && (
            <span className="bo-rs__actions-blocking">
              {' '}
              ·{' '}
              {blocking === 1
                ? '1 producto necesita corrección'
                : `${blocking} productos necesitan corrección`}
            </span>
          )}
        </p>
        <div className="bo-rs__actions-buttons">
          {/* Rechazar cierra la orden y NO se deshace, así que va separado de los otros
              —que guardan o reintentan— y en rojo. No se apaga por cambios sin guardar
              ni por avisos: justamente se rechaza una orden que no se puede corregir.
              Lo único que lo apaga es que ya no esté en revisión. */}
          <button
            type="button"
            className="bo-rs__button bo-rs__button--danger bo-rs__actions-reject"
            disabled={!editable}
            onClick={() => {
              setRejectError(null);
              setAskReject(true);
            }}
          >
            Rechazar orden
          </button>
          <button
            type="button"
            className="bo-rs__button bo-rs__button--ghost"
            disabled={changes.length === 0 || saving}
            onClick={onDiscard}
          >
            Descartar cambios
          </button>
          <button
            type="button"
            className="bo-rs__button bo-rs__button--ghost"
            disabled={changes.length === 0 || blocking > 0 || !editable}
            onClick={() => void onSave()}
          >
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
          {/* El reenvío es de la orden COMPLETA, no de cada orden SAP (confirmado con
              el equipo el 2026-09-17): se manda la BusinessOrder y el Middleware la
              parte en una orden SAP por centro de distribución.

              No se bloquea por cambios sin guardar ni por avisos: el modal los dice y
              deja decidir. Lo único que lo apaga es que la orden ya no esté en revisión
              — sobre una orden ya resuelta no hay nada que reenviar, y el middleware la
              rechazaría igual. */}
          <button
            type="button"
            className="bo-rs__button"
            disabled={!editable}
            onClick={() => {
              setResendResult(null);
              setResendError(null);
              setAskResend(true);
            }}
          >
            Reenviar a SAP
          </button>
        </div>
      </div>
    </>
  );
}
