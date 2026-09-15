-- =============================================================================
-- Mobility BackOffice — Rol Revisión SAP
-- Agrega el rol MOBILITYBO_REVISION_SAP + su permiso + el mapeo Rol->Permiso.
-- NO toca la Application ni los roles ya registrados por 001, 006 y 007: solo suma.
--
-- QUE ES: el rol de quien revisa las ordenes que SAP rechazo. Ve SOLO la seccion
-- "Ordenes rechazadas por SAP": reasigna centro y destino por item y reenvia la
-- orden. No da acceso a Regiones, Marketing ni a la consola de soporte.
--
-- Se asigna DELIBERADAMENTE: Usuario no lo incluye, porque reenviar ordenes a SAP
-- es una tarea operativa que se le da a quien la hace.
--
-- Prioridad de resolucion tras este script:
--   SUPERADMIN > Soporte > RevisionSap > Usuario > Administrador > Marketing
-- (apps/api/src/auth/role-resolver.service.ts).
--
-- ⚠️ La app resuelve UN SOLO rol por usuario. Quien tenga USER + REVISION_SAP queda
-- como RevisionSap y pierde el resto: quien necesite las dos cosas va con SUPERADMIN.
-- Ver docs/ROLES_Y_PERMISOS.md.
--
-- Idempotente y ADITIVO: solo INSERT IF NOT EXISTS, no modifica ni borra filas
-- ajenas. Sin USE (depende de la conexion). Correr en Mobility_QATEST y en
-- Mobility-PROD. Ver docs/DEPLOY_SQL_PENDIENTE.md.
-- =============================================================================
SET NOCOUNT ON;
GO

DECLARE @Client CHAR(36) = '00000000-0000-0000-0000-000000000001'; -- Default Organization
DECLARE @Now BIGINT = DATEDIFF_BIG(MILLISECOND, '1970-01-01', SYSUTCDATETIME());
DECLARE @App CHAR(36) = (SELECT Guid FROM Applications WHERE AppId = 'MobilityBackOffice');

-- Prerequisito: 001 tiene que haber corrido antes. Sin la Application, el rol no
-- tiene donde colgarse y el accessMatrix no lo devolveria.
IF @App IS NULL
BEGIN
    RAISERROR('MobilityBackOffice no esta registrada. Correr 001_RegisterMobilityBackOfficeApp.sql primero.', 16, 1);
    RETURN;
END;

-- -----------------------------------------------------------------------------
-- 1. Rol Revisión SAP (idempotente por RoleKey global).
-- -----------------------------------------------------------------------------
;WITH R(RoleName, RoleKey) AS (
    SELECT 'Revisión SAP', 'MOBILITYBO_REVISION_SAP'  -- ordenes rechazadas por SAP
)
INSERT INTO Roles (Guid, GuidApiLoginClients, GuidApplications, RoleName, RoleKey, TimeStamp, ServerTimestamp)
SELECT CONVERT(CHAR(36), NEWID()), @Client, @App, R.RoleName, R.RoleKey, @Now, @Now
FROM R
WHERE NOT EXISTS (SELECT 1 FROM Roles ro WHERE ro.RoleKey = R.RoleKey);
PRINT '>> MobilityBackOffice revision SAP role ensured.';

-- -----------------------------------------------------------------------------
-- 2. Permisos (idempotente por PermissionKey).
--
--    Hoy BackOffice autoriza por ROL, no por permiso. Se separan "ver" y "reenviar"
--    para que el dia que haga falta distinguirlos no haya que volver a ITManager.
-- -----------------------------------------------------------------------------
;WITH P(PermissionKey, DisplayName, Description) AS (
    SELECT 'MOBILITYBO_REVISION_SAP_VIEW', 'Ver ordenes rechazadas por SAP',
           'Bandeja y detalle de las ordenes que SAP rechazo, sin precios' UNION ALL
    SELECT 'MOBILITYBO_REVISION_SAP_RESEND', 'Reasignar y reenviar a SAP',
           'Cambiar centro y destino por item y reenviar la orden a SAP'
)
INSERT INTO Permissions (Guid, GuidApplications, PermissionKey, DisplayName, Description, TimeStamp, ServerTimestamp)
SELECT CONVERT(CHAR(36), NEWID()), @App, P.PermissionKey, P.DisplayName, P.Description, @Now, @Now
FROM P
WHERE NOT EXISTS (SELECT 1 FROM Permissions x WHERE x.PermissionKey = P.PermissionKey AND x.GuidApplications = @App);
PRINT '>> MobilityBackOffice revision SAP permissions ensured.';

-- -----------------------------------------------------------------------------
-- 3. Mapeo Rol -> Permiso (idempotente por par). SuperAdmin tambien los recibe.
-- -----------------------------------------------------------------------------
;WITH M(RoleKey, PermissionKey) AS (
    SELECT 'MOBILITYBO_REVISION_SAP', 'MOBILITYBO_REVISION_SAP_VIEW'   UNION ALL
    SELECT 'MOBILITYBO_REVISION_SAP', 'MOBILITYBO_REVISION_SAP_RESEND' UNION ALL
    SELECT 'MOBILITYBO_SUPERADMIN',   'MOBILITYBO_REVISION_SAP_VIEW'   UNION ALL
    SELECT 'MOBILITYBO_SUPERADMIN',   'MOBILITYBO_REVISION_SAP_RESEND'
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
PRINT '>> MobilityBackOffice revision SAP role-permission map ensured.';
GO

PRINT '== Rol Revisión SAP registrado: MOBILITYBO_REVISION_SAP + REVISION_SAP_VIEW + REVISION_SAP_RESEND ==';
GO
