-- =============================================================================
-- Mobility BackOffice — Registro completo en ITManager
-- Inserta la Application + Roles (SUPERADMIN, Administrador, Marketing) + Permisos
-- + el mapeo Rol->Permiso. El rol de cada usuario se ASIGNA en ITManager; BackOffice
-- lo deriva del accessMatrix filtrado por appId (sin tabla de mapeo ni perfil SAP).
--
-- Prerequisito DURO del login: sin este registro, el accessMatrix no trae roles de
-- la app y todo login responde 403.
--
-- NOTA sobre los permisos: hoy BackOffice autoriza por ROL (RolesGuard). Los permisos
-- viajan en el accessMatrix y quedan en la sesion (`permissions`, sin el prefijo
-- MOBILITYBO_), listos para chequeos mas finos si se necesitan. Definirlos ahora deja
-- el registro en ITManager completo y consistente. Ver docs/ROLES_Y_PERMISOS.md.
--
-- Idempotente y ADITIVO: solo INSERT IF NOT EXISTS, no modifica ni borra filas
-- ajenas. Sin USE (depende de la conexion). Correr en Mobility_QATEST y en
-- Mobility-PROD. Ver docs/DEPLOY_SQL_PENDIENTE.md.
-- =============================================================================
SET NOCOUNT ON;
GO

DECLARE @Client CHAR(36) = '00000000-0000-0000-0000-000000000001'; -- Default Organization
DECLARE @Now BIGINT = DATEDIFF_BIG(MILLISECOND, '1970-01-01', SYSUTCDATETIME());

-- -----------------------------------------------------------------------------
-- 1. Application
--    El Prefix 'MOBILITYBO' es lo que enlaza con PERM_PREFIX=MOBILITYBO_ y
--    APP_ID=MobilityBackOffice del .env. Si se cambia aca, hay que cambiarlo alla.
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
--    Prioridad de resolucion: SUPERADMIN > Administrador > Marketing.
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

-- -----------------------------------------------------------------------------
-- 3. Permisos de la app (idempotente por PermissionKey). Prefijo MOBILITYBO_: la app
--    los recibe sin el prefijo (REGIONS_VIEW, RAG_ACCESS, ...).
-- -----------------------------------------------------------------------------
;WITH P(PermissionKey, DisplayName, Description) AS (
    SELECT 'MOBILITYBO_REGIONS_VIEW',      'Ver regiones comerciales',      'Ver regiones, sus vinculos CEBE-sociedad y los diagnosticos' UNION ALL
    SELECT 'MOBILITYBO_REGIONS_LINK',      'Gestionar vinculos de regiones','Vincular y desvincular CEBEs a regiones'                    UNION ALL
    SELECT 'MOBILITYBO_RAG_ACCESS',        'Acceder al RAG',                'Acceder al cargador de documentacion del RAG'               UNION ALL
    SELECT 'MOBILITYBO_TEMPLATES_VIEW',    'Ver templates de WhatsApp',     'Ver las plantillas de WhatsApp (funcionalidad pendiente)'    UNION ALL
    SELECT 'MOBILITYBO_TEMPLATES_MANAGE',  'Gestionar templates de WhatsApp','Crear, editar y eliminar plantillas de WhatsApp (pendiente)'
)
INSERT INTO Permissions (Guid, GuidApplications, PermissionKey, DisplayName, Description, TimeStamp, ServerTimestamp)
SELECT CONVERT(CHAR(36), NEWID()), @App, P.PermissionKey, P.DisplayName, P.Description, @Now, @Now
FROM P
WHERE NOT EXISTS (SELECT 1 FROM Permissions x WHERE x.PermissionKey = P.PermissionKey AND x.GuidApplications = @App);
PRINT '>> MobilityBackOffice permissions ensured.';

-- -----------------------------------------------------------------------------
-- 4. Mapeo Rol -> Permiso (idempotente por par). SuperAdmin: todos. Administrador:
--    regiones. Marketing: RAG + templates.
-- -----------------------------------------------------------------------------
;WITH M(RoleKey, PermissionKey) AS (
    -- SUPERADMIN: todos los permisos
    SELECT 'MOBILITYBO_SUPERADMIN', 'MOBILITYBO_REGIONS_VIEW'      UNION ALL
    SELECT 'MOBILITYBO_SUPERADMIN', 'MOBILITYBO_REGIONS_LINK'      UNION ALL
    SELECT 'MOBILITYBO_SUPERADMIN', 'MOBILITYBO_RAG_ACCESS'        UNION ALL
    SELECT 'MOBILITYBO_SUPERADMIN', 'MOBILITYBO_TEMPLATES_VIEW'    UNION ALL
    SELECT 'MOBILITYBO_SUPERADMIN', 'MOBILITYBO_TEMPLATES_MANAGE'  UNION ALL
    -- Administrador: regiones
    SELECT 'MOBILITYBO_ADMIN',      'MOBILITYBO_REGIONS_VIEW'      UNION ALL
    SELECT 'MOBILITYBO_ADMIN',      'MOBILITYBO_REGIONS_LINK'      UNION ALL
    -- Marketing: RAG + templates
    SELECT 'MOBILITYBO_MARKETING',  'MOBILITYBO_RAG_ACCESS'        UNION ALL
    SELECT 'MOBILITYBO_MARKETING',  'MOBILITYBO_TEMPLATES_VIEW'    UNION ALL
    SELECT 'MOBILITYBO_MARKETING',  'MOBILITYBO_TEMPLATES_MANAGE'
)
INSERT INTO RolePermissions (Guid, GuidRoles, GuidPermissions, TimeStamp, ServerTimestamp)
SELECT CONVERT(CHAR(36), NEWID()), ro.Guid, pe.Guid, @Now, @Now
FROM M
JOIN Roles ro       ON ro.RoleKey = M.RoleKey AND ro.GuidApplications = @App
JOIN Permissions pe ON pe.PermissionKey = M.PermissionKey AND pe.GuidApplications = @App
WHERE NOT EXISTS (
    SELECT 1 FROM RolePermissions rp
    WHERE rp.GuidRoles = ro.Guid AND rp.GuidPermissions = pe.Guid
      AND (rp.DeletedTimestamp IS NULL OR rp.DeletedTimestamp = 0)
);
PRINT '>> MobilityBackOffice role-permission map ensured.';
GO

PRINT '== MobilityBackOffice registrada: Application + Roles + Permisos + Mapeo ==';
GO
