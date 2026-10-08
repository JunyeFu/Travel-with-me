# Documentation

This directory contains current 2D documents and archived 3D references. Current product boundaries are owned by [README](../README.md), [Architecture](../ARCHITECTURE.md), [Roadmap](../TODO.md), and the [3D archive boundary](../archive/3d/README.md). `DEVELOPMENT.md` is a historical 2026-07-20 snapshot.

## Product

| Document                                                         | Owner scope                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [Product architecture](product/architecture-blueprint.md)        | product definition, 2D truth boundary, delivery stages and document ownership  |
| [Commercialization](product/commercialization.md)                | commercial readiness gaps, monetization gates, non-goals and launch sequencing |
| [AI guide import evaluation](product/guide-import-evaluation.md) | guide-import quality methodology, fixtures, metrics and evaluation commands    |
| [Roadmap](../TODO.md)                                            | active backlog and next executable batch                                       |

## Architecture

| Document                                                 | Owner scope                                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [Architecture overview](../ARCHITECTURE.md)              | implemented architecture, ADRs and module boundaries                         |
| [2D data foundation](architecture/2d-data-foundation.md) | active 2D geographic fact contract                                           |
| [RAG upgrade plan](architecture/rag-upgrade-plan.md)     | RAG architecture, phased implementation, embedding/vector store tech choices |

### Archived 3D references

Files under `architecture/3d/` and `engineering/qa/` describe the frozen 3D implementation. They are not active requirements.

## Engineering

| Document                                                         | Owner scope                                                       |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| [API reference](engineering/api.md)                              | BFF endpoint contracts, response shapes and environment variables |
| [Development workflow](engineering/development-workflow.md)      | local tools, environment preparation and engineering workflow     |
| [Live provider testing](engineering/testing/live-provider.md)    | opt-in live-provider smoke policy and commands                    |
| [AI guide extraction prompt](../server/prompts/guide-extract.md) | server-side extraction prompt contract                            |

## Operations

| Document                                                 | Owner scope                                                |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| [Release playbook](operations/release-playbook.md)       | release checks, smoke validation, rollback and monitoring  |
| [Quality gate status](operations/quality-gate-status.md) | historical 2026-07-17 ledger, not current release evidence |
| [Changelog](../CHANGELOG.md)                             | released version notes                                     |

## Design

| Document                                                 | Owner scope                                         |
| -------------------------------------------------------- | --------------------------------------------------- |
| [UI visual style guide](design/ui-visual-style-guide.md) | visual language, color, layout and icon constraints |

## Root Documents

| Document                           | Owner scope                                             |
| ---------------------------------- | ------------------------------------------------------- |
| [README](../README.md)             | project overview, setup and reader entry points         |
| [Contributing](../CONTRIBUTING.md) | commands, test expectations and contributor conventions |
| [AGENTS](../AGENTS.md)             | local Codex workflow rules                              |

## Deleted Or Archived

The following Markdown files are intentionally not part of the maintained commercial documentation
set:

- `docs/codex-self-prompts.md`: removed because agent self-prompts are not product, engineering, or release source-of-truth documents.
- `docs/ops/working-tree-2026-06-22.md`: removed because it was a dated worktree inventory superseded by git history and current quality gates.
- `docs/design-refactor-plan.md`
- `docs/enterprise-delivery-playbook.md`
- `docs/project-delivery-maturity-review.md`
- `docs/technical-feature-implementation-scorecard.md`
- `docs/s2-completion-gap-review.md`
- `docs/3d-terrain-implementation-research.md`
- `docs/3d-deep-research-prompt.md`
- `travel_with_me_merged_context.md`
