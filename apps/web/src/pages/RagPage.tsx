import '../components/rag/rag-frame.css';

/**
 * Documentacion del RAG (DuwyEngineRAG) embebido.
 *
 * El iframe apunta a `/rag/` — mismo origen que BackOffice — porque el backend
 * hace reverse-proxy hacia el RAG. Es la unica via: el RAG manda
 * X-Frame-Options: SAMEORIGIN y un iframe directo desde otro origen se bloquea.
 * La sesion viaja por la cookie httpOnly `bo_rag_token` (scopeada a /rag), que el
 * backend setea en el login; el proxy exige rol Marketing o SuperAdmin.
 */
export function RagPage() {
  return (
    <div className="bo-rag-wrap">
      <iframe
        className="bo-rag-frame"
        src="/rag/"
        title="Documentación del RAG"
      />
    </div>
  );
}
