-- =============================================================================
-- United Tribes: inviting someone now sends them an email
--
-- invite_person saved the invitation and the role, and queued nothing, so the person invited was never told. This adds one trigger on the
-- invitations table that queues the email. It changes no existing function and no table, so every way of inviting is covered at once:
-- Admin → People, God Mode → give a role, and any later caller.
--
--   * an address with no account yet (or one that has not verified it): "You are invited to serve as ..., sign in with this address."
--     The role is added the first time they sign in with it, exactly as before
--   * an address that already has an account: the role is already on it, and the email says so
--   * inviting the same address for the same role again (the invitation is extended) sends it again, at most once a day
--   * the email comes from the church office. It never names the person who invited, and never the owner
--   * it carries no secret and no link that works as a key
--   * nothing here can stop an invitation: a fault is written to the notice faults and the invitation goes ahead
--   * invitations the system itself makes (no one invited them) send nothing
--
-- The trigger runs at the end of the invitation's transaction (deferred), so it sees the invitation as it finally stands: still waiting,
-- or already accepted because the person had an account.
--
-- Way back: supabase/rollback/20261227000100_invitation_email.down.sql drops the trigger and the function. Emails already queued stay.
-- =============================================================================

create function public.invitation_email_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.invitations%rowtype;
  v_day text := to_char(now() at time zone 'Africa/Lagos', 'YYYYMMDD');
begin
  begin
    select * into i from public.invitations x where x.id = new.id;
    -- Gone since, or made by the system rather than invited by a person
    if not found or i.invited_by is null then
      return null;
    end if;

    if i.status = 'accepted' and i.resolved_by is not null then
      -- The person had an account: the role is already theirs
      perform public.enqueue_message(
        p_person => i.resolved_by, p_template => 'role_invitation',
        p_params => jsonb_build_object('role', i.role::text, 'existing', true),
        p_dedupe => 'invite:' || i.id || ':' || v_day, p_force => 'email');
    elsif i.status = 'pending' and i.expires_at > now() then
      -- No account yet: write to the address itself
      perform public.enqueue_message(
        p_person => null, p_template => 'role_invitation',
        p_params => jsonb_build_object('role', i.role::text, 'existing', false,
                                       'days', greatest(1, ceil(extract(epoch from (i.expires_at - now())) / 86400)::integer)),
        p_dedupe => 'invite:' || i.id || ':' || v_day, p_force => 'email', p_to_email => i.email);
    end if;
  exception when others then
    perform public.notice_fault('invitation email', sqlerrm);
  end;
  return null;
end;
$$;

create constraint trigger invitation_email
  after insert or update of expires_at on public.invitations
  deferrable initially deferred
  for each row execute function public.invitation_email_trg();

-- A trigger function is never called by a person or by the sending service.
revoke execute on function public.invitation_email_trg() from public, anon, authenticated;
