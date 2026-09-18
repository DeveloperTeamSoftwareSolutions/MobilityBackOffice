import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ScopeService } from './scope.service';
import { ScopeClient } from './scope.client';

/**
 * Módulo del alcance por jerarquía.
 *
 * **No es global, a diferencia de MobilityManager.** Allá lo consumen casi todas las
 * secciones; acá lo consume una sola (Almacenes), y que haya que importarlo a mano es
 * justamente lo que hace visible en el `imports` de cada módulo si una sección empieza a
 * recortar por jerarquía. Ver `docs/JERARQUIA_Y_VISIBILIDAD.md`.
 */
@Module({
  imports: [HttpModule],
  providers: [ScopeService, ScopeClient],
  exports: [ScopeService],
})
export class ScopeModule {}
