-- =============================================================================
-- Mobility BackOffice — Registro de la app en ITManager
-- Inserta la Application + sus Roles (SUPERADMIN, Administrador, Marketing).
-- El rol de cada usuario se ASIGNA en ITManager; BackOffice lo deriva del
-- accessMatrix filtrado por appId (no usa tabla de mapeo ni perfil SAP).
--
-- Prerequisito DURO del login: sin este registro, el accessMatrix no trae roles
-- de la app y todo login responde 403.
--
-- Idempotente y ADITIVO: solo INSERT IF NOT EXISTS, no modifica ni borra filas
-- ajenas. Sin USE (depende de la conexión). Correr en Mobility_QATEST y en
-- Mobility-PROD. Ver docs/DEPLOY_SQL_PENDIENTE.md.
-- =============================================================================
SET NOCOUNT ON;
GO

DECLARE @Client CHAR(36) = '00000000-0000-0000-0000-000000000001'; -- Default Organization
DECLARE @Now BIGINT = DATEDIFF_BIG(MILLISECOND, '1970-01-01', SYSUTCDATETIME());

-- -----------------------------------------------------------------------------
-- 1. Application
--    El Prefix 'MOBILITYBO' es lo que enlaza con PERM_PREFIX=MOBILITYBO_ y
--    APP_ID=MobilityBackOffice del .env. Si se cambia acá, hay que cambiarlo allá.
-- -----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM Applications WHERE AppId = 'MobilityBackOffice')
BEGIN
    INSERT INTO Applications
        (Guid, GuidApiLoginClients, AppId, DisplayName, Description, IsActive, AppType, Prefix, TimeStamp, ServerTimestamp)
    VALUES
        (CONVERT(CHAR(36), NEWID()), @Client, 'MobilityBackOffice', 'Mobility BackOffice',
         'Back-office de administracion y marketing', 1, 'user', 'MOBILITYBO', @Now, @Now);
    PRINT '>> Application MobilityBackOffice created.';
END;

DECLARE @App CHAR(36) = (SELECT Guid FROM Applications WHERE AppId = 'MobilityBackOffice');

-- -----------------------------------------------------------------------------
-- 2. Roles de la app (idempotente por RoleKey global). Cada usuario recibe uno de
--    estos en ITManager; el login deriva el rol del RoleKey (sin tabla de mapeo).
--    Prioridad de resolución: SUPERADMIN > Administrador > Marketing.
-- -----------------------------------------------------------------------------
;WITH R(RoleName, RoleKey) AS (
    SELECT 'SUPERADMIN',    'MOBILITYBO_SUPERADMIN' UNION ALL  -- acceso total
    SELECT 'Administrador', 'MOBILITYBO_ADMIN'      UNION ALL  -- regiones, configuracion
    SELECT 'Marketing',     'MOBILITYBO_MARKETING'             -- templates WhatsApp, carga RAG
)
INSERT INTO Roles (Guid, GuidApiLoginClients, GuidApplications, RoleName, RoleKey, TimeStamp, ServerTimestamp)
SELECT CONVERT(CHAR(36), NEWID()), @Client, @App, R.RoleName, R.RoleKey, @Now, @Now
FROM R
WHERE NOT EXISTS (SELECT 1 FROM Roles ro WHERE ro.RoleKey = R.RoleKey);
PRINT '>> MobilityBackOffice roles ensured.';
GO

PRINT '== MobilityBackOffice registrada: Application + Roles (SUPERADMIN/Administrador/Marketing) ==';
GO
