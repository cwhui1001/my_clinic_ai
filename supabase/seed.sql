insert into public.clinics (slug, name, timezone)
values ('nightingale-demo', 'Nightingale Women''s Health Clinic', 'Asia/Kuala_Lumpur')
on conflict (slug) do update
set name = excluded.name,
    timezone = excluded.timezone,
    updated_at = now();

insert into public.channel_rules (
  clinic_id,
  source_channel,
  identity_level,
  time_of_day,
  opening_strategy,
  priority
)
select
  clinics.id,
  rule.source_channel::public.source_channel,
  rule.identity_level::public.identity_level,
  rule.time_of_day,
  jsonb_build_object('headline', rule.headline, 'prompt', rule.prompt),
  100
from public.clinics
cross join (
  values
    ('staff_referral', 'anonymous', 'any', 'Your care team shared this private starting point.', 'Review the topic and continue when you are ready.'),
    ('social_comment', 'social_handle', 'any', 'Thanks for reaching out.', 'You can ask a general question here before sharing anything personal.'),
    ('instagram_ad_click', 'anonymous', 'any', 'Get a clear starting point—without signing up first.', 'Ask about services, availability, or general education.'),
    ('website_widget', 'anonymous', 'any', 'How can we help?', 'Ask about this service, clinic hours, or availability.')
) as rule(source_channel, identity_level, time_of_day, headline, prompt)
where clinics.slug = 'nightingale-demo'
on conflict (clinic_id, source_channel, identity_level, time_of_day, priority)
do update set
  opening_strategy = excluded.opening_strategy,
  active = true,
  updated_at = now();
