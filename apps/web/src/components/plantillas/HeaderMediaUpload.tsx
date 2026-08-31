import { useRef, useState } from 'react';
import { TemplateFormState } from './plantillas.types';
import { uploadSample, mensajesDeError } from './plantillas.api';

/**
 * Archivo de ejemplo del encabezado multimedia.
 *
 * No es el archivo que se manda a los clientes: ese lo elige quien envía cada mensaje.
 * Es el ejemplo que **META exige para revisar** una plantilla con encabezado de imagen,
 * video o documento — sin él, la rechaza. Esa distinción es la que confunde, así que la
 * pantalla la dice explícitamente en vez de dejarla al nombre del campo.
 *
 * Lo que se guarda es el `handle` que devuelve META: el archivo no vuelve a viajar, ni
 * siquiera al reenviar la plantilla.
 */

/** Lo que acepta META para cada tipo, en el formato del `accept` del input. */
const ACEPTA: Record<string, string> = {
  IMAGE: 'image/jpeg,image/png',
  VIDEO: 'video/mp4,video/3gpp',
  DOCUMENT: 'application/pdf',
};

const DESCRIPCION: Record<string, string> = {
  IMAGE: 'JPG o PNG',
  VIDEO: 'MP4 o 3GP',
  DOCUMENT: 'PDF',
};

export function HeaderMediaUpload({
  form,
  set,
  saving,
  id,
}: {
  form: TemplateFormState;
  set: <K extends keyof TemplateFormState>(k: K, v: TemplateFormState[K]) => void;
  saving: boolean;
  /** Distingue el input del asistente del del modo avanzado, que conviven en la sección. */
  id: string;
}) {
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const tipo = form.headerType;
  const acepta = ACEPTA[tipo] ?? '';

  const elegir = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setSubiendo(true);
    try {
      const res = await uploadSample(file, tipo);
      set('headerHandle', res.handle);
      set('headerFileName', res.fileName);
    } catch (err) {
      setError(mensajesDeError(err)[0]);
      // Se limpia lo anterior: dejar un handle viejo con un archivo nuevo a la vista
      // haría que se envíe a META algo distinto de lo que se ve.
      set('headerHandle', '');
      set('headerFileName', '');
    } finally {
      setSubiendo(false);
      // Permite volver a elegir el mismo archivo después de un error.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const quitar = () => {
    set('headerHandle', '');
    set('headerFileName', '');
    setError(null);
  };

  return (
    <div className="bo-pl__field">
      <label className="bo-pl__label" htmlFor={id}>
        Archivo de ejemplo
      </label>
      <p className="bo-pl__hint">
        META necesita ver un ejemplo del {DESCRIPCION[tipo] ? 'archivo' : 'medio'} para
        revisar la plantilla. <strong>No es el archivo que se envía a los clientes</strong>:
        ese lo elige quien manda cada mensaje.
      </p>

      <input
        ref={inputRef}
        id={id}
        type="file"
        className="bo-pl__file"
        accept={acepta}
        disabled={saving || subiendo}
        onChange={(e) => elegir(e.target.files?.[0])}
      />

      <span className="bo-pl__hint">
        {DESCRIPCION[tipo] ?? 'Formato admitido por META'} · hasta 25 MB
      </span>

      {subiendo && <p className="bo-pl__hint">Subiendo…</p>}

      {form.headerHandle && !subiendo && (
        <div className="bo-pl__filedone">
          <span className="bo-pl__fileok" aria-hidden="true">
            ✓
          </span>
          <span className="bo-pl__filename">{form.headerFileName || 'Archivo cargado'}</span>
          <button
            type="button"
            className="bo-pl__btn bo-pl__btn--sm"
            disabled={saving}
            onClick={quitar}
          >
            Quitar
          </button>
        </div>
      )}

      {error && <p className="bo-pl__warn">{error}</p>}
    </div>
  );
}
