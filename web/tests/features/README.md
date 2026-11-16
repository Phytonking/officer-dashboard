# Behaviour specs (BDD)

`*.feature` files here describe user-facing behaviour in Gherkin. Each one is implemented by a
Playwright spec next to it in `web/tests/` using the small helper in `tests/bdd.ts`:

| Gherkin | Playwright |
| --- | --- |
| `Feature:` | `Feature(name, { shots }, body)` → `test.describe` |
| `Background:` | `Background(fn)` → `test.beforeEach` |
| `Scenario:` | `Scenario(name, fn)` → `test` |
| `Given` / `When` / `Then` / `And` / `But` | `Given(text, fn)` … → `test.step` |

A step function returns the page it acted on, and the helper saves a screenshot of it to
`web/tmp/verify/<suite>/<NN-scenario>/<NN-keyword-step>.png` (gitignored). Steps that only call
APIs return nothing and take no screenshot.

## Drift check

The last test in each BDD spec (`features/<name>.feature matches the implemented steps`) parses
the `.feature` file and the spec source and fails unless every `Scenario:` title and every step
line appears in the spec, word for word and in the same order. Edit both together.

## Running `launchpad.feature`

The suite needs the Go server built with the dev login (`-tags dev`, `DEV_AUTH=1`) and seeded
demo data. It signs in through `POST /auth/dev`, including `launchpad=<token>&discord=<id>`,
which accepts a Launchpad invite with the same server code as the Discord callback.

```sh
# 1. Front end
cd web && npm ci && npm run build

# 2. API + static site on :8099 with a seeded database
cd ../server
go build -tags dev -o /tmp/dashboard-dev ./cmd/dashboard
/tmp/dashboard-dev seed -reset -db /tmp/bdd.db
DB_PATH=/tmp/bdd.db DEV_AUTH=1 STATIC_DIR=../web/dist ADDR=127.0.0.1:8099 /tmp/dashboard-dev serve &

# 3. Run (desktop project; phone screenshots are taken inside the steps)
cd ../web
WEB_ORIGIN=http://127.0.0.1:8099 npx playwright test tests/launchpad.bdd.spec.ts --project=desktop
```

Each run creates its own cohort, builders, mentor contact and Discord IDs, so it can be run
again on the same database. The final scenario archives that run's cohort, so the register's
default cohort goes back to the seeded one. Earlier runs' mentors are marked unavailable at
the start of the mentor scenario, so auto-assign always picks this run's mentor.

To use the Astro dev server instead of the built site, start it with `API_ORIGIN` pointing at
the Go server and drop `WEB_ORIGIN`.
