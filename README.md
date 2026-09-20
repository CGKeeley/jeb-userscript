# Just Eat for Business UserScript

A single self-contained script for `app.business.just-eat.co.uk/my-meals` (the rebranded City Pantry
"individual choice" site). Delivered as a bookmarklet rather than a Tampermonkey-style UserScript, since it
needs to run in locked-down browsers that block installing real browser extensions. It adds a **Compare menus**
button next to each upcoming day. Clicking it fetches the menu of every provider on that day, across both
lunch slots, and shows them in one sortable, filterable table.

## Install

The latest build is published at https://cgkeeley.github.io/jeb-userscript/ — drag the link from there. To build locally instead:

1. `npm install && npm run build`
2. Open `dist/install.html` in a browser and drag the orange link to your bookmarks bar, or create a bookmark
   manually and paste the contents of `dist/bookmarklet.url.txt` as its URL.
3. Go to https://app.business.just-eat.co.uk/my-meals and click the bookmark. If you click it anywhere else it
   redirects you to that page; click it again once there.

The bookmarklet is about 38 KB and has no external dependencies, so it works in locked-down browsers that block
third-party script hosts. Clicking it a second time is harmless: it refreshes the data and re-adds any missing
buttons. The site reloads itself once shortly after first load, so if the buttons vanish, click the bookmark again.

## What the comparison shows

- Every non-hidden item available at the vendor's selected location, from every provider that day, with the
  provider name linking to that provider's ordering page (`/my-meals/<orderId>`).
- Two views, switchable in the header: **Tiles** (default) with large photos, and a **Table**. The choice is
  remembered. Each provider gets a colour (tile top border, table row stripe) and its logo sits on the tile.
- Type chips (Mains, Sides, Desserts, Other), a **Within budget** toggle that hides anything needing a top-up,
  and a **★ Favourites** toggle. Star any item (tile corner or table row); favourites are remembered by
  vendor and dish name, so they carry across days.
- Filters (diets, mode, type, providers by name, slots, within budget, favourites) persist in the browser
  between runs of the bookmarklet. Max price is saved per day instead — a £3 cap today doesn't carry over to
  tomorrow's comparison — and old days' caps are dropped automatically so the saved data doesn't grow forever.
  Click a photo to see it large; Escape closes it.
- Provider checkboxes in the filter bar: all on by default; untick to drop a provider (OR across ticked ones).
- Sorted by price descending by default. Click a table header or use the sort dropdown.
- Diet filter: Vegetarian, Vegan, Pescatarian, Gluten free, Dairy free, Nut free, Halal.
  **Match any (inclusive)** shows items matching at least one selected diet (e.g. vegetarian OR pescatarian).
  **Match all (exclusive)** shows items matching every selected diet.
  Bundles that can satisfy a diet with the right component choice count as matching and show dashed tags.
- Slot filter (12:00 - 12:30 vs 12:30 - 13:00), free-text search over name, description, provider, section and
  ingredients, and a max price box.
- **Choose** on a row or tile opens that provider inside the app, scrolls to the item and presses + for you.
  You then click the site's own **Confirm Choice**. For items with options or bundles it only scrolls to the
  item so you can pick. Nothing is ordered until you confirm. The comparison is only hidden, not closed: a
  **Back to comparison** pill at the bottom right restores it with your filters, view and sort intact.
  Escape, clicking outside, or **Minimise** also hide it; **Close** discards it.
- The **Compare menus** button itself is disabled (with a tooltip giving the open time) for a day the site
  hasn't opened for choosing yet — shown on the list as "Order is not open". The lock is per day, not per item:
  everything in an unopened day is locked together, so one disabled button covers it. Once a day is open,
  everything inside it behaves normally.
- The header shows the day's subsidised budget, what you have already spent (both slots share one budget) and
  what remains; prices above the remaining amount are red with the top-up in the tooltip. The subsidy is one
  budget for the whole day, shared across both slots and every vendor, used up in the order you confirm.
  Once it is gone the site offers a Pay button (card payment) instead of Confirm Choice. Spend is re-fetched
  every time the comparison reappears (via the pill), so confirming an order and coming back updates
  "remaining" without needing to reload the whole page.
- **Copy as Markdown** copies the items currently shown, grouped by slot and provider with price, kcal, diets,
  allergens, ingredients and budget context, ready to paste into an LLM.
- Prices above the day's budget are red. Items you have already chosen are marked. Sold-out providers are listed
  in the header but not fetched, because the API answers 409 for them.

## How it works

The page's own JSON API is called with the session cookies:

- `GET /api/eaters/me/carts?from=<local midnight ISO>` lists upcoming carts (one per meal slot) with the
  `eaterOptions` (vendors) for each. Days in the DOM are matched to carts via the `Order <humanId>` labels.
- `GET /api/individual-choice/<eaterOption.orderId>/summary` returns a vendor's full menu, including
  `dietaries`, `possibleDietaries` (custom items), `allergens`, `kcal`, section `hidden` flags and per-location
  `availability`. It answers even before the choice window opens (`Cart.choiceOpenTime`), but the bookmarklet
  doesn't use that early access: the **Compare menus** button for that day is disabled instead of relying on
  the summary page to be locked.

Item types: `SingleItem`, `CustomItem` (option sections) and `ItemBundle` (choice groups). For bundles the best
case is computed as the intersection across groups of the union within each group. The API's `possibleDietaries`
field on custom items is the worst case (flags that survive every option) and is ignored.

### Basket semantics (found by recording the site, see `scripts/explore-cart*.mjs`)

The + / - buttons on a provider page change nothing on the server and write nothing to storage: the basket is
in-memory Angular state. **Confirm Choice** is the order. It sends one request:

```
PUT /api/eaters/me/orders/<eaterOption.orderId>/cart
{"cartItems":[{"item":"<itemId>","quantity":1,"type":"CartSingleItem"}],
 "departmentReference":"","deskNumber":null,"hasEaterConfirmedAge":false,"recommendedItemId":null}
```

`GET` on the same URL returns the confirmed cart (`item.cartItems`). The bookmarklet never calls the PUT; it
drives the site's own UI up to the confirm button so the user stays in control.

## Development

```
npm run login          # opens a headed browser; log in once. Saves a persistent profile under auth/ (git-ignored)
npm run check-session  # read-only: is the saved profile still logged in? exits 1 if not
npm run build          # bundles src/ into dist/bookmarklet.js, dist/bookmarklet.url.txt and dist/install.html
npm run typecheck
npm run test:unit      # pure logic tests (filtering, sorting, flattening)
npm run test:live      # drives the real site with the saved profile, headed (Cloudflare blocks headless Chromium)
npm run preview        # injects the built bookmarklet on the real page and screenshots the overlay to auth/
```

Corporate SSO sessions expire; `npm run login` waits up to 15 minutes for you to complete it and only reports
success once it actually sees the meals list logged in (it used to print "Saved" unconditionally on timeout —
fixed after that produced a false positive during unattended testing).

Layout:

- `src/bookmarklet.ts` entry: finds day rows, adds buttons, keeps them present via a MutationObserver.
- `src/ui.ts` the overlay, rendered into a shadow root so site CSS cannot interfere.
- `src/core.ts` pure data logic (flatten, filter, sort). `src/api.ts` fetch wrappers. `src/types.ts` API types.
- `tests/unit` and `tests/live` Playwright tests. `scripts/` build, login and preview helpers.

Never place an order from the test profile. The live tests only read data and open the overlay.
