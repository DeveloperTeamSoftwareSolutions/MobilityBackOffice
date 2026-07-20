-- =============================================================================
-- Mobility BackOffice — Regiones comerciales por CEBE
-- Consolida reportes por CEBE (Centro de Beneficio) en vez de por país geográfico.
--
-- ORIGEN: este script es el `004_ContinentProfitCenters.sql` del repo MobilityManager,
-- renumerado. YA FUE APLICADO a Mobility_QATEST desde allí (verificado 2026-07-20).
-- Se versiona acá porque el módulo de Regiones pasó a vivir en BackOffice.
-- Requiere el 003 (CompanyCode) a continuación para llegar al esquema vigente.
-- REUSA la tabla existente `Continents` como catálogo de regiones comerciales
-- (CA=Centroamérica, CB=Caribe, AN=Andina, NA=Norteamérica) — SOLO LECTURA:
-- este script NO altera Continents ni inserta filas (es una tabla compartida por
-- otros reportes). Agrupaciones tipo CAYCAR (CA+CB) se resuelven por configuración
-- en el código, no en la base. Ver docs/SPEC_BACKOFFICE_REGIONES.md.
--
-- Crea 1 tabla NUEVA y aislada: ContinentProfitCenters (mapeo M:N CEBE↔región).
-- Idempotente: IF NOT EXISTS en tabla e índices. Sin USE (depende de la conexión).
-- =============================================================================
SET NOCOUNT ON;
GO

-- -----------------------------------------------------------------------------
-- ContinentProfitCenters — mapeo atomizado CEBE↔región (M:N). Unlink = soft-delete.
-- FK a Continents.Guid (solo lectura del catálogo; no se modifica esa tabla).
-- -----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ContinentProfitCenters')
BEGIN
    CREATE TABLE ContinentProfitCenters (
        Id                 INT      IDENTITY(1,1) NOT NULL,
        Guid               CHAR(36) COLLATE Latin1_General_100_CI_AI_SC NOT NULL
                               DEFAULT CONVERT(CHAR(36), NEWID()),
        TimeStamp          BIGINT   NOT NULL
                               DEFAULT DATEDIFF_BIG(MILLISECOND, '1970-01-01', SYSUTCDATETIME()),
        ServerTimestamp    BIGINT   NOT NULL
                               DEFAULT DATEDIFF_BIG(MILLISECOND, '1970-01-01', SYSUTCDATETIME()),
        DeletedTimestamp   BIGINT   NULL,
        -- OJO: la collation DEBE coincidir con Continents.Guid (Latin1_General_100_CI_AS_SC,
        -- el default de la base — accent-SENSITIVE), o la FK falla. No es el _AI_ del estándar.
        GuidContinents     CHAR(36)       COLLATE Latin1_General_100_CI_AS_SC NOT NULL, -- FK → Continents.Guid (catálogo)
        ProfitCenterCode   NVARCHAR(32)   COLLATE Latin1_General_100_CI_AI_SC NOT NULL, -- CEBE (ref. [SAPServices].[dbo].[ProfitCenters])
        ProfitCenterName   NVARCHAR(256)  COLLATE Latin1_General_100_CI_AI_SC NULL, -- snapshot al vincular
        Source             NVARCHAR(16)   COLLATE Latin1_General_100_CI_AI_SC NOT NULL DEFAULT 'ui', -- ui | api | sap
        CreatedBy          NVARCHAR(200)  NULL,
        UpdatedBy          NVARCHAR(200)  NULL,
        Version            INT      NOT NULL DEFAULT 1,
        CONSTRAINT PK_ContinentProfitCenters PRIMARY KEY (Guid),
        CONSTRAINT UQ_ContinentProfitCenters_Guid UNIQUE (Guid),
        CONSTRAINT FK_ContinentProfitCenters_GuidContinents FOREIGN KEY (GuidContinents) REFERENCES Continents(Guid)
    );
    PRINT '>> Table ContinentProfitCenters created.';
END;
GO

-- -----------------------------------------------------------------------------
-- Índices
-- -----------------------------------------------------------------------------
-- Único filtrado: un CEBE no se vincula dos veces ACTIVO a la misma región.
IF NOT EXISTS (SELECT 1 FROM sys.indexes
              WHERE name = 'UX_ContinentProfitCenters_Cont_Cebe_Active'
                AND object_id = OBJECT_ID('ContinentProfitCenters'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_ContinentProfitCenters_Cont_Cebe_Active
    ON dbo.ContinentProfitCenters (GuidContinents, ProfitCenterCode)
    INCLUDE (ProfitCenterName, DeletedTimestamp)
    WHERE DeletedTimestamp IS NULL;
    PRINT '>> UX_ContinentProfitCenters_Cont_Cebe_Active created.';
END;
GO

-- Búsqueda por CEBE: diagnósticos (sin región / en varias regiones) e intersección.
IF NOT EXISTS (SELECT 1 FROM sys.indexes
              WHERE name = 'IX_ContinentProfitCenters_ProfitCenterCode'
                AND object_id = OBJECT_ID('ContinentProfitCenters'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_ContinentProfitCenters_ProfitCenterCode
    ON dbo.ContinentProfitCenters (ProfitCenterCode)
    INCLUDE (GuidContinents, DeletedTimestamp);
    PRINT '>> IX_ContinentProfitCenters_ProfitCenterCode created.';
END;
GO

PRINT '== Regiones por CEBE: ContinentProfitCenters + índices (Continents NO se modifica) ==';
GO
