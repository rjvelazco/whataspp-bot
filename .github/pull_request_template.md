## What this changes

<!-- One or two sentences. Link the issue or the plan step if there is one. -->

## Stacked PR

- **Base branch:** <!-- `main`, or the PR below this one in the stack -->
- [ ] The base branch is already merged into `main`, **or** this PR is not ready to merge yet.

> Stacked PRs merge strictly bottom-up. Merging one whose base is not yet in `main` is what
> orphaned 12 commits last time.

## Definition of done

- [ ] `npm run lint` passes
- [ ] `npm run build` passes (type-check)
- [ ] `npm test` passes
- [ ] `npm run build:web` passes and stays inside the bundle budgets
- [ ] Renders correctly at **1440px**, **900px** and **390px**
- [ ] No spacing value off the 8-point grid
- [ ] No colour outside the two token files
- [ ] No database identifier visible anywhere in the UI
- [ ] Every interactive control has a visible boundary before interaction
- [ ] Keyboard reachable — `aria-sort` on sortable headers, `role="switch"` on toggles
- [ ] Copy is in plain Spanish, addressed to a shop owner
- [ ] No constant, label map or copy string duplicated instead of imported

## How I verified it

<!-- What you actually ran and saw. Screenshots at the three widths for UI changes.
     "Should work" is not verification. -->
