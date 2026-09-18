-- app.uuidv7() is the id of every row. If it is wrong, every id is.
begin;
select plan(4);

select is(substr(app.uuidv7()::text, 15, 1), '7', 'the version nibble says 7');
select ok(substr(app.uuidv7()::text, 20, 1) in ('8', '9', 'a', 'b'), 'the variant bits say RFC 4122');
select ok(
  (select a < b from (select app.uuidv7() as a, pg_sleep(0.002), app.uuidv7() as b) t),
  'an id made later sorts later');
select is(
  (select count(distinct app.uuidv7()) from generate_series(1, 1000)),
  1000::bigint,
  'a thousand ids are a thousand distinct ids');

select * from finish();
rollback;
