# Just Eat for Business UserScript

A bookmarklet for `app.business.just-eat.co.uk/my-meals` that compares every provider's menu for a day in one filterable view, and shows a live arrivals board for each day's deliveries.

## Install

Drag the bookmarklet from https://cgkeeley.github.io/jeb-userscript/ to your bookmarks bar. Open https://app.business.just-eat.co.uk/my-meals and click it. A **Compare menus** button appears beside each day. If you click the bookmarklet from another page, it takes you to the meals page; click it again there.

To build locally, run `npm install && npm run build`, then open `dist/install.html` or paste the contents of `dist/bookmarklet.url.txt` into a bookmark's URL. The bookmark holds the script compressed (about 23 KB rather than 54 KB) and unpacks it when clicked, which keeps it well under Firefox's 64 KB bookmark limit; `dist/bookmarklet.js` is the plain script.

## Use

The comparison shows items across providers and meal slots. You can search, filter by diet or price, and sort the results. **Choose** takes you to the item on the provider's page; you still need to confirm the choice on the site to place an order.

**Lunch arrivals** opens a live board for that day, like a station arrivals board, listing every restaurant delivering to your office, whether or not you ordered from it. Each row shows the restaurant, its live delivery window (or the time it arrived), a countdown such as "in 4 min", "Due now" or "6 min late", the site's current status, and the order number. Orders still to come are listed soonest first, and arrived ones below them, most recent first. Restaurants you ordered from are tinted and tagged **Yours** with what you ordered, and a strip under the header says where your deliveries are. Before the day, each row shows the requested slot and "tomorrow" or "in 3 days"; live windows and statuses appear on the day. The board refreshes every 30 seconds while the tab is visible (every 5 minutes while the next delivery is more than two hours away), and stops refreshing once everything has arrived. **Full screen** puts it on a shared screen.

## Development

```sh
npm run build
npm run typecheck
npm run test:unit
npm run login          # save a browser session for live tests
npm run check-session  # check whether that session is still valid
npm run test:live
npm run preview
node scripts/preview-arrivals.mjs  # screenshot the first day's arrivals board (--day n for another)
```

Live tests use the saved session in `auth/` and require access to the site.
