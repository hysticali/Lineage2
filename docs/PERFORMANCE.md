# Exploration performance

Baseline measured on 2026-10-15 using Node 22.23.3 and an AMD Ryzen 5 5600.
`performance-baseline.json` records full measurements and the fixture description.
The fixture is a balanced binary descendant tree with all six visible generations expanded.

| People | Baseline descendant fan | Ancestor fan | Search scan |
| --- | --- | --- | --- |
| 100 | 15.63 ms | 0.57 ms | 0.07 ms |
| 1,000 | 188.07 ms | 0.08 ms | 0.42 ms |
| 10,000 | 3,583.86 ms | 0.11 ms | 4.10 ms |

Targets set before optimization: on this reference machine, a first descendant
fan build should take less than 50 ms for 1,000 people and 200 ms for 10,000 people.
A warmed name/date/place search should take less than 50 ms for 10,000 people.
The UI should render a bounded page of search results, not 10,000 buttons.

These are application computation targets, not guarantees for network transfer,
database latency, media decoding, or every device. Browser behavior and mobile
layout are verified separately by Playwright.

Run `npm run benchmark` to measure the current implementation. Results after
optimization will be recorded separately so the baseline remains reviewable.

## Indexed graph results

`performance-current.json` records the current production graph/search helpers
on the same reference machine. Child, spouse, sibling, and normalized search
indexes are cached per immutable archive snapshot and released with that
snapshot. The fan remains bounded to six generations; search renders 25 results
per page. Iterative path traversal tracks visited people to terminate on cycles.

| People | Descendant fan | Ancestor fan | Warmed production search |
| --- | --- | --- | --- |
| 100 | 7.57 ms | 0.95 ms | 0.16 ms |
| 1,000 | 4.84 ms | 0.14 ms | 0.23 ms |
| 10,000 | 32.08 ms | 0.07 ms | 1.05 ms |

All measured descendant and warmed-search targets pass. The old baseline used
a simple text scan; the current search column calls the actual normalized,
multi-term, paged search helper. Their search timings are therefore not a direct
before/after comparison. Ancestor timings reflect this fixture's limited parent
structure, not every possible pedigree. Runtime warm-up and machine load affect
individual timings. Browser tests separately exercise pagination, direct links,
history, selection, empty states, and narrow-screen zoom.

## Final milestone audit rerun

[performance-final.json](benchmarks/performance-final.json) records the final rerun on the
same machine with Node 22.23.3. The original baseline and indexed measurements
are retained separately.

| People | Descendant fan | Ancestor fan | Warmed production search |
| --- | --- | --- | --- |
| 100 | 8.515 ms | 1.147 ms | 0.179 ms |
| 1,000 | 5.687 ms | 0.113 ms | 0.282 ms |
| 10,000 | 34.312 ms | 0.073 ms | 1.474 ms |

All documented targets pass in this rerun. The same fixture and interpretation
limits apply; these timings are not an end-to-end browser latency guarantee.
