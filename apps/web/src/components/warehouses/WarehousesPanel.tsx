import { useState } from 'react';
import { CentersList } from './CentersList';
import { CenterWarehouses } from './CenterWarehouses';
import { Center } from './warehouses.types';
import './warehouses.css';

/**
 * Sección Centros y Almacenes. Vista inicial = centros; al entrar a un centro se ven sus
 * almacenes, y cada almacén despliega sus reservas (clientes y grupos de clientes de SAP).
 *
 * El alcance por sociedad lo resuelve el backend: acá no se filtra nada.
 */
export function WarehousesPanel() {
  const [center, setCenter] = useState<Center | null>(null);

  return (
    <div className="bo-wh-shell">
      {center ? (
        <CenterWarehouses center={center} onBack={() => setCenter(null)} />
      ) : (
        <CentersList onSelect={setCenter} />
      )}
    </div>
  );
}
