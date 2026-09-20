# Just Eat for Business UserScript

A bookmarklet for `app.business.just-eat.co.uk/my-meals` that compares every provider's menu for a day in one filterable view.

## Install

Drag the bookmarklet from https://cgkeeley.github.io/jeb-userscript/ to your bookmarks bar. Open https://app.business.just-eat.co.uk/my-meals and click it. A **Compare menus** button appears beside each day. If you click the bookmarklet from another page, it takes you to the meals page; click it again there.

To build locally, run `npm install && npm run build`, then open `dist/install.html` or paste the contents of `dist/bookmarklet.url.txt` into a bookmark's URL.

## Use

The comparison shows items across providers and meal slots. You can search, filter by diet or price, and sort the results. **Choose** takes you to the item on the provider's page; you still need to confirm the choice on the site to place an order.

## Development

```sh
npm run build
npm run typecheck
npm run test:unit
npm run login          # save a browser session for live tests
npm run check-session  # check whether that session is still valid
npm run test:live
npm run preview
```

Live tests use the saved session in `auth/` and require access to the site.
