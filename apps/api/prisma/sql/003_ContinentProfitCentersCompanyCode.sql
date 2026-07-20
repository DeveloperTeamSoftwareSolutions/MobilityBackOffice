-- =============================================================================
-- Mobility BackOffice — ContinentProfitCenters: agregar CompanyCode (clave triple)
-- -----------------------------------------------------------------------------
-- ORIGEN: este script es el `006_ContinentProfitCentersCompanyCode.sql` del repo
-- MobilityManager, renumerado. YA FUE APLICADO a Mobility_QATEST desde allí
-- (verificado 2026-07-20: columna CompanyCode presente e índice único triple
-- UX_ContinentProfitCenters_Cont_Cebe_Company_Active creado). Requiere el 002.
-- -----------------------------------------------------------------------------
-- Motivo (reunión de equipo): existen CEBEs TRANSVERSALES (p. ej. "Duwest Banano",
-- "Seguridad") que operan en varias sociedades bajo distintas regiones. Para
-- consolidar una región (p. ej. Centroamérica) hay que traer tanto los CEBEs
-- país-específicos como los transversales, pero LIMITADOS a los Company Codes
-- (sociedades) de esa región geográfica. Por eso la clave de la asociación pasa
-- a integrar (ContinentId, ProfitCenterCode, CompanyCode).
--
-- Este script (idempotente, aditivo):
--   1. Agrega la columna CompanyCode.
--   2. Backfilla las 3 filas heredadas (region↔CEBE sin sociedad) con la sociedad
--      geográficamente correcta (eran datos de prueba; se pueden reasignar por ABM).
--   3. Cambia el índice único: de (GuidContinents, ProfitCenterCode) al triple
--      (GuidContinents, ProfitCenterCode, CompanyCode), filtrado por no-eliminado.
--   4. Índice de apoyo por CompanyCode + covering por ProfitCenterCode con CompanyCode.
--
-- NO toca la tabla `Continents` (catálogo compartido; el rename SA→Andina ya está
-- aplicado en la base). Sin USE (depende de la conexión). Ver docs/SPEC_BACKOFFICE_REGIONES.md.
-- =============================================================================
SET NOCOUNT ON;
GO

-- -----------------------------------------------------------------------------
-- 1. Columna CompanyCode (nullable primero: ADD aditivo sobre filas existentes).
--    Misma collation que ProfitCenterCode (Latin1_General_100_CI_AI_SC).
-- -----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID('dbo.ContinentProfitCenters') AND name = 'CompanyCode')
BEGIN
    ALTER TABLE dbo.ContinentProfitCenters
        ADD CompanyCode NVARCHAR(32) COLLATE Latin1_General_100_CI_AI_SC NULL; -- FK lógica → [SAPServices].[dbo].[Companies].CompanyCode
    PRINT '>> ContinentProfitCenters.CompanyCode added (nullable).';
END;
GO

-- -----------------------------------------------------------------------------
-- 2. Backfill de las filas heredadas (region↔CEBE sin sociedad). Idempotente:
--    solo toca filas activas con CompanyCode IS NULL. Mapeo geográfico:
--      CA · 1003 (Duwest Banano) → 2100 (Duwest Guatemala)
--      CA · 1080 (Qualicon)      → 2100 (Duwest Guatemala)
--      CB · 1003 (Duwest Banano) → 3000 (Duwest Dominicana)
-- -----------------------------------------------------------------------------
UPDATE rpc
    SET rpc.CompanyCode = m.CompanyCode,
        rpc.ServerTimestamp = DATEDIFF_BIG(MILLISECOND, '1970-01-01', SYSUTCDATETIME())
FROM dbo.ContinentProfitCenters rpc
JOIN dbo.Continents c
    ON c.Guid = rpc.GuidContinents
JOIN (VALUES
        ('CA', '1003', '2100'),
        ('CA', '1080', '2100'),
        ('CB', '1003', '3000')
     ) AS m (RegionCode, ProfitCenterCode, CompanyCode)
    ON m.RegionCode      COLLATE Latin1_General_100_CI_AI_SC = c.Code             COLLATE Latin1_General_100_CI_AI_SC
   AND m.ProfitCenterCode COLLATE Latin1_General_100_CI_AI_SC = rpc.ProfitCenterCode COLLATE Latin1_General_100_CI_AI_SC
