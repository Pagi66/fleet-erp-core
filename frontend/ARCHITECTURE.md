# Frontend Architecture Baseline

This document is the source of truth for frontend architecture in Fleet ERP Core. All frontend changes must align with it.

## Baseline Status

- Scope: `frontend/`
- Applies to: all frontend features, refactors, and reviews
- Enforcement: block non-compliant changes until corrected

## Layers

### API

Purpose:

- communicate with backend HTTP endpoints
- define transport request and response contracts
- normalize transport envelopes only

Allowed:

- `fetch` usage
- request headers, query params, body serialization
- response parsing and transport error mapping

Forbidden:

- UI shaping
- cross-request orchestration
- shared state management
- business workflow logic

### Services

Purpose:

- orchestrate frontend use cases
- combine API calls
- apply frontend workflow sequencing
- trigger state actions
- choose which view-model builders and state updates to invoke

Allowed:

- multi-call flows
- retries, dedupe, refresh coordination
- domain-aware orchestration that is not purely presentational

Forbidden:

- direct rendering
- JSX
- direct shared state mutation outside the state layer contract
- storing async data
- caching async data
- persisting async data

### State

Purpose:

- act as the single source of truth for shared client state
- store async resource state, cache, invalidation, and mutation status

Allowed:

- resource state transitions
- cache updates
- loading, success, and error state
- invalidation rules
- shared async data ownership

Forbidden:

- direct HTTP calls if they bypass the API layer
- UI rendering logic
- ad hoc mutation from pages or components

### View-Models

Purpose:

- transform backend and state data into UI-ready shapes
- isolate display labels, grouped fields, derived counts, and presentation-safe values

Allowed:

- pure data shaping
- derived display fields
- presentation-friendly naming
- reused display logic across views

Forbidden:

- HTTP calls
- shared state mutation
- side effects
- React hooks
- direct reads from state modules

### Components

Purpose:

- render UI
- receive props
- emit UI events upward

Allowed:

- presentational conditional rendering
- local UI-only state
- formatting that does not encode workflow or business rules

Forbidden:

- direct API calls
- business logic
- domain orchestration
- shared state ownership for application flows

### Pages

Purpose:

- compose routes from state-backed data and presentational components
- connect route params to services or state
- pass data downward into components

Allowed:

- route-level composition
- invoking state or service entry points
- selecting which components render
- simple selection of already-prepared data

Forbidden:

- direct `fetch`
- direct API client orchestration
- inline business rules
- inline view-model shaping that should be reusable
- data transformation beyond simple selection
- duplicated logic already defined in services or view-models
- orchestration logic

## Folder Structure

Target structure:

```text
frontend/
  ARCHITECTURE.md
  src/
    api/
      client.ts
      reports.ts
      events.ts
    services/
      dashboard.service.ts
      ship-overview.service.ts
      failed-events.service.ts
    state/
      dashboard-store.ts
      ship-overview-store.ts
      failed-events-store.ts
    view-models/
      dashboard.vm.ts
      ship-overview.vm.ts
      failed-events.vm.ts
    components/
    pages/
    App.tsx
    main.tsx
    styles.css
```

Notes:

- Create new folders only when the code needs them.
- Keep `components/` and `pages/` thin.
- Keep transport code under `api/`.

## Data Flow Rules

Required flow:

1. page requests a use case
2. service orchestrates the use case
3. api layer communicates with backend
4. state layer owns shared async state when required
5. service interprets responses and triggers state updates
6. view-model layer shapes domain-safe data for display
7. components render the view-model output

Short form:

`Page -> Service -> API -> State -> ViewModel -> Component`

Service triggers -> State owns -> UI reads

Read-only flows may bypass state only if all of the following are true:

- data is used in a single component
- data is not reused across views
- no caching or refresh behavior is required

If any of these conditions is false, the state layer is mandatory.

## Boundaries Between Layers

- Only the API layer talks to backend HTTP directly.
- Services may call API modules and state modules.
- Services must not store, cache, or persist async data.
- State owns loading, success, error, caching, and invalidation for shared async data.
- Pages and components must read shared async data from state, not directly from services.
- State may depend on API modules only through explicit state actions or loaders.
- View-models may depend on API response types or state shapes passed in as inputs, but must stay pure, deterministic, and stateless.
- Components may depend on view-models and UI props, not on API modules.
- Pages may compose services, state, and components, and pass data downward, but must not absorb their responsibilities.

## Async Ownership Rules

- All shared async data must be owned by the state layer.
- Services only trigger state actions and orchestrate flows.
- Services must not store, cache, or persist async data.
- State is responsible for loading, success, error, caching, and invalidation.
- Pages and components must read shared async data from state, not directly from services.

## API Contract Rule

- API layer returns raw transport-normalized data only.
- Services interpret API responses and map them into domain-safe structures.
- View-models shape domain-safe structures into UI-ready format.

Required flow:

`API -> Service -> ViewModel -> UI`

## View-Model Purity

- View-models must be pure functions.
- View-models must be deterministic.
- View-models must be stateless.
- View-models must not depend on React hooks.
- View-models must not read directly from state modules.
- View-models must not perform side effects.
- If logic is reused across views, it belongs in a view-model.

## Page Responsibility Limits

- Pages must compose services, state, and components.
- Pages must pass data downward.
- Pages must not perform data transformation beyond simple selection.
- Pages must not duplicate logic already defined in services or view-models.
- Pages must not contain business logic.
- Pages must not contain orchestration logic.

## Evolution Rule

- Logic must move downward: `page -> service -> state -> view-model`.
- Never push logic upward into pages or components.
- Every refactor must reduce responsibility at the page level.

## Enforcement Rules

- If a change touches a file that already violates this baseline, correct that violation before extending the file.
- If new code breaks a boundary, block the change and correct the structure first.
- If a user asks to bypass this baseline, reject the shortcut and redirect to a compliant path.
- Implement frontend work in small, immediately testable steps only.

## Current Baseline Violations To Correct Before Extension

- None currently recorded. Continue enforcing this baseline on all new changes.
