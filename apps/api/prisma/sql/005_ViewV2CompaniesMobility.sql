-- =============================================================================
-- 005 — VIEW_V2_CompaniesMobility (maestro de sociedades para el Middleware)
--
--   Wrapper cross-DB en Mobility sobre [SAPServices].[dbo].[Companies]. Catalogo
--   MAESTRO de sociedades SAP (CompanyCode -> CompanyName, City, Country, Currency).
--   Es la vista que el endpoint del middleware `GET /api/v2/mobility/companies`
--   consume para el typeahead de sociedades del alta de CEBE en BackOffice.
--
--   POR QUE ESTE SCRIPT: la vista YA existe en Mobility_QATEST, pero NO en
--   Mobility-PROD (verificado contra el dump de esquema PROD 2026-08-03). Sin ella,
--   el selector de sociedades del alta de CEBE falla en produccion. Este script la
--   crea en el entorno que la necesite. Ver docs/DEPLOY_SQL_PENDIENTE.md.
--
--   Cross-DB collation: los textos se re-COLLATE-an al standard Mobility
--   (Latin1_General_100_CI_AI_SC) en los AS de salida, para que WHERE/JOIN externos
--   en Mobility usen la collation nativa sin conflictos.
--
--   Soft-delete: WHERE (DeletedTimestamp IS NULL OR DeletedTimestamp = 0).
--
--   Prerequisito: la base [SAPServices] debe existir en la misma instancia y contener
--   [dbo].[Companies]. Idempotente (CREATE OR ALTER). Sin USE: depende de la conexion,
--   correr conectado a Mobility_QATEST o Mobility-PROD segun corresponda.
-- =============================================================================
SET NOCOUNT ON;
GO

CREATE OR ALTER VIEW [dbo].[VIEW_V2_CompaniesMobility]
AS
SELECT
    -- Timestamps base estandar
    c.TimeStamp                                                    AS TimeStamp,
    c.ServerTimestamp                                              AS ServerTimestamp,
    c.DeletedTimestamp                                             AS DeletedTimestamp,

    -- Identidad
    c.Guid                     COLLATE Latin1_General_100_CI_AI_SC AS Guid,
    c.GuidTenants              COLLATE Latin1_General_100_CI_AI_SC AS GuidTenants,
    c.GuidSapCallLogs          COLLATE Latin1_General_100_CI_AI_SC AS GuidSapCallLogs,

    -- Datos de la sociedad
    c.CompanyCode              COLLATE Latin1_General_100_CI_AI_SC AS CompanyCode,
    c.CompanyName              COLLATE Latin1_General_100_CI_AI_SC AS CompanyName,
    c.City                     COLLATE Latin1_General_100_CI_AI_SC AS City,
    c.Country                  COLLATE Latin1_General_100_CI_AI_SC AS Country,
    c.Currency                 COLLATE Latin1_General_100_CI_AI_SC AS Currency

FROM [SAPServices].[dbo].[Companies] c
WHERE (c.DeletedTimestamp IS NULL OR c.DeletedTimestamp = 0);
GO

PRINT '>> VIEW_V2_CompaniesMobility creada/actualizada.';
GO
