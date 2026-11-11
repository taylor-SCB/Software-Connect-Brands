# Verify 2 — final test pass (commit c76fde8)

Machine 2 of 3. Fresh database `scb_v2` (setup.sh), `next typegen` and
`next build` clean, suites run against the production build on :3400 with
`run-suites.sh plain:…`. No app code changed.

| Suite | Result | Steps | Time |
|---|---|---|---|
| looks | PASS | 31 / 31 | 105 s |
| overlay-readability | PASS | 16 / 16 | 57 s |
| login-case | PASS | 10 / 10 | 6 s |
| template-replace | PASS | 18 / 18 | 20 s |
| products-ratesheets | PASS | 27 / 27 | 28 s |
| products-scale | PASS | 18 / 18 | 24 s |
| catalog-suppliers | PASS | 38 / 38 | 64 s |
| variations-pictures | PASS | 30 / 30 (0 page errors) | 49 s |
| import-ratesheet | PASS | 25 / 25 | 35 s |

**9 of 9 suites passed on the first run, 213 steps.** No reruns needed,
no failures or flakes to diagnose.
