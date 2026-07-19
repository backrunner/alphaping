ALTER TABLE machines ADD COLUMN public_slug TEXT;

UPDATE machines
SET public_slug = lower(hex(randomblob(16)))
WHERE public_slug IS NULL OR public_slug = '';

CREATE UNIQUE INDEX machines_workspace_public_slug_uq
  ON machines (workspace_id, public_slug);
