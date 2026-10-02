<p><img src="web/img/mark.svg" width="48" alt=""></p>

# MealConvene

Group meal orders for teams. Everyone picks their own food under the same per-person limit, and the coach gets one combined order, plus a browser extension that builds that order in the restaurant's own online cart.

Built for a robotics team that orders Subway. Free software under the GNU AGPL-3.0.

## How an order works

1. **Roster (optional).** Students can add their own names from the order link; anyone who does is saved to the roster to tap next time. The organizer can also paste names. Only names are kept.
2. **Restaurant.** Add Subway (a starter menu is built in) or paste any menu. Check the prices against your store and tick *I checked these prices*. Until that box is ticked, no order can open, because the limit is only as accurate as the prices.
3. **Order.** Pick the restaurant, set the limit (the same for everyone), choose whether tax and tip count against it, and set an optional closing time.
4. **One link in team chat.** Each person types their name (or taps it, if it is already listed) once. After that the name is locked to their device, so nobody can order as someone else or claim a second limit. Each person also has a personal link, which the organizer can copy or reset.
5. **Students pick.** They choose items, sizes, breads, toppings and so on, and watch a running "$X left" bar. The server re-checks every cart against the limit, so the phone's math is a convenience, not the guard.
6. **The organizer orders.** The order page shows what to order (identical picks merged, with who each one is for), a per-person pickup sheet, and a CSV. With the extension, *Add all* builds each item in the restaurant's cart. Checkout and payment are always done by hand.

## Run it

Needs Node 22.6 or newer. There are no dependencies and no build step.

```bash
npm start            # http://127.0.0.1:4330, data in data/mealconvene.db
npm test             # invariant tests
```

The first visit asks you to create the organizer account.

| Variable | Default | |
|---|---|---|
| `PORT` | `4330` | |
| `HOST` | `127.0.0.1` | `0.0.0.0` to listen beyond this machine |
| `MC_DB` | `data/mealconvene.db` | SQLite file |
| `MC_SECURE_COOKIES` | unset | `1` behind HTTPS (also detected from `X-Forwarded-Proto`) |
| `MC_SOURCE_URL` | this project's GitHub repo | Where `/source` points. **Change it if you run a modified copy** (AGPL §13). |

In production, put it behind an HTTPS reverse proxy (Caddy, nginx or Cloudflare Tunnel). Students' links are the only thing standing between them and someone else's order, so serve them over HTTPS only.

## The cart-fill extension

`extension/` is a Chrome extension (Manifest V3). Until it's on the Chrome Web Store:

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the `extension` folder.
2. On the order page, click **Copy cart-fill link**.
3. On subway.com, pick your store and open the menu. Click the extension, paste the link, press **Load order**, then **Show on this page**, then **Add all**.

It works one item at a time, at human speed, in your own signed-in browser. When it can't do something, it **stops** and leaves that item open for you to finish by hand: a half-built sandwich in the bag is worse than a stop. Ticked lines are skipped on the next run.

**Subway status: unverified.** Subway's site blocks automated browsers, so the Subway steps were written from the pages a person can see and tested against a mock of that flow, not against a live order. If it stops on your first real order, press **Save page map** in the panel while the sandwich customizer is open and send the file in. The page map records headings and buttons, never anything typed, and it's what an exact adapter is written from.

Other restaurants use the generic steps, which match by name. Use the restaurant's own names in your menu.

The extension is part of this project and under the same AGPL-3.0 license; the package carries its own copy in `extension/LICENSE` and a short `extension/NOTICE.txt`. It only ever acts in your own browser, on pages you opened, at the speed a person would; whether that is allowed on a given restaurant's site is governed by that site's terms of use, which you agree to as its customer.

## Privacy

- Students have no accounts. They have a name on a roster and a link.
- No email addresses, phone numbers or ages are collected from students.
- The cart-fill link carries what to order and first-name labels, never anyone's link.
- Delete an order once the food is picked up, and everyone's picks go with it.

## Working with TeamConvene

MealConvene stands alone. When TeamConvene ships, the plan is in [docs/teamconvene.md](docs/teamconvene.md): the roster can come from TeamConvene instead of being typed. MealConvene records orders, not money.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributors sign the [CLA](CLA.md) once, before their first merge. You keep your copyright; the CLA lets SoftwareConvene LLC use your work under the AGPL and under other licenses, including in a paid hosted version. Contributors under 18 sign together with a parent or guardian.

## License

Copyright © 2026 SoftwareConvene LLC and the MealConvene contributors.

MealConvene, including the browser extension in `extension/`, is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, version 3 only (AGPL-3.0-only). It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full terms.

**If you run a copy for other people over a network, you must offer them its source.** Every page links to `/source`, which redirects to `MC_SOURCE_URL`. The default points at this repository, which is only correct if you run it unmodified. If you change anything, publish your changed source and set `MC_SOURCE_URL` to it (AGPL section 13). Students using an order link are users too; that is why the link is on every page.

SoftwareConvene LLC also offers MealConvene under other terms and may run it as a hosted service. Ask at **contact@softwareconvene.org**.

### Trademarks

Subway® and the sandwich names in the starter menu (`src/core/templates/subway.txt`) are trademarks of their owner. They appear only to say which restaurant the menu and the cart-fill steps are for. MealConvene is an independent project and is not affiliated with, sponsored by or endorsed by Subway or any other restaurant. "MealConvene" and "SoftwareConvene" are names of SoftwareConvene LLC; the AGPL does not grant permission to use them for a modified version in a way that suggests it is ours.
