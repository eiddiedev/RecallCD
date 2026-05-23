# RecallCD Frontend Agent Handoff

This document is for the frontend/design agent working with RecallCD. The goal is to let frontend polish continue while the photo classification logic is improved in parallel, without creating avoidable merge conflicts.

## Product Direction

RecallCD is an offline mobile-first interactive photo archive. The core interaction is a Ye-inspired 3D CD case shelf:

- Users scroll through stacked CD cases.
- Tapping a CD in portrait mode makes it stand up in place.
- A bottom photo drawer opens and shows the photos inside that collection.
- Users can import local photos, and the app classifies them offline into collections.

Keep the work demo-friendly, tactile, and visual. Do not add external resources, links, network calls, or CDN assets.

## Ownership Boundaries

### Frontend Agent Owns

You may edit these areas:

- `index.html`
  - Layout, CSS, copy, HUD, drawer markup, responsive behavior.
  - Mobile portrait polish and visual hierarchy.
- `js/main.js`
  - Three.js visual presentation functions:
    - `setupThree`
    - `createCaseGroup`
    - `createTitlePlane`
    - `makeAlbumTitleTexture`
    - `makeCoverTexture`
    - `makeTextTexture`
    - `makeFrontSpineTexture`
    - `tick`
    - `resize`
  - UI interaction functions:
    - `setupEvents`
    - pointer handlers
    - `presentCollection`
    - `hidePresentation`
    - `renderDrawer`
    - `hideDrawer`
    - `onDrawerClick`
    - `drawDetail`
    - detail/drawer rendering helpers

### Classification Agent Owns

Do not edit these areas unless the classification owner explicitly asks:

- `analyzeSource`
- `handleFiles`
- `fileToImage`
- `formatDate`
- Classification labels and routing logic.
- EXIF/time/location parsing if added.
- Any future `js/classifier.js`, `js/exif.js`, or similar classification modules.

### Shared Contract

Frontend code should treat each photo object as having this shape:

```js
{
  id: string,
  name: string,
  source: CanvasImageSource,
  paletteLabel: string,
  sceneLabel: string,
  timeLabel: string,
  locationLabel: string
}
```

Frontend may display these fields, but should not rename or remove them. Classification work may improve how these fields are produced.

Each collection should keep this shape:

```js
{
  id: string,
  title: string,
  spine: string,
  palette: { primary: string, secondary: string, text: string },
  tags: string[],
  photos: Photo[]
}
```

Frontend may adjust colors and display styling, but avoid changing `id` values because classifier routing depends on them.

## Hard Rules

- Do not add `fetch`, `XMLHttpRequest`, `WebSocket`, remote scripts, remote images, `iframe`, `<a>` links, or `window.location`.
- Do not add CDN fonts, Google Fonts, remote Three.js, or online image assets.
- Do not reformat the whole `js/main.js`; edit only the functions you need.
- Do not rename classification fields to make UI copy easier.
- Do not commit generated package files like `photo-tape-machine.zip` unless the team is doing a release/package commit.
- Keep total zipped size under 8MB.

## Recommended Frontend Tasks

Good next tasks for the frontend agent:

- Refine the portrait tapped-CD composition so the standing CD, rear title layer, and bottom drawer feel more intentional.
- Improve drawer thumbnail spacing and selected-photo state.
- Improve horizontal fallback only if it does not disturb portrait behavior.
- Add subtle motion polish with existing Three.js and CSS transitions.
- Improve empty/import states without changing classification behavior.

Avoid these tasks:

- Rewriting the classifier.
- Replacing the current Three.js CD model.
- Moving all logic into a new framework.
- Adding build tools unless both teammates agree.

## Parallel Workflow

Use separate branches:

- Classification work: `feature/photo-classifier`
- Frontend work: `feature/frontend-polish`

Before starting work:

```bash
git pull --rebase origin main
git checkout -b feature/frontend-polish
```

Before pushing:

```bash
node --check js/main.js
rg -n "fetch\\(|XMLHttpRequest|WebSocket|<iframe|<a\\s|window\\.location|https?://" index.html js/main.js
```

The `rg` command should return no matches for app code.

Commit narrowly:

```bash
git add index.html js/main.js docs/FRONTEND_AGENT_HANDOFF.md
git commit -m "Polish frontend interaction"
git push -u origin feature/frontend-polish
```

## If A Conflict Happens

Prefer preserving classification behavior and reapplying visual edits around it.

If both branches touched `js/main.js`:

- Keep classifier changes in `analyzeSource`, `handleFiles`, and import/parsing helpers.
- Keep frontend changes in rendering, motion, CSS-linked state, drawer, and Three.js functions.
- Do not resolve by accepting one whole file version.
- After resolving, test photo import and portrait CD click again.

## Acceptance Checklist

Before handing back:

- Portrait shelf still scrolls.
- Tapping a CD opens the standing-CD presentation and drawer.
- Drawer shows photo thumbnails.
- Imported photos still route into a collection.
- No console errors.
- No horizontal page scroll.
- Offline constraints are still respected.
- Zip size remains under 8MB if packaged.