WHERE rpc.CompanyCode IS NULL
  AND (rpc.DeletedTimestamp IS NULL OR rpc.DeletedTimestamp = 0);
PRINT '>> Backfill CompanyCode en filas heredadas (solo NULL activas).';
GO

-- -----------------------------------------------------------------------------
-- 3. Índice único: quitar el viejo (par) y crear el nuevo (triple), filtrado.
-- -----------------------------------------------------------------------------
IF EXISTS (SELECT 1 FROM sys.indexes
           WHERE name = 'UX_ContinentProfitCenters_Cont_Cebe_Active'
             AND object_id = OBJECT_ID('dbo.ContinentProfitCenters'))
BEGIN
    DROP INDEX UX_ContinentProfitCenters_Cont_Cebe_Active ON dbo.ContinentProfitCenters;
    PRINT '>> UX_ContinentProfitCenters_Cont_Cebe_Active (par) dropped.';
END;
GO

-- Forzar NOT NULL solo si no quedan CompanyCode NULL (backfill completo).
IF EXISTS (SELECT 1 FROM sys.columns
           WHERE object_id = OBJECT_ID('dbo.ContinentProfitCenters')
             AND name = 'CompanyCode' AND is_nullable = 1)
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.ContinentProfitCenters WHERE CompanyCode IS NULL)
    BEGIN
        ALTER TABLE dbo.ContinentProfitCenters
            ALTER COLUMN CompanyCode NVARCHAR(32) COLLATE Latin1_General_100_CI_AI_SC NOT NULL;
        PRINT '>> ContinentProfitCenters.CompanyCode -> NOT NULL.';
    END
    ELSE
        PRINT '!! CompanyCode con filas NULL: se deja nullable. Revisar backfill antes de forzar NOT NULL.';
END;
GO

-- Único triple: un CEBE no se vincula dos veces ACTIVO a la misma (región, sociedad).
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'UX_ContinentProfitCenters_Cont_Cebe_Company_Active'
                 AND object_id = OBJECT_ID('dbo.ContinentProfitCenters'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_ContinentProfitCenters_Cont_Cebe_Company_Active
    ON dbo.ContinentProfitCenters (GuidContinents, ProfitCenterCode, CompanyCode)
    INCLUDE (ProfitCenterName, DeletedTimestamp)
    WHERE DeletedTimestamp IS NULL;
    PRINT '>> UX_ContinentProfitCenters_Cont_Cebe_Company_Active (triple) created.';
END;
GO

-- -----------------------------------------------------------------------------
-- 4. Índices de apoyo.
-- -----------------------------------------------------------------------------
-- Búsqueda/consolidación por sociedad.
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_ContinentProfitCenters_CompanyCode'
                 AND object_id = OBJECT_ID('dbo.ContinentProfitCenters'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_ContinentProfitCenters_CompanyCode
    ON dbo.ContinentProfitCenters (CompanyCode)
    INCLUDE (GuidContinents, ProfitCenterCode, DeletedTimestamp);
    PRINT '>> IX_ContinentProfitCenters_CompanyCode created.';
END;
GO

-- Covering por CEBE: recrear con CompanyCode en el INCLUDE (diagnósticos/resolver).
IF EXISTS (SELECT 1 FROM sys.indexes
           WHERE name = 'IX_ContinentProfitCenters_ProfitCenterCode'
             AND object_id = OBJECT_ID('dbo.ContinentProfitCenters'))
BEGIN
    DROP INDEX IX_ContinentProfitCenters_ProfitCenterCode ON dbo.ContinentProfitCenters;
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_ContinentProfitCenters_ProfitCenterCode'
                 AND object_id = OBJECT_ID('dbo.ContinentProfitCenters'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_ContinentProfitCenters_ProfitCenterCode
    ON dbo.ContinentProfitCenters (ProfitCenterCode)
    INCLUDE (GuidContinents, CompanyCode, DeletedTimestamp);
    PRINT '>> IX_ContinentProfitCenters_ProfitCenterCode (con CompanyCode) created.';
END;
GO

PRINT '== ContinentProfitCenters: CompanyCode + clave triple aplicados ==';
GO
