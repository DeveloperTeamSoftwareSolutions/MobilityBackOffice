-- =============================================================================
-- Mobility BackOffice — Rol de Soporte (consola de soporte, fase 1)
-- Agrega el rol MOBILITYBO_SUPPORT + sus dos permisos + el mapeo Rol->Permiso.
-- NO toca la Application ni los roles ya registrados por 001: solo suma.
--
-- El rol es EXCLUSIVO del DevelopersTeam: habilita la consola que audita la
-- trazabilidad de ordenes/cotizaciones y (fases 2 y 3) corrige estados en
-- caliente. SuperAdmin tambien entra, por la regla transversal de la app.
--
-- Prioridad de resolucion tras este script:
--   SUPERADMIN > Soporte > Administrador > Marketing
-- (apps/api/src/auth/role-resolver.service.ts). OJO: la app resuelve UN SOLO rol
-- por usuario, asi que a quien tenga ADMIN + SUPPORT le gana Soporte y pierde
-- Regiones. Quien necesite ambos accesos va con SUPERADMIN.
-- Ver docs/ROLES_Y_PERMISOS.md y docs/SPEC_CONSOLA_SOPORTE.md (riesgo R2).
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
-- 1. Rol de soporte (idempotente por RoleKey global).
-- -----------------------------------------------------------------------------
;WITH R(RoleName, RoleKey) AS (
    SELECT 'Soporte', 'MOBILITYBO_SUPPORT'  -- consola de soporte (DevelopersTeam)
)
INSERT INTO Roles (Guid, GuidApiLoginClients, GuidApplications, RoleName, RoleKey, TimeStamp, ServerTimestamp)
SELECT CONVERT(CHAR(36), NEWID()), @Client, @App, R.RoleName, R.RoleKey, @Now, @Now
FROM R
WHERE NOT EXISTS (SELECT 1 FROM Roles ro WHERE ro.RoleKey = R.RoleKey);
PRINT '>> MobilityBackOffice support role ensured.';

-- -----------------------------------------------------------------------------
-- 2. Permisos de soporte (idempotente por PermissionKey). La app los recibe sin
--    el prefijo (SUPPORT_VIEW, SUPPORT_OVERRIDE).
--
--    Hoy BackOffice autoriza por ROL, no por permiso: los dos existen para que el
--    registro quede completo y para poder separar "auditar" de "corregir" cuando
--    lleguen las fases 2 y 3 sin volver a tocar ITManager.
-- -----------------------------------------------------------------------------
;WITH P(PermissionKey, DisplayName, Description) AS (
    SELECT 'MOBILITYBO_SUPPORT_VIEW',     'Auditar documentos',        'Buscar ordenes/cotizaciones y ver su linea de tiempo completa'      UNION ALL
    SELECT 'MOBILITYBO_SUPPORT_OVERRIDE', 'Corregir documentos',       'Forzar estados y banderas de control de ordenes/cotizaciones'
)
INSERT INTO Permissions (Guid, GuidApplications, PermissionKey, DisplayName, Description, TimeStamp, ServerTimestamp)
SELECT CONVERT(CHAR(36), NEWID()), @App, P.PermissionKey, P.DisplayName, P.Description, @Now, @Now
FROM P
WHERE NOT EXISTS (SELECT 1 FROM Permissions x WHERE x.PermissionKey = P.PermissionKey AND x.GuidApplications = @App);
PRINT '>> MobilityBackOffice support permissions ensured.';

-- -----------------------------------------------------------------------------
-- 3. Mapeo Rol -> Permiso (idempotente por par). Soporte: ambos. SuperAdmin:
--    ambos tambien (ve todo).
-- -----------------------------------------------------------------------------
;WITH M(RoleKey, PermissionKey) AS (
    SELECT 'MOBILITYBO_SUPPORT',    'MOBILITYBO_SUPPORT_VIEW'     UNION ALL
    SELECT 'MOBILITYBO_SUPPORT',    'MOBILITYBO_SUPPORT_OVERRIDE' UNION ALL
    SELECT 'MOBILITYBO_SUPERADMIN', 'MOBILITYBO_SUPPORT_VIEW'     UNION ALL
    SELECT 'MOBILITYBO_SUPERADMIN', 'MOBILITYBO_SUPPORT_OVERRIDE'
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
PRINT '>> MobilityBackOffice support role-permission map ensured.';
GO

PRINT '== Rol de Soporte registrado: MOBILITYBO_SUPPORT + SUPPORT_VIEW + SUPPORT_OVERRIDE ==';
GO
