-- Correct the Georgian wording for mention notifications. Only rows that
-- still carry the old, broken text are touched, so admin edits are kept.
UPDATE translations
   SET value = 'მოგნიშნა {name}',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE lang = 'ka'
   AND key = 'mentioned you in {name}'
   AND value = 'გამოგიხმო ჩათში: {name}';

UPDATE translations
   SET value = 'მოგნიშნა კომენტარში',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE lang = 'ka'
   AND key = 'mentioned you in a comment'
   AND value = 'მოგვახლო თქვენს კომენტარში';

UPDATE translations
   SET value = 'მოგნიშნა საერთო ჩატში',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE lang = 'ka'
   AND key = 'mentioned you in the global channel'
   AND value = 'მოგნიშნა გლობალურ არხში';
