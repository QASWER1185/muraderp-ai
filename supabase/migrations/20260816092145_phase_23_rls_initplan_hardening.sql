ALTER POLICY memberships_select_self_or_same_org
ON public.organization_memberships
USING (
  (user_id = (select auth.uid()))
  OR EXISTS (
    SELECT 1
    FROM public.organization_memberships own
    WHERE own.organization_id = organization_memberships.organization_id
      AND own.user_id = (select auth.uid())
      AND own.status = 'active'
      AND own.role = ANY (ARRAY['owner', 'admin'])
  )
);

ALTER POLICY organizations_select_member
ON public.organizations
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    WHERE om.organization_id = organizations.id
      AND om.user_id = (select auth.uid())
      AND om.status = 'active'
  )
);

ALTER POLICY permissions_select_authenticated
ON public.permissions
USING ((select auth.uid()) IS NOT NULL);

ALTER POLICY role_permissions_select_authenticated
ON public.role_permissions
USING ((select auth.uid()) IS NOT NULL);