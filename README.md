# Just Eat for Business: Compare menus bookmarklet

A single self-contained bookmarklet for `app.business.just-eat.co.uk/my-meals` (the rebranded City Pantry
"individual choice" site). It adds a **Compare menus** button next to each upcoming day. Clicking it fetches the
menu of every provider on that day, across both lunch slots, and shows them in one sortable, filterable table.

## Install

1. `npm install && npm run build`
2. Open `dist/install.html` in a browser and drag the orange link to your bookmarks bar, or create a bookmark
   manually and paste the contents of `dist/bookmarklet.url.txt` as its URL.
3. Go to https://app.business.just-eat.co.uk/my-meals and click the bookmark. If you click it anywhere else it
   redirects you to that page; click it again once there.

The bookmarklet is about 16 KB and has no external dependencies, so it works in locked-down browsers that block
third-party script hosts. Clicking it a second time is harmless: it refreshes the data and re-adds any missing
buttons. The site reloads itself once shortly after first load, so if the buttons vanish, click the bookmark again.

## What the comparison shows

- Every non-hidden item available at the vendor's selected location, from every provider that day, with the
  provider name linking to that provider's ordering page (`/my-meals/<orderId>`).
- Two views, switchable in the header: a **Table** and **Tiles** with large photos. The choice is remembered.
- Sorted by price descending by default. Click a table header or use the sort dropdown.
- Diet filter: Vegetarian, Vegan, Pescatarian, Gluten free, Dairy free, Nut free, Halal.
  **Match any (inclusive)** shows items matching at least one selected diet (e.g. vegetarian OR pescatarian).
  **Match all (exclusive)** shows items matching every selected diet.
  Bundles that can satisfy a diet with the right component choice count as matching and show dashed tags.
- Slot filter (12:00 - 12:30 vs 12:30 - 13:00), free-text search over name, description, provider, section and
  ingredients, and a max price box.
- Prices above the day's budget are red. Items you have already chosen are marked. Sold-out providers are listed
  in the header but not fetched, because the API answers 409 for them.

## How it works

The page's own JSON API is called with the session cookies:

- `GET /api/eaters/me/carts?from=<local midnight ISO>` lists upcoming carts (one per meal slot) with the
  `eaterOptions` (vendors) for each. Days in the DOM are matched to carts via the `Order <humanId>` labels.
- `GET /api/individual-choice/<eaterOption.orderId>/summary` returns a vendor's full menu, including
  `dietaries`, `possibleDietaries` (custom items), `allergens`, `kcal`, section `hidden` flags and per-location
  `availability`. It works even before the choice window opens.

Item types: `SingleItem`, `CustomItem` (option sections) and `ItemBundle` (choice groups). For bundles the best
case is computed as the intersection across groups of the union within each group. The API's `possibleDietaries`
field on custom items is the worst case (flags that survive every option) and is ignored.

## Development

```
npm run login       # opens a headed browser; log in once. Saves a persistent profile under auth/ (git-ignored)
npm run build       # bundles src/ into dist/bookmarklet.js, dist/bookmarklet.url.txt and dist/install.html
npm run typecheck
npm run test:unit   # pure logic tests (filtering, sorting, flattening)
npm run test:live   # drives the real site with the saved profile, headed (Cloudflare blocks headless Chromium)
npm run preview     # injects the built bookmarklet on the real page and screenshots the overlay to auth/
```

Layout:

- `src/bookmarklet.ts` entry: finds day rows, adds buttons, keeps them present via a MutationObserver.
- `src/ui.ts` the overlay, rendered into a shadow root so site CSS cannot interfere.
- `src/core.ts` pure data logic (flatten, filter, sort). `src/api.ts` fetch wrappers. `src/types.ts` API types.
- `tests/unit` and `tests/live` Playwright tests. `scripts/` build, login and preview helpers.

Never place an order from the test profile. The live tests only read data and open the overlay.
