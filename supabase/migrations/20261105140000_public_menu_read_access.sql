-- The public menu returns only active business/menu details intended for guests.
-- Ordering and table-session RPCs remain restricted to the service role.
grant execute on function public.public_menu(text) to anon;
