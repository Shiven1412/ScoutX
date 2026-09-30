alter table public.intent_signals
  drop constraint if exists intent_signals_category_check;

alter table public.intent_signals
  add constraint intent_signals_category_check
  check (category in (
    'pain_point',
    'seeking_alternative',
    'feature_request',
    'buying_intent',
    'recommendation_request',
    'self_promotion',
    'product_launch',
    'thought_leadership',
    'career_discussion',
    'general_discussion',
    'ignore'
  ));