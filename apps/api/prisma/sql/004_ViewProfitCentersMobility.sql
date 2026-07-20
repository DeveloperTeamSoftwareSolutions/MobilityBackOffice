-- =============================================================================
-- Mobility BackOffice — VIEW_ProfitCentersMobility (versionado del objeto)
-- -----------------------------------------------------------------------------
-- Wrapper de lectura sobre [SAPServices].[dbo].[ProfitCenters] (CEBEs). Es la
-- fuente del typeahead de CEBEs y de los diagnósticos del módulo de Regiones.
--
-- POR QUE EXISTE ESTE SCRIPT: la vista se venía consumiendo desde MobilityManager
-- sin estar versionada en ningún repositorio. Si se pierde (p. ej. al actualizar
-- SAPServices, como ya pasó con otros wrappers), no había forma de recrearla.
-- La definición de abajo fue extraída VERBATIM de Mobility_QATEST el 2026-07-20.
--
-- NO SOBREESCRIBE: si la vista ya existe, este script NO la altera — solo avisa.
-- La vista la consumen otras apps (MobilityManager) y su definición en PROD podría
-- diferir legítimamente de la de QATEST. Para comparar antes de decidir, ver la
-- query de diagnóstico al final.
--
-- Sin USE (depende de la conexión). Ver docs/DEPLOY_SQL_PENDIENTE.md.
-- =============================================================================
SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.VIEW_ProfitCentersMobility') IS NULL
BEGIN
    EXEC sp_executesql N'
CREATE VIEW [dbo].[VIEW_ProfitCentersMobility]
AS
SELECT
    t.TimeStamp                                                AS TimeStamp,
    t.ServerTimestamp                                          AS ServerTimestamp,
    t.DeletedTimestamp                                         AS DeletedTimestamp,
    t.Guid                  COLLATE Latin1_General_100_CI_AI_SC AS Guid,
    t.GuidTenants           COLLATE Latin1_General_100_CI_AI_SC AS GuidTenants,
    t.GuidSapCallLogs       COLLATE Latin1_General_100_CI_AI_SC AS GuidSapCallLogs,
    t.ProfitCenterCode      COLLATE Latin1_General_100_CI_AI_SC AS ProfitCenterCode,
    t.ProfitCenterName      COLLATE Latin1_General_100_CI_AI_SC AS ProfitCenterName,
    t.ShowInMobility                                           AS ShowInMobility
FROM [SAPServices].[dbo].[ProfitCenters] t
WHERE (t.DeletedTimestamp IS NULL OR t.DeletedTimestamp = 0)
  AND t.ShowInMobility = 1
  AND t.Disabled IS NULL;';
    PRINT '>> VIEW_ProfitCentersMobility created.';
END
ELSE
    PRINT '>> VIEW_ProfitCentersMobility ya existe: NO se modifica. Comparar definicion si hay dudas.';
GO

-- -----------------------------------------------------------------------------
-- Diagnóstico: ver la definición vigente para compararla con la de este script.
-- -----------------------------------------------------------------------------
-- SELECT sm.definition
-- FROM sys.sql_modules sm
-- WHERE sm.object_id = OBJECT_ID('dbo.VIEW_ProfitCentersMobility');

PRINT '== VIEW_ProfitCentersMobility verificada ==';
GO
