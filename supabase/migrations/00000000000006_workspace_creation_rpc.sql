-- Atomic workspace creation: insert the workspace and its owner
-- membership row in a single transaction. security invoker (the
-- default) so RLS still applies exactly as if the caller ran both
-- inserts themselves — this function exists for atomicity, not to
-- bypass authorization.
create function public.create_workspace_with_owner(workspace_name text, workspace_slug text)
returns public.workspaces
language plpgsql
as $$
declare
  new_workspace public.workspaces;
begin
  insert into public.workspaces (name, slug, owner_id)
  values (workspace_name, workspace_slug, auth.uid())
  returning * into new_workspace;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace.id, auth.uid(), 'owner');

  return new_workspace;
end;
$$;
