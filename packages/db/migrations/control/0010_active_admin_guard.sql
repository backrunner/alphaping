CREATE TRIGGER memberships_keep_active_admin_on_update
BEFORE UPDATE OF role, status ON memberships
WHEN OLD.role = 'admin'
  AND OLD.status = 'active'
  AND (NEW.role != 'admin' OR NEW.status != 'active')
  AND NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE workspace_id = OLD.workspace_id
      AND user_id != OLD.user_id
      AND role = 'admin'
      AND status = 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'workspace requires an active administrator');
END;

CREATE TRIGGER memberships_keep_active_admin_on_delete
BEFORE DELETE ON memberships
WHEN OLD.role = 'admin'
  AND OLD.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE workspace_id = OLD.workspace_id
      AND user_id != OLD.user_id
      AND role = 'admin'
      AND status = 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'workspace requires an active administrator');
END;
