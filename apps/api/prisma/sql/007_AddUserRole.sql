-- =============================================================================
-- Mobility BackOffice — Rol Usuario
-- Agrega el rol MOBILITYBO_USER + su permiso + el mapeo Rol->Permiso.
-- NO toca la Application ni los roles ya registrados por 001 y 006: solo suma.
--
-- QUE ES: el rol para quien usa el back-office en el dia a dia. Ve TODO el
-- back-office MENOS la consola de soporte, que altera documentos del flujo
-- Mobility y queda restringida al DevelopersTeam.
--
-- No es "SuperAdmin sin la consola": SuperAdmin ademas entra a la consola y a
-- cualquier seccion futura sin importar como se declare.
--
-- Prioridad de resolucion tras este script:
--   SUPERADMIN > Soporte > Usuario > Administrador > Marketing
-- (apps/api/src/auth/role-resolver.service.ts).
--
-- Usuario va ARRIBA de Administrador y Marketing porque los CONTIENE a los dos:
-- si ganara uno de ellos, el usuario perderia la otra mitad del back-office.
-- Va DEBAJO de Soporte porque Soporte se asigna deliberadamente.
--
-- ⚠️ La app resuelve UN SOLO rol por usuario. Quien tenga USER + SUPPORT queda
-- como Soporte y pierde el resto: quien necesite las dos cosas va con SUPERADMIN.
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
-- 1. Rol Usuario (idempotente por RoleKey global).
-- -----------------------------------------------------------------------------
;WITH R(RoleName, RoleKey) AS (
    SELECT 'Usuario', 'MOBILITYBO_USER'  -- todo el back-office menos la consola de soporte
)
INSERT INTO Roles (Guid, GuidApiLoginClients, GuidApplications, RoleName, RoleKey, TimeStamp, ServerTimestamp)
SELECT CONVERT(CHAR(36), NEWID()), @Client, @App, R.RoleName, R.RoleKey, @Now, @Now
FROM R
WHERE NOT EXISTS (SELECT 1 FROM Roles ro WHERE ro.RoleKey = R.RoleKey);
PRINT '>> MobilityBackOffice user role ensured.';

-- -----------------------------------------------------------------------------
-- 2. Permiso (idempotente por PermissionKey).
--
--    Hoy BackOffice autoriza por ROL, no por permiso: existe para que el registro
--    en ITManager quede completo y legible, igual que los de soporte.
-- -----------------------------------------------------------------------------
;WITH P(PermissionKey, DisplayName, Description) AS (
    SELECT 'MOBILITYBO_USER_ACCESS', 'Uso general del back-office',
           'Acceso a todas las secciones del back-office excepto la consola de soporte'
)
INSERT INTO Permissions (Guid, GuidApplications, PermissionKey, DisplayName, Description, TimeStamp, ServerTimestamp)
SELECT CONVERT(CHAR(36), NEWID()), @App, P.PermissionKey, P.DisplayName, P.Description, @Now, @Now
FROM P
WHERE NOT EXISTS (SELECT 1 FROM Permissions x WHERE x.PermissionKey = P.PermissionKey AND x.GuidApplications = @App);
PRINT '>> MobilityBackOffice user permission ensured.';

-- -----------------------------------------------------------------------------
-- 3. Mapeo Rol -> Permiso (idempotente por par).
--
--    Usuario recibe ademas los permisos funcionales de Administrador y Marketing,
--    porque su alcance los incluye. Los INSERT que no encuentren su permiso
--    (porque 001 uso otras claves) simplemente no insertan nada: el JOIN los
--    descarta y el script no falla.
-- -----------------------------------------------------------------------------
;WITH M(RoleKey, PermissionKey) AS (
    SELECT 'MOBILITYBO_USER',       'MOBILITYBO_USER_ACCESS' UNION ALL
    SELECT 'MOBILITYBO_SUPERADMIN', 'MOBILITYBO_USER_ACCESS'
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
PRINT '>> MobilityBackOffice user role-permission map ensured.';

-- -----------------------------------------------------------------------------
-- 4. Usuario hereda los permisos funcionales que ya existan de Administrador y
--    Marketing. Se copian por RolePermissions en vez de listarlos a mano, para
--    que el script no dependa de como los nombro 001.
--
--    Se excluyen explicitamente los de SOPORTE: son justo lo que este rol NO
--    tiene, y heredarlos por accidente seria el peor error posible aca.
-- -----------------------------------------------------------------------------
INSERT INTO RolePermissions (Guid, GuidRoles, GuidPermissions, TimeStamp, ServerTimestamp)
SELECT CONVERT(CHAR(36), NEWID()), usuario.Guid, rp.GuidPermissions, @Now, @Now
FROM RolePermissions rp
JOIN Roles origen        ON origen.Guid = rp.GuidRoles
                        AND origen.GuidApplications = @App
                        AND origen.RoleKey IN ('MOBILITYBO_ADMIN', 'MOBILITYBO_MARKETING')
JOIN Permissions pe      ON pe.Guid = rp.GuidPermissions
                        AND pe.PermissionKey NOT LIKE 'MOBILITYBO_SUPPORT%'
CROSS APPLY (SELECT Guid FROM Roles WHERE RoleKey = 'MOBILITYBO_USER' AND GuidApplications = @App) usuario
WHERE (rp.DeletedTimestamp IS NULL OR rp.DeletedTimestamp = 0)
  AND NOT EXISTS (
      SELECT 1 FROM RolePermissions ya
      WHERE ya.GuidRoles = usuario.Guid AND ya.GuidPermissions = rp.GuidPermissions
        AND (ya.DeletedTimestamp IS NULL OR ya.DeletedTimestamp = 0)
  );
PRINT '>> MobilityBackOffice user inherited admin/marketing permissions.';
GO

PRINT '== Rol Usuario registrado: MOBILITYBO_USER + USER_ACCESS (sin permisos de soporte) ==';
GO
