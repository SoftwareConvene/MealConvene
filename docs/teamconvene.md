# MealConvene ↔ TeamConvene (planned, not built)

MealConvene ships standalone first. These are the seams left for TeamConvene, so connecting the two later is an addition and not a rewrite.

## Roster comes from TeamConvene

- `person.external_id` is already in the schema, with a unique index. A sync matches on it instead of on names, so a rename in TeamConvene can't create a duplicate.
- Direction: TeamConvene → MealConvene only. MealConvene receives **display names and active/inactive status, nothing else**. Everything else about a person stays in TeamConvene.
- Shape: an organizer pastes a TeamConvene API key into MealConvene's Account page, and MealConvene pulls `GET /v1/people?fields=display_name,active`. Pull rather than push, so MealConvene needs no inbound credential.
- A person TeamConvene marks inactive is retired here, never deleted, because past orders name them.

## Opening an order from a TeamConvene event

- A TeamConvene event (build day, competition) gets an "Order food" action that deep-links to MealConvene's New order page with `?title=&people=<external_ids>&close_at=` filled in. That's a link, not an API: MealConvene stays usable without TeamConvene.

## Not planned

- Single sign-on between the two. Organizers are few; students never sign in to MealConvene at all.
- MealConvene writing anything back to TeamConvene's roster.
