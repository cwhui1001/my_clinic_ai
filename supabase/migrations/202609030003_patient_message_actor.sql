-- PostgreSQL enum values must be committed before a later migration can use
-- them in stored functions. Keep this migration separate from the pipeline.
alter type public.message_actor add value if not exists 'patient' after 'guest';
