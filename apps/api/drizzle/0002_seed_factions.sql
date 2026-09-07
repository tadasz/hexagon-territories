-- Custom migration (specs/001-repo-foundations/data-model.md §4.2): the three factions. Names,
-- emoji and colours live only here (docs/architecture.md §1); renaming is a new migration.
INSERT INTO "factions" ("id", "slug", "name", "emoji", "color_light", "color_dark", "sort") VALUES
  (1, 'owls',  'Owls',  '🦉', '#4CAF50', '#2E7D32', 1),
  (2, 'foxes', 'Foxes', '🦊', '#FFC107', '#FFA000', 2),
  (3, 'deer',  'Deer',  '🦌', '#2196F3', '#1976D2', 3)
ON CONFLICT ("id") DO NOTHING;
