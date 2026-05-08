# Semantic Map Template

This document is not a passive documentation artifact. It is the semantic
contract an agent should read before modifying code and update after changing
behavior.

## Architecture

- What the system does
- Main execution path
- Major components and dependencies

## Modules

- `module-or-file`: role, responsibilities, collaborators

## Types

- `TypeName`: purpose, fields, invariants

## Functions

For each function or method:

- purpose
- inputs
- outputs
- side effects
- preconditions
- postconditions

## Runtime Flow

- startup
- normal execution
- error paths
- teardown

## Side Effects

- files written
- network calls
- state changes
- caches or temporary artifacts

## Agent Change Protocol

- Before editing: read this map and the source files relevant to the request.
- During editing: treat this map as the current behavioral contract unless source inspection proves it stale.
- After editing: update changed module, function, runtime-flow, and side-effect sections in the same change.
- If code and map disagree: trust observed code, then repair the map before relying on it for further edits.

## Change Sync

- changed files
- behavioral changes
- compatibility impact
